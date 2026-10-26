// Fixed-target metadata only unless a reviewed one-shot UpdateStack is enabled.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {awsEnvironment} from '../platform-web-credential-v1/aws.mjs';
import {readMetadataJson} from '../platform-hosted-window-v6/cloud.mjs';
import {H as A} from '../platform-hosted-access-v6/contract.mjs';
import {H as D} from '../platform-hosted-deploy-v6/contract.mjs';
import {T,P,BEFORE,hash,same,must,request,validate,verifyObserved,baseline} from './plan.mjs';
const req=createRequire(new URL('../cloud-worker/package.json',import.meta.url));
const C=req('@aws-sdk/client-cloudformation'),E=req('@aws-sdk/client-ecs'),I=req('@aws-sdk/client-iam'),S=req('@aws-sdk/client-secrets-manager'),
  L=req('@aws-sdk/client-elastic-load-balancing-v2'),G=req('@aws-sdk/client-cloudwatch-logs'),R=req('@aws-sdk/client-route-53'),X=req('@aws-sdk/client-ecr'),Q=req('@aws-sdk/client-sts');
const decode=v=>typeof v==='string'?JSON.parse(decodeURIComponent(v)):v;
export function createCloud({manifest,approved,readOnly=true,metadataLimit=65,record=async()=>{}}={}){
  awsEnvironment();const provider=fromLoginCredentials({profile:P.profile,ignoreCache:true});
  const config=(endpoint,region=P.region)=>({region,credentials:provider,maxAttempts:1,ignoreConfiguredEndpointUrls:true,endpoint,
    requestHandler:new NodeHttpHandler({httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})});
  const clients={cfn:new C.CloudFormationClient(config('https://cloudformation.ca-central-1.amazonaws.com')),
    ecs:new E.ECSClient(config('https://ecs.ca-central-1.amazonaws.com')),iam:new I.IAMClient(config('https://iam.amazonaws.com','us-east-1')),
    sm:new S.SecretsManagerClient(config('https://secretsmanager.ca-central-1.amazonaws.com')),elb:new L.ElasticLoadBalancingV2Client(config('https://elasticloadbalancing.ca-central-1.amazonaws.com')),
    logs:new G.CloudWatchLogsClient(config('https://logs.ca-central-1.amazonaws.com')),dns:new R.Route53Client(config('https://route53.amazonaws.com','us-east-1')),
    ecr:new X.ECRClient(config('https://api.ecr.ca-central-1.amazonaws.com')),sts:new Q.STSClient(config('https://sts.ca-central-1.amazonaws.com'))};
  const counts={sts:0,metadata:0,writes:0};let identity=null;
  const call=(client,cmd)=>{must(++counts.metadata<=metadataLimit,'METADATA_BUDGET');return clients[client].send(cmd,{abortSignal:AbortSignal.timeout(30000)});};
  async function source(){if(identity)return identity;must(++counts.sts===1,'STS_BUDGET');const v=await clients.sts.send(new Q.GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
    must(v.Account===P.account&&v.Arn===P.sourceArn&&v.UserId===P.sourceId,'SOURCE_IDENTITY');identity={Account:v.Account,Arn:v.Arn,UserId:v.UserId};return identity;}
  const cli=(service,op,args)=>{must((service==='ec2'&&op==='describe-security-groups')||(service==='kms'&&op==='describe-key'),'CLI_READ_ONLY');
    must(++counts.metadata<=metadataLimit,'METADATA_BUDGET');return readMetadataJson(service,op,()=>execFileSync('aws.exe',[service,op,...args,'--profile',P.profile,'--region',P.region,
      '--endpoint-url','https://'+service+'.ca-central-1.amazonaws.com','--output','json','--no-cli-pager','--no-paginate'],
      {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:3000000,stdio:['ignore','pipe','pipe'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:''}}));};
  async function secret(arn){const [d,p,v]=await Promise.all([call('sm',new S.DescribeSecretCommand({SecretId:arn})),call('sm',new S.GetResourcePolicyCommand({SecretId:arn})),
    call('sm',new S.ListSecretVersionIdsCommand({SecretId:arn,IncludeDeprecated:true,MaxResults:100}))]);return {arn:d.ARN,name:d.Name,kmsArn:d.KmsKeyId??null,deleted:!!d.DeletedDate,
    rotation:!!d.RotationEnabled,replicas:d.ReplicationStatus?.length??0,complete:!v.NextToken,stages:d.VersionIdsToStages??{},versions:(v.Versions??[]).map(x=>({id:x.VersionId,stages:x.VersionStages??[]})),
    policy:p.ResourcePolicy?JSON.parse(p.ResourcePolicy):null,tags:[...(d.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key))};}
  async function supply(){const [r,b,i,n,m,p,st,t,rs,cs,web,controller,app]=await Promise.all([
    call('iam',new I.GetRoleCommand({RoleName:A.role})),call('iam',new I.GetPolicyCommand({PolicyArn:A.boundaryArn})),call('iam',new I.GetRolePolicyCommand({RoleName:A.role,PolicyName:A.inline})),
    call('iam',new I.ListRolePoliciesCommand({RoleName:A.role})),call('iam',new I.ListAttachedRolePoliciesCommand({RoleName:A.role})),call('iam',new I.ListPolicyVersionsCommand({PolicyArn:A.boundaryArn})),
    call('cfn',new C.DescribeStacksCommand({StackName:A.stackId})),call('cfn',new C.GetTemplateCommand({StackName:A.stackId,TemplateStage:'Original'})),
    call('cfn',new C.ListStackResourcesCommand({StackName:A.stackId})),call('cfn',new C.ListChangeSetsCommand({StackName:A.stackId})),secret(P.secretArn),secret(D.controllerArn),secret(D.appArn)]);
    const d=await call('iam',new I.GetPolicyVersionCommand({PolicyArn:A.boundaryArn,VersionId:b.Policy.DefaultVersionId})),role=r.Role,policy=b.Policy,stack=st.Stacks[0];
    const k=cli('kms','describe-key',['--key-id',A.kmsArn]).KeyMetadata;
    return {source:identity,web,controller,app,kms:{arn:k.Arn,manager:k.KeyManager,enabled:k.Enabled===true&&k.KeyState==='Enabled'},pendingComplete:!cs.NextToken,
      pendingChangeSets:(cs.Summaries??[]).map(x=>({id:x.ChangeSetId,status:x.Status,execution:x.ExecutionStatus})),
      access:{stackId:stack.StackId,status:stack.StackStatus,stackRoleArn:stack.RoleARN??null,parameters:stack.Parameters??[],template:decode(t.TemplateBody),roleId:role.RoleId,roleArn:role.Arn,
        path:role.Path,maxSessionDuration:role.MaxSessionDuration,roleBoundaryArn:role.PermissionsBoundary?.PermissionsBoundaryArn??null,
        roleTags:[...(role.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)),trust:decode(role.AssumeRolePolicyDocument),policyId:policy.PolicyId,boundaryArn:policy.Arn,
        attachmentCount:policy.AttachmentCount,boundaryUsageCount:policy.PermissionsBoundaryUsageCount,defaultVersion:policy.DefaultVersionId,
        policyVersions:(p.Versions??[]).map(x=>x.VersionId).sort(),inline:decode(i.PolicyDocument),boundary:decode(d.PolicyVersion.Document),inlineNames:n.PolicyNames??[],managed:m.AttachedPolicies??[],
        listsComplete:n.IsTruncated===false&&m.IsTruncated===false&&p.IsTruncated===false&&!rs.NextToken,
        resources:(rs.StackResourceSummaries??[]).map(x=>({logicalId:x.LogicalResourceId,type:x.ResourceType,physicalId:x.PhysicalResourceId,status:x.ResourceStatus})).sort((a,b)=>a.logicalId.localeCompare(b.logicalId))}};
  }
  async function read(){await source();const v={};[v.stack,v.resources,v.template,v.events]=await Promise.all([
    call('cfn',new C.DescribeStacksCommand({StackName:T.stackId})),call('cfn',new C.ListStackResourcesCommand({StackName:T.stackId})),
    call('cfn',new C.GetTemplateCommand({StackName:T.stackId,TemplateStage:'Original'})),call('cfn',new C.DescribeStackEventsCommand({StackName:T.stackId}))]);
    const ids=Object.fromEntries((v.resources.StackResourceSummaries??[]).map(r=>[r.LogicalResourceId,r.PhysicalResourceId]));
    must(v.stack.Stacks?.[0]?.StackId===T.stackId&&Object.keys(ids).length===11&&Object.entries(BEFORE.ids).every(([k,id])=>k==='TaskDefinition'||ids[k]===id),'READ_TARGETS');
    [v.lb,v.listeners,v.service,v.definition,v.running,v.targets,v.logs,v.dns,v.supply]=await Promise.all([
      call('elb',new L.DescribeLoadBalancersCommand({LoadBalancerArns:[ids.LoadBalancer]})),call('elb',new L.DescribeListenersCommand({LoadBalancerArn:ids.LoadBalancer})),
      call('ecs',new E.DescribeServicesCommand({cluster:P.cluster,services:[P.service]})),call('ecs',new E.DescribeTaskDefinitionCommand({taskDefinition:ids.TaskDefinition})),
      call('ecs',new E.ListTasksCommand({cluster:P.cluster,serviceName:P.service,desiredStatus:'RUNNING'})),call('elb',new L.DescribeTargetHealthCommand({TargetGroupArn:ids.TargetGroup})),
      call('logs',new G.DescribeLogGroupsCommand({logGroupNamePrefix:P.logGroup,limit:50})),call('dns',new R.ListResourceRecordSetsCommand({HostedZoneId:P.hostedZone,StartRecordName:P.domain,StartRecordType:'A',MaxItems:100})),supply()]);
    must(!v.running.nextToken&&v.running.taskArns?.length===1,'RUNNING_COUNT');v.tasks=await call('ecs',new E.DescribeTasksCommand({cluster:P.cluster,tasks:v.running.taskArns}));
    v.groups=cli('ec2','describe-security-groups',['--group-ids',ids.TaskSecurityGroup,ids.AlbSecurityGroup]);
    const [p,c]=await Promise.all([call('cfn',new C.GetStackPolicyCommand({StackName:T.stackId})),call('cfn',new C.ListChangeSetsCommand({StackName:T.stackId}))]);must(!c.NextToken,'CHANGE_SET_PAGE');
    const definitions={};for(const status of ['ACTIVE','INACTIVE','DELETE_IN_PROGRESS']){const a=await call('ecs',new E.ListTaskDefinitionsCommand({familyPrefix:P.family,status,maxResults:100}));must(!a.nextToken,'DEFINITION_PAGE');definitions[status]=a.taskDefinitionArns??[];}
    return {rawMetadata:v,extra:{stackPolicy:p.StackPolicyBody?JSON.parse(p.StackPolicyBody):null,changeSets:c.Summaries??[],definitions}};
  }
  return {counts,
    async snapshot(){const checkedAt=Date.now(),v=await read();await record('raw-readback',v);const proof=await verifyObserved(v.rawMetadata,v.extra,{controlLease:BEFORE.oldLease});
      const permissions=[];for(const action of ['cloudformation:UpdateStack','cloudformation:SetStackPolicy']){const r=await call('iam',new I.SimulatePrincipalPolicyCommand({PolicySourceArn:P.sourceArn,ActionNames:[action],ResourceArns:[T.stackId],
        ContextEntries:[{ContextKeyName:'aws:RequestedRegion',ContextKeyValues:[P.region],ContextKeyType:'string'}]}));const e=r.EvaluationResults?.[0];
        must(!r.IsTruncated&&r.EvaluationResults?.length===1&&e.EvalActionName===action&&e.EvalDecision==='allowed'&&!(e.MissingContextValues??[]).length,'PERMISSION');permissions.push({action,decision:e.EvalDecision});}
      const response=await call('ecr',new X.BatchGetImageCommand({registryId:P.account,repositoryName:P.repository,imageIds:[{imageDigest:T.imageDigest}],acceptedMediaTypes:['application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json']}));
      const image=response.images?.[0],body=image?.imageManifest;must(!response.failures?.length&&response.images?.length===1&&image.imageId?.imageDigest===T.imageDigest&&
        'sha256:'+hash(body)===T.imageDigest&&JSON.parse(body).config?.digest===T.configDigest,'ECR_MANIFEST');
      return {...v,checkedAt,permissions,proof,image:{digest:T.imageDigest,configDigest:T.configDigest,rawManifest:response},baseline:baseline(v.rawMetadata,v.extra,proof),counts:{...counts}};
    },
    async update(input){must(!readOnly&&manifest&&approved&&counts.writes===0,'WRITE_DISABLED');validate(manifest,approved,Date.now());const at=JSON.parse(input.Parameters.find(p=>p.ParameterKey==='ControllerLease').ParameterValue).issuedAt;
      must(identity&&Date.now()>=at&&Date.now()-at<30000&&same(input,request(manifest,at)),'EXACT_UPDATE');counts.writes++;
      const r=await clients.cfn.send(new C.UpdateStackCommand(input),{abortSignal:AbortSignal.timeout(30000)});return {StackId:r.StackId,sdkAttempts:r.$metadata?.attempts??null};},
    async stack(){const r=await call('cfn',new C.DescribeStacksCommand({StackName:T.stackId}));must(r.Stacks?.length===1,'STACK_COUNT');return {StackId:r.Stacks[0].StackId,StackStatus:r.Stacks[0].StackStatus,LastUpdatedTime:r.Stacks[0].LastUpdatedTime};},
    async observe(intent){const v=await read();await record('observed-readback',v);
      const proof=await verifyObserved(v.rawMetadata,v.extra,{source:manifest.sourceCommit,controlLease:intent.controlLease,updated:true,
      intentAt:intent.intentAt,token:intent.request.ClientRequestToken,priorInactive:manifest.before.inactive});return {...v,proof,counts:{...counts}};},
    close(){for(const c of Object.values(clients))c.destroy();},
  };
}
