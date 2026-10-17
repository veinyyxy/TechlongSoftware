// LOCAL read-only installation inventory, deliberately outside the cloud closure.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import * as iam from '@aws-sdk/client-iam';
import { DynamoDBClient, DescribeTableCommand, DescribeTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { assertCloudIamLayoutV5 } from '../cloud-aws-reads-v5.mjs';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
export const INSTALL_CANDIDATE_V5 = Object.freeze({ role: 'TechlongSandboxGitHubDeploymentWorkerRole',
  boundary: 'arn:aws:iam::402010193138:policy/TechlongSandboxGitHubDeploymentWorkerBoundaryV5',
  oidc: 'arn:aws:iam::402010193138:oidc-provider/token.actions.githubusercontent.com',
  table: 'techlong-sandbox-deployment-worker-journal-v1', bucket: 'techlong-sandbox-cloud-worker-evidence-402010193138',
  secrets: ['techlong/sandbox/deployment-worker/neon-control-v1','techlong/sandbox/deployment-worker/control-first-acceptance-v1'],
  schema: 'techlong_cloud_worker_v5', roleDb: 'techlong_cloud_worker_v5' });
const C = INSTALL_CANDIDATE_V5;
const must = (ok, message) => { if (!ok) throw Error(message); };
const allowed = new Set(['GetCallerIdentityCommand','GetRoleCommand','GetPolicyCommand','GetPolicyVersionCommand','ListRolePoliciesCommand',
  'ListAttachedRolePoliciesCommand','GetRolePolicyCommand','GetOpenIDConnectProviderCommand','ListRolesCommand','DescribeTableCommand',
  'DescribeTimeToLiveCommand','DescribeSecretCommand','HeadBucketCommand','DescribeStacksCommand','ListStackResourcesCommand']);
export const NEON_INSTALL_INVENTORY_SQL_V5 = `SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,
  current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only,
  (SELECT jsonb_build_object('oid',r.oid::text,'name',r.rolname,'createRole',r.rolcreaterole,'superuser',r.rolsuper) FROM pg_roles r WHERE r.rolname=current_user) AS installer,
  (SELECT jsonb_build_object('oid',r.oid::text,'login',r.rolcanlogin,'inherit',r.rolinherit,'superuser',r.rolsuper,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb)
    FROM pg_roles r WHERE r.rolname='techlong_cloud_worker_v5') AS candidate_role,
  (SELECT jsonb_build_object('oid',n.oid::text,'owner',n.nspowner::text,'acl',n.nspacl) FROM pg_namespace n WHERE n.nspname='techlong_cloud_worker_v5') AS candidate_schema,
  (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',n.nspowner::text,'acl',n.nspacl)) FROM pg_namespace n WHERE n.nspname='public') AS public_schema,
  exists(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
    WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='CREATE') AS public_database_create,
  (SELECT coalesce(jsonb_agg(n.nspname),'[]'::jsonb) FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
    exists(SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0 AND a.privilege_type='CREATE')) AS public_create_schemas,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'privilege',a.privilege_type)), '[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') AND a.grantee=0) AS public_relation_grants,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',col.attname,'privilege',a.privilege_type)), '[]'::jsonb)
    FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
    WHERE n.nspname='public' AND a.grantee=0 AND col.attnum>0 AND NOT col.attisdropped) AS public_column_grants,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'oid',p.oid::text,'owner',p.proowner::text,
    'config',p.proconfig,'identity',pg_get_function_identity_arguments(p.oid),'publicExecutable',exists(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS definers,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('owner',d.defaclrole::text,'namespace',d.defaclnamespace::text,'type',d.defaclobjtype,'acl',d.defaclacl)), '[]'::jsonb) FROM pg_default_acl d) AS default_acl,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl)), '[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN
    ('users','deployment_environments','workspaces','subscriptions','app_instances','app_instance_template_versions','app_instance_deployments','deployment_jobs','deployment_tenant_resources','deployment_tenant_external_operations')) AS target_tables,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'functionSchema',n.nspname,'function',p.proname)), '[]'::jsonb)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE cn.nspname='public' AND NOT t.tgisinternal AND c.relname IN
    ('deployment_jobs','app_instance_deployments')) AS write_table_triggers`;
export async function readNeonInstallInventoryV5() {
  const config = parseEnv(await readFile(new URL('../../../.env.local', import.meta.url), 'utf8')), url = new URL(config.DATABASE_URL);
  must(['postgres:','postgresql:'].includes(url.protocol) && url.hostname.endsWith('.neon.tech') && !!url.password &&
    ['require','verify-full'].includes(url.searchParams.get('sslmode')), 'FIXED_NEON_TLS_REQUIRED');
  const sql = neon(config.DATABASE_URL, { fullResults: true });
  const [r] = await sql.transaction(tx => [tx.query(NEON_INSTALL_INVENTORY_SQL_V5, [])], {
    isolationLevel: 'RepeatableRead', readOnly: true, fetchOptions: { signal: AbortSignal.timeout(30000) } });
  must(r.rowCount === 1 && r.rows[0].read_only === 'on', 'READ_ONLY_CATALOG_REQUIRED');
  return { state: 'READ', observedAt: Date.now(), targetFingerprintSha256: await sha256Hex({ host: url.hostname, port: 5432,
    database: url.pathname.slice(1), role: decodeURIComponent(url.username), transport: 'NeonHTTPS' }), catalog: r.rows[0],
  databaseWriteTransactions: 0, businessRowsRead: 0, secretValueReads: 0 };
}
export async function readAwsInstallInventoryV5() {
  const cfg = { region: 'ca-central-1', ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }, credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', ignoreCache: true, clientConfig: cfg });
  const clients = { sts: new STSClient({ ...cfg, credentials }), iam: new iam.IAMClient({ ...cfg, region: 'us-east-1', credentials }),
    ddb: new DynamoDBClient({ ...cfg, credentials }), sm: new SecretsManagerClient({ ...cfg, credentials }),
    s3: new S3Client({ ...cfg, credentials }), cfn: new CloudFormationClient({ ...cfg, credentials }) };
  let reads = 0;
  const send = (c, q) => { must(allowed.has(q.constructor.name) && ++reads <= 100, 'READ_ONLY_CALL_BUDGET'); return c.send(q, { abortSignal: AbortSignal.timeout(20000) }); };
  async function read(c, q, missing = []) {
    try { return { state: 'READ', value: await send(c, q) }; }
    catch(e) { return { state: missing.includes(e.name) ? 'ABSENT_AT_CHECK' : 'UNKNOWN_NOT_ABSENT', error: String(e.name ?? 'UNAVAILABLE') }; }
  }
  const clean = value => JSON.parse(JSON.stringify(value, (key, v) => key === '$metadata' ? undefined : v));
  try {
    const who = await send(clients.sts, new GetCallerIdentityCommand({}));
    must(who.Account === '402010193138' && who.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' && who.UserId === 'AIDAV3GNMXTZEO7SHLC2X', 'SOURCE_IDENTITY_REQUIRED');
    const capsule = JSON.parse(await readFile(new URL('../material/public-capsule-v5.json', import.meta.url), 'utf8'));
    const result = { schema: 'techlong/cloud-worker-aws-install-inventory/v5', observedAt: Date.now(), source: who,
      oidc: await read(clients.iam, new iam.GetOpenIDConnectProviderCommand({ OpenIDConnectProviderArn: C.oidc }), ['NoSuchEntityException']),
      workerRole: await read(clients.iam, new iam.GetRoleCommand({ RoleName: C.role }), ['NoSuchEntityException']),
      boundary: await read(clients.iam, new iam.GetPolicyCommand({ PolicyArn: C.boundary }), ['NoSuchEntityException']),
      journal: await read(clients.ddb, new DescribeTableCommand({ TableName: C.table }), ['ResourceNotFoundException']),
      evidenceBucket: await read(clients.s3, new HeadBucketCommand({ Bucket: C.bucket, ExpectedBucketOwner: '402010193138' }), ['NotFound','NoSuchBucket']),
      secrets: {}, preservedIam: null, oidcRoleReferences: [], namespace: {}, writes: 0, secretValuesRead: 0 };
    if (result.journal.state === 'READ') result.journal.ttl = await read(clients.ddb, new DescribeTimeToLiveCommand({ TableName: C.table }));
    for (const name of C.secrets) result.secrets[name] = await read(clients.sm, new DescribeSecretCommand({ SecretId: name }), ['ResourceNotFoundException']);
    try { result.preservedIam = await assertCloudIamLayoutV5({ api: { iam: clients.iam }, historicalPreflight: capsule.base.iam, send }); }
    catch { result.preservedIam = { state: 'UNKNOWN_OR_DRIFT_NO_MUTATION' }; }
    const roles = await read(clients.iam, new iam.ListRolesCommand({ MaxItems: 100 }));
    if (roles.state === 'READ' && !roles.value.IsTruncated) {
      result.oidcRoleReferences = roles.value.Roles.filter(r => decodeURIComponent(r.AssumeRolePolicyDocument ?? '').includes('token.actions.githubusercontent.com'))
        .map(r => ({ name: r.RoleName, id: r.RoleId, arn: r.Arn, trust: JSON.parse(decodeURIComponent(r.AssumeRolePolicyDocument)) }));
      result.oidcRoleReferenceScanComplete = true;
    } else { result.oidcRoleReferenceScanComplete = false; }
    for (const [label, id] of [['cell',capsule.base.compute.stackId],['predecessor',capsule.base.predecessorStackId],['namespace','techlong-sandbox-tenant-9c5ee9e64509dcad']]) {
      const got = await read(clients.cfn, new DescribeStacksCommand({ StackName: id }));
      result.namespace[label] = got.state === 'READ' ? { state: 'READ', stacks: got.value.Stacks?.map(s => ({ id: s.StackId, status: s.StackStatus,
        resources: undefined, expiresAt: s.Tags?.find(t => t.Key === 'ExpiresAt')?.Value })) } : got;
      if (label === 'predecessor' && got.state === 'READ') {
        const resources = await read(clients.cfn, new ListStackResourcesCommand({ StackName: id }));
        result.namespace[label].resources = resources.state === 'READ' ? { nextToken: resources.value.NextToken ?? null,
          items: resources.value.StackResourceSummaries?.map(r => ({ logical: r.LogicalResourceId, type: r.ResourceType, status: r.ResourceStatus })) } : resources;
      }
    }
    result.completedReadCalls = reads; result.finishedAt = Date.now(); return clean(result);
  } finally { Object.values(clients).forEach(c => c.destroy()); }
}
export async function mainInventoryV5(args = process.argv.slice(2)) {
  must(args.length === 2 && args[0] === '--output', 'READ_ONLY_OUTPUT_ARGUMENT');
  const out = path.resolve(args[1]), parent = path.resolve('F:/ChatGPT_workshop');
  must(path.dirname(out).toLowerCase() === parent.toLowerCase() && /^techlong-w5d-inventory-[a-z0-9-]+$/.test(path.basename(out)), 'EXACT_FRESH_OUTPUT_REQUIRED');
  await mkdir(out); // no recursive creation, no existing slot overwrite
  const result = { schema: 'techlong/cloud-worker-install-inventory/v5', startedAt: Date.now() };
  for (const [name, read] of [['aws',readAwsInstallInventoryV5],['neon',readNeonInstallInventoryV5]]) {
    try { result[name] = await read(); } catch { result[name] = { state: 'UNAVAILABLE', writes: 0, secretValueReads: 0 }; }
    await writeFile(path.join(out, name + '.json'), JSON.stringify(result[name], null, 2) + '\n', { flag: 'wx', flush: true });
  }
  result.finishedAt = Date.now(); result.externalWrites = 0; result.privateSourceBundleReads = 0;
  await writeFile(path.join(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', flush: true });
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mainInventoryV5().catch(() => {
  console.error('INSTALL_INVENTORY_FAILED_NO_WRITES'); process.exitCode = 1;
});
