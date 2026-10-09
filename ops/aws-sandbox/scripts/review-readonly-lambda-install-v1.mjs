import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, GetRoleCommand, GetRolePolicyCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand,
  GetPolicyCommand, GetPolicyVersionCommand, ListPolicyVersionsCommand, ListPolicyTagsCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readonlyRuntimeIamDocumentsV1, readonlyRuntimeIamTagsV1, READONLY_RUNTIME_IAM_TARGETS_V1 } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { readonlyLambdaTargetsV1, compileReadonlyLambdaManifestV1, validateReadonlyLambdaManifestV1, runReadonlyLambdaInstallV1, validateReadonlyProbeResponseV1,
  READONLY_LAMBDA_INSTALL_SCOPE_V1 as scope } from "../../../lib/deployments/execution/readonly-lambda-install-v1.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url)), privateRoot = await realpath("F:/ChatGPT_workshop"), args = process.argv.slice(2), opts = {};
for(let i=0;i<args.length;i+=2){if(!["--mode","--out","--artifacts","--manifest","--approved-sha"].includes(args[i])||!args[i+1]||opts[args[i]])throw new Error("PROBE_OPTIONS_INVALID");opts[args[i]]=args[i+1];}
const mode=opts["--mode"], out=path.resolve(opts["--out"]??"");
if(!["Review","Run","Inspect"].includes(mode)||!/^techlong-f3b3-readonly-lambda-[a-z0-9-]+$/.test(path.basename(out))||
  (await realpath(path.dirname(out))).toLowerCase()!==privateRoot.toLowerCase())throw new Error("PROBE_PRIVATE_OUTPUT_REQUIRED");
const slot=path.join(privateRoot,scope.permanentSlot), execute=promisify(execFile), sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev";
const iamApproval="748999ae1ebb298670243d1dae36cf29accb75046daaab981f136534f77764aa";
const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1}, login=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config});
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b), parse=v=>{
  if(v&&typeof v==="object")return v;
  if(typeof v!=="string")throw new Error("PROBE_IAM_DOCUMENT_MISSING");
  try{return JSON.parse(v.startsWith("{")?v:decodeURIComponent(v));}catch{throw new Error("PROBE_IAM_DOCUMENT_INVALID");}
};
const shaBytes=bytes=>createHash("sha256").update(bytes).digest("hex");
const sortedTags=tags=>[...(tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key));
const tags=approval=>({ApprovalSha256:approval,Environment:"sandbox",Project:"Techlong",Purpose:"readonly-lambda-probe-v1"});
// IAM simulations and metadata share a paced queue; maxAttempts remains one (no SDK retry).
let iamQueue=Promise.resolve(),nextIamCallAt=0;
const call=async(client,command)=>{
  const send=async()=>{try{return await client.send(command,{abortSignal:AbortSignal.timeout(15000)});}catch(error){error.probeOperation=command.constructor.name;throw error;}};
  if(!(client instanceof IAMClient))return send();
  const request=iamQueue.then(async()=>{const delay=nextIamCallAt-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    nextIamCallAt=Date.now()+600;return send();});
  iamQueue=request.then(()=>undefined,()=>undefined);return request;
};
let stage="LOCAL_BINDING",slotConsumed=false,sourceIdentityVerified=false,manifest,targets;
await mkdir(out);const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),bytes,{flag:"wx"});return sha256Hex(bytes);};
try {
  let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}
  if(mode!=="Inspect"&&occupied)throw new Error("PROBE_PERMANENT_SLOT_OCCUPIED_INSPECT_ONLY");
  const bindingFiles=["ops/aws-sandbox/scripts/review-readonly-lambda-install-v1.mjs","ops/aws-sandbox/scripts/build-readonly-lambda-probes-v1.mjs",
    "ops/aws-sandbox/lambda/readonly-ttl-probe-v1.ts","ops/aws-sandbox/lambda/readonly-drain-probe-v1.ts","lib/deployments/execution/readonly-lambda-probe-v1.ts",
    "lib/deployments/execution/readonly-lambda-install-v1.ts","lib/deployments/execution/readonly-runtime-iam-v1.ts","lib/deployments/execution/hash.ts","package.json","package-lock.json"];
  const pins=[];for(const file of bindingFiles)pins.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});const codeSha256=await sha256Hex(pins);
  if(mode!=="Review"){
    const file=path.resolve(opts["--manifest"]??"");if(path.basename(file)!=="review-manifest.json"||!/^techlong-f3b3-readonly-lambda-[a-z0-9-]+$/.test(path.basename(path.dirname(file)))||
      (await realpath(path.dirname(path.dirname(file)))).toLowerCase()!==privateRoot.toLowerCase())throw new Error("PROBE_PRIVATE_MANIFEST_REQUIRED");
    manifest=JSON.parse(await readFile(file,"utf8"));await validateReadonlyLambdaManifestV1(manifest,codeSha256);
    if(mode==="Inspect"&&occupied&&!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),manifest))throw new Error("PROBE_SLOT_MANIFEST_DRIFT");
  }
  const artifactsDirectory=path.resolve(mode==="Review"?opts["--artifacts"]??"":manifest.artifactsDirectory);
  if(!/^techlong-f3b3-readonly-probe-artifacts-[a-z0-9-]+$/.test(path.basename(artifactsDirectory))||
    (await realpath(path.dirname(artifactsDirectory))).toLowerCase()!==privateRoot.toLowerCase()||(await realpath(artifactsDirectory)).toLowerCase()!==artifactsDirectory.toLowerCase())throw new Error("PROBE_ARTIFACT_LOCATION_INVALID");
  const reportBytes=await readFile(path.join(artifactsDirectory,"artifact-review.json")),report=JSON.parse(reportBytes),reportSha=shaBytes(reportBytes);
  if(report.protocol!=="readonly-lambda-probe-artifacts-v1"||!report.reproducibleBuildVerified||!report.dependencyFreeStartupVerified||report.businessRuntimeLinked||
    report.cloudMutationPerformed||report.installationAuthorized||report.artifacts.length!==2||report.packageLockSha256!==shaBytes(await readFile(path.join(root,"package-lock.json"))))throw new Error("PROBE_ARTIFACT_REPORT_INVALID");
  for(const pin of report.sourcePins){if(!bindingFiles.includes(pin.file)||await sha256Hex((await readFile(path.join(root,pin.file),"utf8")).replace(/\r\n/g,"\n"))!==pin.sha256)throw new Error("PROBE_ARTIFACT_SOURCE_DRIFT");}
  const zips=[];for(let i=0;i<2;i++){
    const a=report.artifacts[i];if(a.index!==i||a.file!==`${i===0?"ttl":"drain"}.zip`||a.handler!=="index.handler"||a.runtime!=="nodejs22.x"||a.architecture!=="x86_64")throw new Error("PROBE_ARTIFACT_TARGET_INVALID");
    const bytes=await readFile(path.join(artifactsDirectory,a.file));if(bytes.length!==a.zipBytes||shaBytes(bytes)!==a.zipSha256)throw new Error("PROBE_ARTIFACT_BYTES_DRIFT");zips.push(bytes);
  }
  targets=readonlyLambdaTargetsV1(report.artifacts);
  if(manifest&&(!equal(manifest.targets,targets)||manifest.artifactReportFileSha256!==reportSha))throw new Error("PROBE_ARTIFACT_MANIFEST_DRIFT");
  const clients=async()=>{
    const credentials=await login(),sts=new STSClient({...config,credentials});try{const identity=await call(sts,new GetCallerIdentityCommand({}));
      if(identity.Account!=="402010193138"||identity.Arn!==sourceArn)throw new Error("PROBE_EXACT_SOURCE_REQUIRED");sourceIdentityVerified=true;}finally{sts.destroy();}
    return {credentials,iam:new IAMClient({...config,credentials})};
  };
  const cli=async(c,args,input)=>{
    const file=input?path.join(out,`request-${randomBytes(6).toString("hex")}.json`):null;if(file)await writeFile(file,JSON.stringify(input),{flag:"wx"});
    try{
      const r=await execute("aws",[...args,...(file?["--cli-input-json",`file://${file}`]:[]),"--region","ca-central-1","--output","json","--no-cli-pager","--cli-connect-timeout","10","--cli-read-timeout","70"],
        {windowsHide:true,timeout:75000,maxBuffer:7_000_000,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:c.credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:c.credentials.secretAccessKey,
          AWS_SESSION_TOKEN:c.credentials.sessionToken,AWS_REGION:"ca-central-1",AWS_DEFAULT_REGION:"ca-central-1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_MAX_ATTEMPTS:"1",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});
      return r.stdout.trim()?JSON.parse(r.stdout):{};
    }catch(error){const match=/\((ResourceNotFoundException|AccessDeniedException|AccessDenied|ResourceConflictException|InvalidParameterValueException|InvalidParameterException|ThrottlingException)\)/.exec(error.stderr??"");
      const safe=new Error("PROBE_AWS_CLI_UNVERIFIED");safe.name=match?.[1]??"Error";safe.probeOperation=`${args[0]}:${args[1]}`;
      safe.processExitCode=Number.isInteger(error.code)?error.code:null;safe.nodeErrorCode=["ENOENT","ETIMEDOUT","EACCES","EPERM"].includes(error.code)?error.code:null;
      safe.cliParserError=/Unknown options:|Invalid choice:|usage: aws/i.test(error.stderr??"");safe.cliJsonError=error instanceof SyntaxError;throw safe;}
  };
  const absent=async fn=>{try{return await fn();}catch(e){if(e.name==="ResourceNotFoundException")return null;throw e;}};
  const foundation=async c=>{
    const records=await Promise.all(targets.map(async(t,i)=>{
      const old=READONLY_RUNTIME_IAM_TARGETS_V1[i],boundaryArn=`arn:aws:iam::402010193138:policy/${old.boundary}`;
      const [role,inline,inlineNames,attached,policy,versions,policyTags,version]=await Promise.all([
        call(c.iam,new GetRoleCommand({RoleName:old.role})),call(c.iam,new GetRolePolicyCommand({RoleName:old.role,PolicyName:old.inline})),
        call(c.iam,new ListRolePoliciesCommand({RoleName:old.role,MaxItems:100})),call(c.iam,new ListAttachedRolePoliciesCommand({RoleName:old.role,MaxItems:100})),
        call(c.iam,new GetPolicyCommand({PolicyArn:boundaryArn})),call(c.iam,new ListPolicyVersionsCommand({PolicyArn:boundaryArn,MaxItems:100})),
        call(c.iam,new ListPolicyTagsCommand({PolicyArn:boundaryArn,MaxItems:100})),call(c.iam,new GetPolicyVersionCommand({PolicyArn:boundaryArn,VersionId:"v1"}))]);
      const r=role.Role,doc=readonlyRuntimeIamDocumentsV1(i);
      if(r?.Arn!==t.roleArn||r.RoleId!==t.roleId||r.Path!=="/"||r.MaxSessionDuration!==3600||r.PermissionsBoundary?.PermissionsBoundaryArn!==boundaryArn||
        !equal(parse(r.AssumeRolePolicyDocument),doc.trust)||!equal(sortedTags(r.Tags),readonlyRuntimeIamTagsV1(iamApproval))||
        !equal(parse(inline.PolicyDocument),doc.identity)||inline.RoleName!==old.role||inline.PolicyName!==old.inline||
        inlineNames.IsTruncated||inlineNames.Marker||!equal(inlineNames.PolicyNames,[old.inline])||attached.IsTruncated||attached.Marker||attached.AttachedPolicies?.length!==0||
        policy.Policy?.Arn!==boundaryArn||policy.Policy.Path!=="/"||policy.Policy.DefaultVersionId!=="v1"||policy.Policy.AttachmentCount!==0||
        versions.IsTruncated||versions.Marker||versions.Versions?.length!==1||versions.Versions[0].VersionId!=="v1"||!versions.Versions[0].IsDefaultVersion||
        policyTags.IsTruncated||policyTags.Marker||!equal(sortedTags(policyTags.Tags),readonlyRuntimeIamTagsV1(iamApproval))||!equal(parse(version.PolicyVersion?.Document),doc.boundary))throw new Error("PROBE_IAM_FOUNDATION_DRIFT");
      return {roleArn:t.roleArn,roleId:t.roleId,boundaryArn,documentsSha256:await sha256Hex(doc),iamApproval};
    }));return sha256Hex(records);
  };
  const resources=async(c,t,approval,pendingRetention=false)=>{
    const fn=await absent(()=>cli(c,["lambda","get-function","--function-name",t.functionArn]));
    const groups=await cli(c,["logs","describe-log-groups","--log-group-name-prefix",t.logGroup,"--no-paginate"]);
    if(groups.nextToken)throw new Error("PROBE_LOG_INVENTORY_INCOMPLETE");const matching=(groups.logGroups??[]).filter(x=>x.logGroupName===t.logGroup);
    if(matching.length>1)throw new Error("PROBE_LOG_INVENTORY_INVALID");
    let logState="ABSENT",functionState="ABSENT";
    if(matching.length){const log=matching[0],tag=await cli(c,["logs","list-tags-for-resource","--resource-arn",`arn:aws:logs:ca-central-1:402010193138:log-group:${t.logGroup}`]);
      logState=(pendingRetention?log.retentionInDays===undefined:log.retentionInDays===7)&&!log.kmsKeyId&&(log.logGroupClass??"STANDARD")==="STANDARD"&&equal(tag.tags,tags(approval))?"OWN_READY":"OTHER";}
    if(fn){const r=fn.Configuration,tag=await cli(c,["lambda","list-tags","--resource",t.functionArn]);
      const [policy,url,aliases,mappings,concurrency]=await Promise.all([
        absent(()=>cli(c,["lambda","get-policy","--function-name",t.functionArn])),absent(()=>cli(c,["lambda","get-function-url-config","--function-name",t.functionArn])),
        cli(c,["lambda","list-aliases","--function-name",t.functionArn,"--no-paginate"]),cli(c,["lambda","list-event-source-mappings","--function-name",t.functionArn,"--no-paginate"]),cli(c,["lambda","get-function-concurrency","--function-name",t.functionArn])]);
      functionState=r?.FunctionArn===t.functionArn&&r.Role===t.roleArn&&r.Runtime===t.runtime&&r.Handler===t.handler&&r.PackageType==="Zip"&&
        equal(r.Architectures,[t.architecture])&&r.MemorySize===128&&r.Timeout===60&&r.EphemeralStorage?.Size===512&&r.CodeSha256===Buffer.from(t.zipSha256,"hex").toString("base64")&&
        r.CodeSize===t.zipBytes&&r.State==="Active"&&r.LastUpdateStatus==="Successful"&&r.Version==="$LATEST"&&
        !r.KMSKeyArn&&!r.DeadLetterConfig?.TargetArn&&!r.FileSystemConfigs?.length&&!r.Layers?.length&&!Object.keys(r.Environment?.Variables??{}).length&&
        !r.VpcConfig?.SubnetIds?.length&&!r.VpcConfig?.SecurityGroupIds?.length&&r.TracingConfig?.Mode==="PassThrough"&&
        r.LoggingConfig?.LogGroup===t.logGroup&&r.LoggingConfig?.LogFormat==="JSON"&&r.LoggingConfig?.ApplicationLogLevel==="INFO"&&r.LoggingConfig?.SystemLogLevel==="WARN"&&
        (r.SnapStart?.ApplyOn??"None")==="None"&&!fn.Code?.SourceKMSKeyArn&&!r.RuntimeVersionConfig?.Error&&equal(tag.Tags,tags(approval))&&
        !policy&&!url&&!aliases.NextMarker&&!aliases.Aliases?.length&&!mappings.NextMarker&&!mappings.EventSourceMappings?.length&&concurrency.ReservedConcurrentExecutions===undefined?"OWN_READY":"OTHER";
    }
    return {index:t.index,functionState,logState};
  };
  const permissions=async c=>{
    const result=[];for(const t of targets)for(const [action,resource] of [["logs:CreateLogGroup",`arn:aws:logs:ca-central-1:402010193138:log-group:${t.logGroup}:*`],
      ["logs:TagResource",`arn:aws:logs:ca-central-1:402010193138:log-group:${t.logGroup}:*`],["logs:PutRetentionPolicy",`arn:aws:logs:ca-central-1:402010193138:log-group:${t.logGroup}:*`],
      ["lambda:CreateFunction",t.functionArn],["lambda:TagResource",t.functionArn],["lambda:InvokeFunction",t.functionArn],["iam:PassRole",t.roleArn]]){
      const r=await call(c.iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:sourceArn,ActionNames:[action],ResourceArns:[resource],ContextEntries:[
        {ContextKeyName:"aws:RequestedRegion",ContextKeyType:"string",ContextKeyValues:["ca-central-1"]},
        {ContextKeyName:"iam:PassedToService",ContextKeyType:"string",ContextKeyValues:["lambda.amazonaws.com"]},
        {ContextKeyName:"lambda:Runtime",ContextKeyType:"string",ContextKeyValues:["nodejs22.x"]}],MaxItems:100}));
      if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("PROBE_PERMISSION_SIMULATION_INCOMPLETE");
      result.push({action,resource,decision:r.EvaluationResults[0].EvalDecision});
    }return result;
  };
  const inventory=async(approval,withPermissions=mode!=="Inspect")=>{
    stage="SOURCE_READONLY_INVENTORY";const start=Date.now(),c=await clients();try{
      const [foundationSha256,rs,sourcePermissions]=await Promise.all([foundation(c),Promise.all(targets.map(t=>resources(c,t,approval))),withPermissions?permissions(c):Promise.resolve([])]);
      if(Date.now()-start>30000)throw new Error("PROBE_INVENTORY_STALE");return {observedAt:start,foundationSha256,resources:rs,sourcePermissions};
    }finally{c.iam.destroy();}
  };
  const inspect=async()=>{
    const r=await inventory(manifest.manifestSha256,false),responses=[];
    for(let i=0;i<2;i++){
      let response=null;try{response=JSON.parse(await readFile(path.join(slot,`invoke-${i}-response.json`),"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}
      let logMarkerVerified=false;
      if(response){response=validateReadonlyProbeResponseV1(i,manifest.events[i],response);const responseSha256=await sha256Hex(response);
        const c=await clients();try{const logs=await cli(c,["logs","filter-log-events","--log-group-name",targets[i].logGroup,"--filter-pattern",`"${manifest.events[i].nonce}"`,"--limit","50","--no-paginate"]);
        logMarkerVerified=(logs.events??[]).some(entry=>{try{let value=JSON.parse(entry.message);if(value.message!==undefined)value=typeof value.message==="string"?JSON.parse(value.message):value.message;
          return value.protocol==="readonly-runtime-log-marker-v1"&&value.nonce===manifest.events[i].nonce&&value.functionArn===targets[i].functionArn&&value.requestId===response.requestId&&value.responseSha256===responseSha256;}catch{return false;}});
      }finally{c.iam.destroy();}}
      responses.push({index:i,invocationResponsePresent:!!response,readsVerified:response?.outcome==="READONLY_PROBE_READS_VERIFIED",logMarkerVerified,
        ...(response?{responseFileSha256:shaBytes(await readFile(path.join(slot,`invoke-${i}-response.json`)))}:{})});
    }
    const installed=r.foundationSha256===manifest.foundationSha256&&r.resources.every(x=>x.functionState==="OWN_READY"&&x.logState==="OWN_READY");
    const result={outcome:installed&&responses.every(x=>x.readsVerified&&x.logMarkerVerified)?"READONLY_LAMBDA_READS_AND_LOGS_VERIFIED":"READONLY_LAMBDA_PARTIAL_OR_READ_PROOF_NOT_VERIFIED",
      inventory:r,probes:responses,probeInstallationVerified:installed,liveReadProofVerified:installed&&responses.every(x=>x.readsVerified&&x.logMarkerVerified),
      productionCfExistingResourceReadProved:false,drainSealedV3BusinessCompatibilityProved:false,mutationGrantAuthorized:false,retryAuthorized:false,runtimeEnabled:false};
    const fileSha256=await save("independent-inspect.json",result);console.log(JSON.stringify({mode:"Inspect",out,fileSha256,...result}));return result;
  };
  if(mode==="Review"){
    stage="READONLY_REVIEW";const r=await inventory("0".repeat(64));await save("read-only-inventory.json",r);
    if(r.sourcePermissions.some(x=>x.decision!=="allowed"))throw new Error("PROBE_SOURCE_PERMISSION_NOT_VERIFIED");
    manifest=await compileReadonlyLambdaManifestV1({reviewedAt:Date.now(),codeSha256,artifactsDirectory,artifactReportFileSha256:reportSha,targets,inventory:r,
      events:targets.map(()=>({schemaVersion:1,action:"verify_readonly_runtime_v1",nonce:randomBytes(32).toString("hex")}))});
    const fileSha256=await save("review-manifest.json",manifest);console.log(JSON.stringify({mode,out,fileSha256,manifestSha256:manifest.manifestSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),
      approvalRequired:true,installationWrites:0,lambdaInvocations:0,runtimeEnabled:false}));
  }else{
    if(mode==="Run"){
      const write=async(fn)=>{const c=await clients();try{await foundation(c);
        if(Date.now()<manifest.reviewedAt||Date.now()+5000>=manifest.expiresAt)throw new Error("PROBE_FRESH_APPROVAL_REQUIRED");
        return await fn(c);}finally{c.iam.destroy();}};
      const result=await runReadonlyLambdaInstallV1({manifest,approvedSha:opts["--approved-sha"],codeSha256,ports:{now:Date.now,inventory,
        claimSlot:()=>mkdir(slot),marker:(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"}),
        createLog:(i,approval)=>write(c=>cli(c,["logs","create-log-group"],{logGroupName:targets[i].logGroup,logGroupClass:"STANDARD",tags:tags(approval)})),
        retainLog:i=>write(async c=>{const r=await resources(c,targets[i],manifest.manifestSha256,true);if(r.logState!=="OWN_READY"||r.functionState!=="ABSENT")throw new Error("PROBE_NEW_LOG_OWNERSHIP_DRIFT");
          return cli(c,["logs","put-retention-policy"],{logGroupName:targets[i].logGroup,retentionInDays:7});}),
        createFunction:(i,approval)=>write(async c=>{const r=await resources(c,targets[i],approval);if(r.logState!=="OWN_READY"||r.functionState!=="ABSENT")throw new Error("PROBE_PRECREATE_RESOURCE_DRIFT");
          return cli(c,["lambda","create-function"],{FunctionName:targets[i].functionName,Runtime:"nodejs22.x",Role:targets[i].roleArn,
          Handler:"index.handler",Code:{ZipFile:zips[i].toString("base64")},Description:"Techlong read-only AWS verification probe; no database or production runtime",Timeout:60,MemorySize:128,
          Publish:false,PackageType:"Zip",Architectures:["x86_64"],EphemeralStorage:{Size:512},TracingConfig:{Mode:"PassThrough"},
          LoggingConfig:{LogGroup:targets[i].logGroup,LogFormat:"JSON",ApplicationLogLevel:"INFO",SystemLogLevel:"WARN"},Tags:tags(approval)});}),
        waitAndInspect:async approval=>{let r;for(let attempt=0;attempt<6;attempt++){r=await inventory(approval,false);if(r.resources.every(x=>x.functionState==="OWN_READY"&&x.logState==="OWN_READY"))return r;
          if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));}return r;},
        invokeOnce:async(i,event)=>{const c=await clients();try{
          // One signed synchronous HTTP request; unlike CLI outfile, untrusted raw output never reaches disk.
          const hostname="lambda.ca-central-1.amazonaws.com",invokePath=`/2015-03-31/functions/${encodeURIComponent(targets[i].functionArn)}/invocations`;
          const signer=new SignatureV4({credentials:c.credentials,region:"ca-central-1",service:"lambda",sha256:Hash.bind(null,"sha256")});
          const request=await signer.sign(new HttpRequest({protocol:"https:",hostname,method:"POST",path:invokePath,
            headers:{host:hostname,"content-type":"application/json","x-amz-invocation-type":"RequestResponse","x-amz-log-type":"None"},body:JSON.stringify(event)}));
          const response=await fetch(`https://${hostname}${invokePath}`,{method:"POST",headers:request.headers,body:request.body,redirect:"error",signal:AbortSignal.timeout(75000)});
          if(response.status!==200||response.headers.has("x-amz-function-error")||response.headers.get("x-amz-executed-version")!=="$LATEST")throw new Error("PROBE_RESPONSE_NOT_VERIFIED");
          const reader=response.body.getReader(),chunks=[];let size=0;
          for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>16384){await reader.cancel();throw new Error("PROBE_RESPONSE_NOT_VERIFIED");}chunks.push(Buffer.from(chunk.value));}
          return validateReadonlyProbeResponseV1(i,event,JSON.parse(Buffer.concat(chunks).toString("utf8")));
        }finally{c.iam.destroy();}},
      }});slotConsumed=result.slotConsumed;await save("submission-receipt.json",result);console.log(JSON.stringify({mode,out,...result}));if(result.failureStage)process.exitCode=1;
    }
    const result=await inspect();if(!result.liveReadProofVerified)process.exitCode=1;
  }
}catch(error){const diagnostic={outcome:"READONLY_LAMBDA_REVIEW_OR_EXECUTION_NOT_VERIFIED",stage,slotConsumed,sourceIdentityVerified,
  failureCode:/^PROBE_[A-Z_]+$/.test(error.message??"")?error.message:"PROBE_OPERATION_UNVERIFIED",serviceErrorName:["AccessDeniedException","AccessDenied","ResourceNotFoundException","ExpiredToken","ExpiredTokenException","CredentialsProviderError","NoSuchEntity","NoSuchEntityException","InvalidInput","InvalidInputException","Throttling","ThrottlingException","ServiceFailure","ValidationError","TypeError","SyntaxError","Error"].includes(error.name)?error.name:null,
  operation:/^(?:[A-Za-z]+Command|(?:lambda|logs):[a-z-]+)$/.test(error.probeOperation??"")?error.probeOperation:null,
  httpStatus:Number.isInteger(error.$metadata?.httpStatusCode)?error.$metadata.httpStatusCode:null,processExitCode:error.processExitCode??null,nodeErrorCode:error.nodeErrorCode??null,
  cliParserError:error.cliParserError??false,cliJsonError:error.cliJsonError??false,rawDiagnosticsWithheld:true,noWriteRetry:true,runtimeEnabled:false};
  await save("failure-diagnostic.json",diagnostic);console.error(JSON.stringify(diagnostic));process.exitCode=1;}
