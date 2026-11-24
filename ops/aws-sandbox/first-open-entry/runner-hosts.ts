import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { AwsSdkDeploymentAdapter, type AwsSdkAdapterDependencies } from "../../../lib/deployments/execution/aws-sdk-adapter.ts";
import type { AwsSdkDynamoDbEpochAuthorityDependencies } from "../../../lib/deployments/execution/aws-sdk-dynamodb-epoch-authority.ts";
import { SANDBOX_FIRST_OPEN as scope } from "../../../lib/deployments/execution/first-onboarding-run-once.ts";
import { releaseMetadataApi } from "../../releases/aws-runtime.ts";
import { firstOpenBuyerSigningMaterial, sdkConfig } from "../first-open-express-aws.ts";
import type { FirstOpenRolePorts } from "../first-open-workflow-launcher.ts";
import { firstOpenNeonPort } from "./runner-neon.ts";
import { checkedRunnerPaths, firstOpenSameRunUpload, managementBackend } from "./runner-supply.ts";
import { bindFirstOpenSession } from "../first-open-sessions.ts";
import { createFirstOpenRunOnceControl } from "./runner-control.ts";
import { bindFirstOpenRunOnceReadiness, type FirstOpenIndependentReadiness } from "./runner-readiness.ts";
import type { FirstOpenControlledCfnPreclaimProof } from "../first-open-express-runtime.ts";
import type { FirstOpenVersionAuthorityReader } from "../first-open-controlled-cfn.ts";
import { firstOpenInspectorVersionAuthorityProof, type FirstOpenVersionAuthoritySource } from "../first-open-version-authority-proof.ts";
import prepared from "../first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

const fail = (code: string): never => { throw Error("FIRST_OPEN_HOST_" + code); };
const hex = /^[a-f0-9]{64}$/;
type RoleResult<K extends keyof FirstOpenRolePorts> = Awaited<ReturnType<FirstOpenRolePorts[K]>>;

/** Only Management obtains its backend/tool paths and boolean claim reader
 * here. Lifecycle credentials are still issued by the protected binder. */
export function managementHost(neonReviewUrl: string, controlledCfnPreclaimProof?: FirstOpenControlledCfnPreclaimProof,
  versionAuthorityReader?: FirstOpenVersionAuthorityReader): FirstOpenRolePorts["management"] {
  return async ({ signal }) => {
    const paths = checkedRunnerPaths("management");
    const management = await managementBackend(paths, signal);
    const claimReader = firstOpenNeonPort("management", neonReviewUrl, signal);
    // Canonical digests only; the immutable mailbox remains the durable
    // cross-run evidence. A journal entry is not a COMMIT or stage ACK.
    const journal = {
      async beforeStage(facts: Record<string, unknown>) {
        signal.throwIfAborted();
        console.log("FIRST_OPEN_STAGE_INTENT", await sha256Hex(facts));
      },
      async stageObserved(facts: Record<string, unknown>) {
        signal.throwIfAborted();
        console.log("FIRST_OPEN_STAGE_OBSERVED", await sha256Hex(facts));
      },
    };
    return { management: { ...management, journal }, claimReader, controlledCfnPreclaimProof, versionAuthorityReader, dispose: claimReader.dispose };
  };
}

/** The launcher injects only the already-verified Inspector identity; no
 * other auth source or SQL handle is available to this factory. */
export const inspectHost: FirstOpenRolePorts["inspect"] = async ({ signal }) => {
  signal.throwIfAborted();
  const paths = checkedRunnerPaths("inspect"), uploadOwn = firstOpenSameRunUpload(paths);
  const readOnly: RoleResult<"inspect">["readOnly"] = credentials => {
    let api: Promise<ReturnType<typeof releaseMetadataApi>> | undefined;
    const resolve = () => api ??= (async () => {
      signal.throwIfAborted();
      const c = await credentials(signal), expiresAt = c.expiration?.getTime();
      if (!c.sessionToken || !expiresAt || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return fail("INSPECT_SESSION");
      return releaseMetadataApi({ region: scope.region, maxMetadataCallsPerSnapshot: 24 },
        { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken, expiresAt });
    })();
    return {
      async read<T>(service: string, operation: string, input: Record<string, unknown>) {
        signal.throwIfAborted();
        return (await resolve()).read<T>(service, operation, input);
      },
      async getTechnical(path, origin) {
        signal.throwIfAborted();
        if (origin !== "https://" + scope.hostname) return fail("INSPECT_ORIGIN");
        return (await resolve()).getTechnical(path, origin);
      },
    };
  };
  return { backendDirectory: paths.backend, readOnly, uploadOwn };
};

/** For the protected capsule only. No live source may be chosen from
 * workflow inputs or from an artifact issued by the writer. */
export function inspectHostWithVersionAuthority(source: FirstOpenVersionAuthoritySource, sourceSha256: string): FirstOpenRolePorts["inspect"] {
  const versionAuthorityProof = firstOpenInspectorVersionAuthorityProof(source, sourceSha256);
  return async input => ({ ...await inspectHost(input), versionAuthorityProof });
}

type FiveLogins = Record<"review" | "claim" | "complete" | "inspect" | "middle", string>;
type TenantPayment = { stripeSecretKey: string; stripeWebhookSecret: string };
export interface ReviewedRunOnceHostInputs {
  neon: FiveLogins;
  payment: TenantPayment;
  approvedSha256: string;
  control: Pick<Parameters<typeof createFirstOpenRunOnceControl>[0], "keys" | "evidence" | "template">;
  independentReadiness: FirstOpenIndependentReadiness;
}

/** The authority adapter sends/receives plain JS record fields, so only
 * DocumentClient commands may be paired with the protected transport. */
export function firstOpenWriterDynamoDependencies(transport: DynamoDBClient): AwsSdkDynamoDbEpochAuthorityDependencies {
  const client = DynamoDBDocumentClient.from(transport, {
    marshallOptions: { removeUndefinedValues: false, convertClassInstanceToMap: false },
  });
  return {
    client: client as unknown as AwsSdkDynamoDbEpochAuthorityDependencies["client"],
    commands: { get: GetCommand as unknown as AwsSdkDynamoDbEpochAuthorityDependencies["commands"]["get"],
      put: PutCommand as unknown as AwsSdkDynamoDbEpochAuthorityDependencies["commands"]["put"] },
  };
}

/** The approved installer supplies in-memory, reviewed data. No private
 * path reads, substitutions, archival, or GitHub writes in this renderer. */
export function renderRunOnceCapsule(input: ReviewedRunOnceHostInputs): Buffer {
  const data = JSON.stringify(JSON.stringify(input)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const out = Buffer.from(`import { pathToFileURL } from "node:url";
import { join } from "node:path";
const { runOnceHost } = await import(pathToFileURL(join(process.cwd(), "ops/aws-sandbox/first-open-entry/runner-hosts.ts")).href);
export const firstOpenHost = Object.freeze({ runonce: runOnceHost(JSON.parse(${data})) });
`);
  if (out.length > 32_768) return fail("RUNONCE_CAPSULE_SIZE");
  return out;
}

export function runOnceHost(input: ReviewedRunOnceHostInputs): FirstOpenRolePorts["runonce"] {
  return async ({ credentials, approvalSha256, formalApprovalSha256, approval, seed, initialVersionId, signal }) => {
    if (!hex.test(approvalSha256) || input.approvedSha256 !== approvalSha256 ||
      !input.control || !input.independentReadiness || !hex.test(initialVersionId)) return fail("RUNONCE_EVIDENCE");
    if (input.control.evidence.clientTrustStoreArn !== input.independentReadiness.restoredCellCoordinates?.controlTrustStoreArn) {
      return fail("RUNONCE_TRUST_STORE");
    }
    const paths = checkedRunnerPaths("runonce"), uploadOwn = firstOpenSameRunUpload(paths);
    const session = bindFirstOpenSession("provisioner", credentials, approval.writeBefore);
    const cfg = sdkConfig(() => session.credentials(signal));
    let readApi: Promise<ReturnType<typeof releaseMetadataApi>> | undefined;
    const readiness = await bindFirstOpenRunOnceReadiness({ approval, approvalSha256, formalApprovalSha256, seed, versionId: initialVersionId,
      evidence: input.independentReadiness, read: { async read<T>(service: string, operation: string, args: Record<string, unknown>) {
        signal.throwIfAborted();
        readApi ??= (async () => {
          const c = await session.credentials(signal);
          return releaseMetadataApi({ region: scope.region, maxMetadataCallsPerSnapshot: 24,
            firstOpenTrustStoreArn: input.independentReadiness.restoredCellCoordinates.controlTrustStoreArn },
            { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken!, expiresAt: c.expiration!.getTime() });
        })();
        return (await readApi).read<T>(service, operation, args);
      } } });
    const { cellPreflight, cleanupReadiness, runtimeGrantEvidenceSha256, verifyRuntimeGrant } = readiness;
    const control = await createFirstOpenRunOnceControl({ ...input.control, approval, seed, versionId: initialVersionId, signal });
    const sts = new STSClient(cfg), cfn = new CloudFormationClient(cfg), dynamo = new DynamoDBClient(cfg);
    const signerClient = new SecretsManagerClient(cfg);
    const readBuyerSigner = firstOpenBuyerSigningMaterial(signerClient, approval.express?.buyerForwardSigner);
    type Cmd = AwsSdkAdapterDependencies["commands"]["describeStacks"];
    const never = class { constructor() { fail("UNSUPPORTED_STACK_WRITE"); } };
    const aws = new AwsSdkDeploymentAdapter(scope.region, {
      stsClient: sts as unknown as AwsSdkAdapterDependencies["stsClient"],
      cloudFormationClient: cfn as unknown as AwsSdkAdapterDependencies["cloudFormationClient"],
      commands: { getCallerIdentity: GetCallerIdentityCommand as Cmd, describeStacks: DescribeStacksCommand as Cmd,
        createStack: never, updateStack: never, deleteStack: never },
    });
    const review = firstOpenNeonPort("review", input.neon.review, signal);
    const claim = firstOpenNeonPort("claim", input.neon.claim, signal);
    const completion = firstOpenNeonPort("complete", input.neon.complete, signal);
    const inspection = firstOpenNeonPort("inspect", input.neon.inspect, signal);
    const sql = firstOpenNeonPort("middle", input.neon.middle, signal);
    let paymentUsed = false, signer: Buffer | undefined;
    const clearSigner = () => { signer?.fill(0); signer = undefined; };
    signal.addEventListener("abort", clearSigner, { once: true });
    return {
      aws, uploadOwn, sql: { review, claim, completion, inspection }, runtimeGrantEvidenceSha256, verifyRuntimeGrant,
      ports: { cellPreflight, cleanupReadiness: { verify: cleanupReadiness.verify,
        async verifyBeforeClaim(x) {
          const ready = await cleanupReadiness.verifyBeforeClaim!(x);
          const beforeClaim = AbortSignal.any([x.signal, signal, AbortSignal.timeout(15_000)]);
          const value = await readBuyerSigner(beforeClaim);
          beforeClaim.throwIfAborted();
          signer = Buffer.from(value, "ascii");
          return ready;
        },
      }, control: control.control,
        controlPayloadCompiler: control.controlPayloadCompiler },
      controlMaterial: { onVerifiedControlMaterial: control.onVerifiedControlMaterial, rememberOwnerSeed: control.rememberOwnerSeed },
      middle: { sql, dynamo: firstOpenWriterDynamoDependencies(dynamo),
      planHash: prepared.scope.planSha256, configurationHash: prepared.scope.configurationSha256 },
      async loadTenantPaymentMaterial(request) {
        signal.throwIfAborted();
        request.signal.throwIfAborted();
        if (paymentUsed || !signer || request.jobId !== scope.jobId || request.instanceId !== scope.instanceId ||
          request.approvalSha256 !== approvalSha256) return fail("PAYMENT_SCOPE");
        paymentUsed = true;
        const buyerSigningKey = signer.toString("ascii");
        clearSigner();
        return { jobId: scope.jobId, instanceId: scope.instanceId, approvalSha256, buyerSigningKey, payment: { ...input.payment } };
      },
      async dispose() {
        clearSigner(); signal.removeEventListener("abort", clearSigner); signerClient.destroy();
        control.dispose();
        await Promise.all([review, claim, completion, inspection, sql].map(p => p.dispose()));
        cfn.destroy(); dynamo.destroy(); sts.destroy();
      },
    };
  };
}
