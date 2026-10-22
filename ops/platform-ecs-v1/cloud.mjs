// No Secret value/Neon client. All discovery is metadata; writes are access-only.
import {execFileSync} from 'node:child_process';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {CloudFormationClient,CreateStackCommand,DescribeStacksCommand,GetTemplateCommand,ListStackResourcesCommand,ValidateTemplateCommand} from '@aws-sdk/client-cloudformation';
import {SecretsManagerClient,DescribeSecretCommand,GetResourcePolicyCommand,ListSecretVersionIdsCommand,PutResourcePolicyCommand,ValidateResourcePolicyCommand} from '@aws-sdk/client-secrets-manager';
import {IAMClient,GetRoleCommand,GetPolicyCommand,GetPolicyVersionCommand,ListAttachedRolePoliciesCommand,ListRolePoliciesCommand,GetRolePolicyCommand} from '@aws-sdk/client-iam';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {sourceOnlyPolicy} from '../platform-web-credential-v1/contract.mjs';
import {P,must,same,canonical,policySame,handoffPolicy} from './contract.mjs';
import {accessTemplate,executionPolicy,trust,tags} from './templates.mjs';
export function assertPublicRoutes(tables){
  const rt=tables.find(r=>r.RouteTableId===P.routeTable);must(rt?.VpcId===P.vpc&&rt.Routes.some(r=>r.DestinationCidrBlock==='0.0.0.0/0'&&r.GatewayId===P.igw&&r.State==='active'),'PUBLIC_ROUTES');
  for(const id of P.subnets){const explicit=tables.filter(r=>r.Associations.some(a=>a.SubnetId===id&&a.AssociationState?.State==='associated'));
    must(explicit.length===1?explicit[0].RouteTableId===P.routeTable:explicit.length===0&&rt.Associations.some(a=>a.Main===true&&a.AssociationState?.State==='associated'),'SUBNET_ROUTE_OVERRIDE');}
}
export function cloud(){
  awsEnvironment();const cfg={region:P.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:P.profile,ignoreCache:true})};
  const sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'}),cfn=new CloudFormationClient({...cfg,endpoint:'https://cloudformation.ca-central-1.amazonaws.com',
    requestHandler:new NodeHttpHandler({httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})}),
    sm=new SecretsManagerClient({...cfg,endpoint:'https://secretsmanager.ca-central-1.amazonaws.com'}),iam=new IAMClient({...cfg,region:'us-east-1',endpoint:'https://iam.amazonaws.com'});
  const counts={reads:0,writes:0};
  const send=async(client,cmd,write=false)=>{counts[write?'writes':'reads']++;must(counts.writes<=2,'WRITE_LIMIT');
    try{return await client.send(cmd,{abortSignal:AbortSignal.timeout(30000)});}catch(e){e.operation=cmd.constructor.name;throw e;}};
  const cli=(service,operation,args=[])=>{counts.reads++;const endpoints={ec2:'ec2.ca-central-1.amazonaws.com',elbv2:'elasticloadbalancing.ca-central-1.amazonaws.com',
    ecr:'api.ecr.ca-central-1.amazonaws.com',ecs:'ecs.ca-central-1.amazonaws.com',logs:'logs.ca-central-1.amazonaws.com',route53:'route53.amazonaws.com',
    acm:'acm.ca-central-1.amazonaws.com',kms:'kms.ca-central-1.amazonaws.com',accessanalyzer:'access-analyzer.ca-central-1.amazonaws.com',budgets:'budgets.amazonaws.com'};
    must(endpoints[service]&&/^(describe-|list-|get-|validate-)/.test(operation),'READ_OPERATION');
    try{return JSON.parse(execFileSync('aws.exe',[service,operation,...args,'--profile',P.profile,'--region',['route53','budgets'].includes(service)?'us-east-1':P.region,'--endpoint-url','https://'+endpoints[service],
      '--output','json','--no-cli-pager','--no-paginate'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,
      stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));}
    catch(e){const text=String(e.stderr??'');const code=text.match(/An error occurred \(([A-Za-z0-9_.]+)\)/)?.[1];
      const safe=Error('PLATFORM_ECS_CLI_READ_FAILED');safe.name=code??'AwsCliReadUnavailable';safe.operation=service+'-'+operation;throw safe;}};
  async function source(){const r=await send(sts,new GetCallerIdentityCommand({}));must(r.Account===P.account&&r.Arn===P.sourceArn&&r.UserId===P.sourceId,'SOURCE');return {Account:r.Account,Arn:r.Arn,UserId:r.UserId};}
  async function stack(name){try{const r=await send(cfn,new DescribeStacksCommand({StackName:name}));must(r.Stacks?.length===1,'STACK_COUNT');return r.Stacks[0];}
    catch(e){if(e.name==='ValidationError'&&/does not exist/.test(e.message))return null;throw e;}}
  async function optionalRole(name){try{return (await send(iam,new GetRoleCommand({RoleName:name}))).Role;}catch(e){if(e.name==='NoSuchEntityException'||e.name==='NoSuchEntity')return null;throw e;}}
  async function optionalPolicy(){try{return (await send(iam,new GetPolicyCommand({PolicyArn:P.boundaryArn}))).Policy;}catch(e){if(e.name==='NoSuchEntityException'||e.name==='NoSuchEntity')return null;throw e;}}
  async function secret(expectedPolicy){const d=await send(sm,new DescribeSecretCommand({SecretId:P.secretArn})),p=await send(sm,new GetResourcePolicyCommand({SecretId:P.secretArn})),
    v=await send(sm,new ListSecretVersionIdsCommand({SecretId:P.secretArn,IncludeDeprecated:true,MaxResults:100}));
    const expectedTags=[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-neon-v1'},{Key:'ReviewSha256',Value:P.secretReviewSha}];
    must(d.ARN===P.secretArn&&!d.DeletedDate&&!d.RotationEnabled&&!d.ReplicationStatus?.length&&d.KmsKeyId===P.kmsArn&&
      same([...(d.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),expectedTags.sort((a,b)=>a.Key.localeCompare(b.Key)))&&
      same(d.VersionIdsToStages,{[P.secretVersion]:['AWSCURRENT']})&&v.ARN===P.secretArn&&!v.NextToken&&v.Versions?.length===1&&
      v.Versions[0].VersionId===P.secretVersion&&same(v.Versions[0].VersionStages,['AWSCURRENT'])&&(!expectedPolicy||policySame(p.ResourcePolicy,expectedPolicy)),'SECRET_METADATA');
    return {arn:d.ARN,versionId:P.secretVersion,kmsArn:d.KmsKeyId,tags:d.Tags,policy:JSON.parse(p.ResourcePolicy),valuesRead:false};}
  async function accessAbsent(){must(!(await stack(P.accessStack))&&!(await optionalRole(P.role))&&!(await optionalPolicy()),'ACCESS_NAMES_OCCUPIED');return true;}
  async function accessPrestate(){const who=await source();await accessAbsent();const s=await secret(sourceOnlyPolicy());
    const k=cli('kms','describe-key',['--key-id',P.kmsArn]).KeyMetadata;must(k?.Arn===P.kmsArn&&k.KeyManager==='AWS'&&k.Enabled&&k.KeyState==='Enabled','KMS');
    return {source:who,accessNamesAbsent:true,secret:s,kms:{arn:k.Arn,keyManager:k.KeyManager}};}
  async function inventory(){const access=await accessPrestate();
    const image=cli('ecr','describe-images',['--repository-name',P.repository,'--image-ids','imageDigest='+P.imageDigest]);must(image.imageDetails?.length===1&&image.imageDetails[0].imageDigest===P.imageDigest,'IMAGE');
    const v=cli('ec2','describe-vpcs',['--vpc-ids',P.vpc]).Vpcs;must(v?.length===1&&v[0].State==='available','VPC');
    for(const name of ['enableDnsSupport','enableDnsHostnames'])must(cli('ec2','describe-vpc-attribute',['--vpc-id',P.vpc,'--attribute',name])[name[0].toUpperCase()+name.slice(1)]?.Value===true,'VPC_DNS');
    const sub=cli('ec2','describe-subnets',['--subnet-ids',...P.subnets]).Subnets;must(sub?.length===2&&new Set(sub.map(s=>s.AvailabilityZone)).size===2&&
      sub.every(s=>P.subnets.includes(s.SubnetId)&&s.VpcId===P.vpc&&s.State==='available'&&s.AvailableIpAddressCount>=8),'SUBNETS');
    const routes=cli('ec2','describe-route-tables',['--filters','Name=vpc-id,Values='+P.vpc]);must(!routes.NextToken&&Array.isArray(routes.RouteTables),'ROUTE_PAGINATION');assertPublicRoutes(routes.RouteTables);
    const igw=cli('ec2','describe-internet-gateways',['--internet-gateway-ids',P.igw]).InternetGateways;
    must(igw?.length===1&&igw[0].Attachments.some(a=>a.VpcId===P.vpc&&['available','attached'].includes(a.State)),'IGW');
    const acl=cli('ec2','describe-network-acls',['--filters','Name=vpc-id,Values='+P.vpc]).NetworkAcls;
    must(P.subnets.every(id=>acl?.some(a=>a.IsDefault&&a.Associations.some(s=>s.SubnetId===id)&&[false,true].every(egress=>a.Entries.some(e=>e.Egress===egress&&e.RuleNumber===100&&e.RuleAction==='allow'&&e.Protocol==='-1'&&e.CidrBlock==='0.0.0.0/0')))),'NETWORK_ACL_REVIEW');
    const cert=cli('acm','describe-certificate',['--certificate-arn',P.certificate]).Certificate;
    must(cert?.Status==='ISSUED'&&Date.parse(cert.NotAfter)>Date.now()+7*86400000&&cert.SubjectAlternativeNames?.some(n=>n===P.domain||n==='*.sandbox.techlong.cloud'),'CERTIFICATE');
    const zone=cli('route53','get-hosted-zone',['--id',P.hostedZone]);must(zone.HostedZone?.Name==='sandbox.techlong.cloud.'&&!zone.HostedZone.Config.PrivateZone,'ZONE');
    const dns=cli('route53','list-resource-record-sets',['--hosted-zone-id',P.hostedZone,'--start-record-name',P.domain,'--start-record-type','A']);
    must(!dns.ResourceRecordSets?.some(r=>r.Name.toLowerCase()===P.domain+'.'&&['A','AAAA','CNAME'].includes(r.Type)),'DNS_OCCUPIED');
    must(!(await stack(P.hostingStack)),'HOSTING_STACK_OCCUPIED');
    for(const [op,arg,name,notFound]of [['describe-load-balancers','--names',P.alb,'LoadBalancerNotFound'],['describe-target-groups','--names',P.targetGroup,'TargetGroupNotFound']]){
      let missing=false;try{cli('elbv2',op,[arg,name]);}catch(e){if(e.name===notFound)missing=true;else throw e;}must(missing,'HOSTING_ELB_NAME_OCCUPIED');}
    const cluster=cli('ecs','describe-clusters',['--clusters',P.cluster]);must(cluster.clusters?.length===0&&cluster.failures?.length===1&&cluster.failures[0].reason==='MISSING','CLUSTER_OCCUPIED');
    const logs=cli('logs','describe-log-groups',['--log-group-name-prefix',P.logGroup,'--limit','50']);must(!logs.nextToken&&!logs.logGroups?.some(g=>g.logGroupName===P.logGroup),'LOG_GROUP_OCCUPIED');
    const linked=[];for(const name of ['AWSServiceRoleForECS','AWSServiceRoleForElasticLoadBalancing']){const role=await optionalRole(name);must(role?.RoleId,'SERVICE_LINKED_ROLE');linked.push({name,id:role.RoleId,arn:role.Arn});}
    const budget=cli('budgets','describe-budget',['--account-id',P.account,'--budget-name','techlong-sandbox-402010193138-ca-central-1']).Budget;
    must(Number(budget?.BudgetLimit?.Amount)===50&&budget.BudgetLimit.Unit==='USD'&&budget.TimeUnit==='MONTHLY','BUDGET_TARGET');
    return {...access,checkedAtUtc:new Date().toISOString(),hostingNamesAbsent:true,
      image:{digest:P.imageDigest,size:image.imageDetails[0].imageSizeInBytes,pushedAt:image.imageDetails[0].imagePushedAt},
      network:{vpc:P.vpc,cidr:v[0].CidrBlock,subnets:sub.map(s=>({id:s.SubnetId,az:s.AvailabilityZone})).sort((a,b)=>a.id.localeCompare(b.id)),routeTable:P.routeTable,igw:P.igw,defaultAclConfirmed:true},
      certificate:{arn:P.certificate,status:cert.Status,notAfter:cert.NotAfter,domains:cert.SubjectAlternativeNames},zone:{id:P.hostedZone,name:zone.HostedZone.Name},serviceLinkedRoles:linked,
      budget:{name:budget.BudgetName,limitUsd:50,timeUnit:'MONTHLY',hardCap:false}};}
  async function inspectAccess(nonce,stackId){
    const st=await stack(P.accessStack);must(st?.StackId===stackId&&st.StackStatus==='CREATE_COMPLETE','ACCESS_STACK_COMPLETE');
    const resources=await send(cfn,new ListStackResourcesCommand({StackName:stackId})),template=await send(cfn,new GetTemplateCommand({StackName:stackId,TemplateStage:'Original'}));
    must(!resources.NextToken&&resources.StackResourceSummaries?.length===2&&resources.StackResourceSummaries.every(r=>r.ResourceStatus==='CREATE_COMPLETE')&&
      same(typeof template.TemplateBody==='string'?JSON.parse(template.TemplateBody):template.TemplateBody,accessTemplate(nonce)),'ACCESS_CFN_RESOURCES');
    const role=await optionalRole(P.role),policy=await optionalPolicy(),attached=await send(iam,new ListAttachedRolePoliciesCommand({RoleName:P.role})),
      inline=await send(iam,new ListRolePoliciesCommand({RoleName:P.role})),doc=await send(iam,new GetRolePolicyCommand({RoleName:P.role,PolicyName:P.inline})),
      version=await send(iam,new GetPolicyVersionCommand({PolicyArn:P.boundaryArn,VersionId:'v1'}));
    const systemTags={'aws:cloudformation:stack-id':stackId,'aws:cloudformation:stack-name':P.accessStack,'aws:cloudformation:logical-id':'ExecutionRole'};
    must(role?.Arn===P.roleArn&&/^AROA[A-Z0-9]{17}$/.test(role.RoleId)&&role.Path==='/'&&role.MaxSessionDuration===3600&&
      role.PermissionsBoundary?.PermissionsBoundaryArn===P.boundaryArn&&policySame(role.AssumeRolePolicyDocument,trust())&&
      same((role.Tags??[]).filter(t=>!t.Key.startsWith('aws:')).sort((a,b)=>a.Key.localeCompare(b.Key)),tags(nonce).sort((a,b)=>a.Key.localeCompare(b.Key)))&&
      (role.Tags??[]).filter(t=>t.Key.startsWith('aws:')).every(t=>systemTags[t.Key]===t.Value)&&
      !attached.IsTruncated&&attached.AttachedPolicies?.length===0&&!inline.IsTruncated&&same(inline.PolicyNames,[P.inline])&&policySame(doc.PolicyDocument,executionPolicy())&&
      policy?.Arn===P.boundaryArn&&policy.DefaultVersionId==='v1'&&policy.AttachmentCount===0&&policy.PermissionsBoundaryUsageCount===1&&
      version.PolicyVersion?.IsDefaultVersion===true&&policySame(version.PolicyVersion.Document,executionPolicy()),'ACCESS_IAM_EXACT');
    must(resources.StackResourceSummaries.some(r=>r.LogicalResourceId==='ExecutionRole'&&r.PhysicalResourceId===P.role)&&
      resources.StackResourceSummaries.some(r=>r.LogicalResourceId==='ExecutionBoundary'&&r.PhysicalResourceId===P.boundaryArn),'ACCESS_PHYSICAL_IDS');
    return {stackId,stackStatus:st.StackStatus,roleArn:role.Arn,roleId:role.RoleId,boundaryArn:policy.Arn,boundaryId:policy.PolicyId,
      defaultVersion:'v1',trust:trust(),policy:executionPolicy(),tags:role.Tags};}
  return {counts,source,inventory,accessPrestate,accessAbsent,secret,stack,inspectAccess,
    async assertRoleId(roleId){const r=await optionalRole(P.role);must(r?.RoleId===roleId&&r.Arn===P.roleArn&&r.PermissionsBoundary?.PermissionsBoundaryArn===P.boundaryArn,'ROLE_ID_CHANGED');},
    async validateTemplates(a,h){const access=await send(cfn,new ValidateTemplateCommand({TemplateBody:canonical(a)})),hosting=await send(cfn,new ValidateTemplateCommand({TemplateBody:canonical(h)})),
      policy=await send(sm,new ValidateResourcePolicyCommand({SecretId:P.secretArn,ResourcePolicy:canonical(handoffPolicy())}));
      must(same(access.Capabilities,['CAPABILITY_NAMED_IAM'])&&(access.Parameters??[]).length===0&&!(hosting.Capabilities??[]).length&&
        hosting.Parameters?.length===1&&hosting.Parameters[0].ParameterKey==='HostingExpiresAt'&&policy.PolicyValidationPassed&&!policy.ValidationErrors?.length,'SERVICE_VALIDATION');
      return {accessCapabilities:access.Capabilities,hostingParameters:hosting.Parameters,secretPolicyValidated:true};},
    validateIdentityPolicy(file,trustDocument=false){const r=cli('accessanalyzer','validate-policy',['--policy-document','file://'+file,
      '--policy-type',trustDocument?'RESOURCE_POLICY':'IDENTITY_POLICY',...(trustDocument?['--validate-policy-resource-type','AWS::IAM::AssumeRolePolicyDocument']:[])]);
      must(!r.nextToken&&!r.findings?.some(f=>['ERROR','SECURITY_WARNING'].includes(f.findingType)),'POLICY_FINDINGS');return r;},
    async createAccess(nonce){const r=await send(cfn,new CreateStackCommand({StackName:P.accessStack,TemplateBody:canonical(accessTemplate(nonce)),Capabilities:['CAPABILITY_NAMED_IAM'],
      DisableRollback:true,Parameters:[],Tags:tags(nonce),ClientRequestToken:'platform-access-'+nonce}),true);must(typeof r.StackId==='string'&&r.StackId.startsWith(`arn:aws:cloudformation:${P.region}:${P.account}:stack/${P.accessStack}/`),'CREATE_ACK');return r.StackId;},
    async putHandoff(){const r=await send(sm,new PutResourcePolicyCommand({SecretId:P.secretArn,ResourcePolicy:canonical(handoffPolicy()),BlockPublicPolicy:true}),true);must(r.ARN===P.secretArn,'HANDOFF_ACK');},
    dispose(){for(const c of [sts,cfn,sm,iam])c.destroy();}
  };
}
