import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { SEALED_BUSINESS_PREDECESSOR_V1 as pin, SEALED_BUSINESS_ARTIFACTS_V1 as artifacts, SEALED_BUSINESS_INSTALL_SCOPE_V1 as scope,
 compileBusinessInstallManifestV1, validateBusinessInstallManifestV1, runBusinessInstallV1 } from "../../../lib/deployments/execution/sealed-business-install-v1.ts";
import { createSealedBusinessInstallAwsRuntimeV1 } from "./sealed-business-install-aws-runtime-v1.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=await realpath("F:/ChatGPT_workshop"),args=process.argv.slice(2),o={},hash=b=>createHash("sha256").update(b).digest("hex"),equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
for(let i=0;i<args.length;i+=2){if(!["--mode","--out","--manifest","--approved-sha"].includes(args[i])||!args[i+1]||o[args[i]])throw Error("BUSINESS_INSTALL_OPTIONS_INVALID");o[args[i]]=args[i+1];}
const mode=o["--mode"],required=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||!equal(Object.keys(o).sort(),required.sort()))throw Error("BUSINESS_INSTALL_OPTIONS_INVALID");
const bounded=async p=>/^techlong-f3b3-business-install-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(path.dirname(p))).toLowerCase()===privateRoot.toLowerCase();
const out=path.resolve(o["--out"]);if(!await bounded(out))throw Error("BUSINESS_INSTALL_PRIVATE_OUTPUT_REQUIRED");await mkdir(out);
const slot=path.join(privateRoot,scope.permanentSlot),save=async(name,value)=>{const b=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),b,{flag:"wx"});return hash(b);};
let stage="LOCAL_IMMUTABLE_BINDING";
try {
 const readPinned=async(name,sha)=>{const b=await readFile(path.join(privateRoot,name));if(hash(b)!==sha)throw Error("BUSINESS_INSTALL_PREDECESSOR_FILE_DRIFT");return JSON.parse(b);};
 const receipt=await readPinned("techlong-f3b3-neon-sealed-invoke-20261011-r1-run/submission-receipt.json",pin.receiptFileSha256),inspect=await readPinned("techlong-f3b3-neon-sealed-invoke-20261011-r1-verify/independent-inspect.json",pin.inspectionFileSha256);
 if(receipt.outcome!=="NEON_INVOKE_SUBMITTED_REQUIRES_INSPECT")throw Error("BUSINESS_INSTALL_PREDECESSOR_OUTCOME_INVALID");
 if(receipt.invocationAttempts!==1||receipt.codeUpdates!==0||receipt.response?.outcome!=="NEON_SEALED_READONLY_PREFLIGHT_VERIFIED"||await sha256Hex(receipt.response)!==pin.responseSha256||
  inspect.outcome!=="NEON_INVOKE_READONLY_PREFLIGHT_AND_LOG_VERIFIED"||inspect.readProofVerified!==true||inspect.logs?.logMarkerVerified!==true||await sha256Hex(inspect.response)!==pin.responseSha256)throw Error("BUSINESS_INSTALL_PREDECESSOR_PROOF_INVALID");
 const policyReview=await readPinned("techlong-f3b3-sealed-drain-policy-20261011-r2/read-only-policy-review.json",pin.policyReviewFileSha256);
 if(!policyReview.kmsAndNegativeCasesVerified||policyReview.allCasesVerified!==false||policyReview.directSecretAllowCasesNotProved!==2||policyReview.iamWrites!==0)throw Error("BUSINESS_INSTALL_POLICY_REVIEW_DRIFT");
 const oldScript=await readFile(path.join(root,"ops/aws-sandbox/scripts/review-readonly-neon-sealed-invoke-v1.mjs"),"utf8"),legacyFiles=[...JSON.parse(oldScript.match(/const oldFiles=(\[[\s\S]*?\]);/)[1]),
  "ops/aws-sandbox/scripts/review-readonly-neon-sealed-invoke-v1.mjs","ops/aws-sandbox/scripts/neon-sealed-invoke-aws-runtime-v1.mjs","lib/deployments/execution/readonly-neon-sealed-invoke-v1.ts"],legacyPins=[];
 for(const file of legacyFiles)legacyPins.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});
 if(await sha256Hex(legacyPins)!==pin.invokeCodeBindingSha256)throw Error("BUSINESS_INSTALL_OLD_CODE_BINDING_DRIFT");
 const artifactDirectory=await realpath(path.join(privateRoot,"techlong-f3b3-sealed-runtime-v3-20261011-p1"));if(path.dirname(artifactDirectory).toLowerCase()!==privateRoot.toLowerCase())throw Error("BUSINESS_INSTALL_ARTIFACT_PATH_INVALID");
 const b=await readFile(path.join(artifactDirectory,"artifact-review.json")),report=JSON.parse(b);if(hash(b)!==pin.buildReportFileSha256||!report.reproducibleBuildVerified||!report.dependencyFreeStartupVerified||report.installationAuthorized!==false)throw Error("BUSINESS_INSTALL_ARTIFACT_REPORT_DRIFT");
 const zips=[];for(const a of artifacts){const file=await realpath(path.join(artifactDirectory,a.file));if(path.dirname(file).toLowerCase()!==artifactDirectory.toLowerCase())throw Error("BUSINESS_INSTALL_ARTIFACT_PATH_INVALID");
  const zip=await readFile(file),entry=report.artifacts.find(x=>`${x.kind}.zip`===a.file);if(hash(zip)!==a.zipSha256||zip.length!==a.zipBytes||entry?.zipSha256!==a.zipSha256||entry?.zipBytes!==a.zipBytes)throw Error("BUSINESS_INSTALL_ARTIFACT_BYTES_DRIFT");zips.push(zip);}
 for(const p of report.sourcePins){if(!/^(lib\/deployments\/execution|ops\/aws-sandbox\/(scripts|lambda))\/[A-Za-z0-9-]+\.(ts|mjs)$/.test(p.file)||hash(Buffer.from((await readFile(path.join(root,p.file),"utf8")).replace(/\r\n/g,"\n")))!==p.sha256)throw Error("BUSINESS_INSTALL_CANDIDATE_SOURCE_DRIFT");}
 if(hash(await readFile(path.join(root,"package-lock.json")))!==report.packageLockSha256)throw Error("BUSINESS_INSTALL_PACKAGE_LOCK_DRIFT");
 const bindingFiles=[...legacyFiles,...report.sourcePins.map(x=>x.file),"lib/deployments/execution/sealed-business-install-v1.ts","lib/deployments/execution/sealed-drain-iam-candidate-v3.ts","lib/deployments/execution/readonly-kms-read-repair-v1.ts",
  "ops/aws-sandbox/scripts/review-sealed-business-install-v1.mjs","ops/aws-sandbox/scripts/sealed-business-install-aws-runtime-v1.mjs","package.json","package-lock.json"],pins=[];
 for(const file of [...new Set(bindingFiles)].sort())pins.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});const codeSha256=await sha256Hex(pins);
 await save("code-binding.json",{codeSha256,pins,predecessor:pin});
 let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}if(mode!=="Inspect"&&occupied)throw Error("BUSINESS_INSTALL_PERMANENT_SLOT_INSPECT_ONLY");
 const runtime=createSealedBusinessInstallAwsRuntimeV1();let manifest;
 if(mode==="Review") {
  stage="READONLY_REVIEW";const inventory=await runtime.inventory(true);await save("read-only-inventory.json",inventory);
  manifest=await compileBusinessInstallManifestV1({inventory,now:Date.now(),codeSha256,artifactDirectory});const fileSha256=await save("review-manifest.json",manifest);
  console.log(JSON.stringify({mode,out,fileSha256,manifestSha256:manifest.manifestSha256,codeSha256,stableAnchorSha256:manifest.stableAnchorSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),approvalRequired:true,
   iamWrites:0,lambdaUpdates:0,lambdaInvocations:0,secretValuesRead:false,databaseConnected:false,businessInvocationAuthorized:false,slotConsumed:false}));
 }else {
  const file=path.resolve(o["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!await bounded(path.dirname(file)))throw Error("BUSINESS_INSTALL_PRIVATE_MANIFEST_REQUIRED");
  manifest=JSON.parse(await readFile(file,"utf8"));await validateBusinessInstallManifestV1(manifest,codeSha256);if(manifest.artifactDirectory!==artifactDirectory)throw Error("BUSINESS_INSTALL_ARTIFACT_DIRECTORY_DRIFT");
  if(occupied&&!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),manifest))throw Error("BUSINESS_INSTALL_SLOT_MANIFEST_DRIFT");
  let result=null;
  if(mode==="Run") {
   stage="APPROVED_ONCE_INSTALL";result=await runBusinessInstallV1(manifest,o["--approved-sha"],codeSha256,{now:Date.now,inventory:runtime.inventory,claimSlot:()=>mkdir(slot),
    marker:(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"}),createDefaultV3:s=>runtime.createDefaultV3(manifest,s),putDrainInline:s=>runtime.putDrainInline(manifest,s),
    updateCodeOnce:(i,s)=>runtime.updateCodeOnce(manifest,i,s,zips[i]),waitForReadyReadonly:(i,s)=>runtime.waitForReadyReadonly(manifest,i,s)});
   const fileSha256=await save("submission-receipt.json",result);console.log(JSON.stringify({mode,out,fileSha256,...result}));if(result.failureStage)process.exitCode=1;
  }
  stage="INDEPENDENT_READONLY_INSPECT";const inventory=await runtime.inventory(false),readyMarkers=[];
  if(occupied||result?.slotConsumed)for(const index of [0,1]){try{readyMarkers.push(JSON.parse(await readFile(path.join(slot,`code-${index}-ready.json`),"utf8")));}catch(e){if(e.code!=="ENOENT")throw e;}}
  const installationVerified=inventory.stableAnchorSha256===manifest.stableAnchorSha256&&inventory.state.drainBoundary==="v3"&&inventory.state.drainInline==="CANDIDATE"&&readyMarkers.length===2&&
   inventory.state.functions.every((f,i)=>f.code==="CANDIDATE"&&f.revisionId===readyMarkers[i].revisionId&&readyMarkers[i].zipSha256===artifacts[i].zipSha256&&readyMarkers[i].readyObservations===2);
  const inspected={outcome:installationVerified?"BUSINESS_CANDIDATE_INSTALLATION_METADATA_VERIFIED":"BUSINESS_CANDIDATE_INSTALLATION_NOT_VERIFIED_INSPECT_ONLY",inventory,installationVerified,lambdaInvocations:0,
   secretValuesRead:false,databaseConnected:false,businessInvocationAuthorized:false,ttlDeletionGrantInstalled:false,retryAuthorized:false,endToEndDeploymentVerified:false};
  const fileSha256=await save("independent-inspect.json",inspected);console.log(JSON.stringify({mode:"Inspect",out,fileSha256,...inspected}));if(!installationVerified)process.exitCode=1;
 }
}catch(e){const result={outcome:"BUSINESS_INSTALL_REVIEW_OR_EXECUTION_UNVERIFIED",stage,failureCode:/^BUSINESS_INSTALL_[A-Z_]+$/.test(e.message??"")?e.message:"BUSINESS_INSTALL_OPERATION_UNVERIFIED",
 serviceErrorName:["CredentialsProviderError","ExpiredToken","ExpiredTokenException","AccessDenied","AccessDeniedException","Throttling","ThrottlingException"].includes(e.name)?e.name:null,operation:e.installOperation??null,
 rawDiagnosticsWithheld:true,noAutomaticRollbackRevokeDeleteFillResetOrRetry:true,businessInvocationAuthorized:false};await save("failure-diagnostic.json",result);console.error(JSON.stringify(result));process.exitCode=1;}
