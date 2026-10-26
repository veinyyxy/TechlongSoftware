// Exactly three GitHub GETs; no dispatch, AWS identity or private files.
import {git} from '../platform-image-source-v2/files.mjs';
import {T,must} from './plan.mjs';
const REPOSITORY='veinyyxy/TechlongSoftware';
export const METADATA_FILES=Object.freeze(['docs/aws-auto-deployment-w9p-recovery-hosting-code-verified.md',
  'ops/aws-sandbox/reviews/platform-recovery-hosting-v1.code-verified.json',
  'docs/aws-auto-deployment-w9p-recovery-hosting-update-prepared.md','ops/aws-sandbox/reviews/platform-recovery-hosting-v1.prepared.json']);
export function metadataOnly(files){must(files.every(f=>METADATA_FILES.includes(f)),'CI_SOURCE_DRIFT');}
export async function readCi(id,head,{fetcher=fetch,gitRunner=git,credential=()=>{
  const raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath='+REPOSITORY+'.git\n\n');
  return raw.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);
}}={}){
  must(/^[1-9][0-9]{0,15}$/.test(id),'CI_ID');let token=await credential();must(token,'CI_AUTH');let calls=0;
  const get=async p=>{must(++calls<=3,'CI_READ_BUDGET');const r=await fetcher('https://api.github.com/repos/'+REPOSITORY+'/'+p,
    {headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    must(r.status===200,'CI_READ');const t=await r.text();must(t.length<300000,'CI_SIZE');return JSON.parse(t);};
  try{const r=await get('actions/runs/'+id),j=await get('actions/runs/'+id+'/attempts/1/jobs?per_page=100');
    must(/^[a-f0-9]{40}$/.test(r.head_sha??''),'CI_HEAD');gitRunner(['merge-base','--is-ancestor',r.head_sha,head]);
    const changed=gitRunner(['diff','--name-only',r.head_sha,head]).trim().split(/\r?\n/).filter(Boolean);metadataOnly(changed);
    must(String(r.id)===id&&r.head_branch==='main'&&r.path==='.github/workflows/'+T.ciFile&&r.event==='push'&&r.run_attempt===1&&
      r.repository?.id===1323312747&&r.repository.owner?.id===14145707&&r.status==='completed'&&r.conclusion==='success'&&
      j.total_count===1&&j.jobs?.length===1&&j.jobs[0].head_sha===r.head_sha&&j.jobs[0].run_attempt===1&&String(j.jobs[0].run_id)===id&&
      j.jobs[0].status==='completed'&&j.jobs[0].conclusion==='success'&&j.jobs[0].steps.every(s=>s.status==='completed'&&s.conclusion==='success')&&
      j.jobs[0].steps.some(s=>s.name==='Recovery hosting update contracts'&&s.conclusion==='success')&&(await get('branches/main')).commit.sha===head,'EXACT_CI');
    return {runId:id,jobId:String(j.jobs[0].id),sourceCommit:head,testedSourceCommit:r.head_sha,metadataOnlyChangedFiles:changed,
      attempt:1,status:'completed',conclusion:'success',githubGets:calls};
  }finally{token=undefined;}
}
