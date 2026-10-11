// Read-only IAM simulation and prestate check. No cloud writer/invoker or DB client is imported.
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulateCustomPolicyCommand, GetRoleCommand, GetRolePolicyCommand, GetPolicyVersionCommand, GetPolicyCommand } from "@aws-sdk/client-iam";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { writeFile, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { sealedDrainIamCandidateV3 } from "../../../lib/deployments/execution/sealed-drain-iam-candidate-v3.ts";
import { readonlyKmsRepairDocumentsV1, READONLY_KMS_KEY_ARN_V1 as key } from "../../../lib/deployments/execution/readonly-kms-read-repair-v1.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";
const args=process.argv.slice(2),privateRoot=await realpath("F:/ChatGPT_workshop");if(args.length!==2||args[0]!=="--out")throw new Error("SEALED_POLICY_FRESH_OUTPUT_REQUIRED");
const out=path.resolve(args[1]);if((await realpath(path.dirname(out))).toLowerCase()!==privateRoot.toLowerCase()||!/^techlong-f3b3-sealed-drain-policy-[a-z0-9-]+$/.test(path.basename(out)))throw new Error("SEALED_POLICY_PRIVATE_OUTPUT_REQUIRED");await mkdir(out);
const hash=b=>createHash("sha256").update(b).digest("hex"),save=async(name,value)=>{const b=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),b,{flag:"wx"});return hash(b);};
let iam;
try{
 const doc=sealedDrainIamCandidateV3(),documentFileSha256=await save("candidate-policy.json",doc),config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1},sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev";
 const credentials=await fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config})(),sts=new STSClient({...config,credentials});
 try{const i=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});if(i.Account!=="402010193138"||i.Arn!==sourceArn)throw new Error("SEALED_POLICY_SOURCE_IDENTITY_INVALID");}finally{sts.destroy();}
 iam=new IAMClient({...config,credentials});let next=0;const call=async c=>{if(next>Date.now())await new Promise(r=>setTimeout(r,next-Date.now()));next=Date.now()+600;return iam.send(c,{abortSignal:AbortSignal.timeout(15000)});};
 const target=targets[1],boundaryArn=`arn:aws:iam::402010193138:policy/${target.boundary}`,roleArn=`arn:aws:iam::402010193138:role/${target.role}`,fnArn=`arn:aws:lambda:ca-central-1:402010193138:function:${target.functionName}`;
 const parse=v=>typeof v==="string"?JSON.parse(v.startsWith("{")?v:decodeURIComponent(v)):v;
 const r=await call(new GetRoleCommand({RoleName:target.role})),p=await call(new GetPolicyCommand({PolicyArn:boundaryArn})),v=await call(new GetPolicyVersionCommand({PolicyArn:boundaryArn,VersionId:"v2"})),inline=await call(new GetRolePolicyCommand({RoleName:target.role,PolicyName:target.inline}));
 if(r.Role?.Arn!==roleArn||r.Role.RoleId!=="AROAV3GNMXTZPRETOTXTS"||r.Role.PermissionsBoundary?.PermissionsBoundaryArn!==boundaryArn||p.Policy?.DefaultVersionId!=="v2"||
  canonicalJson(parse(v.PolicyVersion?.Document))!==canonicalJson(readonlyKmsRepairDocumentsV1(1).boundary)||canonicalJson(parse(inline.PolicyDocument))!==canonicalJson(readonlyKmsRepairDocumentsV1(1).identity))throw new Error("SEALED_POLICY_EXISTING_IAM_DRIFT");
 const cases=[];for(const [index,t] of targets.entries()){
   const ctx={"aws:RequestedRegion":"ca-central-1","kms:ViaService":"secretsmanager.ca-central-1.amazonaws.com","kms:CallerAccount":"402010193138","kms:EncryptionContext:SecretARN":t.secretArn,"kms:EncryptionContext:SecretVersionId":t.secretVersionId};
   cases.push({name:`exact-kms-${index}`,action:"kms:Decrypt",resource:key,ctx,allowed:true},{name:`cross-uuid-${index}`,action:"kms:Decrypt",resource:key,ctx:{...ctx,"kms:EncryptionContext:SecretVersionId":targets[index===0?1:0].secretVersionId},allowed:false},
    {name:`direct-secret-${index}`,action:"secretsmanager:GetSecretValue",resource:t.secretArn,ctx:{"aws:RequestedRegion":"ca-central-1","lambda:SourceFunctionArn":fnArn,"secretsmanager:VersionStage":"AWSCURRENT"},allowed:true});
 }
 const base=cases[0];for(const k of ["kms:ViaService","kms:CallerAccount","kms:EncryptionContext:SecretARN","kms:EncryptionContext:SecretVersionId"])
  cases.push({...base,name:`missing-${k}`,ctx:Object.fromEntries(Object.entries(base.ctx).filter(([key])=>key!==k)),allowed:false});
 cases.push({...base,name:"wrong-key",resource:"arn:aws:kms:ca-central-1:402010193138:key/00000000-0000-0000-0000-000000000000",allowed:false},
  {...cases[2],name:"wrong-direct-function",ctx:{...cases[2].ctx,"lambda:SourceFunctionArn":"arn:aws:lambda:ca-central-1:402010193138:function:other"},allowed:false},
  {...base,name:"cloud-delete-not-allowed",action:"cloudformation:DeleteStack",resource:"arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/00000000-0000-0000-0000-000000000000",allowed:false});
 const results=[];for(const c of cases){const r=await call(new SimulateCustomPolicyCommand({PolicyInputList:[canonicalJson(doc.identity)],PermissionsBoundaryPolicyInputList:[canonicalJson(doc.boundary)],ActionNames:[c.action],ResourceArns:[c.resource],
  ContextEntries:Object.entries(c.ctx).map(([k,v])=>({ContextKeyName:k,ContextKeyType:"string",ContextKeyValues:[v]})),MaxItems:100}));
  if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("SEALED_POLICY_SIMULATION_INCOMPLETE");const e=r.EvaluationResults[0],decision=e.EvalDecision;
  results.push({name:c.name,decision,expectedAllowed:c.allowed,verified:(decision==="allowed")===c.allowed,sourceFunctionAllowPathNotProved:c.name.startsWith("direct-secret-")&&decision!=="allowed",
   missingContext:e.MissingContextValues??[],boundaryAllowed:e.PermissionsBoundaryDecisionDetail?.AllowedByPermissionsBoundary,matchedStatements:e.MatchedStatements??[]});}
 const report={schemaVersion:3,observedAt:new Date().toISOString(),sourceArn,existingRoleId:r.Role.RoleId,existingBoundaryDefault:"v2",existingInlineUnchanged:true,documentFileSha256,candidatePolicySha256:await sha256Hex(doc.identity),candidateCharacters:doc.characters,
  cases:results,allCasesVerified:results.every(c=>c.verified),kmsAndNegativeCasesVerified:results.filter(c=>!c.name.startsWith("direct-secret-")).every(c=>c.verified),directSecretAllowCasesNotProved:results.filter(c=>c.sourceFunctionAllowPathNotProved).length,
  simulationOnly:true,iamWrites:0,lambdaUpdates:0,lambdaInvocations:0,secretValuesRead:false,databaseConnected:false,installationAuthorized:false,runtimeEnabled:false};
 const fileSha256=await save("read-only-policy-review.json",report);console.log(JSON.stringify({out,fileSha256,...report}));if(!report.allCasesVerified)process.exitCode=1;
}catch(error){const result={outcome:"SEALED_POLICY_CANDIDATE_NOT_VERIFIED",failureCode:/^SEALED_POLICY_[A-Z_]+$/.test(error.message??"")?error.message:"SEALED_POLICY_READ_OR_SIMULATION_UNVERIFIED",rawDiagnosticsWithheld:true,
 iamWrites:0,lambdaUpdates:0,lambdaInvocations:0,secretValuesRead:false,databaseConnected:false,installationAuthorized:false};await save("failure-diagnostic.json",result);console.error(JSON.stringify(result));process.exitCode=1;
}finally{iam?.destroy();}
