import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PostgresReleaseRepository,ReleaseRequestRejected} from '../lib/deployments/releases/repository.ts';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {releaseFixture,h} from './instance-release-fixture.ts';

// Never falls back to DATABASE_URL or local/production configuration. No DROP/reset/cleanup SQL.
const testUrl=process.env.INSTANCE_RELEASE_TEST_DATABASE_URL;
test('release native PostgreSQL 16: draft DDL, narrow roles, real row-lock claim and verified CAS outcomes', {skip:!testUrl,timeout:30000},async t=>{
 const url=new URL(testUrl);
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/instance_release_ci');assert.equal(url.username,'postgres');
 const clients=[];
 const connect=async(name,role)=>{const c=new pg.Client({connectionString:testUrl,application_name:name,statement_timeout:5000});await c.connect();clients.push(c);if(role)await c.query('SET ROLE '+role);return c;};
 try{
  const admin=await connect('release-native-admin');
  const pre=await admin.query("select current_database() as db,current_setting('server_version_num')::int as version,(select count(*)::int from pg_catalog.pg_tables where schemaname not in ('pg_catalog','information_schema')) as tables");
  assert.equal(pre.rows[0].db,'instance_release_ci');assert.ok(pre.rows[0].version>=160000&&pre.rows[0].version<170000);assert.equal(pre.rows[0].tables,0);
  assert.equal((await admin.query("select count(*)::int as n from pg_catalog.pg_roles where rolname like 'deployment_release_%'")).rows[0].n,0);
  await admin.query(await readFile(new URL('../ops/releases/schema.draft.sql',import.meta.url),'utf8'));
  await admin.query(await readFile(new URL('../ops/releases/grants.draft.sql',import.meta.url),'utf8'));
  const f=await releaseFixture(),p=f.plan;
  p.observedAt=Date.now();p.preparedAt=p.observedAt;p.writeBefore=p.observedAt+300000;const sha=await sha256Hex(p);
  const document=(id,version,imageUri,platformDigest)=>({id,version,productId:p.productId,component:'tenant_api',status:'ecr_verified',
   source:{repository:p.to.sourceRepository,commit:p.to.sourceCommit,buildRunId:p.to.buildRunId,buildAttempt:1,artifactSha256:p.to.artifactSha256},
   image:{repository:imageUri.split('@')[0],manifestDigest:imageUri.split('@')[1],platformDigest,verificationSha256:p.to.imageVerificationSha256,runtimePlatform:'linux/amd64'}});
  for(const d of [document(p.from.releaseId,'1.0.0',p.from.imageUri,p.from.platformDigest),document(p.to.releaseId,p.to.version,p.to.imageUri,p.to.platformDigest)]){
   await admin.query('insert into deployment_release.releases(id,product_id,component,version,status,document) values($1,$2,$3,$4,$5,$6::jsonb)',[d.id,d.productId,d.component,d.version,d.status,canonicalJson(d)]);
  }
  const binding={instanceId:p.selection.instanceId,workspaceId:p.selection.workspaceId,environmentId:p.selection.environmentId,productId:p.productId,
   status:'active',initialized:true,stackId:p.changeSet.StackName,templateSha256:p.templateSha256,configurationSha256:p.configurationSha256};
  await admin.query('insert into deployment_release.instance_state(instance_id,binding,current_release_id,revision) values($1,$2::jsonb,$3,$4)',[binding.instanceId,canonicalJson(binding),p.from.releaseId,p.expectedStateRevision]);
  const plannerClient=await connect('release-native-planner','deployment_release_planner'),writer=await connect('release-native-writer','deployment_release_executor'),
   verifierClient=await connect('release-native-verifier','deployment_release_verifier'),contender=await connect('release-native-contender','deployment_release_executor');
  const planner=new PostgresReleaseRepository(plannerClient),executor=new PostgresReleaseRepository(writer),verifier=new PostgresReleaseRepository(verifierClient),other=new PostgresReleaseRepository(contender);
  await t.test('runtime roles cannot write tables/self-attest/claim as verifier; PUBLIC cannot call functions',async()=>{
   for(const statement of ["update deployment_release.instance_state set revision=999", "select deployment_release.record_inspection('none','{}'::jsonb)"]){await assert.rejects(writer.query(statement),e=>e.code==='42501');}
   await assert.rejects(verifierClient.query("select deployment_release.claim_request('none','none','1',1,'synthetic-token')"),e=>e.code==='42501');
   await assert.rejects(plannerClient.query("select deployment_release.stop_request('none','none','BLOCKED','TEST')"),e=>e.code==='42501');
   await admin.query('CREATE ROLE release_ci_public NOLOGIN');await admin.query('SET ROLE release_ci_public');
   await assert.rejects(admin.query("select deployment_release.read_request('none')"),e=>e.code==='42501');await admin.query('RESET ROLE');
  });
  const prepared=await planner.prepare(p,sha);assert.equal(prepared.status,'AWAITING_APPROVAL');assert.equal(prepared.planSha256,sha);
  await t.test('claim uses a real instance-row lock; waiting claimant cannot replay after first commit',async()=>{
   await writer.query('BEGIN');const first=await executor.claim(p,sha,'1000',1,'native-token-00000001');assert.equal(first.status,'CLAIMED');
   const pid=(await contender.query('select pg_backend_pid() as pid')).rows[0].pid;
   let settled=false;const waiting=other.claim(p,sha,'1001',1,'native-token-00000002').then(value=>{settled=true;return{value};},error=>{settled=true;return{error};});
   let locked=false;
   for(let i=0;i<20&&!locked;i++){locked=(await admin.query("select wait_event_type='Lock' as locked from pg_stat_activity where pid=$1",[pid])).rows[0]?.locked===true;if(!locked)await new Promise(resolve=>setTimeout(resolve,25));}
   assert.equal(locked,true);assert.equal(settled,false);await writer.query('COMMIT');
   const second=await waiting;assert.ok(second.error instanceof ReleaseRequestRejected);assert.equal(second.error.message,'RELEASE_CLAIM_CONFLICT');
  });
  const claim={requestId:p.selection.requestId,token:'native-token-00000001'};
  const progress=async(plan,token,run)=>{
   const c={requestId:plan.selection.requestId,token};await executor.operation(c,'create','INTENT',h('a'));await executor.operation(c,'create','ACK',h('a'),f.changeSetId);
   await executor.operation(c,'execute','INTENT',h('b'));await executor.operation(c,'execute','ACK',h('b'),f.changeSetId);
   return{requestId:c.requestId,planSha256:await sha256Hex(plan),runId:run,runAttempt:1,stackId:plan.changeSet.StackName,releaseId:plan.to.releaseId,
    imageUri:plan.to.imageUri,platformDigest:plan.to.platformDigest,templateSha256:plan.templateSha256,configurationSha256:plan.configurationSha256,
    result:'SUCCEEDED',changeSetId:f.changeSetId,serviceArn:'synthetic-service',taskDefinitionArn:'synthetic-definition',observedAt:Date.now(),runtimeSha256:h('c'),
    evidence:{bucket:'ci-evidence',key:'synthetic/proof',versionId:'ci-fixed-version',sha256:h('d')}};
  };
  await t.test('only the verifier proof permits one CAS advance, then NO_CHANGE is persisted without an executable plan',async()=>{
   const proof=await progress(p,claim.token,'1000');await assert.rejects(executor.complete(claim),ReleaseRequestRejected);
   await verifier.recordInspection(proof);assert.equal((await executor.complete(claim)).status,'SUCCEEDED');
   const state=await executor.context(binding.instanceId);assert.equal(state.binding.stateRevision,4);assert.equal(state.binding.currentRelease.id,p.to.releaseId);assert.equal(state.activeRequestId,null);
   await assert.rejects(executor.complete(claim),ReleaseRequestRejected);
   const decision=await planner.recordDecision({schema:'techlong/instance-release-decision/v1',selection:{...p.selection,requestId:'native_no_change'},status:'NO_CHANGE',reason:'ALREADY_VERIFIED_IMAGE',expectedStateRevision:4,currentReleaseId:p.to.releaseId});
   assert.equal(decision.status,'NO_CHANGE');assert.equal(decision.plan,null);
  });
  await t.test('verified rollback retains old version and invalidates revision; failed verification retains the active fence',async()=>{
   for(const result of ['FAILED_ROLLED_BACK_VERIFIED','FAILED_NEEDS_INSPECTION']){
    const context=await executor.context(binding.instanceId),next=structuredClone(p);next.selection.requestId='native_'+result.toLowerCase();next.selection.releaseId=p.from.releaseId;
    next.expectedStateRevision=context.binding.stateRevision;next.from={releaseId:p.to.releaseId,imageUri:p.to.imageUri,platformDigest:p.to.platformDigest};
    Object.assign(next.to,{releaseId:p.from.releaseId,version:'1.0.0',imageUri:p.from.imageUri,platformDigest:p.from.platformDigest});
    next.changeSet.Parameters=next.changeSet.Parameters.map(v=>v.ParameterKey==='ImageUri'?{ParameterKey:'ImageUri',ParameterValue:next.to.imageUri}:v);
    const digest=await sha256Hex(next),token='native-token-'+result;await planner.prepare(next,digest);await executor.claim(next,digest,'2000',1,token);
    const proof=await progress(next,token,'2000');Object.assign(proof,{result,releaseId:next.from.releaseId,imageUri:next.from.imageUri,platformDigest:next.from.platformDigest});
    await verifier.recordInspection(proof);assert.equal((await executor.complete({requestId:next.selection.requestId,token})).status,result);
    const after=await executor.context(binding.instanceId);assert.equal(after.binding.currentRelease.id,p.to.releaseId);assert.equal(after.binding.stateRevision,5);
    assert.equal(after.activeRequestId,result==='FAILED_NEEDS_INSPECTION'?next.selection.requestId:null);
   }
  });
 }finally{await Promise.all(clients.map(c=>c.end()));}
});
