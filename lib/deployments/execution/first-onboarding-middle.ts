import type { NeonQueryFunction } from "@neondatabase/serverless";
import { AwsSdkDynamoDbEpochAuthority, type AwsSdkDynamoDbEpochAuthorityDependencies } from "./aws-sdk-dynamodb-epoch-authority.ts";
import { AuthorityBackedTenantExternalOwnershipProvider, type AtomicTenantExternalEpochAuthorityPort } from "./cloudformation-external-ownership.ts";
import { RepositoryTenantExternalOwnershipCoordinator, tenantExternalOperationHash } from "./external-ownership-coordinator.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK, type SandboxFirstOpenPorts } from "./first-onboarding-run-once.ts";
import { firstOpenExecutionWindow, type FirstOpenControlledWindow } from "./first-onboarding-window.ts";
import { assertFirstOpenSecondSlot, type FirstOpenSecondSlotApproval } from "./first-open-second-slot.ts";
import type { DeploymentJobLeaseFence, TenantExternalOperationFence } from "./contracts.ts";
import { NeonDeploymentExecutionRepository } from "./neon-repository.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "./first-onboarding-version.ts";
import { COST_CONTROL_SCOPE_V1 } from "./sandbox-cost-controls-v1.ts";
import type { AwsSdkDeploymentAdapter } from "./aws-sdk-adapter.ts";

// Intentionally pin only the SQL the fixed first-open runner needs. Never
// transmit template SQL, a table name, or a caller-supplied function name.
export const FIRST_OPEN_MIDDLE_SQL_HASHES = Object.freeze({
  context: "95e355d6a3751a4da93af4d95a8b9abee181d00718e0bac2ac064d0b02dbb1bb",
  capacity_count: "2b5c7d52257d94c16debfe6c3daabb722584e4a04dc6d5e0b9e03a2cc06e7dd8",
  reserve: "a0bf5087e14d71d488a5f7d7d57b05789aac1f0ab64ea833765b55a56e0a3acd",
  heartbeat: "3676c9b56fe7fa6a5eb9551f34b3c5175c29ee5fb5f817cc1ae3360a5b12ba46",
  transition: "58d27858f6246472f8915b0bb259eb07b9f665f1ae8e1459ecd8a447290a0372",
  begin_step: "afb0f50dac771e71453c452548dbc00692569bf7c33ea49b242aa67a3bf4dc87",
  finish_step: "c5d3d1c89ed25f3a62c8b9ab4751cf5614de9b8176cf410a39534fb3fefb7c0a",
  record_lifecycle: "4a1122b0b0b009c073d9e00ebc847578f71a7a51b230b02d66a3c9cc0a1c7d63",
  claim_generation: "9eec36ce349a3b96dd913739ef3a9d4b7f5e52fbf6a3b848f2b5c22196bcde56",
  prepare_epoch: "2284a48b6271cc75a444a9016b583e6aab5e63928f1b1a27ea34efd768218493",
  activate_epoch: "b8775853fb6e6d3bf3e71afeff246a1a7aec72ac8c68c9d13e95b410d9135c5d",
  assert_epoch: "cdb5fb1644a689378c53a90b01841236ffc35bb351615af257fe177f4e2b4e58",
});
export type FirstOpenMiddleOperation = keyof typeof FIRST_OPEN_MIDDLE_SQL_HASHES;
export const FIRST_OPEN_MIDDLE_RPC = "SELECT row FROM techlong_first_onboarding_middle.run($1::text,$2::text,$3::text,$4::jsonb) AS r(row)";
export const FIRST_OPEN_MIDDLE_ROLES = Object.freeze({
  definer: "first_onboarding_fc41597f_middle_owner",
  runner: "first_onboarding_fc41597f_middle",
});
export const FIRST_OPEN_AUTHORITY_KEY = "tenant:" + s.stableIdentity;
export const FIRST_OPEN_RESOURCE_MARKER = "tl_owner_" + s.stableIdentity.slice(0, 32) + "_g1";
export const FIRST_OPEN_EPOCH_MARKER = "tl_epoch_" + s.stableIdentity.slice(0, 24) + "_g1_e1";
export const FIRST_OPEN_MIDDLE_WORKER = "first-onboarding:" + s.jobId;
export const FIRST_OPEN_ARTIFACT = s.imageRepository + "@" + s.imageDigest;
export const FIRST_OPEN_SECRET_BASE_NAME = s.secretName.slice(0, -"/g1".length);

export interface FirstOpenMiddleScope {
  approvalSha256: string;
  planHash: string;
  configurationHash: string;
  writeBefore: number;
  window: FirstOpenControlledWindow;
  taskRelease?: FirstOpenTaskRelease;
  secondSlot?: FirstOpenSecondSlotApproval;
}

export interface FirstOpenMiddleSql {
  query(sql: typeof FIRST_OPEN_MIDDLE_RPC, params: [string, string, FirstOpenMiddleOperation | "readiness", string]):
    Promise<{ rows: unknown[] }>;
}

function requireScope(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Object.assign(Error(reason), { retryable: false });
}

export function firstOpenMiddleScope(input: FirstOpenMiddleScope) {
  const x = structuredClone(input);
  requireScope([x.approvalSha256, x.planHash, x.configurationHash].every(h => /^[a-f0-9]{64}$/.test(h)), "FIRST_OPEN_MIDDLE_SCOPE");
  firstOpenVersion(x.taskRelease);
  if (x.secondSlot !== undefined) {
    requireScope(x.taskRelease !== undefined, "FIRST_OPEN_MIDDLE_SECOND_SLOT_SCOPE");
    assertFirstOpenSecondSlot(x.secondSlot);
  }
  return Object.freeze({ ...x, window: firstOpenExecutionWindow(s.jobId, x.writeBefore, x.window)! });
}

export function firstOpenMiddleOperationHash(scope: Pick<FirstOpenMiddleScope, "planHash" | "configurationHash" | "taskRelease">) {
  return tenantExternalOperationHash("provision", { identity: { appInstanceId: s.instanceId },
    generation: 1, ownershipMarker: FIRST_OPEN_RESOURCE_MARKER },
  { id: s.deploymentId, planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: firstOpenVersion(scope.taskRelease).artifactRef });
}

type Repository = SandboxFirstOpenPorts["repository"] & Pick<NeonDeploymentExecutionRepository,
  "prepareTenantExternalOperation" | "activateTenantExternalOperation">;

export function createSandboxFirstOpenMiddleRepository(input: {
  scope: FirstOpenMiddleScope; sql: FirstOpenMiddleSql; now?: () => number;
}): Repository {
  const scope = firstOpenMiddleScope(input.scope), now = input.now ?? Date.now;
  const inWindow = () => requireScope(now() >= scope.window.startAt && now() < scope.writeBefore, "FIRST_OPEN_MIDDLE_WINDOW");
  const known = new Map<string, FirstOpenMiddleOperation>(Object.entries(FIRST_OPEN_MIDDLE_SQL_HASHES)
    .map(([key, value]) => [value, key as FirstOpenMiddleOperation]));
  const checkToken = (token: string) => requireScope(/^lease_[a-f0-9]{32}$/.test(token), "FIRST_OPEN_MIDDLE_LEASE");
  const checkLease = (f: DeploymentJobLeaseFence) => {
    requireScope(f.jobId === s.jobId && f.deploymentId === s.deploymentId && f.workerId === FIRST_OPEN_MIDDLE_WORKER && f.attempt === 1,
      "FIRST_OPEN_MIDDLE_LEASE");
    return f.leaseToken;
  };
  const repository = (token: string) => {
    checkToken(token);
    // The mandatory injected client has no default credential path. A new
    // lightweight wrapper per call captures only this call's lease token.
    const client = { async query(statement: string, bindings: unknown[]) {
      inWindow();
      const key = known.get(await sha256Hex(statement));
      requireScope(key, "FIRST_OPEN_MIDDLE_SQL_NOT_REVIEWED");
      const result = await input.sql.query(FIRST_OPEN_MIDDLE_RPC, [scope.approvalSha256, token, key, canonicalJson(bindings)]);
      inWindow();
      requireScope(result.rows.length <= 1 && result.rows.every(x => x && typeof x === "object" &&
        "row" in x && x.row && typeof x.row === "object" && !Array.isArray(x.row)), "FIRST_OPEN_MIDDLE_RPC_ACK");
      return { rows: result.rows.map(x => (x as { row: object }).row) };
    } };
    return new NeonDeploymentExecutionRepository("postgresql://first-open-rpc.invalid", undefined,
      () => client as unknown as NeonQueryFunction<false, true>);
  };
  return {
    loadContext(job) {
      requireScope(job.id === s.jobId && job.deploymentId === s.deploymentId && job.attempt === 1 &&
        job.jobType === "apply" && job.payload.planHash === scope.planHash, "FIRST_OPEN_MIDDLE_JOB");
      return repository(job.leaseToken).loadContext(job);
    },
    reserveEnvironmentCapacity: x => repository(checkLease(x.lease)).reserveEnvironmentCapacity(x),
    heartbeat(x) {
      requireScope("notAfter" in x && x.notAfter === scope.writeBefore, "FIRST_OPEN_MIDDLE_HEARTBEAT_WINDOW");
      return repository(checkLease(x.lease)).heartbeat(x);
    },
    transitionDeployment: x => repository(checkLease(x.lease)).transitionDeployment(x),
    beginStep: x => repository(checkLease(x.lease)).beginStep(x),
    finishStep: x => repository(checkLease(x.lease)).finishStep(x),
    recordTenantResourceLifecycle: x => repository(checkLease(x.lease)).recordTenantResourceLifecycle(x),
    claimTenantResourceGeneration: x => repository(checkLease(x.lease)).claimTenantResourceGeneration(x),
    prepareTenantExternalOperation: x => repository(checkLease(x.lease)).prepareTenantExternalOperation(x),
    activateTenantExternalOperation: x => repository(checkLease(x.lease)).activateTenantExternalOperation(x),
    assertTenantExternalOperation: x => repository(checkLease(x.lease)).assertTenantExternalOperation(x),
  };
}

/** Existing DynamoDB CAS, but only for a vacant, exact tenant key and once. */
export function bindSandboxFirstOpenMiddle(input: {
  scope: FirstOpenMiddleScope; sql: FirstOpenMiddleSql; dynamo: AwsSdkDynamoDbEpochAuthorityDependencies;
  cloud: Pick<AwsSdkDeploymentAdapter, "region" | "describeTenantStack">; now?: () => number;
}) {
  const scope = firstOpenMiddleScope(input.scope), now = input.now ?? Date.now;
  requireScope(input.cloud.region === s.region, "FIRST_OPEN_AUTHORITY_REGION");
  const repository = createSandboxFirstOpenMiddleRepository({ scope, sql: input.sql, now });
  const store = new AwsSdkDynamoDbEpochAuthority({ tableArn: COST_CONTROL_SCOPE_V1.tableArn }, input.dynamo);
  const operation = firstOpenMiddleOperationHash(scope);
  let vacancyProved = false, readBeforeClaim = false, provisionStarted = false, triedCas = false, authorityReads = 0;
  const at = (signal: AbortSignal) => {
    signal.throwIfAborted();
    requireScope(now() >= scope.window.startAt && now() < scope.writeBefore, "FIRST_OPEN_AUTHORITY_WINDOW");
  };
  const assertFence = async (f: TenantExternalOperationFence) => {
    requireScope(f.state === "pending_external" && f.intent === "provision" && f.epoch === 1 &&
      f.operationHash === await operation && f.marker === FIRST_OPEN_EPOCH_MARKER && f.ownerDeploymentId === s.deploymentId &&
      f.resourceFence.generation === 1 && f.resourceFence.ownerDeploymentId === s.deploymentId &&
      f.resourceFence.ownershipMarker === FIRST_OPEN_RESOURCE_MARKER && f.resourceFence.identity.appInstanceId === s.instanceId &&
      f.resourceFence.identity.stableIdentityHash === s.stableIdentity, "FIRST_OPEN_AUTHORITY_FENCE");
  };
  const exactVacancy = (v: { authorityKey: string; revision: string; record: unknown }) =>
    v.authorityKey === FIRST_OPEN_AUTHORITY_KEY && v.revision === "rev:0" && v.record === null;
  const authority: AtomicTenantExternalEpochAuthorityPort = {
    async observe(x) {
      at(x.signal);
      requireScope(vacancyProved && x.authorityKey === FIRST_OPEN_AUTHORITY_KEY && ++authorityReads <= 2, "FIRST_OPEN_AUTHORITY_READ");
      const observed = await store.observe(x);
      if (!triedCas) requireScope(exactVacancy(observed), "FIRST_OPEN_AUTHORITY_OCCUPIED");
      return observed;
    },
    async compareAndSet(x) {
      at(x.signal);
      requireScope(vacancyProved && !triedCas && x.authorityKey === FIRST_OPEN_AUTHORITY_KEY && exactVacancy(x.expected) &&
        x.next.stableIdentityHash === s.stableIdentity && x.next.epoch === 1 && x.next.generation === 1 &&
        x.next.intent === "provision" && x.next.ownerDeploymentId === s.deploymentId &&
        x.next.operationHash === await operation && x.next.marker === FIRST_OPEN_EPOCH_MARKER, "FIRST_OPEN_AUTHORITY_WRITE");
      at(x.signal);
      triedCas = true;
      return store.compareAndSet(x);
    },
  };
  const provider = new AuthorityBackedTenantExternalOwnershipProvider({
    authority, workload: { async observe({ pendingFence, signal }) {
      at(signal); await assertFence(pendingFence); at(signal);
      const observed = await input.cloud.describeTenantStack(SANDBOX_FIRST_OPEN_STACK, { signal });
      at(signal);
      return { stackName: SANDBOX_FIRST_OPEN_STACK, state: observed.state, stackId: observed.stackId, tags: observed.tags };
    } },
  });
  const coordinator = new RepositoryTenantExternalOwnershipCoordinator(repository, provider, now);
  return {
    repository,
    async verifyMiddleReadyBeforeClaim(signal: AbortSignal) {
      at(signal);
      requireScope(now() < scope.window.claimBefore, "FIRST_OPEN_MIDDLE_PRECLAIM");
      const response = await input.sql.query(FIRST_OPEN_MIDDLE_RPC, [scope.approvalSha256, "", "readiness", "[]"]);
      at(signal);
      requireScope(response.rows.length === 1 && canonicalJson(response.rows[0]) === canonicalJson({ row: {
        jobId: s.jobId, planHash: scope.planHash, configurationHash: scope.configurationHash,
        writeBefore: scope.writeBefore, claimBefore: scope.window.claimBefore,
      } }), "FIRST_OPEN_MIDDLE_READY_UNPROVED");
    },
    async verifyAuthorityVacantBeforeClaim(signal: AbortSignal) {
      at(signal);
      requireScope(!readBeforeClaim && now() < scope.window.claimBefore, "FIRST_OPEN_AUTHORITY_PRECLAIM");
      readBeforeClaim = true;
      requireScope(exactVacancy(await store.observe({ authorityKey: FIRST_OPEN_AUTHORITY_KEY, signal })), "FIRST_OPEN_AUTHORITY_OCCUPIED");
      at(signal);
      vacancyProved = true;
    },
    provisionEpoch: (async x => {
      at(x.signal);
      requireScope(vacancyProved && !provisionStarted && x.intent === "provision" && x.resourceFence.generation === 1 &&
        x.context.deployment.id === s.deploymentId && x.context.deployment.planHash === scope.planHash &&
        x.context.deployment.configurationHash === scope.configurationHash &&
        x.context.deployment.artifactRef === firstOpenVersion(scope.taskRelease).artifactRef, "FIRST_OPEN_AUTHORITY_PROVISION");
      provisionStarted = true;
      return coordinator.prepareAndActivate(x);
    }) satisfies SandboxFirstOpenPorts["provisionEpoch"],
  };
}

/** Approval material only; nothing attaches these permissions at runtime. */
export const FIRST_OPEN_AUTHORITY_POLICY = Object.freeze({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem"],
    Resource: COST_CONTROL_SCOPE_V1.tableArn,
    Condition: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [FIRST_OPEN_AUTHORITY_KEY] },
      Null: { "dynamodb:LeadingKeys": "false" } } }],
});
