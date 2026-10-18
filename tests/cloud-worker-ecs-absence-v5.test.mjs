import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {readCloudServiceNamespaceV5} from '../ops/cloud-worker/aws-initialized-workload-v5.mjs';
const cloudRequire=createRequire(new URL('../ops/cloud-worker/package.json',import.meta.url)),
  {DescribeServicesCommand,ListTasksCommand}=cloudRequire('@aws-sdk/client-ecs');
const serviceName='tenant-9c5ee9e64509dcad-ecs-service',
  serviceArn='arn:aws:ecs:ca-central-1:402010193138:service/cell-sandbox-1/'+serviceName;
const missing=()=>({services:[],failures:[{arn:serviceArn,reason:'MISSING'}]}),
  notFound=()=>Object.assign(new Error('Service not found.'),{name:'ServiceNotFoundException',$metadata:{httpStatusCode:400}});
function rig({services=missing(),tasks={taskArns:[]},taskError,describeError}={}){
  const calls=[];
  const send=async command=>{
    calls.push(command);
    if(command instanceof DescribeServicesCommand){if(describeError)throw describeError;return services;}
    assert.ok(command instanceof ListTasksCommand);if(taskError)throw taskError;return tasks;
  };
  return {calls,run:()=>readCloudServiceNamespaceV5(send,serviceName)};
}
test('observed exact MISSING plus HTTP400 ServiceNotFound becomes empty tasks using only two precise reads',async()=>{
  const f=rig({taskError:notFound()}),result=await f.run();
  assert.deepEqual(result.services,missing());assert.deepEqual(result.tasks,{taskArns:[]});assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[0].input,{cluster:'cell-sandbox-1',services:[serviceName]});
  assert.deepEqual(f.calls[1].input,{cluster:'cell-sandbox-1',serviceName,desiredStatus:'RUNNING'});
});
test('successful ListTasks response is passed through, including pagination and tasks for existing namespace guards',async()=>{
  for(const tasks of [{taskArns:[]},{taskArns:['unexpected-task']},{taskArns:[],nextToken:'more'},{}]){
    const f=rig({tasks}),result=await f.run();assert.equal(result.tasks,tasks);assert.equal(f.calls.length,2);
  }
});
test('INACTIVE zero-capacity happy path remains unchanged when ListTasks succeeds',async()=>{
  const services={services:[{serviceArn,status:'INACTIVE',desiredCount:0,runningCount:0,pendingCount:0}],failures:[]},
    tasks={taskArns:[]},f=rig({services,tasks}),result=await f.run();
  assert.equal(result.services,services);assert.equal(result.tasks,tasks);
});
test('missing ARN, another service/cluster/account, mixed failures or an existing service cannot corroborate absence',async()=>{
  const cases=[{}, {services:[]}, {services:[],failures:[]}, {services:[],failures:[{reason:'MISSING'}]},
    {services:{length:0},failures:missing().failures}, {services:[],failures:{length:1,0:missing().failures[0]}},
    {services:[],failures:[null]},
    {services:[],failures:[{arn:serviceArn+'-other',reason:'MISSING'}]},
    {services:[],failures:[{arn:serviceArn.replace('cell-sandbox-1','another-cluster'),reason:'MISSING'}]},
    {services:[],failures:[{arn:serviceArn.replace('402010193138','111111111111'),reason:'MISSING'}]},
    {services:[],failures:[{arn:serviceArn,reason:'ACCESS_DENIED'}]},
    {services:[],failures:[{arn:serviceArn,reason:'MISSING'},{arn:serviceArn,reason:'MISSING'}]},
    {services:[{serviceArn,status:'ACTIVE',desiredCount:0,runningCount:0,pendingCount:0}],failures:[]},
    {services:[{serviceArn,status:'INACTIVE',desiredCount:0,runningCount:0,pendingCount:0}],failures:[]},
    {services:[{serviceArn,status:'ACTIVE'}],failures:missing().failures}];
  for(const services of cases){const error=notFound(),f=rig({services,taskError:error});
    await assert.rejects(f.run(),e=>e===error);assert.equal(f.calls.length,2);}
});
test('AccessDenied, missing cluster, throttling, abort and network failures propagate unchanged with no retry',async()=>{
  for(const name of ['AccessDeniedException','ClusterNotFoundException','ThrottlingException','AbortError','TimeoutError','NetworkingError','ServiceNotFound']){
    const error=Object.assign(new Error('withheld'),{name,$metadata:{httpStatusCode:400}}),f=rig({taskError:error});
    await assert.rejects(f.run(),e=>e===error);assert.equal(f.calls.length,2);
  }
});
test('error name alone or an unexpected HTTP status never authorizes an empty-list fallback',async()=>{
  for(const status of [undefined,200,403,404,429,500]){
    const error=Object.assign(new Error('Service not found.'),{name:'ServiceNotFoundException',
      ...(status===undefined?{}:{$metadata:{httpStatusCode:status}})}),f=rig({taskError:error});
    await assert.rejects(f.run(),e=>e===error);assert.equal(f.calls.length,2);
  }
});
test('a failed DescribeServices blocks even when ListTasks reports ServiceNotFound',async()=>{
  const error=Object.assign(new Error('withheld'),{name:'AccessDeniedException'}),f=rig({describeError:error,taskError:notFound()});
  await assert.rejects(f.run(),e=>e===error);assert.equal(f.calls.length,2);
});
test('production calls this helper only after idle Cell and fixed metadata checks; all downstream guards remain',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/aws-initialized-workload-v5.mjs',import.meta.url),'utf8');
  const cell=code.indexOf('const cell = await readCell(signal);'),metadata=code.indexOf('await fixedMetadata(workload, job, signal);'),
    helper=code.indexOf('readCloudServiceNamespaceV5(command => send(api.ecs, command, signal), svcName)');
  assert.ok(cell>=0&&metadata>cell&&helper>metadata);
  assert.match(code,/const serviceAbsent = exactCloudServiceMissing\(services, svcName\)/);
  assert.match(code,/!tasks\.nextToken && tasks\.taskArns\?\.length === 0/);
  for(const guard of ['CELL_OR_CAPACITY_DRIFT','NAMESPACE_NOT_EMPTY','PREDECESSOR_NOT_RETIRED','LISTENER_PRIORITY_OCCUPIED','EXTERNAL_AUTHORITY_DRIFT','UNEXPECTED_IAM_CAPABILITY'])
    assert.ok(code.includes(guard));
});
