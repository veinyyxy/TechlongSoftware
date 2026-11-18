import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { parseTarget } from '../platform-web-database-v1/local.mjs';
import { sandboxFirstPurchaseInstallStatements } from '../platform-web-database-role-v1/sandbox-first-purchase-ddl.ts';
import { SANDBOX_PURCHASE_WEBHOOK_ROLE as hook } from '../../lib/purchases/sandbox-first-purchase-config.ts';
import { hash, same } from './contract.mjs';
import { scope } from './first-purchase-activation.mjs';

const web='techlong_platform_web_acceptance_v1', definer='techlong_sandbox_first_purchase_definer';
const roles=[definer,hook];
const check=(ok,code)=>{if(!ok)throw Error('FIRST_PURCHASE_DB_'+code);};
const selectTables=['workspaces','workspace_members','users','products','plans','app_instance_template_versions',
  'app_instance_templates','subscriptions','app_instances','payment_records','subscription_purchase_orders',
  'deployment_environments','deployment_tenant_resources','app_instance_deployments','workspace_product_entitlements'];
const insertTables=['payment_records','subscription_purchase_orders','subscriptions','app_instances','workspace_product_entitlements',
  'app_instance_deployments','deployment_jobs','payment_webhook_events'];
const updates={
  subscription_purchase_orders:['provider_session_id','checkout_url','expires_at','subscription_id','provider_payment_id','completed_at','status','updated_at'],
  payment_records:['reference','subscription_id','status','paid_at','provider_payment_id','provider_event_id','updated_at'],
  workspaces:['plan_id','subscription_status','app_instance_status','updated_at'],
  app_instances:['updated_at'],subscriptions:['updated_at'],deployment_environments:['updated_at'],
};
const tables=[...new Set([...selectTables,...insertTables])];
const columnOptions=Object.entries(updates).flatMap(([table,columns])=>columns.map(column=>[table,column]));
async function base(q){
  await q('SET LOCAL search_path=pg_catalog');await q("SET LOCAL statement_timeout='18s'");await q("SET LOCAL lock_timeout='4s'");
}
export function firstPurchaseDatabase({rawConfig,historical,projection,binding,deadline,record}){
  check(!Object.keys(process.env).some(k=>/^PG|^SSL_CERT_(?:DIR|FILE)$/i.test(k)&&process.env[k]) &&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','PROCESS_ENV');
  const {target,config}=parseTarget(parseEnv(rawConfig).DATABASE_URL), h=historical.catalog?.identity;
  check(same(target,historical.target)&&target.actor!==web&&h?.actor_role?.oid&&h.database_metadata?.oid,'TARGET');
  const limits={connections:0,sql:0};let password;
  async function session(work,{readOnly=true}={}){
    check(++limits.connections<=3&&Date.now()<deadline,'CONNECTION_LIMIT');
    const db=new pg.Client({...config,application_name:'Techlong-Reviewed-Sandbox-First-Purchase'});
    db.on('error',()=>{});let started=false,commitSent=false;
    const q=async (stmt,args)=>{
      check(++limits.sql<=76&&Date.now()<deadline,'SQL_LIMIT');return (await db.query(stmt,args)).rows;
    };
    try{
      await db.connect();const stream=db.connection.stream;
      check(stream?.encrypted===true&&stream.authorized===true,'TLS');
      await q(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');started=true;await base(q);
      const [id]=await q(`SELECT current_user AS actor,session_user AS login,current_database() AS db,
        r.oid::text AS oid,d.oid::text AS database_oid,d.datdba::text AS owner,
        current_setting('server_version_num')::int/10000 AS major,r.rolsuper,r.rolcreaterole
        FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`);
      check(id?.actor===target.actor&&id.login===target.actor&&id.db===target.database&&id.oid===h.actor_role.oid&&
        id.database_oid===h.database_metadata.oid&&id.owner===h.database_metadata.owner&&id.major===18&&!id.rolsuper&&id.rolcreaterole,'IDENTITY');
      const result=await work(q);
      if(!readOnly)await record('db-commit-intent',{statementCount:limits.sql});
      commitSent=true;await q('COMMIT');started=false;return result;
    }finally{
      if(started&&!commitSent&&limits.sql<76&&Date.now()<deadline)await q('ROLLBACK').catch(()=>{});
      await db.end().catch(()=>{});
    }
  }
  async function layout(q){
    return q(`SELECT c.relname AS name,encode(sha256(convert_to(jsonb_build_object(
      'cols',coalesce((SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
        a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
      'constraints',coalesce((SELECT jsonb_agg(jsonb_build_array(p.conname,p.convalidated,pg_get_constraintdef(p.oid)) ORDER BY p.conname)
        FROM pg_constraint p WHERE p.conrelid=c.oid),'[]'::jsonb),
      'indexes',coalesce((SELECT jsonb_agg(jsonb_build_array(i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
        FROM pg_index i WHERE i.indrelid=c.oid),'[]'::jsonb),
      'triggers',coalesce((SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),p.proowner,p.prosecdef,
        encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) ORDER BY t.tgname)
        FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),'[]'::jsonb))::text,'UTF8')),'hex') AS definition_sha256,
      EXISTS(SELECT 1 FROM pg_rewrite rw WHERE rw.ev_class=c.oid) AS has_rule,
      (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS visible_trigger_count
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,[tables]);
  }
  async function before(q){
    const [a]=await q(`SELECT
      NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])) AND to_regnamespace('sandbox_first_purchase') IS NULL AS vacant,
      has_database_privilege(current_user,current_database(),'CREATE') AND has_language_privilege(current_user,'plpgsql','USAGE')
        AND has_schema_privilege(current_user,'public','USAGE WITH GRANT OPTION')
        AND has_column_privilege(current_user,'public.deployment_jobs','id','SELECT WITH GRANT OPTION') AS installer,
      EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=$2 AND r.oid::text=$3
        AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
        AND has_schema_privilege(r.oid,'public','USAGE') AND NOT has_schema_privilege(r.oid,'public','CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)) AS web,
      has_function_privilege($2::name,to_regprocedure('sandbox_registration.register_account(text,text,text,text)'),'EXECUTE') AS old_registration,
      NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
        WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='CREATE') AS protected_public`,[roles,web,projection.roles.web.oid]);
    check(a&&Object.values(a).every(v=>v===true),'ROLE_OR_SLOT');
    const [w]=await q(`SELECT w.status='active' AND w.subscription_status='not_configured' AND w.app_instance_status='not_provisioned'
      AND EXISTS(SELECT 1 FROM public.workspace_members m JOIN public.users u ON u.id=m.user_id
        WHERE m.workspace_id=w.id AND m.user_id=w.owner_id AND m.role='owner' AND u.status='active' AND u.is_platform_admin=0)
      AND (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.role='owner')=1
      AND NOT EXISTS(SELECT 1 FROM public.subscription_purchase_orders WHERE workspace_id=w.id AND product_id=$2)
      AND NOT EXISTS(SELECT 1 FROM public.app_instances WHERE workspace_id=w.id AND product_id=$2)
      AND NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE workspace_id=w.id AND product_id=$2)
      AND NOT EXISTS(SELECT 1 FROM public.workspace_product_entitlements WHERE workspace_id=w.id AND product_id=$2) AS eligible
      FROM public.workspaces w WHERE w.id=$1`,[binding.workspaceId,scope.productId]);
    const plans=await q(`SELECT q.id AS plan_id,q.template_version_id,v.version,q.price_amount,q.currency,q.billing_interval
      FROM public.plans q JOIN public.products p ON p.id=q.product_id JOIN public.app_instance_template_versions v ON v.id=q.template_version_id
      JOIN public.app_instance_templates t ON t.id=v.template_id AND t.product_id=p.id
      WHERE p.id=$1 AND p.status='active' AND q.status='active' AND q.deployment_profile_key=$2 AND q.price_amount>0
      AND q.billing_interval IN ('month','year') AND t.status='active' AND v.status='published' ORDER BY q.id LIMIT 2`,[scope.productId,scope.profile]);
    check(w?.eligible===true&&plans.length===1&&plans[0].plan_id===binding.planId&&same(plans,projection.plans),'WORKSPACE_OR_PLAN');
    const [e]=await q(`SELECT key,region,cell_key,kind,expected_account_id,apply_enabled,admission_state,status
      FROM public.deployment_environments WHERE id=$1`,[scope.environmentId]);
    const [r]=await q(`SELECT status,product_id,component,document #>> '{image,repository}' AS repository,
      document #>> '{image,manifestDigest}' AS manifest_digest,document #>> '{image,platformDigest}' AS platform_digest,
      document #>> '{image,runtimePlatform}' AS runtime_platform,document #> '{compatibility,databaseProfiles}' AS profiles,
      document #> '{compatibility,schemaVersions}' AS schema_versions,document #> '{compatibility,applicationPort}' AS port,
      document #> '{compatibility,requiresMigration}' AS requires_migration,document #> '{compatibility,startupWrites}' AS startup_writes
      FROM deployment_release.releases WHERE id=$1`,[scope.tenantReleaseId]);
    check(same(e,projection.environment)&&e?.apply_enabled===0&&e?.admission_state==='open'&&same(r,projection.releaseA)&&
      r?.status==='ecr_verified'&&r.repository+'@'+r.manifest_digest===scope.tenantReleaseImage,'ADMISSION_OR_RELEASE');
    const acl=await q(`SELECT c.relname AS name,
      has_any_column_privilege($1,c.oid,'INSERT,UPDATE') OR has_table_privilege($1,c.oid,'DELETE,TRUNCATE') AS web_direct_write,
      has_table_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION') AS can_grant_select,
      has_table_privilege(current_user,c.oid,'INSERT WITH GRANT OPTION') AS can_grant_insert,
      c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($2::text[]) AND c.relkind='r' ORDER BY c.relname`,[web,tables]);
    check(acl.length===tables.length&&hash(JSON.stringify(acl))===projection.catalogTables.projectionSha256&&
      acl.every(x=>!x.web_direct_write&&!x.rls&&!x.force_rls&&(!selectTables.includes(x.name)||x.can_grant_select)&&
        (!insertTables.includes(x.name)||x.can_grant_insert)),'TABLE_GRANTS');
    const [cols]=await q(`SELECT bool_and(has_column_privilege(current_user,'public.'||(x->>0),x->>1,'UPDATE WITH GRANT OPTION')) AS allowed
      FROM jsonb_array_elements($1::jsonb) x`,[JSON.stringify(columnOptions)]);
    check(cols?.allowed===true&&same(await layout(q),projection.protectedLayout),'COLUMNS_OR_PROTECTED_LAYOUT');
  }
  async function installed(q,statements){
    const [v]=await q(`SELECT (
      SELECT count(*)=2 AND bool_and(rolcanlogin=(rolname=$1) AND NOT (rolinherit OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
        AND NOT pg_has_role(current_user,oid,'SET') AND NOT pg_has_role(current_user,oid,'USAGE'))
        FROM pg_roles WHERE rolname=ANY($2::text[])) AS roles,
      (SELECT count(*)=2 AND bool_and(m.rolname=current_user AND a.admin_option AND NOT a.inherit_option AND NOT a.set_option)
        FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member
        WHERE r.rolname=ANY($2::text[]) OR m.rolname=ANY($2::text[])) AS memberships,
      (SELECT pg_get_userbyid(n.nspowner)=$3
        AND (SELECT count(*)=4 AND bool_and(NOT a.is_grantable AND ((pg_get_userbyid(a.grantee)=$3 AND a.privilege_type IN ('CREATE','USAGE'))
          OR (pg_get_userbyid(a.grantee) IN ($1,$4) AND a.privilege_type='USAGE'))) FROM aclexplode(n.nspacl) a)
        FROM pg_namespace n WHERE n.nspname='sandbox_first_purchase') AS namespace,
      NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
        AND (has_any_column_privilege($1::name,c.oid,'INSERT,UPDATE,REFERENCES') OR has_table_privilege($1::name,c.oid,'DELETE,TRUNCATE,TRIGGER')
          OR has_any_column_privilege($4::name,c.oid,'INSERT,UPDATE,REFERENCES') OR has_table_privilege($4::name,c.oid,'DELETE,TRUNCATE,TRIGGER'))) AS no_direct_writes`,
      [hook,roles,definer,web]);
    check(v&&Object.values(v).every(x=>x===true),'INSTALLED_ROLE_OR_ACL');
    const f=await q(`SELECT p.proname AS name,p.prosrc AS body,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,p.proconfig AS config,
      ARRAY(SELECT coalesce(r.rolname,'PUBLIC')||':'||x.privilege_type||':'||x.is_grantable::text
        FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee ORDER BY r.rolname) AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sandbox_first_purchase' ORDER BY p.proname`);
    const expected=Object.fromEntries(statements.flatMap(x=>{
      const m=x.match(/^CREATE FUNCTION sandbox_first_purchase\.(\w+)\([\s\S]*?\nAS \$purchase\$([\s\S]*)\$purchase\$;$/);
      return m?[[m[1],m[2]]]:[];
    }));
    check(f.length===5&&Object.keys(expected).length===5&&new Set(f.map(x=>x.name)).size===5&&f.every(x=>x.body===expected[x.name]&&
      x.owner===definer&&x.definer===true&&same(x.config,['search_path=pg_catalog, public, pg_temp'])&&
      same([...x.acl].sort(),[`${definer}:EXECUTE:false`,`${['complete','webhook_order'].includes(x.name)?hook:web}:EXECUTE:false`].sort()))&&
      same(await layout(q),projection.protectedLayout),'INSTALLED_FUNCTIONS_OR_LAYOUT');
    return hash(JSON.stringify(f.map(({name,body,acl})=>({name,bodySha256:hash(body),acl}))));
  }
  return {limits, preflight:()=>session(before),
    async install(){
      password=randomBytes(48).toString('base64url');
      const sql=sandboxFirstPurchaseInstallStatements(binding,password);
      const written=await session(async q=>{await before(q);await record('db-install-intent',{statements:sql.length});
        for(const stmt of sql)await q(stmt);
        return installed(q,sql);},{readOnly:false});
      await record('db-commit-ack',{functionAclSha256:written});
      check(await session(q=>installed(q,sql))===written,'INDEPENDENT_READBACK');
      await record('db-verified',{functionAclSha256:written});
      const dsn=new URL(`postgresql://${target.host}:5432/${target.database}?sslmode=verify-full&channel_binding=require`);
      dsn.username=hook;dsn.password=password;password=undefined;return dsn.href;
    }};
}
