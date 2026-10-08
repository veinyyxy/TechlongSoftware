// Explicit operator CLI, not a migration hook or runtime activation path.
import { Client } from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readSealedPlanManagementStateV1, compileSealedPlanManagementReviewV1,
  validateSealedPlanManagementApprovalV1, validateSealedPlanManagementReviewIntegrityV1, runReviewedSealedPlanMutationV1,
  verifySealedPlanManagementPoststateV1 } from "../../../lib/deployments/execution/sealed-plan-management-v1.ts";

const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith("--")||!args[i+1]||options[args[i]])throw new Error("SEALED_MANAGEMENT_ARGUMENTS_INVALID");options[args[i]]=args[i+1];}
const modes=["ReviewInstall","ReviewRegistration","RunInstall","RunRegistration","VerifyInstall","VerifyRegistration"];
const mode=options["--mode"], phase=mode?.endsWith("Install")?"install":"register";
const reviewMode=mode?.startsWith("Review"), runMode=mode?.startsWith("Run");
const allowed=reviewMode?["--mode","--out"]:runMode?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!modes.includes(mode)||canonicalJson(Object.keys(options).sort())!==canonicalJson(allowed.sort()))throw new Error("SEALED_MANAGEMENT_ARGUMENTS_INVALID");
const output=path.resolve(options["--out"]), privateRoot=path.resolve("F:/ChatGPT_workshop");
if(path.dirname(output).toLowerCase()!==privateRoot.toLowerCase()||!/^techlong-f3b3-sealed-management-[a-z0-9-]+$/.test(path.basename(output)))throw new Error("SEALED_MANAGEMENT_PRIVATE_OUTPUT_REQUIRED");
const root=fileURLToPath(new URL("../../../",import.meta.url));
let activeClient;
try {
  const codeFiles=["ops/aws-sandbox/scripts/review-f3b3-sealed-management.mjs","lib/deployments/execution/sealed-plan-management-v1.ts",
    "lib/deployments/execution/sealed-plan-catalog-read-v1.ts","lib/deployments/execution/hash.ts"];
  const codeHashes=[];
  for(const file of codeFiles)codeHashes.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});
  const candidate=(await readFile(path.join(root,"ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql"),"utf8")).replace(/\r\n/g,"\n");
  const raw=process.env.DATABASE_URL, url=raw?new URL(raw):null;
  if(!url||!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||!url.username||!url.password||
    (url.port&&url.port!=="5432")||!["require","verify-full"].includes(url.searchParams.get("sslmode"))||
    !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.hash||[...url.searchParams.keys()].some(k=>!["sslmode","channel_binding"].includes(k)))
    throw new Error("SEALED_MANAGEMENT_NEON_TLS_TARGET_REQUIRED");
  const user=decodeURIComponent(url.username),database=decodeURIComponent(url.pathname.slice(1));
  const binding={targetFingerprintSha256:await sha256Hex({protocol:"neon-sealed-management-target-v1",host:url.hostname,port:5432,database,user}),
    managementCodeSha256:await sha256Hex(codeHashes)};
  const connect=async()=>{
    const client=new Client({host:url.hostname,port:5432,user,password:decodeURIComponent(url.password),database,
      ssl:{rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,connectionTimeoutMillis:10000,
      statement_timeout:30000,query_timeout:35000,application_name:"techlong-sealed-plan-management-v1"});
    client.on("error",()=>undefined);await client.connect();return client;
  };
  const readonly=async()=>{
    activeClient=await connect();
    try{await activeClient.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
      await activeClient.query("SET LOCAL search_path=pg_catalog");
      const result=await readSealedPlanManagementStateV1(activeClient);
      if(result.state.identity.role!==user||result.state.identity.database!==database)throw new Error("SEALED_MANAGEMENT_SQL_TARGET_MISMATCH");
      await activeClient.query("COMMIT");return result;
    }finally{await activeClient.end().catch(()=>undefined);activeClient=null;}
  };
  await mkdir(output); // Fresh output only; never overwrite prior evidence.
  const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(output,name),bytes,{flag:"wx"});return sha256Hex(bytes);};
  if(reviewMode){
    const startedAt=Date.now(), readback=await readonly();
    await save("private-preimage.json",readback.privatePreimage);
    await save("read-only-preflight.json",{...readback,privatePreimage:undefined,binding,databaseMutationPerformed:false});
    const review=await compileSealedPlanManagementReviewV1({phase,binding,readback,candidateSql:candidate,startedAt,now:Date.now()});
    const fileSha256=await save("review-manifest.json",review);
    console.log(JSON.stringify({mode,phase,outcome:"FRESH_REVIEW_REQUIRES_SEPARATE_HUMAN_APPROVAL",output,manifestSha256:review.manifestSha256,fileSha256,
      expiresAt:new Date(review.expiresAt).toISOString(),readerRolePresent:readback.state.roles.some(r=>r.name==="techlong_cell_cleanup_reader"),
      protectedTableOwners:[...new Set(readback.state.tables.map(t=>t.owner))],databaseMutationPerformed:false,registrationPerformed:false,runtimeEnabled:false}));
  }else{
    const manifestPath=path.resolve(options["--manifest"]);
    if(path.extname(manifestPath)!==".json"||!path.dirname(manifestPath).toLowerCase().startsWith(privateRoot.toLowerCase()+path.sep)||
      !/^techlong-f3b3-sealed-management-[a-z0-9-]+$/.test(path.basename(path.dirname(manifestPath))))throw new Error("SEALED_MANAGEMENT_PRIVATE_MANIFEST_REQUIRED");
    const review=JSON.parse(await readFile(manifestPath,"utf8"));
    if(review.phase!==phase)throw new Error("SEALED_MANAGEMENT_PHASE_MISMATCH");
    await validateSealedPlanManagementReviewIntegrityV1(review,binding,candidate);
    if(runMode){
      await validateSealedPlanManagementApprovalV1(review,options["--approved-sha"],binding,candidate,Date.now());
      activeClient=await connect();
      const slot=path.join(privateRoot,`techlong-f3b3-sealed-${phase}-v1-consumed`);
      const result=await runReviewedSealedPlanMutationV1({client:activeClient,review,approvedSha256:options["--approved-sha"],binding,candidateSql:candidate,now:Date.now,
        claimPermanentSlot:async()=>{await mkdir(slot);},
        persistConsumedReview:async()=>{await writeFile(path.join(slot,"approved-manifest.json"),JSON.stringify(review,null,2)+"\n",{flag:"wx"});}});
      await activeClient.end().catch(()=>undefined);activeClient=null;
      await save("submission-receipt.json",result);
      console.log(JSON.stringify({mode,output,...result}));
      if(!result.commitConfirmed)process.exitCode=1;
    }
    // New connection, read-only transaction. It does not submit DDL/INSERT or retry a failed commit.
    const readback=await readonly();
    await save("read-only-observation.json",{...readback,privatePreimage:undefined,binding,databaseMutationPerformed:false});
    const verified=await verifySealedPlanManagementPoststateV1(readback,review,candidate);
    const fileSha256=await save("independent-readback.json",{...verified,binding,approvedManifestSha256:review.manifestSha256,
      dbObservedAt:readback.observedAt,independentConnection:true,readOnly:true,deferrable:true,runtimeEnabled:false});
    console.log(JSON.stringify({mode:"IndependentReadback",output,fileSha256,outcome:verified.outcome,runtimeEnabled:false}));
  }
}catch{
  console.error("SEALED_MANAGEMENT_NOT_VERIFIED; no write retry; credentials, business preimage and raw diagnostics withheld. Use independent read-only inspection after any consumed slot.");
  process.exitCode=1;
}finally{await activeClient?.end().catch(()=>undefined);}
