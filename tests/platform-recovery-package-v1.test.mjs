import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {K,packageKey,checksum,makePackageReview,verifyPackageReview,assertBucket,assertAck,packageUploadRunner,uploadPackageOnce} from '../ops/platform-recovery-package-v1/plan.mjs';
import {parsePackageArgs,createPackageIo,isDefiniteMissing} from '../ops/platform-recovery-package-v1/local.mjs';
import {recoveryCloudClosure} from '../ops/platform-recovery-cloud-v1/closure.mjs';
const now=1792989600000;
async function fixture(){const sourceCommit='a'.repeat(40),input={sourceCommit,createdAt:now,
  ci:{runId:'123',jobId:'456',sourceCommit,attempt:1,status:'completed',conclusion:'success'},
  pins:Array.from({length:10},(_,i)=>({file:'synthetic-'+i,sha256:'b'.repeat(64)}))};
  const m=await makePackageReview(input),source={Account:K.owner,Arn:K.sourceArn,UserId:K.sourceUserId};
  const p={source,region:K.region,versioning:{Status:'Enabled'},encryption:{Rules:[{ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]},
    ownership:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},publicAccess:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true},
    policyIsPublic:false,targetAbsent:true,deleteMarker:false};
  const ack={key:packageKey(),versionId:'synthetic-version',encryption:'AES256',checksum:checksum()};return {input,m,p,ack};}
async function runner(){const f=await fixture(),events=[];let clock=now,taken=false,fail;
  const step=s=>{events.push(s);if(fail===s)throw Error('Synthetic unknown');};
  const io={assertSource:async()=>step('source'),preflight:async()=>{step('preflight');return structuredClone(f.p);},record:async n=>step(n),
    readPackage:async()=>{step('package');return 'SYNTHETIC';},consume:async()=>{assert.equal(taken,false);taken=true;step('slot');},
    finalRead:async()=>{step('final');return {source:f.p.source,targetAbsent:true,deleteMarker:false};},put:async()=>{step('put');return f.ack;}};
  const run=packageUploadRunner({verifyBody:v=>v==='SYNTHETIC'});
  return {...f,events,io,at:v=>{clock=v;},fail:s=>{fail=s;},run:()=>run({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>clock})};
}
test('exact review binds one AES256 conditional object, original basis expiry and no activation/permission/dispatch authority',async()=>{
  const {m}=await fixture();assert.equal(m.put.Key,packageKey());assert.equal(m.put.IfNoneMatch,'*');assert.equal(m.put.ContentLength,384888);
  assert.equal(m.put.ExpectedBucketOwner,'402010193138');assert.equal(m.put.ServerSideEncryption,'AES256');assert.equal(m.put.ChecksumSHA256,checksum());
  assert.equal(m.package.objectCount,7);assert.equal(m.package.basisExpiresAt,K.basisExpiresAt);
  for(const k of ['iamWrites','secretValueReads','pemReads','sqlConnections','controllerActivations','workflowDispatches','cellCreates','automaticWriteRetries'])assert.equal(m.effects[k],0);
});
test('review max24h, cannot extend original basis expiry, last-start reserve2min and expired Inspect remains read-only',async()=>{
  const {m,input}=await fixture();assert.equal(m.expiresAt,Math.min(now+24*3600000,K.basisExpiresAt));
  const late=await makePackageReview({...input,createdAt:K.basisExpiresAt-3600000});assert.equal(late.expiresAt,K.basisExpiresAt);
  await assert.rejects(makePackageReview({...input,createdAt:K.basisExpiresAt}));
  for(const [a,t] of [['wrong',now],[m.manifestSha256,now-1],[m.manifestSha256,m.expiresAt-120000]])await assert.rejects(verifyPackageReview(m,a,t));
  await verifyPackageReview(m,undefined,K.basisExpiresAt+1,true);
});
test('manifest cannot change key, bucket, checksum, local file, read limits, permanent slot, risk or frozen release',async()=>{
  const {m}=await fixture();for(const change of [v=>{v.put.Key='other';},v=>{v.put.Bucket='other';},v=>{v.put.ChecksumSHA256='other';},
    v=>{v.package.file='other';},v=>{v.permanentSlot='other';},v=>{v.effects.conditionalPuts=2;},v=>{v.riskFile='other';},
    v=>{v.publication.reusableCommit='f'.repeat(40);},v=>{v.effects.independentFixedVersionGets=2;},v=>{v.approved=true;}]){
    const v=structuredClone(m);change(v);await assert.rejects(verifyPackageReview(v,m.manifestSha256,now));
  }
});
test('bucket/Source/region/version/encryption/ownership/public access and exact current absence are hard requirements',async()=>{
  const {p}=await fixture();assertBucket(p);
  for(const fn of [v=>{v.source.UserId='other';},v=>{v.region='us-east-1';},v=>{v.versioning.Status='Suspended';},v=>{v.encryption.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm='aws:kms';},
    v=>{v.ownership.Rules[0].ObjectOwnership='ObjectWriter';},v=>{v.publicAccess.BlockPublicPolicy=false;},v=>{v.policyIsPublic=true;},
    v=>{v.targetAbsent=false;},v=>{v.deleteMarker=true;},v=>{v.encryption.Rules.push(v.encryption.Rules[0]);}]){const v=structuredClone(p);fn(v);assert.throws(()=>assertBucket(v));}
});
test('ACK requires exact key, non-null fixed VersionId, AES256 and SHA256 rather than ETag',async()=>{
  const {ack}=await fixture();assert.deepEqual(assertAck(ack),{key:packageKey(),versionId:ack.versionId,sha256:K.packageSha256});
  for(const fn of [v=>{v.key='other';},v=>{v.versionId='null';},v=>{v.versionId='';},v=>{v.checksum=undefined;},v=>{v.encryption='aws:kms';}]){
    const v=structuredClone(ack);fn(v);assert.throws(()=>assertAck(v));}
});
test('ordered one-use flow reads package only after preflight and consumes before final read/one PUT/ACK',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT');
  for(const [a,b] of [['preflight','package'],['package','slot'],['slot','final'],['final','put'],['put','put-ack']])assert.ok(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='put').length,1);
});
test('production body verifier rejects synthetic payload before consuming a permanent slot',async()=>{
  const f=await runner();await assert.rejects(uploadPackageOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:()=>now}),/BODY_CHANGED/);
  assert.equal(f.events.includes('slot'),false);assert.equal(f.events.includes('put'),false);
});
test('bad approval and drifting read-only preconditions stop before package read/slot/write',async()=>{
  const f=await runner();await assert.rejects(uploadPackageOnce({manifest:f.m,approved:'bad',io:f.io,now:()=>now}));assert.deepEqual(f.events,[]);
  f.io.preflight=async()=>({...f.p,policyIsPublic:true});await assert.rejects(f.run());assert.equal(f.events.includes('package'),false);assert.equal(f.events.includes('slot'),false);
});
test('every unknown final read, PUT or ACK failure preserves once-only slot without a second PUT',async()=>{
  for(const s of ['final','put','put-ack-unverified','put-ack']){const f=await runner();f.fail(s);const r=await f.run();assert.match(r.outcome,/PARTIAL_OR_UNKNOWN/);
    assert.equal(r.retryAllowed,false);await assert.rejects(f.run());assert.ok(f.events.filter(x=>x==='put').length<=1);}
});
test('HEAD only treats named 404 without a delete-marker as absence; 403, unknown errors and deletion markers stop',()=>{
  const missing={name:'NotFound',$metadata:{httpStatusCode:404},$response:{headers:{}}};assert.equal(isDefiniteMissing(missing),true);
  for(const e of [{...missing,$metadata:{httpStatusCode:403}},{...missing,name:'Unknown'},
    {...missing,DeleteMarker:true},{...missing,DeleteMarker:'true'},{...missing,$response:undefined},
    {...missing,$response:{headers:{'X-Amz-Delete-Marker':'true'}}},{}])assert.equal(isDefiniteMissing(e),false);
});
test('expired approval or local drift after final read prevents network PUT and leaves slot permanently consumed',async()=>{
  const f=await runner();f.io.finalRead=async()=>{f.events.push('final');f.at(f.m.expiresAt);return {source:f.p.source,targetAbsent:true,deleteMarker:false};};
  assert.match((await f.run()).outcome,/PARTIAL/);assert.equal(f.events.includes('put'),false);
  const v=await runner();v.io.finalRead=async()=>({source:v.p.source,targetAbsent:false,deleteMarker:false});assert.match((await v.run()).outcome,/PARTIAL/);assert.equal(v.events.includes('put'),false);
});
test('read-only SDK capability refuses publication functions before any credentials, network, package read or slot',async()=>{
  const {m}=await fixture(),io=await createPackageIo(m,'unused',{inspect:true});
  try{for(const fn of [()=>io.preflight(),()=>io.finalRead(),()=>io.readPackage(),()=>io.consume({}),()=>io.put('x')])await assert.rejects(Promise.resolve().then(fn));
    assert.deepEqual(io.counts(),{sourceSts:0,bucketMetadata:0,targetHead:0,localPackageReads:0,put:0,fixedVersionGet:0});}finally{io.close();}
});
test('CLI offers no package/key/bucket/endpoint/profile/retry/activation override',()=>{
  if(process.platform==='win32')assert.equal(parsePackageArgs(['--mode','PrepareSaved','--output','F:/ChatGPT_workshop/techlong-w9l-recovery-package-test','--ci-run','123'])['--mode'],'PrepareSaved');
  for(const args of [[],['--mode','Upload'],['--mode','Delete','--output','x'],['--mode','PrepareSaved','--output','x','--ci-run','123','--bucket','other']])assert.throws(()=>parsePackageArgs(args));
});
test('SDK source has exactly one conditional PUT and fixed-version GET, no delete, IAM, SQL, Secret or dispatch writer',async()=>{
  const code=await readFile(new URL('../ops/platform-recovery-package-v1/local.mjs',import.meta.url),'utf8');
  assert.equal((code.match(/new PutObjectCommand/g)??[]).length,1);assert.equal((code.match(/new GetObjectCommand/g)??[]).length,1);
  assert.match(code,/VersionId:ref.versionId/);assert.match(code,/maxAttempts:1/);assert.match(code,/readOnly|READ_ONLY_CAPABILITY/);
  assert.doesNotMatch(code,/DeleteObjectCommand|GetSecretValueCommand|UpdateAssumeRolePolicy|CreateChangeSet|signAppJwt|\.env\.local|new pg\.|\/dispatches/);
  assert.match(code,/x-amz-delete-marker/);assert.match(code,/httpStatusCode===404/);assert.match(code,/if\(isDefiniteMissing\(e\)\)/);
});
test('new package uploader does not enter or modify the frozen 97-file cloud closure',async()=>{
  const c=await recoveryCloudClosure();assert.equal(c.pinCount,97);assert.equal(c.closureSha256,K.closureSha256);assert(!c.pins.some(p=>p.file.startsWith('ops/platform-recovery-package-v1/')));
});
