// Independent diagnostics only. Does not import an executor or touch its consumed slot.
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const args=process.argv.slice(2),privateRoot=await realpath("F:/ChatGPT_workshop");
if(args.length!==2||args[0]!=="--out")throw new Error("REVISION_DIAGNOSTIC_OUTPUT_REQUIRED");
const out=path.resolve(args[1]);if((await realpath(path.dirname(out))).toLowerCase()!==privateRoot.toLowerCase()||!/^techlong-f3b3-neon-sealed-revision-[a-z0-9-]+$/.test(path.basename(out)))throw new Error("REVISION_DIAGNOSTIC_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);const hash=b=>createHash("sha256").update(b).digest("hex"),execute=promisify(execFile),config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1};
const functionName="techlong-sandbox-cell-ttl-executor-v3",arn=`arn:aws:lambda:ca-central-1:402010193138:function:${functionName}`,sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev";
const save=async(name,value)=>{const b=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),b,{flag:"wx"});return hash(b);};
try{
 const receiptBytes=await readFile(path.join(privateRoot,"techlong-f3b3-neon-sealed-review-20261011-r1-run/submission-receipt.json"));
 const inspectBytes=await readFile(path.join(privateRoot,"techlong-f3b3-neon-sealed-review-20261011-r1-verify/independent-inspect.json"));
 if(hash(receiptBytes)!=="996477536dc68fb9b881149431824131631bd7b545723dd2b628ccb4a799aa0b"||hash(inspectBytes)!=="5ebd0746af63127e2a1d7802f7462d21cc3f18d2a13ecfd68caa5549f889e6d9")throw new Error("REVISION_DIAGNOSTIC_RECEIPT_DRIFT");
 const receipt=JSON.parse(receiptBytes),inspect=JSON.parse(inspectBytes),confirmed=JSON.parse(await readFile(path.join(privateRoot,"techlong-f3b3-readonly-neon-sealed-probe-v1-consumed/update-code-confirmed.json"),"utf8"));
 if(receipt.codeUpdates!==1||receipt.invocations!==0||receipt.failureCode!=="NEON_UPDATE_POSTSTATE_DRIFT"||inspect.inventory.state!=="CANDIDATE_READY")throw new Error("REVISION_DIAGNOSTIC_PRESTATE_NOT_MATCHED");
 const credentials=await fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config})(),sts=new STSClient({...config,credentials});
 try{const i=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});if(i.Account!=="402010193138"||i.Arn!==sourceArn)throw new Error("REVISION_DIAGNOSTIC_IDENTITY_INVALID");}finally{sts.destroy();}
 let token;const events=[];let pagesRead=0;
 for(;pagesRead<3;){pagesRead++;const r=await execute("aws",["cloudtrail","lookup-events","--lookup-attributes","AttributeKey=EventSource,AttributeValue=lambda.amazonaws.com",
   "--start-time","2026-10-11T16:07:00Z","--end-time","2026-10-11T16:12:00Z","--max-results","50","--no-paginate",...(token?["--next-token",token]:[]),"--region","ca-central-1","--output","json","--no-cli-pager","--cli-connect-timeout","10","--cli-read-timeout","30"],
   {timeout:35000,maxBuffer:4_000_000,windowsHide:true,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:credentials.secretAccessKey,AWS_SESSION_TOKEN:credentials.sessionToken,
      AWS_REGION:"ca-central-1",AWS_DEFAULT_REGION:"ca-central-1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_MAX_ATTEMPTS:"1",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});
   const result=JSON.parse(r.stdout);for(const row of result.Events??[]){let e;try{e=JSON.parse(row.CloudTrailEvent);}catch{continue;}
     if(!["UpdateFunctionCode20150331v2","UpdateFunctionConfiguration20150331v2","PublishVersion20150331","UpdateAlias20150331","PutRuntimeManagementConfig"].includes(e.eventName)||
        ![arn,functionName].includes(e.requestParameters?.functionName))continue;
     events.push({eventName:e.eventName,eventId:/^[a-f0-9-]{36}$/.test(e.eventID??"")?e.eventID:null,eventTime:/^2026-10-11T16:\d\d:\d\dZ$/.test(e.eventTime??"")?e.eventTime:null,
       exactFunctionMatched:true,sourceUserMatched:e.userIdentity?.arn===sourceArn,requestedOriginalRevisionMatched:e.requestParameters?.revisionId==="0ce68252-11fe-4cd8-9fc6-9fdc1ec44e9f",
       publishFalse:e.requestParameters?.publish===false,errorPresent:!!e.errorCode,responseRevisionPresent:typeof e.responseElements?.revisionId==="string"});
   }if(!result.NextToken||result.NextToken===token)break;token=result.NextToken;
 }
 const report={schemaVersion:1,protocol:"neon-sealed-update-revision-diagnostic-v1",observedAt:new Date().toISOString(),sourceArn,functionArn:arn,
   updateResponseRevisionId:confirmed.revisionId,independentlyObservedRevisionId:inspect.inventory.revisionId,
   revisionMismatchObserved:confirmed.revisionId!==inspect.inventory.revisionId,stableAnchorVerified:inspect.inventory.stableAnchorSha256==="3d373a6602d2bbcc111b8879ffa37385ef5a7ce74d9bbad1f7390dbe18d5689a",
   candidateCodeReadyObserved:true,cloudTrailWindow:{start:"2026-10-11T16:07:00Z",end:"2026-10-11T16:12:00Z",pagesRead,truncated:!!token&&pagesRead===3},events,
   cloudTrailMayBeDelayedAndDoesNotExcludeConcurrency:true,asynchronousRevisionChangeNotUniquelyProved:true,awsWrites:0,lambdaInvocations:0,secretValuesRead:false,databaseConnected:false,
   rawProviderRecordsPersisted:false,noAutomaticRollbackOrWriteInvocationRetry:true,runtimeEnabled:false};
 const fileSha256=await save("read-only-diagnostic.json",report);console.log(JSON.stringify({out,fileSha256,...report}));
}catch{const diagnostic={outcome:"REVISION_DIAGNOSTIC_NOT_VERIFIED",rawDiagnosticsWithheld:true,awsWrites:0,lambdaInvocations:0,secretValuesRead:false,databaseConnected:false,noWriteInvocationRetry:true};
 await save("failure-diagnostic.json",diagnostic);console.error(JSON.stringify(diagnostic));process.exitCode=1;}
