import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { NEON_INVOKE_PREDECESSOR_V1 as pin, NEON_SEALED_INVOKE_SCOPE_V1 as scope, compileNeonSealedInvokeManifestV1, validateNeonSealedInvokeManifestV1, runNeonSealedInvokeV1 } from "../../../lib/deployments/execution/readonly-neon-sealed-invoke-v1.ts";
import { validateNeonSealedUpdateManifestV1 } from "../../../lib/deployments/execution/readonly-neon-sealed-update-v1.ts";
import { validateNeonProbeResponseV1 } from "../../../lib/deployments/execution/readonly-neon-sealed-probe-v1.ts";
import { createNeonSealedInvokeAwsRuntimeV1 } from "./neon-sealed-invoke-aws-runtime-v1.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=await realpath("F:/ChatGPT_workshop"),o={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){if(!["--mode","--out","--manifest","--approved-sha"].includes(args[i])||!args[i+1]||o[args[i]])throw new Error("NEON_INVOKE_OPTIONS_INVALID");o[args[i]]=args[i+1];}
const mode=o["--mode"],keys=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||canonicalJson(Object.keys(o).sort())!==canonicalJson(keys.sort()))throw new Error("NEON_INVOKE_OPTIONS_INVALID");
const bounded=async p=>/^techlong-f3b3-neon-sealed-invoke-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(path.dirname(p))).toLowerCase()===privateRoot.toLowerCase();
const out=path.resolve(o["--out"]);if(!await bounded(out))throw new Error("NEON_INVOKE_PRIVATE_OUTPUT_REQUIRED");await mkdir(out);
const slot=path.join(privateRoot,scope.permanentSlot),hash=b=>createHash("sha256").update(b).digest("hex"),equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
const save=async(name,value)=>{const b=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),b,{flag:"wx"});return hash(b);};
let stage="LOCAL_PREDECESSOR_AND_BINDING";
try{
  const pins=async files=>{const result=[];for(const file of files)result.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});return result;};
  const oldFiles=["ops/aws-sandbox/scripts/review-readonly-kms-read-repair-v1.mjs","ops/aws-sandbox/scripts/readonly-kms-repair-aws-runtime.mjs","lib/deployments/execution/readonly-kms-read-repair-v1.ts",
    "lib/deployments/execution/readonly-runtime-iam-v1.ts","lib/deployments/execution/readonly-lambda-install-v1.ts","lib/deployments/execution/hash.ts","package.json","package-lock.json",
    "ops/aws-sandbox/scripts/review-readonly-neon-sealed-update-v1.mjs","ops/aws-sandbox/scripts/neon-sealed-update-aws-runtime-v1.mjs","ops/aws-sandbox/scripts/build-readonly-neon-sealed-probe-v1.mjs",
    "ops/aws-sandbox/lambda/readonly-neon-sealed-probe-v1.ts","lib/deployments/execution/readonly-neon-sealed-update-v1.ts","lib/deployments/execution/readonly-neon-sealed-probe-v1.ts",
    "lib/deployments/execution/readonly-neon-sealed-transport-v1.ts","lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts","lib/deployments/execution/sealed-plan-catalog-read-v1.ts"];
  if(await sha256Hex(await pins(oldFiles))!==pin.codeBindingSha256)throw new Error("NEON_INVOKE_PREDECESSOR_CODE_BINDING_DRIFT");
  const files=[...oldFiles,"ops/aws-sandbox/scripts/review-readonly-neon-sealed-invoke-v1.mjs","ops/aws-sandbox/scripts/neon-sealed-invoke-aws-runtime-v1.mjs","lib/deployments/execution/readonly-neon-sealed-invoke-v1.ts"],codeSha256=await sha256Hex(await pins(files));
  const oldSlot=path.join(privateRoot,"techlong-f3b3-readonly-neon-sealed-probe-v1-consumed"),approved=JSON.parse(await readFile(path.join(oldSlot,"approved-manifest.json"),"utf8"));
  await validateNeonSealedUpdateManifestV1(approved,pin.codeBindingSha256);if(approved.manifestSha256!==pin.approvedManifestSha256)throw new Error("NEON_INVOKE_PREDECESSOR_APPROVAL_DRIFT");
  const readPinned=async(name,expected)=>{const b=await readFile(path.join(privateRoot,name));if(hash(b)!==expected)throw new Error("NEON_INVOKE_PREDECESSOR_RECEIPT_DRIFT");return JSON.parse(b);};
  const receipt=await readPinned("techlong-f3b3-neon-sealed-review-20261011-r1-run/submission-receipt.json",pin.receiptFileSha256);
  const first=await readPinned("techlong-f3b3-neon-sealed-review-20261011-r1-run/independent-inspect.json",pin.firstInspectionFileSha256);
  const second=await readPinned("techlong-f3b3-neon-sealed-review-20261011-r1-verify/independent-inspect.json",pin.independentInspectionFileSha256);
  const confirmed=await readPinned("techlong-f3b3-readonly-neon-sealed-probe-v1-consumed/update-code-confirmed.json",pin.confirmedUpdateFileSha256);
  if(receipt.outcome!=="NEON_UPDATE_STOPPED_INSPECT_ONLY"||!receipt.slotConsumed||receipt.codeUpdates!==1||receipt.invocations!==0||receipt.response!==null||receipt.failureCode!=="NEON_UPDATE_POSTSTATE_DRIFT"||confirmed.zipSha256!==pin.installedZipSha256||
    [first,second].some(r=>r.inventory.state!=="CANDIDATE_READY"||r.inventory.revisionId!==pin.completedRevisionId||r.inventory.predecessorAnchorSha256!==pin.fullAnchorSha256||r.inventory.stableAnchorSha256!==pin.stableAnchorSha256||r.response!==null||r.readProofVerified!==false))throw new Error("NEON_INVOKE_PREDECESSOR_STATE_NOT_MATCHED");
  for(const name of ["invoke-attempt.json","invoke-response.json"]){try{await lstat(path.join(oldSlot,name));throw new Error("NEON_INVOKE_PREDECESSOR_CALL_MARKER_PRESENT");}catch(e){if(e.code!=="ENOENT")throw e;}}
  const artifactDirectory=await realpath(approved.artifactDirectory);if((await realpath(path.dirname(artifactDirectory))).toLowerCase()!==privateRoot.toLowerCase()||!/^techlong-f3b3-neon-sealed-artifacts-[a-z0-9-]+$/.test(path.basename(artifactDirectory)))throw new Error("NEON_INVOKE_ARTIFACT_PATH_INVALID");
  const reportBytes=await readFile(path.join(artifactDirectory,"artifact-review.json")),report=JSON.parse(reportBytes);
  if(hash(reportBytes)!==approved.artifactReportFileSha256||report.artifact.zipSha256!==pin.installedZipSha256||report.artifact.zipBytes!==pin.installedZipBytes)throw new Error("NEON_INVOKE_ARTIFACT_REPORT_DRIFT");
  const zipPath=await realpath(path.join(artifactDirectory,"ttl-neon.zip"));if(path.dirname(zipPath).toLowerCase()!==artifactDirectory.toLowerCase())throw new Error("NEON_INVOKE_ARTIFACT_PATH_INVALID");
  const zip=await readFile(zipPath);if(hash(zip)!==pin.installedZipSha256||zip.length!==pin.installedZipBytes)throw new Error("NEON_INVOKE_ARTIFACT_BYTES_DRIFT");
  for(const p of report.sourcePins){if(!/^(lib\/deployments\/execution|ops\/aws-sandbox\/(scripts|lambda))\/[A-Za-z0-9-]+\.(ts|mjs)$/.test(p.file)||await sha256Hex((await readFile(path.join(root,p.file),"utf8")).replace(/\r\n/g,"\n"))!==p.sha256)throw new Error("NEON_INVOKE_INSTALLED_SOURCE_DRIFT");}
  const oldInstallManifest=JSON.parse(await readFile(path.join(privateRoot,"techlong-f3b3-readonly-lambda-20261008-r5/review-manifest.json"),"utf8")),oldInstallScript=await readFile(path.join(root,"ops/aws-sandbox/scripts/review-readonly-lambda-install-v1.mjs"),"utf8");
  if(oldInstallManifest.manifestSha256!=="e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e"||await sha256Hex(await pins(JSON.parse(oldInstallScript.match(/const bindingFiles=(\[[\s\S]*?\]);/)[1])))!==oldInstallManifest.codeSha256)throw new Error("NEON_INVOKE_ORIGINAL_INSTALL_BINDING_DRIFT");
  let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}if(mode!=="Inspect"&&occupied)throw new Error("NEON_INVOKE_PERMANENT_SLOT_INSPECT_ONLY");
  const runtime=createNeonSealedInvokeAwsRuntimeV1(oldInstallManifest);let manifest;
  if(mode==="Review"){
    stage="READONLY_REVIEW";const inventory=await runtime.inventory(true);await save("read-only-inventory.json",inventory);
    manifest=await compileNeonSealedInvokeManifestV1({inventory,now:Date.now(),codeSha256,nonce:randomBytes(32).toString("hex")});
    if(manifest.event.nonce===approved.event.nonce)throw new Error("NEON_INVOKE_NONCE_COLLISION");
    const fileSha256=await save("review-manifest.json",manifest);console.log(JSON.stringify({mode,out,fileSha256,manifestSha256:manifest.manifestSha256,codeSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),approvalRequired:true,codeUpdates:0,lambdaInvocations:0,databaseConnected:false,runtimeEnabled:false}));
  }else{
    const file=path.resolve(o["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!await bounded(path.dirname(file)))throw new Error("NEON_INVOKE_PRIVATE_MANIFEST_REQUIRED");
    manifest=JSON.parse(await readFile(file,"utf8"));await validateNeonSealedInvokeManifestV1(manifest,codeSha256);
    if(manifest.event.nonce===approved.event.nonce)throw new Error("NEON_INVOKE_NONCE_COLLISION");
    if(occupied&&!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),manifest))throw new Error("NEON_INVOKE_SLOT_MANIFEST_DRIFT");
    if(mode==="Run"){
      stage="APPROVED_ONCE_INVOKE";const result=await runNeonSealedInvokeV1({manifest,approvedSha:o["--approved-sha"],codeSha256,ports:{now:Date.now,inventory:()=>runtime.inventory(true),claimSlot:()=>mkdir(slot),
        marker:(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"}),invokeOnce:()=>runtime.invokeOnce(manifest)}});
      const fileSha256=await save("submission-receipt.json",result);console.log(JSON.stringify({mode,out,fileSha256,...result}));if(result.failureStage)process.exitCode=1;
    }
    stage="INDEPENDENT_READONLY_INSPECT";const inventory=await runtime.inventory(false);let response=null;
    try{response=validateNeonProbeResponseV1(manifest.event,JSON.parse(await readFile(path.join(slot,"invoke-response.json"),"utf8")));}catch(e){if(e.code!=="ENOENT")throw e;}
    const logs=response?await runtime.logProof(manifest,response):{logMarkerVerified:false};
    const readProofVerified=inventory.predecessorAnchorSha256===manifest.fullAnchorSha256&&inventory.revisionId===manifest.completedRevisionId&&response?.outcome==="NEON_SEALED_READONLY_PREFLIGHT_VERIFIED"&&logs.logMarkerVerified;
    const result={outcome:readProofVerified?"NEON_INVOKE_READONLY_PREFLIGHT_AND_LOG_VERIFIED":"NEON_INVOKE_READONLY_PREFLIGHT_NOT_VERIFIED",inventory,response,logs,readProofVerified,
      sourceGate:response?.proof?.sourceGate??null,codeUpdates:0,productionDrainBusinessCompatibilityProved:false,authorityWriteAuthorized:false,deletionAuthorized:false,retryAuthorized:false,runtimeEnabled:false};
    const fileSha256=await save("independent-inspect.json",result);console.log(JSON.stringify({mode:"Inspect",out,fileSha256,...result}));if(!readProofVerified)process.exitCode=1;
  }
}catch(error){const result={outcome:"NEON_INVOKE_REVIEW_OR_EXECUTION_NOT_VERIFIED",stage,failureCode:/^NEON_(INVOKE|UPDATE|PROBE)_[A-Z_]+$/.test(error.message??"")?error.message:"NEON_INVOKE_OPERATION_UNVERIFIED",
  serviceErrorName:["CredentialsProviderError","ExpiredToken","ExpiredTokenException","AccessDenied","AccessDeniedException","Throttling","ThrottlingException"].includes(error.name)?error.name:null,
  rawDiagnosticsWithheld:true,noAutomaticRollbackOrInvocationRetry:true,runtimeEnabled:false};await save("failure-diagnostic.json",result);console.error(JSON.stringify(result));process.exitCode=1;}
