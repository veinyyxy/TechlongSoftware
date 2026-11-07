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
import bCreated from '../ops/deployment-baseline/tenant-b-created-20261107.json' with { type: 'json' };
import bExecuteReview from '../ops/deployment-baseline/tenant-b-execution-review.json' with { type: 'json' };
import bExpired from '../ops/deployment-baseline/tenant-b-execution-expired-20261107.json' with { type: 'json' };
import bRefresh from '../ops/deployment-baseline/tenant-b-execution-refresh-20261107.json' with { type: 'json' };
import bRefreshedReview from '../ops/deployment-baseline/tenant-b-execution-review-refreshed-20261107.json' with { type: 'json' };
import bInspected from '../ops/deployment-baseline/tenant-b-execution-inspected-20261107.json' with { type: 'json' };
import bFailureRead from '../ops/deployment-baseline/tenant-b-failed-event-read-scope.json' with { type: 'json' };
import bFailureObserved from '../ops/deployment-baseline/tenant-b-failed-events-observed-20261107.json' with { type: 'json' };
import bRecovery from '../ops/deployment-baseline/tenant-b-recovery-offline-plan.json' with { type: 'json' };
import bRecoveryFacts from '../ops/deployment-baseline/tenant-b-recovery-preflight-20261107.json' with { type: 'json' };
import bRollback from '../ops/deployment-baseline/tenant-b-rollback-review.json' with { type: 'json' };
import bRollbackStop from '../ops/deployment-baseline/tenant-b-rollback-preflight-stopped-20261107.json' with { type: 'json' };
import bRollbackResume from '../ops/deployment-baseline/tenant-b-rollback-resume-review-20261107.json' with { type: 'json' };
import bRolledBack from '../ops/deployment-baseline/tenant-b-rollback-observed-20261107.json' with { type: 'json' };
import bPostRollback from '../ops/deployment-baseline/tenant-b-post-rollback-offline-plan.json' with { type: 'json' };
import bPostRollbackRead from '../ops/deployment-baseline/tenant-b-post-rollback-preflight-20261107.json' with { type: 'json' };
import bPostRollbackCreate from '../ops/deployment-baseline/tenant-b-post-rollback-creation-review-20261107.json' with { type: 'json' };
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

test('B actual created plan has three replacements, while the applied stack and idle service remain unchanged',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bCreated.approvedManifestSha256,sha(bCreateReview));
  assert.equal(bCreated.status,'B_CHANGE_SET_CREATED_VERIFIED_NOT_EXECUTED');
  assert.equal(bCreated.stackId,bCreateReview.requestWithoutTags.StackName);
  assert.ok(bCreated.changeSetId.startsWith('arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+bCreateReview.requestWithoutTags.ChangeSetName+'/'));
  assert.equal(bCreated.changeSetStatus,'CREATE_COMPLETE');assert.equal(bCreated.executionStatus,'AVAILABLE');
  assert.equal(bCreated.observedDeploymentConfig.Mode,'STANDARD');
  assert.deepEqual(bCreated.changes.map(x=>({logicalId:x.logicalId,type:x.type,action:x.action,replacement:x.replacement,onlyProperty:x.changedProperties[0]})),bCreateReview.expected.proposedChanges);
  assert.ok(bCreated.changes.every(x=>x.policyAction==='ReplaceAndDelete'&&x.changedProperties.length===1));
  assert.equal(bCreated.proposedTemplateSha256,bFacts.templateSha256);assert.equal(bCreated.appliedTemplateSha256,bFacts.templateSha256);
  assert.equal(bCreated.submittedPreviousParameterCount,18);assert.equal(bCreated.unchangedReturnedParameterMetadataCompared,true);
  assert.equal(bCreated.requestClientTokenRecorded,bCreateReview.requestWithoutTags.ClientToken);
  assert.equal(bCreated.requestClientTokenVerifiedFromBoundRequest,true);assert.equal(bCreated.describeChangeSetClientTokenEchoed,false);
  assert.equal(bCreated.noEchoValuesReadOrUnmasked,false);
  assert.deepEqual(bCreated.cfnRecordedResources,bFacts.cfnRecordedResources);
  assert.deepEqual([bCreated.service.desired,bCreated.service.running,bCreated.service.pending],[0,0,0]);
  assert.equal(bCreated.service.taskDefinitionArn,bFacts.service.taskDefinitionArn);
  assert.deepEqual(bCreated.counts.total,{sts:2,metadata:24,createChangeSet:1});
  assert.equal(bCreated.counts.writer.metadata,18);assert.equal(bCreated.counts.independent.metadata,6);
  for(const key of ['executeChangeSet','deleteChangeSet','otherDirectAwsWrites'])assert.equal(bCreated.counts[key],0,key);
  assert.equal(bCreated.executionSlotsConsumed,1);assert.equal(bCreated.retainedTagCount,17);
  for(const key of ['executionAuthorized','actualRulesReplaced','tenantBindingsRepaired','apiDnsRepaired','imageUpdated','wholeSystemAccepted','servicePreservationDuringFutureExecutionProved'])assert.equal(bCreated[key],false,key);
});

test('B execution proposal binds this existing ARN and a separately reviewed no-rollback policy without renewing facts',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  for(const [file,data]of [['tenant-b-created-20261107.json',bCreated],['tenant-b-iam-installed-20261107.json',bIamInstalled],['tenant-b-preflight-20261107.json',bFacts]]){
    assert.equal(bExecuteReview.evidence.find(x=>x.file===file).canonicalSha256,sha(data));
  }
  assert.equal(bExecuteReview.request.StackName,bCreated.stackId);assert.equal(bExecuteReview.request.ChangeSetName,bCreated.changeSetId);
  assert.equal(bExecuteReview.request.DisableRollback,true);
  assert.match(bExecuteReview.request.ClientRequestToken,/^tenant-b-execute-[a-f0-9]{32}$/);
  assert.equal(bExecuteReview.expected.currentTemplateSha256,bCreated.appliedTemplateSha256);
  assert.equal(bExecuteReview.expected.proposedTemplateSha256,bCreated.proposedTemplateSha256);
  assert.deepEqual(bExecuteReview.expected.onlyRuleReplacements,bCreated.changes);
  assert.deepEqual(bExecuteReview.expected.retainedLogicalIds,['TenantLogGroup','TenantService','TenantTargetGroup','TenantTaskDefinition']);
  assert.equal(bExecuteReview.dependencyFactsAt,bFacts.factsAt);
  assert.equal(bExecuteReview.dependencyFactsValidBefore,bFacts.effectiveFactsValidBefore);
  assert.equal(Date.parse(bExecuteReview.dependencyFactsValidBefore)-Date.parse(bExecuteReview.startBefore),15*60000);
  assert.equal(bExecuteReview.preparation.newAccountAwsCalls,0);assert.equal(bExecuteReview.preparation.executionSlotsConsumed,0);
});

test('B future execution requires explicit dependent-service risk approval and never silently starts or stops tasks',()=>{
  assert.equal(bExecuteReview.executionAuthorized,false);assert.equal(bExecuteReview.serviceRiskAccepted,false);
  assert.equal(bExecuteReview.serviceRiskDisclosure.requiresExplicitNewApproval,true);
  assert.equal(bExecuteReview.serviceRiskDisclosure.templateDesiredCount,1);
  assert.deepEqual(bExecuteReview.serviceRiskDisclosure.observedDesiredRunningPending,[0,0,0]);
  for(const key of ['cannotGuaranteeZeroServiceCountsAfterExecution','possibleAdditionalComputeOrPublicIpv4Cost','possibleNormalRuntimeSecretAndDatabaseAccessIfTaskStarts','noAutomaticStopOrScaleBack','serviceDeviationMustNotBeReportedAsSuccessfulConvergence'])assert.equal(bExecuteReview.serviceRiskDisclosure[key],true,key);
  assert.equal(bExecuteReview.scope.executeChangeSetMax,1);
  assert.equal(bExecuteReview.scope.metadataReadMax,bExecuteReview.scope.writerMetadataMax+bExecuteReview.scope.independentMetadataReserve);
  for(const [key,value]of Object.entries(bExecuteReview.scope))if(!['stsMax','metadataReadMax','writerMetadataMax','independentMetadataReserve','executeChangeSetMax'].includes(key))assert.equal(value,0,key);
  assert.equal(bExecuteReview.failurePolicy.disableRollback,true);
  for(const key of ['automaticRetry','automaticRollback','automaticCleanup','automaticEcsScaleOrStop','automaticIamRevoke','attemptResetAllowed'])assert.equal(bExecuteReview.failurePolicy[key],false,key);
  assert.ok(bExecuteReview.allowedMetadataApis.includes('cloudformation:ListChangeSets'));
  assert.ok(!bExecuteReview.allowedMetadataApis.includes('cloudformation:DescribeStackEvents'),'no task-definition environment via historical event ResourceProperties');
  assert.equal(bExecuteReview.polling.maxFailureEventReads,0);
});

test('late B risk acceptance cannot restamp an expired manifest or consume an execution slot',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bExpired.manifestCanonicalSha256,sha(bExecuteReview));
  assert.equal(bExpired.startBefore,bExecuteReview.startBefore);
  assert.equal(bExpired.dependencyFactsValidBefore,bExecuteReview.dependencyFactsValidBefore);
  assert.ok(Date.parse(bExpired.checkedAt)>Date.parse(bExpired.dependencyFactsValidBefore));
  assert.equal(bExpired.changeSetId,bCreated.changeSetId);assert.equal(bExpired.stackId,bCreated.stackId);
  assert.equal(bExpired.userExplicitServiceRiskAcceptanceRecorded,true);
  assert.equal(bExpired.userAcceptanceDoesNotExtendExpiredDeadline,true);
  assert.equal(bExpired.currentAwsStateNotQueried,true);assert.equal(bExpired.sourceCredentialValidityNotChecked,true);
  assert.ok(Object.values(bExpired.counts).every(x=>x===0));assert.equal(bExpired.executionPerformed,false);
  assert.equal(bExpired.oldManifestAndFactsUnmodified,true);assert.equal(bExpired.existingChangeSetPreservedByThisTurn,true);
  assert.equal(bExpired.proposedReadOnlyRefresh.approvalRequired,true);
  assert.equal(bExpired.proposedReadOnlyRefresh.newReadFactsValidityHours,5);
  assert.equal(bExpired.proposedReadOnlyRefresh.awsWrites,0);
  assert.equal(bExpired.proposedReadOnlyRefresh.actualExecutionNeedsFreshBoundApproval,true);
});

test('B fresh read capture revalidates the same existing plan and dependencies without recreating or applying it',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bRefresh.status,'B_EXECUTION_REFRESH_VERIFIED_NO_WRITE');
  assert.equal(bRefresh.stackId,bCreated.stackId);assert.equal(bRefresh.changeSetId,bCreated.changeSetId);
  assert.equal(bRefresh.changeSetStatus,'CREATE_COMPLETE');assert.equal(bRefresh.executionStatus,'AVAILABLE');
  assert.equal(bRefresh.availableChangeSetCanonicalSha256,bExecuteReview.expected.availableChangeSetCanonicalSha256);
  assert.equal(bRefresh.oldManifestCanonicalSha256,sha(bExecuteReview));assert.equal(bRefresh.oldExpiredRecordCanonicalSha256,sha(bExpired));
  assert.ok(Date.parse(bRefresh.factsAt)>Date.parse(bExpired.checkedAt));
  assert.equal(Date.parse(bRefresh.factsValidBefore)-Date.parse(bRefresh.factsAt),5*3600000);
  assert.equal(Date.parse(bRefresh.factsValidBefore)-Date.parse(bRefresh.startBefore),15*60000);
  assert.deepEqual(bRefresh.tenantCfnPhysicalRecords,bCreated.cfnRecordedResources);
  assert.deepEqual(bRefresh.summary.serviceCounts,{desired:0,running:0,pending:0});
  assert.equal(bRefresh.summary.serviceTaskDefinition,bCreated.service.taskDefinitionArn);
  assert.equal(bRefresh.cellCfnPhysicalRecords.length,16);assert.deepEqual(bRefresh.summary.cellOutputs,a2Executed.cellOutputs);
  for(const key of ['newRulePrioritiesVacant','threeOldRulesAbsent','networkOwnershipAndIngressMatched','certificateIssued','trustStoreActive'])assert.equal(bRefresh.summary[key],true,key);
  assert.equal(bRefresh.summary.policyDefault,'v10');assert.equal(bRefresh.summary.policyCanonicalSha256,bIamInstalled.installedPolicyCanonicalSha256);
  assert.deepEqual([bRefresh.counts.sts,bRefresh.counts.metadata],[1,28]);
  for(const [key,value]of Object.entries(bRefresh.counts))if(!['sts','metadata'].includes(key))assert.equal(value,0,key);
  assert.equal(bRefresh.executionAuthorized,false);assert.equal(bRefresh.originalManifestUnmodified,true);
});

test('B refreshed approval carries the accepted unchanged risk but still needs a fresh action SHA',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bRefreshedReview.evidence.find(x=>x.file==='tenant-b-execution-refresh-20261107.json').canonicalSha256,sha(bRefresh));
  assert.equal(bRefreshedReview.supersedesExpiredManifest.canonicalSha256,sha(bExecuteReview));
  assert.equal(bRefreshedReview.supersedesExpiredManifest.oldStartBefore,bExecuteReview.startBefore);
  assert.equal(bRefreshedReview.dependencyFactsAt,bRefresh.factsAt);assert.equal(bRefreshedReview.dependencyFactsValidBefore,bRefresh.factsValidBefore);
  assert.equal(bRefreshedReview.startBefore,bRefresh.startBefore);
  assert.deepEqual({...bRefreshedReview.request,ClientRequestToken:undefined},{...bExecuteReview.request,ClientRequestToken:undefined});
  assert.notEqual(bRefreshedReview.request.ClientRequestToken,bExecuteReview.request.ClientRequestToken);
  for(const key of ['scope','failurePolicy','serviceRiskDisclosure','risks','allowedMetadataApis','polling'])assert.deepEqual(bRefreshedReview[key],bExecuteReview[key],key);
  assert.equal(bRefreshedReview.serviceRiskAccepted,true);assert.equal(bRefreshedReview.serviceRiskAcceptanceReference.recordCanonicalSha256,sha(bExpired));
  assert.equal(bRefreshedReview.serviceRiskAcceptanceReference.scopeUnchanged,true);
  assert.equal(bRefreshedReview.serviceRiskAcceptanceReference.doesNotAuthorizeTheNewExecutionWithoutConfirmation,true);
  assert.ok(bRefreshedReview.privateMetadataSources.every(x=>x.journalRawSha256===bRefresh.journalRawSha256&&x.directory===bRefresh.privateEvidenceDirectory));
  assert.equal(bRefreshedReview.executionAuthorized,false);assert.equal(bRefreshedReview.apiDnsChangeAuthorized,false);
  assert.equal(bRefreshedReview.preparation.newAccountAwsCallsDuringManifestAssembly,0);
  assert.equal(bRefreshedReview.preparation.executionSlotsConsumed,0);
});

test('B failed execution is recorded as partial state, never success or an unused retry slot',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bInspected.approvedManifestSha256,sha(bRefreshedReview));
  assert.equal(bInspected.status,'B_EXECUTION_INDEPENDENTLY_INSPECTED_NOT_ACCEPTED');
  assert.equal(bInspected.stackStatus,'UPDATE_FAILED');assert.equal(bInspected.changeSetExecutionStatus,'EXECUTE_FAILED');
  assert.equal(bInspected.effectiveDisableRollback,true);assert.equal(bInspected.executeAcknowledged,true);
  assert.equal(bInspected.listenerParametersChangedDespiteFailure,true);
  assert.deepEqual(bInspected.listenerParametersNow,bRefreshedReview.expected.newListenerParameters);
  assert.equal(bInspected.newTenantRulesVerifiedAfterOperation,0);assert.equal(bInspected.ruleReferencesStillOld,true);
  assert.equal(bInspected.resourceLevelRecoveryObserved.length,3);
  assert.ok(bInspected.cfnResourceRecords.filter(x=>bRefreshedReview.expected.onlyRuleReplacements.some(y=>y.logicalId===x.logicalId)).every(x=>x.status==='UPDATE_ROLLBACK_COMPLETE'));
  assert.equal(bInspected.retainedFourPhysicalIdsUnchanged,true);
  assert.deepEqual([bInspected.service.desired,bInspected.service.running,bInspected.service.pending],[0,0,0]);
  assert.equal(bInspected.service.taskDefinitionArn,bCreated.service.taskDefinitionArn);
  assert.deepEqual(bInspected.targetGroupAlbAssociations,[]);
  assert.equal(bInspected.currentPolicyDefault,'v10');assert.equal(bInspected.currentPolicyCanonicalSha256,bIamInstalled.installedPolicyCanonicalSha256);
  assert.deepEqual(bInspected.counts.total,{sts:2,metadata:36,executeChangeSet:1});
  assert.equal(bInspected.counts.otherDirectAwsWrites,0);assert.equal(bInspected.executionSlotsConsumed,1);
  assert.equal(bInspected.executionApprovalConsumed,true);assert.equal(bInspected.initialFailureCauseProved,false);
  for(const key of ['repeatExecutionAuthorized','automaticRetry','agentRollbackRequested','agentCleanupOrStopPerformed','tenantBindingsRepaired','apiDnsRepaired','imageUpdated','wholeSystemAccepted'])assert.equal(bInspected[key],false,key);
});

test('B failed-event followup needs separate narrow read permission and excludes persisted ResourceProperties',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bFailureRead.parentResultCanonicalSha256,sha(bInspected));
  assert.equal(bFailureRead.request.OperationId,bInspected.operationId);assert.deepEqual(bFailureRead.request.Filters,{FailedEvents:true});
  assert.equal(bFailureRead.operation,'cloudformation:DescribeEvents');
  assert.ok(!bRefreshedReview.allowedMetadataApis.includes(bFailureRead.operation),'do not use spare execution budget for an unapproved API');
  assert.equal(bFailureRead.status,'PROPOSED_NOT_APPROVED');assert.equal(bFailureRead.stsMax,1);assert.equal(bFailureRead.metadataMax,1);
  assert.equal(bFailureRead.followNextToken,false);assert.deepEqual(bFailureRead.excludedFields,['ResourceProperties']);
  assert.ok(!bFailureRead.projectedEventFields.includes('ResourceProperties'));
  assert.equal(bFailureRead.rawEventPropertiesMayEnterAwsCliMemory,true);assert.equal(bFailureRead.rawResourcePropertiesNotSavedOrPrinted,true);
  for(const key of ['unfilteredDescribeStackEvents','taskDefinitionApiReads','secretValueReads','privateKeyReads','configSecretFileReads','databaseConnections','awsWrites','executionSlotsConsumed'])assert.equal(bFailureRead[key],0,key);
  assert.equal(bFailureRead.executionAuthorized,false);assert.equal(bFailureRead.automaticRepair,false);
});

test('B recovery is an offline proposal bound to a real prior stable state and this failed operation, never a replay',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  const evidence={'tenant-b-preflight-20261107.json':bFacts,'tenant-b-created-20261107.json':bCreated,'tenant-b-execution-inspected-20261107.json':bInspected,'tenant-b-failed-events-observed-20261107.json':bFailureObserved};
  for(const e of bRecovery.evidence)assert.equal(e.canonicalSha256,sha(evidence[e.file]));
  assert.equal(bRecovery.targetStackId,bInspected.stackId);assert.equal(bCreated.stackId,bRecovery.targetStackId);
  assert.equal(bRecovery.historicalStableState.stackStatus,bCreated.appliedStackStatus);assert.equal(bCreated.appliedStackStatus,'CREATE_COMPLETE');
  assert.equal(bRecovery.historicalStableState.observedAt,bCreated.independentlyVerifiedAt);
  assert.equal(bRecovery.historicalStableState.templateCanonicalSha256,bInspected.appliedTemplateSha256);
  assert.equal(bRecovery.status,'OFFLINE_PROPOSAL_NOT_EXECUTABLE');assert.equal(bRecovery.recoveryManifestSha256,null);
  assert.equal(bRecovery.newReadsAuthorized,false);assert.equal(bRecovery.executionAuthorized,false);
  assert.ok(Object.values(bRecovery.thisOfflinePhase).every(x=>x===0));
  const [rollback,create,execute]=bRecovery.proposedSequence;
  assert.equal(rollback.api,'cloudformation:RollbackStack');assert.equal(rollback.requiredStartingStatus,'UPDATE_FAILED');
  assert.equal(rollback.requiredFailedOperationId,bFailureObserved.operationId);
  assert.equal(rollback.wholeTenantStackOperationNotThreeRuleChangeSet,true);assert.equal(rollback.stableStateProofRequiredBeforeWrite,true);
  assert.equal(rollback.noStableStateCanDeleteStack,true);assert.equal(rollback.clientRequestToken,null);
  assert.equal(create.requiresIndependentlyVerifiedStableRollback,true);assert.equal(create.newChangeSetArn,null);
  assert.equal(execute.disableRollback,false);assert.equal(execute.onStackFailureMustNotBeSpecifiedAtCreation,true);
  assert.equal(execute.replayConsumedExecution,false);assert.ok(bRecovery.proposedSequence.every(x=>x.authorized===false&&x.maxWritesAfterSeparateApproval===1));
});

test('B recovery preserves dependent-service risks and proposes only nine metadata reads, not recovery permission',()=>{
  const p=bRecovery.proposedNextReadOnlyPreparation,r=bRecovery.retentionAndRisks;
  assert.equal(p.stsMax,1);assert.equal(p.metadataMax,9);assert.equal(p.calls.reduce((n,x)=>n+x.count,0),9);
  assert.ok(p.calls.every(x=>/:(Describe|Get|List)/.test(x.api)));assert.equal(p.authorized,false);
  assert.equal(p.readPermitDoesNotAuthorizeRollback,true);assert.equal(p.freshFactsAt,null);assert.equal(p.freshFactsValidBefore,null);
  assert.equal(p.maxSnapshotAgeHours,5);assert.equal(p.noPaginationRetryOrExtraDiagnostic,true);
  assert.deepEqual([...r.retainedLogicalIds].sort(),bInspected.cfnResourceRecords.filter(x=>!x.logicalId.endsWith('Rule')).map(x=>x.logicalId).sort());
  assert.equal(r.templateDesiredCount,1);assert.equal(r.dependentServiceMayBeReconciledOrRun,true);
  assert.equal(r.providerMayDeleteNewResourcesDuringRollback,true);assert.equal(r.missingOldResourcesCanCauseRollbackFailure,true);
  assert.equal(r.automaticContinueUpdateRollback,false);assert.deepEqual(r.resourcesToSkip,[]);assert.equal(r.automaticCleanupOrCompensation,false);
});

test('B recovery read result is nine new metadata observations, never a rollback approval or live rule proof',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bRecoveryFacts.proposalCanonicalSha256,sha(bRecovery));
  assert.equal(bRecoveryFacts.status,'RECOVERY_READONLY_MATCHED_NO_WRITE');assert.deepEqual(bRecoveryFacts.counts,{sts:1,metadata:9});
  assert.equal(bRecoveryFacts.stackId,bInspected.stackId);assert.equal(bRecoveryFacts.failedOperationId,bInspected.operationId);
  assert.equal(bRecoveryFacts.stackStatus,'UPDATE_FAILED');assert.equal(bRecoveryFacts.originalTemplateCanonicalSha256,bInspected.appliedTemplateSha256);
  assert.equal(Date.parse(bRecoveryFacts.factsValidBefore)-Date.parse(bRecoveryFacts.factsAt),5*3600000);
  assert.equal(Date.parse(bRecoveryFacts.factsValidBefore)-Date.parse(bRecoveryFacts.startBefore),15*60000);
  assert.ok(Date.parse(bRecoveryFacts.factsAt)>Date.parse(bFailureObserved.finishedAt));
  assert.deepEqual(bRecoveryFacts.service,bInspected.service);assert.equal(bRecoveryFacts.policyDefaultVersion,'v10');
  for(const key of ['awsWrites','secretValueReads','privateKeyReads','configSecretFileReads','databaseConnections','executionSlotsConsumed'])assert.equal(bRecoveryFacts[key],0,key);
  for(const key of ['rollbackAuthorized','sourceRollbackPermissionProved','cellOrLiveRuleEntitiesRefreshed','noEchoSecretValuesVerified'])assert.equal(bRecoveryFacts[key],false,key);
  assert.equal(bRecoveryFacts.originalTemplateBodyNotPersisted,true);
});

test('B rollback proposal binds one exact request and current facts without unsupported flags or new change sets',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  const evidence={'tenant-b-recovery-preflight-20261107.json':bRecoveryFacts,'tenant-b-recovery-offline-plan.json':bRecovery,'tenant-b-created-20261107.json':bCreated,'tenant-b-execution-inspected-20261107.json':bInspected,'tenant-b-creation-review.json':bCreateReview};
  for(const e of bRollback.evidence)assert.equal(e.canonicalSha256,sha(evidence[e.file]));
  assert.deepEqual(Object.keys(bRollback.request).sort(),['ClientRequestToken','RetainExceptOnCreate','RoleARN','StackName']);
  assert.equal(bRollback.request.StackName,bRecoveryFacts.stackId);assert.equal(bRollback.request.RoleARN,bRecoveryFacts.roleArn);
  assert.equal(bRollback.request.RetainExceptOnCreate,false);assert.match(bRollback.request.ClientRequestToken,/^tenant-b-rollback-[a-f0-9]{32}$/);
  assert.notEqual(bRollback.request.ClientRequestToken,bInspected.clientRequestToken);
  for(const key of ['factsAt','factsValidBefore','startBefore'])assert.equal(bRollback[key],bRecoveryFacts[key]);
  assert.equal(bRollback.scope.rollbackStackMax,1);assert.equal(bRollback.status,'PREPARED_NOT_APPROVED');
  assert.equal(bRollback.operation,'cloudformation:RollbackStack');
  assert.equal(bRollback.executionAuthorized,false);assert.equal(bRollback.newChangeSetAuthorized,false);
  assert.equal(bRollback.expected.postRollbackStackStatus,'UPDATE_ROLLBACK_COMPLETE');
  assert.equal(bRollback.expected.postRollbackDisableRollbackMayRemainTrue,true);
  assert.equal(bRollback.expected.liveRuleEntityRestorationProvedByThisOperation,false);
});

test('B rollback permits only bounded preflight, status polls and independent reads; no retry, skip or compensation',()=>{
  assert.equal(bRollback.scopeAppliesToDirectOperatorCalls,true);
  assert.equal(bRollback.scope.directSecretValueReads,0);assert.equal(bRollback.scope.directDatabaseConnections,0);
  assert.equal(bRollback.scope.stsMax,2);assert.equal(bRollback.scope.metadataMax,30);
  assert.equal(bRollback.scope.writerPreflightMetadataMax+bRollback.scope.writerStackStatusPollMax+bRollback.scope.independentMetadataMax,30);
  assert.deepEqual(bRollback.allowedMetadataApis,bRecovery.proposedNextReadOnlyPreparation.calls.map(x=>x.api));
  for(const [key,value] of Object.entries(bRollback.scope))if(!['stsMax','metadataMax','writerPreflightMetadataMax','writerStackStatusPollMax','independentMetadataMax','rollbackStackMax'].includes(key))assert.equal(value,0,key);
  for(const key of ['automaticWriteRetry','automaticContinueUpdateRollback','automaticCleanupOrCompensation','replayConsumedExecution','attemptResetAllowed','sourceWritePermissionProved'])assert.equal(bRollback.failurePolicy[key],false,key);
  assert.deepEqual(bRollback.failurePolicy.resourcesToSkip,[]);assert.equal(bRollback.failurePolicy.unknownSubmissionRequiresIndependentRead,true);
  assert.equal(bRollback.failurePolicy.cloudFormationProviderRollbackActionsAreNotLimitedToOneApiCall,true);
});

test('B credential stop retains a failed Source attempt without pretending rollback or slot consumption',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bRollbackStop.manifestCanonicalSha256,sha(bRollback));
  assert.equal(bRollbackStop.status,'CREDENTIALS_UNAVAILABLE_NO_ROLLBACK_SUBMISSION');
  assert.deepEqual(bRollbackStop.counts,{sts:1,metadata:0,rollbackStack:0});
  assert.equal(bRollbackStop.code,'CREDENTIALS_UNAVAILABLE');assert.equal(bRollbackStop.userExplicitConfirmationRecorded,true);
  for(const key of ['rollbackRequestSubmitted','submissionIntentPresent','newIdentityVerified','newResourceFactsObtained','automaticRetry','automaticCompensation'])assert.equal(bRollbackStop[key],false,key);
  assert.equal(bRollbackStop.executionSlotsConsumed,0);assert.equal(bRollbackStop.earlierAmbiguousCommandLaunched,false);
});

test('B resume needs new approval and counts the stopped STS without changing the never-submitted request or deadlines',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bRollbackResume.evidence.find(x=>x.file==='tenant-b-rollback-preflight-stopped-20261107.json').canonicalSha256,sha(bRollbackStop));
  assert.equal(bRollbackResume.resumeOf.manifestCanonicalSha256,sha(bRollback));
  assert.deepEqual(bRollbackResume.resumeOf.priorCounts,bRollbackStop.counts);
  assert.deepEqual(bRollbackResume.request,bRollback.request);assert.deepEqual(bRollbackResume.expected,bRollback.expected);
  assert.deepEqual(bRollbackResume.allowedMetadataApis,bRollback.allowedMetadataApis);
  assert.deepEqual(bRollbackResume.failurePolicy,bRollback.failurePolicy);
  assert.deepEqual(bRollbackResume.scope,{...bRollback.scope,stsMax:3});
  assert.equal(bRollbackResume.scope.stsMax,bRollbackStop.counts.sts+2);
  for(const key of ['factsAt','factsValidBefore','startBefore'])assert.equal(bRollbackResume[key],bRollback[key]);
  assert.notEqual(bRollbackResume.executionEvidenceDirectory,bRollback.executionEvidenceDirectory);
  assert.equal(bRollbackResume.resumeOf.oldEvidenceAndRecipePreserved,true);
  assert.equal(bRollbackResume.status,'PREPARED_NOT_APPROVED');assert.equal(bRollbackResume.executionAuthorized,false);
  assert.equal(bRollbackResume.newChangeSetAuthorized,false);
});

test('B actual rollback restores only reviewed CFN control state and counts a, b and independent calls without authorizing next B',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  assert.equal(bRolledBack.approvedManifestCanonicalSha256,sha(bRollbackResume));
  assert.equal(bRolledBack.stackId,bRollbackResume.request.StackName);assert.equal(bRolledBack.clientRequestToken,bRollbackResume.request.ClientRequestToken);
  assert.equal(bRolledBack.status,'ROLLBACK_CONTROL_STATE_INDEPENDENTLY_VERIFIED');assert.equal(bRolledBack.stackStatus,'UPDATE_ROLLBACK_COMPLETE');
  assert.equal(bRolledBack.operationType,'ROLLBACK');assert.equal(bRolledBack.disableRollbackObserved,true);
  assert.deepEqual(bRolledBack.listenerParametersRestoredTo,bRecovery.historicalStableState.listenerParameters);
  assert.equal(bRolledBack.originalTemplateCanonicalSha256,bInspected.appliedTemplateSha256);
  assert.deepEqual(bRolledBack.service,bRecoveryFacts.service);assert.equal(bRolledBack.allSevenRecordedPhysicalIdsUnchanged,true);
  assert.equal(bRolledBack.policyDefaultVersion,'v10');assert.equal(bRolledBack.policyCanonicalSha256,bRecoveryFacts.policyCanonicalSha256);
  assert.deepEqual(bRolledBack.counts.aggregate,{sts:3,metadata:20,rollbackStack:1});assert.deepEqual(bRolledBack.counts.priorStoppedA,bRollbackStop.counts);
  for(const key of ['sts','metadata','rollbackStack'])assert.equal(bRolledBack.counts.aggregate[key],bRolledBack.counts.priorStoppedA[key]+bRolledBack.counts.writerB[key]+bRolledBack.counts.independent[key]);
  assert.equal(bRolledBack.executionSlotsConsumed,1);assert.equal(bRolledBack.executionApprovalConsumed,true);assert.equal(bRolledBack.counts.otherDirectAwsWrites,0);
  for(const key of ['repeatExecutionAuthorized','automaticRetry','automaticCleanupOrCompensation','newChangeSetCreated','newChangeSetAuthorized','dnsUpdated','imageUpdated','noEchoSecretValuesVerified','liveRuleEntitiesRead','transientRuntimeHistoryRead','listenerOwnershipConvergenceVerified','apiRestorationVerified','wholeSystemAccepted'])assert.equal(bRolledBack[key],false,key);
  assert.deepEqual(bRolledBack.differences,[]);
});

test('new offline B binds actual restored control state without restamping older Cell facts or replaying a request',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  const evidence={'tenant-b-rollback-observed-20261107.json':bRolledBack,'tenant-b-execution-inspected-20261107.json':bInspected,
    'tenant-b-execution-refresh-20261107.json':bRefresh,'tenant-b-offline-plan.json':listenerPlan,'tenant-listener-change.template.json':listenerTemplate};
  for(const e of bPostRollback.evidence)assert.equal(e.canonicalSha256,sha(evidence[e.file]));
  assert.equal(bPostRollback.targetStackId,bRolledBack.stackId);
  const s=bPostRollback.savedStartingState,c=bPostRollback.savedCellCandidate;
  assert.equal(s.observedAt,bRolledBack.independentlyVerifiedAt);assert.equal(s.stackStatus,'UPDATE_ROLLBACK_COMPLETE');
  assert.equal(s.operationId,bRolledBack.operationId);assert.equal(s.operationType,'ROLLBACK');assert.equal(s.disableRollbackObserved,true);
  assert.deepEqual(s.listenerParameters,bRolledBack.listenerParametersRestoredTo);
  assert.equal(s.originalTemplateCanonicalSha256,bRolledBack.originalTemplateCanonicalSha256);
  assert.equal(s.policyCanonicalSha256,bRolledBack.policyCanonicalSha256);assert.equal(s.liveRuleEntityExistenceProved,false);
  for(const k of ['factsAt','factsValidBefore'])assert.equal(c[k],bRefresh[k]);
  assert.ok(Date.parse(c.factsAt)<Date.parse(s.observedAt));assert.equal(c.tenantRollbackDoesNotRefreshCellFacts,true);
  for(const [key,value]of Object.entries(c.listenerParameters))assert.equal(value,bRefresh.summary.cellOutputs[key]);
  assert.equal(c.currentOwnershipOrPriorityVacancyProved,false);assert.equal(c.valuesMustMatchSeparatelyApprovedCurrentCellCheck,true);
  assert.equal(bPostRollback.noReplay.failedChangeSetId,bInspected.changeSetId);
  assert.equal(bPostRollback.noReplay.consumedRollbackToken,bRolledBack.clientRequestToken);
  assert.equal(bPostRollback.noReplay.reuseOldApprovalOrSpareBudget,false);assert.equal(bPostRollback.noReplay.resetAttemptSlot,false);
});

test('new offline B retains the original two-parameter fragment, three-rule shape and four other physical IDs',()=>{
  const c=bPostRollback.creationContract,r=bPostRollback.requiredChangeSetShape,g=bPostRollback.serviceGuard;
  assert.equal(c.usePreviousTemplate,true);assert.equal(c.changeSetType,'UPDATE');assert.equal(c.includeNestedStacks,false);
  assert.equal(c.parametersFragmentFile,'tenant-listener-change.template.json');assert.equal(c.unchangedParameterCount,18);
  assert.deepEqual(c.changedParameters,listenerTemplate.Parameters.filter(p=>Object.hasOwn(p,'ParameterValue')).map(p=>p.ParameterKey));
  for(const p of listenerTemplate.Parameters)assert.deepEqual(p,Object.hasOwn(bPostRollback.savedCellCandidate.listenerParameters,p.ParameterKey)?
    {ParameterKey:p.ParameterKey,ParameterValue:bPostRollback.savedCellCandidate.listenerParameters[p.ParameterKey]}:{ParameterKey:p.ParameterKey,UsePreviousValue:true});
  assert.equal(c.imageUriUsesPreviousValue,true);assert.equal(c.preserveExistingRoleAndTags,true);
  assert.deepEqual(r.rules,listenerPlan.archivedTemplate.ruleProjection.map(x=>({logicalId:x.logicalId,listenerParameter:x.listenerParameter,priority:x.priority})));
  assert.deepEqual([r.modifyCount,r.addCount,r.removeCount,r.importCount],[3,0,0,0]);assert.equal(r.eachRuleReplacement,'True');assert.equal(r.onlyProperty,'ListenerArn');
  assert.equal(r.shapeMatchIsNotParameterPreservationOwnershipOrExecutionProof,true);
  assert.deepEqual(bPostRollback.retainedResources,Object.fromEntries(bInspected.cfnResourceRecords.filter(x=>!x.logicalId.endsWith('Rule')).map(x=>[x.logicalId,x.physicalId])));
  assert.equal(g.templateDesiredCount,1);assert.deepEqual(g.observedCounts,{desired:0,running:0,pending:0});
  assert.equal(g.observedTaskDefinitionArn,bRolledBack.service.taskDefinitionArn);assert.deepEqual(g.unchangedDependsOn,listenerPlan.archivedTemplate.serviceDependsOn);
  assert.equal(g.futureDependentServiceReconciliationOrTaskStartCannotBeExcluded,true);assert.equal(g.futureRuntimeMayReadManagedSecretsAndWriteDatabase,true);
  assert.equal(g.automaticDesiredCountOrDependsOnFix,false);assert.equal(g.directServiceStartAuthorized,false);
});

test('new B material is not executable or authorized; future replacements require explicit normal rollback',()=>{
  const c=bPostRollback.creationContract,f=bPostRollback.futureExecutionPolicy;
  assert.equal(bPostRollback.status,'OFFLINE_DRAFT_NOT_EXECUTABLE');assert.equal(c.maxWritesAfterSeparateApproval,1);
  assert.equal(c.executeChangeSetMax,0);assert.equal(c.deleteChangeSetOrStackMax,0);assert.equal(c.omitOnStackFailure,true);
  assert.equal(c.changeSetName,null);assert.equal(c.clientToken,null);assert.equal(c.requestIsCompleteOrExecutable,false);
  assert.equal(f.disableRollback,false);assert.equal(f.mustBeExplicitNotInferredFromStackOrSdkDefault,true);assert.equal(f.requiresSeparateExactChangeSetApproval,true);
  assert.equal(f.providerAutomaticRollbackMayDeleteReplacementRulesOrReconcileDependents,true);assert.equal(f.missingOldRulesCanCauseUpdateOrRollbackFailure,true);
  for(const key of ['automaticWriteRetryOrContinueUpdateRollback','automaticResourceSkipOrCleanup','executionAuthorized'])assert.equal(f[key],false,key);
  for(const key of ['cloudReadAuthorized','creationAuthorized','executionAuthorized','iamDnsImageServiceOrDatabaseChangesAuthorized'])assert.equal(bPostRollback[key],false,key);
  for(const key of ['approvalManifestSha256','changeSetId'])assert.equal(bPostRollback[key],null,key);
  for(const key of ['newLiveFactsAt','newFactsValidBefore','startBefore'])assert.equal(bPostRollback.factPolicy[key],null,key);
  assert.equal(bPostRollback.factPolicy.maxNewSnapshotAgeHours,5);
  for(const [key,value]of Object.entries(bPostRollback.thisPreparation))assert.equal(value,key==='newRuntimeOrRecoveryFramework'?false:0,key);
});

test('post-rollback fresh read binds actual stable tenant and Cell without writes or restamped old facts',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  const r=bPostRollbackRead,s=r.summary;
  assert.equal(r.offlineDraftCanonicalSha256,sha(bPostRollback));assert.equal(r.status,'POST_ROLLBACK_READONLY_MATCHED_NO_WRITE');
  assert.equal(r.userReadApprovalRecorded,true);assert.deepEqual(r.counts,{sts:1,metadata:27});
  assert.ok(Date.parse(r.factsAt)>Date.parse(bRolledBack.independentlyVerifiedAt));assert.ok(Date.parse(r.factsAt)>Date.parse(bRefresh.factsValidBefore));
  assert.equal(Date.parse(r.factsValidBefore)-Date.parse(r.factsAt),5*3600000);assert.equal(Date.parse(r.factsValidBefore)-Date.parse(r.startBefore),15*60000);
  assert.equal(s.stackId,bRolledBack.stackId);assert.equal(s.stackStatus,'UPDATE_ROLLBACK_COMPLETE');assert.equal(s.operationId,bRolledBack.operationId);
  assert.equal(s.disableRollbackObserved,true);assert.equal(s.tenantTemplateCanonicalSha256,bRolledBack.originalTemplateCanonicalSha256);
  assert.equal(s.cellTemplateCanonicalSha256,a2Executed.appliedTemplateSha256);assert.deepEqual(s.cellOutputs,a2Executed.cellOutputs);
  assert.deepEqual(s.tenantListenerParameters,bRolledBack.listenerParametersRestoredTo);assert.deepEqual(s.service,bRolledBack.service);
  assert.equal(s.policyDefaultVersion,'v10');assert.equal(s.policyCanonicalSha256,bRolledBack.policyCanonicalSha256);
  assert.equal(s.requiredPrioritiesVacant,true);assert.equal(s.threeOldRulesAbsent,true);assert.equal(s.listenerOwnershipTlsMtlsNetworkMatched,true);
  assert.equal(r.tenantCfnPhysicalRecords.length,7);assert.deepEqual(r.tenantCfnPhysicalRecords.map(x=>x.physicalId).sort(),bInspected.cfnResourceRecords.map(x=>x.physicalId).sort());
  for(const key of ['awsWrites','secretValueReads','privateKeyReads','configSecretFileReads','databaseConnections','executionSlotsConsumed'])assert.equal(r[key],0,key);
  for(const key of ['creationAuthorized','executionAuthorized','dnsOrImageUpdated','wholeSystemAccepted'])assert.equal(r[key],false,key);
  assert.equal(s.noEchoSecretValuesVerified,false);assert.equal(s.sourceWritePermissionProved,false);assert.equal(r.originalTemplateBodyNotPersisted,true);
});

test('new create-only review binds fresh facts and an unused request while keeping future normal rollback separate',()=>{
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
  const a=bPostRollbackCreate,r=a.requestWithoutTags;
  const evidence={'tenant-b-post-rollback-preflight-20261107.json':bPostRollbackRead,'tenant-b-post-rollback-offline-plan.json':bPostRollback,
    'tenant-b-rollback-observed-20261107.json':bRolledBack,'tenant-listener-change.template.json':listenerTemplate};
  for(const e of a.evidence)assert.equal(e.canonicalSha256,sha(evidence[e.file]));
  assert.equal(a.status,'PREPARED_NOT_APPROVED');for(const key of ['factsAt','factsValidBefore','startBefore'])assert.equal(a[key],bPostRollbackRead[key]);
  assert.equal(r.StackName,bRolledBack.stackId);assert.equal(r.RoleARN,bPostRollback.executionRoleArn);assert.equal(r.ChangeSetType,'UPDATE');
  assert.equal(r.UsePreviousTemplate,true);assert.equal(r.IncludeNestedStacks,false);assert.deepEqual(r.Parameters,listenerTemplate.Parameters);
  for(const key of ['TemplateBody','TemplateURL','OnStackFailure','DisableRollback'])assert.ok(!Object.hasOwn(r,key));
  assert.notEqual(r.ChangeSetName,bCreateReview.requestWithoutTags.ChangeSetName);assert.notEqual(r.ClientToken,bCreateReview.requestWithoutTags.ClientToken);
  assert.equal(a.tagsFromBoundPrivateRecord.directory,bPostRollbackRead.privateEvidenceDirectory);assert.equal(a.tagsFromBoundPrivateRecord.journalRawSha256,bPostRollbackRead.journalRawSha256);
  assert.equal(a.tagsFromBoundPrivateRecord.canonicalMapSha256,bPostRollbackRead.summary.tenantTagsCanonicalSha256);
  assert.equal(a.expected.tenantRootStatus,'UPDATE_ROLLBACK_COMPLETE');assert.deepEqual(a.expected.tenantResourcePhysicalIds,bPostRollbackRead.tenantCfnPhysicalRecords);
  assert.equal(a.expected.policyDefaultVersion,'v10');assert.equal(a.scope.stsMax,2);assert.equal(a.scope.createChangeSetMax,1);
  assert.equal(a.scope.writerPreflightMetadataMax+a.scope.writerChangeSetStatusPollMax,a.scope.writerMetadataMax);
  assert.equal(a.scope.writerMetadataMax+a.scope.independentMetadataReserve,a.scope.metadataReadMax);assert.equal(a.scope.metadataReadMax,31);
  for(const schedule of [...a.writerReadSchedule,a.independentReadSchedule])assert.equal(Object.values(schedule.calls).reduce((sum,n)=>sum+n,0),schedule.metadataMax);
  assert.equal(a.allowedMetadataApis.includes('iam:ListPolicyVersions'),false);assert.equal(a.futureExecutionPolicy.disableRollback,false);
  for(const key of ['creationAuthorized','executionAuthorized','iamChangeAuthorized','apiDnsChangeAuthorized'])assert.equal(a[key],false,key);
  for(const key of ['automaticRetry','replayAfterUnknownSubmission','automaticDeleteChangeSet','automaticExecute','automaticRollback','attemptResetAllowed'])assert.equal(a.failurePolicy[key],false,key);
  assert.equal(a.preparation.additionalAwsCallsToAssembleManifest,0);assert.equal(a.preparation.changeSetsCreated,0);
});
