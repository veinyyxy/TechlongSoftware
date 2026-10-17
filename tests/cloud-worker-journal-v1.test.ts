import assert from 'node:assert/strict';
import test from 'node:test';
import { DescribeTableCommand, DescribeTimeToLiveCommand, PutItemCommand, TransactGetItemsCommand,
  TransactWriteItemsCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { CLOUD_WORKER_ENTRIES_V1 as ENTRIES, CLOUD_WORKER_JOURNAL_V1 as C, openCloudWorkerJournalV1,
  type CloudWorkerJournalPortV1 } from '../lib/deployments/execution/cloud-worker-journal-v1.ts';
import { journalBinding, journalMetadata, JOURNAL_NOW, JOURNAL_TABLE_ID } from './fixtures/cloud-worker-journal-v1.ts';

const signal = () => AbortSignal.timeout(10000);
const open = (port: CloudWorkerJournalPortV1, binding = journalBinding(), now = () => JOURNAL_NOW) =>
  openCloudWorkerJournalV1({ port, binding, tableId: JOURNAL_TABLE_ID, signal: signal(), now });
function stub() {
  const calls: string[] = [], items = new Map<string, Record<string, AttributeValue>>();
  let loseAck = false, metadata = journalMetadata();
  const port: CloudWorkerJournalPortV1 = { async send(command) {
    calls.push(command.constructor.name);
    if (command instanceof DescribeTableCommand) return metadata;
    if (command instanceof DescribeTimeToLiveCommand) return { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } };
    if (command instanceof PutItemCommand) {
      assert.equal(command.input.TableName, C.tableArn);
      assert.equal(command.input.ConditionExpression, 'attribute_not_exists(#pk)');
      const item = command.input.Item!;
      const k = item.pk.S! + item.sk.S!;
      if (items.has(k)) throw Error('ConditionalCheckFailedException');
      items.set(k, structuredClone(item));
      if (loseAck) throw Error('private upstream message NEVER expose');
      return {};
    }
    if (command instanceof TransactWriteItemsCommand) {
      assert.equal(command.input.ClientRequestToken, undefined);
      const [check, put] = command.input.TransactItems!;
      assert.match(check.ConditionCheck!.ConditionExpression!, /#binding = :binding/);
      const predecessor = check.ConditionCheck!.Key!, next = put.Put!.Item!;
      const p = items.get(predecessor.pk.S! + predecessor.sk.S!);
      if (!p || p.binding.S !== next.binding.S || items.has(next.pk.S! + next.sk.S!)) throw Error('TransactionCanceledException');
      assert.equal(put.Put!.ConditionExpression, 'attribute_not_exists(#pk)');
      items.set(next.pk.S! + next.sk.S!, structuredClone(next));
      if (loseAck) throw Error('lost ack');
      return {};
    }
    assert.ok(command instanceof TransactGetItemsCommand);
    return { Responses: command.input.TransactItems!.map(t => ({ Item: items.get(t.Get!.Key!.pk.S! + t.Get!.Key!.sk.S!) })) };
  } };
  return { port, calls, items, loseAck() { loseAck = true; }, setMetadata(m: typeof metadata) { metadata = m; } };
}

test('five ordered create-only stages; atomic snapshot is not deployment-success proof', async () => {
  const s = stub(), j = await open(s.port);
  assert.equal((await j.inspect()).state, 'ABSENT');
  for (const e of ENTRIES) await j.consume(e, journalBinding().actions[e]);
  const view = await j.inspect();
  assert.equal(view.state, 'ALL_SLOTS_CONSUMED'); assert.equal(view.executionSucceededProved, false);
  assert.equal(view.retryAllowed, false); assert.equal(j.runtimeEnabled, false);
  assert.deepEqual(view.consumed.map(r => r.entry), ENTRIES);
  assert.equal(s.calls.filter(c => c === 'PutItemCommand').length, 1);
  assert.equal(s.calls.filter(c => c === 'TransactWriteItemsCommand').length, 4);
  for (const r of s.items.values()) assert.equal(Object.keys(r).some(k => /ttl|expire/i.test(k)), false);
  await assert.rejects(j.consume('run', journalBinding().manifestSha256));
});
test('same job cannot reopen with new manifest, run ID, run attempt, request ID or predecessor', async () => {
  const s = stub(), b = journalBinding();
  await (await open(s.port)).consume('run', b.manifestSha256);
  const patches = [
    { requestId: '9'.repeat(64) }, { predecessorReceiptSha256: '9'.repeat(64) },
    { manifestSha256: '9'.repeat(64), actions: { ...b.actions, run: '9'.repeat(64) } },
    { run: { ...b.run, runId: '987654321' } }, { run: { ...b.run, runAttempt: 2 } },
  ];
  for (const patch of patches) {
    const x = { ...b, ...patch }, j = await open(s.port, x);
    await assert.rejects(j.consume('run', x.manifestSha256), /INSPECT_REQUIRED_NO_RETRY/);
    assert.equal((await j.inspect()).state, 'UNKNOWN_OR_CONFLICT');
  }
  assert.equal(s.items.size, 1);
});
test('ACK loss leaves slot and halts same object; new process can only inspect, not resume', async () => {
  const s = stub(), b = journalBinding(), j = await open(s.port);
  s.loseAck();
  await assert.rejects(j.consume('run', b.manifestSha256), /^Error: CLOUD_WORKER_JOURNAL_INSPECT_REQUIRED_NO_RETRY$/);
  await assert.rejects(j.consume('claim_job', b.actions.claim_job));
  const fresh = await open(s.port);
  assert.equal((await fresh.inspect()).state, 'PARTIAL');
  await assert.rejects(fresh.consume('claim_job', b.actions.claim_job));
  assert.equal(s.calls.filter(c => /PutItem|TransactWrite/.test(c)).length, 1);
});
test('bad approval metadata, skipped stage, invalid SHA, expiry and abort send zero writes', async () => {
  const s = stub(), b = journalBinding();
  await assert.rejects(open(s.port, { ...b, unreviewed: true } as typeof b));
  await assert.rejects(open(s.port, { ...b, actions: { ...b.actions, run: '0'.repeat(64) } }));
  for (const [entry, effect] of [['claim_job', b.actions.claim_job], ['run', 'bad'], ['run', '0'.repeat(64)]] as const)
    await assert.rejects((await open(s.port)).consume(entry, effect));
  await assert.rejects((await open(s.port, b, () => b.expiresAt)).consume('run', b.manifestSha256));
  await assert.rejects((await open(s.port, b, () => b.notBefore - 1)).consume('run', b.manifestSha256));
  await assert.rejects(openCloudWorkerJournalV1({ port: s.port, binding: b, tableId: JOURNAL_TABLE_ID, signal: AbortSignal.abort() }));
  assert.equal(s.calls.filter(c => /PutItem|TransactWrite/.test(c)).length, 0);
});
test('table recreation, key mismatch and disabled delete protection fail closed', async () => {
  const s = stub();
  for (const patch of [{ TableId: '87654321-1234-4234-8234-123456789012' }, { TableArn: C.tableArn + '-other' },
    { DeletionProtectionEnabled: false }, { KeySchema: [] }]) {
    const m = journalMetadata(); Object.assign(m.Table, patch); s.setMetadata(m);
    await assert.rejects(open(s.port), /INSPECT_REQUIRED_NO_RETRY/);
  }
  assert.equal(s.calls.filter(c => /PutItem|TransactWrite/.test(c)).length, 0);
});
test('missing/gapped/tampered slots and provider errors never become success or retry authority', async () => {
  const s = stub(), b = journalBinding(), j = await open(s.port);
  await j.consume('run', b.manifestSha256); await j.consume('claim_job', b.actions.claim_job);
  const first = [...s.items.keys()][0]; s.items.delete(first);
  assert.equal((await j.inspect()).state, 'UNKNOWN_OR_CONFLICT');
  const record = [...s.items.values()][0]; record.retryAllowed = { BOOL: true };
  assert.equal((await j.inspect()).state, 'UNKNOWN_OR_CONFLICT');
  assert.equal((await j.inspect()).executionSucceededProved, false);
});
test('TTL enabling/disabled-with-old-attribute and replicated/indexed tables are rejected before writes', async () => {
  for (const ttl of [{ TimeToLiveStatus: 'ENABLED', AttributeName: 'expires' },
    { TimeToLiveStatus: 'DISABLING', AttributeName: 'expires' }, { TimeToLiveStatus: 'DISABLED', AttributeName: 'expires' }]) {
    const s = stub(), port: CloudWorkerJournalPortV1 = { send: (c, signal) => c instanceof DescribeTimeToLiveCommand ?
      Promise.resolve({ TimeToLiveDescription: ttl }) : s.port.send(c, signal) };
    await assert.rejects(open(port), /INSPECT_REQUIRED_NO_RETRY/);
    assert.equal(s.calls.filter(c => /PutItem|TransactWrite/.test(c)).length, 0);
  }
  for (const field of ['Replicas', 'GlobalSecondaryIndexes', 'LocalSecondaryIndexes']) {
    const s = stub(), m = journalMetadata(); Object.assign(m.Table, { [field]: [{ unapproved: true }] }); s.setMetadata(m);
    await assert.rejects(open(s.port), /INSPECT_REQUIRED_NO_RETRY/);
  }
});
test('ACK arriving after deadline consumes fence but never permits an effect; expired Inspect still works', async () => {
  const s = stub(), b = journalBinding(); let now = JOURNAL_NOW;
  const port: CloudWorkerJournalPortV1 = { async send(c, signal) {
    const response = await s.port.send(c, signal);
    if (c instanceof PutItemCommand) now = b.expiresAt;
    return response;
  } };
  const j = await open(port, b, () => now);
  await assert.rejects(j.consume('run', b.manifestSha256), /INSPECT_REQUIRED_NO_RETRY/);
  assert.equal((await j.inspect()).state, 'PARTIAL');
  await assert.rejects(j.consume('claim_job', b.actions.claim_job));
  assert.equal(s.items.size, 1);
});
