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
import listenerPlan from '../ops/deployment-baseline/tenant-b-offline-plan.json' with { type: 'json' };
import listenerTemplate from '../ops/deployment-baseline/tenant-listener-change.template.json' with { type: 'json' };
import bFacts from '../ops/deployment-baseline/tenant-b-preflight-20261107.json' with { type: 'json' };
import bIamPolicy from '../ops/deployment-baseline/tenant-b-iam-policy-draft.json' with { type: 'json' };
import bIamReview from '../ops/deployment-baseline/tenant-b-iam-review.json' with { type: 'json' };
import bIamInstalled from '../ops/deployment-baseline/tenant-b-iam-installed-20261107.json' with { type: 'json' };
import bCreateReview from '../ops/deployment-baseline/tenant-b-creation-review.json' with { type: 'json' };
import { compareBindings, compareDeclarations, draftImageUpdate, imageChange, reviewTenantListenerChangeSet } from '../ops/deployment-baseline/review.mjs';

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

test('B fragment changes only two real A2 outputs and retains template plus eighteen parameters',()=>{
  assert.deepEqual(Object.keys(listenerTemplate).sort(),['Parameters','UsePreviousTemplate']);
  assert.equal(listenerTemplate.UsePreviousTemplate,true);
  assert.deepEqual(listenerTemplate.Parameters.map(p=>p.ParameterKey),b.stacks.tenant.parameters);
  for(const p of listenerTemplate.Parameters){
    assert.deepEqual(p,listenerPlan.fragment.changedParameters.includes(p.ParameterKey)?
      {ParameterKey:p.ParameterKey,ParameterValue:a2Executed.cellOutputs[p.ParameterKey]}:
      {ParameterKey:p.ParameterKey,UsePreviousValue:true});
  }
  assert.equal(listenerTemplate.Parameters.filter(p=>p.UsePreviousValue).length,18);
  assert.equal(listenerTemplate.Parameters.find(p=>p.ParameterKey==='ImageUri').UsePreviousValue,true);
});

test('B binds saved observations without renewing them or hiding Service drift and pending IAM checks',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(listenerPlan.sourceCell.resultCanonicalSha256,sha(a2Executed));
  assert.deepEqual(listenerPlan.sourceCell.outputs,a2Executed.cellOutputs);
  assert.equal(listenerPlan.sourceCell.independentlyVerifiedAt,a2Executed.independentlyVerifiedAt);
  assert.equal(listenerPlan.fragment.canonicalSha256,sha(listenerTemplate));
  assert.equal(listenerPlan.archivedTemplate.canonicalSha256,b.stacks.tenant.templateSha256);
  const old=listenerPlan.savedTenantObservation,oldListeners=a2Executed.tenantListenerParametersObservedBeforeExecute;
  assert.equal(old.observedAt,oldListeners.observedAt);
  for(const key of b.cellOutputsToTenantParameters){
    if(listenerPlan.fragment.changedParameters.includes(key)){
      assert.equal(old.sixCrossStackParameters[key],oldListeners[key]);
      assert.notEqual(old.sixCrossStackParameters[key],a2Executed.cellOutputs[key]);
    }else assert.equal(old.sixCrossStackParameters[key],a2Executed.cellOutputs[key]);
  }
  assert.equal(listenerPlan.archivedTemplate.serviceDesiredCount,1);
  assert.deepEqual([old.desiredCount,old.runningCount,old.pendingCount],[0,0,0]);
  assert.equal(old.cfnTaskDefinitionPhysicalIdNotRead,true);
  assert.deepEqual([...listenerPlan.archivedTemplate.serviceDependsOn].sort(),listenerPlan.archivedTemplate.ruleProjection.map(r=>r.logicalId).sort());
  assert.deepEqual(listenerPlan.archivedTemplate.ruleProjection.map(r=>[r.logicalId,r.listenerParameter,r.priority]),[
    ['TenantBusinessControlDenyRule','HttpsListenerArn',100],['TenantControlListenerRule','ControlListenerArn',100],['TenantListenerRule','HttpsListenerArn',101]]);
  for(const key of ['actualServicePreservationNotProved','noAutomaticDesiredCountOrDependsOnFix','noServiceOrTaskDefinitionScopeExpansion'])assert.equal(listenerPlan.serviceGuard[key],true);
  assert.equal(listenerPlan.permissions.currentTenantRoleAndPoliciesNotReadThisPhase,true);
  assert.equal(listenerPlan.permissions.proposedIamWrite,null);
  for(const [field,parameter]of [['businessRuleNamespaceToCheck','HttpsListenerArn'],['controlRuleNamespaceToCheck','ControlListenerArn']]){
    assert.equal(listenerPlan.permissions[field],a2Executed.cellOutputs[parameter].replace(':listener/',':listener-rule/')+'/*');
  }
  assert.equal(listenerPlan.thisPreparation.accountAwsCalls,0);assert.equal(listenerPlan.thisPreparation.executionSlotsConsumed,0);
  for(const key of ['approvalManifestSha256','changeSetId','newLiveFactsAt','startBefore'])assert.equal(listenerPlan[key],null);
  for(const key of ['creationAuthorized','executionAuthorized','liveOwnershipVerified'])assert.equal(listenerPlan[key],false);
});

function syntheticListenerChangeSet(){
  return {StackId:listenerPlan.targetStackId,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',
    Parameters:structuredClone(listenerTemplate.Parameters),
    Changes:listenerPlan.archivedTemplate.ruleProjection.map(r=>({Type:'Resource',ResourceChange:{
      LogicalResourceId:r.logicalId,ResourceType:r.type,Action:'Modify',Replacement:'True',Scope:['Properties'],
      Details:[{Target:{Attribute:'Properties',Name:'ListenerArn',RequiresRecreation:'Always'}}]}}))};
}

test('B three-replacement shape match is never service, parameter preservation, ownership or execution proof',()=>{
  const input=syntheticListenerChangeSet(),saved=structuredClone(input);
  const result=reviewTenantListenerChangeSet(input);
  assert.equal(result.matchesProposedRuleReplacementShape,true);assert.deepEqual(result.differences,[]);
  for(const key of ['unchangedParameterPreservationProved','servicePreservationProved','liveOwnershipVerified','executionAuthorized'])assert.equal(result[key],false);
  assert.deepEqual(input,saved);
});

test('B shape check rejects other resources, conditional replacements, wrong binding and incomplete evidence',()=>{
  const changes=[
    c=>{c.StackId+='-other';},c=>{c.ExecutionStatus='EXECUTE_COMPLETE';},c=>{c.NextToken='next';},
    c=>{c.IncludeNestedStacks=true;},c=>{c.Changes.pop();},
    c=>{c.Changes[0].ResourceChange.LogicalResourceId=c.Changes[1].ResourceChange.LogicalResourceId;},
    c=>{c.Changes[0].ResourceChange.LogicalResourceId='TenantService';c.Changes[0].ResourceChange.ResourceType='AWS::ECS::Service';},
    ...['Add','Remove','Import'].map(action=>c=>{c.Changes[0].ResourceChange.Action=action;}),
    ...['Conditional','False',true].map(replacement=>c=>{c.Changes[0].ResourceChange.Replacement=replacement;}),
    c=>{c.Changes[0].ResourceChange.Scope.push('Tags');},
    c=>{c.Changes[0].ResourceChange.Details[0].Target.Name='Priority';},
    c=>{delete c.Changes[0].ResourceChange.Details;},
    c=>{c.Parameters.find(p=>p.ParameterKey==='HttpsListenerArn').ParameterValue='old';},
    c=>{c.Parameters.push(c.Parameters[0]);},
  ];
  for(const mutate of changes){
    const input=syntheticListenerChangeSet();mutate(input);
    const result=reviewTenantListenerChangeSet(input);
    assert.equal(result.matchesProposedRuleReplacementShape,false);assert.ok(result.differences.length>0);
    assert.equal(result.executionAuthorized,false);
  }
  assert.equal(reviewTenantListenerChangeSet().matchesProposedRuleReplacementShape,false);
});

test('B read-only facts distinguish CFN recorded resources from missing rules and resolve only task-definition drift',()=>{
  assert.equal(bFacts.targetStackId,listenerPlan.targetStackId);
  assert.equal(bFacts.templateSha256,listenerPlan.archivedTemplate.canonicalSha256);
  assert.deepEqual(bFacts.newCellOutputs,a2Executed.cellOutputs);
  assert.equal(bFacts.resourceCount,7);assert.equal(bFacts.cfnRecordedResources.length,7);
  assert.equal(bFacts.cfnResourceCompleteStatusDoesNotProvePhysicalExistence,true);
  assert.ok(bFacts.oldRules.every(x=>x.absent));assert.equal(bFacts.oldRules.length,3);
  for(const r of bFacts.oldRules)assert.equal(bFacts.cfnRecordedResources.find(x=>x.logicalId===r.logicalId).physicalId,r.arn);
  assert.ok(Object.values(bFacts.newRulePriorities).every(x=>x.occupiedRequestedPriorities.length===0));
  assert.deepEqual([bFacts.service.desired,bFacts.service.running,bFacts.service.pending],[0,0,0]);
  assert.equal(bFacts.service.taskDefinitionArn,bFacts.service.cfnTaskDefinitionPhysicalId);
  assert.equal(bFacts.service.taskDefinitionMatchesCfn,true);
  assert.equal(bFacts.service.archivedDesiredCount,1);assert.equal(bFacts.service.serviceDesiredCountDrift,true);
  assert.equal(bFacts.servicePreservationProved,false);assert.equal(bFacts.otherFourCrossStackInputsMatch,true);
  assert.deepEqual(bFacts.pendingChangeSets,[]);assert.equal(bFacts.targetGroup.loadBalancerArns.length,0);
  assert.equal(bFacts.apiDns.unambiguousSimpleAlias,true);assert.equal(bFacts.apiDns.pointsToNewCell,false);
  assert.notEqual(bFacts.apiDns.records[0].AliasTarget.DNSName.replace(/\.$/,''),a2Executed.alb.dnsName);
  assert.deepEqual([bFacts.counts.sts,bFacts.counts.metadata],[1,22]);
  for(const [key,count]of Object.entries(bFacts.counts))if(!['sts','metadata'].includes(key))assert.equal(count,0,key);
  assert.equal(bFacts.effectiveFactsValidBefore,bFacts.reusedA2.dependencyValidBefore);
  assert.ok(Date.parse(bFacts.newReadValidBefore)>Date.parse(bFacts.effectiveFactsValidBefore));
});

test('B IAM candidate adds only two authorization paths; optional Sid removal fits size without other permission changes',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  const restored=structuredClone(bIamPolicy),statement=restored.Statement.find(x=>x.Sid===bIamReview.exactDiff.statementSid);
  assert.equal(restored.Statement.filter(x=>x.Sid===statement.Sid).length,1);
  assert.deepEqual(statement.Action,['elasticloadbalancing:DescribeTags']);
  assert.deepEqual(statement.Resource,[...bFacts.iam.currentRuleDescribeTagsResources,...bFacts.iam.newRuleDescribeTagsResourcesNotCovered]);
  assert.deepEqual(bIamReview.exactDiff.appendResources,[listenerPlan.permissions.businessRuleNamespaceToCheck,listenerPlan.permissions.controlRuleNamespaceToCheck]);
  assert.deepEqual(bIamReview.exactDiff.preserveResources,bFacts.iam.currentRuleDescribeTagsResources);
  statement.Resource=statement.Resource.slice(0,2);
  const removed=bIamReview.exactDiff.removedOptionalStatementIdsForSize;
  assert.equal(removed.length,5);assert.equal(new Set(removed.map(x=>x.index)).size,5);
  for(const x of removed){assert.equal(restored.Statement[x.index].Sid,undefined);restored.Statement[x.index].Sid=x.oldSid;}
  assert.equal(sha(restored),bFacts.iam.policyCanonicalSha256,'reversing two additions and five optional labels exactly restores observed v9');
  assert.equal(sha(restored),bIamReview.policyDocument.previousCanonicalSha256);
  assert.equal(sha(bIamPolicy),bIamReview.policyDocument.canonicalSha256);
  assert.equal(bIamReview.exactDiff.allAuthorizationElementsExceptTwoResourceAdditionsUnchanged,true);
  assert.equal(JSON.stringify(restored).length,bIamReview.sizeCheck.sourceNonWhitespaceCharacters);
  assert.equal(JSON.stringify(bIamPolicy).length,bIamReview.sizeCheck.candidateNonWhitespaceCharacters);
  assert.equal(bIamReview.sizeCheck.candidateNonWhitespaceCharacters,6140);
  assert.ok(bIamReview.sizeCheck.candidateNonWhitespaceCharacters<=bIamReview.sizeCheck.managedPolicyLimit);
  assert.equal(bFacts.iam.attachmentCount,1);assert.equal(bFacts.iam.boundaryUsageCount,1);
  assert.deepEqual(bFacts.iam.attachedPolicyArns,[bFacts.iam.boundaryArn]);assert.deepEqual(bFacts.iam.inlinePolicyNames,[]);
});

test('B IAM review binds exact facts and one new default version without version deletion or tenant deployment authority',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bIamReview.evidence.find(x=>x.file==='tenant-b-preflight-20261107.json').canonicalSha256,sha(bFacts));
  assert.equal(bIamReview.evidence.find(x=>x.file==='cell-a2-executed-20261107.json').canonicalSha256,sha(a2Executed));
  assert.deepEqual(bIamReview.requestWithoutPolicyDocument,{PolicyArn:bFacts.iam.boundaryArn,SetAsDefault:true});
  assert.equal(bIamReview.expected.defaultVersion,'v9');assert.equal(bIamReview.expected.policyId,bFacts.iam.policyId);
  assert.deepEqual(bIamReview.expected.retainedVersions,['v7','v8','v9']);assert.equal(bIamReview.expected.maxExistingVersions,4);
  assert.equal(bIamReview.scope.createPolicyVersionMax,1);assert.equal(bIamReview.scope.setDefaultThroughCreateOnly,true);
  for(const [key,count]of Object.entries(bIamReview.scope))if(!['stsMax','metadataMax','createPolicyVersionMax','setDefaultThroughCreateOnly'].includes(key))assert.equal(count,0,key);
  assert.equal(bIamReview.factsAt,bFacts.factsAt);assert.equal(bIamReview.factsValidBefore,bFacts.effectiveFactsValidBefore);
  assert.equal(Date.parse(bIamReview.factsValidBefore)-Date.parse(bIamReview.startBefore),10*60000);
  for(const key of ['automaticRetry','automaticRollback','automaticVersionDeletion','automaticPermissionRevoke','attemptResetAllowed'])assert.equal(bIamReview.failurePolicy[key],false);
  assert.equal(bIamReview.status,'PREPARED_NOT_APPROVED');
  for(const key of ['installationAuthorized','creationAuthorized','executionAuthorized'])assert.equal(bIamReview[key],false);
  for(const key of ['creationAuthorized','executionAuthorized','iamInstallationAuthorized','apiDnsRepaired','wholeSystemAccepted'])assert.equal(bFacts[key],false);
});

test('B IAM result is one acknowledged version write independently verified, not a tenant deployment',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bIamInstalled.approvedManifestSha256,sha(bIamReview));
  assert.equal(bIamInstalled.status,'B_IAM_MINIMAL_EXTENSION_INDEPENDENTLY_VERIFIED');
  assert.equal(bIamInstalled.policyArn,bIamReview.expected.boundaryArn);assert.equal(bIamInstalled.policyId,bIamReview.expected.policyId);
  assert.equal(bIamInstalled.previousDefaultVersion,'v9');assert.equal(bIamInstalled.installedDefaultVersion,'v10');
  assert.deepEqual(bIamInstalled.retainedVersions,['v7','v8','v9']);assert.deepEqual(bIamInstalled.observedVersionIds,['v7','v8','v9','v10']);
  assert.equal(bIamInstalled.installedPolicyCanonicalSha256,sha(bIamPolicy));assert.equal(bIamInstalled.policyNonWhitespaceCharacters,6140);
  assert.deepEqual(bIamInstalled.authorizationDelta,bIamReview.exactDiff.appendResources.map(resource=>({action:'elasticloadbalancing:DescribeTags',resource})));
  assert.deepEqual(bIamInstalled.removedOptionalSidMapping,bIamReview.exactDiff.removedOptionalStatementIdsForSize);
  assert.deepEqual(bIamInstalled.counts.total,{sts:2,metadata:14,createPolicyVersion:1});
  assert.equal(bIamInstalled.counts.writer.metadata,8);assert.equal(bIamInstalled.counts.independent.metadata,6);
  assert.equal(bIamInstalled.counts.otherDirectAwsWrites,0);assert.equal(bIamInstalled.executionSlotsConsumed,1);
  assert.equal(bIamInstalled.writeAcknowledged,true);assert.equal(bIamInstalled.roleTrustInlineAttachmentBoundaryAndUsageCountsUnchanged,true);
  assert.ok(Date.parse(bIamInstalled.submissionIntentAt)<Date.parse(bIamReview.startBefore));
  assert.ok(Date.parse(bIamInstalled.acknowledgedAt)<Date.parse(bIamInstalled.independentlyVerifiedAt));
  for(const key of ['automaticRetry','automaticRollback','automaticVersionDeletion','automaticRevoke','tenantChangeSetCreated','tenantBindingsRepaired','apiDnsRepaired','ecsOrRdsStarted','imageUpdated','wholeSystemAccepted','tenantCreationAuthorized','tenantExecutionAuthorized'])assert.equal(bIamInstalled[key],false,key);
});

test('B create-only review binds the verified IAM result and pinned fragment without publishing private tags',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  for(const [file,data]of [['tenant-b-preflight-20261107.json',bFacts],['tenant-b-iam-installed-20261107.json',bIamInstalled],['tenant-listener-change.template.json',listenerTemplate]]){
    assert.equal(bCreateReview.evidence.find(x=>x.file===file).canonicalSha256,sha(data));
  }
  const r=bCreateReview.requestWithoutTags;
  assert.equal(r.StackName,bFacts.targetStackId);assert.equal(r.RoleARN,bIamInstalled.roleArn);
  assert.equal(r.UsePreviousTemplate,true);assert.deepEqual(r.Parameters,listenerTemplate.Parameters);
  assert.equal(r.ChangeSetType,'UPDATE');assert.equal(r.IncludeNestedStacks,false);
  assert.equal(r.Tags,undefined);assert.equal(r.TemplateBody,undefined);assert.equal(r.TemplateURL,undefined);assert.equal(r.OnStackFailure,undefined);
  assert.equal(bCreateReview.tagsFromBoundPrivateRecord.journalRawSha256,bFacts.evidence[0].journalRawSha256);
  assert.match(bCreateReview.tagsFromBoundPrivateRecord.canonicalMapSha256,/^[a-f0-9]{64}$/);
  assert.equal(bCreateReview.tagsFromBoundPrivateRecord.preserveAllValuesWithoutPublishingThem,true);
  assert.equal(bCreateReview.expected.policyDefaultVersion,bIamInstalled.installedDefaultVersion);
  assert.equal(bCreateReview.expected.policyCanonicalSha256,bIamInstalled.installedPolicyCanonicalSha256);
  assert.deepEqual(bCreateReview.expected.policyVersionIds,bIamInstalled.observedVersionIds);
  assert.deepEqual(bCreateReview.expected.tenantResourcePhysicalIds,bFacts.cfnRecordedResources);
  assert.deepEqual(bCreateReview.expected.proposedChanges,listenerPlan.archivedTemplate.ruleProjection.map(x=>({logicalId:x.logicalId,type:x.type,action:'Modify',replacement:'True',onlyProperty:'ListenerArn'})));
});

test('B creation approval is separate and cannot execute, change IAM/DNS/service or renew existing facts',()=>{
  assert.equal(bCreateReview.status,'PREPARED_NOT_APPROVED');
  assert.equal(bCreateReview.scope.createChangeSetMax,1);assert.equal(bCreateReview.scope.stsMax,2);
  assert.equal(bCreateReview.scope.metadataReadMax,bCreateReview.scope.writerMetadataMax+bCreateReview.scope.independentMetadataReserve);
  for(const [key,value]of Object.entries(bCreateReview.scope))if(!['stsMax','metadataReadMax','writerMetadataMax','independentMetadataReserve','createChangeSetMax'].includes(key))assert.equal(value,0,key);
  assert.equal(bCreateReview.factsAt,bFacts.factsAt);assert.equal(bCreateReview.factsValidBefore,bFacts.effectiveFactsValidBefore);
  assert.equal(bCreateReview.iamVerifiedAt,bIamInstalled.independentlyVerifiedAt);
  assert.equal(Date.parse(bCreateReview.factsValidBefore)-Date.parse(bCreateReview.startBefore),10*60000);
  for(const key of ['automaticRetry','automaticDeleteChangeSet','automaticExecute','automaticRollback','attemptResetAllowed'])assert.equal(bCreateReview.failurePolicy[key],false,key);
  for(const key of ['creationAuthorized','executionAuthorized','iamChangeAuthorized','apiDnsChangeAuthorized'])assert.equal(bCreateReview[key],false,key);
  assert.equal(bCreateReview.serviceGuard.shapeMatchIsNotFutureExecutionOrServicePreservationProof,true);
  assert.equal(bCreateReview.serviceGuard.unexpectedServiceOrOtherResourceChangeIsNoGo,true);
  assert.equal(bCreateReview.preparation.newAccountAwsCalls,0);assert.equal(bCreateReview.preparation.changeSetsCreated,0);
});
