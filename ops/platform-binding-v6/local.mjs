// Prepare is remote read-only. Publish is one reviewed public Git file, no cloud writer.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {git,P} from '../platform-identity-review-v6/publication.mjs';
import {readPublishedLayoutV6} from '../platform-publication-v6/local.mjs';
import {platformClosureV6} from '../platform-cloud-v6/closure.mjs';
import {cloudWorkflowsV6} from '../platform-cloud-v6/workflows.mjs';
import {FROZEN_V6 as F} from '../platform-activation-v6/publication.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {J,must,same,renderBindingV6,assertBindingPrestateV6,makeBindingReviewV6,verifyBindingApprovalV6,publishBindingOnceV6} from './plan.mjs';
export const FILES=['ops/platform-binding-v6/plan.mjs','ops/platform-binding-v6/local.mjs','tests/platform-binding-v6.test.mjs','tests/fixtures/platform-binding-template-v6.json',
  'lib/deployments/controller-v6/installed-binding.ts','lib/deployments/controller-v6/configuration.ts','lib/deployments/controller-v6/runtime.ts',
  'lib/deployments/controller-v6/controller.ts','lib/deployments/controller-v6/ledger.ts','lib/deployments/controller-v6/http.ts',
  'lib/deployments/controller-v6/github.ts','lib/deployments/controller-v6/contract.ts','lib/deployments/execution/hash.ts',
  'app/api/admin/instances/[instanceId]/deployment-control/route.ts','components/admin/DeploymentControlPanel.tsx','ops/platform-publisher-v6/io.mjs',
  'ops/platform-publication-v6/local.mjs','ops/platform-activation-v6/publication.mjs','ops/platform-identity-review-v6/publication.mjs',
  'ops/platform-cloud-v6/workflows.mjs','ops/platform-cloud-v6/closure.mjs','ops/aws-sandbox/reviews/platform-app-publication-v6.executed.json',
  '.github/workflows/platform-cloud-candidate.yml',J.riskFile];
const hash=v=>createHash('sha256').update(v).digest('hex'),json=async f=>JSON.parse(await readFile(f,'utf8'));
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});};
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(P.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function objects(m){const o=m.object,text=await renderBindingV6(m.riskSha256);
  must((await git(['rev-list','--parents','-n','1',o.commit])).trim()===o.commit+' '+o.parent&&
    (await git(['rev-parse',o.commit+'^{tree}'])).trim()===o.tree&&
    (await git(['ls-tree',o.commit,'--',J.target])).trim()==='100644 blob '+o.blob+'\t'+J.target&&
    (await git(['show',o.commit+':'+J.target])).replaceAll('\r\n','\n')===text&&
    (await git(['diff','--name-status',o.parent,o.commit])).trim()==='M\t'+J.target,'EXACT_OBJECT');}
async function ioFor(output){let token;const record=(n,v)=>write(output+'/'+n+'.json',v);
  async function get(suffix,missing=false){if(!token){const raw=await git(['credential','fill'],{input:'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n'});
      token=raw.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);must(token&&token.length<20000,'GITHUB_AUTH');}
    const r=await fetch('https://api.github.com/repos/'+P.repository+'/'+suffix,{redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'Techlong-Reviewed-Binding-V6'}});
    if(missing&&r.status===404)return null;must(r.status===200,'GITHUB_READ');const b=await r.text();must(b.length<2000000,'GITHUB_SIZE');return JSON.parse(b);}
  const main=async()=>(await get('branches/main')).commit.sha;
  const ci=async(id,parent)=>{must(/^[1-9][0-9]{0,15}$/.test(id),'CI_ID');const r=await get('actions/runs/'+id),j=await get('actions/runs/'+id+'/attempts/1/jobs?per_page=100');
    must(String(r.id)===id&&r.head_sha===parent&&r.head_branch==='main'&&r.path==='.github/workflows/platform-cloud-candidate.yml'&&r.event==='push'&&
      r.run_attempt===1&&r.status==='completed'&&r.conclusion==='success'&&r.repository.id===P.repositoryId&&r.repository.owner.id===P.ownerId&&
      j.total_count===1&&j.jobs?.length===1&&j.jobs[0].head_sha===parent&&j.jobs[0].run_attempt===1&&String(j.jobs[0].run_id)===id&&j.jobs[0].status==='completed'&&j.jobs[0].conclusion==='success'&&
      j.jobs[0].steps.every(s=>s.status==='completed'&&s.conclusion==='success'),'EXACT_CI');
    return {runId:id,jobId:String(j.jobs[0].id),sourceCommit:parent,attempt:1,status:'completed',conclusion:'success'};};
  let pushes=0,ffs=0;
  return {record,ci,
    async preflight(parent){must(await main()===parent,'REMOTE_PARENT');
      const layout=await readPublishedLayoutV6(),closure=await platformClosureV6(),texts=cloudWorkflowsV6({...F,reusableCommit:J.reusable}),workflows=[];
      for(const [file,id,commit,text] of [['cloud-worker-platform-job-v6.yml',J.reusableId,J.reusable,texts.reusable],['cloud-worker-platform-v6.yml',J.workflowId,parent,texts.caller]]){
        const w=await get('actions/workflows/'+file),c=await get('contents/.github/workflows/'+file+'?ref='+commit);
        must(String(w.id)===id&&w.path==='.github/workflows/'+file&&w.state==='active'&&c.type==='file'&&c.encoding==='base64'&&hash(Buffer.from(c.content,'base64'))===hash(text),'LIVE_WORKFLOW');
        workflows.push({id,path:w.path,state:w.state,blob:c.sha,sha256:hash(text)});
      }
      const runs=await get('actions/workflows/'+J.workflowId+'/runs?per_page=100');must(runs.total_count<100&&runs.workflow_runs?.length===runs.total_count&&runs.workflow_runs.every(r=>r.status==='completed'),'NO_ACTIVE_APP_RUN');
      const p={layout,workflows,closureSha256:closure.closureSha256,newWorkflowUnfinishedRuns:0,newWorkflowRunIds:runs.workflow_runs.map(x=>String(x.id)).sort()};await assertBindingPrestateV6(p,parent);return p;},
    async assertLocal(m){must((await git(['rev-parse','HEAD'])).trim()===m.parent&&(await git(['branch','--show-current'])).trim()==='main'&&
      (await git(['status','--porcelain'])).trim()===''&&(await git(['remote','get-url','--push','--all','github'])).trim()===P.remote&&same(await pins(),m.pins),'LOCAL_SOURCE');await objects(m);},
    claim:v=>write(J.slot,v),
    async push(m,guard){must(pushes++===0&&await main()===m.parent,'PUSH_ONCE');await guard();
      await git(['-c','push.followTags=false','-c','remote.github.mirror=false','push','--porcelain','github',m.actions.pushRefspec]);},
    async verifyRemote(m){must(await main()===m.object.commit,'PUBLISHED_MAIN');const c=await get('contents/'+J.target+'?ref='+m.object.commit);
      must(c.type==='file'&&c.sha===m.object.blob&&c.encoding==='base64'&&hash(Buffer.from(c.content,'base64'))===m.object.sha256,'PUBLISHED_BINDING');
      return {head:m.object.commit,blob:c.sha,sha256:m.object.sha256,compiledBindingPublished:true,runtimeProvisioned:false,serverStarted:false};},
    async fastForward(m,guard){must(ffs++===0&&await main()===m.object.commit,'FF_ONCE');await guard();await git(['merge','--ff-only',m.object.commit]);},
    async inspect(m){await objects(m);const remote=await main(),local=(await git(['rev-parse','HEAD'])).trim();return {
      outcome:remote===m.object.commit?'BINDING_PUBLICATION_INDEPENDENTLY_VERIFIED_RUNTIME_NOT_STARTED':remote===m.parent?'BINDING_REMOTE_OLD_INSPECT_ONLY_NO_RETRY':'BINDING_REMOTE_DRIFT_INSPECT_ONLY_NO_RETRY',
      remoteMain:remote,localHead:local,...(remote===m.object.commit?{proof:await this.verifyRemote(m)}:{}),externalWrites:0,runtimeStarted:false,workflowDispatched:false,retryAllowed:false};},
    dispose(){token=undefined;}
  };
}
async function directory(s,existing=false){const p=path.resolve(s);must(path.dirname(p).toLowerCase()===path.resolve(P.base).toLowerCase()&&/^techlong-w6j-binding-[a-z0-9-]+$/.test(path.basename(p))&&
  (await realpath(P.base)).toLowerCase()===path.resolve(P.base).toLowerCase(),'DIRECTORY');if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'REALPATH');return p;}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Prepare'?['--ci-run']:mode==='Publish'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['Prepare','Publish','Inspect'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'MODE');
  must(!['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','AWS_CA_BUNDLE','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE'].some(k=>process.env[k])&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&
    !Object.keys(process.env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const output=await directory(a['--output']);let m;
  if(mode!=='Prepare'){const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST_PATH');m=await json(f);await verifyBindingApprovalV6(m,a['--approved-sha'],Date.now(),mode==='Inspect');}
  if(mode!=='Inspect')await absent(J.slot);await mkdir(output);const io=await ioFor(output);
  try{let result;if(mode==='Prepare'){
      const parent=(await git(['rev-parse','HEAD'])).trim();must((await git(['status','--porcelain'])).trim()===''&&(await git(['branch','--show-current'])).trim()==='main','CLEAN_MAIN');
      const ci=await io.ci(a['--ci-run'],parent),prestate=await io.preflight(parent),riskSha256=hash((await readFile(P.root+'/'+J.riskFile,'utf8')).replaceAll('\r\n','\n'));
      const before=(await readFile(P.root+'/'+J.target,'utf8')).replaceAll('\r\n','\n');must(before.includes('"state": "UNPUBLISHED"')&&!before.includes('"state": "PUBLISHED"'),'NOT_ALREADY_PUBLISHED');
      const proof=await json(P.root+'/ops/aws-sandbox/reviews/platform-app-publication-v6.executed.json');must(proof.state==='APP_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH'&&proof.workflows[1].id===J.workflowId&&proof.publishedReusableCommit===J.reusable,'W6I_PROOF');
      const oldRaw=await readFile('F:/ChatGPT_workshop/techlong-w6i-app-publication-20261020-a-inspect/independent-layout.json');
      must(hash(oldRaw)==='3059fc48c7ab2a93bb85aed489e637b2dfe337a4982d4a7397c3af3ed854eefa','W6I_ORIGINAL');
      const old=JSON.parse(oldRaw),normalized=structuredClone(prestate.layout);normalized.main=old.main;must(same(normalized,old),'W6I_LAYOUT_DRIFT');
      const text=await renderBindingV6(riskSha256),env={GIT_INDEX_FILE:output+'/binding.index',GIT_AUTHOR_DATE:new Date().toISOString(),GIT_COMMITTER_DATE:new Date().toISOString()};
      await git(['read-tree',parent],{env});const blob=(await git(['hash-object','-w','--stdin'],{input:text})).trim();await git(['update-index','--cacheinfo','100644,'+blob+','+J.target],{env});
      const tree=(await git(['write-tree'],{env})).trim(),commit=(await git(['commit-tree',tree,'-p',parent],{env,input:'feat(deployments): publish reviewed platform release binding\n'})).trim();
      const object={parent,commit,tree,blob,file:J.target,sha256:hash(text)};
      m=await makeBindingReviewV6({parent,object,pins:await pins(),ci,prestate,riskSha256,createdAt:Date.now()});await io.assertLocal(m);await io.record('manifest',m);await io.record('candidate-binding',{text});
      result={outcome:'BINDING_REVIEW_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,parent,proposedCommit:commit,expiresAtUtc:new Date(m.expiresAt).toISOString(),
        expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),externalWrites:0,slotConsumed:false,runtimeStarted:false};
    }else if(mode==='Publish'){await io.ci(m.ci.runId,m.parent);await io.record('approved-manifest',m);result=await publishBindingOnceV6({manifest:m,approved:a['--approved-sha'],io});if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else{const slot=await json(J.slot);must(slot.manifestSha256===m.manifestSha256&&slot.commit===m.object.commit&&slot.parent===m.parent,'INSPECT_SLOT');result=await io.inspect(m);}
    await io.record('result',{...result,manifestSha256:m.manifestSha256});console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({outcome:'BINDING_ENTRY_STOPPED_NO_RETRY',
  failure:/^(BINDING_PUBLICATION|APP_PUBLICATION)_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD',errorName:/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(e?.name)?e.name:'WITHHELD'}));process.exitCode=1;});
