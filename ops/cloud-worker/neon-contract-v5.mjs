// Candidate SQL only: rendering never connects to or installs into Neon.
import { readFile } from 'node:fs/promises';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../../lib/deployments/initialized-platform-request-v1.ts';
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
export const NEON_V5 = Object.freeze({ schema: 'techlong_cloud_worker_v5', role: 'techlong_cloud_worker_v5',
  originalJobId: 'job_202c8dc12a8bf379f3a7c693', templateId: 'tplver_9c175436f0a14d9aa7f5fdfc2b5c139e' });
const literal = v => "'" + String(v).replaceAll("'", "''") + "'";
const value = (i, j, type = 'text') => `(p_args->${i}->>${j})::${type}`;
export async function loadNeonContractV5() {
  const programs = JSON.parse(await readFile(new URL('./material/neon-programs-v5.json', import.meta.url), 'utf8'));
  return Object.freeze({ programs, contractSha256: await sha256Hex(programs) });
}
export function packNeonProgramV5(contract, operation, program) {
  const template = contract.programs[operation];
  must(template?.length === program.statements.length && template.every((q, i) => q.key === program.statements[i].key &&
    q.text === program.statements[i].text && q.types.length === program.statements[i].values.length &&
    q.types.every((t, j) => t === 'bigint' ? Number.isSafeInteger(program.statements[i].values[j]) : typeof program.statements[i].values[j] === 'string')),
  'STATIC_NEON_PROGRAM_MISMATCH');
  return program.statements.map(q => [...q.values]); // values only, NEVER caller-supplied SQL
}
const requireSql = condition => `IF (${condition}) IS NOT TRUE THEN RAISE EXCEPTION 'CLOUD_WORKER_SCOPE_REJECTED' USING ERRCODE='42501'; END IF;`;
function guardSql(operation, templates) {
  const q = i => `(p_args->0->>${i})::jsonb`, v = (i, j) => value(i, j);
  const snapshot = [
    `${q(0)}->>'id'=${literal(S.environmentId)}`, `${q(1)}->>'id'=${literal(S.workspaceId)}`,
    `${q(2)}->>'workspace_id'=${literal(S.workspaceId)}`, `${q(2)}->>'product_id'=${literal(S.productId)}`,
    `${q(3)}->>'id'=${literal(S.appInstanceId)}`, `${q(3)}->>'workspace_id'=${literal(S.workspaceId)}`,
    `${q(3)}->>'subscription_id'=${q(2)}->>'id'`, `${q(4)}->>'id'=${literal(NEON_V5.templateId)}`,
    `${q(5)}->>'id'=${literal(S.deploymentId)}`, `${q(5)}->>'app_instance_id'=${literal(S.appInstanceId)}`,
    `${q(5)}->>'environment_id'=${literal(S.environmentId)}`, `${q(5)}->>'subscription_id'=${q(2)}->>'id'`,
    `${q(6)}->>'id'=${literal(NEON_V5.originalJobId)}`, `${q(6)}->>'deployment_id'=${literal(S.deploymentId)}`,
    ...[7, 8].flatMap(i => [`${q(i)}->>'app_instance_id'=${literal(S.appInstanceId)}`, `${q(i)}->>'owner_deployment_id'=${literal(S.deploymentId)}`]),
    `${q(8)}->>'epoch'='1'`, `${q(8)}->>'operation_hash'=${literal(S.operationHash)}`,
  ];
  let sql = requireSql(`jsonb_typeof(p_args)='array' AND jsonb_array_length(p_args)=${templates.length} AND octet_length(p_args::text)<=250000`);
  templates.forEach((t, i) => { sql += requireSql(`jsonb_typeof(p_args->${i})='array' AND jsonb_array_length(p_args->${i})=${t.types.length}`); });
  sql += requireSql(snapshot.join(' AND '));
  sql += `\njob_id := ${v(1, 0)}; deadline := ${value(0, 9, 'bigint')};\n`;
  sql += requireSql(`job_id ~ '^job_[a-f0-9]{24}$' AND job_id<>${literal(NEON_V5.originalJobId)} AND
    current_setting('transaction_isolation')='serializable' AND deadline>(extract(epoch FROM clock_timestamp())*1000)::bigint AND
    deadline-(extract(epoch FROM clock_timestamp())*1000)::bigint<=3600000`);
  if (operation === 'claim') {
    sql += `held := (${v(1, 1)})::jsonb; running := (${v(3, 2)})::jsonb; request := (held->>'payload')::jsonb;\n`;
    sql += requireSql(`held->>'id'=job_id AND held->>'deployment_id'=${literal(S.deploymentId)} AND held->>'job_type'='reconcile' AND
      held->>'status'='pending' AND held->>'attempts'='0' AND held->>'max_attempts'='1' AND held->>'available_at'='9007199254740991' AND
      held->'lease_token'='null'::jsonb AND held->'lease_owner'='null'::jsonb AND held->'lease_expires_at'='null'::jsonb AND held->'completed_at'='null'::jsonb AND
      ${v(1, 2)}=request->>'requestedByUserId' AND ${v(2, 0)}=${literal(S.deploymentId)} AND ${v(2, 1)}=job_id AND
      ${v(3, 0)}=job_id AND ${v(3, 1)}=${literal(S.deploymentId)} AND ${v(3, 3)}='express-initialized-single-job-v2' AND
      ${v(3, 4)} ~ '^lease_[a-f0-9]{32}$' AND ${value(3, 5, 'bigint')}=1200000 AND ${value(3, 6, 'bigint')}=deadline AND
      ${value(3, 7, 'bigint')}=9007199254740991 AND ${v(3, 8)}=${v(2, 2)} AND ${v(3, 9)}=${v(2, 3)} AND
      ${value(2, 4, 'bigint')}=deadline AND ${value(2, 3, 'bigint')}-${value(2, 2, 'bigint')}=900000 AND
      deadline-${value(2, 2, 'bigint')}=3600000 AND running->'platformRequest'=request`);
  } else {
    sql += `running := (${v(1, 4)})::jsonb; request := running->'platformRequest';\n`;
    sql += requireSql(`${v(1, 1)}=${literal(S.deploymentId)} AND ${v(1, 2)}='express-initialized-single-job-v2' AND
      ${v(1, 3)} ~ '^lease_[a-f0-9]{32}$' AND ${v(1, 5)}='express-initialized-v2:'||(request->>'requestId') AND ${value(1, 6, 'bigint')}=deadline`);
  }
  sql += requireSql(`request->>'kind'='express_initialized_request_v4' AND request->>'requestId' ~ '^[a-f0-9]{64}$' AND
    request->'scope'=${literal(canonicalJson(S))}::jsonb AND request->'reviewRequired'='true'::jsonb AND request->'cloudExecutionAuthorized'='false'::jsonb AND
    running->>'kind'='express_initialized_workload_v2' AND running->>'materialSha256'=${literal(S.materialSha256)} AND
    running->>'planSha256' ~ '^[a-f0-9]{64}$' AND running->>'requestId'=request->>'requestId' AND running->'initializationPostAllowed'='false'::jsonb`);
  if (operation === 'claim') sql += requireSql(`held->>'dedupe_key'='express-initialized-v2:'||(request->>'requestId')`);
  if (operation === 'complete') {
    sql += `old_outputs := (${q(5)}->>'outputs')::jsonb; new_outputs := (${v(2, 1)})::jsonb;
      receipt := new_outputs->'expressInitializedWorkerRunsV2'->job_id;\n`;
    sql += requireSql(`${v(2, 0)}=${literal(S.deploymentId)} AND ${v(3, 0)}=job_id AND ${v(3, 1)}=${literal(S.deploymentId)} AND
      ${v(3, 2)}=${v(1, 2)} AND ${v(3, 3)}=${v(1, 3)} AND ${value(3, 4, 'bigint')}=deadline AND
      ${v(3, 5)}=${v(2, 3)} AND ${value(2, 3, 'bigint')}=(receipt->>'workloadExpiresAt')::bigint AND
      octet_length(new_outputs::text)<=32768 AND jsonb_typeof(new_outputs->'expressInitializedWorkerRunsV2')='object' AND
      NOT (coalesce(old_outputs->'expressInitializedWorkerRunsV2','{}'::jsonb) ? job_id) AND
      new_outputs-'expressInitializedWorkerRunsV2'=old_outputs-'expressInitializedWorkerRunsV2' AND
      (new_outputs->'expressInitializedWorkerRunsV2')-job_id=coalesce(old_outputs->'expressInitializedWorkerRunsV2','{}'::jsonb) AND
      receipt->>'jobId'=job_id AND receipt->>'jobPlanSha256'=running->>'planSha256' AND receipt->>'materialSha256'=${literal(S.materialSha256)} AND
      receipt->>'completedBy'='express-initialized-single-job-v2' AND receipt->>'configurationHash'=${literal(S.configurationHash)} AND
      receipt->>'imageUri'=${literal(S.artifactRef)} AND receipt->>'existingDefaultStoreId'=${literal(S.existingDefaultStoreId)} AND
      receipt->>'epoch'='1' AND receipt->>'operationHash'=${literal(S.operationHash)} AND
      receipt->'initializedVerified'='true'::jsonb AND receipt->'effectiveConfigurationVerified'='true'::jsonb AND NOT (receipt ? 'leaseToken') AND
      receipt->>'stackId' ~ '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/[a-f0-9-]{36}$'`);
  }
  return sql;
}
function programBody(operation, templates) {
  let body = `DECLARE r record; result jsonb := '[]'::jsonb; held jsonb; running jsonb; request jsonb; job_id text; deadline bigint;
    old_outputs jsonb; new_outputs jsonb; receipt jsonb;\nBEGIN\n${guardSql(operation, templates)}\n`;
  templates.forEach((q, i) => {
    let sql = q.text.replace(/\$(\d+)/g, (_, n) => value(i, Number(n) - 1, q.types[Number(n) - 1]));
    // Keep data-modifying CTEs at top level, insert PL/pgSQL INTO only in the
    // outer result SELECT (not inside a subquery or the UPDATE RETURNING).
    if (q.key === 'claim_same_held_job_once') sql = sql.replace(' AS lease_expires_at FROM changed', ' AS lease_expires_at INTO STRICT r FROM changed');
    else if (sql.includes(' AS accepted FROM')) sql = sql.replace(' AS accepted FROM', ' AS accepted INTO STRICT r FROM');
    else { must(sql.endsWith(' AS accepted'), 'STATIC_SQL_RESULT_SHAPE'); sql += ' INTO STRICT r'; }
    body += `${sql};
      IF r.accepted<>1 THEN RAISE EXCEPTION 'CLOUD_WORKER_PROGRAM_REJECTED'; END IF;
      result := result || jsonb_build_array(to_jsonb(r));\n`;
  });
  return body + 'RETURN result;\nEND';
}
function readBody() {
  return `DECLARE result jsonb; actor text; p jsonb;
BEGIN
  IF p_job !~ '^job_[a-f0-9]{24}$' THEN RAISE EXCEPTION 'CLOUD_WORKER_SCOPE_REJECTED'; END IF;
  SELECT payload::jsonb INTO p FROM public.deployment_jobs WHERE id=p_job AND deployment_id=${literal(S.deploymentId)};
  actor := coalesce(p->>'requestedByUserId', p->'platformRequest'->>'requestedByUserId');
  IF actor IS NULL THEN RAISE EXCEPTION 'CLOUD_WORKER_REQUEST_NOT_FOUND'; END IF;
  SELECT jsonb_build_object('snapshot',jsonb_build_object('environment',to_jsonb(e),'workspace',to_jsonb(w),
    'subscription',to_jsonb(sub),'app',to_jsonb(a),'templateVersion',to_jsonb(t),'deployment',to_jsonb(d),
    'predecessorJob',to_jsonb(oldj),'resource',to_jsonb(r),'operation',to_jsonb(o)),
    'job',(SELECT to_jsonb(j) FROM public.deployment_jobs j WHERE j.id=p_job AND j.deployment_id=d.id),
    'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM public.deployment_jobs j WHERE j.deployment_id=d.id),
    'requester',(SELECT jsonb_build_object('id',u.id,'status',u.status,'is_platform_admin',u.is_platform_admin) FROM public.users u WHERE u.id=actor),
    'checkedAt',(extract(epoch FROM clock_timestamp())*1000)::bigint) INTO STRICT result
  FROM public.app_instance_deployments d JOIN public.app_instances a ON a.id=d.app_instance_id
  JOIN public.workspaces w ON w.id=a.workspace_id JOIN public.subscriptions sub ON sub.id=d.subscription_id
  JOIN public.deployment_environments e ON e.id=d.environment_id JOIN public.app_instance_template_versions t ON t.id=a.template_version_id
  JOIN public.deployment_jobs oldj ON oldj.id=${literal(NEON_V5.originalJobId)} AND oldj.deployment_id=d.id
  JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id AND r.generation=1
  JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=a.id AND o.generation=1 AND o.epoch=1
  WHERE d.id=${literal(S.deploymentId)} AND a.id=${literal(S.appInstanceId)} AND w.id=${literal(S.workspaceId)};
  RETURN result;
END`;
}
export function renderNeonContractV5(contract) {
  const functions = [{ name: 'read_state', argument: 'p_job text', identity: 'text', body: readBody(), readOnly: true },
    ...Object.entries(contract.programs).map(([name, templates]) => ({ name, argument: 'p_args jsonb', identity: 'jsonb', body: programBody(name, templates), readOnly: name === 'lease' }))];
  const schema = NEON_V5.schema, role = NEON_V5.role;
  const statements = [`CREATE SCHEMA ${schema}`, `REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`, `GRANT USAGE ON SCHEMA ${schema} TO ${role}`];
  for (const f of functions) {
    statements.push(`CREATE FUNCTION ${schema}.${f.name}(${f.argument}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog AS $worker$${f.body}$worker$`,
    `REVOKE ALL ON FUNCTION ${schema}.${f.name}(${f.identity}) FROM PUBLIC`, `GRANT EXECUTE ON FUNCTION ${schema}.${f.name}(${f.identity}) TO ${role}`);
  }
  return Object.freeze({ functions, statements, role, schema, automaticRetries: 0, installed: false });
}
