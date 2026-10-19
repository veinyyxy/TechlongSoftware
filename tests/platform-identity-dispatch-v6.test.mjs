import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {D,SOURCES,hash,makeReview,verifyReview,dispatchOnce,exactAck,verifyAckBinding,cleanupSummary,verifyRunContext,
  artifactReference,decodeProofZip,verifyProof,boundedBytes} from '../ops/platform-identity-review-v6/dispatch.mjs';
import {identityProofV6} from '../ops/platform-cloud-v6/identity.mjs';
import {S,CLOUD_V6 as C} from '../ops/platform-cloud-v6/contract.mjs';
const now=Date.parse('2026-10-19T19:30:00Z'),source='a'.repeat(40),nonce='b'.repeat(64),runId='123456789';
// In-memory disposable test key; NEVER the user's PEM, filesystem loader or network.
const pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'}).toString();
const workflow=await readFile(new URL('../.github/workflows/platform-controller-identity-v6.yml',import.meta.url),'utf8');
const metadata={length:1675,keyContentRead:false,protectedThreePrincipalAcl:true};
const review=()=>makeReview({sourceCommit:source,nonce,createdAt:now,keyMetadata:metadata,pins:SOURCES.map(file=>({file,sha256:'c'.repeat(64)}))});
const url=`https://github.com/${S.repository}/actions/runs/${runId}`;
const ackBody={workflow_run_id:Number(runId),html_url:url,run_url:D.api+'/repos/'+S.repository+'/actions/runs/'+runId};
function fixture(patch={}){
  const m=review(),calls=[],events=[];let occupied=false,receipt,ack,clock=now;
  const account={id:Number(S.ownerId),login:'veinyyxy',type:'User'},permissions={actions:'write',contents:'read',metadata:'read'};
  const fetcher=async(input,init)=>{
    const path=new URL(String(input)).pathname,method=init.method;calls.push({path,method,body:init.body?JSON.parse(init.body):undefined});events.push(method+' '+path);
    assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
    if(method==='DELETE'){if(patch.revokeThrows)throw Error('PRIVATE_NETWORK_DETAIL');return new Response(null,{status:patch.revokeFails?503:204});}
    if(path.endsWith('/access_tokens')){
      if(patch.issueUnknown)throw Error('PRIVATE_PROVIDER_TOKEN');
      if(patch.issueBadJson)return new Response('{',{status:201});
      return Response.json({token:'test-token-never-in-receipts',permissions:patch.overbroad?{...permissions,deployments:'write'}:permissions,
        expires_at:new Date(now+(patch.shortToken?5000:3600000)).toISOString()},{status:201});
    }
    if(path.endsWith('/dispatches')){
      if(patch.dispatchUnknown)throw Error('PRIVATE_TOKEN_IN_NETWORK_ERROR');
      return Response.json(patch.badAck?{...ackBody,html_url:'https://evil.invalid/run'}:ackBody);
    }
    if(path==='/app')return Response.json({id:Number(S.appId),slug:'techlong-sandbox-controller',name:'Techlong Sandbox Controller',
      external_url:'https://github.com/'+S.repository,html_url:'https://github.com/apps/techlong-sandbox-controller',owner:account,events:[],
      permissions:patch.appDrift?{...permissions,contents:'write'}:permissions});
    if(path.startsWith('/app/installations/'))return Response.json({id:Number(S.installationId),app_id:Number(S.appId),app_slug:'techlong-sandbox-controller',
      account,target_id:Number(S.ownerId),target_type:'User',repository_selection:'selected',suspended_at:null,events:[],permissions});
    if(path==='/installation/repositories'){
      if(patch.metadataBadJson)return new Response('{');
      return Response.json({total_count:patch.extraRepo?2:1,repositories:[{id:Number(S.repositoryId),full_name:S.repository,owner:account}]});
    }
    if(path.startsWith('/users/'))return Response.json({id:patch.botDrift?1:Number(S.candidateBotId),type:'Bot',login:'techlong-sandbox-controller[bot]'});
    if(path.endsWith('/git/ref/heads/main'))return Response.json({ref:'refs/heads/main',object:{sha:patch.mainDrift?'d'.repeat(40):source}});
    if(path.includes('/contents/'))return Response.json({type:'file',sha:D.workflowBlob,encoding:'base64',content:Buffer.from(patch.bytesDrift?'bad':workflow.replaceAll('\r\n','\n')).toString('base64')});
    if(path.endsWith('/runs'))return Response.json({total_count:patch.priorRun?1:0,workflow_runs:patch.priorRun?[{id:123}]:[]});
    return Response.json({id:Number(D.workflowId),path:D.workflowFile,state:'active'});
  };
  const deps={now:()=>clock,fetch:fetcher,assertReady:async()=>{events.push('ready');if(patch.notReady)throw Error('drift');},
    preflight:async()=>{events.push('preflight');if(patch.preflightFail)throw Error('remote drift');},
    claim:async()=>{events.push('claim');assert.equal(occupied,false);occupied=true;},
    readKey:async()=>{events.push('key');assert.equal(occupied,true);if(patch.keyFails)throw Error('PRIVATE_KEY_PATH');return pem;},
    beforePost:async()=>{events.push('beforePost');if(patch.expireBeforePost)clock=m.expiresAt;},
    saveAck:async v=>{events.push('ack');if(patch.ackWriteFails)throw Error('PRIVATE_FS_DETAIL');ack=v;},
    saveReceipt:async v=>{events.push('receipt');if(patch.receiptFails)throw Error('disk');receipt=v;}};
  return {m,calls,events,deps,ack:()=>ack,receipt:()=>receipt,run:()=>dispatchOnce({review:m,approved:m.manifestSha256,deps})};
}
test('review is exact, 48h, fixed workflow/key/new slot, write token but no AWS or environment approval',()=>{
  const m=review();verifyReview(m,m.manifestSha256,now);assert.equal(SOURCES.length,15);assert.equal(m.expiresAt-m.createdAt,48*3600000);
  assert.equal(m.limits.dispatchPosts,1);assert.equal(m.limits.metadataGets,8);assert.equal(m.limits.awsOrSqlCalls,0);assert.equal(m.limits.environmentApprovals,0);
  assert.equal(m.keyPath,D.key);assert.equal(m.workflowId,'389772013');assert.deepEqual(Object.keys(m.dispatchRequest.inputs).sort(),['nonce','sourceCommit']);
  for(const [value,sha,time] of [[m,'0'.repeat(64),now],[m,m.manifestSha256,m.expiresAt],[m,m.manifestSha256,now-1],
    [{...m,workflowId:'1'},m.manifestSha256,now],[{...m,extra:true},m.manifestSha256,now],[{...m,keyMetadata:{...metadata,length:2}},m.manifestSha256,now]])
    assert.throws(()=>verifyReview(value,sha,time));
  verifyReview(m,undefined,m.expiresAt+1000,true);
});
test('bad approval, readiness/preflight failure or occupied slot stop before key/network',async()=>{
  const f=fixture();await assert.rejects(dispatchOnce({review:f.m,approved:'wrong',deps:f.deps}));assert.deepEqual(f.events,[]);
  for(const patch of [{notReady:true},{preflightFail:true}]){const q=fixture(patch);await assert.rejects(q.run());assert.equal(q.events.includes('key'),false);assert.equal(q.calls.length,0);}
  await f.run();const n=f.calls.length;await assert.rejects(f.run());assert.equal(f.calls.length,n);assert.equal(f.events.filter(e=>e==='key').length,1);
});
test('one key, eight GETs, one issue/dispatch/revoke; durable ACK precedes cleanup and sanitized receipt',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.outcome,'DISPATCH_ACK_SAVED_TOKEN_REVOKED_REQUIRES_HUMAN_APPROVAL');
  assert.deepEqual(f.events.slice(0,4),['ready','preflight','claim','ready']);assert.ok(f.events.indexOf('claim')<f.events.indexOf('key'));
  assert.equal(f.calls.length,11);assert.equal(f.calls.filter(c=>c.method==='GET').length,8);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,2);assert.equal(f.calls.at(-1).method,'DELETE');
  assert.deepEqual(f.calls.find(c=>c.path.endsWith('/access_tokens')).body,f.m.tokenRequest);
  assert.deepEqual(f.calls.find(c=>c.path.endsWith('/dispatches')).body,f.m.dispatchRequest);
  assert.ok(f.events.indexOf('ack')<f.events.findIndex(e=>e.startsWith('DELETE')));assert.equal(f.events.at(-1),'receipt');
  assert.equal(f.ack().runId,runId);assert.equal(r.tokenMayRemain,false);assert.equal(r.realAppActorVerified,false);assert.equal(r.canDeploy,false);
  assert.doesNotMatch(JSON.stringify(r),/test-token|BEGIN RSA|PRIVATE_|authorization|"token":/i);
});
test('key or App drift stops without mint; no private errors enter receipt',async()=>{
  for(const patch of [{keyFails:true},{appDrift:true}]){const f=fixture(patch),r=await f.run();
    assert.equal(r.tokenIssueAttempted,false);assert.equal(r.dispatchAttempted,false);assert.equal(r.tokenMayRemain,false);
    assert.doesNotMatch(JSON.stringify(r),/PRIVATE_KEY_PATH/);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);}
});
test('unknown issue or malformed successful issue body preserves possible live-token risk, no remint',async()=>{
  for(const patch of [{issueUnknown:true},{issueBadJson:true}]){const f=fixture(patch),r=await f.run();
    assert.equal(r.tokenIssueAttempted,true);assert.equal(r.tokenMayRemain,true);assert.equal(r.tokenRevocationAttempted,false);assert.equal(r.dispatchAttempted,false);
    assert.equal(f.calls.length,3);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_PROVIDER_TOKEN/);}
});
test('overbroad/short token or post-issue metadata drift still revokes exactly once, no dispatch',async()=>{
  for(const patch of [{overbroad:true},{shortToken:true},{metadataBadJson:true},{extraRepo:true},{botDrift:true}]){const f=fixture(patch),r=await f.run();
    assert.equal(r.dispatchAttempted,false);assert.equal(r.tokenRevocationHttp204,true);assert.equal(r.tokenMayRemain,false);
    assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);assert.match(r.outcome,/STOPPED/);}
});
test('main/workflow/prior-run drift or last-second deadline prevents dispatch but not cleanup',async()=>{
  for(const patch of [{mainDrift:true},{bytesDrift:true},{priorRun:true},{expireBeforePost:true}]){const f=fixture(patch),r=await f.run();
    assert.equal(r.dispatchAttempted,false);assert.equal(r.tokenRevocationHttp204,true);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);}
});
test('unknown dispatch, malformed ACK or failed ACK persistence never redispatch and always attempts cleanup',async()=>{
  for(const patch of [{dispatchUnknown:true},{badAck:true},{ackWriteFails:true}]){const f=fixture(patch),r=await f.run();
    assert.equal(r.dispatchAttempted,true);assert.equal(r.dispatchAckSaved,false);assert.equal(r.tokenRevocationHttp204,true);assert.match(r.outcome,/PARTIAL/);
    assert.equal(f.calls.filter(c=>c.path.endsWith('/dispatches')).length,1);await assert.rejects(f.run());
    assert.equal(f.calls.filter(c=>c.path.endsWith('/dispatches')).length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_TOKEN|PRIVATE_FS/);}
});
test('revocation failure cannot erase durable dispatch ACK; receipt failure cannot cause another dispatch',async()=>{
  for(const patch of [{revokeFails:true},{revokeThrows:true}]){const f=fixture(patch),r=await f.run();assert.equal(r.dispatchAckSaved,true);
    assert.equal(r.tokenMayRemain,true);assert.match(r.outcome,/PARTIAL/);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);assert.equal(f.ack().runId,runId);}
  const f=fixture({receiptFails:true});await assert.rejects(f.run());assert.equal(f.ack().runId,runId);assert.equal(f.calls.at(-1).method,'DELETE');
  await assert.rejects(f.run());assert.equal(f.calls.filter(c=>c.path.endsWith('/dispatches')).length,1);
});
function rawRun(status='completed',conclusion='success'){return {id:Number(runId),workflow_id:Number(D.workflowId),run_attempt:1,event:'workflow_dispatch',
  path:D.workflowFile,head_sha:source,head_branch:'main',repository:{id:Number(S.repositoryId),full_name:S.repository,owner:{id:Number(S.ownerId)}},
  actor:{id:Number(S.candidateBotId)},triggering_actor:{id:Number(S.candidateBotId)},status,conclusion};}
test('only exact durable ACK/run accepted; waiting is not proof and wrong run/actor/attempt is rejected',async()=>{
  const m=review(),ack=exactAck(ackBody,m);verifyAckBinding(ack,m);verifyRunContext(rawRun(),ack,m);verifyRunContext(rawRun('waiting',null),ack,m);
  for(const a of [{...ack,runId:'../1'},{...ack,nonce:'f'.repeat(64)},{...ack,sourceCommit:'f'.repeat(40)}])assert.throws(()=>verifyAckBinding(a,m));
  for(const change of [{run_attempt:2},{actor:{id:Number(S.ownerId)}},{workflow_id:1},{head_sha:'f'.repeat(40)},{path:'.github/workflows/cloud-worker-execute.yml'}])
    assert.throws(()=>verifyRunContext({...rawRun(),...change},ack,m));
});
test('independent identity inspection never hides unknown revocation or claims a live provider revocation check',async()=>{
  const m=review();assert.equal(cleanupSummary(null,m).tokenMayRemain,true);
  const f=fixture(),receipt=await f.run(),ok=cleanupSummary(receipt,m);assert.equal(ok.tokenRevocationHttp204,true);
  assert.equal(ok.liveRevocationIndependentlyProved,false);assert.equal(cleanupSummary({...receipt,audit:[]},m).tokenMayRemain,true);
  assert.throws(()=>cleanupSummary({...receipt,manifestSha256:'0'.repeat(64)},m));
});
async function proof(){return identityProofV6({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:S.repository,GITHUB_REPOSITORY_ID:S.repositoryId,
  GITHUB_REPOSITORY_OWNER_ID:S.ownerId,GITHUB_ACTOR_ID:S.candidateBotId,GITHUB_ACTOR:C.actorLogin,GITHUB_TRIGGERING_ACTOR:C.actorLogin,
  GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:runId,GITHUB_SHA:source,
  TECHLONG_IDENTITY_SOURCE:source,TECHLONG_IDENTITY_FROZEN_SOURCE:D.frozenSource,TECHLONG_IDENTITY_NONCE:nonce,
  GITHUB_WORKFLOW_REF:`${S.repository}/${D.workflowFile}@refs/heads/main`},S.candidateBotId);}
test('independent exact run and nonce/caller/frozen/sender proof required before real identity claim',async()=>{
  const m=review(),ack=exactAck(ackBody,m),p=await proof();assert.equal((await verifyProof(p,rawRun(),ack,m)).canDeploy,false);
  for(const change of [{nonce:'f'.repeat(64)},{senderId:S.ownerId},{sourceCommit:'f'.repeat(40)},{frozenSourceCommit:'f'.repeat(40)},{awsCalls:1},{extra:true}])
    await assert.rejects(verifyProof({...p,...change},rawRun(),ack,m));
  await assert.rejects(verifyProof(p,rawRun('waiting',null),ack,m));
});
const crc32=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
function zipFor(value,{name='platform-app-identity-v6.json',method=0}={}){
  const plain=Buffer.from(JSON.stringify(value)),packed=method===8?deflateRawSync(plain):plain,n=Buffer.from(name),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(crc32(plain),14);
  local.writeUInt32LE(packed.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(n.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);
  central.writeUInt32LE(crc32(plain),16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(plain.length,24);central.writeUInt16LE(n.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);
  end.writeUInt32LE(local.length+n.length+packed.length,16);return Buffer.concat([local,n,packed,central,n,end]);
}
test('bounded in-memory ZIP accepts stored/deflated single proof with digest+CRC, no extraction',async()=>{
  const p=await proof();for(const method of [0,8]){const b=zipFor(p,{method});assert.deepEqual(decodeProofZip(b,hash(b)),p);}
  const b=zipFor(p);assert.throws(()=>decodeProofZip(b,'0'.repeat(64)));
  for(const mutate of [b=>b.writeUInt16LE(2,b.length-12),b=>b.writeUInt32LE(0,b.length-22),b=>b.writeUInt16LE(1,6),
    b=>b.writeUInt32LE(0,b.readUInt32LE(b.length-6)+16),b=>b.writeUInt32LE(9000,b.readUInt32LE(b.length-6)+24)]){
    const x=Buffer.from(b);mutate(x);assert.throws(()=>decodeProofZip(x,hash(x)));}
  for(const name of ['../platform-app-identity-v6.json','other.json']){const x=zipFor(p,{name});assert.throws(()=>decodeProofZip(x,hash(x)));}
});
test('artifact must be the only exact run/caller artifact with digest, unexpired, bounded size',()=>{
  const m=review(),ack=exactAck(ackBody,m),artifact={id:123,name:'platform-app-identity-v6-'+runId,expired:false,size_in_bytes:2000,digest:'sha256:'+'a'.repeat(64),
    workflow_run:{id:Number(runId),repository_id:Number(S.repositoryId),head_sha:source,head_branch:'main'},archive_download_url:D.api+'/repos/'+S.repository+'/actions/artifacts/123/zip'};
  assert.equal(artifactReference({total_count:1,artifacts:[artifact]},ack,m).id,'123');
  for(const change of [{expired:true},{size_in_bytes:70000},{digest:null},{name:'other'},{archive_download_url:'https://evil.invalid/a'},
    {workflow_run:{...artifact.workflow_run,head_sha:'f'.repeat(40)}}])assert.throws(()=>artifactReference({total_count:1,artifacts:[{...artifact,...change}]},ack,m));
  assert.throws(()=>artifactReference({total_count:2,artifacts:[artifact,artifact]},ack,m));
});
test('oversized response is bounded, and local entry has explicit modes/no cloud or automatic rerun/revoke path',async()=>{
  await assert.rejects(boundedBytes(new Response('x'.repeat(100)),10));
  const code=await readFile(new URL('../ops/platform-identity-review-v6/dispatch-local.mjs',import.meta.url),'utf8');
  assert.match(code,/\['Prepare','Dispatch','Inspect'\]/);assert.match(code,/bytes\?\.fill\(0\)/);assert.match(code,/flag:'wx',flush:true/);
  assert.doesNotMatch(code,/readFile\(D\.key|@aws-sdk|DATABASE_URL|method:'POST'|method:'DELETE'|Re-run|setInterval/);
  assert.match(code,/NEVER forward the GitHub Authorization header/);assert.equal(D.slot.includes('controller-auth-v6'),false);
});
