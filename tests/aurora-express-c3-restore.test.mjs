import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import review from '../lib/deployments/execution/aurora-express-c3-restore-review.cjs';
import capture from '../lib/deployments/execution/aurora-express-c3-restore-capture.cjs';
const backend=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const {verifyPg17Catalog}=backend('./services/saas/aurora_express_restore_v3');
const tables=Array.from({length:73},(_,i)=>`synthetic_${String(i).padStart(2,'0')}`);
const empty={schemas:[{name:'public',owner:'pg_database_owner',acl:[
  {grantee:'PUBLIC',grantor:'pg_database_owner',privilege:'USAGE',grantable:false},
  {grantee:'pg_database_owner',grantor:'pg_database_owner',privilege:'CREATE',grantable:false},
  {grantee:'pg_database_owner',grantor:'pg_database_owner',privilege:'USAGE',grantable:false}]}],
  relations:[],functions:[],extensions:[],types:[],collations:[],eventTriggers:[]};
const restored=()=>({...structuredClone(empty),relations:tables.map(name=>({schema:'public',name,kind:'r',owner:'postgres',persistence:'p',
  rls:false,forceRls:false,rules:[],policies:[],acl:[],columns:[]})),extensions:[{name:'uuid-ossp',owner:'postgres',schema:'public',version:'1.1'}]});
const result=c=>({rowCount:1,rows:[{identity:c}]});
const programs={empty:'EMPTY',catalog:'CATALOG',restore:'RESTORE',verification:'VERIFY',rows:'ROWS',migrations:['M1','M2']};
test('fixed seed and size query allowlists match the actual unchanged V4 port byte-for-byte',()=>{
  const source=backend('./services/saas/aurora_express_restore_v4').PostgresExpressRestoreProviderV4.prototype.apply.toString();
  const root=readFileSync(new URL('../ops/aws-sandbox/scripts/review-aurora-express-c3-restore.mjs',import.meta.url),'utf8');
  const actualEntitlements=/const entitlements = await q\(targetClient, `([\s\S]*?)`\);/.exec(source)?.[1];
  const allowedEntitlements=/const entitlementSql='([^']+)';/.exec(root)?.[1]?.replaceAll('\\n','\n');
  assert.ok(actualEntitlements);assert.equal(allowedEntitlements,actualEntitlements);
  const actualInstance=/const instance = await q\(targetClient, '([^']+)'\);/.exec(source)?.[1];
  const allowedInstance=/const instanceSql='([^']+)';/.exec(root)?.[1];
  assert.ok(actualInstance);assert.equal(allowedInstance,actualInstance);
  const actualSize=/const size = await q\(targetClient, '([^']+)'\);/.exec(source)?.[1];
  assert.ok(actualSize);assert.ok(root.includes(`sizeSql='${actualSize}'`));
});
test('the current exact empty catalog pin is required before restoring; unknown nonempty state never dispatches restore',async()=>{
  assert.equal(db.digest(empty),review.EMPTY_CATALOG_SHA);
  let touched=false; const calls=[],reports=[];
  const q=capture.createCaptureQuery({approval:()=>{},programs,tables,verifyCatalog:verifyPg17Catalog,saveReport:async r=>reports.push(r),
    nativeQuery:async text=>{calls.push(text);if(text==='EMPTY')return{rowCount:1,rows:[{objects:'0',closed_public_schema:'1'}]};
      if(text==='CATALOG')return result(empty);if(text==='RESTORE')touched=true;return{rowCount:0,rows:[]};}});
  await assert.rejects(()=>q('RESTORE'),/PRECONDITION/);assert.equal(calls.length,0);
  await q('EMPTY');assert.equal(reports[0].phase,'empty-before-write');assert.equal(reports[0].originalValidation.accepted,false);
  await q('RESTORE');assert.equal(touched,true);await assert.rejects(()=>q('RESTORE'),/PRECONDITION/);
  const drift=structuredClone(empty);drift.schemas[0].owner='postgres';
  const q2=capture.createCaptureQuery({approval:()=>{},programs,tables,verifyCatalog:verifyPg17Catalog,saveReport:async()=>{},
    nativeQuery:async text=>text==='EMPTY'?{rowCount:1,rows:[{objects:'0',closed_public_schema:'1'}]}:result(drift)});
  await assert.rejects(()=>q2('EMPTY'),/EMPTY_CATALOG_CHANGED/);await assert.rejects(()=>q2('RESTORE'),/PRECONDITION/);
});
test('catalog evidence precedes the unchanged verifier, rejected baseline cannot migrate/commit, raw definitions never serialize',async()=>{
  const c=restored();c.functions.push({schema:'public',name:'SYNTHETIC_PRIVATE_NAME',owner:'SYNTHETIC_PRIVATE_OWNER',config:null,
    definition:'SYNTHETIC_PRIVATE_BODY',arguments:'SYNTHETIC_PRIVATE_ARGS',acl:[]});
  let submitted=false;const calls=[],reports=[];
  const q=capture.createCaptureQuery({approval:()=>{},programs,tables,verifyCatalog:verifyPg17Catalog,saveReport:async r=>reports.push(r),
    nativeQuery:async text=>{calls.push(text);if(text==='EMPTY')return{rowCount:1,rows:[{objects:0,closed_public_schema:1}]};
      if(text==='RESTORE')submitted=true;return text==='CATALOG'?result(submitted?c:empty):{rows:[]};}});
  await q('EMPTY');await q('RESTORE');const observed=await q('CATALOG');
  assert.equal(reports.at(-1).phase,'baseline-before-verifier');assert.ok(reports.at(-1).rejectedPredicates.includes('function_owner'));
  assert.equal(JSON.stringify(reports).includes('SYNTHETIC_PRIVATE'),false);
  assert.ok(reports.at(-1).objectRejections[0].reasons.includes('owner'));
  const aclCase=restored();aclCase.functions.push({schema:'public',name:'SYNTHETIC_PRIVATE_NAME',owner:'EXTENSION_SCRIPT_OWNER',extensionOwned:true,
    config:null,acl:[{grantor:'postgres',grantee:'PUBLIC',privilege:'EXECUTE',grantable:false}]});
  const aclReport=capture.catalogReport({result:result(aclCase),tables,phase:'baseline-before-verifier',verifyCatalog:verifyPg17Catalog});
  assert.ok(aclReport.objectRejections[0].reasons.includes('acl'));assert.equal(aclReport.objectRejections[0].acl[0].grantor.value,'postgres');
  assert.equal(JSON.stringify(aclReport).includes('SYNTHETIC_PRIVATE'),false);
  assert.throws(()=>verifyPg17Catalog(observed,tables),/CATALOG_REJECTED/);
  const n=calls.length;await assert.rejects(()=>q('M1'));await assert.rejects(()=>q('COMMIT'));assert.equal(calls.length,n);
});
test('both accepted captures and both migrations are required before COMMIT; read-only inspection cannot run restore',async()=>{
  let submitted=false;const c=restored(),calls=[],reports=[];
  const nativeQuery=async text=>{calls.push(text);if(text==='EMPTY')return{rowCount:1,rows:[{objects:0,closed_public_schema:1}]};
    if(text==='RESTORE')submitted=true;return text==='CATALOG'?result(submitted?c:empty):{rows:[]};};
  const q=capture.createCaptureQuery({nativeQuery,approval:()=>{},programs,tables,verifyCatalog:verifyPg17Catalog,saveReport:async r=>reports.push(r)});
  await q('EMPTY');await q('RESTORE');verifyPg17Catalog(await q('CATALOG'),tables);
  await assert.rejects(()=>q('COMMIT'));await assert.rejects(()=>q('M2'));await q('M1');await q('M2');
  verifyPg17Catalog(await q('CATALOG'),tables);await q('COMMIT');assert.equal(calls.at(-1),'COMMIT');
  assert.deepEqual(reports.map(r=>r.phase),['empty-before-write','baseline-before-verifier','migrated-before-verifier']);
  const inspect=capture.createCaptureQuery({nativeQuery,approval:()=>{},programs,tables,verifyCatalog:verifyPg17Catalog,saveReport:async()=>{},inspectOnly:true});
  const n=calls.length;for(const t of ['RESTORE','EMPTY','VERIFY','M1'])await assert.rejects(()=>inspect(t));assert.equal(calls.length,n);
  await inspect('CATALOG');await inspect('COMMIT');
});
test('fresh restore authority is narrower than prepare and binds the original real SQL identity; replay, old SHA and widened scope fail',()=>{
  const load=p=>JSON.parse(readFileSync(p,'utf8'));
  const originalD=load('F:/ChatGPT_workshop/techlong-d002-express-c3d-review-20261014-r2/manifest.json');
  const originalE=load('F:/ChatGPT_workshop/techlong-d002-express-c3-catalog-review-20261014-r2/manifest.json');
  const now=Date.parse('2026-10-14T14:30:00Z'),facts={...structuredClone(originalE.facts),observedAt:new Date(now).toISOString()};
  const input={facts,originalD,originalE,sqlProgram:originalD.sqlProgram,codeBindingSha256:'a'.repeat(64),historySha256:'b'.repeat(64)};
  const r=review.prepareReview(input,now),approve=(v=r,sha=r.manifestSha256,time=now)=>
    review.assertApproval(v,sha,input.codeBindingSha256,input.historySha256,originalD,originalE,time);
  approve();assert.equal(r.limits.newDatabases,0);assert.equal(r.limits.guardDeletions,0);assert.equal(r.limits.newRoles,0);
  assert.equal(r.expectedTenantDatabaseOid,'16459');assert.equal(r.executionAuthorized,false);assert.equal(r.sqlProgramSha256,review.SQL_PROGRAM_SHA);
  assert.throws(()=>approve(r,review.DIAGNOSTIC_SHA));assert.throws(()=>approve(r,r.manifestSha256,now+6*3600000));
  const body={...r,limits:{...r.limits,newDatabases:1}};delete body.manifestSha256;const fake={...body,manifestSha256:db.digest(body)};
  assert.throws(()=>approve(fake,fake.manifestSha256),/SCOPE_DRIFT/);
  assert.throws(()=>review.prepareReview({...input,sqlProgram:{...input.sqlProgram,tables:72}},now));
});
