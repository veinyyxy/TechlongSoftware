// Offline synthetic AWS responses only. Never run live AWS commands from this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {digest,ruleInput,capturePowerSnapshot} from '../ops/aws-resource-power/core.mjs';
import {permittedOperations} from '../ops/aws-resource-power/cli.mjs';
import {OPERATIONS} from '../ops/temporary-idle/cli.mjs';
import {ENV_SCHEMA,validateEnvironment,makeIdleConfig,stopEnvironment,startEnvironment,environmentStatus} from '../ops/temporary-idle/environment.mjs';
import {EnvironmentAwsCli,EXTRA_OPERATIONS,parseEnvironmentArgs,stateDirectory,executeEnvironmentCommand} from '../ops/temporary-idle/environment-cli.mjs';

const accountId='111111111111',region='ca-central-1',arn=(service,id)=>`arn:aws:${service}:${region}:${accountId}:${id}`,
  taskDefinition=arn('ecs','task-definition/test:1'),target=arn('elasticloadbalancing','targetgroup/test/aaaaaaaaaaaaaaaa'),vpc='vpc-aaaaaaaa',
  copy=v=>structuredClone(v),tags=[{Key:'Environment',Value:'aws-sandbox'}];
const config={schema:ENV_SCHEMA,temporary:true,enabled:true,accountId,region,profile:'synthetic',expectedPrincipalArn:`arn:aws:iam::${accountId}:user/test`,
  stateDirectory:path.join(os.tmpdir(),'environment-tests','aws-environment-state'),
  services:[{cluster:'test',service:'test-service',desiredCount:1,requireControllerClosed:true}],
  databases:[{kind:'cluster',id:'test-cluster',resourceId:'cluster-stable'},{kind:'instance',id:'test-instance',resourceId:'db-stable'}],
  loadBalancers:[{name:'test-lb',vpcId:vpc}],requiredLoadBalancerTags:{Environment:'aws-sandbox'},
  network:{vpcIds:[vpc],natGatewayIds:[],endpointIds:[],allocationIds:[],requiredNetworkTags:{Environment:'aws-sandbox'},acknowledgeNetworkRecreation:true},
  dns:{zoneId:'ZTEST',records:[{name:'api.sandbox.example.com.',loadBalancerName:'test-lb'}]},acknowledgeCloudFormationDrift:true,allowDisableDeletionProtection:true};
function memoryStore(){return {snapshot:null,journal:null,async read(name){return copy(name==='snapshot.json'?this.snapshot:this.journal);},
  async createSnapshot(s,j){assert.equal(this.snapshot,null);this.snapshot=copy(s);this.journal=copy(j);},async saveJournal(j){this.journal=copy(j);},
  async load(){assert.equal(this.journal.snapshotSha256,digest(this.snapshot));return {snapshot:copy(this.snapshot),journal:copy(this.journal)};}};}
function fixture(){
  const stores={cycleStore:memoryStore(),idleStore:memoryStore(),powerStore:memoryStore()},calls=[],svc={serviceArn:arn('ecs','service/test/test-service'),clusterArn:arn('ecs','cluster/test'),serviceName:'test-service',createdAt:'2026-01-01T00:00:00Z',taskDefinition,
    desiredCount:1,runningCount:1,pendingCount:0,status:'ACTIVE',launchType:'FARGATE',loadBalancers:[{targetGroupArn:target}]},
    defaults=[{Key:'deletion_protection.enabled',Value:'false'},{Key:'load_balancing.cross_zone.enabled',Value:'true'},{Key:'idle_timeout.timeout_seconds',Value:'60'},
      {Key:'access_logs.s3.enabled',Value:'false'},{Key:'access_logs.s3.bucket',Value:''},{Key:'access_logs.s3.prefix',Value:''}],
    fixed=[{Type:'fixed-response',FixedResponseConfig:{StatusCode:'404'}}],certificate=arn('acm','certificate/test'),
    lbFor=n=>({LoadBalancerName:'test-lb',LoadBalancerArn:arn('elasticloadbalancing',`loadbalancer/app/test-lb/${String(n).padStart(16,'a')}`),DNSName:`test-lb-${n}.ca-central-1.elb.amazonaws.com`,CanonicalHostedZoneId:'ZALB',VpcId:vpc,Type:'application',Scheme:'internet-facing',IpAddressType:'ipv4',SecurityGroups:['sg-test'],AvailabilityZones:[{SubnetId:'subnet-aaaaaaaa'},{SubnetId:'subnet-bbbbbbbb'}],State:{Code:'active'}}),
    listenerFor=lb=>({ListenerArn:lb.LoadBalancerArn.replace(':loadbalancer/',':listener/')+'/cccccccccccccccc',LoadBalancerArn:lb.LoadBalancerArn,Protocol:'HTTPS',Port:443,Certificates:[{CertificateArn:certificate}],DefaultActions:copy(fixed)}),
    ruleFor=l=>({RuleArn:l.ListenerArn.replace(':listener/',':listener-rule/')+'/eeeeeeeeeeeeeeee',Priority:'10',IsDefault:false,
      Conditions:[{Field:'path-pattern',Values:['/*'],PathPatternConfig:{Values:['/*']}}],Transforms:[],Actions:[{Type:'forward',TargetGroupArn:target}]});
  const state={generation:1,lb:lbFor(1),cluster:'available',instance:'available',attrs:copy(defaults),listener:null,rules:[],controller:false,fail:null,wrongIdentity:false,wrongResource:false,tags:copy(tags),unhealthy:false};
  state.listener=listenerFor(state.lb);state.rules=[ruleFor(state.listener)];
  state.alias={Name:config.dns.records[0].name,Type:'A',AliasTarget:{HostedZoneId:'ZALB',DNSName:'dualstack.'+state.lb.DNSName+'.',EvaluateTargetHealth:true}};
  let clock=1000;
  const io={now:()=>clock,sleep:async ms=>{clock+=ms;},call:async(service,operation,input)=>{
    const mutation=[permittedOperations,OPERATIONS,EXTRA_OPERATIONS].some(x=>x.writes[service]?.includes(operation));calls.push({service,operation,input:copy(input),mutation});
    if(mutation){assert.ok(stores.cycleStore.snapshot,'complete environment backup before first write');assert.ok(stores.idleStore.snapshot,'ECS backup before first write');}
    if(state.fail===operation)throw Object.assign(Error('synthetic'),{code:'AccessDenied'});
    if(operation==='get-caller-identity')return {Account:accountId,Arn:state.wrongIdentity?`arn:aws:iam::${accountId}:user/other`:config.expectedPrincipalArn};
    if(operation==='describe-services')return {services:[copy(svc)]};
    if(operation==='describe-task-definition')return {taskDefinition:{taskDefinitionArn:taskDefinition,containerDefinitions:[{command:['node','start.mjs'],environment:[{name:'TECHLONG_PLATFORM_CONTROLLER_ENABLED',value:state.controller?'true':'false'}]}]}};
    if(operation==='describe-scalable-targets')return {ScalableTargets:[]};
    if(operation==='list-tasks')return {taskArns:[]};
    if(operation==='update-service'){svc.desiredCount=input.desiredCount;svc.runningCount=input.desiredCount;return {service:copy(svc)};}
    if(service==='rds'){
      const cluster=operation.includes('cluster'),key=cluster?'cluster':'instance',id=cluster?'test-cluster':'test-instance';
      if(operation.startsWith('stop-'))state[key]='stopped';if(operation.startsWith('start-'))state[key]='available';
      return cluster?{DBClusters:[{DBClusterArn:arn('rds','cluster:'+id),DBClusterIdentifier:id,DbClusterResourceId:state.wrongResource?'cluster-replaced':'cluster-stable',Engine:'aurora-postgresql',Status:state[key]}]}:
        {DBInstances:[{DBInstanceArn:arn('rds','db:'+id),DBInstanceIdentifier:id,DbiResourceId:'db-stable',Engine:'postgres',DBInstanceStatus:state[key]}]};
    }
    if(operation==='describe-load-balancers'){
      if(!state.lb||(input.LoadBalancerArns&&!input.LoadBalancerArns.includes(state.lb.LoadBalancerArn)))throw Object.assign(Error('absent'),{code:'LoadBalancerNotFound'});
      return {LoadBalancers:[copy(state.lb)]};
    }
    if(operation==='describe-load-balancer-attributes')return {Attributes:copy(state.attrs)};
    if(operation==='modify-load-balancer-attributes'){assert.ok(input.Attributes.every(a=>a.Value!==''),'never send empty log bucket/prefix');for(const item of input.Attributes){const current=state.attrs.find(a=>a.Key===item.Key);if(current)current.Value=item.Value;else state.attrs.push(copy(item));}return {};}
    if(operation==='describe-listeners')return {Listeners:state.listener?[copy(state.listener)]:[]};
    if(operation==='describe-listener-attributes')return {Attributes:[{Key:'routing.http.response.server.enabled',Value:'true'}]};
    if(operation==='describe-listener-certificates')return {Certificates:[{CertificateArn:certificate,IsDefault:true}]};
    if(operation==='describe-rules')return {Rules:[{IsDefault:true,Actions:fixed},...copy(state.rules)]};
    if(operation==='describe-tags')return {TagDescriptions:[{ResourceArn:input.ResourceArns[0],Tags:copy(state.tags)}]};
    if(operation==='describe-target-groups')return {TargetGroups:[{TargetGroupArn:target,VpcId:vpc,LoadBalancerArns:state.lb?[state.lb.LoadBalancerArn]:[]}]};
    if(operation==='describe-target-health')return {TargetHealthDescriptions:[{TargetHealth:{State:state.unhealthy?'unhealthy':'healthy'}}]};
    if(operation==='delete-load-balancer'){state.lb=null;return {};}
    if(operation==='create-load-balancer'){state.lb=lbFor(++state.generation);state.attrs=copy(defaults);state.listener=null;state.rules=[];return {LoadBalancers:[copy(state.lb)]};}
    if(operation==='create-listener'){state.listener={...copy(input),ListenerArn:listenerFor(state.lb).ListenerArn};return {Listeners:[copy(state.listener)]};}
    if(operation==='create-rule'){assert.equal(input.Conditions[0].Values,undefined);assert.equal(input.Transforms,undefined);const rule={...copy(input),RuleArn:ruleFor(state.listener).RuleArn,Priority:String(input.Priority),IsDefault:false};delete rule.ListenerArn;state.rules.push(rule);return {Rules:[copy(rule)]};}
    if(operation==='list-resource-record-sets')return {ResourceRecordSets:[copy(state.alias)],IsTruncated:false};
    if(operation==='change-resource-record-sets'){state.alias=copy(input.ChangeBatch.Changes[0].ResourceRecordSet);return {ChangeInfo:{Id:'/change/TEST',Status:'PENDING'}};}
    if(operation==='get-change')return {ChangeInfo:{Status:'INSYNC'}};
    throw Error('UNEXPECTED_SYNTHETIC_OPERATION_'+operation);
  }};
  return {config:copy(config),...stores,io,calls,state,svc};
}
const writes=f=>f.calls.filter(c=>c.mutation);
test('full stop/start/repeat resolves new ALB ARN automatically and preserves exact DNS/DB/ECS bindings',async()=>{
  const f=fixture(),original=f.state.lb.LoadBalancerArn;assert.equal((await environmentStatus(f)).status,'RUNNING');
  assert.equal((await stopEnvironment(f)).status,'STOPPED');assert.equal((await environmentStatus(f)).status,'STOPPED');
  assert.equal((await startEnvironment(f)).status,'ENVIRONMENT_STARTED');assert.equal((await environmentStatus(f)).status,'RUNNING');
  assert.notEqual(f.state.lb.LoadBalancerArn,original);assert.ok(f.state.alias.AliasTarget.DNSName.includes('test-lb-2.'));assert.equal(f.state.alias.AliasTarget.EvaluateTargetHealth,true);
  assert.ok(!writes(f).some(x=>['modify-load-balancer-attributes','modify-listener-attributes'].includes(x.operation)),'unchanged empty Describe attributes never sent to Modify');
  const ops=writes(f).map(x=>x.operation);assert.ok(ops.indexOf('update-service')<ops.indexOf('stop-db-cluster'));assert.ok(ops.indexOf('change-resource-record-sets')<ops.lastIndexOf('update-service'));
  const before=writes(f).length;assert.equal((await startEnvironment(f)).noWriteReplay,true);assert.equal(writes(f).length,before);
  const next={...f,cycleStore:memoryStore(),idleStore:memoryStore(),powerStore:memoryStore()};
  // Existing fixture's write-backup assertion still holds; each next cycle itself must create all snapshots.
  assert.equal((await stopEnvironment(next)).status,'STOPPED');assert.equal(next.cycleStore.snapshot.resolved.power.loadBalancerArns[0],arn('elasticloadbalancing','loadbalancer/app/test-lb/aaaaaaaaaaaaaaa2'));
});
test('wrong exact principal, immutable database ID, ownership tags or alias refuses all writes',async()=>{
  for(const kind of ['principal','database','tags','dns']){const f=fixture();if(kind==='principal')f.state.wrongIdentity=true;if(kind==='database')f.state.wrongResource=true;if(kind==='tags')f.state.tags=[];if(kind==='dns')f.state.alias.AliasTarget.DNSName='other.elb.amazonaws.com.';
    await assert.rejects(stopEnvironment(f));assert.equal(writes(f).length,0,kind);}
});
test('disabled switch or changed service desired count refuses stop before mutation',async()=>{const f=fixture();f.config.enabled=false;await assert.rejects(stopEnvironment(f),/DISABLED/);assert.equal(f.calls.length,0);const g=fixture();g.svc.desiredCount=2;await assert.rejects(stopEnvironment(g),/COUNT_CHANGED/);assert.equal(writes(g).length,0);});
test('backup persistence failure means no cloud writes',async()=>{const f=fixture();f.cycleStore.createSnapshot=async()=>{throw Error('DISK_FULL');};await assert.rejects(stopEnvironment(f),/DISK_FULL/);assert.equal(writes(f).length,0);});
test('platform controller closure, DNS changes and replaced ECS service stop before paid start',async()=>{
  for(const kind of ['controller','dns','service']){const f=fixture();await stopEnvironment(f);f.calls.length=0;if(kind==='controller')f.state.controller=true;if(kind==='dns')f.state.alias.AliasTarget.EvaluateTargetHealth=false;if(kind==='service')f.svc.createdAt='changed';
    await assert.rejects(startEnvironment(f));assert.equal(writes(f).length,0,kind);}
});
test('a failed power write is never automatically replayed or followed by DNS/ECS start',async()=>{const f=fixture();await stopEnvironment(f);f.calls.length=0;f.state.fail='create-load-balancer';await assert.rejects(startEnvironment(f));assert.equal(writes(f).filter(x=>x.operation==='create-load-balancer').length,1);const count=writes(f).length;
  f.state.fail=null;await assert.rejects(startEnvironment(f),/START_STAGE_ALREADY_ATTEMPTED/);assert.equal(writes(f).length,count);assert.equal(f.svc.desiredCount,0);});
test('failed target health is not confused with successful product acceptance',async()=>{const f=fixture();await stopEnvironment(f);f.state.unhealthy=true;await assert.rejects(startEnvironment({...f,waitSeconds:1}),/TARGET_HEALTH_TIMEOUT/);assert.equal(f.cycleStore.journal.status,'START_FAILED_INSPECT');});
test('power preflight is read-only and rule projection removes duplicate typed Values and empty transforms',async()=>{
  const f=fixture(),p=await capturePowerSnapshot({config:makeIdleConfig(f.config,[f.state.lb.LoadBalancerArn]).power,io:f.io});assert.equal(writes(f).length,0);assert.equal(p.loadBalancers[0].listeners.length,1);
  const rule={Priority:'5',Conditions:[{Field:'host-header',Values:['example.com'],HostHeaderConfig:{Values:['example.com']}}],Actions:[],Transforms:[]},projected=ruleInput(rule,'listener');
  assert.equal(projected.Conditions[0].Values,undefined);assert.equal(projected.Transforms,undefined);assert.ok(rule.Conditions[0].Values);
  rule.Conditions[0].Values=['other.com'];assert.throws(()=>ruleInput(rule,'listener'),/REPRESENTATION_MISMATCH/);
});
test('changed nonempty ALB attribute is restored without replaying disabled empty log outputs',async()=>{const f=fixture();f.state.attrs.find(a=>a.Key==='idle_timeout.timeout_seconds').Value='30';await stopEnvironment(f);await startEnvironment(f);
  assert.deepEqual(writes(f).find(c=>c.operation==='modify-load-balancer-attributes').input.Attributes,[{Key:'idle_timeout.timeout_seconds',Value:'30'}]);});
test('strict config rejects unknown fields, wrong VPC, duplicate targets and secrets',()=>{
  assert.equal(validateEnvironment(config).schema,ENV_SCHEMA);
  for(const bad of [{...config,password:'never'}, {...config,network:{}},{...config,loadBalancers:[{name:'test-lb',vpcId:'vpc-other'}]}, {...config,databases:[config.databases[0],config.databases[0]]}])assert.throws(()=>validateEnvironment(bad));
});
test('parser defaults offline and prevents unknown/duplicate/accountless execution',()=>{
  assert.equal(parseEnvironmentArgs(['stop']).execute,false);assert.deepEqual(parseEnvironmentArgs(['--help']),{help:true});
  for(const args of [['stop','--execute'],['start','--wait-seconds','0'],['stop','--execute','--execute'],['stop','--unknown','x'],['status','--config','a','--config','b']])assert.throws(()=>parseEnvironmentArgs(args));
  assert.throws(()=>stateDirectory({...config,stateDirectory:process.cwd()}));assert.throws(()=>stateDirectory({...config,stateDirectory:'aws-environment-relative'}));
});
test('offline preview creates no state and does not launch a subprocess; disabled live stays offline',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'environment-test-'));try{const c={...config,enabled:false,stateDirectory:path.join(dir,'aws-environment-state')},exec=()=>{assert.fail('no subprocess');};
    const result=await executeEnvironmentCommand(parseEnvironmentArgs(['stop']),c,{exec});assert.equal(result.awsCalls,0);assert.deepEqual(await readdir(dir),[]);
    await assert.rejects(executeEnvironmentCommand(parseEnvironmentArgs(['stop','--execute','--confirm-account',accountId]),c,{exec}),/DISABLED/);assert.deepEqual(await readdir(dir),[]);
  }finally{assert.ok(path.basename(dir).startsWith('environment-test-'));await rm(dir,{recursive:true});}
});
test('adapter uses global Route53 endpoint/signing, redacts provider errors and forbids unrelated APIs',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'environment-test-'));try{const calls=[],exec=async(bin,args,opts)=>{calls.push({bin,args,opts});return {stdout:'{}'};},a=new EnvironmentAwsCli(config,dir,{exec});
    await a.call('route53','get-change',{Id:'/change/test'});assert.ok(calls[0].args.includes('https://route53.amazonaws.com'));assert.equal(calls[0].args[calls[0].args.indexOf('--region')+1],'us-east-1');assert.equal(calls[0].opts.env.AWS_MAX_ATTEMPTS,'1');assert.equal(calls[0].opts.shell,undefined);
    await assert.rejects(a.call('route53','change-resource-record-sets',{}),/WRITES_DISABLED/);
    for(const [s,o] of [['iam','create-role'],['secretsmanager','get-secret-value'],['rds','delete-db-instance'],['ec2','delete-vpc'],['cloudformation','update-stack'],['ecs','run-task']])await assert.rejects(a.call(s,o,{}),/API_NOT_ALLOWED/);
    const failed=new EnvironmentAwsCli(config,dir,{exec:async()=>{throw Object.assign(Error('private raw text'),{stderr:'An error occurred (AccessDenied) private raw text'});}});
    await assert.rejects(failed.call('route53','get-change',{}),e=>e.code==='AccessDenied'&&!JSON.stringify(e).includes('private raw text'));assert.deepEqual(await readdir(dir),[]);
  }finally{assert.ok(path.basename(dir).startsWith('environment-test-'));await rm(dir,{recursive:true});}
});
test('real file cycles preserve previous backup and allow repeated fixed commands, with fake CLI only',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'environment-test-'));try{const f=fixture(),c={...f.config,stateDirectory:path.join(dir,'aws-environment-state')},exec=async(bin,args)=>{
    try{return {stdout:JSON.stringify(await f.io.call(args[0],args[1],JSON.parse(await readFile(args[args.indexOf('--cli-input-json')+1].slice(7),'utf8'))))};}
    catch(e){throw Object.assign(Error('synthetic CLI provider rejection'),{stderr:`An error occurred (${e.code??'SyntheticError'})`});}},
      execute=mode=>executeEnvironmentCommand(parseEnvironmentArgs([mode,'--execute','--confirm-account',accountId]),c,{exec,now:f.io.now,sleep:f.io.sleep});
    // File-backed command owns backup checks; in-memory fixture records only the AWS shape here.
    f.cycleStore.snapshot={};f.idleStore.snapshot={};
    const first=await execute('stop');assert.equal(first.status,'STOPPED');const j1=JSON.parse(await readFile(path.join(c.stateDirectory,'journal.json'),'utf8'));assert.ok(j1.cycleId);
    const prior=writes(f).length;assert.equal((await execute('stop')).noWriteReplay,true);assert.equal(writes(f).length,prior);
    assert.equal((await execute('start')).status,'ENVIRONMENT_STARTED');assert.equal((await execute('start')).noWriteReplay,true);
    const second=await execute('stop');assert.notEqual(second.cycleId,first.cycleId);assert.ok((await readdir(c.stateDirectory)).includes(first.cycleId));
    const before=writes(f).length;assert.equal((await execute('status')).readOnly,true);assert.equal(writes(f).length,before);
    const preserved=await readFile(path.join(c.stateDirectory,'journal.json'),'utf8');f.state.wrongIdentity=true;await assert.rejects(execute('start'),/IDENTITY_MISMATCH/);
    assert.equal(await readFile(path.join(c.stateDirectory,'journal.json'),'utf8'),preserved,'auth failure cannot poison last complete cycle');f.state.wrongIdentity=false;
    f.state.fail='create-load-balancer';await assert.rejects(execute('start'));const failedCount=writes(f).length;f.state.fail=null;await assert.rejects(execute('start'),/PREVIOUS_OPERATION_REQUIRES_INSPECTION/);assert.equal(writes(f).length,failedCount);
  }finally{assert.ok(path.basename(dir).startsWith('environment-test-'));await rm(dir,{recursive:true});}
});
