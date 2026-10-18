// Scoped local Prepare/Apply/Inspect. Apply is dormant without a fresh exact SHA.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import * as cf from '@aws-sdk/client-cloudformation';
import * as iam from '@aws-sdk/client-iam';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {ecsJobSourceContextV5,createEcsJobDispatchIoV5} from './ecs-job-dispatch-local-v5.mjs';
import {gitLocalV5} from './activation/commit-objects-v5.mjs';
import {assertLocalEnvironmentV5} from './install/local-io-v5.mjs';
import {INSTALL_CANDIDATE_V5 as C} from './install/inventory-v5.mjs';
import {requireActivationV5 as must,safeActivationFailureV5} from './activation/errors-v5.mjs';
import {TASK_DEFINITION_PERMISSION_V5 as V,taskDefinitionPermissionChangeV5,prepareTaskDefinitionPermissionV5,
  verifyTaskDefinitionPermissionChangeSetV5,assertTaskDefinitionLayoutV5,applyTaskDefinitionPermissionV5} from './task-definition-permission-v5.mjs';
const root='E:/NodejsProject/TechlongSoftware',base='F:/ChatGPT_workshop',json=async p=>JSON.parse(await readFile(p,'utf8')),
  hash=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>canonicalJson(a)===canonicalJson(b),
  decode=v=>typeof v==='string'?JSON.parse(decodeURIComponent(v)):v,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function absent(p){try{await access(p);must(false,'TASKDEF_SLOT_OR_DIRECTORY_USED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(p,existing=false){const out=path.resolve(p);must(path.dirname(out).toLowerCase()===path.resolve(base).toLowerCase()&&
  /^techlong-w5p-[a-z0-9-]+$/.test(path.basename(out))&&(await realpath(base)).toLowerCase()===path.resolve(base).toLowerCase(),'TASKDEF_DIRECTORY');
  if(existing)must((await realpath(out)).toLowerCase()===out.toLowerCase(),'TASKDEF_REALPATH');return out;}
export async function taskDefinitionPermissionSourceV5(){
  const c=await ecsJobSourceContextV5(),failurePath=base+'/techlong-w5o-failed-checkpoint-20261018-a.json',raw=await readFile(failurePath);
  must(hash(raw)==='917b7d48df2f364d0d2f60e3d29815aef0f1d3c24284b69be72b6429635eb0ab','TASKDEF_FAILURE_CHECKPOINT');
  const failure=JSON.parse(raw),check=async p=>must(p.path.startsWith(base+'/')&&!p.path.includes('..')&&hash(await readFile(p.path))===p.rawSha256,'TASKDEF_FAILURE_ORIGINAL');
  must(failure.runId==='39157727313'&&failure.successfulManifestProduced===false&&failure.reviewV4SlotPermanentlyConsumed===true&&
    failure.confirmedBlocker.operation==='ecs:DescribeTaskDefinition'&&failure.confirmedBlocker.errorCode==='AccessDenied','TASKDEF_FAILURE_STATE');
  for(const f of failure.evidenceFiles)await check(f);
  must(hash(await readFile(failure.diagnosisDocument))==='0cd3e7a586d7d3019f3e8f6501fdac2453a1e2d4e78b094d9ae1a1085dac0c99','TASKDEF_DIAGNOSIS_DOCUMENT');
  const dispatched=await json(base+'/techlong-w5o-dispatched-checkpoint-20261018-a.json');for(const f of dispatched.evidenceFiles)await check(f);
  const prior=await json(base+'/techlong-w5o-dispatch-20261018-a/approved-manifest.json'),{manifestSha256,...body}=prior;
  must(await sha256Hex(body)===failure.approvedManifestSha256&&manifestSha256===failure.approvedManifestSha256&&
    prior.source.commit===failure.frozenCallerMain&&prior.source.files.length===159,'TASKDEF_PRIOR_APPROVAL');
  const compatible=new Set(['README.md','docs/aws-auto-deployment-mainline.md','.github/workflows/cloud-worker-candidate.yml']),changed=[];
  for(let i=0;i<prior.source.files.length;i+=8)await Promise.all(prior.source.files.slice(i,i+8).map(async p=>{
    must(hash((await gitLocalV5(['show',prior.source.commit+':'+p.file])).replaceAll('\r\n','\n'))===p.normalizedLfSha256,'TASKDEF_HISTORICAL_SOURCE_PIN');
    const current=c.source.files.find(f=>f.file===p.file);must(current,'TASKDEF_SOURCE_PIN_PRESENT');
    if(current.normalizedLfSha256!==p.normalizedLfSha256){must(compatible.has(p.file),'TASKDEF_ONLY_LOCAL_PREPARATION_CHANGE');changed.push(p.file);}
  }));
  must(same(changed.sort(),[...compatible].sort()),'TASKDEF_EXPLICIT_LOCAL_PREPARATION_FILES');
  const files=new Map(c.source.files.map(p=>[p.file,p]));
  for(const file of ['ops/cloud-worker/task-definition-permission-v5.mjs','ops/cloud-worker/task-definition-permission-local-v5.mjs',
    'tests/cloud-worker-task-definition-permission-v5.test.mjs',V.riskFile,'ops/aws-sandbox/reviews/cloud-worker-w5p-task-definition-read.prepared.json'])
    files.set(file,{file,normalizedLfSha256:hash((await readFile(root+'/'+file,'utf8')).replaceAll('\r\n','\n'))});
  return {...c,source:{...c.source,files:[...files.values()].sort((a,b)=>a.file.localeCompare(b.file))},
    history:{...c.history,permissionFailureEvidenceVerified:true,failedReviewSourcePinsVerified:159,failedReviewRunId:failure.runId,
      permissionFailureCheckpointRawSha256:hash(raw),permissionDiagnosisRawSha256:'0cd3e7a586d7d3019f3e8f6501fdac2453a1e2d4e78b094d9ae1a1085dac0c99',
      explicitPermissionPreparationFiles:changed.sort(),previousReviewApprovalSha256:manifestSha256}};
}
export async function createTaskDefinitionPermissionIoV5(output,context){
  const common=await createEcsJobDispatchIoV5(output,context),capsule=context.capsule,change=taskDefinitionPermissionChangeV5(capsule),
    cfg={region:'ca-central-1',maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})},
    cfn=new cf.CloudFormationClient({...cfg,endpoint:'https://cloudformation.ca-central-1.amazonaws.com'}),
    im=new iam.IAMClient({...cfg,region:'us-east-1',endpoint:'https://iam.amazonaws.com'}),sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});
  const counts={changeSetCreateAttempts:0,changeSetExecuteAttempts:0,secretValueReads:0,workflowDispatches:0,automaticWriteRetries:0},
    send=(client,q)=>client.send(q,{abortSignal:AbortSignal.timeout(30000)}),record=common.record;
  const remoteMain=async()=>{
    must((await gitLocalV5(['remote','get-url','--push','github'])).trim()==='https://github.com/veinyyxy/TechlongSoftware.git','TASKDEF_REMOTE_URL');
    const line=(await gitLocalV5(['ls-remote','--exit-code','github','refs/heads/main'])).trim(),match=/^([a-f0-9]{40})\s+refs\/heads\/main$/.exec(line);
    must(match,'TASKDEF_REMOTE_MAIN_READ');return match[1];
  };
  const stackRead=async()=>{
    const [s,t]=await Promise.all([send(cfn,new cf.DescribeStacksCommand({StackName:V.stackId})),send(cfn,new cf.GetTemplateCommand({StackName:V.stackId,TemplateStage:'Original'}))]);
    must(s.Stacks?.length===1&&s.Stacks[0].StackId===V.stackId,'TASKDEF_EXACT_STACK');return {stack:s.Stacks[0],template:JSON.parse(t.TemplateBody)};
  };
  const readLayout=async state=>{
    const expected=state==='old'?change.oldTemplate:change.template,
      [{stack:s,template},resources,role,inline,names,attached,boundary,who,main]=await Promise.all([stackRead(),
        send(cfn,new cf.ListStackResourcesCommand({StackName:V.stackId})),send(im,new iam.GetRoleCommand({RoleName:V.roleName})),
        send(im,new iam.GetRolePolicyCommand({RoleName:V.roleName,PolicyName:'ExactSandboxWorkerV5'})),
        send(im,new iam.ListRolePoliciesCommand({RoleName:V.roleName})),send(im,new iam.ListAttachedRolePoliciesCommand({RoleName:V.roleName})),
        send(im,new iam.GetPolicyCommand({PolicyArn:C.boundary})),send(sts,new GetCallerIdentityCommand({})),remoteMain()]);
    const version=await send(im,new iam.GetPolicyVersionCommand({PolicyArn:C.boundary,VersionId:'v1'})),r=role.Role,rows=resources.StackResourceSummaries,
      policy=decode(inline.PolicyDocument),bd=decode(version.PolicyVersion.Document),trust=decode(r.AssumeRolePolicyDocument);
    must(who.Account==='402010193138'&&who.Arn==='arn:aws:iam::402010193138:user/techlong-sandbox-dev'&&who.UserId==='AIDAV3GNMXTZEO7SHLC2X'&&
      main===context.source.commit&&s.StackStatus==='UPDATE_COMPLETE'&&s.EnableTerminationProtection===true&&s.DisableRollback===true&&
      same(template,expected)&&!resources.NextToken&&rows?.length===5&&rows.every(x=>expected.Resources[x.LogicalResourceId]?.Type===x.ResourceType&&
        ['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(x.ResourceStatus)&&x.PhysicalResourceId)&&r.RoleId===V.roleId&&r.Arn==='arn:aws:iam::402010193138:role/'+V.roleName&&
      r.MaxSessionDuration===3600&&r.PermissionsBoundary?.PermissionsBoundaryArn===C.boundary&&same(trust,expected.Resources.WorkerRole.Properties.AssumeRolePolicyDocument)&&
      !names.IsTruncated&&same(names.PolicyNames,['ExactSandboxWorkerV5'])&&!attached.IsTruncated&&attached.AttachedPolicies?.length===0&&
      same(policy,expected.Resources.WorkerRole.Properties.Policies[0].PolicyDocument)&&boundary.Policy?.DefaultVersionId==='v1'&&version.PolicyVersion.IsDefaultVersion===true&&
      same(bd,expected.Resources.Boundary.Properties.PolicyDocument),'TASKDEF_EXACT_LAYOUT');
    return {state,main,sourceArn:who.Arn,sourceUserId:who.UserId,stackId:s.StackId,stackStatus:s.StackStatus,
      stackExecutionRole:s.RoleARN??null,roleId:r.RoleId,roleTagsSha256:await sha256Hex((r.Tags??[]).sort((a,b)=>a.Key.localeCompare(b.Key))),
      trustSha256:await sha256Hex(trust),boundaryPolicyId:boundary.Policy.PolicyId,boundaryDefaultVersion:'v1',boundaryDocumentSha256:await sha256Hex(bd),
      foundationResourceIdsSha256:await sha256Hex(rows.map(x=>({logical:x.LogicalResourceId,type:x.ResourceType,physical:x.PhysicalResourceId})).sort((a,b)=>a.logical.localeCompare(b.logical))),
      templateSha256:await sha256Hex(template),inlinePolicySha256:await sha256Hex(policy)};
  };
  return {record,readLayout,counts:()=>({...counts}),
    async preflight(){const p=await common.preflight('Review'),layout=await readLayout('old');await record('preflight-layout',layout);return {...p,layout};},
    async assertLocalSource(m){await common.assertLocalSource(m);must(await remoteMain()===m.source.commit,'TASKDEF_REMOTE_MAIN_DRIFT');},
    async consumeSlot(value){await writeFile(V.slot,JSON.stringify(value)+'\n',{flag:'wx',flush:true});},
    async createChangeSet(request,guard){
      await guard();must(counts.changeSetCreateAttempts++===0,'TASKDEF_CREATE_ONCE');const r=await send(cfn,new cf.CreateChangeSetCommand(request));
      must(r.StackId===V.stackId&&typeof r.Id==='string'&&/^arn:aws:cloudformation:ca-central-1:402010193138:changeSet\/taskdef-read-v5-[a-f0-9]{24}\/[a-f0-9-]{36}$/.test(r.Id)&&
        r.Id.split('/')[1]===request.ChangeSetName,'TASKDEF_EXACT_CREATE_ACK');
      const ref={changeSetId:r.Id,stackId:r.StackId};await record('changeset-create-api-ack',ref);return ref;
    },
    async waitChangeSet(ref,m,guard){
      for(let n=0;n<20;n++){
        await guard();const d=await send(cfn,new cf.DescribeChangeSetCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId}));
        if(d.Status==='CREATE_COMPLETE'){
          const t=await send(cfn,new cf.GetTemplateCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId,TemplateStage:'Original'}));
          return verifyTaskDefinitionPermissionChangeSetV5(d,m,ref.changeSetId,JSON.parse(t.TemplateBody));
        }must(['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(d.Status),'TASKDEF_CHANGESET_STOPPED');await sleep(1500);
      }throw Error('TASKDEF_CHANGESET_PENDING_INSPECT_ONLY');
    },
    async executeChangeSet(ref,m,guard){
      const d=await send(cfn,new cf.DescribeChangeSetCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId})),
        t=await send(cfn,new cf.GetTemplateCommand({StackName:V.stackId,ChangeSetName:ref.changeSetId,TemplateStage:'Original'}));
      verifyTaskDefinitionPermissionChangeSetV5(d,m,ref.changeSetId,JSON.parse(t.TemplateBody));await guard();
      must(counts.changeSetExecuteAttempts++===0,'TASKDEF_EXECUTE_ONCE');
      await send(cfn,new cf.ExecuteChangeSetCommand({...m.actions.execute,ChangeSetName:ref.changeSetId}));
      const ack={changeSetId:ref.changeSetId,stackId:V.stackId,disableRollback:true};await record('changeset-execute-api-ack',ack);return ack;
    },
    async waitFoundation(guard){
      for(let n=0;n<40;n++){
        await guard();const r=await send(cfn,new cf.DescribeStacksCommand({StackName:V.stackId})),s=r.Stacks?.[0];must(r.Stacks?.length===1&&s.StackId===V.stackId,'TASKDEF_STACK_ID');
        if(s.StackStatus==='UPDATE_COMPLETE')return;must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s.StackStatus),'TASKDEF_STACK_STOPPED');await sleep(2500);
      }throw Error('TASKDEF_STACK_PENDING_INSPECT_ONLY');
    },
    async inspect(m){
      const [{stack:s,template},main]=await Promise.all([stackRead(),remoteMain()]),state=same(template,change.oldTemplate)?'old':same(template,change.template)?'new':'unknown',
        facts={stackId:s.StackId,stackStatus:s.StackStatus,templateState:state,templateSha256:await sha256Hex(template),remoteMain:main};await record('independent-partial-metadata',facts);
      if(main!==m.source.commit||state==='unknown'||s.StackStatus!=='UPDATE_COMPLETE')return {outcome:'TASK_DEFINITION_PERMISSION_PARTIAL_OR_DRIFT_METADATA_ONLY_NO_RETRY',facts,externalWrites:0,retryAllowed:false};
      const proof=assertTaskDefinitionLayoutV5(await readLayout(state),m,state);await record('independent-layout',proof);
      return {outcome:state==='new'?'TASK_DEFINITION_READ_CORRECTION_INDEPENDENTLY_VERIFIED_NO_REVIEW':'TASK_DEFINITION_PERMISSION_OLD_LAYOUT_VERIFIED_NO_RETRY',
        manifestSha256:m.manifestSha256,facts,proof,externalWrites:0,secretValueReads:0,workflowDispatched:false,retryAllowed:false};
    },dispose(){common.dispose();cfn.destroy();im.destroy();sts.destroy();},
  };
}
export async function mainTaskDefinitionPermissionV5(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'TASKDEF_ARGUMENTS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n]),'TASKDEF_DUPLICATE_ARG');a[args[n]]=args[n+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Apply'?['--manifest','--approved-sha']:mode==='Inspect'?['--run-directory']:[])];
  must(['Prepare','Apply','Inspect'].includes(mode)&&keys.length===Object.keys(a).length&&keys.every(k=>a[k]),'TASKDEF_ARGUMENT_SET');
  assertLocalEnvironmentV5();const output=await directory(a['--output']);await mkdir(output);let context,m;
  if(mode==='Inspect'){
    const run=await directory(a['--run-directory'],true);m=await json(run+'/approved-manifest.json');const {manifestSha256,...body}=m,slot=await json(V.slot);
    must(await sha256Hex(body)===manifestSha256&&slot.manifestSha256===manifestSha256&&m.schema==='techlong/cloud-worker-task-definition-permission-review/v5','TASKDEF_INSPECT_BINDING');
    context={source:m.source,history:m.history};
  }else{
    await absent(V.slot);context=await taskDefinitionPermissionSourceV5();
    if(mode==='Apply'){
      const file=path.resolve(a['--manifest']);await directory(path.dirname(file),true);must(path.basename(file)==='manifest.json','TASKDEF_MANIFEST_PATH');m=await json(file);
      must(m.source.commit===context.source.commit,'TASKDEF_FINAL_MAIN');
    }
  }
  context.capsule=await json(root+'/ops/cloud-worker/material/public-capsule-v5.json');const io=await createTaskDefinitionPermissionIoV5(output,context);
  try{
    let result;
    if(mode==='Prepare'){
      const prestate=await io.preflight();m=await prepareTaskDefinitionPermissionV5({...context,prestate,now:Date.now()});await io.record('manifest',m);
      await io.record('template',JSON.parse(m.actions.create.TemplateBody));
      result={outcome:'TASK_DEFINITION_PERMISSION_REVIEW_PREPARED_NOT_APPLIED',manifestSha256:m.manifestSha256,main:m.source.commit,
        expiresAt:new Date(m.expiresAt).toISOString(),slotConsumed:false,awsWrites:0,secretValueReads:0,workflowDispatches:0};
    }else if(mode==='Apply'){
      await io.record('approved-manifest',m);result=await applyTaskDefinitionPermissionV5({manifest:m,approved:a['--approved-sha'],context:{...context,prestate:m.prestate},io});
      if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else result=await io.inspect(m);
    if(mode!=='Apply')await io.record('result',result);console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)mainTaskDefinitionPermissionV5().catch(e=>{
  console.error(JSON.stringify({outcome:'TASK_DEFINITION_PERMISSION_STOPPED_NO_AUTOMATIC_WRITE_RETRY',failure:safeActivationFailureV5(e)}));process.exitCode=1;
});
