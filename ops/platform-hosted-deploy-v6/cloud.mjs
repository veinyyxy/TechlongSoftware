// Fixed regional metadata + at most ONE CreateStack. No value/SQL/App access.
import {execFileSync} from 'node:child_process';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import * as C from '@aws-sdk/client-cloudformation';
import {createCloud as supplyCloud} from '../platform-hosted-access-v6/cloud.mjs';
import {assertPublicRoutes} from '../platform-ecs-v1/cloud.mjs';
import {assertGroups} from '../platform-hosting-deploy-v1/cloud.mjs';
import {H,P,must,same,hash,canonical,lease,template,tags,assertSupply,assertDefinitions,assertBaseline,runtime} from './contract.mjs';
const endpoints={ec2:'ec2.ca-central-1.amazonaws.com',ecr:'api.ecr.ca-central-1.amazonaws.com',ecs:'ecs.ca-central-1.amazonaws.com',
  elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',logs:'logs.ca-central-1.amazonaws.com',route53:'route53.amazonaws.com',
  acm:'acm.ca-central-1.amazonaws.com',iam:'iam.amazonaws.com',budgets:'budgets.amazonaws.com'};
const sort=a=>[...a].sort((x,y)=>canonical(x).localeCompare(canonical(y)));
export function cloud(){
  const supply=supplyCloud(),counts={metadata:0,writes:0};let allowedUntil=0;
  const client=()=>new C.CloudFormationClient({region:P.region,endpoint:'https://cloudformation.ca-central-1.amazonaws.com',
    maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:P.profile,ignoreCache:true}),
    requestHandler:new NodeHttpHandler({httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})});
  const cfn=client();
  const read=(c,x)=>{counts.metadata++;return c.send(x,{abortSignal:AbortSignal.timeout(30000)});};
  const cli=(service,operation,args=[])=>{must(endpoints[service]&&(/^(describe-|list-|get-)/.test(operation)||service==='ecr'&&operation==='batch-get-image'),'READ_OPERATION');counts.metadata++;
    try{return JSON.parse(execFileSync('aws.exe',[service,operation,...args,'--profile',P.profile,
      '--region',['iam','budgets','route53'].includes(service)?'us-east-1':P.region,'--endpoint-url','https://'+endpoints[service],
      '--output','json','--no-cli-pager','--no-paginate'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:3000000,
      stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));
    }catch(e){const code=String(e.stderr??'').match(/An error occurred \(([A-Za-z0-9_]+)\)/)?.[1];
      const error=Error('HOSTED_DEPLOY_METADATA_UNAVAILABLE');error.name=code??'AwsCliReadUnavailable';throw error;}};
  async function stack(c=cfn,name=P.hostingStack){try{const x=await read(c,new C.DescribeStacksCommand({StackName:name}));
    must(x.Stacks?.length===1,'STACK_SHAPE');return x.Stacks[0];
  }catch(e){if(e.name==='ValidationError'&&/does not exist/.test(e.message))return null;throw e;}}
  async function assertSupplyFresh(){const s=await supply.snapshot();assertSupply(s);return s;}
  async function inventory(){
    const s=await assertSupplyFresh();must(!(await stack()),'HOSTING_OCCUPIED');
    const previous=await stack(cfn,H.previousStackId);must(previous?.StackId===H.previousStackId&&previous.StackStatus==='DELETE_COMPLETE','PREVIOUS_STACK');
    const image=cli('ecr','describe-images',['--repository-name',P.repository,'--image-ids','imageDigest='+H.imageDigest]);
    must(image.imageDetails?.length===1&&image.imageDetails[0].imageDigest===H.imageDigest,'IMAGE');
    const manifest=cli('ecr','batch-get-image',['--repository-name',P.repository,'--image-ids','imageDigest='+H.imageDigest]);
    must(!manifest.failures?.length&&manifest.images?.length===1&&manifest.images[0].imageId?.imageDigest===H.imageDigest,'IMAGE_MANIFEST');
    const raw=manifest.images[0].imageManifest,doc=JSON.parse(raw);
    must('sha256:'+hash(raw)===H.imageDigest&&doc.schemaVersion===2&&doc.config?.digest===H.imageConfigDigest&&doc.layers?.length===12,'IMAGE_CONFIG');
    const v=cli('ec2','describe-vpcs',['--vpc-ids',P.vpc]).Vpcs;
    must(v?.length===1&&v[0].VpcId===P.vpc&&v[0].State==='available','VPC');
    for(const a of ['enableDnsSupport','enableDnsHostnames'])must(cli('ec2','describe-vpc-attribute',['--vpc-id',P.vpc,'--attribute',a])[a[0].toUpperCase()+a.slice(1)]?.Value===true,'VPC_DNS');
    const sub=cli('ec2','describe-subnets',['--subnet-ids',...P.subnets]).Subnets;
    must(sub?.length===2&&new Set(sub.map(s=>s.AvailabilityZone)).size===2&&sub.every(s=>P.subnets.includes(s.SubnetId)&&s.VpcId===P.vpc&&s.State==='available'&&s.AvailableIpAddressCount>=8),'SUBNETS');
    const routes=cli('ec2','describe-route-tables',['--filters','Name=vpc-id,Values='+P.vpc]);must(!routes.NextToken,'ROUTE_PAGE');assertPublicRoutes(routes.RouteTables??[]);
    const igw=cli('ec2','describe-internet-gateways',['--internet-gateway-ids',P.igw]).InternetGateways;
    must(igw?.length===1&&igw[0].Attachments.some(a=>a.VpcId===P.vpc&&['attached','available'].includes(a.State)),'IGW');
    const acls=cli('ec2','describe-network-acls',['--filters','Name=vpc-id,Values='+P.vpc]);
    must(!acls.NextToken&&P.subnets.every(id=>acls.NetworkAcls?.some(a=>a.IsDefault&&a.Associations?.some(x=>x.SubnetId===id)&&
      [false,true].every(e=>a.Entries?.some(r=>r.Egress===e&&r.RuleNumber===100&&r.RuleAction==='allow'&&r.Protocol==='-1'&&r.CidrBlock==='0.0.0.0/0')))),'NACL');
    const cert=cli('acm','describe-certificate',['--certificate-arn',P.certificate]).Certificate;
    must(cert?.CertificateArn===P.certificate&&cert.Status==='ISSUED'&&Date.parse(cert.NotAfter)>Date.now()+7*86400000&&
      cert.SubjectAlternativeNames?.some(d=>d===P.domain||d==='*.sandbox.techlong.cloud'),'CERTIFICATE');
    const zone=cli('route53','get-hosted-zone',['--id',P.hostedZone]);must(zone.HostedZone?.Name==='sandbox.techlong.cloud.'&&!zone.HostedZone.Config.PrivateZone,'ZONE');
    const dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);
    must(!dns.ResourceRecordSets?.some(r=>r.Name.toLowerCase().replace(/\.$/,'')===P.domain&&['A','AAAA','CNAME'].includes(r.Type)),'DNS_OCCUPIED');
    for(const [op,name,code]of [['describe-load-balancers',P.alb,'LoadBalancerNotFound'],['describe-target-groups',P.targetGroup,'TargetGroupNotFound']]){
      let absent=false;try{cli('elbv2',op,['--names',name]);}catch(e){if(e.name!==code)throw e;absent=true;}must(absent,'ELB_OCCUPIED');}
    const cl=cli('ecs','describe-clusters',['--clusters',P.cluster]);
    const cluster=cl.clusters?.[0],missing=cl.clusters?.length===0&&cl.failures?.length===1&&cl.failures[0].reason==='MISSING';
    must(missing||(cl.clusters.length===1&&!cl.failures?.length&&cluster.clusterName===P.cluster&&cluster.status==='INACTIVE'&&
      cluster.runningTasksCount===0&&cluster.pendingTasksCount===0&&cluster.activeServicesCount===0&&cluster.registeredContainerInstancesCount===0),'CLUSTER_OCCUPIED');
    if(!missing){const sv=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);
      must(sv.services?.length===1&&sv.services[0].serviceName===P.service&&sv.services[0].status==='INACTIVE'&&sv.services[0].desiredCount===0&&
        sv.services[0].runningCount===0&&sv.services[0].pendingCount===0&&!sv.failures?.length,'SERVICE_OCCUPIED');}
    const definitions={};for(const status of ['ACTIVE','INACTIVE','DELETE_IN_PROGRESS'])definitions[status]=cli('ecs','list-task-definitions',['--family-prefix',P.family,'--status',status,'--max-results','100']);
    const inactive=assertDefinitions(definitions);
    const logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);must(!logs.nextToken&&!logs.logGroups?.some(g=>g.logGroupName===P.logGroup),'LOGS_OCCUPIED');
    const linked=[];for(const name of ['AWSServiceRoleForECS','AWSServiceRoleForElasticLoadBalancing']){const r=cli('iam','get-role',['--role-name',name]).Role;
      must(r?.RoleId&&r.Arn.includes(':role/aws-service-role/'),'LINKED_ROLE');linked.push({name,id:r.RoleId,arn:r.Arn});}
    const budget=cli('budgets','describe-budget',['--account-id',P.account,'--budget-name','techlong-sandbox-402010193138-ca-central-1']).Budget;
    must(Number(budget?.BudgetLimit?.Amount)===50&&budget.BudgetLimit.Unit==='USD'&&budget.TimeUnit==='MONTHLY','BUDGET');
    const baseline={supply:s,hostingNamesAbsent:true,previousStackId:previous.StackId,previousStackStatus:previous.StackStatus,
      image:{digest:H.imageDigest,configDigest:doc.config.digest,size:image.imageDetails[0].imageSizeInBytes},
      network:{vpc:P.vpc,subnets:sort(sub.map(x=>({id:x.SubnetId,az:x.AvailabilityZone}))),routeTable:P.routeTable,igw:P.igw},
      certificate:{arn:P.certificate,status:cert.Status,notAfter:cert.NotAfter},serviceLinkedRoles:linked,budget:{limitUsd:50,hardCap:false},
      retired:{cluster:missing?'MISSING':'INACTIVE',active:0,deleting:0,running:0,inactiveDefinitions:inactive}};
    assertBaseline(baseline);return {observedAtUtc:new Date().toISOString(),baseline};
  }
  async function observe({nonce,stackId,hostingExpiresAt,controlLease}){
    const c=client();try{const st=await stack(c);if(!st)return {verified:false,present:false};
      const list=await read(c,new C.ListStackResourcesCommand({StackName:st.StackId}));must(!list.NextToken,'RESOURCE_PAGE');
      const resources=(list.StackResourceSummaries??[]).map(x=>({id:x.LogicalResourceId,type:x.ResourceType,status:x.ResourceStatus,physicalId:x.PhysicalResourceId}));
      if(!stackId||st.StackId!==stackId||st.StackStatus!=='CREATE_COMPLETE')return {verified:false,present:true,stackId:st.StackId,status:st.StackStatus,resources};
      must(stackId!==H.previousStackId&&same(controlLease,lease(controlLease?.issuedAt))&&hostingExpiresAt===new Date(controlLease.issuedAt+H.hostingMs).toISOString(),'RUNTIME_BINDING');
      const doc=await read(c,new C.GetTemplateCommand({StackName:stackId,TemplateStage:'Original'})),intended=template(nonce);
      must(same(typeof doc.TemplateBody==='string'?JSON.parse(doc.TemplateBody):doc.TemplateBody,intended)&&!st.RoleARN&&
        same(sort(st.Parameters?.map(p=>({ParameterKey:p.ParameterKey,ParameterValue:p.ParameterValue}))??[]),sort([
          {ParameterKey:'HostingExpiresAt',ParameterValue:hostingExpiresAt},{ParameterKey:'ControllerLease',ParameterValue:canonical(controlLease)}]))&&
        same(sort(st.Tags??[]),sort(tags(nonce,hostingExpiresAt)))&&resources.length===11&&resources.every(x=>x.status==='CREATE_COMPLETE'&&x.physicalId&&intended.Resources[x.id]?.Type===x.type),'STACK_EXACT');
      const ids=Object.fromEntries(resources.map(x=>[x.id,x.physicalId]));must(!H.retiredTaskDefinitions.includes(ids.TaskDefinition),'OLD_DEFINITION');
      const lb=cli('elbv2','describe-load-balancers',['--load-balancer-arns',ids.LoadBalancer]).LoadBalancers;
      must(lb?.length===1&&lb[0].LoadBalancerArn===ids.LoadBalancer&&lb[0].LoadBalancerName===P.alb&&lb[0].State.Code==='active'&&lb[0].VpcId===P.vpc&&
        lb[0].Type==='application'&&lb[0].Scheme==='internet-facing'&&lb[0].IpAddressType==='ipv4'&&same(lb[0].SecurityGroups,[ids.AlbSecurityGroup])&&same(sort(lb[0].AvailabilityZones.map(z=>z.SubnetId)),sort(P.subnets)),'ALB');
      const listeners=cli('elbv2','describe-listeners',['--load-balancer-arn',ids.LoadBalancer]);const l=listeners.Listeners?.[0];
      must(!listeners.NextMarker&&listeners.Listeners?.length===1&&l.ListenerArn===ids.HttpsListener&&l.Port===443&&l.Protocol==='HTTPS'&&l.SslPolicy===P.sslPolicy&&
        same(l.Certificates,[{CertificateArn:P.certificate}])&&l.DefaultActions?.length===1&&l.DefaultActions[0].Type==='forward'&&l.DefaultActions[0].TargetGroupArn===ids.TargetGroup,'LISTENER');
      const sv=cli('ecs','describe-services',['--cluster',P.cluster,'--services',P.service]);must(sv.services?.length===1&&!sv.failures?.length,'SERVICE_COUNT');
      const d=cli('ecs','describe-task-definition',['--task-definition',ids.TaskDefinition]).taskDefinition;
      const running=cli('ecs','list-tasks',['--cluster',P.cluster,'--service-name',P.service,'--desired-status','RUNNING']);must(!running.nextToken&&running.taskArns?.length===1,'TASK_COUNT');
      const tasks=cli('ecs','describe-tasks',['--cluster',P.cluster,'--tasks',running.taskArns[0]]);must(tasks.tasks?.length===1&&!tasks.failures?.length,'TASK_COUNT');
      const targets=cli('elbv2','describe-target-health',['--target-group-arn',ids.TargetGroup]).TargetHealthDescriptions;
      runtime({service:sv.services[0],definition:d,task:tasks.tasks[0],targets,ids,nonce,controlLease});
      assertGroups(cli('ec2','describe-security-groups',['--group-ids',ids.TaskSecurityGroup,ids.AlbSecurityGroup]).SecurityGroups,ids);
      const logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);
      must(!logs.nextToken&&logs.logGroups?.filter(g=>g.logGroupName===P.logGroup&&g.retentionInDays===7).length===1,'LOG_RETENTION');
      const dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);
      const records=dns.ResourceRecordSets?.filter(r=>r.Name.toLowerCase().replace(/\.$/,'')===P.domain&&['A','AAAA','CNAME'].includes(r.Type));
      must(records?.length===1&&records[0].Type==='A'&&records[0].AliasTarget?.DNSName.replace(/\.$/,'')===lb[0].DNSName.replace(/\.$/,'')&&
        records[0].AliasTarget.HostedZoneId===lb[0].CanonicalHostedZoneId&&records[0].AliasTarget.EvaluateTargetHealth===true,'DNS');
      await assertSupplyFresh();return {verified:true,stackId,status:st.StackStatus,resources,taskArn:tasks.tasks[0].taskArn,imageDigest:H.imageDigest,
        healthy:true,controlLease,hostingExpiresAt,observedAtUtc:new Date().toISOString(),controlAcceptancePassed:false};
    }finally{c.destroy();}}
  return {inventory,observe,stack,assertSupply:assertSupplyFresh,source:()=>supply.source(),
    counts:()=>({metadata:counts.metadata+supply.counts.metadata,writes:counts.writes+supply.counts.writes}),
    startWrites(deadline){must(allowedUntil===0&&Number.isSafeInteger(deadline)&&deadline>Date.now()&&deadline-Date.now()<=H.runMs,'WRITE_WINDOW');allowedUntil=deadline;},
    async validate(nonce){const v=await read(cfn,new C.ValidateTemplateCommand({TemplateBody:canonical(template(nonce))}));
      must(!(v.Capabilities??[]).length&&same((v.Parameters??[]).map(p=>p.ParameterKey).sort(),['ControllerLease','HostingExpiresAt'])&&v.Parameters.every(p=>!p.DefaultValue),'TEMPLATE_VALIDATION');
      return {validated:true,parameters:['ControllerLease','HostingExpiresAt'],capabilities:[]};},
    async create(nonce,expiry,l){must(counts.writes===0&&Date.now()<allowedUntil&&same(l,lease(l?.issuedAt))&&Date.now()>=l.issuedAt&&Date.now()-l.issuedAt<30000&&expiry===new Date(l.issuedAt+H.hostingMs).toISOString(),'CREATE_WINDOW');
      must(new RegExp(template(nonce).Parameters.HostingExpiresAt.AllowedPattern).test(expiry),'EXPIRY');counts.writes++;
      const r=await cfn.send(new C.CreateStackCommand({StackName:P.hostingStack,TemplateBody:canonical(template(nonce)),
        Parameters:[{ParameterKey:'HostingExpiresAt',ParameterValue:expiry},{ParameterKey:'ControllerLease',ParameterValue:canonical(l)}],
        DisableRollback:true,TimeoutInMinutes:20,Tags:tags(nonce,expiry),ClientRequestToken:'platform-hosted-'+nonce}),{abortSignal:AbortSignal.timeout(30000)});
      must(new RegExp(`^arn:aws:cloudformation:${P.region}:${P.account}:stack/${P.hostingStack}/[a-f0-9-]{36}$`).test(r.StackId??'')&&r.StackId!==H.previousStackId,'CREATE_ACK');return r.StackId;},
    close(){cfn.destroy();supply.close();}};
}
