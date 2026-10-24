// Bounded metadata reads; only a separately approved one-shot normal-rollback update.
import {execFileSync} from 'node:child_process';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {CloudFormationClient,UpdateStackCommand,DescribeStacksCommand} from '@aws-sdk/client-cloudformation';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {createCloud as supplyCloud} from '../platform-hosted-access-v6/cloud.mjs';
import {readMetadataJson} from './cloud.mjs';
import {W,K,P,must,same,hash,canonical,recoveredBaseline,verifyUpdated,compatibleInput,validateWindow} from './compatible.mjs';
const hosts={cloudformation:'cloudformation.ca-central-1.amazonaws.com',ecs:'ecs.ca-central-1.amazonaws.com',elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',
  ec2:'ec2.ca-central-1.amazonaws.com',logs:'logs.ca-central-1.amazonaws.com',route53:'route53.amazonaws.com',iam:'iam.amazonaws.com'};
const allowed={cloudformation:['describe-stacks','get-template','list-stack-resources','get-stack-policy','list-change-sets','describe-stack-events'],
  ecs:['describe-services','describe-task-definition','list-tasks','describe-tasks','list-task-definitions'],elbv2:['describe-load-balancers','describe-listeners','describe-target-health'],
  ec2:['describe-security-groups'],logs:['describe-log-groups'],route53:['list-resource-record-sets'],iam:['simulate-principal-policy']};
const SOURCE='arn:aws:iam::402010193138:user/techlong-sandbox-dev';
export async function compatibleCloud({recovery,manifest,approved}){
  const provider=fromLoginCredentials({profile:P.profile,ignoreCache:true});
  const session=async()=>{const c=await provider();must(c.expiration instanceof Date&&c.expiration.getTime()>Date.now()+120000,'SOURCE_SESSION');};await session();
  const sdk={region:P.region,credentials:provider,maxAttempts:1,ignoreConfiguredEndpointUrls:true,requestHandler:new NodeHttpHandler({
    httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})};
  const cfn=new CloudFormationClient({...sdk,endpoint:'https://'+hosts.cloudformation}),sts=new STSClient({...sdk,endpoint:'https://sts.ca-central-1.amazonaws.com'}),supply=supplyCloud();
  const counts={metadata:0,writes:0};let verified=false,deadline=0;
  const tick=()=>must(++counts.metadata+supply.counts.metadata<=300,'METADATA_BUDGET');
  const cli=(service,op,args=[])=>{must(allowed[service]?.includes(op),'READ_OPERATION');tick();return readMetadataJson(service,op,()=>execFileSync('aws.exe',
    [service,op,...args,'--profile',P.profile,'--region',['iam','route53'].includes(service)?'us-east-1':P.region,
      '--endpoint-url','https://'+hosts[service],'--output','json','--no-cli-pager','--no-paginate'],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:3000000,stdio:['ignore','pipe','pipe'],
      env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));};
  async function source(){if(verified)return;tick();const s=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(s.Account===P.account&&s.Arn===SOURCE&&s.UserId==='AIDAV3GNMXTZEO7SHLC2X','SOURCE_IDENTITY');verified=true;}
  async function read(){await source();const v={};
    v.stack=cli('cloudformation','describe-stacks',['--stack-name',K.stackId]);v.resources=cli('cloudformation','list-stack-resources',['--stack-name',K.stackId]);
    const ids=Object.fromEntries((v.resources.StackResourceSummaries??[]).map(r=>[r.LogicalResourceId,r.PhysicalResourceId]));
    must(v.stack.Stacks?.length===1&&v.stack.Stacks[0].StackId===K.stackId&&ids.LoadBalancer===recovery.verified.ids.LoadBalancer&&
      ids.TargetGroup===recovery.verified.ids.TargetGroup&&typeof ids.TaskDefinition==='string','EXACT_TARGETS');
    v.template=cli('cloudformation','get-template',['--stack-name',K.stackId,'--template-stage','Original']);
    v.events=cli('cloudformation','describe-stack-events',['--stack-name',K.stackId]);
    v.lb=cli('elbv2','describe-load-balancers',['--load-balancer-arns',ids.LoadBalancer]);v.listeners=cli('elbv2','describe-listeners',['--load-balancer-arn',ids.LoadBalancer]);
    v.service=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);v.definition=cli('ecs','describe-task-definition',['--task-definition',ids.TaskDefinition]);
    v.running=cli('ecs','list-tasks',['--cluster',P.cluster,'--service-name',P.service,'--desired-status','RUNNING']);
    must(!v.running.nextToken&&v.running.taskArns?.length===1,'RUNNING_COUNT');v.tasks=cli('ecs','describe-tasks',['--cluster',P.cluster,'--tasks',v.running.taskArns[0]]);
    v.targets=cli('elbv2','describe-target-health',['--target-group-arn',ids.TargetGroup]);v.groups=cli('ec2','describe-security-groups',['--group-ids',ids.TaskSecurityGroup,ids.AlbSecurityGroup]);
    v.logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);
    v.dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);v.supply=await supply.snapshot();
    const p=cli('cloudformation','get-stack-policy',['--stack-name',K.stackId]),c=cli('cloudformation','list-change-sets',['--stack-name',K.stackId]);
    must(!c.NextToken,'CHANGE_SET_PAGE');const definitions={};
    for(const status of ['ACTIVE','INACTIVE','DELETE_IN_PROGRESS']){const r=cli('ecs','list-task-definitions',['--family-prefix',P.family,'--status',status,'--max-results','100']);
      must(!r.nextToken,'DEFINITION_PAGE');definitions[status]=r.taskDefinitionArns??[];}
    return {rawMetadata:v,extra:{stackId:K.stackId,stackPolicy:p.StackPolicyBody?JSON.parse(p.StackPolicyBody):null,changeSets:c.Summaries??[],definitions},
      metadataCalls:counts.metadata+supply.counts.metadata};
  }
  return {counts,read,
    async snapshot(){const checkedAt=Date.now(),v=await read(),permissions=[];
      for(const action of ['cloudformation:UpdateStack','cloudformation:SetStackPolicy']){const r=cli('iam','simulate-principal-policy',[
        '--policy-source-arn',SOURCE,'--action-names',action,'--resource-arns',K.stackId,'--context-entries',
        JSON.stringify([{ContextKeyName:'aws:RequestedRegion',ContextKeyValues:[P.region],ContextKeyType:'string'}])]);const e=r.EvaluationResults?.[0];
        must(!r.IsTruncated&&!r.Marker&&r.EvaluationResults?.length===1&&e.EvalActionName===action&&e.EvalResourceName===K.stackId&&
          e.EvalDecision==='allowed'&&(e.MissingContextValues??[]).length===0,'PERMISSION');permissions.push({action,decision:'allowed'});}
      must(Date.now()-checkedAt<120000,'SNAPSHOT_STALE');return {...v,metadataCalls:counts.metadata+supply.counts.metadata,checkedAt,permissions,
        baseline:recoveredBaseline(v.rawMetadata,v.extra,recovery)};},
    async stack(){await source();tick();const r=await cfn.send(new DescribeStacksCommand({StackName:K.stackId}),{abortSignal:AbortSignal.timeout(30000)});
      must(r.Stacks?.length===1&&r.Stacks[0].StackId===K.stackId,'STACK_ID');return {StackId:K.stackId,StackStatus:r.Stacks[0].StackStatus};},
    enableWrite(until){must(deadline===0&&until>Date.now()&&until-Date.now()<=W.runMs,'WRITE_WINDOW');deadline=until;},
    async update(request){must(manifest&&approved&&deadline>Date.now(),'WRITE_NOT_AVAILABLE');validateWindow(manifest,approved,Date.now());
      const at=JSON.parse(request.Parameters.find(p=>p.ParameterKey==='ControllerLease').ParameterValue).issuedAt;
      must(verified&&counts.writes===0&&Date.now()>=at&&Date.now()-at<30000&&same(request,compatibleInput(manifest,at))&&
        request.DisableRollback===false,'EXACT_UPDATE');await session();validateWindow(manifest,approved,Date.now());
      must(deadline>Date.now()&&Date.now()>=at&&Date.now()-at<30000,'UPDATE_WINDOW');counts.writes++;
      const r=await cfn.send(new UpdateStackCommand(request),{abortSignal:AbortSignal.timeout(30000)});
      return {StackId:r.StackId,OperationId:r.OperationId??null,requestSha256:hash(canonical(request)),sdkAttempts:r.$metadata?.attempts??null};},
    async observe(intent){const v=await read(),proof=verifyUpdated(v.rawMetadata,v.extra,intent.controlLease,manifest.baseline.ids,
      manifest.sourceCommit,intent.request.ClientRequestToken,intent.intentAt);return {...v,proof};},
    close(){cfn.destroy();sts.destroy();supply.close();},
  };
}
