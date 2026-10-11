import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createKmsRepairAwsRuntimeV1 } from "./readonly-kms-repair-aws-runtime.mjs";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { NEON_SEALED_PROBE_FUNCTION_ARN_V1 as arn, validateNeonProbeResponseV1 } from "../../../lib/deployments/execution/readonly-neon-sealed-probe-v1.ts";
const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1},sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev",execute=promisify(execFile);
export function createNeonSealedUpdateAwsRuntimeV1(oldManifest,artifact){
 const login=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config});
 const credentials=async()=>{const c=await login(),sts=new STSClient({...config,credentials:c});try{const i=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});
   if(i.Account!=="402010193138"||i.Arn!==sourceArn)throw new Error("NEON_UPDATE_SOURCE_IDENTITY_INVALID");return c;}finally{sts.destroy();}};
 const candidate=structuredClone(oldManifest);candidate.targets[0].zipSha256=artifact.zipSha256;candidate.targets[0].zipBytes=artifact.zipBytes;
 const oldRead=createKmsRepairAwsRuntimeV1(oldManifest),newRead=createKmsRepairAwsRuntimeV1(candidate);
 const permissions=async()=>{const c=await credentials(),iam=new IAMClient({...config,credentials:c});try{const checks=[];for(const action of ["lambda:UpdateFunctionCode","lambda:InvokeFunction"]){
   const r=await iam.send(new SimulatePrincipalPolicyCommand({PolicySourceArn:sourceArn,ActionNames:[action],ResourceArns:[arn],MaxItems:100}),{abortSignal:AbortSignal.timeout(15000)});
   if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("NEON_UPDATE_SOURCE_SIMULATION_INCOMPLETE");checks.push({action,resource:arn,decision:r.EvaluationResults[0].EvalDecision});
   await new Promise(resolve=>setTimeout(resolve,600));}return checks;}finally{iam.destroy();}};
 const inventory=async(candidateCode=false,withPermissions=false)=>{
   const permissionChecks=withPermissions?await permissions():[],r=await(candidateCode?newRead:oldRead).inventory(false);
   if(r.states.some(s=>s.boundary!=="OWN_V2"||s.inline!=="OWN_REPAIRED"))throw new Error("NEON_UPDATE_KMS_IAM_DRIFT");
   const anchor=structuredClone(r.context);delete anchor.sourcePermissions;
   for(const key of ["zipSha256","revisionId","lastModified"])delete anchor.functions[0][key];
   return {observedAt:r.observedAt,predecessorAnchorSha256:r.anchorSha256,stableAnchorSha256:await sha256Hex(anchor),state:candidateCode?"CANDIDATE_READY":"OLD_READY",revisionId:r.context.functions[0].revisionId,
     sourcePermissionsAllowed:withPermissions&&permissionChecks.every(x=>x.decision==="allowed")&&permissionChecks.length===2,permissionChecks,context:r.context};
 };
 const cli=async(args)=>{if(!["lambda:get-function-configuration","logs:filter-log-events"].includes(`${args[0]}:${args[1]}`))throw new Error("NEON_UPDATE_CLI_WRITE_FORBIDDEN");
   const c=await credentials();try{const r=await execute("aws",[...args,"--region","ca-central-1","--output","json","--no-cli-pager","--cli-connect-timeout","10","--cli-read-timeout","30"],
     {windowsHide:true,timeout:35000,maxBuffer:2_000_000,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:c.accessKeyId,AWS_SECRET_ACCESS_KEY:c.secretAccessKey,AWS_SESSION_TOKEN:c.sessionToken,
       AWS_REGION:"ca-central-1",AWS_DEFAULT_REGION:"ca-central-1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_MAX_ATTEMPTS:"1",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});return JSON.parse(r.stdout);
   }catch{throw new Error("NEON_UPDATE_READ_OPERATION_UNVERIFIED");}};
 const assertTime=m=>{if(Date.now()<m.reviewedAt||Date.now()+5000>=m.expiresAt)throw new Error("NEON_UPDATE_FRESH_APPROVAL_REQUIRED");};
 const request=async(m,method,suffix,body,headers={})=>{
   const c=await credentials(),hostname="lambda.ca-central-1.amazonaws.com",apiPath=`/2015-03-31/functions/${encodeURIComponent(arn)}/${suffix}`;
   if(!((method==="PUT"&&suffix==="code")||(method==="POST"&&suffix==="invocations")))throw new Error("NEON_UPDATE_API_OUT_OF_SCOPE");
   const signer=new SignatureV4({credentials:c,region:"ca-central-1",service:"lambda",sha256:Hash.bind(null,"sha256")}),req=await signer.sign(new HttpRequest({protocol:"https:",hostname,method,path:apiPath,
     headers:{host:hostname,"content-type":"application/json",...headers},body:JSON.stringify(body)}));
   assertTime(m);const response=await fetch(`https://${hostname}${apiPath}`,{method,headers:req.headers,body:req.body,redirect:"error",signal:AbortSignal.timeout(method==="POST"?75000:35000)});
   if(response.status!==200||response.headers.has("x-amz-function-error")||(method==="POST"&&response.headers.get("x-amz-executed-version")!=="$LATEST"))throw new Error("NEON_UPDATE_API_RESPONSE_UNCERTAIN");
   const reader=response.body?.getReader();if(!reader)throw new Error("NEON_UPDATE_API_RESPONSE_UNCERTAIN");let size=0;const chunks=[];
   for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw new Error("NEON_UPDATE_API_RESPONSE_UNCERTAIN");}chunks.push(Buffer.from(part.value));}
   return JSON.parse(Buffer.concat(chunks).toString("utf8"));
 };
 return {inventory,
   updateCodeOnce:async(m,zip)=>{
     if(createHash("sha256").update(zip).digest("hex")!==m.artifact.zipSha256||zip.length!==m.artifact.zipBytes)throw new Error("NEON_UPDATE_ARTIFACT_DRIFT");
     const i=await inventory(false,false);if(i.stableAnchorSha256!==m.stableAnchorSha256||i.revisionId!==m.originalRevisionId)throw new Error("NEON_UPDATE_IMMEDIATE_PREWRITE_DRIFT");assertTime(m);
     const r=await request(m,"PUT","code",{ZipFile:zip.toString("base64"),Publish:false,RevisionId:m.originalRevisionId});
     if(r.FunctionArn!==arn||r.CodeSha256!==Buffer.from(m.artifact.zipSha256,"hex").toString("base64"))throw new Error("NEON_UPDATE_RESPONSE_UNCERTAIN");
     return {revisionId:r.RevisionId,zipSha256:m.artifact.zipSha256};
   },
   waitForReadyReadonly:async m=>{for(let n=0;n<12;n++){
     const r=await cli(["lambda","get-function-configuration","--function-name",arn]);
     if(r.FunctionArn!==arn||r.CodeSha256!==Buffer.from(m.artifact.zipSha256,"hex").toString("base64"))throw new Error("NEON_UPDATE_CODE_DRIFT_INSPECT_ONLY");
     if(r.State==="Active"&&r.LastUpdateStatus==="Successful")return;
     if(!["InProgress","Successful"].includes(r.LastUpdateStatus)||!["Active","Pending"].includes(r.State))throw new Error("NEON_UPDATE_CODE_NOT_READY_INSPECT_ONLY");
     await new Promise(resolve=>setTimeout(resolve,2000));
   }throw new Error("NEON_UPDATE_CODE_WAIT_NOT_VERIFIED");},
   invokeOnce:async(m,revision)=>{const r=await cli(["lambda","get-function-configuration","--function-name",arn]);
     if(r.FunctionArn!==arn||r.RevisionId!==revision||r.CodeSha256!==Buffer.from(m.artifact.zipSha256,"hex").toString("base64")||r.State!=="Active"||r.LastUpdateStatus!=="Successful")throw new Error("NEON_UPDATE_PREINVOKE_DRIFT");
     assertTime(m);return validateNeonProbeResponseV1(m.event,await request(m,"POST","invocations",m.event,{"x-amz-invocation-type":"RequestResponse","x-amz-log-type":"None"}));},
   logProof:async(m,response)=>{const responseSha256=await sha256Hex(response);let token,pagesRead=0;
     for(;pagesRead<8;){pagesRead++;const r=await cli(["logs","filter-log-events","--log-group-name",oldManifest.targets[0].logGroup,"--filter-pattern",`"${m.event.nonce}"`,"--limit","50","--no-paginate",...(token?["--next-token",token]:[])]);
       if((r.events??[]).some(e=>{try{let v=JSON.parse(e.message);if(v.message!==undefined)v=typeof v.message==="string"?JSON.parse(v.message):v.message;
         return v.protocol==="neon-sealed-readonly-log-v1"&&v.functionArn===arn&&v.requestId===response.requestId&&v.nonce===m.event.nonce&&v.responseSha256===responseSha256;}catch{return false;}}))return {logMarkerVerified:true,responseSha256,pagesRead};
       if(!r.nextToken||r.nextToken===token)break;token=r.nextToken;
     }return {logMarkerVerified:false,responseSha256,pagesRead};},
 };
}
