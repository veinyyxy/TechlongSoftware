import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),req=createRequire(import.meta.url),exec=promisify(execFile);
// Reuse the existing pinned toolchain; do not add/upgrade dependencies.
const wranglerRequire=createRequire(req.resolve('wrangler/package.json'));
const {build}=wranglerRequire('esbuild'),workerd=wranglerRequire('workerd').default;

test('actual workerd + Neon/GitHub adapters reject redirects without network or private bindings', {timeout:60000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'platform-controller-transport-v6-'));
  t.after(async()=>{
    // Only recursively remove the exact fresh mkdtemp child, never a workspace.
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('platform-controller-transport-v6-'));
    await rm(dir,{recursive:true,force:true});
  });
  const config=JSON.parse(await readFile(new URL('../ops/platform-local-v6/worker.json',import.meta.url),'utf8'));
  const fixture=path.join(root,'tests/fixtures/platform-controller-transport-v6.mjs');
  const output=await build({entryPoints:[fixture],bundle:true,write:false,format:'esm',platform:'neutral',
    conditions:['workerd','browser','import'],mainFields:['browser','module','main'],external:['node:*'],logLevel:'silent',
    plugins:[{name:'synthetic-controller-binding-only',setup(builder){
      builder.onResolve({filter:/configuration\.ts$/},args=>{
        if(path.resolve(args.importer)===path.join(root,'lib/deployments/controller-v6/ledger.ts'))
          return {path:'exact-fixture-binding',namespace:'synthetic-only'};
      });
      builder.onLoad({filter:/.*/,namespace:'synthetic-only'},()=>({loader:'js',resolveDir:root,contents:`
        export {assertControllerNeonTransportV6} from ${JSON.stringify(path.join(root,'lib/deployments/controller-v6/configuration.ts'))};
        export async function assertControllerDatabaseUrlV6(value){
          if(value!=='postgresql://techlong_deployment_controller_v6:synthetic-only@ep-fixture.ca-central-1.aws.neon.tech/neondb?sslmode=verify-full')throw Error('SYNTHETIC_BINDING_ONLY');return value;}
      `}));
    }}]});
  await writeFile(path.join(dir,'probe.mjs'),output.outputFiles[0].contents,{flag:'wx'});
  const worker=`(modules=[(name="probe.mjs",esModule=embed "probe.mjs")],compatibilityDate=${JSON.stringify(config.compatibility_date)},
    compatibilityFlags=${JSON.stringify(config.compatibility_flags)},globalOutbound="internet")`;
  // Explicit mock named internet prevents workerd's implicit network default.
  await writeFile(path.join(dir,'probe.capnp'),`using W=import "/workerd/workerd.capnp";
    const config :W.Config=(services=[(name="probe",worker=${worker}),(name="internet",worker=${worker})],sockets=[]);`,{flag:'wx'});
  const allow=new Set(['systemroot','windir','path','temp','tmp']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>allow.has(name.toLowerCase())));
  const {stdout}=await exec(workerd,['test',path.join(dir,'probe.capnp'),'probe'],{cwd:dir,env,windowsHide:true,timeout:45000,maxBuffer:128000});
  const result=JSON.parse(stdout.split(/\r?\n/).find(line=>line.startsWith('{"schema":')));
  assert.equal(result.schema,'techlong/platform-controller-transport-regression/v6');
  assert.equal(result.ledgerCases,6);assert.equal(result.githubCases,21);assert.equal(result.successfulAck,true);
  for(const key of ['privateReads','networkServices','sockets','realTokens','realDispatches'])assert.equal(result[key],0);
  assert.equal(result.transportGuardRetained,true);
});
