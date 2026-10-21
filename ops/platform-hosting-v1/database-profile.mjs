// Proposed acceptance-only profile, NOT an installed/verified grant or SQL runner.
export const WEB_DATABASE_PROFILE=Object.freeze({role:'techlong_platform_web_acceptance_v1',secretName:'techlong/sandbox/platform-web/neon-v1',
  allowedPurpose:'existing admin login, overview and instance readback only',
  selectTables:Object.freeze(['users','workspaces','workspace_members','products','plans','subscriptions','app_instances',
    'app_instance_templates','app_instance_template_versions','workspace_product_entitlements','app_instance_deployments','deployment_jobs','payment_records']),
  credentialsSelectColumns:Object.freeze(['user_id','password_hash','password_salt','password_iterations','failed_attempts','locked_until']),
  credentialsUpdateColumns:Object.freeze(['failed_attempts','locked_until','updated_at']),
  sessionPrivileges:Object.freeze(['SELECT','INSERT','DELETE']),
  prohibited:Object.freeze(['owner','superuser','bypassrls','createdb','createrole','role memberships','schema create','DDL',
    'password changes','business writes','deployment writes','authority writes','controller schema access','default privileges']),
  catalogVerified:false,installed:false,rowIsolation:false});

// No password/connection URL, business rows, stored function source or secret values.
// To be executed only after a separate read-only database review, in READ ONLY txn.
export const WEB_DATABASE_CATALOG_SQL=`SELECT current_database() AS database, current_user AS actor,
 current_setting('transaction_read_only') AS read_only,
 (SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,
   'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls,'config',rolconfig)
  FROM pg_roles WHERE rolname='techlong_platform_web_acceptance_v1') AS candidate_role,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
   'owner',c.relowner::text,'acl',c.relacl,'rls',c.relrowsecurity) ORDER BY n.nspname,c.relname),'[]'::jsonb)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')) AS relations,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'oid',p.oid::text,
   'types',oidvectortypes(p.proargtypes),'owner',p.proowner::text,'definer',p.prosecdef,'acl',p.proacl,'config',p.proconfig)
   ORDER BY n.nspname,p.proname,p.oid),'[]'::jsonb)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema') AS functions,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('role',p.rolname,'admin',m.admin_option,
   'inherit',to_jsonb(m)->'inherit_option','set',to_jsonb(m)->'set_option') ORDER BY p.rolname),'[]'::jsonb)
  FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid
  WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='techlong_platform_web_acceptance_v1')) AS memberships,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',nspname,'owner',nspowner::text,'acl',nspacl) ORDER BY nspname),'[]'::jsonb)
  FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema') AS schemas,
 (SELECT datacl FROM pg_database WHERE datname=current_database()) AS database_acl`;
