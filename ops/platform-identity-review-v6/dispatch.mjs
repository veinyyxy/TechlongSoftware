// A one-shot identity experiment, not a production controller or AWS entry.
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {signAppJwt} from '../../lib/deployments/controller-v6/github.ts';
import {inspectPlatformControllerPublicMetadata} from '../../lib/deployments/platform-controller-registration-v1.ts';
import {verifyIdentityProofV6} from '../platform-cloud-v6/identity.mjs';
import {S} from '../platform-cloud-v6/contract.mjs';

export const D=Object.freeze({api:'https://api.github.com',repository:S.repository,workflowId:'389772013',
  workflowFile:'.github/workflows/platform-controller-identity-v6.yml',
  workflowBlob:'4fb6626ca37730e8606abe3ae0d06000d015dcce',
  workflowSha256:'ffac70244e455a547b498fc233a9a17fa5b0c022ab598c5b9735c83436007dea',
  frozenSource:'ca2b38d8c756dd8fb800a88ded596c93687f278f',
  key:'E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem',
  slot:'F:/ChatGPT_workshop/techlong-w6e-identity-dispatch.intent.json',
  ack:'F:/ChatGPT_workshop/techlong-w6e-identity-dispatch.ack.json',
  receipt:'F:/ChatGPT_workshop/techlong-w6e-identity-dispatch.receipt.json',
  riskFile:'docs/aws-auto-deployment-platform-w6e-app-identity-dispatch.md',validMs:48*3600000});
export const SOURCES=[
  'ops/platform-identity-review-v6/dispatch.mjs','ops/platform-identity-review-v6/dispatch-local.mjs',
  'ops/platform-identity-review-v6/publication.mjs',
  'tests/platform-identity-dispatch-v6.test.mjs','scripts/controller-auth-metadata-v6.ps1',
  'lib/deployments/controller-v6/github.ts','lib/deployments/controller-v6/contract.ts',
  'lib/deployments/platform-controller-registration-v1.ts','lib/deployments/execution/hash.ts',
  'ops/platform-cloud-v6/identity.mjs','ops/platform-cloud-v6/contract.mjs',
  'ops/platform-cloud-v6/workflows.mjs',D.workflowFile,
  'ops/aws-sandbox/reviews/platform-identity-v6.executed.json',D.riskFile];
export const must=(v,c)=>{if(!v)throw Error('IDENTITY_DISPATCH_'+c);};
export const hash=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>canonicalJson(a)===canonicalJson(b),commit=v=>/^[a-f0-9]{40}$/.test(v),digest=v=>/^[a-f0-9]{64}$/.test(v);
const permissions={actions:'write',contents:'read',metadata:'read'};
const repo='/repos/'+S.repository;
export function makeReview({sourceCommit,nonce,createdAt,keyMetadata,pins}){
  must(commit(sourceCommit)&&digest(nonce)&&Number.isSafeInteger(createdAt)&&keyMetadata?.keyContentRead===false&&
    keyMetadata.protectedThreePrincipalAcl===true&&pins.length===SOURCES.length&&
    pins.every((p,i)=>p.file===SOURCES[i]&&digest(p.sha256)),'REVIEW_INPUT');
  const body={schema:'techlong/platform-app-identity-dispatch-review/v6',createdAt,expiresAt:createdAt+D.validMs,
    repository:S.repository,repositoryId:S.repositoryId,ownerId:S.ownerId,appId:S.appId,installationId:S.installationId,
    actorId:S.candidateBotId,sourceCommit,nonce,frozenSource:D.frozenSource,workflowId:D.workflowId,
    workflowFile:D.workflowFile,workflowSha256:D.workflowSha256,keyPath:D.key,keyMetadata,pins,
    slot:D.slot,ackPath:D.ack,receiptPath:D.receipt,riskFile:D.riskFile,
    tokenRequest:{repository_ids:[Number(S.repositoryId)],permissions},
    dispatchRequest:{ref:'main',return_run_details:true,inputs:{nonce,sourceCommit}},
    limits:{keyReads:1,jwtSignatures:1,tokenIssuePosts:1,metadataGets:8,dispatchPosts:1,tokenRevokeDeletes:1,
      awsOrSqlCalls:0,environmentApprovals:0,automaticRetries:0},
    requireNoPreviousIdentityRuns:true,preparationIsNotExecutionApproval:true,
    risk:'Actions write is repository-wide. Unknown token or dispatch ACK is not retried. Revocation may fail. Permanent slot is never reset.'};
  return {...body,manifestSha256:hash(canonicalJson(body))};
}
export function verifyReview(m,approved,now=Date.now(),inspect=false){
  must(same(m,makeReview(m)),'REVIEW_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'APPROVAL_OR_EXPIRED');
}
export function verifyLayout(head,workflow,contents,runs,m){
  must(head?.object?.sha===m.sourceCommit&&head.ref==='refs/heads/main','MAIN_DRIFT');
  must(String(workflow?.id)===D.workflowId&&workflow.path===D.workflowFile&&workflow.state==='active','WORKFLOW_DRIFT');
  must(contents?.type==='file'&&contents.sha===D.workflowBlob&&contents.encoding==='base64'&&
    hash(Buffer.from(contents.content,'base64'))===D.workflowSha256,'WORKFLOW_BYTES');
  must(runs?.total_count===0&&Array.isArray(runs.workflow_runs)&&runs.workflow_runs.length===0,'PRIOR_IDENTITY_RUN');
}
export async function boundedBytes(response,limit){
  const r=response.body?.getReader();must(r,'BODY');let size=0;const chunks=[];
  try{for(;;){const q=await r.read();if(q.done)break;size+=q.value.byteLength;if(size>limit){await r.cancel();must(false,'BODY_LIMIT');}chunks.push(Buffer.from(q.value));}}
  finally{r.releaseLock();}return Buffer.concat(chunks);
}
async function readJson(response){
  const b=await boundedBytes(response,256000);try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));must(v&&typeof v==='object'&&!Array.isArray(v),'JSON');return v;}
  catch{must(false,'JSON');}
}
export function exactAck(v,m){
  must(Number.isSafeInteger(v?.workflow_run_id)&&v.workflow_run_id>0,'ACK_UNKNOWN');
  const runId=String(v.workflow_run_id),url=`https://github.com/${S.repository}/actions/runs/${runId}`;
  must(v.html_url===url&&v.run_url===D.api+repo+'/actions/runs/'+runId,'ACK_UNKNOWN');
  return {schema:'techlong/platform-app-identity-dispatch-ack/v6',manifestSha256:m.manifestSha256,
    runId,url,sourceCommit:m.sourceCommit,workflowId:D.workflowId,nonce:m.nonce};
}
export async function dispatchOnce({review:m,approved,deps}){
  verifyReview(m,approved,deps.now());await deps.assertReady();await deps.preflight();
  verifyReview(m,approved,deps.now());await deps.claim(); // Before any key read or App API request.
  const audit=[],used=new Set();let keyReads=0,jwt,token,ack=null,ackSaved=false,identity=null,reason=null;
  const routes={app:['GET','/app'],installation:['GET',`/app/installations/${S.installationId}`],
    issue:['POST',`/app/installations/${S.installationId}/access_tokens`,m.tokenRequest],
    repositories:['GET','/installation/repositories'],bot:['GET','/users/techlong-sandbox-controller%5Bbot%5D'],
    head:['GET',repo+'/git/ref/heads/main'],workflow:['GET',repo+'/actions/workflows/'+D.workflowId],
    contents:['GET',repo+'/contents/'+D.workflowFile+'?ref='+m.sourceCommit],
    runs:['GET',repo+'/actions/workflows/'+D.workflowId+'/runs?per_page=100'],
    dispatch:['POST',repo+'/actions/workflows/'+D.workflowId+'/dispatches',m.dispatchRequest],
    revoke:['DELETE','/installation/token']};
  const request=async(stage,credential)=>{
    must(Object.hasOwn(routes,stage)&&!used.has(stage),'REQUEST_ONCE');used.add(stage);
    const [method,pathname,body]=routes[stage],event={stage,method,pathname,status:null,responseReceived:false};audit.push(event);
    const r=await deps.fetch(D.api+pathname,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
      headers:{accept:'application/vnd.github+json',authorization:'Bearer '+credential,'x-github-api-version':'2026-03-10',
        'content-type':'application/json','user-agent':'Techlong-Reviewed-App-Identity'},...(body?{body:JSON.stringify(body)}:{})});
    event.status=r.status;event.responseReceived=true;
    must(r.status===(stage==='issue'?201:stage==='revoke'?204:200),stage==='revoke'?'REVOKE_UNCONFIRMED':'RESPONSE');
    return stage==='revoke'?null:readJson(r);
  };
  try{
    await deps.assertReady();verifyReview(m,approved,deps.now());keyReads++;jwt=await signAppJwt(await deps.readKey(),deps.now());
    const app=await request('app',jwt),installation=await request('installation',jwt);
    must(String(app.id)===S.appId&&app.slug==='techlong-sandbox-controller'&&String(app.owner?.id)===S.ownerId&&
      same(app.permissions,permissions)&&same(installation.permissions,permissions)&&
      String(installation.id)===S.installationId&&String(installation.app_id)===S.appId&&
      installation.app_slug===app.slug&&installation.repository_selection==='selected'&&installation.suspended_at===null&&
      String(installation.account?.id)===S.ownerId&&String(installation.target_id)===S.ownerId,'APP_OR_INSTALLATION');
    const issued=await request('issue',jwt);
    // Capture usable token BEFORE permission/expiry/metadata validation so cleanup still runs on drift.
    token=typeof issued.token==='string'&&issued.token.length>0&&issued.token.length<=16000?issued.token:undefined;
    must(token,'TOKEN_UNKNOWN');
    must(same(issued.permissions,permissions),'TOKEN_SCOPE');const expiry=Date.parse(issued.expires_at);
    must(Number.isSafeInteger(expiry)&&expiry>deps.now()+60000&&expiry<=deps.now()+3660000,'TOKEN_EXPIRY');
    const repositories=await request('repositories',token),bot=await request('bot',token);
    identity=inspectPlatformControllerPublicMetadata({app,installation,repositories,bot});
    must(identity.appId===S.appId&&identity.installationId===S.installationId&&identity.candidateBotId===S.candidateBotId,'APP_METADATA');
    const head=await request('head',token),workflow=await request('workflow',token),contents=await request('contents',token),runs=await request('runs',token);
    verifyLayout(head,workflow,contents,runs,m);await deps.beforePost();verifyReview(m,approved,deps.now());
    ack=exactAck(await request('dispatch',token),m);await deps.saveAck(ack);ackSaved=true;
  }catch(e){reason=/^IDENTITY_DISPATCH_[A-Z_]+$/.test(e?.message)?e.message:'IDENTITY_DISPATCH_STOPPED';}
  finally{
    if(token){try{await request('revoke',token);}catch{reason='IDENTITY_DISPATCH_REVOKE_UNCONFIRMED';}}
    jwt=undefined;token=undefined;
  }
  const issue=audit.find(e=>e.stage==='issue'),dispatch=audit.find(e=>e.stage==='dispatch'),revoke=audit.find(e=>e.stage==='revoke');
  const receipt={schema:'techlong/platform-app-identity-dispatch-receipt/v6',manifestSha256:m.manifestSha256,finishedAt:deps.now(),
    outcome:ackSaved&&revoke?.status===204?'DISPATCH_ACK_SAVED_TOKEN_REVOKED_REQUIRES_HUMAN_APPROVAL':'STOPPED_OR_PARTIAL_INSPECT_ONLY_NO_RETRY',
    reason,keyReadAttempts:keyReads,tokenIssueAttempted:!!issue,tokenIssueHttp201:issue?.status===201,
    tokenRevocationAttempted:!!revoke,tokenRevocationHttp204:revoke?.status===204,tokenMayRemain:!!issue&&revoke?.status!==204,
    dispatchAttempted:!!dispatch,dispatchHttp200:dispatch?.status===200,dispatchAckSaved:ackSaved,ack,identity,audit,
    realAppActorVerified:false,awsOrSqlCalls:0,environmentApprovals:0,canDeploy:false,retryAllowed:false};
  await deps.saveReceipt(receipt);return receipt;
}
export function verifyAckBinding(ack,m){
  must(ack.manifestSha256===m.manifestSha256&&ack.sourceCommit===m.sourceCommit&&ack.nonce===m.nonce&&ack.workflowId===D.workflowId&&
    /^[1-9][0-9]{0,15}$/.test(ack.runId)&&ack.url===`https://github.com/${S.repository}/actions/runs/${ack.runId}`,'ACK_BINDING');
}
export function cleanupSummary(receipt,m){
  if(!receipt)return {receiptSaved:false,tokenRevocationHttp204:false,tokenMayRemain:true,liveRevocationIndependentlyProved:false};
  must(receipt.schema==='techlong/platform-app-identity-dispatch-receipt/v6'&&receipt.manifestSha256===m.manifestSha256,'RECEIPT_BINDING');
  const revoked=receipt.tokenRevocationHttp204===true&&receipt.audit?.some(e=>e.stage==='revoke'&&e.status===204)===true;
  return {receiptSaved:true,tokenRevocationHttp204:revoked,tokenMayRemain:!revoked,liveRevocationIndependentlyProved:false};
}
export function verifyRunContext(run,ack,m){
  verifyAckBinding(ack,m);
  must(String(run.id)===ack.runId&&String(run.workflow_id)===D.workflowId&&run.run_attempt===1&&run.event==='workflow_dispatch'&&
    run.path===D.workflowFile&&run.head_sha===m.sourceCommit&&run.head_branch==='main'&&run.repository?.full_name===S.repository&&
    String(run.repository?.id)===S.repositoryId&&String(run.repository?.owner?.id)===S.ownerId&&
    String(run.actor?.id)===S.candidateBotId&&String(run.triggering_actor?.id)===S.candidateBotId,'RUN_CONTEXT');
  must(['queued','requested','waiting','pending','in_progress','completed'].includes(run.status)&&
    (run.status==='completed'?typeof run.conclusion==='string':run.conclusion===null),'RUN_STATUS');
}
export function artifactReference(list,ack,m){
  must(list?.total_count===1&&list.artifacts?.length===1,'ARTIFACT_COUNT');const a=list.artifacts[0];
  must(Number.isSafeInteger(a.id)&&a.id>0&&a.name==='platform-app-identity-v6-'+ack.runId&&a.expired===false&&
    Number.isSafeInteger(a.size_in_bytes)&&a.size_in_bytes>0&&a.size_in_bytes<=65536&&
    /^sha256:[a-f0-9]{64}$/.test(a.digest)&&String(a.workflow_run?.id)===ack.runId&&
    a.workflow_run.head_sha===m.sourceCommit&&a.workflow_run.head_branch==='main'&&
    String(a.workflow_run.repository_id)===S.repositoryId&&
    a.archive_download_url===D.api+repo+'/actions/artifacts/'+a.id+'/zip','ARTIFACT_BINDING');
  return {id:String(a.id),zipSha256:a.digest.slice(7)};
}
const crc32=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
export function decodeProofZip(zip,expectedDigest){
  must(Buffer.isBuffer(zip)&&zip.length>=100&&zip.length<=65536&&hash(zip)===expectedDigest,'ZIP_DIGEST');
  // One regular file, no filesystem extraction, ZIP64/encryption/symlinks/multi-disk or comments.
  const e=zip.length-22;must(zip.readUInt32LE(e)===0x06054b50&&zip.readUInt16LE(e+4)===0&&zip.readUInt16LE(e+6)===0&&
    zip.readUInt16LE(e+8)===1&&zip.readUInt16LE(e+10)===1&&zip.readUInt16LE(e+20)===0,'ZIP_END');
  const c=zip.readUInt32LE(e+16),size=zip.readUInt32LE(e+12);must(c>=30&&c+size===e&&size>=46,'ZIP_DIRECTORY');
  must(zip.readUInt32LE(c)===0x02014b50,'ZIP_CENTRAL');
  const flags=zip.readUInt16LE(c+8),method=zip.readUInt16LE(c+10),crc=zip.readUInt32LE(c+16),packed=zip.readUInt32LE(c+20),plain=zip.readUInt32LE(c+24),
    n=zip.readUInt16LE(c+28),x=zip.readUInt16LE(c+30),comment=zip.readUInt16LE(c+32),offset=zip.readUInt32LE(c+42);
  must((flags&~0x808)===0&&[0,8].includes(method)&&plain>0&&plain<=8192&&packed>0&&packed<=65536&&
    size===46+n+x+comment&&comment===0&&zip.readUInt16LE(c+34)===0&&
    (zip.readUInt32LE(c+38)>>>16&0xf000)!==0xa000&&offset===0,'ZIP_ENTRY');
  must(zip.subarray(c+46,c+46+n).toString('utf8')==='platform-app-identity-v6.json'&&zip.readUInt32LE(0)===0x04034b50&&
    zip.readUInt16LE(6)===flags&&zip.readUInt16LE(8)===method&&zip.readUInt16LE(26)===n,'ZIP_LOCAL');
  const start=30+n+zip.readUInt16LE(28);must(start+packed<=c&&zip.subarray(30,30+n).equals(zip.subarray(c+46,c+46+n)),'ZIP_RANGE');
  const data=zip.subarray(start,start+packed),out=method===0?data:inflateRawSync(data,{maxOutputLength:8192});
  must(out.length===plain&&crc32(out)===crc,'ZIP_CRC');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(out));}catch{must(false,'PROOF_JSON');}
}
export async function verifyProof(proof,run,ack,m){
  verifyRunContext(run,ack,m);
  return verifyIdentityProofV6(proof,run,{nonce:m.nonce,sourceCommit:m.sourceCommit,frozenSourceCommit:D.frozenSource,
    workflowId:D.workflowId,runId:ack.runId});
}
