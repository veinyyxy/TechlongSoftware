import test from 'node:test';
import assert from 'node:assert/strict';
import b from '../ops/deployment-baseline/existing-tenant.template.json' with { type: 'json' };
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
