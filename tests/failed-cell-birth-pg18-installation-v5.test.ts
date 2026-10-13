import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256Hex, canonicalJson } from "../lib/deployments/execution/hash.ts";
import { registeredSealedCertificateV1 as certificate } from "./fixtures/registered-sealed-certificate-v1.ts";
import { FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4, FAILED_BIRTH_SCHEMA_SHA_V4, FAILED_BIRTH_GRANTS_SHA_V4,
  verifyFailedBirthInstallPoststateV4 } from "../lib/deployments/execution/failed-cell-birth-installation-v4.ts";
import { verifyPg18NotNullMappingsV5, verifyFailedBirthPg18PoststateV5, compileFailedBirthPg18ReviewV5,
  validateFailedBirthPg18ReviewV5, runReviewedFailedBirthPg18V5, FAILED_BIRTH_PG18_SCOPE_V5, FAILED_BIRTH_PG18_RISKS_V5,
  FAILED_BIRTH_PRIOR_ATTEMPT_V5, type FailedBirthPg18ReadV5, type FailedBirthPg18ReviewV5 } from "../lib/deployments/execution/failed-cell-birth-pg18-installation-v5.ts";
type Row = Record<string, unknown>;
const table = "deployment_failed_cell_birth_fences_v1", env = "deployment_environments", at = 1791854000000,
  binding = { targetFingerprintSha256: "a".repeat(64), codeSha256: "b".repeat(64) };
const schema = (await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql", import.meta.url), "utf8")).replace(/\r\n/g,"\n"),
  grants = (await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql", import.meta.url), "utf8")).replace(/\r\n/g,"\n");
const names = ["enforce_deployment_environment_admission_transition", "reject_failed_cell_birth_fence_mutation_v1", "guard_failed_cell_birth_environment_v1", "begin_failed_cell_birth_fence_v1"];
const column = (relation: string, name: string, number: number) => ({ relation,name,number,type:name === "created_at"?"bigint":"text",not_null:true,identity:"",generated:"",default:null });
const constraint = (relation: string, name: string, type: string, columns: number[]): Row => ({ relation,name,type,columns,enforced:true,validated:true,deferrable:false,deferred:false,
  local:true,inheritance_count:0,parent_id:0,period:false,referenced_columns:null,referenced_relation:null,delete_action:" ",update_action:" ",match_type:" ",definition:`fixture ${type}` });
// Structural regression fixtures, NOT real PG18 installation/runtime proof.
async function fixture() {
  const cert = structuredClone(certificate),owner="fixture_owner",cols=[column(env,"id",1)];
  const envChecks: Row[] = ["deployment_environments_admission_state_check","deployment_environments_admission_consistency_check"].map(name => ({ ...constraint(env,name,"c",[2]),definition:"'open' 'draining'" })),
    envNotNull=constraint(env,"env_id_not_null","n",[1]);
  const role = (name: string) => ({name,rolcanlogin:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false,rolreplication:false,
    owner_member:false,grant_option:false,nontrigger_definer_access:false,memberships:[],rolinherit:false,sequence_access:false,schema_privileges:["public:USAGE"],
    ...structuredClone(FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4[name as keyof typeof FAILED_BIRTH_EXISTING_ROLE_PRIVILEGES_V4])});
  const legacy = { base:{preserved:{sealed:{identity:{role:owner,sessionRole:owner,version:180006,replicationRole:"origin",canCreatePublic:true},certificates:[cert],
    fence:{sealed:true},protectionSha256:cert.protection_schema_sha256,evidence:{originalRowSha256:cert.original_row_sha256,originalPlanBytesSha256:cert.original_plan_bytes_sha256,
      originalPlanHash:cert.original_plan_hash,businessStateSha256:cert.business_state_sha256,executionReferences:{jobs:0}},
    tables:[{name:env,owner_member:true,constraints:[],triggers:[{name:"deployment_environments_admission_transition"}]}]},management:{},catalog:[]},
    roles:[role("techlong_cell_cleanup_reader"),role("techlong_cell_drain")]},
    environmentState:{environment:{id:"env_aws_sandbox_ca_central_1",expected_account_id:"402010193138",region:"ca-central-1",cell_key:"cell-sandbox-1",kind:"aws_sandbox",driver:"aws_ecs_cell",
      base_domain:"sandbox.techlong.cloud",status:"active",apply_enabled:0,admission_state:"open",admission_epoch:0},jobs:0,steps:0,capacity:0,resources:0,schedules:0,other_deployments:0},
    objects:[{kind:"function",name:names[0],properties:{owner,acl:[]}},{kind:"trigger",name:"deployment_environments_admission_transition",properties:{definition:"fixture"}},
      ...envChecks.map(c=>({kind:"environment_constraint",name:c.name,properties:{type:c.type,validated:c.validated,definition:c.definition}}))],fenceRows:null,protectionSha256:"1".repeat(64) };
  const before = {legacy,columns:cols,constraints:[envNotNull,...envChecks]} as unknown as FailedBirthPg18ReadV5["state"],after=structuredClone(before);
  after.columns.push(...["environment_id","fence_json","fence_sha256","created_at"].map((n,i)=>column(table,n,i+1)));
  after.constraints.push(...after.columns.filter(c=>c.relation===table).map(c=>constraint(table,`${c.name}_not_null`,"n",[Number(c.number)])),
    ...Array.from({length:5},(_,i)=>constraint(table,`check_${i}`,"c",[i===4?3:Math.min(i+1,4)])),constraint(table,"pk","p",[1]),
    {...constraint(table,"fk","f",[1]),referenced_relation:"public.deployment_environments",referenced_columns:[1],delete_action:"r",update_action:"a",match_type:"s"});
  after.constraints=after.constraints.map(c=>c.relation===env && c.type==="c"?{...c,definition:"'open' 'draining' 'failed_unadmitted'"}:c).sort((a,b)=>String(a.relation).localeCompare(String(b.relation)) || String(a.name).localeCompare(String(b.name)));
  after.legacy.fenceRows=0;after.legacy.protectionSha256="2".repeat(64);
  const reader=after.legacy.base.roles[0];reader.table_privileges=[...(reader.table_privileges as string[]),`public.${table}:SELECT`].sort();
  reader.column_privileges=["deployment_jobs","deployment_step_runs"].flatMap(t=>["id","deployment_id","status"].map(c=>`public.${t}.${c}:SELECT`)).sort();
  after.legacy.base.roles[1].nontrigger_definer_access=true;
  const funcs=await Promise.all(names.map(async name=>({kind:"function",name,properties:{owner,acl:name===names[3]?[{grantee:"techlong_cell_drain",privilege:"EXECUTE",grantable:false}]:[],
    bodySha256:await sha256Hex(schema.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*? AS \\$\\$([\\s\\S]*?)\\$\\$;`))![1]),language:"plpgsql",config:["search_path=pg_catalog"],
    returns:name===names[3]?"text":"trigger",arguments:name===names[3]?"input_json text, input_sha256 text":"",definer:[names[2],names[3]].includes(name)}})));
  const triggers=[["failed_birth_fence_mutation_v1",table,names[1],27],["failed_birth_fence_truncate_v1",table,names[1],34],
    ["failed_birth_environment_mutation_v1",env,names[2],27],["failed_birth_environment_truncate_v1",env,names[2],34],
    ["deployment_environments_admission_transition",env,names[0],19]].map(([name,relation,fn,type])=>({kind:"trigger",name,properties:{table:relation,function:fn,type,enabled:"A",arguments:"",definition:"fixture"}}));
  after.legacy.objects=[...funcs,...triggers,...after.constraints.filter(c=>c.relation===env && c.type==="c").map(c=>({kind:"environment_constraint",name:c.name,properties:{type:c.type,validated:c.validated,definition:c.definition}})),
    {kind:"table",name:table,properties:{owner,kind:"r",rls:false,forceRls:false,
      columns:after.columns.filter(c=>c.relation===table).map(c=>({name:c.name,type:c.type,notNull:c.not_null,default:c.default})),
      constraints:after.constraints.filter(c=>c.relation===table).map(c=>({name:c.name,type:c.type,validated:c.validated,definition:c.definition})),
      acl:[{grantee:"techlong_cell_cleanup_reader",privilege:"SELECT",grantable:false}]}}];
  const read=async(state=after):Promise<FailedBirthPg18ReadV5>=>({state:structuredClone(state),stateSha256:await sha256Hex(state),legacyStateSha256:await sha256Hex(state.legacy),observedAt:at,
    transaction:{readOnly:"on",isolation:"serializable",deferrable:"on",searchPath:"pg_catalog"}});
  const unsigned={schemaVersion:5,protocol:"failed-cell-birth-pg18-reviewed-installation-v5",binding,reviewedAt:at,expiresAt:at+3600000,reviewedState:before,prestateSha256:await sha256Hex(before),
    schemaSqlSha256:FAILED_BIRTH_SCHEMA_SHA_V4,grantsSqlSha256:FAILED_BIRTH_GRANTS_SHA_V4,scope:FAILED_BIRTH_PG18_SCOPE_V5,risks:FAILED_BIRTH_PG18_RISKS_V5};
  const review={...unsigned,manifestSha256:await sha256Hex(unsigned)} as FailedBirthPg18ReviewV5;
  return {before,after,read,review};
}
test("PG18 eleven constraints pass precise mapping while unchanged v4 seven-total rule still rejects",async()=>{
  const f=await fixture(),r=await f.read();await assert.rejects(verifyFailedBirthInstallPoststateV4({state:r.state.legacy,stateSha256:r.legacyStateSha256,observedAt:at,transaction:r.transaction},f.before.legacy,schema),/TABLE_GUARDS_OR_ACL/);
  const p=await verifyFailedBirthPg18PoststateV5(r,f.before,schema);assert.deepEqual(p.pg18ConstraintTypeCounts,{n:4,c:5,p:1,f:1});assert.equal(p.actualRestrictedRuntimeProofProduced,false);
});
test("missing, duplicate, wrong-column, unvalidated or unenforced NOT NULL never normalize away",async()=>{
  const f=await fixture();for(const kind of ["missing","duplicate","column","validated","enforced","deferred"]){const a=structuredClone(f.after),n=a.constraints.find(c=>c.relation===table && c.type==="n")!;
    if(kind==="missing")a.constraints.splice(a.constraints.indexOf(n),1);if(kind==="duplicate")a.constraints.push(structuredClone(n));if(kind==="column")n.columns=[99];if(kind==="validated")n.validated=false;if(kind==="enforced")n.enforced=false;if(kind==="deferred")n.deferred=true;
    assert.throws(()=>verifyPg18NotNullMappingsV5(a.columns,a.constraints,table));}
});
test("correct total eleven is insufficient: unknown types, disabled CHECK/FK and deferred keys reject",async()=>{
  const f=await fixture();for(const change of [{type:"u"},{enforced:false},{validated:false},{deferrable:true},{period:true}]){const a=structuredClone(f.after);Object.assign(a.constraints.find(c=>c.relation===table && c.type==="c")!,change);await assert.rejects(verifyFailedBirthPg18PoststateV5(await f.read(a),f.before,schema));}
});
test("foreign/primary column mapping, referenced environment and RESTRICT actions stay exact",async()=>{
  const f=await fixture();for(const change of [{columns:[2]},{referenced_columns:[2]},{referenced_relation:"public.other"},{delete_action:"c"},{update_action:"c"},{match_type:"f"}]){const a=structuredClone(f.after);Object.assign(a.constraints.find(c=>c.relation===table && c.type==="f")!,change);await assert.rejects(verifyFailedBirthPg18PoststateV5(await f.read(a),f.before,schema));}
  const a=structuredClone(f.after);a.constraints.find(c=>c.relation===table && c.type==="p")!.columns=[2];await assert.rejects(verifyFailedBirthPg18PoststateV5(await f.read(a),f.before,schema));
});
test("environment checks and untouched environment metadata cannot weaken or drift",async()=>{
  const f=await fixture();for(const kind of ["check","existing","column"]){const a=structuredClone(f.after);if(kind==="check")a.constraints.find(c=>c.relation===env && c.type==="c")!.enforced=false;
    if(kind==="existing")a.constraints.find(c=>c.relation===env && c.type==="n")!.validated=false;if(kind==="column")a.columns[0].not_null=false;
    await assert.rejects(verifyFailedBirthPg18PoststateV5(await f.read(a),f.before,schema));}
});
test("dual catalog disagreement and old permission/body/ACL checks remain blocking",async()=>{
  const f=await fixture();for(const kind of ["catalog","privilege","body","acl"]){const a=structuredClone(f.after);if(kind==="catalog"){const t=a.legacy.objects.find(o=>o.kind==="table")!.properties as Row;(t.constraints as Row[])[0].definition="changed";}
    if(kind==="privilege")(a.legacy.base.roles[0].table_privileges as string[]).push("public.deployment_jobs:UPDATE");if(kind==="body")(a.legacy.objects.find(o=>o.kind==="function")!.properties as Row).bodySha256="f".repeat(64);
    if(kind==="acl")((a.legacy.objects.find(o=>o.kind==="table")!.properties as Row).acl as Row[]).push({grantee:"PUBLIC",privilege:"SELECT",grantable:false});
    await assert.rejects(verifyFailedBirthPg18PoststateV5(await f.read(a),f.before,schema));}
});
test("synthetic prestate cannot impersonate the exact historical restored hash even with a claimed SHA",async()=>{
  const f=await fixture(),r=await f.read(f.before);r.legacyStateSha256=FAILED_BIRTH_PRIOR_ATTEMPT_V5.restoredLegacyStateSha256;
  await assert.rejects(compileFailedBirthPg18ReviewV5(r,binding,at,at),/PRIOR_RESTORATION/);
});
test("fresh cold manifest uses v5 protocol, preserves old slot and rejects old protocol, scope, risk and SQL drift",async()=>{
  const f=await fixture();await validateFailedBirthPg18ReviewV5(f.review,binding,schema,grants);
  assert.notEqual(f.review.scope.permanentSlot,FAILED_BIRTH_PRIOR_ATTEMPT_V5.consumedSlot);assert.equal(f.review.scope.preservesOriginalConsumedSlot,true);
  for(const change of [{schemaVersion:4},{protocol:"failed-cell-birth-schema-role-installation-v4"},{scope:{...f.review.scope,permanentSlot:FAILED_BIRTH_PRIOR_ATTEMPT_V5.consumedSlot}},{risks:{}}])
    await assert.rejects(validateFailedBirthPg18ReviewV5({...f.review,...change} as typeof f.review,binding,schema,grants));
  await assert.rejects(validateFailedBirthPg18ReviewV5(f.review,binding,schema+"\n",grants));
});
test("wrong SHA or expired fresh approval causes no transaction, evidence save or new slot",async()=>{
  const f=await fixture();for(const expired of [false,true]){const calls:string[]=[];await assert.rejects(runReviewedFailedBirthPg18V5({client:{async query(s){calls.push(s);return {rows:[]};}},review:f.review,approvedSha:expired?f.review.manifestSha256:"f".repeat(64),binding,schema,grants,
    now:()=>expired?at+3600000:at,readState:()=>f.read(f.before),verifyCodeAndPriorEvidence:async()=>undefined,claimFreshApprovedSlot:async()=>{calls.push("slot");},persistPrecommitEvidence:async()=>{calls.push("save");}}));assert.deepEqual(calls,[]);}
});
test("CLI and writer persist post-DDL evidence before validation, and new slot requires old consumed evidence and fresh approval",async()=>{
  const src=await readFile(new URL("../lib/deployments/execution/failed-cell-birth-pg18-installation-v5.ts",import.meta.url),"utf8"),cli=await readFile(new URL("../ops/aws-sandbox/scripts/review-failed-cell-birth-pg18-installation-v5.mjs",import.meta.url),"utf8");
  const save=src.indexOf('input.persistPrecommitEvidence("after-ddl", after)'),check=src.indexOf('await verifyFailedBirthPg18PoststateV5(after');assert.ok(save>0 && check>save);
  assert.match(src,/transaction && !commitAttempted/);assert.match(cli,/flag:"wx",flush:true/);assert.match(cli,/prior\.consumedSlotSha256/);assert.match(cli,/mode === "Review"/);assert.match(cli,/databaseWrites:0/);
  assert.doesNotMatch(cli,/unlink|rmSync|RESET SLOT|SET ROLE|GetSecretValueCommand|InvokeCommand/);assert.match(canonicalJson(FAILED_BIRTH_PG18_SCOPE_V5),/separateFreshHumanApprovalRequired/);
});
