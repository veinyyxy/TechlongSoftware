import test from 'node:test';
import assert from 'node:assert/strict';
import {env} from 'cloudflare:workers';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {CONTROL_SCOPE as S} from '../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {RECOVERY_CONTROL_BINDING as R} from '../ops/platform-recovery-control-v1/binding.mjs';
import {CONTROL_ORIGIN_V6,HOSTED_CONTROL_ORIGIN_V6,localRuntimeLeaseV6,hostedRuntimeLeaseV6,
  controllerRuntimeV6,verifiedControllerRuntimeV6} from '../lib/deployments/controller-v6/configuration.ts';
import {platformControlEnabled,platformControlOrigin,getPlatformControlStatus} from '../lib/deployments/controller-v6/runtime.ts';
import {createControlHandlers} from '../lib/deployments/controller-v6/http.ts';
import {assertRuntimeEnvironment,buildEnvironment} from '../ops/platform-hosting-v1/contract.mjs';

const at=Date.parse('2026-10-23T13:00:00Z');
async function fixture(now=at,release=B.platform){return {schema:'techlong/platform-hosted-runtime-lease/v6',origin:HOSTED_CONTROL_ORIGIN_V6,
  sourceCommit:'a'.repeat(40),releaseSha256:await sha256Hex(release),issuedAt:now,expiresAt:now+1800000};}
const recoverySelected=R.state==='PUBLISHED';
const flags={TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROL_LOCAL:'false',TECHLONG_PLATFORM_CONTROL_HOSTED:'true'};
const reader=(lease,patch={})=>{const v={...flags,TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify(lease),...patch};return name=>v[name];};

test('hosted lease is exact HTTPS origin, published release, source and at most thirty minutes',async()=>{
  const lease=await fixture();assert.deepEqual(hostedRuntimeLeaseV6(JSON.stringify(lease),B.platform,at),lease);
  const ctx=await verifiedControllerRuntimeV6(reader(lease),B.platform,at);
  assert.equal(ctx.mode,'hosted');assert.equal(ctx.origin,HOSTED_CONTROL_ORIGIN_V6);assert.equal(ctx.lease.sourceCommit,lease.sourceCommit);
  for(const p of [{origin:CONTROL_ORIGIN_V6},{origin:HOSTED_CONTROL_ORIGIN_V6+'/'},{origin:HOSTED_CONTROL_ORIGIN_V6+':443'},
    {origin:'https://sandbox.techlong.cloud'},{schema:'techlong/platform-local-runtime-lease/v6'},{sourceCommit:'main'},
    {issuedAt:at+1},{expiresAt:at},{expiresAt:at+1800001},{expiresAt:Infinity},{issuedAt:0},{extraPermission:true}])
    assert.equal(hostedRuntimeLeaseV6(JSON.stringify({...lease,...p}),B.platform,at),null);
  for(const now of [NaN,Infinity,at-1,lease.expiresAt])assert.equal(hostedRuntimeLeaseV6(JSON.stringify(lease),B.platform,now),null);
  assert.equal(hostedRuntimeLeaseV6(JSON.stringify(lease),{...B.platform,state:'UNPUBLISHED'},at),null);
  assert.equal(await verifiedControllerRuntimeV6(reader({...lease,releaseSha256:'0'.repeat(64)}),B.platform,at),null);
});

test('local lease behavior remains separate; modes and leases cannot be interchanged',async()=>{
  const hosted=await fixture(),local={...hosted,schema:'techlong/platform-local-runtime-lease/v6',origin:CONTROL_ORIGIN_V6};
  assert.equal(localRuntimeLeaseV6(JSON.stringify(hosted),B.platform,at),null);
  assert.equal(hostedRuntimeLeaseV6(JSON.stringify(local),B.platform,at),null);
  const r=reader(local,{TECHLONG_PLATFORM_CONTROL_LOCAL:'true',TECHLONG_PLATFORM_CONTROL_HOSTED:undefined});
  assert.equal((await verifiedControllerRuntimeV6(r,B.platform,at)).mode,'local');
  assert.equal(controllerRuntimeV6(reader(hosted,{TECHLONG_PLATFORM_CONTROL_LOCAL:'true'}),B.platform,at),null);
  assert.equal(controllerRuntimeV6(reader(hosted,{TECHLONG_PLATFORM_CONTROL_HOSTED:'false'}),B.platform,at),null);
  for(const p of [{TECHLONG_PLATFORM_CONTROLLER_ENABLED:'false'},{TECHLONG_PLATFORM_CONTROL_LOCAL:'FALSE'},
    {TECHLONG_PLATFORM_CONTROL_HOSTED:true},{TECHLONG_PLATFORM_CONTROL_HOSTED:'1'}])
    assert.equal(controllerRuntimeV6(reader(hosted,p),B.platform,at),null);
});

test('real controller runtime selects hosted origin without reading private bindings; invalid digest stops before ledger',async()=>{
  const lease=await fixture(Date.now(),recoverySelected?R.release:B.platform);let privateReads=0;
  const values={...flags,TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify(lease)};
  for(const [name,value] of Object.entries(values))env[name]=value;
  for(const name of ['TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'])
    Object.defineProperty(env,name,{configurable:true,get(){privateReads++;throw Error('PRIVATE_READ_FORBIDDEN');}});
  try{assert.equal(platformControlEnabled(),true);assert.equal(platformControlOrigin(),HOSTED_CONTROL_ORIGIN_V6);assert.equal(privateReads,0);
    env.TECHLONG_PLATFORM_CONTROLLER_LEASE=JSON.stringify({...lease,releaseSha256:'0'.repeat(64)});
    await assert.rejects(getPlatformControlStatus(S.instanceId),e=>recoverySelected?
      e.message==='RECOVERY_V1_CONTROL_RUNTIME_BINDING':e.code==='CONTROL_RUNTIME_LEASE');assert.equal(privateReads,0);
    env.TECHLONG_PLATFORM_CONTROLLER_LEASE=JSON.stringify({...lease,expiresAt:Date.now()-1});
    assert.equal(platformControlEnabled(),false);assert.deepEqual((await getPlatformControlStatus(S.instanceId)).plans,[]);assert.equal(privateReads,0);
  }finally{for(const name of [...Object.keys(values),'TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'])delete env[name];}
});

test('published recovery runtime rejects a legacy release lease before any private binding read',async()=>{
  if(!recoverySelected)return;
  const lease=await fixture(Date.now());let privateReads=0;
  assert.notEqual(lease.releaseSha256,await sha256Hex(R.release));
  const values={...flags,TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify(lease)};
  for(const [name,value] of Object.entries(values))env[name]=value;
  for(const name of ['TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'])
    Object.defineProperty(env,name,{configurable:true,get(){privateReads++;throw Error('PRIVATE_READ_FORBIDDEN');}});
  try{await assert.rejects(getPlatformControlStatus(S.instanceId),e=>e.message==='RECOVERY_V1_CONTROL_RUNTIME_BINDING');
    assert.equal(privateReads,0);
  }finally{for(const name of [...Object.keys(values),'TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'])delete env[name];}
});

test('same-origin controller HTTP boundary accepts only hosted canonical origin before authorization',async()=>{
  let auth=0;const h=createControlHandlers({origin:()=>HOSTED_CONTROL_ORIGIN_V6,enabled:()=>true,
    authorize:async()=>{auth++;return {account:null,response:null};},status:async()=>null,act:async()=>null});
  const ctx={params:Promise.resolve({instanceId:S.instanceId})};
  for(const origin of [CONTROL_ORIGIN_V6,'https://attacker.invalid','https://sandbox.techlong.cloud']){
    assert.equal((await h.GET(new Request(origin+'/api'),ctx)).status,403);
    assert.equal((await h.POST(new Request(origin+'/api',{method:'POST',headers:{origin}}),ctx)).status,403);
  }
  assert.equal((await h.POST(new Request(HOSTED_CONTROL_ORIGIN_V6+'/api',{method:'POST'}),ctx)).status,403);assert.equal(auth,0);
  assert.equal((await h.GET(new Request(HOSTED_CONTROL_ORIGIN_V6+'/api'),ctx)).status,401);assert.equal(auth,1);
});

test('existing Node hosting remains closed and cannot activate this candidate by injected flags',async()=>{
  assert.throws(()=>assertRuntimeEnvironment({TECHLONG_PLATFORM_CONTROL_HOSTED:'true'}),/CLOSED_RUNTIME/);
  assert.equal(buildEnvironment(flags).TECHLONG_PLATFORM_CONTROL_HOSTED,'false');
  const old=process.env.TECHLONG_PLATFORM_CONTROL_HOSTED;process.env.TECHLONG_PLATFORM_CONTROL_HOSTED='true';
  try{const {env:nodeEnv}=await import('../ops/platform-hosting-v1/bindings.mjs');
    assert.equal(nodeEnv.TECHLONG_PLATFORM_CONTROL_HOSTED,'false');assert.equal(nodeEnv.TECHLONG_PLATFORM_CONTROLLER_ENABLED,'false');
    assert.equal(nodeEnv.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,undefined);
  }finally{if(old===undefined)delete process.env.TECHLONG_PLATFORM_CONTROL_HOSTED;else process.env.TECHLONG_PLATFORM_CONTROL_HOSTED=old;}
});
