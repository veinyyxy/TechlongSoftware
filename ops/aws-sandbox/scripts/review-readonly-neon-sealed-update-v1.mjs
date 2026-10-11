import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sha256Hex, canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { compileNeonSealedUpdateManifestV1, validateNeonSealedUpdateManifestV1, runNeonSealedUpdateV1, NEON_SEALED_UPDATE_SCOPE_V1 as scope } from "../../../lib/deployments/execution/readonly-neon-sealed-update-v1.ts";
import { validateNeonProbeResponseV1 } from "../../../lib/deployments/execution/readonly-neon-sealed-probe-v1.ts";
import { createNeonSealedUpdateAwsRuntimeV1 } from "./neon-sealed-update-aws-runtime-v1.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=await realpath("F:/ChatGPT_workshop"),args=process.argv.slice(2),o={};
for(let i=0;i<args.length;i+=2){if(!["--mode","--out","--artifacts","--manifest","--approved-sha"].includes(args[i])||!args[i+1]||o[args[i]])throw new Error("NEON_UPDATE_OPTIONS_INVALID");o[args[i]]=args[i+1];}
const mode=o["--mode"],keys=mode==="Review"?["--mode","--out","--artifacts"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||canonicalJson(Object.keys(o).sort())!==canonicalJson(keys.sort()))throw new Error("NEON_UPDATE_OPTIONS_INVALID");
const bounded=async(p,pattern)=>pattern.test(path.basename(p))&&(await realpath(path.dirname(p))).toLowerCase()===privateRoot.toLowerCase();
const outputPattern=/^techlong-f3b3-neon-sealed-review-[a-z0-9-]+$/,artifactPattern=/^techlong-f3b3-neon-sealed-artifacts-[a-z0-9-]+$/;
const out=path.resolve(o["--out"]);if(!await bounded(out,outputPattern))throw new Error("NEON_UPDATE_PRIVATE_OUTPUT_REQUIRED");await mkdir(out);
const hash=b=>createHash("sha256").update(b).digest("hex"),equal=(a,b)=>canonicalJson(a)===canonicalJson(b),slot=path.join(privateRoot,scope.permanentSlot);
const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),bytes,{flag:"wx"});return hash(bytes);};
let stage="LOCAL_PREDECESSOR_AND_CODE_BINDING";
try{
 const oldManifest=JSON.parse(await readFile(path.join(privateRoot,"techlong-f3b3-readonly-lambda-20261008-r5/review-manifest.json"),"utf8"));
 const inspectionBytes=await readFile(path.join(privateRoot,"techlong-f3b3-readonly-kms-repair-20261011-r3-verify/independent-inspect.json"));
 if(hash(inspectionBytes)!=="7a7ac97a3f6fbd69dee36e24d8e2f9c6947fe4b1132b126284c9002f31e888dd")throw new Error("NEON_UPDATE_PREDECESSOR_INSPECT_DRIFT");
 const predecessor=JSON.parse(inspectionBytes);if(!predecessor.liveReadProofVerified||!predecessor.iamRepairVerified)throw new Error("NEON_UPDATE_PREDECESSOR_NOT_VERIFIED");
 const receipt=await readFile(path.join(privateRoot,"techlong-f3b3-readonly-kms-repair-20261011-r3-run/submission-receipt.json"));
 if(hash(receipt)!=="90987b5460a21dea2affba831078b856e9874d67fa286f77d2d17c329cf0325c")throw new Error("NEON_UPDATE_PREDECESSOR_RECEIPT_DRIFT");
 const priorApproval=JSON.parse(await readFile(path.join(privateRoot,"techlong-f3b3-readonly-kms-read-repair-v1-consumed/approved-manifest.json"),"utf8"));
 if(priorApproval.manifestSha256!=="5d1485cf6d9a36bee3da8546124c2d02cf99339c02dfe47aa0e9ceefc47baca6")throw new Error("NEON_UPDATE_PREDECESSOR_SLOT_DRIFT");
 const kmsFiles=["ops/aws-sandbox/scripts/review-readonly-kms-read-repair-v1.mjs","ops/aws-sandbox/scripts/readonly-kms-repair-aws-runtime.mjs","lib/deployments/execution/readonly-kms-read-repair-v1.ts",
   "lib/deployments/execution/readonly-runtime-iam-v1.ts","lib/deployments/execution/readonly-lambda-install-v1.ts","lib/deployments/execution/hash.ts","package.json","package-lock.json"];
 const pins=async files=>{const p=[];for(const file of files)p.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});return p;};
 if(await sha256Hex(await pins(kmsFiles))!=="f382bda1dd4e7401f485e95941cbae64a0956220de1d2e5d30a5cdf1e3be2222")throw new Error("NEON_UPDATE_ORIGINAL_KMS_CODE_DRIFT");
 const originalScript=await readFile(path.join(root,"ops/aws-sandbox/scripts/review-readonly-lambda-install-v1.mjs"),"utf8");
 if(await sha256Hex(await pins(JSON.parse(originalScript.match(/const bindingFiles=(\[[\s\S]*?\]);/)[1])))!==oldManifest.codeSha256||oldManifest.manifestSha256!=="e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e")throw new Error("NEON_UPDATE_ORIGINAL_LAMBDA_CODE_DRIFT");
 const files=[...kmsFiles,"ops/aws-sandbox/scripts/review-readonly-neon-sealed-update-v1.mjs","ops/aws-sandbox/scripts/neon-sealed-update-aws-runtime-v1.mjs","ops/aws-sandbox/scripts/build-readonly-neon-sealed-probe-v1.mjs",
   "ops/aws-sandbox/lambda/readonly-neon-sealed-probe-v1.ts","lib/deployments/execution/readonly-neon-sealed-update-v1.ts","lib/deployments/execution/readonly-neon-sealed-probe-v1.ts",
   "lib/deployments/execution/readonly-neon-sealed-transport-v1.ts","lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts","lib/deployments/execution/sealed-plan-catalog-read-v1.ts"],codeSha256=await sha256Hex(await pins(files));
 let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}if(mode!=="Inspect"&&occupied)throw new Error("NEON_UPDATE_PERMANENT_SLOT_INSPECT_ONLY");
 let m;if(mode!=="Review"){
   const file=path.resolve(o["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!await bounded(path.dirname(file),outputPattern))throw new Error("NEON_UPDATE_PRIVATE_MANIFEST_REQUIRED");
   m=JSON.parse(await readFile(file,"utf8"));await validateNeonSealedUpdateManifestV1(m,codeSha256);
   if(occupied&&!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),m))throw new Error("NEON_UPDATE_SLOT_MANIFEST_DRIFT");
 }
 const artifactDirectory=await realpath(path.resolve(mode==="Review"?o["--artifacts"]:m.artifactDirectory));
 if(!await bounded(artifactDirectory,artifactPattern))throw new Error("NEON_UPDATE_PRIVATE_ARTIFACT_REQUIRED");
 const reportBytes=await readFile(path.join(artifactDirectory,"artifact-review.json")),report=JSON.parse(reportBytes),a=report.artifact;
 if(report.protocol!=="neon-sealed-readonly-artifacts-v1"||report.schemaVersion!==1||!report.reproducibleBuildVerified||!report.dependencyFreeStartupVerified||!report.invalidEventRejectedBeforeCredentials||
   report.mutationRuntimeLinked!==false||report.cloudMutationPerformed!==false||report.databaseConnected!==false||report.installationAuthorized!==false||hash(await readFile(path.join(root,"package-lock.json")))!==report.packageLockSha256||
   report.esbuildVersion!=="0.28.0"||report.zipBuilderVersion!=="0.7.4"||!Array.isArray(report.sourcePins)||report.sourcePins.length<5)throw new Error("NEON_UPDATE_ARTIFACT_REPORT_INVALID");
 for(const p of report.sourcePins){if(!/^(lib\/deployments\/execution|ops\/aws-sandbox\/(scripts|lambda))\/[A-Za-z0-9-]+\.(ts|mjs)$/.test(p.file)||await sha256Hex((await readFile(path.join(root,p.file),"utf8")).replace(/\r\n/g,"\n"))!==p.sha256)throw new Error("NEON_UPDATE_ARTIFACT_SOURCE_DRIFT");}
 const zipPath=await realpath(path.join(artifactDirectory,"ttl-neon.zip"));if(path.dirname(zipPath).toLowerCase()!==artifactDirectory.toLowerCase())throw new Error("NEON_UPDATE_ARTIFACT_PATH_INVALID");
 const zip=await readFile(zipPath);if(hash(zip)!==a.zipSha256||zip.length!==a.zipBytes||a.file!=="ttl-neon.zip"||a.handler!=="index.handler"||a.runtime!=="nodejs22.x"||a.architecture!=="x86_64")throw new Error("NEON_UPDATE_ARTIFACT_BYTES_DRIFT");
 const artifact={zipSha256:a.zipSha256,zipBytes:a.zipBytes,bundleSha256:a.bundleSha256,file:"ttl-neon.zip"},runtime=createNeonSealedUpdateAwsRuntimeV1(oldManifest,artifact);
 if(mode==="Review"){
   stage="READONLY_REVIEW";const inventory=await runtime.inventory(false,true);await save("read-only-inventory.json",inventory);
   if(inventory.predecessorAnchorSha256!==predecessor.inventory.anchorSha256)throw new Error("NEON_UPDATE_PREDECESSOR_ANCHOR_DRIFT");
   m=await compileNeonSealedUpdateManifestV1({inventory,now:Date.now(),codeSha256,artifactDirectory,artifactReportFileSha256:hash(reportBytes),artifact,nonce:randomBytes(32).toString("hex")});
   const fileSha256=await save("review-manifest.json",m);console.log(JSON.stringify({mode,out,manifestSha256:m.manifestSha256,fileSha256,codeSha256,expiresAt:new Date(m.expiresAt).toISOString(),
     approvalRequired:true,codeUpdates:0,lambdaInvocations:0,databaseConnected:false,runtimeEnabled:false}));
 }else{
   if(m.artifactDirectory!==artifactDirectory||m.artifactReportFileSha256!==hash(reportBytes)||!equal(m.artifact,artifact))throw new Error("NEON_UPDATE_MANIFEST_ARTIFACT_DRIFT");
   if(mode==="Run"){
     stage="APPROVED_UPDATE_AND_ONE_READ";let revision;
     const r=await runNeonSealedUpdateV1(m,o["--approved-sha"],codeSha256,{now:Date.now,inventory:candidateCode=>runtime.inventory(candidateCode,!candidateCode),claimSlot:()=>mkdir(slot),
       marker:(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"}),updateCodeOnce:async()=>{const x=await runtime.updateCodeOnce(m,zip);revision=x.revisionId;return x;},
       waitForReadyReadonly:()=>runtime.waitForReadyReadonly(m),invokeOnce:()=>runtime.invokeOnce(m,revision)});
     const fileSha256=await save("submission-receipt.json",r);console.log(JSON.stringify({mode,out,fileSha256,...r}));if(r.failureStage)process.exitCode=1;
   }
   stage="INDEPENDENT_READONLY_INSPECT";let inventory;try{inventory=await runtime.inventory(true,false);}catch{inventory=await runtime.inventory(false,false);}
   let response=null;try{response=validateNeonProbeResponseV1(m.event,JSON.parse(await readFile(path.join(slot,"invoke-response.json"),"utf8")));}catch(e){if(e.code!=="ENOENT")throw e;}
   const logs=response?await runtime.logProof(m,response):{logMarkerVerified:false};
   const readProofVerified=inventory.state==="CANDIDATE_READY"&&inventory.stableAnchorSha256===m.stableAnchorSha256&&response?.outcome==="NEON_SEALED_READONLY_PREFLIGHT_VERIFIED"&&logs.logMarkerVerified;
   const result={outcome:readProofVerified?"NEON_SEALED_READONLY_PREFLIGHT_AND_LOG_VERIFIED":"NEON_SEALED_READONLY_PREFLIGHT_NOT_VERIFIED",inventory,response,logs,readProofVerified,
     sourceGate:response?.proof?.sourceGate??null,productionDrainBusinessCompatibilityProved:false,authorityWriteAuthorized:false,deletionAuthorized:false,retryAuthorized:false,runtimeEnabled:false};
   const fileSha256=await save("independent-inspect.json",result);console.log(JSON.stringify({mode:"Inspect",out,fileSha256,...result}));if(!readProofVerified)process.exitCode=1;
 }
}catch(error){const diagnostic={outcome:"NEON_UPDATE_REVIEW_OR_EXECUTION_NOT_VERIFIED",stage,
 failureCode:/^NEON_(UPDATE|PROBE)_[A-Z_]+$/.test(error.message??"")?error.message:"NEON_UPDATE_OPERATION_UNVERIFIED",
 serviceErrorName:["CredentialsProviderError","ExpiredToken","ExpiredTokenException","AccessDenied","AccessDeniedException","Throttling","ThrottlingException"].includes(error.name)?error.name:null,
 rawDiagnosticsWithheld:true,noAutomaticWriteInvocationRetry:true,runtimeEnabled:false};await save("failure-diagnostic.json",diagnostic);console.error(JSON.stringify(diagnostic));process.exitCode=1;}
