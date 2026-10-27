import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {K,packageKey,checksum,makeReview,verifyReview,assertAck,assertBucket,createUploadRunner,uploadOnce,factsApproval,hash} from '../ops/platform-a604-package-v1/plan.mjs';
import {K as OLD,packageKey as oldKey} from '../ops/platform-recovery-package-v1/plan.mjs';
import {parseArgs,main,ROOTS} from '../ops/platform-a604-package-v1/local.mjs';
import {createPackageIo,isDefiniteMissing} from '../ops/platform-recovery-package-v1/local.mjs';
import {recoveryCloudClosure} from '../ops/platform-recovery-cloud-v1/closure.mjs';
import {a604CloudClosure} from '../ops/platform-a604-cloud-v1/closure.mjs';
import {A604_PROFILE,HANDOFF,A604_PUBLICATION} from '../ops/platform-a604-cloud-v1/profile.mjs';
import {LOCAL_PUBLICATION} from '../ops/platform-a604-operator-v1/scope.mjs';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';
const at=1793128000000;
async function fixture(){const sourceCommit='a'.repeat(40),input={sourceCommit,createdAt:at,
  ci:{runId:'123',jobId:'456',sourceCommit,testedSourceCommit:sourceCommit,attempt:1,status:'completed',conclusion:'success'},
  pins:Array.from({length:20},(_,n)=>({file:'synthetic-'+n,sha256:'b'.repeat(64)}))};
  const m=await makeReview(input),source={Account:K.owner,Arn:K.sourceArn,UserId:K.sourceUserId};
  const p={source,region:K.region,versioning:{Status:'Enabled'},encryption:{Rules:[{ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]},
    ownership:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},publicAccess:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true},
    policyIsPublic:false,targetAbsent:true,deleteMarker:false},ack={key:packageKey(),versionId:'synthetic-version',encryption:'AES256',checksum:checksum()};
  return {input,m,p,ack};}
async function runner(){const f=await fixture(),events=[];let taken=false,clock=at,fail;
  const step=s=>{events.push(s);if(s===fail)throw Error('Synthetic ambiguous ACK');};
  const io={assertSource:async()=>step('source'),preflight:async()=>{step('preflight');return f.p;},record:async n=>step(n),
    readPackage:async()=>{step('read-package');return 'SYNTHETIC';},consume:async v=>{assert.equal(taken,false);taken=true;assert.equal(v.packageSha256,K.packageSha256);step('slot');},
    finalRead:async()=>{step('final');return {source:f.p.source,targetAbsent:true,deleteMarker:false};},put:async()=>{step('put');return f.ack;}};
  const run=createUploadRunner({verifyBody:v=>v==='SYNTHETIC'});
  return {...f,events,io,setFail:v=>{fail=v;},setClock:v=>{clock=v;},run:()=>run({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>clock})};}

test('a604 review binds exact new package, raw wrapper, bytes, key, separate slots and one conditional AES256 PUT',async()=>{
  const {m}=await fixture();assert.notEqual(K.slot,OLD.slot);assert.notEqual(K.inspectSlot,OLD.inspectSlot);assert.notEqual(packageKey(),oldKey());
  assert.equal(m.put.Key,packageKey());assert.equal(m.put.ContentLength,390134);assert.equal(m.put.IfNoneMatch,'*');assert.equal(m.put.ServerSideEncryption,'AES256');
  assert.equal(m.put.ChecksumSHA256,checksum());assert.equal(m.package.rawBytes,583850);assert.equal(m.package.candidateWrapperNotUploaded,true);
  assert.equal(m.package.jobId,'job_a60423b885fef3e4326213f7');assert.equal(m.package.objectCount,7);assert.equal(m.permanentSlot,K.slot);
});
test('new facts window anchors real handoff48h, never extends old expiry, upload is not runtime/workflow/trust approval',async()=>{
  const {m}=await fixture();assert.equal(m.newFacts.factsAt,A604_PROFILE.factsAt);assert.equal(m.newFacts.expiresAt,A604_PROFILE.factsAt+48*3600000);
  assert.equal(m.newFacts.originalBasisExpiresAt,HANDOFF.originalBasisExpiresAt);assert.equal(m.newFacts.originalBasisExtended,false);
  assert.equal(m.laterPublication.authorized,false);assert.equal(m.laterPublication.trustOnly,true);assert.equal(m.laterPublication.permissionsExpansion,false);
  assert.equal(m.laterPublication.packageVersionId,'from-successful-independent-inspection-only');
  for(const k of ['workflowPublications','iamWrites','sqlConnections','secretValueReads','pemReads','controllerActivations','workflowDispatches','cellCreates','automaticWriteRetries'])assert.equal(m.effects[k],0);
});
test('approval valid up to24h/new fixed expiry, no late start, and expired Inspect cannot upload',async()=>{
  const {m,input}=await fixture();assert.equal(m.expiresAt,at+24*3600000);
  const near=await makeReview({...input,createdAt:K.basisExpiresAt-3600000});assert.equal(near.expiresAt,K.basisExpiresAt);
  for(const t of [at-1,m.expiresAt-120000,K.basisExpiresAt])await assert.rejects(verifyReview(m,m.manifestSha256,t));
  await verifyReview(m,undefined,K.basisExpiresAt+1,true);await assert.rejects(makeReview({...input,createdAt:K.basisExpiresAt}));
});
test('tampered scope/body/hash/slot/limits/new facts or readiness cannot be approved even with recomputed manifest SHA',async()=>{
  const {m}=await fixture();for(const mutate of [v=>{v.put.Key=oldKey();},v=>{v.put.Bucket='other';},v=>{v.put.ContentLength++;},v=>{v.put.IfNoneMatch='';},
    v=>{v.package.file='other';},v=>{v.package.sha256=OLD.packageSha256;},v=>{v.permanentSlot=OLD.slot;},v=>{v.inspectSlot=OLD.inspectSlot;},
    v=>{v.newFacts.expiresAt++;},v=>{v.newFacts.factsAt++;},v=>{v.newFacts.originalBasisExtended=true;},v=>{v.newFacts.futureRuntimeActivationAuthorized=true;},
    v=>{v.readiness.rawSha256='c'.repeat(64);},v=>{v.effects.conditionalPuts=2;},v=>{v.laterPublication.authorized=true;}]){
    const v=structuredClone(m);mutate(v);const {manifestSha256:ignored,...body}=v;void ignored;v.manifestSha256=await sha256Hex(body);await assert.rejects(verifyReview(v,v.manifestSha256,at));}
});
test('manifest canonicalization is the original publication protocol, not the distinct hosting object hasher',async()=>{
  const v={Z:1,a:2},wrong=JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:1)));
  assert.notEqual(hash(wrong),await sha256Hex(v));assert.equal(hash(canonicalJson(v)),await sha256Hex(v));
  const {m}=await fixture(),reordered=Object.fromEntries(Object.entries(m).reverse());await verifyReview(reordered,m.manifestSha256,at);
});
test('shared ordered upload engine consumes only new package slot, at most one PUT, never claims activation',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT');assert.equal(r.reference.key,packageKey());
  assert.equal(r.controllerActivated,false);assert.equal(r.workflowDispatched,false);
  for(const [a,b] of [['preflight','read-package'],['read-package','slot'],['slot','final'],['final','put'],['put','put-ack']])assert(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='put').length,1);
});
test('default production body verifier rejects synthetic or old-package body before new permanent claim',async()=>{
  const f=await runner();await assert.rejects(uploadOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:()=>at}),/BODY_CHANGED/);
  assert(!f.events.includes('slot'));assert(!f.events.includes('put'));
});
for(const phase of ['final','put','put-ack-unverified','put-ack'])test('unknown '+phase+' never retries or dispatches after permanent claim',async()=>{
  const f=await runner();f.setFail(phase);const r=await f.run();assert.match(r.outcome,/PARTIAL_OR_UNKNOWN/);assert.equal(r.retryAllowed,false);
  await assert.rejects(f.run());assert(f.events.filter(x=>x==='put').length<=1);
});
test('last read, Source and bucket safety remain strict for new profile',async()=>{
  const f=await runner();f.io.finalRead=async()=>({...f.p,targetAbsent:false});assert.match((await f.run()).outcome,/PARTIAL/);assert(!f.events.includes('put'));
  for(const mutate of [v=>{v.source.UserId='other';},v=>{v.region='us-east-1';},v=>{v.policyIsPublic=true;},v=>{v.deleteMarker=true;},v=>{v.publicAccess.BlockPublicPolicy=false;}]){
    const v=structuredClone(f.p);mutate(v);assert.throws(()=>assertBucket(v));}
});
test('new ACK excludes old key/digest, null versions, wrong checksum and malformed version identifiers',async()=>{
  const {ack}=await fixture();assert.equal(assertAck(ack).sha256,K.packageSha256);
  for(const delta of [{key:oldKey()},{checksum:Buffer.from(OLD.packageSha256,'hex').toString('base64')},{versionId:'null'},{versionId:'../other'},{encryption:'aws:kms'}])assert.throws(()=>assertAck({...ack,...delta}));
});
test('exact approval provenance is available only for same new-facts manifest, without activation',async()=>{
  const {m}=await fixture();await assert.rejects(factsApproval(m,'bad'));const a=await factsApproval(m,m.manifestSha256);
  assert.equal(a.state,'APPROVED');assert.equal(a.manifestSha256,m.manifestSha256);assert.equal(a.expiresAt,K.basisExpiresAt);assert.equal(a.originalBasisExtended,false);
});
test('read-only SDK instance cannot write/read local package/claim, and has no credential/network activity',async()=>{
  const {m}=await fixture(),io=await createPackageIo(m,'unused',{inspect:true,capability:{target:K,assertAck,readPackage:()=>assert.fail('private read')}});
  try{for(const fn of [()=>io.preflight(),()=>io.finalRead(),()=>io.readPackage(),()=>io.consume({}),()=>io.put('x')])await assert.rejects(Promise.resolve().then(fn));
    assert.deepEqual(io.counts(),{sourceSts:0,bucketMetadata:0,targetHead:0,localPackageReads:0,put:0,fixedVersionGet:0});}finally{io.close();}
});
test('definite missing requires exact404 and explicit absence of delete marker; ambiguous/403 are not permission to PUT',()=>{
  const e={name:'NotFound',$metadata:{httpStatusCode:404},$response:{headers:{}}};assert.equal(isDefiniteMissing(e),true);
  assert.equal(isDefiniteMissing({...e,$response:{headers:{'x-amz-delete-marker':'true'}}}),false);assert.equal(isDefiniteMissing({...e,$metadata:{httpStatusCode:403}}),false);
});
test('new CLI is closed without exact approved mode and exposes no target/profile/facts/hash/retry overrides',async()=>{
  const checked=await main(['--check']);assert.equal(checked.awsCalls,0);assert.equal(checked.uploads,0);assert.equal(checked.executionAuthorized,false);
  for(const args of [[],['--mode','UploadReviewed'],['--mode','Delete'],['--mode','PrepareSaved','--ci-run','123','--output','F:/ChatGPT_workshop/techlong-a604-package-x','--profile','other']])assert.throws(()=>parseArgs(args));
  if(process.platform==='win32')assert.equal(parseArgs(['--mode','PrepareSaved','--ci-run','123','--output','F:/ChatGPT_workshop/techlong-a604-package-x'])['--mode'],'PrepareSaved');
  assert(ROOTS.includes(K.riskFile));assert.equal(A604_PUBLICATION.state,'UNPUBLISHED');assert.equal(LOCAL_PUBLICATION.state,'UNPUBLISHED');
});
test('local entry never creates deployment/IAM/SQL/Secret or protected workflow writers',async()=>{
  const text=await readFile(new URL('../ops/platform-a604-package-v1/local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(text,/GetSecretValueCommand|CreateChangeSet|UpdateStackCommand|new pg\.|\.env\.local|\/dispatches|DeleteObjectCommand/);
  assert.match(text,/createPackageIo/);assert.match(text,/result\.outcome==='RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT'/);
  assert.match(text,/K\.inspectSlot/);assert.match(text,/A604_PACKAGE_INSPECT_STOPPED_NO_RETRY/);
});
test('old97 and a604104 cloud closures remain exact and exclude both local uploaders',async()=>{
  const [old,newer]=await Promise.all([recoveryCloudClosure(),a604CloudClosure()]);assert.equal(old.pinCount,97);assert.equal(newer.pinCount,104);
  assert.equal(old.closureSha256,OLD.closureSha256);assert.equal(newer.closureSha256,K.closureSha256);
  for(const c of [old,newer])assert(!c.pins.some(p=>/platform-(?:a604|recovery)-package-v1/.test(p.file)));
});
