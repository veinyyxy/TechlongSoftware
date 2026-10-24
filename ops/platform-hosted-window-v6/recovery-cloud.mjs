// Metadata and a separately approved single RollbackStack; no update/deploy API.
import {execFileSync} from 'node:child_process';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {CloudFormationClient,RollbackStackCommand,DescribeStacksCommand} from '@aws-sdk/client-cloudformation';
import {M,K,P,must,same,validate,hash,canonical} from './recovery.mjs';
import {readMetadataJson} from './cloud.mjs';
const hosts={cloudformation:'cloudformation.ca-central-1.amazonaws.com',ecs:'ecs.ca-central-1.amazonaws.com',
  elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',iam:'iam.amazonaws.com'};
const allowed={cloudformation:['describe-stacks','list-stack-resources','get-template','get-stack-policy','list-change-sets','describe-stack-events'],
  ecs:['describe-services','describe-task-definition','list-tasks','describe-tasks','list-task-definitions'],elbv2:['describe-target-health'],iam:['simulate-principal-policy']};
const SOURCE='arn:aws:iam::402010193138:user/techlong-sandbox-dev';
export async function recoveryCloud({manifest,approved}={}){
  const provider=fromLoginCredentials({profile:P.profile,ignoreCache:true});
  const session=async()=>{const c=await provider();must(c.expiration instanceof Date&&c.expiration.getTime()>Date.now()+120000,'SOURCE_SESSION');return c;};
  await session();
  const cfg={region:P.region,credentials:provider,maxAttempts:1,ignoreConfiguredEndpointUrls:true,
    requestHandler:new NodeHttpHandler({httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})};
  const sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'}),
    cfn=new CloudFormationClient({...cfg,endpoint:'https://'+hosts.cloudformation});
  const counts={metadata:0,writes:0};let verified=false;
  const tick=()=>must(++counts.metadata<=160,'METADATA_BUDGET');
  const cli=(service,op,args=[])=>{must(allowed[service]?.includes(op),'READ_OPERATION');tick();
    return readMetadataJson(service,op,()=>execFileSync('aws.exe',[service,op,...args,'--profile',P.profile,
      '--region',service==='iam'?'us-east-1':P.region,'--endpoint-url','https://'+hosts[service],'--output','json','--no-cli-pager','--no-paginate'],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:3000000,stdio:['ignore','pipe','pipe'],
      env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));};
  async function source(){if(verified)return;tick();const id=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(id.Account===P.account&&id.Arn===SOURCE&&id.UserId==='AIDAV3GNMXTZEO7SHLC2X','SOURCE_IDENTITY');verified=true;}
  async function snapshot(checkPermission=false){await source();const observedAt=Date.now(),raw={};
    raw.stack=cli('cloudformation','describe-stacks',['--stack-name',K.stackId]);
    must(raw.stack.Stacks?.length===1&&raw.stack.Stacks[0].StackId===K.stackId,'EXACT_STACK');
    raw.resources=cli('cloudformation','list-stack-resources',['--stack-name',K.stackId]);
    raw.template=cli('cloudformation','get-template',['--stack-name',K.stackId,'--template-stage','Original']);
    raw.policy=cli('cloudformation','get-stack-policy',['--stack-name',K.stackId]);
    raw.changeSets=cli('cloudformation','list-change-sets',['--stack-name',K.stackId]);
    const events=[];let token;
    for(let n=0;n<3;n++){
      const r=cli('cloudformation','describe-stack-events',['--stack-name',K.stackId,...(token?['--next-token',token]:[])]);
      must(Array.isArray(r.StackEvents),'EVENT_RESPONSE');
      events.push(...r.StackEvents.map(e=>Object.fromEntries(['EventId','StackId','Timestamp','LogicalResourceId','PhysicalResourceId','ResourceType',
        'ResourceStatus','ResourceStatusReason','ClientRequestToken'].map(k=>[k,e[k]??null]))));
      token=r.NextToken;if(!token)break;
    }
    raw.eventHistory={events,complete:!token};
    raw.service=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);
    raw.definition=cli('ecs','describe-task-definition',['--task-definition',K.originalDefinition]);
    raw.running=cli('ecs','list-tasks',['--cluster',P.cluster,'--service-name',P.service,'--desired-status','RUNNING']);
    must(!raw.running.nextToken&&raw.running.taskArns?.length===1,'RUNNING_COUNT');
    raw.tasks=cli('ecs','describe-tasks',['--cluster',P.cluster,'--tasks',raw.running.taskArns[0]]);
    raw.definitions={};for(const status of ['ACTIVE','INACTIVE','DELETE_IN_PROGRESS'])
      raw.definitions[status]=cli('ecs','list-task-definitions',['--family-prefix',P.family,'--status',status,'--max-results','100']);
    const ids=Object.fromEntries((raw.resources.StackResourceSummaries??[]).map(x=>[x.LogicalResourceId,x.PhysicalResourceId]));
    must(ids.TargetGroup==='arn:aws:elasticloadbalancing:ca-central-1:402010193138:targetgroup/techlong-platform-web-v1/b29a8b9e4f95f6dd','EXACT_TARGET');
    raw.targets=cli('elbv2','describe-target-health',['--target-group-arn',ids.TargetGroup]);
    if(checkPermission){const r=cli('iam','simulate-principal-policy',['--policy-source-arn',SOURCE,'--action-names','cloudformation:RollbackStack',
      '--resource-arns',K.stackId,'--context-entries',JSON.stringify([{ContextKeyName:'aws:RequestedRegion',ContextKeyValues:[P.region],ContextKeyType:'string'}])]);
      raw.permission={truncated:Boolean(r.IsTruncated||r.Marker),evaluations:r.EvaluationResults?.map(e=>({action:e.EvalActionName,
        resource:e.EvalResourceName,decision:e.EvalDecision,missingContext:e.MissingContextValues??[]}))};}
    must(Date.now()>=observedAt&&Date.now()-observedAt<M.freshMs,'SNAPSHOT_STALE');return {observedAt,raw,metadataCalls:counts.metadata};
  }
  return {counts,snapshot,
    async stack(){await source();tick();const r=await cfn.send(new DescribeStacksCommand({StackName:K.stackId}),{abortSignal:AbortSignal.timeout(30000)});
      must(r.Stacks?.length===1&&r.Stacks[0].StackId===K.stackId,'EXACT_STACK');return {StackId:K.stackId,StackStatus:r.Stacks[0].StackStatus};},
    async rollback(request){must(manifest&&approved,'WRITE_NOT_AVAILABLE');validate(manifest,approved,Date.now());
      must(verified&&counts.writes===0&&same(request,manifest.request),'EXACT_ROLLBACK_REQUEST');await session();counts.writes++;
      const r=await cfn.send(new RollbackStackCommand(request),{abortSignal:AbortSignal.timeout(30000)});
      return {StackId:r.StackId,OperationId:r.OperationId??null,requestSha256:hash(canonical(request)),sdkAttempts:r.$metadata?.attempts??null};},
    close(){sts.destroy();cfn.destroy();},
  };
}
