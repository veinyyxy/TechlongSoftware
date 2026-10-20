// Prepare: metadata only. Start: separately approved one-use private provision.
import {readFile,writeFile,mkdir,lstat,realpath,open,access} from 'node:fs/promises';
import {parseEnv,promisify} from 'node:util';
import {execFile,spawn} from 'node:child_process';
import {createHash,createPrivateKey} from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {SecretsManagerClient,DescribeSecretCommand,ListSecretVersionIdsCommand,GetResourcePolicyCommand,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {git,P} from '../platform-identity-review-v6/publication.mjs';
import {secretPolicyV6} from '../platform-activation-v6/credentials.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertControllerDatabaseUrlV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertConfigDirectoryV6} from './child.mjs';
import {L,must,same,makeLocalReviewV6,verifyLocalReviewV6,startLocalOnceV6,childEnvironmentV6} from './plan.mjs';
export const FILES=['ops/platform-local-v6/plan.mjs','ops/platform-local-v6/local.mjs','ops/platform-local-v6/child.mjs',L.config,
  'ops/platform-local-v6/metadata.ps1','scripts/controller-auth-metadata-v6.ps1','tests/platform-local-v6.test.mjs',
  'lib/deployments/controller-v6/installed-binding.ts','lib/deployments/controller-v6/configuration.ts','lib/deployments/controller-v6/runtime.ts',
  'lib/deployments/controller-v6/controller.ts','lib/deployments/controller-v6/ledger.ts','lib/deployments/controller-v6/github.ts',
  'lib/deployments/controller-v6/http.ts','ops/platform-activation-v6/credentials.mjs','worker/index.ts','next.config.ts','tsconfig.json',
  'package.json','package-lock.json','scripts/ci/verify-platform-local-v6.mjs','.github/workflows/platform-cloud-candidate.yml',L.riskFile];
const exec=promisify(execFile),hash=v=>createHash('sha256').update(v).digest('hex'),json=async f=>JSON.parse(await readFile(f,'utf8'));
async function write(f,v){assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});}
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(L.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function cleanMain(expected){const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
  (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected),'CLEAN_MAIN');return head;}
async function fileMetadata(file){const r=await exec('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',file],{cwd:L.root,windowsHide:true,timeout:20000,maxBuffer:8000});return JSON.parse(r.stdout);}
export async function portFreeV6(){return new Promise((resolve,reject)=>{
  const s=net.createConnection({host:'127.0.0.1',port:3100}),done=v=>{s.destroy();resolve(v);};
  s.setTimeout(1500,()=>{s.destroy();reject(Error('LOCAL_RUNTIME_PORT_UNKNOWN'));});s.once('connect',()=>done(false));
  s.once('error',e=>{if(e.code==='ECONNREFUSED')done(true);else reject(Error('LOCAL_RUNTIME_PORT_UNKNOWN'));});
});}
async function readReviewedFile(file,expected,metadata){
  must(same(await metadata(),expected),'PRIVATE_FILE_DRIFT');const before=await lstat(file);
  must(before.isFile()&&!before.isSymbolicLink()&&path.resolve(await realpath(file)).toLowerCase()===path.resolve(file).toLowerCase(),'PRIVATE_FILE_LINK');
  const handle=await open(file,'r');let bytes;
  try{const opened=await handle.stat();must(opened.ino===before.ino&&opened.dev===before.dev&&opened.size===expected.length&&opened.mtimeMs===before.mtimeMs,'PRIVATE_FILE_DRIFT');
    bytes=Buffer.alloc(opened.size+1);const r=await handle.read(bytes,0,bytes.length,0),after=await handle.stat();
    must(r.bytesRead===opened.size&&after.size===opened.size&&after.mtimeMs===opened.mtimeMs&&same(await metadata(),expected),'PRIVATE_FILE_DRIFT');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,r.bytesRead));
  }finally{bytes?.fill(0);await handle.close();}
}
async function ciProof(id,head){
  must(/^[1-9][0-9]{0,15}$/.test(id),'CI_ID');const raw=await git(['credential','fill'],{input:'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n'});
  let token=raw.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);must(token,'GITHUB_READ_AUTH');
  const get=async suffix=>{const r=await fetch('https://api.github.com/repos/'+P.repository+'/'+suffix,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'Techlong-Local-Review-V6'}});must(r.status===200,'CI_READ');
    const text=await r.text();must(text.length<300000,'CI_SIZE');return JSON.parse(text);};
  try{const r=await get('actions/runs/'+id),j=await get('actions/runs/'+id+'/attempts/1/jobs?per_page=100');
    must(String(r.id)===id&&r.head_sha===head&&r.head_branch==='main'&&r.path===P.ciPath&&r.event==='push'&&r.run_attempt===1&&
      r.status==='completed'&&r.conclusion==='success'&&r.repository.id===P.repositoryId&&r.repository.owner.id===P.ownerId&&
      j.total_count===1&&j.jobs?.length===1&&j.jobs[0].head_sha===head&&j.jobs[0].run_attempt===1&&String(j.jobs[0].run_id)===id&&
      j.jobs[0].status==='completed'&&j.jobs[0].conclusion==='success'&&j.jobs[0].steps.every(s=>s.status==='completed'&&s.conclusion==='success')&&
      j.jobs[0].steps.some(s=>s.name==='Reviewed local launcher with synthetic I/O only'&&s.conclusion==='success')&&
      (await get('branches/main')).commit.sha===head,'EXACT_CI');
    return {runId:id,jobId:String(j.jobs[0].id),sourceCommit:head,attempt:1,status:'completed',conclusion:'success'};
  }finally{token=undefined;}
}
async function serve(material,lease,onReady){
  const child=spawn(process.execPath,['--experimental-strip-types',path.join(L.root,'ops/platform-local-v6/child.mjs')],{
    cwd:L.root,env:childEnvironmentV6(process.env,material,lease),windowsHide:true,shell:false,stdio:['ignore','ignore','ignore','ipc']});
  let clean=false,ready=false,bad=false,forceTimer,readyWrite=Promise.resolve();
  const stop=()=>{if(!forceTimer){if(child.connected)child.send({type:'stop'},error=>{if(error)bad=true;});forceTimer=setTimeout(()=>{bad=true;child.kill();},10000);}};
  const deadline=setTimeout(stop,Math.max(0,lease.expiresAt-Date.now())),startup=setTimeout(()=>{bad=true;stop();},120000);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{await new Promise(resolve=>{
    child.on('error',()=>{bad=true;stop();});
    child.on('message',message=>{if(message?.type==='ready'&&!ready&&message.pid===child.pid&&message.origin==='http://127.0.0.1:3100'){
      ready=true;clearTimeout(startup);readyWrite=onReady({childPid:child.pid,origin:message.origin,startedAt:Date.now()}).then(()=>{
        console.log(JSON.stringify({outcome:'LOCAL_RUNTIME_READY',childPid:child.pid,origin:message.origin,expiresAtUtc:new Date(lease.expiresAt).toISOString(),
          next:'Login/view only under startup approval. Any task write or dispatch requires a separate exact approval. Ctrl+C stops this child; never restart this slot.'}));
      }).catch(()=>{bad=true;stop();});
    }else if(message?.type==='stopped')clean=message.clean===true;else{bad=true;stop();}});
    child.once('close',code=>{if(code!==0)bad=true;resolve();});
  });await readyWrite;return {childExited:true,portFree:await portFreeV6(),cleanClose:ready&&clean&&!bad};
  }finally{clearTimeout(deadline);clearTimeout(startup);clearTimeout(forceTimer);process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
async function openIo(output){
  const config={region:L.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:'techlong-sandbox-user'})};
  const sts=new STSClient(config),sm=new SecretsManagerClient(config),send=(c,v)=>c.send(v,{abortSignal:AbortSignal.timeout(20000)});
  const key=()=>fileMetadata('scripts/controller-auth-metadata-v6.ps1'),auth=()=>fileMetadata('ops/platform-local-v6/metadata.ps1');
  return {record:(n,v)=>write(output+'/'+n+'.json',v),claim:v=>write(L.slot,v),
    async assertSource(m){await cleanMain(m.sourceCommit);must(same(await pins(),m.pins),'SOURCE_PINS');await assertConfigDirectoryV6(L.root);},
    async metadata(){await assertConfigDirectoryV6(L.root);
      const source=await send(sts,new GetCallerIdentityCommand({})),d=await send(sm,new DescribeSecretCommand({SecretId:L.secretArn})),
        v=await send(sm,new ListSecretVersionIdsCommand({SecretId:L.secretArn,IncludeDeprecated:true})),p=await send(sm,new GetResourcePolicyCommand({SecretId:L.secretArn}));
      must(d.ARN===L.secretArn&&!d.DeletedDate&&!d.RotationEnabled&&same(d.VersionIdsToStages?.[L.versionId],['AWSCURRENT'])&&
        v.ARN===L.secretArn&&v.Versions?.length===1&&v.Versions[0].VersionId===L.versionId&&same(v.Versions[0].VersionStages,['AWSCURRENT'])&&
        p.ARN===L.secretArn&&same(JSON.parse(p.ResourcePolicy),secretPolicyV6()),'SECRET_METADATA');
      return {source:{Account:source.Account,Arn:source.Arn,UserId:source.UserId},secret:{arn:L.secretArn,versionId:L.versionId,current:true,sourceOnlyPolicyMatched:true},
        key:await key(),auth:await auth(),portFree:await portFreeV6()};},
    async readSecret(){const r=await send(sm,new GetSecretValueCommand({SecretId:L.secretArn,VersionId:L.versionId}));
      must(r.ARN===L.secretArn&&r.VersionId===L.versionId&&same(r.VersionStages,['AWSCURRENT'])&&typeof r.SecretString==='string'&&!r.SecretBinary&&r.SecretString.length<12000,'SECRET_VERSION');
      const value=JSON.parse(r.SecretString);must(same(Object.keys(value).sort(),['databaseUrl','schema'])&&value.schema==='techlong/platform-controller-neon-material/v6','SECRET_MATERIAL');
      return assertControllerDatabaseUrlV6(value.databaseUrl);},
    async readKey(expected){const pem=await readReviewedFile(L.key,expected,key),k=createPrivateKey(pem);
      must(k.asymmetricKeyType==='rsa'&&k.asymmetricKeyDetails?.modulusLength>=2048,'KEY_FORMAT');return pem;},
    async readAuth(expected){const values=parseEnv(await readReviewedFile(L.authFile,expected,auth));let u;
      try{u=new URL(values.DATABASE_URL);}catch{must(false,'AUTH_DATABASE');}
      must(['postgres:','postgresql:'].includes(u.protocol)&&decodeURIComponent(u.username)==='neondb_owner'&&u.password&&!u.hash&&
        (!u.port||u.port==='5432')&&['require','verify-full'].includes(u.searchParams.get('sslmode'))&&
        [...u.searchParams.keys()].every(k=>['sslmode','channel_binding'].includes(k))&&
        await sha256Hex({host:u.hostname,port:5432,database:u.pathname.slice(1),actor:'neondb_owner',transport:'PostgresTLSVerifyFull'})===
        '5d5e52c00c54ed761aac13730f81b1b6f107d7ac06a68a407276132d150690a7','AUTH_DATABASE');return values.DATABASE_URL;},
    serve,dispose(){sts.destroy();sm.destroy();}
  };
}
async function directory(value,existing=false){const p=path.resolve(value);must(path.dirname(p).toLowerCase()===path.resolve(L.base).toLowerCase()&&
  /^techlong-w6k-local-runtime-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(L.base)).toLowerCase()===path.resolve(L.base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'DIRECTORY_LINK');return p;}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=['--mode','--output',...(mode==='Prepare'?['--ci-run']:mode==='Start'?['--manifest','--approved-sha']:['--manifest'])];
  must(['Prepare','Start','Inspect'].includes(mode)&&Object.keys(a).length===fields.length&&fields.every(k=>a[k]),'MODE');
  must(path.resolve(process.cwd()).toLowerCase()===path.resolve(L.root).toLowerCase()&&process.platform==='win32'&&
    !['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','AWS_CA_BUNDLE','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','CLOUDFLARE_ENV'].some(k=>process.env[k])&&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!Object.keys(process.env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const output=await directory(a['--output']);let m;
  if(mode!=='Prepare'){const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST_PATH');
    m=await json(f);await verifyLocalReviewV6(m,a['--approved-sha'],Date.now(),mode==='Inspect');}
  if(mode!=='Inspect')await absent(L.slot);await mkdir(output);
  if(mode==='Inspect'){
    const slot=await json(L.slot);must(slot.manifestSha256===m.manifestSha256&&slot.sourceCommit===m.sourceCommit,'INSPECT_SLOT');
    const free=await portFreeV6();const result={outcome:free?'LOCAL_PORT_CLOSED_INDEPENDENTLY_OBSERVED':'LOCAL_PORT_OCCUPIED_REQUIRES_OPERATOR',
      manifestSha256:m.manifestSha256,portFree:free,privateReads:0,awsCalls:0,externalWrites:0,retryAllowed:false};
    await write(output+'/result.json',result);console.log(JSON.stringify(result));return result;
  }
  const io=await openIo(output);
  try{if(mode==='Prepare'){const sourceCommit=await cleanMain(),ci=await ciProof(a['--ci-run'],sourceCommit),metadata=await io.metadata();
      m=await makeLocalReviewV6({sourceCommit,pins:await pins(),ci,metadata,createdAt:Date.now()});await io.assertSource(m);await io.record('manifest',m);
      const result={outcome:'LOCAL_START_REVIEW_PREPARED_NOT_STARTED',manifestSha256:m.manifestSha256,sourceCommit,expiresAtUtc:new Date(m.expiresAt).toISOString(),
        expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
        secretValueReads:0,privateKeyReads:0,authFileReads:0,serverStarts:0,slotConsumed:false};await io.record('result',result);console.log(JSON.stringify(result,null,2));return result;
    }
    await ciProof(m.ci.runId,m.sourceCommit);await io.record('approved-manifest',m);const result=await startLocalOnceV6({manifest:m,approved:a['--approved-sha'],io});
    if(result.outcome.includes('UNKNOWN'))process.exitCode=1;console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(e=>{console.error(JSON.stringify({outcome:'LOCAL_RUNTIME_ENTRY_STOPPED_NO_RETRY',
    failure:/^LOCAL_RUNTIME_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD',
    errorName:/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(e?.name)?e.name:'WITHHELD',retryAllowed:false}));process.exitCode=1;});
