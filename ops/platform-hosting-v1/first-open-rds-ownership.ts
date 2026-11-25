import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { awsSandboxTenantStackName } from "../../lib/deployments/cloudformation/tenant-stack.ts";
import { AwsSdkDynamoDbEpochAuthority, type AwsSdkDynamoDbEpochAuthorityDependencies } from "../../lib/deployments/execution/aws-sdk-dynamodb-epoch-authority.ts";
import { AuthorityBackedTenantExternalOwnershipProvider, type AtomicTenantExternalEpochAuthorityPort,
  type TenantExternalEpochAuthoritySnapshot } from "../../lib/deployments/execution/cloudformation-external-ownership.ts";
import type { AwsDeploymentPort, DeploymentExecutionContext, DeploymentExecutionRepository, DeploymentJobLeaseFence,
  TenantExternalOperationFence } from "../../lib/deployments/execution/contracts.ts";
import { isFirstOpenExecutionId, type EcsFirstOpenApproval } from "../../lib/deployments/execution/ecs-first-open.ts";
import { RepositoryTenantExternalOwnershipCoordinator, tenantExternalOperationHash } from "../../lib/deployments/execution/external-ownership-coordinator.ts";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";
import { NeonDeploymentExecutionRepository } from "../../lib/deployments/execution/neon-repository.ts";
import { COST_CONTROL_SCOPE_V1 } from "../../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import type { SingleDeploymentClaimScope } from "../../lib/deployments/execution/single-deployment-scope.ts";
import { assertTenantResourceFence } from "../../lib/deployments/execution/tenant-database.ts";
import type { TenantExternalOwnershipCoordinatorPort } from "../../lib/deployments/execution/worker.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE as roleArn,
  type attestFirstOpenTask } from "./first-open-task-identity.ts";

export const FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN = COST_CONTROL_SCOPE_V1.tableArn;
type Approval = Pick<EcsFirstOpenApproval, "executionId" | "jobId" | "instanceId" | "workspaceId">;
type Identity = Pick<Awaited<ReturnType<typeof attestFirstOpenTask>>, "roleArn" | "credentials">;
type RepositorySql = Exclude<ConstructorParameters<typeof NeonDeploymentExecutionRepository>[0], string>;
type AuthorityRepository = Pick<DeploymentExecutionRepository, "prepareTenantExternalOperation" | "assertTenantExternalOperation" |
  "activateTenantExternalOperation">;
type Binding = {
  scope: SingleDeploymentClaimScope; approval: Approval; fence: TenantExternalOperationFence;
  writeBefore: number; now?: () => number;
};

const environmentId = "env_aws_sandbox_ca_central_1";
const cellKey = "cell-sandbox-1";
const digest = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const allowedTransitions = new Set(["queued", "preflight", "database_preparing", "migrating", "infrastructure_provisioning",
  "waiting_healthy", "configuring", "verifying"]);

function requireScope(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}

function forbidden(): never { throw Error("ECS_FIRST_OPEN_REPOSITORY_OPERATION_DISABLED"); }

function bindScope({ scope: supplied, approval: accepted, fence: expected, writeBefore, now = Date.now }: Binding) {
  const { deploymentId, appInstanceId, planHash, configurationHash, artifactRef } = supplied;
  const { executionId, jobId, instanceId, workspaceId } = accepted;
  const fence = structuredClone(expected), { resourceFence, ownerDeploymentId, marker, operationHash } = fence;
  const { identity } = resourceFence;
  assertTenantResourceFence(resourceFence);
  requireScope(isFirstOpenExecutionId(executionId) && /^job_[a-f0-9]{24}$/.test(jobId) && id.test(workspaceId) &&
    id.test(deploymentId) && id.test(appInstanceId) && instanceId === appInstanceId && supplied.environmentId === environmentId &&
    digest.test(planHash) && digest.test(configurationHash) &&
    /^402010193138\.dkr\.ecr\.ca-central-1\.amazonaws\.com\/techlong-sandbox-speedfeast@sha256:[a-f0-9]{64}$/.test(artifactRef) &&
    fence.schemaVersion === 1 && fence.state === "active" && fence.intent === "provision" && fence.epoch === 1 &&
    fence.provisionPredecessor === undefined && resourceFence.generation === 1 &&
    ownerDeploymentId === deploymentId && resourceFence.ownerDeploymentId === deploymentId &&
    identity.appInstanceId === appInstanceId && identity.workspaceId === workspaceId && identity.environmentId === environmentId &&
    identity.cellKey === cellKey && digest.test(operationHash) && marker === `tl_epoch_${identity.stableIdentityHash.slice(0, 24)}_g1_e1` &&
    Number.isSafeInteger(writeBefore) && writeBefore > now() && writeBefore <= now() + 3_600_000, "ECS_FIRST_OPEN_OWNERSHIP_SCOPE");
  function checkWindow(signal?: AbortSignal) {
    signal?.throwIfAborted();
    requireScope(now() < writeBefore, "ECS_FIRST_OPEN_OWNERSHIP_WINDOW");
  }
  function checkLease(lease: DeploymentJobLeaseFence) {
    checkWindow();
    requireScope(lease.jobId === jobId && lease.deploymentId === deploymentId && lease.workerId === executionId && lease.attempt === 1 &&
      /^lease_[a-f0-9]{32}$/.test(lease.leaseToken), "ECS_FIRST_OPEN_OWNERSHIP_LEASE");
  }
  function checkContext(context: DeploymentExecutionContext) {
    requireScope(context.job.id === jobId && context.job.attempt === 1 && context.job.deploymentId === deploymentId &&
      context.deployment.id === deploymentId && context.deployment.appInstanceId === appInstanceId &&
      context.deployment.environmentId === environmentId && context.deployment.planHash === planHash &&
      context.deployment.configurationHash === configurationHash && context.deployment.artifactRef === artifactRef &&
      context.environment.id === environmentId && context.environment.region === region && context.environment.expectedAccountId === account &&
      context.environment.cellKey === cellKey && context.appInstance.id === appInstanceId && context.appInstance.workspaceId === workspaceId &&
      context.appInstance.productId === identity.productId && context.workspace.id === workspaceId, "ECS_FIRST_OPEN_OWNERSHIP_CONTEXT");
  }
  return { deploymentId, appInstanceId, executionId, planHash, fence, now, writeBefore, checkWindow, checkLease, checkContext };
}

/** The first-open worker sees only its own leased application deployment and
 * the existing repository operations required by Management. */
export function createFirstOpenRdsRepository(sql: RepositorySql, input: Binding): DeploymentExecutionRepository {
  const scope = bindScope(input), repo = new NeonDeploymentExecutionRepository(sql);
  const { fence, writeBefore, checkLease, checkContext, checkWindow } = scope;
  const pending = { ...fence, state: "pending_external" };
  let leaseToken: string | undefined;
  const guardLease = (lease: DeploymentJobLeaseFence) => {
    checkLease(lease);
    requireScope(leaseToken !== undefined && lease.leaseToken === leaseToken, "ECS_FIRST_OPEN_OWNERSHIP_LEASE");
  };
  const repository: DeploymentExecutionRepository = {
    claimNext: forbidden, confirmCleanupSchedule: forbidden, enqueueJob: forbidden, completeJob: forbidden,
    retryJob: forbidden, markReady: forbidden, markInstanceUnavailable: forbidden, markCleanupStatus: forbidden,
    beginTenantResourceCleanup: forbidden, assertTenantResourceCleanupFence: forbidden, completeTenantResourceCleanup: forbidden,
    beginOrResumeTenantResourceCleanup: forbidden, beginTenantResourceCleanupPhase: forbidden,
    completeTenantResourceCleanupPhase: forbidden, finalizeTenantResourceCleanup: forbidden,
    async loadContext(job) {
      checkLease({ jobId: job.id, deploymentId: job.deploymentId, workerId: scope.executionId,
        attempt: job.attempt, leaseToken: job.leaseToken });
      requireScope((leaseToken === undefined || leaseToken === job.leaseToken) && job.jobType === "apply" &&
        job.maxAttempts === 1 && job.leaseExpiresAt === writeBefore && job.payload.deploymentId === scope.deploymentId &&
        job.payload.planHash === scope.planHash, "ECS_FIRST_OPEN_OWNERSHIP_LEASE");
      const context = await repo.loadContext(job);
      checkWindow();
      checkContext(context);
      requireScope(leaseToken === undefined || leaseToken === job.leaseToken, "ECS_FIRST_OPEN_OWNERSHIP_LEASE");
      leaseToken = job.leaseToken;
      return context;
    },
    reserveEnvironmentCapacity(x) {
      guardLease(x.lease);
      requireScope(x.environmentId === environmentId, "ECS_FIRST_OPEN_OWNERSHIP_CONTEXT");
      return repo.reserveEnvironmentCapacity(x);
    },
    heartbeat(x) { guardLease(x.lease); return repo.heartbeat({ ...x, notAfter: writeBefore }); },
    transitionDeployment(x) {
      guardLease(x.lease);
      requireScope(allowedTransitions.has(x.to), "ECS_FIRST_OPEN_REPOSITORY_OPERATION_DISABLED");
      return repo.transitionDeployment(x);
    },
    beginStep(x) { guardLease(x.lease); return repo.beginStep(x); },
    finishStep(x) { guardLease(x.lease); return repo.finishStep(x); },
    async claimTenantResourceGeneration(x) {
      guardLease(x.lease);
      requireScope(same(x.identity, fence.resourceFence.identity), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      const claim = await repo.claimTenantResourceGeneration(x);
      requireScope(same(claim.fence, fence.resourceFence), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      return claim;
    },
    recordTenantResourceLifecycle(x) {
      guardLease(x.lease);
      requireScope(same(x.fence, fence.resourceFence) && same(x.externalFence, fence), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      return repo.recordTenantResourceLifecycle(x);
    },
    async prepareTenantExternalOperation(x) {
      guardLease(x.lease);
      requireScope(x.intent === fence.intent && x.operationHash === fence.operationHash && same(x.resourceFence, fence.resourceFence),
        "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      const claim = await repo.prepareTenantExternalOperation(x);
      requireScope(same(claim.fence, pending), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      return claim;
    },
    activateTenantExternalOperation(x) {
      guardLease(x.lease);
      requireScope(same(x.proof.pendingFence, pending), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      return repo.activateTenantExternalOperation(x);
    },
    assertTenantExternalOperation(x) {
      guardLease(x.lease);
      requireScope(same(x.externalFence, fence) && x.requiredState === "active", "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      return repo.assertTenantExternalOperation(x);
    },
  };
  return Object.freeze(repository);
}

function productionDynamo(credentials: Identity["credentials"]): AwsSdkDynamoDbEpochAuthorityDependencies {
  const endpoint = `https://dynamodb.${region}.amazonaws.com`;
  const sdk = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint, region, credentials,
    maxAttempts: 1, ignoreConfiguredEndpointUrls: true }));
  return { client: { async send(command, options) {
    if (command instanceof GetCommand) return { ...await sdk.send(command, options) };
    if (command instanceof PutCommand) return { ...await sdk.send(command, options) };
    return forbidden();
  } }, commands: {
    get: GetCommand as unknown as AwsSdkDynamoDbEpochAuthorityDependencies["commands"]["get"],
    put: PutCommand as unknown as AwsSdkDynamoDbEpochAuthorityDependencies["commands"]["put"],
  } };
}

/** Single execution, initial G1/e1 only. PostgreSQL records an active fence
 * after the provider's vacancy CAS and independent exact readback. */
export function createFirstOpenRdsOwnership(input: Binding & {
  identity: Identity; tableArn: string; repository: AuthorityRepository; describeTenantStack: AwsDeploymentPort["describeTenantStack"];
  dynamo?: AwsSdkDynamoDbEpochAuthorityDependencies;
}): { coordinator: TenantExternalOwnershipCoordinatorPort; assertActive(fence: TenantExternalOperationFence, signal: AbortSignal): Promise<void> } {
  const scope = bindScope(input), { fence, checkContext, checkWindow, checkLease, now } = scope;
  const { identity, tableArn, repository, describeTenantStack } = input;
  requireScope(identity.roleArn === roleArn && typeof identity.credentials === "function" &&
    tableArn === FIRST_OPEN_RDS_AUTHORITY_TABLE_ARN, "ECS_FIRST_OPEN_OWNERSHIP_AUTHORITY");
  const store = new AwsSdkDynamoDbEpochAuthority({ tableArn }, input.dynamo ?? productionDynamo(identity.credentials));
  const stableIdentityHash = fence.resourceFence.identity.stableIdentityHash;
  const key = "tenant:" + stableIdentityHash, stackName = awsSandboxTenantStackName(scope.appInstanceId);
  const pending = { ...fence, state: "pending_external" };
  const candidate = { stableIdentityHash, schemaVersion: fence.schemaVersion, generation: fence.resourceFence.generation,
    epoch: fence.epoch, intent: fence.intent, ownerDeploymentId: fence.ownerDeploymentId, operationHash: fence.operationHash, marker: fence.marker };
  const vacancy = (x: TenantExternalEpochAuthoritySnapshot) => x.authorityKey === key && x.revision === "rev:0" && x.record === null;
  const installed = (x: TenantExternalEpochAuthoritySnapshot) => x.authorityKey === key && x.revision === "rev:1" &&
    same(x.record, { ...candidate, predecessor: null });
  let attempted = false, written = false, activeLease: DeploymentJobLeaseFence | undefined;
  const authority: AtomicTenantExternalEpochAuthorityPort = {
    async observe(x) {
      checkWindow(x.signal);
      requireScope(x.authorityKey === key, "ECS_FIRST_OPEN_OWNERSHIP_AUTHORITY");
      const observed = await store.observe(x);
      checkWindow(x.signal);
      requireScope(written ? installed(observed) : vacancy(observed), "ECS_FIRST_OPEN_OWNERSHIP_READBACK");
      return observed;
    },
    async compareAndSet(x) {
      checkWindow(x.signal);
      requireScope(!written && x.authorityKey === key && vacancy(x.expected) && same(x.next, candidate), "ECS_FIRST_OPEN_OWNERSHIP_CAS");
      written = true;
      return store.compareAndSet(x);
    },
  };
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({ authority, workload: {
    async observe({ pendingFence, signal }) {
      checkWindow(signal);
      requireScope(same(pendingFence, pending), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      const observed = await describeTenantStack(stackName, { signal });
      checkWindow(signal);
      return { stackName, state: observed.state, stackId: observed.stackId, tags: observed.tags };
    },
  } });
  const bound = new RepositoryTenantExternalOwnershipCoordinator(repository, provider, now);
  return Object.freeze({
    coordinator: Object.freeze({
      async prepareAndActivate(x: Parameters<TenantExternalOwnershipCoordinatorPort["prepareAndActivate"]>[0]) {
        checkWindow(x.signal);
        checkLease(x.lease);
        checkContext(x.context);
        requireScope(x.intent === "provision" && x.context.job.leaseToken === x.lease.leaseToken &&
          x.context.job.leaseExpiresAt === scope.writeBefore && same(x.resourceFence, fence.resourceFence) &&
          await tenantExternalOperationHash(x.intent, x.resourceFence, x.context.deployment) === fence.operationHash,
          "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
        checkWindow(x.signal);
        requireScope(!attempted, "ECS_FIRST_OPEN_OWNERSHIP_ALREADY_ATTEMPTED");
        attempted = true;
        const active = await bound.prepareAndActivate(x);
        checkWindow(x.signal);
        requireScope(written && same(active, fence), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
        activeLease = structuredClone(x.lease);
        return active;
      },
    }),
    async assertActive(candidateFence: TenantExternalOperationFence, signal: AbortSignal) {
      checkWindow(signal);
      requireScope(activeLease && same(candidateFence, fence), "ECS_FIRST_OPEN_OWNERSHIP_FENCE");
      await authority.observe({ authorityKey: key, signal });
      const active = await repository.assertTenantExternalOperation({ lease: activeLease, externalFence: fence, requiredState: "active", now: now() });
      checkWindow(signal);
      requireScope(active, "ECS_FIRST_OPEN_OWNERSHIP_ACTIVE_LOST");
    },
  });
}
