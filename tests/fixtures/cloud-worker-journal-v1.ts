import type { CloudWorkerBindingV1 } from '../../lib/deployments/execution/cloud-worker-journal-v1.ts';
import { CLOUD_WORKER_JOURNAL_V1 as C } from '../../lib/deployments/execution/cloud-worker-journal-v1.ts';

export const JOURNAL_TABLE_ID = '12345678-1234-4234-8234-123456789012';
export const JOURNAL_NOW = Date.parse('2026-10-17T21:00:00Z');
export function journalBinding(suffix = 'a'): CloudWorkerBindingV1 {
  return {
    jobId: 'job_' + suffix.repeat(24), requestId: 'b'.repeat(64), manifestSha256: 'c'.repeat(64),
    codeSha256: 'd'.repeat(64), predecessorReceiptSha256: 'e'.repeat(64),
    notBefore: JOURNAL_NOW - 1000, expiresAt: JOURNAL_NOW + 600000,
    run: { repository: C.repository, runId: '123456789', runAttempt: 1, commitSha: 'f'.repeat(40) },
    actions: { run: 'c'.repeat(64), claim_job: '1'.repeat(64), create_workload: '2'.repeat(64),
      private_control_load: '3'.repeat(64), atomic_complete: '4'.repeat(64) },
  };
}
export function journalMetadata() {
  return { Table: { TableId: JOURNAL_TABLE_ID, TableArn: C.tableArn, TableName: C.tableName, TableStatus: 'ACTIVE',
    DeletionProtectionEnabled: true, KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }] } };
}
