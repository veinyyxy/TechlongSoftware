// Real PostgreSQL tests in a fresh, owned local TLS cluster only. No .env,
// DATABASE_URL, Neon, AWS clients, source database or production migration runner.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args=process.argv.slice(2);
const githubPg18=args.length===3&&args[0]==="--github-pg18"&&args[1]==="--out";
if(!githubPg18&&(args.length!==6||args[0]!=="--out"||args[2]!=="--pg-bin"||args[4]!=="--python"||
  !/^techlong-f3b3-sealed-pg16-[a-z0-9-]+$/.test(path.basename(args[1])))) throw new Error("FRESH_LOCAL_ISOLATION_FIXTURE_ARGUMENTS_REQUIRED");
const root=fileURLToPath(new URL("../../../",import.meta.url));
const require=createRequire(import.meta.url);
const withFixture=githubPg18?(await import("./lib/github-pg18-fixture.mjs")).withGithubPg18Fixture:
 require("E:/NodejsProject/SpeedFeast_Backend_main/scripts/lib/isolated-pg16-fixture.js").withIsolatedPg16;
const hash=value=>createHash("sha256").update(value).digest("hex");
const candidate=(await readFile(path.join(root,"ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql"),"utf8")).replace(/\r\n/g,"\n");
const base=(await readFile(path.join(root,"db/postgres-schema.sql"),"utf8")).replace(/\r\n/g,"\n");
const target="dep_d00144511731f1c20991aa56", instance="app_fb1962e93a9a4cc2acf046170593d9e3";
const sealSql=`INSERT INTO public.deployment_plan_only_isolations
 (deployment_id,environment_id,app_instance_id,original_row_sha256,original_plan_bytes_sha256,original_plan_hash,
 business_state_sha256,approved_registration_sha256,protection_schema_sha256,sealed_at)
 VALUES ($1,'env_aws_sandbox_ca_central_1',$2,$3,$4,$5,$6,$7,$8,(extract(epoch FROM transaction_timestamp())*1000)::bigint)`;
async function preimage(client){
 const row=(await client.query(`SELECT to_jsonb(d)::text AS row, d.desired_plan,d.plan_hash,
 jsonb_build_object('instanceId',i.id,'instanceStatus',i.status,'instanceUpdatedAt',i.updated_at,
 'subscriptionId',s.id,'subscriptionStatus',s.status)::text AS business
 FROM app_instance_deployments d JOIN app_instances i ON i.id=d.app_instance_id
 LEFT JOIN subscriptions s ON s.id=d.subscription_id WHERE d.id=$1`,[target])).rows[0];
 return {row:row.row,business:row.business,values:[target,instance,hash(row.row),hash(row.desired_plan),row.plan_hash,hash(row.business),"a".repeat(64),
 (await client.query("SELECT public.sealed_plan_protection_hash_v1() AS digest")).rows[0].digest]};
}
async function expectFailure(client,sql,values=[],state="55000",sealedMessage=true){
 await client.query("SAVEPOINT negative_case");
 let caught;
 try{await client.query(sql,values);}catch(error){caught=error;}
 await client.query("ROLLBACK TO SAVEPOINT negative_case");
 await client.query("RELEASE SAVEPOINT negative_case");
 assert(caught,"Expected the guard to reject the SQL statement");assert.equal(caught.code,state);
 if(sealedMessage)assert(String(caught.message).startsWith("sealed plan"));
}
async function waitForLock(observer,pid){
 for(let i=0;i<40;i++){
  if((await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.wait_event_type==="Lock")return;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Object.assign(new Error("Expected real row-lock contention"),{code:"ISOLATION_RACE_NOT_OBSERVED"});
}

await withFixture({output:githubPg18?args[2]:args[1],bin:args[3],python:args[5],receiptKind:"sessions"},async context=>{
 const c=context.managementClient, receipt=context.receipt;
 const proofs=[];const prove=label=>proofs.push(label);
 receipt.phase="BASE_SCHEMA";
 await c.query(base);
 receipt.phase="SYNTHETIC_BUSINESS_FIXTURE";
 await c.query(`INSERT INTO users(id,email,name,created_at,updated_at) VALUES ('seal_user','seal-fixture@example.invalid','fixture',1,1);
 INSERT INTO products(id,name,slug,created_at,updated_at) VALUES ('seal_product','fixture','seal-product',1,1);
 INSERT INTO app_instance_templates(id,product_id,name,created_at,updated_at) VALUES ('seal_template','seal_product','fixture',1,1);
 INSERT INTO app_instance_template_versions(id,template_id,version,status,created_at,updated_at) VALUES ('seal_version','seal_template',1,'published',1,1);
 INSERT INTO plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at)
 VALUES ('seal_plan','seal_product','seal_version','fixture',1,'USD','month',1,1);
 INSERT INTO workspaces(id,name,owner_id,created_at,updated_at) VALUES ('seal_workspace','fixture','seal_user',1,1);
 INSERT INTO subscriptions(id,workspace_id,product_id,plan_id,template_version_id,status,current_period_start,current_period_end,created_by_user_id,created_at,updated_at)
 VALUES ('seal_subscription','seal_workspace','seal_product','seal_plan','seal_version','active',1,9999999999999,'seal_user',1,1);
 INSERT INTO app_instances(id,workspace_id,product_id,subscription_id,template_version_id,name,slug,access_url,tenant_key,created_by_user_id,created_at,updated_at)
 VALUES ('${instance}','seal_workspace','seal_product','seal_subscription','seal_version','fixture','seal-fixture','https://example.invalid','seal-fixture','seal_user',1,1);
 INSERT INTO app_instance_deployments(id,app_instance_id,subscription_id,driver,workflow_version,cell_key,deployment_profile_key,mode,status,desired_plan,plan_hash,idempotency_key,created_at,updated_at,environment_id)
 VALUES ('${target}','${instance}','seal_subscription','aws_ecs_cell','v1','cell-demo-1','standard-v1','plan_only','planned',
 '{"safety":{"applyEnabled":false,"createsAwsResources":false,"storesSecretValues":false}}',repeat('b',64),'seal-old',1,1,'env_aws_sandbox_ca_central_1');`);
 const originalTrigger=(await c.query("SELECT pg_get_functiondef(t.tgfoid) AS definition FROM pg_trigger t WHERE tgname='app_instance_deployments_admission_reopen_fence'")).rows[0].definition;
 receipt.phase="INSTALL_CANDIDATE_ONLY_IN_OWNED_FIXTURE";
 await c.query("BEGIN");await c.query(candidate);await c.query("COMMIT");
 const before=await preimage(c);receipt.protectionCatalogSha256=before.values[7];
 prove("candidateDDLExecutesAgainstFullCurrentSchema");
 assert.equal((await c.query("SELECT pg_get_functiondef(t.tgfoid) AS definition FROM pg_trigger t WHERE tgname='app_instance_deployments_admission_reopen_fence'")).rows[0].definition,originalTrigger);
 prove("originalImmutableTriggerUnchanged");
 receipt.phase="GUARD_AND_PREIMAGE_NEGATIVE_CASES";
 await c.query("BEGIN");
 for(const index of [2,3,4,5,7]){const values=[...before.values];values[index]="c".repeat(64);await expectFailure(c,sealSql,values);}
 await c.query("ALTER TABLE deployment_jobs DISABLE TRIGGER aa_sealed_plan_deployment_jobs_v1");
 await expectFailure(c,"SELECT public.sealed_plan_protection_hash_v1()");await c.query("ROLLBACK");
 prove("byteBusinessAndGuardPinsFailClosed");
 await c.query("BEGIN");await c.query("ALTER TABLE deployment_plan_only_isolations DROP CONSTRAINT deployment_plan_only_isolations_pkey");
 assert.notEqual((await c.query("SELECT public.sealed_plan_protection_hash_v1() AS digest")).rows[0].digest,before.values[7]);
 await expectFailure(c,sealSql,before.values);await c.query("ROLLBACK");
 prove("changedTableConstraintInvalidatesApprovedProtectionPin");
 await c.query("BEGIN");await c.query("CREATE TABLE public.seal_uncovered_reference(deployment_id text REFERENCES app_instance_deployments(id))");
 await expectFailure(c,"SELECT public.sealed_plan_protection_hash_v1()");await c.query("ROLLBACK");
 prove("unknownDeploymentForeignKeyFailsClosed");
 await c.query("BEGIN");await c.query("CREATE SCHEMA seal_other;CREATE TABLE seal_other.extra_reference(deployment_id text REFERENCES public.app_instance_deployments(id))");
 await expectFailure(c,"SELECT public.sealed_plan_protection_hash_v1()");await c.query("ROLLBACK");
 prove("foreignSchemaReferenceAlsoFailsClosed");

 receipt.phase="WRITER_FIRST_REGISTRATION_RACE";
 const writer=await context.connect(),registrar=await context.connect();
 await writer.query("BEGIN");await writer.query("INSERT INTO deployment_jobs(id,deployment_id,job_type,dedupe_key,available_at,created_at,updated_at) VALUES ('racing_job',$1,'apply','racing',1,1,1)",[target]);
 await registrar.query("BEGIN");const registrarPid=(await registrar.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
 const registration=registrar.query(sealSql,before.values).then(()=>null,error=>error);
 await waitForLock(c,registrarPid);await writer.query("COMMIT");
 const blockedRegistration=await registration;assert.equal(blockedRegistration?.code,"55000");assert(String(blockedRegistration.message).startsWith("sealed plan"));
 await registrar.query("ROLLBACK");await c.query("DELETE FROM deployment_jobs WHERE id='racing_job'");
 prove("committedReferenceWriterBlocksRacingRegistration");

 receipt.phase="SEAL_FIRST_STALE_SNAPSHOT_RACES";
 const staleClients=[];
 for(const isolation of ["REPEATABLE READ","SERIALIZABLE"]){
  const stale=await context.connect();await stale.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  await stale.query("SELECT * FROM deployment_plan_only_isolation_fences");
  staleClients.push({client:stale,pid:(await stale.query("SELECT pg_backend_pid() AS pid")).rows[0].pid});
 }
 await c.query("BEGIN");await c.query(sealSql,before.values);
 const staleWrites=staleClients.map(({client},i)=>client.query("INSERT INTO deployment_jobs(id,deployment_id,job_type,dedupe_key,available_at,created_at,updated_at) VALUES ($1,$2,'apply',$1,1,1,1)",[`stale_job_${i}`,target]).then(()=>null,error=>error));
 for(const {pid} of staleClients)await waitForLock(registrar,pid);
 await c.query("COMMIT");
 for(let i=0;i<staleClients.length;i++){assert.equal((await staleWrites[i])?.code,"40001");await staleClients[i].client.query("ROLLBACK");}
 prove("staleRepeatableReadAndSerializableWritersCannotBypassSealAfterLockWait");
 receipt.phase="SEALED_ROW_AND_REFERENCE_GUARDS";
 const after=await preimage(c);assert.equal(after.row,before.row);assert.equal(after.business,before.business);
 prove("businessAndOriginalBytesPreservedAfterRegistration");
 await c.query("BEGIN");
 for(const [table,column] of [
  ["deployment_jobs","deployment_id"],["deployment_step_runs","deployment_id"],["deployment_cleanup_schedules","deployment_id"],
  ["deployment_environment_capacity_reservations","deployment_id"],["deployment_tenant_resources","owner_deployment_id"],
  ["deployment_tenant_resources","created_by_deployment_id"],["deployment_tenant_resource_events","deployment_id"],
  ["deployment_tenant_external_operations","owner_deployment_id"],["deployment_tenant_external_operation_events","deployment_id"],
  ["deployment_tenant_cleanup_runs","owner_deployment_id"]]){
   await expectFailure(c,`INSERT INTO public.${table}(${column}) VALUES ($1)`,[target]);
 }
 for(const sql of ["UPDATE app_instance_deployments SET updated_at=updated_at+1 WHERE id=$1","DELETE FROM app_instance_deployments WHERE id=$1",
  "UPDATE deployment_plan_only_isolations SET sealed_at=sealed_at+1 WHERE deployment_id=$1","DELETE FROM deployment_plan_only_isolations WHERE deployment_id=$1",
  "UPDATE deployment_plan_only_isolation_fences SET sealed=false,sealed_at=NULL,revision=revision+1 WHERE deployment_id=$1"])
  await expectFailure(c,sql,[target]);
 for(const sql of ["TRUNCATE deployment_plan_only_isolations","TRUNCATE app_instance_deployments CASCADE"])await expectFailure(c,sql);
 await c.query("ROLLBACK");prove("allTenReferenceColumnsAndPermanentEvidenceRejectMutation");

 receipt.phase="RESTRICTED_WRITER_AND_BUSINESS_CONTINUITY";
 await c.query(`CREATE ROLE seal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
 GRANT seal_runtime TO cell_admin WITH SET TRUE;
 GRANT USAGE ON SCHEMA public TO seal_runtime;
 GRANT SELECT,INSERT,UPDATE,DELETE ON app_instances,subscriptions,app_instance_deployments,deployment_jobs TO seal_runtime;
 GRANT SELECT,UPDATE(admission_state) ON deployment_environments TO seal_runtime;`);
 await c.query("BEGIN");await c.query("SET LOCAL ROLE seal_runtime");
 await expectFailure(c,"SELECT public.touch_sealed_plan_fence_v1(false)",[],"42501",false);
 await expectFailure(c,sealSql,before.values,"42501",false);
 await expectFailure(c,"UPDATE app_instance_deployments SET updated_at=2 WHERE id=$1",[target]);
 await c.query("UPDATE app_instances SET status='active',updated_at=2 WHERE id=$1",[instance]);
 await c.query("UPDATE subscriptions SET status='paused',updated_at=2 WHERE id='seal_subscription'");
 await c.query(`INSERT INTO app_instance_deployments(id,app_instance_id,subscription_id,driver,workflow_version,cell_key,deployment_profile_key,
 mode,status,desired_plan,plan_hash,idempotency_key,created_at,updated_at,environment_id,configuration_hash)
 VALUES ('dep_seal_future_live',$1,'seal_subscription','aws_ecs_cell','v1','cell-sandbox-1','standard-v1','aws_sandbox','queued',
 '{}',repeat('d',64),'seal-new',2,2,'env_aws_sandbox_ca_central_1',repeat('e',64))`,[instance]);
 await c.query("INSERT INTO deployment_jobs(id,deployment_id,job_type,dedupe_key,available_at,created_at,updated_at) VALUES ('future_job','dep_seal_future_live','apply','future',2,2,2)");
 await c.query("COMMIT");
 const membership=(await c.query(`SELECT count(DISTINCT i.id)::int AS active FROM app_instances i JOIN app_instance_deployments d ON d.app_instance_id=i.id
 WHERE d.environment_id='env_aws_sandbox_ca_central_1' AND i.status IN ('pending','active')
 AND NOT EXISTS(SELECT 1 FROM deployment_plan_only_isolations r WHERE r.deployment_id=d.id)`)).rows[0];
 assert.equal(membership.active,1);assert.equal((await c.query("SELECT to_jsonb(d)::text AS row FROM app_instance_deployments d WHERE id=$1",[target])).rows[0].row,before.row);
 prove("restrictedWriterCannotRegisterAndBusinessStatusNewDeploymentRemainAllowed");
 if(githubPg18){
  receipt.phase="CERTIFIED_SOURCE_V3";
  const {NeonSealedCellOwnershipSourceV3}=await import("../../../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts");
  await c.query(`CREATE ROLE techlong_cell_cleanup_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    GRANT techlong_cell_cleanup_reader TO cell_admin WITH SET TRUE;
    GRANT USAGE ON SCHEMA public TO techlong_cell_cleanup_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO techlong_cell_cleanup_reader;`);
  const registered=(await c.query("SELECT * FROM deployment_plan_only_isolations WHERE deployment_id=$1",[target])).rows[0];
  registered.sealed_at=Number(registered.sealed_at);
  await c.query(`UPDATE deployment_environments SET admission_state='draining',admission_epoch=1,admission_fence_sha256=repeat('1',64),
    admission_provision_operation_hash=repeat('2',64),admission_stack_id='arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012',
    admission_cell_expires_at=(extract(epoch FROM transaction_timestamp())*1000)::bigint-60000,
    admission_changed_at=(extract(epoch FROM transaction_timestamp())*1000)::bigint WHERE id='env_aws_sandbox_ca_central_1'`);
  const sql={async transaction(build,settings){
    assert.equal(settings.readOnly,true);assert.equal(settings.isolationLevel,"Serializable");assert.equal(settings.deferrable,true);
    const client=await context.connect();try{
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");await client.query("SET LOCAL ROLE techlong_cell_cleanup_reader");
      const queries=build({query:(statement,values)=>({statement,values})}),results=[];
      for(const q of queries)results.push(await client.query(q.statement,q.values));
      await client.query("COMMIT");return results;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{await client.end();}
  }};
  const source=new NeonSealedCellOwnershipSourceV3(sql,registered);
  const certifiedRead=()=>source.readCertifiedSerializableSnapshot({accountId:"402010193138",region:"ca-central-1",cellId:"cell-sandbox-1",
    environmentId:"env_aws_sandbox_ca_central_1",signal:AbortSignal.timeout(30000)});
  const visible=await certifiedRead();assert.deepEqual(visible.activeTenantIds,[instance]);
  assert.deepEqual(visible.nonterminalDeploymentIds,["dep_seal_future_live"]);assert.equal(visible.runtimeActivationAuthorized,false);
  assert.equal(typeof source.readSerializableReadOnlySnapshot,"undefined");
  prove("certifiedSourceV3KeepsFutureUnsealedDeploymentVisibleAsRestrictedReader");
  const savedFunction=(await c.query("SELECT pg_get_functiondef('public.sealed_plan_protection_hash_v1()'::regprocedure) AS definition")).rows[0].definition;
  await c.query(`CREATE OR REPLACE FUNCTION public.sealed_plan_protection_hash_v1() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
    AS $$BEGIN RAISE EXCEPTION 'CI_TRAP_MUTABLE_HELPER_EXECUTED';END;$$`);
  await assert.rejects(certifiedRead(),error=>error.code==="SEALED_SOURCE_CERTIFICATE_OR_PROTECTION_MISMATCH");
  await c.query(savedFunction);
  prove("certifiedSourceV3RejectsSubstitutedFingerprintHelperWithoutExecutingIt");
  await c.query("UPDATE app_instance_deployments SET status='canceled' WHERE id='dep_seal_future_live';UPDATE app_instances SET status='suspended' WHERE id='"+instance+"'");
  const zero=await certifiedRead();assert.deepEqual(zero.activeTenantIds,[]);assert.deepEqual(zero.nonterminalDeploymentIds,[]);
  assert.deepEqual(zero.rawOwnershipWitness.nonterminalDeploymentIds,[target]);
  prove("certifiedSourceV3BindsRawAndClassifiedOwnershipWithoutErasingOriginalRow");
 }
 receipt.phase="COMPLETE";
 const version=Number((await c.query("SELECT current_setting('server_version_num') AS version")).rows[0].version);
 assert.equal(version,githubPg18?180006:160014);
 const result={schemaVersion:1,outcome:githubPg18?"SEALED_PLAN_CANDIDATE_REAL_PG18_VERIFIED_NOT_INSTALLED":"SEALED_PLAN_CANDIDATE_REAL_PG16_VERIFIED_NOT_INSTALLED",candidateTextSha256:hash(candidate.replace(/\r\n/g,"\n")),
  baseSchemaTextSha256:hash(base.replace(/\r\n/g,"\n")),protectionCatalogSha256:receipt.protectionCatalogSha256,proofs,
  postgresVersion:version,fixtureDataOnly:true,neonMutationPerformed:false,sourceMutationPerformed:false,cloudMutationPerformed:false,
  migrationRegistered:false,productionRegistrationPerformed:false,ownershipSourceActivated:false,installationAuthorized:false,runtimeEnabled:false};
 await writeFile(path.join(context.output,"sealed-plan-verification.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
 return {outcome:result.outcome,receipt:{...result}};
});
