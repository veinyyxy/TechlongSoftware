// Temporary orchestration of the existing three stacks. No business runtime imports.
import {randomUUID} from 'node:crypto';
import {ensure} from '../aws-resource-power/core.mjs';
import {ROLES,SERVICE,EDGE,CELL_BINDINGS,copy,hash,tagMap,variant,assertTemplate,readStack,assertSameStack,applyStack,writeOnce} from './environment-cfn.mjs';
export const ENV_SCHEMA='techlong/temporary-environment/v2';
// A role-review acknowledgement is per operation, not a resource-scope migration.
export const configHash=c=>hash(Object.fromEntries(Object.entries(c).filter(([k])=>k!=='acknowledgeRoleScopeReview')));
export function limitsFor(mode,seconds){ensure(['stop','start'].includes(mode)&&Number.isInteger(seconds)&&seconds>=1&&seconds<=7200,'PLAN_MODE_OR_WAIT');const cfn=mode==='stop'?5:7,polls=Math.ceil(seconds/30)+1;return {cfnChangeSetsMax:cfn,cfnExecutionsMax:cfn,databaseWritesMax:2,externalAliasWritesMax:mode==='start'?1:0,totalWritesMax:cfn*2+2+(mode==='start'?1:0),readCallsMax:100+cfn*(12+2*polls)+10*polls+Math.ceil(seconds/10)+1};}
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const same=(a,b)=>hash(a)===hash(b),name=v=>String(v).toLowerCase().replace(/\.$/,''),lbName=role=>role==='cell'?'CellLoadBalancer':'LoadBalancer';
export function validateEnvironment(c){
 ensure(c?.schema===ENV_SCHEMA,'LEGACY_DIRECT_RESOURCE_TOOL_DISABLED_USE_V2_CONFIG');
 ensure(keys(c,['schema','temporary','enabled','accountId','region','profile','expectedPrincipalArn','expectedPrincipalUserId','stateDirectory','awsCliExecutable','stacks','databases','externalApiAlias','acknowledgeRoleScopeReview'])&&c.temporary===true&&typeof c.enabled==='boolean','ENVIRONMENT_CONFIG');
 ensure(/^\d{12}$/.test(c.accountId)&&/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(c.region)&&/^[\w.-]+$/.test(c.profile),'CONFIG_IDENTITY');
 ensure(c.expectedPrincipalArn?.startsWith(`arn:aws:iam::${c.accountId}:user/`)&&!/[\s*?]/.test(c.expectedPrincipalArn)&&/^[A-Z0-9]+$/.test(c.expectedPrincipalUserId),'EXACT_IAM_USER_REQUIRED');
 ensure(typeof c.stateDirectory==='string'&&c.stateDirectory.length>3&&!/[\r\n\0]/.test(c.stateDirectory),'STATE_DIRECTORY_REQUIRED');
 ensure(c.awsCliExecutable===undefined||typeof c.awsCliExecutable==='string'&&c.awsCliExecutable.length>0&&!/[\r\n\0]/.test(c.awsCliExecutable),'AWS_CLI_PATH');
 ensure(keys(c.stacks,ROLES)&&ROLES.every(r=>c.stacks[r])&&new Set(ROLES.map(r=>c.stacks[r].stackId)).size===3,'EXACT_THREE_STACKS_REQUIRED');
 for(const r of ROLES){const s=c.stacks[r];ensure(keys(s,['stackId','templateSha256','desiredCount'])&&new RegExp(`^arn:aws:cloudformation:${c.region}:${c.accountId}:stack/[A-Za-z][A-Za-z0-9-]*/[a-f0-9-]{36}$`).test(s.stackId)&&/^[a-f0-9]{64}$/.test(s.templateSha256),'STACK_UUID_AND_BASELINE_SHA_REQUIRED');if(r!=='cell')ensure(Number.isInteger(s.desiredCount)&&s.desiredCount>=1&&s.desiredCount<=2,'RUNNING_REPLICA_COUNT_REQUIRED');}
 ensure(Array.isArray(c.databases)&&c.databases.length===2&&new Set(c.databases.map(d=>d.kind+'/'+d.id)).size===2,'EXACT_TWO_DATABASES_REQUIRED');
 for(const d of c.databases)ensure(keys(d,['kind','id','resourceId'])&&['cluster','instance'].includes(d.kind)&&/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(d.id)&&/^[A-Za-z0-9_-]{3,100}$/.test(d.resourceId),'DATABASE_IDENTITY_REQUIRED');
 const d=c.externalApiAlias;ensure(keys(d,['zoneId','name','owner'])&&d.owner==='external'&&/^Z[A-Z0-9]+$/.test(d.zoneId)&&/^(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,63}\.?$/.test(d.name),'EXTERNAL_API_ALIAS_SCOPE');
 ensure(typeof c.acknowledgeRoleScopeReview==='boolean','ROLE_REVIEW_ACK_REQUIRED');return copy(c);
}
async function identity(c,io){const x=await io.call('sts','get-caller-identity',{});ensure(x.Account===c.accountId&&x.Arn===c.expectedPrincipalArn&&x.UserId===c.expectedPrincipalUserId,'ENVIRONMENT_IDENTITY_MISMATCH');}
async function db(c,io,d){const cluster=d.kind==='cluster',r=await io.call('rds',cluster?'describe-db-clusters':'describe-db-instances',cluster?{DBClusterIdentifier:d.id}:{DBInstanceIdentifier:d.id}),rows=cluster?r.DBClusters:r.DBInstances,v=rows?.[0];
 ensure(rows?.length===1&&!r.Marker&&(cluster?v.DBClusterIdentifier:v.DBInstanceIdentifier)===d.id&&(cluster?v.DbClusterResourceId:v.DbiResourceId)===d.resourceId,'DATABASE_REPLACED');
 ensure((cluster?v.DBClusterArn:v.DBInstanceArn)?.startsWith(`arn:aws:rds:${c.region}:${c.accountId}:${cluster?'cluster':'db'}:`),'DATABASE_ACCOUNT_REGION');
 ensure(cluster?/^aurora(?:-|$)/.test(v.Engine)&&!v.GlobalClusterIdentifier&&!v.ReplicationSourceIdentifier&&!v.ReadReplicaIdentifiers?.length:!v.DBClusterIdentifier&&!v.ReadReplicaSourceDBInstanceIdentifier&&!v.ReadReplicaDBInstanceIdentifiers?.length&&!v.ReadReplicaDBClusterIdentifiers?.length,'UNSUPPORTED_DATABASE_TOPOLOGY');
 return {...d,status:cluster?v.Status:v.DBInstanceStatus};
}
async function alias(c,io,recordName,missing=false){const r=await io.call('route53','list-resource-record-sets',{HostedZoneId:c.externalApiAlias.zoneId,StartRecordName:recordName,StartRecordType:'A',MaxItems:'5'}),rows=(r.ResourceRecordSets??[]).filter(x=>name(x.Name)===name(recordName)&&x.Type==='A');
 ensure(!(r.IsTruncated&&name(r.NextRecordName)===name(recordName)&&r.NextRecordType==='A'),'ALIAS_PAGE_INCOMPLETE');if(missing&&rows.length===0)return null;ensure(rows.length===1&&rows[0].AliasTarget&&!rows[0].SetIdentifier,'EXACT_SIMPLE_ALIAS_REQUIRED');return rows[0];}
function serviceScope(c,arn){const prefix=`arn:aws:ecs:${c.region}:${c.accountId}:service/`;ensure(arn?.startsWith(prefix),'SERVICE_ACCOUNT_REGION');const parts=arn.slice(prefix.length).split('/');ensure(parts.length===2&&parts.every(x=>/^[\w-]+$/.test(x)),'LONG_SERVICE_ARN_REQUIRED');return {cluster:parts[0],service:parts[1],arn};}
function resolveNetwork(v,stack){if(Array.isArray(v))return v.map(x=>resolveNetwork(x,stack));if(!v||typeof v!=='object')return v;if(v.Ref){if(stack.bindings[v.Ref])return stack.bindings[v.Ref].physicalId;const x=stack.parameters[v.Ref];ensure(x!==undefined,'NETWORK_PARAMETER_BINDING_REQUIRED');return stack.template.Parameters[v.Ref].Type==='CommaDelimitedList'?x.split(','):x;}if(v['Fn::Split'])return String(resolveNetwork(v['Fn::Split'][1],stack)).split(v['Fn::Split'][0]);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolveNetwork(x,stack)]));}
function assertServiceTags(service,stack,role){
 const rows=service.tags??[];ensure(Array.isArray(rows)&&rows.every(t=>typeof t.key==='string'&&typeof t.value==='string')&&new Set(rows.map(t=>t.key)).size===rows.length,'SERVICE_TAG_RESPONSE_INVALID');const tags=tagMap(rows);
 // CFN's exact physical binding is authoritative; system-tag propagation varies by resource type.
 for(const [key,value]of [['aws:cloudformation:stack-id',stack.stackId],['aws:cloudformation:logical-id',SERVICE[role]],['aws:cloudformation:stack-name',stack.stackId.split(':stack/')[1].split('/')[0]]])if(Object.hasOwn(tags,key))ensure(tags[key]===value,'SERVICE_NOT_OWNED_BY_EXACT_STACK');
 const declared=stack.template.Resources[SERVICE[role]].Properties.Tags??[];ensure(Array.isArray(declared)&&declared.every(t=>typeof t.Key==='string')&&new Set(declared.map(t=>t.Key)).size===declared.length,'SERVICE_DECLARED_TAGS_INVALID');
 for(const {Key,Value}of declared){
  // Compare parameter hashes already captured by readStack; never retain extra parameter values or resolve NoEcho.
  const expected=typeof Value==='string'?hash(Value):Value&&Object.keys(Value).length===1&&typeof Value.Ref==='string'?stack.parameterHashes[Value.Ref]:null;
  ensure(typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected),'SERVICE_TAG_VALUE_UNSUPPORTED');
  ensure(Object.hasOwn(tags,Key)&&hash(tags[Key])===expected,'SERVICE_DECLARED_TAG_DRIFT');
 }
}
async function liveService(c,io,scope,stack,role){const r=await io.call('ecs','describe-services',{cluster:scope.cluster,services:[scope.arn],include:['TAGS']});ensure(!r.failures?.length&&r.services?.length===1,'SERVICE_LOOKUP_FAILED');const s=r.services[0];
 ensure(s.serviceArn===scope.arn&&s.serviceArn===stack.bindings[SERVICE[role]].physicalId&&stack.bindings[SERVICE[role]].type==='AWS::ECS::Service'&&s.status==='ACTIVE'&&s.launchType==='FARGATE'&&s.taskDefinition===stack.bindings[role==='platform'?'TaskDefinition':'TenantTaskDefinition'].physicalId,'SERVICE_TEMPLATE_BINDING_MISMATCH');
 assertServiceTags(s,stack,role);
 ensure([0,c.stacks[role].desiredCount].includes(s.desiredCount),'UNREVIEWED_SERVICE_COUNT');const p=stack.template.Resources[SERVICE[role]].Properties,groups=s.loadBalancers??[],want=p.LoadBalancers??[],target=stack.bindings[role==='platform'?'TargetGroup':'TenantTargetGroup'].physicalId;
 ensure(groups.length===1&&want.length===1&&groups[0].targetGroupArn===target&&groups[0].containerName===want[0].ContainerName&&groups[0].containerPort===want[0].ContainerPort,'SERVICE_TARGET_BINDING_DRIFT');
 if(p.NetworkConfiguration){const n=resolveNetwork(p.NetworkConfiguration.AwsvpcConfiguration,stack),live=s.networkConfiguration?.awsvpcConfiguration;ensure(live&&same([...(live.subnets??[])].sort(),[...n.Subnets].sort())&&same([...(live.securityGroups??[])].sort(),[...n.SecurityGroups].sort())&&live.assignPublicIp===n.AssignPublicIp,'SERVICE_NETWORK_DRIFT');}
 return {scope,...Object.fromEntries(['serviceArn','taskDefinition','desiredCount','runningCount','pendingCount','createdAt','loadBalancers','networkConfiguration'].map(k=>[k,s[k]]))};}
async function controllerClosed(io,stack){const arn=stack.bindings.TaskDefinition.physicalId,d=(await io.call('ecs','describe-task-definition',{taskDefinition:arn})).taskDefinition;ensure(d?.taskDefinitionArn===arn&&d.status==='ACTIVE'&&d.containerDefinitions?.length===1,'PLATFORM_TASK_DEFINITION');const x=d.containerDefinitions[0],env=new Map((x.environment??[]).map(v=>[v.name,v.value]));ensure(!x.command?.includes('--hosted-controller')&&env.get('TECHLONG_PLATFORM_CONTROLLER_ENABLED')==='false'&&!(x.secrets??[]).some(v=>['TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'].includes(v.name)),'PLATFORM_CONTROLLER_NOT_CLOSED');}
async function alb(c,io,stack,role,base,allStacks){
 const id=lbName(role),spec=base.Resources[id].Properties,physical=stack.bindings[id]?.physicalId;let r;
 try{r=await io.call('elbv2','describe-load-balancers',physical?{LoadBalancerArns:[physical]}:{Names:[spec.Name]});}catch(e){if(!physical&&['LoadBalancerNotFound','LoadBalancerNotFoundException'].includes(e.code))return null;throw e;}
 if(!physical){ensure(!r.LoadBalancers?.length,'ALB_RECREATED_OUTSIDE_CFN');return null;}
 ensure(!r.NextMarker&&r.LoadBalancers?.length===1&&r.LoadBalancers[0].LoadBalancerArn===physical,'ALB_CFN_BINDING_MISMATCH');const lb=r.LoadBalancers[0];ensure(lb.Type==='application'&&lb.State?.Code==='active'&&lb.LoadBalancerName===spec.Name,'ALB_NOT_ACTIVE');
 const t=await io.call('elbv2','describe-tags',{ResourceArns:[physical]});ensure(t.TagDescriptions?.length===1&&t.TagDescriptions[0].ResourceArn===physical,'ALB_TAG_RESPONSE');const tags=tagMap(t.TagDescriptions[0].Tags);ensure(tags['aws:cloudformation:stack-id']===stack.stackId&&tags['aws:cloudformation:logical-id']===id,'ALB_NOT_OWNED_BY_STACK');
 const lr=await io.call('elbv2','describe-listeners',{LoadBalancerArn:physical});ensure(!lr.NextMarker,'LISTENER_PAGE_INCOMPLETE');const listenerBindings=Object.entries(stack.bindings).filter(([,x])=>x.type==='AWS::ElasticLoadBalancingV2::Listener');ensure(same((lr.Listeners??[]).map(x=>x.ListenerArn).sort(),listenerBindings.map(([,x])=>x.physicalId).sort()),'FOREIGN_OR_MISSING_LISTENER');
 const expectedRules=Object.values(allStacks).flatMap(s=>Object.values(s.bindings).filter(x=>x.type==='AWS::ElasticLoadBalancingV2::ListenerRule').map(x=>x.physicalId)),actualRules=[];
 for(const l of lr.Listeners??[]){const logical=listenerBindings.find(([,x])=>x.physicalId===l.ListenerArn)[0],p=base.Resources[logical].Properties;ensure(l.Port===p.Port&&l.Protocol===p.Protocol&&l.SslPolicy===p.SslPolicy,'LISTENER_PROTOCOL_CHANGED');
  if(role==='cell'&&logical==='ControlMtlsListener')ensure(l.MutualAuthentication?.Mode==='verify'&&l.MutualAuthentication.TrustStoreArn===stack.parameters.ControlTrustStoreArn,'CONTROL_MTLS_CHANGED');
  const rr=await io.call('elbv2','describe-rules',{ListenerArn:l.ListenerArn});ensure(!rr.NextMarker,'RULE_PAGE_INCOMPLETE');for(const x of rr.Rules??[])if(!x.IsDefault){ensure(expectedRules.includes(x.RuleArn),'FOREIGN_RULE_WOULD_BE_DELETED');actualRules.push(x.RuleArn);}
 }
 const required=expectedRules.filter(x=>listenerBindings.some(([,l])=>x.replace(':listener-rule/',':listener/').startsWith(l.physicalId+'/')));ensure(same(required.sort(),actualRules.sort()),'MISSING_MANAGED_ROUTING_RULE');
 if(role==='cell')for(const [output,logical]of [['HttpsListenerArn','BusinessHttpsListener'],['ControlListenerArn','ControlMtlsListener']])ensure(stack.outputs[output]===stack.bindings[logical].physicalId,'CELL_OUTPUT_NOT_ACTUAL_LISTENER');
 return {arn:physical,dnsName:lb.DNSName,zoneId:lb.CanonicalHostedZoneId};
}
export async function captureEnvironment({config,io,base=null,expectedMode=null}){
 const c=validateEnvironment(config);await identity(c,io);const stacks={},templates=base?.templates?copy(base.templates):{},scopes=base?.serviceScopes?copy(base.serviceScopes):{},services={},lbs={};
 for(const role of ROLES){const s=await readStack(c,io,role);if(!base){ensure(s.templateSha256===c.stacks[role].templateSha256,'FIRST_USE_BASELINE_TEMPLATE_CHANGED');assertTemplate(role,s.template);templates[role]=copy(s.template);}
  else{ensure(['stopped','running'].includes(expectedMode),'SAVED_BASELINE_MODE_REQUIRED');const wanted=variant(templates[role],role,expectedMode==='stopped'?'idle':'full',c.stacks[role].desiredCount??0);ensure(s.templateSha256===hash(wanted),'SAVED_MODE_TEMPLATE_CHANGED');assertTemplate(role,s.template,expectedMode==='stopped'?'idle':'full');}stacks[role]=s;}
 for(const role of ['platform','tenant']){const s=stacks[role],id=SERVICE[role];if(s.bindings[id])scopes[role]=serviceScope(c,s.bindings[id].physicalId);ensure(scopes[role],'FULL_TEMPLATE_STOP_BACKUP_REQUIRED');const scope=scopes[role];
  const listed=await io.call('ecs','list-services',{cluster:scope.cluster,maxResults:100});ensure(!listed.nextToken&&(listed.serviceArns??[]).every(x=>s.bindings[id]&&x===s.bindings[id].physicalId),'UNSELECTED_SERVICE_IN_SHARED_CLUSTER');
  const scaling=await io.call('application-autoscaling','describe-scalable-targets',{ServiceNamespace:'ecs',ScalableDimension:'ecs:service:DesiredCount',ResourceIds:[`service/${scope.cluster}/${scope.service}`]});ensure(!scaling.NextToken&&!scaling.ScalableTargets?.length,'EXTERNAL_AUTOSCALING_REQUIRES_SEPARATE_REVIEW');
  services[role]=s.bindings[id]?await liveService(c,io,scope,s,role):null;
  if(services[role]&&services[role].desiredCount!==s.template.Resources[id].Properties.DesiredCount)ensure(!base&&role==='tenant'&&s.template.Resources[id].Properties.DesiredCount===1&&services[role].desiredCount===0&&services[role].runningCount===0&&services[role].pendingCount===0,'UNEXPECTED_DESIRED_COUNT_DRIFT');
 }
 if(stacks.tenant.bindings.TenantListenerRule)for(const k of CELL_BINDINGS){const actual=stacks.tenant.parameters[k],output=stacks.cell.outputs[k];ensure(typeof output==='string'&&(k==='SubnetIds'?same(actual?.split(',').sort(),output.split(',').sort()):actual===output),'TENANT_CELL_PARAMETER_BINDING_DRIFT');}
 await controllerClosed(io,stacks.platform);for(const role of ['cell','platform'])lbs[role]=await alb(c,io,stacks[role],role,templates[role],stacks);
 const api=await alias(c,io,c.externalApiAlias.name),consoleName=templates.platform.Resources.DnsRecord.Properties.Name;ensure(typeof consoleName==='string'&&name(consoleName)!==name(c.externalApiAlias.name),'EXTERNAL_ALIAS_MUST_NOT_BE_PLATFORM_MANAGED_RECORD');const consoleRecord=await alias(c,io,consoleName,!stacks.platform.bindings.DnsRecord);
 for(const [record,lb]of [[api,lbs.cell],[consoleRecord,lbs.platform]])if(lb)ensure(record?.AliasTarget.HostedZoneId===lb.zoneId&&name(record.AliasTarget.DNSName).replace(/^dualstack\./,'')===name(lb.dnsName),'ALIAS_NOT_BOUND_TO_MANAGED_ALB');
 if(!stacks.platform.bindings.DnsRecord)ensure(!consoleRecord,'MANAGED_CONSOLE_ALIAS_EXISTS_OUTSIDE_STOPPED_STACK');
 const databases=[];for(const d of c.databases){const v=await db(c,io,d);ensure(['available','stopped'].includes(v.status),'DATABASE_TRANSITION_REQUIRES_INSPECTION');databases.push(v);}
 return {stacks,services,loadBalancers:lbs,apiAlias:api,databases,base:{templates,serviceScopes:scopes},capturedAt:io.now()};
}
export function publicStatus(s,c){const stopped=ROLES.every(r=>!EDGE[r].some(id=>s.stacks[r].bindings[id]))&&s.databases.every(d=>d.status==='stopped'),running=s.databases.every(d=>d.status==='available')&&['cell','platform'].every(r=>s.loadBalancers[r])&&['tenant','platform'].every(r=>s.services[r]?.desiredCount===c.stacks[r].desiredCount&&s.services[r].runningCount===c.stacks[r].desiredCount&&s.services[r].pendingCount===0);
 return {status:stopped?'STOPPED':running?'RUNNING':'IDLE_OR_PARTIAL',stackIds:Object.fromEntries(ROLES.map(r=>[r,s.stacks[r].stackId])),taskCounts:Object.fromEntries(['platform','tenant'].map(r=>[r,s.services[r]?{desired:s.services[r].desiredCount,running:s.services[r].runningCount,pending:s.services[r].pendingCount}:null])),databases:s.databases,loadBalancers:s.loadBalancers,zeroAccountCharges:false,noProductAcceptanceClaim:true};}
export async function prepareEnvironmentPlan({config,io,mode,base=null,expectedMode=null,waitSeconds=1800}){
 const c=validateEnvironment(config);ensure(['stop','start'].includes(mode)&&Number.isInteger(waitSeconds)&&waitSeconds>=1&&waitSeconds<=7200,'PLAN_MODE_OR_WAIT');const observed=await captureEnvironment({config:c,io,base,expectedMode}),preparedAt=io.now();
 return {schema:'techlong/temporary-environment-plan/v2',id:randomUUID(),mode,configSha256:configHash(c),preparedAt,writeBefore:preparedAt+5*3600000,waitSeconds,limits:limitsFor(mode,waitSeconds),observedMode:base?expectedMode:'baseline',observed,base:observed.base,
  stages:mode==='stop'?['tenant-drain','platform-drain','tenant-idle','platform-idle','cell-idle','stop-databases']:['align-existing-zero-services','database-start','cell-full','platform-full-zero','tenant-full-zero-with-current-cell-outputs','external-api-alias','platform-running','tenant-running'],
  writePolicy:{cfnChangeSetsOnly:true,normalCfnRollback:true,noAgentRollbackRetryOrCleanup:true,noIamChange:true,noImageChange:true,noDatabaseDeletion:true,noNewResourceExpiry:true,roleScopeReviewRequiredBeforeStart:!c.acknowledgeRoleScopeReview},
  risks:['Asynchronous/non-atomic; normal CFN rollback can fail and leave charged resources. Unknown submissions are never replayed.',
   'Execute can invalidate/delete other same-stack change-set records. No direct DeleteChangeSet or manual rollback is performed.',
   'Service objects and ALB routes are removed by their owning stacks; retained VPC/network, data, task definitions, target groups and logs remain. No full-stack deletion.',
   'Start can launch configured tasks, managed Secret injection and database application activity. Platform controller stays disabled; no business tests are performed.',
   'New Cell outputs derive listener parameters. Existing roles may not authorize new ARN paths; review separately before start, never expand IAM here.',
   'Only the separately owned exact API Alias target is updated; console DNS stays exclusively in the platform stack.',
   'Templates/metadata enter memory and private ACL backups. No Secret values/PEM/.env or SQL; no zero-charge guarantee or automatic resource stop.']};
}
async function waitServiceZero(c,io,stack,role,waitSeconds){if(!stack.bindings[SERVICE[role]])return;const scope=serviceScope(c,stack.bindings[SERVICE[role]].physicalId),end=io.now()+waitSeconds*1000;for(;;){const s=await liveService(c,io,scope,stack,role);if(s.desiredCount===0&&s.runningCount===0&&s.pendingCount===0)return;ensure(io.now()<end,'SERVICE_DRAIN_TIMEOUT_INSPECT');await io.sleep(Math.min(30000,end-io.now()));}}
async function databaseState(c,io,store,j,mode,waitSeconds){for(const d of c.databases){const before=await db(c,io,d),wanted=mode==='stop'?'stopped':'available';if(before.status===wanted)continue;ensure(before.status===(mode==='stop'?'available':'stopped'),'DATABASE_TRANSITION_REQUIRES_INSPECTION');const cluster=d.kind==='cluster',op=(mode==='stop'?'stop-':'start-')+(cluster?'db-cluster':'db-instance');await writeOnce(io,store,j,mode+'/'+d.kind+'/'+d.id,'rds',op,cluster?{DBClusterIdentifier:d.id}:{DBInstanceIdentifier:d.id});
  const end=io.now()+waitSeconds*1000;for(;;){if((await db(c,io,d)).status===wanted)break;ensure(io.now()<end,'DATABASE_WAIT_TIMEOUT_INSPECT');await io.sleep(Math.min(30000,end-io.now()));}}
}
export async function executeEnvironmentPlan({config,io,plan,approvedSha,store,onAttemptStarted=async()=>{}}){
 const c=validateEnvironment(config);ensure(c.enabled,'ENVIRONMENT_DISABLED');ensure(hash(plan)===approvedSha&&plan.configSha256===configHash(c)&&plan.schema==='techlong/temporary-environment-plan/v2'&&['stop','start'].includes(plan.mode),'EXACT_PLAN_APPROVAL_REQUIRED');ensure(io.now()<plan.writeBefore,'PLAN_EXPIRED');ensure(plan.mode!=='start'||c.acknowledgeRoleScopeReview&&!plan.writePolicy.roleScopeReviewRequiredBeforeStart,'RESTORATION_ROLE_SCOPE_REVIEW_REQUIRED');
 ensure(same(plan.limits,limitsFor(plan.mode,plan.waitSeconds)),'PLAN_LIMIT_POLICY_CHANGED');
 const originalIo=io,counts={reads:0,writes:0,cfnCreates:0,cfnExecutes:0,databases:0,aliases:0};io={...originalIo,call:async(s,o,input)=>{const kind=o==='create-change-set'?'cfnCreates':o==='execute-change-set'?'cfnExecutes':s==='rds'&&/^(?:stop|start)-/.test(o)?'databases':o==='change-resource-record-sets'?'aliases':null;
  if(kind){const max={cfnCreates:plan.limits.cfnChangeSetsMax,cfnExecutes:plan.limits.cfnExecutionsMax,databases:plan.limits.databaseWritesMax,aliases:plan.limits.externalAliasWritesMax};ensure(counts[kind]<max[kind]&&counts.writes<plan.limits.totalWritesMax,'PLAN_WRITE_BUDGET_EXHAUSTED');counts[kind]++;counts.writes++;}else{ensure(counts.reads<plan.limits.readCallsMax,'PLAN_READ_BUDGET_EXHAUSTED');counts.reads++;}return originalIo.call(s,o,input);}};
 const before=await captureEnvironment({config:c,io,base:plan.observedMode==='baseline'?null:plan.base,expectedMode:plan.observedMode==='baseline'?null:plan.observedMode});
 for(const r of ROLES)assertSameStack(before.stacks[r],plan.observed.stacks[r]);ensure(same(before.services,plan.observed.services)&&same(before.databases,plan.observed.databases)&&same(before.apiAlias,plan.observed.apiAlias),'ENVIRONMENT_CHANGED_SINCE_PLAN');
 const j={schema:ENV_SCHEMA,planSha256:approvedSha,status:'APPLYING',mode:plan.mode,writeBefore:plan.writeBefore,counts,actions:{},changeSets:{},completedStages:[],stageProofs:{}};await store.createSnapshot({schema:ENV_SCHEMA,plan,configSha256:configHash(c)},j);await onAttemptStarted();
 const state=copy(before.stacks),apply=async(key,role,t,overrides={})=>{state[role]=await applyStack({c,io,store,j,key,role,current:state[role],target:t,overrides,waitSeconds:plan.waitSeconds});};
 try{
  const already=publicStatus(before,c).status===(plan.mode==='stop'?'STOPPED':'RUNNING');
  if(!already&&plan.mode==='stop'){
   for(const role of ['tenant','platform'])if(state[role].bindings[SERVICE[role]]){await apply(role+'-drain',role,variant(plan.base.templates[role],role,'full',0));await waitServiceZero(c,io,state[role],role,plan.waitSeconds);}
   for(const role of ['tenant','platform','cell'])await apply(role+'-idle',role,variant(plan.base.templates[role],role,'idle'));
   await databaseState(c,io,store,j,'stop',plan.waitSeconds);
  }else if(!already){
   for(const role of ['tenant','platform'])if(state[role].bindings[SERVICE[role]]&&before.services[role].desiredCount===0)await apply(role+'-align-zero',role,variant(plan.base.templates[role],role,'full',0));
   await databaseState(c,io,store,j,'start',plan.waitSeconds);
   await apply('cell-full','cell',variant(plan.base.templates.cell,'cell','full'));
   await apply('platform-full-zero','platform',variant(plan.base.templates.platform,'platform','full',0));
   const refs=Object.fromEntries(CELL_BINDINGS.map(k=>{ensure(typeof state.cell.outputs[k]==='string'&&state.cell.outputs[k].length>0,'CURRENT_CELL_OUTPUT_REQUIRED');const output=state.cell.outputs[k],old=state.tenant.parameters[k];return [k,k==='SubnetIds'&&same(old?.split(',').sort(),output.split(',').sort())?old:output];}));
   await apply('tenant-full-zero','tenant',variant(plan.base.templates.tenant,'tenant','full',0),refs);
   const routing={};for(const role of ['cell','platform'])routing[role]=await alb(c,io,state[role],role,plan.base.templates[role],state);
   const old=await alias(c,io,c.externalApiAlias.name);ensure(same(old,plan.observed.apiAlias),'EXTERNAL_ALIAS_CHANGED_OUTSIDE_TOOL');const record=copy(old),dual=name(record.AliasTarget.DNSName).startsWith('dualstack.');record.AliasTarget.DNSName=(dual?'dualstack.':'')+routing.cell.dnsName+'.';record.AliasTarget.HostedZoneId=routing.cell.zoneId;
   if(!same(record,old)){const ack=await writeOnce(io,store,j,'api-alias','route53','change-resource-record-sets',{HostedZoneId:c.externalApiAlias.zoneId,ChangeBatch:{Changes:[{Action:'UPSERT',ResourceRecordSet:record}]}});ensure(ack.ChangeInfo?.Id,'ALIAS_ACK_REQUIRED');const end=io.now()+plan.waitSeconds*1000;for(;;){if((await io.call('route53','get-change',{Id:ack.ChangeInfo.Id})).ChangeInfo?.Status==='INSYNC')break;ensure(io.now()<end,'ALIAS_WAIT_TIMEOUT_INSPECT');await io.sleep(Math.min(10000,end-io.now()));}}
   for(const role of ['platform','tenant'])await apply(role+'-running',role,variant(plan.base.templates[role],role,'full',c.stacks[role].desiredCount));
  }
  const proof=await captureEnvironment({config:c,io,base:plan.base,expectedMode:plan.mode==='stop'?'stopped':'running'}),result=publicStatus(proof,c);ensure(result.status===(plan.mode==='stop'?'STOPPED':'RUNNING'),'FINAL_OWNERSHIP_OR_COUNT_NOT_ACCEPTED');
  if(plan.mode==='start'){const end=io.now()+plan.waitSeconds*1000;for(;;){let healthy=true;for(const role of ['platform','tenant'])for(const g of proof.services[role].loadBalancers??[]){const h=await io.call('elbv2','describe-target-health',{TargetGroupArn:g.targetGroupArn});healthy=!!h.TargetHealthDescriptions?.length&&h.TargetHealthDescriptions.every(x=>x.TargetHealth?.State==='healthy')&&healthy;}if(healthy)break;ensure(io.now()<end,'TARGET_HEALTH_TIMEOUT_INSPECT');await io.sleep(Math.min(30000,end-io.now()));}}
  j.status=result.status;j.finishedAt=io.now();j.finalProof={stacks:proof.stacks,publicStatus:result};await store.saveJournal(j);return {...result,noWriteReplay:already,cloudFormationOwnershipVerified:true,noProductAcceptanceClaim:true};
 }catch(e){j.status='NEEDS_INSPECTION';j.error={code:e.code??e.message,operation:e.operation??null};await store.saveJournal(j);throw e;}
}
