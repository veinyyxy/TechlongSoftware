// Read-only W8g follow-up. The approved deployment code and failed receipts stay unchanged.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {environment} from '../platform-web-database-v1/local.mjs';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {readText,writeOnce,git} from '../platform-image-source-v2/files.mjs';
import {createCloud as supplyCloud} from '../platform-hosted-access-v6/cloud.mjs';
import {sourcePins,parents,ROOT,BASE} from './local.mjs';
import {assertGroups} from '../platform-hosting-deploy-v1/cloud.mjs';
import {H,P,hash,canonical,same,must,safeCode,template,tags,lease,validate,runtime,assertSupply} from './contract.mjs';
const sort=a=>[...a].sort((x,y)=>canonical(x).localeCompare(canonical(y)));
export function normalizeDefaultArrays(definition){
  const d=structuredClone(definition),p=d?.containerDefinitions?.[0]?.linuxParameters;
  must(p&&same(Object.keys(p).sort(),['capabilities','devices','initProcessEnabled','tmpfs'])&&
    same(Object.keys(p.capabilities??{}).sort(),['add','drop'])&&same(p.capabilities.add,[])&&same(p.devices,[])&&same(p.tmpfs,[]),'UNEXPECTED_LINUX_DEFAULTS');
  // EXACTLY these observed empty arrays; never strip nonempty permissions/devices/mounts.
  delete p.capabilities.add;delete p.devices;delete p.tmpfs;return d;
}
export function runtimeWithDefaults(args){return runtime({...args,definition:normalizeDefaultArrays(args.definition)});}
const endpoints={cloudformation:'cloudformation.ca-central-1.amazonaws.com',ecs:'ecs.ca-central-1.amazonaws.com',
  elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',ec2:'ec2.ca-central-1.amazonaws.com',logs:'logs.ca-central-1.amazonaws.com',route53:'route53.amazonaws.com'};
const operations={cloudformation:['describe-stacks','get-template','list-stack-resources'],ecs:['describe-services','describe-task-definition','list-tasks','describe-tasks'],
  elbv2:['describe-load-balancers','describe-listeners','describe-target-health'],ec2:['describe-security-groups'],logs:['describe-log-groups'],route53:['list-resource-record-sets']};
export function verifyMetadata(v,m,ack){
  const st=v.stack.Stacks?.[0],rs=v.resources.StackResourceSummaries,intended=template(m.nonce),doc=v.template.TemplateBody;
  must(v.stack.Stacks?.length===1&&st.StackId===ack.stackId&&st.StackStatus==='CREATE_COMPLETE'&&!st.RoleARN&&
    same(typeof doc==='string'?JSON.parse(doc):doc,intended)&&!v.resources.NextToken&&rs?.length===11&&
    new Set(rs.map(r=>r.LogicalResourceId)).size===11&&rs.every(r=>r.ResourceStatus==='CREATE_COMPLETE'&&r.PhysicalResourceId&&intended.Resources[r.LogicalResourceId]?.Type===r.ResourceType)&&
    same(sort(st.Parameters?.map(p=>({ParameterKey:p.ParameterKey,ParameterValue:p.ParameterValue}))??[]),sort([
      {ParameterKey:'HostingExpiresAt',ParameterValue:ack.hostingExpiresAt},{ParameterKey:'ControllerLease',ParameterValue:canonical(ack.controlLease)}]))&&
    same(sort(st.Tags??[]),sort(tags(m.nonce,ack.hostingExpiresAt))),'READBACK_STACK');
  const ids=Object.fromEntries(rs.map(r=>[r.LogicalResourceId,r.PhysicalResourceId]));
  must(!H.retiredTaskDefinitions.includes(ids.TaskDefinition),'OLD_DEFINITION');
  const lb=v.lb.LoadBalancers?.[0],l=v.listeners.Listeners?.[0];
  must(v.lb.LoadBalancers?.length===1&&lb.LoadBalancerArn===ids.LoadBalancer&&lb.LoadBalancerName===P.alb&&lb.State.Code==='active'&&lb.VpcId===P.vpc&&
    lb.Type==='application'&&lb.Scheme==='internet-facing'&&lb.IpAddressType==='ipv4'&&same(lb.SecurityGroups,[ids.AlbSecurityGroup])&&
    same(sort(lb.AvailabilityZones.map(z=>z.SubnetId)),sort(P.subnets)),'READBACK_ALB');
  must(!v.listeners.NextMarker&&v.listeners.Listeners?.length===1&&l.ListenerArn===ids.HttpsListener&&l.Port===443&&l.Protocol==='HTTPS'&&
    l.SslPolicy===P.sslPolicy&&same(l.Certificates,[{CertificateArn:P.certificate}])&&l.DefaultActions?.length===1&&
    l.DefaultActions[0].Type==='forward'&&l.DefaultActions[0].TargetGroupArn===ids.TargetGroup,'READBACK_LISTENER');
  must(v.service.services?.length===1&&!v.service.failures?.length&&!v.running.nextToken&&v.running.taskArns?.length===1&&
    v.tasks.tasks?.length===1&&!v.tasks.failures?.length&&v.tasks.tasks[0].taskArn===v.running.taskArns[0],'READBACK_TASKS');
  runtimeWithDefaults({service:v.service.services[0],definition:v.definition.taskDefinition,task:v.tasks.tasks[0],
    targets:v.targets.TargetHealthDescriptions,ids,nonce:m.nonce,controlLease:ack.controlLease});
  assertGroups(v.groups.SecurityGroups,ids);
  must(!v.logs.nextToken&&v.logs.logGroups?.filter(g=>g.logGroupName===P.logGroup&&g.retentionInDays===7).length===1,'READBACK_LOGS');
  const records=v.dns.ResourceRecordSets?.filter(r=>r.Name.toLowerCase().replace(/\.$/,'')===P.domain&&['A','AAAA','CNAME'].includes(r.Type));
  must(records?.length===1&&records[0].Type==='A'&&records[0].AliasTarget?.DNSName.replace(/\.$/,'')===lb.DNSName.replace(/\.$/,'')&&
    records[0].AliasTarget.HostedZoneId===lb.CanonicalHostedZoneId&&records[0].AliasTarget.EvaluateTargetHealth===true,'READBACK_DNS');
  assertSupply(v.supply);return {stackId:st.StackId,stackStatus:st.StackStatus,resources:rs.map(r=>({id:r.LogicalResourceId,type:r.ResourceType,status:r.ResourceStatus,physicalId:r.PhysicalResourceId})),
    taskArn:v.tasks.tasks[0].taskArn,taskDefinition:ids.TaskDefinition,imageDigest:H.imageDigest,healthy:true,dnsAliasVerified:true,
    controlLease:ack.controlLease,hostingExpiresAt:ack.hostingExpiresAt,controlAcceptancePassed:false,
    defaultEmptyArraysNormalized:['linuxParameters.capabilities.add','linuxParameters.devices','linuxParameters.tmpfs']};
}
export async function main(args=process.argv.slice(2)){
  const [file,sha,...extra]=args;must(!extra.length&&/^F:\/ChatGPT_workshop\/techlong-hosted-deploy-review-[a-z0-9-]+\.json$/.test(file??'')&&/^[a-f0-9]{64}$/.test(sha??''),'INSPECT_ARGUMENTS');
  environment();awsEnvironment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()==='','CLEAN_MAIN');
  const raw=await readText(file,300000),m=validate(raw,sha,Date.now(),true);
  must(same(await sourcePins(),m.pins)&&same(await parents(),m.parents),'ORIGINAL_PINS_PARENTS');
  const dir=BASE+'/techlong-platform-hosted-deploy-'+m.nonce,slotRaw=await readText(H.slot),ackRaw=await readText(dir+'/create-ack.json'),intentRaw=await readText(dir+'/create-intent.json');
  const slot=JSON.parse(slotRaw),ack=JSON.parse(ackRaw),intent=JSON.parse(intentRaw);
  must([slot,ack,intent].every(x=>x.manifestSha256===sha&&x.nonce===m.nonce)&&ack.stackId!==H.previousStackId&&
    new RegExp(`^arn:aws:cloudformation:${P.region}:${P.account}:stack/${P.hostingStack}/[a-f0-9-]{36}$`).test(ack.stackId??'')&&
    same(ack.controlLease,intent.controlLease)&&same(ack.controlLease,lease(ack.controlLease.issuedAt))&&
    ack.hostingExpiresAt===intent.hostingExpiresAt&&ack.hostingExpiresAt===new Date(ack.controlLease.issuedAt+H.hostingMs).toISOString(),'INSPECT_ACK_BINDING');
  let reads=0;const cli=(service,op,argv)=>{must(operations[service]?.includes(op),'INSPECT_READ_ONLY');reads++;
    try{return JSON.parse(execFileSync('aws.exe',[service,op,...argv,'--profile',P.profile,'--region',service==='route53'?'us-east-1':P.region,
      '--endpoint-url','https://'+endpoints[service],'--output','json','--no-cli-pager','--no-paginate'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:3000000,
      stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));
    }catch{throw Error('HOSTED_DEPLOY_INSPECT_METADATA_UNAVAILABLE');}};
  const c=supplyCloud(),v={},errors=[];let verified=null;
  try{await c.source();
    v.stack=cli('cloudformation','describe-stacks',['--stack-name',ack.stackId]);
    v.resources=cli('cloudformation','list-stack-resources',['--stack-name',ack.stackId]);
    v.template=cli('cloudformation','get-template',['--stack-name',ack.stackId,'--template-stage','Original']);
    const ids=Object.fromEntries((v.resources.StackResourceSummaries??[]).map(r=>[r.LogicalResourceId,r.PhysicalResourceId]));
    must(v.stack.Stacks?.[0]?.StackId===ack.stackId&&v.stack.Stacks[0].StackStatus==='CREATE_COMPLETE'&&Object.keys(ids).length===11&&
      Object.keys(ids).every(k=>template(m.nonce).Resources[k]),'INSPECT_RESOURCE_TARGETS');
    v.lb=cli('elbv2','describe-load-balancers',['--load-balancer-arns',ids.LoadBalancer]);
    v.listeners=cli('elbv2','describe-listeners',['--load-balancer-arn',ids.LoadBalancer]);
    v.service=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);
    v.definition=cli('ecs','describe-task-definition',['--task-definition',ids.TaskDefinition]);
    v.running=cli('ecs','list-tasks',['--cluster',P.cluster,'--service-name',P.service,'--desired-status','RUNNING']);
    must(!v.running.nextToken&&v.running.taskArns?.length===1,'INSPECT_RUNNING_COUNT');
    v.tasks=cli('ecs','describe-tasks',['--cluster',P.cluster,'--tasks',v.running.taskArns[0]]);
    v.targets=cli('elbv2','describe-target-health',['--target-group-arn',ids.TargetGroup]);
    v.groups=cli('ec2','describe-security-groups',['--group-ids',ids.TaskSecurityGroup,ids.AlbSecurityGroup]);
    v.logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);
    v.dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);
    v.supply=await c.snapshot();verified=verifyMetadata(v,m,ack);
  }catch(e){errors.push(safeCode(e));}
  finally{c.close();}
  const result={schema:'techlong/platform-hosted-deploy-defaults-inspect/v6',manifestSha256:sha,nonce:m.nonce,
    inspectorCommit:git(['rev-parse','HEAD']).trim(),inspectorFileSha256:hash(await readText(fileURLToPath(import.meta.url))),
    originalApprovedSourcePinsUnchanged:true,originalExecutionReceiptsPreserved:true,
    sourceReceipts:{slotSha256:hash(slotRaw),createAckSha256:hash(ackRaw),createIntentSha256:hash(intentRaw)},
    outcome:verified&&!errors.length?'HOSTING_METADATA_INDEPENDENTLY_VERIFIED_DEFAULT_ARRAYS':'HOSTING_REQUIRES_REVIEW',
    observedAtUtc:new Date().toISOString(),verified,errors,metadataCalls:reads+c.counts.metadata,cloudWrites:c.counts.writes,
    directSecretValueReads:0,directSql:0,applicationHttp:0,githubDispatches:0,applicationAcceptancePassed:false,controlAcceptancePassed:false,
    automaticCleanup:false,retryAllowed:false,rawMetadata:v};
  must(result.cloudWrites===0&&!/postgres(?:ql)?:\/\/|-----BEGIN (RSA )?PRIVATE KEY-----|SCRAM-SHA-256\$/.test(JSON.stringify(result)),'INSPECT_PRIVATE_EVIDENCE');
  const output=BASE+'/techlong-hosted-deploy-defaults-inspect-'+m.nonce+'-'+Date.now()+'.json';await writeOnce(output,result);
  return {output,outcome:result.outcome,errors,cloudWrites:0,observedAtUtc:result.observedAtUtc};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().then(r=>{
  console.log(JSON.stringify(r,null,2));if(r.outcome!=='HOSTING_METADATA_INDEPENDENTLY_VERIFIED_DEFAULT_ARRAYS')process.exitCode=2;
}).catch(e=>{console.error(JSON.stringify({outcome:'READ_ONLY_INSPECT_STOPPED',code:safeCode(e),cloudWrites:0}));process.exitCode=1;});
