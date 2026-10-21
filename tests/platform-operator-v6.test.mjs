import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,symlink,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {createTrustedPublisherV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {verifyCloudResultContent} from '../ops/platform-operations-v6/evidence.mjs';
import {S} from '../ops/platform-cloud-v6/contract.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {makeReview,verifyReview,intentName,LIMITS} from '../ops/platform-operator-v6/review.mjs';
import {inspectOnce,assertPolledRun} from '../ops/platform-operator-v6/inspect.mjs';
import {createInspectTransport,boundedJson} from '../ops/platform-operator-v6/live.mjs';
import {verifyBundle} from '../ops/platform-operator-v6/bundle.mjs';
import {parseArgs,main} from '../ops/platform-operator-v6/cli.mjs';
import {jsonFile,writeOnce,newDirectory,noLinks,evidenceRoot,within,ROOT} from '../ops/platform-operator-v6/files.mjs';
import {platformClosureV6} from '../ops/platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {load} from 'js-yaml';

async function fixture(){
  const f=await platformFixtureV6({installed:true}),pub=createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,
    frozenSourceCommit:f.frozenSourceCommit,ports:f.ports,now:f.now});
  const review=await f.observedPlan(f.basePlan,'123456789'),reviewRef=await f.resultFor(review.plan,'123456789');
  await pub.attestResult(review.planSha256,reviewRef);const plan=(await pub.publishSuccessor(review.planSha256,reviewRef)).plan,runId='123456790';
  const report={schema:'techlong/cloud-worker-run/v5',jobId:plan.jobId,manifestSha256:f.manifest.manifestSha256,run:f.run(runId),
    result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'},retryAllowed:false};
  const reportRef=await f.store(`worker-v5/${S.instanceId}/${plan.jobId}/${f.manifest.manifestSha256}/run-${runId}-1/run.json`,report);
  const execution=await f.store(`worker-v5/${S.instanceId}/${plan.jobId}/${f.manifest.manifestSha256}/execution-reference-${runId}-v1.json`,
    {executionRun:f.run(runId),executionReportReference:reportRef});
  const ref=await f.resultFor(plan,runId,{outcome:report.result.outcome,cloudReportReference:reportRef,executionReference:execution});
  const input={schema:'techlong/platform-operator-input/v6',plan,runId,resultReference:ref,
    keyPath:path.resolve(tmpdir(),'operator-synthetic-key.pem'),evidenceRoot:path.resolve(tmpdir(),'operator-synthetic-evidence')};
  const m=await makeReview({input,operatorSourceCommit:f.sourceCommit,createdAt:f.at,
    pins:Array.from({length:20},(_,n)=>({file:`synthetic/${n}.mjs`,sha256:'0'.repeat(64)})),
    key:{length:2000,mtimeMs:1,ctimeMs:1,identity:'synthetic',protectionSha256:'1'.repeat(64),contentRead:false}});
  const records=[],calls=[],inspectId='123456791';let inspectRef,inspectPlan;
  async function finish(p){
    inspectPlan=p;const body={schema:'techlong/cloud-worker-independent-inspect/v5',outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',jobId:plan.jobId,
      manifestSha256:f.manifest.manifestSha256,receiptSha256:'1'.repeat(64),providerObservationSha256:'2'.repeat(64),run:f.run(inspectId),executionRun:f.run(runId),
      journal:{state:'ALL_SLOTS_CONSUMED'},checkedAt:f.now(),retryAllowed:false,cloudWrites:0,databaseWrites:0,privateControlReads:0};
    const report=await f.store(`worker-v5/${S.instanceId}/${plan.jobId}/${f.manifest.manifestSha256}/run-${inspectId}-1/inspect.json`,
      {...body,inspectSha256:await sha256Hex(body)});
    inspectRef=await f.resultFor(p,inspectId,{outcome:body.outcome,cloudReportReference:report});return {runId:inspectId,url:`https://github.com/${S.repository}/actions/runs/${inspectId}`};
  }
  const io={deadline:f.at+LIMITS.runMs,guard:async()=>{calls.push('guard');},preflight:async()=>{calls.push('preflight');},claim:async()=>{calls.push('claim');},
    readRun:async id=>{calls.push('run:'+id);return f.rawRun(id);},readObject:f.ports.readObject,
    dispatch:async p=>{calls.push('dispatch');return finish(p);},discoverResult:async()=>inspectRef,
    record:async(name,value)=>{records.push({name,value});},close:async()=>{calls.push('close');}};
  return {...f,m,input,records,calls,io,finish,inspectId,getInspectRef:()=>inspectRef,getInspectPlan:()=>inspectPlan};
}
const run=f=>inspectOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now,sleep:async()=>{}});

test('48-hour public manifest is reproducible; changing any field invalidates approval',async()=>{
  const f=await fixture();assert.equal(f.m.expiresAt-f.m.createdAt,48*3600000);await verifyReview(f.m,f.m.manifestSha256,f.now(),true);
  for(const changed of [{...f.m,expiresAt:f.m.expiresAt+1},{...f.m,effects:{...f.m.effects,cloudResourceWrites:1}},
    {...f.m,key:{...f.m.key,length:1999}},{...f.m,input:{...f.input,extra:'no'}}])await assert.rejects(verifyReview(changed,f.m.manifestSha256,f.now()));
  const refreshed=await makeReview({...f.m,createdAt:f.at+1000});assert.notEqual(refreshed.manifestSha256,f.m.manifestSha256);
  assert.equal(intentName(refreshed),intentName(f.m),'refresh cannot reset the action slot');
});
for(const fault of ['approval','expired','lateStart','historical'])test('pre-port rejection: '+fault,async()=>{
  const f=await fixture();let approved=f.m.manifestSha256,at=f.now();
  if(fault==='approval')approved='0'.repeat(64);
  if(fault==='expired')at=f.m.expiresAt;
  if(fault==='lateStart')at=f.m.lastStartAt;
  if(fault==='historical'){f.m=await makeReview({...f.m,operatorSourceCommit:'a'.repeat(40)});approved=f.m.manifestSha256;}
  await assert.rejects(inspectOnce({manifest:f.m,approved,io:f.io,now:()=>at}));assert.deepEqual(f.calls,[]);
});
test('single Inspect executes original full content checks, announces exact environment URL and never writes a ledger',async()=>{
  const f=await fixture(),before=f.writes.length,result=await run(f);assert.equal(result.independentCloudAcceptanceVerified,true);
  assert.equal(result.platformLedgerWrites,0);assert.equal(result.proofImported,false);assert.equal(f.writes.length,before);
  assert.equal(f.calls.filter(v=>v==='claim').length,1);assert.equal(f.calls.filter(v=>v==='dispatch').length,1);
  const notice=f.records.find(r=>r.name==='awaiting-human-environment');assert.equal(notice.value.runId,f.inspectId);assert.equal(notice.value.requiresHumanApproval,true);
  assert.equal(f.calls.at(-1),'close');
});
for(const fault of ['preflight','claim','readRun','readObject','dispatch','discoverResult'])test('ambiguous '+fault+' is never retried or compensated',async()=>{
  const f=await fixture();let count=0;f.io[fault]=async()=>{count++;throw Error('provider diagnostic containing synthetic-sensitive-value');};
  const result=await run(f);assert.equal(result.retryAllowed,false);assert.equal(result.independentCloudAcceptanceVerified,false);assert.equal(count,1);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-sensitive/);assert.equal(f.calls.at(-1),'close');
  if(fault==='claim'){assert.equal(result.claimAttempted,true);assert.equal(result.claimed,false);}
});
test('unknown ACK preserves separately saved exact run and never polls or re-dispatches',async()=>{
  const f=await fixture();f.io.dispatch=async p=>{await f.finish(p);throw Error('cleanup failed');};
  f.io.knownAck=()=>({runId:f.inspectId,url:`https://github.com/${S.repository}/actions/runs/${f.inspectId}`});
  const r=await run(f);assert.equal(r.ack.runId,f.inspectId);assert.equal(f.calls.some(c=>c==='run:'+f.inspectId),false);
});
test('bounded waiting stops without a repeated dispatch; successful GitHub alone is not acceptance',async()=>{
  const f=await fixture();let reads=0;f.io.readRun=async id=>{if(id===f.input.runId)return f.rawRun(id);reads++;return {...f.rawRun(id),status:'waiting',conclusion:null};};
  const r=await run(f);assert.equal(reads,LIMITS.maxPolls);assert.equal(r.independentCloudAcceptanceVerified,false);assert.equal(f.calls.filter(x=>x==='dispatch').length,1);
});
for(const patch of [{run_attempt:2},{actor:{id:1}},{head_sha:'0'.repeat(40)},{referenced_workflows:[]},{status:'completed',conclusion:'failure'}])
  test('exact polling identity/status remains strict: '+Object.keys(patch)[0],async()=>{
    const f=await fixture();assert.throws(()=>assertPolledRun({...f.rawRun(f.inspectId),...patch},f.inspectId,f.sourceCommit));
  });

const pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
async function transportFixture(patch={}){
  const f=await fixture(),requests=[],events=[],permissions={actions:'write',contents:'read',metadata:'read'},account={id:Number(S.ownerId),login:'veinyyxy',type:'User'};
  let failGuard=false;
  const p={now:f.now,deadline:f.at+LIMITS.runMs,guard:async()=>{if(failGuard)throw Error('PLATFORM_OPERATOR_ACTIVE_WINDOW_EXPIRED');},
    source:{credentials:async()=>({}),close:async()=>{},counts:()=>({sourceCredentialLoads:1,sourceStsGets:1})},
    claim:async()=>{events.push('claim');},loadReadCredential:async()=>{events.push('credential');return 'synthetic-read-credential';},
    keyMetadata:async()=>f.m.key,readKey:async()=>{events.push('key');return pem;},record:async(name,value)=>{events.push(name);f.records.push({name,value});},
    dispose:async()=>{},getObject:f.ports.readObject,headObject:async key=>{
      assert.equal(key,f.getInspectRef().key);const o=f.objects.get(key);return {versionId:o.versionId,encryption:o.encryption,contentLength:o.contentLength,
        checksumSHA256:Buffer.from(f.getInspectRef().sha256,'hex').toString('base64')};},
    fetch:async(url,options)=>{
      const u=new URL(url),method=options.method;requests.push({path:u.pathname,method});assert.equal(u.origin,'https://api.github.com');assert.equal(options.redirect,'manual');
      if(u.pathname===patch.redirectPath)return new Response(null,{status:302,headers:{location:'https://must-not-follow.invalid'}});
      if(u.pathname==='/app')return Response.json({id:Number(S.appId),slug:'techlong-sandbox-controller',name:'Techlong Sandbox Controller',
        external_url:'https://github.com/'+S.repository,html_url:'https://github.com/apps/techlong-sandbox-controller',owner:account,permissions,events:[]});
      if(u.pathname===`/app/installations/${S.installationId}`)return Response.json({id:Number(S.installationId),app_id:Number(S.appId),app_slug:'techlong-sandbox-controller',
        account,target_id:Number(S.ownerId),target_type:'User',permissions,events:[],repository_selection:'selected',suspended_at:null});
      if(u.pathname.endsWith('/access_tokens'))return Response.json({token:'synthetic-installation-credential',permissions,expires_at:new Date(f.now()+3600000).toISOString()},{status:201});
      if(u.pathname==='/installation/token'){events.push('revoke');return new Response(null,{status:patch.revokeFails?503:204});}
      if(u.pathname==='/installation/repositories')return Response.json({total_count:1,repositories:[{id:Number(S.repositoryId),full_name:S.repository,owner:account}]});
      if(u.pathname==='/users/techlong-sandbox-controller%5Bbot%5D')return Response.json({id:Number(S.candidateBotId),login:'techlong-sandbox-controller[bot]',type:'Bot'});
      if(u.pathname.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:patch.wrongMain?'a'.repeat(40):f.sourceCommit}});
      if(u.pathname.endsWith('/actions/workflows/'+S.workflowFile))return Response.json({id:Number(B.platform.workflowId),state:'active',path:'.github/workflows/'+S.workflowFile});
      if(u.pathname.endsWith('/dispatches')){
        if(patch.unknownPost)throw Error('synthetic-sensitive-provider-diagnostic');
        if(patch.expireAfterPost)failGuard=true;
        return Response.json({workflow_run_id:Number(f.inspectId),html_url:`https://github.com/${S.repository}/actions/runs/${f.inspectId}`,
          run_url:`https://api.github.com/repos/${S.repository}/actions/runs/${f.inspectId}`});
      }
      if(u.pathname.includes('/actions/runs/'))return Response.json(f.rawRun(u.pathname.split('/').at(-1)));
      throw Error('UNEXPECTED_SYNTHETIC_ROUTE');
    },
  };
  const io=createInspectTransport(f.m,p),prior=await verifyCloudResultContent({plan:f.input.plan,runId:f.input.runId,run:f.rawRun(f.input.runId),
    resultReference:f.input.resultReference,release:f.release,sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,readObject:f.ports.readObject,now:f.now,deriveInspectPlan:true});
  return {...f,p,io,requests,events,inspectPlan:prior.derivedInspectPlan.plan};
}
test('actual App client through operator transport scopes one token/Inspect, saves ACK before revoke and prevents a second dispatch',async()=>{
  const f=await transportFixture();await f.io.preflight();await f.io.claim();await f.io.dispatch(f.inspectPlan);
  assert(f.events.indexOf('claim')<f.events.indexOf('credential'));assert(f.events.indexOf('dispatch-api-ack')<f.events.indexOf('revoke'));
  await assert.rejects(f.io.dispatch(f.inspectPlan));assert.equal(f.requests.filter(x=>x.path.endsWith('/dispatches')).length,1);
  assert(!f.requests.some(x=>/pending_deployments|rerun/.test(x.path)));await f.io.close();
});
for(const patch of [{revokeFails:true},{unknownPost:true},{wrongMain:true},{expireAfterPost:true},
  {redirectPath:'/app'},{redirectPath:`/repos/${S.repository}/actions/workflows/${S.workflowFile}/dispatches`}])
  test('live transport failure and cleanup protocol: '+Object.keys(patch)[0]+(patch.redirectPath??''),async()=>{
    const f=await transportFixture(patch);await f.io.claim();
    if(patch.expireAfterPost)await f.io.dispatch(f.inspectPlan);else await assert.rejects(f.io.dispatch(f.inspectPlan));
    assert(f.requests.filter(x=>x.path.endsWith('/dispatches')).length<=1);
    if(!patch.redirectPath?.endsWith('/app'))assert.equal(f.requests.filter(x=>x.path==='/installation/token').length,1);
    if(patch.revokeFails||patch.expireAfterPost)assert.equal(f.io.knownAck().runId,f.inspectId);await f.io.close();
  });
test('transport enforces exact object allowlist, digest, unique read cache and exact result HEAD',async()=>{
  const f=await transportFixture();await f.io.claim();await assert.rejects(f.io.readObject({...f.input.resultReference,key:'not-approved'}));
  let gets=0;f.p.getObject=async r=>{gets++;return f.ports.readObject(r);};
  await f.io.readObject(f.input.resultReference);await f.io.readObject(f.input.resultReference);assert.equal(gets,1);
  await f.io.dispatch(f.inspectPlan);await f.finish(f.inspectPlan);await f.io.discoverResult(f.inspectId);await assert.rejects(f.io.discoverResult(f.inspectId));await f.io.close();
});
test('full protocol using real transport and publisher produces a portable bundle; offline replay cannot claim authentication',async()=>{
  const f=await transportFixture(),dispatch=f.io.dispatch;f.io.dispatch=async p=>{await f.finish(p);return dispatch(p);};
  const r=await run(f);assert.equal(r.independentCloudAcceptanceVerified,true);
  const bundle=f.records.find(r=>r.name==='bundle').value,offline=await verifyBundle(bundle);
  assert.equal(offline.contentVerified,true);assert.equal(offline.candidateIndependentAcceptance,true);assert.equal(offline.independentCloudAcceptanceVerified,false);
  assert.equal(offline.runMetadataAuthenticated,false);assert.equal(offline.proofImported,false);
  const changed=structuredClone(bundle);changed.objects[0].object.value.password='synthetic-sensitive';await assert.rejects(verifyBundle(changed));
  const missing=structuredClone(bundle);missing.objects=[];await assert.rejects(verifyBundle(missing));
});
test('real offline CLI reads a synthetic portable bundle and exclusively writes an explicitly unauthenticated report',async()=>{
  const f=await transportFixture(),dispatch=f.io.dispatch;f.io.dispatch=async p=>{await f.finish(p);return dispatch(p);};await run(f);
  const directory=await mkdtemp(path.join(tmpdir(),'techlong-operator-test-'));
  try{
    const bundle=path.join(directory,'bundle.json'),output=path.join(directory,'offline.json'),messages=[];
    await writeOnce(bundle,f.records.find(r=>r.name==='bundle').value);
    await main(['verify-bundle','--bundle',bundle,'--output',output],v=>messages.push(v));
    assert.equal((await jsonFile(output)).runMetadataAuthenticated,false);assert.equal(messages.length,1);
    await assert.rejects(main(['verify-bundle','--bundle',bundle,'--output',output],()=>{}));
  }finally{assert.equal(path.dirname(directory),tmpdir());assert(path.basename(directory).startsWith('techlong-operator-test-'));await rm(directory,{recursive:true,force:true});}
});
test('bounded response rejects oversized bodies and never follows a redirect',async()=>{
  await assert.rejects(boundedJson(Response.json({value:'x'.repeat(100)}),20),/HTTP_SIZE/);
});
test('strict CLI rejects duplicates, unsupported modes and missing explicit readiness without acquiring clients',()=>{
  assert.deepEqual(parseArgs(['prepare','--input','input.json']).command,'prepare');
  for(const args of [[],['resume'],['inspect-once','--manifest','x'],['prepare','--input','x','--input','y'],['prepare','--endpoint','x']])assert.throws(()=>parseArgs(args));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-operator-v6/cli.mjs','resume'],{cwd:ROOT,encoding:'utf8',timeout:20000});
  assert.equal(r.status,1);assert.match(r.stderr,/OPERATOR_STOPPED_NO_RETRY/);assert.doesNotMatch(r.stderr,/stack|credential|BEGIN PRIVATE/i);
});
test('local receipts use exclusive writes, bounded reads and constrained roots',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'techlong-operator-test-'));
  try{
    const root=await evidenceRoot(directory),sub=await newDirectory(root,'synthetic'),file=path.join(sub,'receipt.json');
    await writeOnce(file,{value:1});assert.deepEqual(await jsonFile(file),{value:1});await assert.rejects(writeOnce(file,{value:2}));
    await assert.rejects(jsonFile(file,2));await assert.rejects(newDirectory(root,'../outside'));await assert.rejects(evidenceRoot(ROOT));
    assert.equal(within(root,path.join(root,'x')),true);assert.equal(within(root,path.resolve(root,'../x')),false);
  }finally{assert.equal(path.dirname(directory),tmpdir());assert(path.basename(directory).startsWith('techlong-operator-test-'));await rm(directory,{recursive:true,force:true});}
});
test('linked roots and linked ancestors are refused (Linux CI always exercises this)',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'techlong-operator-test-'));
  try{
    const target=path.join(directory,'target');await mkdir(target);const link=path.join(directory,'link');
    try{await symlink(target,link,process.platform==='win32'?'junction':'dir');}
    catch(e){if(process.platform==='win32'&&e.code==='EPERM'){t.skip('Windows sandbox denies test junction creation; CI tests real symlinks');return;}throw e;}
    await assert.rejects(noLinks(link));await assert.rejects(newDirectory(link,'child'));
  }finally{assert.equal(path.dirname(directory),tmpdir());assert(path.basename(directory).startsWith('techlong-operator-test-'));await rm(directory,{recursive:true,force:true});}
});
test('operator is not in either published cloud closure and No-AWS CI covers its real CLI/transport tests',async()=>{
  const c=await platformClosureV6();assert.equal(c.closureSha256,B.platform.closureSha256);assert.equal(c.pinCount,81);
  assert(!c.pins.some(p=>p.file.startsWith('ops/platform-operator-v6/')));
  const workflow=load(await readFile(new URL('../.github/workflows/platform-cloud-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(workflow.permissions,{contents:'read'});assert(workflow.on.push.paths.includes('ops/platform-operator-v6/**'));
  assert(workflow.jobs.candidate.steps.some(s=>s.run?.includes('tests/platform-operator-v6.test.mjs')));
});
