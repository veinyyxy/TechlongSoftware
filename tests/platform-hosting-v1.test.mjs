import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {buildEnvironment,assertBuildChildEnvironment,assertRuntimeEnvironment,serverOptions,CLOSED_BINDINGS,FORBIDDEN} from '../ops/platform-hosting-v1/contract.mjs';
import {makeBuildConfig} from '../ops/platform-hosting-v1/config.mjs';
import {platformClosureV6} from '../ops/platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {load} from 'js-yaml';

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
  assert.equal((source.match(/@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d/g)??[]).length,2);
  assert.match(source,/USER node/);assert.doesNotMatch(source,/COPY \. |ARG .*SECRET|migrate|aws login/);
  const ignore=await readFile(new URL('../ops/platform-hosting-v1/Dockerfile.dockerignore',import.meta.url),'utf8');assert(ignore.includes('**/.env*')&&ignore.includes('**/*.pem'));
});
test('CI has no AWS/OIDC/Secrets/deployment authority; tests actual built image without external network',async()=>{
  const y=load(await readFile(new URL('../.github/workflows/platform-hosting-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(y.permissions,{contents:'read'});assert.equal(y.jobs.candidate.environment,undefined);
  const steps=y.jobs.candidate.steps.map(s=>s.run??'').join('\n');
  for(const expected of ['git archive HEAD','docker build','--network none','--read-only','smoke.mjs'])assert(steps.includes(expected));
  assert.doesNotMatch(steps,/configure-aws|aws sts|docker push|workflow_dispatch|secrets\./);
});
test('published tenant deployment execution closure remains byte-identical',async()=>{
  const c=await platformClosureV6();assert.equal(c.closureSha256,B.platform.closureSha256);assert.equal(c.pinCount,81);
  assert(!c.pins.some(p=>p.file.includes('platform-hosting-v1')));
});
