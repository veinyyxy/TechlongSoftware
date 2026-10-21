import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AUTH_PATHS, AUTH_SOURCES, authSubject, verifyAuthReview, authAuditFetch, executeAuthOnce } from '../scripts/review-platform-controller-auth-v6.mjs';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';
import { CONTROL_SCOPE as S } from '../lib/deployments/controller-v6/contract.ts';

// Generated in memory. No filesystem key loader, .env, network or user PEM access.
const pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'}).toString();
const now=1792418400000;
function fixture(patch={}) {
  const order=[], calls=[], receipts=[];
  const account={id:Number(S.ownerId),login:'veinyyxy',type:'User'};
  const permissions={actions:'write',contents:'read',metadata:'read'};
  const fetcher=async(input,init)=>{
    const url=new URL(String(input)),method=init.method;
    calls.push({pathname:url.pathname,method});order.push(method+' '+url.pathname);
    const read={actions:'read',contents:'read',metadata:'read'};
    if(method==='DELETE')return new Response(null,{status:patch.revokeFails?503:204});
    if(method==='POST') {
      if(patch.unknownIssue)throw Error('PRIVATE_PROVIDER_DIAGNOSTIC_WITH_TOKEN');
      return Response.json({token:'test-credential-never-return-in-receipt',permissions:patch.overbroadToken?permissions:read,
        expires_at:new Date(now+3600000).toISOString()},{status:201});
    }
    if(url.pathname==='/app')return Response.json({id:Number(S.appId),slug:'techlong-sandbox-controller',name:'Techlong Sandbox Controller',
      external_url:'https://github.com/'+S.repository,html_url:'https://github.com/apps/techlong-sandbox-controller',owner:account,
      permissions:patch.extraPermission?{...permissions,deployments:'write'}:permissions,events:[]});
    if(url.pathname.startsWith('/app/installations/'))return Response.json({id:Number(S.installationId),app_id:Number(S.appId),app_slug:'techlong-sandbox-controller',
      target_id:Number(S.ownerId),target_type:'User',account,permissions,events:[],repository_selection:'selected',suspended_at:null});
    if(url.pathname==='/installation/repositories') {
      if(patch.badBody)return new Response('{');
      return Response.json({total_count:1,repositories:[{id:Number(S.repositoryId),full_name:S.repository,owner:account}]});
    }
    return Response.json({id:Number(S.candidateBotId),login:'techlong-sandbox-controller[bot]',type:'Bot'});
  };
  return {order,calls,receipts,deps:{manifestSha256:'a'.repeat(64),now:()=>now,fetch:fetcher,
    assertReady:async()=>{order.push('ready');if(patch.notReady)throw Error('expired');},
    claim:async()=>{order.push('claim');if(patch.occupied)throw Error('occupied');},
    readPrivateKey:async()=>{order.push('key');if(patch.keyFails)throw Error('PRIVATE_FILE_SYSTEM_DIAGNOSTIC');return pem;},
    saveReceipt:async receipt=>{order.push('receipt');receipts.push(receipt);}}};
}
test('exact review SHA, key metadata, source pins and 48h deadline are mandatory',async()=>{
  const metadata={length:1675,aclSha256:'b'.repeat(64)},pins=[{file:'fixture',normalizedLfSha256:'c'.repeat(64)}];
  const subject=authSubject(now,metadata,pins),manifestSha256=await sha256Hex(subject),review={subject,manifestSha256};
  await verifyAuthReview(review,manifestSha256,now+47*3600000,metadata,pins);
  for(const [sha,time,meta,files] of [[manifestSha256,now+48*3600000,metadata,pins],['d'.repeat(64),now,metadata,pins],
    [manifestSha256,now,{...metadata,length:1},pins],[manifestSha256,now,metadata,[]]])
    await assert.rejects(verifyAuthReview(review,sha,time,meta,files));
  const altered={subject:{...subject,tokenRequest:{permissions:{actions:'write'}}}};altered.manifestSha256=await sha256Hex(altered.subject);
  await assert.rejects(verifyAuthReview(altered,altered.manifestSha256,now,metadata,pins),/DRIFT/);
  assert.equal(AUTH_SOURCES.length,9);assert.equal(subject.limits.dispatches,0);assert.equal(subject.keyPath,AUTH_PATHS.key);
});
test('historical auth review stays immutable and cannot approve the redirect-fixed sources',async()=>{
  const root=new URL('../',import.meta.url),review=JSON.parse(await readFile(new URL(AUTH_PATHS.review,root),'utf8'));
  const pins=await Promise.all(AUTH_SOURCES.map(async file=>({file,normalizedLfSha256:createHash('sha256')
    .update((await readFile(new URL(file,root),'utf8')).replace(/\r\n/g,'\n')).digest('hex')})));
  assert.equal(review.manifestSha256,'22dc06b289f5964464ec27f537540d68a006f20fd68d391239956af3bbf48782');
  await verifyAuthReview(review,review.manifestSha256,review.subject.preparedAt,review.subject.keyMetadata,review.subject.sourcePins);
  assert.notDeepEqual(pins,review.subject.sourcePins);
  await assert.rejects(verifyAuthReview(review,review.manifestSha256,review.subject.preparedAt,review.subject.keyMetadata,pins),/CONTROL_AUTH_DRIFT/);
  assert.equal(review.subject.keyContentIntegrityProved,false);assert.equal(review.subject.runtimeRemainsUnpublished,true);
});
test('success claims before one key read, restricts token, revokes before sanitized receipt',async()=>{
  const f=fixture(),r=await executeAuthOnce(f.deps);
  assert.deepEqual(f.order.slice(0,3),['ready','claim','key']);assert.equal(r.keyReadAttempts,1);
  assert.equal(r.outcome,'AUTH_METADATA_MATCH_TOKEN_REVOKED');assert.equal(r.tokenMayRemain,false);
  assert.equal(r.tokenRevocationHttp204,true);assert.equal(f.calls.length,6);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.at(-1).method,'DELETE');
  assert.equal(f.order.at(-1),'receipt');assert.equal(r.identity.canDispatch,false);
  assert.equal(r.identity.installationRepositoryCountVerified,false);assert.equal(r.identity.dispatchActorObserved,false);
  assert.doesNotMatch(JSON.stringify(r),/test-credential|BEGIN RSA|PRIVATE_PROVIDER|authorization|"token":/i);
});
test('preflight or occupied permanent slot stops before key/network/receipt',async()=>{
  for(const patch of [{notReady:true},{occupied:true}]){
    const f=fixture(patch);await assert.rejects(executeAuthOnce(f.deps));
    assert.equal(f.order.includes('key'),false);assert.equal(f.calls.length,0);assert.equal(f.receipts.length,0);
  }
});
test('key loader failure consumes intent but sanitizes error without network',async()=>{
  const f=fixture({keyFails:true}),r=await executeAuthOnce(f.deps);
  assert.equal(r.outcome,'STOPPED_REQUIRES_INSPECTION_NO_RETRY');assert.equal(r.reason,'CONTROL_AUTH_STOPPED');
  assert.equal(r.tokenMayRemain,false);assert.equal(f.calls.length,0);assert.equal(r.retryAuthorized,false);
});
test('App permission drift rejects before real token creation',async()=>{
  const f=fixture({extraPermission:true}),r=await executeAuthOnce(f.deps);
  assert.equal(r.reason,'CONTROL_APP_PERMISSIONS');assert.equal(f.calls.length,2);
  assert.equal(r.tokenIssueAttempted,false);assert.equal(r.tokenRevocationAttempted,false);
});
test('unknown token POST is not reissued and explicitly may have left a live credential',async()=>{
  const f=fixture({unknownIssue:true}),r=await executeAuthOnce(f.deps);
  assert.equal(r.tokenIssueAttempted,true);assert.equal(r.tokenIssueHttp201,false);assert.equal(r.tokenMayRemain,true);
  assert.equal(r.tokenRevocationAttempted,false);assert.equal(f.calls.length,3);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_PROVIDER/);
});
test('overbroad issued token or malformed metadata still causes exactly one cleanup',async()=>{
  for(const patch of [{overbroadToken:true},{badBody:true}]){
    const f=fixture(patch),r=await executeAuthOnce(f.deps);
    assert.equal(r.outcome,'STOPPED_REQUIRES_INSPECTION_NO_RETRY');assert.equal(r.tokenRevocationHttp204,true);
    assert.equal(r.tokenMayRemain,false);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
    assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  }
});
test('unconfirmed revocation preserves risk, never retries or reports authentication success',async()=>{
  const f=fixture({revokeFails:true}),r=await executeAuthOnce(f.deps);
  assert.equal(r.reason,'CONTROL_TOKEN_REVOKE_UNCONFIRMED');assert.equal(r.tokenMayRemain,true);
  assert.equal(r.outcome,'STOPPED_REQUIRES_INSPECTION_NO_RETRY');assert.equal(f.calls.length,6);
  assert.equal(r.identity,null);assert.equal(r.runtimeEnabled,false);
});
test('audit network boundary rejects dispatch, redirection, duplicates, reordering and write token before fetch',async()=>{
  let network=0;const f=authAuditFetch(async()=>{network++;return new Response(null,{status:200});},[]);
  const init={method:'GET',redirect:'manual',cache:'no-store'};
  for(const url of ['https://evil.invalid/app','https://api.github.com/app?x=1',
    'https://api.github.com/repos/'+S.repository+'/actions/workflows/x/dispatches',
    'https://api.github.com/installation/repositories'])await assert.rejects(f(url,init));
  for(const redirect of ['follow','error'])await assert.rejects(f('https://api.github.com/app',{...init,redirect}));assert.equal(network,0);
  await f('https://api.github.com/app',init);await assert.rejects(f('https://api.github.com/app',init));assert.equal(network,1);
  await f('https://api.github.com/app/installations/'+S.installationId,init);
  await assert.rejects(f('https://api.github.com/app/installations/'+S.installationId+'/access_tokens',
    {...init,method:'POST',body:JSON.stringify({repository_ids:[Number(S.repositoryId)],permissions:{actions:'write',contents:'read',metadata:'read'}})}));
  assert.equal(network,2);
});
