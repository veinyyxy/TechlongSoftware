// No AWS, registry authentication, business connection, or upload paths here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkCandidateScan } from '../platform-hosting-v1/security-scan.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const REGISTRATION = '06d91b3eb875568af5d3f9b9a9015d9a949571dc0ec8427b0ad2e764bbd8c720';
const PREVIOUS_FIRST_PURCHASE = '258c77666a802b08f3052f1082c279104ee45c9f643e174089f9e630110c1e9c';
const PLAN_CONFIG_PATH = 'lib/purchases/sandbox-first-purchase-config.ts';
const PRE_DAHLIA_RECIPE = 'b344a2e3f1c36ceeebca47b8d184f9e20fce8fa0c8d66e44ddcfb62454e17315';
export const FIRST_PURCHASE = 'cdfa2e16aa6660698a2bce8b8a6a73b67616c1bc7d2955fc43291764abe9ed1d';
export const CHECKOUT_REPAIR = 'b2faf785466efcef7aa4434b82c3a22b8537550c829525a3885b04105e3eaaff';
export const BILLING_REPAIR = '1f01d6a8736504dad9c1351b1f8c6c6c142c2459ee158e17fb011e81d8a35f9c';
export const BUYER_FORWARD = '35ec0afbe7d4d7f6f222f45edc261aeaf5b229fe49874817c0fedc3bf0c2e597';
const REGISTRATION_TREE = '131fc5f0fd491e642916723ea0206cd0b03f413f';
export const FIRST_PURCHASE_TREE = '5a818a48940e21b2d907d6b8a64ac902ff709299';
export const CHECKOUT_REPAIR_TREE = '88749946405674d03892e241bbfc6f6153caa88c';
export const BILLING_REPAIR_TREE = '8ff7f4974fe1212b101aba308809cd226cf7a373';
const ARCHIVE_FILE = 'image.tar.gz';
const SHA = /^[a-f0-9]{64}$/;
const OID = /^[a-f0-9]{40}$/;
const CONFIG = /^sha256:[a-f0-9]{64}$/;
const fixedFiles = ['lib/auth/credentials.ts', 'lib/auth/sandbox-registration.ts'];
const dahliaFiles = ['app/api/stripe/webhook/route.ts','lib/payments/stripe.ts',
  'lib/purchases/sandbox-first-purchase-runtime.ts','lib/purchases/sandbox-first-purchase.ts'];
const checkoutFiles = ['lib/payments/stripe.ts',PLAN_CONFIG_PATH,'lib/purchases/sandbox-first-purchase.ts'];
const isFirstPurchase = review => [FIRST_PURCHASE,CHECKOUT_REPAIR,BILLING_REPAIR].includes(review);
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ?
  Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const hash = b => createHash('sha256').update(b).digest('hex');
export const FIRST_PURCHASE_SMOKE = Object.freeze({
  outcome:'SANDBOX_FIRST_PURCHASE_SYNTHETIC_CALLBACK_PASSED',
  validOutOfScopeIgnored:true, liveModeIgnored:true, badSignatureRejected:true, exactRouteOnly:true, workerClosed:true,
});
const buyerForwardImageSchema = 'techlong/sandbox-first-open-buyer-forward-image/v1';

async function buyerForwardRecipe() {
  const source = await readFile(new URL('./buyer-forward-v1.source.json', import.meta.url),'utf8');
  const canonicalText = source.replace(/\r\n/g,'\n');
  assert.equal(hash(canonicalText), BUYER_FORWARD, 'reviewed buyer-forward recipe bytes');
  const recipe = JSON.parse(canonicalText);
  assert.equal(recipe.schema, 'techlong/sandbox-first-open-buyer-forward-source/v1');
  assert.equal(recipe.baseRecipeSha256, BILLING_REPAIR);
  assert.equal(recipe.baseTreeOid, BILLING_REPAIR_TREE);
  assert.ok(OID.test(recipe.sourceTreeOid) && recipe.sourceTreeOid!==recipe.baseTreeOid);
  assert.equal(recipe.overlay.length,8);
  const patch=(await readFile(new URL('./buyer-forward-v1.patch', import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  assert.equal(hash(patch),recipe.patchSha256,'reviewed buyer-forward patch bytes');
  return {recipe,patch};
}

async function reviewedProfile(review) {
  assert.ok(review===REGISTRATION || isFirstPurchase(review), 'reviewed recipe ID');
  if (review===REGISTRATION) {
    const recipe=JSON.parse(await readFile(path.join(root,'docs/evidence/sandbox-registration-platform-update.prepared.json'),'utf8')).candidate.sourceRecipe;
    assert.equal(hash(JSON.stringify(canon(recipe))), review, 'reviewed source recipe');
    assert.deepEqual(recipe.overlay.map(x=>x.path), fixedFiles);
    return {recipe, schema:'techlong/sandbox-registration-overlay-image/v1', treeOid:REGISTRATION_TREE};
  }
  const prior=JSON.parse(await readFile(path.join(root,'docs/evidence/sandbox-first-purchase-activation.prepared.json'),'utf8')).candidate;
  assert.equal(prior.recipeSha256,PREVIOUS_FIRST_PURCHASE);
  assert.equal(hash(JSON.stringify(prior.recipe)),PREVIOUS_FIRST_PURCHASE,'previous source recipe');
  const {replacement,candidate}=JSON.parse(await readFile(path.join(root,'docs/evidence/sandbox-first-purchase-replacement.prepared.json'),'utf8'));
  assert.equal(replacement.path,PLAN_CONFIG_PATH);
  const old=prior.recipe.overlay.filter(row=>row.path===PLAN_CONFIG_PATH);
  assert.equal(old.length,1);
  assert.notEqual(old[0].blob,replacement.blob);
  const previous={...prior.recipe,overlay:prior.recipe.overlay.map(row=>row.path===PLAN_CONFIG_PATH?replacement:row)};
  assert.equal(candidate.recipeSha256,PRE_DAHLIA_RECIPE);
  assert.equal(hash(JSON.stringify(previous)),PRE_DAHLIA_RECIPE,'previous plan-fixed recipe');
  const reviewed=JSON.parse(await readFile(path.join(root,'docs/evidence/sandbox-first-purchase-dahlia.prepared.json'),'utf8'));
  assert.equal(reviewed.previous.recipeSha256,PRE_DAHLIA_RECIPE);
  assert.equal(reviewed.previous.sourceTreeOid,candidate.sourceTreeOid);
  assert.deepEqual(reviewed.replacements.map(x=>x.path),dahliaFiles);
  const overrides=new Map(reviewed.replacements.map(x=>[x.path,x]));
  assert.ok(reviewed.replacements.every(f=>previous.overlay.some(row=>row.path===f.path&&row.blob!==f.blob)));
  const recipe={...previous,overlay:previous.overlay.map(row=>overrides.get(row.path)??row)};
  assert.equal(reviewed.candidate.recipeSha256,FIRST_PURCHASE);
  assert.equal(reviewed.candidate.sourceTreeOid,FIRST_PURCHASE_TREE);
  assert.equal(hash(JSON.stringify(recipe)), FIRST_PURCHASE, 'reviewed source recipe');
  assert.equal(recipe.overlay.length,reviewed.candidate.overlayFiles);
  assert.equal(recipe.overlay.length,19);
  assert.equal(new Set(recipe.overlay.map(x=>x.path)).size,recipe.overlay.length);
  const schema='techlong/sandbox-first-purchase-overlay-image/v1';
  if(review===FIRST_PURCHASE)return {recipe,schema,treeOid:FIRST_PURCHASE_TREE};
  const repair=JSON.parse(await readFile(path.join(root,'docs/evidence/sandbox-first-purchase-checkout-repair.prepared.json'),'utf8')).source;
  assert.equal(repair.deployedRecipeSha256,FIRST_PURCHASE);
  assert.equal(repair.deployedTreeOid,FIRST_PURCHASE_TREE);
  assert.equal(repair.candidateRecipeSha256,CHECKOUT_REPAIR);
  assert.equal(repair.candidateTreeOid,CHECKOUT_REPAIR_TREE);
  assert.deepEqual(repair.runtimeReplacements.map(x=>x.path),checkoutFiles);
  assert.equal(repair.overallOverlayFiles,recipe.overlay.length);
  const changes=new Map(repair.runtimeReplacements.map(({path,blob,sha256})=>[path,{path,source:repair.fixCommit,blob,sha256}]));
  assert.ok([...changes.values()].every(f=>recipe.overlay.some(row=>row.path===f.path&&row.blob!==f.blob)));
  const next={...recipe,overlay:recipe.overlay.map(row=>changes.get(row.path)??row)};
  assert.equal(hash(JSON.stringify(next)), CHECKOUT_REPAIR, 'reviewed checkout repair source recipe');
  if(review===CHECKOUT_REPAIR)return {recipe:next,schema,treeOid:CHECKOUT_REPAIR_TREE};
  const billingText=(await readFile(path.join(root,'docs/evidence/sandbox-first-purchase-billing-rollout.review.json'),'utf8')).replace(/\r\n/g,'\n');
  assert.equal(hash(billingText),'7112a253eddda954c25c5b94f92b259b8895484a07ae127e4531d0d7d746334c','billing approval bytes');
  const billing=JSON.parse(billingText).source;
  assert.equal(billing.previousRecipeSha256,CHECKOUT_REPAIR);
  assert.equal(billing.previousTree,CHECKOUT_REPAIR_TREE);
  assert.equal(billing.recipeSha256,BILLING_REPAIR);
  assert.equal(billing.tree,BILLING_REPAIR_TREE);
  const [page,runtime]=billing.replacements;
  assert.deepEqual(billing.replacements.map(f=>f.path),['app/dashboard/billing/page.tsx','lib/purchases/sandbox-first-purchase-runtime.ts']);
  assert.ok(billing.replacements.every(f=>f.source===billing.commit));
  assert.ok(!next.overlay.some(f=>f.path===page.path)&&next.overlay.some(f=>f.path===runtime.path&&f.blob!==runtime.blob));
  const final={...next,overlay:[...next.overlay.map(f=>f.path===runtime.path?runtime:f),page]};
  assert.equal(final.overlay.length,20);
  assert.equal(hash(JSON.stringify(final)),BILLING_REPAIR);
  return {recipe:final,schema,treeOid:BILLING_REPAIR_TREE};
}

const git = (args, env=process.env, input) => execFileSync('git', ['-C',root,...args], {
  env, input, maxBuffer: 4*1024*1024, stdio:[input===undefined?'ignore':'pipe','pipe','ignore'],
});
export async function buildCandidateArchive(dir, review=REGISTRATION) {
  assert.ok(path.isAbsolute(dir));
  const overlay=review===BUYER_FORWARD ? await buyerForwardRecipe() : null;
  const baseReview=overlay ? BILLING_REPAIR : review;
  const {recipe,treeOid}=await reviewedProfile(baseReview);
  assert.ok(OID.test(recipe.base));
  const objects=path.join(dir,'objects');
  await mkdir(dir);
  await mkdir(objects);
  // Alternate objects are read-only; all new trees and the temporary index stay outside checkout.
  const env={...process.env,GIT_INDEX_FILE:path.join(dir,'index'),GIT_OBJECT_DIRECTORY:objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES:git(['rev-parse','--path-format=absolute','--git-path','objects']).toString().trim()};
  git(['read-tree',recipe.base],env);
  const ancestry=new Set();
  const expected=[];
  for(const f of recipe.overlay) {
    const source=isFirstPurchase(baseReview) ? f.source : recipe.fix;
    assert.ok(OID.test(source));
    if(!ancestry.has(source)) {
      git(['merge-base','--is-ancestor',recipe.base,source]);
      ancestry.add(source);
    }
    const pathspec=':(literal)'+f.path;
    const entry=git(['ls-tree',source,'--',pathspec]).toString().trim();
    const parts=/^100644 blob ([a-f0-9]{40})\t([^\n]+)$/.exec(entry);
    assert.ok(parts?.[2]===f.path && SHA.test(f.sha256));
    if(isFirstPurchase(baseReview)) assert.equal(parts[1], f.blob);
    assert.equal(hash(git(['cat-file','blob',parts[1]])),f.sha256);
    const old=git(['ls-tree',recipe.base,'--',pathspec]).toString().trim();
    assert.notEqual(old,entry,'overlay must change the pinned base');
    expected.push(`${old?'M':'A'}\t${f.path}`);
    git(['update-index','--add','--cacheinfo',`100644,${parts[1]},${f.path}`],env);
  }
  const tree=git(['write-tree'],env).toString().trim();
  assert.equal(tree,treeOid,'reviewed source tree');
  const changed=git(['diff-tree','--no-commit-id','--name-status','-r',recipe.base,tree],env).toString().trim().split('\n');
  assert.deepEqual(changed.sort(),expected.sort());
  let stagedTree=tree;
  if(overlay) {
    // Zero context is safe only with the exact prior tree, patch hash, and final tree/blob checks.
    git(['apply','--cached','--unidiff-zero','--whitespace=error-all','-'],env,overlay.patch);
    stagedTree=git(['write-tree'],env).toString().trim();
    assert.equal(stagedTree,overlay.recipe.sourceTreeOid,'exact buyer-forward source tree');
    const delta=git(['diff-tree','--no-commit-id','--name-status','--no-renames','-r',tree,stagedTree],env).toString().trim().split('\n');
    assert.deepEqual(delta,overlay.recipe.overlay.map(f=>`${f.action}\t${f.path}`));
    for(const f of overlay.recipe.overlay) {
      assert.equal(git(['ls-tree',stagedTree,'--',':(literal)'+f.path],env).toString().trim(),
        `100644 blob ${f.blob}\t${f.path}`);
      assert.equal(hash(git(['cat-file','blob',f.blob],env)),f.sha256);
    }
  }
  git(['archive','--format=tar',`--output=${path.join(dir,'source.tar')}`,stagedTree],env);
  const proof={sourceRecipe:overlay?.recipe??recipe,sourceRecipeSha256:review,sourceTreeOid:stagedTree};
  await writeFile(path.join(dir,'source-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  return proof;
}

async function readJson(file,max) {
  const s=await lstat(file);
  assert.ok(s.isFile() && s.size>0 && s.size<=max);
  return JSON.parse(await readFile(file,'utf8'));
}
async function hashArchive(file) {
  const s=await lstat(file), digest=createHash('sha256');
  assert.ok(s.isFile() && s.size>0 && s.size<1610612736);
  let bytes=0;
  for await(const chunk of createReadStream(file)) { bytes+=chunk.length; assert.ok(bytes<1610612736); digest.update(chunk); }
  assert.equal(bytes,s.size);
  return {archiveFile:ARCHIVE_FILE,archiveBytes:bytes,archiveSha256:digest.digest('hex')};
}
function inspectConfig(rows) {
  assert.equal(rows.length,1);
  const i=rows[0], env=i.Config?.Env??[], names=env.map(x=>x.split('=')[0]);
  assert.ok(CONFIG.test(i.Id) && i.Os==='linux' && i.Architecture==='amd64' && i.Config?.User==='node' && i.Config.WorkingDir==='/app');
  assert.deepEqual(i.Config.Cmd,['node','ops/platform-hosting-v1/start.mjs']);
  assert.deepEqual(i.Config.Entrypoint,['docker-entrypoint.sh']);
  assert.ok(!i.Config.Volumes && !i.Config.OnBuild?.length && new Set(names).size===names.length &&
    names.every(n=>['PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','PORT'].includes(n)) &&
    ['NODE_VERSION=24.18.0','NODE_ENV=production','PORT=3000'].every(k=>env.includes(k)));
  return i.Id;
}
async function seal(dir,cache,review) {
  const e=process.env;
  const overlay=review===BUYER_FORWARD ? await buyerForwardRecipe() : null;
  const {recipe,schema,treeOid}=overlay ?
    {recipe:overlay.recipe,schema:buyerForwardImageSchema,treeOid:overlay.recipe.sourceTreeOid} : await reviewedProfile(review);
  assert.ok(e.GITHUB_ACTIONS==='true' && e.GITHUB_EVENT_NAME==='workflow_dispatch' && e.GITHUB_REF==='refs/heads/main' &&
    e.GITHUB_REPOSITORY==='veinyyxy/TechlongSoftware' && e.GITHUB_REPOSITORY_ID==='1323312747' && e.GITHUB_RUN_ATTEMPT==='1' &&
    OID.test(e.GITHUB_SHA) && e.GITHUB_SHA===e.REVIEWED_ORCHESTRATION_SHA && /^[1-9][0-9]{5,19}$/.test(e.GITHUB_RUN_ID));
  assert.ok(!Object.keys(e).some(k=>/^(AWS_|ACTIONS_ID_TOKEN_REQUEST_|DATABASE_URL$|STRIPE_|TECHLONG_SANDBOX_STRIPE_|TECHLONG_SANDBOX_FIRST_PURCHASE_WEBHOOK_DB$)/.test(k)&&e[k]));
  const proof=await readJson(path.join(dir,'source-proof.json'),8192);
  assert.deepEqual(proof.sourceRecipe,recipe); assert.equal(proof.sourceRecipeSha256,review); assert.equal(proof.sourceTreeOid,treeOid);
  const smoke={networkDisabled:true,closedControl:true,healthAndLogin:true,registrationPageGetOnly:true};
  if(isFirstPurchase(review)||overlay) {
    const extra=await readJson(path.join(dir,'first-purchase-smoke.json'),1024);
    assert.deepEqual(extra,FIRST_PURCHASE_SMOKE);
    smoke.firstPurchaseSyntheticCallback=extra;
  }
  const imageConfigDigest=inspectConfig(await readJson(path.join(dir,'image-inspect.json'),262144));
  const scan=checkCandidateScan(await readJson(path.join(dir,'os-scan.json'),40*1024*1024),
    await readJson(path.join(cache,'db/metadata.json'),8192),imageConfigDigest);
  const scanText=JSON.stringify({...scan,recordedAtUtc:new Date().toISOString()},null,2)+'\n';
  await writeFile(path.join(dir,'os-scan-summary.json'),scanText,{flag:'wx'});
  assert.equal(scan.outcome,'OS_HIGH_CRITICAL_ZERO');
  const receipt={schema,...proof,
    orchestrationCommit:e.GITHUB_SHA,runId:e.GITHUB_RUN_ID,runAttempt:1,imageConfigDigest,os:'linux',architecture:'amd64',
    ...await hashArchive(path.join(dir,ARCHIVE_FILE)),scanSummarySha256:hash(scanText),
    smoke,
    awsIdentity:false,registryManifestVerified:false};
  const text=JSON.stringify(receipt,null,2)+'\n';
  await writeFile(path.join(dir,'image-receipt.json'),text,{flag:'wx'});
  await writeFile(path.join(dir,'SHA256SUMS'),`${receipt.archiveSha256}  ${ARCHIVE_FILE}\n${hash(text)}  image-receipt.json\n${receipt.scanSummarySha256}  os-scan-summary.json\n`,{flag:'wx'});
  return receipt;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode,dir,cache,...extra]=process.argv.slice(2);
  const review=process.env.REVIEWED_RECIPE_SHA ?? REGISTRATION;
  try {
    assert.ok(dir && path.isAbsolute(dir) && extra.length===0);
    const result=mode==='source' && !cache ? await buildCandidateArchive(dir,review)
      : mode==='seal' && cache && path.isAbsolute(cache) ? await seal(dir,cache,review) : null;
    assert.ok(result);
    console.log(JSON.stringify(result));
  } catch {
    console.error('SANDBOX_REGISTRATION_CANDIDATE_REFUSED');
    process.exitCode=1;
  }
}
