// Source-pinned IAM-only installer; Review/Inspect are read-only. No Lambda/DDB/Secret write commands.
import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IAMClient, GetRoleCommand, GetPolicyCommand, GetPolicyVersionCommand, ListPolicyVersionsCommand, ListPolicyTagsCommand,
  ListRolePoliciesCommand, GetRolePolicyCommand, ListAttachedRolePoliciesCommand, CreatePolicyCommand, CreateRoleCommand, PutRolePolicyCommand,
  SimulateCustomPolicyCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, DescribeSecretCommand, GetResourcePolicyCommand, ListSecretVersionIdsCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient, DescribeTableCommand, GetResourcePolicyCommand as GetDdbResourcePolicyCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets, READONLY_RUNTIME_IAM_SCOPE_V1 as scope, READONLY_RUNTIME_IAM_TABLE_V1 as table,
  readonlyRuntimeIamDocumentsV1 as documents, readonlyRuntimeIamTagsV1 as tags, compileReadonlyIamManifestV1,
  validateReadonlyIamManifestV1, runReadonlyIamInstallV1, inspectReadonlyIamInventoryV1, ReadonlyRuntimeIamErrorV1 } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith("--")||!args[i+1]||options[args[i]])throw new Error("IAM_ARGUMENTS_INVALID");options[args[i]]=args[i+1];}
const mode=options["--mode"],allowed=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||canonicalJson(Object.keys(options).sort())!==canonicalJson(allowed.sort()))throw new Error("IAM_ARGUMENTS_INVALID");
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=path.resolve("F:/ChatGPT_workshop"),out=path.resolve(options["--out"]);
const bounded=p=>path.dirname(p).toLowerCase()===privateRoot.toLowerCase()&&/^techlong-f3b3-readonly-iam-[a-z0-9-]+$/.test(path.basename(p));
if(!bounded(out))throw new Error("IAM_FRESH_PRIVATE_OUTPUT_REQUIRED");
const slot=path.join(privateRoot,scope.permanentSlot),sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev";
const roleArn=i=>`arn:aws:iam::402010193138:role/${targets[i].role}`,policyArn=i=>`arn:aws:iam::402010193138:policy/${targets[i].boundary}`;
const functionArn=i=>`arn:aws:lambda:ca-central-1:402010193138:function:${targets[i].functionName}`;
const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1};
const call=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(30000)});
const execute=promisify(execFile),login=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config});
const parse=v=>{if(v&&typeof v==="object")return v;if(typeof v!=="string")throw new Error("IAM_DOCUMENT_INVALID");try{return JSON.parse(v);}catch{return JSON.parse(decodeURIComponent(v));}};
const equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const sortedTags=v=>[...(v??[])].sort((a,b)=>a.Key.localeCompare(b.Key));
const absent=async fn=>{try{return await fn();}catch(e){if(["NoSuchEntity","NoSuchEntityException"].includes(e.name))return null;throw e;}};
let stage="LOCAL_BINDING",lastInventory,slotConsumed=false;
try{
 const bytes=await readFile(path.join(privateRoot,"techlong-f3b3-neon-credential-recovery-20261008-r1-verify/independent-inspect.json"),"utf8");
 if(await sha256Hex(bytes)!=="9537b004ce68a4751d16ad93df570e0e02281cffe8623dc7d5a7d90df56c021f")throw new Error("IAM_CREDENTIAL_PROOF_DRIFT");
 const proof=JSON.parse(bytes);
 if(!proof.credentialReady||proof.runtimeEnabled||!equal(proof.rolesLogin,[true,true])||proof.secrets.some(s=>!s.authenticated))throw new Error("IAM_CREDENTIAL_READY_PROOF_REQUIRED");
 const files=["ops/aws-sandbox/scripts/review-f3b3-readonly-runtime-iam.mjs","lib/deployments/execution/readonly-runtime-iam-v1.ts",
  "lib/deployments/execution/hash.ts","package.json","package-lock.json"],hashes=[];
 for(const file of files)hashes.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});
 const codeSha256=await sha256Hex(hashes);
 let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}
 if(mode!=="Inspect"&&occupied)throw new Error("IAM_PERMANENT_SLOT_OCCUPIED_INSPECT_ONLY");
 const clients=async()=>{
  stage="SOURCE_STS_CHECK";
  const credentials=await login(),identity=await call(new STSClient({...config,credentials}),new GetCallerIdentityCommand({}));
  if(identity.Account!=="402010193138"||identity.Arn!==sourceArn)throw new Error("IAM_EXACT_SOURCE_IDENTITY_REQUIRED");
  return {credentials,iam:new IAMClient({...config,credentials}),secrets:new SecretsManagerClient({...config,credentials}),
   ddb:new DynamoDBClient({...config,credentials}),cf:new CloudFormationClient({...config,credentials})};
 };
 const functionState=async(c,i)=>{
  stage=`LAMBDA_METADATA_${i+1}`;
  // No Lambda SDK is added to the frozen lock. CLI receives the same verified credential object in memory, never command-line secrets.
  try{
   const r=await execute("aws",["lambda","get-function-configuration","--function-name",targets[i].functionName,"--region","ca-central-1","--output","json","--no-cli-pager",
    "--cli-connect-timeout","10","--cli-read-timeout","30","--query","{Arn:FunctionArn,Role:Role,State:State,Runtime:Runtime,CodeSha256:CodeSha256}"],
    {timeout:35000,maxBuffer:65536,windowsHide:true,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:c.credentials.accessKeyId,
     AWS_SECRET_ACCESS_KEY:c.credentials.secretAccessKey,AWS_SESSION_TOKEN:c.credentials.sessionToken,AWS_REGION:"ca-central-1",AWS_DEFAULT_REGION:"ca-central-1",
     AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_MAX_ATTEMPTS:"1",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});
   const data=JSON.parse(r.stdout);if(data.Arn!==functionArn(i))throw new Error("IAM_FUNCTION_IDENTITY_MISMATCH");return {name:targets[i].functionName,state:"PRESENT",data};
  }catch(e){if(/\(ResourceNotFoundException\)/.test(e.stderr??""))return {name:targets[i].functionName,state:"ABSENT"};throw new Error("IAM_FUNCTION_READ_UNVERIFIED");}
 };
 const readPolicy=async(c,i,approval)=>{
  stage=`IAM_BOUNDARY_READ_${i+1}`;
  const p=await absent(()=>call(c.iam,new GetPolicyCommand({PolicyArn:policyArn(i)})));if(!p)return {name:targets[i].boundary,state:"ABSENT"};
  const versions=await call(c.iam,new ListPolicyVersionsCommand({PolicyArn:policyArn(i),MaxItems:100}));
  const tagRead=await call(c.iam,new ListPolicyTagsCommand({PolicyArn:policyArn(i),MaxItems:100}));
  const v=await call(c.iam,new GetPolicyVersionCommand({PolicyArn:policyArn(i),VersionId:p.Policy.DefaultVersionId}));
  const matched=p.Policy.Arn===policyArn(i)&&p.Policy.PolicyName===targets[i].boundary&&p.Policy.Path==="/"&&p.Policy.DefaultVersionId==="v1"&&p.Policy.AttachmentCount===0&&
   !versions.IsTruncated&&!versions.Marker&&versions.Versions?.length===1&&versions.Versions[0].VersionId==="v1"&&versions.Versions[0].IsDefaultVersion===true&&
   !tagRead.IsTruncated&&!tagRead.Marker&&equal(sortedTags(tagRead.Tags),tags(approval))&&equal(parse(v.PolicyVersion.Document),documents(i).boundary);
  return {name:targets[i].boundary,state:"PRESENT",exactOwnMatch:matched};
 };
 const readRole=async(c,i,approval,empty=false)=>{
  stage=`IAM_ROLE_READ_${i+1}`;
  const r=await absent(()=>call(c.iam,new GetRoleCommand({RoleName:targets[i].role})));if(!r)return {name:targets[i].role,state:"ABSENT"};
  const inline=await call(c.iam,new ListRolePoliciesCommand({RoleName:targets[i].role,MaxItems:100}));
  const attached=await call(c.iam,new ListAttachedRolePoliciesCommand({RoleName:targets[i].role,MaxItems:100}));
  const role=r.Role;let matched=role.Arn===roleArn(i)&&role.Path==="/"&&role.MaxSessionDuration===3600&&
   role.PermissionsBoundary?.PermissionsBoundaryArn===policyArn(i)&&equal(parse(role.AssumeRolePolicyDocument),documents(i).trust)&&equal(sortedTags(role.Tags),tags(approval))&&
   !inline.IsTruncated&&!inline.Marker&&!attached.IsTruncated&&!attached.Marker&&attached.AttachedPolicies?.length===0;
  if(empty)matched&&=inline.PolicyNames?.length===0;
  else{
   matched&&=equal(inline.PolicyNames,[targets[i].inline]);
   if(matched){const p=await call(c.iam,new GetRolePolicyCommand({RoleName:targets[i].role,PolicyName:targets[i].inline}));
    matched&&=p.RoleName===targets[i].role&&p.PolicyName===targets[i].inline&&equal(parse(p.PolicyDocument),documents(i).identity);}
  }
  return {name:targets[i].role,state:"PRESENT",exactOwnMatch:matched,roleId:role.RoleId};
 };
 const prerequisites=async c=>{
  const functions=[];for(let i=0;i<2;i++)functions.push(await functionState(c,i));
  if(functions.some(f=>f.state!=="ABSENT"))throw new Error("IAM_NO_FUNCTION_INSTALL_OR_EXISTING_FUNCTION_REUSE");
  const secrets=[];
  for(const t of targets){
   stage=`SECRET_METADATA_${t.functionName}`;
   const d=await call(c.secrets,new DescribeSecretCommand({SecretId:t.secretArn}));
   const expectedTags=[{Key:"ApprovalSha256",Value:"85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54"},
    {Key:"Environment",Value:"sandbox"},{Key:"Project",Value:"Techlong"},{Key:"Purpose",Value:"control-credential-bootstrap-v1"}];
   if(d.ARN!==t.secretArn||d.Name!==t.secretArn.split(":secret:")[1].slice(0,-7)||d.DeletedDate||d.RotationEnabled||d.RotationLambdaARN||d.RotationRules||
    d.ReplicationStatus?.length||d.KmsKeyId||(d.PrimaryRegion&&d.PrimaryRegion!=="ca-central-1")||d.OwningService||d.Type||d.ExternalSecretRotationRoleArn||d.ExternalSecretRotationMetadata?.length||
    !equal(d.VersionIdsToStages,{[t.secretVersionId]:["AWSCURRENT"]})||!equal(sortedTags(d.Tags),expectedTags))throw new Error("IAM_EXISTING_SECRET_METADATA_DRIFT");
   const rp=await call(c.secrets,new GetResourcePolicyCommand({SecretId:t.secretArn}));
   const vs=await call(c.secrets,new ListSecretVersionIdsCommand({SecretId:t.secretArn,IncludeDeprecated:true,MaxResults:100}));
   if(rp.ARN!==t.secretArn||rp.Name!==d.Name||rp.ResourcePolicy||vs.ARN!==t.secretArn||vs.Name!==d.Name||vs.NextToken||vs.Versions?.length!==1||
    vs.Versions[0].VersionId!==t.secretVersionId||!equal(vs.Versions[0].VersionStages,["AWSCURRENT"]))throw new Error("IAM_SECRET_POLICY_OR_ALL_VERSIONS_DRIFT");
   secrets.push({arn:t.secretArn,versionId:t.secretVersionId,stage:"AWSCURRENT",noResourcePolicy:true,onlyInitialVersion:true});
  }
  stage="DDB_TABLE_METADATA";const td=(await call(c.ddb,new DescribeTableCommand({TableName:table}))).Table;
  if(td.TableArn!==table||td.TableStatus!=="ACTIVE"||td.BillingModeSummary?.BillingMode!=="PAY_PER_REQUEST"||
   !equal(td.KeySchema,[{AttributeName:"authority_key",KeyType:"HASH"}]))throw new Error("IAM_AUTHORITY_TABLE_UNVERIFIED");
  stage="DDB_RESOURCE_POLICY_READ";let noResourcePolicy=false;
  try{const rp=await call(c.ddb,new GetDdbResourcePolicyCommand({ResourceArn:table}));noResourcePolicy=!rp.Policy;}
  catch(e){if(e.name==="PolicyNotFoundException")noResourcePolicy=true;else throw e;}
  if(!noResourcePolicy)throw new Error("IAM_TABLE_RESOURCE_POLICY_REQUIRES_REVIEW");
  const doc=DynamoDBDocumentClient.from(c.ddb,{marshallOptions:{removeUndefinedValues:false,convertClassInstanceToMap:false}}),items=[];
  for(const key of ["cell:cell-sandbox-1","sealed-cell-ttl-v3:cell:cell-sandbox-1"]){
   stage=`DDB_ITEM_READ_${key}`;
   const r=await call(doc,new GetCommand({TableName:table,Key:{authority_key:key},ConsistentRead:true}));
   if(r.Item&&r.Item.authority_key!==key)throw new Error("IAM_AUTHORITY_KEY_MISMATCH");
   items.push({key,state:r.Item?"PRESENT":"ABSENT",...(r.Item?{itemSha256:await sha256Hex(r.Item),schemaVersion:r.Item.schema_version,revision:r.Item.revision}:{})});
  }
  stage="CELL_STACK_READ";let cell;
  try{const r=await call(c.cf,new DescribeStacksCommand({StackName:"techlong-sandbox-cell-sandbox-1"}));
   if(r.Stacks?.length!==1||r.Stacks[0].StackName!=="techlong-sandbox-cell-sandbox-1")throw new Error("IAM_CELL_READ_UNVERIFIED");
   cell={state:"PRESENT",stackId:r.Stacks[0].StackId,status:r.Stacks[0].StackStatus};
  }catch(e){if(e.name==="ValidationError"&&/^Stack with id techlong-sandbox-cell-sandbox-1 does not exist$/.test(e.message??""))cell={state:"ABSENT",proof:"EXACT_NAME_BOUND_VALIDATION_ERROR"};else throw e;}
  return {functions,secrets,table:{arn:table,billingMode:"PAY_PER_REQUEST",key:"authority_key",noResourcePolicy},items,cell,
   credentialInspectFileSha256:"9537b004ce68a4751d16ad93df570e0e02281cffe8623dc7d5a7d90df56c021f",secretValuesRead:false};
 };
 const inventory=async approval=>{
  const start=Date.now(),c=await clients(),policies=[],roles=[];
  for(let i=0;i<2;i++)policies.push(await readPolicy(c,i,approval));for(let i=0;i<2;i++)roles.push(await readRole(c,i,approval));
  const context=await prerequisites(c);if(Date.now()-start>30000)throw new Error("IAM_INVENTORY_COLLECTION_STALE");
  const r={observedAt:start,sourceArn,policies,roles,prerequisitesSha256:await sha256Hex(context)};lastInventory={...r,context};return r;
 };
 await mkdir(out);const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),bytes,{flag:"wx"});return sha256Hex(bytes);};
 let manifest;
 if(mode==="Review"){
  stage="READONLY_REVIEW";const r=await inventory("0".repeat(64));manifest=await compileReadonlyIamManifestV1({inventory:r,codeSha256,now:Date.now()});
  // Simulation is an online IAM parser/evaluator check, not live role capability proof or a resource mutation.
  const c=await clients(),cases=[];
  const simulate=async(index,label,action,resource,context,expected)=>{
   stage=`POLICY_SIMULATION_${index+1}_${label}`;
   const doc=documents(index),request={PolicyInputList:[canonicalJson(doc.identity)],PermissionsBoundaryPolicyInputList:[canonicalJson(doc.boundary)],
    ActionNames:[action],ResourceArns:[resource],ContextEntries:Object.entries(context).map(([key,value])=>({ContextKeyName:key,ContextKeyType:Array.isArray(value)?"stringList":"string",ContextKeyValues:Array.isArray(value)?value:[value]})),MaxItems:100};
   const r=await call(c.iam,new SimulateCustomPolicyCommand(request));
   if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("IAM_SIMULATION_INCOMPLETE");
   const v=r.EvaluationResults[0],decision=v.EvalDecision;
   if(v.EvalActionName?.toLowerCase()!==action.toLowerCase()||v.EvalResourceName!==resource||(expected==="denied"&&decision==="allowed")){
    await save("policy-simulation-failure.json",{index,label,action,resource,expected,result:v,simulationOnly:true,awsWrites:0});
    console.log(JSON.stringify({mode:"SimulationFailure",label,decision,expected,actionMatches:v.EvalActionName?.toLowerCase()===action.toLowerCase(),resourceMatches:v.EvalResourceName===resource,
     missingContext:v.MissingContextValues??[],boundaryAllowed:v.PermissionsBoundaryDecisionDetail?.AllowedByPermissionsBoundary}));
    throw new Error("IAM_POLICY_CASE_NOT_VERIFIED");
   }
   cases.push({index,label,action,resource,expected,decision,expectedDecisionVerified:expected==="allowed"?decision==="allowed":decision!=="allowed",
    sourceFunctionAllowPathNotProved:expected==="allowed"&&decision!=="allowed",missingContext:v.MissingContextValues??[]});
  };
  for(let i=0;i<2;i++){
   const base={"lambda:SourceFunctionArn":functionArn(i),"aws:RequestedRegion":"ca-central-1"};
   await simulate(i,"exact-secret", "secretsmanager:GetSecretValue",targets[i].secretArn,{...base,"secretsmanager:VersionStage":"AWSCURRENT"},"allowed");
   await simulate(i,"wrong-secret", "secretsmanager:GetSecretValue",targets[1-i].secretArn,{...base,"secretsmanager:VersionStage":"AWSCURRENT"},"denied");
   await simulate(i,"wrong-version-stage", "secretsmanager:GetSecretValue",targets[i].secretArn,{...base,"secretsmanager:VersionStage":"AWSPREVIOUS"},"denied");
   await simulate(i,"missing-source", "secretsmanager:GetSecretValue",targets[i].secretArn,{"aws:RequestedRegion":"ca-central-1","secretsmanager:VersionStage":"AWSCURRENT"},"denied");
   await simulate(i,"wrong-source", "secretsmanager:GetSecretValue",targets[i].secretArn,{...base,"lambda:SourceFunctionArn":functionArn(1-i),"secretsmanager:VersionStage":"AWSCURRENT"},"denied");
   await simulate(i,"wrong-region", "secretsmanager:GetSecretValue",targets[i].secretArn,{...base,"aws:RequestedRegion":"us-east-1","secretsmanager:VersionStage":"AWSCURRENT"},"denied");
   const read={...base,"dynamodb:LeadingKeys":["cell:cell-sandbox-1"],...(i===0?{"dynamodb:EnclosingOperation":"TransactGetItems"}:{})};
   await simulate(i,"exact-authority-read","dynamodb:GetItem",table,read,"allowed");
   await simulate(i,"missing-leading-keys","dynamodb:GetItem",table,base,"denied");
   await simulate(i,"mixed-outside-key","dynamodb:GetItem",table,{...read,"dynamodb:LeadingKeys":["cell:cell-sandbox-1","cell:another-cell"]},"denied");
   await simulate(i,"table-write","dynamodb:PutItem",table,{...base,"dynamodb:LeadingKeys":["cell:cell-sandbox-1"]},"denied");
   await simulate(i,"cell-delete","cloudformation:DeleteStack","arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012",base,"denied");
   await simulate(i,"pass-role","iam:PassRole",roleArn(i),base,"denied");
   await simulate(i,"log-create-group","logs:CreateLogGroup",`arn:aws:logs:ca-central-1:402010193138:log-group:/aws/lambda/${targets[i].functionName}`,base,"denied");
   await simulate(i,"exact-existing-log-stream","logs:PutLogEvents",`arn:aws:logs:ca-central-1:402010193138:log-group:/aws/lambda/${targets[i].functionName}:log-stream:approved-test`,base,"allowed");
  }
  const base={"lambda:SourceFunctionArn":functionArn(0),"aws:RequestedRegion":"ca-central-1"};
  await simulate(0,"atomic-two-key-read","dynamodb:GetItem",table,{...base,"dynamodb:LeadingKeys":["cell:cell-sandbox-1","sealed-cell-ttl-v3:cell:cell-sandbox-1"],"dynamodb:EnclosingOperation":"TransactGetItems"},"allowed");
  await simulate(0,"exact-journal-read","dynamodb:GetItem",table,{...base,"dynamodb:LeadingKeys":["sealed-cell-ttl-v3:intent:"+"a".repeat(64)]},"allowed");
  await simulate(0,"short-journal-key","dynamodb:GetItem",table,{...base,"dynamodb:LeadingKeys":["sealed-cell-ttl-v3:intent:short"]},"denied");
  await simulate(0,"plain-authority-get","dynamodb:GetItem",table,{...base,"dynamodb:LeadingKeys":["cell:cell-sandbox-1"]},"denied");
  const sourcePermissions=[];
  for(let i=0;i<2;i++)for(const [action,resource] of [["iam:CreatePolicy",policyArn(i)],["iam:TagPolicy",policyArn(i)],["iam:CreateRole",roleArn(i)],["iam:TagRole",roleArn(i)],["iam:PutRolePolicy",roleArn(i)]]){
   stage=`SOURCE_PERMISSION_${i+1}_${action}`;
   const r=await call(c.iam,new SimulatePrincipalPolicyCommand({PolicySourceArn:sourceArn,ActionNames:[action],ResourceArns:[resource],
    ContextEntries:[{ContextKeyName:"iam:PermissionsBoundary",ContextKeyType:"string",ContextKeyValues:[policyArn(i)]}],MaxItems:100}));
   if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("IAM_SOURCE_SIMULATION_INCOMPLETE");
   sourcePermissions.push({action,resource,decision:r.EvaluationResults[0].EvalDecision,missingContext:r.EvaluationResults[0].MissingContextValues??[]});
  }
  await save("policy-simulation.json",{cases,sourcePermissions,policyParserAndEvaluatorOnly:true,liveRolePermissionsVerified:false,
   allowCasesNotVerified:cases.filter(x=>x.sourceFunctionAllowPathNotProved).length,deniedCasesVerified:cases.filter(x=>x.expected==="denied"&&x.expectedDecisionVerified).length,
   sourceFunctionGuardNotRemovedFromInstallDocuments:true,resourceInstallationOnlyNotRuntimeReady:true});
  await save("read-only-inventory.json",lastInventory);
  if(sourcePermissions.some(x=>x.decision!=="allowed"))throw new Error("IAM_SOURCE_INSTALL_PERMISSION_NOT_PROVED");
  const fileSha256=await save("review-manifest.json",manifest);
  console.log(JSON.stringify({mode,out,manifestSha256:manifest.manifestSha256,fileSha256,codeSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),
   policySimulationCases:cases.length,sourcePermissionCases:sourcePermissions.length,allowCasesNotVerified:cases.filter(x=>x.sourceFunctionAllowPathNotProved).length,
   runtimePermissionsNotProved:true,sourceFunctionGuardPreserved:true,secretValuesRead:false,awsWrites:0,approvalRequired:true,runtimeEnabled:false}));
 }else{
  const file=path.resolve(options["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!bounded(path.dirname(file)))throw new Error("IAM_PRIVATE_MANIFEST_REQUIRED");
  manifest=JSON.parse(await readFile(file,"utf8"));await validateReadonlyIamManifestV1(manifest,codeSha256);
  if(mode==="Inspect"&&occupied){const approved=JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8"));if(!equal(approved,manifest))throw new Error("IAM_SLOT_MANIFEST_DRIFT");}
  if(mode==="Run"){
   stage="APPROVED_SINGLE_IAM_INSTALL";const createdRoleIds=new Map();
   const result=await runReadonlyIamInstallV1({manifest,approvedSha:options["--approved-sha"],codeSha256,ports:{now:Date.now,inventory,
    claimSlot:()=>mkdir(slot),saveMarker:async(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"}),
    createBoundary:async(i,approval)=>{const c=await clients(),r=await call(c.iam,new CreatePolicyCommand({PolicyName:targets[i].boundary,Path:"/",
     Description:"Techlong dedicated runtime maximum: read only AWS and exact existing log streams; no deployment or deletion",PolicyDocument:canonicalJson(documents(i).boundary),Tags:tags(approval)}));
     return {arn:r.Policy?.Arn,name:r.Policy?.PolicyName,version:r.Policy?.DefaultVersionId};},
    createRole:async(i,approval)=>{const c=await clients(),r=await call(c.iam,new CreateRoleCommand({RoleName:targets[i].role,Path:"/",MaxSessionDuration:3600,
     Description:"Techlong dedicated Lambda role; no runtime installed by this approval",PermissionsBoundary:policyArn(i),AssumeRolePolicyDocument:canonicalJson(documents(i).trust),Tags:tags(approval)}));
     if(r.Role?.RoleId)createdRoleIds.set(i,r.Role.RoleId);return {arn:r.Role?.Arn,name:r.Role?.RoleName,roleId:r.Role?.RoleId,boundaryArn:r.Role?.PermissionsBoundary?.PermissionsBoundaryArn};},
    verifyNewEmptyRole:async(i,roleId,approval)=>{const c=await clients(),r=await readRole(c,i,approval,true);if(r.roleId!==roleId||!r.exactOwnMatch||createdRoleIds.get(i)!==roleId)throw new Error("IAM_NEW_ROLE_PREPOLICY_DRIFT");},
    putOwnRolePolicy:async(i,roleId)=>{if(createdRoleIds.get(i)!==roleId)throw new Error("IAM_OWN_NEW_ROLE_REQUIRED");const c=await clients();
     const r=await readRole(c,i,manifest.manifestSha256,true);if(r.roleId!==roleId||!r.exactOwnMatch)throw new Error("IAM_ROLE_ID_OR_EMPTY_ROLE_STATE_DRIFT");
     await call(c.iam,new PutRolePolicyCommand({RoleName:targets[i].role,PolicyName:targets[i].inline,PolicyDocument:canonicalJson(documents(i).identity)}));}}});
   slotConsumed=result.slotConsumed;await save("submission-receipt.json",result);console.log(JSON.stringify({mode,out,...result}));if(result.failureStage)process.exitCode=1;
  }
  stage="INDEPENDENT_READONLY_INSPECT";const r=await inventory(manifest.manifestSha256),inspected=inspectReadonlyIamInventoryV1(r,manifest);
  await save("read-only-inventory.json",lastInventory);const fileSha256=await save("independent-inspect.json",inspected);
  console.log(JSON.stringify({mode:"IndependentInspect",out,fileSha256,outcome:inspected.outcome,iamFoundationReady:inspected.iamFoundationReady,runtimeEnabled:false}));
  if(!inspected.iamFoundationReady)process.exitCode=1;
 }
}catch(e){console.error(JSON.stringify({outcome:"READONLY_RUNTIME_IAM_NOT_VERIFIED",stage,slotConsumed,
 failureCode:e instanceof ReadonlyRuntimeIamErrorV1?e.code:/^[A-Za-z0-9_]{5,80}$/.test(e.message??"")?e.message:"READONLY_IAM_OPERATION_UNVERIFIED",
 serviceErrorName:["AccessDenied","AccessDeniedException","InvalidClientTokenId","ExpiredToken","ExpiredTokenException","ResourceNotFoundException","PolicyNotFoundException","NoSuchEntityException","InvalidInputException","ValidationError","CredentialsProviderError","TokenProviderError","Error","TypeError","TimeoutError","Throttling","ThrottlingException"].includes(e.name)?e.name:null,
 httpStatus:Number.isInteger(e.$metadata?.httpStatusCode)?e.$metadata.httpStatusCode:null,nodeErrorCode:["ENOENT","ETIMEDOUT","ECONNREFUSED","ENOTFOUND"].includes(e.code)?e.code:null,
 rawDiagnosticsWithheld:true,noWriteRetry:true,awsWritesAuthorizedByReview:false,runtimeEnabled:false}));process.exitCode=1;}
