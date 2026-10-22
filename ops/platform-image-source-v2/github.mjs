import {git} from './files.mjs';
import {P,S,must,validateGithubLayout,verifyRun} from './review.mjs';
import {verifyCandidate} from '../platform-image-publication-v2/plan.mjs';
async function json(r){
  must(r.body,'SOURCE_GITHUB_BODY');const reader=r.body.getReader(),parts=[];let size=0;
  try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;must(size<=1000000,'SOURCE_GITHUB_SIZE');parts.push(Buffer.from(p.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function createGithub({fetcher=fetch,credential=()=>{
  const raw=git(['credential','fill'],`protocol=https\nhost=github.com\npath=${P.repository}.git\n\n`);
  const token=raw.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);must(token&&token.length<=16000&&!/[\r\n]/.test(token),'SOURCE_GITHUB_CREDENTIAL');return token;
}}={}){
  let token,posts=0;
  async function request(suffix,{method='GET',body}={}){
    must(suffix.startsWith(`/repos/${P.repository}/`)||suffix===`/repos/${P.repository}`||suffix==='/user','SOURCE_GITHUB_SCOPE');
    if(method!=='GET')must(method==='POST'&&suffix===`/repos/${P.repository}/actions/workflows/${P.callerFile}/dispatches`&&posts++===0,'SOURCE_DISPATCH_ONCE');
    token??=await credential();
    const r=await fetcher('https://api.github.com'+suffix,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    must(r.status===200,'SOURCE_GITHUB_RESPONSE');return json(r);
  }
  const prefix=`/repos/${P.repository}`;
  return {
    async readIdentity(){const v=await request('/user');return {id:v.id,login:v.login};},
    async metadata(head,m){
      const paths={user:'/user',repo:prefix,oidc:prefix+'/actions/oidc/customization/sub',
        environment:prefix+'/environments/'+P.environment,branches:prefix+'/environments/'+P.environment+'/deployment-branch-policies?per_page=100',
        head:prefix+'/git/ref/heads/main',workflow:prefix+'/actions/workflows/'+P.callerFile,
        producer:prefix+'/actions/runs/'+P.runId,artifact:prefix+'/actions/artifacts/'+P.artifactId,
        reusableCi:prefix+'/actions/runs/'+S.reusableCiRun};
      const v={observedAtUtc:new Date().toISOString()};await Promise.all(Object.entries(paths).map(async([k,p])=>{v[k]=await request(p);}));
      v.user={id:v.user.id,login:v.user.login}; // do not retain unrelated /user fields
      validateGithubLayout(v);verifyCandidate(v.producer,v.artifact);
      must(v.head.object?.sha===head&&v.workflow.path===`.github/workflows/${P.callerFile}`&&v.workflow.state==='active'&&
        Number.isSafeInteger(v.workflow.id)&&(!m||v.workflow.id===m.callerWorkflowId),'SOURCE_REMOTE_HEAD_WORKFLOW');
      const ci=v.reusableCi;
      must(ci.id===S.reusableCiRun&&ci.head_sha===S.reusableCommit&&ci.workflow_id===S.reusableCiWorkflow&&ci.repository?.id===P.repositoryId&&
        ci.status==='completed'&&ci.conclusion==='success'&&ci.event==='push'&&ci.head_branch==='main'&&ci.run_attempt===1,'SOURCE_REUSABLE_CI');
      if(m)v.sourceCi=await request(prefix+'/actions/runs/'+m.sourceCiRunId);
      else{
        const list=await request(prefix+`/actions/runs?head_sha=${head}&event=push&per_page=100`);
        must(list.total_count<=100,'SOURCE_CI_PAGINATION');const rows=list.workflow_runs?.filter(r=>r.path===`.github/workflows/${S.sourceCiFile}`);
        must(rows?.length===1,'SOURCE_CI_UNIQUE');v.sourceCi=rows[0];
      }
      const sc=v.sourceCi;
      must(sc.head_sha===(m?.operatorSourceCommit??head)&&sc.repository?.id===P.repositoryId&&sc.path===`.github/workflows/${S.sourceCiFile}`&&
        sc.head_branch==='main'&&sc.event==='push'&&sc.run_attempt===1&&sc.status==='completed'&&sc.conclusion==='success','SOURCE_OPERATOR_CI');
      return v;
    },
    async dispatch(inner,text,sha){
      const head=await request(prefix+'/git/ref/heads/main');must(head.object?.sha===inner.dispatchCommit,'SOURCE_LAST_REMOTE_HEAD');
      const ack=await request(prefix+`/actions/workflows/${P.callerFile}/dispatches`,{method:'POST',
        body:{ref:'main',return_run_details:true,inputs:{review_json:text,review_sha:sha}}});
      must(Number.isSafeInteger(ack.workflow_run_id)&&ack.workflow_run_id>0&&ack.html_url===`https://github.com/${P.repository}/actions/runs/${ack.workflow_run_id}`&&
        ack.run_url===`https://api.github.com/repos/${P.repository}/actions/runs/${ack.workflow_run_id}`,'SOURCE_DISPATCH_ACK');
      return {runId:ack.workflow_run_id,url:ack.html_url,dispatchCommit:inner.dispatchCommit};
    },
    async wait(ack,inner,sha,workflowId,onWaiting,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
      let announced=false;const deadline=Date.parse(inner.grantExpiresAt)-10*60000;
      for(let n=0;n<201;n++){
        must(now()<deadline,'SOURCE_RUN_DEADLINE');const r=await request(prefix+'/actions/runs/'+ack.runId);
        verifyRun(r,{id:ack.runId,workflowId,head:inner.dispatchCommit});
        if(r.status==='completed'){must(r.conclusion==='success','SOURCE_RUN_FAILED');return r;}
        must(['queued','requested','waiting','pending','in_progress'].includes(r.status),'SOURCE_RUN_STATUS');
        if(!announced){announced=true;await onWaiting({runId:ack.runId,url:ack.url,reviewSha256:sha,latestWaitUtc:new Date(deadline).toISOString(),
          action:'Review deployments > techlong-sandbox-deploy; approve only this run; never re-run'});}
        await sleep(15000);
      }throw Error('PLATFORM_PUBLISH_V2_SOURCE_RUN_POLL_LIMIT');
    },
    close(){token=undefined;},
  };
}
