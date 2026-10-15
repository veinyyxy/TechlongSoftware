'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- New reviewed attempt, frozen C4f SQL and classifiers remain unchanged. */
const core=require('./express-application-activation-c4f.cjs');
const db=require('./aurora-database-contract-v2.cjs');
const RUN_SLOT='techlong-d002-express-c4g-application-install-v1.permanent-slot.json';
const INSPECT_SLOT='techlong-d002-express-c4g-application-inspect-v1.permanent-slot.json';
const PREDECESSOR_SHA='0c32f6f0885938065735b1945586e082eff3e2272e50f02c321d93b7feb943cc';
const LEGACY_CODES=new Set(['AURORA_APP_V6_CANDIDATE_REJECTED','AURORA_V5_PG17_CATALOG_REJECTED','AURORA_V3_ROW_COUNTS_CHANGED',
 'C4F_COMPILED_PREDECESSOR_REQUIRED','C4F_PRIVATE_PROGRAM_REQUIRED','C4F_REVIEW_REJECTED','C4F_FRESH_APPROVAL_REQUIRED',
 'C4F_EXACT_TLS_CONTEXT_REQUIRED','C4F_EXACT_ISOLATED_ACL_REQUIRED','C4F_INSPECT_STATE_DIVERGED','C4F_IAM_SQL_ROLE_CHANGED','C4F_APPLICATION_PRIVILEGES_REJECTED',
 'C4G_FRESH_APPROVAL_REQUIRED','C4G_EVIDENCE_QUERY_SCOPE_REJECTED','C4G_EVIDENCE_SIZE_REJECTED','C4G_EVIDENCE_JOURNAL_REQUIRED','C4G_EVIDENCE_FRAME_BUDGET_REJECTED']);
const VALIDATORS=new Set(['ROLE_CLASSIFIER','CATALOG_PROJECT_AND_PIN','SEED_AND_BUSINESS_COUNTS']);
const MAX_EVIDENCE_BYTES=262144;
const safeName=v=>typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(v)?v:null;
const bool=v=>typeof v==='boolean'?v:null,oid=v=>typeof v==='string'&&/^[1-9][0-9]{0,9}$/.test(v)?v:null;
function fail(code){throw Object.assign(Error(code),{code,retryable:false});}
function errorDetails(e){
 const v=[e?.code,e?.message].find(v=>LEGACY_CODES.has(v));
 return {validationCode:v||null,validationStage:VALIDATORS.has(e?.c4gValidationStage)?e.c4gValidationStage:null};
}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function prepare(options){const old=core.prepare(options),{manifestSha256:ignored,...body}=old;void ignored;
 const next={...body,schema:'techlong/express-application-review/c4g',slots:{run:RUN_SLOT,inspect:INSPECT_SLOT},
  predecessorConsumedManifestSha256:PREDECESSOR_SHA,newIndependentAttemptRequiresApproval:true,
  frozenC4fSqlAndMinimumPolicyUnchanged:true,
  evidence:{maximumBytesPerFrame:MAX_EVIDENCE_BYTES,maximumSnapshotFramesPerMode:15,
   roleConfigValues:'redacted-by-frozen-SQL',catalog:'only-ACL-vectors-and-digests-no-DDL-or-functions',
   providerErrors:'allowlisted-validator-code-and-SQLSTATE-only-no-message-detail'},
  risks:[...body.risks,
   'This is one new independent permanent install/inspect slot pair after C4f rollback, not a reset or automatic retry. Historical slots/source are preserved; a new exact SHA is mandatory.',
   'Bounded local evidence is saved during the same SQL transaction before the unchanged validators. It includes role/membership metadata, approved-object app ACL vectors, catalog digest and row counts; no function/DDL/config/private row values or provider messages. Local persistence may fail or delay validation, causing abort or unknown state; evidence is not a second live database observation.',
   'PostgreSQL can select a grantor distinct from the login user. That is only a possible C4f failure explanation, not a proved historical cause. Existing grantor predicates remain strict: no alternate grantor/membership/ACL is automatically accepted based on captured evidence.']};
 return freeze({...next,manifestSha256:db.digest(next)});
}
function approval(m,sha,code,program,now){const {manifestSha256,...body}=m||{};core.assertProgram(program);
 if(sha!==manifestSha256||db.digest(body)!==manifestSha256||m.codeBindingSha256!==code||
  db.canonicalJson(m.program)!==db.canonicalJson(program)||now<Date.parse(m.preparedAt)||now>=Date.parse(m.expiresAt)||
  db.canonicalJson(prepare({...body,program,now:Date.parse(m.preparedAt)}))!==db.canonicalJson(m))fail('C4G_FRESH_APPROVAL_REQUIRED');
}
function membership(v){return {name:safeName(v?.name),oid:oid(v?.oid),grantor:safeName(v?.grantor),admin:bool(v?.admin),inherit:bool(v?.inherit),set:bool(v?.set)};}
function roleEvidence(r){const v=r?.rows?.[0];if(r?.rowCount!==1||!v)return {validShape:false};
 return {oid:oid(v.oid),name:safeName(v.name),login:bool(v.login),inherit:bool(v.inherit),
  superuser:bool(v.superuser),create_db:bool(v.create_db),create_role:bool(v.create_role),replication:bool(v.replication),bypass_rls:bool(v.bypass_rls),
  settings:bool(v.settings),owns_objects:bool(v.owns_objects),connection_limit:Number.isInteger(v.connection_limit)?v.connection_limit:null,
  valid_until_is_null:v.valid_until===null,config_is_null:v.config===null,
  iam_role_oid:oid(v.iam_role_oid),parents:Array.isArray(v.parents)&&v.parents.length<=32?v.parents.map(membership):null,
  members:Array.isArray(v.members)&&v.members.length<=32?v.members.map(membership):null,
  other_connectable_databases:Number.isSafeInteger(v.other_connectable_databases)?v.other_connectable_databases:null};
}
function aclEntries(acl,role){if(!Array.isArray(acl)||acl.length>128)return null;
 return acl.filter(a=>a.grantee===role).map(a=>({grantor:safeName(a.grantor),privilege:['CONNECT','USAGE','SELECT','INSERT','UPDATE','DELETE','CREATE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(a.privilege)?a.privilege:null,grantable:bool(a.grantable)}));}
function catalogEvidence(r,p){const c=r?.rows?.[0]?.identity;if(r?.rowCount!==1||!c||Buffer.byteLength(db.canonicalJson(c))>4000000||
 !Array.isArray(c.schemas)||c.schemas.length>16||!Array.isArray(c.relations)||c.relations.length>1024)return {validShape:false};
 const approved=new Set([...p.tables,...p.sequences]),role=p.target.role;
 return {actualCatalogSha256:db.digest(c),schemas:c.schemas.map(s=>({name:s.name==='public'?'public':null,appAcl:aclEntries(s.acl,role)})),
  approvedObjects:c.relations.filter(r=>approved.has(r.name)).map(r=>({name:r.name,kind:['r','S'].includes(r.kind)?r.kind:null,appAcl:aclEntries(r.acl,role)})),
  unexpectedApplicationAclObjects:c.relations.filter(r=>!approved.has(r.name)&&r.acl?.some(a=>a.grantee===role)).map(r=>({nameSha256:db.digest(r.name),kind:['r','i','S'].includes(r.kind)?r.kind:null,appAcl:aclEntries(r.acl,role)})),
  relationCount:c.relations.length,functionCount:Array.isArray(c.functions)?c.functions.length:null,
  definitionValuesPersisted:false};
}
function snapshotEvidence(index,result,p){let observation;
 if(index===0){const v=result?.rows?.[0];observation=result?.rowCount===1?{
  database:v?.database===p.target.database?v.database:null,username:['postgres',p.target.role].includes(v?.username)?v.username:null,
  session_username:['postgres',p.target.role].includes(v?.session_username)?v.session_username:null,
  database_oid:oid(v?.database_oid),role_oid:oid(v?.role_oid),server_version_num:Number.isInteger(v?.server_version_num)?v.server_version_num:null,
  read_only:['on','off'].includes(v?.read_only)?v.read_only:null,isolation:v?.isolation==='repeatable read'?v.isolation:null,backend_tls_active:bool(v?.backend_tls_active)}:{validShape:false};
 }else if(index===1)observation=roleEvidence(result);
 else if(index===2)observation={rows:Number.isInteger(result?.rowCount)?result.rowCount:null,databaseAclSha256:db.digest(result?.rows??null)};
 else if(index===3)observation=catalogEvidence(result,p);
 else if(index===4){const rows=result?.rows;observation={rowCount:Number.isInteger(result?.rowCount)?result.rowCount:null,
  counts:Array.isArray(rows)&&rows.length<=73?rows.map(r=>({name:p.tables.includes(r.name)?r.name:null,rows:typeof r.rows==='string'&&/^[0-9]{1,20}$/.test(r.rows)?r.rows:null})):null};
 }else fail('C4G_EVIDENCE_QUERY_SCOPE_REJECTED');
 const frame={kind:'BOUNDED_SNAPSHOT_RESPONSE',snapshotIndex:index+1,observation};
 if(Buffer.byteLength(db.canonicalJson(frame))>MAX_EVIDENCE_BYTES)fail('C4G_EVIDENCE_SIZE_REJECTED');return frame;
}
async function execute(options){const {client,program,checks,journal}=options;core.assertProgram(program);let snapshots=0;
 if(typeof journal!=='function')fail('C4G_EVIDENCE_JOURNAL_REQUIRED');
 const observedClient={query:async q=>{const result=await client.query(q),text=typeof q==='string'?q:q.text,index=program.snapshotPlan.findIndex(v=>v.text===text);
  if(index>=0){if(++snapshots>15)fail('C4G_EVIDENCE_FRAME_BUDGET_REJECTED');await journal(snapshotEvidence(index,result,program));}return result;}};
 // Validators are synchronous. Evidence journal writes occur before them in
 // observedClient; errors are annotated, not converted into an allowed state.
 const wrap=(name,stage)=>(...args)=>{try{return checks[name](...args);}catch(e){e.c4gValidationStage=stage;throw e;}};
 return core.execute({...options,client:observedClient,checks:{...checks,classifyRole:wrap('classifyRole','ROLE_CLASSIFIER'),
  verifyCatalog:wrap('verifyCatalog','CATALOG_PROJECT_AND_PIN'),verifyRows:wrap('verifyRows','SEED_AND_BUSINESS_COUNTS')}});
}
module.exports={...core,RUN_SLOT,INSPECT_SLOT,PREDECESSOR_SHA,MAX_EVIDENCE_BYTES,prepare,approval,errorDetails,snapshotEvidence,execute};
