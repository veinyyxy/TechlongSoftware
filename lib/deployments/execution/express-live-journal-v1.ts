import path from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { assertSafeDeploymentOutput } from '../safety.ts';

const entries = new Set(['admit', 'private_control_load', 'first_claim', 'install_epoch', 'activate_epoch',
  'status_database_preparing', 'status_migrating', 'status_infrastructure_provisioning', 'create_workload', 'create_dns',
  'status_waiting_healthy', 'adopt_verified_schema', 'status_configuring', 'compile_first_owner', 'provision_once',
  'status_verifying', 'atomic_ready', 'database_observe_preflight', 'database_observe_after_bootstrap']);
const notes = new Set(['workload_acknowledged', 'dns_acknowledged', 'independent_ready_verified']);
// Intentionally NOT derived from manifest SHA or child window. New approvals
// cannot sidestep a consumed first-delivery root. Never reset/delete in code.
const directory = 'F:/ChatGPT_workshop/techlong-express-c5h-first-delivery-v1';

export function createExpressLiveJournalV1() {
  const write = async (name: string, value: object) => {
    await mkdir(directory, { recursive: true });
    const handle = await open(path.join(directory, name), 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
  };
  return Object.freeze({
    async consume(entry: string, digest: string) {
      if (!entries.has(entry) || !/^[a-f0-9]{64}$/.test(digest)) throw Error('EXPRESS_JOURNAL_ENTRY_REJECTED');
      await write(entry + '.permanent-slot.json', { schema: 'techlong/express-live-entry/v1', entry, requestSha256: digest,
        enteredAt: new Date().toISOString(), state: 'CONSUMED_BEFORE_ATTEMPT', retryAllowed: false });
    },
    async note(entry: string, evidence: Record<string, unknown>) {
      if (!notes.has(entry)) throw Error('EXPRESS_JOURNAL_NOTE_REJECTED');
      assertSafeDeploymentOutput(evidence);
      await write(entry + '.json', { entry, savedAt: new Date().toISOString(), evidence });
    },
  });
}
