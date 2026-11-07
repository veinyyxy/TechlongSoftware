// Offline review only. No cloud clients, credentials, processes or write capability.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import baseline from './existing-tenant.template.json' with { type: 'json' };
import imageTemplate from './tenant-image-change.template.json' with { type: 'json' };
import listenerPlan from './tenant-b-offline-plan.json' with { type: 'json' };
import listenerTemplate from './tenant-listener-change.template.json' with { type: 'json' };

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
}

export function compareDeclarations(templates) {
  const differences = [];
  for (const [role, expected] of Object.entries(baseline.stacks)) {
    const t = templates[role];
    if (!t?.Resources) { differences.push(role + ':missing-template'); continue; }
    const resources = Object.fromEntries(Object.entries(t.Resources).map(([id, r]) => [id, r?.Type]));
    for (const id of new Set([...Object.keys(resources), ...Object.keys(expected.resources)])) {
      if (resources[id] !== expected.resources[id]) differences.push(role + ':resource:' + id);
    }
    for (const [field, names] of [['Parameters', expected.parameters], ['Outputs', expected.outputs]]) {
      if (!isDeepStrictEqual(Object.keys(t[field] ?? {}).sort(), names)) differences.push(role + ':' + field);
    }
    const sha = createHash('sha256').update(JSON.stringify(canonical(t))).digest('hex');
    if (sha !== expected.templateSha256) differences.push(role + ':template-content');
  }
  return { matchesHistoricalDeclarations: differences.length === 0, differences,
    liveOwnershipVerified: false, executionAuthorized: false };
}

// Compare only the six public Cell output -> workload parameter links, never NoEcho values.
export function compareBindings({ cellOutputs = {}, tenantParameters = {} } = {}) {
  const differences = [];
  const listener = /^arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener\/app\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{16}\/[a-f0-9]{16}$/;
  const valid = {
    ClusterName: v => v === 'cell-sandbox-1',
    VpcId: v => /^vpc-[a-f0-9]{8,17}$/.test(v),
    TaskSecurityGroupId: v => /^sg-[a-f0-9]{8,17}$/.test(v),
    SubnetIds: v => v.split(',').length === 2 && new Set(v.split(',')).size === 2 && v.split(',').every(x => /^subnet-[a-f0-9]{8,17}$/.test(x)),
    HttpsListenerArn: v => listener.test(v), ControlListenerArn: v => listener.test(v),
  };
  for (const key of baseline.cellOutputsToTenantParameters) {
    const v = cellOutputs[key];
    if (typeof v !== 'string' || !valid[key](v) || v !== tenantParameters[key]) differences.push(key);
  }
  if (!differences.length && (cellOutputs.HttpsListenerArn === cellOutputs.ControlListenerArn ||
    cellOutputs.HttpsListenerArn.split('/')[3] !== cellOutputs.ControlListenerArn.split('/')[3])) differences.push('listener-pair');
  return { matchesSuppliedBindings: differences.length === 0, differences, liveOwnershipVerified: false };
}

export function imageChange(currentImage, proposedImage) {
  const { repository, parameter } = baseline.tenantUpdate;
  for (const image of [currentImage, proposedImage]) {
    if (typeof image !== 'string' || !image.startsWith(repository + '@sha256:') ||
      image.length !== repository.length + 72 || !/^[a-f0-9]{64}$/.test(image.slice(repository.length + 8))) throw Error('EXACT_REPOSITORY_DIGEST_REQUIRED');
  }
  if (currentImage === proposedImage) throw Error('UNCHANGED_IMAGE');
  const expected = baseline.stacks.tenant.parameters.map(ParameterKey => ParameterKey === parameter ?
    { ParameterKey, ParameterValue: '{{reviewedImageUri}}' } : { ParameterKey, UsePreviousValue: true });
  if (!isDeepStrictEqual(imageTemplate, { UsePreviousTemplate: true, Parameters: expected })) throw Error('UPDATE_TEMPLATE_SCOPE_CHANGED');
  const change = structuredClone(imageTemplate);
  change.Parameters.find(p => p.ParameterKey === parameter).ParameterValue = proposedImage;
  return { proposedParameter: { name: parameter, from: currentImage, to: proposedImage },
    unchangedParameters: baseline.stacks.tenant.parameters.filter(k => k !== parameter), changeSetFragment: change };
}

export function draftImageUpdate(templates, bindings, currentImage, proposedImage) {
  if (!compareDeclarations(templates).matchesHistoricalDeclarations) throw Error('DECLARATION_DIFF_REQUIRES_REVIEW');
  if (!compareBindings(bindings).matchesSuppliedBindings) throw Error('CROSS_STACK_BINDING_DIFF');
  return { target: baseline.stacks.tenant.name, ...imageChange(currentImage, proposedImage),
    preserveTemplate: true, liveOwnershipVerified: false, executionAuthorized: false,
    blockers: ['verify-stack-physical-ownership', 'verify-cell-outputs-against-tenant-parameters-and-live-resources',
      'verify-service-revision-and-current-image', 'verify-proposed-ecr-digest', 'review-exact-change-set-and-approval'] };
}

// Shape check only, not an execution gate. DescribeChangeSet does not prove that
// UsePreviousValue was submitted for the other parameters, or preserve ECS drift.
export function reviewTenantListenerChangeSet(changeSet = {}) {
  const differences = [];
  if (changeSet.StackId !== listenerPlan.targetStackId) differences.push('tenant-stack-id');
  if (changeSet.Status !== 'CREATE_COMPLETE' || changeSet.ExecutionStatus !== 'AVAILABLE') differences.push('unexecuted-available-plan');
  if (changeSet.NextToken || changeSet.ParentChangeSetId || changeSet.RootChangeSetId || changeSet.IncludeNestedStacks === true) differences.push('nested-or-incomplete-plan');
  const expectedIds = listenerPlan.archivedTemplate.ruleProjection.map(r => r.logicalId).sort();
  const changes = Array.isArray(changeSet.Changes) ? changeSet.Changes : [];
  if (!isDeepStrictEqual(changes.map(c => c?.ResourceChange?.LogicalResourceId).sort(), expectedIds)) differences.push('exact-three-rules');
  for (const c of changes) {
    const r = c?.ResourceChange;
    if (!r || c.Type !== 'Resource' || r.ResourceType !== 'AWS::ElasticLoadBalancingV2::ListenerRule' ||
      r.Action !== 'Modify' || r.Replacement !== 'True' || r.ChangeSetId) differences.push('rule-replacement-only');
    if (!isDeepStrictEqual(r?.Scope, ['Properties']) || !Array.isArray(r?.Details) || !r.Details.length ||
      r.Details.some(d => d?.Target?.Attribute !== 'Properties' || d.Target.Name !== 'ListenerArn')) differences.push('listener-property-only');
  }
  const parameters = Array.isArray(changeSet.Parameters) ? changeSet.Parameters : [];
  if (!isDeepStrictEqual(parameters.map(p => p?.ParameterKey).sort(), baseline.stacks.tenant.parameters)) differences.push('parameter-names');
  for (const expected of listenerTemplate.Parameters.filter(p => Object.hasOwn(p, 'ParameterValue'))) {
    const actual = parameters.find(p => p?.ParameterKey === expected.ParameterKey);
    if (actual?.ParameterValue !== expected.ParameterValue || actual.UsePreviousValue === true) differences.push('listener-value:' + expected.ParameterKey);
  }
  return { matchesProposedRuleReplacementShape: differences.length === 0, differences: [...new Set(differences)],
    unchangedParameterPreservationProved: false, servicePreservationProved: false,
    liveOwnershipVerified: false, executionAuthorized: false };
}
