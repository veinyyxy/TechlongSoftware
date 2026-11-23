import { firstOnboardingExpressNames, type FirstOnboardingReview } from "../first-onboarding.ts";
import type { FirstOpenBuyerSignerPin } from "../../buyer-forward/signer-binding.ts";
import type { ReleaseSamplingBinding } from "../releases/sampling.ts";
import type { AwsEcsCellDeploymentPlan } from "../types.ts";
import type { AwsSandboxTenantStackInput } from "../cloudformation/tenant-stack.ts";
import { renderExpressSingleTenantWorkloadV1 } from "../cloudformation/express-single-tenant-workload-v1.ts";
import { compileExpressBootstrapCandidateV3, type ExpressManagementTargetV3 } from "./aurora-express-bootstrap-v3.ts";
import { parseDatabaseBindingV2 } from "./aurora-database-v2.ts";
import type { DeploymentExecutionContext, TenantApprovedBaseline, TenantDatabaseLifecyclePort, TenantDatabaseMutationReceipt,
  TenantExternalOperationFence, TenantSecretInspection, TenantSecretStorePort } from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertTenantApplicationAccessProof } from "./tenant-application-access-proof.ts";
import { deriveTenantRuntimeSecretName, GuardedTenantDatabasePort, validateApprovedBaseline } from "./tenant-database.ts";

const account = "402010193138", region = "ca-central-1";
const cluster = "techlong-sandbox-express-d001";
const digest = /^[a-f0-9]{64}$/;
export const fixedSecretVersionPattern = /^[a-zA-Z0-9-]{32,64}$/;
export const FIRST_OPEN_G1_TAG_PROOF_MODE = "arn-then-name-identical-tags-v1" as const;
export interface FirstOnboardingExpressApproval {
  target: ExpressManagementTargetV3;
  nonce: string;
  baseline: TenantApprovedBaseline & { archiveVersionId: string; manifestVersionId: string };
  applicationRoleArn: string;
  lifecycleRoleArn: string;
  independentRoleArn: string;
  environmentParametersSha256: string;
  /** The real fc41597f entry requires this exact approved signer-only version. */
  buyerForwardSigner?: FirstOpenBuyerSignerPin;
  /** Explicitly reviews the two same-tag write requests that must be denied. */
  g1StandaloneTagProof?: typeof FIRST_OPEN_G1_TAG_PROOF_MODE;
  sampling: ReleaseSamplingBinding; // static; contains only the exact control public key reference
  mediaPublicBaseUrl: string;
}

type Prepare = Parameters<TenantDatabaseLifecyclePort["prepareEmptyDatabase"]>[0];
type Restore = Parameters<TenantDatabaseLifecyclePort["restoreApprovedBaseline"]>[0];
type Verify = Parameters<TenantDatabaseLifecyclePort["verify"]>[0];
type EnsureSecret = Parameters<TenantSecretStorePort["ensureRuntimeSecret"]>[0];
export interface FirstOnboardingDatabaseIdentity {
  name: string; roleName: string; ownershipMarker: string; baselineDigest: string; schemaVersion: string;
  databaseOid: string; roleOid: string; clusterResourceId: string; otherConnectableDatabases: 0;
}
export interface FirstOnboardingExpressPorts {
  database: Pick<TenantDatabaseLifecyclePort, "inspect" | "migrateSaas"> & {
    prepare(input: Prepare & { program: ReturnType<typeof compileExpressBootstrapCandidateV3> }): Promise<TenantDatabaseMutationReceipt>;
    restore(input: Restore & { archiveVersionId: string; manifestVersionId: string }): Promise<TenantDatabaseMutationReceipt>;
    activateApplication(input: Pick<Verify, "fence" | "externalFence" | "signal"> & { target: ExpressManagementTargetV3; applicationRoleArn: string;
      migrationEvidenceSha256: string }): Promise<Pick<TenantDatabaseMutationReceipt, "fence" | "externalFence" | "outcome" | "evidenceHash"> & {
        databaseName: string; roleName: string; applicationRoleArn: string; otherConnectableDatabases: 0;
      }>;
    verify(input: Verify): Promise<{ receipt: TenantDatabaseMutationReceipt; identity: FirstOnboardingDatabaseIdentity }>;
  };
  secret: {
    inspectRuntimeSecret: TenantSecretStorePort["inspectRuntimeSecret"];
    createInitial(input: EnsureSecret & { name: string; requestSha256: string; initialVersionId: string }):
      Promise<{ requestSha256: string; metadata: TenantSecretInspection }>;
  };
  /** Fixed RunOnce only: initialize control with already-verified g1 facts
   * from the recipe, not with guessed OIDs or the previous tenant's Secret. */
  onVerifiedControlMaterial?(input: { identity: FirstOnboardingDatabaseIdentity;
    runtimeSecret: ReleaseSamplingBinding["secrets"][number];
    context: DeploymentExecutionContext; fence: TenantExternalOperationFence }): Promise<void>;
}

function reject(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }

export function firstOnboardingInitialSecretVersion(input: { approvalSha256: string; name: string; jobId: string;
  epoch: TenantExternalOperationFence; baselineDigest: string }) {
  return sha256Hex({ kind: "first-onboarding-g1-initial-secret", approvalSha256: input.approvalSha256, name: input.name,
    jobId: input.jobId, epoch: input.epoch, baselineDigest: input.baselineDigest });
}

export function assertInitialSecretVersion(metadata: { ARN?: string; DeletedDate?: unknown; RotationEnabled?: boolean;
  VersionIdsToStages?: Record<string, string[]> }, arn: string, versionId: string) {
  if (metadata.ARN !== arn || metadata.DeletedDate || metadata.RotationEnabled ||
    canonicalJson(Object.keys(metadata.VersionIdsToStages ?? {})) !== canonicalJson([versionId]) ||
    !metadata.VersionIdsToStages?.[versionId]?.includes("AWSCURRENT")) reject("FIRST_ONBOARDING_SECRET_VERSION_CHANGED");
}

export function firstOpenExpressDatabaseBinding(a: FirstOnboardingExpressApproval, runtimeSecret: ReleaseSamplingBinding["secrets"][number]) {
  const { target, applicationRoleArn } = a;
  return parseDatabaseBindingV2({
    schema: "techlong/database-binding/v2", profile: "express_iam", tlsTrust: "ats-roots/v1",
    clusterArn: target.clusterArn, clusterResourceId: target.clusterResourceId, endpoint: target.endpoint, port: target.port,
    observedEngineVersion: target.observedEngineVersion, tenantDatabase: target.tenantDatabase, tenantUsername: target.tenantUsername,
    managementDatabase: target.managementDatabase, managementUsername: target.managementUsername,
    stableIdentity: target.stableIdentity, resourceGeneration: target.resourceGeneration, runtimeSecret,
    access: { authentication: "iam", internetAccessGatewayEnabled: true, applicationRoleArn, lifecycleRoleArn: a.lifecycleRoleArn },
  });
}

/** Re-render approved inputs; never use an observed template as the expectation. */
export async function renderFirstOpenExpressTemplate(stackInput: AwsSandboxTenantStackInput, a: FirstOnboardingExpressApproval,
  material: { identity: FirstOnboardingDatabaseIdentity; sampling: ReleaseSamplingBinding }, configurationHash: string) {
  const { sampling } = a, { identity, sampling: completed } = material;
  const r = await renderExpressSingleTenantWorkloadV1({ workload: stackInput, databaseOid: identity.databaseOid,
    roleOid: identity.roleOid, configurationHash,
    binding: firstOpenExpressDatabaseBinding(a, completed.secrets[1]),
  });
  const resources = r.template.Resources as Record<string, { Properties: { ContainerDefinitions: { Environment: { Name: string; Value: unknown }[] }[] } }>;
  const container = resources.TenantTaskDefinition.Properties.ContainerDefinitions[0];
  const media = { IMAGE_STORAGE_PROVIDER: "s3", IMAGE_S3_BUCKET: sampling.persistence.bucket,
    IMAGE_PUBLIC_BASE_URL: a.mediaPublicBaseUrl, ALLOW_EPHEMERAL_IMAGE_STORAGE: "false" };
  container.Environment = [...container.Environment.filter(e => !Object.hasOwn(media, e.Name)),
    ...Object.entries(media).map(([Name, Value]) => ({ Name, Value }))];
  return { ...r, templateBody: canonicalJson(r.template), templateSha256: await sha256Hex(r.template) };
}

/** One composition for one held task. No connections or write clients are created here. */
export async function composeFirstOnboardingExpress(input: {
  approval: FirstOnboardingExpressApproval; approvalSha256: string; review: FirstOnboardingReview;
  hostname: string; schemaVersion: string; baselineDigest: string; plan: AwsEcsCellDeploymentPlan;
  ports: FirstOnboardingExpressPorts; now: () => number; deadline: number;
  verifyInitialSecret(ack: { arn: string; versionId: string; externalFence: TenantExternalOperationFence }, signal: AbortSignal): Promise<void>;
}) {
  const a = structuredClone(input.approval), { target, baseline, sampling, applicationRoleArn } = a, { ports, review } = input;
  const scope = review.payload.scope;
  const tenant = { appInstanceId: scope.appInstanceId, workspaceId: scope.workspaceId, productId: scope.productId,
    environmentId: scope.environmentId, cellKey: "cell-sandbox-1" as const };
  const names = await firstOnboardingExpressNames(tenant);
  const stem = names.stableIdentity.slice(0, 16);
  const dbPlan = input.plan.resources?.tenant?.database;
  const rolePrefix = `arn:aws:iam::${account}:role/`;
  const secretPrefix = `arn:aws:secretsmanager:${region}:${account}:secret:`;
  const control = sampling.secrets[0];
  const stackPrefix = `arn:aws:cloudformation:${region}:${account}:stack/`;
  const uuidTail = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  if (target.clusterArn !== `arn:aws:rds:${region}:${account}:cluster:${cluster}` ||
    target.clusterResourceId !== "cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM" || target.stableIdentity !== names.stableIdentity ||
    dbPlan?.databaseName !== names.databaseName || dbPlan.roleName !== names.roleName ||
    sampling.database.kind !== "cluster" || sampling.database.identifier !== cluster || sampling.database.profile !== "express_iam" ||
    sampling.database.schemaVersion !== input.schemaVersion || sampling.apiHostname !== input.hostname || !/^Z[A-Z0-9]{4,31}$/.test(sampling.hostedZoneId) ||
    ![sampling.cellStackId, sampling.platformStackId].every(s => s.startsWith(stackPrefix) && uuidTail.test(s.split("/").at(-1)!)) ||
    !["ClusterName", "VpcId", "SubnetIds", "HttpsListenerArn", "ControlListenerArn"].every(k => sampling.cellOutputParameters[k] === k) ||
    Object.keys(sampling.cellOutputParameters).length !== 5 ||
    applicationRoleArn !== rolePrefix + "TechlongSandboxFirstOpen-" + stem ||
    a.lifecycleRoleArn !== rolePrefix + "TechlongSandboxTenantLifecycleTaskRole" ||
    a.independentRoleArn !== rolePrefix + "TechlongSandboxFirstOpenInspector" ||
    sampling.persistence.bucket !== `techlong-sandbox-tenant-images-${account}-${stem}` ||
    sampling.persistence.providerVariable !== "IMAGE_STORAGE_PROVIDER" || sampling.persistence.bucketVariable !== "IMAGE_S3_BUCKET" ||
    !digest.test(sampling.persistence.verificationSha256) || !digest.test(a.environmentParametersSha256) ||
    !/^https:\/\/[a-z0-9]+\.cloudfront\.net$/.test(a.mediaPublicBaseUrl) || sampling.secrets.length !== 1 ||
    !control?.arn.startsWith(secretPrefix) || !/^techlong\/sandbox\/control-public-key-[a-zA-Z0-9-]{6,128}$/.test(control.arn.slice(secretPrefix.length)) ||
    !fixedSecretVersionPattern.test(control.versionId) ||
    ![baseline.archiveVersionId, baseline.manifestVersionId].every(v => /^[A-Za-z0-9_+=./-]{1,1024}$/.test(v) && v !== "null")) {
    reject("FIRST_ONBOARDING_EXPRESS_SCOPE_CHANGED");
  }
  const program = compileExpressBootstrapCandidateV3({ target, scope: tenant, nonce: a.nonce });
  if (baseline.archiveSha256 !== input.baselineDigest || baseline.archiveSha256 !== program.baseline.archiveSha256 ||
    baseline.manifestSha256 !== program.baseline.manifestSha256) reject("FIRST_ONBOARDING_BASELINE_PIN_CHANGED");
  validateApprovedBaseline(baseline, review.jobId);
  const window = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (input.now() >= input.deadline) reject("FIRST_ONBOARDING_WINDOW_CLOSED");
  };
  const checkFence = (x: Pick<Prepare, "fence" | "externalFence" | "signal">) => {
    window(x.signal);
    const { fence: f, externalFence: o } = x;
    if (f.generation !== 1 || f.identity.stableIdentityHash !== names.stableIdentity || f.ownerDeploymentId !== scope.deploymentId ||
      o.state !== "active" || o.intent !== "provision" || o.ownerDeploymentId !== scope.deploymentId ||
      canonicalJson(o.resourceFence) !== canonicalJson(f)) reject("FIRST_ONBOARDING_EXPRESS_FENCE_CHANGED");
  };
  const controlRef = `${control.arn}:::${control.versionId}`;
  let created: { arn: string; versionId: string; epoch: string } | undefined, initialized: FirstOnboardingDatabaseIdentity | undefined;
  let prepareSent = false, restoreSent = false, migrateSent = false, activated = false, createSent = false;
  const epoch = (o: TenantExternalOperationFence) => canonicalJson(o);
  const fresh = (r: TenantDatabaseMutationReceipt) => {
    if (r.outcome !== "applied") reject("FIRST_ONBOARDING_DATABASE_ALREADY_EXISTS");
    return r;
  };
  const disabled = async (): Promise<never> => reject("FIRST_ONBOARDING_DESTROY_DISABLED");
  const database = new GuardedTenantDatabasePort({
    approvedBaseline: baseline,
    fixedFirstOpenBaseline: true,
    lifecycle: {
      inspect: async x => { checkFence(x); return ports.database.inspect(x); },
      prepareEmptyDatabase: async x => {
        checkFence(x);
        if (prepareSent) reject("FIRST_ONBOARDING_PREPARE_ALREADY_SUBMITTED");
        prepareSent = true;
        return fresh(await ports.database.prepare({ ...x, program }));
      },
      restoreApprovedBaseline: async x => {
        checkFence(x);
        if (restoreSent || !prepareSent || canonicalJson(x.baseline) !== canonicalJson(baseline)) reject("FIRST_ONBOARDING_RESTORE_OUT_OF_ORDER");
        restoreSent = true;
        return fresh(await ports.database.restore({ ...x, archiveVersionId: baseline.archiveVersionId, manifestVersionId: baseline.manifestVersionId }));
      },
      migrateSaas: async x => {
        checkFence(x);
        if (!restoreSent || migrateSent) reject("FIRST_ONBOARDING_MIGRATION_OUT_OF_ORDER");
        migrateSent = true;
        const migrated = fresh(await ports.database.migrateSaas(x));
        checkFence(x);
        const matches = (r: Pick<TenantDatabaseMutationReceipt, "fence" | "externalFence" | "evidenceHash">) =>
          canonicalJson(r.fence) === canonicalJson(x.fence) && epoch(r.externalFence) === epoch(x.externalFence) && digest.test(r.evidenceHash);
        if (!matches(migrated) || migrated.operation !== "migrate_saas" || migrated.resultingState !== "saas_migrated") {
          reject("FIRST_ONBOARDING_MIGRATION_ACK_CHANGED");
        }
        // The V3 bootstrap role is deliberately NOLOGIN. Only this fenced new
        // pair may be activated after the approved schema is present.
        const grant = await ports.database.activateApplication({ fence: x.fence, externalFence: x.externalFence, signal: x.signal,
          target, applicationRoleArn, migrationEvidenceSha256: migrated.evidenceHash });
        checkFence(x);
        if (!matches(grant) || grant.outcome !== "applied" || grant.databaseName !== names.databaseName || grant.roleName !== names.roleName ||
          grant.applicationRoleArn !== applicationRoleArn || grant.otherConnectableDatabases !== 0) reject("FIRST_ONBOARDING_APPLICATION_GRANT_CHANGED");
        activated = true;
        return migrated;
      },
      verify: async x => {
        checkFence(x);
        if (!activated || initialized) reject("FIRST_ONBOARDING_VERIFY_OUT_OF_ORDER");
        const verified = await ports.database.verify(x), id = verified.identity;
        window(x.signal);
        assertTenantApplicationAccessProof(verified.receipt.applicationAccess);
        if (id.name !== names.databaseName || id.roleName !== names.roleName || id.ownershipMarker !== x.fence.ownershipMarker ||
          id.baselineDigest !== baseline.archiveSha256 || id.schemaVersion !== input.schemaVersion || id.clusterResourceId !== target.clusterResourceId ||
          id.otherConnectableDatabases !== 0 || ![id.databaseOid, id.roleOid].every(v => /^[1-9][0-9]{0,9}$/.test(v) && Number(v) < 2**32)) {
          reject("FIRST_ONBOARDING_EXPRESS_DATABASE_PROOF_CHANGED");
        }
        initialized = structuredClone(id);
        // The generic DB lifecycle checkpoint receives only its existing projection.
        const { applicationAccess: _checked, ...receipt } = verified.receipt;
        void _checked;
        return receipt;
      },
      destroy: disabled,
    },
    secrets: {
      inspectRuntimeSecret: async x => {
        checkFence(x);
        const r = await ports.secret.inspectRuntimeSecret(x);
        if (r.state === "present" && (!created || created.epoch !== epoch(x.externalFence) ||
          r.secretRef !== created.arn || r.versionRef !== created.versionId)) reject("FIRST_ONBOARDING_SECRET_UNEXPECTED_EXISTING");
        return r;
      },
      ensureRuntimeSecret: async x => {
        checkFence(x);
        if (createSent) reject("FIRST_ONBOARDING_SECRET_ALREADY_SUBMITTED");
        const name = deriveTenantRuntimeSecretName(x.fence);
        const requestSha256 = await firstOnboardingInitialSecretVersion({ approvalSha256: input.approvalSha256,
          name, jobId: review.jobId, epoch: x.externalFence, baselineDigest: baseline.archiveSha256 });
        window(x.signal);
        createSent = true;
        const ack = await ports.secret.createInitial({ ...x, name, requestSha256, initialVersionId: requestSha256 });
        const m = ack.metadata, prefix = secretPrefix + name + "-";
        window(x.signal);
        if (ack.requestSha256 !== requestSha256 || m.state !== "present" || m.versionRef !== requestSha256 ||
          !m.secretRef?.startsWith(prefix) || !/^[A-Za-z0-9]{6}$/.test(m.secretRef.slice(prefix.length)) ||
          m.ownershipMarker !== x.fence.ownershipMarker || canonicalJson(m.fence) !== canonicalJson(x.fence) ||
          epoch(m.externalFence) !== epoch(x.externalFence)) reject("FIRST_ONBOARDING_SECRET_ACK_CHANGED");
        await input.verifyInitialSecret({ arn: m.secretRef, versionId: requestSha256, externalFence: x.externalFence }, x.signal);
        window(x.signal);
        created = { arn: m.secretRef, versionId: requestSha256, epoch: epoch(x.externalFence) };
        return { fence: x.fence, externalFence: x.externalFence, outcome: "created", secretRef: created.arn,
          versionRef: created.versionId, ownershipMarker: x.fence.ownershipMarker };
      },
      destroyRuntimeSecret: disabled,
    },
  });
  const material = () => {
    window();
    if (!created || !initialized) return reject("FIRST_ONBOARDING_EXPRESS_MATERIAL_MISSING");
    return { identity: structuredClone(initialized), sampling: { ...structuredClone(sampling),
      secrets: [structuredClone(control), { arn: created.arn, versionId: created.versionId }] } };
  };
  return {
    database, material, applicationRoleArn, controlRef,
    async assertContext(context: DeploymentExecutionContext) {
      window();
      if (!context.binding || ![control.arn, controlRef].includes(context.binding.tenantStackParameters.ControlPublicKeyValueFrom) ||
        await sha256Hex(context.binding.tenantStackParameters) !== a.environmentParametersSha256) {
        reject("FIRST_ONBOARDING_EXPRESS_PARAMETERS_CHANGED");
      }
    },
    async render(stackInput: AwsSandboxTenantStackInput, context: DeploymentExecutionContext) {
      await this.assertContext(context);
      const evidence = material();
      if (stackInput.runtimeSecretRef !== created?.arn || !context.tenantExternalOperation ||
        epoch(context.tenantExternalOperation) !== created.epoch ||
        context.tenantResources?.identity.stableIdentityHash !== names.stableIdentity) reject("FIRST_ONBOARDING_EXPRESS_RENDER_FENCE_CHANGED");
      const rendered = await renderFirstOpenExpressTemplate(stackInput, a, evidence, context.deployment.configurationHash);
      await ports.onVerifiedControlMaterial?.({ identity: evidence.identity, runtimeSecret: evidence.sampling.secrets[1],
        context, fence: context.tenantExternalOperation });
      window();
      return rendered;
    },
  };
}

export type FirstOnboardingExpressComposition = Awaited<ReturnType<typeof composeFirstOnboardingExpress>>;
