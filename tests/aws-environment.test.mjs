// All account responses are synthetic. No AWS CLI, credentials, SQL or business requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {FileStore} from '../ops/aws-resource-power/cli.mjs';
import {fixture,writes,memoryStore,copy,accountId} from './aws-environment-fixture.mjs';
import {hash,variant,EDGE,ROLES} from '../ops/temporary-idle/environment-cfn.mjs';
import {configHash,validateEnvironment,prepareEnvironmentPlan,executeEnvironmentPlan} from '../ops/temporary-idle/environment.mjs';
import {EnvironmentAwsCli,parseEnvironmentArgs,stateDirectory,executeEnvironmentCommand} from '../ops/temporary-idle/environment-cli.mjs';
import cell from '../ops/deployment-baseline/cell-reattach-draft.template.json' with {type:'json'};
import platform from '../ops/deployment-baseline/platform-idle-convergence.template.json' with {type:'json'};

const plan=(f,mode,previous,expectedMode)=>prepareEnvironmentPlan({config:f.config,io:f.io,mode,...(previous?{base:previous.base,expectedMode}:{}),waitSeconds:1});
const apply=(f,p,store=memoryStore())=>executeEnvironmentPlan({config:f.config,io:f.io,plan:p,approvedSha:hash(p),store});
async function clean(dir){assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('aws-env-v2-test-'));await rm(dir,{recursive:true});}

test('idle variants retain the existing stacks and protected resources without dangling listeners or service dependencies',()=>{
 const f=fixture();for(const role of ROLES){const base=f.baseTemplates[role],idle=variant(base,role,'idle');assert.equal(Object.keys(base.Resources).length-Object.keys(idle.Resources).length,4);for(const id of EDGE[role])assert.equal(idle.Resources[id],undefined);for(const [id,r]of Object.entries(idle.Resources))assert.deepEqual(r,base.Resources[id]);assert.deepEqual(variant(base,role,'full',1),base);}
 assert.equal(Object.keys(variant(cell,'cell','idle').Resources).length,12);assert.equal(Object.keys(variant(platform,'platform','idle').Resources).length,7);assert.equal(variant(platform,'platform','full',1).Resources.Service.Properties.DesiredCount,1);
});

test('read-only preparation binds a five-hour whole-cycle SHA and does not mutate cloud resources',async()=>{
 const f=fixture(),p=await plan(f,'stop');assert.equal(writes(f).length,0);assert.equal(p.writeBefore-p.preparedAt,5*3600000);assert.equal(p.observedMode,'baseline');assert.equal(p.writePolicy.cfnChangeSetsOnly,true);assert.equal(p.writePolicy.noIamChange,true);assert.equal(p.base.templates.platform.Resources.Service.Properties.DesiredCount,1);assert.equal(p.limits.totalWritesMax,12);assert.equal(p.limits.cfnExecutionsMax,5);assert.equal(p.limits.externalAliasWritesMax,0);
});

test('stop → start → stop keeps CFN ownership, binds fresh Cell outputs and never writes ELB/ECS or deletes data/stacks',async()=>{
 const f=fixture(),original=copy(Object.fromEntries(ROLES.map(r=>[r,f.stacks[r].bindings]))),stop=await plan(f,'stop');assert.equal((await apply(f,stop)).status,'STOPPED');
 assert.deepEqual(ROLES.map(r=>Object.keys(f.stacks[r].bindings).length),[7,12,3]);assert.deepEqual(f.dbState,{cluster:'stopped',instance:'stopped'});
 const start=await plan(f,'start',stop,'stopped');assert.equal((await apply(f,start)).status,'RUNNING');
 for(const role of ROLES)for(const [id,arn]of Object.entries(original[role]))if(!EDGE[role].includes(id))assert.equal(f.stacks[role].bindings[id],arn);
 assert.notEqual(f.stacks.cell.bindings.CellLoadBalancer,original.cell.CellLoadBalancer);assert.notEqual(f.stacks.platform.bindings.LoadBalancer,original.platform.LoadBalancer);
 assert.equal(f.stacks.tenant.params.HttpsListenerArn,f.stacks.cell.bindings.BusinessHttpsListener);assert.equal(f.stacks.tenant.params.ControlListenerArn,f.stacks.cell.bindings.ControlMtlsListener);
 assert.ok(f.api().AliasTarget.DNSName.includes(f.stacks.cell.bindings.CellLoadBalancer.split('/').at(-1)));assert.equal(f.api().AliasTarget.EvaluateTargetHealth,false);
 for(const role of ['platform','tenant'])assert.equal(f.stacks[role].service.desiredCount,f.stacks[role].template.Resources[role==='platform'?'Service':'TenantService'].Properties.DesiredCount);
 const again=await plan(f,'stop',start,'running');assert.equal((await apply(f,again)).status,'STOPPED');
 assert.ok(writes(f).every(x=>['cloudformation','rds','route53'].includes(x.service)));assert.ok(writes(f).every(x=>!['delete-stack','update-stack','update-service','create-load-balancer','delete-load-balancer'].includes(x.operation)));
 assert.ok(writes(f).filter(x=>x.operation==='execute-change-set').every(x=>x.input.DisableRollback===false));assert.ok(writes(f).filter(x=>x.operation==='change-resource-record-sets').every(x=>x.input.ChangeBatch.Changes.length===1&&x.input.ChangeBatch.Changes[0].ResourceRecordSet.Name===f.config.externalApiAlias.name));
});

test('initial tenant declaration1/live0 is explicitly aligned via CFN before startup, never treated as a no-op scale-up',async()=>{
 const f=fixture();Object.assign(f.stacks.tenant.service,{desiredCount:0,runningCount:0,pendingCount:0});const p=await plan(f,'start');await apply(f,p);
 const countTemplates=writes(f).filter(x=>x.operation==='create-change-set'&&x.input.StackName===f.stacks.tenant.id).map(x=>JSON.parse(x.input.TemplateBody).Resources.TenantService?.Properties.DesiredCount);assert.ok(countTemplates.includes(0)&&countTemplates.includes(1));assert.equal(f.stacks.tenant.service.desiredCount,1);
});

test('idle tasks and stopped databases still require ALB stop; only CFN removes dependencies and retained resource IDs survive',async()=>{
 const f=fixture();
 f.stacks.platform.template.Resources.Service.Properties.DesiredCount=0;
 f.config.stacks.platform.templateSha256=hash(f.stacks.platform.template);
 for(const role of ['platform','tenant'])Object.assign(f.stacks[role].service,{desiredCount:0,runningCount:0,pendingCount:0});
 Object.assign(f.dbState,{cluster:'stopped',instance:'stopped'});
 const retained=Object.fromEntries(ROLES.map(role=>[role,Object.fromEntries(Object.entries(f.stacks[role].bindings).filter(([id])=>!EDGE[role].includes(id)))]));
 const p=await plan(f,'stop'),result=await apply(f,p);
 assert.equal(result.status,'STOPPED');assert.equal(result.noWriteReplay,false);
 assert.ok(writes(f).every(x=>x.service==='cloudformation'));
 assert.equal(writes(f).filter(x=>x.operation==='execute-change-set').length,4);
 const creates=writes(f).filter(x=>x.operation==='create-change-set');
 assert.deepEqual(creates.map(x=>Object.values(f.stacks).find(s=>s.id===x.input.StackName).role),['tenant','tenant','platform','cell']);
 assert.equal(JSON.parse(creates[0].input.TemplateBody).Resources.TenantService.Properties.DesiredCount,0);
 for(const role of ROLES)assert.deepEqual(f.stacks[role].bindings,retained[role]);
 assert.deepEqual(f.dbState,{cluster:'stopped',instance:'stopped'});
 const sameState=await plan(f,'stop',p,'stopped'),before=writes(f).length;
 assert.equal((await apply(f,sameState)).noWriteReplay,true);assert.equal(writes(f).length,before);
 const start=await plan(f,'start',p,'stopped');assert.equal((await apply(f,start)).status,'RUNNING');
 assert.deepEqual(f.dbState,{cluster:'available',instance:'available'});
 for(const role of ROLES)for(const [id,physical]of Object.entries(retained[role]))assert.equal(f.stacks[role].bindings[id],physical);
 const stopAgain=await plan(f,'stop',start,'running');assert.equal((await apply(f,stopAgain)).status,'STOPPED');
});

test('an already running freshly approved start performs verification but no cloud writes',async()=>{const f=fixture(),p=await plan(f,'start');const r=await apply(f,p);assert.equal(r.status,'RUNNING');assert.equal(r.noWriteReplay,true);assert.equal(writes(f).length,0);});

test('wrong principal, database identity, ownership, active controller, foreign workloads/rules or scaling refuses before any cloud write',async()=>{
 for(const key of ['wrongUser','replacedDb','badTag','badController','foreignService','foreignRule','externalScaling']){const f=fixture();f.state[key]=true;await assert.rejects(plan(f,'stop'),undefined,key);assert.equal(writes(f).length,0,key);}
});

test('unknown drift is not silently adopted as a new baseline',async()=>{
 const f=fixture();f.stacks.platform.template.Description='unreviewed';await assert.rejects(plan(f,'stop'),/BASELINE_TEMPLATE_CHANGED/);assert.equal(writes(f).length,0);
 const g=fixture();g.stacks.platform.service.desiredCount=0;await assert.rejects(plan(g,'stop'),/DESIRED_COUNT_DRIFT/);assert.equal(writes(g).length,0);
});

test('tenant cross-stack listener parameter drift and service target drift refuse preparation',async()=>{for(const which of ['listener','target']){const f=fixture();if(which==='listener')f.stacks.tenant.params.HttpsListenerArn='stale-listener';else f.stacks.tenant.service.loadBalancers[0].targetGroupArn='foreign-target';await assert.rejects(plan(f,'stop'),/BINDING_DRIFT/);assert.equal(writes(f).length,0);}});

test('expired or incorrect SHA, disabled switch and missing role review refuse before execution reads/writes',async()=>{
 for(const kind of ['sha','expired','disabled','role']){const f=fixture();if(kind==='role')f.config.acknowledgeRoleScopeReview=false;const p=await plan(f,kind==='role'?'start':'stop'),before=f.calls.length;if(kind==='expired')f.advance(5*3600000);if(kind==='disabled')f.config.enabled=false;
  await assert.rejects(executeEnvironmentPlan({config:f.config,io:f.io,plan:p,approvedSha:kind==='sha'?'a'.repeat(64):hash(p),store:memoryStore()}));assert.equal(f.calls.length,before);assert.equal(writes(f).length,0);}
});

test('role acknowledgement can be reviewed without destroying the saved resource scope, but requires a new approved plan',async()=>{
 const f=fixture();f.config.acknowledgeRoleScopeReview=false;const p=await plan(f,'start'),oldHash=configHash(f.config);f.config.acknowledgeRoleScopeReview=true;assert.equal(configHash(f.config),oldHash);await assert.rejects(apply(f,p),/ROLE_SCOPE_REVIEW_REQUIRED/);assert.equal(writes(f).length,0);await apply(f,await plan(f,'start'));
});

test('fresh service identity changes after preparation stop before mutation',async()=>{const f=fixture(),p=await plan(f,'stop');f.stacks.platform.service.createdAt='changed';await assert.rejects(apply(f,p),/CHANGED_SINCE_PLAN/);assert.equal(writes(f).length,0);});

test('backup persistence failure precedes the first cloud write',async()=>{const f=fixture(),p=await plan(f,'stop'),store=memoryStore();store.createSnapshot=async()=>{throw Error('DISK_FULL');};await assert.rejects(apply(f,p,store),/DISK_FULL/);assert.equal(writes(f).length,0);});

test('unexpected Change Set scope prevents Execute and leaves the created plan for inspection',async()=>{const f=fixture(),p=await plan(f,'stop'),store=memoryStore();f.state.unexpectedChange=true;await assert.rejects(apply(f,p,store),/CHANGE_SET_SCOPE_COUNT/);assert.equal(writes(f).filter(x=>x.operation==='create-change-set').length,1);assert.equal(writes(f).filter(x=>x.operation==='execute-change-set').length,0);assert.equal(store.journal.status,'NEEDS_INSPECTION');});

test('unknown Execute submission is attempted once and never rolled back or replayed',async()=>{const f=fixture(),p=await plan(f,'stop'),store=memoryStore();f.state.unknownExecute=true;await assert.rejects(apply(f,p,store));assert.equal(writes(f).filter(x=>x.operation==='execute-change-set').length,1);assert.ok(Object.values(store.journal.actions).some(x=>x.status==='UNKNOWN_OR_REJECTED'));const before=writes(f).length;await assert.rejects(apply(f,p,store));assert.equal(writes(f).length,before);});

test('root stabilization timeout is not retried, silently force-deployed or claimed stopped',async()=>{const f=fixture(),p=await plan(f,'stop'),store=memoryStore();f.state.neverComplete=true;await assert.rejects(apply(f,p,store),/WAIT_TIMEOUT_INSPECT/);assert.equal(store.journal.status,'NEEDS_INSPECTION');assert.equal(writes(f).filter(x=>x.operation==='execute-change-set').length,1);assert.equal(writes(f).filter(x=>x.operation==='stop-db-cluster').length,0);});

test('strict v2 config/parser retire old direct-resource configuration and require exact approved apply inputs',()=>{
 const f=fixture();assert.equal(validateEnvironment(f.config).schema,'techlong/temporary-environment/v2');assert.throws(()=>validateEnvironment({...f.config,schema:'techlong/temporary-environment/v1'}),/LEGACY_DIRECT_RESOURCE/);
 for(const c of [{...f.config,password:'never'},{...f.config,network:{natGatewayIds:[]}},{...f.config,stacks:{...f.config.stacks,other:{}}}])assert.throws(()=>validateEnvironment(c));
 assert.equal(parseEnvironmentArgs(['stop']).execute,false);for(const args of [['stop','--execute','--confirm-account',accountId],['stop','--execute'],['plan-stop','--plan','x'],['start','--wait-seconds','0'],['stop','--execute','--execute']])assert.throws(()=>parseEnvironmentArgs(args));
 assert.throws(()=>stateDirectory({...f.config,stateDirectory:process.cwd()}));assert.throws(()=>stateDirectory({...f.config,stateDirectory:path.join(os.tmpdir(),'aws-environment-state')}));
});

test('offline previews do not spawn subprocesses, access credentials or create private state',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'aws-env-v2-test-'));try{const f=fixture(),c={...f.config,enabled:false,stateDirectory:path.join(dir,'aws-environment-cfn-state')};for(const mode of ['status','stop','start','plan-stop','plan-start']){const r=await executeEnvironmentCommand(parseEnvironmentArgs([mode]),c,{exec:()=>assert.fail('no subprocess')});assert.equal(r.awsCalls,0);}assert.deepEqual(await readdir(dir),[]);await assert.rejects(executeEnvironmentCommand(parseEnvironmentArgs(['plan-stop','--execute','--confirm-account',accountId]),c),/DISABLED/);assert.deepEqual(await readdir(dir),[]);}finally{await clean(dir);}});

test('adapter rejects direct ELB/ECS, all stack deletion/IAM/Secret/EC2 writes and managed-console DNS, and signs Route53 globally',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aws-env-v2-test-'));try{const f=fixture(),calls=[],exec=async(bin,args,opts)=>{calls.push({args,opts});return {stdout:'{}'};},a=new EnvironmentAwsCli(f.config,dir,{exec,allowWrites:true});
  for(const [s,o]of [['elbv2','delete-load-balancer'],['elbv2','create-listener'],['ecs','update-service'],['cloudformation','delete-stack'],['cloudformation','update-stack'],['iam','create-role'],['secretsmanager','get-secret-value'],['rds','delete-db-instance'],['ec2','delete-vpc']])await assert.rejects(a.call(s,o,{}),/API_NOT_ALLOWED/);
  await assert.rejects(a.call('route53','change-resource-record-sets',{HostedZoneId:'ZTEST',ChangeBatch:{Changes:[{Action:'UPSERT',ResourceRecordSet:{Name:'console.sandbox.example.com.',Type:'A'}}]}}),/ONLY_EXTERNAL_API_ALIAS/);assert.equal(calls.length,0);
  await a.call('route53','get-change',{Id:'/change/test'});assert.ok(calls[0].args.includes('https://route53.amazonaws.com'));assert.equal(calls[0].args[calls[0].args.indexOf('--region')+1],'us-east-1');assert.equal(calls[0].opts.env.AWS_MAX_ATTEMPTS,'1');assert.equal(calls[0].opts.shell,undefined);assert.deepEqual(await readdir(dir),[]);
 }finally{await clean(dir);}
});

test('real private plan files support stop/start/stop with synthetic CLI and preserve all prior attempts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aws-env-v2-test-'));try{const f=fixture(),c={...f.config,stateDirectory:path.join(dir,'aws-environment-cfn-state')},exec=async(bin,args)=>{try{return {stdout:JSON.stringify(await f.io.call(args[0],args[1],JSON.parse(await readFile(args[args.indexOf('--cli-input-json')+1].slice(7),'utf8'))))};}catch(e){throw Object.assign(Error('synthetic private text'),{stderr:'An error occurred ('+(e.code??'SyntheticError')+')'});}},
   command=(mode,approved)=>executeEnvironmentCommand(parseEnvironmentArgs([mode,'--execute','--confirm-account',accountId,...(approved?['--plan',approved.planId,'--approved-plan-sha',approved.planSha256]:[])]),c,{exec,now:f.io.now,sleep:f.io.sleep});
  const p1=await command('plan-stop');assert.equal(writes(f).length,0);assert.match(p1.implementationSha256,/^[a-f0-9]{64}$/);
  const stale=JSON.parse(await readFile(path.join(p1.privatePlanDirectory,'snapshot.json'),'utf8'));stale.plan.id=randomUUID();stale.plan.implementationSha256='f'.repeat(64);const staleStore=new FileStore(path.join(c.stateDirectory,'plan-'+stale.plan.id));await staleStore.createDirectory();await staleStore.createSnapshot(stale,{schema:'techlong/temporary-environment-state/v2',planSha256:hash(stale.plan),status:'PREPARED'});const beforeStale=f.calls.length;await assert.rejects(command('stop',{planId:stale.plan.id,planSha256:hash(stale.plan)}),/IMPLEMENTATION_CHANGED/);assert.equal(f.calls.length,beforeStale);
  assert.equal((await command('stop',p1)).status,'STOPPED');const before=f.calls.length;await assert.rejects(command('stop',p1),/PARENT_MISMATCH|NO_REPLAY/);assert.equal(f.calls.length,before);
  const p2=await command('plan-start');assert.equal((await command('start',p2)).status,'RUNNING');const p3=await command('plan-stop');assert.equal((await command('stop',p3)).status,'STOPPED');assert.notEqual(p1.planId,p3.planId);assert.ok((await readdir(c.stateDirectory)).includes('plan-'+p1.planId));
  const prior=writes(f).length;assert.equal((await command('status')).status,'STOPPED');assert.equal(writes(f).length,prior);
  const failed=await command('plan-start');f.state.unknownExecute=true;await assert.rejects(command('start',failed));const failedWrites=writes(f).length,inspected=await command('status');assert.equal(inspected.status,'NEEDS_INSPECTION');assert.equal(inspected.readOnly,true);assert.equal(writes(f).length,failedWrites);await assert.rejects(command('plan-start'),/PREVIOUS_OPERATION_REQUIRES_INSPECTION/);
 }finally{await clean(dir);}
});
