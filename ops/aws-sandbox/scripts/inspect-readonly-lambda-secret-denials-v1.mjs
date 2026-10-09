import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets, readonlyRuntimeIamDocumentsV1 } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { validateReadonlyLambdaManifestV1, validateReadonlyProbeResponseV1 } from "../../../lib/deployments/execution/readonly-lambda-install-v1.ts";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";

const args=process.argv.slice(2),privateRoot=await realpath("F:/ChatGPT_workshop");
const logsOnly=args.length===3&&args[2]==="--logs-only";
if((args.length!==2&&!logsOnly)||args[0]!=="--out")throw new Error("READONLY_DIAGNOSTIC_OUTPUT_REQUIRED");
const out=path.resolve(args[1]);if(!/^techlong-f3b3-readonly-lambda-diagnostics-[a-z0-9-]+$/.test(path.basename(out))||
  (await realpath(path.dirname(out))).toLowerCase()!==privateRoot.toLowerCase())throw new Error("READONLY_DIAGNOSTIC_OUTPUT_OUT_OF_SCOPE");
try{
const manifest=JSON.parse(await readFile(path.join(privateRoot,"techlong-f3b3-readonly-lambda-20261008-r5/review-manifest.json"),"utf8"));
if(manifest.manifestSha256!=="e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e")throw new Error("READONLY_DIAGNOSTIC_MANIFEST_MISMATCH");
await validateReadonlyLambdaManifestV1(manifest,manifest.codeSha256);await mkdir(out);
const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1},execute=promisify(execFile);
const credentials=await fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config})();
const sts=new STSClient({...config,credentials});const identity=await sts.send(new GetCallerIdentityCommand({}));sts.destroy();
if(identity.Account!=="402010193138"||identity.Arn!=="arn:aws:iam::402010193138:user/techlong-sandbox-dev")throw new Error("READONLY_DIAGNOSTIC_SOURCE_MISMATCH");
const allowed=new Set(["secretsmanager:describe-secret","secretsmanager:get-resource-policy","secretsmanager:list-secret-version-ids","kms:describe-key","kms:get-key-policy","cloudtrail:lookup-events","logs:filter-log-events"]);
const cli=async args=>{
  if(!allowed.has(`${args[0]}:${args[1]}`))throw new Error("READONLY_DIAGNOSTIC_WRITE_FORBIDDEN");
  try{const r=await execute("aws",[...args,"--region","ca-central-1","--output","json","--no-cli-pager","--cli-connect-timeout","10","--cli-read-timeout","30"],
    {timeout:35000,maxBuffer:2_000_000,windowsHide:true,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:credentials.secretAccessKey,
      AWS_SESSION_TOKEN:credentials.sessionToken,AWS_REGION:"ca-central-1",AWS_DEFAULT_REGION:"ca-central-1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_MAX_ATTEMPTS:"1",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});return JSON.parse(r.stdout);
  }catch(e){return {readUnverified:true,serviceError:/\((AccessDeniedException|AccessDenied|ThrottlingException|Throttling)\)/.exec(e.stderr??"")?.[1]??"READ_UNVERIFIED"};}
};
const secrets=[];if(!logsOnly)for(const t of targets){
  const [meta,policy,versions]=await Promise.all([cli(["secretsmanager","describe-secret","--secret-id",t.secretArn]),cli(["secretsmanager","get-resource-policy","--secret-id",t.secretArn]),
    cli(["secretsmanager","list-secret-version-ids","--secret-id",t.secretArn,"--include-deprecated","--no-paginate"])]);
  secrets.push({arn:t.secretArn,metadataVerified:meta.ARN===t.secretArn,kmsKeyIdReturned:!!meta.KmsKeyId,resourcePolicyPresent:!!policy.ResourcePolicy,
    versionsVerified:!versions.NextToken&&versions.ARN===t.secretArn&&versions.Versions?.length===1&&versions.Versions[0].VersionId===t.secretVersionId&&
      JSON.stringify(versions.Versions[0].VersionStages)==='["AWSCURRENT"]',readUnverified:!!(meta.readUnverified||policy.readUnverified||versions.readUnverified)});
}
let managedKey={notInspected:true};if(!logsOnly){
  const key=await cli(["kms","describe-key","--key-id","alias/aws/secretsmanager"]),kms=key.KeyMetadata;
  const keyPolicy=kms?.Arn?await cli(["kms","get-key-policy","--key-id",kms.Arn,"--policy-name","default"]):{};
  managedKey={readVerified:!!kms?.Arn,arn:kms?.Arn??null,keyManager:kms?.KeyManager??null,keyState:kms?.KeyState??null,
    policySha256:typeof keyPolicy.Policy==="string"?await sha256Hex(JSON.parse(keyPolicy.Policy)):null};
}
const trail=[];if(!logsOnly)for(const eventName of ["GetSecretValue","Decrypt"]){
  const r=await cli(["cloudtrail","lookup-events","--lookup-attributes",`AttributeKey=EventName,AttributeValue=${eventName}`,"--start-time","2026-10-09T04:48:00Z","--end-time",new Date().toISOString(),"--max-results","50","--no-paginate"]);
  const events=[];for(const row of r.Events??[]){let e;try{e=JSON.parse(row.CloudTrailEvent);}catch{continue;}
    const index=targets.findIndex(t=>e.userIdentity?.sessionContext?.sessionIssuer?.arn===`arn:aws:iam::402010193138:role/${t.role}`);if(index<0)continue;
    const t=targets[index],request=e.requestParameters??{},secretArn=eventName==="Decrypt"?request.encryptionContext?.SecretARN:request.secretId;
    if(secretArn!==t.secretArn)continue;
    events.push({index,eventId:/^[a-f0-9-]{36}$/.test(e.eventID??"")?e.eventID:null,eventName,eventSource:e.eventSource==="kms.amazonaws.com"?"kms.amazonaws.com":"secretsmanager.amazonaws.com",
      eventTime:/^\d{4}-\d{2}-\d{2}T/.test(e.eventTime??"")?e.eventTime:null,errorCode:["AccessDenied","AccessDeniedException","DecryptionFailure"].includes(e.errorCode)?e.errorCode:null,
      deniedByKms:/kms|decrypt/i.test(e.errorMessage??""),explicitIdentityDeny:/explicit deny.*identity|identity.*explicit deny/i.test(e.errorMessage??""),
      explicitBoundaryDeny:/explicit deny.*boundary|boundary.*explicit deny/i.test(e.errorMessage??""),
      versionIdMatches:(request.versionId??request.encryptionContext?.SecretVersionId)===t.secretVersionId,
      versionStageMatches:eventName==="GetSecretValue"?request.versionStage==="AWSCURRENT":null});
  }
  trail.push({eventName,readVerified:!r.readUnverified,nextPageAvailable:!!r.NextToken,events});
}
const logs=[];for(let i=0;i<2;i++){
  const response=validateReadonlyProbeResponseV1(i,manifest.events[i],JSON.parse(await readFile(path.join(privateRoot,"techlong-f3b3-readonly-lambda-install-v1-consumed",`invoke-${i}-response.json`),"utf8")));
  const responseSha256=await sha256Hex(response);let token,found=false,pages=0;
  while(pages<4&&!found){
    pages++;
    const r=await cli(["logs","filter-log-events","--log-group-name",manifest.targets[i].logGroup,"--filter-pattern",`"${manifest.events[i].nonce}"`,"--limit","50","--no-paginate",...(token?["--next-token",token]:[])]);
    found=(r.events??[]).some(row=>{try{let v=JSON.parse(row.message);if(v.message!==undefined)v=typeof v.message==="string"?JSON.parse(v.message):v.message;
      return v.protocol==="readonly-runtime-log-marker-v1"&&v.functionArn===manifest.targets[i].functionArn&&v.nonce===manifest.events[i].nonce&&v.requestId===response.requestId&&v.responseSha256===responseSha256;}catch{return false;}});
    if(!r.nextToken||r.nextToken===token)break;token=r.nextToken;
  }
  logs.push({index:i,responseSha256,logMarkerVerified:found,pagesRead:pages});
}
const policyFacts=targets.map((t,i)=>({role:t.role,explicitDenyAllOtherActionsCoversKmsDecrypt:!readonlyRuntimeIamDocumentsV1(i).boundary.Statement.find(x=>x.Sid==="DenyAllOtherActions").NotAction.includes("kms:Decrypt")}));
const report={schemaVersion:1,mode:logsOnly?"PAGED_LOGS_ONLY":"SECRET_METADATA_KMS_CLOUDTRAIL_AND_PAGED_LOGS",observedAt:new Date().toISOString(),sourceArn:identity.Arn,secrets,managedKey,trail,logs,policyFacts,
  awsWrites:0,lambdaInvocations:0,secretValuesRead:false,databaseConnected:false,rawProviderRecordsPersisted:false,noWriteInvocationRetry:true,runtimeEnabled:false};
const bytes=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(out,"read-only-diagnostic.json"),bytes,{flag:"wx"});
console.log(JSON.stringify({out,fileSha256:await sha256Hex(bytes),...report}));
}catch(error){console.error(JSON.stringify({outcome:"READONLY_SECRET_DIAGNOSTIC_NOT_VERIFIED",rawDiagnosticsWithheld:true,
  serviceErrorName:["CredentialsProviderError","ExpiredToken","ExpiredTokenException","AccessDenied","AccessDeniedException"].includes(error.name)?error.name:null,
  awsWrites:0,lambdaInvocations:0,secretValuesRead:false,noWriteInvocationRetry:true}));process.exitCode=1;}
