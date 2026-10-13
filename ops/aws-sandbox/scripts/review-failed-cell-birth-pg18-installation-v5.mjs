// Fresh reviewed PG18 repair preparation/once-only installation. Old 68 files,
// approved attempt and consumed slot are preserved. No automatic retry entry.
import { Client } from "pg";
import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readFailedBirthPg18StateV5, compileFailedBirthPg18ReviewV5, validateFailedBirthPg18ReviewV5,
  runReviewedFailedBirthPg18V5, verifyFailedBirthPg18PoststateV5, FAILED_BIRTH_PRIOR_ATTEMPT_V5 as prior,
  FAILED_BIRTH_PG18_SCOPE_V5 as scope } from "../../../lib/deployments/execution/failed-cell-birth-pg18-installation-v5.ts";

const options = {}, args = process.argv.slice(2);
for (let i=0; i<args.length; i+=2) { if (!args[i]?.startsWith("--") || !args[i+1] || options[args[i]]) throw Error("FAILED_PG18_ARGUMENTS_INVALID"); options[args[i]] = args[i+1]; }
const mode = options["--mode"], allowed = mode === "Review" ? ["--mode", "--out"] : mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] : ["--mode", "--out", "--manifest"];
if (!["Review", "Run", "Inspect"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("FAILED_PG18_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]);
const bounded = async p => (await realpath(path.dirname(p))).toLowerCase() === root.toLowerCase() && /^techlong-f3c9e-pg18-install-[a-z0-9-]+$/.test(path.basename(p));
if ((await lstat("F:/ChatGPT_workshop")).isSymbolicLink() || !(await bounded(out))) throw Error("FAILED_PG18_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out); const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx", flush: true }); return sha256Hex(text); };
let active, stage = "OLD68_AND_PRIOR_ATTEMPT_BINDING", databaseConnections = 0, result;
try {
  const originalDirectory = path.join(root, "techlong-f3c9d-neon-install-20261012-r3"), original = JSON.parse(await readFile(path.join(originalDirectory, "code-binding.json"), "utf8"));
  if (original.pins.length !== 68 || original.codeSha256 !== prior.code68Sha256 || await sha256Hex(original.pins) !== prior.code68Sha256) throw Error("FAILED_PG18_OLD68_BINDING_INVALID");
  const pins = [...original.pins];
  for (const file of ["lib/deployments/execution/failed-cell-birth-pg18-installation-v5.ts", "ops/aws-sandbox/scripts/review-failed-cell-birth-pg18-installation-v5.mjs"])
    pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g,"\n")) });
  const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256, originalCode68: prior.code68Sha256 });
  const verifyCodeAndPriorEvidence = async () => {
    for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file),"utf8")).replace(/\r\n/g,"\n")) !== p.sha256) throw Error("FAILED_PG18_CODE_DRIFT");
    const slotText = await readFile(path.join(root, prior.consumedSlot),"utf8"), slot = JSON.parse(slotText),
      receiptText = await readFile(path.join(root,"techlong-f3c9d-neon-install-20261012-r3-run/submission-receipt.json"),"utf8"), receipt = JSON.parse(receiptText),
      reportText = await readFile(path.join(root,"techlong-f3c9d-neon-stop-20261012-r1/independent-stop-inspect.json"),"utf8"), report = JSON.parse(reportText);
    if (await sha256Hex(slotText) !== prior.consumedSlotSha256 || slot.approvedSha256 !== prior.approvedSha256 || slot.codeSha256 !== prior.code68Sha256 || slot.retryAuthorized !== false ||
      await sha256Hex(receiptText) !== prior.receiptSha256 || receipt.commitAttempted !== false || receipt.slotConsumed !== true ||
      await sha256Hex(reportText) !== prior.restorationReportSha256 || report.exactReviewedPrestateRestored !== true || report.currentStateSha256 !== prior.restoredLegacyStateSha256)
      throw Error("FAILED_PG18_PRIOR_ATTEMPT_EVIDENCE_DRIFT");
  };
  await verifyCodeAndPriorEvidence();
  const text = async f => (await readFile(path.join(repo,f),"utf8")).replace(/\r\n/g,"\n"),
    schema = await text("ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql"), grants = await text("ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql");
  const raw = process.env.DATABASE_URL, url = raw ? new URL(raw) : null;
  if (!url || !["postgres:","postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") || !url.username || !url.password ||
    (url.port && url.port !== "5432") || !["require","verify-full"].includes(url.searchParams.get("sslmode")) || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
    url.hash || [...url.searchParams.keys()].some(k => !["sslmode","channel_binding"].includes(k))) throw Error("FAILED_PG18_NEON_TLS_REQUIRED");
  const user = decodeURIComponent(url.username), database = decodeURIComponent(url.pathname.slice(1)), binding = {
    targetFingerprintSha256: await sha256Hex({ protocol:"neon-failed-birth-installation-target-v4",host:url.hostname,port:5432,database,user }), codeSha256 };
  const oldReview = JSON.parse(await readFile(path.join(originalDirectory,"review-manifest.json"),"utf8"));
  if (oldReview.manifestSha256 !== prior.approvedSha256 || binding.targetFingerprintSha256 !== oldReview.binding.targetFingerprintSha256) throw Error("FAILED_PG18_PRIOR_NEON_TARGET_DRIFT");
  const newSlot = path.join(root,scope.permanentSlot), newSlotPresent = async () => { try { await lstat(newSlot); return true; } catch(e) { if(e.code === "ENOENT") return false; throw Error("FAILED_PG18_NEW_SLOT_READ_FAILED"); } };
  if (mode !== "Inspect" && await newSlotPresent()) throw Error("FAILED_PG18_NEW_SLOT_OCCUPIED_INSPECT_ONLY");
  const connect = async () => { const c = new Client({host:url.hostname,port:5432,user,password:decodeURIComponent(url.password),database,
    ssl:{rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,connectionTimeoutMillis:10000,statement_timeout:30000,query_timeout:35000,application_name:"techlong-failed-birth-pg18-v5"});
    c.on("error",()=>undefined);await c.connect();databaseConnections++;return c; };
  const readState = async () => { const r = await readFailedBirthPg18StateV5(active);
    if (r.state.legacy.base.preserved.sealed.identity.role !== user || r.state.legacy.base.preserved.sealed.identity.database !== database) throw Error("FAILED_PG18_SQL_IDENTITY_DRIFT"); return r; };
  const readonly = async () => { active = await connect(); try { await active.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");await active.query("SET LOCAL search_path=pg_catalog");
    const r = await readState();await active.query("COMMIT");return r; } finally { await active.end().catch(()=>undefined);active=null; } };
  if (mode === "Review") {
    stage = "NEON_READONLY_FRESH_REVIEW";const started=Date.now(),read=await readonly();await verifyCodeAndPriorEvidence();
    await save("read-only-preflight.json",{...read,binding,databaseWrites:0,newSlotConsumed:false,originalSlotPreserved:true});
    const review=await compileFailedBirthPg18ReviewV5(read,binding,started,Date.now());await validateFailedBirthPg18ReviewV5(review,binding,schema,grants);
    const manifestFileSha256=await save("review-manifest.json",review);
    console.log(JSON.stringify({mode,outcome:"FRESH_PG18_INSTALLATION_REVIEW_REQUIRES_NEW_HUMAN_APPROVAL",manifestSha256:review.manifestSha256,
      expiresAt:new Date(review.expiresAt).toISOString(),manifestFileSha256,codeSha256,boundFileCount:pins.length,prestateSha256:read.stateSha256,legacyStateSha256:read.legacyStateSha256,
      existingEnvironmentNotNullMappingsVerified:true,original68Unchanged:true,oldConsumedSlotPreserved:true,newSlotConsumed:false,databaseConnections,databaseWrites:0,awsCalls:0,secretValueReads:0,runtimeEnabled:false,output:out},null,2));
  } else {
    const manifest=path.resolve(options["--manifest"]);
    if(path.basename(manifest)!=="review-manifest.json" || !(await bounded(path.dirname(manifest)))) throw Error("FAILED_PG18_PRIVATE_MANIFEST_REQUIRED");
    const review=JSON.parse(await readFile(manifest,"utf8"));await validateFailedBirthPg18ReviewV5(review,binding,schema,grants);await verifyCodeAndPriorEvidence();
    if(mode === "Run") {
      stage="APPROVED_PG18_ONCE_ONLY_INSTALLATION";active=await connect();
      result=await runReviewedFailedBirthPg18V5({client:active,review,approvedSha:options["--approved-sha"],binding,schema,grants,now:Date.now,readState,verifyCodeAndPriorEvidence,
        persistPrecommitEvidence:async(phase,read)=>{await save(`${phase}-private-catalog.json`,{...read,binding,approvedManifestSha256:review.manifestSha256,noConnectionStringOrPasswordIncluded:true});},
        claimFreshApprovedSlot:async()=>{await writeFile(newSlot,JSON.stringify({protocol:"failed-birth-pg18-reviewed-permanent-attempt-v5",approvedSha256:review.manifestSha256,
          codeSha256,previousConsumedSlotSha256:prior.consumedSlotSha256,attemptedAt:new Date().toISOString(),retryAuthorized:false})+"\n",{flag:"wx",flush:true});} });
      await active.end().catch(()=>undefined);active=null;await save("submission-receipt.json",result);console.log(JSON.stringify({mode,...result,output:out},null,2));if(!result.commitConfirmed)process.exitCode=1;
    }
    stage="INDEPENDENT_READONLY_INSPECT";const started=Date.now(),read=await readonly();await verifyCodeAndPriorEvidence();
    await save("independent-read-only-observation.json",{...read,binding,databaseWritesThisRead:0,runtimeEnabled:false});
    if(Date.now()-started>30000)throw Error("FAILED_PG18_INDEPENDENT_READ_STALE");
    const verified=await verifyFailedBirthPg18PoststateV5(read,review.reviewedState,schema),reportFileSha256=await save("independent-inspect.json",{...verified,
      approvedManifestSha256:review.manifestSha256,codeSha256,observedAt:new Date(read.observedAt).toISOString(),independentNewTlsConnection:true,readOnly:true,deferrable:true,
      oldConsumedSlotPreserved:true,newSlotConsumed:await newSlotPresent(),awsCalls:0,secretValueReads:0});
    console.log(JSON.stringify({mode:"IndependentInspect",...verified,reportFileSha256,output:out},null,2));
  }
} catch(e) {
  const report={outcome:"PG18_INSTALLATION_NOT_VERIFIED_INSPECT_ONLY",stage,safeCode:/^(FAILED_PG18|FAILED_INSTALL)_[A-Z0-9_]{1,100}$/.test(String(e.message))?e.message:"FAILED_PG18_PROVIDER_OR_PRIVATE_EVIDENCE_FAILURE",
    sqlState:/^[0-9A-Z]{5}$/.test(String(e.code))?e.code:null,noRawDiagnosticsOrPasswordsPersisted:true,databaseConnections,submissionResult:result??null,awsCalls:0,secretValueReads:0,retryAuthorized:false,runtimeEnabled:false};
  await save("safe-failure.json",report);console.log(JSON.stringify(report,null,2));process.exitCode=1;
} finally { await active?.end().catch(()=>undefined); }
