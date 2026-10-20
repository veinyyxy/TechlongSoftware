// W6l: one NEW held request; no cloud/credential discovery on import.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {makeReviewedRequestWindowV6,REQUEST_WINDOW_BINDING_V6,REQUEST_ADMIN_V6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {childEnvironmentV6,localLeaseV6,L} from '../platform-local-v6/plan.mjs';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
export const Q=Object.freeze({slot:'F:/ChatGPT_workshop/techlong-w6l-held-request.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w6l-held-request-inspect.intent.json',riskFile:'docs/aws-auto-deployment-platform-w6l-held-request-review.md',
  previousSlot:'F:/ChatGPT_workshop/techlong-w6k-local-runtime.intent.json',previousSlotSha256:'18056a059310f8e8d344ff6efdf2dbc87185c19c074ea0c7c35f5efc9bf271d2',
  previousInspect:'F:/ChatGPT_workshop/techlong-w6k-local-runtime-20261020-a-inspect/result.json',previousInspectSha256:'5d6bfc8c6b35dde354a361ae3e40f55453f7f1b22363b918de37439939e4afad'});
export const must=(v,c)=>{if(!v)throw Error('HELD_REQUEST_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export async function makeRequestReviewV6({sourceCommit,clientRequestId,pins,ci,metadata,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(clientRequestId)&&Number.isSafeInteger(createdAt)&&
    ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&pins.length>=15&&
    new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)),'SOURCE_CI');
  must(metadata.auth?.contentRead===false&&metadata.auth.length>0&&/^[a-f0-9]{64}$/.test(metadata.auth.aclSha256)&&
    metadata.portFree===true&&metadata.previousRuntimeStopped===true,'METADATA');
  const target=await makeReviewedRequestWindowV6({sourceCommit,clientRequestId,issuedAt:createdAt,expiresAt:createdAt+1800000});
  must(B.state==='PUBLISHED','BINDING');
  const body={schema:'techlong/platform-held-request-review/v6',sourceCommit,clientRequestId,pins,ci,metadata,createdAt,expiresAt:createdAt+48*3600000,
    binding:B,origin:'http://127.0.0.1:3100',runMs:1800000,authFile:L.authFile,riskFile:Q.riskFile,permanentSlot:Q.slot,independentReadbackSlot:Q.inspectSlot,
    target:{appInstanceId:S.appInstanceId,deploymentId:S.deploymentId,adminUserId:REQUEST_ADMIN_V6,clientRequestId,requestId:target.requestId,jobId:target.jobId},
    effects:{authFileReadsMax:2,privateKeyReads:0,awsSecretReads:0,childStartsMax:1,humanNewHeldJobsMax:1,readOnlyTransactionsMax:4,
      awsCalls:0,appTokens:0,workflowDispatches:0,workerEnabled:false,awsApplyEnabled:false,automaticRetries:0},
    risks:{wholeAuthFileReadTwice:true,ownerCredentialMemoryAndProviderExposure:true,normalLoginWrites:true,legacyUiWritesStillPossible:true,
      memoryFenceNotDistributedDurableCas:true,deterministicSqlDedupeNotHttpSubmissionLimit:true,partialOrUnknownCommit:true,
      noAutomaticDeleteRollbackResetRetry:true,existingCloudCostsContinue:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyRequestReviewV6(m,approved,now,inspect=false){
  must(same(m,await makeRequestReviewV6(m)),'MANIFEST_CHANGED');
  must(approved===m.manifestSha256&&now>=m.createdAt&&(inspect?now:now+1800000)<m.expiresAt,'APPROVAL_OR_EXPIRED');
}
export async function requestEnvironmentV6(m,authUrl,now){const lease=await localLeaseV6(m,now),request=await makeReviewedRequestWindowV6({
  sourceCommit:m.sourceCommit,clientRequestId:m.clientRequestId,issuedAt:lease.issuedAt,expiresAt:lease.expiresAt});
  must(request.jobId===m.target.jobId&&request.requestId===m.target.requestId,'TARGET');
  return {lease,request,environment:{...childEnvironmentV6(process.env,{authUrl,databaseUrl:'',privateKey:''},lease),
    TECHLONG_PLATFORM_CONTROLLER_ENABLED:'false',TECHLONG_PLATFORM_CONTROL_LOCAL:'false',AWS_INITIALIZED_REQUESTS_ENABLED:'true',
    [REQUEST_WINDOW_BINDING_V6]:JSON.stringify(request)}};
}
export async function startRequestOnceV6({manifest:m,approved,io,now=Date.now}){
  const approve=()=>verifyRequestReviewV6(m,approved,now());await approve();await io.assertSource(m);
  const at=now(),metadata=await io.metadata();must(now()-at<120000&&same(metadata,m.metadata),'METADATA_CHANGED');await approve();
  await io.claim({manifestSha256:m.manifestSha256,sourceCommit:m.sourceCommit,target:m.target,consumedAt:now(),retryAllowed:false});
  let phase='SLOT_CONSUMED';
  try{await approve();await io.assertSource(m);phase='AUTH_READ';const authUrl=await io.readAuth(m.metadata.auth);
    phase='BASELINE';const baseline=await io.readState(authUrl,m.target);await io.validateBaseline(baseline,m.target);await io.record('baseline',baseline);
    must(now()-at<120000,'STARTUP_WINDOW');await approve();await io.assertSource(m);phase='REQUEST_WINDOW';
    const p=await requestEnvironmentV6(m,authUrl,now());await io.record('window',{lease:p.lease,request:p.request});
    const stopped=await io.serve(p.environment,p.lease,ready=>io.record('started',{...ready,target:m.target}));
    must(stopped.childExited&&stopped.portFree&&stopped.cleanClose,'STOP_UNCONFIRMED');
    const r={outcome:'REQUEST_WINDOW_CLOSED_REQUIRES_INDEPENDENT_READBACK',target:m.target,portFree:true,retryAllowed:false};await io.record('result',r);return r;
  }catch{const r={outcome:'REQUEST_WINDOW_STOPPED_OR_UNKNOWN_NO_RETRY',phase,target:m.target,retryAllowed:false};await io.record('result',r);return r;}
}
