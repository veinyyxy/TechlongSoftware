import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as scope, compileCostManifestV1, validateCostManifestV1, runCostControlsV1 } from "../../../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { createCostControlsAwsRuntimeV1 } from "./sandbox-cost-controls-aws-v1.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=await realpath("F:/ChatGPT_workshop"),args=process.argv.slice(2),o={},equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
for(let i=0;i<args.length;i+=2){if(!["--mode","--out","--manifest","--approved-sha"].includes(args[i])||!args[i+1]||o[args[i]])throw Error("COST_CONTROL_OPTIONS_INVALID");o[args[i]]=args[i+1];}
const mode=o["--mode"],keys=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||!equal(Object.keys(o).sort(),keys.sort()))throw Error("COST_CONTROL_OPTIONS_INVALID");
const bounded=async p=>/^techlong-f3c3a-cost-controls-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(path.dirname(p))).toLowerCase()===privateRoot.toLowerCase(),out=path.resolve(o["--out"]);
if(!await bounded(out))throw Error("COST_CONTROL_PRIVATE_OUTPUT_REQUIRED");await mkdir(out);
const slot=path.join(privateRoot,scope.permanentSlot),save=async(name,v)=>{const b=JSON.stringify(v,null,2)+"\n";await writeFile(path.join(out,name),b,{flag:"wx"});return sha256Hex(b);};let stage="CODE_BINDING";
try{
 const files=["lib/deployments/execution/sandbox-cost-controls-v1.ts","lib/deployments/execution/hash.ts","ops/aws-sandbox/scripts/sandbox-cost-controls-aws-v1.mjs","ops/aws-sandbox/scripts/review-sandbox-cost-controls-v1.mjs","ops/aws-sandbox/cloudformation/guardrails.template.json","package.json","package-lock.json"],pins=[];
 for(const file of files)pins.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});const codeSha256=await sha256Hex(pins);await save("code-binding.json",{codeSha256,pins});
 const base=JSON.parse(await readFile(path.join(root,"ops/aws-sandbox/cloudformation/guardrails.template.json"),"utf8"));
 let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}if(mode!=="Inspect"&&occupied)throw Error("COST_CONTROL_CONSUMED_SLOT_INSPECT_ONLY");
 const runtime=createCostControlsAwsRuntimeV1(slot);let manifest;
 if(mode==="Review"){stage="READONLY_REVIEW";const i=await runtime.inventory(true);await save("read-only-inventory.json",i);manifest=await compileCostManifestV1(i,base,codeSha256,Date.now());
  await save("candidate-template.json",manifest.candidateTemplate);const fileSha256=await save("review-manifest.json",manifest);
  console.log(JSON.stringify({mode,out,fileSha256,manifestSha256:manifest.manifestSha256,codeSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),permissionChecks:i.permissionChecks,oldFailedChangeSetsPreservedLocally:i.preservedFailedChangeSets.length,
   proposedMaximumDirectWrites:3,cloudWrites:0,approvalRequired:true,runtimeEnabled:false}));
 }else{const file=path.resolve(o["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!await bounded(path.dirname(file)))throw Error("COST_CONTROL_PRIVATE_MANIFEST_REQUIRED");manifest=JSON.parse(await readFile(file,"utf8"));await validateCostManifestV1(manifest,base,codeSha256);
  if(occupied&&!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),manifest))throw Error("COST_CONTROL_SLOT_MANIFEST_DRIFT");
  if(mode==="Run"){stage="APPROVED_ONCE_RUN";const r=await runCostControlsV1(manifest,o["--approved-sha"],base,codeSha256,{now:Date.now,inventory:runtime.inventory,claimSlot:()=>mkdir(slot),marker:(n,v)=>writeFile(path.join(slot,n),JSON.stringify(v,null,2)+"\n",{flag:"wx"}),
   createChangeSetOnce:runtime.createChangeSetOnce,readReviewedChangeSet:runtime.readReviewedChangeSet,executeChangeSetOnce:runtime.executeChangeSetOnce,waitBudgetUpdate:runtime.waitBudgetUpdate,updateReadLimitOnce:runtime.updateReadLimitOnce});const fileSha256=await save("submission-receipt.json",r);
   console.log(JSON.stringify({mode,out,fileSha256,...r}));if(r.failureCode)process.exitCode=1;}
  stage="INDEPENDENT_READONLY_INSPECT";const r=await runtime.inspect(manifest),fileSha256=await save("independent-inspect.json",r);console.log(JSON.stringify({mode:"Inspect",out,fileSha256,...r}));if(!r.costControlsVerified)process.exitCode=1;
 }
}catch(e){const r={outcome:"COST_CONTROL_UNVERIFIED",stage,failureCode:/^COST_CONTROL_[A-Z_]+$/.test(e.message??"")?e.message:"COST_CONTROL_OPERATION_UNVERIFIED",serviceErrorName:["CredentialsProviderError","ExpiredToken","ExpiredTokenException","AccessDenied","AccessDeniedException"].includes(e.name)?e.name:null,
 rawDiagnosticsWithheld:true,noAutomaticRollbackDeleteFillResetOrWriteRetry:true,runtimeEnabled:false};await save("failure-diagnostic.json",r);console.error(JSON.stringify(r));process.exitCode=1;}
