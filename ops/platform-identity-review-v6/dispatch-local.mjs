import {readFile,writeFile,mkdir,lstat,realpath,open,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {git,P} from './publication.mjs';
import {D,SOURCES,must,hash,makeReview,verifyReview,verifyLayout,dispatchOnce,boundedBytes,
  verifyAckBinding,cleanupSummary,verifyRunContext,artifactReference,decodeProofZip,verifyProof} from './dispatch.mjs';
const fold=v=>path.resolve(v).toLowerCase(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const writeOnce=(f,v)=>writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});
async function absent(f){try{await access(f);must(false,'SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function unused(){for(const f of [D.slot,D.ack,D.receipt])await absent(f);}
async function directory(input,existing=false){const p=path.resolve(input);
  must(path.dirname(p).toLowerCase()===path.resolve(P.base).toLowerCase()&&/^techlong-w6e-identity-[a-z0-9-]+$/.test(path.basename(p))&&
    fold(await realpath(P.base))===fold(P.base),'OUTPUT_DIRECTORY');
  if(existing)must(fold(await realpath(p))===fold(p),'OUTPUT_REALPATH');return p;
}
export async function sourcePins(){return Promise.all(SOURCES.map(async file=>({file,sha256:hash((await readFile(P.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));}
export async function snapshotKeyMetadata(){
  must(process.platform==='win32','KEY_PLATFORM');const st=await lstat(D.key);
  must(st.isFile()&&!st.isSymbolicLink()&&fold(await realpath(D.key))===fold(D.key),'KEY_FILE');
  let text;try{text=execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',P.root+'/scripts/controller-auth-metadata-v6.ps1'],
    {encoding:'utf8',timeout:15000,maxBuffer:16000,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch{must(false,'KEY_METADATA');}
  const m=JSON.parse(text.trim());must(m.protectedThreePrincipalAcl===true&&m.keyContentRead===false&&m.length===st.size,'KEY_METADATA');
  const name=path.basename(D.key);must((await git(['check-ignore','--',name])).trim()===name&&
    (await git(['ls-files','--',name])).trim()==='','KEY_TRACKED');return m;
}
export async function readKeyOnce(expected){
  must(same(await snapshotKeyMetadata(),expected),'KEY_DRIFT');const before=await lstat(D.key),handle=await open(D.key,'r');let bytes;
  try{const s=await handle.stat();must(s.isFile()&&s.size===before.size&&s.ino===before.ino&&s.dev===before.dev&&
      s.mtimeMs===before.mtimeMs&&s.size>0&&s.size<=16000,'KEY_OPEN_DRIFT');
    bytes=Buffer.alloc(s.size+1);const r=await handle.read(bytes,0,bytes.length,0),after=await handle.stat();
    must(r.bytesRead===s.size&&after.size===s.size&&after.mtimeMs===s.mtimeMs&&same(await snapshotKeyMetadata(),expected),'KEY_READ_DRIFT');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,r.bytesRead));
  }finally{bytes?.fill(0);await handle.close();}
}
async function cleanMain(expected){
  const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
    (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected)&&
    (await git(['remote','get-url','--push','--all','github'])).trim()===P.remote,'CLEAN_MAIN');return head;
}
async function humanReader(){
  const raw=await git(['credential','fill'],{input:'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n'});
  let token=raw.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);must(token&&token.length<20000,'GIT_CREDENTIAL');
  const request=async suffix=>{
    must((suffix===''||suffix.startsWith('/'))&&!suffix.includes('://'),'READ_PATH');
    return fetch(D.api+'/repos/'+D.repository+suffix,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2026-03-10',
        'user-agent':'Techlong-Reviewed-Identity-Readonly'}});
  };
  return {async get(suffix){const r=await request(suffix);must(r.status===200,'READ_STATUS');
      try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(r,256000)));}catch{must(false,'READ_JSON');}},
    async zip(id){
      must(/^[1-9][0-9]{0,15}$/.test(id),'ARTIFACT_ID');const r=await request('/actions/artifacts/'+id+'/zip');must(r.status===302,'ARTIFACT_REDIRECT');
      const url=new URL(r.headers.get('location'));
      must(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443')&&
        (/^[a-z0-9-]+\.blob\.core\.windows\.net$/.test(url.hostname)||/^[a-z0-9.-]+\.actions\.githubusercontent\.com$/.test(url.hostname)),
      'ARTIFACT_STORAGE_HOST');
      // Signed storage URL stays in memory; NEVER forward the GitHub Authorization header.
      const data=await fetch(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
      must(data.status===200,'ARTIFACT_STORAGE_STATUS');return boundedBytes(data,65536);
    },dispose(){token=undefined;}};
}
async function preflight(reader,m){
  const r=await reader.get('');must(String(r.id)==='1323312747'&&String(r.owner?.id)==='14145707'&&r.full_name===D.repository,'REPOSITORY');
  verifyLayout(await reader.get('/git/ref/heads/main'),await reader.get('/actions/workflows/'+D.workflowId),
    await reader.get('/contents/'+D.workflowFile+'?ref='+m.sourceCommit),await reader.get('/actions/workflows/'+D.workflowId+'/runs?per_page=100'),m);
}
async function assertReady(m,approved){
  verifyReview(m,approved);await cleanMain(m.sourceCommit);
  must(same(await sourcePins(),m.pins)&&same(await snapshotKeyMetadata(),m.keyMetadata),'SOURCE_OR_KEY_METADATA_DRIFT');
  must((await git(['diff','--name-only',D.frozenSource,'HEAD','--',
    'lib/deployments/controller-v6/github.ts','lib/deployments/controller-v6/contract.ts',
    'lib/deployments/platform-controller-registration-v1.ts','lib/deployments/execution/hash.ts',
    'ops/platform-cloud-v6/identity.mjs','ops/platform-cloud-v6/contract.mjs','ops/platform-cloud-v6/workflows.mjs'])).trim()==='','FROZEN_IMPORT_DRIFT');
}
async function inspect(m,output){
  const slot=await json(D.slot);must(slot.manifestSha256===m.manifestSha256&&slot.sourceCommit===m.sourceCommit,'INSPECT_SLOT');
  let receipt;try{receipt=await json(D.receipt);}catch(e){if(e.code!=='ENOENT')throw e;}const cleanup=cleanupSummary(receipt,m);
  let ack;try{ack=await json(D.ack);}catch(e){if(e.code!=='ENOENT')throw e;
    return {outcome:'ACK_UNKNOWN_MANUAL_READONLY_RECOVERY_REQUIRED_NO_RETRY',cleanup,retryAllowed:false,privateKeyReads:0,externalWrites:0};}
  verifyAckBinding(ack,m);
  const reader=await humanReader();
  try{
    const run=await reader.get('/actions/runs/'+ack.runId);verifyRunContext(run,ack,m);
    const observation={runId:ack.runId,url:ack.url,sourceCommit:m.sourceCommit,workflowId:D.workflowId,status:run.status,conclusion:run.conclusion,
      actorId:String(run.actor.id),triggeringActorId:String(run.triggering_actor.id),attempt:1};
    await writeOnce(output+'/run-observation.json',observation);
    if(run.status!=='completed')return {outcome:'IDENTITY_PENDING_HUMAN_APPROVAL_OR_RUN',observation,cleanup,realAppActorVerified:false,externalWrites:0,retryAllowed:false};
    if(run.conclusion!=='success')return {outcome:'IDENTITY_RUN_NOT_SUCCESS_NO_RETRY',observation,cleanup,realAppActorVerified:false,externalWrites:0,retryAllowed:false};
    const list=await reader.get('/actions/runs/'+ack.runId+'/artifacts?per_page=100'),a=artifactReference(list,ack,m),zip=await reader.zip(a.id),
      proof=decodeProofZip(zip,a.zipSha256),verified=await verifyProof(proof,run,ack,m);
    await writeOnce(output+'/identity-proof.json',proof);
    return {outcome:'EXACT_APP_IDENTITY_INDEPENDENTLY_VERIFIED_NOT_AWS_AUTHORIZATION',observation,verified,
      artifact:{id:a.id,zipSha256:a.zipSha256,proofSha256:proof.proofSha256},cleanup,realAppActorVerified:true,awsOrSqlCalls:0,
      privateKeyReads:0,appTokensCreated:0,externalWrites:0,retryAllowed:false,canDeploy:false};
  }finally{reader.dispose();}
}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Dispatch'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['Prepare','Dispatch','Inspect'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'MODE');
  must(process.platform==='win32'&&process.versions.node.split('.')[0]==='22'&&fold(await realpath(P.root))===fold(P.root)&&
    !['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY'].some(k=>process.env[k])&&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!Object.keys(process.env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),
  'ENVIRONMENT');
  const output=await directory(a['--output']);let m;
  if(mode!=='Inspect')await unused();
  if(mode!=='Prepare'){
    const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST_PATH');
    m=await json(f);verifyReview(m,a['--approved-sha'],Date.now(),mode==='Inspect');
  }
  await mkdir(output);let result;
  if(mode==='Inspect')result=await inspect(m,output);
  else{
    const reader=await humanReader();
    try{
      if(mode==='Prepare'){
        m=makeReview({sourceCommit:await cleanMain(),nonce:randomBytes(32).toString('hex'),createdAt:Date.now(),
          keyMetadata:await snapshotKeyMetadata(),pins:await sourcePins()});await preflight(reader,m);await assertReady(m,m.manifestSha256);
        await writeOnce(output+'/manifest.json',m);result={outcome:'APP_IDENTITY_DISPATCH_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,
          sourceCommit:m.sourceCommit,workflowId:D.workflowId,expiresAt:new Date(m.expiresAt).toISOString(),keyContentReads:0,appTokensCreated:0,
          workflowDispatches:0,slotConsumed:false};
      }else{
        await writeOnce(output+'/approved-manifest.json',m);
        const receipt=await dispatchOnce({review:m,approved:a['--approved-sha'],deps:{now:Date.now,fetch:globalThis.fetch,
          assertReady:()=>assertReady(m,a['--approved-sha']),preflight:()=>preflight(reader,m),
          claim:()=>writeOnce(D.slot,{schema:'techlong/platform-app-identity-intent/v6',manifestSha256:m.manifestSha256,sourceCommit:m.sourceCommit,
            claimedAt:Date.now(),retryAllowed:false}),readKey:()=>readKeyOnce(m.keyMetadata),
          beforePost:()=>assertReady(m,a['--approved-sha']),saveAck:v=>writeOnce(D.ack,v),saveReceipt:v=>writeOnce(D.receipt,v)}});
        result={outcome:receipt.outcome,manifestSha256:m.manifestSha256,ack:receipt.dispatchAckSaved?receipt.ack:null,
          tokenRevocationHttp204:receipt.tokenRevocationHttp204,tokenMayRemain:receipt.tokenMayRemain,retryAllowed:false,canDeploy:false};
        if(result.outcome.startsWith('STOPPED'))process.exitCode=1;
      }
    }finally{reader.dispose();}
  }
  await writeOnce(output+'/result.json',{...result,manifestSha256:m.manifestSha256});console.log(JSON.stringify({...result,output},null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'IDENTITY_DISPATCH_ENTRY_STOPPED_NO_RETRY',failure:
    /^IDENTITY_DISPATCH_[A-Z_]+$/.test(e?.message)?e.message:'LOCAL_OR_PROVIDER_FAILURE_DETAILS_WITHHELD'}));process.exitCode=1;
});
