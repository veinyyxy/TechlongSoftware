import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NeonSealedCellOwnershipSourceV3, SEALED_CELL_OWNERSHIP_SQL_V3, type SealedPlanCertificateV1 } from "../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts";
import type { NeonSerializableSnapshotSqlClient } from "../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";

const target="dep_d00144511731f1c20991aa56",instance="app_fb1962e93a9a4cc2acf046170593d9e3",environment="env_aws_sandbox_ca_central_1";
const cert:SealedPlanCertificateV1={deployment_id:target,environment_id:environment,app_instance_id:instance,
 original_row_sha256:"a".repeat(64),original_plan_bytes_sha256:"b".repeat(64),original_plan_hash:"c".repeat(64),business_state_sha256:"d".repeat(64),
 approved_registration_sha256:"e".repeat(64),protection_schema_sha256:"f".repeat(64),sealed_at:1000};
const bodySha="16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66";
const input=()=>({accountId:"402010193138" as const,region:"ca-central-1" as const,cellId:"cell-sandbox-1" as const,environmentId:environment as "env_aws_sandbox_ca_central_1",signal:new AbortController().signal});
function fixture(change?:(results:{rows:Record<string,unknown>[]}[])=>void){
 const results=[{rows:[{search_path:"pg_catalog",row_security:"off"}]},{rows:[{environment_id:environment,account_id:"402010193138",region:"ca-central-1",cell_key:"cell-sandbox-1",
  admission_state:"draining",admission_epoch:"1",admission_fence_sha256:"1".repeat(64),admission_provision_operation_hash:"2".repeat(64),
  admission_stack_id:"arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012",
  admission_cell_expires_at:"2000",admission_changed_at:"2001",observed_at:"3000",reader_role:"techlong_cell_cleanup_reader",limited_reader:true,no_owner_or_table_write:true}]},
  {rows:[{...cert,sealed_at:"1000",fence_sealed:true,fence_sealed_at:"1000",fence_revision:"3",live_row_sha256:cert.original_row_sha256,
   live_plan_bytes_sha256:cert.original_plan_bytes_sha256,live_plan_hash:cert.original_plan_hash,fingerprint_body_sha256:bodySha,fingerprint_function_safe:true,live_protection_sha256:cert.protection_schema_sha256}]},
  {rows:[{id:instance}]},{rows:[{instance_id:instance,deployment_id:target}]},{rows:[]},{rows:[{id:target}]},{rows:[]},{rows:[]}];
 change?.(results);
 let reads=0;
 const sql:NeonSerializableSnapshotSqlClient={async transaction(build,settings){
  reads++;assert.equal(settings.readOnly,true);assert.equal(settings.isolationLevel,"Serializable");assert.equal(settings.deferrable,true);
  const statements=build({query:(statement,values)=>({queryData:{statement,values}})});assert.equal(statements.length,9);
  assert.deepEqual(statements[0].queryData,{statement:SEALED_CELL_OWNERSHIP_SQL_V3.searchPath,values:[]});
  return structuredClone(results);
 }};
 return {source:new NeonSealedCellOwnershipSourceV3(sql,cert),results,reads:()=>reads};
}
test("v3 classifies only the exact sealed old plan and binds raw witnesses without activating deletion",async()=>{
 const f=fixture();assert.equal(f.reads(),0);const snap=await f.source.readCertifiedSerializableSnapshot(input());
 assert.deepEqual(snap.activeTenantIds,[]);assert.deepEqual(snap.nonterminalDeploymentIds,[]);assert.deepEqual(snap.rawOwnershipWitness.nonterminalDeploymentIds,[target]);
 assert.equal(snap.runtimeActivationAuthorized,false);assert.equal(snap.schemaVersion,3);assert.match(snap.ownershipStateSha256,/^[a-f0-9]{64}$/);
 assert.equal("readSerializableReadOnlySnapshot" in f.source,false);assert.throws(()=>snap.sealedCertificates.push(cert),TypeError);
});
test("every future unsealed deployment remains visible, including an active instance linked to a terminal deployment",async()=>{
 const f=fixture(r=>{r[4].rows.push({instance_id:instance,deployment_id:"dep_future"});r[4].rows.sort((a,b)=>String(a.deployment_id).localeCompare(String(b.deployment_id)));
  r[6].rows.push({id:"dep_future"});r[6].rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)));});
 const snap=await f.source.readCertifiedSerializableSnapshot(input());assert.deepEqual(snap.activeTenantIds,[instance]);assert.deepEqual(snap.nonterminalDeploymentIds,["dep_future"]);
 f.results[6].rows=[{id:target}];const terminal=await f.source.readCertifiedSerializableSnapshot(input());assert.deepEqual(terminal.activeTenantIds,[instance]);
});
test("certificate bytes, helper body, live guards, fence and reader privilege mismatches fail closed",async()=>{
 for(const [key,value] of [["live_row_sha256","0".repeat(64)],["fingerprint_body_sha256","0".repeat(64)],["live_protection_sha256","0".repeat(64)],["fence_sealed",false],["fingerprint_function_safe",false]] as const){
  const f=fixture(r=>{r[2].rows[0][key]=value;});await assert.rejects(f.source.readCertifiedSerializableSnapshot(input()));
 }
 for(const key of ["limited_reader","no_owner_or_table_write"]){const f=fixture(r=>{r[1].rows[0][key]=false;});await assert.rejects(f.source.readCertifiedSerializableSnapshot(input()));}
 const missing=fixture(r=>{r[2].rows=[];});await assert.rejects(missing.source.readCertifiedSerializableSnapshot(input()));
});
test("resources, capacity and schedules are never filtered by a certificate and change the state hash",async()=>{
 const zero=await fixture().source.readCertifiedSerializableSnapshot(input());
 for(const index of [5,7,8]){const f=fixture(r=>{r[index].rows=[{id:"live_1"}];});const snap=await f.source.readCertifiedSerializableSnapshot(input());
  assert.notEqual(snap.ownershipStateSha256,zero.ownershipStateSha256);
  assert.deepEqual(index===5?snap.activeCapacityReservationIds:index===7?snap.liveTenantResourceIds:snap.nonterminalTenantCleanupScheduleIds,["live_1"]);
 }
});
test("incomplete/foreign associations and unexpected certificates cannot hide tenants",async()=>{
 for(const mutate of [(r:{rows:Record<string,unknown>[]}[])=>{r[4].rows=[];},(r:{rows:Record<string,unknown>[]}[])=>{r[4].rows[0].instance_id="other_instance";}]){
  const f=fixture(mutate);await assert.rejects(f.source.readCertifiedSerializableSnapshot(input()));
 }
 assert.throws(()=>new NeonSealedCellOwnershipSourceV3({transaction:async()=>[]},{...cert,unreviewed:true} as SealedPlanCertificateV1));
});
test("fingerprint body pin matches the unregistered SQL and source never invokes the mutable helper",()=>{
 const sql=readFileSync(new URL("../ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql",import.meta.url),"utf8").replace(/\r\n/g,"\n");
 const body=sql.match(/CREATE FUNCTION public\.sealed_plan_protection_hash_v1\(\)[\s\S]*? AS \$\$([\s\S]*?)\$\$;/)![1];
 assert.equal(createHash("sha256").update(body).digest("hex"),bodySha);
 assert.doesNotMatch(SEALED_CELL_OWNERSHIP_SQL_V3.certificate,/public\.sealed_plan_protection_hash_v1\(\)\s+AS/i);
 assert.match(SEALED_CELL_OWNERSHIP_SQL_V3.certificate,/WITH functions AS/);
});
