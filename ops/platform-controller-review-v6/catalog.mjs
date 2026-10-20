// Exact control schema metadata and counts only. Never reads business rows.
export const ROLE='techlong_deployment_controller_v6',SCHEMA='deployment_control_v6';
export const TABLE_COLUMNS={plans:['plan_sha','action_sha','risk_sha','job_id','mode','body','expires_at','created_at'],
  approvals:['plan_sha','admin_id','approved_at'],
  dispatch_attempts:['plan_sha','job_id','mode','state','run_id','run_status','conclusion','proof_sha','started_at','observed_at']};
export const CATALOG_SQL=`SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,
  current_setting('server_version_num') AS server_version_num,current_setting('transaction_read_only') AS read_only,
  (SELECT jsonb_build_object('oid',oid::text,'name',rolname,'super',rolsuper,'createRole',rolcreaterole) FROM pg_roles WHERE rolname=current_user) AS installer,
  (SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,
    'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls) FROM pg_roles WHERE rolname='${ROLE}') AS role,
  (SELECT jsonb_build_object('oid',n.oid::text,'owner',n.nspowner::text,
    'serviceUsage',CASE WHEN to_regrole('${ROLE}') IS NULL THEN false ELSE has_schema_privilege('${ROLE}',n.oid,'USAGE') END,
    'serviceCreate',CASE WHEN to_regrole('${ROLE}') IS NULL THEN false ELSE has_schema_privilege('${ROLE}',n.oid,'CREATE') END,
    'publicGrants',(SELECT coalesce(jsonb_agg(a.privilege_type ORDER BY a.privilege_type),'[]'::jsonb)
      FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0)) FROM pg_namespace n WHERE n.nspname='${SCHEMA}') AS schema,
  has_database_privilege(current_user,current_database(),'CREATE') AS installer_database_create,
  EXISTS(SELECT FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
    WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='CREATE') AS public_database_create,
  EXISTS(SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='CREATE') AS public_schema_create,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'privilege',a.privilege_type)),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND c.relname IN ('users','deployment_jobs','app_instance_deployments') AND a.grantee=0) AS public_business_grants,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind,
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'columns',(SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'publicGrants',(SELECT coalesce(jsonb_agg(a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0),
    'serviceTableAccess',CASE WHEN to_regrole('${ROLE}') IS NULL THEN false ELSE has_table_privilege('${ROLE}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END,
    'serviceColumnAccess',CASE WHEN to_regrole('${ROLE}') IS NULL THEN false ELSE has_any_column_privilege('${ROLE}',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END,
    'publicColumnAccess',EXISTS(SELECT FROM pg_attribute col CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE col.attrelid=c.oid AND col.attnum>0 AND a.grantee=0),
    'userTriggers',(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) ORDER BY c.relname),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${SCHEMA}' AND c.relkind IN ('r','p','v','m','S','f')) AS tables,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'oid',p.oid::text,'owner',p.proowner::text,'types',oidvectortypes(p.proargtypes),
    'language',l.lanname,'definer',p.prosecdef,'config',p.proconfig,'body',p.prosrc,
    'publicExecute',EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
    'serviceExecute',CASE WHEN to_regrole('${ROLE}') IS NULL THEN false ELSE has_function_privilege('${ROLE}',p.oid,'EXECUTE') END) ORDER BY p.proname),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='${SCHEMA}') AS functions,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',u.rolname,'admin',m.admin_option,
    'inherit',to_jsonb(m)->'inherit_option','set',to_jsonb(m)->'set_option') ORDER BY r.rolname,u.rolname),'[]'::jsonb)
    FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='${ROLE}' OR u.rolname='${ROLE}') AS memberships,
  (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('users','deployment_jobs','app_instance_deployments') AND c.relkind IN ('r','p')) AS business_tables`;
export async function readControlCatalog(client){
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    const r=await client.query(CATALOG_SQL);if(r.rows.length!==1||r.rows[0].read_only!=='on')throw Error('CONTROL_INSTALL_READ_ONLY');
    const catalog=r.rows[0];catalog.rowCounts={};
    for(const name of Object.keys(TABLE_COLUMNS))if(catalog.tables.some(t=>t.name===name&&t.kind==='r')){
      const q=await client.query(`SELECT count(*)::text AS n FROM ${SCHEMA}.${name}`);catalog.rowCounts[name]=q.rows[0].n;
    }
    await client.query('COMMIT');return catalog;
  }catch(e){try{await client.query('ROLLBACK');}catch{/* Read-only cleanup only. */}throw e;}
}
