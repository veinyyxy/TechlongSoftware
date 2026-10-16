import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exitAssessment, allowedRead, parseReadOutput } from '../ops/aws-sandbox/scripts/inventory-express-exit-v1.mjs';
import { H } from '../ops/aws-sandbox/scripts/express-hosting-resume-plan-v1.mjs';

const fixture = () => ({ expiresAt: '2026-10-16T15:37:01.033Z', observedAt: '2026-10-16T16:00:00Z', stackStatus: 'DELETE_COMPLETE',
  service: { runningCount: 0, pendingCount: 0, desiredCount: 0 }, taskCount: 0, physicalReferencesAbsent: true,
  resources: Object.entries(H.resources).map(([LogicalResourceId, ResourceType]) => ({ LogicalResourceId, ResourceType, ResourceStatus: 'DELETE_COMPLETE' })) });
test('TTL or CFN alone never proves physical exit or stop billing', () => {
  const f = fixture(); f.stackStatus = 'CREATE_COMPLETE'; f.service.runningCount = 1;
  const r = exitAssessment(f); assert.equal(r.expired, true); assert.equal(r.workloadExitProved, false); assert.equal(r.fullStopBillingProved, false);
  const g = fixture(); g.physicalReferencesAbsent = false; assert.equal(exitAssessment(g).workloadExitProved, false);
});
test('exit requires exact seven resources, zero compute and independently absent references', () => {
  assert.equal(exitAssessment(fixture()).workloadExitProved, true);
  for (const mutate of [f => { f.resources.pop(); }, f => { f.resources[0].ResourceType = 'wrong'; }, f => { f.taskCount = undefined; }, f => { f.service.pendingCount = 1; }]) {
    const f = fixture(); mutate(f); assert.equal(exitAssessment(f).workloadExitProved, false);
  }
  assert.equal(exitAssessment(fixture()).dataDeletionAuthorized, false); assert.equal(exitAssessment(fixture()).parentDeletionAuthorized, false);
});
test('read allowlist excludes mutation, private values and account upgrade', () => {
  for (const args of [['cloudformation', 'delete-stack'], ['ecs', 'update-service'], ['secretsmanager', 'get-secret-value'], ['freetier', 'upgrade-account-plan'], ['ce', 'get-cost-and-usage']]) assert.equal(allowedRead(args), false);
  assert.equal(allowedRead(['freetier', 'get-account-plan-state']), true); assert.equal(allowedRead(['dynamodb', 'get-item']), true);
});
test('only successful GetItem can have an empty CLI body; other empty/invalid JSON is not absence', () => {
  assert.deepEqual(parseReadOutput('  \n', ['dynamodb', 'get-item']), {});
  assert.deepEqual(parseReadOutput('{"Item":{"key":{"S":"fixed"}}}', ['dynamodb', 'get-item']), { Item: { key: { S: 'fixed' } } });
  assert.throws(() => parseReadOutput('', ['cloudformation', 'describe-stacks']), SyntaxError);
  assert.throws(() => parseReadOutput('invalid', ['dynamodb', 'get-item']), SyntaxError);
});
test('inventory is bounded, non-overwriting, no automatic monitor or application request', async () => {
  const src = await readFile(new URL('../ops/aws-sandbox/scripts/inventory-express-exit-v1.mjs', import.meta.url), 'utf8');
  assert.match(src, /\+\+cliReads <= 38/); assert.match(src, /AWS_MAX_ATTEMPTS: '1'/); assert.match(src, /await mkdir\(out\)/);
  assert.match(src, /creditAmountOmitted: true/); assert.match(src, /invoiceOrCostExplorerRead: false/);
  assert.equal(src.includes('GetSecretValueCommand'), false); assert.equal(src.includes('readOnly: false'), false);
});
