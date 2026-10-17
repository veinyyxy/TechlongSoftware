import { neon } from '@neondatabase/serverless';
import { compilePlatformInitializedClaimV4, compilePlatformInitializedLeaseCheckV4, compilePlatformInitializedCompleteV4,
  verifyPlatformInitializedCompletionReadbackV4 } from '../../lib/deployments/execution/express-platform-claim-v4.ts';
import { NEON_V5, packNeonProgramV5, renderNeonContractV5 } from './neon-contract-v5.mjs';
import { platformReadObservationV4 } from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';

// Catalog reads need no base-table grants. Unexpected inherited/PUBLIC rights
// fail closed: installation must resolve them explicitly, never auto-revoke.
export const NEON_CATALOG_SQL_V5 = `SELECT
  current_user AS current_user, session_user AS session_user, to_jsonb(r) - 'rolpassword' AS role,
  (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
  has_database_privilege(r.oid,current_database(),'CREATE') AS db_create,
  (SELECT coalesce(jsonb_agg(n.nspname),'[]'::jsonb) FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
    AND has_schema_privilege(r.oid,n.oid,'CREATE')) AS create_schemas,
  (SELECT coalesce(jsonb_agg(c.oid::text),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND
      (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
       has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS base_rights,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),
    'oid',p.oid::text,'owner',p.proowner::text,'source',p.prosrc,'securityDefiner',p.prosecdef,'config',p.proconfig,
    'language',l.lanname,'acl',p.proacl,'returnType',p.prorettype::regtype::text)),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='techlong_cloud_worker_v5') AS functions,
  (SELECT coalesce(jsonb_agg(p.oid::text),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema','techlong_cloud_worker_v5') AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS other_definers,
  (SELECT jsonb_build_object('owner',n.nspowner::text,'usage',has_schema_privilege(r.oid,n.oid,'USAGE'),
    'create',has_schema_privilege(r.oid,n.oid,'CREATE')) FROM pg_namespace n WHERE n.nspname='techlong_cloud_worker_v5') AS schema,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('function',p.proname,'grantee',a.grantee::text,'grantor',a.grantor::text,
    'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='techlong_cloud_worker_v5') AS function_acl
FROM pg_roles r WHERE r.rolname=current_user`;

export async function verifyNeonCatalogV5(row, contract, expected) {
  const r = row?.role, fs = renderNeonContractV5(contract).functions;
  must(expected && /^\d+$/.test(expected.roleOid) && /^\d+$/.test(expected.ownerOid) && expected.roleOid !== expected.ownerOid &&
    row.current_user === NEON_V5.role && row.session_user === NEON_V5.role && String(r?.oid) === expected.roleOid && r.rolcanlogin === true &&
    ['rolsuper','rolinherit','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls'].every(k => r[k] === false) &&
    row.memberships === 0 && row.db_create === false && row.create_schemas?.length === 0 && row.base_rights?.length === 0 &&
    row.other_definers?.length === 0 && row.schema?.owner === expected.ownerOid && row.schema.usage === true && row.schema.create === false &&
    row.functions?.length === fs.length, 'NEON_NARROW_ROLE_LAYOUT');
  for (const f of fs) {
    const p = row.functions.find(p => p.name === f.name);
    must(p && p.owner === expected.ownerOid && p.securityDefiner === true && p.language === 'plpgsql' && p.returnType === 'jsonb' &&
      canonicalJson(p.config) === canonicalJson(['search_path=pg_catalog']) && p.identity === f.argument && p.source === f.body &&
      p.oid === expected.functionOids[f.name], 'NEON_FUNCTION_SOURCE_OR_ID');
    const grants = row.function_acl.filter(a => a.function === f.name);
    must(grants.length === 2 && grants.every(a => a.privilege === 'EXECUTE' && a.grantor === expected.ownerOid &&
      (a.grantee === expected.ownerOid || a.grantee === expected.roleOid) && a.grantable === false), 'NEON_FUNCTION_ACL');
  }
  return { roleOid: expected.roleOid, ownerOid: expected.ownerOid, contractSha256: contract.contractSha256,
    catalogSha256: await sha256Hex(row), narrowRoleVerified: true };
}
export function createNeonRpcTransportV5(databaseUrl) {
  const sql = neon(databaseUrl, { fullResults: true });
  return Object.freeze({ async query(text, values, { signal, readOnly }) {
    signal.throwIfAborted();
    try {
      const [r] = await sql.transaction(tx => [tx.query(text, values)], { isolationLevel: 'Serializable', readOnly,
        fetchOptions: { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) } });
      must(r.rowCount === 1, 'NEON_RPC_ROW_COUNT'); return r.rows[0];
    } catch { throw Error('NEON_RPC_REQUIRES_INSPECT_NO_RETRY'); }
  } });
}
export function createNarrowNeonV5({ transport, contract, expected, now = Date.now }) {
  let verified = false, halted = false, writes = 0, reads = 0;
  async function query(text, values, signal, readOnly) {
    must(!halted, 'NEON_HALTED');
    try { const result = await transport.query(text, values, { signal, readOnly }); if (readOnly) reads++; else writes++; return result; }
    catch { halted = true; throw Error('NEON_RPC_REQUIRES_INSPECT_NO_RETRY'); }
  }
  async function read(jobId, signal) {
    must(verified && /^job_[a-f0-9]{24}$/.test(jobId), 'NEON_PREFLIGHT_OR_JOB'); const started = now();
    const { result } = await query(`SELECT ${NEON_V5.schema}.read_state($1::text) AS result`, [jobId], signal, true);
    return platformReadObservationV4(result, result, started, now());
  }
  async function execute(operation, program, signal) {
    must(verified, 'NEON_PREFLIGHT_REQUIRED');
    const values = packNeonProgramV5(contract, operation, program);
    const { result } = await query(`SELECT ${NEON_V5.schema}.${operation}($1::jsonb) AS result`, [canonicalJson(values)], signal, operation === 'lease');
    must(Array.isArray(result) && result.length === values.length && result.every(r => r.accepted === 1), 'NEON_PROGRAM_RESULT');
    return result;
  }
  return Object.freeze({
    async verify(signal) { must(!verified, 'NEON_VERIFY_ONCE');
      const row = await query(NEON_CATALOG_SQL_V5, [], signal, true);
      const proof = await verifyNeonCatalogV5(row, contract, expected); verified = true; return proof;
    }, read,
    bind(queuedJob) { const queued = structuredClone(queuedJob); return Object.freeze({
      async claim(input, signal) {
        const p = await compilePlatformInitializedClaimV4({ ...input, queuedJob: queued });
        const rows = await execute('claim', p, signal), expiry = Number(rows.at(-1).lease_expires_at);
        must(Number.isSafeInteger(expiry) && expiry <= input.plan.deadline, 'NEON_LEASE_EXPIRY');
        return { lease: p.lease, leaseExpiresAt: expiry, programSha256: p.programSha256 };
      },
      async assertLease(plan, lease, signal) {
        const p = await compilePlatformInitializedLeaseCheckV4(plan, queued, lease); await execute('lease', p, signal);
        return { accepted: true, programSha256: p.programSha256 };
      },
      async complete(input, signal) {
        const p = await compilePlatformInitializedCompleteV4({ ...input, queuedJob: queued }); await execute('complete', p, signal);
        const observed = await read(input.plan.jobId, signal);
        const result = await verifyPlatformInitializedCompletionReadbackV4({ ...input, queuedJob: queued,
          snapshot: observed.snapshot, job: observed.job, expectedOutputs: p.outputs });
        return { ...result, programSha256: p.programSha256, receiptSha256: p.receiptSha256, checkedAt: observed.checkedAt };
      },
    }); }, counts: () => ({ completedReads: reads, completedWriteTransactions: writes, automaticRetries: 0 }),
  });
}
