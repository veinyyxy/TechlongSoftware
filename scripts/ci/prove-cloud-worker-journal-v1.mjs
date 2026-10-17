// GitHub-owned disposable DynamoDB Local only. Never reads AWS Login, env files,
// Neon or private application material. Real conditional/transaction API calls.
import assert from 'node:assert/strict';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, DescribeLimitsCommand,
  DescribeTimeToLiveCommand, PutItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { openCloudWorkerJournalV1, CLOUD_WORKER_JOURNAL_V1 as C, CLOUD_WORKER_ENTRIES_V1 as ENTRIES } from '../../lib/deployments/execution/cloud-worker-journal-v1.ts';
import { journalBinding, JOURNAL_TABLE_ID, JOURNAL_NOW } from '../../tests/fixtures/cloud-worker-journal-v1.ts';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CI-only disposable proof');
assert.equal(process.env.CI, 'true');
assert.ok(!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY && !process.env.AWS_SESSION_TOKEN && !process.env.AWS_PROFILE);
const signal = AbortSignal.timeout(90000), groups = [], commands = [];
const client = new DynamoDBClient({ region: C.region, endpoint: 'http://127.0.0.1:8000', maxAttempts: 1,
  credentials: { accessKeyId: 'DUMMYLOCAL', secretAccessKey: 'DUMMYLOCALNOTANAWSCREDENTIAL' } });
const send = command => client.send(command, { abortSignal: signal });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  // Readiness reads only, not retries of a mutation/slot/effect.
  let ready = false;
  for (let n = 0; n < 20; n++) {
    try { await send(new DescribeLimitsCommand({})); ready = true; break; } catch { await sleep(500); }
  }
  assert.ok(ready, 'DynamoDB Local must start');
  await send(new CreateTableCommand({ TableName: C.tableName, BillingMode: 'PAY_PER_REQUEST', DeletionProtectionEnabled: true,
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }] }));
  const observed = (await send(new DescribeTableCommand({ TableName: C.tableName }))).Table;
  assert.equal(observed?.TableStatus, 'ACTIVE');
  // DynamoDB Local lacks real AWS account/ARN/TableId identity. Translate ONLY
  // those metadata/target differences; expression evaluation is the service's.
  // This proof explicitly does NOT attest AWS identity, IAM, TLS or durability.
  const localTableId = observed.TableId ?? JOURNAL_TABLE_ID;
  const port = { async send(command, abortSignal) {
    commands.push(command.constructor.name);
    const input = structuredClone(command.input);
    if (input.TableName) { assert.equal(input.TableName, C.tableArn); input.TableName = C.tableName; }
    for (const t of input.TransactItems ?? []) for (const operation of Object.values(t)) {
      assert.equal(operation.TableName, C.tableArn); operation.TableName = C.tableName;
    }
    const response = await client.send(new command.constructor(input), { abortSignal });
    if (command instanceof DescribeTableCommand) return { ...response, Table: { ...response.Table,
      TableArn: C.tableArn, TableId: localTableId } };
    return response;
  } };
  const open = (b, p = port) => openCloudWorkerJournalV1({ binding: b, tableId: localTableId, port: p, signal, now: () => JOURNAL_NOW });

  const b = journalBinding('a'), j = await open(b);
  assert.equal((await j.inspect()).state, 'ABSENT');
  for (const e of ENTRIES) await j.consume(e, b.actions[e]);
  const complete = await (await open(b)).inspect();
  assert.equal(complete.state, 'ALL_SLOTS_CONSUMED'); assert.equal(complete.executionSucceededProved, false);
  groups.push('five-stage-conditional-transaction-chain-and-independent-snapshot');

  const duplicate = await open(b);
  await assert.rejects(duplicate.consume('run', b.manifestSha256), /INSPECT_REQUIRED_NO_RETRY/);
  groups.push('fresh-process-duplicate-denied');

  const changed = structuredClone(b); changed.manifestSha256 = '9'.repeat(64); changed.actions.run = changed.manifestSha256;
  changed.requestId = '8'.repeat(64); changed.run.runAttempt++;
  await assert.rejects((await open(changed)).consume('run', changed.manifestSha256), /INSPECT_REQUIRED_NO_RETRY/);
  assert.equal((await (await open(changed)).inspect()).state, 'UNKNOWN_OR_CONFLICT');
  groups.push('new-manifest-request-or-run-attempt-cannot-reopen-job');

  const race = journalBinding('b'), first = await open(race), second = await open(race);
  const results = await Promise.allSettled([first.consume('run', race.manifestSha256), second.consume('run', race.manifestSha256)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  groups.push('concurrent-processes-exactly-one-slot-ack');

  const lost = journalBinding('c'); let attempts = 0;
  const lossy = { async send(command, abortSignal) {
    const r = await port.send(command, abortSignal);
    if (command instanceof PutItemCommand) { attempts++; throw Error('ACK lost after real service commit'); }
    return r;
  } };
  await assert.rejects((await open(lost, lossy)).consume('run', lost.manifestSha256), /INSPECT_REQUIRED_NO_RETRY/);
  assert.equal(attempts, 1);
  assert.equal((await (await open(lost)).inspect()).state, 'PARTIAL');
  await assert.rejects((await open(lost)).consume('run', lost.manifestSha256));
  await assert.rejects((await open(lost)).consume('claim_job', lost.actions.claim_job));
  groups.push('committed-ack-loss-visible-no-resume-or-retry');

  // Force real server rejection: wrong predecessor binding in the production
  // transaction. The slot being Put must not leak out of the rejected txn.
  const failed = journalBinding('d'); let changedTransaction = false;
  const rejectTxn = { async send(command, abortSignal) {
    if (command instanceof TransactWriteItemsCommand) {
      const request = structuredClone(command.input);
      request.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':binding'] = { S: 'not-the-binding' };
      changedTransaction = true; return port.send(new TransactWriteItemsCommand(request), abortSignal);
    }
    return port.send(command, abortSignal);
  } };
  const transactional = await open(failed, rejectTxn);
  await transactional.consume('run', failed.manifestSha256);
  await assert.rejects(transactional.consume('claim_job', failed.actions.claim_job), /INSPECT_REQUIRED_NO_RETRY/);
  assert.ok(changedTransaction);
  const partial = await (await open(failed)).inspect();
  assert.deepEqual(partial.consumed.map(r => r.entry), ['run']);
  groups.push('failed-predecessor-condition-atomically-prevents-next-slot');

  const expired = journalBinding('e'); expired.expiresAt = JOURNAL_NOW; expired.notBefore = JOURNAL_NOW - 60000;
  await assert.rejects((await open(expired)).consume('run', expired.manifestSha256));
  assert.equal((await (await open(expired)).inspect()).state, 'ABSENT');
  groups.push('expired-binding-never-writes');

  assert.ok(commands.every(n => ['DescribeTableCommand', 'DescribeTimeToLiveCommand', 'PutItemCommand',
    'TransactWriteItemsCommand', 'TransactGetItemsCommand'].includes(n)));
  assert.equal((await send(new DescribeTimeToLiveCommand({ TableName: C.tableName }))).TimeToLiveDescription.TimeToLiveStatus, 'DISABLED');
  console.log(JSON.stringify({ schema: 'techlong/cloud-worker-journal-ci-proof/v1', outcome: 'PASSED', groups,
    groupCount: groups.length, gitCommit: process.env.GITHUB_SHA, githubRunId: process.env.GITHUB_RUN_ID,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT, service: 'DynamoDB Local 3.3.2',
    realAwsCalls: 0, neonCalls: 0, privateMaterialReads: 0, actualDeployments: 0,
    awsIdentityVerified: false, productionDurabilityVerified: false, workerActivated: false }, null, 2));
} finally { client.destroy(); }
