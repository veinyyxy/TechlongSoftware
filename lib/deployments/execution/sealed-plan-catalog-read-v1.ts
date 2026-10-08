/** Independent catalog read. Never executes a mutable SECURITY DEFINER helper. */
export const SEALED_PLAN_CATALOG_READ_V1=`WITH functions AS (
 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',p.proname,'definition',pg_catalog.pg_get_functiondef(p.oid),'owner',p.proowner::pg_catalog.regrole::text)
 ORDER BY p.proname) AS value FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY['sealed_plan_protection_hash_v1','touch_sealed_plan_fence_v1','guard_sealed_plan_fence_v1',
 'guard_sealed_plan_deployment_v1','guard_sealed_plan_reference_v1','validate_sealed_plan_registration_v1','finalize_sealed_plan_registration_v1','reject_sealed_plan_mutation_v1'])
),triggers AS (
 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
 ORDER BY c.relname,t.tgname) AS value FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname LIKE 'aa_sealed_plan_%_v1'
),refs AS (
 SELECT pg_catalog.jsonb_agg(n.nspname||'.'||c.relname||'.'||a.attname ORDER BY n.nspname,c.relname,a.attname) AS value
 FROM pg_catalog.pg_constraint f JOIN pg_catalog.pg_class c ON c.oid=f.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL pg_catalog.unnest(f.conkey) k(attnum) JOIN pg_catalog.pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum
 WHERE f.contype='f' AND f.confrelid='public.app_instance_deployments'::pg_catalog.regclass
),tables AS (
 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',c.relname,'owner',c.relowner::pg_catalog.regrole::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
 'collation',a.attcollation::pg_catalog.regcollation::text,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',k.conname,'definition',pg_catalog.pg_get_constraintdef(k.oid)) ORDER BY k.conname)
 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
 'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(i.indexrelid) ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid)) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid),
 'allTriggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled,
 'function',pg_catalog.pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) ORDER BY c.relname) AS value
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY(ARRAY['app_instance_deployments','deployment_jobs','deployment_step_runs',
 'deployment_cleanup_schedules','deployment_environment_capacity_reservations','deployment_tenant_resources','deployment_tenant_resource_events',
 'deployment_tenant_external_operations','deployment_tenant_external_operation_events','deployment_tenant_cleanup_runs',
 'deployment_plan_only_isolations','deployment_plan_only_isolation_fences'])
) SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('functions',functions.value,'triggers',triggers.value,
 'references',refs.value,'tables',tables.value)::text,'UTF8')),'hex') AS live_protection_sha256 FROM functions,triggers,refs,tables`;
