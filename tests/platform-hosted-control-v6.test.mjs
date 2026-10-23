import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {CLOSED_BINDINGS,serverOptions} from '../ops/platform-hosting-v1/contract.mjs';
import {PUBLIC_ORIGIN} from '../ops/platform-hosting-v1/ingress.mjs';
import {prepareHostedControl,installHostedControl,hostedControlBinding,PRIVATE_CONTROL_BINDINGS} from '../ops/platform-hosting-v1/control-runtime.mjs';

const at=Date.parse('2026-10-23T14:00:00Z');
async function fixture(){
  const lease={schema:'techlong/platform-hosted-runtime-lease/v6',origin:PUBLIC_ORIGIN,sourceCommit:'a'.repeat(40),
    releaseSha256:await sha256Hex(B.platform),issuedAt:at,expiresAt:at+1800000};
  const env={TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN,
    TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROL_LOCAL:'false',TECHLONG_PLATFORM_CONTROL_HOSTED:'true',
    TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify(lease),TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT:lease.sourceCommit};
  let reads=0,clock=at;
  for(const name of PRIVATE_CONTROL_BINDINGS)Object.defineProperty(env,name,{enumerable:true,get(){reads++;return 'synthetic-only-'+name;}});
  return {env,lease,reads:()=>reads,now:()=>clock,time:t=>{clock=t;}};
}

test('explicit hosted preparation validates public context before lazily supplying each private binding once',async()=>{
  const f=await fixture(),c=await prepareHostedControl(f.env,{now:f.now});assert.equal(f.reads(),0);
  assert(Object.isFrozen(c)&&Object.isFrozen(c.lease));assert.equal(c.policy.origin,PUBLIC_ORIGIN);
  assert.equal(c.read('TECHLONG_PLATFORM_CONTROL_HOSTED'),'true');
  for(const name of PRIVATE_CONTROL_BINDINGS){assert.match(c.read(name),/^synthetic-only-/);assert.equal(c.read(name),c.read(name));}
  assert.equal(f.reads(),2);c.close();for(const name of PRIVATE_CONTROL_BINDINGS)assert.equal(c.read(name),null);
  assert.equal(c.read('TECHLONG_PLATFORM_CONTROLLER_ENABLED'),'false');assert.equal(f.reads(),2);
});

test('expired, wrong release/source/origin, mixed local mode or incomplete ingress never reads private values',async()=>{
  for(const patch of [
    {TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT:'b'.repeat(40)}, {TECHLONG_PLATFORM_CONTROL_LOCAL:'true'},
    {TECHLONG_PLATFORM_PUBLIC_ORIGIN:'https://attacker.invalid'}, {TECHLONG_PLATFORM_INGRESS:''},
    {TECHLONG_PLATFORM_CONTROLLER_ENABLED:'false'},
    {TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify({...((await fixture()).lease),releaseSha256:'0'.repeat(64)})},
    {TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify({...((await fixture()).lease),origin:'http://127.0.0.1:3100'})},
  ]){const f=await fixture();Object.assign(f.env,patch);await assert.rejects(prepareHostedControl(f.env,{now:f.now}));assert.equal(f.reads(),0);}
  const f=await fixture();f.time(f.lease.expiresAt);await assert.rejects(prepareHostedControl(f.env,{now:f.now}));assert.equal(f.reads(),0);
});

test('forbidden credential/override names are rejected without evaluating getters',async()=>{
  for(const name of ['AWS_ACCESS_KEY_ID','AWS_CONTAINER_CREDENTIALS_RELATIVE_URI','NODE_OPTIONS','VINEXT_TRUSTED_HOSTS','STRIPE_SECRET_KEY']){
    const f=await fixture();let forbiddenReads=0;Object.defineProperty(f.env,name,{enumerable:true,get(){forbiddenReads++;throw Error('FORBIDDEN_GETTER');}});
    await assert.rejects(prepareHostedControl(f.env,{now:f.now}),/HOSTED_FORBIDDEN/);assert.equal(forbiddenReads,0);assert.equal(f.reads(),0);
  }
});

test('expiry, invalid clock or clock rollback irreversibly closes capability and prevents private env fallback',async()=>{
  for(const time of [f=>f.lease.expiresAt,()=>NaN,()=>at-1]){
    const f=await fixture(),c=await prepareHostedControl(f.env,{now:f.now});f.time(time(f));
    assert.equal(c.live(),false);assert.equal(c.read(PRIVATE_CONTROL_BINDINGS[0]),null);
    f.time(at);assert.equal(c.live(),false);assert.equal(c.read(PRIVATE_CONTROL_BINDINGS[1]),null);assert.equal(f.reads(),0);
  }
});

test('public snapshot cannot be changed after validation and the Web database is never a control credential',async()=>{
  const f=await fixture(),plain={...Object.fromEntries(Object.keys(f.env).filter(k=>!PRIVATE_CONTROL_BINDINGS.includes(k)).map(k=>[k,f.env[k]])),DATABASE_URL:'synthetic-web-only'};
  assert.equal(f.reads(),0);
  const c=await prepareHostedControl(plain,{now:f.now});plain.TECHLONG_PLATFORM_CONTROLLER_ENABLED='false';
  plain.TECHLONG_PLATFORM_CONTROLLER_LEASE='changed';assert.equal(c.read('TECHLONG_PLATFORM_CONTROLLER_ENABLED'),'true');
  assert.equal(c.read('DATABASE_URL'),undefined);assert.equal(c.read(PRIVATE_CONTROL_BINDINGS[0]),null);c.close();
});

test('default Node path remains closed and explicit hosted command is not a normal server option',async()=>{
  assert.throws(()=>serverOptions(['--hosted-controller'],{}),/ARGUMENTS/);
  const {env}=await import('../ops/platform-hosting-v1/bindings.mjs');
  for(const [name,value] of Object.entries(CLOSED_BINDINGS))assert.equal(env[name],value);
  assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,undefined);
});

test('independent module evaluations and Node alias share one capability; duplicate installation never replaces it',async()=>{
  const f=await fixture(),c=await prepareHostedControl(f.env,{now:f.now});installHostedControl(c);
  try{const duplicate=await import('../ops/platform-hosting-v1/control-runtime.mjs?bundled-copy');
    const {env}=await import('../ops/platform-hosting-v1/bindings.mjs');
    assert.equal(duplicate.hostedControlBinding('TECHLONG_PLATFORM_CONTROL_HOSTED'),'true');
    assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_ENABLED,'true');assert.equal(f.reads(),0);
    assert.match(env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,/^synthetic-only-/);assert.equal(f.reads(),1);
    assert.throws(()=>installHostedControl(c),/INSTALL_ONCE/);assert.equal(hostedControlBinding('TECHLONG_PLATFORM_CONTROL_HOSTED'),'true');
  }finally{c.close();}
  const {env}=await import('../ops/platform-hosting-v1/bindings.mjs');
  assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_ENABLED,'false');assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,null);
});

test('Docker retains default command and only public TS dependencies; CI tests synthetic hosted start and expiry without AWS',async()=>{
  const docker=await readFile(new URL('../ops/platform-hosting-v1/Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/CMD \["node", "ops\/platform-hosting-v1\/start.mjs"\]/);assert(docker.includes('control-runtime.mjs'));
  for(const name of ['configuration.ts','contract.ts','installed-binding.ts','execution/hash.ts'])assert(docker.includes(name));
  const y=load(await readFile(new URL('../.github/workflows/platform-hosting-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(y.permissions,{contents:'read'});assert.equal(y.jobs.candidate.environment,undefined);
  const step=y.jobs.candidate.steps.find(s=>s.name?.startsWith('Hosted controller bootstrap'));
  assert(step);for(const text of ['--network none','hosted-smoke.mjs','docker wait','CONTROL_LEASE_CLOSED'])assert(step.run.includes(text));
  assert.doesNotMatch(step.run,/configure-aws|aws sts|secrets\.|docker push/);
});
