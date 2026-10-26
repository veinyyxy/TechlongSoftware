import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {recoveryControlFixture} from './fixtures/platform-recovery-control-v1.mjs';
import {createBoundRecoveryController} from '../ops/platform-recovery-control-v1/controller.mjs';
import {assertRecoveryBinding,assertRecoveryPublication,bindRecoveryPublication,RECOVERY_CONTROL_BINDING} from '../ops/platform-recovery-control-v1/binding.mjs';
import {verifyRecoveryContent} from '../ops/platform-recovery-control-v1/content.mjs';
import {followRecoveryRunOnce,verifyRecoveryFollowupReview,recoveryFollowupIntentName,RECOVERY_FOLLOWUP} from '../ops/platform-recovery-control-v1/followup.mjs';
import {createRecoveryInspectTransport} from '../ops/platform-recovery-control-v1/live.mjs';
import {parseRecoveryControlArgs} from '../ops/platform-recovery-control-v1/cli.mjs';
import {intentName} from '../ops/platform-operator-v6/review.mjs';
import {recoveryCloudClosure} from '../ops/platform-recovery-cloud-v1/closure.mjs';
import {S} from '../ops/platform-cloud-v6/contract.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
const run=(f,overrides={})=>followRecoveryRunOnce({manifest:f.m,approved:f.m.manifestSha256,basis:f.basis,binding:f.binding,io:f.io,now:f.now,sleep:async()=>{},rebuildPackage:f.rebuild,...overrides});

test('explicit candidate binding is closed before even public runtime values, ledger or key factories are read',async()=>{
  const candidate={schema:'techlong/recovery-control-binding/v1',state:'CANDIDATE'};
  let reads=0;const controller=createBoundRecoveryController({binding:candidate,read:()=>{reads++;throw Error('must stay closed');},fetch});
  const v=await controller.status(S.instanceId);assert.equal(v.enabled,false);assert.equal(controller.enabled(),false);assert.equal(reads,0);
  await assert.rejects(controller.act(S.instanceId,ADMIN,{}));await assert.rejects(assertRecoveryBinding(RECOVERY_CONTROL_BINDING));
});
test('current source binding without provisioned runtime stays disabled before database/key/network capabilities',async()=>{
  let privateReads=0,factories=0;const controller=createBoundRecoveryController({read:n=>{if(n.endsWith('DATABASE_URL')||n.endsWith('PRIVATE_KEY'))privateReads++;return undefined;},fetch,
    ledgerFactory:()=>{factories++;throw Error('no database capability');},githubFactory:()=>{factories++;throw Error('no GitHub capability');}});
  assert.equal(controller.enabled(),false);assert.equal((await controller.status(S.instanceId)).enabled,false);
  await assert.rejects(controller.act(S.instanceId,ADMIN,{}));assert.equal(privateReads+factories,0);
});

async function controllerFixture({publication=false}={}){
  const f=await recoveryControlFixture(),effects=[],action={operation:'approve_dispatch',planSha256:f.runPlan.planSha256,
    actionSha256:f.runPlan.actionSha256,riskSha256:f.release.riskSha256};
  const lease={schema:'techlong/platform-hosted-runtime-lease/v6',releaseSha256:await sha256Hex(f.release),origin:'https://console.sandbox.techlong.cloud',
    sourceCommit:f.sourceCommit,issuedAt:f.at,expiresAt:f.at+30*60000};
  const values={TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROL_HOSTED:'true',TECHLONG_PLATFORM_CONTROL_LOCAL:'false',
    TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify(lease),TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY:'synthetic-not-a-real-key'};
  let entry={...f.runPlan,riskSha256:f.release.riskSha256,attempt:null};
  const ledger={load:async()=>{effects.push('load');return entry;},begin:async()=>{effects.push('begin');},assertLive:async()=>{},
    acknowledge:async()=>{effects.push('ack');},unknown:async()=>{effects.push('unknown');},observe:async()=>{},status:async()=>[]};
  const compiled=publication?{...f.binding,sourceCommit:null,controllerCodeCommit:'a'.repeat(40),activation:{...f.binding.activation,sourceCommit:null}}:f.binding;
  const controller=createBoundRecoveryController({binding:compiled,now:f.now,read:n=>{if(n.endsWith('PRIVATE_KEY'))effects.push('key');return values[n];},fetch,
    ledgerFactory:()=>ledger,githubFactory:deps=>({dispatch:async(plan,before,onAck)=>{
      await deps.privateKey();await before();effects.push('dispatch');const ack={runId:'123456798',url:'https://github.com/'+S.repository+'/actions/runs/123456798'};
      await onAck(ack);return ack;}})});
  return {...f,controller,compiled,effects,action,values,lease,ledger,setEntry:v=>{entry=v;}};
}
test('bound controller retains V6 atomic approval before key access and exact source/job/package scope',async()=>{
  const f=await controllerFixture(),r=await f.controller.act(S.instanceId,ADMIN,f.action);
  assert.equal(r.outcome,'DISPATCH_ACKNOWLEDGED_REQUIRES_HUMAN_ENVIRONMENT_APPROVAL');assert(f.effects.indexOf('begin')<f.effects.indexOf('key'));
  assert.equal(f.effects.filter(v=>v==='dispatch').length,1);
  const g=await controllerFixture();g.setEntry({...g.runPlan,plan:{...g.runPlan.plan,jobId:g.oldJob.id},attempt:null});
  await assert.rejects(g.controller.act(S.instanceId,ADMIN,g.action));assert(!g.effects.includes('begin'));assert(!g.effects.includes('key'));
});
test('published descriptor avoids self-hash: runtime lease binds execution source without mutating source publication',async()=>{
  const f=await controllerFixture({publication:true});await assertRecoveryPublication(f.compiled);
  const effective=await bindRecoveryPublication(f.compiled,f.sourceCommit);assert.equal(effective.sourceCommit,f.sourceCommit);
  assert.equal(f.compiled.sourceCommit,null);assert.equal(f.compiled.activation.sourceCommit,null);
  const r=await f.controller.act(S.instanceId,ADMIN,f.action);assert.equal(r.runId,'123456798');assert(f.effects.indexOf('begin')<f.effects.indexOf('key'));
});
test('expired or mismatched runtime lease blocks before ledger/key acquisition',async()=>{
  const f=await controllerFixture();f.values.TECHLONG_PLATFORM_CONTROLLER_LEASE=JSON.stringify({...f.lease,releaseSha256:'0'.repeat(64)});
  await assert.rejects(f.controller.act(S.instanceId,ADMIN,f.action));assert.deepEqual(f.effects,[]);
  f.values.TECHLONG_PLATFORM_CONTROLLER_LEASE=JSON.stringify(f.lease);f.tick(30*60000);
  await assert.rejects(f.controller.act(S.instanceId,ADMIN,f.action));assert.deepEqual(f.effects,[]);
});
test('lease expiry after permanent begin prevents private key read and marks unknown without dispatch',async()=>{
  const f=await controllerFixture();f.ledger.begin=async()=>{f.effects.push('begin');f.tick(30*60000);};
  await assert.rejects(f.controller.act(S.instanceId,ADMIN,f.action));assert(f.effects.includes('begin'));assert(f.effects.includes('unknown'));
  assert(!f.effects.includes('key'));assert(!f.effects.includes('dispatch'));
});

test('content bridge derives Inspect entirely in memory; cannot claim persisted ledger acceptance',async()=>{
  const f=await recoveryControlFixture(),writes=f.writes.length;
  const v=await verifyRecoveryContent({binding:f.binding,basis:f.basis,plan:f.input.plan,runId:f.input.runId,run:f.rawRun(f.input.runId),
    resultReference:f.ref,readObject:f.ports.readObject,deriveInspectPlan:true,now:f.now,rebuildPackage:f.rebuild});
  assert.equal(v.derivedInspectPlan.plan.mode,'Inspect');assert.equal(v.physicalOwnerWrites,0);assert.equal(v.platformLedgerVerified,false);
  assert.equal(v.proofImported,false);assert.equal(f.writes.length,writes);
});
test('bounded followup waits for exact successful RunOnce, dispatches Inspect once and verifies new-protocol content',async()=>{
  const f=await recoveryControlFixture();await verifyRecoveryFollowupReview(f.m,f.m.manifestSha256,f.basis,f.binding,f.now(),true);
  let reads=0;f.io.readRun=async id=>id===f.input.runId&&reads++===0?
    {...f.rawRun(id),status:'in_progress',conclusion:null}:f.rawRun(id);
  const r=await run(f);assert.equal(r.independentCloudAcceptanceVerified,true);assert.equal(r.inspectRunId,f.inspectId);
  assert.equal(r.platformLedgerWrites,0);assert.equal(r.proofImported,false);assert.equal(f.effects.filter(e=>e==='dispatch').length,1);
  assert.equal(f.effects.filter(e=>e==='claim').length,1);assert.equal(f.effects.at(-1),'close');
  assert.equal(f.records.find(v=>v.name==='awaiting-human-environment').value.requiresHumanApproval,true);
  assert.equal(recoveryFollowupIntentName(f.m),intentName(f.m));
});
for(const fault of ['sha','expired','late','binding','source'])test('invalid '+fault+' approval has no IO side effects',async()=>{
  const f=await recoveryControlFixture(),overrides={};
  if(fault==='sha')overrides.approved='0'.repeat(64);if(fault==='expired')f.tick(f.m.expiresAt-f.at);
  if(fault==='late')f.tick(f.m.lastStartAt-f.at);if(fault==='binding')overrides.binding={...f.binding,state:'CANDIDATE'};
  if(fault==='source')overrides.manifest={...f.m,operatorSourceCommit:'0'.repeat(40)};
  await assert.rejects(run(f,overrides));assert.deepEqual(f.effects,[]);
});
for(const fault of ['preflight','claim','discoverExecutionResult','dispatch','discoverResult'])test('failure at '+fault+' stops once, sanitizes and closes',async()=>{
  const f=await recoveryControlFixture();let n=0;f.io[fault]=async()=>{n++;throw Error('synthetic-sensitive-diagnostic');};
  const r=await run(f);assert.equal(r.retryAllowed,false);assert.equal(r.independentCloudAcceptanceVerified,false);assert.equal(n,1);
  assert(!JSON.stringify(r).includes('synthetic-sensitive-diagnostic'));assert.equal(f.effects.at(-1),'close');
});
test('late content, failed RunOnce or unknown ACK never triggers another dispatch',async()=>{
  const f=await recoveryControlFixture();f.io.readRun=async id=>({...f.rawRun(id),conclusion:'failure'});
  const failed=await run(f);assert.equal(failed.independentCloudAcceptanceVerified,false);assert(!f.effects.includes('dispatch'));
  const g=await recoveryControlFixture();g.io.discoverExecutionResult=async()=>{g.tick(26*60000);return g.ref;};
  const late=await run(g);assert.equal(late.independentCloudAcceptanceVerified,false);assert(!g.effects.includes('dispatch'));
  const h=await recoveryControlFixture();h.io.dispatch=async plan=>{await h.finish(plan);throw Error('cleanup unknown');};
  h.io.knownAck=()=>({runId:h.inspectId,url:'https://github.com/'+S.repository+'/actions/runs/'+h.inspectId});
  const unknown=await run(h);assert.equal(unknown.ack.runId,h.inspectId);assert(!h.effects.includes('run:'+h.inspectId));
});

test('real shared transport handles outer/inner references, one token/Inspect and cleanup without changing old V6 defaults',async()=>{
  const f=await recoveryControlFixture(),requests=[],heads=[],records=[],pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const permissions={actions:'write',contents:'read',metadata:'read'},account={id:Number(S.ownerId),login:'veinyyxy',type:'User'};
  const io=createRecoveryInspectTransport(f.m,{now:f.now,deadline:f.at+RECOVERY_FOLLOWUP.runMs,guard:async()=>{},
    source:{credentials:async()=>({}),close:async()=>{},counts:()=>({})},keyMetadata:async()=>f.m.key,readKey:async()=>pem,
    claim:async()=>{},loadReadCredential:async()=>'synthetic-read-credential',dispose:async()=>{},record:async(name,value)=>{records.push({name,value});},
    getObject:f.ports.readObject,headObject:async key=>{heads.push(key);const o=f.objects.get(key);return {versionId:o.versionId,encryption:o.encryption,
      contentLength:o.contentLength,checksumSHA256:Buffer.from(await sha256Hex(o.value),'hex').toString('base64')};},
    fetch:async(url,options)=>{const p=new URL(url).pathname;requests.push({path:p,method:options.method});
      if(p==='/app')return Response.json({id:Number(S.appId),slug:'techlong-sandbox-controller',name:'Techlong Sandbox Controller',external_url:'https://github.com/'+S.repository,
        html_url:'https://github.com/apps/techlong-sandbox-controller',owner:account,permissions,events:[]});
      if(p===`/app/installations/${S.installationId}`)return Response.json({id:Number(S.installationId),app_id:Number(S.appId),app_slug:'techlong-sandbox-controller',
        account,target_id:Number(S.ownerId),target_type:'User',permissions,events:[],repository_selection:'selected',suspended_at:null});
      if(p.endsWith('/access_tokens'))return Response.json({token:'synthetic-installation-token',permissions,expires_at:new Date(f.now()+3600000).toISOString()},{status:201});
      if(p==='/installation/token')return new Response(null,{status:204});
      if(p==='/installation/repositories')return Response.json({total_count:1,repositories:[{id:Number(S.repositoryId),full_name:S.repository,owner:account}]});
      if(p==='/users/techlong-sandbox-controller%5Bbot%5D')return Response.json({id:Number(S.candidateBotId),login:'techlong-sandbox-controller[bot]',type:'Bot'});
      if(p.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:f.sourceCommit}});
      if(p.endsWith('/actions/workflows/'+S.workflowFile))return Response.json({id:Number(f.release.workflowId),state:'active',path:'.github/workflows/'+S.workflowFile});
      if(p.endsWith('/dispatches')){const inputs=JSON.parse(options.body).inputs;assert.equal(inputs.mode,'Inspect');await f.finish({...f.input.plan,mode:'Inspect',inputs});
        return Response.json({workflow_run_id:Number(f.inspectId),html_url:`https://github.com/${S.repository}/actions/runs/${f.inspectId}`,
          run_url:`https://api.github.com/repos/${S.repository}/actions/runs/${f.inspectId}`});}
      if(p.includes('/actions/runs/'))return Response.json(f.rawRun(p.split('/').at(-1)));throw Error('UNEXPECTED_SYNTHETIC_ROUTE');
    }},f.binding);
  f.io=io;const r=await run(f);assert.equal(r.independentCloudAcceptanceVerified,true);assert.equal(heads.length,2);
  assert.equal(requests.filter(v=>v.path.endsWith('/dispatches')).length,1);assert.equal(requests.filter(v=>v.path==='/installation/token').length,1);
  assert(!requests.some(v=>/pending_deployments|rerun/.test(v.path)));
  const counts=records.find(v=>v.name==='capability-counts').value;assert.equal(counts.s3VersionedGets,8);assert.equal(counts.inspectDispatches,1);assert.equal(counts.keyReads,1);
});

test('CLI rejects scope overrides and default check performs no private/network actions; both cloud closures stay pinned',async()=>{
  assert.equal(parseRecoveryControlArgs(['--check']).command,'check');assert.throws(()=>parseRecoveryControlArgs(['prepare-followup','--input','x','--profile','owner']));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-recovery-control-v1/cli.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0);const v=JSON.parse(r.stdout);assert.equal(v.state,RECOVERY_CONTROL_BINDING.state);assert.equal(v.privateReads+v.awsCalls+v.sqlConnections+v.dispatches,0);
  if(v.state==='PUBLISHED'){
    await assertRecoveryPublication(RECOVERY_CONTROL_BINDING);
    assert.equal(RECOVERY_CONTROL_BINDING.release.reusableCommit,'4c09548ab9852a4f3e948f0686f8c81251cda73b');
    assert.equal(RECOVERY_CONTROL_BINDING.packageReference.versionId,'Zz5fH5Javs900ZrmMrgi3QhBzFbCNkPm');
    assert.equal(RECOVERY_CONTROL_BINDING.sourceCommit,null);assert.equal(RECOVERY_CONTROL_BINDING.activation.sourceCommit,null);
  }
  const c=await recoveryCloudClosure();assert.equal(c.closureSha256,'30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374');assert.equal(c.pinCount,97);
  assert.equal(c.previousPlatformClosureSha256,'828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a');
  const ci=load(await readFile(new URL('../.github/workflows/platform-cloud-candidate.yml',import.meta.url),'utf8'));assert.deepEqual(ci.permissions,{contents:'read'});
  const runtime=await readFile(new URL('../lib/deployments/controller-v6/runtime.ts',import.meta.url),'utf8');
  assert(runtime.includes('recoverySelected?recovery.act:controller.act'));assert(runtime.includes('getPlatformControlRiskFile'));
  const panel=await readFile(new URL('../components/admin/DeploymentControlPanel.tsx',import.meta.url),'utf8');assert(panel.includes('${p.sourceCommit}/${riskFile}'));
});
