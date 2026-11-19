import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {load} from 'js-yaml';
import {buildCandidateArchive,CHECKOUT_REPAIR,CHECKOUT_REPAIR_TREE,FIRST_PURCHASE,FIRST_PURCHASE_TREE} from '../ops/platform-registration-candidate-v1/candidate.mjs';

const file=filepath=>new URL('../'+filepath,import.meta.url);
const previous=JSON.parse(await readFile(file('docs/evidence/sandbox-first-purchase-activation.prepared.json'),'utf8')).candidate;
const prior=JSON.parse(await readFile(file('docs/evidence/sandbox-first-purchase-replacement.prepared.json'),'utf8'));
const prepared=JSON.parse(await readFile(file('docs/evidence/sandbox-first-purchase-dahlia.prepared.json'),'utf8'));
const repair=JSON.parse(await readFile(file('docs/evidence/sandbox-first-purchase-checkout-repair.prepared.json'),'utf8'));

test('same no-AWS manual workflow admits only registration and the two exact Dahlia recipes',async()=>{
  const workflow=load(await readFile(file('.github/workflows/sandbox-registration-candidate-v1.yml'),'utf8'));
  assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs),['recipe_sha','orchestration_sha']);
  assert.deepEqual(workflow.permissions,{contents:'read'});
  const job=workflow.jobs.candidate;
  assert.equal(job.environment,undefined);
  assert.equal(job.permissions,undefined);
  assert.equal(job['timeout-minutes'],25);
  for(const gate of ["github.ref == 'refs/heads/main'","github.run_attempt == 1","github.repository_id == '1323312747'",
    'github.sha == inputs.orchestration_sha',FIRST_PURCHASE,CHECKOUT_REPAIR,'06d91b3eb875568af5d3f9b9a9015d9a949571dc0ec8427b0ad2e764bbd8c720']) {
    assert.ok(job.if.includes(gate),gate);
  }
  assert.equal((job.if.match(/inputs\.recipe_sha == '[a-f0-9]{64}'/g)??[]).length,3);
  assert.ok(!job.if.includes(previous.recipeSha256));
  assert.ok(!job.if.includes(prior.candidate.recipeSha256));
  assert.deepEqual(job.env,{REVIEWED_RECIPE_SHA:'${{ inputs.recipe_sha }}'});
  const shell=job.steps.map(x=>x.run??'').join('\n');
  assert.doesNotMatch(shell,/docker push|docker login|aws login|aws sts|gh workflow run|secrets\./);
  assert.equal((shell.match(/docker build --platform/g)??[]).length,1);
  const smoke=job.steps.find(x=>x.name?.startsWith('First-purchase signed-callback'));
  assert.equal(smoke.if,`inputs.recipe_sha == '${FIRST_PURCHASE}' || inputs.recipe_sha == '${CHECKOUT_REPAIR}'`);
  for(const pin of ['--network none','--read-only','--cap-drop ALL','DEPLOYMENT_WORKER_ENABLED=false','whsec_synthetic_only','first-purchase-smoke.json',
    'TECHLONG_SANDBOX_FIRST_PURCHASE_PLAN_ID=pln_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] )
    assert.ok(smoke.run.includes(pin));
  const upload=job.steps.find(x=>x.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with.name,"${{ inputs.recipe_sha == '"+CHECKOUT_REPAIR+"' && 'sandbox-first-purchase-checkout-b2faf785' || "+
    "inputs.recipe_sha == '"+FIRST_PURCHASE+"' && 'sandbox-first-purchase-overlay-"+
    FIRST_PURCHASE.slice(0,8)+"' || 'sandbox-registration-overlay-06d91b3e' }}-${{ github.run_id }}");
  assert.equal(upload.with['retention-days'],3);
  assert.equal(upload.with.overwrite,false);
  assert.match(await readFile(file('ops/platform-registration-candidate-v1/first-purchase-smoke.mjs'),'utf8'),/api_version:'2026-05-27\.dahlia'/);
});

test('exact archives retain the fixed Dahlia lineage and change only three files for Checkout repair',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'techlong-candidate-wiring-test-'));
  try {
    await assert.rejects(buildCandidateArchive(path.join(temp,'wrong'),'0'.repeat(64)),/reviewed recipe ID/);
    await assert.rejects(buildCandidateArchive(path.join(temp,'superseded'),previous.recipeSha256),/reviewed recipe ID/);
    await assert.rejects(buildCandidateArchive(path.join(temp,'pre-dahlia'),prior.candidate.recipeSha256),/reviewed recipe ID/);
    const staged=path.join(temp,'first-purchase');
    const [old,next,fixed]=await Promise.all([buildCandidateArchive(path.join(temp,'registration')),buildCandidateArchive(staged,FIRST_PURCHASE),
      buildCandidateArchive(path.join(temp,'checkout-repair'),CHECKOUT_REPAIR)]);
    assert.equal(old.sourceTreeOid,'131fc5f0fd491e642916723ea0206cd0b03f413f');
    assert.equal(old.sourceRecipe.overlay.length,2);
    assert.equal(next.sourceRecipeSha256,FIRST_PURCHASE);
    assert.equal(next.sourceRecipe.overlay.length,19);
    assert.equal(next.sourceRecipe.base,old.sourceRecipe.base);
    assert.equal(next.sourceRecipe.base,previous.recipe.base);
    assert.equal(next.sourceTreeOid,FIRST_PURCHASE_TREE);
    assert.deepEqual(next.sourceRecipe.overlay.map(x=>x.path),previous.recipe.overlay.map(x=>x.path));
    const planFixed=previous.recipe.overlay.map(row=>row.path===prior.replacement.path?prior.replacement:row);
    const changed=new Set(prepared.replacements.map(x=>x.path));
    assert.equal(changed.size,4);
    assert.deepEqual(next.sourceRecipe.overlay.filter(row=>changed.has(row.path)),prepared.replacements);
    const unaffected=rows=>rows.filter(x=>!changed.has(x.path));
    assert.deepEqual(unaffected(next.sourceRecipe.overlay),unaffected(planFixed));
    assert.equal(prepared.dispatchAuthorized,false);
    for(const row of old.sourceRecipe.overlay) {
      assert.equal(next.sourceRecipe.overlay.find(x=>x.path===row.path)?.sha256,row.sha256);
    }
    const proof=await readFile(path.join(staged,'source-proof.json'),'utf8');
    assert.ok(Buffer.byteLength(proof)<8192);
    assert.deepEqual(JSON.parse(proof),next);
    assert.ok((await stat(path.join(staged,'source.tar'))).size>0);
    assert.equal(fixed.sourceRecipeSha256,CHECKOUT_REPAIR);
    assert.equal(fixed.sourceTreeOid,CHECKOUT_REPAIR_TREE);
    assert.equal(fixed.sourceRecipe.overlay.length,19);
    assert.equal(fixed.sourceRecipe.base,next.sourceRecipe.base);
    assert.deepEqual(fixed.sourceRecipe.overlay.map(x=>x.path),next.sourceRecipe.overlay.map(x=>x.path));
    const repairChanged=fixed.sourceRecipe.overlay.filter((x,i)=>x.blob!==next.sourceRecipe.overlay[i].blob);
    const byPath=(a,b)=>a.path.localeCompare(b.path);
    assert.deepEqual(repairChanged.map(({path,blob,sha256})=>({path,blob,sha256})).sort(byPath),
      [...repair.source.runtimeReplacements].sort(byPath));
    assert.ok(repairChanged.every(x=>x.source===repair.source.fixCommit));
    assert.deepEqual(fixed.sourceRecipe.overlay.filter(x=>!repairChanged.includes(x)),
      next.sourceRecipe.overlay.filter(x=>!repairChanged.some(y=>y.path===x.path)));
    assert.equal(repair.executionAuthorized,false);
    await assert.rejects(buildCandidateArchive(staged,FIRST_PURCHASE),{code:'EEXIST'});
  } finally {
    // Only the unique test fixture created above, not a checkout or existing directory.
    assert.equal(path.dirname(temp),tmpdir().replace(/[\\/]$/,''));
    assert.match(path.basename(temp),/^techlong-candidate-wiring-test-[A-Za-z0-9]+$/);
    await rm(temp,{recursive:true,force:true});
  }
});
