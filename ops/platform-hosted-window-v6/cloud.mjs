// Bounded metadata reads and exactly one reviewed UpdateStack, never Secret values.
import {execFileSync} from 'node:child_process';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {CloudFormationClient,UpdateStackCommand,DescribeStacksCommand} from '@aws-sdk/client-cloudformation';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {createCloud as supplyCloud} from '../platform-hosted-access-v6/cloud.mjs';
import {K,P,must,same,hash,baseline,verifyWindowMetadata,assertExtra,updateInput,canonical} from './contract.mjs';
const hosts={cloudformation:'cloudformation.ca-central-1.amazonaws.com',ecs:'ecs.ca-central-1.amazonaws.com',elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',
  ec2:'ec2.ca-central-1.amazonaws.com',logs:'logs.ca-central-1.amazonaws.com',route53:'route53.amazonaws.com'};
const allowed={cloudformation:['describe-stacks','get-template','list-stack-resources','get-stack-policy','list-change-sets'],
  ecs:['describe-services','describe-task-definition','list-tasks','describe-tasks','list-task-definitions'],
  elbv2:['describe-load-balancers','describe-listeners','describe-target-health'],ec2:['describe-security-groups'],logs:['describe-log-groups'],route53:['list-resource-record-sets']};
export function readMetadataJson(service,op,execute){
  try{
    const text=execute();must(typeof text==='string','METADATA_OUTPUT');
    const stackPolicy=service==='cloudformation'&&op==='get-stack-policy';
    // AWS CLI emits no JSON for a successful empty GetStackPolicy response.
    // Never infer absence from a command failure or another operation's output.
    if(stackPolicy&&text.trim()==='')return {};
    const value=JSON.parse(text);
    if(stackPolicy){
      must(value!==null&&typeof value==='object'&&!Array.isArray(value)&&
        Object.keys(value).every(k=>k==='StackPolicyBody'),'STACK_POLICY_RESPONSE');
      if(Object.hasOwn(value,'StackPolicyBody'))must(typeof value.StackPolicyBody==='string'&&
        value.StackPolicyBody.trim()!==''&&JSON.parse(value.StackPolicyBody)!==null,'STACK_POLICY_BODY');
    }
    return value;
  }catch{throw Error('HOSTED_WINDOW_METADATA_UNAVAILABLE');}
}
export async function cloud(m){
  const credentials=await fromLoginCredentials({profile:P.profile,ignoreCache:true})();
  must(credentials.expiration instanceof Date&&credentials.expiration.getTime()>Date.now()+120000,'SOURCE_SESSION');
  const sdk={region:P.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true,requestHandler:new NodeHttpHandler({
    httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})};
  const cfn=new CloudFormationClient({...sdk,endpoint:'https://'+hosts.cloudformation}),sts=new STSClient({...sdk,endpoint:'https://sts.ca-central-1.amazonaws.com'}),supply=supplyCloud();
  const counts={metadata:0,writes:0};let deadline=0,verified=false;
  const tick=()=>{must(++counts.metadata+supply.counts.metadata<=300,'METADATA_BUDGET');};
  const cli=(service,op,args=[])=>{must(allowed[service]?.includes(op),'READ_OPERATION');tick();
    return readMetadataJson(service,op,()=>execFileSync('aws.exe',[service,op,...args,'--profile',P.profile,'--region',service==='route53'?'us-east-1':P.region,
      '--endpoint-url','https://'+hosts[service],'--output','json','--no-cli-pager','--no-paginate'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:3000000,
      stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));
  };
  async function source(){if(verified)return;tick();const v=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(v.Account===P.account&&v.Arn==='arn:aws:iam::402010193138:user/techlong-sandbox-dev'&&v.UserId==='AIDAV3GNMXTZEO7SHLC2X','SOURCE_IDENTITY');verified=true;}
  async function raw(){await source();const v={};
    v.stack=cli('cloudformation','describe-stacks',['--stack-name',K.stackId]);
    v.resources=cli('cloudformation','list-stack-resources',['--stack-name',K.stackId]);v.template=cli('cloudformation','get-template',['--stack-name',K.stackId,'--template-stage','Original']);
    const ids=Object.fromEntries((v.resources.StackResourceSummaries??[]).map(r=>[r.LogicalResourceId,r.PhysicalResourceId]));
    must(v.stack.Stacks?.[0]?.StackId===K.stackId&&ids.LoadBalancer&&ids.TaskDefinition,'EXACT_READ_TARGET');
    v.lb=cli('elbv2','describe-load-balancers',['--load-balancer-arns',ids.LoadBalancer]);v.listeners=cli('elbv2','describe-listeners',['--load-balancer-arn',ids.LoadBalancer]);
    v.service=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);v.definition=cli('ecs','describe-task-definition',['--task-definition',ids.TaskDefinition]);
    v.running=cli('ecs','list-tasks',['--cluster',P.cluster,'--service-name',P.service,'--desired-status','RUNNING']);
    must(!v.running.nextToken&&v.running.taskArns?.length===1,'RUNNING_COUNT');v.tasks=cli('ecs','describe-tasks',['--cluster',P.cluster,'--tasks',v.running.taskArns[0]]);
    v.targets=cli('elbv2','describe-target-health',['--target-group-arn',ids.TargetGroup]);v.groups=cli('ec2','describe-security-groups',['--group-ids',ids.TaskSecurityGroup,ids.AlbSecurityGroup]);
    v.logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);v.dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);
    v.supply=await supply.snapshot();return v;
  }
  async function extras(){const p=cli('cloudformation','get-stack-policy',['--stack-name',K.stackId]),c=cli('cloudformation','list-change-sets',['--stack-name',K.stackId]);
    must(!c.NextToken,'CHANGE_SET_PAGE');const definitions={};
    for(const status of ['ACTIVE','INACTIVE','DELETE_IN_PROGRESS']){const d=cli('ecs','list-task-definitions',['--family-prefix',P.family,'--status',status,'--max-results','100']);
      must(!d.nextToken,'DEFINITION_PAGE');definitions[status]=d.taskDefinitionArns??[];}
    return {stackId:K.stackId,stackPolicy:p.StackPolicyBody?JSON.parse(p.StackPolicyBody):null,changeSets:c.Summaries??[],definitions};}
  return {counts,
    async snapshot(){const at=Date.now(),v=await raw(),e=await extras();return {checkedAt:at,baseline:baseline(v,e),rawMetadata:v,extra:e};},
    async observe(l,ids){const v=await raw(),e=await extras(),proof=verifyWindowMetadata(v,l,ids,true,m.sourceCommit);
      const nextIds=Object.fromEntries(proof.resources.map(r=>[r.id,r.physicalId]));assertExtra(e,nextIds,true);
      return {...proof,extra:e,rawMetadata:v,metadataCalls:counts.metadata+supply.counts.metadata};},
    async stack(){await source();tick();const r=await cfn.send(new DescribeStacksCommand({StackName:K.stackId}),{abortSignal:AbortSignal.timeout(30000)});
      must(r.Stacks?.length===1,'STACK_COUNT');return {StackId:r.Stacks[0].StackId,StackStatus:r.Stacks[0].StackStatus};},
    enableWrite(until){must(deadline===0&&until>Date.now()&&until-Date.now()<=K.runMs,'WRITE_WINDOW');deadline=until;},
    async update(request){must(verified&&counts.writes===0&&Date.now()<deadline&&credentials.expiration.getTime()>Date.now()+30000,'UPDATE_WINDOW');
      const at=JSON.parse(request.Parameters.find(p=>p.ParameterKey==='ControllerLease').ParameterValue).issuedAt;
      must(Date.now()>=at&&Date.now()-at<30000&&same(request,updateInput(m,at)),'EXACT_UPDATE_INPUT');counts.writes++;
      const ack=await cfn.send(new UpdateStackCommand(request),{abortSignal:AbortSignal.timeout(30000)});
      return {StackId:ack.StackId,OperationId:ack.OperationId??null,requestSha256:hash(canonical(request)),sdkAttempts:ack.$metadata?.attempts??null};},
    close(){cfn.destroy();sts.destroy();supply.close();},
  };
}
