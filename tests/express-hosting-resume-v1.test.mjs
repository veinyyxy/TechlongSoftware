import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { H, hash, resumePlan, bindExecution, admission, executionWindow, resumeReceipt, compileRebind,
  validateResumeBefore, validateRebound, validatePlatformProjection } from '../ops/aws-sandbox/scripts/express-hosting-resume-plan-v1.mjs';
function fixture(now = Date.now()) {
  const oldExpiry = '2026-10-16T12:04:28.726Z', aliases = ['d', 'a', 'j', 'r', 'o', 'e', 'w', 'sub', 'tv'];
  const rowHashes = Object.fromEntries(aliases.map(a => [a, hash(a)])), identity = { database: 'neondb', databaseOid: '1', role: 'owner', roleOid: '2', version: '180006', timezone: 'GMT' };
  const request = { StackName: H.name, RoleARN: H.role, TemplateBody: JSON.stringify({ Metadata: {},
    Resources: Object.fromEntries(Object.entries(H.resources).map(([n, Type]) => [n, { Type, Properties: { Tags: [{ Key: 'ExpiresAt', Value: oldExpiry }] } }])) }),
  Parameters: Array.from({ length: 20 }, (_, n) => ({ ParameterKey: 'Parameter' + n, ParameterValue: 'fixed' + n })),
  Tags: [{ Key: 'ExpiresAt', Value: oldExpiry }], OnFailure: 'ROLLBACK', TimeoutInMinutes: 25 };
  const historical = { plan: { scope: { deploymentId: 'dep_exact', appInstanceId: 'app_exact', environmentId: 'env_exact' },
    templateVersionId: 'tpl_exact', subscriptionId: 'sub_exact', pendingExternalFence: { resourceFence: { identity: { workspaceId: 'ws_exact', productId: 'prd_exact' } } } } };
  const snapshot = { read_only: 'on', identity, hashes: rowHashes, stable_hashes: rowHashes, original_receipt_intact: true, stack_id: H.stack,
    deployment_status: 'ready', instance_status: 'active', job_status: 'succeeded', attempts: 1, max_attempts: 1, lease_cleared: true,
    restoration_slot_absent: true, restoration_receipt_matches: false, current_step: 'ready', artifact_ref: 'registry@' + H.newDigest,
    outputs_json_octets: 2669, outputs_json_sha256: hash('old-output'), outputs_text_sha256: hash('old-text') };
  const input = { base: { k1: { plan: { request } }, historical }, ready: { independent: { snapshot: { hashes: rowHashes, identity },
    catalogServerSha256: hash('catalog'), applicationProof: { checkedAt: now - 3600000 } }, write: { receipt: { protocol: 'original-manual' } } },
  readyPlatform: {}, k2cManifest: { plan: { endpointSha256: hash('endpoint') } } };
  const state = { snapshot, endpointSha256: hash('endpoint'), catalog: { server_sha256: hash('catalog') } }, p = resumePlan(input, state, now);
  const x = bindExecution(p, hash('manifest'), now + 3600000), checkedAt = x.startedAt + 3000;
  const hosting = { checkedAt: x.startedAt + 1000, live: { stackId: H.stack.replace(/[^/]+$/, 'new-uuid'), taskDefinitionArn: H.oldTask.replace(/:2$/, ':3'), digest: H.newDigest } };
  const proof = [['/health', 200], ['/ready', 200], ['/api/merchant/stores', 401]].map(([path, statusCode]) => ({ path, statusCode, expectedResponseVerified: true, checkedAt: new Date(checkedAt).toISOString() }));
  const receipt = resumeReceipt(p, x, hosting, proof, checkedAt);
  return { input, p, x, state, hosting, proof, receipt, now };
}
test('approval lasts 24h but two-hour TTL starts only at one durable execution binding', () => {
  const f = fixture(); assert.equal(f.p.approvalExpiresAt - f.now, 86400000); assert.equal(Date.parse(f.x.expiresAt) - f.x.startedAt, 7200000);
  assert.equal(f.x.startedAt, f.now + 3600000); admission(f.p, f.x.startedAt); executionWindow(f.x, f.x.startedAt);
  assert.throws(() => admission(f.p, f.p.approvalExpiresAt), /APPROVAL_EXPIRED/);
  assert.throws(() => executionWindow(f.x, f.x.finishBefore), /EXECUTION_EXPIRED/);
  assert.deepEqual(bindExecution(f.p, hash('manifest'), f.x.startedAt), f.x);
  assert.notEqual(bindExecution(f.p, hash('manifest'), f.x.startedAt + 1).requestSha256, f.x.requestSha256);
});
test('request keeps all twenty parameters/role/resources; changes only expiry and explicit restoration metadata', () => {
  const f = fixture(), old = f.input.base.k1.plan.request;
  assert.deepEqual(f.x.request.Parameters, old.Parameters); assert.equal(f.x.request.RoleARN, old.RoleARN); assert.equal(f.x.request.OnFailure, 'ROLLBACK');
  const t = JSON.parse(f.x.request.TemplateBody); assert.equal(Object.keys(t.Resources).length, 7);
  assert.equal(t.Metadata.PublicAcceptanceRestoration.provisionAuthorized, false);
  for (const r of Object.values(t.Resources)) assert.equal(r.Properties.Tags[0].Value, f.x.expiresAt);
  assert.equal(new Set([H.slot, H.writeSlot, H.inspectSlot]).size, 3); assert.notEqual(H.stack, H.name);
});
test('current ready record, original receipt and all nine complete rows cannot be silently adopted after drift', () => {
  const f = fixture(); validateResumeBefore(f.state.snapshot, f.input);
  for (const patch of [{ job_status: 'running' }, { attempts: 2 }, { instance_status: 'pending' }, { original_receipt_intact: false },
    { hashes: {} }, { stack_id: 'foreign' }, { restoration_slot_absent: false }, { lease_cleared: false }])
    assert.throws(() => validateResumeBefore({ ...f.state.snapshot, ...patch }, f.input), /CURRENT_READY_ROWS_CHANGED/);
});
test('wrong database source/catalog cannot produce a proposal', () => {
  const f = fixture(); assert.throws(() => resumePlan(f.input, { ...f.state, endpointSha256: hash('other') }, f.now), /SOURCE_OR_CATALOG/);
  assert.throws(() => resumePlan(f.input, { ...f.state, catalog: { server_sha256: hash('other') } }, f.now), /SOURCE_OR_CATALOG/);
});
test('new receipt requires ordered exact three public results and new host; configuration proof is explicitly historical', () => {
  const f = fixture(); assert.equal(f.receipt.authenticatedConfigurationProof, 'HISTORICAL_K2C_NOT_A_FRESH_CONTROL_GET');
  for (const proof of [f.proof.slice(0, 2), [...f.proof].reverse(), f.proof.map(p => ({ ...p, statusCode: 200 }))])
    assert.throws(() => resumeReceipt(f.p, f.x, f.hosting, proof, f.receipt.checkedAt), /NEW_HOSTING_PUBLIC_PROOF/);
  assert.throws(() => resumeReceipt(f.p, f.x, { ...f.hosting, live: { ...f.hosting.live, stackId: H.stack } }, f.proof, f.receipt.checkedAt), /NEW_HOSTING_PUBLIC_PROOF/);
});
test('one five-statement serializable program updates only deployment outputs/updated_at and preserves prior receipt/outputs', () => {
  const f = fixture(), p = compileRebind(f.p, f.x, f.receipt, f.input), text = p.statements.map(q => q.text).join('\n');
  assert.equal(p.statements.length, 5); assert.equal((text.match(/UPDATE public\./g) || []).length, 1);
  assert.match(text, /SET outputs=/); assert.match(text, /'previousOutputs',outputs::jsonb/); assert.match(text, /'manualReadyReconciliationV1'/);
  assert.doesNotMatch(text, /UPDATE public\.(?:app_instances|deployment_jobs)|\bINSERT INTO\b|\bDELETE FROM\b|SET status=|SET attempts=/);
  assert.match(text, /FOR UPDATE OF e,w,sub,tv,d,a,j,r,o/); assert.match(text, /30000/); assert.match(text, /pg_get_functiondef/);
  for (const q of p.statements) assert.deepEqual([...new Set([...q.text.matchAll(/\$(\d+)/g)].map(m => Number(m[1])))].sort((a, b) => a - b),
    Array.from({ length: q.values.length }, (_, i) => i + 1));
});
test('independent state proves old masks, original receipt and preserved outputs rather than only ready status', () => {
  const f = fixture(), s = { ...f.state.snapshot, restoration_receipt_matches: true, restoration_slot_absent: false,
    stack_id: f.receipt.stackId, observation_sha256: hash(f.receipt), previous_outputs_sha256: f.p.expectedState.outputs_json_sha256,
    deployment_updated_at: String(f.receipt.checkedAt + 1) };
  validateRebound(s, f.p, f.x, f.receipt);
  for (const patch of [{ original_receipt_intact: false }, { stable_hashes: {} }, { previous_outputs_sha256: 'other' }, { stack_id: H.stack }])
    assert.throws(() => validateRebound({ ...s, ...patch }, f.p, f.x, f.receipt), /REBOUND_NOT_PROVED/);
});
test('actual provider projection permits only stack/observation/updated coordinate change', () => {
  const f = fixture(), row = { desired_plan: '{}', configuration_snapshot: '{}', environment_policy: '{}', attempts: 1, job_status: 'succeeded',
    stack_id: f.receipt.stackId, observation_sha256: hash(f.receipt), deployment_updated_at: String(f.receipt.checkedAt + 1) };
  const old = { ...row, stack_id: H.stack, desired_plan_sha256: hash({}), configuration_snapshot_sha256: hash({}), environment_policy_sha256: hash({}) };
  for (const k of ['desired_plan', 'configuration_snapshot', 'environment_policy']) delete old[k];
  validatePlatformProjection(row, old, f.receipt); assert.throws(() => validatePlatformProjection({ ...row, attempts: 2 }, old, f.receipt), /PLATFORM_PROJECTION_CHANGED/);
});
test('controller exposes one create and one transaction; no private load, IAM/DNS/DDB write, provision or app retry', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/review-express-hosting-resume-v1.mjs', import.meta.url), 'utf8');
  assert.equal((text.match(/new CreateStackCommand\(/g) || []).length, 1); assert.equal((text.match(/await sql\.transaction\(/g) || []).length, 1);
  assert.doesNotMatch(text, /new (?:DeleteStack|UpdateStack|ExecuteChangeSet|GetSecretValue|PutItem|ChangeResourceRecordSets|CreateRole)Command|openReadyReader|\.provision\(/);
  assert.match(text, /save\(H\.slot/); assert.match(text, /save\(H\.writeSlot/); assert.match(text, /save\(H\.inspectSlot/);
  const inspect = text.slice(text.indexOf("} else if (mode === 'Inspect')"), text.indexOf("} else {\n      const hosting"));
  assert.doesNotMatch(inspect, /publicGet\(/); assert.match(text, /POLL_LIMIT/);
});
test('observer validates actual repaired revision :2 against pinned K2c spec without reusing the :1 old-image transformer', async () => {
  const text = await readFile(new URL('../ops/aws-sandbox/scripts/express-hosting-resume-observer-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /expectedTaskProjection/); assert.match(text, /expectedTaskSha256 === priorTaskSha256/);
  assert.match(text, /taskProjection\(td\.taskDefinition\)/);
});
