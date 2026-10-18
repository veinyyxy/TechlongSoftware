// Local single dispatch controller; never changes the frozen cloud runtime/workflows.
import { readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { createActivationIoV5 } from './activation/local-io-v5.mjs';
import { activationHistoryV5 } from './activation/run-activation-v5.mjs';
import { assertReleaseObjectsV5, gitLocalV5 } from './activation/commit-objects-v5.mjs';
import { assertLocalEnvironmentV5, writePublicOnceV5 } from './install/local-io-v5.mjs';
import { assertEvidenceSafeV5 } from './cloud-evidence-v5.mjs';
import { safeActivationFailureV5, requireActivationV5 as must } from './activation/errors-v5.mjs';
const root = 'E:/NodejsProject/TechlongSoftware', base = 'F:/ChatGPT_workshop', repo = 'repos/veinyyxy/TechlongSoftware';
export const VERIFY_INSTALL_V5 = Object.freeze({ workflowId:388188162, environmentId:24613410405,
  runtime:'ac75c4bcbb856babc67d88b6e06212e981a25d90', reusable:'7c02d9db3a39fc2f926848a593eb804b642bd1e5',
  slot:base + '/techlong-cloud-worker-v5-verify-install-v1.permanent-slot.json',
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5g-verify-install.md', apiVersion:'2026-03-10' });
const V = VERIFY_INSTALL_V5, digest = v => createHash('sha256').update(v).digest('hex');
const same = (a,b) => canonicalJson(a) === canonicalJson(b), json = async f => JSON.parse(await readFile(f,'utf8'));
const recordFile = 'ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json';
export function verifyDispatchBodyV5(publication) {
  must(publication.installationSha256 === '0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1' &&
    publication.versionId === 'QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV' && publication.sha256 === '695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae' &&
    publication.key === 'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/installation/' + publication.installationSha256 + '.json','PROBE_FIXED_PUBLICATION');
  return { ref:'main', return_run_details:true, inputs:{ mode:'VerifyInstall',
    installation:canonicalJson({ key:publication.key, versionId:publication.versionId, sha256:publication.sha256 }),
    job:'', manifest:'', manifestSha:'', execution:'', lineage:'' } };
}
export async function prepareProbeV5({ source, history, prestate, publication, now }) {
  must(source.commit === prestate.main && prestate.workflowId === V.workflowId && prestate.environmentId === V.environmentId &&
    prestate.deploymentWorkflowRuns === 0 && prestate.metadataVerified === true && source.files.length > 110,'PROBE_PRESTATE');
  const body = { schema:'techlong/cloud-worker-verify-install-review/v5',preparedAt:now,expiresAt:now+7200000,source,history,prestate,
    request:{ method:'POST',path:repo + '/actions/workflows/' + V.workflowId + '/dispatches',apiVersion:V.apiVersion,body:verifyDispatchBodyV5(publication) },
    runtimeCommit:V.runtime,reusableCommit:V.reusable,riskFile:V.riskFile,
    effects:{ workflowDispatches:1,humanEnvironmentApprovalRequired:true,oidcTokenRequests:1,stsExchanges:1,maxSessionSeconds:3600,
      publicBindingReads:1,fixedDatabaseSecretValueReads:1,narrowReadOnlyCatalogTransactions:1,controlSecretReads:0,
      originalBundleReads:0,resourceOrDatabaseWrites:0,automaticReruns:0,automaticCleanupOrRollback:false },
    approvalWindowOnlyControlsDispatchNotLaterHumanReview:true };
  return { ...body, manifestSha256:await sha256Hex(body) };
}
export async function assertProbeApprovalV5(m,approved,{ source,history,prestate,publication,now }) {
  const exact = await prepareProbeV5({ source,history,prestate,publication,now:m.preparedAt });
  must(approved === m.manifestSha256 && /^[a-f0-9]{64}$/.test(approved) && same(m,exact) && now >= m.preparedAt && now < m.expiresAt,'PROBE_FRESH_APPROVAL');
}
export async function dispatchProbeV5({ manifest:m,approved,source,history,publication,io,now=Date.now }) {
  // Validate approval before network, then fresh exact readback before the permanent slot.
  await assertProbeApprovalV5(m,approved,{ source,history,prestate:m.prestate,publication,now:now() });
  const started=now(),prestate=await io.preflight();
  await assertProbeApprovalV5(m,approved,{ source,history,prestate,publication,now:now() });
  must(now()-started < 180000,'PROBE_PREFLIGHT_WINDOW');
  await io.consumeSlot({ manifestSha256:m.manifestSha256,at:now(),retryAllowed:false });
  const intent={ manifestSha256:m.manifestSha256,at:now(),main:m.source.commit,workflowId:V.workflowId };
  await io.record('dispatch-intent',intent);
  // No POST retries/fallback; an unknown response permanently requires read-only inspection.
  const guard=async()=>{await assertProbeApprovalV5(m,approved,{source,history,prestate,publication,now:now()});
    must(now()-started<210000,'PROBE_SUBMISSION_WINDOW');};
  const ack=await io.dispatch(m.request,guard); await io.record('dispatch-api-ack',ack);
  must(Number.isSafeInteger(ack.workflow_run_id) && ack.workflow_run_id>0 &&
    ack.html_url === 'https://github.com/veinyyxy/TechlongSoftware/actions/runs/' + ack.workflow_run_id &&
    ack.run_url === 'https://api.github.com/' + repo + '/actions/runs/' + ack.workflow_run_id,'PROBE_EXACT_RUN_ACK');
  const result={ outcome:'DISPATCH_ACKNOWLEDGED_REQUIRES_HUMAN_ENVIRONMENT_APPROVAL',manifestSha256:m.manifestSha256,
    runId:String(ack.workflow_run_id),url:ack.html_url,workflowDispatched:true,environmentApprovedByController:false,retryAllowed:false };
  await io.record('dispatch-result',result); return result;
}
export function assertProbeRunV5(r,m,runId) {
  must(String(r.id)===runId && r.workflow_id===V.workflowId && r.head_sha===m.source.commit && r.head_branch==='main' &&
    r.event==='workflow_dispatch' && r.run_attempt===1 && r.actor?.id===14145707 && r.triggering_actor?.id===14145707 &&
    r.repository?.id===1323312747 && r.head_repository?.id===1323312747 && Date.parse(r.created_at)>=m.preparedAt &&
    r.html_url==='https://github.com/veinyyxy/TechlongSoftware/actions/runs/'+runId,'PROBE_RUN_IDENTITY');
  return { runId,status:r.status,conclusion:r.conclusion,url:r.html_url,headSha:r.head_sha,attempt:1 };
}
export function probeProofFromLogsV5(log,m,runId) {
  must(typeof log==='string' && Buffer.byteLength(log)<3000000,'PROBE_LOG_SIZE');
  const lines=log.split(/\r?\n/).map(l=>l.replace(/^\d{4}-\d{2}-\d{2}T\S+\s/,'')),proofs=[];
  for(let a=0;a<lines.length;a++) if(lines[a].trim()==='{') {
    for(let b=a+1;b<Math.min(a+120,lines.length);b++) if(lines[b].trim()==='}') {
      try { const p=JSON.parse(lines.slice(a,b+1).join('\n')); if(p.schema==='techlong/cloud-worker-cloud-install-proof/v5') proofs.push(p); } catch {}
    }
  }
  must(proofs.length===1,'PROBE_UNIQUE_PUBLIC_PROOF'); const p=proofs[0]; assertEvidenceSafeV5(p);
  must(p.outcome==='CLOUD_IDENTITY_FIXED_BINDING_DATABASE_CATALOG_VERIFIED' &&
    same(p.run,{ repository:'veinyyxy/TechlongSoftware',runId,runAttempt:1,commitSha:m.source.commit }) &&
    p.installationSha256==='0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1' && p.frozenSourceCommit===V.runtime &&
    p.rootClosureSha256==='110f06bcfe0037ffc1bc0e1d4679a6796080564abde42818074807e516b7bb84' &&
    same(p.counters,{ bindingReads:1,identityReads:1,databaseSecretReads:1,catalogTransactions:1,controlSecretReads:0,cloudWrites:0,databaseWrites:0 }) &&
    p.controlMaterialOrApplicationVerified===false && p.workloadDeploymentPerformed===false && p.retryAllowed===false,'PROBE_EXACT_PUBLIC_PROOF');
  return p;
}
async function credential() {
  return new Promise((resolve,reject)=>{
    const p=spawn('git',['credential','fill'],{ cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'] });
    let text='';p.stdout.setEncoding('utf8'); const timer=setTimeout(()=>p.kill(),15000);
    p.stdout.on('data',b=>{ text+=b;if(text.length>20000)p.kill(); });p.stderr.on('data',()=>{});p.stdin.on('error',()=>{});
    p.on('error',()=>{clearTimeout(timer);reject(Error('PROBE_GITHUB_CREDENTIAL'));});
    p.on('close',code=>{clearTimeout(timer);const v=text.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);
      if(code||!v||text.length>20000)reject(Error('PROBE_GITHUB_CREDENTIAL'));else resolve(v);});
    p.stdin.end('protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
  });
}
async function localSource() {
  must((await gitLocalV5(['branch','--show-current'])).trim()==='main' && (await gitLocalV5(['status','--porcelain'])).trim()==='','PROBE_CLEAN_MAIN');
  const old=await json(base+'/techlong-w5f-review-20261017-a/manifest.json');
  for(const f of old.source.files)must(digest((await readFile(root+'/'+f.file,'utf8')).replaceAll('\r\n','\n'))===f.normalizedLfSha256,'PROBE_OLD_SOURCE_PIN');
  const files=[...old.source.files],extra=['ops/cloud-worker/verify-install-v5.mjs','tests/cloud-worker-verify-install-v5.test.mjs',V.riskFile,
    '.github/workflows/cloud-worker-execute.yml','.github/workflows/cloud-worker-job.yml',recordFile];
  for(const f of extra)files.push({ file:f,normalizedLfSha256:digest((await readFile(root+'/'+f,'utf8')).replaceAll('\r\n','\n')) });
  const executed=await json(root+'/'+recordFile),proofRaw=await readFile(executed.independentProof.localProof);
  must(digest(proofRaw)===executed.independentProof.rawSha256 && executed.state==='ACTIVATED_INDEPENDENT_METADATA_VERIFIED_NO_DISPATCH','PROBE_ACTIVATED_HISTORY');
  const proof=JSON.parse(proofRaw);for(const f of proof.evidenceFiles)must(f.path.startsWith(base+'/') && digest(await readFile(f.path))===f.rawSha256,'PROBE_RECEIPT_HISTORY');
  await assertReleaseObjectsV5(old.actions.release); const history=await activationHistoryV5();
  return { source:{ commit:(await gitLocalV5(['rev-parse','HEAD'])).trim(),files:files.sort((a,b)=>a.file.localeCompare(b.file)),node:process.version },
    history:{ ...history,activationRecordRawSha256:digest(await readFile(root+'/'+recordFile)),activationProofRawSha256:digest(proofRaw),activationEvidenceFiles:proof.evidenceFiles.length },
    old,publication:proof.publication };
}
export async function createProbeIoV5(output,context) {
  const record=async(name,value)=>{assertEvidenceSafeV5(value);await writePublicOnceV5(output,name,value);};
  let token,posts=0;
  const gh=async(method,suffix,body)=>{
    token??=await credential(); const r=await fetch('https://api.github.com/'+suffix,{ method,
      headers:{ authorization:'Bearer '+token,accept:'application/vnd.github+json','content-type':'application/json',
        'x-github-api-version':V.apiVersion,'user-agent':'Techlong-Single-VerifyInstall' },
      ...(body===undefined?{}:{ body:JSON.stringify(body) }),redirect:'error',signal:AbortSignal.timeout(30000) });
    if(!r.ok)throw Object.assign(Error('PROBE_GITHUB_STATUS'),{status:r.status});
    if(method==='POST')must(r.status===200,'PROBE_RUN_ACK_REQUIRED');
    return r.status===204?null:r.json();
  };
  const capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json'),binding=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json');
  const metadata=createActivationIoV5({output,capsule,binding});
  return { record,
    async preflight() {
      const [repository,actor,branch,workflow,runs,caller,reusable]=await Promise.all([gh('GET',repo),gh('GET','user'),gh('GET',repo+'/branches/main'),
        gh('GET',repo+'/actions/workflows/'+V.workflowId),gh('GET',repo+'/actions/workflows/'+V.workflowId+'/runs?per_page=1'),
        gh('GET',repo+'/contents/.github/workflows/cloud-worker-execute.yml?ref='+context.source.commit),
        gh('GET',repo+'/contents/.github/workflows/cloud-worker-job.yml?ref='+V.reusable)]);
      must(repository.id===1323312747 && repository.owner?.id===14145707 && repository.visibility==='public' && repository.default_branch==='main' &&
        repository.permissions?.admin===true && actor.id===14145707 && branch.commit.sha===context.source.commit &&
        workflow.id===V.workflowId && workflow.path==='.github/workflows/cloud-worker-execute.yml' && workflow.state==='active' &&
        runs.total_count===0 && runs.workflow_runs?.length===0,'PROBE_GITHUB_PRESTATE');
      for(const [r,file]of [[caller,'.github/workflows/cloud-worker-execute.yml'],[reusable,'.github/workflows/cloud-worker-job.yml']])
        must(r.encoding==='base64' && r.type==='file' && r.path===file &&
          Buffer.from(r.content,'base64').toString('utf8').replaceAll('\r\n','\n')===(await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'),'PROBE_REMOTE_WORKFLOW');
      const view=structuredClone(context.old);view.actions.release.caller.commit=context.source.commit;
      const proof=await metadata.inspectActivated(view,context.publication); await record('metadata',proof);
      must(proof.environment.environmentId===V.environmentId,'PROBE_ENVIRONMENT_ID');
      return { main:branch.commit.sha,workflowId:workflow.id,environmentId:V.environmentId,deploymentWorkflowRuns:0,metadataVerified:true,
        runtimeCommit:V.runtime,reusableCommit:V.reusable,publication:context.publication,roleId:proof.foundation.roleId,tableId:proof.foundation.tableId };
    },
    async consumeSlot(v){await writeFile(V.slot,JSON.stringify(v)+'\n',{flag:'wx',flush:true});},
    async dispatch(request,guard){must(request.method==='POST' && request.path===repo+'/actions/workflows/'+V.workflowId+'/dispatches' &&
      request.apiVersion===V.apiVersion && same(request.body,verifyDispatchBodyV5(context.publication)),'PROBE_ONLY_ONE_POST');
      // Recheck the mutable branch immediately before submission; not a cross-service CAS.
      must((await gh('GET',repo+'/branches/main')).commit.sha===context.source.commit,'PROBE_MAIN_DRIFT');
      await guard();must(++posts===1,'PROBE_POST_ONCE');
      return gh('POST',request.path,request.body);
    },
    async inspect(m,runId) {
      const r=await gh('GET',repo+'/actions/runs/'+runId),summary=assertProbeRunV5(r,m,runId);await record('run-metadata',summary);
      if(r.status!=='completed')return {outcome:'WAITING_OR_RUNNING_NO_AUTOMATIC_RETRY',...summary};
      if(r.conclusion!=='success')return {outcome:'RUN_NOT_SUCCESSFUL_NO_AUTOMATIC_RETRY',...summary};
      const jobs=await gh('GET',repo+'/actions/runs/'+runId+'/jobs?filter=all&per_page=100');
      must(jobs.total_count===1 && jobs.jobs?.length===1 && jobs.jobs[0].conclusion==='success' &&
        String(jobs.jobs[0].run_id)===runId && jobs.jobs[0].head_sha===m.source.commit,'PROBE_ONE_SUCCESS_JOB');
      token??=await credential();
      const resp=await fetch('https://api.github.com/'+repo+'/actions/jobs/'+jobs.jobs[0].id+'/logs',{headers:{authorization:'Bearer '+token,
        accept:'application/vnd.github+json','x-github-api-version':V.apiVersion},redirect:'manual',signal:AbortSignal.timeout(30000)});
      const location=resp.headers.get('location');must(resp.status===302 && location,'PROBE_LOG_REDIRECT');const u=new URL(location);
      must(u.protocol==='https:' && !u.username && !u.password && /\.(blob\.core\.windows\.net|actions\.githubusercontent\.com)$/.test(u.hostname),'PROBE_LOG_HOST');
      const raw=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(30000)});must(raw.ok && Number(raw.headers.get('content-length')??0)<3000000,'PROBE_LOG_RESPONSE');
      const proof=probeProofFromLogsV5(await raw.text(),m,runId);await record('cloud-public-proof',proof);
      return {outcome:'CLOUD_VERIFY_INSTALL_INDEPENDENT_PUBLIC_PROOF_VERIFIED',...summary,proof,rawLogsSaved:false,externalWrites:0,retryAllowed:false};
    },dispose(){token=undefined;metadata.dispose();},
  };
}
async function fresh(input,kind) {
  const p=path.resolve(input);must(path.dirname(p).toLowerCase()===path.resolve(base).toLowerCase() &&
    new RegExp('^techlong-w5g-'+kind+'-[a-z0-9-]+$').test(path.basename(p)),'PROBE_OUTPUT');return p;
}
export async function mainProbeV5(args=process.argv.slice(2)) {
  const a={};must(args.length%2===0,'PROBE_ARGUMENTS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n]),'PROBE_DUPLICATE_ARGUMENT');a[args[n]]=args[n+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Dispatch'?['--manifest','--approved-sha']:mode==='Inspect'?['--dispatch-directory']:[])];
  must(['Review','Dispatch','Inspect'].includes(mode) && Object.keys(a).length===keys.length && keys.every(k=>a[k]),'PROBE_ARGUMENT_SET');
  assertLocalEnvironmentV5();const out=await fresh(a['--output'],mode.toLowerCase());await mkdir(out);
  if(mode!=='Inspect')try{await access(V.slot);must(false,'PROBE_SLOT_USED');}catch(e){if(e.code!=='ENOENT')throw e;}
  const context=await localSource(),io=await createProbeIoV5(out,context);
  try {
    let result;
    if(mode==='Review'){
      const prestate=await io.preflight(),m=await prepareProbeV5({...context,prestate,now:Date.now()});await io.record('manifest',m);
      result={mode,manifestSha256:m.manifestSha256,expiresAt:new Date(m.expiresAt).toISOString(),main:m.source.commit,
        externalWrites:0,secretValueReads:0,slotConsumed:false,workflowDispatched:false};
    }else{
      const dispatchDir=mode==='Inspect'?await realpath(await fresh(a['--dispatch-directory'],'dispatch')):null;
      const f=await realpath(mode==='Inspect'?path.join(dispatchDir,'manifest.json'):a['--manifest']);
      must(path.basename(f)==='manifest.json' && (mode==='Inspect'?path.dirname(f)===dispatchDir:path.dirname(f)===await fresh(path.dirname(f),'review')),'PROBE_MANIFEST_PATH');
      const m=await json(f),{manifestSha256,...body}=m;must(await sha256Hex(body)===manifestSha256,'PROBE_MANIFEST_HASH');await io.record('manifest',m);
      if(mode==='Dispatch')result=await dispatchProbeV5({manifest:m,approved:a['--approved-sha'],...context,io});
      else{const ack=await json(path.join(dispatchDir,'dispatch-api-ack.json')),slot=await json(V.slot);
        must(Number.isSafeInteger(ack.workflow_run_id) && ack.workflow_run_id>0 &&
          ack.html_url==='https://github.com/veinyyxy/TechlongSoftware/actions/runs/'+ack.workflow_run_id &&
          slot.manifestSha256===manifestSha256,'PROBE_INSPECT_ACK_AND_SLOT');result=await io.inspect(m,String(ack.workflow_run_id));}
    }
    await io.record('summary',result);console.log(JSON.stringify({...result,output:out},null,2));return result;
  }catch(e){const result={mode,outcome:'PROBE_STOPPED_READ_ONLY_INSPECT_NO_WRITE_RETRY',failure:safeActivationFailureV5(e),retryAllowed:false};
    await io.record('stopped',result);console.log(JSON.stringify({...result,output:out},null,2));process.exitCode=1;return result;
  }finally{io.dispose();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)mainProbeV5().catch(()=>{
  console.error('PROBE_LOCAL_SETUP_STOPPED_NO_AUTOMATIC_RETRY');process.exitCode=1;
});
