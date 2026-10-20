// Effective capabilities of the NOLOGIN service role. Catalog metadata only.
import {CONTROL_SCOPE as S} from '../../lib/deployments/controller-v6/contract.ts';
import {createHash} from 'node:crypto';
export const PRIVILEGE_SQL_V6=`WITH r AS (SELECT * FROM pg_roles WHERE rolname='${S.databaseRole}')
SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,current_setting('transaction_read_only') AS read_only,
 (SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,
   'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls,'config',rolconfig) FROM r) AS role,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('role',p.rolname,'admin',m.admin_option,'inherit',to_jsonb(m)->'inherit_option',
   'set',to_jsonb(m)->'set_option') ORDER BY p.rolname),'[]'::jsonb) FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.member=(SELECT oid FROM r)) AS memberships,
 (SELECT coalesce(jsonb_agg(d.datname ORDER BY d.datname),'[]'::jsonb) FROM pg_database d,r WHERE
   d.datdba=r.oid OR has_database_privilege(r.oid,d.oid,'CREATE')) AS database_create_or_owner,
 (SELECT has_database_privilege(r.oid,current_database(),'TEMP') FROM r) AS temporary_objects_allowed,
 (SELECT coalesce(jsonb_agg(n.nspname ORDER BY n.nspname),'[]'::jsonb) FROM pg_namespace n,r WHERE
   n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE'))) AS schema_create_or_owner,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'oid',c.oid::text,'kind',c.relkind) ORDER BY n.nspname,c.relname),'[]'::jsonb)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,r WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
   (c.relowner=r.oid OR CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
     (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
     WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE false END)) AS relation_or_column_rights,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'oid',p.oid::text,
   'types',oidvectortypes(p.proargtypes),'definer',p.prosecdef,'owner',p.proowner::text,'language',l.lanname,
   'returnType',p.prorettype::regtype::text,'config',p.proconfig,'body',p.prosrc) ORDER BY n.nspname,p.proname,p.oid),'[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang,r WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
   (p.proowner=r.oid OR (has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE'))) AND
   p.oid NOT IN ('deployment_control_v6.load_plan(text)'::regprocedure,'deployment_control_v6.begin_dispatch(text,text,text,text)'::regprocedure,
     'deployment_control_v6.assert_live(text)'::regprocedure,'deployment_control_v6.acknowledge(text,text)'::regprocedure,
     'deployment_control_v6.mark_unknown(text)'::regprocedure,'deployment_control_v6.observe_run(text,text,text,text)'::regprocedure,
     'deployment_control_v6.status()'::regprocedure)) AS unexpected_executable_functions,
 (SELECT coalesce(jsonb_agg(p.oid::text ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,r WHERE
   n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(r.oid,p.oid,'EXECUTE WITH GRANT OPTION')) AS function_grant_options,
 (SELECT coalesce(jsonb_agg(s.srvname ORDER BY s.srvname),'[]'::jsonb) FROM pg_foreign_server s,r WHERE
   s.srvowner=r.oid OR has_server_privilege(r.oid,s.oid,'USAGE')) AS foreign_server_rights`;

export async function readControlPrivilegesV6(client){
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{const r=await client.query(PRIVILEGE_SQL_V6);
    if(r.rows?.length!==1||r.rows[0].read_only!=='on')throw Error('PUBLISHER_AUDIT_READ_ONLY');
    await client.query('COMMIT');const c=r.rows[0];
    c.unexpected_executable_functions=c.unexpected_executable_functions.map(({body,...f})=>({...f,
      bodySha256:createHash('sha256').update(body).digest('hex')}));return c;
  }catch(e){try{await client.query('ROLLBACK');}catch{/* Read-only transaction cleanup only. */}throw e;}
}
export function inspectControlPrivilegesV6(c,expectedRoleOid,{expectedLogin=false}={}){
  const blockers=[],r=c.role;
  if(c.read_only!=='on'||r?.oid!==expectedRoleOid||r?.name!==S.databaseRole)blockers.push('ROLE_IDENTITY');
  if(!r||r.login!==expectedLogin||['super','inherit','createRole','createDb','replication','bypassRls'].some(k=>r[k]!==false)||r.config!==null)blockers.push('ROLE_FLAGS_OR_CONFIG');
  for(const k of ['memberships','database_create_or_owner','schema_create_or_owner','relation_or_column_rights',
    'unexpected_executable_functions','function_grant_options','foreign_server_rights'])if(!Array.isArray(c[k])||c[k].length)blockers.push(k);
  return {state:blockers.length?'LOGIN_ACTIVATION_BLOCKED_REQUIRES_REVIEW':expectedLogin?
    'LOGIN_PRIVILEGE_READBACK_PASSED_RUNTIME_NOT_ENABLED':'NOLOGIN_PRIVILEGE_PREFLIGHT_PASSED_NOT_ACTIVATED',
    activationPreflightPassed:blockers.length===0,blockers,roleOid:r?.oid??null,roleLogin:r?.login??null,
    legacyInvokerTriggerCount:(c.unexpected_executable_functions??[]).filter(f=>f.definer===false&&f.returnType==='trigger'&&f.language==='plpgsql').length,
    temporaryObjectsAllowed:c.temporary_objects_allowed===true,automaticRevokes:0,loginActivations:0,
    systemFunctionSemanticsAudited:false,providerAndConcurrentChangeRiskRemains:true};
}
