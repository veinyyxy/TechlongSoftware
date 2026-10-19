// One new local attempt. Old entries remain byte-identical and cannot be replayed.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {DynamoDBClient,DescribeTableCommand,TransactGetItemsCommand} from '@aws-sdk/client-dynamodb';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {correctedJobSourceContextV5,createCorrectedJobDispatchIoV5} from './corrected-job-dispatch-local-v5.mjs';
import {executionObjectV5} from './corrected-job-dispatch-v5.mjs';
import {APPROVAL_HANDOFF_V5 as V,handoffSlotV5 as slot,prepareHandoffV5,dispatchHandoffV5,reviewToRunOnceHandoffV5,runOnceHandoffScopeV5,assertHandoffBudgetV5} from './approval-handoff-v5.mjs';
import {assertLocalEnvironmentV5} from './install/local-io-v5.mjs';
import {gitLocalV5} from './activation/commit-objects-v5.mjs';
import {requireActivationV5,safeActivationFailureV5} from './activation/errors-v5.mjs';
const root='E:/NodejsProject/TechlongSoftware',base='F:/ChatGPT_workshop',repo='repos/veinyyxy/TechlongSoftware',
  must=(v,c)=>requireActivationV5(v,'HANDOFF_LOCAL_'+c),same=(a,b)=>canonicalJson(a)===canonicalJson(b),
  hash=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
async function absent(p){try{await access(p);throw Error('HANDOFF_LOCAL_SLOT_USED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(p,existing=false){const d=path.resolve(p);must(path.dirname(d).toLowerCase()===path.resolve(base).toLowerCase()&&
  /^techlong-w5r-[a-z0-9-]+$/.test(path.basename(d))&&(await realpath(base)).toLowerCase()===path.resolve(base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(d)).toLowerCase()===d.toLowerCase(),'REALPATH');return d;}
export async function handoffSourceContextV5(){
  const c=await correctedJobSourceContextV5(),checkpoint=await readFile(base+'/techlong-w5q-runonce-failed-checkpoint-20261018-a.json');
  must(hash(checkpoint)===V.failureCheckpointSha256,'FAILURE_CHECKPOINT');const failed=JSON.parse(checkpoint);
  const check=async f=>must(f.path.startsWith(base+'/')&&!f.path.includes('..')&&hash(await readFile(f.path))===f.rawSha256,'FAILURE_ORIGINAL');
  must(failed.failedRunOnceRunId===V.previousRunId&&failed.frozenCallerMain===V.previousSourceCommit&&failed.runConclusion==='failure'&&
    failed.runtimeStartedAt==='2026-10-18T23:13:22Z'&&failed.originalClaimBy==='2026-10-18T23:10:29.859Z'&&
    failed.allFiveDynamoJournalEntriesAbsentInTransactionalRead===true&&failed.jobStillPendingAttemptsZeroNoLease===true,'FAILURE_STATE');
  for(const f of failed.evidenceFiles)await check(f);
  const dispatched=await json(base+'/techlong-w5q-runonce-dispatched-checkpoint-20261018-a.json');for(const f of dispatched.evidenceFiles)await check(f);
  const reviewDispatched=await json(base+'/techlong-w5q-dispatched-checkpoint-20261018-a.json');for(const f of reviewDispatched.evidenceFiles)await check(f);
  const summary=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5q-runonce.stopped.json');
  must(summary.failureCheckpointRawSha256===hash(checkpoint)&&summary.failedRunId===V.previousRunId&&summary.sourceCommit===V.previousSourceCommit&&
    summary.state===failed.state&&summary.successfulReviewRunId===V.previousReviewRunId,'TRACKED_FAILURE_SUMMARY');
  const prior=await json(base+'/techlong-w5q-runonce-dispatch-20261018-a/approved-manifest.json'),{manifestSha256,...body}=prior;
  must(await sha256Hex(body)===manifestSha256&&manifestSha256===failed.approvedRunOnceManifestSha256&&prior.source.commit===V.previousSourceCommit&&
    prior.source.files.length===172&&prior.mode==='RunOnce','PRIOR_APPROVAL');
  const compatible=new Set(['README.md','docs/aws-auto-deployment-mainline.md','.github/workflows/cloud-worker-candidate.yml']),changed=[];
  for(let i=0;i<prior.source.files.length;i+=8)await Promise.all(prior.source.files.slice(i,i+8).map(async p=>{
    must(hash((await gitLocalV5(['show',V.previousSourceCommit+':'+p.file])).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'PREVIOUS_ATTEMPT_GIT_PIN');
    const current=c.source.files.find(x=>x.file===p.file);must(current,'CURRENT_PIN_PRESENT');
    if(current.normalizedLfSha256!==p.normalizedLfSha256){must(compatible.has(p.file),'ONLY_HANDOFF_LOCAL_PREPARATION');changed.push(p.file);}
  }));
  must(same(changed.sort(),[...compatible].sort()),'EXPLICIT_HANDOFF_PREPARATION_FILES');
  const files=new Map(c.source.files.map(p=>[p.file,p]));
  for(const file of ['ops/cloud-worker/approval-handoff-v5.mjs','ops/cloud-worker/approval-handoff-local-v5.mjs',
    'tests/cloud-worker-approval-handoff-v5.test.mjs',V.riskFile,'ops/aws-sandbox/reviews/cloud-worker-w5r-approval-handoff.prepared.json',
    'ops/aws-sandbox/reviews/cloud-worker-w5q-runonce.stopped.json','docs/aws-auto-deployment-cloud-worker-w5q-runonce-stopped.md'])
    files.set(file,{file,normalizedLfSha256:hash((await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'))});
  return {...c,source:{...c.source,files:[...files.values()].sort((a,b)=>a.file.localeCompare(b.file))},
    history:{...c.history,expiredRunOnceEvidenceVerified:true,previousAttemptSourcePinsVerified:172,previousRunOnceRunId:V.previousRunId,
      previousReviewRunId:V.previousReviewRunId,previousRunOnceLocalSlotPreserved:true,previousFailureCheckpointSha256:hash(checkpoint),
      previousAttemptCompatibleFiles:changed.sort()}};
}
export async function createHandoffIoV5(output,context){
  const common=await createCorrectedJobDispatchIoV5(output,context),ddb=new DynamoDBClient({region:'ca-central-1',maxAttempts:1,ignoreConfiguredEndpointUrls:true,
    credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})});
  return {...common,
    async preflight(mode){
      const p=await common.preflight(mode);if(mode==='Inspect')return p;
      const TableName='techlong-sandbox-deployment-worker-journal-v1',send=q=>ddb.send(q,{abortSignal:AbortSignal.timeout(30000)}),
        t=await send(new DescribeTableCommand({TableName})),entries=['run','claim_job','create_workload','private_control_load','atomic_complete'];
      must(t.Table?.TableId==='ea69c69e-1c48-481a-83f0-36393c196d9f','EXACT_JOURNAL');
      const r=await send(new TransactGetItemsCommand({TransactItems:entries.map(entry=>({Get:{TableName,Key:{pk:{S:'JOB#'+V.jobId},sk:{S:'STAGE#'+entry}}}}))}));
      must(r.Responses?.length===5&&r.Responses.every(x=>!x.Item),'JOURNAL_NOT_EMPTY_NO_NEW_ATTEMPT');
      const journal={tableId:t.Table.TableId,transactionalFiveEntrySnapshot:true,allFiveAbsent:true};await common.record('new-attempt-journal-metadata',journal);
      return {...p,newAttemptJournal:journal};
    },async consumeSlot(mode,v){await writeFile(slot(mode),JSON.stringify(v)+'\n',{flag:'wx',flush:true});},
    dispose(){common.dispose();ddb.destroy();},
  };
}
async function readRunV5(runId){
  const token=await new Promise((resolve,reject)=>{
    const p=spawn('git',['credential','fill'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';
    const timer=setTimeout(()=>p.kill(),15000);p.stdout.setEncoding('utf8');p.stdout.on('data',b=>{text+=b;if(text.length>20000)p.kill();});p.stderr.on('data',()=>{});p.stdin.on('error',()=>{});
    p.on('error',()=>{clearTimeout(timer);reject(Error('HANDOFF_GITHUB_CREDENTIAL'));});p.on('close',code=>{clearTimeout(timer);
      const value=text.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(code||!value||text.length>20000)reject(Error('HANDOFF_GITHUB_CREDENTIAL'));else resolve(value);});
    p.stdin.end('protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
  });
  const r=await fetch('https://api.github.com/'+repo+'/actions/runs/'+runId,{method:'GET',headers:{authorization:'Bearer '+token,
    accept:'application/vnd.github+json','x-github-api-version':V.apiVersion,'user-agent':'Techlong-ReadOnly-Handoff'},redirect:'error',signal:AbortSignal.timeout(30000)});
  must(r.ok,'RUN_READ');return r.json();
}
async function prepareOnlyV5(context,output,cloudMode,existingIo=null){
  assertHandoffBudgetV5(cloudMode,context.cloud,Date.now());const io=existingIo??await createHandoffIoV5(output,context);
  try{
    const prestate=await io.preflight(cloudMode),m=await prepareHandoffV5({...context,mode:cloudMode,prestate,now:Date.now()});await io.record('manifest',m);
    let scopeFile=null;if(cloudMode==='RunOnce'){
      scopeFile=output+'/approval-scope.md';await writeFile(scopeFile,runOnceHandoffScopeV5(m,context.cloudManifest),{flag:'wx',flush:true});
    }
    const result={outcome:'PREPARED_NOT_DISPATCHED',cloudMode,jobId:V.jobId,manifestSha256:m.manifestSha256,main:context.source.commit,
      expiresAt:new Date(m.expiresAt).toISOString(),minimumRunOnceRemainingMs:V.minimumRunOnceRemainingMs,scopeFile,
      workflowDispatches:0,secretValueReads:0,slotConsumed:false,output};await io.record('result',result);return result;
  }finally{if(!existingIo)io.dispose();}
}
export async function mainHandoffV5(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n]),'DUPLICATE_ARG');a[args[n]]=args[n+1];}
  const mode=a['--mode'],cloudMode=a['--cloud-mode'];let keys=['--mode','--output'];
  if(mode==='Prepare')keys.push('--cloud-mode',...(cloudMode==='Review'?[]:['--cloud-review-directory']),...(cloudMode==='Inspect'?['--execution-directory']:[]));
  else if(mode==='Dispatch')keys.push('--manifest','--approved-sha',...(a['--cloud-review-directory']?['--cloud-review-directory']:[]),...(a['--execution-directory']?['--execution-directory']:[]));
  else if(['Observe','Handoff'].includes(mode))keys.push('--dispatch-directory',...(mode==='Handoff'?['--runonce-output']:[]));
  must(['Prepare','Dispatch','Observe','Handoff'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'ARG_SET');
  assertLocalEnvironmentV5();const output=await directory(a['--output']);await mkdir(output);const context=await handoffSourceContextV5();let m;
  if(mode==='Dispatch'){
    const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST_FILE');m=await json(f);
    must(m.source.commit===context.source.commit,'FROZEN_MAIN');
  }
  if(['Observe','Handoff'].includes(mode)){
    const d=await directory(a['--dispatch-directory'],true);m=await json(d+'/approved-manifest.json');const ack=await json(d+'/dispatch-api-ack.json'),{manifestSha256,...body}=m;
    must(m.schema==='techlong/cloud-worker-approval-handoff-review/v5'&&['Review','RunOnce','Inspect'].includes(m.mode)&&
      m.source.commit===context.source.commit&&same(m.source,context.source)&&same(m.history,context.history)&&await sha256Hex(body)===manifestSha256,'OBSERVE_FROZEN_SOURCE');
    const used=await json(slot(m.mode));must(used.manifestSha256===manifestSha256&&used.retryAllowed===false,'OBSERVE_SLOT');
    if(mode==='Handoff')must(m.mode==='Review','HANDOFF_REVIEW_ONLY');
    const io=await createHandoffIoV5(output,context);
    try{
      const runId=String(ack.workflow_run_id);let result;
      if(mode==='Observe')result=await io.observe(m,runId);
      else result=await reviewToRunOnceHandoffV5({manifest:m,runId,io:{readRun:readRunV5,sleep:ms=>new Promise(r=>setTimeout(r,ms)),observe:io.observe,
        async prepareRunOnce(reviewed){
          const out=await directory(a['--runonce-output']);must(out!==output,'DISTINCT_OUTPUTS');await absent(slot('RunOnce'));await mkdir(out);
          const cm=await json(output+'/cloud-manifest.json');await io.validateCloud(cm,reviewed.reference,context.source.commit);await io.assertLocalSource(m);
          context.cloudManifest=cm;context.cloud={jobId:V.jobId,manifestSha256:cm.manifestSha256,reference:reviewed.reference,code:cm.code,
            claimBy:cm.jobPlan.claimBy,deadline:cm.jobPlan.deadline,workloadExpiresAt:cm.workload.workloadExpiresAt};context.execution=null;
          return prepareOnlyV5(context,out,'RunOnce');
        }}});
      await io.record('result',result);console.log(JSON.stringify(result,null,2));return result;
    }finally{io.dispose();}
  }
  context.mode=mode==='Prepare'?cloudMode:m.mode;must(['Review','RunOnce','Inspect'].includes(context.mode),'CLOUD_MODE');
  await absent(slot(context.mode));context.cloud=null;context.execution=null;const io=await createHandoffIoV5(output,context);
  try{
    if(context.mode!=='Review'){
      const d=await directory(a['--cloud-review-directory'],true),verified=await json(d+'/verified.json'),cm=await json(d+'/cloud-manifest.json');
      must(verified.mode==='Review'&&verified.outcome==='CLOUD_REVIEW_RECONSTRUCTED_NOT_EXECUTION_APPROVAL','SUCCESSFUL_REVIEW_REQUIRED');
      await io.validateCloud(cm,verified.reference,context.source.commit);context.cloudManifest=cm;
      context.cloud={jobId:V.jobId,manifestSha256:cm.manifestSha256,reference:verified.reference,code:cm.code,claimBy:cm.jobPlan.claimBy,
        deadline:cm.jobPlan.deadline,workloadExpiresAt:cm.workload.workloadExpiresAt};
    }else must(!a['--cloud-review-directory']&&!a['--execution-directory'],'REVIEW_NO_EXTRA_REFS');
    if(context.mode==='Inspect'){
      const d=await directory(a['--execution-directory'],true),execution=await json(d+'/verified.json');must(execution.mode==='RunOnce','EXECUTION_DIRECTORY');
      executionObjectV5(context.cloud,execution);context.execution={jobId:execution.jobId,manifestSha256:execution.manifestSha256,outcome:execution.outcome,
        reference:execution.reference,executionRun:execution.executionRun};
    }else must(!a['--execution-directory'],'NO_EXTRA_EXECUTION');
    if(mode==='Prepare'){const result=await prepareOnlyV5(context,output,context.mode,io);console.log(JSON.stringify(result,null,2));return result;}
    await io.record('approved-manifest',m);const result=await dispatchHandoffV5({manifest:m,approved:a['--approved-sha'],context:{...context,mode:context.mode},io});
    await io.record('result',result);console.log(JSON.stringify(result,null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)mainHandoffV5().catch(e=>{
  console.error(JSON.stringify({outcome:'HANDOFF_STOPPED_NO_AUTOMATIC_WRITE_RETRY',failure:safeActivationFailureV5(e),retryAllowed:false}));process.exitCode=1;
});
