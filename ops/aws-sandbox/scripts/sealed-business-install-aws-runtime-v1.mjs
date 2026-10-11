import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, GetRoleCommand, GetRolePolicyCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand, GetPolicyCommand,
 GetPolicyVersionCommand, ListPolicyVersionsCommand, ListPolicyTagsCommand, CreatePolicyVersionCommand, PutRolePolicyCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets, readonlyRuntimeIamDocumentsV1, readonlyRuntimeIamTagsV1 } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { readonlyKmsRepairDocumentsV1, READONLY_KMS_KEY_ARN_V1 as keyArn, READONLY_KMS_KEY_POLICY_SHA_V1 as keyPolicySha } from "../../../lib/deployments/execution/readonly-kms-read-repair-v1.ts";
import { sealedDrainIamCandidateV3 } from "../../../lib/deployments/execution/sealed-drain-iam-candidate-v3.ts";
import { SEALED_BUSINESS_ARTIFACTS_V1 as artifacts, sealedBusinessResourcesV1 } from "../../../lib/deployments/execution/sealed-business-install-v1.ts";
const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1},sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev",execute=promisify(execFile);
const roles=["AROAV3GNMXTZLB4NZQLZY","AROAV3GNMXTZPRETOTXTS"],resources=sealedBusinessResourcesV1(),equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const original=[{zipSha256:"0f2330afbef3e801faf3645f96610d293349705743ae0748de22198391a25533",zipBytes:277794},{zipSha256:"b4f8219360e89012b0cecbd2315bf55962e5308f9397cf028a9598bc8072f1d2",zipBytes:287035}];
const iamApproval="748999ae1ebb298670243d1dae36cf29accb75046daaab981f136534f77764aa",lambdaApproval="e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e";
const functionTags={ApprovalSha256:lambdaApproval,Environment:"sandbox",Project:"Techlong",Purpose:"readonly-lambda-probe-v1"};
const tags=v=>[...(v??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),parse=v=>{try{return typeof v==="string"?JSON.parse(v.startsWith("{")?v:decodeURIComponent(v)):v;}catch{throw Error("BUSINESS_INSTALL_DOCUMENT_INVALID");}};
export function createSealedBusinessInstallAwsRuntimeV1() {
 const login=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config});let queue=Promise.resolve(),next=0,cliActive=0,nextCli=0;const waiters=[];
 const call=(client,command)=>{const result=queue.then(async()=>{if(next>Date.now())await new Promise(r=>setTimeout(r,next-Date.now()));next=Date.now()+600;return client.send(command,{abortSignal:AbortSignal.timeout(15000)});});queue=result.then(()=>undefined,()=>undefined);return result;};
 const session=async()=>{const credentials=await login(),sts=new STSClient({...config,credentials});try{const i=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});
  if(i.Account!=="402010193138"||i.Arn!==sourceArn)throw Error("BUSINESS_INSTALL_SOURCE_IDENTITY_INVALID");return{credentials,iam:new IAMClient({...config,credentials})};}finally{sts.destroy();}};
 const acquire=async()=>{if(cliActive>=3)await new Promise(r=>waiters.push(r));else cliActive++;const start=Math.max(nextCli,Date.now());nextCli=start+180;if(start>Date.now())await new Promise(r=>setTimeout(r,start-Date.now()));};
 const cli=async(c,args)=>{
  if(!["lambda:get-function","lambda:get-function-configuration","lambda:list-tags","lambda:get-policy","lambda:get-function-url-config","lambda:list-aliases","lambda:list-event-source-mappings","lambda:get-function-concurrency",
   "logs:describe-log-groups","logs:list-tags-for-resource","secretsmanager:describe-secret","secretsmanager:get-resource-policy","secretsmanager:list-secret-version-ids","kms:describe-key","kms:get-key-policy","dynamodb:get-item","cloudformation:describe-stacks"].includes(`${args[0]}:${args[1]}`))throw Error("BUSINESS_INSTALL_CLI_WRITE_FORBIDDEN");
  await acquire();try{const r=await execute("aws",[...args,"--region","ca-central-1","--output","json","--no-cli-pager","--cli-connect-timeout","10","--cli-read-timeout","30"],
   {windowsHide:true,timeout:35000,maxBuffer:2000000,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:c.credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:c.credentials.secretAccessKey,AWS_SESSION_TOKEN:c.credentials.sessionToken,
    AWS_REGION:"ca-central-1",AWS_DEFAULT_REGION:"ca-central-1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_MAX_ATTEMPTS:"1",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});return r.stdout.trim()?JSON.parse(r.stdout):{};
  }catch(e){const error=Error("BUSINESS_INSTALL_READ_OPERATION_UNVERIFIED");error.name=/\((ResourceNotFoundException|AccessDeniedException|AccessDenied|ThrottlingException|TooManyRequestsException)\)/.exec(e.stderr??"")?.[1]??"Error";
   if(args[0]==="cloudformation"&&args[1]==="describe-stacks"&&/\(ValidationError\)/.test(e.stderr??"")&&/Stack with id techlong-sandbox-cell-sandbox-1 does not exist/.test(e.stderr??""))error.name="ExactCellStackAbsent";
   error.installOperation=`${args[0]}:${args[1]}`;throw error;
  }finally{const waiter=waiters.shift();if(waiter)waiter();else cliActive--;}
 };
 const absent=async(fn,name="ResourceNotFoundException")=>{try{return await fn();}catch(e){if(e.name===name)return null;throw e;}};
 const iamState=async(c,i)=>{
  const t=targets[i],arn=`arn:aws:iam::402010193138:policy/${t.boundary}`,roleArn=`arn:aws:iam::402010193138:role/${t.role}`,base=readonlyRuntimeIamDocumentsV1(i),old=readonlyKmsRepairDocumentsV1(i),candidate=sealedDrainIamCandidateV3();
  const [role,inline,names,attached,policy,versions,ptags,v1,v2]=await Promise.all([
   call(c.iam,new GetRoleCommand({RoleName:t.role})),call(c.iam,new GetRolePolicyCommand({RoleName:t.role,PolicyName:t.inline})),call(c.iam,new ListRolePoliciesCommand({RoleName:t.role,MaxItems:100})),
   call(c.iam,new ListAttachedRolePoliciesCommand({RoleName:t.role,MaxItems:100})),call(c.iam,new GetPolicyCommand({PolicyArn:arn})),call(c.iam,new ListPolicyVersionsCommand({PolicyArn:arn,MaxItems:100})),
   call(c.iam,new ListPolicyTagsCommand({PolicyArn:arn,MaxItems:100})),call(c.iam,new GetPolicyVersionCommand({PolicyArn:arn,VersionId:"v1"})),call(c.iam,new GetPolicyVersionCommand({PolicyArn:arn,VersionId:"v2"}))]);
  const r=role.Role,p=policy.Policy;
  if(r?.Arn!==roleArn||r.RoleId!==roles[i]||r.Path!=="/"||r.MaxSessionDuration!==3600||r.PermissionsBoundary?.PermissionsBoundaryArn!==arn||!equal(parse(r.AssumeRolePolicyDocument),base.trust)||
   !equal(tags(r.Tags),readonlyRuntimeIamTagsV1(iamApproval))||names.IsTruncated||names.Marker||!equal(names.PolicyNames,[t.inline])||attached.IsTruncated||attached.Marker||attached.AttachedPolicies?.length!==0||
   p?.Arn!==arn||p.Path!=="/"||p.AttachmentCount!==0||p.PermissionsBoundaryUsageCount!==1||versions.IsTruncated||versions.Marker||ptags.IsTruncated||ptags.Marker||!equal(tags(ptags.Tags),readonlyRuntimeIamTagsV1(iamApproval))||
   !equal(parse(v1.PolicyVersion?.Document),base.boundary)||!equal(parse(v2.PolicyVersion?.Document),old.boundary)||inline.RoleName!==t.role||inline.PolicyName!==t.inline)throw Error("BUSINESS_INSTALL_IAM_FIXED_STATE_DRIFT");
  const expectedIds=i===1&&p.DefaultVersionId==="v3"?["v1","v2","v3"]:["v1","v2"];
  if(!equal((versions.Versions??[]).map(v=>v.VersionId).sort(),expectedIds)||versions.Versions.filter(v=>v.IsDefaultVersion).length!==1||!versions.Versions.some(v=>v.VersionId===p.DefaultVersionId&&v.IsDefaultVersion)||
   (i===0&&p.DefaultVersionId!=="v2")||(i===1&&!["v2","v3"].includes(p.DefaultVersionId)))throw Error("BUSINESS_INSTALL_IAM_VERSIONS_DRIFT");
  if(p.DefaultVersionId==="v3"){const v=await call(c.iam,new GetPolicyVersionCommand({PolicyArn:arn,VersionId:"v3"}));if(!equal(parse(v.PolicyVersion?.Document),candidate.boundary))throw Error("BUSINESS_INSTALL_BOUNDARY_DOCUMENT_DRIFT");}
  const doc=parse(inline.PolicyDocument),inlineState=equal(doc,old.identity)?"BASE":i===1&&equal(doc,candidate.identity)?"CANDIDATE":null;
  if(!inlineState)throw Error("BUSINESS_INSTALL_INLINE_DOCUMENT_DRIFT");
  return {boundary:p.DefaultVersionId,inline:inlineState,anchor:{roleArn,roleId:roles[i],boundaryArn:arn,trustSha256:await sha256Hex(base.trust),tags:tags(r.Tags),v1Sha256:await sha256Hex(base.boundary),v2Sha256:await sha256Hex(old.boundary),
   retainedVersions:versions.Versions.filter(v=>["v1","v2"].includes(v.VersionId)).map(v=>({id:v.VersionId,createdAt:v.CreateDate?.toISOString()})).sort((a,b)=>a.id.localeCompare(b.id))}};
 };
 const functionState=async(c,i)=>{
  const arn=resources.functions[i],fn=await cli(c,["lambda","get-function","--function-name",arn]),r=fn.Configuration,logGroup=`/aws/lambda/${targets[i].functionName}`;
  const [ftags,policy,url,aliases,mappings,concurrency,groups,ltags]=await Promise.all([
   cli(c,["lambda","list-tags","--resource",arn]),absent(()=>cli(c,["lambda","get-policy","--function-name",arn])),absent(()=>cli(c,["lambda","get-function-url-config","--function-name",arn])),
   cli(c,["lambda","list-aliases","--function-name",arn,"--no-paginate"]),cli(c,["lambda","list-event-source-mappings","--function-name",arn,"--no-paginate"]),cli(c,["lambda","get-function-concurrency","--function-name",arn]),
   cli(c,["logs","describe-log-groups","--log-group-name-prefix",logGroup,"--no-paginate"]),cli(c,["logs","list-tags-for-resource","--resource-arn",`arn:aws:logs:ca-central-1:402010193138:log-group:${logGroup}`])]);
  if(r?.FunctionArn!==arn||r.Role!==`arn:aws:iam::402010193138:role/${targets[i].role}`||r.Runtime!=="nodejs22.x"||r.Handler!=="index.handler"||r.PackageType!=="Zip"||!equal(r.Architectures,["x86_64"])||
   r.MemorySize!==128||r.Timeout!==60||r.EphemeralStorage?.Size!==512||r.State!=="Active"||r.LastUpdateStatus!=="Successful"||r.Version!=="$LATEST"||r.KMSKeyArn||r.DeadLetterConfig?.TargetArn||r.FileSystemConfigs?.length||r.Layers?.length||
   Object.keys(r.Environment?.Variables??{}).length||r.Environment?.Error||r.VpcConfig?.SubnetIds?.length||r.VpcConfig?.SecurityGroupIds?.length||r.TracingConfig?.Mode!=="PassThrough"||
   r.LoggingConfig?.LogGroup!==logGroup||r.LoggingConfig?.LogFormat!=="JSON"||r.LoggingConfig?.ApplicationLogLevel!=="INFO"||r.LoggingConfig?.SystemLogLevel!=="WARN"||
   (r.SnapStart?.ApplyOn??"None")!=="None"||fn.Code?.SourceKMSKeyArn||r.RuntimeVersionConfig?.Error||!equal(ftags.Tags,functionTags)||policy||url||aliases.NextMarker||aliases.Aliases?.length||mappings.NextMarker||mappings.EventSourceMappings?.length||
   concurrency.ReservedConcurrentExecutions!==undefined||groups.nextToken||groups.logGroups?.length!==1||groups.logGroups[0].logGroupName!==logGroup||groups.logGroups[0].retentionInDays!==7||groups.logGroups[0].kmsKeyId||
   (groups.logGroups[0].logGroupClass??"STANDARD")!=="STANDARD"||!equal(ltags.tags,functionTags))throw Error("BUSINESS_INSTALL_FUNCTION_OR_LOG_DRIFT");
  const zipSha256=Buffer.from(r.CodeSha256,"base64").toString("hex"),code=zipSha256===original[i].zipSha256&&r.CodeSize===original[i].zipBytes?"OLD":zipSha256===artifacts[i].zipSha256&&r.CodeSize===artifacts[i].zipBytes?"CANDIDATE":null;
  if(!code)throw Error("BUSINESS_INSTALL_CODE_UNREVIEWED");
  const stable=structuredClone(r);for(const k of ["CodeSha256","CodeSize","RevisionId","LastModified","LastUpdateStatus","LastUpdateStatusReason","LastUpdateStatusReasonCode","StateReason","StateReasonCode","ConfigSha256"])delete stable[k];
  return {state:{index:i,code,revisionId:r.RevisionId},anchor:{functionArn:arn,configurationSha256:await sha256Hex(stable),runtimeVersionArn:r.RuntimeVersionConfig?.RuntimeVersionArn??null,logGroup,tags:functionTags}};
 };
 const materialState=async c=>{
  const secrets=await Promise.all(targets.map(async t=>{const [d,p,v]=await Promise.all([cli(c,["secretsmanager","describe-secret","--secret-id",t.secretArn]),cli(c,["secretsmanager","get-resource-policy","--secret-id",t.secretArn]),cli(c,["secretsmanager","list-secret-version-ids","--secret-id",t.secretArn,"--include-deprecated","--no-paginate"])]);
   const name=t.secretArn.split(":secret:")[1].slice(0,-7),expectedTags=[{Key:"ApprovalSha256",Value:"85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54"},{Key:"Environment",Value:"sandbox"},{Key:"Project",Value:"Techlong"},{Key:"Purpose",Value:"control-credential-bootstrap-v1"}];
   if(d.ARN!==t.secretArn||d.Name!==name||d.DeletedDate||d.RotationEnabled||d.RotationLambdaARN||d.RotationRules||d.ReplicationStatus?.length||d.KmsKeyId||(d.PrimaryRegion&&d.PrimaryRegion!=="ca-central-1")||d.OwningService||d.Type||d.ExternalSecretRotationRoleArn||d.ExternalSecretRotationMetadata?.length||
    !equal(d.VersionIdsToStages,{[t.secretVersionId]:["AWSCURRENT"]})||!equal(tags(d.Tags),expectedTags)||p.ARN!==t.secretArn||p.Name!==name||p.ResourcePolicy||v.ARN!==t.secretArn||v.Name!==name||v.NextToken||v.Versions?.length!==1||v.Versions[0].VersionId!==t.secretVersionId||!equal(v.Versions[0].VersionStages,["AWSCURRENT"]))throw Error("BUSINESS_INSTALL_SECRET_METADATA_DRIFT");
   return {arn:t.secretArn,versionId:t.secretVersionId,tags:expectedTags};}));
  const k=(await cli(c,["kms","describe-key","--key-id","alias/aws/secretsmanager"])).KeyMetadata,p=await cli(c,["kms","get-key-policy","--key-id",keyArn,"--policy-name","default"]);
  if(k?.Arn!==keyArn||k.KeyManager!=="AWS"||k.KeyState!=="Enabled"||k.KeyUsage!=="ENCRYPT_DECRYPT"||k.KeySpec!=="SYMMETRIC_DEFAULT"||k.MultiRegion||await sha256Hex(parse(p.Policy))!==keyPolicySha)throw Error("BUSINESS_INSTALL_KEY_DRIFT");
  return{secrets,keyArn,keyPolicySha};
 };
 const absentAuthority=async c=>{
  const keys=["cell:cell-sandbox-1","sealed-cell-ttl-v3:cell:cell-sandbox-1"];
  const r=await Promise.all(keys.map(key=>cli(c,["dynamodb","get-item","--table-name","techlong-sandbox-tenant-external-epoch-authority","--key",JSON.stringify({authority_key:{S:key}}),"--consistent-read"])));
  if(r.some(x=>x.Item!==undefined))throw Error("BUSINESS_INSTALL_REAL_AUTHORITY_PRESENT_REVIEW_REQUIRED");
  const stack=await absent(()=>cli(c,["cloudformation","describe-stacks","--stack-name","techlong-sandbox-cell-sandbox-1"]),"ExactCellStackAbsent");
  if(stack!==null)throw Error("BUSINESS_INSTALL_REAL_CELL_PRESENT_REVIEW_REQUIRED");return{keys,absent:true,exactCellStackAbsent:true};
 };
 const permissions=async c=>{const result=[];for(const[action,resource]of [["iam:CreatePolicyVersion",resources.boundaryArn],["iam:PutRolePolicy",resources.roleArn],...resources.functions.map(f=>["lambda:UpdateFunctionCode",f])]){
  const r=await call(c.iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:sourceArn,ActionNames:[action],ResourceArns:[resource],MaxItems:100}));if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw Error("BUSINESS_INSTALL_SOURCE_SIMULATION_INCOMPLETE");result.push({action,resource,decision:r.EvaluationResults[0].EvalDecision});}return result;};
 const inventory=async(withPermissions=false)=>{const started=Date.now(),c=await session();try{const [iam,functions,material,empty,checks]=await Promise.all([Promise.all(targets.map((_,i)=>iamState(c,i))),Promise.all(targets.map((_,i)=>functionState(c,i))),materialState(c),absentAuthority(c),withPermissions?permissions(c):Promise.resolve([])]);
  if(Date.now()-started>30000)throw Error("BUSINESS_INSTALL_INVENTORY_STALE");
  const context={iam:iam.map(x=>x.anchor),functions:functions.map(x=>x.anchor),material,absence:empty};return{observedAt:started,stableAnchorSha256:await sha256Hex(context),state:{drainBoundary:iam[1].boundary,drainInline:iam[1].inline,functions:functions.map(x=>x.state)},
   sourcePermissionsAllowed:checks.length===4&&checks.every(x=>x.decision==="allowed"),permissionChecks:checks,context};
 }finally{c.iam.destroy();}};
 const assertTime=m=>{if(Date.now()<m.reviewedAt||Date.now()+5000>=m.expiresAt)throw Error("BUSINESS_INSTALL_FRESH_APPROVAL_REQUIRED");};
 const assertCurrent=async(m,expected)=>{const r=await inventory(false);if(r.stableAnchorSha256!==m.stableAnchorSha256||!equal(r.state,expected))throw Error("BUSINESS_INSTALL_IMMEDIATE_PREWRITE_DRIFT");assertTime(m);};
 return Object.freeze({inventory,
  createDefaultV3:async(m,expected)=>{await assertCurrent(m,expected);const c=await session();try{assertTime(m);const r=await call(c.iam,new CreatePolicyVersionCommand({PolicyArn:resources.boundaryArn,PolicyDocument:canonicalJson(sealedDrainIamCandidateV3().boundary),SetAsDefault:true}));return{versionId:r.PolicyVersion?.VersionId,isDefault:r.PolicyVersion?.IsDefaultVersion};}finally{c.iam.destroy();}},
  putDrainInline:async(m,expected)=>{await assertCurrent(m,expected);const c=await session();try{assertTime(m);await call(c.iam,new PutRolePolicyCommand({RoleName:targets[1].role,PolicyName:targets[1].inline,PolicyDocument:canonicalJson(sealedDrainIamCandidateV3().identity)}));}finally{c.iam.destroy();}},
  updateCodeOnce:async(m,index,expected,zip)=>{if(![0,1].includes(index)||createHash("sha256").update(zip).digest("hex")!==artifacts[index].zipSha256||zip.length!==artifacts[index].zipBytes)throw Error("BUSINESS_INSTALL_ARTIFACT_DRIFT");await assertCurrent(m,expected);
   const c=await session();try{const hostname="lambda.ca-central-1.amazonaws.com",apiPath=`/2015-03-31/functions/${encodeURIComponent(resources.functions[index])}/code`,signer=new SignatureV4({credentials:c.credentials,region:"ca-central-1",service:"lambda",sha256:Hash.bind(null,"sha256")});
    const req=await signer.sign(new HttpRequest({protocol:"https:",hostname,method:"PUT",path:apiPath,headers:{host:hostname,"content-type":"application/json"},body:JSON.stringify({ZipFile:zip.toString("base64"),Publish:false,RevisionId:expected.functions[index].revisionId})}));assertTime(m);
    const response=await fetch(`https://${hostname}${apiPath}`,{method:"PUT",headers:req.headers,body:req.body,redirect:"error",signal:AbortSignal.timeout(35000)});
    if(response.status!==200)throw Error("BUSINESS_INSTALL_CODE_RESPONSE_UNCERTAIN");const reader=response.body?.getReader();if(!reader)throw Error("BUSINESS_INSTALL_CODE_RESPONSE_UNCERTAIN");let size=0;const parts=[];
    for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>65536){await reader.cancel();throw Error("BUSINESS_INSTALL_CODE_RESPONSE_UNCERTAIN");}parts.push(Buffer.from(p.value));}
    const r=JSON.parse(Buffer.concat(parts).toString("utf8"));if(r.FunctionArn!==resources.functions[index]||r.CodeSha256!==Buffer.from(artifacts[index].zipSha256,"hex").toString("base64"))throw Error("BUSINESS_INSTALL_CODE_RESPONSE_UNCERTAIN");return{revisionId:r.RevisionId,zipSha256:artifacts[index].zipSha256};
   }finally{c.iam.destroy();}},
  waitForReadyReadonly:async(m,index,expected)=>{let last=null;for(let n=0;n<12;n++){const c=await session();try{const r=await cli(c,["lambda","get-function-configuration","--function-name",resources.functions[index]]);
    if(r.FunctionArn!==resources.functions[index]||r.CodeSha256!==Buffer.from(artifacts[index].zipSha256,"hex").toString("base64")||r.CodeSize!==artifacts[index].zipBytes)throw Error("BUSINESS_INSTALL_CODE_WAIT_DRIFT");
    if(r.State==="Active"&&r.LastUpdateStatus==="Successful"){const prospective=structuredClone(expected);prospective.functions[index].revisionId=r.RevisionId;const i=await inventory(false);
     if(i.stableAnchorSha256!==m.stableAnchorSha256||!equal(i.state,prospective))throw Error("BUSINESS_INSTALL_READY_CONFIGURATION_DRIFT");
     if(last===r.RevisionId)return{revisionId:r.RevisionId,zipSha256:artifacts[index].zipSha256,readyObservations:2};last=r.RevisionId;
    }else if(!["InProgress","Successful"].includes(r.LastUpdateStatus)||!["Active","Pending"].includes(r.State))throw Error("BUSINESS_INSTALL_CODE_WAIT_NOT_READY");else last=null;
   }finally{c.iam.destroy();}await new Promise(r=>setTimeout(r,2000));}throw Error("BUSINESS_INSTALL_CODE_WAIT_UNVERIFIED");},
 });
}
