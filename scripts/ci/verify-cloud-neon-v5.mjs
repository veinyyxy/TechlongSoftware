// Real PostgreSQL capability proof, ONLY in an owned GitHub service container.
import assert from 'node:assert/strict';
import pg from 'pg';
import { cloudRootFixtureV5 } from '../../tests/fixtures/cloud-worker-root-v5.mjs';
import { admitPlatformJobV4 } from '../../ops/aws-sandbox/scripts/express-platform-worker-v4.mjs';
import { compilePlatformInitializedClaimV4 as claim, compilePlatformInitializedLeaseCheckV4 as lease,
  compilePlatformInitializedCompleteV4 as complete } from '../../lib/deployments/execution/express-platform-claim-v4.ts';
import { loadNeonContractV5, renderNeonContractV5, packNeonProgramV5, NEON_V5 } from '../../ops/cloud-worker/neon-contract-v5.mjs';
import { verifyNeonCatalogV5, NEON_CATALOG_SQL_V5 } from '../../ops/cloud-worker/neon-persistence-v5.mjs';
import { canonicalJson } from '../../lib/deployments/execution/hash.ts';
const port = Number(process.env.CLOUD_NEON_CI_PORT), password = 'cloud-worker-ci-only-bootstrap';
assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const base = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' }, dbName = 'cloud_worker_v5_ci';
const admin = new pg.Client(base); await admin.connect();
assert.match((await admin.query('SELECT version() AS v')).rows[0].v, /PostgreSQL 18\.6/);
assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])).rowCount, 0);
assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [NEON_V5.role])).rowCount, 0);
let db, worker, dbCreated = false, roleCreated = false;
const checks = [], check = (name, value = true) => { assert.equal(value, true); checks.push(name); };
try {
  await admin.query(`CREATE DATABASE ${dbName}`); dbCreated = true;
  await admin.query(`CREATE ROLE ${NEON_V5.role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'cloud-worker-ci-fixture'`); roleCreated = true;
  db = new pg.Client({ ...base, database: dbName }); await db.connect();
  const f = await cloudRootFixtureV5(), snap = f.observed.snapshot;
  const union = [...new Set(f.observed.jobs.flatMap(r => Object.keys(r)))];
  f.observed.jobs = f.observed.jobs.map(r => Object.fromEntries(union.map(k => [k, r[k] ?? null])));
  f.observed.job = f.observed.jobs.find(r => r.id === f.observed.job.id);
  snap.predecessorJob = f.observed.jobs.find(r => r.id === snap.predecessorJob.id);
  const tables = { deployment_environments: [snap.environment], workspaces: [snap.workspace], subscriptions: [snap.subscription],
    app_instances: [snap.app], app_instance_template_versions: [snap.templateVersion], app_instance_deployments: [snap.deployment],
    deployment_tenant_resources: [snap.resource], deployment_tenant_external_operations: [snap.operation], deployment_jobs: f.observed.jobs,
    users: [{ ...f.observed.requester, password_hash: 'fixture-never-returned' }] };
  for (const [table, rows] of Object.entries(tables)) {
    const columns = Object.keys(rows[0]);
    const type = k => rows.some(r => typeof r[k] === 'number') || /(?:_at|_epoch)$/.test(k) ? 'bigint' : 'text';
    await db.query(`CREATE TABLE public.${table} (${columns.map(k => `"${k}" ${type(k)}`).join(',')})`);
    for (const row of rows) await db.query(`INSERT INTO public.${table} (${columns.map(k => `"${k}"`).join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`, columns.map(k => row[k]));
  }
  const contract = await loadNeonContractV5(), rendered = renderNeonContractV5(contract);
  await db.query('BEGIN');
  for (const sql of rendered.statements) await db.query(sql);
  await db.query('COMMIT');
  worker = new pg.Client({ ...base, database: dbName, user: NEON_V5.role, password: 'cloud-worker-ci-fixture' }); await worker.connect();
  const catalog = (await worker.query(NEON_CATALOG_SQL_V5)).rows[0];
  const expected = { roleOid: String(catalog.role.oid), ownerOid: catalog.schema.owner,
    functionOids: Object.fromEntries(catalog.functions.map(f => [f.name, f.oid])) };
  await verifyNeonCatalogV5(catalog, contract, expected); check('exact owner/source/ACL/OIDs and no inherited or base-table rights');
  const denied = async (sql, values = []) => { await assert.rejects(worker.query(sql, values)); };
  await denied('SELECT * FROM public.users'); await denied('SELECT * FROM public.deployment_jobs');
  await denied("UPDATE public.app_instance_deployments SET status='broken'");
  await denied('CREATE TABLE public.worker_escape(id text)');
  await denied(`CREATE FUNCTION ${NEON_V5.schema}.escape() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
  await denied(`SELECT ${NEON_V5.schema}.read_state($1)`, ['job_ffffffffffffffffffffffff']);
  check('password/table reads, generic writes, schema CREATE and unrelated job rejected');
  const observed = (await worker.query(`SELECT ${NEON_V5.schema}.read_state($1) AS r`, [f.observed.job.id])).rows[0].r;
  assert.deepEqual(observed.snapshot, snap); assert.deepEqual(observed.requester, f.observed.requester);
  assert.equal(canonicalJson(observed).includes('fixture-never-returned'), false); check('fixed-scope read returns only safe requester projection');
  const admission = await admitPlatformJobV4({ root: f.context.root, observed, predecessor: f.context.predecessor, now: Date.now() });
  const plan = admission.jobPlan, queuedJob = observed.job;
  const cp = await claim({ plan, queuedJob, leaseToken: f.lease.leaseToken, approvedPlanSha256: plan.planSha256 });
  const invoke = async (op, args, readOnly = false) => {
    await worker.query('BEGIN ISOLATION LEVEL SERIALIZABLE' + (readOnly ? ' READ ONLY' : ''));
    try { const result = (await worker.query(`SELECT ${NEON_V5.schema}.${op}($1::jsonb) AS r`, [JSON.stringify(args)])).rows[0].r;
      await worker.query('COMMIT'); return result; }
    catch (e) { await worker.query('ROLLBACK'); throw e; }
  };
  const claimArgs = packNeonProgramV5(contract, 'claim', cp), foreign = structuredClone(claimArgs);
  const foreignDep = JSON.parse(foreign[0][5]); foreignDep.id = 'dep_foreign'; foreign[0][5] = canonicalJson(foreignDep);
  await assert.rejects(invoke('claim', foreign));
  const injection = structuredClone(claimArgs); injection[3][1] = "dep_foreign'; UPDATE public.users SET status='active';--";
  await assert.rejects(invoke('claim', injection)); check('server rejects cross-scope and SQL-shaped argument bypass');
  const claimed = await invoke('claim', claimArgs); assert.equal(claimed.at(-1).accepted, 1);
  await assert.rejects(invoke('claim', claimArgs)); check('same held job claimed once; replay rejected');
  const lp = await lease(plan, queuedJob, cp.lease);
  await invoke('lease', packNeonProgramV5(contract, 'lease', lp), true); check('lease checks work in read-only serializable transaction');
  const now = Date.now(), proof = { ...f.proof, jobId: plan.jobId, providerCheckedAt: now, authorityCheckedAt: now, controlCheckedAt: now };
  const done = await complete({ plan, queuedJob, lease: cp.lease, proof, now });
  const completeArgs = packNeonProgramV5(contract, 'complete', done);
  const overwritten = structuredClone(completeArgs), badOutputs = JSON.parse(overwritten[2][1]); badOutputs.fixtureOnly = 'overwritten'; overwritten[2][1] = canonicalJson(badOutputs);
  await assert.rejects(invoke('complete', overwritten)); check('old outputs/history cannot be overwritten');
  // Force the *last* statement to fail AFTER the deployment output UPDATE.
  await db.query(`CREATE FUNCTION public.ci_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
    IF NEW.status='succeeded' THEN RAISE EXCEPTION 'CI forced final-row failure'; END IF; RETURN NEW; END$$`);
  await db.query('CREATE TRIGGER ci_fail_completion BEFORE UPDATE ON public.deployment_jobs FOR EACH ROW EXECUTE FUNCTION public.ci_fail_completion()');
  await assert.rejects(invoke('complete', completeArgs));
  const afterFailure = (await db.query('SELECT outputs FROM public.app_instance_deployments')).rows[0];
  assert.equal(afterFailure.outputs, snap.deployment.outputs); check('last-row failure rolls back prior deployment output write');
  await db.query('DROP TRIGGER ci_fail_completion ON public.deployment_jobs');
  await invoke('complete', completeArgs); check('one atomic two-row completion succeeds');
  const after = (await worker.query(`SELECT ${NEON_V5.schema}.read_state($1) AS r`, [plan.jobId])).rows[0].r;
  assert.equal(after.job.status, 'succeeded'); assert.equal(after.job.lease_token, null);
  assert.equal(after.snapshot.deployment.ready_at, snap.deployment.ready_at);
  for (const key of Object.keys(snap)) if (key !== 'deployment') assert.deepEqual(after.snapshot[key], snap[key]);
  for (const old of observed.jobs.filter(j => j.id !== plan.jobId)) assert.deepEqual(after.jobs.find(j => j.id === old.id), old);
  assert.equal(after.snapshot.deployment.outputs, done.outputs); check('ready_at, original nine rows, successful jobs and receipt history preserved');
  await assert.rejects(invoke('complete', completeArgs)); check('completion replay rejected');
  console.log(JSON.stringify({ schema: 'techlong/cloud-worker-neon-pg18-proof/v5', outcome: 'PASSED',
    contractSha256: contract.contractSha256, checks, checkCount: checks.length, realPostgres: true, productionNeonUsed: false,
    productionPermissionsInstalled: false, awsCalls: 0, privateMaterialReads: 0 }, null, 2));
} finally {
  await worker?.end(); await db?.end();
  // These exact names were proven absent and created by this process above.
  if (dbCreated) await admin.query(`DROP DATABASE ${dbName}`);
  if (roleCreated) await admin.query(`DROP ROLE ${NEON_V5.role}`);
  await admin.end();
}
