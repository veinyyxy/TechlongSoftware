import { createHash, randomBytes } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { firstOpenBuyerSignerSecretName, isFirstOpenBuyerSignerPin, isFirstOpenBuyerSigningKey,
  type FirstOpenBuyerSignerPin } from "../../lib/buyer-forward/signer-binding.ts";
import { FIRST_OPEN_BASELINE_BINDING as baseline } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { generateRuntimeSecretMaterialC4d } from "../../lib/deployments/execution/express-runtime-secret-c4d.ts";
import { assertInitialSecretVersion, firstOnboardingInitialSecretVersion, type FirstOnboardingExpressPorts } from "../../lib/deployments/execution/first-onboarding-express.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { sameFirstOpenFence, stopFirstOpen, type FirstOpenFenceInput } from "./first-open-express-scope.ts";

export type FirstOpenCredentials = NonNullable<ConstructorParameters<typeof STSClient>[0]>["credentials"];
export const sdkConfig = (credentials: FirstOpenCredentials) => {
  if (!credentials) return stopFirstOpen("EXPLICIT_CREDENTIALS_REQUIRED");
  return { region: s.region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
};

export async function assertFirstOpenAwsRole(sts: Pick<STSClient, "send">, roleArn: string, signal: AbortSignal) {
  const { Account, Arn } = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal })
    .catch(() => stopFirstOpen("AWS_IDENTITY_UNPROVED"));
  signal.throwIfAborted();
  const prefix = `arn:aws:sts::${s.account}:assumed-role/${roleArn.split("/").at(-1)}/`;
  if (Account !== s.account || !Arn?.startsWith(prefix) || !/^[A-Za-z0-9+=,.@_-]{2,64}$/.test(Arn.slice(prefix.length))) {
    stopFirstOpen("AWS_ROLE_CHANGED");
  }
  return { accountId: Account, arn: Arn };
}

export function firstOpenBaselineSource(s3: Pick<S3Client, "send">) {
  let used = false;
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (used) stopFirstOpen("BASELINE_READ_ALREADY_USED");
    used = true;
    async function read(pin: (typeof baseline.objects)[keyof typeof baseline.objects]) {
      signal.throwIfAborted();
      const result = await s3.send(new GetObjectCommand({ Bucket: baseline.bucket, Key: pin.key, VersionId: pin.versionId,
        ExpectedBucketOwner: s.account }), { abortSignal: signal });
      const body = result.Body;
      if (!body || !(Symbol.asyncIterator in body)) return stopFirstOpen("BASELINE_STREAM_REQUIRED");
      const chunks: Buffer[] = [];
      let length = 0;
      try {
        if (result.VersionId !== pin.versionId || result.ContentLength !== pin.bytes || result.DeleteMarker) stopFirstOpen("BASELINE_METADATA_CHANGED");
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          signal.throwIfAborted();
          if (!(chunk instanceof Uint8Array) || (length += chunk.length) > pin.bytes) stopFirstOpen("BASELINE_SIZE_CHANGED");
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        if ("destroy" in body && typeof body.destroy === "function") body.destroy();
      }
      const bytes = Buffer.concat(chunks, length);
      signal.throwIfAborted();
      if (length !== pin.bytes || createHash("sha256").update(bytes).digest("hex") !== pin.sha256) stopFirstOpen("BASELINE_SHA_CHANGED");
      return bytes;
    }
    try {
      return { archiveBytes: await read(baseline.objects.archive), manifestBytes: await read(baseline.objects.manifest) };
    } catch {
      return stopFirstOpen("FIXED_BASELINE_READ_FAILED");
    }
  };
}

/** One preclaim read of the separately installed raw signer, never g1 or
 * AWSCURRENT. The protected host supplies the pinned Provisioner session. */
export function firstOpenBuyerSigningMaterial(client: Pick<SecretsManagerClient, "send">, approved: FirstOpenBuyerSignerPin | undefined) {
  if (!isFirstOpenBuyerSignerPin(approved)) return stopFirstOpen("BUYER_SIGNER_PIN_REQUIRED");
  const pin = structuredClone(approved);
  let consumed = false;
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (consumed) return stopFirstOpen("BUYER_SIGNER_READ_ALREADY_USED");
    consumed = true;
    try {
      const result = await client.send(new GetSecretValueCommand({ SecretId: pin.arn, VersionId: pin.versionId }), { abortSignal: signal });
      signal.throwIfAborted();
      if (result.ARN !== pin.arn || result.Name !== firstOpenBuyerSignerSecretName || result.VersionId !== pin.versionId ||
        result.SecretBinary !== undefined || !isFirstOpenBuyerSigningKey(result.SecretString)) return stopFirstOpen("BUYER_SIGNER_METADATA_CHANGED");
      return result.SecretString;
    } catch { return stopFirstOpen("BUYER_SIGNER_READ_UNPROVED"); }
  };
}

export function firstOpenInitialSecret(input: {
  approvedSha256: string; client: Pick<SecretsManagerClient, "send">; sts: Pick<STSClient, "send">;
  loadTenantPaymentMaterial: FirstOpenPaymentSource;
  rememberOwnerSeed?(input: { arn: string; versionId: string; externalFence: FirstOpenFenceInput["externalFence"]; key: string }): void;
}): FirstOnboardingExpressPorts["secret"] {
  let vacant = false, started = false, arn: string | undefined, token: string | undefined, epoch: string | undefined;
  const name = s.secretName, prefix = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${name}-`;
  const goodArn = (value: string | undefined): value is string =>
    Boolean(value?.startsWith(prefix) && /^[A-Za-z0-9]{6}$/.test(value.slice(prefix.length)));
  const check = (x: FirstOpenFenceInput) => {
    sameFirstOpenFence(x);
    if (epoch && epoch !== x.externalFence.operationHash) stopFirstOpen("SECRET_EPOCH_CHANGED");
  };
  const tags = (x: FirstOpenFenceInput) => ({
    ManagedBy: "techlong-sandbox", SecretSchema: "techlong-runtime-four-key-v2", DatabaseProfile: "express_iam",
    ResourceGeneration: "1", StableIdentity: s.stableIdentity, AppInstanceId: s.instanceId, DeploymentId: s.deploymentId,
    OwnershipMarker: x.fence.ownershipMarker,
  });
  const present = (x: FirstOpenFenceInput, secretRef: string, versionRef: string) => ({
    fence: x.fence, externalFence: x.externalFence, state: "present" as const, secretRef, versionRef, ownershipMarker: x.fence.ownershipMarker,
  });
  return {
    async inspectRuntimeSecret(x) {
      check(x);
      try {
        const found = await input.client.send(new DescribeSecretCommand({ SecretId: arn ?? name }), { abortSignal: x.signal });
        check(x);
        if (!arn || !token || found.Name !== name || found.ReplicationStatus?.length || (found.PrimaryRegion && found.PrimaryRegion !== s.region) ||
          (found.KmsKeyId && found.KmsKeyId !== "alias/aws/secretsmanager")) {
          return stopFirstOpen("SECRET_UNEXPECTED_EXISTING");
        }
        const expected = tags(x);
        if (found.Tags?.length !== Object.keys(expected).length || Object.entries(expected).some(([Key, Value]) =>
          found.Tags?.filter(t => t.Key === Key && t.Value === Value).length !== 1)) return stopFirstOpen("SECRET_TAGS_CHANGED");
        assertInitialSecretVersion(found, arn, token);
        if (found.VersionIdsToStages?.[token]?.length !== 1) return stopFirstOpen("SECRET_STAGES_CHANGED");
        return present(x, arn, token);
      } catch (error) {
        check(x);
        if (!started && !vacant && error instanceof Error && error.name === "ResourceNotFoundException") {
          vacant = true;
          epoch = x.externalFence.operationHash;
          return { fence: x.fence, externalFence: x.externalFence, state: "missing", secretRef: null, versionRef: null, ownershipMarker: null };
        }
        return stopFirstOpen("SECRET_METADATA_UNPROVED");
      }
    },
    async createInitial(x) {
      check(x);
      const expected = await firstOnboardingInitialSecretVersion({ approvalSha256: input.approvedSha256, name, jobId: s.jobId,
        epoch: x.externalFence, baselineDigest: baseline.objects.archive.sha256 });
      check(x);
      if (!vacant || started || x.name !== name || x.initialVersionId !== expected || x.requestSha256 !== expected) {
        return stopFirstOpen("SECRET_CREATE_SCOPE_CHANGED");
      }
      started = true;
      try {
        await assertFirstOpenAwsRole(input.sts, s.workerRole, x.signal);
        const supplied = await input.loadTenantPaymentMaterial({ jobId: s.jobId, instanceId: s.instanceId,
          approvalSha256: input.approvedSha256, signal: x.signal });
        if (supplied.jobId !== s.jobId || supplied.instanceId !== s.instanceId || supplied.approvalSha256 !== input.approvedSha256 ||
          !isFirstOpenBuyerSigningKey(supplied.buyerSigningKey)) {
          return stopFirstOpen("SECRET_PAYMENT_SCOPE_CHANGED");
        }
        const material = { ...generateRuntimeSecretMaterialC4d(supplied.payment), hmac_secret_key: supplied.buyerSigningKey };
        check(x);
        const ack = await input.client.send(new CreateSecretCommand({ Name: name, ClientRequestToken: expected,
          SecretString: JSON.stringify(material), Tags: Object.entries(tags(x)).map(([Key, Value]) => ({ Key, Value })) }), { abortSignal: x.signal });
        check(x);
        if (!goodArn(ack.ARN) || ack.Name !== name || ack.VersionId !== expected) return stopFirstOpen("SECRET_ACK_CHANGED");
        // The web forwarder can sign requests, but its key must never let it
        // derive the first merchant owner's password. Do not persist this seed.
        if (input.rememberOwnerSeed) {
          const ownerSeed = randomBytes(32);
          try {
            input.rememberOwnerSeed({ arn: ack.ARN, versionId: expected, externalFence: x.externalFence, key: ownerSeed.toString("base64url") });
          } finally { ownerSeed.fill(0); }
        }
        arn = ack.ARN; token = expected;
        return { requestSha256: expected, metadata: present(x, arn, token) };
      } catch {
        return stopFirstOpen("SECRET_CREATE_UNVERIFIED_NO_RETRY");
      }
    },
  };
}

type PaymentScope = { jobId: string; instanceId: string; approvalSha256: string };
export type FirstOpenPaymentSource = (input: PaymentScope & { signal: AbortSignal }) => Promise<PaymentScope & {
  payment: unknown; buyerSigningKey: string;
}>;
