import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudFormationClient, CreateStackCommand, DescribeStacksCommand, type CreateStackCommandOutput,
  type DescribeStacksCommandOutput } from "@aws-sdk/client-cloudformation";
import { GetObjectCommand, S3Client, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient, type GetSecretValueCommandOutput } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient, type GetCallerIdentityCommandOutput } from "@aws-sdk/client-sts";
import { awsSandboxTenantStackName } from "../../lib/deployments/cloudformation/tenant-stack.ts";
import { AwsSdkDeploymentAdapter } from "../../lib/deployments/execution/aws-sdk-adapter.ts";
import type { TenantDatabasePort, TenantExternalOperationFence } from "../../lib/deployments/execution/contracts.ts";
import { FIRST_OPEN_BASELINE_BUCKET, FIRST_OPEN_BASELINE_OBJECTS, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { assertFinalizedSupervisedTenantStack, type SupervisedWorkloadAwsPort } from "../../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { deriveTenantRuntimeSecretName } from "../../lib/deployments/execution/tenant-database.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE as roleArn,
  type attestFirstOpenTask } from "./first-open-task-identity.ts";
import { createTenantPostgresAdapter } from "./first-open-tenant-postgres.mjs";
import { checkRdsCaBundle } from "./rds-ca.mjs";

type Identity = Pick<Awaited<ReturnType<typeof attestFirstOpenTask>>, "roleArn" | "credentials">;
type Target = {
  kind: "rds"; engine: "postgres"; host: string; port: 5432; dbInstanceIdentifier: string;
  database: string; username: string; owner: string; databaseOid: string; ownershipMarker: string; isolatedEmpty: true;
};
type ManagementScope = {
  fence: TenantExternalOperationFence;
  target: Target;
  managementSecret: { arn: string; versionId: string };
  applicationSecretRef: string;
  baselineVersions: Record<keyof typeof FIRST_OPEN_BASELINE_OBJECTS, string>;
  stack: { templateSha256: string; parametersSha256: string };
  writeBefore: number;
};
type Clients = {
  describe: (command: DescribeStacksCommand, signal: AbortSignal) => Promise<DescribeStacksCommandOutput>;
  create: (command: CreateStackCommand, signal: AbortSignal) => Promise<CreateStackCommandOutput>;
  identity: (command: GetCallerIdentityCommand, signal: AbortSignal) => Promise<GetCallerIdentityCommandOutput>;
  baseline: (command: GetObjectCommand, signal: AbortSignal) => Promise<GetObjectCommandOutput>;
  secret: (command: GetSecretValueCommand, signal: AbortSignal) => Promise<GetSecretValueCommandOutput>;
};
const caPath = "/app/certs/amazon-rds.pem";
const versionPattern = /^[A-Za-z0-9-]{32,64}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const roleSession = /^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxFirstOpenTaskRole\/[A-Za-z0-9+=,.@_-]{2,64}$/;
const originalBindingRole = `arn:aws:iam::${account}:role/TechlongSandboxProvisionerRole`;
const stackExecutionRole = `arn:aws:iam::${account}:role/TechlongSandboxCloudFormationExecutionRole`;
const never = () => { throw Error("ECS_FIRST_OPEN_MANAGEMENT_OPERATION_DISABLED"); };
class DisabledStackCommand { constructor() { never(); } }

function productionClients(identity: Identity): Clients {
  const options = { region, credentials: identity.credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const cfn = new CloudFormationClient(options), sts = new STSClient(options);
  const s3 = new S3Client({ ...options, followRegionRedirects: false }), secrets = new SecretsManagerClient(options);
  return {
    describe: (command, abortSignal) => cfn.send(command, { abortSignal }),
    create: (command, abortSignal) => cfn.send(command, { abortSignal }),
    identity: (command, abortSignal) => sts.send(command, { abortSignal }),
    baseline: (command, abortSignal) => s3.send(command, { abortSignal }),
    secret: (command, abortSignal) => secrets.send(command, { abortSignal }),
  };
}

/** Candidate-only provider ports. The caller must provide the separately reviewed
 * exact G1 scope, activate the real external fence and verify the application-secret binding. */
export function createFirstOpenRdsManagement({ identity, scope: supplied, assertActive, now = Date.now, clients,
  openTarget = createTenantPostgresAdapter, readCa = async () => {
    await checkRdsCaBundle(caPath);
    return readFile(caPath, "utf8");
  },
}: { identity: Identity; scope: ManagementScope;
  assertActive(fence: TenantExternalOperationFence, signal: AbortSignal): Promise<void>;
  now?: () => number; clients?: Clients; openTarget?: typeof createTenantPostgresAdapter; readCa?: () => Promise<string>;
}): { tenantDatabase: TenantDatabasePort; aws: SupervisedWorkloadAwsPort } {
  const { fence, target, managementSecret, applicationSecretRef, baselineVersions, stack, writeBefore } = structuredClone(supplied);
  const { identity: tenant, ownershipMarker, generation, ownerDeploymentId } = fence.resourceFence;
  const secretPrefix = `arn:aws:secretsmanager:${region}:${account}:secret:`;
  const applicationSecretName = secretPrefix + deriveTenantRuntimeSecretName(fence.resourceFence) + "-";
  if (identity.roleArn !== roleArn || typeof identity.credentials !== "function" || !Number.isSafeInteger(writeBefore) ||
    writeBefore <= now() || writeBefore > now() + 3_600_000 || fence.state !== "active" || fence.intent !== "provision" ||
    fence.epoch !== 1 || generation !== 1 || fence.ownerDeploymentId !== ownerDeploymentId || tenant.cellKey !== "cell-sandbox-1" ||
    !hashPattern.test(tenant.stableIdentityHash) || !hashPattern.test(fence.operationHash) ||
    fence.marker !== `tl_epoch_${tenant.stableIdentityHash.slice(0, 24)}_g1_e1` || target.kind !== "rds" || target.engine !== "postgres" ||
    target.isolatedEmpty !== true || target.host.split(".")[2] !== region || target.database !== tenant.databaseName ||
    target.username !== target.owner || target.ownershipMarker !== ownershipMarker ||
    !managementSecret.arn.startsWith(secretPrefix) || !/^[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(managementSecret.arn.slice(secretPrefix.length)) ||
    !versionPattern.test(managementSecret.versionId) || managementSecret.arn === applicationSecretRef ||
    !applicationSecretRef.startsWith(applicationSecretName) || !/^[A-Za-z0-9]{6}$/.test(applicationSecretRef.slice(applicationSecretName.length)) ||
    !validFirstOpenVersionId(baselineVersions.archive) || !validFirstOpenVersionId(baselineVersions.manifest) ||
    !hashPattern.test(stack.templateSha256) || !hashPattern.test(stack.parametersSha256)) throw Error("ECS_FIRST_OPEN_MANAGEMENT_SCOPE");

  const sdk = clients ?? productionClients(identity);
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (now() >= writeBefore) throw Error("ECS_FIRST_OPEN_MANAGEMENT_WINDOW");
  };
  const stackName = awsSandboxTenantStackName(tenant.appInstanceId);
  const adapter = new AwsSdkDeploymentAdapter(region, {
    stsClient: { async send(command, options) { return { ...await sdk.identity(command as GetCallerIdentityCommand, options!.abortSignal!) }; } },
    cloudFormationClient: { async send(command, options) {
      if (command instanceof DescribeStacksCommand) return { ...await sdk.describe(command, options!.abortSignal!) };
      return never();
    } },
    commands: { getCallerIdentity: GetCallerIdentityCommand, describeStacks: DescribeStacksCommand,
      createStack: DisabledStackCommand, updateStack: DisabledStackCommand, deleteStack: DisabledStackCommand },
  });
  const assertCaller = async (signal: AbortSignal) => {
    check(signal);
    const caller = await adapter.getCallerIdentity({ signal });
    check(signal);
    if (caller.accountId !== account || !roleSession.test(caller.arn)) throw Error("ECS_FIRST_OPEN_MANAGEMENT_CALLER");
    return caller;
  };
  const requireFence = async (input: Parameters<TenantDatabasePort["ensureTenantDatabase"]>[0]) => {
    check(input.signal);
    if (input.context.deployment.id !== ownerDeploymentId || input.context.appInstance.id !== tenant.appInstanceId ||
      input.context.appInstance.workspaceId !== tenant.workspaceId || input.context.environment.id !== tenant.environmentId ||
      input.context.environment.expectedAccountId !== account || input.context.environment.region !== region ||
      input.context.binding?.workerRoleArn !== originalBindingRole || canonicalJson(input.externalFence) !== canonicalJson(fence) ||
      canonicalJson(input.context.tenantExternalOperation) !== canonicalJson(fence)) throw Error("ECS_FIRST_OPEN_MANAGEMENT_FENCE");
    await assertActive(fence, input.signal);
    check(input.signal);
  };
  const readBaseline = async (kind: keyof typeof FIRST_OPEN_BASELINE_OBJECTS, signal: AbortSignal) => {
    check(signal);
    const { key, bytes, sha256 } = FIRST_OPEN_BASELINE_OBJECTS[kind];
    const version = baselineVersions[kind];
    const received = await sdk.baseline(new GetObjectCommand({ Bucket: FIRST_OPEN_BASELINE_BUCKET, Key: key,
      ExpectedBucketOwner: account, VersionId: version }), signal);
    const body = received.Body;
    if (!body || !(Symbol.asyncIterator in body)) throw Error("ECS_FIRST_OPEN_BASELINE_STREAM");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      if (received.VersionId !== version || received.ContentLength !== bytes || received.DeleteMarker) throw Error("ECS_FIRST_OPEN_BASELINE_VERSION");
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        check(signal);
        if (!(chunk instanceof Uint8Array) || (size += chunk.byteLength) > bytes) throw Error("ECS_FIRST_OPEN_BASELINE_SIZE");
        chunks.push(chunk);
      }
    } finally {
      if ("destroy" in body && typeof body.destroy === "function") body.destroy();
    }
    const buffer = Buffer.concat(chunks, size);
    if (size !== bytes || createHash("sha256").update(buffer).digest("hex") !== sha256) throw Error("ECS_FIRST_OPEN_BASELINE_BYTES");
    return buffer;
  };
  const receipt = async (state: "empty" | "verified", observation: unknown) => ({
    lifecycleState: state, databaseName: tenant.databaseName, roleName: tenant.roleName, ownershipMarker,
    resourceGeneration: generation, resourceOwnerDeploymentId: ownerDeploymentId, externalEpoch: fence.epoch,
    externalMarker: fence.marker, externalOperationHash: fence.operationHash, secretRef: applicationSecretRef,
    baselineDigest: state === "verified" ? FIRST_OPEN_BASELINE_OBJECTS.archive.sha256 : null,
    migrationContract: state === "verified" ? "speedfeast-saas-control-v1" : null,
    evidenceHash: await sha256Hex({ fence, state, observation }),
  });
  const initialization = { backendDirectory: "/app/first-open-backend", pgRestorePath: "/usr/bin/pg_restore" };
  let postgres: ReturnType<typeof createTenantPostgresAdapter> | undefined;
  let prepareAttempted = false, empty = false, migrationAttempted = false;
  const tenantDatabase: TenantDatabasePort = {
    async ensureTenantDatabase(input) {
      await requireFence(input);
      if (prepareAttempted) throw Error("ECS_FIRST_OPEN_DATABASE_ALREADY_ATTESTED");
      prepareAttempted = true;
      await assertCaller(input.signal);
      const secret = await sdk.secret(new GetSecretValueCommand({ SecretId: managementSecret.arn, VersionId: managementSecret.versionId }),
        input.signal);
      check(input.signal);
      let databaseUrl;
      try {
        if (secret.ARN !== managementSecret.arn || secret.VersionId !== managementSecret.versionId ||
          typeof secret.SecretString !== "string" || secret.SecretBinary !== undefined) throw Error();
        databaseUrl = JSON.parse(secret.SecretString).database_url;
        if (typeof databaseUrl !== "string") throw Error();
      } catch { throw Error("ECS_FIRST_OPEN_MANAGEMENT_SECRET"); }
      const ca = await readCa();
      check(input.signal);
      postgres = openTarget({ target, databaseUrl, ca, localPassword: undefined, localSsl: undefined });
      const observation = await postgres.inspectEmpty({ ...initialization, signal: input.signal });
      if (observation.eligibleEmpty !== true) throw Object.assign(Error("TENANT_POSTGRES_NOT_EMPTY"), { retryable: false });
      empty = true;
      return receipt("empty", observation);
    },
    async migrateTenantDatabase(input) {
      await requireFence(input);
      if (!empty || !postgres || migrationAttempted) throw Error("ECS_FIRST_OPEN_DATABASE_INITIALIZATION_STATE");
      migrationAttempted = true;
      const archiveBytes = await readBaseline("archive", input.signal);
      const manifestBytes = await readBaseline("manifest", input.signal);
      await requireFence(input);
      const scratch = await mkdtemp(join(tmpdir(), "techlong-first-open-"));
      try {
        const observation = await postgres.initialize({ ...initialization, archiveBytes, manifestBytes,
          archiveSha256: FIRST_OPEN_BASELINE_OBJECTS.archive.sha256, manifestSha256: FIRST_OPEN_BASELINE_OBJECTS.manifest.sha256,
          workspace: join(scratch, "baseline"), signal: input.signal });
        return receipt("verified", observation);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  };

  let createAttempted = false;
  let acknowledgedStackId: string | undefined;
  const aws: SupervisedWorkloadAwsPort = {
    region, getCallerIdentity: ({ signal }) => assertCaller(signal), applyTenantStack: never, deleteTenantStack: never,
    async describeTenantStack(name, { signal }) {
      check(signal);
      if (name !== stackName && name !== acknowledgedStackId) throw Error("ECS_FIRST_OPEN_STACK_SCOPE");
      const observed = await adapter.describeTenantStack(name, { signal });
      check(signal);
      if (name === acknowledgedStackId && observed.state !== "missing" && observed.stackId !== acknowledgedStackId) {
        throw Error("ECS_FIRST_OPEN_STACK_READBACK_SCOPE");
      }
      return observed;
    },
    applySupervisedTenantStack: async (candidate, input) => {
      assertFinalizedSupervisedTenantStack(candidate);
      const tags = candidate.tags;
      if (input.createOnly !== true || createAttempted || candidate.stackName !== stackName ||
        candidate.cloudFormationRoleArn !== stackExecutionRole || Buffer.byteLength(candidate.templateBody) > 51_200 ||
        tags.AppInstanceId !== tenant.appInstanceId || tags.DeploymentId !== ownerDeploymentId ||
        tags.CellId !== tenant.cellKey || tags.ResourceGeneration !== String(generation) ||
        tags.ExternalOperationEpoch !== String(fence.epoch) || tags.ExternalOperationIntent !== fence.intent ||
        tags.ExternalOperationMarker !== fence.marker || tags.ExternalOperationHash !== fence.operationHash ||
        createHash("sha256").update(candidate.templateBody).digest("hex") !== stack.templateSha256 ||
        await sha256Hex(candidate.parameters) !== stack.parametersSha256) throw Error("ECS_FIRST_OPEN_STACK_SCOPE");
      // Consume the local attempt before the first further await. The durable
      // Worker claim is responsible for excluding any second process.
      if (createAttempted) throw Error("ECS_FIRST_OPEN_STACK_SCOPE");
      createAttempted = true;
      await assertCaller(input.signal);
      if ((await aws.describeTenantStack(stackName, input)).state !== "missing") throw Error("ECS_FIRST_OPEN_STACK_ALREADY_EXISTS");
      await assertActive(fence, input.signal);
      check(input.signal);
      const response = await sdk.create(new CreateStackCommand({ StackName: stackName, RoleARN: stackExecutionRole,
        TemplateBody: candidate.templateBody, ClientRequestToken: candidate.clientRequestToken, OnFailure: candidate.onFailure,
        EnableTerminationProtection: false,
        Parameters: Object.entries(candidate.parameters).sort().map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
        Tags: Object.entries(candidate.tags).sort().map(([Key, Value]) => ({ Key, Value })),
      }), input.signal);
      check(input.signal);
      const prefix = `arn:aws:cloudformation:${region}:${account}:stack/${stackName}/`;
      const id = response.StackId;
      if (typeof id !== "string" || !id.startsWith(prefix) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id.slice(prefix.length))) {
        throw Error("ECS_FIRST_OPEN_STACK_RESULT_UNCONFIRMED");
      }
      acknowledgedStackId = id;
      return { operation: "create", stackId: id };
    },
  };
  return { tenantDatabase, aws };
}
