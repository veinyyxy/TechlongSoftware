import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { createGitHubController, signAppJwt } from '../lib/deployments/controller-v6/github.ts';
import { CONTROL_SCOPE as S, PLATFORM_RELEASE } from '../lib/deployments/controller-v6/contract.ts';
import { TEST_NOW, TEST_RELEASE, controlPlanFixture } from './fixtures/platform-controller-v6.ts';
// Fresh throwaway key in memory only. Never open the user's PEM or .env.
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=pair.privateKey.export({type:'pkcs1',format:'pem'}).toString();
const jwtPart=(text:string)=>JSON.parse(Buffer.from(text,'base64url').toString('utf8'));
function apiFixture(patch:{extraPermission?:boolean;wrongAck?:boolean;wrongActor?:boolean;revokeFails?:boolean;unknownPost?:boolean;wrongMain?:boolean}={}) {
  const calls:{path:string;method:string;body:Record<string,unknown>|null}[]=[],headers:Headers[]=[];
  const permissions={actions:'write',contents:'read',metadata:'read'},account={id:Number(S.ownerId),login:'veinyyxy',type:'User'};
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):null;
    assert.equal(url.origin,'https://api.github.com');assert.equal(init?.redirect,'error');headers.push(new Headers(init?.headers));
    calls.push({path:url.pathname,method,body});let value:unknown;
    if(url.pathname==='/app')value={id:Number(S.appId),slug:'techlong-sandbox-controller',name:'Techlong Sandbox Controller',
      external_url:'https://github.com/'+S.repository,html_url:'https://github.com/apps/techlong-sandbox-controller',owner:account,
      permissions:patch.extraPermission?{...permissions,deployments:'write'}:permissions,events:[]};
    else if(url.pathname===`/app/installations/${S.installationId}`)value={id:Number(S.installationId),app_id:Number(S.appId),app_slug:'techlong-sandbox-controller',
      target_id:Number(S.ownerId),target_type:'User',account,permissions,events:[],repository_selection:'selected',suspended_at:null};
    else if(url.pathname.endsWith('/access_tokens'))return Response.json({token:'fixture-installation-token-not-a-real-secret',permissions:body.permissions,
      expires_at:new Date(TEST_NOW+3600000).toISOString()},{status:201});
    else if(url.pathname==='/installation/token')return new Response(null,{status:patch.revokeFails?503:204});
    else if(url.pathname==='/installation/repositories')value={total_count:1,repositories:[{id:Number(S.repositoryId),full_name:S.repository,owner:account}]};
    else if(url.pathname==='/users/techlong-sandbox-controller%5Bbot%5D')value={id:Number(S.candidateBotId),login:'techlong-sandbox-controller[bot]',type:'Bot'};
    else if(url.pathname.endsWith('/git/ref/heads/main'))value={object:{sha:(patch.wrongMain?'a':'f').repeat(40)}};
    else if(url.pathname.endsWith('/dispatches')){
      if(patch.unknownPost)throw Error('PRIVATE_PROVIDER_DIAGNOSTIC');
      value={workflow_run_id:123,html_url:patch.wrongAck?'https://evil.invalid':`https://github.com/${S.repository}/actions/runs/123`,
        run_url:`https://api.github.com/repos/${S.repository}/actions/runs/123`};
    }else if(url.pathname.endsWith('/actions/runs/123'))value={id:123,run_attempt:1,event:'workflow_dispatch',head_branch:'main',head_sha:'f'.repeat(40),
      workflow_id:Number(TEST_RELEASE.workflowId),repository:{id:Number(S.repositoryId),full_name:S.repository,owner:account},
      actor:{id:Number(patch.wrongActor?S.ownerId:S.candidateBotId)},triggering_actor:{id:Number(S.candidateBotId)},status:'completed',conclusion:'success',
      referenced_workflows:[{sha:TEST_RELEASE.reusableCommit,path:`${S.repository}/.github/workflows/cloud-worker-platform-job-v6.yml@${TEST_RELEASE.reusableCommit}`}]};
    else if(url.pathname.endsWith('/actions/workflows/'+S.workflowFile))value={id:Number(TEST_RELEASE.workflowId),state:'active',path:'.github/workflows/'+S.workflowFile};
    else throw Error('UNEXPECTED_TEST_ENDPOINT');
    return Response.json(value);
  };
  return {calls,headers,fetcher,client:createGitHubController({release:TEST_RELEASE,privateKey:async()=>pem,fetch:fetcher,now:()=>TEST_NOW})};
}
test('WebCrypto signs PKCS1 and PKCS8 RS256 JWT with fixed App ID and bounded expiry',async()=>{
  for(const key of [pem,pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()]){
    const jwt=await signAppJwt(key,TEST_NOW),parts=jwt.split('.'),body=jwtPart(parts[1]);
    assert.deepEqual(jwtPart(parts[0]),{alg:'RS256',typ:'JWT'});assert.equal(body.iss,S.appId);
    assert.equal(body.iat,Math.floor(TEST_NOW/1000)-60);assert.ok(body.exp-body.iat<=600);
    assert.ok(verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),createPublicKey(pair.privateKey),Buffer.from(parts[2],'base64url')));
  }
  await assert.rejects(signAppJwt('not a PEM',TEST_NOW),{message:'CONTROL_KEY_FORMAT'});
});
test('single scoped dispatch, exact ACK recorded before token revocation; no approval/rerun endpoint',async()=>{
  const f=apiFixture(),order:string[]=[],plan=await controlPlanFixture();
  const ack=await f.client.dispatch(plan,async()=>{order.push('guard');},async()=>{order.push('durableAck');});
  assert.equal(ack.runId,'123');assert.deepEqual(order,['guard','durableAck']);
  const token=f.calls.find(c=>c.path.endsWith('/access_tokens'))!;assert.deepEqual(token.body,{repository_ids:[Number(S.repositoryId)],permissions:{actions:'write',contents:'read',metadata:'read'}});
  const posts=f.calls.filter(c=>c.path.endsWith('/dispatches'));assert.equal(posts.length,1);assert.equal(posts[0].body?.return_run_details,true);
  assert.equal(f.calls.at(-1)?.path,'/installation/token');assert.equal(f.calls.at(-1)?.method,'DELETE');
  assert.ok(f.calls.every(c=>!/rerun|pending_deployments/.test(c.path)));
});
test('inspection before publication mints only read token and returns no secrets or dispatch authority',async()=>{
  const g=apiFixture(),client=createGitHubController({release:PLATFORM_RELEASE,privateKey:async()=>pem,fetch:g.fetcher,now:()=>TEST_NOW});
  const result=await client.inspectInstallation();
  assert.equal(result.appId,S.appId);assert.equal(result.canDispatch,false);assert.equal(result.dispatchActorObserved,false);
  assert.equal(result.tokenRepositoryScopeVerified,true);assert.equal(result.installationRepositoryCountVerified,false);
  assert.doesNotMatch(JSON.stringify(result),/fixture-installation-token|BEGIN RSA|"(?:token|authorization|pem)":/i);
  const token=g.calls.find(c=>c.path.endsWith('/access_tokens'))!;assert.equal((token.body?.permissions as Record<string,string>).actions,'read');
  assert.equal(g.calls.filter(c=>c.path.endsWith('/dispatches')).length,0);
});
test('permission/main drift, unknown or incorrect ACK stop without dispatch retries; token is cleaned up',async()=>{
  for(const patch of [{extraPermission:true},{wrongMain:true},{unknownPost:true},{wrongAck:true}]){
    const f=apiFixture(patch);await assert.rejects(f.client.dispatch(await controlPlanFixture(),async()=>{},async()=>{}));
    assert.ok(f.calls.filter(c=>c.path.endsWith('/dispatches')).length<=1);
    if(patch.extraPermission)assert.equal(f.calls.some(c=>c.path.endsWith('/access_tokens')),false);
    else assert.equal(f.calls.at(-1)?.method,'DELETE');
  }
});
test('token cleanup failure occurs after durable ACK; exact actor and reusable checks apply to observation',async()=>{
  const f=apiFixture({revokeFails:true});let ackSaved=false;
  await assert.rejects(f.client.dispatch(await controlPlanFixture(),async()=>{},async()=>{ackSaved=true;}),/REVOKE_UNCONFIRMED/);assert.equal(ackSaved,true);
  const wrong=apiFixture({wrongActor:true});await assert.rejects(wrong.client.observe(await controlPlanFixture(),'123'),/RUN_IDENTITY/);
  assert.equal(wrong.calls.at(-1)?.method,'DELETE');
  const good=apiFixture();assert.equal((await good.client.observe(await controlPlanFixture(),'123')).conclusion,'success');
});
test('last-moment guard failure prevents POST, while unpublished dispatch never asks for a key',async()=>{
  const f=apiFixture();await assert.rejects(f.client.dispatch(await controlPlanFixture(),async()=>{throw Error('deadline expired');},async()=>{}));
  assert.equal(f.calls.filter(c=>c.path.endsWith('/dispatches')).length,0);assert.equal(f.calls.at(-1)?.method,'DELETE');
  let keyReads=0;const c=createGitHubController({release:PLATFORM_RELEASE,privateKey:async()=>{keyReads++;return pem;},fetch:f.fetcher});
  await assert.rejects(c.dispatch(await controlPlanFixture(),async()=>{},async()=>{}),/UNPUBLISHED/);assert.equal(keyReads,0);
});
