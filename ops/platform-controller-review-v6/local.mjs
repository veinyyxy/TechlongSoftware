// Local reviewed schema install. No AWS client, App key or runtime activation.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {git,P} from '../platform-identity-review-v6/publication.mjs';
import {readControlCatalog} from './catalog.mjs';
import {I,SOURCE_FILES,must,hash,same,sqlContract,assertAbsent,assertInstalled,makeManifest,verifyManifest,installOnce} from './install.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const writeOnce=(f,v)=>writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});
const fold=p=>path.resolve(p).toLowerCase();
async function absent(f){try{await access(f);must(false,'SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(input,existing=false){const p=path.resolve(input);must(path.dirname(p).toLowerCase()===path.resolve(P.base).toLowerCase()&&
  /^techlong-w6f-control-[a-z0-9-]+$/.test(path.basename(p))&&fold(await realpath(P.base))===fold(P.base),'DIRECTORY');
  if(existing)must(fold(await realpath(p))===fold(p),'REALPATH');return p;
}
async function pins(){return Promise.all(SOURCE_FILES.map(async file=>({file,sha256:hash((await readFile(P.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));}
async function cleanMain(expected){const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
  (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected),'CLEAN_MAIN');return head;
}
async function identityEvidence(){
  const e=await json(P.root+'/'+I.identityRecord);
  must(e.state==='REAL_APP_IDENTITY_INDEPENDENTLY_VERIFIED_NO_AWS_AUTHORIZATION'&&e.runId===I.identityRun&&
    e.artifact?.proofSha256===I.identityProofSha256&&e.realAppDispatchActorVerified===true&&e.cleanup.tokenRevocationHttp204===true&&
    e.receipts?.length===10,'IDENTITY_EVIDENCE');
  const base=P.base+'/techlong-w6e-identity-',allow=new Set([
    base+'20261019-a/manifest.json',base+'dispatch.intent.json',base+'dispatch.ack.json',base+'dispatch.receipt.json',
    base+'20261019-a-run/result.json',base+'20261019-a-inspect1/run-observation.json',base+'20261019-a-inspect1/result.json',
    base+'20261019-a-inspect2/run-observation.json',base+'20261019-a-inspect2/identity-proof.json',base+'20261019-a-inspect2/result.json']);
  for(const r of e.receipts){must(allow.delete(r.path)&&hash(await readFile(r.path))===r.rawSha256,'IDENTITY_ORIGINAL');}
  must(allow.size===0,'IDENTITY_ORIGINALS');
  const proof=await json(base+'20261019-a-inspect2/identity-proof.json'),{proofSha256,...body}=proof;
  must(proofSha256===I.identityProofSha256&&hash(canonicalJson(body))===proofSha256&&proof.runId===I.identityRun&&
    proof.actorId==='344813947'&&proof.senderId===proof.actorId,'IDENTITY_PROOF');
}
async function database(){
  const config=parseEnv(await readFile(P.root+'/.env.local','utf8')),u=new URL(config.DATABASE_URL);
  must(['postgres:','postgresql:'].includes(u.protocol)&&/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname)&&
    (!u.port||u.port==='5432')&&/^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname)&&u.username&&u.password&&!u.hash&&
    ['require','verify-full'].includes(u.searchParams.get('sslmode')),'NEON_TLS_TARGET');
  const publicTarget={host:u.hostname,port:5432,database:u.pathname.slice(1),actor:decodeURIComponent(u.username),transport:'PostgresTLSVerifyFull'};
  const client=new pg.Client({host:u.hostname,port:5432,database:publicTarget.database,user:publicTarget.actor,password:decodeURIComponent(u.password),
    ssl:{rejectUnauthorized:true},options:'',application_name:'Techlong-Reviewed-Control-Schema-V6',
    connectionTimeoutMillis:15000,query_timeout:30000,statement_timeout:20000});
  let unexpected=false;client.on('error',()=>{unexpected=true;});
  try{await client.connect();}catch{try{await client.end();}catch{/* No retry. */}must(false,'DATABASE_CONNECT');}
  return {client,targetFingerprintSha256:hash(canonicalJson(publicTarget)),healthy:()=>must(!unexpected,'DATABASE_SESSION'),close:()=>client.end()};
}
async function github(){
  const raw=await git(['credential','fill'],{input:'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n'});
  let token=raw.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);must(token&&token.length<20000,'GIT_CREDENTIAL');
  return {async get(suffix){
    const r=await fetch('https://api.github.com/repos/veinyyxy/TechlongSoftware/'+suffix,{headers:{authorization:'Bearer '+token,
      accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Techlong-Control-Install-Review'},redirect:'error',signal:AbortSignal.timeout(20000)});
    must(r.status===200,'CI_READ');const text=await r.text();must(Buffer.byteLength(text)<256000,'CI_SIZE');return JSON.parse(text);
  },dispose(){token=undefined;}};
}
async function ciProof(g,runId,sourceCommit){
  must(/^[1-9][0-9]{0,15}$/.test(runId),'CI_ID');const r=await g.get('actions/runs/'+runId),jobs=await g.get('actions/runs/'+runId+'/attempts/1/jobs?per_page=100');
  must(String(r.id)===runId&&r.head_sha===sourceCommit&&r.head_branch==='main'&&r.path==='.github/workflows/platform-cloud-candidate.yml'&&
    r.status==='completed'&&r.conclusion==='success'&&r.run_attempt===1&&r.event==='push'&&String(r.repository?.id)==='1323312747'&&
    r.repository.full_name==='veinyyxy/TechlongSoftware'&&String(r.repository.owner?.id)==='14145707'&&
    jobs.total_count===1&&jobs.jobs?.length===1&&jobs.jobs[0].head_sha===sourceCommit&&String(jobs.jobs[0].run_id)===runId&&
    jobs.jobs[0].run_attempt===1&&jobs.jobs[0].status==='completed'&&jobs.jobs[0].conclusion==='success'&&
    jobs.jobs[0].steps.every(s=>s.status==='completed'&&s.conclusion==='success')&&
    jobs.jobs[0].steps.some(s=>s.name==='Exact SQL and actual publisher queries on disposable PostgreSQL'&&s.conclusion==='success'),'CI_NOT_VERIFIED');
  must((await g.get('branches/main')).commit.sha===sourceCommit,'REMOTE_MAIN');
  return {runId,jobId:String(jobs.jobs[0].id),sourceCommit,status:'completed',conclusion:'success',attempt:1,
    realInstallerCatalogVerified:true,verificationBasis:'exact successful PostgreSQL step with catalog verifier bound in this source'};
}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Prepare'?['--ci-run']:mode==='Install'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['Inventory','Prepare','Install','Inspect'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'MODE');
  must(process.versions.node.split('.')[0]==='22'&&!['DATABASE_URL','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_PATH'].some(k=>process.env[k])&&
    !Object.keys(process.env).some(k=>/^PG|^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k))&&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','ENVIRONMENT');
  const output=await directory(a['--output']);let m;
  if(['Prepare','Install'].includes(mode))await absent(I.slot);
  if(['Install','Inspect'].includes(mode)){
    const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST_PATH');
    m=await json(f);verifyManifest(m,a['--approved-sha'],Date.now(),mode==='Inspect');
  }
  const sql=(await readFile(P.root+'/'+I.sql,'utf8')).replaceAll('\r\n','\n'),contract=sqlContract(sql);
  await identityEvidence();await mkdir(output);const db=await database();let g;
  const read=async()=>{db.healthy();return readControlCatalog(db.client);},record=(name,value)=>writeOnce(output+'/'+name+'.json',value);
  try{
    let result;
    if(mode==='Inventory'){
      const catalog=await read();await record('catalog',catalog);result={outcome:catalog.role||catalog.schema?'CONTROL_NAMESPACE_PRESENT_READONLY':'CONTROL_NAMESPACE_ABSENT_READONLY',
        targetFingerprintSha256:db.targetFingerprintSha256,businessRowsRead:0,installSubmissions:0,slotConsumed:false};
    }else if(mode==='Prepare'){
      const sourceCommit=await cleanMain();g=await github();const ci=await ciProof(g,a['--ci-run'],sourceCommit),prestate=await read();assertAbsent(prestate);
      m=makeManifest({sourceCommit,pins:await pins(),contract,prestate,targetFingerprintSha256:db.targetFingerprintSha256,ci,createdAt:Date.now()});
      await record('manifest',m);result={outcome:'CONTROL_NOLOGIN_INSTALL_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,sourceCommit,
        expiresAt:new Date(m.expiresAt).toISOString(),installSubmissions:0,slotConsumed:false};
    }else if(mode==='Install'){
      must(db.targetFingerprintSha256===m.targetFingerprintSha256&&same(contract,m.contract),'TARGET_OR_SQL_DRIFT');g=await github();
      await ciProof(g,m.ci.runId,m.sourceCommit);await record('approved-manifest',m);
      result=await installOnce({manifest:m,approved:a['--approved-sha'],io:{
        assertSource:async()=>{await cleanMain(m.sourceCommit);must(same(await pins(),m.pins),'SOURCE_DRIFT');},readCatalog:read,
        claim:v=>writeOnce(I.slot,v),record,
        installBatch:async()=>{db.healthy();const r=await db.client.query(sql);return {commitAcknowledged:Array.isArray(r)&&r.at(-1)?.command==='COMMIT'};}}});
      if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else{
      const slot=await json(I.slot);must(slot.manifestSha256===m.manifestSha256&&slot.targetFingerprintSha256===m.targetFingerprintSha256&&
        db.targetFingerprintSha256===m.targetFingerprintSha256&&same(contract,m.contract),'INSPECT_BINDING');
      const catalog=await read();await record('catalog',catalog);
      let verified=null;try{verified=assertInstalled(catalog,m.contract,m.prestate);}catch{/* Preserve drift/partial metadata, never repair. */}
      result={outcome:verified?'CONTROL_NOLOGIN_SCHEMA_INDEPENDENTLY_VERIFIED':catalog.role===null&&catalog.schema===null?
        'CONTROL_SCHEMA_ABSENT_NO_RETRY':'CONTROL_SCHEMA_PARTIAL_OR_DRIFT_NO_RETRY',verified,installSubmissions:0,retryAllowed:false,runtimeEnabled:false};
    }
    await record('result',{...result,manifestSha256:m?.manifestSha256??null});console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{g?.dispose();await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'CONTROL_INSTALL_ENTRY_STOPPED_NO_AUTOMATIC_RETRY',failure:
    /^CONTROL_INSTALL_[A-Z_]+$/.test(e?.message)?e.message:'DATABASE_OR_LOCAL_FAILURE_DETAILS_WITHHELD'}));process.exitCode=1;
});
