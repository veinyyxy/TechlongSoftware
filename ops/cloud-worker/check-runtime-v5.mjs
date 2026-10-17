// Deliberately NO Run/Review/dispatch/installer until the approved cloud root
// binds exact DB identity, OIDC role, immutable materials and durable journal.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareCloudContextV5 } from './cloud-context-v5.mjs';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
import { createCloudInitializedAwsV5 } from './aws-initialized-workload-v5.mjs';
import { createCloudControlSourcesV5 } from './cloud-control-v5.mjs';
export async function main(args = process.argv.slice(2)) {
  must(args.length === 2 && args[0] === '--mode' && ['CheckRuntime', 'CheckBundle'].includes(args[1]), 'CHECK_ARGUMENTS');
  must(typeof createCloudInitializedAwsV5 === 'function' && typeof createCloudControlSourcesV5 === 'function', 'MODULE_IMPORTS');
  let context;
  if (args[1] === 'CheckBundle') context = await prepareCloudContextV5(JSON.parse(await readFile(new URL('./material/public-capsule-v5.json', import.meta.url), 'utf8')));
  const result = { mode: args[1], state: 'CLOUD_ADAPTER_AND_CONTROL_CONTRACT_READY_NOT_ACTIVATED',
    capsuleSha256: context?.capsuleSha256, predecessor: context?.predecessor, awsCalls: 0, dbQueries: 0, privateReads: 0,
    slotsConsumed: 0, runtimeEnabled: false, runModeAvailable: false, automaticRetries: 0 };
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('CLOUD_WORKER_V5_CHECK_REJECTED'); process.exitCode = 1;
});
