// TEMPORARY operator-only composition. Never import from application/runtime code.
import {digest,ensure,capturePowerSnapshot,stopResources,resumeResources} from '../aws-resource-power/core.mjs';
import {validateConfig as validateIdle,idle,restoreNetwork,resumeCompute} from './core.mjs';

export const ENV_SCHEMA='techlong/temporary-environment/v1';
const copy=v=>structuredClone(v),keys=(v,allowed)=>v&&Object.keys(v).every(k=>allowed.includes(k)),
  list=v=>Array.isArray(v)&&v.length<=50,unique=v=>new Set(v).size===v.length,
  dnsName=v=>String(v).toLowerCase().replace(/\.$/,''),lbDns=v=>dnsName(v).replace(/^dualstack\./,'');
export function validateEnvironment(c){
  ensure(keys(c,['schema','temporary','enabled','accountId','region','profile','expectedPrincipalArn','stateDirectory','awsCliExecutable','services','databases','loadBalancers','requiredLoadBalancerTags','network','dns','acknowledgeCloudFormationDrift','allowDisableDeletionProtection'])&&c.schema===ENV_SCHEMA&&c.temporary===true&&typeof c.enabled==='boolean','ENVIRONMENT_CONFIG');
  ensure(typeof c.stateDirectory==='string'&&c.stateDirectory.length>3&&!/[\r\n\0]/.test(c.stateDirectory),'STATE_DIRECTORY_REQUIRED');
  ensure(typeof c.expectedPrincipalArn==='string'&&c.expectedPrincipalArn.startsWith('arn:aws:')&&c.expectedPrincipalArn.includes(`:${c.accountId}:`)&&!/[\s*?]/.test(c.expectedPrincipalArn),'EXACT_PRINCIPAL_REQUIRED');
  ensure(c.awsCliExecutable===undefined||typeof c.awsCliExecutable==='string'&&c.awsCliExecutable.length>0&&!/[\r\n\0]/.test(c.awsCliExecutable),'AWS_CLI_PATH');
  ensure(list(c.services)&&c.services.length>0&&unique(c.services.map(s=>s.cluster+'/'+s.service)),'ENVIRONMENT_SERVICES');
  for(const s of c.services)ensure(keys(s,['cluster','service','requireControllerClosed','desiredCount'])&&typeof s.requireControllerClosed==='boolean'&&Number.isInteger(s.desiredCount)&&s.desiredCount>=0&&s.desiredCount<=20,'SERVICE_POLICY');
  ensure(list(c.databases)&&c.databases.length>0&&unique(c.databases.map(d=>d.kind+'/'+d.id)),'ENVIRONMENT_DATABASES');
  for(const d of c.databases)ensure(keys(d,['kind','id','resourceId'])&&['cluster','instance'].includes(d.kind)&&/^[A-Za-z0-9_-]{3,100}$/.test(d.resourceId),'EXPECTED_DATABASE_ID_REQUIRED');
  ensure(keys(c.network,['vpcIds','natGatewayIds','endpointIds','allocationIds','requiredNetworkTags','acknowledgeNetworkRecreation'])&&list(c.network.vpcIds),'NETWORK_POLICY');
  ensure(list(c.loadBalancers)&&c.loadBalancers.length>0&&unique(c.loadBalancers.map(l=>l.name)),'NAMED_ALBS_REQUIRED');
  for(const l of c.loadBalancers)ensure(keys(l,['name','vpcId'])&&/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(l.name)&&!l.name.startsWith('internal-')&&c.network.vpcIds.includes(l.vpcId),'ALB_NAME_VPC_SCOPE');
  ensure(c.requiredLoadBalancerTags&&Object.keys(c.requiredLoadBalancerTags).length>0&&Object.entries(c.requiredLoadBalancerTags).every(([k,v])=>k&&typeof v==='string'&&v.length>0),'ALB_OWNERSHIP_TAGS_REQUIRED');
  ensure(keys(c.dns,['zoneId','records'])&&/^Z[A-Z0-9]+$/.test(c.dns.zoneId)&&list(c.dns.records)&&unique(c.dns.records.map(r=>dnsName(r.name))),'DNS_POLICY');
  for(const r of c.dns.records)ensure(keys(r,['name','loadBalancerName'])&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?$/.test(r.name)&&c.loadBalancers.some(l=>l.name===r.loadBalancerName),'EXACT_DNS_BINDING_REQUIRED');
  makeIdleConfig(c,[]);return copy(c);
}
export function makeIdleConfig(c,arns){
  return validateIdle({schema:'techlong/temporary-idle/v1',temporary:true,enabled:c.enabled,expiresAt:null,
    accountId:c.accountId,region:c.region,profile:c.profile,services:c.services.map(s=>({cluster:s.cluster,service:s.service})),
    standaloneTasks:[],schedules:[],rules:[],...copy(c.network),power:{accountId:c.accountId,region:c.region,profile:c.profile,
      rdsClusters:c.databases.filter(d=>d.kind==='cluster').map(d=>d.id),rdsInstances:c.databases.filter(d=>d.kind==='instance').map(d=>d.id),
      loadBalancerArns:arns,acknowledgeCloudFormationDrift:c.acknowledgeCloudFormationDrift,allowDisableDeletionProtection:c.allowDisableDeletionProtection}});
}
async function identity(c,io){const who=await io.call('sts','get-caller-identity',{});ensure(who.Account===c.accountId&&who.Arn===c.expectedPrincipalArn,'ENVIRONMENT_IDENTITY_MISMATCH');}
async function namedLb(c,io,spec,missing=false){
  let r;try{r=await io.call('elbv2','describe-load-balancers',{Names:[spec.name]});}catch(e){if(missing&&['LoadBalancerNotFound','LoadBalancerNotFoundException'].includes(e.code))return null;throw e;}
  if(missing&&r.LoadBalancers?.length===0)return null;
  ensure(r.LoadBalancers?.length===1&&!r.NextMarker,'EXACT_NAMED_ALB_REQUIRED');const lb=r.LoadBalancers[0];
  ensure(lb.LoadBalancerName===spec.name&&lb.Type==='application'&&lb.VpcId===spec.vpcId&&lb.LoadBalancerArn?.startsWith(`arn:aws:elasticloadbalancing:${c.region}:${c.accountId}:loadbalancer/app/`),'NAMED_ALB_IDENTITY_MISMATCH');
  const tags=(await io.call('elbv2','describe-tags',{ResourceArns:[lb.LoadBalancerArn]})).TagDescriptions;
  ensure(tags?.length===1&&tags[0].ResourceArn===lb.LoadBalancerArn&&Object.entries(c.requiredLoadBalancerTags).every(([k,v])=>tags[0].Tags?.some(t=>t.Key===k&&t.Value===v)),'ALB_OWNERSHIP_MISMATCH');return lb;
}
async function service(c,io,s){const r=await io.call('ecs','describe-services',{cluster:s.cluster,services:[s.service],include:['TAGS']});
  ensure(!r.failures?.length&&r.services?.length===1,'SERVICE_LOOKUP_FAILED');const v=r.services[0],prefix=`arn:aws:ecs:${c.region}:${c.accountId}:`;
  ensure(v.clusterArn===(s.cluster.startsWith('arn:')?s.cluster:prefix+'cluster/'+s.cluster)&&v.serviceArn?.startsWith(prefix+'service/')&&(s.service.startsWith('arn:')?v.serviceArn===s.service:v.serviceName===s.service),'SERVICE_IDENTITY_MISMATCH');
  ensure(v.status==='ACTIVE'&&(v.launchType==='FARGATE'||v.capacityProviderStrategy?.length&&v.capacityProviderStrategy.every(p=>['FARGATE','FARGATE_SPOT'].includes(p.capacityProvider))),'EXPECTED_ACTIVE_FARGATE_SERVICE');return v;}
async function database(io,d){const cluster=d.kind==='cluster',r=await io.call('rds',cluster?'describe-db-clusters':'describe-db-instances',cluster?{DBClusterIdentifier:d.id}:{DBInstanceIdentifier:d.id}),rows=cluster?r.DBClusters:r.DBInstances,v=rows?.[0];
  ensure(rows?.length===1&&!r.Marker&&(cluster?v.DBClusterIdentifier:v.DBInstanceIdentifier)===d.id&&(cluster?v.DbClusterResourceId:v.DbiResourceId)===d.resourceId,'ENVIRONMENT_DATABASE_REPLACED');return {kind:d.kind,id:d.id,resourceId:d.resourceId,state:cluster?v.Status:v.DBInstanceStatus};}
async function alias(c,io,name){const r=await io.call('route53','list-resource-record-sets',{HostedZoneId:c.dns.zoneId,StartRecordName:name,StartRecordType:'A',MaxItems:'5'}),records=r.ResourceRecordSets?.filter(x=>dnsName(x.Name)===dnsName(name)&&x.Type==='A');
  ensure(records?.length===1&&records[0].AliasTarget&&!(r.IsTruncated&&dnsName(r.NextRecordName)===dnsName(name)&&r.NextRecordType==='A'),'EXACT_EXISTING_ALIAS_REQUIRED');return records[0];}
function assertDatabases(c,snapshot){for(const d of c.databases){const saved=snapshot.databases.find(x=>x.kind===d.kind&&x.id===d.id);ensure(saved?.resourceId===d.resourceId,'SAVED_DATABASE_IDENTITY_MISMATCH');}}
async function assertClosed(io,scope,taskDefinition){if(!scope.requireControllerClosed)return;const d=(await io.call('ecs','describe-task-definition',{taskDefinition})).taskDefinition;ensure(d?.taskDefinitionArn===taskDefinition&&d.containerDefinitions?.length===1,'TASK_DEFINITION_RESPONSE');const container=d.containerDefinitions[0],env=new Map((container.environment??[]).map(x=>[x.name,x.value])),privateNames=['TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'];
  ensure(!container.command?.includes('--hosted-controller')&&env.get('TECHLONG_PLATFORM_CONTROLLER_ENABLED')==='false'&&!container.secrets?.some(x=>privateNames.includes(x.name))&&!privateNames.some(n=>env.get(n)),'PLATFORM_CONTROLLER_NOT_CLOSED');}
export async function environmentStatus({config,io}){
  const c=validateEnvironment(config);await identity(c,io);const r={databases:[],services:[],loadBalancers:[],dns:[],zeroAccountCharges:false};
  for(const d of c.databases)r.databases.push(await database(io,d));
  for(const s of c.services){const v=await service(c,io,s);r.services.push({cluster:s.cluster,service:v.serviceName,desired:v.desiredCount,running:v.runningCount,pending:v.pendingCount,taskDefinition:v.taskDefinition,expectedDesired:s.desiredCount});}
  for(const spec of c.loadBalancers){const v=await namedLb(c,io,spec,true);r.loadBalancers.push(v?{name:spec.name,arn:v.LoadBalancerArn,dns:v.DNSName,state:v.State?.Code}:{name:spec.name,state:'absent'});}
  for(const spec of c.dns.records){const rr=await alias(c,io,spec.name),lb=r.loadBalancers.find(l=>l.name===spec.loadBalancerName);r.dns.push({name:rr.Name,target:rr.AliasTarget.DNSName,matchesCurrentAlb:!!lb?.dns&&lbDns(rr.AliasTarget.DNSName)===lbDns(lb.dns)});}
  const running=r.databases.every(d=>d.state==='available')&&r.services.every(s=>s.desired===s.expectedDesired&&s.running===s.expectedDesired&&s.pending===0)&&r.loadBalancers.every(l=>l.state==='active')&&r.dns.every(d=>d.matchesCurrentAlb),
    stopped=r.databases.every(d=>d.state==='stopped')&&r.services.every(s=>s.desired===0&&s.running===0&&s.pending===0)&&r.loadBalancers.every(l=>l.state==='absent');
  return {status:running?'RUNNING':stopped?'STOPPED':'PARTIAL_OR_TRANSITIONING',...r};
}
export async function stopEnvironment({config,io,cycleStore,idleStore,powerStore,waitSeconds=1800}){
  const c=validateEnvironment(config);ensure(c.enabled,'ENVIRONMENT_DISABLED');await identity(c,io);const arns=[],lbs=[];
  for(const scope of c.services){const live=await service(c,io,scope);ensure(live.desiredCount===scope.desiredCount,'SERVICE_COUNT_CHANGED_BEFORE_STOP');}
  for(const spec of c.loadBalancers){const lb=await namedLb(c,io,spec);arns.push(lb.LoadBalancerArn);lbs.push(lb);}
  const resolved=makeIdleConfig(c,arns),powerPreflight=await capturePowerSnapshot({config:resolved.power,io});assertDatabases(c,powerPreflight);
  const dns=[];for(const spec of c.dns.records){const record=await alias(c,io,spec.name),lb=lbs.find(l=>l.LoadBalancerName===spec.loadBalancerName);ensure(lbDns(record.AliasTarget.DNSName)===lbDns(lb.DNSName)&&record.AliasTarget.HostedZoneId===lb.CanonicalHostedZoneId,'DNS_NOT_BOUND_TO_SELECTED_ALB');dns.push({...spec,record});}
  const snapshot={schema:ENV_SCHEMA,config:c,resolved,dns,powerPreflight,createdAt:io.now()},j={schema:ENV_SCHEMA,snapshotSha256:digest(snapshot),status:'STOPPING',stages:{},actions:{}};
  await cycleStore.createSnapshot(snapshot,j); // Complete ALB/DNS preflight backup before ECS is changed.
  try{
    const result=await idle({config:resolved,io,store:idleStore,waitSeconds,powerStop:async cfg=>{
      const actual=await capturePowerSnapshot({config:cfg,io});assertDatabases(c,actual);
      ensure(actual.loadBalancers.every(l=>powerPreflight.loadBalancers.some(b=>b.description.LoadBalancerArn===l.description.LoadBalancerArn&&b.description.DNSName===l.description.DNSName)),'POWER_TARGET_CHANGED');
      return stopResources({config:cfg,io,store:powerStore,waitSeconds});}});
    j.status=result.publicIpResiduals?.length?'STOPPED_WITH_PUBLIC_IP_RESIDUALS':'STOPPED';j.stoppedAt=io.now();j.stopResult=result;await cycleStore.saveJournal(j);return {...result,status:j.status};
  }catch(e){j.status='STOP_FAILED_INSPECT';j.failure={code:e.code??e.message,operation:e.operation??null};await cycleStore.saveJournal(j);throw e;}
}
export async function loadEnvironmentCycle(cycleStore){const snapshot=await cycleStore.read('snapshot.json'),journal=await cycleStore.read('journal.json');ensure(snapshot.schema===ENV_SCHEMA&&journal.schema===ENV_SCHEMA&&journal.snapshotSha256===digest(snapshot),'ENVIRONMENT_BACKUP_INTEGRITY');validateEnvironment(snapshot.config);return {snapshot,journal};}
async function currentAliases(snapshot,io,expected){for(const s of snapshot.dns){const live=await alias(snapshot.config,io,s.name),want=expected?.find(x=>x.name===s.name)?.record??s.record;ensure(digest(live)===digest(want),'DNS_CHANGED_OUTSIDE_TOOL');}}
async function restoredBindings(snapshot,mapping){return snapshot.dns.map(s=>{const old=snapshot.powerPreflight.loadBalancers.find(l=>l.description.LoadBalancerName===s.loadBalancerName),m=mapping.find(x=>x.oldArn===old?.description.LoadBalancerArn);ensure(m?.newArn&&m.newDnsName&&m.newHostedZoneId,'RESTORE_MAPPING_REQUIRED');const rr=copy(s.record),dual=dnsName(rr.AliasTarget.DNSName).startsWith('dualstack.');rr.AliasTarget.DNSName=(dual?'dualstack.':'')+m.newDnsName+'.';rr.AliasTarget.HostedZoneId=m.newHostedZoneId;return {...s,record:rr};});}
export async function startEnvironment({config,io,cycleStore,idleStore,powerStore,waitSeconds=1800}){
  const c=validateEnvironment(config);ensure(c.enabled&&waitSeconds>0,'START_REQUIRES_ENABLED_AND_WAIT');const {snapshot,journal:j}=await loadEnvironmentCycle(cycleStore);
  ensure(digest(snapshot.config)===digest(c),'ENVIRONMENT_CONFIG_CHANGED_SINCE_STOP');ensure(['STOPPED','STOPPED_WITH_PUBLIC_IP_RESIDUALS','STARTING','START_FAILED_INSPECT','RUNNING'].includes(j.status),'SUCCESSFUL_STOP_BACKUP_REQUIRED');await identity(c,io);
  if(j.status==='RUNNING')return {...(await environmentStatus({config:c,io})),noWriteReplay:true};
  await currentAliases(snapshot,io,j.stages.dns==='COMPLETED'?j.restoredDns:null);
  const savedPower=await powerStore.load();assertDatabases(c,savedPower.snapshot);
  ensure(digest(savedPower.snapshot.config)===digest(snapshot.resolved.power),'POWER_BACKUP_SCOPE_CHANGED');
  const paused=await idleStore.load();for(const saved of paused.snapshot.services){const scope=c.services.find(s=>s.cluster===saved.scope.cluster&&s.service===saved.scope.service);ensure(scope,'SERVICE_SCOPE_CHANGED');const live=await service(c,io,scope);ensure(live.serviceArn===saved.value.serviceArn&&live.taskDefinition===saved.value.taskDefinition&&live.createdAt===saved.value.createdAt&&digest(live.loadBalancers??[])===digest(saved.value.loadBalancers??[]),'SERVICE_REPLACED_OR_CHANGED');
    if(!j.stages.compute)ensure(live.desiredCount===0&&live.runningCount===0&&live.pendingCount===0,'COMPUTE_RESTARTED_OUTSIDE_TOOL');await assertClosed(io,scope,live.taskDefinition);}
  j.status='STARTING';await cycleStore.saveJournal(j);
  const phase=async(name,fn)=>{if(j.stages[name]==='COMPLETED')return;ensure(!j.stages[name],'START_STAGE_ALREADY_ATTEMPTED_INSPECT');j.stages[name]='ATTEMPTED';await cycleStore.saveJournal(j);await fn();j.stages[name]='COMPLETED';await cycleStore.saveJournal(j);};
  try{
    await phase('network',()=>restoreNetwork({io,store:idleStore,waitSeconds}));
    await phase('power',async()=>{const result=await resumeResources({io,store:powerStore,waitSeconds});ensure(result.verified,'POWER_START_PENDING_INSPECT');});
    const proof=await powerStore.load();assertDatabases(c,proof.snapshot);j.mapping=copy(proof.journal.mapping);
    await phase('dns',async()=>{await currentAliases(snapshot,io);const bindings=await restoredBindings(snapshot,j.mapping);j.restoredDns=bindings;const input={HostedZoneId:c.dns.zoneId,ChangeBatch:{Comment:'Temporary manual test-environment restore',Changes:bindings.map(x=>({Action:'UPSERT',ResourceRecordSet:x.record}))}};
      if(bindings.length){j.actions.dns={status:'SUBMITTING',inputSha256:digest(input)};await cycleStore.saveJournal(j);let response;try{response=await io.call('route53','change-resource-record-sets',input);}catch(e){j.actions.dns.status='UNKNOWN_OR_REJECTED';await cycleStore.saveJournal(j);throw e;}ensure(response.ChangeInfo?.Id,'DNS_ACK_REQUIRED');j.actions.dns={status:'ACKNOWLEDGED',changeId:response.ChangeInfo.Id};await cycleStore.saveJournal(j);const deadline=io.now()+waitSeconds*1000;for(;;){if((await io.call('route53','get-change',{Id:response.ChangeInfo.Id})).ChangeInfo?.Status==='INSYNC')break;ensure(io.now()<deadline,'DNS_WAIT_TIMEOUT_INSPECT');await io.sleep(Math.min(10000,deadline-io.now()));}}
      await currentAliases(snapshot,io,bindings);});
    await phase('compute',()=>resumeCompute({io,store:idleStore,powerProof:proof,bindingsReviewed:true,waitSeconds}));
    await phase('health',async()=>{const deadline=io.now()+waitSeconds*1000;for(;;){let healthy=true;for(const s of paused.snapshot.services){if(s.value.desiredCount===0)continue;for(const g of s.value.loadBalancers??[]){const r=await io.call('elbv2','describe-target-health',{TargetGroupArn:g.targetGroupArn});healthy=!!r.TargetHealthDescriptions?.length&&r.TargetHealthDescriptions.every(t=>t.TargetHealth?.State==='healthy')&&healthy;}}if(healthy)break;ensure(io.now()<deadline,'TARGET_HEALTH_TIMEOUT_INSPECT');await io.sleep(Math.min(10000,deadline-io.now()));}});
    j.status='RUNNING';j.startedAt=io.now();await cycleStore.saveJournal(j);return {status:'ENVIRONMENT_STARTED',mapping:j.mapping,cloudFormationReconciliationRequired:true,noResourceExpiryInstalled:true,dataImportPerformed:false};
  }catch(e){j.status='START_FAILED_INSPECT';j.failure={code:e.code??e.message,operation:e.operation??null};await cycleStore.saveJournal(j);throw e;}
}
