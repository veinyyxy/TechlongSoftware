// The only mutating entry requires Publish + a fresh exact execution-review SHA.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {CloudFormationClient,CreateChangeSetCommand,DescribeChangeSetCommand,GetTemplateCommand,ExecuteChangeSetCommand,DescribeStacksCommand} from '@aws-sdk/client-cloudformation';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {DNS_PUBLICATION_V5 as P,prepareDnsPublicationV5,publishDnsV5,verifyDnsPublicationChangeSetV5} from './dns-publication-v5.mjs';
import {DNS_RELEASE_V5 as V,prepareDnsReleaseObjectsV5,assertDnsReleaseObjectsV5,dnsTrustChangeV5} from './dns-release-v5.mjs';
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
async function absent(f){try{await access(f);must(false,'DNS_PUBLICATION_SLOT_USED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(input,existing=false){const p=path.resolve(input);
  must(path.dirname(p).toLowerCase()===path.resolve(base).toLowerCase() && /^techlong-w5k-[a-z0-9-]+$/.test(path.basename(p)) &&
    (await realpath(base)).toLowerCase()===path.resolve(base).toLowerCase(),'DNS_PUBLICATION_DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'DNS_PUBLICATION_REALPATH');return p;
}
async function credential(){return new Promise((resolve,reject)=>{
  const p=spawn('git',['credential','fill'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='';const timer=setTimeout(()=>p.kill(),15000);
  p.stdout.setEncoding('utf8');p.stdout.on('data',b=>{text+=b;if(text.length>20000)p.kill();});p.stderr.on('data',()=>{});p.stdin.on('error',()=>{});
  p.on('error',()=>{clearTimeout(timer);reject(Error('DNS_GITHUB_CREDENTIAL'));});p.on('close',code=>{clearTimeout(timer);
    const token=text.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(code||!token||text.length>20000)reject(Error('DNS_GITHUB_CREDENTIAL'));else resolve(token);});
  p.stdin.end('protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
});}
async function currentSource(){
  must((await gitLocalV5(['branch','--show-current'])).trim()==='main' && (await gitLocalV5(['status','--porcelain'])).trim()==='','DNS_PUBLICATION_CLEAN_MAIN');
  const proofFile=base+'/techlong-w5j-dns-fix-verified-20261018-a.json',proofRaw=await readFile(proofFile);
  must(hash(proofRaw)==='b77851109f10148363139248af892982a7b18ef0d5c1e0a5c6143849e0a898d2','DNS_PUBLICATION_W5J_PROOF');
  const proof=JSON.parse(proofRaw);for(const f of proof.evidenceFiles)must(f.path.startsWith(base+'/') && hash(await readFile(f.path))===f.rawSha256,'DNS_PUBLICATION_W5J_ORIGINAL');
  const old=await json(proof.preparedMaterial.directory+'/manifest.json'),files=[...old.source.files];
  for(const p of files)must(hash((await readFile(root+'/'+p.file,'utf8')).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'DNS_PUBLICATION_OLD_PIN');
  for(const f of old.history.evidenceFiles)must(f.path.startsWith(base+'/') && hash(await readFile(f.path))===f.rawSha256,'DNS_PUBLICATION_OLD_SLOT_OR_PROOF');
  const extra=['ops/cloud-worker/dns-publication-v5.mjs','ops/cloud-worker/dns-publication-local-v5.mjs',
    'tests/cloud-worker-dns-publication-v5.test.mjs',P.riskFile,'ops/aws-sandbox/reviews/cloud-worker-w5k-dns-publication.prepared.json'];
  for(const file of extra)files.push({file,normalizedLfSha256:hash((await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'))});
  const closure=await computeCloudClosureV5();must(closure.closureSha256===ROOT_CLOSURE_V5 && closure.pinCount===76,'DNS_PUBLICATION_CLOSURE');
  return {source:{commit:(await gitLocalV5(['rev-parse','HEAD'])).trim(),node:process.version,runtimeClosureSha256:closure.closureSha256,
    files:files.sort((a,b)=>a.file.localeCompare(b.file))},history:{...old.history,previousPreparationProofRawSha256:hash(proofRaw),
      priorRuntimeCommit:proof.platformMain,previousSourcePinsPreserved:old.source.files.length,previousCandidateCi:proof.validation.portableCandidate}};
}
export async function createDnsPublicationIoV5(output,context){
  const capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json'),binding=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json'),
    oldView=await json(base+'/techlong-w5f-review-20261017-a/manifest.json'),published=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json');
  const subject=oldView.prestate.github.oidcSubject;
  must(subject.use_default===true && subject.use_immutable_subject===true &&
    subject.sub_claim_prefix==='repo:veinyyxy@14145707/TechlongSoftware@1323312747','DNS_PUBLICATION_FIXED_OIDC_SUBJECT');
  const metadata=createActivationIoV5({output,capsule,binding}),cf=new CloudFormationClient({region:'ca-central-1',maxAttempts:1,ignoreConfiguredEndpointUrls:true,
    endpoint:'https://cloudformation.ca-central-1.amazonaws.com',credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})});
  let token;const counts={gitPushAttempts:0,changeSetCreateAttempts:0,changeSetExecuteAttempts:0,localMainFastForwards:0,
    secretValueReads:0,workflowDispatches:0,automaticWriteRetries:0};
  const record=async(n,v)=>{assertEvidenceSafeV5(v);await writePublicOnceV5(output,n,v);};
  const send=q=>cf.send(q,{abortSignal:AbortSignal.timeout(30000)});
  const get=async suffix=>{token??=await credential();const r=await fetch('https://api.github.com/'+suffix,{headers:{authorization:'Bearer '+token,
    accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Techlong-Reviewed-DNS-Publication'},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Object.assign(Error('DNS_GITHUB_READ_STATUS'),{status:r.status});return r.json();};
  const remoteMain=async expected=>must((await get(repo+'/branches/main')).commit.sha===expected,'DNS_PUBLICATION_REMOTE_MAIN');
  const readLayout=async(state,expectedMain,reusable)=>{
    const view=structuredClone(oldView);view.actions.release.caller.commit=expectedMain;
    view.actions.release.reusable.commit=state==='old'?V.oldReusable:reusable;
    view.actions.foundation.template=dnsTrustChangeV5(capsule,reusable).template;
    if(state==='old')view.actions.foundation.template=dnsTrustChangeV5(capsule,reusable).oldTemplate;
    return metadata.inspectActivated(view,{key:published.publication.key,versionId:published.publication.versionId,
      sha256:published.publication.wholeDocumentSha256,installationSha256:binding.installationSha256});
  };
  return {record,counts:()=>({...counts}),
    async preflight(expectedMain){
      await remoteMain(expectedMain);
      const [runs,ci]=await Promise.all([get(repo+'/actions/workflows/'+P.workflowId+'/runs?per_page=100'),get(repo+'/actions/runs?head_sha='+expectedMain+'&per_page=100')]);
      must(runs.total_count<100 && runs.workflow_runs?.length===runs.total_count && runs.workflow_runs.every(r=>r.status==='completed'),'DNS_PUBLICATION_NO_ACTIVE_RUN');
      const names=['Cloud worker portable candidate - No AWS','Cloud worker fixed-version continuation - No AWS'],checked=[];
      must(ci.total_count<100 && ci.workflow_runs?.length===ci.total_count,'DNS_PUBLICATION_CI_INVENTORY');
      for(const name of names){const found=ci.workflow_runs.filter(r=>r.name===name && r.head_sha===expectedMain && r.run_attempt===1);
        must(found.length===1 && found[0].status==='completed' && found[0].conclusion==='success','DNS_PUBLICATION_SOURCE_CI_NOT_PASSED');checked.push(String(found[0].id));}
      const proof=await readLayout('old',expectedMain,context.release.reusable.commit);await record('preflight-installed',proof);
      return {main:proof.main,roleId:proof.foundation.roleId,tableId:proof.foundation.tableId,environment:proof.environment,publication:proof.publication,
        templateMatchesOld:true,installedReusable:V.oldReusable,metadataSha256:await sha256Hex(proof),unfinishedDeploymentRuns:0,
        completedDeploymentRunIds:runs.workflow_runs.map(r=>String(r.id)).sort(),sourceCiConfirmed:true,sourceCiRunIds:checked.sort()};
    },
    async assertLocalSource(m){
      must((await gitLocalV5(['branch','--show-current'])).trim()==='main' && (await gitLocalV5(['rev-parse','HEAD'])).trim()===m.source.commit &&
        (await gitLocalV5(['status','--porcelain'])).trim()==='','DNS_PUBLICATION_LOCAL_MAIN');
      for(const p of m.source.files)must(hash((await readFile(root+'/'+p.file,'utf8')).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'DNS_PUBLICATION_LOCAL_PIN');
      await assertDnsReleaseObjectsV5(m.release);
    },
    async consumeSlot(v){await writeFile(P.slot,JSON.stringify(v)+'\n',{flag:'wx',flush:true});},
    async publishRelease(release,guard){
      await assertDnsReleaseObjectsV5(release);must((await gitLocalV5(['remote','get-url','--push','github'])).trim()==='https://github.com/veinyyxy/TechlongSoftware.git','DNS_PUBLICATION_REMOTE_URL');
      await remoteMain(release.sourceCommit);await guard();must(counts.gitPushAttempts++===0,'DNS_PUBLICATION_PUSH_ONCE');
      await gitLocalV5(['push','github',release.caller.commit+':refs/heads/main']);
      await record('push-command-ack',{main:release.caller.commit,reusable:release.reusable.commit});await remoteMain(release.caller.commit);
      return {main:release.caller.commit,reusable:release.reusable.commit,runtime:release.runtimeCommit};
    },
    async verifyLayout(m,state,main,label){
      await remoteMain(main);const proof=await readLayout(state,main,m.release.reusable.commit),normalized=structuredClone(proof);
      normalized.main=m.source.commit;normalized.foundation.trustReusesCommit=V.oldReusable;
      must(await sha256Hex(normalized)===m.prestate.metadataSha256,'DNS_PUBLICATION_UNCHANGED_LAYOUT');await record(label,proof);return proof;
    },
    async createChangeSet(request,guard){
      await remoteMain(context.release.caller.commit);await guard();must(counts.changeSetCreateAttempts++===0,'DNS_PUBLICATION_CREATE_ONCE');const r=await send(new CreateChangeSetCommand(request));
      must(r.StackId===V.stackId && typeof r.Id==='string' &&
        /^arn:aws:cloudformation:ca-central-1:402010193138:changeSet\/dns-normalization-v5-[a-f0-9]{24}\/[a-f0-9-]{36}$/.test(r.Id) &&
        r.Id.split('/')[1]===request.ChangeSetName,'DNS_PUBLICATION_CREATE_ACK');
      const ref={changeSetId:r.Id,stackId:r.StackId};await record('changeset-create-api-ack',ref);return ref;
    },
    async waitChangeSet(ref,m,guard){
      for(let i=0;i<20;i++){
        await guard();const d=await send(new DescribeChangeSetCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId}));
        if(d.Status==='CREATE_COMPLETE'){
          const t=await send(new GetTemplateCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId,TemplateStage:'Original'}));
          return verifyDnsPublicationChangeSetV5(d,m,ref.changeSetId,JSON.parse(t.TemplateBody));
        }
        must(['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(d.Status),'DNS_PUBLICATION_CHANGESET_STOPPED');await sleep(1500);
      }throw Error('DNS_PUBLICATION_CHANGESET_PENDING_INSPECT_ONLY');
    },
    async executeChangeSet(ref,m,guard){
      const d=await send(new DescribeChangeSetCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId})),
        t=await send(new GetTemplateCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId,TemplateStage:'Original'}));
      verifyDnsPublicationChangeSetV5(d,m,ref.changeSetId,JSON.parse(t.TemplateBody));await remoteMain(m.release.caller.commit);await guard();
      must(counts.changeSetExecuteAttempts++===0,'DNS_PUBLICATION_EXECUTE_ONCE');
      await send(new ExecuteChangeSetCommand({...m.actions.foundation.execute,ChangeSetName:ref.changeSetId}));
      const ack={changeSetId:ref.changeSetId,stackId:V.stackId,disableRollback:true};await record('changeset-execute-api-ack',ack);return ack;
    },
    async waitFoundation(guard){
      for(let i=0;i<40;i++){
        await guard();const r=await send(new DescribeStacksCommand({StackName:V.stackId})),s=r.Stacks?.[0];
        must(r.Stacks?.length===1 && s.StackId===V.stackId,'DNS_PUBLICATION_STACK_ID');
        if(s.StackStatus==='UPDATE_COMPLETE')return;
        must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus),'DNS_PUBLICATION_STACK_STOPPED');await sleep(2500);
      }throw Error('DNS_PUBLICATION_STACK_PENDING_INSPECT_ONLY');
    },
    async syncLocalMain(release){
      must((await gitLocalV5(['status','--porcelain'])).trim()==='' && (await gitLocalV5(['rev-parse','HEAD'])).trim()===release.sourceCommit,'DNS_PUBLICATION_LOCAL_SYNC');
      await remoteMain(release.caller.commit);must(counts.localMainFastForwards++===0,'DNS_PUBLICATION_SYNC_ONCE');
      await gitLocalV5(['merge','--ff-only',release.caller.commit]);await record('local-main-ack',{head:release.caller.commit});
    },
    async inspect(m){
      await assertDnsReleaseObjectsV5(m.release);
      const branch=await get(repo+'/branches/main'),remote=branch.commit.sha,
        [s,t]=await Promise.all([send(new DescribeStacksCommand({StackName:V.stackId})),send(new GetTemplateCommand({StackName:V.stackId,TemplateStage:'Original'}))]);
      const current=JSON.parse(t.TemplateBody),old=dnsTrustChangeV5(capsule,m.release.reusable.commit).oldTemplate,
        state=same(current,old)?'old':same(current,JSON.parse(m.actions.foundation.create.TemplateBody))?'new':'unknown',stack=s.Stacks?.[0];
      must(s.Stacks?.length===1 && stack.StackId===V.stackId,'DNS_PUBLICATION_INSPECT_STACK');
      const localHead=(await gitLocalV5(['rev-parse','HEAD'])).trim();
      const facts={remoteMain:remote,localHead,localMainAtPublishedCaller:localHead===m.release.caller.commit,
        stackId:stack.StackId,stackStatus:stack.StackStatus,templateState:state,templateSha256:await sha256Hex(current)};
      await record('independent-partial-metadata',facts);
      if(![m.source.commit,m.release.caller.commit].includes(remote) || state==='unknown' || stack.StackStatus!=='UPDATE_COMPLETE')
        return {outcome:'DNS_PUBLICATION_PARTIAL_OR_DRIFT_METADATA_ONLY_NO_RETRY',manifestSha256:m.manifestSha256,facts,externalWrites:0,secretValueReads:0,workflowDispatched:false,retryAllowed:false};
      const proof=await this.verifyLayout(m,state,remote,'independent-layout');
      if(state!=='new' || remote!==m.release.caller.commit)
        return {outcome:'DNS_PUBLICATION_PARTIAL_OLD_TRUST_OR_MAIN_VERIFIED_NO_RETRY',manifestSha256:m.manifestSha256,facts,proof,externalWrites:0,secretValueReads:0,workflowDispatched:false,retryAllowed:false};
      const [caller,reusable]=await Promise.all([get(repo+'/contents/'+V.caller+'?ref='+m.release.caller.commit),get(repo+'/contents/'+V.reusable+'?ref='+m.release.reusable.commit)]);
      for(const [r,p]of [[caller,m.release.caller],[reusable,m.release.reusable]])must(r.encoding==='base64' &&
        hash(Buffer.from(r.content,'base64').toString('utf8').replaceAll('\r\n','\n'))===p.normalizedLfSha256,'DNS_PUBLICATION_PUBLISHED_BYTES');
      return {outcome:'DNS_VERSION_INDEPENDENTLY_VERIFIED_NO_DISPATCH',manifestSha256:m.manifestSha256,facts,proof,externalWrites:0,secretValueReads:0,workflowDispatched:false,retryAllowed:false};
    },dispose(){token=undefined;cf.destroy();metadata.dispose();},
  };
}
export async function mainDnsPublicationV5(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'DNS_PUBLICATION_ARGUMENTS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DNS_PUBLICATION_DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Publish'?['--manifest','--approved-sha']:mode==='Inspect'?['--run-directory']:[])];
  must(['Prepare','Publish','Inspect'].includes(mode) && Object.keys(a).length===keys.length && keys.every(k=>a[k]),'DNS_PUBLICATION_ARGUMENT_SET');
  assertLocalEnvironmentV5();const output=await directory(a['--output']);await mkdir(output);
  let context,m;
  if(mode==='Inspect'){
    const run=await directory(a['--run-directory'],true);m=await json(run+'/approved-manifest.json');const {manifestSha256,...body}=m,slot=await json(P.slot);
    must(await sha256Hex(body)===manifestSha256 && slot.manifestSha256===manifestSha256,'DNS_PUBLICATION_INSPECT_BINDING');context={source:m.source,history:m.history,release:m.release};
  }else{
    await absent(P.slot);context=await currentSource();
    if(mode==='Prepare')context.release=await prepareDnsReleaseObjectsV5({sourceCommit:context.source.commit,output,now:Date.now()});
    else{
      const file=path.resolve(a['--manifest']);await directory(path.dirname(file),true);must(path.basename(file)==='manifest.json','DNS_PUBLICATION_MANIFEST_PATH');
      m=await json(file);context.release=m.release;await assertDnsReleaseObjectsV5(m.release);
      must(m.source.commit===context.source.commit,'DNS_PUBLICATION_FINAL_MAIN');
    }
  }
  const capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json');context.capsule=capsule;
  const io=await createDnsPublicationIoV5(output,context);
  try{
    let result;
    if(mode==='Prepare'){
      await io.record('release',context.release);const prestate=await io.preflight(context.source.commit);
      m=await prepareDnsPublicationV5({...context,prestate,now:Date.now()});await io.record('manifest',m);
      await io.record('template',JSON.parse(m.actions.foundation.create.TemplateBody));
      result={outcome:'FRESH_DNS_PUBLICATION_EXECUTION_REVIEW_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,sourceCommit:m.source.commit,
        reusableCommit:m.release.reusable.commit,callerCommit:m.release.caller.commit,expiresAt:new Date(m.expiresAt).toISOString(),
        slotConsumed:false,remoteWrites:0,awsWrites:0,secretValueReads:0,workflowDispatches:0};
    }else if(mode==='Publish'){
      await io.record('approved-manifest',m);result=await publishDnsV5({manifest:m,approved:a['--approved-sha'],context:{...context,prestate:m.prestate},io});
      if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else{result=await io.inspect(m);await io.record('result',result);}
    if(mode==='Prepare')await io.record('result',result);console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)mainDnsPublicationV5().catch(e=>{
  console.error(JSON.stringify({outcome:'DNS_PUBLICATION_STOPPED_NO_AUTOMATIC_WRITE_RETRY',failure:safeActivationFailureV5(e)}));process.exitCode=1;
});
