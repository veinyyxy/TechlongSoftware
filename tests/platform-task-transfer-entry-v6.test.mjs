import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ENTRY,makeOperatorReview,verifyOperatorReview,prepareOperator,runOperatorMode} from '../ops/platform-request-v6/transfer-entry.mjs';
import {parseTransferArgs} from '../ops/platform-request-v6/transfer-local.mjs';
import {assertAdmissionSnapshot,assertControlLayout,JOB_GUARD_SHA256} from '../ops/platform-request-v6/transfer-state.mjs';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
import {transferFixture,expectedAfter,AT,PROOF} from './fixtures/platform-task-transfer-v6.mjs';
import {TRANSFER} from '../ops/platform-request-v6/transfer.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
async function fixture(){
  const baseline=await transferFixture(),sub='sub_fixture',tv='template_fixture';
  baseline.deployment.admissionSnapshot={app:{id:S.appInstanceId,workspace_id:S.workspaceId,product_id:S.productId,subscription_id:sub,template_version_id:tv,status:'active'},
    workspace:{id:S.workspaceId,status:'active'},subscription:{id:sub,status:'active',current_period_end:AT+86400000},
    environment:{id:S.environmentId,status:'active',apply_enabled:0,admission_state:'open',admission_epoch:0,admission_stack_id:null,kind:'aws_sandbox',expected_account_id:'402010193138',region:'ca-central-1',cell_key:S.cellKey},
    resource:{app_instance_id:S.appInstanceId,owner_deployment_id:S.deploymentId,created_by_deployment_id:S.deploymentId,lifecycle_status:'verified',destroyed_at:null,generation:1,external_operation_epoch:1},
    operation:{app_instance_id:S.appInstanceId,generation:1,epoch:1,owner_deployment_id:S.deploymentId,state:'active',intent:'provision',operation_hash:S.operationHash},
    templateVersion:{id:tv},predecessorJob:structuredClone(baseline.jobs.find(j=>j.id===PROOF)),admin:{id:ADMIN,email:'veinyang@gmail.com',status:'active',platformAdmin:1}};
  const sourceCommit='e'.repeat(40),ci={sourceCommit,runId:'123456789',jobId:'123456790',attempt:1,status:'completed',conclusion:'success'},
    pins=Array.from({length:12},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'a'.repeat(64)})),auth={length:1234,aclSha256:'b'.repeat(64),contentRead:false};
  const review=await makeOperatorReview({baseline,sourceCommit,ci,pins,auth,createdAt:AT}),events=[],records=[];let opens=0,closes=0,fail,after=baseline;
  const io={assertSource:async()=>{events.push('source');if(fail==='source')throw Error('PRIVATE_SOURCE');return sourceCommit;},
    verifyCi:async()=>{events.push('ci');if(fail==='ci')throw Error('PRIVATE_CI');return ci;},sourcePins:async()=>pins,authMetadata:async()=>auth,
    open:async()=>{opens++;if(fail==='open')throw Object.assign(Error('PRIVATE_HOST'),{code:'08006'});return {readOnly:async()=>structuredClone(after),
      transaction:async()=>{events.push('transaction');if(fail==='transaction')throw Error('PRIVATE_TX');return {outcome:'TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK',at:AT};},
      close:async()=>{closes++;}};},record:async(n,v)=>{records.push({n,v});},claimWrite:async()=>{events.push('claimWrite');if(fail==='claimWrite')throw Error('PRIVATE_SLOT');},
    claimInspect:async()=>{events.push('claimInspect');},writerReceipt:async()=>({claim:{manifestSha256:review.manifestSha256,sourceCommit,oldJobId:TRANSFER.oldJobId,newJobId:TRANSFER.newJobId},
      intent:{at:AT,oldJobId:TRANSFER.oldJobId,newJobId:TRANSFER.newJobId,baselineSha256:review.core.baselineSha256}})};
  return {baseline,sourceCommit,ci,pins,auth,review,io,events,records,counts:()=>({opens,closes}),fail:v=>{fail=v;},after:v=>{after=v;},
    run:mode=>runOperatorMode({mode,manifest:review,approved:review.manifestSha256,io,now:()=>AT})};
}
test('strict modes cannot override database/key/slot or implicitly acknowledge a config read',()=>{
  assert.equal(parseTransferArgs(['--mode','Prepare','--ci-run','123','--output','x','--allow-config-read','yes']).mode,'Prepare');
  for(const a of [['--mode','Prepare','--ci-run','1','--output','x'],['--mode','Prepare','--ci-run','1','--output','x','--allow-config-read','no'],
    ['--mode','RunReviewed','--manifest','x','--approved-sha','a','--output','x','--database','other'],['--mode','Resume']])assert.throws(()=>parseTransferArgs(a));
});
test('production review rejects incomplete historic audit, altered bindings, failed CI and expired start',async()=>{
  const f=await fixture();await verifyOperatorReview(f.review,f.review.manifestSha256,AT);
  await assert.rejects(makeOperatorReview({...f,baseline:await transferFixture(),createdAt:AT}));
  await assert.rejects(makeOperatorReview({...f,ci:{...f.ci,conclusion:'failure'},createdAt:AT}));
  await assert.rejects(verifyOperatorReview({...f.review,database:{}},f.review.manifestSha256,AT));
  await assert.rejects(verifyOperatorReview(f.review,f.review.manifestSha256,f.review.latestStartAt));
  await verifyOperatorReview(f.review,f.review.manifestSha256,f.review.expiresAt+1000,true);
  assert.equal(f.review.entry,ENTRY);assert.equal(f.review.effects.awsCalls,0);
});
test('Prepare opens once only after source/CI, closes, publishes no slots or mutations',async()=>{
  const f=await fixture(),r=await prepareOperator({ciRun:f.ci.runId,io:f.io,now:()=>AT});assert.equal(r.outcome,'TASK_TRANSFER_PREPARED_NOT_APPROVED');
  assert.deepEqual(f.counts(),{opens:1,closes:1});assert.equal(f.events.includes('claimWrite'),false);assert.equal(f.events.includes('transaction'),false);
  assert.deepEqual(f.records.map(r=>r.n),['manifest','result']);
  for(const stage of ['source','ci']){const g=await fixture();g.fail(stage);await assert.rejects(prepareOperator({ciRun:g.ci.runId,io:g.io,now:()=>AT}));assert.equal(g.counts().opens,0);}
});
test('RunReviewed needs valid approval, unchanged fresh baseline and permanent claim before SQL',async()=>{
  const f=await fixture(),r=await f.run('RunReviewed');assert.equal(r.outcome,'TASK_TRANSFER_COMMITTED_REQUIRES_INDEPENDENT_READBACK');
  assert.deepEqual(f.counts(),{opens:1,closes:1});assert.ok(f.events.indexOf('claimWrite')<f.events.indexOf('transaction'));
  const g=await fixture();g.after({...g.baseline,protection:{...g.baseline.protection,catalogSha256:'f'.repeat(64)}});
  const stopped=await g.run('RunReviewed');assert.equal(stopped.outcome,'TASK_TRANSFER_OPERATOR_STOPPED_REQUIRES_READBACK');assert.equal(g.events.includes('claimWrite'),false);
  assert.deepEqual(g.counts(),{opens:1,closes:1});
  const h=await fixture();const no=await runOperatorMode({mode:'RunReviewed',manifest:h.review,approved:'0'.repeat(64),io:h.io,now:()=>AT});assert.equal(no.phase,'APPROVAL');assert.equal(h.counts().opens,0);
});
test('private-open/claim/SQL failures sanitize provider details and do not rediscover/retry',async()=>{
  for(const phase of ['open','claimWrite','transaction']){const f=await fixture();f.fail(phase);const r=await f.run('RunReviewed');
    assert.equal(r.retryAllowed,false);assert.ok(f.counts().opens<=1);assert.doesNotMatch(JSON.stringify(f.records),/PRIVATE_HOST|PRIVATE_SLOT|PRIVATE_TX/);}
});
test('independent Inspect never invokes writer and distinguishes unchanged from committed rows',async()=>{
  const f=await fixture(),r=await f.run('Inspect');assert.equal(r.outcome,'TASK_TRANSFER_NOT_APPLIED_INDEPENDENTLY_OBSERVED');
  assert.equal(f.events.includes('transaction'),false);assert.equal(f.events.includes('claimWrite'),false);assert.deepEqual(f.counts(),{opens:1,closes:1});
  const g=await fixture();g.after(expectedAfter(g.baseline,AT));const proof=await g.run('Inspect');assert.equal(proof.outcome,'TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY');assert.equal(proof.executionApproved,false);
  const h=await fixture();const bad=expectedAfter(h.baseline,AT);bad.ledger.attempts[0].proof_sha='a'.repeat(64);h.after(bad);
  assert.equal((await h.run('Inspect')).outcome,'TASK_TRANSFER_OPERATOR_STOPPED_REQUIRES_READBACK');
});
test('all admission conditions are bound, not only the task or UI status',async()=>{
  const f=await fixture();assertAdmissionSnapshot(f.baseline.deployment,AT);
  for(const mutate of [s=>{s.subscription.current_period_end=AT;},s=>{s.admin.status='disabled';},s=>{s.environment.apply_enabled=1;},
    s=>{s.resource.generation=2;},s=>{s.operation.state='destroyed';},s=>{s.app.subscription_id='other';}]){
    const d=structuredClone(f.baseline.deployment);mutate(d.admissionSnapshot);assert.throws(()=>assertAdmissionSnapshot(d,AT));}
});
test('guard hash matches the original sealed-plan source without applying its DDL',async()=>{
  const sql=(await readFile(new URL('../ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const m=sql.match(/CREATE FUNCTION public\.guard_sealed_plan_reference_v1\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/);
  assert.equal(await sha256Hex(m[1]),JOB_GUARD_SHA256);
});
test('control layout must match owner, service isolation and all nine installed function bodies',async()=>{
  await assert.rejects(assertControlLayout({actor:'wrong'}, {functions:[]}, {ownerRole:'expected'}));
  const live=await readFile(new URL('../ops/platform-request-v6/transfer-live.mjs',import.meta.url),'utf8');
  assert.match(live,/options:''/);assert.match(live,/readAuthV6\(auth\)/);assert.match(live,/READ ONLY/);
  assert.doesNotMatch(live,/AWS|GetSecretValue|GRANT|\.env\.local/);
});
