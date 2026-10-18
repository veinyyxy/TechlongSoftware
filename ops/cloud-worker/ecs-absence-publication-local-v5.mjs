// The only mutating entry requires Publish + a fresh exact execution-review SHA.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {CloudFormationClient,CreateChangeSetCommand,DescribeChangeSetCommand,GetTemplateCommand,ExecuteChangeSetCommand,DescribeStacksCommand} from '@aws-sdk/client-cloudformation';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {ECS_ABSENCE_PUBLICATION_V5 as V,prepareEcsAbsencePublicationV5,publishEcsAbsenceV5,
  verifyEcsAbsencePublicationChangeSetV5,ecsAbsenceTrustChangeV5} from './ecs-absence-publication-v5.mjs';
import {assertDnsReleaseObjectsV5} from './dns-release-v5.mjs';
import {renderPinnedJobV5,renderPinnedCallerV5} from './activation/release-v5.mjs';
const P=V;
import {createActivationIoV5} from './activation/local-io-v5.mjs';
import {gitLocalV5} from './activation/commit-objects-v5.mjs';
import {ROOT_CLOSURE_V5} from './activation/runtime-v5.mjs';
import {computeCloudClosureV5} from './closure-v5.mjs';
import {assertLocalEnvironmentV5,writePublicOnceV5} from './install/local-io-v5.mjs';
import {assertEvidenceSafeV5} from './cloud-evidence-v5.mjs';
import {requireActivationV5 as must,safeActivationFailureV5} from './activation/errors-v5.mjs';
const root='E:/NodejsProject/TechlongSoftware',base='F:/ChatGPT_workshop',repo='repos/veinyyxy/TechlongSoftware';
const hash=v=>createHash('sha256').update(v).digest('hex'),same=(a,b)=>canonicalJson(a)===canonicalJson(b),json=async f=>JSON.parse(await readFile(f,'utf8'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function absent(f){try{await access(f);must(false,'ECS_ABSENCE_PUBLICATION_SLOT_USED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(input,existing=false){const p=path.resolve(input);
  must(path.dirname(p).toLowerCase()===path.resolve(base).toLowerCase() && /^techlong-w5n-[a-z0-9-]+$/.test(path.basename(p)) &&
    (await realpath(base)).toLowerCase()===path.resolve(base).toLowerCase(),'ECS_ABSENCE_PUBLICATION_DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'ECS_ABSENCE_PUBLICATION_REALPATH');return p;
}
async function credential(){return new Promise((resolve,reject)=>{
  const p=spawn('git',['credential','fill'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';const timer=setTimeout(()=>p.kill(),15000);
  p.stdout.setEncoding('utf8');p.stdout.on('data',b=>{text+=b;if(text.length>20000)p.kill();});p.stderr.on('data',()=>{});p.stdin.on('error',()=>{});
  p.on('error',()=>{clearTimeout(timer);reject(Error('ECS_ABSENCE_GITHUB_CREDENTIAL'));});p.on('close',code=>{clearTimeout(timer);
    const token=text.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(code||!token||text.length>20000)reject(Error('ECS_ABSENCE_GITHUB_CREDENTIAL'));else resolve(token);});
  p.stdin.end('protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
});}
export async function ecsAbsencePublicationSourceV5(){
  must((await gitLocalV5(['branch','--show-current'])).trim()==='main'&&(await gitLocalV5(['status','--porcelain'])).trim()==='','ECS_ABSENCE_PUBLICATION_CLEAN_MAIN');
  const check=async f=>must(f.path.startsWith(base+'/')&&!f.path.includes('..')&&hash(await readFile(f.path))===f.rawSha256,'ECS_ABSENCE_HISTORICAL_ORIGINAL');
  const fixRaw=await readFile(base+'/techlong-w5m-code-fix-verified-20261018-a.json');
  must(hash(fixRaw)==='d52e9ebc4541f8820eafdf23907f34725e5962aced7d9df15ee2c89e0f650746','ECS_ABSENCE_FIX_PROOF');
  const fix=JSON.parse(fixRaw),failureRaw=await readFile(base+'/techlong-w5l-failed-checkpoint-20261018-a.json');
  must(fix.state==='CODE_FIX_AND_TESTS_PASSED_NOT_CLOUD_PUBLISHED'&&fix.candidateClosureSha256===V.candidateClosure&&
    hash(failureRaw)===fix.failureCheckpointRawSha256,'ECS_ABSENCE_FAILURE_PROOF');
  const failure=JSON.parse(failureRaw);
  must(failure.runId==='39149802733'&&failure.successfulManifestProduced===false&&failure.reviewV3SlotPermanentlyConsumed===true,'ECS_ABSENCE_FAILED_REVIEW');
  for(const f of failure.evidenceFiles)await check(f);
  const dispatched=await json(base+'/techlong-w5l-dispatched-checkpoint-20261018-a.json');
  await check({path:dispatched.preparationProof,rawSha256:dispatched.preparationProofRawSha256});
  for(const f of dispatched.evidenceFiles)await check(f);
  const prep=await json(dispatched.preparationProof);for(const f of prep.evidenceFiles)await check(f);
  const old=await json(prep.reviewDirectory+'/manifest.json'),{manifestSha256,...body}=old;
  must(manifestSha256===prep.manifestSha256&&await sha256Hex(body)===manifestSha256&&
    old.source.commit===fix.previousFailedCaller&&old.source.files.length===142,'ECS_ABSENCE_OLD_APPROVAL');
  for(const f of old.history.evidenceFiles)await check(f);
  const record='ops/aws-sandbox/reviews/cloud-worker-w5k-dns-publication.executed.json',recorded=(await readFile(root+'/'+record,'utf8')).replaceAll('\r\n','\n'),
    anchor=(await gitLocalV5(['show','f6d56a84fa14274f5de1c2ed7aa6b608c9397784:'+record])).replaceAll('\r\n','\n'),publication=JSON.parse(recorded);
  must(recorded===anchor&&publication.runtimeCommit===V.oldRuntime&&publication.reusableCommit===V.oldReusable&&publication.evidenceFiles.length===26,'ECS_ABSENCE_INSTALLED_PUBLICATION');
  for(const f of publication.evidenceFiles)await check(f);
  const prior=await json(base+'/techlong-w5k-review-20261018-b/manifest.json');await assertDnsReleaseObjectsV5(prior.release);
  const jraw=await readFile(base+'/techlong-w5j-dns-fix-verified-20261018-a.json');
  must(hash(jraw)===old.history.previousPreparationProofRawSha256,'ECS_ABSENCE_W5J_PROOF');
  for(const f of JSON.parse(jraw).evidenceFiles)await check(f);
  const g=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.executed.json'),
    h=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5h-request-recorded.json'),
    a=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json');
  for(const f of h.evidence)await check(f);
  for(const p of [{path:g.independentProof.localFile,rawSha256:g.independentProof.rawSha256},{path:a.independentProof.localProof,rawSha256:a.independentProof.rawSha256}]){
    await check(p);for(const f of JSON.parse(await readFile(p.path,'utf8')).evidenceFiles)await check(f);
  }
  const files=new Map(),changed=[],allowed=['.github/workflows/cloud-worker-candidate.yml','ops/cloud-worker/activation/runtime-v5.mjs','ops/cloud-worker/aws-initialized-workload-v5.mjs'];
  for(let i=0;i<old.source.files.length;i+=8)await Promise.all(old.source.files.slice(i,i+8).map(async p=>{
    must(hash((await gitLocalV5(['show',old.source.commit+':'+p.file])).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'ECS_ABSENCE_HISTORICAL_GIT_PIN');
    const actual=hash((await readFile(root+'/'+p.file,'utf8')).replaceAll('\r\n','\n'));
    if(actual!==p.normalizedLfSha256){must(allowed.includes(p.file),'ECS_ABSENCE_UNREVIEWED_CHANGE');changed.push(p.file);}
    files.set(p.file,{file:p.file,normalizedLfSha256:actual});
  }));
  must(same(changed.sort(),[...allowed].sort()),'ECS_ABSENCE_ONLY_REVIEWED_CHANGES');
  const newDocumentation=new Set(['README.md','docs/aws-auto-deployment-mainline.md','.github/workflows/cloud-worker-candidate.yml']);
  for(const p of fix.sourcePins){
    must(hash((await gitLocalV5(['show',fix.platformMain+':'+p.file])).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'ECS_ABSENCE_TESTED_FIX_GIT_PIN');
    const actual=hash((await readFile(root+'/'+p.file,'utf8')).replaceAll('\r\n','\n'));
    must(actual===p.normalizedLfSha256||newDocumentation.has(p.file),'ECS_ABSENCE_TESTED_FIX_DRIFT');files.set(p.file,{file:p.file,normalizedLfSha256:actual});
  }
  for(const file of ['ops/cloud-worker/ecs-absence-publication-v5.mjs','ops/cloud-worker/ecs-absence-publication-local-v5.mjs',
    'tests/cloud-worker-ecs-publication-v5.test.mjs',V.riskFile,'ops/aws-sandbox/reviews/cloud-worker-w5n-ecs-publication.prepared.json'])
    files.set(file,{file,normalizedLfSha256:hash((await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'))});
  const closure=await computeCloudClosureV5();
  must(closure.pinCount===76&&closure.closureSha256===V.candidateClosure&&ROOT_CLOSURE_V5===V.candidateClosure,'ECS_ABSENCE_CANDIDATE_CLOSURE');
  return {source:{commit:(await gitLocalV5(['rev-parse','HEAD'])).trim(),node:process.version,runtimeClosureSha256:closure.closureSha256,
    files:[...files.values()].sort((a,b)=>a.file.localeCompare(b.file))},
    history:{...old.history,ecsFixVerified:true,ecsFixProofRawSha256:hash(fixRaw),failureCheckpointRawSha256:hash(failureRaw),
      failedReviewRunId:failure.runId,historicalSourcePinsVerified:142,explicitChangedSourceFiles:changed.sort(),
      oldRecordsAndSlotsPreserved:true,installedRuntime:V.oldRuntime,installedReusable:V.oldReusable,
      publicationRecordNormalizedLfSha256:hash(recorded),publicationOriginalsVerified:26}};
}
export async function prepareEcsAbsenceReleaseObjectsV5({sourceCommit,output,now}){
  const env={GIT_INDEX_FILE:path.join(output,'release.index'),GIT_AUTHOR_DATE:new Date(now).toISOString(),GIT_COMMITTER_DATE:new Date(now).toISOString()};
  await gitLocalV5(['read-tree',sourceCommit],{env});
  const make=async(file,text,parent,message)=>{
    const blob=(await gitLocalV5(['hash-object','-w','--stdin'],{input:text})).trim();
    must(/^[a-f0-9]{40}$/.test(blob),'ECS_ABSENCE_BLOB');
    await gitLocalV5(['update-index','--add','--cacheinfo','100644,'+blob+','+file],{env});
    const tree=(await gitLocalV5(['write-tree'],{env})).trim(),commit=(await gitLocalV5(['commit-tree',tree,'-p',parent],{env,input:message+'\n'})).trim();
    must(/^[a-f0-9]{40}$/.test(commit),'ECS_ABSENCE_COMMIT');return {commit,tree,parent,file,normalizedLfSha256:hash(text)};
  };
  const reusable=await make(V.reusable,renderPinnedJobV5(sourceCommit),sourceCommit,'fix(deployment): pin strict ECS absence runtime'),
    caller=await make(V.caller,renderPinnedCallerV5(reusable.commit),reusable.commit,'fix(deployment): pin strict ECS absence reusable');
  const release={sourceCommit,runtimeCommit:sourceCommit,reusable,caller,branchesCreated:0,refsChanged:0,remoteWrites:0};
  await assertDnsReleaseObjectsV5(release);return release;
}
export async function createEcsAbsencePublicationIoV5(output,context){
  const capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json'),binding=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json'),
    oldView=await json(base+'/techlong-w5f-review-20261017-a/manifest.json'),published=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json');
  const subject=oldView.prestate.github.oidcSubject;
  must(subject.use_default===true && subject.use_immutable_subject===true &&
    subject.sub_claim_prefix==='repo:veinyyxy@14145707/TechlongSoftware@1323312747','ECS_ABSENCE_PUBLICATION_FIXED_OIDC_SUBJECT');
  const metadata=createActivationIoV5({output,capsule,binding}),cf=new CloudFormationClient({region:'ca-central-1',maxAttempts:1,ignoreConfiguredEndpointUrls:true,
    endpoint:'https://cloudformation.ca-central-1.amazonaws.com',credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})});
  let token;const counts={gitPushAttempts:0,changeSetCreateAttempts:0,changeSetExecuteAttempts:0,localMainFastForwards:0,
    secretValueReads:0,workflowDispatches:0,automaticWriteRetries:0};
  const record=async(n,v)=>{assertEvidenceSafeV5(v);await writePublicOnceV5(output,n,v);};
  const send=q=>cf.send(q,{abortSignal:AbortSignal.timeout(30000)});
  const get=async suffix=>{token??=await credential();const r=await fetch('https://api.github.com/'+suffix,{headers:{authorization:'Bearer '+token,
    accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Techlong-Reviewed-ECS-Absence-Publication'},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Object.assign(Error('ECS_ABSENCE_GITHUB_READ_STATUS'),{status:r.status});return r.json();};
  const remoteMain=async expected=>must((await get(repo+'/branches/main')).commit.sha===expected,'ECS_ABSENCE_PUBLICATION_REMOTE_MAIN');
  const readLayout=async(state,expectedMain,reusable)=>{
    const view=structuredClone(oldView);view.actions.release.caller.commit=expectedMain;
    view.actions.release.reusable.commit=state==='old'?V.oldReusable:reusable;
    view.actions.foundation.template=ecsAbsenceTrustChangeV5(capsule,reusable).template;
    if(state==='old')view.actions.foundation.template=ecsAbsenceTrustChangeV5(capsule,reusable).oldTemplate;
    return metadata.inspectActivated(view,{key:published.publication.key,versionId:published.publication.versionId,
      sha256:published.publication.wholeDocumentSha256,installationSha256:binding.installationSha256});
  };
  return {record,counts:()=>({...counts}),
    async preflight(expectedMain){
      await remoteMain(expectedMain);
      const [runs,ci]=await Promise.all([get(repo+'/actions/workflows/'+P.workflowId+'/runs?per_page=100'),get(repo+'/actions/runs?head_sha='+expectedMain+'&per_page=100')]);
      must(runs.total_count<100 && runs.workflow_runs?.length===runs.total_count && runs.workflow_runs.every(r=>r.status==='completed'),'ECS_ABSENCE_PUBLICATION_NO_ACTIVE_RUN');
      const names=['Cloud worker portable candidate - No AWS','Cloud worker fixed-version continuation - No AWS'],checked=[];
      must(ci.total_count<100 && ci.workflow_runs?.length===ci.total_count,'ECS_ABSENCE_PUBLICATION_CI_INVENTORY');
      for(const name of names){const found=ci.workflow_runs.filter(r=>r.name===name && r.head_sha===expectedMain && r.run_attempt===1);
        must(found.length===1 && found[0].status==='completed' && found[0].conclusion==='success','ECS_ABSENCE_PUBLICATION_SOURCE_CI_NOT_PASSED');checked.push(String(found[0].id));}
      const proof=await readLayout('old',expectedMain,context.release.reusable.commit);await record('preflight-installed',proof);
      return {main:proof.main,roleId:proof.foundation.roleId,tableId:proof.foundation.tableId,environment:proof.environment,publication:proof.publication,
        templateMatchesOld:true,installedReusable:V.oldReusable,metadataSha256:await sha256Hex(proof),unfinishedDeploymentRuns:0,
        completedDeploymentRunIds:runs.workflow_runs.map(r=>String(r.id)).sort(),sourceCiConfirmed:true,sourceCiRunIds:checked.sort()};
    },
    async assertLocalSource(m){
      must((await gitLocalV5(['branch','--show-current'])).trim()==='main' && (await gitLocalV5(['rev-parse','HEAD'])).trim()===m.source.commit &&
        (await gitLocalV5(['status','--porcelain'])).trim()==='','ECS_ABSENCE_PUBLICATION_LOCAL_MAIN');
      for(const p of m.source.files)must(hash((await readFile(root+'/'+p.file,'utf8')).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'ECS_ABSENCE_PUBLICATION_LOCAL_PIN');
      await assertDnsReleaseObjectsV5(m.release);
    },
    async consumeSlot(v){await writeFile(P.slot,JSON.stringify(v)+'\n',{flag:'wx',flush:true});},
    async publishRelease(release,guard){
      await assertDnsReleaseObjectsV5(release);must((await gitLocalV5(['remote','get-url','--push','github'])).trim()==='https://github.com/veinyyxy/TechlongSoftware.git','ECS_ABSENCE_PUBLICATION_REMOTE_URL');
      await remoteMain(release.sourceCommit);await guard();must(counts.gitPushAttempts++===0,'ECS_ABSENCE_PUBLICATION_PUSH_ONCE');
      await gitLocalV5(['push','github',release.caller.commit+':refs/heads/main']);
      await record('push-command-ack',{main:release.caller.commit,reusable:release.reusable.commit});await remoteMain(release.caller.commit);
      return {main:release.caller.commit,reusable:release.reusable.commit,runtime:release.runtimeCommit};
    },
    async verifyLayout(m,state,main,label){
      await remoteMain(main);const proof=await readLayout(state,main,m.release.reusable.commit),normalized=structuredClone(proof);
      normalized.main=m.source.commit;normalized.foundation.trustReusesCommit=V.oldReusable;
      must(await sha256Hex(normalized)===m.prestate.metadataSha256,'ECS_ABSENCE_PUBLICATION_UNCHANGED_LAYOUT');await record(label,proof);return proof;
    },
    async createChangeSet(request,guard){
      await remoteMain(context.release.caller.commit);await guard();must(counts.changeSetCreateAttempts++===0,'ECS_ABSENCE_PUBLICATION_CREATE_ONCE');const r=await send(new CreateChangeSetCommand(request));
      must(r.StackId===V.stackId && typeof r.Id==='string' &&
        /^arn:aws:cloudformation:ca-central-1:402010193138:changeSet\/ecs-absence-v5-[a-f0-9]{24}\/[a-f0-9-]{36}$/.test(r.Id) &&
        r.Id.split('/')[1]===request.ChangeSetName,'ECS_ABSENCE_PUBLICATION_CREATE_ACK');
      const ref={changeSetId:r.Id,stackId:r.StackId};await record('changeset-create-api-ack',ref);return ref;
    },
    async waitChangeSet(ref,m,guard){
      for(let i=0;i<20;i++){
        await guard();const d=await send(new DescribeChangeSetCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId}));
        if(d.Status==='CREATE_COMPLETE'){
          const t=await send(new GetTemplateCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId,TemplateStage:'Original'}));
          return verifyEcsAbsencePublicationChangeSetV5(d,m,ref.changeSetId,JSON.parse(t.TemplateBody));
        }
        must(['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(d.Status),'ECS_ABSENCE_PUBLICATION_CHANGESET_STOPPED');await sleep(1500);
      }throw Error('ECS_ABSENCE_PUBLICATION_CHANGESET_PENDING_INSPECT_ONLY');
    },
    async executeChangeSet(ref,m,guard){
      const d=await send(new DescribeChangeSetCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId})),
        t=await send(new GetTemplateCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId,TemplateStage:'Original'}));
      verifyEcsAbsencePublicationChangeSetV5(d,m,ref.changeSetId,JSON.parse(t.TemplateBody));await remoteMain(m.release.caller.commit);await guard();
      must(counts.changeSetExecuteAttempts++===0,'ECS_ABSENCE_PUBLICATION_EXECUTE_ONCE');
      await send(new ExecuteChangeSetCommand({...m.actions.foundation.execute,ChangeSetName:ref.changeSetId}));
      const ack={changeSetId:ref.changeSetId,stackId:V.stackId,disableRollback:true};await record('changeset-execute-api-ack',ack);return ack;
    },
    async waitFoundation(guard){
      for(let i=0;i<40;i++){
        await guard();const r=await send(new DescribeStacksCommand({StackName:V.stackId})),s=r.Stacks?.[0];
        must(r.Stacks?.length===1 && s.StackId===V.stackId,'ECS_ABSENCE_PUBLICATION_STACK_ID');
        if(s.StackStatus==='UPDATE_COMPLETE')return;
        must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus),'ECS_ABSENCE_PUBLICATION_STACK_STOPPED');await sleep(2500);
      }throw Error('ECS_ABSENCE_PUBLICATION_STACK_PENDING_INSPECT_ONLY');
    },
    async syncLocalMain(release){
      must((await gitLocalV5(['status','--porcelain'])).trim()==='' && (await gitLocalV5(['rev-parse','HEAD'])).trim()===release.sourceCommit,'ECS_ABSENCE_PUBLICATION_LOCAL_SYNC');
      await remoteMain(release.caller.commit);must(counts.localMainFastForwards++===0,'ECS_ABSENCE_PUBLICATION_SYNC_ONCE');
      await gitLocalV5(['merge','--ff-only',release.caller.commit]);await record('local-main-ack',{head:release.caller.commit});
    },
    async inspect(m){
      await assertDnsReleaseObjectsV5(m.release);
      const branch=await get(repo+'/branches/main'),remote=branch.commit.sha,
        [s,t]=await Promise.all([send(new DescribeStacksCommand({StackName:V.stackId})),send(new GetTemplateCommand({StackName:V.stackId,TemplateStage:'Original'}))]);
      const current=JSON.parse(t.TemplateBody),old=ecsAbsenceTrustChangeV5(capsule,m.release.reusable.commit).oldTemplate,
        state=same(current,old)?'old':same(current,JSON.parse(m.actions.foundation.create.TemplateBody))?'new':'unknown',stack=s.Stacks?.[0];
      must(s.Stacks?.length===1 && stack.StackId===V.stackId,'ECS_ABSENCE_PUBLICATION_INSPECT_STACK');
      const localHead=(await gitLocalV5(['rev-parse','HEAD'])).trim();
      const facts={remoteMain:remote,localHead,localMainAtPublishedCaller:localHead===m.release.caller.commit,
        stackId:stack.StackId,stackStatus:stack.StackStatus,templateState:state,templateSha256:await sha256Hex(current)};
      await record('independent-partial-metadata',facts);
      if(![m.source.commit,m.release.caller.commit].includes(remote) || state==='unknown' || stack.StackStatus!=='UPDATE_COMPLETE')
        return {outcome:'ECS_ABSENCE_PUBLICATION_PARTIAL_OR_DRIFT_METADATA_ONLY_NO_RETRY',manifestSha256:m.manifestSha256,facts,externalWrites:0,secretValueReads:0,workflowDispatched:false,retryAllowed:false};
      const proof=await this.verifyLayout(m,state,remote,'independent-layout');
      if(state!=='new' || remote!==m.release.caller.commit)
        return {outcome:'ECS_ABSENCE_PUBLICATION_PARTIAL_OLD_TRUST_OR_MAIN_VERIFIED_NO_RETRY',manifestSha256:m.manifestSha256,facts,proof,externalWrites:0,secretValueReads:0,workflowDispatched:false,retryAllowed:false};
      const [caller,reusable]=await Promise.all([get(repo+'/contents/'+V.caller+'?ref='+m.release.caller.commit),get(repo+'/contents/'+V.reusable+'?ref='+m.release.reusable.commit)]);
      for(const [r,p]of [[caller,m.release.caller],[reusable,m.release.reusable]])must(r.encoding==='base64' &&
        hash(Buffer.from(r.content,'base64').toString('utf8').replaceAll('\r\n','\n'))===p.normalizedLfSha256,'ECS_ABSENCE_PUBLICATION_PUBLISHED_BYTES');
      return {outcome:'ECS_ABSENCE_VERSION_INDEPENDENTLY_VERIFIED_NO_DISPATCH',manifestSha256:m.manifestSha256,facts,proof,externalWrites:0,secretValueReads:0,workflowDispatched:false,retryAllowed:false};
    },dispose(){token=undefined;cf.destroy();metadata.dispose();},
  };
}
export async function mainEcsAbsencePublicationV5(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ECS_ABSENCE_PUBLICATION_ARGUMENTS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'ECS_ABSENCE_PUBLICATION_DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Publish'?['--manifest','--approved-sha']:mode==='Inspect'?['--run-directory']:[])];
  must(['Prepare','Publish','Inspect'].includes(mode) && Object.keys(a).length===keys.length && keys.every(k=>a[k]),'ECS_ABSENCE_PUBLICATION_ARGUMENT_SET');
  assertLocalEnvironmentV5();const output=await directory(a['--output']);await mkdir(output);
  let context,m;
  if(mode==='Inspect'){
    const run=await directory(a['--run-directory'],true);m=await json(run+'/approved-manifest.json');const {manifestSha256,...body}=m,slot=await json(P.slot);
    must(await sha256Hex(body)===manifestSha256 && slot.manifestSha256===manifestSha256,'ECS_ABSENCE_PUBLICATION_INSPECT_BINDING');context={source:m.source,history:m.history,release:m.release};
  }else{
    await absent(P.slot);context=await ecsAbsencePublicationSourceV5();
    if(mode==='Prepare')context.release=await prepareEcsAbsenceReleaseObjectsV5({sourceCommit:context.source.commit,output,now:Date.now()});
    else{
      const file=path.resolve(a['--manifest']);await directory(path.dirname(file),true);must(path.basename(file)==='manifest.json','ECS_ABSENCE_PUBLICATION_MANIFEST_PATH');
      m=await json(file);context.release=m.release;await assertDnsReleaseObjectsV5(m.release);
      must(m.source.commit===context.source.commit,'ECS_ABSENCE_PUBLICATION_FINAL_MAIN');
    }
  }
  const capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json');context.capsule=capsule;
  const io=await createEcsAbsencePublicationIoV5(output,context);
  try{
    let result;
    if(mode==='Prepare'){
      await io.record('release',context.release);const prestate=await io.preflight(context.source.commit);
      m=await prepareEcsAbsencePublicationV5({...context,prestate,now:Date.now()});await io.record('manifest',m);
      await io.record('template',JSON.parse(m.actions.foundation.create.TemplateBody));
      result={outcome:'FRESH_ECS_ABSENCE_PUBLICATION_EXECUTION_REVIEW_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,sourceCommit:m.source.commit,
        reusableCommit:m.release.reusable.commit,callerCommit:m.release.caller.commit,expiresAt:new Date(m.expiresAt).toISOString(),
        slotConsumed:false,remoteWrites:0,awsWrites:0,secretValueReads:0,workflowDispatches:0};
    }else if(mode==='Publish'){
      await io.record('approved-manifest',m);result=await publishEcsAbsenceV5({manifest:m,approved:a['--approved-sha'],context:{...context,prestate:m.prestate},io});
      if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else{result=await io.inspect(m);await io.record('result',result);}
    if(mode==='Prepare')await io.record('result',result);console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)mainEcsAbsencePublicationV5().catch(e=>{
  console.error(JSON.stringify({outcome:'ECS_ABSENCE_PUBLICATION_STOPPED_NO_AUTOMATIC_WRITE_RETRY',failure:safeActivationFailureV5(e)}));process.exitCode=1;
});


