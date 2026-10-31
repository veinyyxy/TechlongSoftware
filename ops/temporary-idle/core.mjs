// TEMPORARY TEST-COST POLICY. Nothing in the production deployment runtime imports this module.
import {digest,ensure,validateConfig as validatePowerConfig} from '../aws-resource-power/core.mjs';
export const SCHEMA='techlong/temporary-idle/v1';
const copy=v=>structuredClone(v),pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,copy(v[k])])),
  now=io=>io.now(),list=(v,max=100)=>Array.isArray(v)&&v.length<=max&&new Set(v.map(x=>JSON.stringify(x))).size===v.length;
const arn=(c,service,resource)=>`arn:aws:${service}:${c.region}:${c.accountId}:${resource}`;
const checkArn=(c,value,service,prefix)=>ensure(typeof value==='string'&&value.startsWith(arn(c,service,prefix))&&!/[\s*?]/.test(value),'RESOURCE_ACCOUNT_REGION');
export function deadline(value){
  ensure(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value),'UTC_DEADLINE_REQUIRED');
  const n=Date.parse(value);ensure(Number.isSafeInteger(n)&&new Date(n).toISOString()===value.replace(/(?<!\.\d{3})Z$/,'.000Z'),'INVALID_DEADLINE');return n;
}
export function validateConfig(c){
  const allowed=['schema','temporary','enabled','expiresAt','accountId','region','profile','services','standaloneTasks','schedules','rules','vpcIds','natGatewayIds','endpointIds','allocationIds','requiredNetworkTags','acknowledgeNetworkRecreation','power'];
  ensure(c?.schema===SCHEMA&&c.temporary===true&&typeof c.enabled==='boolean'&&Object.keys(c).every(k=>allowed.includes(k)),'TEMPORARY_CONFIG_REQUIRED');
  ensure(/^\d{12}$/.test(c.accountId)&&/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(c.region)&&/^[\w.-]+$/.test(c.profile),'CONFIG_IDENTITY');
  if(c.expiresAt!==null)deadline(c.expiresAt);
  for(const k of ['services','standaloneTasks','schedules','rules','vpcIds','natGatewayIds','endpointIds','allocationIds'])ensure(list(c[k]),'EXPLICIT_TARGET_LISTS_REQUIRED');
  for(const s of c.services){ensure(typeof s.cluster==='string'&&typeof s.service==='string','SERVICE_ID');if(s.cluster.startsWith('arn:'))checkArn(c,s.cluster,'ecs','cluster/');else ensure(/^[\w-]+$/.test(s.cluster),'CLUSTER_NAME');if(s.service.startsWith('arn:'))checkArn(c,s.service,'ecs','service/');else ensure(/^[\w-]+$/.test(s.service),'SERVICE_NAME');}
  for(const t of c.standaloneTasks){ensure(typeof t.cluster==='string'&&/^[\w-]+$/.test(t.cluster),'TASK_CLUSTER');checkArn(c,t.taskArn,'ecs','task/');}
  for(const s of c.schedules)ensure(/^[\w.-]+$/.test(s.name)&&/^[\w.-]+$/.test(s.group),'SCHEDULE_ID');
  for(const r of c.rules)ensure(/^[\w.-]+$/.test(r.name)&&/^[\w.-]+$/.test(r.bus),'RULE_ID');
  for(const [key,prefix]of [['vpcIds','vpc'],['natGatewayIds','nat'],['endpointIds','vpce'],['allocationIds','eipalloc']])for(const id of c[key])ensure(new RegExp(`^${prefix}-[a-f0-9]{8,17}$`).test(id),'NETWORK_ID');
  const network=c.natGatewayIds.length+c.endpointIds.length+c.allocationIds.length;
  ensure(!network||c.acknowledgeNetworkRecreation===true&&c.vpcIds.length>0&&c.requiredNetworkTags&&Object.keys(c.requiredNetworkTags).length>0,'NETWORK_RECREATION_ACK_AND_OWNERSHIP_REQUIRED');
  if(c.power){validatePowerConfig(c.power);ensure(['accountId','region','profile'].every(k=>c[k]===c.power[k]),'POWER_SCOPE_MISMATCH');}
  ensure(c.services.length+c.standaloneTasks.length+network+(c.power?1:0)>0,'EMPTY_CONFIG');return copy(c);
}
const active=c=>ensure(c.enabled===true&&c.temporary===true,'TEMPORARY_SWITCH_OFF');
async function identity(c,io){const r=await io.call('sts','get-caller-identity',{});ensure(r.Account===c.accountId&&r.Arn?.split(':')[4]===c.accountId,'SOURCE_ACCOUNT_MISMATCH');}
async function pages(io,service,operation,input,key,token='NextToken'){
  const rows=[],seen=new Set();let next;
  do{const r=await io.call(service,operation,{...input,...(next?{[token]:next}:{})});ensure(Array.isArray(r[key]),'AWS_LIST_RESPONSE');rows.push(...r[key]);next=r[token];ensure(!next||!seen.has(next),'PAGINATION_CYCLE');if(next)seen.add(next);ensure(seen.size<100&&rows.length<10000,'INVENTORY_LIMIT');}while(next);return rows;
}
const clusterArn=(c,s)=>s.cluster.startsWith('arn:')?s.cluster:arn(c,'ecs',`cluster/${s.cluster}`);
async function service(c,io,s){
  const r=await io.call('ecs','describe-services',{cluster:s.cluster,services:[s.service],include:['TAGS']});ensure(!r.failures?.length&&r.services?.length===1,'SERVICE_NOT_FOUND');const value=r.services[0];
  ensure(value.clusterArn===clusterArn(c,s),'SERVICE_CLUSTER_MISMATCH');checkArn(c,value.serviceArn,'ecs','service/');
  ensure(s.service.startsWith('arn:')?value.serviceArn===s.service:value.serviceName===s.service,'SERVICE_NAME_MISMATCH');
  ensure(value.status==='ACTIVE'&&(value.launchType==='FARGATE'||value.capacityProviderStrategy?.length&&value.capacityProviderStrategy.every(p=>['FARGATE','FARGATE_SPOT'].includes(p.capacityProvider))),'ONLY_ACTIVE_FARGATE_SERVICES');return value;
}
async function tasks(io,cluster,ids){if(!ids.length)return [];const r=await io.call('ecs','describe-tasks',{cluster,tasks:ids});ensure(!r.failures?.length&&r.tasks?.length===ids.length,'TASK_LOOKUP');return r.tasks.map(t=>{
  ensure(t.launchType==='FARGATE'||['FARGATE','FARGATE_SPOT'].includes(t.capacityProviderName),'ONLY_FARGATE_TASKS');
  return {taskArn:t.taskArn,clusterArn:t.clusterArn,group:t.group,lastStatus:t.lastStatus,taskDefinitionArn:t.taskDefinitionArn,
    eniIds:(t.attachments??[]).flatMap(a=>(a.details??[]).filter(d=>d.name==='networkInterfaceId').map(d=>d.value))};});}
const scheduleInput=s=>pick(s,['Name','GroupName','ScheduleExpression','ScheduleExpressionTimezone','StartDate','EndDate','FlexibleTimeWindow','Target','KmsKeyArn','Description','ActionAfterCompletion','State']);
function scheduledCluster(c,target){const allowed=new Set(c.services.map(s=>clusterArn(c,s)).concat(c.standaloneTasks.map(t=>arn(c,'ecs',`cluster/${t.cluster}`))));ensure(target?.EcsParameters&&allowed.has(target.Arn),'ONLY_DIRECT_SCOPED_ECS_SCHEDULES');}
function networkOwner(c,v){ensure(Object.entries(c.requiredNetworkTags).every(([k,val])=>(v.Tags??[]).some(t=>t.Key===k&&t.Value===val)),'NETWORK_TAG_MISMATCH');}
const cleanTags=tags=>(tags??[]).filter(t=>!t.Key.toLowerCase().startsWith('aws:'));
const routeKey=r=>['DestinationCidrBlock','DestinationIpv6CidrBlock','DestinationPrefixListId'].find(k=>r[k]);
async function routeTables(io,id){return pages(io,'ec2','describe-route-tables',{Filters:[{Name:'route.nat-gateway-id',Values:[id]}]},'RouteTables');}
async function capture(c,io){
  const snapshot={schema:SCHEMA,config:c,createdAt:now(io),services:[],standalone:[],schedules:[],rules:[],nats:[],endpoints:[],addresses:[]};
  for(const s of c.services){const value=await service(c,io,s),id=`service/${value.clusterArn.split('/').at(-1)}/${value.serviceName}`,
    targets=await pages(io,'application-autoscaling','describe-scalable-targets',{ServiceNamespace:'ecs',ScalableDimension:'ecs:service:DesiredCount',ResourceIds:[id]},'ScalableTargets');
    ensure(targets.length<=1&&targets.every(t=>t.ResourceId===id&&t.MinCapacity<=value.desiredCount&&value.desiredCount<=t.MaxCapacity),'SCALING_SCOPE_OR_CAPACITY_BOUNDS');
    const taskIds=await pages(io,'ecs','list-tasks',{cluster:s.cluster,serviceName:value.serviceName,desiredStatus:'RUNNING'},'taskArns','nextToken');
    const taskRows=[];for(let i=0;i<taskIds.length;i+=100)taskRows.push(...await tasks(io,s.cluster,taskIds.slice(i,i+100)));
    snapshot.services.push({scope:s,value:pick(value,['serviceArn','clusterArn','serviceName','createdAt','taskDefinition','desiredCount','loadBalancers']),scaling:targets,tasks:taskRows});
  }
  for(const t of c.standaloneTasks){const row=(await tasks(io,t.cluster,[t.taskArn]))[0];ensure(row.taskArn===t.taskArn&&row.clusterArn===arn(c,'ecs',`cluster/${t.cluster}`)&&!row.group?.startsWith('service:'),'STANDALONE_TASK_SCOPE');snapshot.standalone.push({scope:t,value:row});}
  for(const s of c.schedules){const r=await io.call('scheduler','get-schedule',{Name:s.name,GroupName:s.group});checkArn(c,r.Arn,'scheduler','schedule/');ensure(r.Name===s.name&&r.GroupName===s.group,'SCHEDULE_SCOPE');scheduledCluster(c,r.Target);snapshot.schedules.push(scheduleInput(r));}
  for(const rule of c.rules){const r=await io.call('events','describe-rule',{Name:rule.name,EventBusName:rule.bus});checkArn(c,r.Arn,'events','rule/');ensure(['ENABLED','DISABLED'].includes(r.State),'RULE_STATE');
    const targets=await pages(io,'events','list-targets-by-rule',{Rule:rule.name,EventBusName:rule.bus},'Targets');ensure(targets.length>0,'EMPTY_RULE');targets.forEach(t=>scheduledCluster(c,t));snapshot.rules.push({...rule,state:r.State,arn:r.Arn,targets});}
  for(const id of c.natGatewayIds){const r=await io.call('ec2','describe-nat-gateways',{NatGatewayIds:[id]}),n=r.NatGateways?.[0];
    ensure(r.NatGateways?.length===1&&n.NatGatewayId===id&&n.State==='available'&&c.vpcIds.includes(n.VpcId)&&n.AvailabilityMode!=='regional','NAT_SCOPE_OR_STATE');networkOwner(c,n);
    ensure(['public','private'].includes(n.ConnectivityType)&&n.NatGatewayAddresses?.length===1,'ONLY_SINGLE_ADDRESS_ZONAL_NAT');
    if(n.ConnectivityType==='public')ensure(c.allocationIds.includes(n.NatGatewayAddresses[0].AllocationId),'NAT_EIP_MUST_BE_EXPLICIT');
    const routes=[];for(const table of await routeTables(io,id)){networkOwner(c,table);for(const route of table.Routes.filter(r=>r.NatGatewayId===id)){const key=routeKey(route);ensure(key&&route.Origin==='CreateRoute','UNRESTORABLE_NAT_ROUTE');routes.push({RouteTableId:table.RouteTableId,[key]:route[key]});}}
    snapshot.nats.push({value:pick(n,['NatGatewayId','VpcId','SubnetId','ConnectivityType','NatGatewayAddresses','Tags']),routes});
  }
  for(const id of c.endpointIds){const r=await io.call('ec2','describe-vpc-endpoints',{VpcEndpointIds:[id]}),e=r.VpcEndpoints?.[0];
    ensure(r.VpcEndpoints?.length===1&&e.VpcEndpointId===id&&e.VpcEndpointType==='Interface'&&e.State==='available'&&!e.RequesterManaged&&c.vpcIds.includes(e.VpcId)&&(!e.OwnerId||e.OwnerId===c.accountId),'ONLY_OWNED_INTERFACE_ENDPOINTS');networkOwner(c,e);
    ensure(e.SubnetIds?.length&&e.Groups?.length&&typeof e.PolicyDocument==='string','ENDPOINT_NETWORK_CONFIG');normalizedJson(e.PolicyDocument);snapshot.endpoints.push(pick(e,['VpcEndpointId','VpcEndpointType','VpcId','ServiceName','ServiceRegion','SubnetIds','Groups','PolicyDocument','PrivateDnsEnabled','IpAddressType','DnsOptions','DnsEntries','Tags']));
  }
  for(const id of c.allocationIds){const r=await io.call('ec2','describe-addresses',{AllocationIds:[id]}),a=r.Addresses?.[0];ensure(r.Addresses?.length===1&&a.AllocationId===id&&a.Domain==='vpc'&&(!a.PublicIpv4Pool||a.PublicIpv4Pool==='amazon')&&!a.CustomerOwnedIp,'EIP_SCOPE');networkOwner(c,a);
    const ownedNat=snapshot.nats.some(n=>n.value.NatGatewayAddresses.some(x=>x.AllocationId===id&&x.NetworkInterfaceId===a.NetworkInterfaceId));ensure(!a.AssociationId||ownedNat,'EIP_STILL_USED_BY_UNSELECTED_RESOURCE');snapshot.addresses.push(pick(a,['AllocationId','PublicIp','NetworkBorderGroup','Tags']));}
  return snapshot;
}
async function write(io,store,j,key,svc,op,input){
  ensure(!j.actions[key],'WRITE_ALREADY_ATTEMPTED_NO_REPLAY');j.actions[key]={service:svc,operation:op,status:'SUBMITTING',at:now(io)};await store.saveJournal(j);
  try{const r=await io.call(svc,op,input);j.actions[key].status='ACKNOWLEDGED';await store.saveJournal(j);return r;}
  catch(e){j.actions[key].status='UNKNOWN_OR_REJECTED';j.status='NEEDS_INSPECTION';await store.saveJournal(j);throw e;}
}
async function wait(io,test,end){for(;;){if(await test())return true;if(now(io)>=end)return false;await io.sleep(Math.min(10000,end-now(io)));}}
async function absent(io,svc,op,input,key,code){try{const r=await io.call(svc,op,input);return !r[key]?.length;}catch(e){if(e.code===code)return true;throw e;}}
async function natGone(io,id){try{const r=await io.call('ec2','describe-nat-gateways',{NatGatewayIds:[id]});return !r.NatGateways?.some(n=>n.State!=='deleted');}catch(e){if(e.code==='InvalidNatGatewayID.NotFound')return true;throw e;}}
function normalizedJson(value){return normalizedJsonValue(typeof value==='string'?JSON.parse(value):value);}
function normalizedJsonValue(v){if(Array.isArray(v))return v.map(normalizedJsonValue);return v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalizedJsonValue(v[k])])):v;}
async function pausedSources(io,s){
  for(const x of s.services)for(const t of x.scaling){const r=await pages(io,'application-autoscaling','describe-scalable-targets',{ServiceNamespace:'ecs',ScalableDimension:'ecs:service:DesiredCount',ResourceIds:[t.ResourceId]},'ScalableTargets');ensure(r.length===1&&r[0].MinCapacity===0&&r[0].MaxCapacity===t.MaxCapacity&&['DynamicScalingInSuspended','DynamicScalingOutSuspended','ScheduledScalingSuspended'].every(k=>r[0].SuspendedState?.[k]===true),'SCALING_PAUSE_UNVERIFIED');}
  for(const x of s.schedules)if(x.State==='ENABLED'){const r=await io.call('scheduler','get-schedule',{Name:x.Name,GroupName:x.GroupName});ensure(r.State==='DISABLED'&&digest({...scheduleInput(r),State:x.State})===digest(x),'SCHEDULE_PAUSE_UNVERIFIED');}
  for(const x of s.rules)if(x.state==='ENABLED'){const r=await io.call('events','describe-rule',{Name:x.name,EventBusName:x.bus});ensure(r.Arn===x.arn&&r.State==='DISABLED','RULE_PAUSE_UNVERIFIED');}
}
async function stoppedCompute(c,io,s){
  for(const x of s.services){const r=await service(c,io,x.scope);ensure(r.createdAt===x.value.createdAt&&r.taskDefinition===x.value.taskDefinition,'SERVICE_REPLACED_OR_CHANGED');if(r.desiredCount!==0||r.runningCount!==0||r.pendingCount!==0)return false;
    if((await pages(io,'ecs','list-tasks',{cluster:x.scope.cluster,serviceName:x.value.serviceName,desiredStatus:'RUNNING'},'taskArns','nextToken')).length)return false;}
  for(const x of s.standalone){const r=await io.call('ecs','describe-tasks',{cluster:x.scope.cluster,tasks:[x.scope.taskArn]});if(r.tasks?.length&&r.tasks[0].lastStatus!=='STOPPED')return false;ensure(!r.failures?.some(f=>f.reason!=='MISSING'),'TASK_STATUS_UNKNOWN');}return true;
}
async function publicIpResiduals(io,s){
  const ids=[...new Set([...s.services.flatMap(x=>x.tasks),...s.standalone.map(x=>x.value)].flatMap(t=>t.eniIds))],remaining=[];
  for(const id of ids)try{const r=await io.call('ec2','describe-network-interfaces',{NetworkInterfaceIds:[id]});for(const eni of r.NetworkInterfaces??[])if(eni.Association?.PublicIp)remaining.push({networkInterfaceId:id,publicIp:eni.Association.PublicIp});}catch(e){if(e.code!=='InvalidNetworkInterfaceID.NotFound')throw e;}
  return remaining; // Never detach/delete requester-managed ENIs.
}
export async function idle({config,io,store,waitSeconds=1800,powerStop}){
  const c=validateConfig(config);active(c);ensure(Number.isInteger(waitSeconds)&&waitSeconds>=0&&waitSeconds<=7200,'WAIT_RANGE');await identity(c,io);const s=await capture(c,io),j={schema:SCHEMA,snapshotSha256:digest(s),status:'CAPTURED',actions:{},mapping:{allocations:{},publicIps:{},nats:{},endpoints:{}}};await store.createSnapshot(s,j);
  for(const x of s.schedules)if(x.State==='ENABLED')await write(io,store,j,`pause-schedule:${x.GroupName}/${x.Name}`,'scheduler','update-schedule',{...x,State:'DISABLED'});
  for(const x of s.rules)if(x.state==='ENABLED')await write(io,store,j,`pause-rule:${x.bus}/${x.name}`,'events','disable-rule',{Name:x.name,EventBusName:x.bus});
  for(const x of s.services){for(const t of x.scaling)await write(io,store,j,`pause-scaling:${t.ResourceId}`,'application-autoscaling','register-scalable-target',{ServiceNamespace:'ecs',ScalableDimension:'ecs:service:DesiredCount',ResourceId:t.ResourceId,MinCapacity:0,MaxCapacity:t.MaxCapacity,SuspendedState:{DynamicScalingInSuspended:true,DynamicScalingOutSuspended:true,ScheduledScalingSuspended:true}});
    if(x.value.desiredCount!==0)await write(io,store,j,`idle-service:${x.value.serviceArn}`,'ecs','update-service',{cluster:x.scope.cluster,service:x.value.serviceArn,desiredCount:0});}
  for(const x of s.standalone)if(x.value.lastStatus!=='STOPPED')await write(io,store,j,`stop-task:${x.value.taskArn}`,'ecs','stop-task',{cluster:x.scope.cluster,task:x.value.taskArn,reason:'TEMPORARY test-cost idle; do not replay standalone job'});
  ensure(await wait(io,()=>stoppedCompute(c,io,s),now(io)+waitSeconds*1000),'COMPUTE_IDLE_TIMEOUT_INSPECT');
  await pausedSources(io,s);
  if(c.power){ensure(typeof powerStop==='function','POWER_STOP_ADAPTER_REQUIRED');j.powerStopAttempted=true;await store.saveJournal(j);const result=await powerStop(c.power);ensure(result.verified===true,'POWER_STOP_NOT_VERIFIED');j.powerStopped=true;await store.saveJournal(j);}
  for(const x of s.nats){for(const route of x.routes)await write(io,store,j,`delete-route:${JSON.stringify(route)}`,'ec2','delete-route',route);await write(io,store,j,`delete-nat:${x.value.NatGatewayId}`,'ec2','delete-nat-gateway',{NatGatewayId:x.value.NatGatewayId});}
  for(const e of s.endpoints){const r=await write(io,store,j,`delete-endpoint:${e.VpcEndpointId}`,'ec2','delete-vpc-endpoints',{VpcEndpointIds:[e.VpcEndpointId]});ensure(!r.Unsuccessful?.length,'ENDPOINT_DELETE_REJECTED');}
  const gone=await wait(io,async()=>{
    for(const x of s.nats)if(!await natGone(io,x.value.NatGatewayId))return false;
    for(const e of s.endpoints)if(!await absent(io,'ec2','describe-vpc-endpoints',{VpcEndpointIds:[e.VpcEndpointId]},'VpcEndpoints','InvalidVpcEndpointId.NotFound'))return false;return true;
  },now(io)+waitSeconds*1000);ensure(gone,'NETWORK_DELETE_TIMEOUT_INSPECT');
  for(const a of s.addresses){const r=await io.call('ec2','describe-addresses',{AllocationIds:[a.AllocationId]});ensure(r.Addresses?.length===1&&!r.Addresses[0].AssociationId,'EIP_NOT_RELEASED_FROM_ATTACHMENT');await write(io,store,j,`release:${a.AllocationId}`,'ec2','release-address',{AllocationId:a.AllocationId});}
  for(const a of s.addresses)ensure(await absent(io,'ec2','describe-addresses',{AllocationIds:[a.AllocationId]},'Addresses','InvalidAllocationID.NotFound'),'EIP_RELEASE_UNVERIFIED');
  j.publicIpResiduals=await publicIpResiduals(io,s);j.status=j.publicIpResiduals.length?'IDLE_WITH_PUBLIC_IP_RESIDUALS':'TEMPORARY_IDLE_VERIFIED';j.finishedAt=now(io);await store.saveJournal(j);return {status:j.status,computeIdle:true,publicIpResiduals:j.publicIpResiduals,zeroAccountCharges:false,standaloneTasksWillNotReplay:s.standalone.length};
}
async function loaded(store){const {snapshot:s,journal:j}=await store.load();ensure(s.schema===SCHEMA&&j.schema===SCHEMA&&digest(s)===j.snapshotSha256,'BACKUP_INTEGRITY');validateConfig(s.config);active(s.config);return {s,j,c:s.config};}
const tagSpec=(type,tags)=>cleanTags(tags).length?[{ResourceType:type,Tags:cleanTags(tags)}]:[];
export async function restoreNetwork({io,store,waitSeconds=1800}){
  const {s,j,c}=await loaded(store);ensure(['TEMPORARY_IDLE_VERIFIED','IDLE_WITH_PUBLIC_IP_RESIDUALS'].includes(j.status),'IDLE_NOT_COMPLETED');ensure(!Object.hasOwn(j,'networkRestoreStarted'),'NETWORK_RESTORE_ALREADY_ATTEMPTED');await identity(c,io);
  ensure(await stoppedCompute(c,io,s),'COMPUTE_RESTARTED_BEFORE_NETWORK_RESTORE');
  for(const a of s.addresses)ensure(await absent(io,'ec2','describe-addresses',{AllocationIds:[a.AllocationId]},'Addresses','InvalidAllocationID.NotFound'),'OLD_EIP_EXISTS');
  for(const e of s.endpoints)ensure(await absent(io,'ec2','describe-vpc-endpoints',{VpcEndpointIds:[e.VpcEndpointId]},'VpcEndpoints','InvalidVpcEndpointId.NotFound'),'OLD_ENDPOINT_EXISTS');
  for(const n of s.nats){ensure(await natGone(io,n.value.NatGatewayId),'OLD_NAT_EXISTS');for(const route of n.routes){const r=await io.call('ec2','describe-route-tables',{RouteTableIds:[route.RouteTableId]});ensure(r.RouteTables?.length===1&&!r.RouteTables[0].Routes.some(x=>x[routeKey(route)]===route[routeKey(route)]),'ROUTE_OCCUPIED');}}
  j.networkRestoreStarted=now(io);await store.saveJournal(j);
  for(const a of s.addresses){if(!s.nats.some(n=>n.value.NatGatewayAddresses.some(x=>x.AllocationId===a.AllocationId))){j.mapping.allocations[a.AllocationId]=null;j.mapping.publicIps[a.PublicIp]=null;await store.saveJournal(j);continue;}
    const r=await write(io,store,j,`allocate:${a.AllocationId}`,'ec2','allocate-address',{Domain:'vpc',...(a.NetworkBorderGroup?{NetworkBorderGroup:a.NetworkBorderGroup}:{}),TagSpecifications:tagSpec('elastic-ip',a.Tags)});ensure(r.AllocationId&&r.PublicIp,'EIP_CREATE_RESPONSE');j.mapping.allocations[a.AllocationId]=r.AllocationId;j.mapping.publicIps[a.PublicIp]=r.PublicIp;await store.saveJournal(j);}
  for(const x of s.nats){const n=x.value,a=n.NatGatewayAddresses[0],r=await write(io,store,j,`create-nat:${n.NatGatewayId}`,'ec2','create-nat-gateway',{SubnetId:n.SubnetId,ConnectivityType:n.ConnectivityType,...(n.ConnectivityType==='public'?{AllocationId:j.mapping.allocations[a.AllocationId]}:{}),TagSpecifications:tagSpec('natgateway',n.Tags)});
    ensure(r.NatGateway?.NatGatewayId,'NAT_CREATE_RESPONSE');const id=r.NatGateway.NatGatewayId;j.mapping.nats[n.NatGatewayId]=id;await store.saveJournal(j);
    ensure(await wait(io,async()=>{let r;try{r=await io.call('ec2','describe-nat-gateways',{NatGatewayIds:[id]});}catch(e){if(e.code==='InvalidNatGatewayID.NotFound')return false;throw e;}ensure(!r.NatGateways?.some(v=>v.State==='failed'),'NAT_CREATE_FAILED');const v=r.NatGateways?.[0];if(v?.State!=='available')return false;ensure(v.VpcId===n.VpcId&&v.SubnetId===n.SubnetId&&v.ConnectivityType===n.ConnectivityType&&(n.ConnectivityType!=='public'||v.NatGatewayAddresses.some(a=>a.AllocationId===j.mapping.allocations[n.NatGatewayAddresses[0].AllocationId])),'RESTORED_NAT_MISMATCH');return true;},now(io)+waitSeconds*1000),'NAT_READY_TIMEOUT_INSPECT');
    for(const route of x.routes)await write(io,store,j,`restore-route:${JSON.stringify(route)}`,'ec2','create-route',{...route,NatGatewayId:id});
  }
  for(const e of s.endpoints){const r=await write(io,store,j,`create-endpoint:${e.VpcEndpointId}`,'ec2','create-vpc-endpoint',{...pick(e,['VpcEndpointType','VpcId','ServiceName','ServiceRegion','SubnetIds','PolicyDocument','PrivateDnsEnabled','IpAddressType','DnsOptions']),SecurityGroupIds:e.Groups.map(g=>g.GroupId),TagSpecifications:tagSpec('vpc-endpoint',e.Tags)});
    ensure(r.VpcEndpoint?.VpcEndpointId,'ENDPOINT_CREATE_RESPONSE');const id=r.VpcEndpoint.VpcEndpointId;j.mapping.endpoints[e.VpcEndpointId]=id;await store.saveJournal(j);
    ensure(await wait(io,async()=>{try{const r=await io.call('ec2','describe-vpc-endpoints',{VpcEndpointIds:[id]});return r.VpcEndpoints?.[0]?.State==='available';}catch(e){if(e.code==='InvalidVpcEndpointId.NotFound')return false;throw e;}},now(io)+waitSeconds*1000),'ENDPOINT_READY_TIMEOUT_INSPECT');
  }
  for(const a of s.addresses){const id=j.mapping.allocations[a.AllocationId];if(!id)continue;const r=await io.call('ec2','describe-addresses',{AllocationIds:[id]});ensure(r.Addresses?.length===1&&r.Addresses[0].PublicIp===j.mapping.publicIps[a.PublicIp],'RESTORED_EIP_MISMATCH');}
  for(const x of s.nats)for(const route of x.routes){const r=await io.call('ec2','describe-route-tables',{RouteTableIds:[route.RouteTableId]});ensure(r.RouteTables?.[0]?.Routes?.some(v=>v[routeKey(route)]===route[routeKey(route)]&&v.NatGatewayId===j.mapping.nats[x.value.NatGatewayId]),'RESTORED_ROUTE_MISMATCH');}
  for(const e of s.endpoints){const r=await io.call('ec2','describe-vpc-endpoints',{VpcEndpointIds:[j.mapping.endpoints[e.VpcEndpointId]]}),v=r.VpcEndpoints?.[0];
    ensure(v?.State==='available'&&v.VpcId===e.VpcId&&v.ServiceName===e.ServiceName&&v.PrivateDnsEnabled===e.PrivateDnsEnabled&&
      v.IpAddressType===e.IpAddressType&&digest(v.DnsOptions??null)===digest(e.DnsOptions??null)&&digest([...v.SubnetIds].sort())===digest([...e.SubnetIds].sort())&&digest(v.Groups.map(g=>g.GroupId).sort())===digest(e.Groups.map(g=>g.GroupId).sort())&&digest(normalizedJson(v.PolicyDocument))===digest(normalizedJson(e.PolicyDocument)),'RESTORED_ENDPOINT_MISMATCH');
    j.mapping.endpointDns??={};j.mapping.endpointDns[e.VpcEndpointId]={old:e.DnsEntries??[],new:v.DnsEntries??[]};}
  j.status='NETWORK_RESTORED_COMPUTE_STILL_IDLE';await store.saveJournal(j);return {status:j.status,mapping:j.mapping,computeStarted:false};
}
async function checkPower(c,io,proof){
  ensure(proof?.snapshot&&proof?.journal&&proof.journal.snapshotSha256===digest(proof.snapshot)&&proof.journal.status==='RESOURCES_RECREATED_BINDINGS_REQUIRE_REVIEW','POWER_RESTORE_PROOF_REQUIRED');
  validatePowerConfig(proof.snapshot.config);ensure(Array.isArray(proof.journal.mapping)&&proof.journal.mapping.length===proof.snapshot.config.loadBalancerArns.length&&proof.snapshot.config.loadBalancerArns.every(a=>proof.journal.mapping.some(m=>m.oldArn===a)),'POWER_MAPPING_INCOMPLETE');
  ensure(proof.snapshot.config.accountId===c.accountId&&proof.snapshot.config.region===c.region,'POWER_RESTORE_SCOPE');
  for(const db of proof.snapshot.databases.filter(d=>d.status==='available')){const cluster=db.kind==='cluster',r=await io.call('rds',cluster?'describe-db-clusters':'describe-db-instances',cluster?{DBClusterIdentifier:db.id}:{DBInstanceIdentifier:db.id}),d=(cluster?r.DBClusters:r.DBInstances)?.[0];ensure(d&&(cluster?d.DbClusterResourceId:d.DbiResourceId)===db.resourceId&&(cluster?d.Status:d.DBInstanceStatus)==='available','POWER_DATABASE_NOT_READY');}
  for(const m of proof.journal.mapping){checkArn(c,m.newArn,'elasticloadbalancing','loadbalancer/app/');const r=await io.call('elbv2','describe-load-balancers',{LoadBalancerArns:[m.newArn]});ensure(r.LoadBalancers?.[0]?.LoadBalancerArn===m.newArn&&r.LoadBalancers[0].State?.Code==='active','POWER_ALB_NOT_READY');}
  return new Set(proof.journal.mapping.map(m=>m.newArn));
}
export async function resumeCompute({io,store,powerProof,bindingsReviewed=false,waitSeconds=1800}){
  const {s,j,c}=await loaded(store);ensure(j.status==='NETWORK_RESTORED_COMPUTE_STILL_IDLE'&&!Object.hasOwn(j,'computeResumeStarted'),'NETWORK_RESTORE_FIRST');ensure(bindingsReviewed===true,'NEW_BINDINGS_REVIEW_REQUIRED');await identity(c,io);const albs=await checkPower(c,io,powerProof);
  for(const x of s.services){const r=await service(c,io,x.scope);ensure(r.createdAt===x.value.createdAt&&r.taskDefinition===x.value.taskDefinition&&r.desiredCount===0&&digest(r.loadBalancers??[])===digest(x.value.loadBalancers??[]),'SERVICE_CHANGED_WHILE_IDLE');for(const group of x.value.loadBalancers??[]){const t=await io.call('elbv2','describe-target-groups',{TargetGroupArns:[group.targetGroupArn]});ensure(t.TargetGroups?.length===1&&t.TargetGroups[0].LoadBalancerArns?.some(a=>albs.has(a)),'SERVICE_ALB_BINDING_NOT_READY');}}
  for(const x of s.services)for(const t of x.scaling){const r=await pages(io,'application-autoscaling','describe-scalable-targets',{ServiceNamespace:'ecs',ScalableDimension:'ecs:service:DesiredCount',ResourceIds:[t.ResourceId]},'ScalableTargets');ensure(r.length===1&&r[0].MinCapacity===0&&r[0].MaxCapacity===t.MaxCapacity&&['DynamicScalingInSuspended','DynamicScalingOutSuspended','ScheduledScalingSuspended'].every(k=>r[0].SuspendedState?.[k]===true),'SCALING_CHANGED_WHILE_IDLE');}
  for(const x of s.schedules)if(x.State==='ENABLED'&&!x.ScheduleExpression.startsWith('at(')&&!(x.EndDate&&Date.parse(x.EndDate)<=now(io))){const r=await io.call('scheduler','get-schedule',{Name:x.Name,GroupName:x.GroupName});ensure(r.State==='DISABLED'&&digest({...scheduleInput(r),State:x.State})===digest(x),'SCHEDULE_CHANGED_WHILE_IDLE');}
  for(const x of s.rules)if(x.state==='ENABLED'){const r=await io.call('events','describe-rule',{Name:x.name,EventBusName:x.bus}),targets=await pages(io,'events','list-targets-by-rule',{Rule:x.name,EventBusName:x.bus},'Targets');ensure(r.Arn===x.arn&&r.State==='DISABLED'&&digest([...targets].sort((a,b)=>a.Id.localeCompare(b.Id)))===digest([...x.targets].sort((a,b)=>a.Id.localeCompare(b.Id))),'RULE_CHANGED_WHILE_IDLE');}
  j.computeResumeStarted=now(io);await store.saveJournal(j);
  for(const x of s.services)if(x.value.desiredCount>0)await write(io,store,j,`resume:${x.value.serviceArn}`,'ecs','update-service',{cluster:x.scope.cluster,service:x.value.serviceArn,desiredCount:x.value.desiredCount});
  ensure(await wait(io,async()=>{for(const x of s.services){const r=await service(c,io,x.scope);if(r.desiredCount!==x.value.desiredCount||r.runningCount!==x.value.desiredCount||r.pendingCount!==0)return false;}return true;},now(io)+waitSeconds*1000),'COMPUTE_READY_TIMEOUT_INSPECT');
  for(const x of s.services)for(const t of x.scaling)await write(io,store,j,`restore-scaling:${t.ResourceId}`,'application-autoscaling','register-scalable-target',{ServiceNamespace:'ecs',ScalableDimension:'ecs:service:DesiredCount',ResourceId:t.ResourceId,MinCapacity:t.MinCapacity,MaxCapacity:t.MaxCapacity,SuspendedState:t.SuspendedState??{DynamicScalingInSuspended:false,DynamicScalingOutSuspended:false,ScheduledScalingSuspended:false}});
  j.skippedOneShotSchedules=[];
  for(const x of s.schedules)if(x.State==='ENABLED'){if(x.ScheduleExpression.startsWith('at(')||x.EndDate&&Date.parse(x.EndDate)<=now(io)){j.skippedOneShotSchedules.push(`${x.GroupName}/${x.Name}`);continue;}await write(io,store,j,`enable-schedule:${x.GroupName}/${x.Name}`,'scheduler','update-schedule',x);}
  for(const x of s.rules)if(x.state==='ENABLED')await write(io,store,j,`enable-rule:${x.bus}/${x.name}`,'events','enable-rule',{Name:x.name,EventBusName:x.bus});
  j.status='TEMPORARY_COMPUTE_RESUMED';await store.saveJournal(j);return {status:j.status,standaloneTasksReplayed:0,skippedOneShotSchedules:j.skippedOneShotSchedules,applicationAccepted:false};
}
export async function waitForExpiry(config,io){const c=validateConfig(config);active(c);const at=deadline(c.expiresAt);ensure(at-now(io)<=7*86400000,'WATCH_TOO_FAR_IN_FUTURE');while(now(io)<at)await io.sleep(Math.min(30000,at-now(io)));return {expiredAt:at};}
