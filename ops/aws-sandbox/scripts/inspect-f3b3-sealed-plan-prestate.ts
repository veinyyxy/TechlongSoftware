import { neon } from "@neondatabase/serverless";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--out")throw new Error("READ_ONLY_PRESTATE_OUTPUT_REQUIRED");
const out=path.resolve(args[1]);
if(path.dirname(out).toLowerCase()!==path.resolve("F:/ChatGPT_workshop").toLowerCase()||
 !/^techlong-f3b3-sealed-prestate-[a-z0-9-]+$/.test(path.basename(out)))throw new Error("READ_ONLY_PRESTATE_PATH_INVALID");
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const expectedReferences=["deployment_cleanup_schedules.deployment_id","deployment_environment_capacity_reservations.deployment_id",
 "deployment_jobs.deployment_id","deployment_step_runs.deployment_id","deployment_tenant_cleanup_runs.owner_deployment_id",
 "deployment_tenant_external_operation_events.deployment_id","deployment_tenant_external_operations.owner_deployment_id",
 "deployment_tenant_resource_events.deployment_id","deployment_tenant_resources.created_by_deployment_id","deployment_tenant_resources.owner_deployment_id"];
try{
 const url=process.env.DATABASE_URL;
 if(!url||!new URL(url).hostname.endsWith(".neon.tech"))throw new Error("Neon target missing");
 const sql=neon(url,{fullResults:true});
 const results=await sql.transaction(tx=>[
  tx.query(`SELECT current_setting('server_version_num') AS server_version,
    current_setting('session_replication_role') AS replication_role,
    to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at,
    d.id,d.environment_id,d.app_instance_id,d.mode,d.status,d.attempts,
    encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') AS original_row_sha256,
    (SELECT count(*) FROM deployment_jobs j WHERE j.deployment_id=d.id) AS job_count,
    (SELECT count(*) FROM app_instance_deployments s WHERE s.app_instance_id=d.app_instance_id) AS instance_deployment_count
    FROM app_instance_deployments d WHERE d.id='dep_d00144511731f1c20991aa56'`),
  tx.query(`SELECT n.nspname AS schema,c.relname AS table,a.attname AS column FROM pg_constraint f
    JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(f.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.attnum
    WHERE f.contype='f' AND f.confrelid='public.app_instance_deployments'::regclass ORDER BY n.nspname,c.relname,a.attname`),
  tx.query(`SELECT 'table' AS kind,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('deployment_plan_only_isolations','deployment_plan_only_isolation_fences')
    UNION ALL SELECT 'function',p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('sealed_plan_protection_hash_v1','touch_sealed_plan_fence_v1',
    'guard_sealed_plan_fence_v1','guard_sealed_plan_deployment_v1','guard_sealed_plan_reference_v1',
    'validate_sealed_plan_registration_v1','finalize_sealed_plan_registration_v1','reject_sealed_plan_mutation_v1')
    UNION ALL SELECT 'trigger',t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname LIKE 'aa_sealed_plan_%_v1'`),
  tx.query(`SELECT t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function
    FROM pg_trigger t WHERE t.tgrelid='public.app_instance_deployments'::regclass
    AND t.tgname='app_instance_deployments_admission_reopen_fence' AND NOT t.tgisinternal`),
 ],{isolationLevel:"Serializable",readOnly:true,deferrable:true,fullResults:true,fetchOptions:{signal:AbortSignal.timeout(30000)}});
 if(results[0].rows.length!==1||results[3].rows.length!==1)throw new Error("Exact prestate unavailable");
 const original=results[0].rows[0],references=results[1].rows,objects=results[2].rows,immutable=results[3].rows[0];
 const closureMatches=references.every(r=>r.schema==="public")&&JSON.stringify(references.map(r=>`${r.table}.${r.column}`).sort())===JSON.stringify(expectedReferences.sort());
 const eligible=original.environment_id==="env_aws_sandbox_ca_central_1"&&original.app_instance_id==="app_fb1962e93a9a4cc2acf046170593d9e3"&&
  original.mode==="plan_only"&&original.status==="planned"&&Number(original.attempts)===0&&Number(original.job_count)===0&&Number(original.instance_deployment_count)===1&&
  closureMatches&&objects.length===0&&["O","A"].includes(immutable.enabled)&&original.replication_role==="origin";
 const report={schemaVersion:1,outcome:eligible?"SEALED_SCHEMA_READ_ONLY_PRESTATE_COMPATIBLE_NOT_APPROVED":"SEALED_SCHEMA_PRESTATE_REQUIRES_REVIEW",
  original,references,objects,immutableTrigger:immutable,referenceClosureMatches:closureMatches,
  localPg16CompatibilityDoesNotProveNeonRuntime:true,installationAuthorized:false,registrationAuthorized:false,databaseMutationPerformed:false,cloudMutationPerformed:false};
 await mkdir(out);const bytes=JSON.stringify(report,null,2)+"\n";
 await writeFile(path.join(out,"sealed-plan-prestate.json"),bytes,{flag:"wx"});
 console.log(JSON.stringify({outcome:report.outcome,output:out,fileSha256:hash(bytes),serverVersion:original.server_version,
  referenceCount:references.length,referenceClosureMatches:closureMatches,newObjectCount:objects.length,installationAuthorized:false,databaseMutationPerformed:false}));
}catch{console.error("SEALED_PLAN_READ_ONLY_PRESTATE_NOT_VERIFIED; credentials/diagnostics withheld; no database mutation.");process.exitCode=1;}
