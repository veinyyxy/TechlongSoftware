import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedCredentialPort} from '../ops/platform-operations-v6/credentials.mjs';

const identity=()=>({Account:'123456789012',Arn:'arn:aws:iam::123456789012:user/synthetic',UserId:'synthetic-user-id'});
const material=at=>({accessKeyId:'fixture-access',secretAccessKey:'fixture-secret',sessionToken:'fixture-session',expiration:new Date(at+900000)});
function fixture(overrides={}){
  let clock=1000000,loads=0,verifies=0;const expectedIdentity=identity();
  const args={deadline:clock+3600000,expectedIdentity,now:()=>clock,guard:async()=>{},
    load:async()=>{loads++;return material(clock);},verifyIdentity:async()=>{verifies++;return identity();},...overrides};
  return {port:createVerifiedCredentialPort(args),args,expectedIdentity,tick:ms=>{clock+=ms;},counts:()=>({loads,verifies}),now:()=>clock};
}
test('construction is inert; verified cache returns isolated credential copies',async()=>{
  const f=fixture();assert.deepEqual(f.counts(),{loads:0,verifies:0});const a=await f.port.credentials();a.sessionToken='caller mutation';a.expiration.setTime(0);
  const b=await f.port.credentials();assert.equal(b.sessionToken,'fixture-session');assert(b.expiration.getTime()>f.now());
  assert.deepEqual(f.port.counts(),{sourceCredentialLoads:1,sourceStsGets:1});
});
test('reload at five-minute freshness boundary without fabricating a longer expiry',async()=>{
  const f=fixture(),a=await f.port.credentials();f.tick(600000);const b=await f.port.credentials();
  assert.equal(a.expiration.getTime(),f.now()+300000);assert.equal(b.expiration.getTime(),f.now()+900000);
  assert.deepEqual(f.counts(),{loads:2,verifies:2});
});
for(const field of ['Account','Arn','UserId'])test('mismatching '+field+' closes permanently with no retry',async()=>{
  let loads=0;const f=fixture({load:async()=>{loads++;return material(1000000);},verifyIdentity:async()=>({...identity(),[field]:'wrong'})});
  await assert.rejects(f.port.credentials(),/SOURCE_UNAVAILABLE_NO_RETRY/);await assert.rejects(f.port.credentials());assert.equal(loads,1);
});
for(const [name,patch] of [['no session',{sessionToken:''}],['not a Date',{expiration:999999999}],['two-minute boundary',{expiration:new Date(1120000)}],['invalid Date',{expiration:new Date(NaN)}]])
  test('rejects '+name+' before STS',async()=>{let verified=0;const f=fixture({load:async()=>({...material(1000000),...patch}),verifyIdentity:async()=>{verified++;return identity();}});
    await assert.rejects(f.port.credentials());assert.equal(verified,0);});
test('load errors are not exposed and never trigger an implicit second load',async()=>{
  let loads=0;const f=fixture({load:async()=>{loads++;throw Error('provider-private-detail');}});
  await assert.rejects(f.port.credentials(),e=>!e.message.includes('provider-private-detail'));await assert.rejects(f.port.credentials());assert.equal(loads,1);
});
test('simultaneous callers share one pending refresh/identity check',async()=>{
  let resolve,loads=0,verifies=0;const pending=new Promise(r=>{resolve=r;}),f=fixture({load:async()=>{loads++;return pending;},verifyIdentity:async()=>{verifies++;return identity();}});
  const a=f.port.credentials(),b=f.port.credentials();await new Promise(r=>setImmediate(r));resolve(material(1000000));await Promise.all([a,b]);
  assert.equal(loads,1);assert.equal(verifies,1);
});
test('close while loading blocks STS, and later calls cannot resurrect the port',async()=>{
  let resolve,verifies=0;const pending=new Promise(r=>{resolve=r;}),f=fixture({load:async()=>pending,verifyIdentity:async()=>{verifies++;return identity();}});
  const p=f.port.credentials();await new Promise(r=>setImmediate(r));f.port.close();resolve(material(1000000));
  await assert.rejects(p);await assert.rejects(f.port.credentials());assert.equal(verifies,0);
});
test('six-load hard cap also covers short-lived but valid credentials',async()=>{
  const f=fixture({load:async()=>({...material(1000000),expiration:new Date(1180000)})});
  for(let n=0;n<6;n++)await f.port.credentials();await assert.rejects(f.port.credentials());await assert.rejects(f.port.credentials());
  assert.deepEqual(f.port.counts(),{sourceCredentialLoads:6,sourceStsGets:6});
});
test('closing, guard latency and expiry after STS are rechecked before return',async()=>{
  const f=fixture();await f.port.credentials();f.args.guard=async()=>{};f.port.close();await assert.rejects(f.port.credentials());
  let clock=1000000;const args={deadline:clock+1000,expectedIdentity:identity(),now:()=>clock,load:async()=>material(clock),verifyIdentity:async()=>identity(),guard:async()=>{clock+=1001;}};
  await assert.rejects(createVerifiedCredentialPort(args).credentials());
  clock=1000000;const p=createVerifiedCredentialPort({...args,deadline:clock+3600000,guard:async()=>{},load:async()=>material(1000000),verifyIdentity:async()=>{clock+=800000;return identity();}});
  await assert.rejects(p.credentials());
});
test('caller cannot mutate the expected identity after construction',async()=>{
  const f=fixture();f.expectedIdentity.Account='000000000000';await f.port.credentials();assert.equal(f.port.counts().sourceStsGets,1);
});
