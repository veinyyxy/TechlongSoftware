import test from "node:test";
import assert from "node:assert/strict";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { NeonDeploymentExecutionRepository } from "../lib/deployments/execution/neon-repository.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE, singleDeploymentClaimPredicate,
  singleDeploymentScopeFromArguments, validateSingleDeploymentScope } from "../lib/deployments/execution/single-deployment-scope.ts";
import type { ClaimedDeploymentJob, TenantResourceFence, TenantProvisionPredecessor } from "../lib/deployments/execution/contracts.ts";
import { awsSandboxTenantStackName } from "../lib/deployments/cloudformation/tenant-stack.ts";

const scope = () => ({ deploymentId: "dep_first_acceptance", appInstanceId: "app_first_acceptance",
  environmentId: "env_aws_sandbox_ca_central_1", planHash: "a".repeat(64), configurationHash: "b".repeat(64), artifactRef: FIRST_ACCEPTANCE_APP_IMAGE });

test("supervised cleanup receipt lookup binds full scope, generation and exact provision predecessor", async () => {
  const s = scope(), name = awsSandboxTenantStackName(s.appInstanceId);
  const fence: TenantResourceFence = { schemaVersion: 1, ownerDeploymentId: s.deploymentId, generation: 1,
    ownershipMarker: `tl_owner_${"c".repeat(32)}_g1`, identity: { schemaVersion: 1, appInstanceId: s.appInstanceId,
      workspaceId: "wsp_first", productId: "prd_first", environmentId: s.environmentId, cellKey: "cell-sandbox-1",
      databaseName: "tenant_first", roleName: "tenant_first_app", secretName: "techlong/sandbox/tenant/first/runtime/g1", stableIdentityHash: "c".repeat(64) } };
  const provisionPredecessor: TenantProvisionPredecessor = { schemaVersion: 1, generation: 1, epoch: 2, intent: "provision",
    ownerDeploymentId: s.deploymentId, operationHash: "d".repeat(64), marker: `tl_epoch_${"c".repeat(24)}_g1_e2` };
  const stackId = `arn:aws:cloudformation:ca-central-1:402010193138:stack/${name}/11111111-2222-3333-4444-555555555555`;
  const output = { stackName: name, stackId, cleanupMode: "supervised-reviewed", workloadStableIdentityHash: fence.identity.stableIdentityHash,
    workloadGeneration: 1, workloadProvisionEpoch: 2, workloadProvisionMarker: provisionPredecessor.marker,
    workloadProvisionHash: provisionPredecessor.operationHash, workloadTemplateSha256: "e".repeat(64), workloadParametersSha256: "f".repeat(64) };
  const client = { query: async (statement: string, values: unknown[]) => {
    assert.ok(statement.includes("mode='aws_sandbox'")); assert.deepEqual(values, Object.values(s));
    return { rows: [{ outputs: JSON.stringify(output) }], rowCount: 1 };
  } } as unknown as NeonQueryFunction<false, true>;
  const repository = new NeonDeploymentExecutionRepository("postgresql://local-test:not-real@localhost/fixture", s, () => client);
  const input = { fence, provisionPredecessor, signal: new AbortController().signal };
  assert.equal(await repository.readSupervisedTenantStackId(input), stackId);
  output.workloadProvisionEpoch = 1;
  await assert.rejects(repository.readSupervisedTenantStackId(input), { code: "SUPERVISED_WORKLOAD_RECEIPT_UNPROVED" });
  output.workloadProvisionEpoch = 2; output.stackId = name;
  await assert.rejects(repository.readSupervisedTenantStackId(input), { code: "SUPERVISED_WORKLOAD_RECEIPT_UNPROVED" });
});
function repository(scoped = true) {
  const calls: { statement: string; values: unknown[] }[] = [];
  const client = { query: async (statement: string, values: unknown[]) => {
    calls.push({ statement, values }); return { rows: [], rowCount: 0 };
  } } as unknown as NeonQueryFunction<false, true>;
  const value = new NeonDeploymentExecutionRepository("postgresql://local-test:not-real@localhost/fixture", scoped ? scope() : undefined, () => client);
  return { value, calls };
}

test("scoped claim constrains all maintenance/selection CTEs before writes, using bound parameters", async () => {
  const { value, calls } = repository();
  assert.equal(await value.claimNext({ workerId: "single-worker", now: 1, leaseDurationMs: 120000, jobTypes: ["apply", "reconcile"] }), null);
  assert.equal(calls.length, 1);
  for (const alias of ["blocked", "exhausted_job", "candidate_job"] as const)
    assert.ok(calls[0].statement.includes(singleDeploymentClaimPredicate(alias)));
  assert.equal(calls[0].statement.includes(scope().deploymentId), false);
  assert.deepEqual(calls[0].values.slice(4), Object.values(scope()));
  assert.ok(calls[0].statement.includes("FOR UPDATE OF candidate_job, candidate_deployment SKIP LOCKED"));
  assert.ok(calls[0].statement.includes("lease_token = $4"));
});

test("default repository retains old unscoped queue and only nulls all new scope parameters", async () => {
  const { value, calls } = repository(false);
  await value.claimNext({ workerId: "legacy-worker", now: 1, leaseDurationMs: 120000, jobTypes: ["cleanup"] });
  assert.deepEqual(calls[0].values.slice(4), [null, null, null, null, null, null]);
});

test("foreign claimed job rejects before any context query", async () => {
  const { value, calls } = repository();
  const job: ClaimedDeploymentJob = { id: "foreign_job", deploymentId: "foreign", jobType: "apply", attempt: 1, maxAttempts: 1,
    leaseExpiresAt: 123000, leaseToken: "test-lease", payload: { deploymentId: "foreign", planHash: scope().planHash } };
  await assert.rejects(() => value.loadContext(job), /SINGLE_DEPLOYMENT_CLAIM_MISMATCH/);
  assert.equal(calls.length, 0);
});

test("partial, typo, repeated or poll-mode scope cannot fall back to the global queue", () => {
  assert.equal(singleDeploymentScopeFromArguments(["--once"]), undefined);
  for (const args of [["--deployment-id", "dep_first_acceptance", "--once"], ["--deployment-idd", "dep_first_acceptance", "--once"],
    ["--deployment-id", "--once"], ["--configuration-sha", "b".repeat(64)]])
    assert.throws(() => singleDeploymentScopeFromArguments(args));
  const args = ["--deployment-id", scope().deploymentId, "--app-instance-id", scope().appInstanceId,
    "--environment-id", scope().environmentId, "--plan-sha", scope().planHash, "--configuration-sha", scope().configurationHash];
  assert.throws(() => singleDeploymentScopeFromArguments(args), /ONCE_REQUIRED/);
  assert.deepEqual(singleDeploymentScopeFromArguments([...args, "--check-runtime"]), scope());
  assert.throws(() => singleDeploymentScopeFromArguments([...args, "--once", "--deployment-id", scope().deploymentId]));
});

test("scope is cloned and frozen, rejects wrong image/environment and SQL-shaped IDs", () => {
  const raw = scope(), frozen = validateSingleDeploymentScope(raw); raw.deploymentId = "changed";
  assert.equal(frozen.deploymentId, "dep_first_acceptance"); assert.equal(Object.isFrozen(frozen), true);
  for (const patch of [{ artifactRef: "latest" }, { environmentId: "production" }, { planHash: "bad" }, { deploymentId: "x' OR 1=1--" }])
    assert.throws(() => validateSingleDeploymentScope({ ...scope(), ...patch }));
  // A present-but-undefined id must never become the SQL null/global sentinel.
  assert.throws(() => validateSingleDeploymentScope({ ...scope(), deploymentId: undefined } as unknown as ReturnType<typeof scope>));
  assert.throws(() => validateSingleDeploymentScope({ ...scope(), appInstanceId: null } as unknown as ReturnType<typeof scope>));
});
