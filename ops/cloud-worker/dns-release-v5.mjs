// PREPARATION ONLY. No workflow publish, IAM/CFN write, Secret read or dispatch path.
import {readFile,mkdir,realpath,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {computeCloudClosureV5} from './closure-v5.mjs';
import {ROOT_CLOSURE_V5} from './activation/runtime-v5.mjs';
import {renderPinnedJobV5,renderPinnedCallerV5,activationTemplateV5} from './activation/release-v5.mjs';
import {gitLocalV5} from './activation/commit-objects-v5.mjs';
import {createActivationIoV5} from './activation/local-io-v5.mjs';
import {assertLocalEnvironmentV5,writePublicOnceV5} from './install/local-io-v5.mjs';
import {requireActivationV5,safeActivationFailureV5} from './activation/errors-v5.mjs';
const root='E:/NodejsProject/TechlongSoftware',base='F:/ChatGPT_workshop',must=(v,c)=>requireActivationV5(v,'DNS_RELEASE_'+c);
const hash=v=>createHash('sha256').update(v).digest('hex'),same=(a,b)=>canonicalJson(a)===canonicalJson(b),json=async f=>JSON.parse(await readFile(f,'utf8'));
export const DNS_RELEASE_V5=Object.freeze({
  oldMain:'1c45f9e4d8f2dad6d4a655e0dd8fc9b194eaf4ab',oldRuntime:'ac75c4bcbb856babc67d88b6e06212e981a25d90',
  oldReusable:'7c02d9db3a39fc2f926848a593eb804b642bd1e5',oldClosure:'110f06bcfe0037ffc1bc0e1d4679a6796080564abde42818074807e516b7bb84',
  caller:'.github/workflows/cloud-worker-execute.yml',reusable:'.github/workflows/cloud-worker-job.yml',
  roleName:'TechlongSandboxGitHubDeploymentWorkerRole',roleId:'AROAV3GNMXTZK5O45RG24',
  stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5',
  riskFile:'docs/aws-auto-deployment-cloud-worker-w5j-dns-fix.md',
  proposedSlot:base+'/techlong-cloud-worker-v5-dns-normalization-release-v1.permanent-slot.json',
});
const V=DNS_RELEASE_V5,reviewedExceptions=['ops/cloud-worker/aws-initialized-workload-v5.mjs','ops/cloud-worker/activation/runtime-v5.mjs',
  'tests/cloud-worker-installer-v5.test.mjs'];
export function dnsTrustChangeV5(capsule,newReusable){
  must(/^[a-f0-9]{40}$/.test(newReusable)&&newReusable!==V.oldReusable,'NEW_REUSABLE');
  const oldTemplate=activationTemplateV5(capsule,V.oldReusable),template=activationTemplateV5(capsule,newReusable),copy=structuredClone(template);
  const key='token.actions.githubusercontent.com:job_workflow_ref',oldValue=oldTemplate.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[key],
    newValue=template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[key];
  copy.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[key]=oldValue;
  must(same(copy,oldTemplate),'TRUST_ONLY_DIFF');
  return {oldTemplate,template,onlyChange:{resource:'WorkerRole',property:'AssumeRolePolicyDocument.Statement[0].Condition.StringEquals',key,oldValue,newValue}};
}
export async function dnsReleasePlanV5({source,history,release,prestate,capsule,now}){
  must(source.commit===release.sourceCommit && source.commit===release.runtimeCommit && /^[a-f0-9]{40}$/.test(source.commit) &&
    release.reusable.parent===source.commit && release.caller.parent===release.reusable.commit &&
    prestate.main===source.commit && prestate.roleId===V.roleId && prestate.templateMatchesOld===true &&
    source.runtimeClosureSha256===ROOT_CLOSURE_V5 && ROOT_CLOSURE_V5!==V.oldClosure,'SOURCE_AND_PRESTATE');
  const change=dnsTrustChangeV5(capsule,release.reusable.commit),templateText=canonicalJson(change.template);
  must(Buffer.byteLength(templateText)<=51200,'INLINE_TEMPLATE_SIZE');
  const create={StackName:V.stackId,ChangeSetName:'dns-normalization-v5-'+release.caller.commit.slice(0,24),ChangeSetType:'UPDATE',
    TemplateBody:templateText,Capabilities:['CAPABILITY_NAMED_IAM'],Description:'DNS normalization only; exact reusable '+release.reusable.commit};
  create.ClientToken='dns-normalization-v5-'+(await sha256Hex(create)).slice(0,40);
  const body={schema:'techlong/cloud-worker-dns-fix-publication-plan/v5',preparedAt:now,expiresAt:now+7200000,source,history,prestate,release,
    actions:{publish:{remote:'github',refspec:release.caller.commit+':refs/heads/main',force:false,onlyFiles:[V.caller,V.reusable]},
      foundation:{create,templateSha256:await sha256Hex(change.template),onlyChange:change.onlyChange,
        expectedChangeSet:{action:'Modify',logicalId:'WorkerRole',type:'AWS::IAM::Role',physicalId:V.roleName,replacement:false,property:'AssumeRolePolicyDocument'},
        execute:{StackName:V.stackId,ChangeSetName:'ONLY_EXACT_ARN_RETURNED_BY_THIS_CREATE_ACK',DisableRollback:true},
        exactTemplateAndTrustOnlyChangeMustBeIndependentlyVerifiedBeforeExecute:true}},
    proposedPermanentSlot:V.proposedSlot,riskFile:V.riskFile,preparationOnly:true,executionAuthorized:false,executableEntryAvailable:false,
    proposedEffects:{preparedMainFastForward:1,foundationChangeSetCreate:1,foundationChangeSetExecute:1,existingRoleTrustReplacement:1,
      permissionExpansion:0,newIamResources:0,environmentWrites:0,s3Writes:0,secretValueReads:0,neonWrites:0,workflowDispatches:0,jobClaims:0,workloadCreates:0},
    risks:{nonAtomic:true,branchUnprotected:true,temporaryOidcDenialBetweenPublishAndTrustUpdate:true,disableFailureRollback:true,
      oldCAndRRetained:true,automaticRetry:false,automaticCompensation:false,guaranteedCleanup:false,hardMonthlyCap:false},
    actualEffects:{remoteWrites:0,awsWrites:0,slotConsumption:0,secretValueReads:0,workflowDispatches:0}};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function prepareDnsReleaseObjectsV5({sourceCommit,output,now}){
  const index=path.join(output,'release.index'),env={GIT_INDEX_FILE:index,GIT_AUTHOR_DATE:new Date(now).toISOString(),GIT_COMMITTER_DATE:new Date(now).toISOString()};
  await gitLocalV5(['read-tree',sourceCommit],{env});
  const make=async(file,text,parent,message)=>{
    const blob=(await gitLocalV5(['hash-object','-w','--stdin'],{input:text})).trim();
    must(/^[a-f0-9]{40}$/.test(blob),'BLOB');await gitLocalV5(['update-index','--add','--cacheinfo','100644,'+blob+','+file],{env});
    const tree=(await gitLocalV5(['write-tree'],{env})).trim(),commit=(await gitLocalV5(['commit-tree',tree,'-p',parent],{env,input:message+'\n'})).trim();
    must(/^[a-f0-9]{40}$/.test(commit),'COMMIT');return {commit,tree,parent,file,normalizedLfSha256:hash(text)};
  };
  const reusable=await make(V.reusable,renderPinnedJobV5(sourceCommit),sourceCommit,'fix(deployment): pin DNS-normalized cloud runtime'),
    caller=await make(V.caller,renderPinnedCallerV5(reusable.commit),reusable.commit,'fix(deployment): pin DNS-normalized reusable worker');
  const release={sourceCommit,runtimeCommit:sourceCommit,reusable,caller,branchesCreated:0,refsChanged:0,remoteWrites:0};
  await assertDnsReleaseObjectsV5(release);return release;
}
export async function assertDnsReleaseObjectsV5(r){
  must(r.sourceCommit===r.runtimeCommit && r.reusable.parent===r.sourceCommit && r.caller.parent===r.reusable.commit &&
    r.branchesCreated===0 && r.refsChanged===0 && r.remoteWrites===0,'RELEASE_CHAIN');
  for(const [p,text] of [[r.reusable,renderPinnedJobV5(r.runtimeCommit)],[r.caller,renderPinnedCallerV5(r.reusable.commit)]])
    must(p.normalizedLfSha256===hash(text) && (await gitLocalV5(['show',p.commit+':'+p.file])).replaceAll('\r\n','\n')===text &&
      (await gitLocalV5(['rev-parse',p.commit+'^'])).trim()===p.parent && (await gitLocalV5(['rev-parse',p.commit+'^{tree}'])).trim()===p.tree,'EXACT_PREPARED_OBJECT');
  must((await gitLocalV5(['diff','--name-only',r.sourceCommit,r.caller.commit])).trim().split(/\r?\n/).sort().join(',')===[V.caller,V.reusable].sort().join(','),'ONLY_TWO_WORKFLOWS');
}
async function sourceAndHistory(){
  must((await gitLocalV5(['branch','--show-current'])).trim()==='main' && (await gitLocalV5(['status','--porcelain'])).trim()==='','CLEAN_MAIN');
  const commit=(await gitLocalV5(['rev-parse','HEAD'])).trim(),oldRaw=await readFile(base+'/techlong-w5i-recovery-review-20261018-a/manifest.json');
  must(hash(oldRaw)==='d6e543dfda0533b0cfc9650192b73a605bfe4f5ddff40dd0e3969a54ec1bfab3','OLD_APPROVAL_ORIGINAL');
  const old=JSON.parse(oldRaw),changed=[],historical=old.source.files;
  must(old.source.commit===V.oldMain,'OLD_MAIN');
  // The old 124-file observation is historical, not silently rewritten to the new runtime.
  for(let i=0;i<historical.length;i+=8)await Promise.all(historical.slice(i,i+8).map(async p=>{
    must(hash((await gitLocalV5(['show',V.oldMain+':'+p.file])).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'HISTORICAL_GIT_PIN');
    if(hash((await readFile(root+'/'+p.file,'utf8')).replaceAll('\r\n','\n'))!==p.normalizedLfSha256)changed.push(p.file);
  }));
  must(same(changed.sort(),[...reviewedExceptions].sort()),'ONLY_REVIEWED_SOURCE_EXCEPTIONS');
  const evidence=[
    ['techlong-w5i-cloud-review-failed-independent-20261018-a.json','59d98dfb68bdbb0ddb56f50a328f7760ea638d35eb9df76bbb397740e91d6466'],
    ['techlong-w5i-fixed-metadata-diagnosis-20261018-a.json','0e5412f2555c6b2e94f400c31e4112d588b0946daf8651c1970f1bc61819924a'],
    ['techlong-w5i-global-read-audit-20261018-a.json','ee31f5ce41e4fe70828afc66457b5e94705a4fc46e4f58dea30449165c662032'],
    ['techlong-cloud-worker-v5-job_ecbf09030d3da7286ea3ef93-review-v1.permanent-slot.json','18fd99eafda7b5a2394869f4df8833bea219dc44815bf32861db813105db35c4'],
    ['techlong-cloud-worker-v5-job_ecbf09030d3da7286ea3ef93-review-v2.permanent-slot.json','ca8504833e2a78aed173c8fbab595bb2d37dbaf66daa6752dde1390440682125'],
  ].map(([file,rawSha256])=>({path:base+'/'+file,rawSha256}));
  for(const e of evidence)must(hash(await readFile(e.path))===e.rawSha256,'FAILURE_OR_SLOT_ORIGINAL');
  const closure=await computeCloudClosureV5();must(closure.closureSha256===ROOT_CLOSURE_V5 && closure.pinCount===76,'NEW_CLOSURE');
  const names=new Set([...historical.map(p=>p.file),...closure.pins.map(p=>p.file),'ops/cloud-worker/dns-release-v5.mjs',
    'tests/cloud-worker-dns-normalization-v5.test.mjs','tests/cloud-worker-dns-release-v5.test.mjs',V.riskFile,
    'ops/aws-sandbox/reviews/cloud-worker-w5j-dns-fix.prepared.json']);
  const files=await Promise.all([...names].sort().map(async file=>({file,normalizedLfSha256:hash((await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
  return {source:{commit,node:process.version,runtimeClosureSha256:closure.closureSha256,files},
    history:{oldMain:V.oldMain,oldRuntime:V.oldRuntime,oldReusable:V.oldReusable,oldClosureSha256:V.oldClosure,
      historicalGitPinsVerified:historical.length,currentOldPinsUnchanged:historical.length-changed.length,explicitChangedSourceFiles:changed,
      failedRunId:'39132584005',failedRunHadNoManifest:true,evidenceFiles:evidence,userAuthorizedLocalFixAndEndOfFailedMainFreeze:true},old};
}
export async function mainDnsReleaseV5(args=process.argv.slice(2)){
  must(args.length===4 && args[0]==='--mode' && args[1]==='Prepare' && args[2]==='--output','PREPARE_ONLY_ARGUMENTS');
  assertLocalEnvironmentV5();const output=path.resolve(args[3]);
  must(path.dirname(output).toLowerCase()===path.resolve(base).toLowerCase() && /^techlong-w5j-dns-release-[a-z0-9-]+$/.test(path.basename(output)) &&
    (await realpath(base)).toLowerCase()===path.resolve(base).toLowerCase(),'OUTPUT');
  await mkdir(output);try{await access(V.proposedSlot);must(false,'PROPOSED_SLOT_ALREADY_USED');}catch(e){if(e.code!=='ENOENT')throw e;}
  const {source,history}=await sourceAndHistory(),release=await prepareDnsReleaseObjectsV5({sourceCommit:source.commit,output,now:Date.now()});
  await writePublicOnceV5(output,'release',release);
  const capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json'),binding=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json'),
    old=await json(base+'/techlong-w5f-review-20261017-a/manifest.json'),view=structuredClone(old),
    publication=await json(root+'/ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json');
  view.actions.release.caller.commit=source.commit;
  const io=createActivationIoV5({output,capsule,binding});
  try{
    const proof=await io.inspectActivated(view,{key:publication.publication.key,versionId:publication.publication.versionId,
      sha256:publication.publication.wholeDocumentSha256,installationSha256:binding.installationSha256});
    await writePublicOnceV5(output,'installed-metadata',proof);
    const prestate={main:proof.main,roleId:proof.foundation.roleId,tableId:proof.foundation.tableId,environment:proof.environment,
      publication:proof.publication,templateMatchesOld:true,installedReusable:V.oldReusable};
    const m=await dnsReleasePlanV5({source,history,release,prestate,capsule,now:Date.now()});
    await writePublicOnceV5(output,'template',JSON.parse(m.actions.foundation.create.TemplateBody));await writePublicOnceV5(output,'manifest',m);
    must((await gitLocalV5(['rev-parse','HEAD'])).trim()===source.commit && (await gitLocalV5(['status','--porcelain'])).trim()==='','MAIN_NOT_MOVED');
    const result={outcome:'DNS_FIX_RELEASE_MATERIAL_PREPARED_NOT_EXECUTABLE',manifestSha256:m.manifestSha256,runtimeCommit:source.commit,
      rootClosureSha256:ROOT_CLOSURE_V5,reusableCommit:release.reusable.commit,callerCommit:release.caller.commit,
      expiresAt:new Date(m.expiresAt).toISOString(),executableEntryAvailable:false,remoteWrites:0,awsWrites:0,slotConsumption:0,secretValueReads:0,workflowDispatches:0};
    await writePublicOnceV5(output,'result',result);console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)mainDnsReleaseV5().catch(e=>{
  console.error(JSON.stringify({outcome:'DNS_RELEASE_PREPARATION_STOPPED_NO_WRITE_RETRY',failure:safeActivationFailureV5(e)}));process.exitCode=1;
});
