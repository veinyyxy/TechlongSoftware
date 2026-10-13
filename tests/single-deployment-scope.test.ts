import test from "node:test";
import assert from "node:assert/strict";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { NeonDeploymentExecutionRepository } from "../lib/deployments/execution/neon-repository.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE, singleDeploymentClaimPredicate,
  singleDeploymentScopeFromArguments, validateSingleDeploymentScope } from "../lib/deployments/execution/single-deployment-scope.ts";
import type { ClaimedDeploymentJob } from "../lib/deployments/execution/contracts.ts";

const scope = () => ({ deploymentId: "dep_first_acceptance", appInstanceId: "app_first_acceptance",
  environmentId: "env_aws_sandbox_ca_central_1", planHash: "a".repeat(64), configurationHash: "b".repeat(64), artifactRef: FIRST_ACCEPTANCE_APP_IMAGE });
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
