import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import b from '../ops/deployment-baseline/existing-tenant.template.json' with { type: 'json' };
import detach from '../ops/deployment-baseline/cell-detach-draft.template.json' with { type: 'json' };
import capture from '../ops/deployment-baseline/cell-preflight-20261106.json' with { type: 'json' };
import execution from '../ops/deployment-baseline/cell-a1-execution-review.json' with { type: 'json' };
import created from '../ops/deployment-baseline/cell-a1-created-20261106.json' with { type: 'json' };
import { compareBindings, compareDeclarations, draftImageUpdate, imageChange } from '../ops/deployment-baseline/review.mjs';

const prefix='arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-cell-sandbox-1/aaaaaaaaaaaaaaaa/';
const cellOutputs={ClusterName:'cell-sandbox-1',VpcId:'vpc-aaaaaaaa',TaskSecurityGroupId:'sg-aaaaaaaa',SubnetIds:'subnet-aaaaaaaa,subnet-bbbbbbbb',
  HttpsListenerArn:prefix+'bbbbbbbbbbbbbbbb',ControlListenerArn:prefix+'cccccccccccccccc'};
const first=b.tenantUpdate.repository+'@sha256:'+'a'.repeat(64),next=b.tenantUpdate.repository+'@sha256:'+'b'.repeat(64);
test('three owners and explicit boundaries: neither Express DB nor tenant DNS is in workload stack',()=>{
  assert.deepEqual(Object.values(b.stacks).map(x=>Object.keys(x.resources).length),[11,16,7]);
  assert.ok(Object.values(b.stacks).every(s=>Object.values(s.resources).every(t=>!t.startsWith('AWS::RDS::'))));
  assert.equal(b.stacks.platform.resources.DnsRecord,'AWS::Route53::RecordSet');
  assert.ok(!Object.values(b.stacks.tenant.resources).includes('AWS::Route53::RecordSet'));
  for(const key of b.cellOutputsToTenantParameters){assert.ok(b.stacks.cell.outputs.includes(key));assert.ok(b.stacks.tenant.parameters.includes(key));}
});
test('matching resource names alone do not prove declaration or physical ownership',()=>{
  const templates=Object.fromEntries(Object.entries(b.stacks).map(([k,v])=>[k,{Resources:Object.fromEntries(Object.entries(v.resources).map(([id,Type])=>[id,{Type}]))}]));
  const r=compareDeclarations(templates);assert.equal(r.matchesHistoricalDeclarations,false);assert.ok(r.differences.includes('tenant:template-content'));
  assert.throws(()=>draftImageUpdate(templates,{},first,next),/DECLARATION_DIFF/);
});
test('cross-stack comparison rejects old listener, unknown values, mixed or duplicate listener pair',()=>{
  assert.deepEqual(compareBindings({cellOutputs,tenantParameters:cellOutputs}),{matchesSuppliedBindings:true,differences:[],liveOwnershipVerified:false});
  assert.deepEqual(compareBindings({cellOutputs,tenantParameters:{...cellOutputs,HttpsListenerArn:'old'}}).differences,['HttpsListenerArn']);
  for(const changes of [{ControlListenerArn:cellOutputs.HttpsListenerArn},{SubnetIds:'****'},{VpcId:undefined},
    {ControlListenerArn:cellOutputs.ControlListenerArn.replace('/aaaaaaaaaaaaaaaa/','/dddddddddddddddd/')}]) {
    const fields={...cellOutputs,...changes};assert.equal(compareBindings({cellOutputs:fields,tenantParameters:fields}).matchesSuppliedBindings,false);
  }
});
test('image-only fragment retains all 19 other parameters and does not mutate template across runs',()=>{
  for(const [a,z] of [[first,next],[next,first]]){const r=imageChange(a,z);assert.equal(r.changeSetFragment.UsePreviousTemplate,true);
    assert.deepEqual(r.changeSetFragment.Parameters.filter(p=>!p.UsePreviousValue),[{ParameterKey:'ImageUri',ParameterValue:z}]);
    assert.equal(r.unchangedParameters.length,19);assert.equal(r.changeSetFragment.Parameters.length,20);}
  for(const bad of [first,next+'\n',next.replace('speedfeast','other'),next.replace(/@.*/,':latest')])assert.throws(()=>imageChange(first,bad));
});

test('A1 is only four resource removals and two outputs, retaining the other declaration names',()=>{
  const resources={...b.stacks.cell.resources};
  for(const id of capture.a1.removeLogicalIds)delete resources[id];
  assert.deepEqual(Object.fromEntries(Object.entries(detach.Resources).map(([k,v])=>[k,v.Type])),resources);
  assert.equal(Object.keys(detach.Resources).length,12);
  assert.deepEqual(Object.keys(detach.Parameters).sort(),b.stacks.cell.parameters);
  assert.deepEqual(Object.keys(detach.Outputs).sort(),b.stacks.cell.outputs.filter(k=>!capture.a1.removeOutputs.includes(k)));
  const body=JSON.stringify(detach);
  for(const id of capture.a1.removeLogicalIds)assert.ok(!body.includes(id),'dangling removed reference: '+id);
  assert.equal(detach.Outputs.CellExpiresAt.Value,capture.dependencies.cellExpiresAt,'do not restamp historical expiry');
});
test('A1 body is pinned, read-only evidence cannot authorize a change set or resource creation',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  assert.equal(createHash('sha256').update(JSON.stringify(canonical(detach))).digest('hex'),capture.a1.canonicalSha256);
  assert.equal(capture.originalTemplateSha256,b.stacks.cell.templateSha256);
  assert.equal(capture.executionAuthorized,false);assert.equal(capture.cloudFormationOwnershipRepaired,false);
  assert.equal(capture.scope.awsWriteCalls,0);assert.equal(capture.scope.changeSetsCreated,0);
  assert.equal(capture.dependencies.cellCleanupSchedule,'DISABLED');
  assert.equal(capture.dependencies.globalTenantScan,'ENABLED');
});
test('execution review binds the existing A1, explicitly disables rollback and grants no extra action',()=>{
  assert.equal(execution.status,'PREPARED_NOT_APPROVED');assert.equal(execution.executionAuthorized,false);
  assert.equal(execution.request.StackName,created.stackId);assert.equal(execution.request.ChangeSetName,created.changeSetId);
  assert.equal(execution.request.DisableRollback,true);assert.equal(execution.scope.executeChangeSetMax,1);
  for(const field of ['createChangeSet','deleteChangeSet','updateStack','rollbackStack','continueUpdateRollback','iamWrites','dnsWrites','databaseOperations','imageUpdates','secretValueReads','lambdaInvocations','restoreAlbOrEcs','a2'])assert.equal(execution.scope[field],0,field);
  assert.equal(execution.failurePolicy.replayAfterUnknownSubmission,false);
  assert.equal(execution.failurePolicy.providerInternalResourceRecoveryMayStillOccur,true);
  assert.equal(execution.failurePolicy.timeoutDoesNotCancelAwsOperation,true);
  assert.equal(execution.expected.proposedTemplateSha256,created.proposedTemplateSha256);
  assert.deepEqual([...execution.expected.removeLogicalIds].sort(),created.changes.map(x=>x.logicalId).sort());
  assert.equal(Date.parse(execution.startBefore)-Date.parse(execution.dependencyFactsAt),5*3600000);
  assert.match(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(execution.startBefore)),/^18:23$/);
});
