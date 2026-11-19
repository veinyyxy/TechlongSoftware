import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { Agent } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { identity } from '../platform-image-source-v2/aws.mjs';
import { parseCloudFormationTemplateDocument as parse } from '../aws-sandbox/scripts/cloudformation-template-document.mjs';
import { P, hash, canonical, same, policySame, handoffPolicy } from './contract.mjs';
import { H } from '../platform-hosted-access-v6/contract.mjs';
import { scope, draft, firstPurchaseOriginalTemplates, exactSecretArn, firstPurchaseSecretProtection } from './first-purchase-activation.mjs';

const require=createRequire(new URL('../cloud-worker/package.json',import.meta.url));
const codes={cfn:['cloudformation','cloudformation'],ecs:['ecs','ecs'],elb:['elastic-load-balancing-v2','elasticloadbalancing'],
  iam:['iam','iam','us-east-1'],dns:['route-53','route53','us-east-1'],sm:['secrets-manager','secretsmanager'],sts:['sts','sts'],
  ecr:['ecr','api.ecr']};
const libs=Object.fromEntries(Object.entries(codes).map(([k,[pkg]])=>[k,require('@aws-sdk/client-'+pkg)]));
const clients={cfn:'CloudFormation',ecs:'ECS',elb:'ElasticLoadBalancingV2',iam:'IAM',dns:'Route53',sm:'SecretsManager',sts:'STS',ecr:'ECR'};
const stable=['CREATE_COMPLETE','UPDATE_COMPLETE'];
const sha=v=>hash(canonical(v));
const check=(ok,code)=>{if(!ok)throw Error('FIRST_PURCHASE_AWS_'+code);};
const policy=x=>typeof x==='string'?JSON.parse(decodeURIComponent(x)):x;
const map=(a,k,v)=>Object.fromEntries((a??[]).map(x=>[x[k],x[v]]));
const host=s=>String(s??'').replace(/^dualstack\./,'').replace(/\.$/,'').toLowerCase();
const changeKind={
  ExecutionRole:['False','Policies'],ExecutionBoundary:['False','PolicyDocument'],
  TaskDefinition:['True','ContainerDefinitions'],Service:['False','TaskDefinition'],
};

export function firstPurchaseAws({deadline,nonce,versionId,prior,record,metadataLimit=185}){
  const old=firstPurchaseOriginalTemplates(),counts={metadata:0,sts:0,writes:0,https:0};
  const names={access:scope.expectedAccessStackId,hosting:scope.expectedHostingStackId},attempts=new Set();
  function session(){
    const credentials=fromLoginCredentials({profile:P.profile,ignoreCache:true});
    const sdk=Object.fromEntries(Object.entries(codes).map(([k,[,endpoint,global]])=>[k,new libs[k][clients[k]+'Client']({
      credentials,region:global??P.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,
      endpoint:`https://${endpoint}${global?'':'.'+P.region}.amazonaws.com`,requestHandler:new NodeHttpHandler({
        httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:15000})})]));
    async function send(k,operation,input,label){
      check(Date.now()+20000<deadline,'WINDOW_CLOSED');
      if(label){
        check(!attempts.has(label)&&++counts.writes<=7,'WRITE_LIMIT');attempts.add(label);
        await record(label+'-intent',{operation}); // no request body, credentials or SQL in the journal
      }else if(k==='sts')check(++counts.sts<=3,'STS_LIMIT');
      else check(++counts.metadata<=metadataLimit,'METADATA_LIMIT');
      return sdk[k].send(new libs[k][operation+'Command'](input),{abortSignal:AbortSignal.timeout(20000)});
    }
    return {send,source:async()=>identity(await send('sts','GetCallerIdentity',{})),close:()=>Object.values(sdk).forEach(x=>x.destroy())};
  }
  const writer=session();
  async function using(work){const c=session();try{return await work(c);}finally{c.close();}}
  const stack=async(c,id)=>{const r=await c.send('cfn','DescribeStacks',{StackName:id});
    check(!r.NextToken&&r.Stacks?.length===1&&r.Stacks[0].StackId===id,'STACK_ID');return r.Stacks[0];};
  const list=async(c,id)=>{const r=await c.send('cfn','ListChangeSets',{StackName:id});
    check(!r.NextToken&&Array.isArray(r.Summaries),'CHANGE_SET_LIST');return r.Summaries.filter(x=>['AVAILABLE','EXECUTE_IN_PROGRESS'].includes(x.ExecutionStatus)||/_PENDING$|_IN_PROGRESS$/.test(x.Status??''));};
  const template=async(c,id,cs)=>parse((await c.send('cfn','GetTemplate',{StackName:id,TemplateStage:'Original',...(cs?{ChangeSetName:cs}:{})})).TemplateBody);
  const stackState=s=>({epoch:new Date(s.LastUpdatedTime??s.CreationTime).toISOString(),role:s.RoleARN??null,
    tags:map(s.Tags,'Key','Value'),parameters:map(s.Parameters,'ParameterKey','ParameterValue'),outputs:map(s.Outputs,'OutputKey','OutputValue')});
  async function snapshot(c,which,t,{after=false,expected}={}){
    const id=names[which],s=await stack(c,id),state=stackState(s),saved=prior[which+'Stack'];
    check(stable.includes(s.StackStatus)&&state.role===null&&saved.id===id&&(!expected?s.StackStatus===saved.status:true)&&
      same(Object.keys(state.parameters).sort(),Object.keys(t.Parameters??{}).sort())&&
      same(Object.keys(state.outputs).sort(),Object.keys(t.Outputs??{}).sort()),'STACK_BASELINE');
    if(!after)check(sha(t)===saved.templateSha256,'ORIGINAL_TEMPLATE_NOT_BOUND');
    check(same(await template(c,id),t),'TEMPLATE');
    const r=await c.send('cfn','ListStackResources',{StackName:id}),rows=r.StackResourceSummaries??[],bindings=map(rows,'LogicalResourceId','PhysicalResourceId');
    check(!r.NextToken&&rows.length===Object.keys(t.Resources).length&&new Set(rows.map(x=>x.LogicalResourceId)).size===rows.length&&
      rows.every(x=>stable.includes(x.ResourceStatus)&&x.ResourceType===t.Resources[x.LogicalResourceId]?.Type&&(
        after&&which==='hosting'&&x.LogicalResourceId==='TaskDefinition'?
          x.PhysicalResourceId.startsWith(`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:`)&&Number(x.PhysicalResourceId.split(':').at(-1))>scope.observedWebTaskRevision
          :x.PhysicalResourceId===saved.physicalIds[x.LogicalResourceId])),'PHYSICAL_OWNERSHIP');
    if(expected)check(same({...state,epoch:null}, {...expected.state,epoch:null}),'RETAINED_STACK_STATE');
    return {state,bindings,stack:s};
  }
  async function role(c,t,{after=false}={}){
    const role=await c.send('iam','GetRole',{RoleName:P.role}), p=await c.send('iam','GetPolicy',{PolicyArn:P.boundaryArn});
    const names=await c.send('iam','ListRolePolicies',{RoleName:P.role}),attached=await c.send('iam','ListAttachedRolePolicies',{RoleName:P.role});
    const r=role.Role,b=p.Policy,priorRole=prior.webAccess;
    check(r?.RoleId===priorRole.roleId&&r.Arn===P.roleArn&&r.Path==='/'&&r.MaxSessionDuration===3600&&r.PermissionsBoundary?.PermissionsBoundaryArn===P.boundaryArn&&
      b?.PolicyId===H.boundaryId&&b.Arn===P.boundaryArn&&b.AttachmentCount===0&&b.PermissionsBoundaryUsageCount===1&&
      (after?b.DefaultVersionId!==priorRole.boundaryVersion:b.DefaultVersionId===priorRole.boundaryVersion)&&
      names.IsTruncated===false&&same(names.PolicyNames,[P.inline])&&attached.IsTruncated===false&&attached.AttachedPolicies?.length===0&&
      policySame(policy(r.AssumeRolePolicyDocument),t.Resources.ExecutionRole.Properties.AssumeRolePolicyDocument),'ROLE_BINDING');
    const inline=await c.send('iam','GetRolePolicy',{RoleName:P.role,PolicyName:P.inline});
    const v=await c.send('iam','GetPolicyVersion',{PolicyArn:P.boundaryArn,VersionId:b.DefaultVersionId});
    check(v.PolicyVersion?.IsDefaultVersion===true&&v.PolicyVersion.VersionId===b.DefaultVersionId&&
      policySame(policy(inline.PolicyDocument),t.Resources.ExecutionRole.Properties.Policies[0].PolicyDocument)&&
      policySame(policy(v.PolicyVersion.Document),t.Resources.ExecutionBoundary.Properties.PolicyDocument),'ROLE_EFFECTIVE_POLICY');
  }
  async function runHealth(c,hosting,b){
    const cluster=b.Cluster,arn=b.TaskDefinition,group=b.TargetGroup,conf=hosting.Resources.Service.Properties,td=hosting.Resources.TaskDefinition.Properties,
      box=td.ContainerDefinitions[0],net=conf.NetworkConfiguration.AwsvpcConfiguration;
    const r=await c.send('ecs','DescribeServices',{cluster,services:[scope.expectedServiceArn]}),s=r.services?.[0],d=s?.deployments?.[0];
    check(r.services?.length===1&&!r.failures?.length&&s.serviceArn===scope.expectedServiceArn&&s.status==='ACTIVE'&&s.taskDefinition===arn&&
      s.desiredCount===1&&s.runningCount===1&&s.pendingCount===0&&s.deployments?.length===1&&d?.status==='PRIMARY'&&
      d.rolloutState==='COMPLETED'&&d.taskDefinition===arn&&s.enableExecuteCommand===false&&s.launchType==='FARGATE'&&s.platformVersion===conf.PlatformVersion&&
      same(s.loadBalancers,[{targetGroupArn:group,containerName:'web',containerPort:3000}])&&
      same({...s.networkConfiguration?.awsvpcConfiguration,subnets:[...(s.networkConfiguration?.awsvpcConfiguration?.subnets??[])].sort()},
        {assignPublicIp:net.AssignPublicIp,securityGroups:[b.TaskSecurityGroup],subnets:[...net.Subnets].sort()}),'SERVICE_ROLLOUT');
    const t=(await c.send('ecs','DescribeTaskDefinition',{taskDefinition:arn})).taskDefinition,w=t?.containerDefinitions?.[0];
    check(t?.status==='ACTIVE'&&t.taskDefinitionArn===arn&&!t.taskRoleArn&&t.executionRoleArn===P.roleArn&&
      t.family===P.family&&t.cpu===td.Cpu&&t.memory===td.Memory&&t.networkMode===td.NetworkMode&&
      same(t.requiresCompatibilities,['FARGATE'])&&t.containerDefinitions?.length===1&&w.name===box.Name&&w.image===box.Image&&
      same(w.command,box.Command)&&!w.environmentFiles?.length&&w.environment?.length===box.Environment.length&&
      same(map(w.environment,'name','value'),map(box.Environment,'Name','Value'))&&w.secrets?.length===box.Secrets.length&&
      same(map(w.secrets,'name','valueFrom'),map(box.Secrets,'Name','ValueFrom')),'TASK_BINDINGS');
    const tasks=await c.send('ecs','ListTasks',{cluster,serviceName:P.service,desiredStatus:'RUNNING'});
    check(!tasks.nextToken&&tasks.taskArns?.length===1,'RUNNING_TASK_COUNT');
    const tr=await c.send('ecs','DescribeTasks',{cluster,tasks:tasks.taskArns}),running=tr.tasks?.[0];
    check(tr.tasks?.length===1&&!tr.failures?.length&&running.taskArn===tasks.taskArns[0]&&running.taskDefinitionArn===arn&&
      running.lastStatus==='RUNNING'&&running.healthStatus==='HEALTHY'&&running.containers?.length===1&&running.containers[0].lastStatus==='RUNNING'&&
      running.containers[0].name==='web'&&running.containers[0].imageDigest===box.Image.split('@')[1],'RUNNING_IMAGE');
    const ip=running.attachments?.flatMap(a=>a.details??[]).find(x=>x.name==='privateIPv4Address')?.value;
    const h=await c.send('elb','DescribeTargetHealth',{TargetGroupArn:group}),tg=h.TargetHealthDescriptions?.[0];
    check(ip&&h.TargetHealthDescriptions?.length===1&&tg.Target?.Id===ip&&tg.Target?.Port===3000&&tg.TargetHealth?.State==='healthy','TARGET_HEALTH');
    const dns=await c.send('dns','ListResourceRecordSets',{HostedZoneId:P.hostedZone,StartRecordName:P.domain+'.',StartRecordType:'A',MaxItems:1});
    const rr=dns.ResourceRecordSets?.[0];
    const load=await c.send('elb','DescribeLoadBalancers',{LoadBalancerArns:[b.LoadBalancer]}),lb=load.LoadBalancers?.[0];
    check(lb?.LoadBalancerArn===b.LoadBalancer&&lb.VpcId===P.vpc&&lb.State?.Code==='active'&&
      rr?.Name===P.domain+'.'&&rr.Type==='A'&&!rr.SetIdentifier&&rr.AliasTarget?.EvaluateTargetHealth===true&&
      host(rr.AliasTarget.DNSName)===host(lb.DNSName)&&rr.AliasTarget.HostedZoneId===lb.CanonicalHostedZoneId,'DNS_ALB');
    const listener=(await c.send('elb','DescribeListeners',{ListenerArns:[b.HttpsListener]})).Listeners?.[0];
    check(listener?.ListenerArn===b.HttpsListener&&listener.LoadBalancerArn===b.LoadBalancer&&listener.Port===443&&listener.Protocol==='HTTPS'&&
      listener.Certificates?.length===1&&listener.Certificates[0].CertificateArn===P.certificate&&listener.SslPolicy===P.sslPolicy,'TLS_LISTENER');
  }
  async function verifySecret(c,arn,version,p){
    const s=await c.send('sm','DescribeSecret',{SecretId:arn}),r=await c.send('sm','GetResourcePolicy',{SecretId:arn});
    check(s.ARN===arn&&!s.DeletedDate&&!s.RotationEnabled&&!s.ReplicationStatus?.length&&
      s.KmsKeyId===P.kmsArn&&r.ARN===arn&&policySame(policy(r.ResourcePolicy),p)&&
      (version?same(s.VersionIdsToStages?.[version],['AWSCURRENT'])&&(arn===P.secretArn||Object.keys(s.VersionIdsToStages).length===1):
        Object.keys(s.VersionIdsToStages??{}).length===0),'SECRET_META');
  }
  async function absentSecret(c){
    try{await c.send('sm','DescribeSecret',{SecretId:draft.runtimeMaterial.newSecretName});}
    catch(e){if(e.name==='ResourceNotFoundException')return;throw e;}check(false,'SECRET_NAME_IN_USE');
  }
  function keyMetadata(operation,args=[]){
    check(++counts.metadata<=metadataLimit&&Date.now()+20000<deadline,'KMS_WINDOW');
    return JSON.parse(execFileSync('aws.exe',['kms',operation,'--key-id',P.kmsArn,...args,'--profile',P.profile,'--region',P.region,
      '--endpoint-url','https://kms.ca-central-1.amazonaws.com','--output','json','--no-cli-pager'],{encoding:'utf8',windowsHide:true,
      timeout:20000,stdio:['ignore','pipe','ignore'],env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_PAGER:''}}));
  }
  async function verifyTenantImage(c){
    const [uri,digest]=scope.tenantReleaseImage.split('@'),repositoryName=uri.split('/').at(-1);
    const r=await c.send('ecr','BatchGetImage',{registryId:P.account,repositoryName,imageIds:[{imageDigest:digest}]});
    const image=r.images?.[0];
    check(!r.failures?.length&&r.images?.length===1&&image.registryId===P.account&&image.repositoryName===repositoryName&&
      image.imageId?.imageDigest===digest&&typeof image.imageManifest==='string'&&'sha256:'+hash(image.imageManifest)===digest&&
      prior.images?.tenantA?.manifestDigest===digest,'TENANT_A_MANIFEST');
    check(JSON.parse(image.imageManifest).config?.digest===prior.images.tenantA.configDigest,'TENANT_A_CONFIG_DIGEST');
  }
  let before,secret;
  return {counts,close:()=>writer.close(),
    async preflight({afterIdentity}={}){
      await writer.source();
      if(afterIdentity)await afterIdentity();
      const access=await snapshot(writer,'access',old.access),hosting=await snapshot(writer,'hosting',old.hosting);
      check(!(await list(writer,names.access)).length&&!(await list(writer,names.hosting)).length,'ACTIVE_CHANGE_SET');
      await role(writer,old.access);await runHealth(writer,old.hosting,hosting.bindings);
      await verifySecret(writer,P.secretArn,P.secretVersion,handoffPolicy());await absentSecret(writer);
      const key=keyMetadata('describe-key').KeyMetadata;
      check(key?.Arn===P.kmsArn&&key.KeyState==='Enabled'&&key.Enabled===true&&key.KeyUsage==='ENCRYPT_DECRYPT','KEY_METADATA');
      const kp=keyMetadata('get-key-policy',['--policy-name','default']);
      check(typeof kp.Policy==='string'&&sha(policy(kp.Policy))===prior.secretMetadata?.keyPolicySha256,'KEY_POLICY_DRIFT');
      await verifyTenantImage(writer);
      before={access,hosting};return true;
    },
    async store(value){
      await absentSecret(writer);
      const s=await writer.send('sm','CreateSecret',{Name:draft.runtimeMaterial.newSecretName,ClientRequestToken:versionId,KmsKeyId:P.kmsArn,
        Description:'Sandbox first purchase restricted runtime material',Tags:[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'first-purchase-v1'}]},'secret-create');
      const arn=exactSecretArn(s.ARN);check(s.Name===draft.runtimeMaterial.newSecretName&&!s.VersionId,'SECRET_CREATE_ACK');
      const p=firstPurchaseSecretProtection(arn);
      const r=await writer.send('sm','PutResourcePolicy',{SecretId:arn,ResourcePolicy:canonical(p),BlockPublicPolicy:true},'secret-protect');
      check(r.ARN===arn,'SECRET_POLICY_ACK');await verifySecret(writer,arn,null,p);
      const v=await writer.send('sm','PutSecretValue',{SecretId:arn,ClientRequestToken:versionId,SecretString:JSON.stringify(value),
        VersionStages:['AWSCURRENT']},'secret-fill');
      check(v.ARN===arn&&v.VersionId===versionId&&same(v.VersionStages,['AWSCURRENT']),'SECRET_VERSION_ACK');
      await verifySecret(writer,arn,versionId,p);secret={arn,versionId};await record('secret-verified',secret);return secret;
    },
    async update(which,target){
      const id=names[which],priorState=before[which],c=writer,isAccess=which==='access',name=`first-purchase-${which}-${nonce}`;
      check(target.stackId===id&&same((await snapshot(c,which,old[which])).state,priorState.state)&&!(await list(c,id)).length,'STACK_CHANGED_BEFORE_CREATE');
      const body=canonical(target.template),capabilities=isAccess?['CAPABILITY_NAMED_IAM']:[];
      check(Buffer.byteLength(body)<=51200,'TEMPLATE_INLINE_LIMIT');
      const ack=await c.send('cfn','CreateChangeSet',{StackName:id,ChangeSetName:name,ChangeSetType:'UPDATE',ClientToken:name+'-create',
        IncludeNestedStacks:false,ImportExistingResources:false,TemplateBody:body,Tags:priorState.stack.Tags??[],
        Parameters:Object.keys(priorState.state.parameters).sort().map(ParameterKey=>({ParameterKey,UsePreviousValue:true})),
        ...(isAccess?{Capabilities:capabilities}:{})},which+'-create');
      check(ack.StackId===id&&new RegExp(`^arn:aws:cloudformation:${P.region}:${P.account}:changeSet/${name}/[0-9a-f-]{36}$`).test(ack.Id),'CHANGE_SET_ACK');
      await record(which+'-create-ack',{id:ack.Id});
      const describe=()=>c.send('cfn','DescribeChangeSet',{StackName:id,ChangeSetName:ack.Id});
      let cs;for(let n=0;n<10;n++){cs=await describe();if(cs.Status==='CREATE_COMPLETE')break;
        check(['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(cs.Status),'CHANGE_SET_FAILED');await sleep(10000);}
      const changes=cs.Changes??[],base=old[which].Resources;
      const shape=changes.map(x=>[x.ResourceChange?.LogicalResourceId,x.ResourceChange?.Action,x.ResourceChange?.Replacement].join(':')).sort();
      check(cs.ChangeSetId===ack.Id&&cs.ChangeSetName===name&&cs.StackId===id&&cs.Status==='CREATE_COMPLETE'&&cs.ExecutionStatus==='AVAILABLE'&&
        !cs.NextToken&&!cs.DeploymentMode&&!cs.DeploymentConfig?.DisableRollback&&!cs.IncludeNestedStacks&&!cs.RootChangeSetId&&!cs.ParentChangeSetId&&
        !cs.ImportExistingResources&&same(cs.Capabilities??[],capabilities)&&same(map(cs.Tags,'Key','Value'),priorState.state.tags)&&
        same((cs.Parameters??[]).map(p=>p.ParameterKey).sort(),Object.keys(priorState.state.parameters).sort())&&
        (cs.Parameters??[]).every(p=>p.UsePreviousValue===true||p.ParameterValue===priorState.state.parameters[p.ParameterKey])&&
        same(shape,[...target.expectedChanges].sort())&&changes.every(x=>{
          const r=x.ResourceChange,[,property]=changeKind[r.LogicalResourceId];
          return x.Type==='Resource'&&r.ResourceType===base[r.LogicalResourceId]?.Type&&r.PhysicalResourceId===priorState.bindings[r.LogicalResourceId]&&
            same(r.Scope,['Properties'])&&r.Details?.length>0&&r.Details.every(d=>d.Target?.Attribute==='Properties'&&d.Target.Name===property);
        })&&same(await template(c,id,ack.Id),target.template),'CHANGE_SET_DIFF');
      const current=await stack(c,id),pending=await list(c,id);
      check(stable.includes(current.StackStatus)&&same(stackState(current),priorState.state)&&pending.length===1&&pending[0].ChangeSetId===ack.Id,'STACK_CHANGED_BEFORE_EXECUTE');
      await c.send('cfn','ExecuteChangeSet',{StackName:id,ChangeSetName:ack.Id,ClientRequestToken:name+'-execute',DisableRollback:false},which+'-execute');
      await record(which+'-execute-ack',{id:ack.Id});
      let done=false;
      for(let n=0;n<25;n++){
        const fresh=await stack(c,id);
        if(fresh.StackStatus==='UPDATE_COMPLETE'&&stackState(fresh).epoch!==priorState.state.epoch&&
          (await describe()).ExecutionStatus==='EXECUTE_COMPLETE'){done=true;break;}
        check(fresh.StackStatus==='UPDATE_COMPLETE'||['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(fresh.StackStatus),'STACK_UPDATE_FAILED');
        await sleep(20000);
      }
      check(done,'STACK_UPDATE_TIMEOUT');
      if(isAccess)await using(async a=>{await a.source();await snapshot(a,'access',target.template,{after:true,expected:priorState});await role(a,target.template,{after:true});});
      await record(which+'-applied',{id:ack.Id,templateSha256:target.canonicalSha256});
    },
    async inspect(targets){
      await using(async c=>{
        await c.source();
        const h=await snapshot(c,'hosting',targets.hosting.template,{after:true,expected:before.hosting});
        await snapshot(c,'access',targets.access.template,{after:true,expected:before.access});await role(c,targets.access.template,{after:true});
        await runHealth(c,targets.hosting.template,h.bindings);await verifySecret(c,secret.arn,secret.versionId,firstPurchaseSecretProtection(secret.arn));
        await verifySecret(c,P.secretArn,P.secretVersion,handoffPolicy());
        await record('platform-inspected',{taskDefinition:h.bindings.TaskDefinition,image:targets.hosting.template.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Image});
      });
      for(const p of ['/api/health','/register']){
        check(++counts.https<=2&&Date.now()+12000<deadline,'HTTPS_LIMIT');
        const r=await fetch(scope.origin+p,{redirect:'error',signal:AbortSignal.timeout(12000),cache:'no-store'});
        check(r.status===200,'HTTPS_STATUS');const body=await r.text();check(body.length<=1048576,'HTTPS_SIZE');
        if(p==='/api/health'){const v=JSON.parse(body).data;check(v?.status==='ok'&&v.service==='saas-platform','PLATFORM_HEALTH');}
        else check(/<form\b/.test(body)&&/name="workspaceName"/.test(body)&&/name="password"/.test(body),'REGISTER_FORM');
      }
    },
  };
}
