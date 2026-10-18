// Real owned PostgreSQL service proof. Neon forwarding is explicitly NOT real.
import assert from 'node:assert/strict';
import pg from 'pg';
import { cloudRootFixtureV5 } from '../../tests/fixtures/cloud-worker-root-v5.mjs';
import { neonRecoveryStatementsV5, safeRecoveryFailureV5 } from '../../ops/cloud-worker/install/neon-recovery-sql-v5.mjs';
import { NEON_CATALOG_SQL_V5, verifyNeonCatalogV5 } from '../../ops/cloud-worker/neon-persistence-v5.mjs';
import { loadNeonContractV5, NEON_V5 } from '../../ops/cloud-worker/neon-contract-v5.mjs';
const port = Number(process.env.CLOUD_NEON_CI_PORT), bootstrap = 'cloud-worker-ci-only-bootstrap';
assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const base = { host: '127.0.0.1', port, user: 'postgres', password: bootstrap, database: 'postgres' },
  dbName = 'cloud_worker_v5_recovery_ci', ownerName = 'cloud_worker_recovery_owner_ci', ownerPassword = 'cloud-worker-ci-only-owner',
  workerPassword = 'b'.repeat(96), checks = [], check = name => checks.push(name);
const admin = new pg.Client(base); await admin.connect(); let owner, worker, dbCreated = false, ownerCreated = false, workerAttempted = false;
assert.match((await admin.query('SELECT version() AS v')).rows[0].v, /PostgreSQL 18\.6/);
assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName])).rowCount, 0);
assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname IN ($1,$2)', [ownerName,NEON_V5.role])).rowCount, 0);
try {
  await admin.query(`CREATE ROLE ${ownerName} LOGIN CREATEROLE NOINHERIT NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD '${ownerPassword}'`); ownerCreated = true;
  await admin.query(`CREATE DATABASE ${dbName} OWNER ${ownerName}`); dbCreated = true;
  owner = new pg.Client({ ...base, user: ownerName, password: ownerPassword, database: dbName }); await owner.connect();
  const ownerState = (await owner.query('SELECT oid::text,rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.equal(ownerState.rolsuper, false); assert.equal(ownerState.rolcreaterole, true); check('actual installer fixture uses non-superuser CREATEROLE database owner');
  const f = await cloudRootFixtureV5(), s = f.observed.snapshot;
  const tables = { deployment_environments: s.environment, workspaces: s.workspace, subscriptions: s.subscription,
    app_instances: s.app, app_instance_template_versions: s.templateVersion, app_instance_deployments: s.deployment,
    deployment_jobs: f.observed.job, deployment_tenant_resources: s.resource, deployment_tenant_external_operations: s.operation,
    users: f.observed.requester };
  for (const [name, row] of Object.entries(tables)) {
    const keys = Object.keys(row); const type = k => typeof row[k] === 'number' || /(?:_at|_epoch)$/.test(k) ? 'bigint' : 'text';
    await owner.query(`CREATE TABLE public.${name} (${keys.map(k => `"${k}" ${type(k)}`).join(',')})`);
    await owner.query(`INSERT INTO public.${name} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`, keys.map(k => row[k]));
  }
  // Custom GUC only in this owned container. No Neon extension/control plane.
  await owner.query("SET neon.forward_ddl='off'");
  const statements = await neonRecoveryStatementsV5(workerPassword), run = async () => { for (const q of statements) await owner.query(q); };
  await owner.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await assert.rejects(run(), e => e.message === 'RECOVERY_NEON_PROVIDER_SETTINGS_REJECTED'); await owner.query('ROLLBACK');
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [NEON_V5.role])).rowCount, 0);
  check('provider-settings guard fails before role creation when forwarding flag is off (GUC mocked)');
  await owner.query("SET neon.forward_ddl='on'");
  await owner.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); workerAttempted = true; await run();
  await assert.rejects(owner.query('SELECT 1/0')); await owner.query('ROLLBACK');
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [NEON_V5.role])).rowCount, 0);
  assert.equal((await owner.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [NEON_V5.schema])).rowCount, 0);
  check('last-statement failure rolls back new role/schema/functions under non-superuser creator');
  await owner.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await owner.query('GRANT SELECT ON public.users TO PUBLIC');
  await assert.rejects(run(), e => e.message === 'CLOUD_WORKER_INSTALL_POSTCONDITION_REJECTED'); await owner.query('ROLLBACK');
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [NEON_V5.role])).rowCount, 0);
  check('unexpected inherited PUBLIC access rejects entire recovery transaction');
  await owner.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await run(); await owner.query('COMMIT');
  worker = new pg.Client({ ...base, database: dbName, user: NEON_V5.role, password: workerPassword }); await worker.connect();
  check('original-password SQL commits once and actual new password authenticates');
  const catalog = (await worker.query(NEON_CATALOG_SQL_V5)).rows[0], expected = { roleOid: String(catalog.role.oid), ownerOid: ownerState.oid,
    functionOids: Object.fromEntries(catalog.functions.map(fn => [fn.name, fn.oid])) };
  await verifyNeonCatalogV5(catalog, await loadNeonContractV5(), expected); check('four exact function sources/ACLs and no generic table/schema rights verified');
  const membership = (await owner.query('SELECT admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid=$1 AND member=$2',
    [expected.roleOid,expected.ownerOid])).rows;
  assert.deepEqual(membership, [{ admin_option: true, inherit_option: false, set_option: false }]);
  check('non-superuser creator automatic ADMIN has no SET/INHERIT; worker has no memberships');
  const wrong = new pg.Client({ ...base, database: dbName, user: NEON_V5.role, password: 'wrong-ci-only' });
  try { await assert.rejects(wrong.connect()); } finally { await wrong.end(); }
  check('wrong password rejected by actual PostgreSQL authentication');
  await assert.rejects(worker.query('SELECT * FROM public.users')); await assert.rejects(worker.query('CREATE TABLE public.escape(id text)'));
  check('dedicated role cannot read users or create generic tables');
  let failure;
  try { await worker.query("DO $$ BEGIN RAISE EXCEPTION 'FIXTURE_SENSITIVE_DIAGNOSTIC'; END $$"); }
  catch (e) { failure = safeRecoveryFailureV5(e); }
  assert.equal(failure.sqlState, 'P0001'); assert.equal(JSON.stringify(failure).includes('FIXTURE_SENSITIVE_DIAGNOSTIC'), false);
  check('actual SQLSTATE retained without raw provider diagnostic/query');
  console.log(JSON.stringify({ schema: 'techlong/cloud-worker-neon-recovery-pg18-proof/v5', outcome: 'PASSED', checks,
    checkCount: checks.length, realPostgres: true, nonSuperuserCreator: true, providerGucMocked: true,
    neonControlPlaneForwardingTested: false, productionNeonUsed: false, productionPermissionsInstalled: false,
    awsCalls: 0, originalPrivateFileReads: 0, actualNeonCalls: 0 }, null, 2));
} finally {
  await worker?.end(); await owner?.end();
  if (dbCreated) await admin.query(`DROP DATABASE ${dbName}`);
  if (workerAttempted && (await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [NEON_V5.role])).rowCount) await admin.query(`DROP ROLE ${NEON_V5.role}`);
  if (ownerCreated) await admin.query(`DROP ROLE ${ownerName}`);
  await admin.end();
}
