import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import b from '../ops/deployment-baseline/existing-tenant.template.json' with { type: 'json' };
import detach from '../ops/deployment-baseline/cell-detach-draft.template.json' with { type: 'json' };
import capture from '../ops/deployment-baseline/cell-preflight-20261106.json' with { type: 'json' };
import execution from '../ops/deployment-baseline/cell-a1-execution-review.json' with { type: 'json' };
import created from '../ops/deployment-baseline/cell-a1-created-20261106.json' with { type: 'json' };
import executed from '../ops/deployment-baseline/cell-a1-executed-20261106.json' with { type: 'json' };
import reattach from '../ops/deployment-baseline/cell-reattach-draft.template.json' with { type: 'json' };
import a2 from '../ops/deployment-baseline/cell-a2-offline-plan.json' with { type: 'json' };
import a2Facts from '../ops/deployment-baseline/cell-a2-preflight-20261107.json' with { type: 'json' };
import a2Create from '../ops/deployment-baseline/cell-a2-creation-review.json' with { type: 'json' };
import a2Created from '../ops/deployment-baseline/cell-a2-created-20261107.json' with { type: 'json' };
import a2Execute from '../ops/deployment-baseline/cell-a2-execution-review.json' with { type: 'json' };
import a2Costs from '../ops/deployment-baseline/cell-a2-cost-estimate.json' with { type: 'json' };
import a2Executed from '../ops/deployment-baseline/cell-a2-executed-20261107.json' with { type: 'json' };
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

test('A1 observed result is one execution and twelve retained owners, not A2 or restored ownership',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  assert.equal(executed.approvedManifestSha256,createHash('sha256').update(JSON.stringify(canonical(execution))).digest('hex'));
  assert.equal(executed.stackId,created.stackId);assert.equal(executed.changeSetId,created.changeSetId);
  assert.equal(executed.stage,'A1');assert.equal(executed.status,'A1_DETACHED_INDEPENDENTLY_VERIFIED');
  assert.equal(executed.stackStatus,'UPDATE_COMPLETE');assert.equal(executed.changeSetExecutionStatus,'EXECUTE_COMPLETE');
  assert.equal(executed.disableRollback,true);assert.equal(executed.counts.total.executeChangeSet,1);
  assert.equal(executed.counts.otherDirectAwsWrites,0);assert.equal(executed.automaticWriteRetry,false);
  assert.equal(executed.automaticRollback,false);assert.equal(executed.a2Authorized,false);
  assert.equal(executed.cloudFormationOwnershipRepaired,false);assert.equal(executed.albAbsentCode,'LoadBalancerNotFound');
  assert.equal(executed.appliedTemplateSha256,capture.a1.canonicalSha256);
  assert.deepEqual(executed.removedLogicalIds,[...execution.expected.removeLogicalIds].sort());
  assert.deepEqual(executed.removedOutputKeys,[...capture.a1.removeOutputs].sort());
  assert.deepEqual(executed.retainedOutputKeys,Object.keys(detach.Outputs).sort());
  assert.equal(executed.retainedPhysicalIds.length,12);
  assert.equal(new Set(executed.retainedPhysicalIds.map(x=>x.logicalId)).size,12);
  assert.deepEqual(Object.fromEntries(executed.retainedPhysicalIds.map(x=>[x.logicalId,x.type])),Object.fromEntries(Object.entries(detach.Resources).map(([id,v])=>[id,v.Type])));
  for(const key of ['retainedPhysicalIdsUnchanged','retainedOutputsUnchanged','tagsUnchanged','executionRoleUnchanged'])assert.equal(executed[key],true,key);
  assert.ok(Date.parse(executed.submissionIntentAt)<Date.parse(execution.startBefore));
  assert.ok(Date.parse(executed.independentlyVerifiedAt)>Date.parse(executed.updateCompleteObservedAt));
});

test('A2 is the pinned pre-A1 Original: exactly four Add and two outputs, no retained changes',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=createHash('sha256').update(JSON.stringify(canonical(reattach))).digest('hex');
  assert.equal(sha,b.stacks.cell.templateSha256);assert.equal(sha,a2.candidate.canonicalSha256);
  assert.equal(a2.provenance.a1AppliedTemplateCanonicalSha256,executed.appliedTemplateSha256);
  assert.equal(a2.stackId,executed.stackId);
  const added=Object.keys(reattach.Resources).filter(id=>!detach.Resources[id]).sort();
  assert.deepEqual(added,executed.removedLogicalIds);
  assert.deepEqual(a2.candidate.add,added.map(logicalId=>({logicalId,type:reattach.Resources[logicalId].Type})));
  assert.deepEqual(a2.candidate.modify,[]);assert.deepEqual(a2.candidate.remove,[]);
  const reverse=structuredClone(reattach);
  for(const id of added)delete reverse.Resources[id];
  for(const id of executed.removedOutputKeys)delete reverse.Outputs[id];
  assert.deepEqual(reverse,detach,'including retained attributes, tags, Metadata, Rules and Parameters');
  assert.equal(Object.keys(reattach.Resources).length,16);
  assert.deepEqual(a2.candidate.addOutputKeys,executed.removedOutputKeys);
});

test('A2 restores only ALB routing infrastructure with original TLS and mTLS deny defaults',()=>{
  const r=reattach.Resources,alb=r.CellLoadBalancer;
  assert.deepEqual(alb.DependsOn,['PublicDefaultRoute']);assert.equal(alb.Properties.Type,'application');
  assert.equal(alb.Properties.Scheme,'internet-facing');assert.equal(alb.Properties.IpAddressType,'ipv4');
  assert.deepEqual(alb.Properties.SecurityGroups,[{Ref:'LoadBalancerSecurityGroup'}]);
  assert.deepEqual(alb.Properties.Subnets,[{Ref:'PublicSubnetA'},{Ref:'PublicSubnetB'}]);
  for(const [id,port] of [['BusinessHttpsListener',443],['ControlMtlsListener',8443]]){
    const p=r[id].Properties;assert.equal(p.Port,port);assert.equal(p.Protocol,'HTTPS');
    assert.equal(p.SslPolicy,'ELBSecurityPolicy-TLS13-1-2-2021-06');
    assert.deepEqual(p.Certificates,[{CertificateArn:{Ref:'CertificateArn'}}]);
    assert.deepEqual(p.LoadBalancerArn,{Ref:'CellLoadBalancer'});
    assert.equal(p.DefaultActions.length,1);assert.equal(p.DefaultActions[0].Type,'fixed-response');
    assert.equal(p.DefaultActions[0].FixedResponseConfig.StatusCode,'404');
  }
  assert.deepEqual(r.ControlMtlsListener.Properties.MutualAuthentication,{IgnoreClientCertificateExpiry:false,Mode:'verify',TrustStoreArn:{Ref:'ControlTrustStoreArn'}});
  assert.equal(r.BusinessHttpsListener.Properties.MutualAuthentication,undefined);
  const deny=r.BusinessControlDenyRule.Properties;
  assert.equal(deny.Priority,1);assert.deepEqual(deny.ListenerArn,{Ref:'BusinessHttpsListener'});
  assert.deepEqual(deny.Conditions,[{Field:'path-pattern',PathPatternConfig:{Values:['/api/saas','/api/saas/*']}}]);
  assert.equal(deny.Actions[0].Type,'fixed-response');assert.equal(deny.Actions[0].FixedResponseConfig.StatusCode,'404');
  assert.deepEqual(reattach.Outputs.HttpsListenerArn,{Value:{Ref:'BusinessHttpsListener'}});
  assert.deepEqual(reattach.Outputs.ControlListenerArn,{Value:{Ref:'ControlMtlsListener'}});
  assert.equal(alb.Properties.Tags.find(t=>t.Key==='ExpiresAt').Value,capture.dependencies.cellExpiresAt);
});

test('A2 references are declaration-based and closed, never historical physical listener IDs or database resources',()=>{
  const names=new Set([...Object.keys(reattach.Resources),...Object.keys(reattach.Parameters)]);
  const visit=v=>{
    if(!v||typeof v!=='object')return;
    if('Ref' in v)assert.ok(names.has(v.Ref)||v.Ref.startsWith('AWS::'),'unknown Ref '+v.Ref);
    if('Fn::GetAtt' in v){const x=v['Fn::GetAtt'];assert.ok(names.has(Array.isArray(x)?x[0]:x.split('.')[0]));}
    for(const x of Object.values(v))visit(x);
  };
  visit(reattach);
  for(const r of Object.values(reattach.Resources)){
    for(const id of typeof r.DependsOn==='string'?[r.DependsOn]:(r.DependsOn??[]))assert.ok(reattach.Resources[id]);
    assert.ok(!r.Type.startsWith('AWS::RDS::'));assert.ok(!r.Type.startsWith('AWS::IAM::'));
  }
  assert.doesNotMatch(JSON.stringify(reattach),/arn:aws:elasticloadbalancing:[^" ]*:(?:loadbalancer|listener|listener-rule)\//);
});

test('A2 offline plan is not creation/execution authority and retains all four parameter bindings',()=>{
  assert.equal(a2.status,'OFFLINE_DRAFT_NOT_EXECUTABLE');
  assert.equal(a2.creationAuthorized,false);assert.equal(a2.executionAuthorized,false);
  assert.equal(a2.cloudFormationOwnershipRepaired,false);
  for(const count of Object.values(a2.thisPreparation))assert.equal(count,0);
  for(const key of ['approvalManifestSha256','changeSetId','executionRequest','liveFactsAt','startBefore'])assert.equal(a2.pendingReview[key],null);
  for(const key of ['newReadOnlyPermissionRequired','creationApprovalRequired','executionApprovalRequired'])assert.equal(a2.pendingReview[key],true);
  assert.deepEqual(a2.changeSetInputOutline,{ChangeSetType:'UPDATE',Parameters:b.stacks.cell.parameters.map(ParameterKey=>({ParameterKey,UsePreviousValue:true}))});
  assert.equal(a2.acceptOnly.addCount,4);assert.equal(a2.acceptOnly.modifyCount,0);assert.equal(a2.acceptOnly.removeCount,0);
  assert.equal(a2.candidate.historicalExpiresAtPreserved,capture.dependencies.cellExpiresAt);
});

test('A2 creation review binds new facts and one unexecuted change set, never ALB execution',()=>{
  assert.equal(a2Facts.counts.sts,1);assert.equal(a2Facts.counts.metadataAttempts,22);
  assert.equal(a2Facts.counts.awsWrites,0);assert.equal(a2Facts.retainedResourceCount,12);
  assert.equal(a2Create.status,'PREPARED_NOT_APPROVED');assert.equal(a2Create.creationAuthorized,false);assert.equal(a2Create.executionAuthorized,false);
  assert.equal(a2Create.requestWithoutTemplateBody.StackName,a2Facts.stackId);
  assert.equal(a2Create.requestWithoutTemplateBody.ChangeSetType,'UPDATE');
  assert.equal(a2Create.templateSource.canonicalSha256,a2.candidate.canonicalSha256);
  assert.equal(a2Create.expected.currentTemplateSha256,executed.appliedTemplateSha256);
  assert.deepEqual(a2Create.expected.iamSha256,a2Facts.iamSha256);
  assert.deepEqual(a2Create.requestWithoutTemplateBody.Parameters,a2.changeSetInputOutline.Parameters);
  assert.deepEqual(a2Create.expected.addLogicalIds,a2.candidate.add.map(x=>x.logicalId));
  assert.equal(a2Create.scope.createChangeSetMax,1);
  for(const key of ['executeChangeSet','deleteChangeSet','createStack','updateStack','rollbackStack','iamWrites','dnsWrites','databaseOperations','imageUpdates','secretValueReads','privateKeyReads','lambdaInvocations','restoreAlbOrEcs','dispatch'])assert.equal(a2Create.scope[key],0,key);
  assert.equal(a2Create.requestWithoutTemplateBody.IncludeNestedStacks,false);
  assert.equal(a2Create.requestWithoutTemplateBody.OnStackFailure,undefined);
  assert.equal(a2Create.failurePolicy.replayAfterUnknownSubmission,false);assert.equal(a2Create.failurePolicy.attemptResetAllowed,false);
  assert.equal(a2Create.scope.iamSigningRegion,'us-east-1');
  assert.equal(Date.parse(a2Create.factsValidBefore)-Date.parse(a2Create.factsAt),5*3600000);
  assert.equal(Date.parse(a2Create.factsValidBefore)-Date.parse(a2Create.startBefore),10*60000);
  assert.equal(a2Create.requestWithoutTemplateBody.Tags.find(x=>x.Key==='ExpiresAt').Value,a2.candidate.historicalExpiresAtPreserved);
});

test('A2 created result is an available four-Add plan; applied stack remains twelve-resource A1',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  assert.equal(a2Created.approvedManifestSha256,createHash('sha256').update(JSON.stringify(canonical(a2Create))).digest('hex'));
  assert.equal(a2Created.status,'A2_CREATED_VERIFIED_NOT_EXECUTED');
  assert.equal(a2Created.stackId,a2Create.requestWithoutTemplateBody.StackName);
  assert.ok(a2Created.changeSetId.startsWith('arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+a2Create.requestWithoutTemplateBody.ChangeSetName+'/'));
  assert.equal(a2Created.changeSetStatus,'CREATE_COMPLETE');assert.equal(a2Created.executionStatus,'AVAILABLE');
  assert.equal(a2Created.proposedTemplateSha256,a2Create.templateSource.canonicalSha256);
  assert.equal(a2Created.appliedTemplateSha256,executed.appliedTemplateSha256);
  assert.deepEqual(a2Created.changes,a2.candidate.add.map(x=>({...x,action:'Add'})));
  assert.equal(a2Created.counts.total.createChangeSet,1);assert.equal(a2Created.counts.total.executeChangeSet,0);
  assert.equal(a2Created.counts.total.deleteChangeSet,0);assert.equal(a2Created.counts.total.otherDirectAwsWrites,0);
  assert.equal(a2Created.retainedResourceCount,12);assert.equal(a2Created.retainedPhysicalIdsMatch,true);
  assert.equal(a2Created.twoListenerOutputsStillAbsent,true);assert.equal(a2Created.namedAlbAbsentCode,'LoadBalancerNotFound');
  assert.equal(a2Created.creationAuthorized,true);assert.equal(a2Created.executionAuthorized,false);
  assert.equal(a2Created.albRestored,false);assert.equal(a2Created.cloudFormationOwnershipRepaired,false);
  assert.ok(Date.parse(a2Created.submissionIntentAt)<Date.parse(a2Create.startBefore));
});

test('A2 execution proposal binds only the existing four-Add plan and an explicit new failure policy',()=>{
  assert.equal(a2Execute.status,'PREPARED_NOT_APPROVED');assert.equal(a2Execute.executionAuthorized,false);
  assert.equal(a2Execute.request.StackName,a2Created.stackId);assert.equal(a2Execute.request.ChangeSetName,a2Created.changeSetId);
  assert.equal(a2Execute.request.DisableRollback,true);assert.equal(a2Execute.scope.executeChangeSetMax,1);
  assert.equal(a2Execute.expected.currentTemplateSha256,a2Created.appliedTemplateSha256);
  assert.equal(a2Execute.expected.proposedTemplateSha256,a2Created.proposedTemplateSha256);
  assert.deepEqual(a2Execute.expected.addLogicalIds,a2Created.changes.map(x=>x.logicalId));
  for(const key of ['createChangeSet','deleteChangeSet','createStack','updateStack','deleteStack','rollbackStack','continueUpdateRollback','directElbWrites','iamWrites','dnsWrites','databaseOperations','ecsWrites','imageUpdates','secretValueReads','privateKeyReads','configSecretFileReads','lambdaInvocations','cleanupOrExpiryChanges','tenantRuleChanges','dispatch'])assert.equal(a2Execute.scope[key],0,key);
  assert.equal(a2Execute.failurePolicy.replayAfterUnknownSubmission,false);assert.equal(a2Execute.failurePolicy.automaticCleanup,false);
  assert.equal(a2Execute.failurePolicy.providerInternalResourceRecoveryMayStillOccur,true);
  assert.equal(a2Execute.expected.cellCleanupSchedule,'DISABLED');assert.equal(a2Execute.historicalCleanupRisk.oldTagNotRenewedOrRemoved,true);
  assert.equal(a2Execute.preparationAccountAwsCalls,0);
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  for(const [file,data]of [['cell-a1-executed-20261106.json',executed],['cell-a2-preflight-20261107.json',a2Facts],['cell-a2-created-20261107.json',a2Created],['cell-a2-cost-estimate.json',a2Costs]]){
    assert.equal(a2Execute.evidenceBindings.find(x=>x.file===file)?.canonicalSha256,createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex'));
  }
  assert.equal(a2Execute.dependencyFactsAt,a2Facts.factsAt);
  assert.equal(Date.parse(a2Execute.dependencyFactsValidBefore)-Date.parse(a2Execute.dependencyFactsAt),5*3600000);
  assert.equal(Date.parse(a2Execute.dependencyFactsValidBefore)-Date.parse(a2Execute.startBefore),15*60000);
});

test('A2 public price scenario includes the mTLS trust store and IPv4, never promises a 50 USD cap',()=>{
  assert.equal(a2Costs.region,'ca-central-1');assert.equal(a2Costs.scenario.albCount,1);
  const hourly=a2Costs.rates.albHour.usd+a2Costs.rates.trustStoreAssociationUnitHour.usd*a2Costs.scenario.trustStoreAssociationUnits+a2Costs.rates.inUsePublicIpv4Hour.usd*a2Costs.scenario.publicIpv4CountAssumed;
  assert.equal(Number(hourly.toFixed(5)),a2Costs.scenario.fixedHourlyUsd);
  assert.equal(Number((hourly*730).toFixed(4)),a2Costs.scenario.fixedMonthlyUsd);
  assert.equal(Number((hourly*2).toFixed(4)),a2Costs.scenario.fixedTwoHourUsd);
  assert.equal(Number((a2Costs.rates.usedLcuHour.usd*730).toFixed(3)),a2Costs.scenario.oneLcuContinuousMonthlyAdditionalUsd);
  assert.equal(a2Execute.costAcceptance.scenarioFixedMonthlyUsd,a2Costs.scenario.fixedMonthlyUsd);
  assert.equal(a2Costs.notACap,true);assert.equal(a2Costs.monthly50UsdGoalNotGuaranteed,true);
  assert.equal(a2Execute.costAcceptance.noNewAutomaticExpiryOrCleanupInstalled,true);
  assert.equal(a2Execute.costAcceptance.notACostCap,true);assert.equal(a2Costs.createsOrExpiresResources,false);
});

test('A2 executed result restores only Cell ownership with real outputs, not tenant or API bindings',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  assert.equal(a2Executed.approvedManifestSha256,createHash('sha256').update(JSON.stringify(canonical(a2Execute))).digest('hex'));
  assert.equal(a2Executed.status,'A2_EXECUTED_CELL_FOUR_RESOURCES_INDEPENDENTLY_VERIFIED');
  assert.equal(a2Executed.stackId,a2Execute.request.StackName);assert.equal(a2Executed.changeSetId,a2Created.changeSetId);
  assert.equal(a2Executed.disableRollback,true);assert.equal(a2Executed.activeResourceCount,16);assert.equal(a2Executed.retainedResourceCount,12);
  assert.equal(a2Executed.appliedTemplateSha256,a2Execute.expected.proposedTemplateSha256);
  assert.equal(a2Executed.retainedPhysicalIdsUnchanged,true);assert.equal(a2Executed.newPhysicalIds.length,4);
  assert.deepEqual(a2Executed.newPhysicalIds.map(x=>x.logicalId),a2Execute.expected.addLogicalIds);
  const id=key=>a2Executed.newPhysicalIds.find(x=>x.logicalId===key).physicalId;
  assert.equal(a2Executed.cellOutputs.HttpsListenerArn,id('BusinessHttpsListener'));
  assert.equal(a2Executed.cellOutputs.ControlListenerArn,id('ControlMtlsListener'));
  assert.equal(a2Executed.alb.arn,id('CellLoadBalancer'));assert.equal(a2Executed.alb.state,'active');
  assert.equal(a2Executed.counts.total.executeChangeSet,1);assert.equal(a2Executed.counts.total.otherDirectAwsWrites,0);
  assert.ok(a2Executed.counts.total.metadata<=a2Execute.scope.metadataReadMax);
  assert.equal(a2Executed.cellFourResourceOwnershipRestored,true);
  for(const key of ['tenantBindingsRepaired','apiDnsRepaired','platformDriftRepaired','wholeSystemAccepted'])assert.equal(a2Executed[key],false,key);
  assert.equal(a2Executed.listeners.find(x=>x.port===8443).mtls.ignoreClientCertificateExpiry,false);
  assert.equal(a2Executed.billableAlbActive,true);assert.equal(a2Executed.automaticCleanup,false);
  const observed=a2Executed.tenantListenerParametersObservedBeforeExecute;
  assert.ok(Date.parse(observed.observedAt)<Date.parse(a2Executed.submissionIntentAt));
  assert.notEqual(observed.HttpsListenerArn,a2Executed.cellOutputs.HttpsListenerArn);
  assert.notEqual(observed.ControlListenerArn,a2Executed.cellOutputs.ControlListenerArn);
});
