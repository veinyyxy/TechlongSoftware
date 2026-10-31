// Synthetic AWS ports only. No actual entry point, AWS CLI or account API is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {digest} from '../ops/aws-resource-power/core.mjs';
import {SCHEMA,validateConfig,deadline,idle,restoreNetwork,resumeCompute,waitForExpiry} from '../ops/temporary-idle/core.mjs';
import {OPERATIONS,TemporaryAwsCli,TemporaryStore,parseArgs} from '../ops/temporary-idle/cli.mjs';
const A='111111111111',region='ca-central-1',arn=(svc,id)=>`arn:aws:${svc}:${region}:${A}:${id}`,
  cluster=arn('ecs','cluster/test-cluster'),serviceArn=arn('ecs','service/test-cluster/test-service'),taskDef=arn('ecs','task-definition/test:1'),
  taskArn=arn('ecs','task/test-cluster/11111111111111111111111111111111'),singleArn=arn('ecs','task/test-cluster/22222222222222222222222222222222'),
  oldLb=arn('elasticloadbalancing','loadbalancer/app/test/aaaaaaaaaaaaaaaa'),newLb=arn('elasticloadbalancing','loadbalancer/app/test/bbbbbbbbbbbbbbbb'),tg=arn('elasticloadbalancing','targetgroup/test/aaaaaaaaaaaaaaaa'),
  nat='nat-aaaaaaaa',newNat='nat-dddddddd',endpoint='vpce-bbbbbbbb',newEndpoint='vpce-ffffffff',allocation='eipalloc-cccccccc',newAllocation='eipalloc-eeeeeeee',vpc='vpc-aaaaaaaa',
  tags=[{Key:'Environment',Value:'aws-sandbox'}],copy=v=>structuredClone(v);
const powerConfig={accountId:A,region,profile:'test',rdsClusters:['test-db'],rdsInstances:[],loadBalancerArns:[oldLb],acknowledgeCloudFormationDrift:true};
function powerProof(){const snapshot={config:powerConfig,databases:[{kind:'cluster',id:'test-db',resourceId:'cluster-stable',status:'available'}]};return {snapshot,journal:{snapshotSha256:digest(snapshot),status:'RESOURCES_RECREATED_BINDINGS_REQUIRE_REVIEW',mapping:[{oldArn:oldLb,newArn:newLb}]}};}
function fixture(o={}){
  let clock=Date.UTC(2026,9,31,12),powerCalled=false;
  const c={schema:SCHEMA,temporary:true,enabled:true,expiresAt:'2026-10-31T11:00:00.000Z',accountId:A,region,profile:'test',services:[{cluster:'test-cluster',service:'test-service'}],standaloneTasks:[{cluster:'test-cluster',taskArn:singleArn}],
    schedules:[{name:'repeat',group:'test'},{name:'once',group:'test'}],rules:[{name:'event-rule',bus:'default'}],vpcIds:[vpc],natGatewayIds:o.noNetwork?[]:[nat],endpointIds:o.noNetwork?[]:[endpoint],allocationIds:o.noNetwork?[]:[allocation],requiredNetworkTags:{Environment:'aws-sandbox'},acknowledgeNetworkRecreation:true,power:o.withPower?powerConfig:null};
  const svc={serviceArn,clusterArn:cluster,serviceName:'test-service',createdAt:'2026-10-01T00:00:00Z',taskDefinition:taskDef,desiredCount:1,runningCount:1,pendingCount:0,status:'ACTIVE',launchType:'FARGATE',loadBalancers:[{targetGroupArn:tg}]},
    task=(id,group)=>({taskArn:id,clusterArn:cluster,group,lastStatus:'RUNNING',launchType:'FARGATE',taskDefinitionArn:taskDef,attachments:[{details:[{name:'networkInterfaceId',value:'eni-11111111'}]}]}),
    taskRows=new Map([[taskArn,task(taskArn,'service:test-service')],[singleArn,task(singleArn,'family:one-shot')]]),
    scaling={ResourceId:'service/test-cluster/test-service',MinCapacity:1,MaxCapacity:2,SuspendedState:{DynamicScalingInSuspended:false,DynamicScalingOutSuspended:false,ScheduledScalingSuspended:false}},
    schedule=name=>({Name:name,GroupName:'test',Arn:arn('scheduler',`schedule/test/${name}`),State:'ENABLED',ScheduleExpression:name==='once'?'at(2026-11-01T12:00:00)':'rate(1 hour)',ScheduleExpressionTimezone:'UTC',FlexibleTimeWindow:{Mode:'OFF'},Description:'preserve optional fields',ActionAfterCompletion:'NONE',
      Target:{Arn:cluster,RoleArn:`arn:aws:iam::${A}:role/unused`,EcsParameters:{TaskDefinitionArn:taskDef,TaskCount:1},Input:'{"synthetic":true}'}}),
    schedules=new Map([['repeat',schedule('repeat')],['once',schedule('once')]]),rule={Arn:arn('events','rule/event-rule'),State:'ENABLED'},ruleTargets=[{Id:'one',Arn:cluster,EcsParameters:{TaskDefinitionArn:taskDef,TaskCount:1}}],
    nats=new Map([[nat,{NatGatewayId:nat,VpcId:vpc,SubnetId:'subnet-aaaaaaaa',ConnectivityType:'public',State:'available',Tags:tags,NatGatewayAddresses:[{AllocationId:allocation,NetworkInterfaceId:'eni-aaaaaaaa'}]}]]),
    endpoints=new Map([[endpoint,{VpcEndpointId:endpoint,VpcEndpointType:'Interface',VpcId:vpc,OwnerId:A,RequesterManaged:false,State:'available',ServiceName:'com.amazonaws.ca-central-1.logs',SubnetIds:['subnet-aaaaaaaa'],Groups:[{GroupId:'sg-aaaaaaaa'}],PrivateDnsEnabled:true,IpAddressType:'ipv4',PolicyDocument:'{"Statement":[]}',DnsOptions:{DnsRecordIpType:'ipv4'},Tags:tags}]]),
    addresses=new Map([[allocation,{AllocationId:allocation,PublicIp:'203.0.113.1',NetworkBorderGroup:region,Domain:'vpc',AssociationId:'eipassoc-aaaaaaaa',NetworkInterfaceId:'eni-aaaaaaaa',PublicIpv4Pool:'amazon',Tags:tags}]]),
    table={RouteTableId:'rtb-aaaaaaaa',Tags:tags,Routes:[{DestinationCidrBlock:'0.0.0.0/0',NatGatewayId:nat,Origin:'CreateRoute'}]},calls=[];
  const store={snapshot:null,journal:null,async createSnapshot(s,j){assert.equal(this.snapshot,null);this.snapshot=copy(s);this.journal=copy(j);},async saveJournal(j){this.journal=copy(j);},async load(){return {snapshot:copy(this.snapshot),journal:copy(this.journal)};}};
  const io={now:()=>clock,sleep:async ms=>{clock+=ms;},call:async(svcName,op,input)=>{
    const mutation=OPERATIONS.writes[svcName]?.includes(op);calls.push({service:svcName,op,input:copy(input),mutation});if(mutation)assert.ok(store.snapshot,'immutable backup precedes writes');
    if(o.fail===op)throw Object.assign(Error('synthetic rejected operation'),{code:'AccessDenied'});
    if(op==='get-caller-identity')return {Account:o.wrongAccount?'222222222222':A,Arn:`arn:aws:iam::${A}:user/test`};
    if(op==='describe-services')return {services:[copy(svc)]};
    if(op==='list-tasks'){if(o.pagination&&!input.nextToken)return {taskArns:[],nextToken:'page2'};return {taskArns:svc.runningCount?[taskArn]:[]};}
    if(op==='describe-tasks')return {tasks:input.tasks.map(id=>copy(taskRows.get(id))),failures:[]};
    if(op==='update-service'){svc.desiredCount=input.desiredCount;svc.runningCount=o.neverIdle&&input.desiredCount===0?1:input.desiredCount;taskRows.get(taskArn).lastStatus=input.desiredCount?'RUNNING':'STOPPED';return {service:copy(svc)};}
    if(op==='stop-task'){taskRows.get(input.task).lastStatus='STOPPED';return {};}
    if(op==='describe-scalable-targets')return {ScalableTargets:[copy(scaling)]};
    if(op==='register-scalable-target'){Object.assign(scaling,copy(input));return {};}
    if(op==='get-schedule')return copy(schedules.get(input.Name));
    if(op==='update-schedule'){schedules.set(input.Name,{...copy(input),Arn:arn('scheduler',`schedule/test/${input.Name}`)});return {};}
    if(op==='describe-rule')return copy(rule);
    if(op==='list-targets-by-rule')return {Targets:copy(ruleTargets)};
    if(op==='disable-rule'){rule.State='DISABLED';return {};}
    if(op==='enable-rule'){rule.State='ENABLED';return {};}
    if(op==='describe-nat-gateways')return {NatGateways:input.NatGatewayIds.map(id=>copy(nats.get(id))).filter(Boolean)};
    if(op==='describe-route-tables')return {RouteTables:input.RouteTableIds||table.Routes.some(r=>r.NatGatewayId===input.Filters[0].Values[0])?[copy(table)]:[]};
    if(op==='delete-route'){table.Routes=table.Routes.filter(r=>r.DestinationCidrBlock!==input.DestinationCidrBlock);return {};}
    if(op==='delete-nat-gateway'){if(o.withPower)assert.equal(powerCalled,true,'power stop before network deletion');nats.get(input.NatGatewayId).State='deleted';delete addresses.get(allocation).AssociationId;delete addresses.get(allocation).NetworkInterfaceId;return {};}
    if(op==='describe-vpc-endpoints'){const rows=input.VpcEndpointIds.map(id=>copy(endpoints.get(id))).filter(Boolean);if(!rows.length)throw Object.assign(Error('gone'),{code:'InvalidVpcEndpointId.NotFound'});return {VpcEndpoints:rows};}
    if(op==='delete-vpc-endpoints'){input.VpcEndpointIds.forEach(id=>endpoints.delete(id));return {Unsuccessful:o.endpointDeleteFails?[{ResourceId:endpoint}]:[]};}
    if(op==='describe-addresses'){const rows=input.AllocationIds.map(id=>copy(addresses.get(id))).filter(Boolean);if(!rows.length)throw Object.assign(Error('gone'),{code:'InvalidAllocationID.NotFound'});return {Addresses:rows};}
    if(op==='release-address'){addresses.delete(input.AllocationId);return {};}
    if(op==='describe-network-interfaces')return {NetworkInterfaces:o.ipResidual?[{NetworkInterfaceId:input.NetworkInterfaceIds[0],Association:{PublicIp:'203.0.113.2'}}]:[]};
    if(op==='allocate-address'){const a={AllocationId:newAllocation,PublicIp:'198.51.100.1',NetworkBorderGroup:region,Domain:'vpc',Tags:input.TagSpecifications[0]?.Tags??[]};addresses.set(newAllocation,a);return copy(a);}
    if(op==='create-nat-gateway'){const n={NatGatewayId:newNat,VpcId:vpc,SubnetId:input.SubnetId,ConnectivityType:input.ConnectivityType,State:'available',Tags:tags,NatGatewayAddresses:[{AllocationId:input.AllocationId,NetworkInterfaceId:'eni-dddddddd'}]};nats.set(newNat,n);return {NatGateway:copy(n)};}
    if(op==='create-route'){table.Routes.push({...copy(input),Origin:'CreateRoute'});return {Return:true};}
    if(op==='create-vpc-endpoint'){const e={...copy(input),VpcEndpointId:newEndpoint,State:'available',Groups:input.SecurityGroupIds.map(GroupId=>({GroupId})),Tags:tags};if(o.badRestoredEndpoint)e.PrivateDnsEnabled=false;endpoints.set(newEndpoint,e);return {VpcEndpoint:copy(e)};}
    if(op==='describe-db-clusters')return {DBClusters:[{DbClusterResourceId:'cluster-stable',Status:o.powerNotReady?'stopped':'available'}]};
    if(op==='describe-load-balancers')return {LoadBalancers:[{LoadBalancerArn:newLb,State:{Code:'active'}}]};
    if(op==='describe-target-groups')return {TargetGroups:[{TargetGroupArn:tg,LoadBalancerArns:o.badAlbBinding?[]:[newLb]}]};
    throw Error(`UNEXPECTED_SYNTHETIC_API_${op}`);
  }};
  const powerStop=async()=>{assert.equal(svc.runningCount,0);powerCalled=true;return {verified:true};};
  return {config:c,io,store,calls,svc,scaling,schedules,rule,ruleTargets,nats,endpoints,addresses,table,powerStop};
}
const mutations=f=>f.calls.filter(c=>c.mutation);
async function stopped(o){const f=fixture(o);await idle(f);return f;}
async function networkReady(o){const f=await stopped(o);await restoreNetwork(f);return f;}
test('temporary stop backs up first, freezes every restart source, scales ECS to zero then removes paid network',async()=>{
  const f=fixture({pagination:true}),r=await idle(f);assert.equal(r.status,'TEMPORARY_IDLE_VERIFIED');assert.equal(f.svc.desiredCount,0);assert.equal(f.scaling.MinCapacity,0);assert.equal(f.scaling.SuspendedState.ScheduledScalingSuspended,true);
  assert.equal(f.schedules.get('repeat').State,'DISABLED');assert.equal(f.rule.State,'DISABLED');assert.equal(f.addresses.size,0);
  const ops=mutations(f).map(x=>x.op);assert.ok(ops.indexOf('update-service')<ops.indexOf('delete-nat-gateway'));assert.ok(ops.indexOf('delete-nat-gateway')<ops.indexOf('release-address'));assert.ok(f.calls.some(c=>c.op==='list-tasks'&&c.input.nextToken==='page2'));
  assert.equal(f.store.snapshot.services[0].value.desiredCount,1);assert.equal(f.store.snapshot.schedules[0].Description,'preserve optional fields');
});
test('restore network remaps EIP/NAT/routes/endpoints but leaves ECS at zero',async()=>{const f=await stopped();const r=await restoreNetwork(f);assert.equal(r.computeStarted,false);assert.equal(r.mapping.nats[nat],newNat);assert.equal(r.mapping.allocations[allocation],newAllocation);assert.equal(f.table.Routes[0].NatGatewayId,newNat);assert.equal(f.endpoints.get(newEndpoint).PrivateDnsEnabled,true);assert.equal(f.svc.desiredCount,0);});
test('resume requires power readiness + binding review, restores original scaling/schedules, never replays one-shot jobs',async()=>{
  const f=await networkReady(),r=await resumeCompute({...f,powerProof:powerProof(),bindingsReviewed:true});assert.equal(r.status,'TEMPORARY_COMPUTE_RESUMED');assert.equal(r.standaloneTasksReplayed,0);assert.equal(f.svc.desiredCount,1);assert.equal(f.scaling.MinCapacity,1);assert.equal(f.scaling.SuspendedState.DynamicScalingOutSuspended,false);
  assert.equal(f.schedules.get('repeat').State,'ENABLED');assert.equal(f.schedules.get('once').State,'DISABLED');assert.deepEqual(r.skippedOneShotSchedules,['test/once']);assert.equal(f.rule.State,'ENABLED');assert.ok(!f.calls.some(c=>c.op==='run-task'));
});
test('power stop callback runs only after compute idle and before network delete',async()=>{const f=fixture({withPower:true});await idle(f);assert.equal(f.store.journal.powerStopped,true);});
test('default switch off or non-temporary config prevents even identity lookup',async()=>{const f=fixture();f.config.enabled=false;await assert.rejects(idle(f),/TEMPORARY_SWITCH_OFF/);assert.equal(f.calls.length,0);assert.throws(()=>validateConfig({...f.config,temporary:false}));});
test('wrong account prevents all mutations',async()=>{const f=fixture({wrongAccount:true});await assert.rejects(idle(f),/SOURCE_ACCOUNT_MISMATCH/);assert.equal(mutations(f).length,0);});
test('network recreation requires explicit acknowledgement and ownership',async()=>{const f=fixture();f.config.acknowledgeNetworkRecreation=false;await assert.rejects(idle(f),/NETWORK_RECREATION_ACK/);assert.equal(f.calls.length,0);const g=fixture();g.nats.get(nat).Tags=[];await assert.rejects(idle(g),/NETWORK_TAG_MISMATCH/);assert.equal(mutations(g).length,0);});
test('unselected active EIP is not disassociated or released',async()=>{const f=fixture();f.addresses.get(allocation).NetworkInterfaceId='eni-other';await assert.rejects(idle(f),/EIP_STILL_USED/);assert.equal(mutations(f).length,0);});
test('unsupported endpoints and regional/multi-address NAT are refused before writes',async()=>{const f=fixture();f.endpoints.get(endpoint).RequesterManaged=true;await assert.rejects(idle(f),/ONLY_OWNED_INTERFACE/);assert.equal(mutations(f).length,0);const g=fixture();g.nats.get(nat).AvailabilityMode='regional';await assert.rejects(idle(g),/NAT_SCOPE_OR_STATE/);assert.equal(mutations(g).length,0);});
test('EC2 launch type is not mistaken for stopped Fargate billing',async()=>{const f=fixture();f.svc.launchType='EC2';await assert.rejects(idle(f),/ONLY_ACTIVE_FARGATE/);assert.equal(mutations(f).length,0);});
test('indirect Lambda schedule or mixed EventBridge rule is never disabled',async()=>{const f=fixture();f.schedules.get('repeat').Target={Arn:arn('lambda','function:not-ours')};await assert.rejects(idle(f),/ONLY_DIRECT_SCOPED_ECS/);assert.equal(mutations(f).length,0);const g=fixture();g.ruleTargets.push({Id:'other',Arn:arn('lambda','function:other')});await assert.rejects(idle(g),/ONLY_DIRECT_SCOPED_ECS/);assert.equal(mutations(g).length,0);});
test('a backup write failure prevents every AWS mutation',async()=>{const f=fixture();f.store.createSnapshot=async()=>{throw Error('DISK_FULL');};await assert.rejects(idle(f),/DISK_FULL/);assert.equal(mutations(f).length,0);});
test('failed mutation is not retried or followed by network deletion',async()=>{const f=fixture({fail:'update-service'});await assert.rejects(idle(f));assert.equal(mutations(f).filter(c=>c.op==='update-service').length,1);assert.ok(!mutations(f).some(c=>c.op==='delete-nat-gateway'));assert.equal(f.store.journal.status,'NEEDS_INSPECTION');});
test('still-running ECS prevents network cleanup',async()=>{const f=fixture({neverIdle:true});await assert.rejects(idle({...f,waitSeconds:0}),/COMPUTE_IDLE_TIMEOUT/);assert.ok(!mutations(f).some(c=>c.service==='ec2'));});

test('ACK without a verified paused restart source prevents network deletion',async()=>{const f=fixture(),call=f.io.call;f.io.call=async(s,o,i)=>{const r=await call(s,o,i);if(o==='register-scalable-target')f.scaling.SuspendedState.DynamicScalingOutSuspended=false;return r;};await assert.rejects(idle(f),/SCALING_PAUSE_UNVERIFIED/);assert.ok(!mutations(f).some(c=>c.service==='ec2'));});
test('remaining managed public IP is reported, never forcibly removed',async()=>{const f=fixture({ipResidual:true}),r=await idle(f);assert.equal(r.status,'IDLE_WITH_PUBLIC_IP_RESIDUALS');assert.ok(r.publicIpResiduals.length);assert.equal(r.zeroAccountCharges,false);assert.ok(!f.calls.some(c=>c.op==='delete-network-interface'));});
test('network create failure preserves mapping/journal and does not start ECS',async()=>{const f=await stopped({badRestoredEndpoint:true});await assert.rejects(restoreNetwork(f),/RESTORED_ENDPOINT_MISMATCH/);assert.equal(f.svc.desiredCount,0);assert.ok(f.store.journal.mapping.nats[nat]);});
test('occupied routes are not overwritten',async()=>{const f=await stopped();f.table.Routes.push({DestinationCidrBlock:'0.0.0.0/0',GatewayId:'igw-other'});const before=mutations(f).length;await assert.rejects(restoreNetwork(f),/ROUTE_OCCUPIED/);assert.equal(mutations(f).length,before);});
test('network restore requires idle compute and cannot be replayed',async()=>{const f=await stopped();f.svc.desiredCount=1;await assert.rejects(restoreNetwork(f),/COMPUTE_RESTARTED/);const g=await networkReady();await assert.rejects(restoreNetwork(g),/IDLE_NOT_COMPLETED/);});
test('deleted NAT history may be absent; it is not a reason to skip restoring the network',async()=>{const f=await stopped(),call=f.io.call;f.io.call=async(s,o,i)=>{if(o==='describe-nat-gateways'&&i.NatGatewayIds[0]===nat)throw Object.assign(Error('old NAT expired from history'),{code:'InvalidNatGatewayID.NotFound'});return call(s,o,i);};assert.equal((await restoreNetwork(f)).computeStarted,false);assert.equal(f.store.journal.mapping.nats[nat],newNat);});
test('released idle EIP not used by a NAT is not reallocated merely to sit idle',async()=>{const f=fixture({noNetwork:true});f.config.allocationIds=[allocation];delete f.addresses.get(allocation).AssociationId;delete f.addresses.get(allocation).NetworkInterfaceId;await idle(f);await restoreNetwork(f);assert.equal(f.store.journal.mapping.allocations[allocation],null);assert.ok(!f.calls.some(c=>c.op==='allocate-address'));});
test('unreviewed or missing ALB/RDS proof cannot start a container',async()=>{const f=await networkReady();const count=mutations(f).length;await assert.rejects(resumeCompute({...f,powerProof:powerProof()}),/NEW_BINDINGS_REVIEW/);await assert.rejects(resumeCompute({...f,bindingsReviewed:true}),/POWER_RESTORE_PROOF/);assert.equal(mutations(f).length,count);});
test('unready RDS or unbound target group blocks compute resume',async()=>{const f=await networkReady({powerNotReady:true});const n=mutations(f).length;await assert.rejects(resumeCompute({...f,powerProof:powerProof(),bindingsReviewed:true}),/POWER_DATABASE_NOT_READY/);assert.equal(mutations(f).length,n);const g=await networkReady({badAlbBinding:true});await assert.rejects(resumeCompute({...g,powerProof:powerProof(),bindingsReviewed:true}),/SERVICE_ALB_BINDING_NOT_READY/);});
test('changed autoscaling or schedule is not overwritten on restore',async()=>{const f=await networkReady();f.scaling.MinCapacity=1;await assert.rejects(resumeCompute({...f,powerProof:powerProof(),bindingsReviewed:true}),/SCALING_CHANGED/);const g=await networkReady();g.schedules.get('repeat').Description='changed externally';await assert.rejects(resumeCompute({...g,powerProof:powerProof(),bindingsReviewed:true}),/SCHEDULE_CHANGED/);});
test('service replacements and backup tampering are rejected',async()=>{const f=await networkReady();f.svc.createdAt='new';await assert.rejects(resumeCompute({...f,powerProof:powerProof(),bindingsReviewed:true}),/SERVICE_CHANGED/);const g=await stopped();g.store.snapshot.config.profile='other';await assert.rejects(restoreNetwork(g),/BACKUP_INTEGRITY/);});

test('changed service target group cannot pass using an old still-valid target group',async()=>{const f=await networkReady();f.svc.loadBalancers=[{targetGroupArn:arn('elasticloadbalancing','targetgroup/other/bbbbbbbbbbbbbbbb')}];const n=mutations(f).length;await assert.rejects(resumeCompute({...f,powerProof:powerProof(),bindingsReviewed:true}),/SERVICE_CHANGED_WHILE_IDLE/);assert.equal(mutations(f).length,n);});
test('no-network configuration still idles compute without deleting VPC or ECR',async()=>{const f=fixture({noNetwork:true});await idle(f);await restoreNetwork(f);assert.ok(!mutations(f).some(c=>c.service==='ec2'));assert.equal(f.svc.desiredCount,0);});
test('watch waits to an immutable UTC deadline without making any AWS calls',async()=>{const f=fixture(),start=f.io.now();f.config.expiresAt=new Date(start+50000).toISOString();const r=await waitForExpiry(f.config,f.io);assert.equal(f.io.now(),start+50000);assert.equal(r.expiredAt,start+50000);assert.equal(f.calls.length,0);assert.throws(()=>deadline('2026-02-30T00:00:00Z'));assert.throws(()=>deadline('2026-10-31T12:00:00'));});
test('CLI preview is default and live operations require explicit account confirmation',()=>{assert.equal(parseArgs(['idle','--config','c.json','--state','s']).execute,false);assert.throws(()=>parseArgs(['idle','--config','c','--state','s','--execute']),/ACCOUNT_CONFIRMATION/);assert.deepEqual(parseArgs(['--help']),{help:true});});
test('temporary production adapter has an explicit API boundary and no real subprocess in tests',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'temporary-idle-test-'));let count=0;
  try{const a=new TemporaryAwsCli(fixture().config,dir,{exec:async(bin,args,opts)=>{count++;assert.ok(args.includes('https://ecs.ca-central-1.amazonaws.com'));assert.equal(opts.env.AWS_MAX_ATTEMPTS,'1');assert.equal(opts.shell,undefined);assert.deepEqual(JSON.parse(await readFile(args[args.indexOf('--cli-input-json')+1].slice(7))),{cluster:'test-cluster',services:['test-service']});return {stdout:'{}'};}});
    await a.call('ecs','describe-services',{cluster:'test-cluster',services:['test-service']});await assert.rejects(a.call('ecs','update-service',{}),/TEMPORARY_WRITES_DISABLED/);
    for(const [svc,op]of [['ec2','delete-vpc'],['ec2','delete-network-interface'],['rds','delete-db-instance'],['ecr','batch-delete-image'],['ecs','run-task']])await assert.rejects(a.call(svc,op,{}),/TEMPORARY_API_NOT_ALLOWED/);assert.equal(count,1);
  }finally{assert.ok(path.basename(dir).startsWith('temporary-idle-test-'));await rm(dir,{recursive:true});}
});
test('temporary store is separate from existing power backup schema',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'temporary-idle-test-'));try{const f=await stopped({noNetwork:true}),store=new TemporaryStore(dir);await store.createSnapshot(f.store.snapshot,f.store.journal);assert.equal((await store.load()).snapshot.schema,SCHEMA);}finally{assert.ok(path.basename(dir).startsWith('temporary-idle-test-'));await rm(dir,{recursive:true});}});
test('formal runtime, old power tool and Janitor do not import temporary policy',async()=>{
  const roots=['lib','worker','ops/cloud-worker','ops/platform-reviewed-cycle-v1','ops/aws-resource-power','ops/aws-sandbox/lambda'];let checked=0;
  async function scan(root){for(const entry of await readdir(root,{withFileTypes:true})){if(['node_modules','.git','dist','build'].includes(entry.name))continue;const file=path.join(root,entry.name);if(entry.isDirectory()){await scan(file);continue;}if(!entry.isFile()||!/\.(?:mjs|cjs|ts)$/.test(file))continue;const text=await readFile(file,'utf8');assert.ok(!/from\s*['"][^'"]*temporary-idle|require\(['"][^'"]*temporary-idle|import\(['"][^'"]*temporary-idle/.test(text),file);checked++;}}
  for(const root of roots)await scan(root);assert.ok(checked>50);
});
