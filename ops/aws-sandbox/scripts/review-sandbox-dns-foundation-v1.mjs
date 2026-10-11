import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { SANDBOX_DNS_SCOPE_V1 as scope, compileSandboxDnsManifestV1, validateSandboxDnsManifestV1, runSandboxDnsFoundationV1 } from "../../../lib/deployments/execution/sandbox-dns-foundation-v1.ts";
import { createSandboxDnsAwsRuntimeV1 } from "./sandbox-dns-foundation-aws-v1.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=await realpath("F:/ChatGPT_workshop"),args=process.argv.slice(2),o={},equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
for(let i=0;i<args.length;i+=2){if(!["--mode","--out","--manifest","--approved-sha"].includes(args[i])||!args[i+1]||o[args[i]])throw Error("SANDBOX_DNS_OPTIONS_INVALID");o[args[i]]=args[i+1];}
const mode=o["--mode"],keys=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||!equal(Object.keys(o).sort(),keys.sort()))throw Error("SANDBOX_DNS_OPTIONS_INVALID");
const bounded=async p=>/^techlong-f3c1-dns-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(path.dirname(p))).toLowerCase()===privateRoot.toLowerCase();
const out=path.resolve(o["--out"]);if(!await bounded(out))throw Error("SANDBOX_DNS_PRIVATE_OUTPUT_REQUIRED");await mkdir(out);
const slot=path.join(privateRoot,scope.permanentSlot),save=async(name,value)=>{const b=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),b,{flag:"wx"});return sha256Hex(b);};let stage="LOCAL_CODE_BINDING";
try {
 const files=["lib/deployments/execution/sandbox-dns-foundation-v1.ts","lib/deployments/execution/hash.ts","ops/aws-sandbox/scripts/sandbox-dns-foundation-aws-v1.mjs","ops/aws-sandbox/scripts/review-sandbox-dns-foundation-v1.mjs","package.json","package-lock.json"],pins=[];
 for(const file of files)pins.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});const codeSha256=await sha256Hex(pins);await save("code-binding.json",{codeSha256,pins});
 let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}if(mode!=="Inspect"&&occupied)throw Error("SANDBOX_DNS_CONSUMED_SLOT_INSPECT_ONLY");
 const runtime=createSandboxDnsAwsRuntimeV1(out);let manifest;
 if(mode==="Review") {stage="READONLY_REVIEW";const i=await runtime.inventory(true);await save("read-only-inventory.json",i);manifest=await compileSandboxDnsManifestV1(i,Date.now(),codeSha256);
  const fileSha256=await save("review-manifest.json",manifest);console.log(JSON.stringify({mode,out,fileSha256,manifestSha256:manifest.manifestSha256,codeSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),sourcePermissions:i.permissionChecks,writeAttempts:0,approvalRequired:true,parentDelegationPerformed:false,paidCellCreated:false}));
 }else {const file=path.resolve(o["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!await bounded(path.dirname(file)))throw Error("SANDBOX_DNS_PRIVATE_MANIFEST_REQUIRED");manifest=JSON.parse(await readFile(file,"utf8"));await validateSandboxDnsManifestV1(manifest,codeSha256);
  if(occupied&&!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),manifest))throw Error("SANDBOX_DNS_SLOT_MANIFEST_DRIFT");let submitted=null;
  if(mode==="Run") {stage="APPROVED_ONCE_RUN";submitted=await runSandboxDnsFoundationV1(manifest,o["--approved-sha"],codeSha256,{now:Date.now,inventory:runtime.inventory,claimSlot:()=>mkdir(slot),marker:(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"}),
   createZoneOnce:()=>runtime.createZoneOnce(manifest),tagZoneOnce:z=>runtime.tagZoneOnce(manifest,z),requestCertificateOnce:z=>runtime.requestCertificateOnce(manifest,z),readCertificateValidation:runtime.readCertificateValidation,createValidationRecordsOnce:(z,a,r)=>runtime.createValidationRecordsOnce(manifest,z,a,r)});
   const fileSha256=await save("submission-receipt.json",submitted);console.log(JSON.stringify({mode,out,fileSha256,...submitted}));if(submitted.failureStage)process.exitCode=1;
  }
  stage="INDEPENDENT_READONLY_INSPECT";const readMarker=async name=>{try{return JSON.parse(await readFile(path.join(slot,name),"utf8"));}catch(e){if(e.code==="ENOENT")return null;throw e;}};
  const zone=await readMarker("zone-confirmed.json"),certificate=await readMarker("certificate-confirmed.json"),records=await readMarker("validation-records-reviewed.json"),recordConfirmation=await readMarker("validation-records-confirmed.json");
  const result=zone&&certificate&&records&&recordConfirmation?await runtime.inspect(manifest,zone,certificate.certificateArn,records):{foundationMetadataVerified:false,zone,certificateArn:certificate?.certificateArn??null,partialOrUncertainSubmission:true,writeAttempts:0,retryAuthorized:false};
  const fileSha256=await save("independent-inspect.json",result);console.log(JSON.stringify({mode:"Inspect",out,fileSha256,...result}));if(!result.foundationMetadataVerified)process.exitCode=1;
 }
}catch(e){const result={outcome:"SANDBOX_DNS_REVIEW_OR_RUN_UNVERIFIED",stage,failureCode:/^SANDBOX_DNS_[A-Z_]+$/.test(e.message??"")?e.message:"SANDBOX_DNS_OPERATION_UNVERIFIED",serviceErrorName:["CredentialsProviderError","ExpiredToken","ExpiredTokenException","AccessDenied","AccessDeniedException"].includes(e.name)?e.name:null,operation:e.dnsOperation??null,rawDiagnosticsWithheld:true,noAutomaticRollbackDeleteFillResetOrWriteRetry:true,paidCellCreated:false};await save("failure-diagnostic.json",result);console.error(JSON.stringify(result));process.exitCode=1;}
