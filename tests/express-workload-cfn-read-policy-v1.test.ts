import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileExpressCfnReadPolicyV1, EXPRESS_CFN_READ_POLICY_V1 as K, assertExpressCfnReadInventoryV1,
  expressCfnReadInventoryIdentityV1, prepareExpressCfnReadPolicyReviewV1, assertExpressCfnReadPolicyApprovalV1,
  type ExpressCfnReadInventoryV1 } from '../lib/deployments/execution/express-workload-cfn-read-policy-v1.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';
const now = Date.parse('2026-10-15T15:50:00Z');
const baseline = { Version: '2012-10-17', Statement: [{ Sid: 'HistoricalUnchanged', Effect: 'Allow', Action: 'iam:GetRole', Resource: K.roleArn }] };
const trust = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: 'cloudformation.amazonaws.com' } }] };
function inventory(): ExpressCfnReadInventoryV1 {
  const consumers = { roles: [{ name: K.roleName, id: K.roleId }], users: [], groups: [] };
  return { observedAt: now - 1000, source: { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
    role: { arn: K.roleArn, id: K.roleId, boundaryArn: K.policyArn, trust, inlineNames: [], attached: [K.policyArn] },
    policy: { arn: K.policyArn, id: K.policyId, defaultVersion: 'v7', document: structuredClone(baseline), versions: [{ id: 'v7', isDefault: true }],
      boundaryConsumers: structuredClone(consumers), permissionConsumers: structuredClone(consumers) } };
}
async function manifest() { return prepareExpressCfnReadPolicyReviewV1({ candidate: await compileExpressCfnReadPolicyV1(baseline), facts: inventory(),
  expectedTrust: trust, baselineDocumentSha256: await sha256Hex(baseline), codeBindingSha256: 'a'.repeat(64), providerEvidenceSha256: 'b'.repeat(64), now }); }

test('read patch preserves every historical statement and appends only six exact regional statements/eight actions', async () => {
  const p = await compileExpressCfnReadPolicyV1(baseline);
  assert.equal(p.additions.length, 6); assert.equal(p.newUniqueActions.length, 8);
  assert.deepEqual(p.document.Statement.slice(0, baseline.Statement.length), baseline.Statement);
  assert.equal(p.newUniqueActions.every(a => /:(?:List|Describe|Get)/.test(a) && !a.includes('*')), true);
  assert.equal(p.newUniqueActions.includes('logs:CreateLogStream'), false); assert.equal(p.newUniqueActions.includes('logs:PutLogEvents'), false);
  for (const s of p.additions) assert.deepEqual(s.Condition, { StringEquals: { 'aws:RequestedRegion': 'ca-central-1' } });
  assert.deepEqual(baseline.Statement.map(s => s.Sid), ['HistoricalUnchanged']); assert.equal(Object.isFrozen(p.document.Statement), true);
});
test('one version/default request targets only the existing CFN policy; no version deletion or service boundary write', async () => {
  const p = await compileExpressCfnReadPolicyV1(baseline);
  assert.deepEqual(Object.keys(p.request).sort(), ['PolicyArn', 'PolicyDocument', 'SetAsDefault']);
  assert.equal(p.request.PolicyArn, K.policyArn); assert.equal(p.request.SetAsDefault, true);
  assert.equal(p.request.PolicyDocument, canonicalJson(p.document)); assert.equal(p.oldPolicyVersionDeleted, false);
  assert.equal(p.serviceBoundaryChanged, false); assert.equal(p.taskExecutionPolicyChanged, false);
  assert.equal(p.executionAuthorized, false); assert.equal(p.resourceMutationAuthorized, false);
});
test('exact target and listener coordinates, two log ARN forms, only regional policy inventory uses star', async () => {
  const p = await compileExpressCfnReadPolicyV1(baseline), rs = p.checks.flatMap(s => s.resources);
  assert.equal(rs.some(r => r.includes('service/cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service')), true);
  assert.equal(rs.some(r => r.includes('469c2b642a33bfc1/*')), true); assert.equal(rs.some(r => r.includes('bc69b195b69bc2d9/*')), true);
  assert.equal(p.checks.find(s => s.label === 'C5gExactLogPoliciesRead')?.resources.length, 2);
  assert.deepEqual(p.checks.filter(s => s.resources.includes('*')).map(s => s.actions), [['logs:DescribeIndexPolicies', 'logs:DescribeResourcePolicies']]);
  assert.equal(p.checks.find(s => s.label === 'C5gExactServiceDeploymentsRead')?.resources.some(r => r.includes(':service/cell-sandbox-1/')), true);
});
test('duplicate installed additions, malformed baseline or policy quota excess cannot produce a request', async () => {
  const p = await compileExpressCfnReadPolicyV1(baseline);
  await assert.rejects(compileExpressCfnReadPolicyV1(p.document));
  await assert.rejects(compileExpressCfnReadPolicyV1({ ...baseline, Version: '2008-10-17' }));
  await assert.rejects(compileExpressCfnReadPolicyV1({ ...baseline, Statement: [] }));
  await assert.rejects(compileExpressCfnReadPolicyV1({ ...baseline, Statement: [{ ...baseline.Statement[0], Resource: 'x'.repeat(6200) }] }));
});
test('fresh inventory requires exact role/policy, v7-only versions, sole boundary AND identity consumer', () => {
  assert.doesNotThrow(() => assertExpressCfnReadInventoryV1(inventory(), now));
  for (const issue of ['role', 'policy', 'version', 'versions', 'inline', 'attached', 'boundary', 'consumers', 'source', 'time']) {
    const f = inventory();
    if (issue === 'role') f.role.id = 'foreign'; if (issue === 'policy') f.policy.id = 'foreign';
    if (issue === 'version') f.policy.defaultVersion = 'v8'; if (issue === 'versions') f.policy.versions.push({ id: 'v6', isDefault: false });
    if (issue === 'inline') f.role.inlineNames.push('extra'); if (issue === 'attached') f.role.attached.push('extra');
    if (issue === 'boundary') f.role.boundaryArn = 'foreign'; if (issue === 'consumers') f.policy.permissionConsumers = { roles: [], users: [], groups: [] };
    if (issue === 'source') f.source.Account = '000000000000'; if (issue === 'time') f.observedAt = now - 90001;
    assert.throws(() => assertExpressCfnReadInventoryV1(f, now));
  }
});
test('review binds full baseline/trust, request, code, provider evidence and one-hour exact approval', async () => {
  const m = await manifest();
  assert.equal(m.expiresAt - m.preparedAt, 3600000); assert.equal(m.limits.createPolicyVersion, 1);
  assert.equal(m.limits.otherIamWrites, 0); assert.equal(m.limits.cloudFormationOrEcsDeployments, 0);
  await assert.doesNotReject(assertExpressCfnReadPolicyApprovalV1(m, m.manifestSha256, 'a'.repeat(64), now + 1000));
  await assert.rejects(assertExpressCfnReadPolicyApprovalV1(m, '0'.repeat(64), 'a'.repeat(64), now));
  await assert.rejects(assertExpressCfnReadPolicyApprovalV1(m, m.manifestSha256, 'c'.repeat(64), now));
  await assert.rejects(assertExpressCfnReadPolicyApprovalV1(m, m.manifestSha256, 'a'.repeat(64), m.expiresAt));
  const tampered = structuredClone(m); Object.assign(tampered, { slot: 'different' });
  await assert.rejects(assertExpressCfnReadPolicyApprovalV1(tampered, m.manifestSha256, 'a'.repeat(64), now));
});
test('trust or complete document drift is rejected, not merged or granted during prepare', async () => {
  const candidate = await compileExpressCfnReadPolicyV1(baseline), args = { candidate, facts: inventory(), expectedTrust: trust,
    baselineDocumentSha256: await sha256Hex(baseline), codeBindingSha256: 'a'.repeat(64), providerEvidenceSha256: 'b'.repeat(64), now };
  await assert.rejects(prepareExpressCfnReadPolicyReviewV1({ ...args, expectedTrust: {} }));
  await assert.rejects(prepareExpressCfnReadPolicyReviewV1({ ...args, baselineDocumentSha256: '0'.repeat(64) }));
  const facts = inventory(); facts.policy.document.Statement[0].Resource = '*';
  await assert.rejects(prepareExpressCfnReadPolicyReviewV1({ ...args, facts }));
});
test('prewrite identity comparison excludes only observation timestamp, never role/trust/consumers/version/document', () => {
  const f = inventory(), next = { ...f, observedAt: f.observedAt + 1000 };
  assert.deepEqual(expressCfnReadInventoryIdentityV1(f), expressCfnReadInventoryIdentityV1(next));
  const changed = structuredClone(f); changed.policy.versions.push({ id: 'v8', isDefault: false });
  assert.notDeepEqual(expressCfnReadInventoryIdentityV1(f), expressCfnReadInventoryIdentityV1(changed));
});
test('future full review corrects resource scopes and never reruns or silently passes the inconclusive log-stream check', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/review-express-live-delivery-v1.mjs', import.meta.url), 'utf8');
  assert.ok(text.includes("['ecs:DescribeServiceDeployments'], [serviceArn,"));
  assert.ok(text.includes("['logs:DescribeIndexPolicies', 'logs:DescribeResourcePolicies'], ['*']"));
  assert.equal(text.includes("await sim('execution-log-stream'"), false);
  assert.ok(text.includes('READ_CHECKS_PASSED_LOG_ACCESS_STILL_UNPROVED_NOT_AUTHORIZED'));
  assert.ok(text.includes('actualLogAccessVerified: false'));
});
