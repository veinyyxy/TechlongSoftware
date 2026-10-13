import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { registeredSealedCertificateV1 as certificate } from "./fixtures/registered-sealed-certificate-v1.ts";
import { compileFailedBirthInstallReviewV4, validateFailedBirthInstallReviewV4, assertFailedBirthInstallPrestateV4,
  runReviewedFailedBirthInstallationV4, verifyFailedBirthInstallPoststateV4, FAILED_BIRTH_INSTALL_SCOPE_V4,
  FAILED_BIRTH_INSTALL_READ_SQL_V4, type FailedBirthInstallReadV4 } from "../lib/deployments/execution/failed-cell-birth-installation-v4.ts";
import { FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4 } from "../lib/deployments/execution/failed-cell-birth-installation-v4.ts";

const schema = (await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n"),
  grants = (await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
type Row = Record<string, unknown>;
const at = 1791848000000, binding = { targetFingerprintSha256: "a".repeat(64), codeSha256: "b".repeat(64) }, table = "deployment_failed_cell_birth_fences_v1";
const fnNames = ["enforce_deployment_environment_admission_transition", "reject_failed_cell_birth_fence_mutation_v1", "guard_failed_cell_birth_environment_v1", "begin_failed_cell_birth_fence_v1"];
// SQL/once-only fixtures only, never claimed to be PG18 or live-role acceptance.
async function fixture() {
  const cert = structuredClone(certificate), owner = "fixture_owner";
  const role = (name: string) => ({ name, rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false,
    rolreplication: false, owner_member: false, grant_option: false, nontrigger_definer_access: false, memberships: [], rolinherit: false, sequence_access: false, schema_privileges: ["public:USAGE"],
    ...structuredClone(FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4[name as keyof typeof FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4]) });
  const oldFn = { kind: "function", name: fnNames[0], properties: { owner, acl: [] } }, transition = { kind: "trigger", name: "deployment_environments_admission_transition", properties: { definition: "fixture" } },
    constraints = ["deployment_environments_admission_state_check", "deployment_environments_admission_consistency_check"].map(name => ({ kind: "environment_constraint", name, properties: { definition: "'open' 'draining'", type: "c", validated: true } }));
  const state = {
    base: { preserved: { sealed: { identity: { role: owner, sessionRole: owner, version: 180006, replicationRole: "origin", canCreatePublic: true }, certificates: [cert],
      fence: { sealed: true }, protectionSha256: cert.protection_schema_sha256, evidence: { originalRowSha256: cert.original_row_sha256,
        originalPlanBytesSha256: cert.original_plan_bytes_sha256, originalPlanHash: cert.original_plan_hash, businessStateSha256: cert.business_state_sha256, executionReferences: { jobs: 0 } },
      tables: [{ name: "deployment_environments", owner_member: true, constraints: [], triggers: [{ name: transition.name }] }] }, management: {}, catalog: [] },
      roles: [role("techlong_cell_cleanup_reader"), role("techlong_cell_drain")] },
    environmentState: { environment: { id: "env_aws_sandbox_ca_central_1", expected_account_id: "402010193138", region: "ca-central-1", cell_key: "cell-sandbox-1",
      kind: "aws_sandbox", driver: "aws_ecs_cell", base_domain: "sandbox.techlong.cloud", status: "active", apply_enabled: 0, admission_state: "open", admission_epoch: 0 },
      capacity: 0, resources: 0, schedules: 0, jobs: 0, steps: 0, other_deployments: 0 },
    objects: [oldFn, transition, ...constraints], fenceRows: null, protectionSha256: "1".repeat(64),
  } as unknown as FailedBirthInstallReadV4["state"];
  const read = async (s = state): Promise<FailedBirthInstallReadV4> => ({ state: structuredClone(s), stateSha256: await sha256Hex(s), observedAt: at,
    transaction: { readOnly: "on", isolation: "serializable", deferrable: "on", searchPath: "pg_catalog" } });
  const before = await read(), review = await compileFailedBirthInstallReviewV4(before, binding, at, at), after = structuredClone(state);
  after.fenceRows = 0; after.protectionSha256 = "2".repeat(64);
  const reader = after.base.roles[0]; reader.table_privileges = [...(reader.table_privileges as string[]), `public.${table}:SELECT`].sort();
  reader.column_privileges = ["deployment_jobs", "deployment_step_runs"].flatMap(t => ["id", "deployment_id", "status"].map(c => `public.${t}.${c}:SELECT`)).sort();
  after.base.roles[1].nontrigger_definer_access = true;
  const funcs = await Promise.all(fnNames.map(async name => ({ kind: "function", name, properties: { owner, bodySha256: await sha256Hex(schema.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*? AS \\$\\$([\\s\\S]*?)\\$\\$;`))![1]),
    arguments: name === fnNames[3] ? "input_json text, input_sha256 text" : "", returns: name === fnNames[3] ? "text" : "trigger", language: "plpgsql", config: ["search_path=pg_catalog"],
    definer: [fnNames[2], fnNames[3]].includes(name), acl: name === fnNames[3] ? [{ grantee: "techlong_cell_drain", privilege: "EXECUTE", grantable: false }] : [] } })));
  const triggers = [["failed_birth_fence_mutation_v1", table, fnNames[1], 27], ["failed_birth_fence_truncate_v1", table, fnNames[1], 34],
    ["failed_birth_environment_mutation_v1", "deployment_environments", fnNames[2], 27], ["failed_birth_environment_truncate_v1", "deployment_environments", fnNames[2], 34],
    [transition.name, "deployment_environments", fnNames[0], 19]].map(([name, t, fn, type]) => ({ kind: "trigger", name, properties: { table: t, function: fn, type, enabled: "A", arguments: "", definition: "fixture" } }));
  after.objects = [...funcs, ...triggers, ...constraints.map(x => ({ ...x, properties: { ...x.properties, definition: "'open' 'draining' 'failed_unadmitted'" } })),
    { kind: "table", name: table, properties: { owner, kind: "r", rls: false, forceRls: false, columns: ["environment_id", "fence_json", "fence_sha256", "created_at"].map(name =>
      ({ name, type: name === "created_at" ? "bigint" : "text", notNull: true, default: null })), constraints: Array.from({ length: 7 }, (_, n) => ({ validated: true, type: n < 5 ? "c" : n === 5 ? "p" : "f" })),
      acl: [{ grantee: "techlong_cell_cleanup_reader", privilege: "SELECT", grantable: false }] } }];
  let installed = false, consumed = 0, fault = "", time = at, drift = false;
  const calls: string[] = [], client = { async query(s: string) { calls.push(s); if (s === fault) throw Error("private provider message"); if (s === schema) installed = true; return { rows: [] }; } };
  const input = { client, review, binding, schema, grants, approvedSha: review.manifestSha256, now: () => time,
    readState: async () => { const r = await read(installed ? after : state); if (drift) r.stateSha256 = "f".repeat(64); return r; },
    verifyCode: async () => undefined, claimPermanentSlot: async () => { consumed++; } };
  return { state, before, after, review, read, input, calls, consumed: () => consumed, failAt: (s: string) => { fault = s; }, expire: () => { time = at + 3600000; }, drift: () => { drift = true; } };
}
test("cold review pins exact SQL, target, full risk and limited installation scope; no activation", async () => {
  const f = await fixture(); await validateFailedBirthInstallReviewV4(f.review, binding, schema, grants);
  assert.equal(f.review.scope.runtimeEnabled, false); assert.equal(f.review.scope.callsFailureEntry, false); assert.equal(f.review.scope.changesBusinessRows, false);
  for (const change of [{ risks: {} }, { scope: { ...FAILED_BIRTH_INSTALL_SCOPE_V4, runtimeEnabled: true } }, { binding: { ...binding, codeSha256: "c".repeat(64) } }])
    await assert.rejects(validateFailedBirthInstallReviewV4({ ...f.review, ...change } as typeof f.review, binding, schema, grants));
  await assert.rejects(validateFailedBirthInstallReviewV4(f.review, binding, schema + "\n", grants));
});
test("nonterminal work, unsafe role and occupied object fail prestate; actual jobs use pending/running/retry_wait", async () => {
  const f = await fixture(); for (const change of ["jobs", "role", "object"]) { const s = structuredClone(f.state);
    if (change === "jobs") s.environmentState.jobs = 1;
    if (change === "role") s.base.roles[0].rolsuper = true;
    if (change === "object") s.objects.push({ kind: "table", name: table });
    await assert.rejects(assertFailedBirthInstallPrestateV4(await f.read(s)));
  }
  assert.match(FAILED_BIRTH_INSTALL_READ_SQL_V4.environment, /'pending','running','retry_wait'/); assert.doesNotMatch(FAILED_BIRTH_INSTALL_READ_SQL_V4.environment, /'queued'/);
});
test("wrong approval, expiry and code drift refuse before transaction or slot", async () => {
  for (const kind of ["wrong", "expired", "code"]) { const f = await fixture(); if (kind === "wrong") f.input.approvedSha = "f".repeat(64); if (kind === "expired") f.expire();
    if (kind === "code") f.input.verifyCode = async () => { throw Error("code drift"); };
    await assert.rejects(runReviewedFailedBirthInstallationV4(f.input)); assert.equal(f.calls.length, 0); assert.equal(f.consumed(), 0); }
});
test("fresh prestate drift or occupied permanent slot rolls back without DDL", async () => {
  for (const kind of ["drift", "slot"]) { const f = await fixture(); if (kind === "drift") f.drift(); else f.input.claimPermanentSlot = async () => { throw Error("occupied"); };
    const r = await runReviewedFailedBirthInstallationV4(f.input); assert.equal(r.commitConfirmed, false); assert.equal(r.ddlAttempted, false); assert.equal(r.slotConsumed, false);
    assert.equal(f.calls.at(-1), "ROLLBACK"); assert.equal(f.calls.includes(schema), false); }
});
test("schema or grant error is one attempt and a pre-commit transaction rollback, never slot reset or retry", async () => {
  for (const sql of [schema, grants]) { const f = await fixture(); f.failAt(sql); const r = await runReviewedFailedBirthInstallationV4(f.input);
    assert.equal(r.slotConsumed, true); assert.equal(r.commitConfirmed, false); assert.equal(r.retryAuthorized, false); assert.equal(f.consumed(), 1);
    assert.equal(f.calls.filter(x => x === sql).length, 1); assert.equal(f.calls.at(-1), "ROLLBACK"); assert.equal(f.calls.includes("COMMIT"), false); assert.doesNotMatch(JSON.stringify(r), /private provider/); }
});
test("single atomic installation commits after exact catalog and role delta verification", async () => {
  const f = await fixture(), r = await runReviewedFailedBirthInstallationV4(f.input); assert.equal(r.commitConfirmed, true); assert.equal(f.consumed(), 1);
  assert.equal(f.calls.filter(x => x === schema).length, 1); assert.equal(f.calls.filter(x => x === grants).length, 1); assert.equal(f.calls.at(-1), "COMMIT");
  assert.ok(f.calls.indexOf(schema) < f.calls.indexOf(grants)); assert.ok(f.calls.some(x => x.includes("ACCESS EXCLUSIVE")));
  const p = await verifyFailedBirthInstallPoststateV4(await f.read(f.after), f.state, schema); assert.equal(p.actualRestrictedRuntimeProofProduced, false);
});
test("catalog acceptance rejects extra privileges, changed bodies, disabled triggers and business drift", async () => {
  const f = await fixture(); for (const kind of ["permission", "body", "trigger", "business", "row"]) { const a = structuredClone(f.after);
    if (kind === "permission") (a.base.roles[0].table_privileges as string[]).push("public.deployment_jobs:UPDATE");
    if (kind === "body") (a.objects.find(x => x.kind === "function")!.properties as Row).bodySha256 = "f".repeat(64);
    if (kind === "trigger") (a.objects.find(x => x.kind === "trigger")!.properties as Row).enabled = "O";
    if (kind === "business") (a.environmentState.environment as Row).apply_enabled = 1;
    if (kind === "row") a.fenceRows = 1;
    await assert.rejects(verifyFailedBirthInstallPoststateV4(await f.read(a), f.state, schema)); }
});
test("lost COMMIT response preserves consumed slot and never sends rollback or another SQL submission", async () => {
  const f = await fixture(); f.failAt("COMMIT"); const r = await runReviewedFailedBirthInstallationV4(f.input);
  assert.equal(r.outcome, "COMMIT_UNKNOWN_READONLY_INSPECT_ONLY"); assert.equal(r.commitAttempted, true); assert.equal(r.slotConsumed, true); assert.equal(f.calls.at(-1), "COMMIT");
  assert.equal(f.calls.includes("ROLLBACK"), false); assert.equal(f.calls.filter(x => x === schema).length, 1);
  const cli = await readFile(new URL("../ops/aws-sandbox/scripts/review-failed-cell-birth-installation-v4.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /GetSecretValueCommand|InvokeCommand|SET ROLE|rmSync|unlink|--mode Run.*exec/); assert.match(cli, /flag: "wx", flush: true/);
  assert.match(cli, /SERIALIZABLE READ ONLY DEFERRABLE/); assert.match(canonicalJson(f.review.risks), /commitUnknownRequiresReadOnlyInspect/);
});
