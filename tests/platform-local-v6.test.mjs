import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {L,BINDINGS,makeLocalReviewV6,verifyLocalReviewV6,localLeaseV6,childEnvironmentV6,startLocalOnceV6} from '../ops/platform-local-v6/plan.mjs';
import {runChildV6,viteOptionsV6} from '../ops/platform-local-v6/child.mjs';
const now=Date.parse('2026-10-20T20:00:00Z');
async function fixture(){const sourceCommit='a'.repeat(40),metadata={
  source:{Account:'402010193138',Arn:L.sourceArn,UserId:L.sourceUserId},secret:{arn:L.secretArn,versionId:L.versionId,current:true,sourceOnlyPolicyMatched:true},
  key:{protectedThreePrincipalAcl:true,keyContentRead:false,length:1675,aclSha256:'b'.repeat(64)},auth:{contentRead:false,length:200,aclSha256:'c'.repeat(64)},portFree:true};
  const m=await makeLocalReviewV6({sourceCommit,pins:Array.from({length:12},(_,i)=>({file:'test-'+i,sha256:'d'.repeat(64)})),
    ci:{sourceCommit,status:'completed',conclusion:'success',attempt:1},metadata,createdAt:now});
  const events=[];let used=false,clock=now,fail;
  const step=name=>{events.push(name);if(fail===name)throw Error('DO_NOT_LOG_PRIVATE_PROVIDER_DATA');};
  const io={assertSource:async()=>step('source'),metadata:async()=>{step('metadata');return metadata;},claim:async()=>{assert.equal(used,false);used=true;step('slot');},
    readSecret:async()=>{step('secret');return 'synthetic-dedicated-url';},readKey:async()=>{step('key');return 'synthetic-test-key';},
    readAuth:async()=>{step('auth');return 'synthetic-auth-url';},serve:async(_material,lease,ready)=>{step('serve');await ready({origin:lease.origin,childPid:1});return {childExited:true,portFree:true,cleanClose:true};},
    record:async(name,value)=>{step(name);assert.doesNotMatch(JSON.stringify(value),/synthetic-|PRIVATE_PROVIDER_DATA/);}};
  return {m,metadata,events,io,fail:v=>{fail=v;},time:v=>{clock=v;},run:()=>startLocalOnceV6({manifest:m,approved:m.manifestSha256,io,now:()=>clock})};}
test('exact 48h review is public metadata only and cannot authorize task, cloud write or token by itself',async()=>{
  const f=await fixture();await verifyLocalReviewV6(f.m,f.m.manifestSha256,now);assert.equal(f.m.expiresAt-now,48*3600000);
  assert.equal(f.m.runMs,30*60000);assert.equal(f.m.effects.businessRequestEntryEnabled,false);
  for(const k of ['awsWrites','automaticSqlConnections','automaticAppTokens','automaticDispatches','automaticRetries'])assert.equal(f.m.effects[k],0);
  for(const [sha,t] of [['bad',now],[f.m.manifestSha256,f.m.expiresAt-1800000],[f.m.manifestSha256,now-1]])
    await assert.rejects(verifyLocalReviewV6(f.m,sha,t));
  await assert.rejects(verifyLocalReviewV6({...f.m,effects:{...f.m.effects,awsWrites:1}},f.m.manifestSha256,now));
  await verifyLocalReviewV6(f.m,undefined,f.m.expiresAt+1,true);
});
test('source identity, fixed version, key ACL, port drift and expired CI reject before any private read',async()=>{
  const f=await fixture();for(const change of [m=>m.metadata.source.UserId='wrong',m=>m.metadata.key.protectedThreePrincipalAcl=false,
    m=>m.metadata.secret.versionId='wrong',m=>m.metadata.portFree=false,m=>m.ci.conclusion='failure']){
    const m=structuredClone(f.m);change(m);await assert.rejects(makeLocalReviewV6(m));
  }
  f.io.metadata=async()=>({...f.metadata,portFree:false});await assert.rejects(f.run());assert.ok(!f.events.includes('slot'));assert.ok(!f.events.includes('secret'));
});
test('permanent slot precedes one Secret/key/auth read and one serve, followed by public receipts only',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.outcome,'LOCAL_RUNTIME_STOPPED_REQUIRES_INDEPENDENT_INSPECT');
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('secret'));assert.deepEqual(f.events.filter(n=>['secret','key','auth','serve'].includes(n)),['secret','key','auth','serve']);
  assert.ok(f.events.indexOf('started')<f.events.indexOf('result'));await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='secret').length,1);
});
test('private/provider/child/receipt failures never reread, restart, return private error or reset the slot',async()=>{
  for(const phase of ['secret','key','auth','serve','started']){const f=await fixture();f.fail(phase);const r=await f.run();
    assert.equal(r.outcome,'LOCAL_RUNTIME_STOPPED_OR_UNKNOWN_INSPECT_ONLY');assert.equal(r.retryAllowed,false);
    assert.doesNotMatch(JSON.stringify(r),/PRIVATE_PROVIDER_DATA/);for(const n of ['secret','key','auth','serve'])assert.ok(f.events.filter(x=>x===n).length<=1);
  }
});
test('a startup deadline hit after one private read does not proceed to the next read or child',async()=>{
  const f=await fixture();f.io.readSecret=async()=>{f.events.push('secret');f.time(now+120000);return 'private';};
  assert.equal((await f.run()).outcome,'LOCAL_RUNTIME_STOPPED_OR_UNKNOWN_INSPECT_ONLY');assert.ok(!f.events.includes('key'));assert.ok(!f.events.includes('serve'));
});
test('only OS plumbing and exact private runtime bindings enter child, never inherited AWS/Git/Node/VITE overrides',async()=>{
  const f=await fixture(),lease=await localLeaseV6(f.m,now),env=childEnvironmentV6({SystemRoot:'OS',PATH:'system-path',AWS_SECRET_ACCESS_KEY:'no',GITHUB_TOKEN:'no',NODE_OPTIONS:'no',
    VITE_PRIVATE_KEY:'no',CLOUDFLARE_ENV:'wrong',TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY:'wrong',AWS_APPLY_ENABLED:'true'},
  {authUrl:'auth',databaseUrl:'dedicated',privateKey:'key'},lease);
  for(const k of ['AWS_SECRET_ACCESS_KEY','GITHUB_TOKEN','NODE_OPTIONS','VITE_PRIVATE_KEY','CLOUDFLARE_ENV'])assert.equal(env[k],undefined);
  assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,'key');assert.equal(env.DEPLOYMENT_WORKER_ENABLED,'false');assert.equal(env.AWS_APPLY_ENABLED,'false');
  assert.equal(env.AWS_INITIALIZED_REQUESTS_ENABLED,'false');assert.equal(JSON.parse(env.TECHLONG_PLATFORM_CONTROLLER_LEASE).expiresAt-now,1800000);
});
test('dedicated Vite configuration cannot load root config/env, expose keys as vars, enable tunnel/remote bindings or publish Sites',async()=>{
  const options=viteOptionsV6('/fixture',[]),worker=JSON.parse(await readFile(new URL('../ops/platform-local-v6/worker.json',import.meta.url),'utf8'));
  assert.equal(options.configFile,false);assert.equal(options.envFile,false);assert.equal(options.envDir,false);assert.equal(options.server.host,'127.0.0.1');
  assert.equal(options.server.port,3100);assert.equal(options.server.strictPort,true);assert.equal(options.server.hmr,false);assert.equal(options.server.cors,false);
  assert.ok(options.server.fs.deny.includes('**/*.pem'));assert.deepEqual(worker.secrets.required,[...BINDINGS]);assert.equal(worker.vars,undefined);
  const child=await readFile(new URL('../ops/platform-local-v6/child.mjs',import.meta.url),'utf8');assert.doesNotMatch(child,/config\.vars\s*=|sites\(|process\.env\s*\}/);
  assert.match(child,/persistState:false,inspectorPort:false,remoteBindings:false/);assert.match(child,/tunnel:false/);
});
test('actual installed Wrangler loads only synthetic process secrets from the dedicated config directory',()=>{
  const script="import {unstable_getVarsForDev} from 'wrangler';import assert from 'node:assert/strict';const names=JSON.parse(process.argv[1]);for(const name of names)process.env[name]='synthetic-ci-value';const vars=unstable_getVarsForDev(process.argv[2],undefined,{},undefined,true,{required:names});assert.deepEqual(Object.keys(vars).sort(),[...names].sort());assert.ok(Object.values(vars).every(v=>v.type==='secret_text'&&v.value==='synthetic-ci-value'));console.log('SYNTHETIC_BINDINGS_VERIFIED');";
  const output=execFileSync(process.execPath,['--input-type=module','-e',script,JSON.stringify([...BINDINGS]),new URL('../ops/platform-local-v6/worker.json',import.meta.url).pathname.replace(/^\/(.:)/,'$1')],
    {cwd:new URL('../',import.meta.url),env:childEnvironmentV6(process.env,{authUrl:'synthetic',databaseUrl:'synthetic',privateKey:'synthetic'},{}),encoding:'utf8',timeout:30000});
  assert.match(output,/SYNTHETIC_BINDINGS_VERIFIED/);assert.doesNotMatch(output,/postgres|BEGIN RSA|SecretString/);
});
test('child sends ready only after exact listen, closes once on timer/signal, and reports after awaited close',async()=>{
  const events=[];let request,deadline;const result=await runChildV6({now:()=>now,expiresAt:now+1800000,
    onStop:fn=>{request=fn;return()=>events.push('detach');},schedule:fn=>{deadline=fn;return 1;},cancel:()=>events.push('cancel'),
    create:async()=>({listen:async()=>events.push('listen'),httpServer:{address:()=>({address:'127.0.0.1',port:3100})},close:async()=>{await Promise.resolve();events.push('close');}}),
    send:v=>{events.push(v.type);if(v.type==='ready'){deadline();request();}}});
  assert.equal(result.clean,true);assert.deepEqual(events.filter(x=>['listen','ready','close','stopped'].includes(x)),['listen','ready','close','stopped']);
  assert.equal(events.filter(x=>x==='close').length,1);
});
test('stop during asynchronous child creation closes eventual server without ready/listen; wrong listener closes too',async()=>{
  for(const early of [true,false]){const events=[];let request;
    await assert.rejects(runChildV6({now:()=>now,expiresAt:now+1800000,schedule:()=>1,cancel:()=>{},onStop:fn=>{request=fn;return()=>{};},
      create:async()=>{if(early)request();return {listen:async()=>events.push('listen'),httpServer:{address:()=>({address:'0.0.0.0',port:3100})},close:async()=>events.push('close')};},
      send:v=>events.push(v.type)}));
    assert.ok(!events.includes('ready'));assert.equal(events.filter(x=>x==='close').length,1);if(early)assert.ok(!events.includes('listen'));
  }
});
