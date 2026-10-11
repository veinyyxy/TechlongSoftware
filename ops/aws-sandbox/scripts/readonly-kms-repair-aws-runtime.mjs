import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, GetRoleCommand, GetRolePolicyCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand,
  GetPolicyCommand, GetPolicyVersionCommand, ListPolicyVersionsCommand, ListPolicyTagsCommand, CreatePolicyVersionCommand, PutRolePolicyCommand, SimulatePrincipalPolicyCommand, SimulateCustomPolicyCommand } from "@aws-sdk/client-iam";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets, readonlyRuntimeIamDocumentsV1, readonlyRuntimeIamTagsV1 } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { READONLY_KMS_KEY_ARN_V1 as keyArn, READONLY_KMS_KEY_POLICY_SHA_V1 as keyPolicySha, readonlyKmsRepairDocumentsV1 } from "../../../lib/deployments/execution/readonly-kms-read-repair-v1.ts";
import { validateReadonlyProbeResponseV1 } from "../../../lib/deployments/execution/readonly-lambda-install-v1.ts";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";

const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1},sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev",execute=promisify(execFile);
const iamApproval="748999ae1ebb298670243d1dae36cf29accb75046daaab981f136534f77764aa",lambdaApproval="e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e";
const roleIds=["AROAV3GNMXTZLB4NZQLZY","AROAV3GNMXTZPRETOTXTS"],equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const parse=v=>{if(v&&typeof v==="object")return v;if(typeof v!=="string")throw new Error("KMS_REPAIR_DOCUMENT_MISSING");try{return JSON.parse(v.startsWith("{")?v:decodeURIComponent(v));}catch{throw new Error("KMS_REPAIR_DOCUMENT_INVALID");}};
const sortedTags=v=>[...(v??[])].sort((a,b)=>a.Key.localeCompare(b.Key));
const roleArn=i=>`arn:aws:iam::402010193138:role/${targets[i].role}`,boundaryArn=i=>`arn:aws:iam::402010193138:policy/${targets[i].boundary}`;
const functionArn=i=>`arn:aws:lambda:ca-central-1:402010193138:function:${targets[i].functionName}`;
export function createKmsRepairAwsRuntimeV1(predecessor) {
  const login=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config});let queue=Promise.resolve(),next=0;
  const call=(client,command)=>{const result=queue.then(async()=>{if(next>Date.now())await new Promise(r=>setTimeout(r,next-Date.now()));next=Date.now()+600;
    try{return await client.send(command,{abortSignal:AbortSignal.timeout(15000)});}catch(error){error.repairOperation=command.constructor.name;throw error;}});queue=result.then(()=>undefined,()=>undefined);return result;};
  const clients=async()=>{const credentials=await login(),sts=new STSClient({...config,credentials});try{
    const identity=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});
    if(identity.Account!=="402010193138"||identity.Arn!==sourceArn)throw new Error("KMS_REPAIR_SOURCE_IDENTITY_INVALID");
    }finally{sts.destroy();}return {credentials,iam:new IAMClient({...config,credentials})};};
  let cliActive=0,nextCliStart=0;const cliWaiters=[];
  const acquireCli=async()=>{if(cliActive>=3)await new Promise(resolve=>cliWaiters.push(resolve));else cliActive++;
    const start=Math.max(Date.now(),nextCliStart);nextCliStart=start+200;if(start>Date.now())await new Promise(r=>setTimeout(r,start-Date.now()));};
  const cli=async(c,args)=>{
    if(!["lambda:get-function","lambda:list-tags","lambda:get-policy","lambda:get-function-url-config","lambda:list-aliases","lambda:list-event-source-mappings","lambda:get-function-concurrency",
      "logs:describe-log-groups","logs:list-tags-for-resource","logs:filter-log-events","secretsmanager:describe-secret","secretsmanager:get-resource-policy","secretsmanager:list-secret-version-ids","kms:describe-key","kms:get-key-policy"].includes(`${args[0]}:${args[1]}`))throw new Error("KMS_REPAIR_CLI_WRITE_FORBIDDEN");
    await acquireCli();try{const r=await execute("aws",[...args,"--region","ca-central-1","--output","json","--no-cli-pager","--cli-connect-timeout","10","--cli-read-timeout","30"],
      {windowsHide:true,timeout:35000,maxBuffer:2_000_000,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:c.credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:c.credentials.secretAccessKey,
        AWS_SESSION_TOKEN:c.credentials.sessionToken,AWS_REGION:"ca-central-1",AWS_DEFAULT_REGION:"ca-central-1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_MAX_ATTEMPTS:"1",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});return r.stdout.trim()?JSON.parse(r.stdout):{};
    }catch(e){const error=new Error("KMS_REPAIR_READ_OPERATION_UNVERIFIED");error.name=/\((ResourceNotFoundException|AccessDeniedException|AccessDenied|ThrottlingException|TooManyRequestsException)\)/.exec(e.stderr??"")?.[1]??"Error";error.repairOperation=`${args[0]}:${args[1]}`;
      error.cliJsonError=e instanceof SyntaxError;error.processExitCode=Number.isInteger(e.code)?e.code:null;throw error;
    }finally{const waiter=cliWaiters.shift();if(waiter)waiter();else cliActive--;}
  };
  const absent=async fn=>{try{return await fn();}catch(e){if(e.name==="ResourceNotFoundException")return null;throw e;}};
  const iamState=async(c,i)=>{
    const t=targets[i],arn=boundaryArn(i),base=readonlyRuntimeIamDocumentsV1(i),repair=readonlyKmsRepairDocumentsV1(i);
    const [role,inline,names,attached,policy,versions,tags,v1]=await Promise.all([
      call(c.iam,new GetRoleCommand({RoleName:t.role})),call(c.iam,new GetRolePolicyCommand({RoleName:t.role,PolicyName:t.inline})),call(c.iam,new ListRolePoliciesCommand({RoleName:t.role,MaxItems:100})),
      call(c.iam,new ListAttachedRolePoliciesCommand({RoleName:t.role,MaxItems:100})),call(c.iam,new GetPolicyCommand({PolicyArn:arn})),call(c.iam,new ListPolicyVersionsCommand({PolicyArn:arn,MaxItems:100})),
      call(c.iam,new ListPolicyTagsCommand({PolicyArn:arn,MaxItems:100})),call(c.iam,new GetPolicyVersionCommand({PolicyArn:arn,VersionId:"v1"}))]);
    const r=role.Role;
    if(r?.Arn!==roleArn(i)||r.RoleId!==roleIds[i]||r.Path!=="/"||r.MaxSessionDuration!==3600||r.PermissionsBoundary?.PermissionsBoundaryArn!==arn||
      !equal(parse(r.AssumeRolePolicyDocument),base.trust)||!equal(sortedTags(r.Tags),readonlyRuntimeIamTagsV1(iamApproval))||
      names.IsTruncated||names.Marker||!equal(names.PolicyNames,[t.inline])||attached.IsTruncated||attached.Marker||attached.AttachedPolicies?.length!==0||
      policy.Policy?.Arn!==arn||policy.Policy.Path!=="/"||policy.Policy.AttachmentCount!==0||versions.IsTruncated||versions.Marker||tags.IsTruncated||tags.Marker||
      !equal(sortedTags(tags.Tags),readonlyRuntimeIamTagsV1(iamApproval))||!equal(parse(v1.PolicyVersion?.Document),base.boundary)||inline.RoleName!==t.role||inline.PolicyName!==t.inline)throw new Error("KMS_REPAIR_ROLE_OR_ORIGINAL_POLICY_DRIFT");
    let boundary="OTHER";
    if(policy.Policy.DefaultVersionId==="v1"&&versions.Versions?.length===1&&versions.Versions[0].VersionId==="v1"&&versions.Versions[0].IsDefaultVersion)boundary="BASE_V1";
    if(policy.Policy.DefaultVersionId==="v2"&&versions.Versions?.length===2&&versions.Versions.some(v=>v.VersionId==="v1"&&!v.IsDefaultVersion)&&versions.Versions.some(v=>v.VersionId==="v2"&&v.IsDefaultVersion)){
      const v2=await call(c.iam,new GetPolicyVersionCommand({PolicyArn:arn,VersionId:"v2"}));if(equal(parse(v2.PolicyVersion?.Document),repair.boundary))boundary="OWN_V2";
    }
    const inlineDoc=parse(inline.PolicyDocument),inlineState=equal(inlineDoc,base.identity)?"BASE":equal(inlineDoc,repair.identity)?"OWN_REPAIRED":"OTHER";
    return {state:{index:i,boundary,inline:inlineState},anchor:{roleArn:roleArn(i),roleId:roleIds[i],boundaryArn:arn,trustSha256:await sha256Hex(base.trust),tags:sortedTags(r.Tags),originalV1Sha256:await sha256Hex(base.boundary)}};
  };
  const functionState=async(c,i)=>{
    const t=predecessor.targets[i],fn=await cli(c,["lambda","get-function","--function-name",functionArn(i)]),r=fn.Configuration;
    const [tags,policy,url,aliases,mappings,concurrency,groups]=await Promise.all([
      cli(c,["lambda","list-tags","--resource",functionArn(i)]),absent(()=>cli(c,["lambda","get-policy","--function-name",functionArn(i)])),absent(()=>cli(c,["lambda","get-function-url-config","--function-name",functionArn(i)])),
      cli(c,["lambda","list-aliases","--function-name",functionArn(i),"--no-paginate"]),cli(c,["lambda","list-event-source-mappings","--function-name",functionArn(i),"--no-paginate"]),
      cli(c,["lambda","get-function-concurrency","--function-name",functionArn(i)]),cli(c,["logs","describe-log-groups","--log-group-name-prefix",t.logGroup,"--no-paginate"])]);
    const logTags=await cli(c,["logs","list-tags-for-resource","--resource-arn",`arn:aws:logs:ca-central-1:402010193138:log-group:${t.logGroup}`]);
    const log=(groups.logGroups??[]).filter(x=>x.logGroupName===t.logGroup),expectedTags={ApprovalSha256:lambdaApproval,Environment:"sandbox",Project:"Techlong",Purpose:"readonly-lambda-probe-v1"};
    if(r?.FunctionArn!==functionArn(i)||r.Role!==roleArn(i)||r.Runtime!=="nodejs22.x"||r.Handler!=="index.handler"||r.PackageType!=="Zip"||!equal(r.Architectures,["x86_64"])||
      r.MemorySize!==128||r.Timeout!==60||r.EphemeralStorage?.Size!==512||r.CodeSize!==t.zipBytes||r.CodeSha256!==Buffer.from(t.zipSha256,"hex").toString("base64")||
      r.State!=="Active"||r.LastUpdateStatus!=="Successful"||r.Version!=="$LATEST"||r.KMSKeyArn||r.DeadLetterConfig?.TargetArn||r.FileSystemConfigs?.length||r.Layers?.length||
      Object.keys(r.Environment?.Variables??{}).length||r.VpcConfig?.SubnetIds?.length||r.VpcConfig?.SecurityGroupIds?.length||r.TracingConfig?.Mode!=="PassThrough"||
      r.LoggingConfig?.LogGroup!==t.logGroup||r.LoggingConfig?.LogFormat!=="JSON"||r.LoggingConfig?.ApplicationLogLevel!=="INFO"||r.LoggingConfig?.SystemLogLevel!=="WARN"||
      (r.SnapStart?.ApplyOn??"None")!=="None"||fn.Code?.SourceKMSKeyArn||r.RuntimeVersionConfig?.Error||!equal(tags.Tags,expectedTags)||policy||url||aliases.NextMarker||aliases.Aliases?.length||
      mappings.NextMarker||mappings.EventSourceMappings?.length||concurrency.ReservedConcurrentExecutions!==undefined||groups.nextToken||log.length!==1||log[0].retentionInDays!==7||
      log[0].kmsKeyId||(log[0].logGroupClass??"STANDARD")!=="STANDARD"||!equal(logTags.tags,expectedTags))throw new Error("KMS_REPAIR_PROBE_OR_LOG_CONFIGURATION_DRIFT");
    return {functionArn:functionArn(i),roleArn:roleArn(i),zipSha256:t.zipSha256,configurationSha256:await sha256Hex({runtime:r.Runtime,handler:r.Handler,memory:r.MemorySize,timeout:r.Timeout,logging:r.LoggingConfig}),
      revisionId:r.RevisionId,lastModified:r.LastModified,runtimeVersionArn:r.RuntimeVersionConfig?.RuntimeVersionArn??null,logGroup:t.logGroup,tags:expectedTags};
  };
  const materialState=async c=>{
    const secrets=await Promise.all(targets.map(async t=>{
      const [d,rp,vs]=await Promise.all([cli(c,["secretsmanager","describe-secret","--secret-id",t.secretArn]),cli(c,["secretsmanager","get-resource-policy","--secret-id",t.secretArn]),
        cli(c,["secretsmanager","list-secret-version-ids","--secret-id",t.secretArn,"--include-deprecated","--no-paginate"])]);
      const name=t.secretArn.split(":secret:")[1].slice(0,-7),tags=[{Key:"ApprovalSha256",Value:"85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54"},
        {Key:"Environment",Value:"sandbox"},{Key:"Project",Value:"Techlong"},{Key:"Purpose",Value:"control-credential-bootstrap-v1"}];
      if(d.ARN!==t.secretArn||d.Name!==name||d.DeletedDate||d.RotationEnabled||d.RotationLambdaARN||d.RotationRules||d.ReplicationStatus?.length||d.KmsKeyId||(d.PrimaryRegion&&d.PrimaryRegion!=="ca-central-1")||
        d.OwningService||d.Type||d.ExternalSecretRotationRoleArn||d.ExternalSecretRotationMetadata?.length||!equal(d.VersionIdsToStages,{[t.secretVersionId]:["AWSCURRENT"]})||!equal(sortedTags(d.Tags),tags)||
        rp.ARN!==t.secretArn||rp.Name!==name||rp.ResourcePolicy||vs.ARN!==t.secretArn||vs.Name!==name||vs.NextToken||vs.Versions?.length!==1||vs.Versions[0].VersionId!==t.secretVersionId||!equal(vs.Versions[0].VersionStages,["AWSCURRENT"]))throw new Error("KMS_REPAIR_SECRET_METADATA_DRIFT");
      return {arn:t.secretArn,versionId:t.secretVersionId,tags};
    }));
    const k=(await cli(c,["kms","describe-key","--key-id","alias/aws/secretsmanager"])).KeyMetadata;
    if(k?.Arn!==keyArn||k.KeyManager!=="AWS"||k.KeyState!=="Enabled"||k.KeyUsage!=="ENCRYPT_DECRYPT"||k.KeySpec!=="SYMMETRIC_DEFAULT"||k.MultiRegion)throw new Error("KMS_REPAIR_MANAGED_KEY_DRIFT");
    const p=await cli(c,["kms","get-key-policy","--key-id",keyArn,"--policy-name","default"]);
    if(await sha256Hex(parse(p.Policy))!==keyPolicySha)throw new Error("KMS_REPAIR_KEY_POLICY_DRIFT");
    return {secrets,keyArn,keyPolicySha};
  };
  const sourcePermissions=async c=>{
    const permissions=[];for(let i=0;i<2;i++)for(const [action,resource] of [["iam:CreatePolicyVersion",boundaryArn(i)],["iam:PutRolePolicy",roleArn(i)],["lambda:InvokeFunction",functionArn(i)]]){
      const r=await call(c.iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:sourceArn,ActionNames:[action],ResourceArns:[resource],MaxItems:100}));
      if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("KMS_REPAIR_SOURCE_SIMULATION_INCOMPLETE");permissions.push({action,resource,decision:r.EvaluationResults[0].EvalDecision});
    }return permissions;
  };
  const inventory=async(withPermissions=true)=>{
    const start=Date.now(),c=await clients();try{const [iam,functions,material,permissions]=await Promise.all([
      Promise.all(targets.map((_,i)=>iamState(c,i))),Promise.all(targets.map((_,i)=>functionState(c,i))),materialState(c),withPermissions?sourcePermissions(c):Promise.resolve([])]);
      if(Date.now()-start>30000)throw new Error("KMS_REPAIR_INVENTORY_STALE");
      return {observedAt:start,anchorSha256:await sha256Hex({iam:iam.map(x=>x.anchor),functions,material}),states:iam.map(x=>x.state),
        sourcePermissionsAllowed:withPermissions&&permissions.length===6&&permissions.every(x=>x.decision==="allowed"),context:{iam:iam.map(x=>x.anchor),functions,material,sourcePermissions:permissions}};
    }finally{c.iam.destroy();}
  };
  const mutation=async(manifest,index,expected,fn)=>{const c=await clients();try{const read=await iamState(c,index);
    if(!equal(read.state,expected))throw new Error("KMS_REPAIR_IMMEDIATE_PREWRITE_DRIFT");
    if(Date.now()<manifest.reviewedAt||Date.now()+5000>=manifest.expiresAt)throw new Error("KMS_REPAIR_FRESH_APPROVAL_REQUIRED");return await fn(c);
  }finally{c.iam.destroy();}};
  const invokeOnce=async(i,event)=>{const c=await clients();try{
    const hostname="lambda.ca-central-1.amazonaws.com",invokePath=`/2015-03-31/functions/${encodeURIComponent(functionArn(i))}/invocations`;
    const signer=new SignatureV4({credentials:c.credentials,region:"ca-central-1",service:"lambda",sha256:Hash.bind(null,"sha256")});
    const request=await signer.sign(new HttpRequest({protocol:"https:",hostname,method:"POST",path:invokePath,headers:{host:hostname,"content-type":"application/json","x-amz-invocation-type":"RequestResponse","x-amz-log-type":"None"},body:JSON.stringify(event)}));
    const response=await fetch(`https://${hostname}${invokePath}`,{method:"POST",headers:request.headers,body:request.body,redirect:"error",signal:AbortSignal.timeout(75000)});
    if(response.status!==200||response.headers.has("x-amz-function-error")||response.headers.get("x-amz-executed-version")!=="$LATEST")throw new Error("KMS_REPAIR_INVOKE_RESPONSE_UNVERIFIED");
    const reader=response.body.getReader(),chunks=[];let size=0;
    for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>16384){await reader.cancel();throw new Error("KMS_REPAIR_INVOKE_RESPONSE_UNVERIFIED");}chunks.push(Buffer.from(chunk.value));}
    return validateReadonlyProbeResponseV1(i,event,JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }finally{c.iam.destroy();}};
  const logProof=async(i,event,response)=>{const c=await clients();try{const responseSha256=await sha256Hex(response);let token,pages=0;
    while(pages<6){pages++;const r=await cli(c,["logs","filter-log-events","--log-group-name",predecessor.targets[i].logGroup,"--filter-pattern",`"${event.nonce}"`,"--limit","50","--no-paginate",...(token?["--next-token",token]:[])]);
      if((r.events??[]).some(entry=>{try{let v=JSON.parse(entry.message);if(v.message!==undefined)v=typeof v.message==="string"?JSON.parse(v.message):v.message;
        return v.protocol==="readonly-runtime-log-marker-v1"&&v.functionArn===functionArn(i)&&v.nonce===event.nonce&&v.requestId===response.requestId&&v.responseSha256===responseSha256;}catch{return false;}}))return {logMarkerVerified:true,pagesRead:pages,responseSha256};
      if(!r.nextToken||r.nextToken===token)break;token=r.nextToken;
    }return {logMarkerVerified:false,pagesRead:pages,responseSha256};
  }finally{c.iam.destroy();}};
  const simulateKmsPolicies=async()=>{const c=await clients(),results=[];try{for(let i=0;i<2;i++){
    const t=targets[i],base={"aws:RequestedRegion":"ca-central-1","kms:ViaService":"secretsmanager.ca-central-1.amazonaws.com","kms:CallerAccount":"402010193138",
      "kms:EncryptionContext:SecretARN":t.secretArn,"kms:EncryptionContext:SecretVersionId":t.secretVersionId};
    const cases=[{name:"exact-forwarded-no-source-key",ctx:base,allowed:true},
      ...Object.keys(base).map(key=>({name:`missing-${key}`,ctx:Object.fromEntries(Object.entries(base).filter(([k])=>k!==key)),allowed:false})),
      ...Object.keys(base).map(key=>({name:`wrong-${key}`,ctx:{...base,[key]:key==="aws:RequestedRegion"?"us-east-1":"wrong"},allowed:false})),
      {name:"wrong-key",ctx:base,resource:"arn:aws:kms:ca-central-1:402010193138:key/00000000-0000-0000-0000-000000000000",allowed:false},
      {name:"encrypt-not-granted",ctx:base,action:"kms:Encrypt",allowed:false}];
    for(const test of cases){const doc=readonlyKmsRepairDocumentsV1(i),r=await call(c.iam,new SimulateCustomPolicyCommand({PolicyInputList:[canonicalJson(doc.identity)],PermissionsBoundaryPolicyInputList:[canonicalJson(doc.boundary)],
      ActionNames:[test.action??"kms:Decrypt"],ResourceArns:[test.resource??keyArn],ContextEntries:Object.entries(test.ctx).map(([k,v])=>({ContextKeyName:k,ContextKeyType:"string",ContextKeyValues:[v]})),MaxItems:100}));
      if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("KMS_REPAIR_SIMULATION_INCOMPLETE");const decision=r.EvaluationResults[0].EvalDecision;
      results.push({index:i,name:test.name,decision,expectedAllowed:test.allowed,verified:(decision==="allowed")===test.allowed});
    }
  }return results;}finally{c.iam.destroy();}};
  return {inventory,invokeOnce,logProof,simulateKmsPolicies,
    createDefaultV2:(m,i,document)=>mutation(m,i,{index:i,boundary:"BASE_V1",inline:"BASE"},async c=>{
      if(!equal(document,readonlyKmsRepairDocumentsV1(i).boundary))throw new Error("KMS_REPAIR_WRITE_DOCUMENT_INVALID");
      const r=await call(c.iam,new CreatePolicyVersionCommand({PolicyArn:boundaryArn(i),PolicyDocument:canonicalJson(document),SetAsDefault:true}));return {versionId:r.PolicyVersion?.VersionId,isDefault:r.PolicyVersion?.IsDefaultVersion};}),
    putInline:(m,i,document)=>mutation(m,i,{index:i,boundary:"OWN_V2",inline:"BASE"},c=>{
      if(!equal(document,readonlyKmsRepairDocumentsV1(i).identity))throw new Error("KMS_REPAIR_WRITE_DOCUMENT_INVALID");
      return call(c.iam,new PutRolePolicyCommand({RoleName:targets[i].role,PolicyName:targets[i].inline,PolicyDocument:canonicalJson(document)}));}),};
}
