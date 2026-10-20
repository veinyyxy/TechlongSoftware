import {createHash} from 'node:crypto';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {ROLE,SCHEMA,TABLE_COLUMNS} from './catalog.mjs';
export const I=Object.freeze({role:ROLE,schema:SCHEMA,sql:'ops/platform-controller-v6/install.sql',
  sqlSha256:'7ae2444c2f8719ad1434529eda35fa4c2c4cf7ed8a416a50530c0c0381f9d541',
  identityRecord:'ops/aws-sandbox/reviews/platform-identity-dispatch-v6.executed.json',
  identityProofSha256:'1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca',
  identityRun:'39312477081',slot:'F:/ChatGPT_workshop/techlong-w6f-control-install.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w6f-control-install.md',validMs:7*24*3600000});
export const SOURCE_FILES=['ops/platform-controller-review-v6/catalog.mjs','ops/platform-controller-review-v6/install.mjs',
  'ops/platform-controller-review-v6/local.mjs','tests/platform-control-install-v6.test.mjs',I.sql,I.riskFile,I.identityRecord,
  'lib/deployments/execution/hash.ts','ops/platform-identity-review-v6/publication.mjs','ops/platform-cloud-v6/workflows.mjs',
  'ops/platform-cloud-v6/contract.mjs','lib/deployments/controller-v6/contract.ts',
  'scripts/ci/verify-platform-cloud-publisher-pg-v6.mjs','.github/workflows/platform-cloud-candidate.yml'];
export const must=(v,c)=>{if(!v)throw Error('CONTROL_INSTALL_'+c);};
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function sqlContract(sql){
  must(typeof sql==='string'&&hash(sql)===I.sqlSha256&&sql.startsWith('-- CANDIDATE ONLY.')&&sql.includes('\nBEGIN;')&&sql.trimEnd().endsWith('COMMIT;'),'SQL_ENVELOPE');
  const functions=[...sql.matchAll(/CREATE FUNCTION deployment_control_v6\.(\w+)\(([^)]*)\)[\s\S]*?LANGUAGE (sql|plpgsql) SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS \$\$([\s\S]*?)\$\$;/g)]
    .map(m=>({name:m[1],types:m[2]?m[2].split(',').map(p=>p.trim().split(/\s+/).at(-1)).join(','):'',language:m[3],bodySha256:hash(m[4]),
      serviceExecute:!['publish_plan','attest_evidence'].includes(m[1])})).sort((a,b)=>a.name.localeCompare(b.name));
  must(functions.length===9&&new Set(functions.map(f=>f.name)).size===9,'SQL_FUNCTIONS');return {sqlSha256:hash(sql),functions};
}
export function assertAbsent(c){
  must(c.actor===c.session_actor&&c.installer?.name===c.actor&&c.installer.createRole===true&&c.installer_database_create===true&&
    Number(c.server_version_num)>=150000&&c.read_only==='on','INSTALLER');
  must(c.role===null&&c.schema===null&&c.functions.length===0&&c.tables.length===0&&c.memberships.length===0,'OCCUPIED');
  must(c.public_database_create===false&&c.public_schema_create===false&&c.public_business_grants.length===0&&
    c.business_tables?.map(t=>t.name).sort().join(',')==='app_instance_deployments,deployment_jobs,users','PUBLIC_OR_BUSINESS_LAYOUT');return c;
}
export function assertInstalled(c,contract,pre){
  must(c.actor===pre.actor&&c.session_actor===pre.session_actor&&c.database===pre.database&&c.installer.oid===pre.installer.oid&&
    c.read_only==='on'&&same(c.business_tables,pre.business_tables),'TARGET_DRIFT');
  const role=c.role;must(role?.name===ROLE&&['login','inherit','super','createRole','createDb','replication','bypassRls'].every(k=>role[k]===false),'ROLE_FLAGS');
  must(c.schema?.owner===c.installer.oid&&c.schema.publicGrants.length===0&&c.schema.serviceUsage===true&&c.schema.serviceCreate===false&&
    c.tables.length===3&&new Set(c.tables.map(t=>t.name)).size===3&&c.functions.length===9&&new Set(c.functions.map(f=>f.name)).size===9,'INSTALLED_LAYOUT');
  must(c.memberships.every(m=>m.role===ROLE&&m.member===c.actor&&m.admin===true)&&c.memberships.length<=1,'ROLE_MEMBERSHIPS');
  for(const t of c.tables)must(Object.hasOwn(TABLE_COLUMNS,t.name)&&t.kind==='r'&&t.owner===c.installer.oid&&
    same(t.columns,TABLE_COLUMNS[t.name])&&t.rls===false&&t.forceRls===false&&t.publicGrants.length===0&&
    t.serviceTableAccess===false&&t.serviceColumnAccess===false&&t.publicColumnAccess===false&&Number(t.userTriggers)===0&&c.rowCounts[t.name]==='0','TABLE_LAYOUT');
  for(const f of c.functions){const expected=contract.functions.find(v=>v.name===f.name);
    must(expected&&f.owner===c.installer.oid&&f.types.replaceAll(' ','')===expected.types&&f.language===expected.language&&
      f.definer===true&&same(f.config?.map(s=>s.replaceAll(' ','')),['search_path=pg_catalog,pg_temp'])&&
      hash(f.body)===expected.bodySha256&&f.publicExecute===false&&f.serviceExecute===expected.serviceExecute,'FUNCTION_LAYOUT');}
  must(c.public_database_create===false&&c.public_schema_create===false&&c.public_business_grants.length===0,'PUBLIC_LAYOUT');
  return {state:'EXACT_NOLOGIN_CONTROL_SCHEMA_VERIFIED',roleOid:role.oid,schemaOid:c.schema.oid,
    tables:3,emptyTables:3,functions:9,serviceExecutableFunctions:7,ownerOnlyFunctions:2,memberships:c.memberships,
    roleLogin:false,businessTableIdentityAndOwnerPreserved:true,canDispatch:false};
}
export function makeManifest({sourceCommit,pins,contract,prestate,targetFingerprintSha256,ci,createdAt}){
  assertAbsent(prestate);must(/^[a-f0-9]{40}$/.test(sourceCommit)&&digest(targetFingerprintSha256)&&Number.isSafeInteger(createdAt)&&
    pins.length===SOURCE_FILES.length&&pins.every((p,i)=>p.file===SOURCE_FILES[i]&&digest(p.sha256))&&digest(contract.sqlSha256)&&
    ci?.sourceCommit===sourceCommit&&ci.status==='completed'&&ci.conclusion==='success'&&ci.attempt===1&&ci.realInstallerCatalogVerified===true,'MANIFEST_INPUT');
  const body={schema:'techlong/platform-control-schema-install-review/v6',sourceCommit,pins,contract,prestate,targetFingerprintSha256,ci,
    identityProofSha256:I.identityProofSha256,createdAt,expiresAt:createdAt+I.validMs,slot:I.slot,riskFile:I.riskFile,
    action:{sqlFile:I.sql,sqlSha256:contract.sqlSha256,oneExactTransactionBatch:true},
    effects:{newNoLoginRoles:1,newSchemas:1,newTables:3,newFunctions:9,serviceExecuteGrants:7,installBatchSubmissions:1,
      passwords:0,loginActivations:0,businessWrites:0,awsCalls:0,appKeyReads:0,workflowDispatches:0,automaticRetries:0},
    risks:{shortTableLocks:true,creatorMembershipMayBeAutomatic:true,noAutomaticDownOrCompensation:true,commitAckMayBeUnknown:true,
      publicFunctionPrivilegesNotFullyAuditedForFutureLogin:true},preparationIsNotExecutionApproval:true};
  return {...body,manifestSha256:hash(canonicalJson(body))};
}
export function verifyManifest(m,approved,now=Date.now(),inspect=false){
  must(same(m,makeManifest(m)),'MANIFEST_CHANGED');if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'APPROVAL_OR_EXPIRED');
}
export async function installOnce({manifest:m,approved,io,now=Date.now}){
  verifyManifest(m,approved,now());await io.assertSource(m);const pre=await io.readCatalog();
  assertAbsent(pre);must(same(pre,m.prestate),'CATALOG_DRIFT');verifyManifest(m,approved,now());
  await io.claim({manifestSha256:m.manifestSha256,targetFingerprintSha256:m.targetFingerprintSha256,claimedAt:now(),retryAllowed:false});
  let phase='SLOT_CONSUMED';
  try{
    await io.assertSource(m);verifyManifest(m,approved,now());phase='EXACT_SQL_BATCH_SUBMISSION';
    const ack=await io.installBatch();must(ack?.commitAcknowledged===true,'COMMIT_ACK_UNKNOWN');
    await io.record('commit-ack',{manifestSha256:m.manifestSha256,commitAcknowledged:true});phase='SAME_PROCESS_READBACK';
    const c=await io.readCatalog(),verified=assertInstalled(c,m.contract,m.prestate);await io.record('installed-catalog',c);
    return {outcome:'CONTROL_SCHEMA_INSTALLED_REQUIRES_INDEPENDENT_INSPECT',verified,independentInspectRequired:true,retryAllowed:false,runtimeEnabled:false};
  }catch{return {outcome:'CONTROL_INSTALL_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',phase,retryAllowed:false,runtimeEnabled:false};}
}
