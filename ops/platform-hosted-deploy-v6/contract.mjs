// W8g reuses the reviewed Web infrastructure; never rebuilds or republishes it.
import {P,hash,canonical,same} from '../platform-ecs-v1/contract.mjs';
import {hostingTemplate} from '../platform-ecs-v1/templates.mjs';
import {verifyInstalled} from '../platform-hosted-access-v6/contract.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
export {P,hash,canonical,same};
export const H=Object.freeze({phase:'W8g',validMs:48*3600000,runMs:20*60000,leaseMs:30*60000,hostingMs:2*3600000,
  imageDigest:'sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789',
  imageConfigDigest:'sha256:c418fef9c5146ef1fcdb39f88cb28ffe2d50a8b89f64ce94f6c8f463f6924230',
  imageSource:'f3cea2da7d26dfc09726c4cbc52cab40217340c6',
  appArn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-controller/github-app-v6-C58FqK',
  appVersion:'0aee41e2-c4c3-4d4d-afca-9e68f66cd379',
  controllerArn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-controller/neon-v6-M4A08E',
  controllerVersion:'3574f24e-ecb3-476c-8f71-baa501fd129e',roleId:'AROAV3GNMXTZJ45S2ANZ7',
  previousStackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/2d7d45a0-ced0-11f1-acc8-0effedbce869',
  previousTaskDefinition:'arn:aws:ecs:ca-central-1:402010193138:task-definition/techlong-sandbox-platform-web-v1:2',
  retiredTaskDefinitions:Object.freeze([1,2].map(n=>`arn:aws:ecs:ca-central-1:402010193138:task-definition/techlong-sandbox-platform-web-v1:${n}`)),
  slot:'F:/ChatGPT_workshop/techlong-platform-hosted-deploy-v6.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w8g-hosting-review.md',ciPath:'.github/workflows/platform-hosted-deploy-candidate.yml'});
export const SCOPE=Object.freeze({createStackMax:1,logicalResources:11,newIam:0,secretWrites:0,directSecretValueReads:0,
  directSql:0,applicationHttp:0,appTokens:0,githubDispatches:0,deletes:0,retries:0,
  managedSecretInjection:true,managedTaskReplacementsPossible:true,publicHosting:true,controlMinutes:30,hostingIntentHours:2,automaticCleanup:false});
export const must=(v,c)=>{if(!v)throw Error('HOSTED_DEPLOY_'+c);};
export const safeCode=e=>/^HOSTED_(?:DEPLOY|SUPPLY)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:
  /^[A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'HOSTING_FAILED';
export const IMAGE=`${P.account}.dkr.ecr.${P.region}.amazonaws.com/${P.repository}@${H.imageDigest}`;
export const RELEASE_SHA=hash(canonical(B.platform));
export function lease(at){must(Number.isSafeInteger(at)&&at>0,'LEASE_TIME');return {
  schema:'techlong/platform-hosted-runtime-lease/v6',releaseSha256:RELEASE_SHA,origin:'https://'+P.domain,
  sourceCommit:H.imageSource,issuedAt:at,expiresAt:at+H.leaseMs};}
export function template(nonce){must(/^[a-f0-9]{32}$/.test(nonce??''),'NONCE');const t=hostingTemplate();
  t.Description='W8g hosted V6 controller; 30-minute control lease and two-hour hosting intent; separate cleanup required';
  t.Parameters.HostingExpiresAt.AllowedPattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';
  t.Parameters.ControllerLease={Type:'String',MinLength:1,MaxLength:2048,Description:'Public fixed-image/release lease derived immediately before CreateStack; at most 30 minutes'};
  t.Metadata={ReviewPhase:H.phase,ReviewNonce:nonce,PreviousStackId:H.previousStackId,ImageSource:H.imageSource,
    ImageConfigDigest:H.imageConfigDigest,ReleaseSha256:RELEASE_SHA,ExecutionRoleId:H.roleId};
  const c=t.Resources.TaskDefinition.Properties.ContainerDefinitions[0];c.Image=IMAGE;
  c.Command=['node','ops/platform-hosting-v1/start.mjs','--hosted-controller'];
  const env=Object.fromEntries(c.Environment.map(x=>[x.Name,x.Value]));
  Object.assign(env,{TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROL_HOSTED:'true',
    TECHLONG_PLATFORM_CONTROL_LOCAL:'false',TECHLONG_PLATFORM_CONTROLLER_LEASE:{Ref:'ControllerLease'},TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT:H.imageSource});
  c.Environment=Object.entries(env).map(([Name,Value])=>({Name,Value}));
  c.Secrets=[{Name:'DATABASE_URL',ValueFrom:P.secretArn+':databaseUrl::'+P.secretVersion},
    {Name:'TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL',ValueFrom:H.controllerArn+':databaseUrl::'+H.controllerVersion},
    {Name:'TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY',ValueFrom:H.appArn+':privateKey::'+H.appVersion}];return t;
}
export const tags=(nonce,expiry)=>[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-two-hour'},
  {Key:'ReviewNonce',Value:nonce},{Key:'HostingExpiresAt',Value:expiry}];
export function assertSupply(s){verifyInstalled(s,H.appArn,H.appVersion);
  must(s.pendingComplete===true&&s.pendingChangeSets.length===0,'PENDING_ACCESS_CHANGE');}
export function assertDefinitions(data){must(same(Object.keys(data??{}).sort(),['ACTIVE','DELETE_IN_PROGRESS','INACTIVE']),'DEFINITION_STATUSES');
  for(const [status,d]of Object.entries(data))must(!d.nextToken&&Array.isArray(d.taskDefinitionArns)&&new Set(d.taskDefinitionArns).size===d.taskDefinitionArns.length&&
    (status==='INACTIVE'?d.taskDefinitionArns.every(a=>H.retiredTaskDefinitions.includes(a)):d.taskDefinitionArns.length===0),'DEFINITION_OCCUPIED');
  return data.INACTIVE.taskDefinitionArns;
}
export function assertBaseline(b){assertSupply(b?.supply);must(b.hostingNamesAbsent===true&&b.previousStackId===H.previousStackId&&
  b.previousStackStatus==='DELETE_COMPLETE'&&b.image?.digest===H.imageDigest&&b.image?.configDigest===H.imageConfigDigest&&
  b.budget?.limitUsd===50&&b.network?.vpc===P.vpc&&b.certificate?.arn===P.certificate&&
  b.retired?.active===0&&b.retired?.deleting===0&&b.retired?.running===0,'BASELINE');return true;}
export function makeReview({sourceCommit,pins,ci,baseline,pricing,validation,parents,nonce,issuedAt,riskSha256}){
  assertBaseline(baseline);template(nonce);must(/^[a-f0-9]{40}$/.test(sourceCommit??'')&&ci?.sourceCommit===sourceCommit&&
    ci.path===H.ciPath&&ci.status==='completed'&&ci.conclusion==='success'&&ci.attempt===1&&Number.isSafeInteger(ci.runId)&&ci.runId>0&&
    Array.isArray(pins)&&pins.length>5&&new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    Array.isArray(parents)&&parents.length===4&&parents.every(p=>/^[a-f0-9]{64}$/.test(p.sha256))&&
    pricing?.currency==='USD'&&pricing.estimate?.notAHardCap===true&&Number.isFinite(pricing.estimate.exampleTwoHoursUsd)&&pricing.estimate.exampleTwoHoursUsd>0&&
    validation?.validated===true&&same(validation.parameters,['ControllerLease','HostingExpiresAt'])&&
    Number.isSafeInteger(issuedAt)&&issuedAt>0&&/^[a-f0-9]{64}$/.test(riskSha256??''),'REVIEW_INPUT');
  return {schema:'techlong/platform-hosted-deploy-review/v6',sourceCommit,pins,ci,baseline,pricing,validation,parents,nonce,issuedAt,
    expiresAt:issuedAt+H.validMs,latestStartAt:issuedAt+H.validMs-H.leaseMs,riskSha256,constants:{...H},scope:{...SCOPE},
    templateSha256:hash(canonical(template(nonce))),controlLeaseDerivation:'lease(CreateStack intent time); expires after 30 minutes; never renew',
    hostingExpiryDerivation:'CreateStack intent time plus two hours; not an automatic stop',preparationIsNotApproval:true};
}
export function validate(text,sha,now=Date.now(),audit=false){must(typeof text==='string'&&text.length<300000&&hash(text)===sha,'APPROVAL_SHA');
  const m=JSON.parse(text);must(same(m,makeReview(m)),'MANIFEST_DRIFT');
  if(!audit)must(Number.isSafeInteger(now)&&now>=m.issuedAt&&now<m.latestStartAt,'EXPIRED');return m;}
export function runtime({service:s,definition:d,task:t,targets,ids,nonce,controlLease}){
  const expected=template(nonce).Resources.TaskDefinition.Properties.ContainerDefinitions[0],c=d?.containerDefinitions?.[0];
  const sorted=a=>[...a].sort((x,y)=>canonical(x).localeCompare(canonical(y)));
  const env=expected.Environment.map(x=>({name:x.Name,value:typeof x.Value==='string'?x.Value:canonical(controlLease)}));
  must(s?.status==='ACTIVE'&&s.serviceName===P.service&&s.serviceArn===ids.Service&&s.taskDefinition===ids.TaskDefinition&&s.desiredCount===1&&s.runningCount===1&&s.pendingCount===0&&
    s.launchType==='FARGATE'&&s.platformVersion==='1.4.0'&&!s.enableExecuteCommand&&s.deployments?.length===1&&s.deployments[0].rolloutState==='COMPLETED'&&
    same(s.loadBalancers,[{targetGroupArn:ids.TargetGroup,containerName:'web',containerPort:3000}])&&
    s.networkConfiguration?.awsvpcConfiguration?.assignPublicIp==='ENABLED'&&same(sorted(s.networkConfiguration.awsvpcConfiguration.subnets),sorted(P.subnets))&&
    same(s.networkConfiguration.awsvpcConfiguration.securityGroups,[ids.TaskSecurityGroup]),'SERVICE_RUNTIME');
  must(d?.taskDefinitionArn===ids.TaskDefinition&&d.family===P.family&&d.executionRoleArn===P.roleArn&&!d.taskRoleArn&&d.networkMode==='awsvpc'&&d.cpu==='512'&&d.memory==='1024'&&
    same(d.requiresCompatibilities,['FARGATE'])&&!d.volumes?.length&&same(d.runtimePlatform,{cpuArchitecture:'X86_64',operatingSystemFamily:'LINUX'})&&
    d.containerDefinitions?.length===1&&c.name==='web'&&c.image===IMAGE&&same(c.command,expected.Command)&&!c.entryPoint?.length&&c.user==='1000:1000'&&!c.privileged&&
    c.readonlyRootFilesystem===false&&same(c.linuxParameters,{initProcessEnabled:true,capabilities:{drop:['ALL']}})&&!c.environmentFiles?.length&&
    same(sorted(c.environment??[]),sorted(env))&&same(sorted(c.secrets??[]),sorted(expected.Secrets.map(x=>({name:x.Name,valueFrom:x.ValueFrom})))),'TASK_DEFINITION');
  must(t?.lastStatus==='RUNNING'&&t.healthStatus==='HEALTHY'&&t.taskDefinitionArn===ids.TaskDefinition&&t.launchType==='FARGATE'&&
    !t.overrides?.taskRoleArn&&!t.overrides?.executionRoleArn&&!(t.overrides?.containerOverrides??[]).some(c=>c.environment?.length||c.environmentFiles?.length||c.command?.length)&&
    t.containers?.length===1&&t.containers[0].imageDigest===H.imageDigest&&targets?.length===1&&targets[0].TargetHealth?.State==='healthy'&&
    targets[0].Target.Port===3000&&t.containers[0].networkInterfaces?.some(n=>n.privateIpv4Address===targets[0].Target.Id),'TASK_HEALTH');return true;
}
