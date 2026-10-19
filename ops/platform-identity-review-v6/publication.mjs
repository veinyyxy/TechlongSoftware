// Publication only. Prepare writes unreachable Git objects, never a branch or workflow.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {identityWorkflowV6} from '../platform-cloud-v6/workflows.mjs';

export const P=Object.freeze({root:'E:/NodejsProject/TechlongSoftware',base:'F:/ChatGPT_workshop',
  repository:'veinyyxy/TechlongSoftware',repositoryId:1323312747,ownerId:14145707,
  remote:'https://github.com/veinyyxy/TechlongSoftware.git',
  source:'ca2b38d8c756dd8fb800a88ded596c93687f278f',runId:39278613827,jobId:118148719175,
  ciPath:'.github/workflows/platform-cloud-candidate.yml',
  candidate:'ops/platform-identity-review-v6/platform-controller-identity-v6.candidate.yml',
  target:'.github/workflows/platform-controller-identity-v6.yml',
  workflowSha256:'ffac70244e455a547b498fc233a9a17fa5b0c022ab598c5b9735c83436007dea',
  slot:'F:/ChatGPT_workshop/techlong-w6d-identity-publication.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w6d-identity-publication-review.md',validMs:48*60*60*1000});
export const PIN_FILES=[P.candidate,'ops/platform-identity-review-v6/publication.mjs',
  'tests/platform-identity-publication-v6.test.mjs','ops/platform-cloud-v6/workflows.mjs',
  'ops/platform-cloud-v6/contract.mjs','lib/deployments/execution/hash.ts',P.riskFile,
  'ops/aws-sandbox/reviews/platform-cloud-v6.verified.json'];
const must=(v,code)=>{if(!v)throw Error('IDENTITY_PUBLICATION_'+code);};
const hash=v=>createHash('sha256').update(v).digest('hex'),lf=v=>v.replaceAll('\r\n','\n');
const same=(a,b)=>canonicalJson(a)===canonicalJson(b),sha=v=>/^[a-f0-9]{40}$/.test(v);
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const writeOnce=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',flush:true});
async function absent(file){try{await access(file);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}

export function git(args,{root=P.root,input='',env={}}={}){
  return new Promise((resolve,reject)=>{
    const c=spawn('git',args,{cwd:root,windowsHide:true,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
    let out='',bad=false;const timer=setTimeout(()=>{bad=true;c.kill();},30000);
    c.stdout.setEncoding('utf8');c.stdout.on('data',s=>{out+=s;if(out.length>3000000){bad=true;c.kill();}});
    c.stderr.on('data',()=>{});c.stdin.on('error',()=>{});
    c.on('error',()=>{clearTimeout(timer);reject(Error('IDENTITY_PUBLICATION_GIT_UNAVAILABLE'));});
    c.on('close',code=>{clearTimeout(timer);if(code||bad)reject(Error('IDENTITY_PUBLICATION_GIT_UNKNOWN_NO_RETRY'));else resolve(out);});
    c.stdin.end(input);
  });
}
export function verifyCi(run,jobs){
  must(run.id===P.runId && run.head_sha===P.source && run.head_branch==='main' && run.event==='push' &&
    run.path===P.ciPath && run.run_attempt===1 && run.status==='completed' && run.conclusion==='success' &&
    run.repository?.id===P.repositoryId && run.repository?.owner?.id===P.ownerId,'EXACT_CI');
  must(jobs.total_count===1 && jobs.jobs?.length===1,'CI_JOBS');const j=jobs.jobs[0];
  must(j.id===P.jobId && j.run_id===P.runId && j.run_attempt===1 && j.head_sha===P.source &&
    j.status==='completed' && j.conclusion==='success' && j.steps?.length===16 &&
    j.steps.every(s=>s.status==='completed' && s.conclusion==='success'),'CI_ALL_STEPS');
  return {runId:P.runId,jobId:P.jobId,sourceCommit:P.source,attempt:1,status:'completed',conclusion:'success',stepsPassed:16,
    realPostgresChecks:12,postgresProofFile:'ops/aws-sandbox/reviews/platform-cloud-v6.verified.json'};
}
export async function prepareObjects({root=P.root,output,parent,now=Date.now()}){
  must(sha(parent),'PARENT');const g=(a,o={})=>git(a,{root,...o});
  must((await g(['rev-parse','HEAD'])).trim()===parent && (await g(['branch','--show-current'])).trim()==='main' &&
    (await g(['status','--porcelain'])).trim()==='','CLEAN_MAIN');
  await absent(path.join(root,P.target));
  must((await g(['ls-tree',parent,'--',P.target])).trim()==='','TARGET_PRESENT');
  const text=lf(await readFile(path.join(root,P.candidate),'utf8'));
  must(text===identityWorkflowV6(P.source) && hash(text)===P.workflowSha256 && Buffer.byteLength(text)===1682,'CANDIDATE_BYTES');
  const index=path.join(output,'publication.index');await absent(index);
  const env={GIT_INDEX_FILE:index,GIT_AUTHOR_DATE:new Date(now).toISOString(),GIT_COMMITTER_DATE:new Date(now).toISOString()};
  await g(['read-tree',parent],{env});
  const blob=(await g(['hash-object','-w','--stdin'],{input:text})).trim();
  await g(['update-index','--add','--cacheinfo','100644,'+blob+','+P.target],{env});
  const tree=(await g(['write-tree'],{env})).trim();
  const commit=(await g(['commit-tree',tree,'-p',parent],{env,input:'feat(deployments): publish reviewed no-AWS App identity workflow\n'})).trim();
  const objects={parent,commit,tree,blob,file:P.target,workflowSha256:P.workflowSha256,unsigned:true};
  await verifyObjects(objects,{root});
  must((await g(['rev-parse','HEAD'])).trim()===parent && (await g(['status','--porcelain'])).trim()==='','PREPARE_MOVED_MAIN');
  return objects;
}
export async function verifyObjects(o,{root=P.root}={}){
  must(sha(o.parent)&&sha(o.commit)&&sha(o.tree)&&sha(o.blob)&&o.file===P.target&&o.workflowSha256===P.workflowSha256&&o.unsigned===true,'OBJECT_BINDING');
  const g=a=>git(a,{root});
  must((await g(['rev-list','--parents','-n','1',o.commit])).trim()===o.commit+' '+o.parent &&
    (await g(['rev-parse',o.commit+'^{tree}'])).trim()===o.tree &&
    (await g(['ls-tree',o.commit,'--',P.target])).trim()==='100644 blob '+o.blob+'\t'+P.target &&
    (await g(['diff','--name-status',o.parent,o.commit])).trim()==='A\t'+P.target &&
    (await g(['show',o.commit+':'+P.target]))===identityWorkflowV6(P.source),'OBJECT_CONTENT');
}
function body({parent,objects,pins,ci,createdAt}){
  must(sha(parent)&&objects.parent===parent&&Number.isSafeInteger(createdAt)&&pins.length===PIN_FILES.length&&
    pins.every((p,i)=>p.file===PIN_FILES[i]&&/^[a-f0-9]{64}$/.test(p.sha256)),'MANIFEST_INPUT');
  must(same(ci,{runId:P.runId,jobId:P.jobId,sourceCommit:P.source,attempt:1,status:'completed',conclusion:'success',stepsPassed:16,
    realPostgresChecks:12,postgresProofFile:'ops/aws-sandbox/reviews/platform-cloud-v6.verified.json'}),'MANIFEST_CI');
  return {schema:'techlong/platform-identity-publication-execution-review/v6',repository:P.repository,sourceCommit:P.source,
    parent,objects,pins,ci,createdAt,expiresAt:createdAt+P.validMs,permanentSlot:P.slot,riskFile:P.riskFile,
    actions:{pushRefspec:objects.commit+':refs/heads/main',force:false,localFastForward:objects.commit},
    effects:{gitPushAttempts:1,newManualWorkflowFiles:1,localMainFastForwards:1,automaticEvents:0,
      appKeyReads:0,appTokens:0,workflowDispatches:0,awsOrSqlCalls:0,iamOrEnvironmentChanges:0,automaticRetries:0},
    uncertainty:'Consume slot before push. Unknown push or readback stops; independent Inspect only. No rollback/reset/replay.',
    preparationIsNotExecutionApproval:true};
}
export function makeManifest(input){const b=body(input);return {...b,manifestSha256:hash(canonicalJson(b))};}
export function validateManifest(m,approved,now=Date.now(),inspect=false){
  const expected=makeManifest(m);must(same(m,expected),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'APPROVAL_OR_EXPIRED');
  return m;
}
export async function publish({manifest:m,approved,io,now=Date.now}){
  validateManifest(m,approved,now());await io.assertLocal(m);await io.preflight(m.parent);
  validateManifest(m,approved,now());await io.consume({manifestSha256:m.manifestSha256,parent:m.parent,commit:m.objects.commit,consumedAt:now()});
  try{
    await io.assertLocal(m);await io.preflight(m.parent);validateManifest(m,approved,now());
    await io.push(m);await io.record('push-command-ack',{commit:m.objects.commit});
    const proof=await io.verifyRemote(m);await io.record('post-push-readback',proof);
    await io.fastForward(m);await io.record('local-main-ack',{commit:m.objects.commit});
    return {outcome:'IDENTITY_WORKFLOW_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT',retryAllowed:false,workflowDispatched:false};
  }catch{return {outcome:'IDENTITY_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY',retryAllowed:false,workflowDispatched:false};}
}
async function safeDirectory(input,existing=false){
  const p=path.resolve(input);must(path.dirname(p).toLowerCase()===path.resolve(P.base).toLowerCase() &&
    /^techlong-w6d-identity-[a-z0-9-]+$/.test(path.basename(p)) &&
    (await realpath(P.base)).toLowerCase()===path.resolve(P.base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'REALPATH');return p;
}
async function pins(){return Promise.all(PIN_FILES.map(async file=>({file,sha256:hash(lf(await readFile(P.root+'/'+file,'utf8')))})));}
async function createIo(output){
  let token;const g=a=>git(a),record=(n,v)=>writeOnce(output+'/'+n+'.json',v);
  const get=async(suffix,allow404=false)=>{
    must(token,'GIT_CREDENTIAL');
    const r=await fetch('https://api.github.com/repos/'+P.repository+(suffix?'/'+suffix:''),{headers:{authorization:'Bearer '+token,
      accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Techlong-Reviewed-Identity-Publication'},
      redirect:'error',signal:AbortSignal.timeout(30000)});
    if(allow404&&r.status===404)return null;must(r.status===200,'GITHUB_READ_STATUS');return r.json();
  };
  // Git credential helper is existing human Git access, NOT the App PEM or an App token.
  const raw=await git(['credential','fill'],{input:'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n'});
  token=raw.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);must(token&&token.length<20000,'GIT_CREDENTIAL');
  const remote=async()=>{const r=await get('branches/main');must(sha(r.commit?.sha),'REMOTE_SHA');return r.commit.sha;};
  const ci=async()=>verifyCi(await get('actions/runs/'+P.runId),await get('actions/runs/'+P.runId+'/attempts/1/jobs?per_page=100'));
  return {record,ci,remote,
    async preflight(parent){
      const r=await get('');must(r.id===P.repositoryId&&r.full_name===P.repository&&r.owner.id===P.ownerId,'REPOSITORY');
      must(await remote()===parent,'REMOTE_PARENT');await ci();
      must(await get('contents/'+P.target+'?ref='+parent,true)===null &&
        await get('actions/workflows/platform-controller-identity-v6.yml',true)===null,'REMOTE_TARGET_EXISTS');
    },
    async assertLocal(m){
      must((await g(['branch','--show-current'])).trim()==='main' && (await g(['rev-parse','HEAD'])).trim()===m.parent &&
        (await g(['status','--porcelain'])).trim()==='' &&
        (await g(['remote','get-url','--push','--all','github'])).trim()===P.remote,'LOCAL_MAIN');
      must(same(await pins(),m.pins),'SOURCE_PINS');await absent(P.root+'/'+P.target);await verifyObjects(m.objects);
    },
    consume:v=>writeOnce(P.slot,v),
    push:m=>g(['-c','push.followTags=false','-c','remote.github.mirror=false','push','--porcelain','github',m.actions.pushRefspec]),
    async verifyRemote(m){
      must(await remote()===m.objects.commit,'PUBLISHED_HEAD');
      const c=await get('contents/'+P.target+'?ref='+m.objects.commit),w=await get('actions/workflows/platform-controller-identity-v6.yml');
      must(c.type==='file'&&c.sha===m.objects.blob&&c.encoding==='base64'&&
        hash(Buffer.from(c.content,'base64'))===P.workflowSha256 &&
        Number.isSafeInteger(w.id)&&w.id>0&&w.path===P.target&&w.state==='active','PUBLISHED_WORKFLOW');
      return {head:m.objects.commit,workflowId:w.id,path:w.path,state:w.state,blob:c.sha,workflowSha256:P.workflowSha256,workflowDispatched:false};
    },
    async fastForward(m){await this.assertLocal(m);must(await remote()===m.objects.commit,'REMOTE_BEFORE_FF');await g(['merge','--ff-only',m.objects.commit]);},
    dispose(){token=undefined;}
  };
}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Publish'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['Prepare','Publish','Inspect'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'MODE');
  must(process.versions.node.split('.')[0]==='22' && !process.env.NODE_OPTIONS&&!process.env.NODE_PATH &&
    !Object.keys(process.env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const output=await safeDirectory(a['--output']);let m;
  if(mode!=='Inspect')await absent(P.slot);
  if(mode!=='Prepare'){
    const file=path.resolve(a['--manifest']);await safeDirectory(path.dirname(file),true);must(path.basename(file)==='manifest.json','MANIFEST_PATH');
    m=await json(file);validateManifest(m,a['--approved-sha'],Date.now(),mode==='Inspect');
  }
  await mkdir(output);const io=await createIo(output);
  try{
    let result;
    if(mode==='Prepare'){
      const parent=(await git(['rev-parse','HEAD'])).trim();await io.preflight(parent);
      const objects=await prepareObjects({output,parent});
      m=makeManifest({parent,objects,pins:await pins(),ci:await io.ci(),createdAt:Date.now()});await io.assertLocal(m);
      await io.record('manifest',m);result={outcome:'FRESH_IDENTITY_PUBLICATION_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,
        parent,proposedCommit:objects.commit,expiresAt:new Date(m.expiresAt).toISOString(),remoteWrites:0,slotConsumed:false};
    }else if(mode==='Publish'){
      await io.record('approved-manifest',m);result=await publish({manifest:m,approved:a['--approved-sha'],io});
      if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else{
      const slot=await json(P.slot);must(slot.manifestSha256===m.manifestSha256&&slot.commit===m.objects.commit&&slot.parent===m.parent,'INSPECT_SLOT');
      await verifyObjects(m.objects);const head=await io.remote(),localHead=(await git(['rev-parse','HEAD'])).trim();
      result={outcome:head===m.objects.commit?'IDENTITY_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH':
        head===m.parent?'IDENTITY_PUBLICATION_REMOTE_OLD_NO_RETRY':'IDENTITY_PUBLICATION_REMOTE_DRIFT_NO_RETRY',head,localHead,
        ...(head===m.objects.commit?{proof:await io.verifyRemote(m)}:{}),retryAllowed:false,remoteWrites:0,workflowDispatched:false};
    }
    await io.record('result',{...result,manifestSha256:m.manifestSha256});console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'IDENTITY_PUBLICATION_STOPPED_NO_AUTOMATIC_RETRY',failure:
    /^IDENTITY_PUBLICATION_[A-Z_]+$/.test(e.message)?e.message:'LOCAL_OR_NETWORK_FAILURE_DETAILS_WITHHELD'}));process.exitCode=1;
});
