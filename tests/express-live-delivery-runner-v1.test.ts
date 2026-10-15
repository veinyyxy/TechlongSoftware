import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveDeliveryFixtureV2, liveNow as now } from './fixtures/express-live-delivery-v2.ts';
import { prepareExpressLiveDeliveryPlanV1, prepareExpressLiveDeliveryPlanV2 } from '../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { compileExpressFirstClaimProgramV1 } from '../lib/deployments/execution/express-first-claim-program-v1.ts';
import { compileExpressAtomicReadyProgramV1 } from '../lib/deployments/execution/express-live-persistence-v1.ts';
import { prepareExpressLiveDeliveryReviewV1, runReviewedExpressLiveDeliveryV1,
  type ExpressLiveDeliveryPortsV1, type ExpressLivePreflightV1 } from '../lib/deployments/execution/express-live-delivery-runner-v1.ts';
import { canonicalJson, sha256Hex } from '../lib/deployments/execution/hash.ts';

const leaseToken = 'lease_' + '1'.repeat(32), digest = 'a'.repeat(64);
const stackSuffix = '11111111-2222-3333-4444-555555555555';
async function fixture() {
  const x = await liveDeliveryFixtureV2(), { plan, f } = x;
  const claim = await compileExpressFirstClaimProgramV1({ plan, configuration: f.configuration,
    environmentPolicy: { ...plan.environmentPolicy }, now, leaseToken });
  const stackId = `arn:aws:cloudformation:ca-central-1:402010193138:stack/${plan.futureTemplate.stackName}/${stackSuffix}`;
  const active = { ...plan.pendingExternalFence, state: 'active' as const };
  const lease = { jobId: claim.jobId, deploymentId: plan.scope.deploymentId, workerId: claim.workerId, leaseToken, attempt: 1 };
  const ready = { plan, configuration: f.configuration, lease, externalFence: active, now,
    proof: { planSha256: plan.planSha256, stackId, observationSha256: digest, configurationHash: plan.scope.configurationHash,
      imageRevision: plan.scope.artifactRef.split('@')[1], checkedAt: now, resourceEvidenceSha256: digest,
      bootstrapVerified: true as const, initializedVerified: true as const, effectiveConfigurationVerified: true as const } };
  return { ...x, claim, stackId, active, lease, ready };
}
test('new child window preserves expired parent and old plan, while v1 still refuses expiry', async () => {
  const { plan, input, previousPlan } = await fixture();
  assert.equal(plan.cellDeadlineTag, previousPlan.cellDeadlineTag);
  assert.ok(Date.parse(plan.cellDeadlineTag) < now);
  assert.equal(Date.parse(plan.deadlineTag) - now, 7200000);
  assert.equal(plan.futureTemplate.tags.ExpiresAt, plan.deadlineTag);
  assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.independentWindow?.supersededPlanSha256, previousPlan.planSha256);
  assert.equal(plan.independentWindow?.parentTagRenewalAuthorized, false);
  assert.equal(plan.independentWindow?.automaticCleanupInstalled, false);
  await assert.rejects(prepareExpressLiveDeliveryPlanV1({ ...input, now }));
  assert.equal(canonicalJson(plan.proposedEpochTransaction), canonicalJson(previousPlan.proposedEpochTransaction));
});
test('v2 refuses changed historical plan, future parent or changed public material', async () => {
  const { candidateInput } = await fixture();
  for (const issue of ['hash', 'future', 'public']) {
    const x = structuredClone(candidateInput);
    if (issue === 'hash') x.previousPlan.planSha256 = '0'.repeat(64);
    if (issue === 'future') x.now = Date.parse('2026-10-15T16:00:00Z');
    if (issue === 'public') x.privateReceipt.publicParameters.ControlIssuer = 'https://other.techlong.cloud';
    await assert.rejects(prepareExpressLiveDeliveryPlanV2(x));
  }
});
test('review cannot stretch admission or erase fixed cloud/private/provision limits', async () => {
  const { plan } = await fixture();
  const review = await prepareExpressLiveDeliveryReviewV1({ plan, codeBindingSha256: digest, now });
  for (const issue of ['time', 'writes']) {
    const x = structuredClone(review);
    if (issue === 'time') x.admissionExpiresAt += 3600000;
    if (issue === 'writes') Object.assign(x, { maxSourceCloudWriteCalls: 0 });
    const { reviewSha256: old, ...body } = x; assert.ok(old); x.reviewSha256 = await sha256Hex(body);
    await assert.rejects(runReviewedExpressLiveDeliveryV1({ plan, review: x, approvedReviewSha256: x.reviewSha256,
      ports: {} as ExpressLiveDeliveryPortsV1, now: () => now, signal: new AbortController().signal }), /REVIEW_SCOPE_REJECTED/);
  }
});
test('atomic ready locks live owner/epoch/lease and changes instance, deployment and same job in one program', async () => {
  const { ready } = await fixture(), p = await compileExpressAtomicReadyProgramV1(ready);
  assert.equal(p.isolationLevel, 'Serializable'); assert.equal(p.statements.length, 4);
  assert.match(p.statements[0].text, /FOR UPDATE OF d,a,sub,w,e,j,r,o/);
  assert.match(p.statements[0].text, /lease_expires_at>.*clock_timestamp/);
  assert.match(p.statements[0].text, /o.state='active'/); assert.match(p.statements[0].text, /r.lifecycle_status='verified'/);
  assert.match(p.statements[0].text, /configuration_snapshot::jsonb=\$20/);
  assert.match(p.statements[3].text, /status='succeeded',lease_owner=NULL/);
  assert.ok(p.statements.every(q => /1 \/ CASE WHEN count\(\*\)=1/.test(q.text)));
  assert.equal(p.automaticRetries, 0);
  assert.doesNotMatch(canonicalJson(p), /first_owner|password|compiledPayload/);
});
test('atomic ready rejects stale observation, wrong job, missing readiness, config drift and foreign UUID', async () => {
  for (const issue of ['stale', 'job', 'ready', 'config', 'stack']) {
    const { ready } = await fixture();
    if (issue === 'stale') ready.proof.checkedAt -= 30001;
    if (issue === 'job') ready.lease.jobId = 'job_' + '0'.repeat(24);
    if (issue === 'ready') Object.assign(ready.proof, { initializedVerified: false });
    if (issue === 'config') ready.configuration.defaultStoreName = 'changed';
    if (issue === 'stack') ready.proof.stackId = ready.proof.stackId.replace('/techlong-sandbox-tenant-', '/foreign-');
    await assert.rejects(compileExpressAtomicReadyProgramV1(ready));
  }
});

async function runnerFixture(fault?: string) {
  const x = await fixture(), { plan, f, stackId, active } = x;
  const review = await prepareExpressLiveDeliveryReviewV1({ plan, codeBindingSha256: digest, now });
  const log: string[] = [], used = new Set<string>(); let finalObservation = '', compiledPayload: Record<string, unknown> = {};
  const observation = { ready: true, desiredConfigurationHash: plan.scope.configurationHash, imageRevision: plan.scope.artifactRef.split('@')[1] };
  const database: ExpressLivePreflightV1['installedDatabase'] = { checkedAt: now, evidenceSha256: digest, databaseOid: '16459', roleOid: '16456',
    databaseName: 'tenant_a0da1748bc4d5419_db', roleName: 'tenant_a0da1748bc4d5419_role', defaultStoreId: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87',
    activeDefaultStores: 1, initialized: false, sourceArchiveSha256: '1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a' };
  const evidence = { provisionPredecessor: null };
  const ports = {
    journal: { async consume(entry: string) { if (used.has(entry)) throw Error('consumed'); used.add(entry); log.push(entry); }, async note() {} },
    infrastructure: {
      async assertIdentity() { log.push('identity'); }, async assertEpoch() { log.push('epoch_read'); },
      async installEpoch() { return { schemaVersion: 1, pendingFence: plan.pendingExternalFence, provisionPredecessor: null, evidence, evidenceHash: await sha256Hex(evidence) }; },
      async createWorkload() { if (fault === 'create') throw Error('could have committed'); return stackId; },
      async waitWorkload() { if (fault === 'stack') throw Error('provider rollback'); return { stackId, resourceInventorySha256: digest }; },
      async createDns() { return '/change/C123'; }, async waitDns() {}, dispose() {},
    },
    async preflight() { return { planSha256: plan.planSha256, checkedAt: fault === 'stale' ? now - 30001 : now,
      inventorySha256: digest, codeBindingSha256: digest, configuration: f.configuration,
      namespacesAbsent: true, computeAndImagesUnchanged: true, cfnV8Unchanged: true, installedDatabase: database }; },
    async observeInstalledDatabase() { return fault === 'store' ? { ...database, activeDefaultStores: 0 } : database; },
    persistence: { async firstClaim(i: Parameters<typeof compileExpressFirstClaimProgramV1>[0]) { return compileExpressFirstClaimProgramV1(i); },
      async finishReady(i: Parameters<typeof compileExpressAtomicReadyProgramV1>[0]) {
        const program = await compileExpressAtomicReadyProgramV1(i); finalObservation = i.proof.observationSha256;
        return { committed: true, programSha256: program.programSha256 }; } },
    repository: { async activateTenantExternalOperation() { return active; }, async assertTenantExternalOperation() { return fault !== 'fence'; },
      async transitionDeployment() { return true; }, async recordTenantResourceLifecycle() { return true; }, async loadContext() { return {}; } },
    async openControl() { return {
      control: { async waitUntilHealthy() { log.push('bootstrap'); return observation; },
        async provision() { log.push('post'); if (fault === 'post') throw Error('ambiguous post with private data'); return { accepted: true }; },
        async readConfiguration() { log.push('initialized'); return { ...observation, ready: fault !== 'initialized' }; } },
      compiler: { async compile() { compiledPayload = { first_owner: { password: 'synthetic-password-not-a-credential' } };
        return { configurationHash: plan.scope.configurationHash, compiledPayload }; } },
      dispose() { log.push('disposed'); },
    }; },
    async inspectReady(i: { jobId: string }) { return { deploymentId: plan.scope.deploymentId, appInstanceId: plan.scope.appInstanceId,
      jobId: i.jobId, deploymentStatus: 'ready', instanceStatus: 'active', jobStatus: fault === 'inspect' ? 'running' : 'succeeded', observationSha256: finalObservation }; },
  } as unknown as ExpressLiveDeliveryPortsV1;
  const run = (approved = review.reviewSha256) => runReviewedExpressLiveDeliveryV1({ plan, review,
    approvedReviewSha256: approved, ports, now: () => now, signal: new AbortController().signal });
  return { ...x, review, run, log, getPayload: () => compiledPayload };
}
test('kernel orders actual gates before one provision and atomic ready; wipes the payload and refuses admission replay', async () => {
  const x = await runnerFixture(), r = await x.run();
  assert.equal(r.outcome, 'INITIALIZED_READY_INDEPENDENTLY_VERIFIED');
  assert.equal(x.log.filter(v => v === 'post').length, 1);
  for (const [before, after] of [['first_claim', 'install_epoch'], ['install_epoch', 'activate_epoch'], ['activate_epoch', 'create_workload'],
    ['create_workload', 'create_dns'], ['bootstrap', 'adopt_verified_schema'], ['adopt_verified_schema', 'compile_first_owner'], ['initialized', 'atomic_ready']])
    assert.ok(x.log.indexOf(before) < x.log.indexOf(after), before + ' before ' + after);
  assert.equal((x.getPayload().first_owner as Record<string, unknown>).password, undefined);
  await assert.rejects(x.run()); assert.equal(x.log.filter(v => v === 'first_claim').length, 1);
});
test('bad SHA/stale preflight cannot consume a slot, load private sources or claim a job', async () => {
  const x = await runnerFixture(); await assert.rejects(x.run('0'.repeat(64))); assert.deepEqual(x.log, []);
  const stale = await runnerFixture('stale'); await assert.rejects(stale.run());
  assert.equal(stale.log.includes('admit'), false); assert.equal(stale.log.includes('private_control_load'), false);
});
test('ambiguous submission, terminal stack, lost fence or changed store stop before provision/ready without retry', async () => {
  for (const fault of ['create', 'stack', 'fence', 'store']) {
    const x = await runnerFixture(fault), result = await x.run();
    assert.equal(result.outcome, 'REQUIRES_INDEPENDENT_INSPECT_NO_RETRY', fault);
    assert.equal(result.retryAllowed, false); assert.equal(x.log.includes('post'), false);
    assert.equal(x.log.includes('atomic_ready'), false); assert.equal(x.log.at(-1), 'disposed');
    assert.ok(x.log.filter(e => e === 'create_workload').length <= 1);
  }
});
test('provision ambiguity or bad initialized response never marks ready; post-commit bad inspection is not success', async () => {
  for (const fault of ['post', 'initialized', 'inspect']) {
    const x = await runnerFixture(fault), result = await x.run();
    assert.equal(result.outcome, 'REQUIRES_INDEPENDENT_INSPECT_NO_RETRY');
    assert.equal(x.log.filter(e => e === 'post').length, 1);
    assert.equal(x.log.includes('atomic_ready'), fault === 'inspect');
    assert.equal((x.getPayload().first_owner as Record<string, unknown>).password, undefined);
  }
});
test('real adapters have one SDK attempt, exact endpoints, CREATE-only DNS and fixed durable root independent of review SHA', async () => {
  const aws = await readFile(new URL('../lib/deployments/execution/aws-sdk-express-live-infrastructure-v1.ts', import.meta.url), 'utf8');
  const journal = await readFile(new URL('../lib/deployments/execution/express-live-journal-v1.ts', import.meta.url), 'utf8');
  assert.match(aws, /maxAttempts: 1/); assert.match(aws, /ConsistentRead: true/);
  assert.match(aws, /endpoint: 'https:\/\/cloudformation.ca-central-1.amazonaws.com'/);
  assert.match(aws, /new GetTemplateCommand/); assert.match(aws, /EXPRESS_WORKLOAD_PARAMETER_DRIFT/);
  assert.doesNotMatch(aws, /new (?:Delete|Update|PutItem)\w*Command/);
  assert.match(journal, /open\(path.join\(directory, name\), 'wx'/); assert.match(journal, /await handle.sync\(\)/);
  assert.match(journal, /const directory = 'F:\/ChatGPT_workshop\/techlong-express-c5h-first-delivery-v1'/);
});
