import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {JOB_DISPATCH_V5 as V,prepareJobDispatchV5,dispatchJobV5,jobProofFromLogsV5,assertJobReferenceV5,executionObjectV5} from './job-dispatch-v5.mjs';
import {assertProbeRunV5} from './verify-install-v5.mjs';
import {createActivationIoV5} from './activation/local-io-v5.mjs';
import {activationHistoryV5} from './activation/run-activation-v5.mjs';
import {assertReleaseObjectsV5,gitLocalV5} from './activation/commit-objects-v5.mjs';
import {assertLocalEnvironmentV5,writePublicOnceV5} from './install/local-io-v5.mjs';
import {safeActivationFailureV5,requireActivationV5} from './activation/errors-v5.mjs';
import {assertEvidenceSafeV5,EVIDENCE_V5,evidenceKeyV5} from './cloud-evidence-v5.mjs';
import {assertCloudManifestV5} from './cloud-worker-root-v5.mjs';
import {prepareCloudContextV5} from './cloud-context-v5.mjs';
import {loadNeonContractV5} from './neon-contract-v5.mjs';
import {createPlatformWorkerReaderV4,admitPlatformJobV4,assertCurrentPlatformRowsV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import {assertRunWindowV3} from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
const root='E:/NodejsProject/TechlongSoftware',base='F:/ChatGPT_workshop',repo='repos/veinyyxy/TechlongSoftware';
const must=(v,c)=>requireActivationV5(v,'JOB_LOCAL_'+c),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const digest=v=>createHash('sha256').update(v).digest('hex'),json=async f=>JSON.parse(await readFile(f,'utf8'));
const slot=mode=>base+'/techlong-cloud-worker-v5-'+V.jobId+'-'+mode.toLowerCase()+'-v1.permanent-slot.json';
async function absent(file){try{await access(file);throw Error('JOB_LOCAL_SLOT_USED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(input){const p=path.resolve(input);must(path.dirname(p).toLowerCase()===path.resolve(base).toLowerCase() &&
  /^techlong-w5i-[a-z0-9-]+$/.test(path.basename(p)) && (await realpath(base)).toLowerCase()===path.resolve(base).toLowerCase(),'OUTPUT_PATH');return p;}
async function inputDirectory(p){const d=await directory(p);must((await realpath(d)).toLowerCase()===d.toLowerCase(),'INPUT_REALPATH');return d;}
async function sourceContext(){
  must((await gitLocalV5(['branch','--show-current'])).trim()==='main' && (await gitLocalV5(['status','--porcelain'])).trim()==='','CLEAN_MAIN');
  const history=await activationHistoryV5(),g=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.executed.json'),
    h=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5h-request-recorded.json');
  must(g.state==='CLOUD_IDENTITY_FIXED_BINDING_DATABASE_CATALOG_INDEPENDENTLY_VERIFIED' && g.runId==='39126114772' &&
    h.state==='ONE_REAL_ADMIN_HELD_REQUEST_VERIFIED_LOCAL_ENTRY_CLOSED' && h.jobId===V.jobId && h.normalizedJobRowSha256===V.jobRowSha256,'HISTORY');
  const gp=await readFile(g.independentProof.localFile);must(digest(gp)===g.independentProof.rawSha256,'VERIFY_INSTALL_PROOF');
  const proof=JSON.parse(gp);
  for(const f of [...proof.evidenceFiles,...h.evidence])must(f.path.startsWith(base+'/') && digest(await readFile(f.path))===f.rawSha256,'EVIDENCE_HISTORY');
  const old=await json(base+'/techlong-w5f-review-20261017-a/manifest.json'),pins=await json(base+'/techlong-w5g-review-20261018-a/manifest.json');
  const activation=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json'),ap=await readFile(activation.independentProof.localProof);
  must(digest(ap)===activation.independentProof.rawSha256,'ACTIVATION_PROOF');
  for(const f of JSON.parse(ap).evidenceFiles)must(f.path.startsWith(base+'/') && digest(await readFile(f.path))===f.rawSha256,'ACTIVATION_EVIDENCE');
  await assertReleaseObjectsV5(old.actions.release);
  const files=[...pins.source.files];for(const p of files)must(digest((await readFile(root+'/'+p.file,'utf8')).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'OLD_SOURCE_PIN');
  for(const file of ['ops/cloud-worker/job-dispatch-v5.mjs','ops/cloud-worker/job-dispatch-local-v5.mjs',
    'tests/cloud-worker-job-dispatch-v5.test.mjs',V.riskFile,'ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.executed.json',
    'ops/aws-sandbox/reviews/cloud-worker-w5h-request-recorded.json'])files.push({file,normalizedLfSha256:digest((await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'))});
  return {source:{commit:(await gitLocalV5(['rev-parse','HEAD'])).trim(),files:files.sort((a,b)=>a.file.localeCompare(b.file)),node:process.version},
    history:{...history,verifyInstallProofRawSha256:digest(gp),activationProofRawSha256:digest(ap),heldRequestRecordRawSha256:digest(await readFile(root+'/ops/aws-sandbox/reviews/cloud-worker-w5h-request-recorded.json'))},old};
}
async function credential(){return new Promise((resolve,reject)=>{
  const p=spawn('git',['credential','fill'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';
  const timer=setTimeout(()=>p.kill(),15000);p.stdout.setEncoding('utf8');p.stdout.on('data',b=>{text+=b;if(text.length>20000)p.kill();});
  p.stderr.on('data',()=>{});p.stdin.on('error',()=>{});p.on('error',()=>{clearTimeout(timer);reject(Error('JOB_GITHUB_CREDENTIAL'));});
  p.on('close',code=>{clearTimeout(timer);const token=text.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);
    if(code||!token||text.length>20000)reject(Error('JOB_GITHUB_CREDENTIAL'));else resolve(token);});
  p.stdin.end('protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
});}
export async function createJobDispatchIoV5(output,context){
  let token,posts=0,puts=0;const record=async(n,v)=>{assertEvidenceSafeV5(v);await writePublicOnceV5(output,n,v);};
  const cfg={region:EVIDENCE_V5.region,credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true}),maxAttempts:1,ignoreConfiguredEndpointUrls:true};
  const s3=new S3Client(cfg),capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json'),
    binding=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json'),
    runtimeContext=await prepareCloudContextV5(capsule),contract=await loadNeonContractV5(),metadata=createActivationIoV5({output,capsule,binding});
  const gh=async(method,suffix,body)=>{
    token??=await credential();const r=await fetch('https://api.github.com/'+suffix,{method,headers:{authorization:'Bearer '+token,
      accept:'application/vnd.github+json','content-type':'application/json','x-github-api-version':V.apiVersion,'user-agent':'Techlong-Single-Job-Controller'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Object.assign(Error('JOB_GITHUB_STATUS'),{status:r.status});if(method==='POST')must(r.status===200,'RUN_DETAILS_REQUIRED');
    return r.json();
  };
  const getObject=async ref=>{
    must(ref.key.startsWith('worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/') && !ref.key.includes('..'),'S3_SCOPE');assertJobReferenceV5(ref,ref.key);
    const r=await s3.send(new GetObjectCommand({Bucket:EVIDENCE_V5.bucket,Key:ref.key,VersionId:ref.versionId,ExpectedBucketOwner:EVIDENCE_V5.owner}),{abortSignal:AbortSignal.timeout(30000)});
    must(r.VersionId===ref.versionId && r.ServerSideEncryption==='AES256' && r.ContentLength>0 && r.ContentLength<=1000000,'S3_METADATA');
    const text=await r.Body.transformToString();must(Buffer.byteLength(text)<=1000000,'S3_SIZE');const v=JSON.parse(text);assertEvidenceSafeV5(v);
    must(await sha256Hex(v)===ref.sha256,'S3_WHOLE_DOCUMENT_SHA');return v;
  };
  const validateCloud=async(m,ref,commit)=>{
    assertJobReferenceV5(ref,evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:m.manifestSha256}));
    must(await sha256Hex(m)===ref.sha256 && m.jobPlan.jobId===V.jobId && m.jobPlan.requestId===V.requestId &&
      m.queue.rowSha256===V.jobRowSha256 && await sha256Hex(m.jobPlan.snapshot)===V.snapshotSha256,'CLOUD_JOB_BINDING');
    await assertCloudManifestV5(m,{code:{commitSha:commit,closureSha256:V.closureSha256},installation:binding,context:runtimeContext,contract});return m;
  };
  const readRows=async(mode,m)=>{
    const env=parseEnv(await readFile(root+'/.env.local','utf8')),reader=createPlatformWorkerReaderV4(env.DATABASE_URL),
      observed=await reader.read(V.jobId,AbortSignal.timeout(30000),V.requesterId);
    if(mode!=='Inspect'){
      await admitPlatformJobV4({root:runtimeContext.root,predecessor:runtimeContext.predecessor,observed,now:Date.now()});
      must(await sha256Hex(observed.job)===V.jobRowSha256 && await sha256Hex(observed.snapshot)===V.snapshotSha256 && observed.jobs.length===4,'CURRENT_HELD_REQUEST');
      if(m)assertCurrentPlatformRowsV4(m,observed,Date.now());
    }
    return {jobId:V.jobId,jobRowSha256:await sha256Hex(observed.job),snapshotSha256:await sha256Hex(observed.snapshot),
      jobsSha256:await sha256Hex(observed.jobs),requesterSha256:await sha256Hex(observed.requester),
      activeJobs:observed.jobs.filter(j=>['pending','running','retry_wait'].includes(j.status)).length,
      status:observed.job.status,readOnlyTransactions:reader.counts().completedReadOnlyTransactions};
  };
  return {record,getObject,validateCloud,
    async assertCloudWindow(mode){if(mode==='RunOnce'){must(context.cloudManifest,'CLOUD_MANIFEST_REQUIRED');assertRunWindowV3(context.cloudManifest,Date.now());}},
    async preflight(mode){
      const [repository,actor,branch,workflow,runs,caller,reusable]=await Promise.all([gh('GET',repo),gh('GET','user'),gh('GET',repo+'/branches/main'),
        gh('GET',repo+'/actions/workflows/'+V.workflowId),gh('GET',repo+'/actions/workflows/'+V.workflowId+'/runs?per_page=100'),
        gh('GET',repo+'/contents/.github/workflows/cloud-worker-execute.yml?ref='+context.source.commit),
        gh('GET',repo+'/contents/.github/workflows/cloud-worker-job.yml?ref='+V.reusable)]);
      must(repository.id===1323312747 && repository.owner?.id===14145707 && repository.visibility==='public' && repository.default_branch==='main' &&
        repository.permissions?.admin===true && actor.id===14145707 && branch.commit.sha===context.source.commit && workflow.id===V.workflowId &&
        workflow.path==='.github/workflows/cloud-worker-execute.yml' && workflow.state==='active' && runs.total_count<100 &&
        runs.workflow_runs?.length===runs.total_count && runs.workflow_runs.every(r=>r.status==='completed'),'GITHUB_PRESTATE');
      for(const [r,f]of [[caller,'.github/workflows/cloud-worker-execute.yml'],[reusable,'.github/workflows/cloud-worker-job.yml']])
        must(r.encoding==='base64' && r.type==='file' && r.path===f && Buffer.from(r.content,'base64').toString('utf8').replaceAll('\r\n','\n')===
          (await readFile(root+'/'+f,'utf8')).replaceAll('\r\n','\n'),'REMOTE_WORKFLOW_PIN');
      const view=structuredClone(context.old);view.actions.release.caller.commit=context.source.commit;
      const publication={...V.publication,installationSha256:V.installationSha256};
      const proof=await metadata.inspectActivated(view,publication);await record('metadata',proof);
      must(proof.environment.environmentId===V.environmentId,'ENVIRONMENT');
      if(context.cloudManifest)await validateCloud(context.cloudManifest,context.cloud.reference,context.source.commit);
      const rows=await readRows(mode,context.cloudManifest);await record('current-job-metadata',rows);
      if(mode==='RunOnce')assertRunWindowV3(context.cloudManifest,Date.now());
      return {main:branch.commit.sha,workflowId:V.workflowId,environmentId:V.environmentId,metadataVerified:true,unfinishedRuns:0,
        completedRunIds:runs.workflow_runs.map(r=>String(r.id)).sort(),roleId:proof.foundation.roleId,tableId:proof.foundation.tableId,...rows};
    },
    async consumeSlot(mode,v){await writeFile(slot(mode),JSON.stringify(v)+'\n',{flag:'wx',flush:true});},
    async putExecutionReference(object){
      must(context.execution && same(object,executionObjectV5(context.cloud,context.execution)) && ++puts===1,'ONLY_EXACT_EXECUTION_PUT');
      const body=canonicalJson(object.body),sha=await sha256Hex(object.body);
      const r=await s3.send(new PutObjectCommand({Bucket:EVIDENCE_V5.bucket,ExpectedBucketOwner:EVIDENCE_V5.owner,Key:object.key,
        Body:body,ContentType:'application/json',ServerSideEncryption:'AES256',IfNoneMatch:'*',ChecksumSHA256:Buffer.from(sha,'hex').toString('base64')}),
      {abortSignal:AbortSignal.timeout(30000)});
      const ref={key:object.key,versionId:r.VersionId,sha256:sha};assertJobReferenceV5(ref,object.key);
      // Persist ACK before any follow-up network; unknown ACK never causes another Put.
      await record('execution-object-put-api-ack',ref);must(same(await getObject(ref),object.body),'EXECUTION_PUT_READBACK');return ref;
    },
    async dispatch(request,guard){
      must(request.method==='POST' && request.path===repo+'/actions/workflows/'+V.workflowId+'/dispatches' && request.apiVersion===V.apiVersion,'ONLY_DISPATCH_POST');
      must((await gh('GET',repo+'/branches/main')).commit.sha===context.source.commit,'MAIN_DRIFT');
      await guard();must(++posts===1,'POST_ONCE');return gh('POST',request.path,request.body);
    },
    async observe(m,runId){
      const r=await gh('GET',repo+'/actions/runs/'+runId),summary=assertProbeRunV5(r,m,runId);await record('run-metadata',summary);
      if(r.status!=='completed'||r.conclusion!=='success')return {outcome:'WAITING_OR_UNSUCCESSFUL_NO_RETRY',...summary,retryAllowed:false};
      const jobs=await gh('GET',repo+'/actions/runs/'+runId+'/jobs?filter=all&per_page=100');
      must(jobs.total_count===1 && jobs.jobs?.length===1 && jobs.jobs[0].conclusion==='success' && String(jobs.jobs[0].run_id)===runId &&
        jobs.jobs[0].head_sha===m.source.commit,'ONE_SUCCESS_JOB');token??=await credential();
      const response=await fetch('https://api.github.com/'+repo+'/actions/jobs/'+jobs.jobs[0].id+'/logs',{headers:{authorization:'Bearer '+token,
        accept:'application/vnd.github+json','x-github-api-version':V.apiVersion},redirect:'manual',signal:AbortSignal.timeout(30000)});
      const location=response.headers.get('location');must(response.status===302 && location,'LOG_REDIRECT');const url=new URL(location);
      must(url.protocol==='https:' && !url.username && !url.password && /\.(blob\.core\.windows\.net|actions\.githubusercontent\.com)$/.test(url.hostname),'LOG_HOST');
      const raw=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});must(raw.ok && Number(raw.headers.get('content-length')??0)<3000000,'LOG_RESPONSE');
      const p=jobProofFromLogsV5(await raw.text(),m.mode);await record('cloud-public-proof',p);
      const run={repository:'veinyyxy/TechlongSoftware',runId,runAttempt:1,commitSha:m.source.commit};let value;
      if(m.mode==='Review'){
        value=await getObject(assertJobReferenceV5(p.saved,evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:p.manifestSha256})));
        must(value.manifestSha256===p.manifestSha256,'REVIEW_BODY_SHA');await validateCloud(value,p.saved,m.source.commit);
        await record('cloud-manifest',value);
      }else{
        const kind=m.mode==='RunOnce'?'run.json':'inspect.json';
        value=await getObject(assertJobReferenceV5(p.saved,evidenceKeyV5(kind,{jobId:V.jobId,manifestSha256:m.cloud.manifestSha256,run})));
        must(same(value.run,run) && value.manifestSha256===m.cloud.manifestSha256 && value.jobId===V.jobId,'REPORT_RUN_BINDING');
        if(m.mode==='Inspect'){
          const {inspectSha256,...body}=value;must(await sha256Hex(body)===inspectSha256 && same(value.executionRun,m.execution.executionRun) &&
            value.run.runId!==value.executionRun.runId && value.outcome===p.outcome,'INDEPENDENT_INSPECT_BINDING');
        }else must(value.result?.outcome===p.outcome,'RUN_REPORT_OUTCOME');
        await record('cloud-report',value);
      }
      const result={outcome:m.mode==='Review'?'CLOUD_REVIEW_RECONSTRUCTED_NOT_EXECUTION_APPROVAL':p.outcome,mode:m.mode,jobId:V.jobId,
        manifestSha256:m.mode==='Review'?value.manifestSha256:m.cloud.manifestSha256,reference:p.saved,
        ...(m.mode==='Review'?{code:value.code,claimBy:value.jobPlan.claimBy,deadline:value.jobPlan.deadline,workloadExpiresAt:value.workload.workloadExpiresAt}:
          m.mode==='RunOnce'?{executionRun:run}:{inspectRun:run}),
        ...summary,rawLogsSaved:false,signedLogUrlSaved:false,retryAllowed:false};await record('verified',result);return result;
    },dispose(){token=undefined;s3.destroy();metadata.dispose();},
  };
}
export async function mainJobDispatchV5(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],cloudMode=a['--cloud-mode'];let keys=['--mode','--output'];
  if(mode==='Prepare')keys.push('--cloud-mode',...(cloudMode==='Review'?[]:['--cloud-review-directory']),...(cloudMode==='Inspect'?['--execution-directory']:[]));
  else if(mode==='Dispatch')keys.push('--manifest','--approved-sha',...(a['--cloud-review-directory']?['--cloud-review-directory']:[]),...(a['--execution-directory']?['--execution-directory']:[]));
  else if(mode==='Observe')keys.push('--dispatch-directory');
  must(['Prepare','Dispatch','Observe'].includes(mode) && Object.keys(a).length===keys.length && keys.every(k=>a[k]),'ARG_SET');
  assertLocalEnvironmentV5();const output=await directory(a['--output']);await mkdir(output);const context=await sourceContext();
  let m;
  if(mode==='Dispatch'){
    const file=path.resolve(a['--manifest']);await inputDirectory(path.dirname(file));must(path.basename(file)==='manifest.json','MANIFEST_FILE');m=await json(file);
    must(m.source.commit===context.source.commit,'LOCAL_MAIN_CHANGED');
  }
  if(mode==='Observe'){
    const d=await inputDirectory(a['--dispatch-directory']);m=await json(d+'/approved-manifest.json');const ack=await json(d+'/dispatch-api-ack.json');
    must(m.source.commit===context.source.commit && same(m.source,context.source) && same(m.history,context.history),'OBSERVE_FROZEN_SOURCE');
    const {manifestSha256,...body}=m;must(await sha256Hex(body)===manifestSha256,'OBSERVE_MANIFEST_SHA');
    const used=await json(slot(m.mode));must(used.manifestSha256===manifestSha256 && used.retryAllowed===false,'OBSERVE_PERMANENT_SLOT');
    const io=await createJobDispatchIoV5(output,context);try{const result=await io.observe(m,String(ack.workflow_run_id));await io.record('result',result);console.log(JSON.stringify(result,null,2));return result;}finally{io.dispose();}
  }
  context.mode=mode==='Prepare'?cloudMode:m.mode;must(['Review','RunOnce','Inspect'].includes(context.mode),'CLOUD_MODE');
  await absent(slot(context.mode));context.cloud=null;context.execution=null;
  const io=await createJobDispatchIoV5(output,context);
  try{
    if(context.mode!=='Review'){
      const d=await inputDirectory(a['--cloud-review-directory']);const cloud=await json(d+'/verified.json'),cm=await json(d+'/cloud-manifest.json');
      must(cloud.mode==='Review' && cloud.outcome==='CLOUD_REVIEW_RECONSTRUCTED_NOT_EXECUTION_APPROVAL','REVIEW_DIRECTORY');
      await io.validateCloud(cm,cloud.reference,context.source.commit);context.cloudManifest=cm;
      context.cloud={jobId:V.jobId,manifestSha256:cm.manifestSha256,reference:cloud.reference,code:cm.code,
        claimBy:cm.jobPlan.claimBy,deadline:cm.jobPlan.deadline,workloadExpiresAt:cm.workload.workloadExpiresAt};
    }else must(!a['--cloud-review-directory'] && !a['--execution-directory'],'REVIEW_NO_EXTRA_REFS');
    if(context.mode==='Inspect'){
      const d=await inputDirectory(a['--execution-directory']),execution=await json(d+'/verified.json');
      must(execution.mode==='RunOnce','EXECUTION_DIRECTORY');executionObjectV5(context.cloud,execution);context.execution={jobId:execution.jobId,
        manifestSha256:execution.manifestSha256,outcome:execution.outcome,reference:execution.reference,executionRun:execution.executionRun};
    }else must(!a['--execution-directory'],'NO_EXTRA_EXECUTION');
    let result;
    if(mode==='Prepare'){
      const prestate=await io.preflight(context.mode);m=await prepareJobDispatchV5({...context,mode:context.mode,prestate,now:Date.now()});await io.record('manifest',m);
      result={outcome:'PREPARED_NOT_DISPATCHED',cloudMode:context.mode,jobId:V.jobId,manifestSha256:m.manifestSha256,main:context.source.commit,
        expiresAt:new Date(m.expiresAt).toISOString(),workflowDispatches:0,secretValueReads:0,slotConsumed:false};
    }else{
      await io.record('approved-manifest',m);result=await dispatchJobV5({manifest:m,approved:a['--approved-sha'],context:{...context,mode:context.mode},io});
    }
    await io.record('result',result);console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)mainJobDispatchV5().catch(e=>{
  console.error(JSON.stringify({outcome:'STOPPED_NO_AUTOMATIC_WRITE_RETRY',failure:safeActivationFailureV5(e),retryAllowed:false}));process.exitCode=1;
});
