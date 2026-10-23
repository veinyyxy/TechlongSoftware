// Source control-plane metadata only; future compute write is one fixed CreateStack.
import {execFileSync} from 'node:child_process';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {CloudFormationClient,CreateStackCommand,GetTemplateCommand,ListStackResourcesCommand,ValidateTemplateCommand} from '@aws-sdk/client-cloudformation';
import {cloud as accessCloud,assertPublicRoutes} from '../platform-ecs-v1/cloud.mjs';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {P,B,must,same,canonical,handoffPolicy,template,stackTags,assertAccess} from './contract.mjs';
const sorted=a=>[...a].sort((x,y)=>canonical(x).localeCompare(canonical(y)));
const dnsName=s=>s.toLowerCase().replace(/\.$/,'');
export function cloud(){
  awsEnvironment();const access=accessCloud(),count={reads:0,writes:0};
  const cfn=new CloudFormationClient({region:P.region,endpoint:'https://cloudformation.ca-central-1.amazonaws.com',maxAttempts:1,ignoreConfiguredEndpointUrls:true,
    credentials:fromLoginCredentials({profile:P.profile,ignoreCache:true}),requestHandler:new NodeHttpHandler({httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})});
  const send=async(cmd,write=false)=>{count[write?'writes':'reads']++;must(count.writes<=1&&access.counts.writes===0,'WRITE_LIMIT');
    try{return await cfn.send(cmd,{abortSignal:AbortSignal.timeout(30000)});}catch(e){e.operation=cmd.constructor.name;throw e;}};
  const cli=(service,operation,args=[])=>{count.reads++;const endpoints={ec2:'ec2.ca-central-1.amazonaws.com',ecr:'api.ecr.ca-central-1.amazonaws.com',
    ecs:'ecs.ca-central-1.amazonaws.com',elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',logs:'logs.ca-central-1.amazonaws.com',
    route53:'route53.amazonaws.com',acm:'acm.ca-central-1.amazonaws.com',kms:'kms.ca-central-1.amazonaws.com',iam:'iam.amazonaws.com',budgets:'budgets.amazonaws.com'};
    must(endpoints[service]&&/^(describe-|list-|get-)/.test(operation),'READ_ONLY_CLI');
    try{return JSON.parse(execFileSync('aws.exe',[service,operation,...args,'--profile',P.profile,'--region',['route53','iam','budgets'].includes(service)?'us-east-1':P.region,
      '--endpoint-url','https://'+endpoints[service],'--output','json','--no-cli-pager','--no-paginate'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,
      stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));}
    catch(e){const code=String(e.stderr??'').match(/An error occurred \(([A-Za-z0-9_.]+)\)/)?.[1],err=Error('PLATFORM_HOSTING_DEPLOY_CLI_READ_FAILED');err.name=code??'AwsCliReadUnavailable';err.operation=service+'-'+operation;throw err;}};
  const stack=()=>access.stack(P.hostingStack);
  async function accessState(){const a=await access.inspectAccess(B.accessNonce,B.accessStackId);assertAccess(a);const secret=await access.secret(handoffPolicy());
    const k=cli('kms','describe-key',['--key-id',P.kmsArn]).KeyMetadata;must(k?.Arn===P.kmsArn&&k.KeyManager==='AWS'&&k.Enabled&&k.KeyState==='Enabled','KMS');return {access:a,secret};}
  async function inventory(){const source=await access.source(),identity=await accessState();must(!(await stack()),'STACK_OCCUPIED');
    const im=cli('ecr','describe-images',['--repository-name',P.repository,'--image-ids','imageDigest='+P.imageDigest]).imageDetails;
    must(im?.length===1&&im[0].imageDigest===P.imageDigest&&['application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json'].includes(im[0].imageManifestMediaType),'IMAGE');
    const v=cli('ec2','describe-vpcs',['--vpc-ids',P.vpc]).Vpcs;must(v?.length===1&&v[0].VpcId===P.vpc&&v[0].State==='available','VPC');
    for(const n of ['enableDnsSupport','enableDnsHostnames'])must(cli('ec2','describe-vpc-attribute',['--vpc-id',P.vpc,'--attribute',n])[n[0].toUpperCase()+n.slice(1)]?.Value===true,'VPC_DNS');
    const sub=cli('ec2','describe-subnets',['--subnet-ids',...P.subnets]).Subnets;
    must(sub?.length===2&&new Set(sub.map(s=>s.AvailabilityZone)).size===2&&sub.every(s=>P.subnets.includes(s.SubnetId)&&s.VpcId===P.vpc&&s.State==='available'&&s.AvailableIpAddressCount>=8),'SUBNETS');
    const rt=cli('ec2','describe-route-tables',['--filters','Name=vpc-id,Values='+P.vpc]);must(!rt.NextToken&&Array.isArray(rt.RouteTables),'ROUTES');assertPublicRoutes(rt.RouteTables);
    const igw=cli('ec2','describe-internet-gateways',['--internet-gateway-ids',P.igw]).InternetGateways;
    must(igw?.length===1&&igw[0].Attachments.some(a=>a.VpcId===P.vpc&&['available','attached'].includes(a.State)),'IGW');
    const nacl=cli('ec2','describe-network-acls',['--filters','Name=vpc-id,Values='+P.vpc]);must(!nacl.NextToken&&P.subnets.every(id=>nacl.NetworkAcls?.some(a=>a.IsDefault&&a.Associations.some(s=>s.SubnetId===id)&&
      [false,true].every(e=>a.Entries.some(r=>r.Egress===e&&r.RuleNumber===100&&r.RuleAction==='allow'&&r.Protocol==='-1'&&r.CidrBlock==='0.0.0.0/0')))),'NACL');
    const cert=cli('acm','describe-certificate',['--certificate-arn',P.certificate]).Certificate;
    must(cert?.CertificateArn===P.certificate&&cert.Status==='ISSUED'&&Date.parse(cert.NotAfter)>Date.now()+7*86400000&&cert.SubjectAlternativeNames?.some(d=>d===P.domain||d==='*.sandbox.techlong.cloud'),'CERTIFICATE');
    const zone=cli('route53','get-hosted-zone',['--id',P.hostedZone]);must(zone.HostedZone?.Name==='sandbox.techlong.cloud.'&&!zone.HostedZone.Config.PrivateZone,'ZONE');
    const dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);
    must(!dns.ResourceRecordSets?.some(r=>dnsName(r.Name)===P.domain&&['A','AAAA','CNAME'].includes(r.Type)),'DNS_OCCUPIED');
    for(const [op,name,notFound]of [['describe-load-balancers',P.alb,'LoadBalancerNotFound'],['describe-target-groups',P.targetGroup,'TargetGroupNotFound']]){
      let absent=false;try{cli('elbv2',op,['--names',name]);}catch(e){if(e.name!==notFound)throw e;absent=true;}must(absent,'ELB_OCCUPIED');}
    const cl=cli('ecs','describe-clusters',['--clusters',P.cluster]);must(cl.clusters?.length===0&&cl.failures?.length===1&&cl.failures[0].reason==='MISSING','CLUSTER_OCCUPIED');
    for(const status of ['ACTIVE','INACTIVE']){const d=cli('ecs','list-task-definitions',['--family-prefix',P.family,'--status',status,'--max-results','100']);must(!d.nextToken&&d.taskDefinitionArns?.length===0,'TASK_FAMILY_OCCUPIED');}
    const logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);must(!logs.nextToken&&!logs.logGroups?.some(g=>g.logGroupName===P.logGroup),'LOGS_OCCUPIED');
    const linked=[];for(const name of ['AWSServiceRoleForECS','AWSServiceRoleForElasticLoadBalancing']){const r=cli('iam','get-role',['--role-name',name]).Role;must(r?.RoleId&&r.Arn.includes(':role/aws-service-role/'),'SERVICE_LINKED_ROLE');linked.push({name,id:r.RoleId,arn:r.Arn});}
    const budget=cli('budgets','describe-budget',['--account-id',P.account,'--budget-name','techlong-sandbox-402010193138-ca-central-1']).Budget;
    must(Number(budget?.BudgetLimit?.Amount)===50&&budget.BudgetLimit.Unit==='USD'&&budget.TimeUnit==='MONTHLY','BUDGET');
    return {checkedAtUtc:new Date().toISOString(),source,...identity,hostingNamesAbsent:true,image:{digest:P.imageDigest,size:im[0].imageSizeInBytes,manifestMediaType:im[0].imageManifestMediaType},
      network:{vpc:P.vpc,cidr:v[0].CidrBlock,subnets:sorted(sub.map(s=>({id:s.SubnetId,az:s.AvailabilityZone}))),routeTable:P.routeTable,igw:P.igw},
      certificate:{arn:P.certificate,status:cert.Status,notAfter:cert.NotAfter},serviceLinkedRoles:linked,budget:{limitUsd:50,hardCap:false}};
  }
  async function observe(nonce,expectedId,expiry){
    const s=await stack();if(!s)return {verified:false,present:false};
    const list=await send(new ListStackResourcesCommand({StackName:s.StackId}));must(!list.NextToken,'RESOURCE_PAGINATION');
    const resources=(list.StackResourceSummaries??[]).map(r=>({id:r.LogicalResourceId,type:r.ResourceType,physicalId:r.PhysicalResourceId,status:r.ResourceStatus}));
    if(!expectedId||s.StackId!==expectedId||s.StackStatus!=='CREATE_COMPLETE')return {verified:false,present:true,stackId:s.StackId,status:s.StackStatus,resources};
    const doc=await send(new GetTemplateCommand({StackName:expectedId,TemplateStage:'Original'}));
    const intended=template(nonce);must(same(typeof doc.TemplateBody==='string'?JSON.parse(doc.TemplateBody):doc.TemplateBody,intended)&&
      same(s.Parameters?.map(p=>({ParameterKey:p.ParameterKey,ParameterValue:p.ParameterValue})),[{ParameterKey:'HostingExpiresAt',ParameterValue:expiry}])&&
      same(sorted(s.Tags??[]),sorted(stackTags(nonce,expiry)))&&resources.length===11&&resources.every(r=>r.status==='CREATE_COMPLETE'&&r.type===intended.Resources[r.id]?.Type&&r.physicalId),'STACK_EXACT');
    const ids=Object.fromEntries(resources.map(r=>[r.id,r.physicalId]));
    const lb=cli('elbv2','describe-load-balancers',['--load-balancer-arns',ids.LoadBalancer]).LoadBalancers;
    must(lb?.length===1&&lb[0].LoadBalancerArn===ids.LoadBalancer&&lb[0].LoadBalancerName===P.alb&&lb[0].Type==='application'&&lb[0].Scheme==='internet-facing'&&lb[0].IpAddressType==='ipv4'&&
      lb[0].State.Code==='active'&&lb[0].VpcId===P.vpc&&same(sorted(lb[0].SecurityGroups),[ids.AlbSecurityGroup])&&same(sorted(lb[0].AvailabilityZones.map(z=>z.SubnetId)),sorted(P.subnets)),'ALB');
    const listeners=cli('elbv2','describe-listeners',['--load-balancer-arn',ids.LoadBalancer]);must(!listeners.NextMarker&&listeners.Listeners?.length===1&&listeners.Listeners[0].ListenerArn===ids.HttpsListener&&
      listeners.Listeners[0].Port===443&&listeners.Listeners[0].Protocol==='HTTPS'&&listeners.Listeners[0].SslPolicy===P.sslPolicy&&listeners.Listeners[0].Certificates?.[0]?.CertificateArn===P.certificate&&
      listeners.Listeners[0].DefaultActions?.length===1&&listeners.Listeners[0].DefaultActions[0].Type==='forward'&&listeners.Listeners[0].DefaultActions[0].TargetGroupArn===ids.TargetGroup,'LISTENER');
    const sv=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);must(!sv.failures?.length&&sv.services?.length===1,'SERVICE_COUNT');const service=sv.services[0];
    const td=cli('ecs','describe-task-definition',['--task-definition',ids.TaskDefinition]).taskDefinition;
    const taskArns=cli('ecs','list-tasks',['--cluster',P.cluster,'--service-name',P.service,'--desired-status','RUNNING']);must(!taskArns.nextToken&&taskArns.taskArns?.length===1,'RUNNING_TASK_COUNT');
    const task=cli('ecs','describe-tasks',['--cluster',P.cluster,'--tasks',taskArns.taskArns[0]]);must(!task.failures?.length&&task.tasks?.length===1,'TASK_COUNT');
    const target=cli('elbv2','describe-target-health',['--target-group-arn',ids.TargetGroup]);
    assertRuntime({service,definition:td,task:task.tasks[0],targets:target.TargetHealthDescriptions,ids});
    assertGroups(cli('ec2','describe-security-groups',['--group-ids',ids.TaskSecurityGroup,ids.AlbSecurityGroup]).SecurityGroups,ids);
    const logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);
    must(!logs.nextToken&&logs.logGroups?.filter(g=>g.logGroupName===P.logGroup&&g.retentionInDays===7).length===1,'LOG_RETENTION');
    const dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']).ResourceRecordSets;
    const record=dns?.filter(r=>dnsName(r.Name)===P.domain&&['A','AAAA','CNAME'].includes(r.Type));
    must(record?.length===1&&record[0].Type==='A'&&dnsName(record[0].AliasTarget?.DNSName??'')===dnsName(lb[0].DNSName)&&record[0].AliasTarget.HostedZoneId===lb[0].CanonicalHostedZoneId&&record[0].AliasTarget.EvaluateTargetHealth===true,'DNS_ALIAS');
    const identity=await accessState();return {verified:true,present:true,stackId:s.StackId,status:s.StackStatus,hostingExpiresAt:expiry,resources,
      roleId:identity.access.roleId,boundaryId:identity.access.boundaryId,secretVersion:identity.secret.versionId,service:{arn:service.serviceArn,running:service.runningCount,desired:service.desiredCount,taskDefinition:service.taskDefinition},
      task:{arn:task.tasks[0].taskArn,status:task.tasks[0].lastStatus,imageDigest:task.tasks[0].containers[0].imageDigest},targetHealthy:true,dnsAliasVerified:true,url:'https://'+P.domain,applicationAcceptancePassed:false};
  }
  return {get counts(){return {reads:count.reads+access.counts.reads,writes:count.writes+access.counts.writes};},source:access.source,stack,inventory,observe,
    async assertAccessFresh(){await accessState();},
    async validate(nonce){const r=await send(new ValidateTemplateCommand({TemplateBody:canonical(template(nonce))}));must(!(r.Capabilities??[]).length&&r.Parameters?.length===1&&r.Parameters[0].ParameterKey==='HostingExpiresAt'&&!r.Parameters[0].DefaultValue,'TEMPLATE_VALIDATION');return {capabilities:[],parameters:r.Parameters};},
    async create(nonce,expiry){must(new RegExp(template(nonce).Parameters.HostingExpiresAt.AllowedPattern).test(expiry),'EXPIRY_FORMAT');
      const r=await send(new CreateStackCommand({StackName:P.hostingStack,TemplateBody:canonical(template(nonce)),Parameters:[{ParameterKey:'HostingExpiresAt',ParameterValue:expiry}],
        DisableRollback:true,TimeoutInMinutes:20,Tags:stackTags(nonce,expiry),ClientRequestToken:'platform-hosting-'+nonce}),true);
      must(r.StackId?.startsWith(`arn:aws:cloudformation:${P.region}:${P.account}:stack/${P.hostingStack}/`),'CREATE_ACK');return r.StackId;},
    dispose(){access.dispose();cfn.destroy();}
  };
}
export function assertGroups(groups,ids){
  const norm=a=>sorted((a??[]).map(p=>({protocol:p.IpProtocol,from:p.FromPort,to:p.ToPort,v4:sorted((p.IpRanges??[]).map(r=>r.CidrIp)),
    v6:sorted((p.Ipv6Ranges??[]).map(r=>r.CidrIpv6)),pairs:sorted((p.UserIdGroupPairs??[]).map(g=>({id:g.GroupId,owner:g.UserId}))),prefixes:p.PrefixListIds??[]})));
  const rule=(port,peer)=>[{protocol:'tcp',from:port,to:port,v4:peer?[]:['0.0.0.0/0'],v6:[],pairs:peer?[{id:peer,owner:P.account}]:[],prefixes:[]}];
  must(groups?.length===2&&groups.every(g=>g.VpcId===P.vpc),'GROUP_COUNT');
  const task=groups.find(g=>g.GroupId===ids.TaskSecurityGroup),alb=groups.find(g=>g.GroupId===ids.AlbSecurityGroup);
  must(task&&alb&&same(norm(task.IpPermissions),rule(3000,ids.AlbSecurityGroup))&&same(norm(task.IpPermissionsEgress),rule(443))&&
    same(norm(alb.IpPermissions),rule(443))&&same(norm(alb.IpPermissionsEgress),rule(3000,ids.TaskSecurityGroup)),'GROUP_RULES');
}
export function assertRuntime({service:s,definition:d,task:t,targets,ids}){
  const intended=template('a'.repeat(32)).Resources.TaskDefinition.Properties,c=d?.containerDefinitions?.[0],expected=intended.ContainerDefinitions[0];
  must(s.status==='ACTIVE'&&s.serviceName===P.service&&s.serviceArn===ids.Service&&s.taskDefinition===ids.TaskDefinition&&s.desiredCount===1&&s.runningCount===1&&s.pendingCount===0&&
    s.launchType==='FARGATE'&&s.platformVersion==='1.4.0'&&s.enableExecuteCommand===false&&s.deployments?.length===1&&s.deployments[0].rolloutState==='COMPLETED'&&
    s.loadBalancers?.length===1&&s.loadBalancers[0].targetGroupArn===ids.TargetGroup&&s.loadBalancers[0].containerPort===3000&&s.loadBalancers[0].containerName==='web'&&
    s.networkConfiguration?.awsvpcConfiguration?.assignPublicIp==='ENABLED'&&same(sorted(s.networkConfiguration.awsvpcConfiguration.subnets),sorted(P.subnets))&&
    same(s.networkConfiguration.awsvpcConfiguration.securityGroups,[ids.TaskSecurityGroup]),'SERVICE_RUNTIME');
  must(d.taskDefinitionArn===ids.TaskDefinition&&d.family===P.family&&d.executionRoleArn===P.roleArn&&!d.taskRoleArn&&d.networkMode==='awsvpc'&&d.cpu==='512'&&d.memory==='1024'&&
    same(d.requiresCompatibilities,['FARGATE'])&&!d.volumes?.length&&d.runtimePlatform?.cpuArchitecture==='X86_64'&&d.runtimePlatform.operatingSystemFamily==='LINUX'&&d.containerDefinitions.length===1&&c.name==='web'&&c.image===P.image&&c.user==='1000:1000'&&!c.privileged&&
    c.readonlyRootFilesystem===false&&same(c.linuxParameters?.capabilities?.drop,['ALL'])&&c.linuxParameters.initProcessEnabled===true&&!c.environmentFiles?.length&&
    same(sorted(c.environment??[]),sorted(expected.Environment.map(e=>({name:e.Name,value:e.Value}))))&&same(c.secrets,[{name:'DATABASE_URL',valueFrom:P.secretArn+':databaseUrl::'+P.secretVersion}]),'TASK_DEFINITION');
  must(t.lastStatus==='RUNNING'&&t.healthStatus==='HEALTHY'&&t.taskDefinitionArn===ids.TaskDefinition&&t.launchType==='FARGATE'&&!t.overrides?.taskRoleArn&&!t.overrides?.executionRoleArn&&
    !(t.overrides?.containerOverrides??[]).some(c=>c.environment?.length||c.environmentFiles?.length||c.command?.length)&&t.containers?.length===1&&t.containers[0].imageDigest===P.imageDigest&&
    targets?.length===1&&targets[0].TargetHealth?.State==='healthy'&&targets[0].Target.Port===3000&&t.containers[0].networkInterfaces?.some(n=>n.privateIpv4Address===targets[0].Target.Id),'TASK_HEALTH');
}
