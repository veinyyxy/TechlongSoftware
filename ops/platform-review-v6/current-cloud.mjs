// Fixed-resource metadata reader. No write, Secret value, S3 or private-key port.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {IAMClient} from '@aws-sdk/client-iam';
import {createCloud as supplyCloud} from '../platform-hosted-access-v6/cloud.mjs';
import {readMetadataJson} from '../platform-hosted-window-v6/cloud.mjs';
import {assertCloudIamLayoutV5} from '../cloud-worker/cloud-aws-reads-v5.mjs';
import {prepareCloudContextV5} from '../cloud-worker/cloud-context-v5.mjs';
import {K,P,H,verifyWindowMetadata,assertExtra,hash,canonical,checkIdentities} from '../platform-hosted-window-v6/contract.mjs';
import {rootEvent} from '../platform-hosted-window-v6/compatible.mjs';
const must=(ok,code)=>{if(!ok)throw Error('CURRENT_CLOUD_'+code);};
export const CURRENT_PARENT=Object.freeze({file:'F:/ChatGPT_workshop/techlong-platform-w8n-compatible-window-executed-verified-20261024-a.json',
  rawSha256:'99ceb0e288075d60c7ab39240df969dcb60d41107a8e8060d52aba2ab1842053'});
const endpoints={cloudformation:'cloudformation.ca-central-1.amazonaws.com',ecs:'ecs.ca-central-1.amazonaws.com',
  elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',ec2:'ec2.ca-central-1.amazonaws.com',logs:'logs.ca-central-1.amazonaws.com',route53:'route53.amazonaws.com'};
export const CURRENT_READS=Object.freeze({cloudformation:['describe-stacks','get-template','list-stack-resources','get-stack-policy','list-change-sets','describe-stack-events'],
  ecs:['describe-services','describe-task-definition','list-tasks','describe-tasks','list-task-definitions'],
  elbv2:['describe-load-balancers','describe-listeners','describe-target-health'],ec2:['describe-security-groups'],logs:['describe-log-groups'],route53:['list-resource-record-sets']});
export function verifyCurrentHosting({rawMetadata:raw,extra,iam},parent,now=Date.now()){
  const old=parent.verified,s=raw.stack.Stacks?.[0],root=rootEvent(raw),ids=Object.fromEntries(old.resources.map(r=>[r.id,r.physicalId]));
  must(parent.outcome==='COMPATIBLE_WINDOW_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING'&&old.stackId===K.stackId&&
    old.stackStatus==='UPDATE_COMPLETE'&&old.controlLease.expiresAt<=now&&s?.DisableRollback===false&&
    root.EventId===old.rootEventId&&root.ResourceStatus==='UPDATE_COMPLETE'&&iam?.iamLayoutUnchanged===true,'PARENT_OR_CURRENT_ROOT');
  checkIdentities(raw.resources.StackResourceSummaries,ids,false);
  const p=verifyWindowMetadata(raw,old.controlLease,undefined,true,old.executionSourceCommit);assertExtra(extra,ids,true);
  must(p.taskDefinition===ids.TaskDefinition&&p.imageDigest===H.imageDigest&&p.controlLease.expiresAt<=now,'EXPIRED_STABLE_BASELINE');
  return {stackId:K.stackId,stackStatus:s.StackStatus,rootEventId:root.EventId,ids,oldLease:old.controlLease,
    hostingExpiresAt:p.hostingExpiresAt,templateSha256:hash(canonical(typeof raw.template.TemplateBody==='string'?JSON.parse(raw.template.TemplateBody):raw.template.TemplateBody)),
    tags:s.Tags??[],stackPolicy:null,imageDigest:H.imageDigest,healthy:true,iamLayoutUnchanged:true,notNewWindow:true};
}
export async function currentCloudInventory(){
  const credentials=fromLoginCredentials({profile:P.profile,ignoreCache:true}),cfg={region:P.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true,
    requestHandler:new NodeHttpHandler({httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})};
  const sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'}),iam=new IAMClient({...cfg,region:'us-east-1',endpoint:'https://iam.amazonaws.com'});
  const supply=supplyCloud(),counts={metadata:0,writes:0,privateReads:0};let used=false;
  const tick=()=>must(++counts.metadata+supply.counts.metadata<=220,'READ_BUDGET');
  const cli=(service,op,args=[])=>{must(CURRENT_READS[service]?.includes(op),'READ_ALLOWLIST');tick();
    return readMetadataJson(service,op,()=>execFileSync('aws.exe',[service,op,...args,'--profile',P.profile,'--region',service==='route53'?'us-east-1':P.region,
      '--endpoint-url','https://'+endpoints[service],'--output','json','--no-cli-pager','--no-paginate'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:3000000,
      stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));};
  return Object.freeze({counts,async snapshot(){
    must(!used,'MEMORY_ONCE');used=true;const checkedAt=Date.now();
    const session=await credentials();must(session.expiration instanceof Date&&session.expiration.getTime()>checkedAt+120000,'SOURCE_SESSION');
    tick();const who=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(20000)});
    must(who.Account===P.account&&who.Arn===P.sourceArn&&who.UserId===P.sourceId,'SOURCE_IDENTITY');
    const v={stack:cli('cloudformation','describe-stacks',['--stack-name',K.stackId]),resources:cli('cloudformation','list-stack-resources',['--stack-name',K.stackId])};
    const ids=Object.fromEntries((v.resources.StackResourceSummaries??[]).map(r=>[r.LogicalResourceId,r.PhysicalResourceId]));
    must(v.stack.Stacks?.length===1&&v.stack.Stacks[0].StackId===K.stackId&&!v.resources.NextToken&&Object.keys(ids).length===11,'EXACT_STACK');
    v.template=cli('cloudformation','get-template',['--stack-name',K.stackId,'--template-stage','Original']);v.events=cli('cloudformation','describe-stack-events',['--stack-name',K.stackId]);
    v.lb=cli('elbv2','describe-load-balancers',['--load-balancer-arns',ids.LoadBalancer]);v.listeners=cli('elbv2','describe-listeners',['--load-balancer-arn',ids.LoadBalancer]);
    v.service=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);v.definition=cli('ecs','describe-task-definition',['--task-definition',ids.TaskDefinition]);
    v.running=cli('ecs','list-tasks',['--cluster',P.cluster,'--service-name',P.service,'--desired-status','RUNNING']);
    must(!v.running.nextToken&&v.running.taskArns?.length===1,'RUNNING_COUNT');v.tasks=cli('ecs','describe-tasks',['--cluster',P.cluster,'--tasks',v.running.taskArns[0]]);
    v.targets=cli('elbv2','describe-target-health',['--target-group-arn',ids.TargetGroup]);v.groups=cli('ec2','describe-security-groups',['--group-ids',ids.TaskSecurityGroup,ids.AlbSecurityGroup]);
    v.logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);
    v.dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);v.supply=await supply.snapshot();
    const p=cli('cloudformation','get-stack-policy',['--stack-name',K.stackId]),c=cli('cloudformation','list-change-sets',['--stack-name',K.stackId]);must(!c.NextToken,'CHANGE_SET_PAGE');
    const definitions={};for(const status of ['ACTIVE','INACTIVE','DELETE_IN_PROGRESS']){const r=cli('ecs','list-task-definitions',['--family-prefix',P.family,'--status',status,'--max-results','100']);must(!r.nextToken,'DEFINITION_PAGE');definitions[status]=r.taskDefinitionArns??[];}
    const capsule=JSON.parse(await readFile(new URL('../cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8')),context=await prepareCloudContextV5(capsule);
    const layout=await assertCloudIamLayoutV5({api:{iam},historicalPreflight:context.base.iam,send:async(client,command)=>{tick();return client.send(command,{abortSignal:AbortSignal.timeout(20000)});}});
    return {checkedAt,completedAt:Date.now(),rawMetadata:v,extra:{stackId:K.stackId,stackPolicy:p.StackPolicyBody?JSON.parse(p.StackPolicyBody):null,changeSets:c.Summaries??[],definitions},
      iam:layout,metadataCalls:counts.metadata+supply.counts.metadata,awsWrites:0,directSecretValueReads:0};
  },close(){sts.destroy();iam.destroy();supply.close();}});
}
