import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {T,PROFILE,makeReview,verifyReview,packageKey,checksum,assertAck,createUploadRunner,uploadOnce,factsApproval,assertBucket} from '../ops/platform-reviewed-cycle-v1/upload-plan.mjs';
import {parseArgs,main} from '../ops/platform-reviewed-cycle-v1/upload-local.mjs';
import {createPackageIo} from '../ops/platform-recovery-package-v1/local.mjs';
import {K as OLD,packageKey as oldKey} from '../ops/platform-a604-package-v1/plan.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {SELECTED_CYCLE} from '../ops/platform-reviewed-cycle-v1/selection.mjs';
const at=1793203200000;
async function fixture(){
  const sourceCommit='a'.repeat(40),input={sourceCommit,createdAt:at,pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'b'.repeat(64)})),
    ci:{runId:'123',jobId:'456',sourceCommit,testedSourceCommit:sourceCommit,attempt:1,status:'completed',conclusion:'success'}},m=await makeReview(input),
    source={Account:T.owner,Arn:T.sourceArn,UserId:T.sourceUserId},p={source,region:T.region,versioning:{Status:'Enabled'},
      encryption:{Rules:[{ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]},ownership:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},
      publicAccess:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true},policyIsPublic:false,targetAbsent:true,deleteMarker:false},
    ack={key:packageKey(),versionId:'synthetic-fixed-version',encryption:'AES256',checksum:checksum()};return {input,m,p,ack};
}
async function runner(){
  const f=await fixture(),events=[];let taken=false,fail;
  const step=n=>{events.push(n);if(n===fail)throw Error('Synthetic unknown ACK');},io={assertSource:async()=>step('source'),
    preflight:async()=>{step('preflight');return f.p;},record:async n=>step(n),readPackage:async()=>{step('body');return 'SYNTHETIC';},
    consume:async()=>{assert.equal(taken,false);taken=true;step('slot');},finalRead:async()=>{step('final');return {source:f.p.source,targetAbsent:true,deleteMarker:false};},
    put:async()=>{step('put');return f.ack;}};
  const run=createUploadRunner({verifyBody:s=>s==='SYNTHETIC'});return {...f,events,io,setFail:n=>{fail=n;},run:()=>run({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>at})};
}
test('SOURCE fixes the sealed bytes, new key/two slots and conditional AES256 checksum PUT without old slot reuse',async()=>{
  const {m}=await fixture();assert.equal(m.package.canonicalBytes,403623);assert.equal(m.package.rawBytes,605958);
  assert.equal(m.package.jobId,PROFILE.newJobId);assert.notEqual(T.slot,OLD.slot);assert.notEqual(T.inspectSlot,OLD.inspectSlot);
  assert.notEqual(packageKey(),oldKey());assert.equal(m.put.Key,packageKey());assert.equal(m.put.IfNoneMatch,'*');
  assert.equal(m.put.ServerSideEncryption,'AES256');assert.equal(m.put.ChecksumSHA256,checksum());assert.equal(m.put.ContentLength,T.bytes);
});
test('new facts retain actual database times and fixed48h; preparation uses original five-hour cutoff, not a new observation',async()=>{
  const {m,input}=await fixture();assert.equal(m.newFacts.factsAt,1793200089592);assert.equal(m.newFacts.databaseCheckedAt,1793200101656);
  assert.equal(m.newFacts.expiresAt,PROFILE.factsAt+48*3600000);assert.equal(m.newFacts.originalBasisExtended,false);
  assert.equal(m.readiness.preparationExpiresAt,1793212938110);assert.equal(m.expiresAt,at+24*3600000);
  for(const createdAt of [PROFILE.observedBy-1,T.preparationExpiresAt,T.preparationExpiresAt+1])await assert.rejects(makeReview({...input,createdAt}));
  await makeReview({...input,createdAt:T.preparationExpiresAt-1});
  assert.equal(m.laterPublication.authorized,false);assert.equal(m.laterPublication.packageVersionId,'from-successful-independent-inspection-only');
  for(const k of ['iamWrites','sqlConnections','secretValueReads','pemReads','workflowPublications','controllerActivations','workflowDispatches','cellCreates','automaticWriteRetries'])assert.equal(m.effects[k],0);
});
test('old approval, changed source/slots/facts/PUT/budgets or recomputed enlarged manifest cannot be substituted',async()=>{
  const {m}=await fixture();await assert.rejects(verifyReview(m,'f'.repeat(64),at));
  for(const change of [v=>{v.put.Key=oldKey();},v=>{v.put.IfNoneMatch='';},v=>{v.put.Bucket='other';},v=>{v.put.ContentLength++;},
    v=>{v.permanentSlot=OLD.slot;},v=>{v.inspectSlot=OLD.inspectSlot;},v=>{v.package.sha256=OLD.packageSha256;},
    v=>{v.newFacts.factsAt++;},v=>{v.newFacts.expiresAt++;},v=>{v.newFacts.originalBasisExtended=true;},
    v=>{v.effects.conditionalPuts=2;},v=>{v.effects.independentFixedVersionGets=2;},v=>{v.laterPublication.authorized=true;}]){
    const v=structuredClone(m);change(v);const {manifestSha256:ignored,...body}=v;void ignored;v.manifestSha256=await sha256Hex(body);
    await assert.rejects(verifyReview(v,v.manifestSha256,at));
  }
});
test('upload window never renews on Inspect; late/missing approval is rejected before I/O',async()=>{
  const {m}=await fixture();for(const time of [at-1,m.expiresAt-120000,T.basisExpiresAt])await assert.rejects(verifyReview(m,m.manifestSha256,time));
  await verifyReview(m,m.manifestSha256,T.basisExpiresAt+1,true);await assert.rejects(verifyReview(m,undefined,at,true));
});
test('shared upload order preserves once-only claim and exposes no runtime activation',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT');
  assert.equal(r.workflowDispatched,false);assert.equal(r.controllerActivated,false);
  for(const [a,b] of [['preflight','body'],['body','slot'],['slot','final'],['final','put'],['put','put-ack']])assert(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='put').length,1);
});
for(const phase of ['final','put','put-ack-unverified','put-ack'])test('unknown '+phase+' preserves the slot and does not retry',async()=>{
  const f=await runner();f.setFail(phase);assert.match((await f.run()).outcome,/PARTIAL_OR_UNKNOWN/);await assert.rejects(f.run());
  assert(f.events.filter(n=>n==='put').length<=1);
});
test('default body verifier rejects old/synthetic bytes before claiming and bucket/ACK guards remain exact',async()=>{
  const f=await runner();await assert.rejects(uploadOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:()=>at}),/BODY_CHANGED/);
  assert(!f.events.includes('slot'));assert(!f.events.includes('put'));
  for(const delta of [{key:oldKey()},{versionId:'null'},{versionId:'../other'},{checksum:'wrong'},{encryption:'aws:kms'}])assert.throws(()=>assertAck({...f.ack,...delta}));
  const v=structuredClone(f.p);v.source.Arn='arn:aws:sts::402010193138:assumed-role/other/session';assert.throws(()=>assertBucket(v));
});
test('facts provenance requires the exact approved manifest and cannot activate the default SOURCE',async()=>{
  const {m}=await fixture();await assert.rejects(factsApproval(m,'bad'));const a=await factsApproval(m,m.manifestSha256);
  assert.equal(a.state,'APPROVED');assert.equal(a.profileSha256,T.profileSha256);assert.equal(a.expiresAt,T.basisExpiresAt);assert.equal(SELECTED_CYCLE,null);
});
test('independent SDK instance cannot PUT/HEAD/claim/read local package and does not acquire credentials on construction',async()=>{
  const {m}=await fixture(),io=await createPackageIo(m,'unused',{inspect:true,capability:{target:T,assertAck,readPackage:()=>assert.fail('LOCAL_BODY_READ')}});
  try{for(const op of [()=>io.preflight(),()=>io.finalRead(),()=>io.readPackage(),()=>io.consume({}),()=>io.put('x')])await assert.rejects(Promise.resolve().then(op));
    assert.deepEqual(io.counts(),{sourceSts:0,bucketMetadata:0,targetHead:0,localPackageReads:0,put:0,fixedVersionGet:0});}finally{io.close();}
});
test('entry requires exact modes/SHA and cannot override targets, facts, output root or permissions',async()=>{
  const r=await main(['--check']);assert.equal(r.awsCalls+r.sqlConnections+r.configurationContentReads+r.pemReads+r.uploads+r.slotsConsumed+r.dispatches,0);
  for(const args of [[],['--mode','Delete'],['--mode','Inspect','--manifest','x','--output','x'],
    ['--mode','PrepareSaved','--ci-run','123','--output','F:/ChatGPT_workshop/techlong-reviewed-cycle-upload-x','--profile','other']])assert.throws(()=>parseArgs(args));
  assert.equal(parseArgs(['--mode','PrepareSaved','--ci-run','123','--output','F:/ChatGPT_workshop/techlong-reviewed-cycle-upload-x'])['--mode'],'PrepareSaved');
  const text=await readFile(new URL('../ops/platform-reviewed-cycle-v1/upload-local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(text,/GetSecretValueCommand|DeleteObjectCommand|CreateChangeSet|UpdateStackCommand|new pg\.|\.env\.local|\/dispatches/);
  assert.match(text,/createPackageIo/);assert.match(text,/result\.outcome==='RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT'/);
});
