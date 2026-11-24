import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { FIRST_OPEN_SECOND_SLOT, type FirstOpenSecondSlotApproval } from "../lib/deployments/execution/first-open-second-slot.ts";
import { firstOpenSecondSlotSqlFence, sandboxFirstOpenClaimDdl } from "../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { firstOpenSqlJson } from "../lib/deployments/execution/first-onboarding-sql-value.ts";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { sandboxFirstOpenMiddleDdl } from "../ops/aws-sandbox/first-onboarding-middle-ddl.ts";
import { firstOpenManagementNeonDraft } from "../ops/aws-sandbox/first-open-management-install.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";
import prepared from "../ops/aws-sandbox/first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

const startAt = Date.parse("2026-11-24T06:00:00Z"), writeBefore = startAt + 3_600_000;
const base = { approvalSha256: "a".repeat(64), planHash: prepared.scope.planSha256, configurationHash: prepared.scope.configurationSha256,
  writeBefore, window: { startAt, claimBefore: startAt + 12 * 60_000, workloadExpiresAt: startAt + 7_200_000, factsExpireAt: writeBefore,
    cleanupReviewSha256: "b".repeat(64), cleanupPermissionsEvidenceSha256: "c".repeat(64) } };
const secondSlot: FirstOpenSecondSlotApproval = { schema: "techlong/fc41597f-second-slot/v1", admissionEpoch: 0, listenerPriority: 110,
  environmentPolicy: { budgetLimitCents: 5000, ttlSeconds: 7200, maxCells: 1, maxTenants: 2, maxTaskCount: 1, allowedProfiles: ["standard-v1"],
    allowNatGateway: false, allowInterfaceEndpoints: false, databaseEngine: "aurora-postgresql-serverless-v2", auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: "16.14", auroraEngineMode: "provisioned", allowLimitlessDatabase: false, databaseMode: "tenant_database",
    auroraServerlessMinAcu: 0, auroraServerlessMaxAcu: 1, auroraSecondsUntilAutoPause: 300, allowDedicatedDatabase: false,
    allowMultiAzDatabase: false, allowRdsProxy: false, allowGlobalDatabase: false, logRetentionDays: 7 } };
const repositorySource = readFileSync(new URL("../lib/deployments/execution/neon-repository.ts", import.meta.url), "utf8");

test("second slot binds the independently verified release and shares the same narrow occupancy predicate across review, claim and reserve", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { claim, middle, completion } = await firstOpenManagementNeonDraft({ ...base, taskRelease, secondSlot }, repositorySource);
  const review = claim.split("AS $review$")[1].split("$review$;")[0];
  const oneShot = claim.split("AS $claim$")[1].split("$claim$;")[0];
  const reserve = middle.split("WHEN 'reserve' THEN")[1].split("WHEN 'heartbeat' THEN")[0];
  const readiness = middle.split("IF p_op='readiness' THEN")[1].split("IF (p_lease~")[0];
  const { incumbentDeploymentId, incumbentInstanceId, deploymentId } = FIRST_OPEN_SECOND_SLOT;
  for (const sql of [review, oneShot, readiness, reserve]) {
    assert.ok(sql.includes(`e.policy::jsonb=${firstOpenSqlJson(secondSlot.environmentPolicy)}`));
    assert.ok(sql.includes(`incumbent.id='${incumbentDeploymentId}' AND incumbent.app_instance_id='${incumbentInstanceId}'`));
    assert.match(sql, /e\.admission_state='open' AND e\.admission_epoch=0/);
    assert.match(sql, /e\.key='aws-sandbox-ca-central-1' AND e\.driver='aws_ecs_cell' AND e\.base_domain='sandbox\.techlong\.cloud'/);
    assert.match(sql, /incumbent\.status='ready' AND ia\.status='active'/);
    assert.match(sql, /other\.status IN \('queued','preflight'.*'ready'\)/);
    assert.doesNotMatch(sql, /r\.slot=1/);
    assert.ok(sql.includes(`r.deployment_id IN ('${incumbentDeploymentId}','${deploymentId}')`));
  }
  assert.match(review, /d\.status='planned' AND j\.job_type='apply' AND j\.status='pending' AND j\.attempts=0 AND j\.max_attempts=1/);
  assert.match(oneShot, /transaction_isolation.*read committed[\s\S]*FOR UPDATE OF j,d;[\s\S]*FOR UPDATE OF e;[\s\S]*RETURN QUERY WITH eligible/);
  assert.match(reserve, /FOR UPDATE OF e;[\s\S]*e\.policy::jsonb=[\s\S]*generate_series\(2, \(\(p_args->>2\)::integer\)\)[\s\S]*INSERT INTO public\.deployment_environment_capacity_reservations/);
  assert.equal(middle.match(/generate_series\(/g)?.length, 1);
  assert.ok(reserve.includes(`r.deployment_id='${deploymentId}' AND r.slot=2`));
  assert.match(reserve, /ON CONFLICT DO NOTHING[\s\S]*FIRST_OPEN_MIDDLE_SECOND_SLOT_RESULT/);
  assert.doesNotMatch(reserve, /DELETE FROM |UPDATE public\.deployment_environments|EXECUTE /);
  assert.match(claim, /GRANT SELECT \(deployment_id,environment_id,slot\) ON public\.deployment_environment_capacity_reservations TO first_onboarding_fc41597f_claim_owner;/);
  assert.doesNotMatch(completion, /FIRST_OPEN_.*SECOND_SLOT/);
});

test("legacy SQL has no second-slot grants or occupancy gates; an unverified release cannot compile the new lane", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const old = await firstOpenManagementNeonDraft(base, repositorySource);
  assert.doesNotMatch(old.claim, /admission_epoch|slot=1|transaction_isolation/);
  assert.doesNotMatch(old.middle, /FIRST_OPEN_MIDDLE_SECOND_SLOT|admission_epoch/);
  assert.match(old.middle, /generate_series\(1, \(\(p_args->>2\)::integer\)\)/);
  assert.equal(old.claim, (await firstOpenManagementNeonDraft({ ...base, secondSlot: undefined }, repositorySource)).claim);
  assert.throws(() => sandboxFirstOpenClaimDdl({ ...base, secondSlot }), /SECOND_SLOT_RELEASE/);
  await assert.rejects(sandboxFirstOpenMiddleDdl({ ...base, secondSlot }, repositorySource));
  const wrongRelease = { ...taskRelease, image: { ...taskRelease.image, verificationSha256: "f".repeat(64) } };
  assert.throws(() => sandboxFirstOpenClaimDdl({ ...base, secondSlot, taskRelease: wrongRelease }), /SECOND_SLOT_RELEASE/);
  await assert.rejects(sandboxFirstOpenMiddleDdl({ ...base, secondSlot, taskRelease: wrongRelease }, repositorySource), /TASK_PROOF_DIGEST/);
  assert.throws(() => sandboxFirstOpenClaimDdl({ ...base, taskRelease, secondSlot: { ...secondSlot,
    environmentPolicy: { ...secondSlot.environmentPolicy, maxTenants: 3 } } }), /SECOND_SLOT_APPROVAL/);
});

test("logical incumbent slot 1 stays unwritten; the guarded reservation inserts exact slot 2 once and rejects ledger drift", async ctx => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const middle = await sandboxFirstOpenMiddleDdl({ ...base, taskRelease, secondSlot }, repositorySource);
  const reserve = middle.split("WHEN 'reserve' THEN")[1].split("WHEN 'heartbeat' THEN")[0];
  const occupancyGate = /IF NOT \((EXISTS [\s\S]+?)\) THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_SECOND_SLOT'; END IF;/.exec(reserve)?.[1];
  assert.ok(occupancyGate);
  assert.match(reserve, /FROM deployment_jobs AS job|FROM public\.deployment_jobs AS job/);
  assert.match(reserve, /job\.lease_token = \(p_args->>5\)[\s\S]*job\.lease_expires_at > db_clock\.now_ms/);
  assert.match(reserve, /existing AS MATERIALIZED[\s\S]*INNER JOIN owned_job ON true[\s\S]*AND NOT EXISTS \(SELECT 1 FROM existing\)[\s\S]*SELECT deployment_id FROM existing/);

  // Use the rendered predicates and reservation SELECT/INSERT in memory.
  // Translate PostgreSQL locks, casts and the modifying CTE for SQLite;
  // PostgreSQL ordering and the real lease branch are checked above by shape.
  const db = new DatabaseSync(":memory:");
  ctx.after(() => db.close());
  db.exec(`ATTACH DATABASE ':memory:' AS public;
    CREATE TABLE public.deployment_environments(id TEXT,kind TEXT,status TEXT,apply_enabled INTEGER,key TEXT,driver TEXT,base_domain TEXT,
      expected_account_id TEXT,region TEXT,cell_key TEXT,admission_state TEXT,admission_epoch INTEGER,policy TEXT);
    CREATE TABLE public.app_instance_deployments(id TEXT,app_instance_id TEXT,environment_id TEXT,status TEXT);
    CREATE TABLE public.app_instances(id TEXT,status TEXT);
    CREATE TABLE public.deployment_environment_capacity_reservations(deployment_id TEXT PRIMARY KEY,environment_id TEXT,slot INTEGER,
      reserved_at INTEGER, UNIQUE(environment_id,slot));`);
  const { environmentId: env, incumbentInstanceId: app, incumbentDeploymentId: incumbent, deploymentId: own } = FIRST_OPEN_SECOND_SLOT;
  const policy = `'${canonicalJson(secondSlot.environmentPolicy).replaceAll("'", "''")}'`;
  const uncast = (sql: string) => sql.replaceAll(firstOpenSqlJson(secondSlot.environmentPolicy), policy).replaceAll("::jsonb", "");
  db.exec(`INSERT INTO public.deployment_environments VALUES ('${env}','aws_sandbox','active',0,'aws-sandbox-ca-central-1','aws_ecs_cell',
      'sandbox.techlong.cloud','402010193138','ca-central-1','cell-sandbox-1','open',0,${policy});
    INSERT INTO public.app_instance_deployments VALUES ('${incumbent}','${app}','${env}','ready'), ('${own}','new-app','${env}','planned');
    INSERT INTO public.app_instances VALUES ('${app}','active');`);
  const occupancy = db.prepare(`SELECT (${uncast(occupancyGate)}) AS allowed`);
  const preclaim = db.prepare(`SELECT EXISTS (SELECT 1 FROM public.deployment_environments e WHERE ${uncast(firstOpenSecondSlotSqlFence(secondSlot))}) AS allowed`);
  const setSlots = (rows: readonly (readonly [string, string, number])[]) => {
    db.exec("DELETE FROM public.deployment_environment_capacity_reservations");
    const insert = db.prepare("INSERT INTO public.deployment_environment_capacity_reservations VALUES (?,?,?,42)");
    for (const row of rows) insert.run(...row);
  };
  const slot1 = [incumbent, env, 1] as const, slot2 = [own, env, 2] as const;
  const next = /next_slot AS MATERIALIZED \(\s*([\s\S]+?)\s*\), inserted/.exec(reserve)?.[1];
  const existing = /existing AS MATERIALIZED \(\s*([\s\S]+?)\s*\), next_slot/.exec(reserve)?.[1];
  const write = /inserted AS \(\s*([\s\S]+?RETURNING deployment_id)\s*\)/.exec(reserve)?.[1];
  const series = /CROSS JOIN LATERAL generate_series\((\d+), \(\(p_args->>2\)::integer\)\) AS candidate\(slot\)/;
  assert.ok(next && existing && write);
  const min = series.exec(next)?.[1];
  assert.ok(min);
  const bind = (sql: string) => sql.replaceAll("((p_args->>2)::integer)", "2").replaceAll("(p_args->>0)", `'${own}'`);
  const ctes = `WITH RECURSIVE candidates(slot) AS (SELECT ${min} UNION ALL SELECT slot+1 FROM candidates WHERE slot<2),
    db_clock AS (SELECT 7 AS now_ms), owned_job AS (SELECT 1 WHERE :leased=1),
    locked_environment AS (SELECT id,1 AS admission_open FROM public.deployment_environments WHERE id='${env}'
      AND EXISTS (SELECT 1 FROM owned_job)),
    existing AS MATERIALIZED (${bind(existing).replace("FOR UPDATE OF reservation", "")}),
    next_slot AS MATERIALIZED (${next.replace(series, "CROSS JOIN candidates AS candidate")})`;
  const insert = db.prepare(`${ctes} ${bind(write)}`);
  const readExisting = db.prepare(`${ctes} SELECT deployment_id FROM existing`);
  const reservationRows = db.prepare("SELECT deployment_id, environment_id, slot, reserved_at FROM public.deployment_environment_capacity_reservations");
  const checkedReserve = (leased = 1) => {
    if (!occupancy.get()?.allowed) return undefined;
    return readExisting.get({ leased }) ?? insert.get({ leased });
  };
  assert.equal(occupancy.get()?.allowed, 1);
  assert.equal(preclaim.get()?.allowed, 1);
  assert.equal(checkedReserve(0), undefined);
  assert.equal(reservationRows.all().length, 0);
  assert.equal(checkedReserve()?.deployment_id, own);
  const afterInsert = reservationRows.all();
  assert.deepEqual(afterInsert.map(r => [r.deployment_id, r.environment_id, r.slot, r.reserved_at]), [[own, env, 2, 7]]);
  assert.equal(occupancy.get()?.allowed, 1);
  assert.equal(preclaim.get()?.allowed, 0);
  assert.equal(checkedReserve(0), undefined);
  assert.equal(checkedReserve()?.deployment_id, own);
  assert.deepEqual(reservationRows.all(), afterInsert);
  for (const rows of [
    [slot1], [slot1, slot2], [["foreign", env, 1]], [["foreign", env, 2]], [[own, env, 1]], [[own, env, 3]],
    [[own, "other-env", 2]], [slot2, ["foreign", env, 3]], [slot2, [incumbent, "other-env", 1]],
  ] as const) {
    setSlots(rows);
    const before = reservationRows.all();
    assert.equal(occupancy.get()?.allowed, 0);
    assert.equal(preclaim.get()?.allowed, 0);
    assert.equal(checkedReserve(), undefined);
    assert.deepEqual(reservationRows.all(), before);
  }
  setSlots([slot2]);
  db.prepare("INSERT INTO public.app_instance_deployments VALUES ('unexpected', ?, ?, 'ready')").run(app, env);
  assert.equal(occupancy.get()?.allowed, 0);
  db.exec("DELETE FROM public.app_instance_deployments WHERE id='unexpected'; UPDATE public.app_instances SET status='pending'");
  assert.equal(occupancy.get()?.allowed, 0);
  db.exec("UPDATE public.app_instances SET status='active'");
  for (const [column, original] of [["key", "aws-sandbox-ca-central-1"], ["driver", "aws_ecs_cell"], ["base_domain", "sandbox.techlong.cloud"]] as const) {
    const update = db.prepare(`UPDATE public.deployment_environments SET ${column}=?`);
    update.run("wrong");
    assert.equal(occupancy.get()?.allowed, 0);
    update.run(original);
    assert.equal(occupancy.get()?.allowed, 1);
  }
});
