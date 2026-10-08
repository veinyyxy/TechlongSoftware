// Standalone reviewed NOLOGIN role installation, not a migration or credential provisioner.
import { Client } from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readSealedControlRoleStateV1, compileControlRoleReviewV1, validateControlRoleReviewV1,
  validateControlRoleApprovalV1, runReviewedControlRolesV1, verifyControlRolePoststateV1 } from "../../../lib/deployments/execution/sealed-control-role-management-v1.ts";

const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith("--")||!args[i+1]||options[args[i]])throw new Error("CONTROL_ROLE_ARGUMENTS_INVALID");options[args[i]]=args[i+1];}
const mode=options["--mode"],allowed=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Verify"].includes(mode)||canonicalJson(Object.keys(options).sort())!==canonicalJson(allowed.sort()))throw new Error("CONTROL_ROLE_ARGUMENTS_INVALID");
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=path.resolve("F:/ChatGPT_workshop"),output=path.resolve(options["--out"]);
const bounded=p=>path.dirname(p).toLowerCase()===privateRoot.toLowerCase()&&/^techlong-f3b3-control-roles-[a-z0-9-]+$/.test(path.basename(p));
if(!bounded(output))throw new Error("CONTROL_ROLE_PRIVATE_OUTPUT_REQUIRED");
let active;
try{
 const raw=process.env.DATABASE_URL,url=raw?new URL(raw):null;
 if(!url||!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||!url.username||!url.password||
  (url.port&&url.port!=="5432")||!["require","verify-full"].includes(url.searchParams.get("sslmode"))||!/^\/[A-Za-z0-9_-]+$/.test(url.pathname)||
  url.hash||[...url.searchParams.keys()].some(k=>!["sslmode","channel_binding"].includes(k)))throw new Error("CONTROL_ROLE_NEON_TLS_TARGET_REQUIRED");
 const user=decodeURIComponent(url.username),database=decodeURIComponent(url.pathname.slice(1));
 const codeFiles=["ops/aws-sandbox/scripts/review-f3b3-control-roles.mjs","lib/deployments/execution/sealed-control-role-management-v1.ts",
  "lib/deployments/execution/sealed-plan-management-v1.ts","lib/deployments/execution/sealed-plan-catalog-read-v1.ts","lib/deployments/execution/hash.ts",
  "package.json","package-lock.json"];
 const codeHashes=[];for(const file of codeFiles)codeHashes.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});
 const sql=(await readFile(path.join(root,"ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql"),"utf8")).replace(/\r\n/g,"\n");
 const binding={targetFingerprintSha256:await sha256Hex({protocol:"neon-sealed-management-target-v1",host:url.hostname,port:5432,database,user}),
  codeSha256:await sha256Hex(codeHashes),certificateSha256:"dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f"};
 const connect=async()=>{const client=new Client({host:url.hostname,port:5432,user,password:decodeURIComponent(url.password),database,
  ssl:{rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,connectionTimeoutMillis:10000,statement_timeout:30000,query_timeout:35000,
  application_name:"techlong-control-roles-v1"});client.on("error",()=>undefined);await client.connect();return client;};
 const readonly=async()=>{active=await connect();try{
  await active.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");await active.query("SET LOCAL search_path=pg_catalog");
  const read=await readSealedControlRoleStateV1(active);
  if(read.state.preserved.sealed.identity.role!==user||read.state.preserved.sealed.identity.database!==database)throw new Error("CONTROL_ROLE_SQL_TARGET_MISMATCH");
  await active.query("COMMIT");return read;
 }finally{await active.end().catch(()=>undefined);active=null;}};
 await mkdir(output);
 const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(output,name),bytes,{flag:"wx"});return sha256Hex(bytes);};
 if(mode==="Review"){
  const startedAt=Date.now(),readback=await readonly();
  await save("private-preimage.json",readback.privatePreimage);await save("read-only-preflight.json",{...readback,privatePreimage:undefined,binding});
  const review=await compileControlRoleReviewV1({readback,binding,sql,startedAt,now:Date.now()});const fileSha256=await save("review-manifest.json",review);
  console.log(JSON.stringify({mode,output,manifestSha256:review.manifestSha256,fileSha256,expiresAt:new Date(review.expiresAt).toISOString(),
   outcome:"NOLOGIN_ROLE_REVIEW_REQUIRES_SEPARATE_HUMAN_APPROVAL",slotConsumed:false,neonMutationPerformed:false,awsMutationPerformed:false,runtimeEnabled:false}));
 }else{
  const manifest=path.resolve(options["--manifest"]);
  if(path.basename(manifest)!=="review-manifest.json"||!bounded(path.dirname(manifest)))throw new Error("CONTROL_ROLE_PRIVATE_MANIFEST_REQUIRED");
  const review=JSON.parse(await readFile(manifest,"utf8"));await validateControlRoleReviewV1(review,binding,sql);
  if(mode==="Run"){
   await validateControlRoleApprovalV1(review,options["--approved-sha"],binding,sql,Date.now());active=await connect();
   const slot=path.join(privateRoot,"techlong-f3b3-control-roles-v1-consumed");
   const result=await runReviewedControlRolesV1({client:active,review,approvedSha:options["--approved-sha"],binding,sql,now:Date.now,
    claimPermanentSlot:async()=>{await mkdir(slot);},persistConsumedReview:async()=>{await writeFile(path.join(slot,"approved-manifest.json"),JSON.stringify(review,null,2)+"\n",{flag:"wx"});}});
   await active.end().catch(()=>undefined);active=null;await save("submission-receipt.json",result);console.log(JSON.stringify({mode,output,...result}));
   if(!result.commitConfirmed)process.exitCode=1;
  }
  const readback=await readonly();await save("read-only-observation.json",{...readback,privatePreimage:undefined,binding});
  const verified=await verifyControlRolePoststateV1(readback,review);
  const fileSha256=await save("independent-readback.json",{...verified,approvedManifestSha256:review.manifestSha256,independentConnection:true,readOnly:true});
  console.log(JSON.stringify({mode:"IndependentReadback",output,fileSha256,outcome:verified.outcome,runtimeEnabled:false}));
 }
}catch{
 console.error("CONTROL_ROLES_NOT_VERIFIED; no write retry; credentials and raw diagnostics withheld. After a consumed slot use Verify only.");process.exitCode=1;
}finally{await active?.end().catch(()=>undefined);}
