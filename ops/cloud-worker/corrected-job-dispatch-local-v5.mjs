// Prepare/Observe are read-only. Dispatch stays dormant without fresh exact approval.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import yaml from 'js-yaml';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {CORRECTED_JOB_DISPATCH_V5 as V,prepareCorrectedJobDispatchV5,dispatchCorrectedJobV5,
  correctedJobDispatchSlotV5 as slot,executionObjectV5} from './corrected-job-dispatch-v5.mjs';
import {taskDefinitionPermissionSourceV5} from './task-definition-permission-local-v5.mjs';
import {prepareTaskDefinitionPermissionV5,assertTaskDefinitionLayoutV5} from './task-definition-permission-v5.mjs';
import {createEcsJobDispatchIoV5} from './ecs-job-dispatch-local-v5.mjs';
import {assertInstalledEcsJobWorkflowV5} from './ecs-job-dispatch-v5.mjs';
import {createCorrectedJobMetadataV5} from './corrected-job-metadata-v5.mjs';
import {gitLocalV5} from './activation/commit-objects-v5.mjs';
import {assertLocalEnvironmentV5} from './install/local-io-v5.mjs';
import {safeActivationFailureV5,requireActivationV5} from './activation/errors-v5.mjs';
import {prepareCloudContextV5} from './cloud-context-v5.mjs';
import {createPlatformWorkerReaderV4,admitPlatformJobV4,assertCurrentPlatformRowsV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import {assertRunWindowV3} from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
const root='E:/NodejsProject/TechlongSoftware',base='F:/ChatGPT_workshop',repo='repos/veinyyxy/TechlongSoftware',
  must=(v,c)=>requireActivationV5(v,'CORRECTED_JOB_LOCAL_'+c),same=(a,b)=>canonicalJson(a)===canonicalJson(b),
  hash=v=>createHash('sha256').update(v).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
async function absent(p){try{await access(p);throw Error('CORRECTED_JOB_LOCAL_SLOT_USED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(p,existing=false){const d=path.resolve(p);must(path.dirname(d).toLowerCase()===path.resolve(base).toLowerCase()&&
  /^techlong-w5q-[a-z0-9-]+$/.test(path.basename(d))&&(await realpath(base)).toLowerCase()===path.resolve(base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(d)).toLowerCase()===d.toLowerCase(),'REALPATH');return d;}
export async function correctedJobSourceContextV5(){
  const c=await taskDefinitionPermissionSourceV5(),text=(await readFile(root+'/'+V.correctionRecordFile,'utf8')).replaceAll('\r\n','\n');
  must(text===(await gitLocalV5(['show',V.correctionRecordCommit+':'+V.correctionRecordFile])).replaceAll('\r\n','\n')&&
    hash(text)===V.correctionRecordNormalizedLfSha256,'IMMUTABLE_CORRECTION_RECORD');
  const r=JSON.parse(text);must(r.state==='TASK_DEFINITION_READ_CORRECTION_INDEPENDENTLY_VERIFIED_NO_REVIEW'&&
    r.approvedManifestSha256===V.correctionManifestSha256&&r.independentNewProcessInspectPassed===true&&r.evidenceFiles.length===31&&
    r.newTemplateSha256===V.templateSha256&&r.newInlinePolicySha256===V.inlinePolicySha256&&r.runtimeCommitUnchanged===V.runtime&&
    r.reusableCommitUnchanged===V.reusable&&r.cloudClosureSha256Unchanged===V.closureSha256,'CORRECTION_STATE');
  for(const f of r.evidenceFiles)must(f.path.startsWith(base+'/')&&!f.path.includes('..')&&hash(await readFile(f.path))===f.rawSha256,'CORRECTION_ORIGINAL');
  const checkpoint=await readFile(base+'/techlong-w5p-corrected-checkpoint-20261018-a.json');
  must(hash(checkpoint)==='3f0717f944629fb0cff2a167fd4f5ed41ab91afe67948e0a1a90bb069ff0807d','CORRECTION_CHECKPOINT');
  const m=await json(base+'/techlong-w5p-apply-20261018-a/approved-manifest.json'),
    inspected=await json(base+'/techlong-w5p-inspect-20261018-a/result.json'),capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json');
  must(m.manifestSha256===V.correctionManifestSha256&&m.source.files.length===164&&m.source.commit===r.sourceCommitAtExecution&&
    same(m,await prepareTaskDefinitionPermissionV5({source:m.source,history:m.history,prestate:m.prestate,capsule,now:m.preparedAt}))&&
    inspected.manifestSha256===m.manifestSha256&&inspected.outcome===r.state,'CORRECTION_PLAN_AND_INSPECT');
  assertTaskDefinitionLayoutV5(inspected.proof,m,'new');
  const compatible=new Set(['README.md','docs/aws-auto-deployment-mainline.md','.github/workflows/cloud-worker-candidate.yml']),changed=[];
  for(let i=0;i<m.source.files.length;i+=8)await Promise.all(m.source.files.slice(i,i+8).map(async p=>{
    must(hash((await gitLocalV5(['show',m.source.commit+':'+p.file])).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'CORRECTION_HISTORICAL_SOURCE_PIN');
    const actual=c.source.files.find(x=>x.file===p.file);must(actual,'CORRECTION_CURRENT_PIN');
    if(actual.normalizedLfSha256!==p.normalizedLfSha256){must(compatible.has(p.file),'ONLY_EXPLICIT_CONTINUATION_CHANGE');changed.push(p.file);}
  }));
  must(same(changed.sort(),[...compatible].sort()),'EXPLICIT_CONTINUATION_FILES');
  const files=new Map(c.source.files.map(x=>[x.file,x]));
  for(const file of [V.correctionRecordFile,'docs/aws-auto-deployment-cloud-worker-w5p-corrected.md',
    'ops/cloud-worker/corrected-job-dispatch-v5.mjs','ops/cloud-worker/corrected-job-dispatch-local-v5.mjs',
    'ops/cloud-worker/corrected-job-metadata-v5.mjs','tests/cloud-worker-corrected-job-dispatch-v5.test.mjs',V.riskFile,
    'ops/aws-sandbox/reviews/cloud-worker-w5q-corrected-review.prepared.json'])
    files.set(file,{file,normalizedLfSha256:hash((await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'))});
  return {...c,source:{...c.source,files:[...files.values()].sort((a,b)=>a.file.localeCompare(b.file))},
    history:{...c.history,permissionCorrectionEvidenceVerified:true,permissionCorrectionOriginalsVerified:31,permissionCorrectionSourcePinsVerified:164,
      permissionCorrectionRecordCommit:V.correctionRecordCommit,permissionCorrectionManifestSha256:V.correctionManifestSha256,
      permissionCorrectionRecordNormalizedLfSha256:hash(text),permissionCorrectionCheckpointRawSha256:hash(checkpoint),
      failedReviewV4Preserved:true,correctedLayoutAnchor:inspected.proof,explicitCorrectedContinuationFiles:changed.sort()}};
}
async function credential(){return new Promise((resolve,reject)=>{
  const p=spawn('git',['credential','fill'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';
  const timer=setTimeout(()=>p.kill(),15000);p.stdout.setEncoding('utf8');p.stdout.on('data',b=>{text+=b;if(text.length>20000)p.kill();});
  p.stderr.on('data',()=>{});p.stdin.on('error',()=>{});p.on('error',()=>{clearTimeout(timer);reject(Error('CORRECTED_JOB_GITHUB_CREDENTIAL'));});
  p.on('close',code=>{clearTimeout(timer);const token=text.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);
    if(code||!token||text.length>20000)reject(Error('CORRECTED_JOB_GITHUB_CREDENTIAL'));else resolve(token);});
  p.stdin.end('protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
});}
export async function createCorrectedJobDispatchIoV5(output,context){
  const common=await createEcsJobDispatchIoV5(output,context);let token;
  const gh=async suffix=>{
    token??=await credential();const r=await fetch('https://api.github.com/'+suffix,{method:'GET',headers:{authorization:'Bearer '+token,
      accept:'application/vnd.github+json','x-github-api-version':V.apiVersion,'user-agent':'Techlong-Corrected-Job-ReadOnly'},
      redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Object.assign(Error('CORRECTED_JOB_GITHUB_STATUS'),{status:r.status});return r.json();
  };
  const metadata=await createCorrectedJobMetadataV5(output,context,gh),capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json'),
    runtimeContext=await prepareCloudContextV5(capsule);
  return {...common,
    async preflight(mode){
      const [repository,actor,branch,workflow,runs,caller,reusable,ci]=await Promise.all([gh(repo),gh('user'),gh(repo+'/branches/main'),
        gh(repo+'/actions/workflows/'+V.workflowId),gh(repo+'/actions/workflows/'+V.workflowId+'/runs?per_page=100'),
        gh(repo+'/contents/.github/workflows/cloud-worker-execute.yml?ref='+context.source.commit),
        gh(repo+'/contents/.github/workflows/cloud-worker-job.yml?ref='+V.reusable),gh(repo+'/actions/runs?head_sha='+context.source.commit+'&per_page=100')]);
      must(repository.id===1323312747&&repository.owner?.id===14145707&&repository.visibility==='public'&&repository.default_branch==='main'&&
        repository.permissions?.admin===true&&actor.id===14145707&&branch.commit.sha===context.source.commit&&workflow.id===V.workflowId&&
        workflow.path==='.github/workflows/cloud-worker-execute.yml'&&workflow.state==='active'&&runs.total_count<100&&
        runs.workflow_runs?.length===runs.total_count&&runs.workflow_runs.every(r=>r.status==='completed'),'GITHUB_PRESTATE');
      for(const [r,f]of [[caller,'.github/workflows/cloud-worker-execute.yml'],[reusable,'.github/workflows/cloud-worker-job.yml']])
        must(r.encoding==='base64'&&r.type==='file'&&r.path===f&&Buffer.from(r.content,'base64').toString('utf8').replaceAll('\r\n','\n')===
          (await readFile(root+'/'+f,'utf8')).replaceAll('\r\n','\n'),'REMOTE_WORKFLOW_PIN');
      assertInstalledEcsJobWorkflowV5(yaml.load(Buffer.from(caller.content,'base64').toString('utf8')));
      must(ci.total_count<100&&ci.workflow_runs?.length===ci.total_count,'SOURCE_CI_INVENTORY');const sourceCiRunIds=[];
      for(const name of ['Cloud worker portable candidate - No AWS','Cloud worker fixed-version continuation - No AWS']){
        const matches=ci.workflow_runs.filter(r=>r.name===name&&r.head_sha===context.source.commit&&r.run_attempt===1);
        must(matches.length===1&&matches[0].status==='completed'&&matches[0].conclusion==='success','SOURCE_CI_NOT_PASSED');sourceCiRunIds.push(String(matches[0].id));
      }
      const proof=await metadata.read();await common.record('metadata',proof);
      if(context.cloudManifest)await common.validateCloud(context.cloudManifest,context.cloud.reference,context.source.commit);
      const env=parseEnv(await readFile(root+'/.env.local','utf8')),reader=createPlatformWorkerReaderV4(env.DATABASE_URL),
        observed=await reader.read(V.jobId,AbortSignal.timeout(30000),V.requesterId);
      if(mode!=='Inspect'){
        await admitPlatformJobV4({root:runtimeContext.root,predecessor:runtimeContext.predecessor,observed,now:Date.now()});
        must(await sha256Hex(observed.job)===V.jobRowSha256&&await sha256Hex(observed.snapshot)===V.snapshotSha256&&observed.jobs.length===4,'CURRENT_HELD_REQUEST');
        if(context.cloudManifest)assertCurrentPlatformRowsV4(context.cloudManifest,observed,Date.now());
      }
      const rows={jobId:V.jobId,jobRowSha256:await sha256Hex(observed.job),snapshotSha256:await sha256Hex(observed.snapshot),jobsSha256:await sha256Hex(observed.jobs),
        requesterSha256:await sha256Hex(observed.requester),activeJobs:observed.jobs.filter(j=>['pending','running','retry_wait'].includes(j.status)).length,
        status:observed.job.status,readOnlyTransactions:reader.counts().completedReadOnlyTransactions};await common.record('current-job-metadata',rows);
      if(mode==='RunOnce')assertRunWindowV3(context.cloudManifest,Date.now());
      return {main:branch.commit.sha,workflowId:V.workflowId,environmentId:V.environmentId,metadataVerified:true,unfinishedRuns:0,
        runtimeCommit:V.runtime,reusableCommit:V.reusable,metadataSha256:await sha256Hex(proof),sourceCiConfirmed:true,sourceCiRunIds:sourceCiRunIds.sort(),
        completedRunIds:runs.workflow_runs.map(r=>String(r.id)).sort(),roleId:proof.foundation.roleId,tableId:proof.foundation.tableId,correctedLayout:proof.correctedLayout,...rows};
    },
    async consumeSlot(mode,v){await writeFile(slot(mode),JSON.stringify(v)+'\n',{flag:'wx',flush:true});},
    dispose(){token=undefined;common.dispose();metadata.dispose();},
  };
}
export async function mainCorrectedJobDispatchV5(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],cloudMode=a['--cloud-mode'];let keys=['--mode','--output'];
  if(mode==='Prepare')keys.push('--cloud-mode',...(cloudMode==='Review'?[]:['--cloud-review-directory']),...(cloudMode==='Inspect'?['--execution-directory']:[]));
  else if(mode==='Dispatch')keys.push('--manifest','--approved-sha',...(a['--cloud-review-directory']?['--cloud-review-directory']:[]),...(a['--execution-directory']?['--execution-directory']:[]));
  else if(mode==='Observe')keys.push('--dispatch-directory');
  must(['Prepare','Dispatch','Observe'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'ARG_SET');
  assertLocalEnvironmentV5();const output=await directory(a['--output']);await mkdir(output);const context=await correctedJobSourceContextV5();let m;
  if(mode==='Dispatch'){
    const file=path.resolve(a['--manifest']);await directory(path.dirname(file),true);must(path.basename(file)==='manifest.json','MANIFEST_FILE');m=await json(file);
    must(m.source.commit===context.source.commit,'LOCAL_MAIN_CHANGED');
  }
  if(mode==='Observe'){
    const d=await directory(a['--dispatch-directory'],true);m=await json(d+'/approved-manifest.json');const ack=await json(d+'/dispatch-api-ack.json');
    must(m.schema==='techlong/cloud-worker-corrected-job-dispatch-review/v5'&&['Review','RunOnce','Inspect'].includes(m.mode)&&
      m.source.commit===context.source.commit&&same(m.source,context.source)&&same(m.history,context.history),'OBSERVE_FROZEN_SOURCE');
    const {manifestSha256,...body}=m;must(await sha256Hex(body)===manifestSha256,'OBSERVE_MANIFEST_SHA');
    const used=await json(slot(m.mode));must(used.manifestSha256===manifestSha256&&used.retryAllowed===false,'OBSERVE_PERMANENT_SLOT');
    const io=await createCorrectedJobDispatchIoV5(output,context);try{const result=await io.observe(m,String(ack.workflow_run_id));await io.record('result',result);
      console.log(JSON.stringify(result,null,2));return result;}finally{io.dispose();}
  }
  context.mode=mode==='Prepare'?cloudMode:m.mode;must(['Review','RunOnce','Inspect'].includes(context.mode),'CLOUD_MODE');
  await absent(slot(context.mode));context.cloud=null;context.execution=null;const io=await createCorrectedJobDispatchIoV5(output,context);
  try{
    if(context.mode!=='Review'){
      const d=await directory(a['--cloud-review-directory'],true),cloud=await json(d+'/verified.json'),cm=await json(d+'/cloud-manifest.json');
      must(cloud.mode==='Review'&&cloud.outcome==='CLOUD_REVIEW_RECONSTRUCTED_NOT_EXECUTION_APPROVAL','REVIEW_DIRECTORY');
      await io.validateCloud(cm,cloud.reference,context.source.commit);context.cloudManifest=cm;
      context.cloud={jobId:V.jobId,manifestSha256:cm.manifestSha256,reference:cloud.reference,code:cm.code,
        claimBy:cm.jobPlan.claimBy,deadline:cm.jobPlan.deadline,workloadExpiresAt:cm.workload.workloadExpiresAt};
    }else must(!a['--cloud-review-directory']&&!a['--execution-directory'],'REVIEW_NO_EXTRA_REFS');
    if(context.mode==='Inspect'){
      const d=await directory(a['--execution-directory'],true),execution=await json(d+'/verified.json');
      must(execution.mode==='RunOnce','EXECUTION_DIRECTORY');executionObjectV5(context.cloud,execution);context.execution={jobId:execution.jobId,
        manifestSha256:execution.manifestSha256,outcome:execution.outcome,reference:execution.reference,executionRun:execution.executionRun};
    }else must(!a['--execution-directory'],'NO_EXTRA_EXECUTION');
    let result;
    if(mode==='Prepare'){
      const prestate=await io.preflight(context.mode);m=await prepareCorrectedJobDispatchV5({...context,mode:context.mode,prestate,now:Date.now()});await io.record('manifest',m);
      result={outcome:'PREPARED_NOT_DISPATCHED',cloudMode:context.mode,jobId:V.jobId,manifestSha256:m.manifestSha256,main:context.source.commit,
        expiresAt:new Date(m.expiresAt).toISOString(),workflowDispatches:0,secretValueReads:0,slotConsumed:false};
    }else{await io.record('approved-manifest',m);result=await dispatchCorrectedJobV5({manifest:m,approved:a['--approved-sha'],context:{...context,mode:context.mode},io});}
    await io.record('result',result);console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)mainCorrectedJobDispatchV5().catch(e=>{
  console.error(JSON.stringify({outcome:'STOPPED_NO_AUTOMATIC_WRITE_RETRY',failure:safeActivationFailureV5(e),retryAllowed:false}));process.exitCode=1;
});
