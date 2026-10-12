import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { SEALED_CELL_OWNERSHIP_SQL_V3 } from "../../../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts";
import { validateSealedCertificateV3 } from "../../../lib/deployments/execution/sealed-cell-cleanup-authority-v3.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 } from "../../../lib/deployments/execution/sealed-cell-cleanup-lambda-context-v3.ts";

// Source prestate ONLY. Never runs candidate SQL, calls a mutable hash helper,
// uses an AWS client, registers a failure, or makes a certified zero/delete proof.
const repo=fileURLToPath(new URL("../../../",import.meta.url)),root=await realpath("F:/ChatGPT_workshop"),out=path.resolve(process.argv[2]??"");
if(process.argv.length!==3||(await realpath(path.dirname(out))).toLowerCase()!==root.toLowerCase()||!/^techlong-f3c7-failed-birth-prestate-[a-z0-9-]+$/.test(path.basename(out)))throw Error("FRESH_FAILED_BIRTH_PRESTATE_DIRECTORY_REQUIRED");
await mkdir(out); const save=async(name,value)=>{const text=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),text,{flag:"wx"});return sha256Hex(text);};
let stage="CODE_BINDING";
try{
 const previous=JSON.parse(await readFile(path.join(root,"techlong-f3c6-birth-registry-20261012-r2/code-binding.json"),"utf8"));
 if(previous.codeSha256!=="af9695730b041e471c1c847ef5f6a011d58519113712480fa885a2cbccc20a8f"||previous.pins.length!==36||await sha256Hex(previous.pins)!==previous.codeSha256)throw Error("FAILED_BIRTH_OLD36_BINDING_INVALID");
 for(const p of previous.pins)if(await sha256Hex((await readFile(path.join(repo,p.file),"utf8")).replace(/\r\n/g,"\n"))!==p.sha256)throw Error("FAILED_BIRTH_OLD36_BINDING_DRIFT");
 const files=[...new Set([...previous.pins.map(p=>p.file),"lib/deployments/execution/failed-cell-birth-fence-v1.ts","lib/deployments/execution/neon-failed-cell-birth-source-v1.ts",
  "ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-fence.sql","ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql",
  "ops/aws-sandbox/scripts/verify-failed-cell-birth-fence-pg16.mjs","ops/aws-sandbox/scripts/review-failed-cell-birth-prestate.mjs"] )];
 const pins=[];for(const file of files)pins.push({file,sha256:await sha256Hex((await readFile(path.join(repo,file),"utf8")).replace(/\r\n/g,"\n"))});
 const codeSha256=await sha256Hex(pins);await save("code-binding.json",{pins,codeSha256});stage="NEON_READONLY_PRESTATE";
 const raw=process.env.DATABASE_URL;if(typeof raw!=="string")throw Error("FAILED_BIRTH_NEON_CONFIG_MISSING");const url=new URL(raw);
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||!url.password||!["require","verify-full"].includes(url.searchParams.get("sslmode")??""))throw Error("FAILED_BIRTH_NEON_TLS_ENDPOINT_REQUIRED");
 const sql=neon(raw,{fullResults:true}); const env="env_aws_sandbox_ca_central_1",signal=AbortSignal.timeout(30000);
 const extra=`SELECT current_setting('server_version_num')::int AS server_version,
  to_regclass('public.deployment_failed_cell_birth_fences_v1') IS NOT NULL AS failure_table_present,
  to_regprocedure('public.begin_failed_cell_birth_fence_v1(text,text)') IS NOT NULL AS failure_entry_present,
  EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.deployment_environments'::pg_catalog.regclass
   AND c.conname='deployment_environments_admission_state_check' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%failed_unadmitted%') AS failure_state_present,
  (SELECT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::pg_catalog.text[] AND p.prorettype='pg_catalog.text'::pg_catalog.regtype
   AND p.pronargs=0 AND l.lanname='plpgsql' FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid='public.sealed_plan_protection_hash_v1()'::pg_catalog.regprocedure) AS fingerprint_definition_safe,
  e.apply_enabled,(SELECT count(*) FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.environment_id=e.id AND j.status IN ('queued','running')) AS nonterminal_jobs,
  (SELECT count(*) FROM public.deployment_step_runs s JOIN public.app_instance_deployments d ON d.id=s.deployment_id WHERE d.environment_id=e.id AND s.status IN ('pending','running')) AS nonterminal_steps
  FROM public.deployment_environments e WHERE e.id=$1`;
 const result=await sql.transaction(tx=>[...Object.entries(SEALED_CELL_OWNERSHIP_SQL_V3).map(([kind,statement])=>tx.query(statement,kind==="searchPath"?[]:[env])),tx.query(extra,[env])],
  {isolationLevel:"Serializable",readOnly:true,deferrable:true,fullResults:true,fetchOptions:{signal}});signal.throwIfAborted();
 if(!Array.isArray(result)||result.length!==10||result[1].rows.length!==1||result[2].rows.length!==1||result[9].rows.length!==1)throw Error("FAILED_BIRTH_PRESTATE_RESPONSE_INVALID");
 const e=result[1].rows[0],c=result[2].rows[0],m=result[9].rows[0],certFields=["deployment_id","environment_id","app_instance_id","original_row_sha256","original_plan_bytes_sha256","original_plan_hash","business_state_sha256","approved_registration_sha256","protection_schema_sha256","sealed_at"];
 const certificate=validateSealedCertificateV3({...Object.fromEntries(certFields.map(k=>[k,c[k]])),sealed_at:Number(c.sealed_at)});
 // Operator prestate may use the existing owner connection, but ONLY in READ
 // ONLY. Do not mislabel owner membership as historical evidence corruption.
 // The actual runtime source still requires the limited non-owner reader.
 const sealChecks={certificateSha:await sha256Hex(certificate)===REGISTERED_SEALED_CERTIFICATE_SHA256_V3,fence:c.fence_sealed===true&&Number(c.fence_sealed_at)===certificate.sealed_at&&Number(c.fence_revision)>0,
  originalRow:c.live_row_sha256===certificate.original_row_sha256,originalPlanBytes:c.live_plan_bytes_sha256===certificate.original_plan_bytes_sha256,originalPlanHash:c.live_plan_hash===certificate.original_plan_hash,
  protectionCatalog:c.live_protection_sha256===certificate.protection_schema_sha256,functionDefinition:m.fingerprint_definition_safe===true,
  functionBody:c.fingerprint_body_sha256==="16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66"};
 if(Object.values(sealChecks).some(v=>v!==true)){await save("seal-diagnostic.json",{checks:sealChecks,neonWrites:0});throw Error("FAILED_BIRTH_CURRENT_HISTORICAL_SEAL_CHANGED");}
 stage="FINAL_CODE_BINDING";for(const p of pins)if(await sha256Hex((await readFile(path.join(repo,p.file),"utf8")).replace(/\r\n/g,"\n"))!==p.sha256)throw Error("FAILED_BIRTH_FINAL_CODE_DRIFT");
 const report={schemaVersion:1,phase:"F3c7_FAILED_BIRTH_DATABASE_FENCE_PREPARATION",outcome:"NEON_READONLY_PRESTATE_VERIFIED_NOT_INSTALLED",observedAt:new Date().toISOString(),
  serverVersionNum:m.server_version,admissionState:e.admission_state,admissionEpoch:Number(e.admission_epoch),applyEnabled:Number(m.apply_enabled),
  failedFenceTablePresent:m.failure_table_present,failedFenceEntryPresent:m.failure_entry_present,failedAdmissionStatePresent:m.failure_state_present,
  historicalCertificateSha256:REGISTERED_SEALED_CERTIFICATE_SHA256_V3,historicalProtectionSha256:certificate.protection_schema_sha256,historicalSealCurrentVerified:true,
  operatorFingerprintNonOwnerPredicateSatisfied:c.fingerprint_function_safe===true,operatorPrestateIsNotLimitedReaderRuntimeProof:true,
  rawCounts:{activeTenant:result[3].rows.length,association:result[4].rows.length,capacity:result[5].rows.length,nonterminalDeployment:result[6].rows.length,
   liveResource:result[7].rows.length,nonterminalSchedule:result[8].rows.length,nonterminalJob:Number(m.nonterminal_jobs),nonterminalStep:Number(m.nonterminal_steps)},
  old36CodeSha256:previous.codeSha256,codeSha256,boundFileCount:pins.length,readOnlySerializableDeferrable:true,certifiedFailedBirthProofProduced:false,
  schemaInstallationAuthorized:false,roleGrantAuthorized:false,fenceWriteAuthorized:false,cloudDeleteAuthorized:false,executableApprovalManifestCreated:false,
  awsCalls:0,lambdaInvocations:0,secretValueReads:0,neonWrites:0,oldAwsAbsenceEvidenceNotRefreshed:true,runtimeEnabled:false};
 const reportFileSha256=await save("failed-birth-prestate-review.json",report);console.log(JSON.stringify({...report,reportFileSha256,output:await realpath(out)},null,2));
}catch(e){const report={outcome:"FAILED_BIRTH_READONLY_PRESTATE_INCOMPLETE",stage,safeCode:/^[A-Z0-9_]{4,120}$/.test(String(e.message))?e.message:String(e.name??"ProviderError").replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,100),
  noProviderDiagnosticsPersisted:true,neonWrites:0,awsCalls:0,cloudDeleteAuthorized:false};await save("read-only-failure.json",report);console.log(JSON.stringify(report));process.exitCode=1;}
