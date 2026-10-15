import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../lib/deployments/execution/express-compute-reviewed-v1.cjs';
import { firstClaimFixture } from './fixtures/express-first-claim-v1.ts';

const now = Date.parse('2026-10-15T13:45:00Z'), code = 'a'.repeat(64), seed = 'b'.repeat(64);
// Synthetic port observations exercise orchestration only; real metadata is
// obtained by Review, not claimed by this local fixture.
async function fixture() {
  const f = await firstClaimFixture(), draft = await f.root.renderCell({ requestedAt: now, availabilityZones: ['ca-central-1a', 'ca-central-1b'],
    certificateArn: 'arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d',
    controlTrustStoreArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44' });
  const oldSnapshot = { stackId: core.OLD, status: 'ROLLBACK_COMPLETE', roleArn: core.ROLE, tags: { ...draft.tags, ExpiresAt: '2026-10-14T01:40:26.908Z' },
    templateSha256: '4d0061be99e0df1e51993f875596d00913aefe609c21a3432d4a7241431e8077',
    resources: Array.from({ length: 20 }, (_, n) => ({ logicalId: 'old' + n, type: 'AWS::EC2::VPC', physicalId: 'old-' + n, status: 'DELETE_COMPLETE' })) };
  const facts = { observedAt: now, source: { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' },
    existingIamVerified: true, iam: { roleId: 'AROAV3GNMXTZESNMKM56K', policyId: 'ANPAV3GNMXTZL4VMJHXXZ', boundaryVersion: 'v1',
      materialSha256: '4d7d1712e914a7b4d7cc4e227a97761318585396893f5fab0d31b11f091e9faf', serviceLinkedRoles: [] },
    prerequisites: { truststoreActive: true, zones: ['ca-central-1a', 'ca-central-1b'] }, simulations: Array.from({ length: 4 }, () => ({ allowed: true })),
    stack: { ...oldSnapshot, terminationProtection: false, outputs: {} as Record<string, string>, parameters: {} as Record<string, string> }, namespace: { vpcs: [] as string[], loadBalancers: [] as { arn: string; vpcId: string }[],
      ecs: { failures: [], clusters: [{ name: 'cell-sandbox-1', arn: 'arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1', status: 'INACTIVE', running: 0, pending: 0, services: 0 }] } } };
  const controlPlane = { result: { outcome: 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED', startedAt: now - 1000, completedAt: now,
    checks: Object.fromEntries(Array.from({ length: 7 }, (_, n) => ['check' + n, true])) } };
  const estimate = { hardCap: false }, m = core.prepare({ draft, facts, oldSnapshot, controlPlane, estimate, seedEvidenceSha256: seed, codeBindingSha256: code, now });
  return { draft, facts, oldSnapshot, controlPlane, estimate, m };
}

test('one exact old UUID retirement and 16-resource CreateStack; no IAM/SQL/Secret/task/DB or ChangeSet writes', async () => {
  const f = await fixture(), r = core.requests(f.m);
  assert.equal(r.retire.StackName, core.OLD); assert.equal(r.retire.DeletionMode, 'STANDARD'); assert.equal('RetainResources' in r.retire, false);
  assert.equal(r.create.StackName, core.NAME); assert.equal(r.create.RoleARN, core.ROLE); assert.equal(r.create.OnFailure, 'ROLLBACK');
  assert.equal(r.create.TimeoutInMinutes, 45); assert.equal(r.create.EnableTerminationProtection, false);
  assert.equal('Capabilities' in r.create, false); assert.equal('TemplateURL' in r.create, false);
  assert.equal(f.draft.resourceInventory.length, 16); assert.equal(r.create.ResourceTypes.some((v: string) => /IAM|RDS|Task|Service|Lambda|Scheduler/.test(v)), false);
});
test('fresh approval binds complete code/facts/template/old UUID and refuses expired deadline or altered body', async () => {
  const f = await fixture(); core.approval(f.m, f.m.manifestSha256, code, now + 1000);
  assert.throws(() => core.approval(f.m, 'c'.repeat(64), code, now)); assert.throws(() => core.approval(f.m, f.m.manifestSha256, 'c'.repeat(64), now));
  assert.throws(() => core.approval(f.m, f.m.manifestSha256, code, f.m.expiresAt));
  const changed = structuredClone(f.m); changed.draft.tags.CellId = 'foreign'; assert.throws(() => core.approval(changed, f.m.manifestSha256, code, now));
});
test('old stack UUID/status/physical inventory, active ECS or any namespace collision refuses retirement', async () => {
  const f = await fixture();
  for (const issue of ['uuid', 'status', 'liveResource', 'missingResource', 'vpc', 'alb', 'ecs', 'source', 'iam']) {
    const x = structuredClone(f.facts);
    if (issue === 'uuid') x.stack.stackId = core.OLD.replace('ede4f290', '00000000');
    if (issue === 'status') x.stack.status = 'CREATE_COMPLETE';
    if (issue === 'liveResource') x.stack.resources[0].status = 'DELETE_FAILED';
    if (issue === 'missingResource') x.stack.resources.pop();
    if (issue === 'vpc') x.namespace.vpcs.push('vpc-foreign');
    if (issue === 'alb') x.namespace.loadBalancers.push({ arn: 'foreign', vpcId: 'foreign' });
    if (issue === 'ecs') x.namespace.ecs.clusters[0].status = 'ACTIVE';
    if (issue === 'source') x.source.UserId = 'foreign';
    if (issue === 'iam') x.iam.roleId = 'recreated';
    assert.throws(() => core.checkOld(x, f.oldSnapshot, now), issue);
  }
});

test('ordered pipeline journals before each of exactly two writes and never completes an uncertain write', async () => {
  const f = await fixture();
  for (const issue of ['ok', 'rootSlot', 'deleteSlot', 'deleteResponse', 'deletePending', 'createSlot', 'createResponse', 'receipt']) {
    const calls: string[] = [], saved: string[] = []; let reads = 0;
    const port = { outputDirectory: 'fixture-only', now: () => now, approve() {}, async control() {}, async who() {}, async credentialsEnough() {},
      async observe() { const x = structuredClone(f.facts); if (++reads > 1) x.stack = null as never; return x; },
      async consume(slot: string) { calls.push('slot:' + slot);
        if (slot === ({ rootSlot: core.RUN_SLOT, deleteSlot: core.DELETE_SLOT, createSlot: core.CREATE_SLOT } as Record<string, string>)[issue]) throw Error('SLOT_FIXTURE'); },
      async save(name: string) { saved.push(name); if (issue === 'receipt' && name === 'create-receipt.json') throw Error('DISK_FIXTURE'); },
      async deleteStack() { calls.push('DELETE'); if (issue === 'deleteResponse') throw Error('LOST_RESPONSE'); },
      async waitDeleted() { calls.push('WAIT'); if (issue === 'deletePending') throw Error('PENDING'); },
      async createStack() { calls.push('CREATE'); if (issue === 'createResponse') throw Error('LOST_RESPONSE'); return { StackId: core.OLD.replace('ede4f290', '11111111') }; } };
    const task = core.executeReviewedCompute(f.m, port); if (issue === 'ok') await task; else await assert.rejects(task);
    assert.ok(calls.filter(v => v === 'DELETE').length <= 1); assert.ok(calls.filter(v => v === 'CREATE').length <= 1);
    if (calls.includes('DELETE')) assert.ok(calls.indexOf('slot:' + core.DELETE_SLOT) < calls.indexOf('DELETE'));
    if (calls.includes('CREATE')) { assert.ok(calls.indexOf('WAIT') < calls.indexOf('CREATE')); assert.ok(calls.indexOf('slot:' + core.CREATE_SLOT) < calls.indexOf('CREATE')); }
    if (['rootSlot', 'deleteSlot', 'deleteResponse', 'deletePending', 'createSlot'].includes(issue)) assert.equal(calls.includes('CREATE'), false);
    if (issue === 'ok') assert.equal(saved.at(-1), 'create-receipt.json');
  }
});
test('post-retirement new collision or IAM identity change stops before new resource creation', async () => {
  const f = await fixture(), absent = structuredClone(f.facts); absent.stack = null as never;
  core.checkBeforeCreate(absent, f.m, now);
  absent.namespace.vpcs.push('new-unreviewed-vpc'); assert.throws(() => core.checkBeforeCreate(absent, f.m, now));
  absent.namespace.vpcs = []; absent.iam.roleId = 'recreated'; assert.throws(() => core.checkBeforeCreate(absent, f.m, now));
});
test('new stack output acceptance requires exact UUID, token attribution, template and zero workload', async () => {
  const f = await fixture(), id = core.OLD.replace('ede4f290', '11111111'), x = structuredClone(f.facts);
  const rs = f.draft.resourceInventory.map(r => ({ ...r, physicalId: r.logicalId === 'CellCluster' ? 'cell-sandbox-1' : 'physical-' + r.logicalId, status: 'CREATE_COMPLETE' })).sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  const ids = Object.fromEntries(rs.map(r => [r.logicalId, r.physicalId]));
  x.stack = { stackId: id, status: 'CREATE_COMPLETE', roleArn: core.ROLE, tags: { ...f.draft.tags, ExpiresAt: f.draft.reviewDeadline }, templateSha256: f.draft.templateSha256, resources: rs,
    parameters: f.draft.parameters, terminationProtection: false, outputs: { ClusterName: ids.CellCluster, VpcId: ids.CellVpc, TaskSecurityGroupId: ids.TaskSecurityGroup,
      HttpsListenerArn: ids.BusinessHttpsListener, ControlListenerArn: ids.ControlMtlsListener, SubnetIds: [ids.PublicSubnetA, ids.PublicSubnetB].join(','), CellExpiresAt: f.draft.reviewDeadline } };
  x.namespace.vpcs = [ids.CellVpc]; x.namespace.loadBalancers = [{ arn: ids.CellLoadBalancer, vpcId: ids.CellVpc }]; x.namespace.ecs.clusters[0].status = 'ACTIVE';
  const receipt = { stackId: id }; assert.equal(core.checkCreatedStack(x, f.m, receipt, true, now).readyVerified, false);
  assert.throws(() => core.checkCreatedStack(x, f.m, receipt, false, now));
  const other = structuredClone(x); other.stack.outputs.VpcId = 'foreign'; assert.throws(() => core.checkCreatedStack(other, f.m, receipt, true, now));
  x.namespace.ecs.clusters[0].running = 1; assert.throws(() => core.checkCreatedStack(x, f.m, receipt, true, now), /UNEXPECTED_WORKLOAD/);
});
test('price estimate distinguishes short compute-only cost from future always-on budget overrun; no free-credit assumption', () => {
  const values = [['AWSELB', 'CAN1-LoadBalancerUsage', .02475, 'Application LoadBalancer-hour'], ['AWSELB', 'CAN1-TS-LoadBalancerUsage', .0055, ''],
    ['AWSELB', 'CAN1-LCUUsage', .0088, 'Application load balancer'], ['AmazonVPC', 'CAN1-PublicIPv4:InUseAddress', .005, ''],
    ['AmazonECS', 'CAN1-Fargate-vCPU-Hours:perCPU', .04456, ''], ['AmazonECS', 'CAN1-Fargate-GB-Hours', .004865, ''], ['AmazonRDS', 'CAN1-Aurora:ServerlessV2Usage', .14, '']];
  const services = [...new Set(values.map(v => v[0]))], feed = { region: 'ca-central-1', currency: 'USD', at: new Date(now).toISOString(), snapshots: services.map(service => ({ service,
    selected: values.filter(v => v[0] === service).map(v => ({ attributes: { usagetype: v[1] }, usd: String(v[2]), description: v[3] })) })) };
  const p = core.prices(feed, 'a'.repeat(64), now); assert.equal(p.currentScope.networkHourlyUsd, .04025);
  assert.ok(Math.abs(p.currentScope.threeHoursOneLcuUsd - .14715) < 1e-8); assert.ok(p.futureNotAuthorized.monthly730HoursAlsoOneActiveAcuUsd > 150);
  assert.equal(p.creditsAssumed, 0); assert.equal(p.automaticDeletion, false); assert.equal(p.hardCap, false);
});
