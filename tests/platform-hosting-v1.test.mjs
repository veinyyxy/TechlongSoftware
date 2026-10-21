import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {buildEnvironment,assertBuildChildEnvironment,assertRuntimeEnvironment,serverOptions,CLOSED_BINDINGS,FORBIDDEN} from '../ops/platform-hosting-v1/contract.mjs';
import {makeBuildConfig} from '../ops/platform-hosting-v1/config.mjs';
import {platformClosureV6} from '../ops/platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {load} from 'js-yaml';
import {PUBLIC_ORIGIN,ingressPolicy,checkIngress,ingressHandler,installIngress} from '../ops/platform-hosting-v1/ingress.mjs';

const albPolicy=ingressPolicy({TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN},{port:3000,host:'0.0.0.0'});
const albHeaders={host:'console.sandbox.techlong.cloud','x-forwarded-proto':'https','x-forwarded-port':'443'};
function wire(headers=albHeaders,method='GET',url='/login'){
  return {headers:{...headers},method,url,rawHeaders:Object.entries(headers).flat()};
}

test('compiler child gets no caller database, key, public override or cloud credential',()=>{
  const e=buildEnvironment({PATH:'synthetic-path',SystemRoot:'synthetic-system',DATABASE_URL:'synthetic-private',
    NEXT_PUBLIC_PLATFORM_NAME:'synthetic-unapproved-name',AWS_ACCESS_KEY_ID:'synthetic-private',CLOUDFLARE_API_TOKEN:'synthetic-private',
    NODE_OPTIONS:'--import=unapproved',TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY:'synthetic-private'});
  assert.equal(e.PATH,'synthetic-path');assert.equal(e.SystemRoot,'synthetic-system');assert.equal(e.NODE_ENV,'production');
  assert.deepEqual(Object.fromEntries(Object.keys(CLOSED_BINDINGS).map(k=>[k,e[k]])),CLOSED_BINDINGS);
  assert(!Object.values(e).some(v=>String(v).includes('private')));assert.equal(e.NEXT_PUBLIC_PLATFORM_NAME,undefined);assertBuildChildEnvironment(e);
  assert.throws(()=>assertBuildChildEnvironment({...e,DATABASE_URL:'synthetic-private'}));
});
for(const name of FORBIDDEN)test('candidate start rejects unreviewed '+name,()=>{
  assert.throws(()=>assertRuntimeEnvironment({[name]:'synthetic-unreviewed'}),/CLOSED_RUNTIME/);
});
test('flags cannot accidentally activate hosted deployment or request entry',()=>{
  assertRuntimeEnvironment({});assertRuntimeEnvironment({...CLOSED_BINDINGS});
  for(const name of Object.keys(CLOSED_BINDINGS))assert.throws(()=>assertRuntimeEnvironment({[name]:'true'}));
  assert.throws(()=>assertRuntimeEnvironment({AWS_ENDPOINT_URL_S3:'https://synthetic.invalid'}));
  assert.throws(()=>assertRuntimeEnvironment({NODE_TLS_REJECT_UNAUTHORIZED:'0'}));
});
test('bounded server options have explicit loopback and reject invalid port/arguments',()=>{
  assert.deepEqual(serverOptions([],{}),{port:3000,host:'0.0.0.0'});assert.deepEqual(serverOptions(['--loopback'],{PORT:'3105'}),{port:3105,host:'127.0.0.1'});
  for(const p of ['0','80','65536','3000x','-1'])assert.throws(()=>serverOptions([],{PORT:p}));
  assert.throws(()=>serverOptions(['--deploy'],{}));
});

test('HTTPS ingress is an exact opt-in, never arbitrary proxy trust or a build-time binding',()=>{
  assert.equal(ingressPolicy({},{port:3000}).origin,'http://127.0.0.1:3000');
  for(const env of [
    {TECHLONG_PLATFORM_INGRESS:'alb-https-v1'},
    {TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN},
    {TECHLONG_PLATFORM_INGRESS:'anything',TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN},
    {TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:'https://attacker.invalid'},
    {TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN+'/'},
  ])assert.throws(()=>ingressPolicy(env,{port:3000,host:'0.0.0.0'}),/INGRESS_CONFIG/);
  assert.throws(()=>ingressPolicy({TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN},{port:3000,host:'127.0.0.1'}));
  assert.equal(buildEnvironment({TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN}).TECHLONG_PLATFORM_PUBLIC_ORIGIN,undefined);
});

test('fixed HTTPS Host/proto/port reject poisoned, ambiguous or missing proxy context',()=>{
  assert.equal(checkIngress(wire(),albPolicy),0);
  assert.equal(checkIngress(wire({...albHeaders,host:albHeaders.host+':443'}),albPolicy),0);
  for(const headers of [
    {...albHeaders,host:'attacker.invalid'}, {...albHeaders,host:albHeaders.host+':3000'},
    {...albHeaders,'x-forwarded-host':'attacker.invalid'},
  ])assert.equal(checkIngress(wire(headers),albPolicy),421);
  for(const headers of [
    {host:albHeaders.host},{...albHeaders,'x-forwarded-proto':'http'},
    {...albHeaders,'x-forwarded-proto':'https, http'},{...albHeaders,'x-forwarded-port':'80'},
    {...albHeaders,forwarded:'host=attacker.invalid'},
    {...albHeaders,'x-forwarded-proto':['https','http']},
  ])assert.equal(checkIngress(wire(headers),albPolicy),400);
  for(const key of ['host','origin','x-forwarded-host','x-forwarded-proto','x-forwarded-port','sec-fetch-site']){
    const req=wire({...albHeaders,[key]:key==='origin'?PUBLIC_ORIGIN:'synthetic'});
    req.rawHeaders.push(key.toUpperCase(),'duplicate');assert.equal(checkIngress(req,albPolicy),400);
  }
  for(const url of ['https://attacker.invalid/a','//attacker.invalid/a','/\\attacker','/a#b','/a b'])assert.equal(checkIngress(wire(albHeaders,'GET',url),albPolicy),400);
  assert.equal(checkIngress(wire(albHeaders,'TRACE'),albPolicy),405);
});

test('every mutation requires exact Origin; cross-site, null, sibling and missing are rejected',()=>{
  for(const method of ['POST','PUT','PATCH','DELETE']){
    assert.equal(checkIngress(wire(albHeaders,method),albPolicy),403);
    for(const origin of ['null','https://attacker.invalid','https://sandbox.techlong.cloud',PUBLIC_ORIGIN+'/',PUBLIC_ORIGIN+':443'])
      assert.equal(checkIngress(wire({...albHeaders,origin},method),albPolicy),403);
    for(const site of ['cross-site','same-site'])assert.equal(checkIngress(wire({...albHeaders,origin:PUBLIC_ORIGIN,'sec-fetch-site':site},method),albPolicy),403);
    for(const site of ['none','same-origin'])assert.equal(checkIngress(wire({...albHeaders,origin:PUBLIC_ORIGIN,'sec-fetch-site':site},method),albPolicy),0);
  }
  assert.equal(checkIngress(wire({...albHeaders,origin:'https://attacker.invalid'}),albPolicy),403);
  assert.equal(checkIngress(wire({...albHeaders,origin:PUBLIC_ORIGIN},'OPTIONS'),albPolicy),0);
});

test('health exemption is only a context-free exact GET/HEAD, with all caller headers discarded',()=>{
  for(const method of ['GET','HEAD']){
    const req=wire({host:'10.0.1.10:3000','x-arbitrary':'untrusted'},method,'/api/health');
    assert.equal(checkIngress(req,albPolicy),0);let called=0;
    ingressHandler(r=>{called++;assert.deepEqual(r.headers,{...albHeaders,'x-forwarded-host':albHeaders.host});},albPolicy)(req,{setHeader(){}});
    assert.equal(called,1);
  }
  for(const url of ['/api/health?x=1','/api/health/','/admin'])assert.equal(checkIngress(wire({host:'10.0.1.10:3000'},'GET',url),albPolicy),421);
  for(const key of ['cookie','authorization','origin','next-action'])assert.notEqual(checkIngress(wire({host:'10.0.1.10:3000',[key]:'synthetic'},'GET','/api/health'),albPolicy),0);
  assert.notEqual(checkIngress(wire({host:'10.0.1.10:3000'},'POST','/api/health'),albPolicy),0);
});

test('loopback mode rejects fake HTTPS headers and public Host, accepts exact local Origin',()=>{
  const p=ingressPolicy({},{port:3000});
  assert.equal(checkIngress(wire({host:p.host}),p),0);
  assert.equal(checkIngress(wire({host:p.host,'x-forwarded-proto':'https'}),p),400);
  assert.equal(checkIngress(wire({host:'attacker.invalid'}),p),421);
  assert.equal(checkIngress(wire({host:p.host},'POST'),p),403);
  assert.equal(checkIngress(wire({host:p.host,origin:p.origin},'POST'),p),0);
});

test('guard wraps the ONLY handler while closed; real wire duplicates/refusals never reach application',async t=>{
  let called=0;
  const server=createServer((req,res)=>{called++;res.end(JSON.stringify(req.headers));});
  installIngress(server,albPolicy);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.throws(()=>installIngress(server,albPolicy),/INGRESS_LISTENERS/);
  const send=(headers,method='GET')=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/login',method,headers},res=>{
      let body='';res.setEncoding('utf8');res.on('data',s=>{body+=s;});res.on('end',()=>resolve({status:res.statusCode,body}));
    });req.on('error',reject);req.end();
  });
  for(const headers of [
    {...albHeaders,host:'attacker.invalid'},
    Object.entries(albHeaders).flat().concat(['Host','attacker.invalid']),
    {...albHeaders,origin:'https://attacker.invalid'},
  ])assert((await send(headers)).status>=400);
  assert.equal((await send(albHeaders,'POST')).status,403);assert.equal(called,0);
  const r=await send({...albHeaders,'x-forwarded-host':albHeaders.host,'x-forwarded-for':'untrusted','x-real-ip':'untrusted','x-forwarded-path':'untrusted'});
  assert.equal(r.status,200);assert.equal(called,1);
  const h=JSON.parse(r.body);assert.equal(h.host,albHeaders.host);assert.equal(h['x-forwarded-host'],albHeaders.host);
  assert.equal(h['x-forwarded-proto'],'https');assert.equal(h['x-forwarded-for'],undefined);assert.equal(h['x-real-ip'],undefined);
  const empty=createServer();assert.throws(()=>installIngress(empty,albPolicy),/INGRESS_LISTENERS/);
});

test('installed vinext converts normalized ingress to the fixed HTTPS URL without generic caller trust',()=>{
  const code=`import assert from 'node:assert/strict';
    import {ingressPolicy,ingressHandler,PUBLIC_ORIGIN} from './ops/platform-hosting-v1/ingress.mjs';
    const p=ingressPolicy({TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN},{port:3000,host:'0.0.0.0'});
    process.env.VINEXT_TRUSTED_HOSTS=p.host;
    const {nodeToWebRequest,trustProxy,trustedHosts}=await import('vinext/server/prod-server');
    assert(trustProxy);assert.deepEqual([...trustedHosts],[p.host]);
    const headers={host:p.host,'x-forwarded-proto':'https','x-forwarded-port':'443'};
    ingressHandler(req=>{const web=nodeToWebRequest(req);assert.equal(web.url,PUBLIC_ORIGIN+'/login');
      assert.equal(web.headers.get('x-forwarded-host'),p.host);},p)
      ({method:'GET',url:'/login',headers,rawHeaders:Object.entries(headers).flat()},{setHeader(){}});`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../',import.meta.url),env:buildEnvironment(process.env),encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,r.stderr);
});
test('Node-only binding maps selected runtime values and masks deployment flags even with accidental caller opt-in',async()=>{
  const before=process.env.TECHLONG_PLATFORM_CONTROLLER_ENABLED;process.env.TECHLONG_PLATFORM_CONTROLLER_ENABLED='true';
  try{
    const {env}=await import('../ops/platform-hosting-v1/bindings.mjs');assert(Object.isFrozen(env));
    assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_ENABLED,'false');assert.equal(env.DB,undefined);assert.equal(env.STRIPE_SECRET_KEY,undefined);
    assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,undefined);
  }finally{if(before===undefined)delete process.env.TECHLONG_PLATFORM_CONTROLLER_ENABLED;else process.env.TECHLONG_PLATFORM_CONTROLLER_ENABLED=before;}
});
test('separate Node build never loads root Vite/Cloudflare/Sites config or repository dotenv',async()=>{
  const c=await makeBuildConfig();assert.equal(c.configFile,false);assert(c.envDir.endsWith('empty-env'));assert.equal(c.mode,'production');
  assert(c.environments.client.build.outDir.replaceAll('\\','/').endsWith('/dist-platform/client'));
  const plugins=c.plugins.flat(Infinity).map(p=>p.name);assert(!plugins.some(p=>/^vite-plugin-cloudflare|^sites$/.test(p)));
  const alias=c.plugins[0];assert.throws(()=>alias.resolveId.call({environment:{name:'client'}},'cloudflare:workers'));
  assert(alias.resolveId.call({environment:{name:'rsc'}},'cloudflare:workers').endsWith('bindings.mjs'));
});
test('existing health contract is retained without provider, credential or database dependency',async()=>{
  const source=await readFile(new URL('../app/api/health/route.ts',import.meta.url),'utf8');
  assert.match(source,/service: "saas-platform"/);assert.match(source,/"cache-control": "no-store"/);
  assert.doesNotMatch(source,/getDatabase|process\.env|fetch\(|Secret|cloudflare:/);
});
test('installed Vite/vinext hooks preserve the actual client output after config merging',()=>{
  const code=`import {resolveConfig} from 'vite';import {makeBuildConfig,OUTPUT} from './ops/platform-hosting-v1/config.mjs';
    import path from 'node:path';const c=await resolveConfig(await makeBuildConfig(),'build');
    if(path.resolve(c.environments.client.build.outDir)!==path.join(OUTPUT,'client')||c.configFile)throw Error('CLIENT_OUTPUT_DRIFT');`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../',import.meta.url),
    env:buildEnvironment(process.env),encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
});
test('pinned non-root container has explicit source COPY, no secret build args and no migrations',async()=>{
  const source=await readFile(new URL('../ops/platform-hosting-v1/Dockerfile',import.meta.url),'utf8');
  assert.match(source,/FROM node:24\.18\.0-alpine3\.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base/);
  assert.match(source,/RUN apk upgrade --no-cache/);
  assert.match(source,/FROM base AS build/);assert.match(source,/FROM base AS candidate/);
  assert.match(source,/USER node/);assert.doesNotMatch(source,/COPY \. |ARG .*SECRET|migrate|aws login/);
  const ignore=await readFile(new URL('../ops/platform-hosting-v1/Dockerfile.dockerignore',import.meta.url),'utf8');assert(ignore.includes('**/.env*')&&ignore.includes('**/*.pem'));
});
test('CI has no AWS/OIDC/Secrets/deployment authority; tests actual built image without external network',async()=>{
  const y=load(await readFile(new URL('../.github/workflows/platform-hosting-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(y.permissions,{contents:'read'});assert.equal(y.jobs.candidate.environment,undefined);
  const steps=y.jobs.candidate.steps.map(s=>s.run??'').join('\n');
  for(const expected of ['git archive HEAD','docker build','--network none','--read-only','smoke.mjs','https-smoke.mjs','TECHLONG_PLATFORM_INGRESS=alb-https-v1'])assert(steps.includes(expected));
  assert.doesNotMatch(steps,/configure-aws|aws sts|docker push|workflow_dispatch|secrets\./);
});
test('published tenant deployment execution closure remains byte-identical',async()=>{
  const c=await platformClosureV6();assert.equal(c.closureSha256,B.platform.closureSha256);assert.equal(c.pinCount,81);
  assert(!c.pins.some(p=>p.file.includes('platform-hosting-v1')));
});
