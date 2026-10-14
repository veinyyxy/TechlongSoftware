import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import review from '../lib/deployments/execution/aurora-express-c3g-restore-review.cjs';
import capture from '../lib/deployments/execution/aurora-express-c3g-restore-capture.cjs';
const backend=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const {verifyPg17Catalog:frozenVerify}=backend('./services/saas/aurora_express_restore_v3');
const {verifyPg17CatalogV5:verifyCatalog}=backend('./services/saas/aurora-pg17-catalog-policy-v5.cjs');
const {fixtureCatalog,tables}=backend('./services/saas/aurora-express-restore-v5-check.cjs');
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const oldD=load('F:/ChatGPT_workshop/techlong-d002-express-c3d-review-20261014-r2/manifest.json');
const oldE=load('F:/ChatGPT_workshop/techlong-d002-express-c3-catalog-review-20261014-r2/manifest.json');
const empty=()=>{const c=fixtureCatalog().rows[0].identity;c.schemas[0].acl.push(
  {grantor:'pg_database_owner',grantee:'pg_database_owner',privilege:'CREATE',grantable:false},
  {grantor:'pg_database_owner',grantee:'pg_database_owner',privilege:'USAGE',grantable:false});
  for(const k of ['relations','functions','extensions','types'])c[k]=[];return{rowCount:1,rows:[{identity:c}]};};
const programs={empty:'EMPTY',catalog:'CATALOG',restore:'RESTORE',verification:'VERIFY',rows:'ROWS',migrations:['M1','M2']};
test('V5 report keeps actual digest and old rejection separate from exact new admission; other ACL gates remain closed',()=>{
  const r=fixtureCatalog(),before=db.canonicalJson(r);
  const report=capture.catalogReport({result:r,tables,phase:'baseline-before-verifier',verifyCatalog,frozenVerify});
  assert.equal(db.canonicalJson(r),before);assert.equal(report.catalogSha256,db.digest(r.rows[0].identity));
  assert.equal(report.originalValidation.accepted,false);assert.equal(report.admissionValidation.accepted,true);
  assert.equal(report.catalogPolicySha256,review.CATALOG_POLICY_SHA);assert.deepEqual(report.rejectedPredicates,[]);
  assert.equal(report.checks.length,17);assert.equal(report.extensions[0].owner.value,'rdsadmin');
  r.rows[0].identity.relations[0].acl.push({grantor:'postgres',grantee:'PUBLIC',privilege:'SELECT',grantable:false});
  const bad=capture.catalogReport({result:r,tables,phase:'baseline-before-verifier',verifyCatalog,frozenVerify});
  assert.equal(bad.admissionValidation.accepted,false);assert.deepEqual(bad.rejectedPredicates,['relation_acl']);
  r.rows[0].identity.functions.push({schema:'public',name:'SYNTHETIC_PRIVATE_NAME',definition:'SYNTHETIC_PRIVATE_BODY',
    owner:'foreign',extensionOwned:false,config:null,securityDefiner:false,leakproof:false,acl:[]});
  assert.equal(JSON.stringify(capture.catalogReport({result:r,tables,phase:'baseline-before-verifier',verifyCatalog,frozenVerify})).includes('SYNTHETIC_PRIVATE'),false);
});
test('exact empty catalog and V5 admission are required; both migrations/final still precede COMMIT, no query result rewriting',async()=>{
  assert.equal(db.digest(empty().rows[0].identity),review.EMPTY_CATALOG_SHA);
  let submitted=false;const calls=[],reports=[],restored=fixtureCatalog();
  const q=capture.createCaptureQuery({approval:()=>{},programs,tables,verifyCatalog,frozenVerify,saveReport:async r=>reports.push(r),
    nativeQuery:async text=>{calls.push(text);if(text==='EMPTY')return{rowCount:1,rows:[{objects:'0',closed_public_schema:'1'}]};
      if(text==='RESTORE')submitted=true;if(text==='CATALOG')return submitted?restored:empty();return{rowCount:0,rows:[]};}});
  await assert.rejects(()=>q('RESTORE'));await q('EMPTY');await q('RESTORE');assert.equal(await q('CATALOG'),restored);
  await assert.rejects(()=>q('COMMIT'));await assert.rejects(()=>q('M2'));await q('M1');await q('M2');
  await q('CATALOG');await q('COMMIT');await assert.rejects(()=>q('RESTORE'));
  assert.equal(calls.filter(v=>v==='RESTORE').length,1);assert.equal(reports[1].admissionValidation.accepted,true);
  const denied=capture.createCaptureQuery({approval:()=>{},programs,tables,verifyCatalog,frozenVerify,saveReport:async()=>{},
    inspectOnly:true,nativeQuery:async()=>restored});
  for(const text of ['RESTORE','EMPTY','VERIFY','M1'])await assert.rejects(()=>denied(text));
});
test('fresh V5 manifest binds the one-field policy and original SQL; old approval, widened resource scope or SQL changes rejected',()=>{
  const now=Date.parse('2026-10-14T16:00:00Z'),facts={...structuredClone(oldE.facts),observedAt:new Date(now).toISOString()};
  const input={facts,originalD:oldD,originalE:oldE,sqlProgram:{...oldD.sqlProgram,catalogPolicySha256:review.CATALOG_POLICY_SHA},
    codeBindingSha256:'a'.repeat(64),historySha256:'b'.repeat(64)};
  const r=review.prepareReview(input,now),check=(x=r,sha=r.manifestSha256,time=now)=>review.assertApproval(x,sha,input.codeBindingSha256,input.historySha256,oldD,oldE,time);
  check();assert.equal(r.limits.newDatabases,0);assert.equal(r.limits.newRoles,0);assert.equal(r.catalogAdmission.extension.owner,'rdsadmin');
  assert.notEqual(r.sqlProgramSha256,r.legacySqlProgramSha256);assert.equal(r.capture.originalAndAdmissionResultsSeparate,true);
  assert.throws(()=>check(r,review.PREDECESSOR_SHA));assert.throws(()=>check(r,r.manifestSha256,now+6*3600000));
  const resign=mutate=>{const x=structuredClone(r);delete x.manifestSha256;mutate(x);return{...x,manifestSha256:db.digest(x)};};
  for(const change of [x=>x.limits.newDatabases=1,x=>x.catalogAdmission.extension.owner='postgres',x=>x.attemptSlot='old']) {
    const changed=resign(change);assert.throws(()=>check(changed,changed.manifestSha256),/SCOPE_DRIFT/);
  }
  assert.throws(()=>review.prepareReview({...input,sqlProgram:{...input.sqlProgram,rowCountsSqlSha256:'0'.repeat(64)}},now));
});
test('fixed V5 seed and size SQL still match root allowlists byte-for-byte; old root/verifier sources preserved',()=>{
  const port=backend('./services/saas/aurora_express_restore_v5').PostgresExpressRestoreProviderV5.prototype.apply.toString();
  const root=readFileSync(new URL('../ops/aws-sandbox/scripts/review-aurora-express-c3g-restore.mjs',import.meta.url),'utf8');
  const a=/const entitlements = await q\(targetClient, `([\s\S]*?)`\);/.exec(port)?.[1];
  const b=/const entitlementSql='([^']+)';/.exec(root)?.[1]?.replaceAll('\\n','\n');assert.ok(a);assert.equal(a,b);
  assert.ok(root.includes("frozen.pins.length!==229"));assert.ok(root.includes('priorBaseline'));
});
