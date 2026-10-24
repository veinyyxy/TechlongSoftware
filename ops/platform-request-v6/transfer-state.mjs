// SELECT-only trusted reader. Explicit client/expected identity/SQL contract; no discovery.
import {INITIALIZED_PLATFORM_SCOPE as S,projectInitializedDeployment} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {CATALOG_SQL,TABLE_COLUMNS,ROLE} from '../platform-controller-review-v6/catalog.mjs';
import {DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {TRANSFER as T} from './transfer.mjs';
const must=(ok,c)=>{if(!ok)throw Error('TRANSFER_STATE_'+c);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const JOB_GUARD_SHA256='da6bd92d2c1d862199929e1673852927a5070f45a0023b8875ab799b7897ca24';
export async function assertControlLayout(c,contract,expected){
  must(c.actor===expected.ownerRole&&c.session_actor===c.actor&&c.database===expected.database&&c.installer?.oid===expected.ownerOid&&
    c.role?.name===ROLE&&c.role.oid===expected.roleOid&&c.schema?.oid===expected.schemaOid&&c.schema.owner===expected.ownerOid&&
    ['inherit','super','createRole','createDb','replication','bypassRls'].every(k=>c.role[k]===false),'IDENTITY');
  must(c.schema.serviceUsage===true&&c.schema.serviceCreate===false&&c.schema.publicGrants.length===0&&c.public_business_grants.length===0&&
    c.public_database_create===false&&c.public_schema_create===false&&c.tables.length===3&&c.functions.length===9,'PRIVILEGES');
  must(c.memberships.length<=1&&c.memberships.every(m=>m.role===ROLE&&m.member===c.actor&&m.admin===true),'MEMBERSHIPS');
  for(const t of c.tables)must(Object.hasOwn(TABLE_COLUMNS,t.name)&&same(t.columns,TABLE_COLUMNS[t.name])&&t.owner===expected.ownerOid&&
    t.kind==='r'&&!t.rls&&!t.forceRls&&Number(t.userTriggers)===0&&t.publicGrants.length===0&&!t.serviceTableAccess&&!t.serviceColumnAccess&&!t.publicColumnAccess,'CONTROL_TABLES');
  for(const f of c.functions){const e=contract.functions.find(e=>e.name===f.name);must(e&&f.owner===expected.ownerOid&&f.definer===true&&
    f.language===e.language&&f.types.replaceAll(' ','')===e.types&&await sha256Hex(f.body)===e.bodySha256&&f.publicExecute===false&&f.serviceExecute===e.serviceExecute&&
    same(f.config?.map(v=>v.replaceAll(' ','')),['search_path=pg_catalog,pg_temp']),'CONTROL_FUNCTIONS');}
}
export function assertAdmissionSnapshot(d,at){
  const s=d.admissionSnapshot;must(s&&Object.keys(s).sort().join(',')==='admin,app,environment,operation,predecessorJob,resource,subscription,templateVersion,workspace','FULL_ADMISSION');
  must(d.id===S.deploymentId&&d.appInstanceId===S.appInstanceId&&d.environmentId===S.environmentId&&d.mode==='aws_sandbox'&&d.status==='ready'&&
    d.planHash===S.planHash&&d.configurationHash===S.configurationHash&&d.artifactRef===S.artifactRef,'DEPLOYMENT');
  must(s.app.id===S.appInstanceId&&s.app.workspace_id===S.workspaceId&&s.app.product_id===S.productId&&s.app.status==='active'&&
    s.workspace.id===S.workspaceId&&s.workspace.status==='active'&&s.subscription.id===s.app.subscription_id&&s.subscription.status==='active'&&
    Number(s.subscription.current_period_end)>at&&s.templateVersion.id===s.app.template_version_id,'BUSINESS');
  const e=s.environment,r=s.resource,o=s.operation;
  must(e.id===S.environmentId&&e.status==='active'&&e.apply_enabled===0&&e.admission_state==='open'&&e.admission_epoch===0&&
    e.admission_stack_id===null&&e.kind==='aws_sandbox'&&e.expected_account_id==='402010193138'&&e.region==='ca-central-1'&&e.cell_key===S.cellKey,'ENVIRONMENT');
  must(r.app_instance_id===S.appInstanceId&&r.owner_deployment_id===S.deploymentId&&r.created_by_deployment_id===S.deploymentId&&
    r.lifecycle_status==='verified'&&r.destroyed_at===null&&r.generation===1&&r.external_operation_epoch===1&&
    o.app_instance_id===S.appInstanceId&&o.generation===1&&o.epoch===1&&o.owner_deployment_id===S.deploymentId&&o.state==='active'&&o.intent==='provision'&&o.operation_hash===S.operationHash,'OWNERSHIP');
  must(s.admin.id===ADMIN&&s.admin.status==='active'&&s.admin.platformAdmin===1&&s.admin.email==='veinyang@gmail.com'&&
    s.predecessorJob.status==='succeeded'&&['lease_token','lease_owner','lease_expires_at'].every(k=>s.predecessorJob[k]===null),'ADMIN_OR_PROOF');
}
export async function readTransferState(client,{contract,expected=DATABASE_V6,now=Date.now}={}){
  must(contract?.functions?.length===9,'CONTRACT');
  const c=(await client.query(CATALOG_SQL)).rows[0];await assertControlLayout(c,contract,expected);
  const rows=(await client.query(`SELECT CASE WHEN lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
    THEN to_jsonb(j)||jsonb_build_object('payload',j.payload::jsonb) ELSE jsonb_build_object('leased',true,'id',id) END AS value
    FROM public.deployment_jobs j WHERE deployment_id=$1 ORDER BY id LIMIT 21`,[S.deploymentId])).rows;
  must(rows.length>1&&rows.length<21&&!rows.some(r=>r.value.leased),'LEASED_OR_TOO_MANY');const jobs=rows.map(r=>r.value);
  const ledger=(await client.query(`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY plan_sha),'[]') FROM deployment_control_v6.plans p WHERE job_id=$1) AS plans,
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.plan_sha),'[]') FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=$1) AS approvals,
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY plan_sha),'[]') FROM deployment_control_v6.dispatch_attempts a WHERE job_id=$1) AS attempts,
    EXISTS(SELECT FROM public.deployment_jobs WHERE id=$2 AND deployment_id<>$3) AS foreign_candidate`,[T.oldJobId,T.newJobId,S.deploymentId])).rows[0];
  must(ledger.foreign_candidate===false,'FOREIGN_CANDIDATE');delete ledger.foreign_candidate;
  const ds=(await client.query(`SELECT id,app_instance_id AS "appInstanceId",environment_id AS "environmentId",mode,status,
    plan_hash AS "planHash",configuration_hash AS "configurationHash",artifact_ref AS "artifactRef",outputs::jsonb AS outputs
    FROM public.app_instance_deployments WHERE id=$1 AND app_instance_id=$2`,[S.deploymentId,S.appInstanceId])).rows;
  must(ds.length===1,'DEPLOYMENT_COUNT');const deployment=ds[0];
  const latest=projectInitializedDeployment({deployment,jobs,gateEnabled:false,now:now()}).view.latest;
  must(latest&&jobs.some(j=>j.id===latest.jobId&&j.status==='succeeded'),'PROOF_RECEIPT');
  const admission=(await client.query(`SELECT to_jsonb(a) AS app,to_jsonb(w) AS workspace,to_jsonb(sub) AS subscription,
    to_jsonb(e) AS environment,to_jsonb(r) AS resource,to_jsonb(o) AS operation,to_jsonb(t) AS "templateVersion",
    jsonb_build_object('id',u.id,'email',u.email,'status',u.status,'platformAdmin',u.is_platform_admin) AS admin
    FROM public.app_instance_deployments d JOIN public.app_instances a ON a.id=d.app_instance_id
    JOIN public.workspaces w ON w.id=a.workspace_id JOIN public.subscriptions sub ON sub.id=d.subscription_id AND sub.id=a.subscription_id
    JOIN public.deployment_environments e ON e.id=d.environment_id JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
    JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
    JOIN public.app_instance_template_versions t ON t.id=a.template_version_id JOIN public.users u ON u.id=$2
    WHERE d.id=$1`,[S.deploymentId,ADMIN])).rows;
  must(admission.length===1,'ADMISSION_COUNT');deployment.admissionSnapshot={...admission[0],predecessorJob:jobs.find(j=>j.id===latest.jobId)};
  assertAdmissionSnapshot(deployment,now());
  const catalog=(await client.query(`SELECT n.nspname,c.relname,c.relowner::text AS owner,c.relrowsecurity,c.relforcerowsecurity,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(v.adbin,v.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef v ON v.adrelid=a.attrelid AND v.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT coalesce(jsonb_agg(pg_get_constraintdef(x.oid) ORDER BY x.conname),'[]') FROM pg_constraint x WHERE x.conrelid=c.oid OR x.confrelid=c.oid) AS constraints,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('unique',i.indisunique,'valid',i.indisvalid,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname),'[]') FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid) AS indexes,
    (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN
    ('users','app_instances','workspaces','subscriptions','deployment_environments','app_instance_deployments','deployment_tenant_resources','deployment_tenant_external_operations','deployment_jobs') ORDER BY c.relname`)).rows;
  must(catalog.length===9&&catalog.every(t=>t.owner===expected.ownerOid&&!t.relrowsecurity&&!t.relforcerowsecurity&&t.policies===0&&t.can_select&&t.can_update)&&
    catalog.find(t=>t.relname==='deployment_jobs')?.can_insert,'BUSINESS_PRIVILEGES');
  const dispatch=c.tables.find(t=>t.name==='dispatch_attempts');must(dispatch,'DISPATCH_TABLE');
  const uniqueness=(await client.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='deployment_control_v6.dispatch_attempts'::regclass AND contype='u'`)).rows;
  must(uniqueness.some(r=>r.definition==='UNIQUE (job_id, mode)'),'PERMANENT_ATTEMPT_KEY');
  const triggers=(await client.query(`SELECT t.tgname,t.tgenabled,t.tgtype,encode(t.tgargs,'hex') AS arguments,p.proname,p.prosrc,p.proowner::text AS owner,p.prosecdef,p.proconfig,
    pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.deployment_jobs'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`)).rows;
  const g=triggers[0];must(triggers.length===1&&g.tgname==='aa_sealed_plan_deployment_jobs_v1'&&g.tgenabled==='A'&&g.tgtype===23&&
    g.proname==='guard_sealed_plan_reference_v1'&&g.owner===expected.ownerOid&&g.prosecdef===true&&same(g.proconfig,['search_path=pg_catalog'])&&
    g.arguments==='6465706c6f796d656e745f69640000'&&await sha256Hex(g.prosrc)===JOB_GUARD_SHA256,'JOB_GUARD');
  const {read_only,...stable}=c;must(['on','off'].includes(read_only),'TRANSACTION_MODE');
  const state={deployment,jobs,ledger,protection:{catalogSha256:await sha256Hex({control:stable,business:catalog,uniqueness}),triggersSha256:await sha256Hex(triggers)}};
  assertEvidenceSafeV5(state);return state;
}
