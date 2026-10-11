import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { sha256Hex, canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { compileKmsRepairManifestV1, validateKmsRepairManifestV1, runKmsReadRepairV1, READONLY_KMS_REPAIR_SCOPE_V1 as scope } from "../../../lib/deployments/execution/readonly-kms-read-repair-v1.ts";
import { validateReadonlyLambdaManifestV1, validateReadonlyProbeResponseV1 } from "../../../lib/deployments/execution/readonly-lambda-install-v1.ts";
import { createKmsRepairAwsRuntimeV1 } from "./readonly-kms-repair-aws-runtime.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=await realpath("F:/ChatGPT_workshop"),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!["--mode","--out","--manifest","--approved-sha"].includes(args[i])||!args[i+1]||options[args[i]])throw new Error("KMS_REPAIR_OPTIONS_INVALID");options[args[i]]=args[i+1];}
const mode=options["--mode"],out=path.resolve(options["--out"]??"");
const bounded=async p=>/^techlong-f3b3-readonly-kms-repair-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(path.dirname(p))).toLowerCase()===privateRoot.toLowerCase();
if(!["Review","Run","Inspect"].includes(mode)||!await bounded(out))throw new Error("KMS_REPAIR_FRESH_PRIVATE_OUTPUT_REQUIRED");
const slot=path.join(privateRoot,scope.permanentSlot),shaBytes=b=>createHash("sha256").update(b).digest("hex"),equal=(a,b)=>canonicalJson(a)===canonicalJson(b);
let stage="LOCAL_PREDECESSOR",slotConsumed=false;await mkdir(out);
const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),bytes,{flag:"wx"});return shaBytes(bytes);};
try{
  const oldManifest=JSON.parse(await readFile(path.join(privateRoot,"techlong-f3b3-readonly-lambda-20261008-r5/review-manifest.json"),"utf8"));
  if(oldManifest.manifestSha256!=="e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e")throw new Error("KMS_REPAIR_PREDECESSOR_MANIFEST_DRIFT");
  await validateReadonlyLambdaManifestV1(oldManifest,oldManifest.codeSha256);
  const oldReceiptBytes=await readFile(path.join(privateRoot,"techlong-f3b3-readonly-lambda-20261008-r5-run/submission-receipt.json"));
  if(shaBytes(oldReceiptBytes)!=="020fdb1cbefacc3af98bf344d7c5cad826f388f7149330ad919efc6b9e6a2c2d")throw new Error("KMS_REPAIR_PREDECESSOR_RECEIPT_DRIFT");
  const oldReceipt=JSON.parse(oldReceiptBytes);
  if(!oldReceipt.slotConsumed||oldReceipt.installationCalls!==6||oldReceipt.invocationCalls!==2||oldReceipt.failureStage!==null||oldReceipt.probeReceipts?.some(r=>r.outcome!=="READONLY_PROBE_READS_NOT_VERIFIED"))throw new Error("KMS_REPAIR_PREDECESSOR_NOT_MATCHED");
  const oldSlot=path.join(privateRoot,"techlong-f3b3-readonly-lambda-install-v1-consumed");
  if(!equal(JSON.parse(await readFile(path.join(oldSlot,"approved-manifest.json"),"utf8")),oldManifest))throw new Error("KMS_REPAIR_PREDECESSOR_SLOT_DRIFT");
  const oldScript=await readFile(path.join(root,"ops/aws-sandbox/scripts/review-readonly-lambda-install-v1.mjs"),"utf8"),oldFiles=JSON.parse(oldScript.match(/const bindingFiles=(\[[\s\S]*?\]);/)[1]),oldPins=[];
  for(const file of oldFiles)oldPins.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});
  if(await sha256Hex(oldPins)!==oldManifest.codeSha256)throw new Error("KMS_REPAIR_ORIGINAL_CODE_BINDING_DRIFT");
  const files=["ops/aws-sandbox/scripts/review-readonly-kms-read-repair-v1.mjs","ops/aws-sandbox/scripts/readonly-kms-repair-aws-runtime.mjs",
    "lib/deployments/execution/readonly-kms-read-repair-v1.ts","lib/deployments/execution/readonly-runtime-iam-v1.ts","lib/deployments/execution/readonly-lambda-install-v1.ts",
    "lib/deployments/execution/hash.ts","package.json","package-lock.json"],pins=[];
  for(const file of files)pins.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});const codeSha256=await sha256Hex(pins);
  let occupied=true;try{await lstat(slot);}catch(e){if(e.code==="ENOENT")occupied=false;else throw e;}
  if(mode!=="Inspect"&&occupied)throw new Error("KMS_REPAIR_PERMANENT_SLOT_OCCUPIED_INSPECT_ONLY");
  const runtime=createKmsRepairAwsRuntimeV1(oldManifest);let manifest;
  if(mode==="Review"){
    stage="READONLY_KMS_SIMULATIONS";const cases=await runtime.simulateKmsPolicies();await save("policy-simulation.json",{cases,simulationOnly:true,lambdaInvocations:0,iamWrites:0});
    if(cases.some(x=>!x.verified))throw new Error("KMS_REPAIR_POLICY_CASE_NOT_VERIFIED");
    stage="READONLY_REVIEW";const inventory=await runtime.inventory();await save("read-only-inventory.json",inventory);
    manifest=await compileKmsRepairManifestV1({inventory,codeSha256,now:Date.now(),events:[0,1].map(()=>({schemaVersion:1,action:"verify_readonly_runtime_v1",nonce:randomBytes(32).toString("hex")}))});
    const fileSha256=await save("review-manifest.json",manifest);console.log(JSON.stringify({mode,out,fileSha256,manifestSha256:manifest.manifestSha256,codeSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),
      policySimulationCases:cases.length,approvalRequired:true,iamWrites:0,lambdaInvocations:0,runtimeEnabled:false}));
  }else{
    const file=path.resolve(options["--manifest"]??"");if(path.basename(file)!=="review-manifest.json"||!await bounded(path.dirname(file)))throw new Error("KMS_REPAIR_PRIVATE_MANIFEST_REQUIRED");
    manifest=JSON.parse(await readFile(file,"utf8"));await validateKmsRepairManifestV1(manifest,codeSha256);
    if(mode==="Inspect"&&occupied&&!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),manifest))throw new Error("KMS_REPAIR_SLOT_MANIFEST_DRIFT");
    if(mode==="Run"){
      stage="APPROVED_FOUR_IAM_WRITES_TWO_NEW_PROBES";
      const receipt=await runKmsReadRepairV1({manifest,approvedSha:options["--approved-sha"],codeSha256,ports:{now:Date.now,inventory:()=>runtime.inventory(),claimSlot:()=>mkdir(slot),
        marker:(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"}),createDefaultV2:(i,doc)=>runtime.createDefaultV2(manifest,i,doc),
        putInline:(i,doc)=>runtime.putInline(manifest,i,doc),waitForPropagation:()=>new Promise(r=>setTimeout(r,20000)),invokeOnce:runtime.invokeOnce}});
      slotConsumed=receipt.slotConsumed;const fileSha256=await save("submission-receipt.json",receipt);console.log(JSON.stringify({mode,out,fileSha256,...receipt}));if(receipt.failureStage)process.exitCode=1;
    }
    stage="INDEPENDENT_READONLY_INSPECT";const inventory=await runtime.inventory(false),probes=[];
    for(let i=0;i<2;i++){let response=null;try{response=JSON.parse(await readFile(path.join(slot,`invoke-${i}-response.json`),"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}
      if(response)response=validateReadonlyProbeResponseV1(i,manifest.events[i],response);
      probes.push({index:i,responsePresent:!!response,readsVerified:response?.outcome==="READONLY_PROBE_READS_VERIFIED",...(response?await runtime.logProof(i,manifest.events[i],response):{logMarkerVerified:false})});
    }
    const iamRepairVerified=inventory.anchorSha256===manifest.anchorSha256&&inventory.states.every(s=>s.boundary==="OWN_V2"&&s.inline==="OWN_REPAIRED");
    const result={outcome:iamRepairVerified&&probes.every(p=>p.readsVerified&&p.logMarkerVerified)?"KMS_REPAIR_SECRET_READS_AND_LOGS_VERIFIED":"KMS_REPAIR_PARTIAL_OR_LIVE_READ_NOT_VERIFIED",
      inventory,probes,iamRepairVerified,liveReadProofVerified:iamRepairVerified&&probes.every(p=>p.readsVerified&&p.logMarkerVerified),
      productionCfExistingResourceReadProved:false,drainSealedV3BusinessCompatibilityProved:false,databaseConnected:false,mutationGrantAuthorized:false,retryAuthorized:false,runtimeEnabled:false};
    const fileSha256=await save("independent-inspect.json",result);console.log(JSON.stringify({mode:"Inspect",out,fileSha256,...result}));if(!result.liveReadProofVerified)process.exitCode=1;
  }
}catch(error){const diagnostic={outcome:"KMS_READ_REPAIR_REVIEW_OR_EXECUTION_NOT_VERIFIED",stage,slotConsumed,
  failureCode:/^KMS_REPAIR_[A-Z_]+$/.test(error.message??"")?error.message:"KMS_REPAIR_OPERATION_UNVERIFIED",
  serviceErrorName:["CredentialsProviderError","ExpiredToken","ExpiredTokenException","AccessDenied","AccessDeniedException","Throttling","ThrottlingException","TooManyRequestsException","NoSuchEntity","InvalidInput"].includes(error.name)?error.name:null,
  operation:/^(?:[A-Za-z]+Command|(?:lambda|logs|kms|secretsmanager):[a-z-]+)$/.test(error.repairOperation??"")?error.repairOperation:null,
  httpStatus:Number.isInteger(error.$metadata?.httpStatusCode)?error.$metadata.httpStatusCode:null,cliJsonError:error.cliJsonError??false,processExitCode:error.processExitCode??null,rawDiagnosticsWithheld:true,noWriteInvocationRetry:true,runtimeEnabled:false};
  await save("failure-diagnostic.json",diagnostic);console.error(JSON.stringify(diagnostic));process.exitCode=1;}
