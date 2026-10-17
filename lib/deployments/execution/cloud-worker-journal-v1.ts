import {
  DynamoDBClient, DescribeTableCommand, DescribeTimeToLiveCommand,
  PutItemCommand, TransactWriteItemsCommand, TransactGetItemsCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { canonicalJson, sha256Hex } from './hash.ts';

export const CLOUD_WORKER_JOURNAL_V1 = Object.freeze({
  region: 'ca-central-1',
  tableName: 'techlong-sandbox-deployment-worker-journal-v1',
  tableArn: 'arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-deployment-worker-journal-v1',
  repository: 'veinyyxy/TechlongSoftware',
  protocol: 'techlong/cloud-worker-journal/v1',
});
export const CLOUD_WORKER_ENTRIES_V1 = Object.freeze([
  'run', 'claim_job', 'create_workload', 'private_control_load', 'atomic_complete',
] as const);
export type CloudWorkerEntryV1 = typeof CLOUD_WORKER_ENTRIES_V1[number];
export interface CloudWorkerBindingV1 {
  jobId: string; requestId: string; manifestSha256: string; codeSha256: string;
  predecessorReceiptSha256: string; notBefore: number; expiresAt: number;
  run: { repository: string; runId: string; runAttempt: number; commitSha: string };
  /** Reviewed action/contract digests. The atomic-completion EFFECT is only
   * known after the provider/readback; it is separately recorded at consume. */
  actions: Record<CloudWorkerEntryV1, string>;
}
type JournalCommand = DescribeTableCommand | DescribeTimeToLiveCommand | PutItemCommand |
  TransactWriteItemsCommand | TransactGetItemsCommand;
export interface CloudWorkerJournalPortV1 {
  /** Test seam. Production must use the explicit-credential factory below. */
  send(command: JournalCommand, signal: AbortSignal): Promise<unknown>;
}
type Item = Record<string, AttributeValue>;
const S = (value: string): AttributeValue => ({ S: value });
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function must(ok: unknown): asserts ok { if (!ok) throw Error('CLOUD_WORKER_JOURNAL_REJECTED'); }
function inspectRequired(): never { throw Error('CLOUD_WORKER_JOURNAL_INSPECT_REQUIRED_NO_RETRY'); }
function keys(v: unknown, expected: string[]) {
  must(v && typeof v === 'object' && !Array.isArray(v) &&
    canonicalJson(Object.keys(v).sort()) === canonicalJson([...expected].sort()));
}
function validateBinding(b: CloudWorkerBindingV1) {
  keys(b, ['jobId', 'requestId', 'manifestSha256', 'codeSha256', 'predecessorReceiptSha256', 'notBefore', 'expiresAt', 'run', 'actions']);
  keys(b.run, ['repository', 'runId', 'runAttempt', 'commitSha']); keys(b.actions, [...CLOUD_WORKER_ENTRIES_V1]);
  must(/^job_[a-f0-9]{24}$/.test(b.jobId) && [b.requestId, b.manifestSha256, b.codeSha256, b.predecessorReceiptSha256,
    ...Object.values(b.actions)].every(hash) && b.actions.run === b.manifestSha256);
  must(b.run.repository === CLOUD_WORKER_JOURNAL_V1.repository && /^[1-9][0-9]{0,19}$/.test(b.run.runId) &&
    Number.isSafeInteger(b.run.runAttempt) && b.run.runAttempt > 0 && /^[a-f0-9]{40}$/.test(b.run.commitSha));
  must(Number.isSafeInteger(b.notBefore) && b.notBefore > 0 && Number.isSafeInteger(b.expiresAt) &&
    b.expiresAt > b.notBefore && b.expiresAt - b.notBefore <= 3600000);
}
function key(jobId: string, entry: CloudWorkerEntryV1): Item {
  // NOT keyed by manifest, attempt, generation or nonce: those cannot reopen a job.
  return { pk: S(`JOB#${jobId}`), sk: S(`STAGE#${entry}`) };
}
const C = CLOUD_WORKER_JOURNAL_V1;

/** Opens only existing, separately approved infrastructure (two metadata reads).
 * It does not validate a deployment manifest, original admin, AWS caller or job
 * lease. Those remain mandatory in the future cloud composition root. */
export async function openCloudWorkerJournalV1(input: {
  binding: CloudWorkerBindingV1; tableId: string; port: CloudWorkerJournalPortV1;
  signal: AbortSignal; now?: () => number;
}) {
  const b = structuredClone(input.binding), now = input.now ?? Date.now;
  validateBinding(b);
  must(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.tableId));
  const tableId = input.tableId, bindingJson = canonicalJson(b), bindingSha256 = await sha256Hex(b);
  const call = async (command: JournalCommand) => {
    input.signal.throwIfAborted();
    const result = await input.port.send(command, input.signal);
    input.signal.throwIfAborted(); return result;
  };
  try {
    const { Table: t } = await call(new DescribeTableCommand({ TableName: C.tableArn })) as { Table?: Record<string, unknown> };
    must(t && t.TableId === tableId && t.TableArn === C.tableArn && t.TableName === C.tableName &&
      t.TableStatus === 'ACTIVE' && t.DeletionProtectionEnabled === true &&
      canonicalJson(t.KeySchema) === canonicalJson([{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }]) &&
      Array.isArray(t.AttributeDefinitions) && canonicalJson([...t.AttributeDefinitions].sort((a, d) => a.AttributeName.localeCompare(d.AttributeName))) ===
        canonicalJson([{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }]) &&
      ['Replicas', 'GlobalSecondaryIndexes', 'LocalSecondaryIndexes'].every(k => !t[k] || (Array.isArray(t[k]) && t[k].length === 0)));
    const { TimeToLiveDescription: ttl } = await call(new DescribeTimeToLiveCommand({ TableName: C.tableArn })) as {
      TimeToLiveDescription?: { TimeToLiveStatus?: string; AttributeName?: string };
    };
    must(ttl?.TimeToLiveStatus === 'DISABLED' && !ttl.AttributeName);
  } catch { inspectRequired(); }

  let next = 0, busy = false, halted = false;
  const item = (entry: CloudWorkerEntryV1, effectSha256: string, attemptedAt: number): Item => ({
    ...key(b.jobId, entry), protocol: S(C.protocol), tableId: S(tableId), binding: S(bindingJson),
    bindingSha256: S(bindingSha256), entry: S(entry), actionSha256: S(b.actions[entry]), effectSha256: S(effectSha256),
    attemptedAt: { N: String(attemptedAt) }, state: S('CONSUMED_BEFORE_ATTEMPT'), retryAllowed: { BOOL: false },
  });
  return Object.freeze({
    bindingSha256, runtimeEnabled: false as const,
    /** Consume BEFORE effect. ACK is permission to proceed once in this process,
     * not proof of effect completion. Never resume from a persisted slot. */
    async consume(entry: CloudWorkerEntryV1, effectSha256: string) {
      if (busy || halted || entry !== CLOUD_WORKER_ENTRIES_V1[next] || !hash(effectSha256) ||
        (entry === 'run' && effectSha256 !== b.manifestSha256)) { halted = true; must(false); }
      busy = true;
      try {
        const at = now();
        must(Number.isSafeInteger(at) && at >= b.notBefore && at < b.expiresAt);
        const record = item(entry, effectSha256, at);
        const put = { TableName: C.tableArn, Item: record,
          ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } };
        if (next === 0) await call(new PutItemCommand(put));
        else await call(new TransactWriteItemsCommand({ TransactItems: [
          { ConditionCheck: { TableName: C.tableArn, Key: key(b.jobId, CLOUD_WORKER_ENTRIES_V1[next - 1]),
            ConditionExpression: '#binding = :binding AND #table = :table AND #state = :state',
            ExpressionAttributeNames: { '#binding': 'binding', '#table': 'tableId', '#state': 'state' },
            ExpressionAttributeValues: { ':binding': S(bindingJson), ':table': S(tableId), ':state': S('CONSUMED_BEFORE_ATTEMPT') } } },
          { Put: put },
        ] })); // No client token or retry: a duplicate must NOT return a fresh ACK.
        const acknowledgedAt = now();
        must(!halted && Number.isSafeInteger(acknowledgedAt) && acknowledgedAt >= at && acknowledgedAt < b.expiresAt); next++;
        return Object.freeze({ entry, actionSha256: b.actions[entry], effectSha256, bindingSha256,
          state: 'CONSUMED_BEFORE_ATTEMPT' as const, executionSucceededProved: false as const, retryAllowed: false as const });
      } catch { halted = true; inspectRequired(); }
      finally { busy = false; }
    },
    /** One transactional snapshot of five items, including after deadline/error.
     * ABSENT is observation only, never authority to reset/retry a prior effect. */
    async inspect() {
      try {
        const r = await call(new TransactGetItemsCommand({ TransactItems: CLOUD_WORKER_ENTRIES_V1.map(entry => ({
          Get: { TableName: C.tableArn, Key: key(b.jobId, entry) },
        })) })) as { Responses?: { Item?: Item }[] };
        must(Array.isArray(r.Responses) && r.Responses.length === CLOUD_WORKER_ENTRIES_V1.length);
        let gap = false;
        const consumed: { entry: CloudWorkerEntryV1; effectSha256: string; attemptedAt: number }[] = [];
        for (let i = 0; i < r.Responses.length; i++) {
          const record = r.Responses[i].Item;
          if (!record) { gap = true; continue; }
          const entry = CLOUD_WORKER_ENTRIES_V1[i], effect = record.effectSha256?.S, at = Number(record.attemptedAt?.N);
          must(!gap && hash(effect) && Number.isSafeInteger(at) && at >= b.notBefore && at < b.expiresAt &&
            (entry !== 'run' || effect === b.manifestSha256) && canonicalJson(record) === canonicalJson(item(entry, effect, at)));
          consumed.push({ entry, effectSha256: effect, attemptedAt: at });
        }
        return Object.freeze({ state: consumed.length === 0 ? 'ABSENT' : consumed.length === 5 ? 'ALL_SLOTS_CONSUMED' : 'PARTIAL',
          consumed, bindingSha256, executionSucceededProved: false as const, retryAllowed: false as const });
      } catch {
        halted = true;
        return Object.freeze({ state: 'UNKNOWN_OR_CONFLICT', consumed: [], bindingSha256,
          executionSucceededProved: false as const, retryAllowed: false as const });
      }
    },
  });
}

/** Explicit short-lived credentials only. No default chain, AWS Login, profile,
 * disk paths, CLI, endpoint override or SDK retry. Not an IAM installer/root. */
export async function openDynamoCloudWorkerJournalV1(input: {
  binding: CloudWorkerBindingV1; tableId: string; signal: AbortSignal;
  credentials: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date }>;
}) {
  must(typeof input.credentials === 'function');
  const client = new DynamoDBClient({ region: C.region, endpoint: `https://dynamodb.${C.region}.amazonaws.com`, maxAttempts: 1,
    credentials: async () => {
      const c = await input.credentials();
      must(c && typeof c.accessKeyId === 'string' && c.accessKeyId.startsWith('ASIA') &&
        typeof c.secretAccessKey === 'string' && !!c.secretAccessKey && typeof c.sessionToken === 'string' && !!c.sessionToken &&
        c.expiration instanceof Date && c.expiration.getTime() > Date.now() + 60000);
      return c;
    },
  });
  try {
    const journal = await openCloudWorkerJournalV1({ ...input, port: { send: (command, signal) => {
      const options = { abortSignal: signal };
      if (command instanceof DescribeTableCommand) return client.send(command, options);
      if (command instanceof DescribeTimeToLiveCommand) return client.send(command, options);
      if (command instanceof PutItemCommand) return client.send(command, options);
      if (command instanceof TransactWriteItemsCommand) return client.send(command, options);
      return client.send(command, options);
    } } });
    return Object.freeze({ ...journal, dispose() { client.destroy(); } });
  } catch { client.destroy(); inspectRequired(); }
}
