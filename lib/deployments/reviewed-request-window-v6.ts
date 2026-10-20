// Public request capability only. No DB, environment, filesystem or network I/O.
import {canonicalJson,sha256Hex} from './execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S,InitializedRequestError,parseInitializedRequestBody} from './initialized-platform-request-v1.ts';
import {INSTALLED_BINDING_V6 as B} from './controller-v6/installed-binding.ts';
export const REQUEST_WINDOW_BINDING_V6='TECHLONG_PLATFORM_REQUEST_WINDOW_V6';
export const REQUEST_ADMIN_V6='usr_4dcd0a09821fde2bb1801f58';
export interface ReviewedRequestWindowV6 {schema:string;sourceCommit:string;releaseSha256:string;origin:string;clientRequestId:string;
  adminUserId:string;requestId:string;jobId:string;issuedAt:number;expiresAt:number}
export async function makeReviewedRequestWindowV6(input:{sourceCommit:string;clientRequestId:string;issuedAt:number;expiresAt:number}):Promise<ReviewedRequestWindowV6>{
  const requestId=await sha256Hex({purpose:'platform-initialized-request/v1',clientRequestId:input.clientRequestId,adminUserId:REQUEST_ADMIN_V6,scope:S});
  const jobId='job_'+(await sha256Hex({purpose:'express-initialized-job/v2',deploymentId:S.deploymentId,materialSha256:S.materialSha256,requestId})).slice(0,24);
  return {schema:'techlong/platform-request-window/v6',...input,releaseSha256:await sha256Hex(B.platform),origin:'http://127.0.0.1:3100',
    adminUserId:REQUEST_ADMIN_V6,requestId,jobId};
}
export function requestWindowShapeV6(raw:unknown,now:number):ReviewedRequestWindowV6|null{
  if(typeof raw!=='string'||raw.length>2400||!Number.isSafeInteger(now)||now<=0)return null;
  try{const v=JSON.parse(raw);
    if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!==
      'adminUserId,clientRequestId,expiresAt,issuedAt,jobId,origin,releaseSha256,requestId,schema,sourceCommit'||
      v.schema!=='techlong/platform-request-window/v6'||v.origin!=='http://127.0.0.1:3100'||v.adminUserId!==REQUEST_ADMIN_V6||
      !/^[a-f0-9]{40}$/.test(v.sourceCommit)||!/^[a-f0-9]{64}$/.test(v.releaseSha256)||!/^[a-f0-9]{64}$/.test(v.requestId)||
      !/^job_[a-f0-9]{24}$/.test(v.jobId)||v.jobId==='job_ecbf09030d3da7286ea3ef93'||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.clientRequestId)||
      !Number.isSafeInteger(v.issuedAt)||!Number.isSafeInteger(v.expiresAt)||v.issuedAt>now||now>=v.expiresAt||
      v.expiresAt<=v.issuedAt||v.expiresAt-v.issuedAt>1800000)return null;
    return v;
  }catch{return null;}
}
export async function verifiedRequestWindowV6(raw:unknown,now:number){
  const v=requestWindowShapeV6(raw,now);if(!v||B.state!=='PUBLISHED')return null;
  const expected=await makeReviewedRequestWindowV6({sourceCommit:v.sourceCommit,clientRequestId:v.clientRequestId,issuedAt:v.issuedAt,expiresAt:v.expiresAt});
  return canonicalJson(v)===canonicalJson(expected)?v:null;
}
const denied=()=>new InitializedRequestError('REVIEWED_REQUEST_WINDOW_CLOSED','受审请求窗口不符、已到期或已尝试；请只读核对，不要重试。');
export function createReviewedRequestFenceV6(){
  const used=new Set<string>();
  return {async begin(raw:unknown,admin:string,body:unknown,now:number){
    const v=await verifiedRequestWindowV6(raw,now),b=parseInitializedRequestBody(body);
    if(!v||admin!==v.adminUserId||b.clientRequestId!==v.clientRequestId||used.has(v.requestId))throw denied();
    used.add(v.requestId);return v;
  },async assertLive(raw:unknown,original:ReviewedRequestWindowV6,now:number){
    const v=await verifiedRequestWindowV6(raw,now);if(!v||canonicalJson(v)!==canonicalJson(original))throw denied();
  }};
}
