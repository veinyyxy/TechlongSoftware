// Actual fresh owned PostgreSQL 16.14 TLS cluster. No .env, Neon/AWS connection,
// production migration runner, customer credentials or Docker Desktop.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { NeonFailedCellBirthFenceWriterV1, decodeFailedCellBirthFenceV1 } from "../../../lib/deployments/execution/failed-cell-birth-fence-v1.ts";
import { NeonFailedCellBirthSourceV1, assertCertifiedFailedCellBirthSnapshotV1, FAILED_BIRTH_ENVIRONMENT_IDENTITY_V1, FAILED_BIRTH_PROTECTION_CATALOG_V1 } from "../../../lib/deployments/execution/neon-failed-cell-birth-source-v1.ts";
import { SEALED_PLAN_CATALOG_READ_V1 } from "../../../lib/deployments/execution/sealed-plan-catalog-read-v1.ts";

const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== "--out" || args[2] !== "--pg-bin" || args[4] !== "--python" || !/^techlong-f3c7-failed-birth-pg16-[a-z0-9-]+$/.test(path.basename(args[1]))) throw Error("FRESH_OWNED_FAILED_BIRTH_PG16_REQUIRED");
const require = createRequire(import.meta.url), { withIsolatedPg16 } = require("E:/NodejsProject/SpeedFeast_Backend_main/scripts/lib/isolated-pg16-fixture.js");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), hash = value => createHash("sha256").update(value).digest("hex"), env = "env_aws_sandbox_ca_central_1";
const files = ["ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-fence.sql", "ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql", "ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql",
 "ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql", "db/postgres-schema.sql"];
const contents = await Promise.all(files.map(async file => (await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")));
const target = "dep_d00144511731f1c20991aa56", instance = "app_fb1962e93a9a4cc2acf046170593d9e3";
await withIsolatedPg16({ output: args[1], bin: args[3], python: args[5], receiptKind: "sessions" }, async context => {
 const { managementClient: c, connect, receipt, output } = context, proofs = [], prove = name => { proofs.push(name); };
 async function readCatalog(statement) { await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
  try { await c.query("SET LOCAL search_path=pg_catalog"); const result=await c.query(statement); await c.query("COMMIT"); return result; }
  catch(e) { await c.query("ROLLBACK"); throw e; }
 }
 receipt.phase = "BASE_AND_SYNTHETIC_BUSINESS"; await c.query(contents[4]);
 await c.query(`INSERT INTO users(id,email,name,created_at,updated_at) VALUES ('fb_user','fb-user@example.invalid','fixture',1,1);
 INSERT INTO products(id,name,slug,created_at,updated_at) VALUES ('fb_product','fixture','fb-product',1,1);
 INSERT INTO app_instance_templates(id,product_id,name,created_at,updated_at) VALUES ('fb_template','fb_product','fixture',1,1);
 INSERT INTO app_instance_template_versions(id,template_id,version,status,created_at,updated_at) VALUES ('fb_version','fb_template',1,'published',1,1);
 INSERT INTO plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at) VALUES ('fb_plan','fb_product','fb_version','fixture',1,'USD','month',1,1);
 INSERT INTO workspaces(id,name,owner_id,created_at,updated_at) VALUES ('fb_workspace','fixture','fb_user',1,1);
 INSERT INTO subscriptions(id,workspace_id,product_id,plan_id,template_version_id,status,current_period_start,current_period_end,created_by_user_id,created_at,updated_at)
 VALUES ('fb_subscription','fb_workspace','fb_product','fb_plan','fb_version','active',1,9999999999999,'fb_user',1,1);
 INSERT INTO app_instances(id,workspace_id,product_id,subscription_id,template_version_id,name,slug,access_url,tenant_key,created_by_user_id,created_at,updated_at)
 VALUES ('${instance}','fb_workspace','fb_product','fb_subscription','fb_version','fixture','fb-old','https://example.invalid','fb-old','fb_user',1,1);
 INSERT INTO app_instance_deployments(id,app_instance_id,subscription_id,driver,workflow_version,cell_key,deployment_profile_key,mode,status,desired_plan,plan_hash,idempotency_key,created_at,updated_at,environment_id)
 VALUES ('${target}','${instance}','fb_subscription','aws_ecs_cell','v1','cell-demo-1','standard-v1','plan_only','planned',
 '{"safety":{"applyEnabled":false,"createsAwsResources":false,"storesSecretValues":false}}',repeat('b',64),'fb-old',1,1,'${env}');`);
 receipt.phase = "ORIGINAL_SEAL"; await c.query("BEGIN"); await c.query(contents[2]);
 const pre = (await c.query(`SELECT to_jsonb(d)::text AS row,d.desired_plan,d.plan_hash,jsonb_build_object('instanceId',i.id,'instanceStatus',i.status,'instanceUpdatedAt',i.updated_at,
 'subscriptionId',s.id,'subscriptionStatus',s.status)::text AS business FROM app_instance_deployments d JOIN app_instances i ON i.id=d.app_instance_id
 LEFT JOIN subscriptions s ON s.id=d.subscription_id WHERE d.id=$1`, [target])).rows[0];
 // This trusted, newly installed local fixture helper uses pg_catalog. The
 // subsequent independent catalog reads use that SAME deparser search path.
 const protectionBefore = (await c.query("SELECT public.sealed_plan_protection_hash_v1() AS digest")).rows[0].digest;
 await c.query(`INSERT INTO public.deployment_plan_only_isolations(deployment_id,environment_id,app_instance_id,original_row_sha256,original_plan_bytes_sha256,original_plan_hash,
 business_state_sha256,approved_registration_sha256,protection_schema_sha256,sealed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(extract(epoch FROM transaction_timestamp())*1000)::bigint)`,
 [target,env,instance,hash(pre.row),hash(pre.desired_plan),pre.plan_hash,hash(pre.business),"a".repeat(64),protectionBefore]); await c.query("COMMIT");
 const certificateRaw = (await c.query("SELECT * FROM deployment_plan_only_isolations")).rows[0], certificate = { ...certificateRaw, sealed_at: Number(certificateRaw.sealed_at) };
 const originalBytes = canonicalJson(certificateRaw), businessBefore = pre.row;
 await c.query(contents[3]);
 receipt.phase = "FAILED_BIRTH_SCHEMA_AND_GRANTS_IN_OWNED_DB";
 await c.query("BEGIN"); await c.query(contents[0]); await c.query(contents[1]); await c.query("COMMIT");
 assert.equal((await readCatalog(SEALED_PLAN_CATALOG_READ_V1)).rows[0].live_protection_sha256, protectionBefore);
 assert.equal(canonicalJson((await c.query("SELECT * FROM deployment_plan_only_isolations")).rows[0]), originalBytes);
 assert.equal((await c.query("SELECT to_jsonb(d)::text AS row FROM app_instance_deployments d WHERE id=$1",[target])).rows[0].row,businessBefore);
 prove("schemaAndGrantCandidatePreserveHistoricalCertificateAndFullOriginalCatalog");
 const environmentIdentitySha256 = (await c.query(FAILED_BIRTH_ENVIRONMENT_IDENTITY_V1,[env])).rows[0].identity_sha256;
 const approvedProtectionSha256 = (await readCatalog(FAILED_BIRTH_PROTECTION_CATALOG_V1)).rows[0].protection_sha256;
 const intent = { schemaVersion: 1, protocol: "failed-cell-birth-exclusion-fence-v1", accountId: "402010193138", region: "ca-central-1", cellId: "cell-sandbox-1", environmentId: env,
 birthIntentSha256: "a".repeat(64), planSha256: "b".repeat(64), templateCanonicalSha256: "c".repeat(64), stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012",
 ownerDeploymentId: "local_failed_birth_fixture", generation: 1, provisionEpoch: 1, failureInventorySha256: "d".repeat(64), failedPhase: "PAID", failedStackStatus: "UPDATE_FAILED",
 cellExpiresAt: Date.now()+10800000, expectedAdmissionEpoch: 0, environmentIdentitySha256 };
 const fenceSha256 = await sha256Hex(intent); await decodeFailedCellBirthFenceV1(intent, fenceSha256);
 const request = [canonicalJson(intent), fenceSha256], call = "SELECT public.begin_failed_cell_birth_fence_v1($1,$2) AS fence_sha256";
 async function negative(statement, values, expected="55000") {
  await c.query("SAVEPOINT negative"); let error; try { await c.query(statement,values); } catch(e) { error=e; }
  await c.query("ROLLBACK TO SAVEPOINT negative"); await c.query("RELEASE SAVEPOINT negative"); assert.ok(error,"guard did not reject"); assert.equal(error.code,expected);
 }
 receipt.phase = "INTENT_VALIDATION_AND_DIRECT_TRANSITION_REJECTION";
 await c.query("BEGIN"); await negative(call,[request[0],"f".repeat(64)]);
 const wrong = {...intent,cellExpiresAt:null}; await negative(call,[canonicalJson(wrong),await sha256Hex(wrong)]);
 await negative("UPDATE deployment_environments SET admission_state='failed_unadmitted',admission_epoch=1,admission_fence_sha256=$1,admission_stack_id=$2,admission_cell_expires_at=$3,admission_changed_at=(extract(epoch FROM transaction_timestamp())*1000)::bigint WHERE id=$4",
 [fenceSha256,intent.stackId,intent.cellExpiresAt,env]); await c.query("ROLLBACK");
 prove("wrongHashNullFieldsAndDirectFailedTransitionRejectWithoutConsumingSlot");
 // A separate unsealed, suspended fixture can reserve capacity. It does not
 // alias the protected old instance or make raw ownership counts disappear.
 receipt.phase = "SEED_COMPETING_TENANT";
 await c.query(`INSERT INTO workspaces(id,name,owner_id,created_at,updated_at) VALUES ('fb_new_workspace','fixture','fb_user',1,1);
 INSERT INTO subscriptions(id,workspace_id,product_id,plan_id,template_version_id,status,current_period_start,current_period_end,created_by_user_id,created_at,updated_at)
 VALUES ('fb_new_subscription','fb_new_workspace','fb_product','fb_plan','fb_version','canceled',1,9999999999999,'fb_user',1,1);
 INSERT INTO app_instances(id,workspace_id,product_id,subscription_id,template_version_id,name,slug,access_url,tenant_key,created_by_user_id,status,created_at,updated_at)
 VALUES ('fb_new_instance','fb_new_workspace','fb_product','fb_new_subscription','fb_version','fixture','fb-new','https://example.invalid','fb-new','fb_user','suspended',1,1);
 INSERT INTO app_instance_deployments(id,app_instance_id,subscription_id,driver,workflow_version,cell_key,deployment_profile_key,mode,status,desired_plan,plan_hash,idempotency_key,created_at,updated_at,environment_id)
 VALUES ('fb_new_deployment','fb_new_instance','fb_new_subscription','aws_ecs_cell','v1','cell-sandbox-1','standard-v1','plan_only','canceled','{}',repeat('c',64),'fb-new',1,1,'${env}');`);
 const reserve = "INSERT INTO deployment_environment_capacity_reservations(deployment_id,environment_id,slot,reserved_at) VALUES ('fb_new_deployment',$1,1,1)";
 await c.query("BEGIN"); await c.query(reserve,[env]); await negative(call,request); await c.query("ROLLBACK");
 prove("existingCapacityPreventsFailedFenceRatherThanCancelingCustomerState");
 receipt.phase = "ACTUAL_ROW_LOCK_RACE";
 const other = await connect(), observer = await connect();
 await c.query("BEGIN"); await c.query(call,request);
 const pid = (await other.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
 const attempted = other.query(reserve,[env]).then(()=>({accepted:true}),e=>({accepted:false,code:e.code}));
 let contended=false;
 for(let n=0;n<40;n++){if((await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.wait_event_type==='Lock'){contended=true;break;}await new Promise(r=>setTimeout(r,50));}
 assert.equal(contended,true,"actual row lock was not observed"); await c.query("COMMIT");
 const denied = await attempted; assert.equal(denied.accepted,false); assert.equal(denied.code,"55000"); await other.end(); await observer.end();
 prove("concurrentCapacityInsertWaitsForEnvironmentFenceAndThenRejects");
 const e = (await c.query("SELECT admission_state,admission_epoch,admission_provision_operation_hash,admission_cell_expires_at,admission_changed_at FROM deployment_environments WHERE id=$1",[env])).rows[0];
 assert.equal(e.admission_state,"failed_unadmitted"); assert.equal(e.admission_provision_operation_hash,null); assert.ok(Number(e.admission_changed_at)<Number(e.admission_cell_expires_at));
 prove("earlyFailureIsNotDueDrainOrFabricatedProvisionHash");
 receipt.phase = "REAL_LIMITED_READER_SERIALIZABLE_CERTIFICATION";
 // Real authentication, not SET ROLE through the creator's ADMIN membership
 // (PG16 deliberately grants the creator no SET/INHERIT by default).
 const readerPassword=randomBytes(32).toString("base64url");
 await c.query(`ALTER ROLE techlong_cell_cleanup_reader LOGIN PASSWORD '${readerPassword}'`);
 const sql = { async transaction(builder,options) {
   assert.equal(options.isolationLevel,"Serializable"); assert.equal(options.readOnly,true); assert.equal(options.deferrable,true);
   const client = await connect("cell_admin","techlong_cell_cleanup_reader",readerPassword,true); try { await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
     const queries = builder({query:(statement,values=[])=>({statement,values})}), result=[];
     for(const query of queries){options.fetchOptions.signal.throwIfAborted();result.push(await client.query(query.statement,query.values));}
     await client.query("COMMIT");return result;
   } finally { await client.end(); }
 } };
 const source = new NeonFailedCellBirthSourceV1(sql,certificate,approvedProtectionSha256), read = () => source.readCertifiedUnadmittedSnapshot({intent,fenceSha256,signal:AbortSignal.timeout(30000)});
 const certified = await read(); assertCertifiedFailedCellBirthSnapshotV1(certified,Date.now());
 assert.equal(certified.rawWitness.activeTenantIds.length,1); assert.equal(certified.rawWitness.deploymentIds.length,1); assert.equal(certified.activeTenantIds.length,0);
 assert.equal(certified.cloudDeletionAuthorized,false); assert.throws(()=>assertCertifiedFailedCellBirthSnapshotV1(structuredClone(certified),Date.now()));
 prove("realReadonlySerializableCensusPreservesRawSealedWitnessAndRejectsCopiedProof");
 receipt.phase = "PERMANENT_FENCE_AND_CATALOG_NEGATIVES";
 await c.query("BEGIN"); await negative("UPDATE deployment_failed_cell_birth_fences_v1 SET fence_sha256=fence_sha256 WHERE environment_id=$1",[env]);
 await negative("DELETE FROM deployment_failed_cell_birth_fences_v1 WHERE environment_id=$1",[env]); await negative("TRUNCATE deployment_failed_cell_birth_fences_v1",[]);
 await negative("UPDATE deployment_environments SET status='inactive' WHERE id=$1",[env]); await negative("DELETE FROM deployment_environments WHERE id=$1",[env]); await c.query("ROLLBACK");
 prove("committedFenceAndEnvironmentTombstoneCannotUpdateDeleteTruncateOrReset");
 await c.query("ALTER TABLE deployment_failed_cell_birth_fences_v1 DISABLE TRIGGER failed_birth_fence_mutation_v1");
 await assert.rejects(read,/PROTECTION_CHANGED/); await c.query("ALTER TABLE deployment_failed_cell_birth_fences_v1 ENABLE ALWAYS TRIGGER failed_birth_fence_mutation_v1");
 await read(); prove("disabledProtectionTriggerIsIndependentlyDetected");
 await c.query("GRANT EXECUTE ON FUNCTION begin_failed_cell_birth_fence_v1(text,text) TO techlong_cell_cleanup_reader"); await assert.rejects(read,/ROLE_INVALID/);
 await c.query("REVOKE EXECUTE ON FUNCTION begin_failed_cell_birth_fence_v1(text,text) FROM techlong_cell_cleanup_reader"); await read(); prove("broadenedReaderFunctionPrivilegeIsRejected");
 let submitted=0; const writer = new NeonFailedCellBirthFenceWriterV1({ async query(statement,values){submitted++;return c.query(statement,values);} });
 await assert.rejects(()=>writer.installOnce({intent,approvedFenceSha256:"f".repeat(64),signal:AbortSignal.timeout(10000)})); assert.equal(submitted,0);
 assert.equal((await writer.installOnce({intent,approvedFenceSha256:fenceSha256,signal:AbortSignal.timeout(10000)})).outcome,"FENCE_RESULT_UNCERTAIN_INSPECT_ONLY"); assert.equal(submitted,1);
 prove("wrongApprovalDoesNotSubmitAndOccupiedFenceIsInspectOnlyWithoutRetry");
 assert.equal((await readCatalog(SEALED_PLAN_CATALOG_READ_V1)).rows[0].live_protection_sha256,protectionBefore);
 assert.equal(canonicalJson((await c.query("SELECT * FROM deployment_plan_only_isolations")).rows[0]),originalBytes);
 const report = { schemaVersion:1,proofs,proofCount:proofs.length,postgresVersion:160014,actualTlsTransport:true,actualEnvironmentLockContended:true,
  historicalCatalogUnchanged:true,historicalCertificateUnchanged:true,earlyFailureWithoutProvisionHash:true,certificateSha256:await sha256Hex(certificate),
  failureProtectionSha256:approvedProtectionSha256,fenceSha256,sourceStateSha256:certified.stateSha256,syntheticAwsBirthNotCloudEvidence:true,
  sourceMutationPerformed:false,neonMutationPerformed:false,cloudMutationPerformed:false,installationAuthorized:false,cloudDeletionAuthorized:false,
  pins:files.map((file,n)=>({file,sha256:hash(contents[n])})),finishedAt:new Date().toISOString() };
 await writeFile(path.join(output,"failed-birth-proof.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx"});
 return {outcome:"FAILED_BIRTH_PG16_TRANSACTION_AND_CENSUS_PROOF_PASSED",receipt:report};
});
