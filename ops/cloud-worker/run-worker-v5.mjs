import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudApplicationV5 } from './cloud-application-v5.mjs';
import { computeCloudClosureV5 } from './closure-v5.mjs';
import { loadNeonContractV5, renderNeonContractV5 } from './neon-contract-v5.mjs';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
const getArgs = args => {
  const result = {}; must(args.length % 2 === 0, 'CLI_ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) { must(/^--[a-z-]+$/.test(args[i]) && !Object.hasOwn(result, args[i].slice(2)), 'CLI_ARGUMENTS'); result[args[i].slice(2)] = args[i + 1]; }
  return result;
};
async function publicJson(file) {
  must(file && path.extname(file) === '.json', 'PUBLIC_JSON_REQUIRED'); const resolved = await realpath(file);
  const allowed = await Promise.all([process.env.GITHUB_WORKSPACE, process.env.RUNNER_TEMP].map(p => realpath(p)));
  must(allowed.some(root => { const p = path.relative(root, resolved); return p && !p.startsWith('..') && !path.isAbsolute(p); }), 'RUNNER_PUBLIC_INPUT_PATH');
  const data = await readFile(resolved, 'utf8'); must(Buffer.byteLength(data) <= 1000000, 'PUBLIC_JSON_SIZE'); return JSON.parse(data);
}
export async function mainV5(args = process.argv.slice(2)) {
  const a = getArgs(args), closure = await computeCloudClosureV5(), contract = await loadNeonContractV5();
  must(['CheckCandidate','Review','RunOnce','Inspect'].includes(a.mode), 'CLI_MODE');
  if (a.mode === 'CheckCandidate') {
    must(Object.keys(a).length === 1, 'CHECK_HAS_NO_LIVE_ARGUMENTS');
    const result = { mode: a.mode, schema: 'techlong/cloud-worker-root-candidate/v5', closureSha256: closure.closureSha256,
      contractSha256: contract.contractSha256, sqlSha256: await sha256Hex(renderNeonContractV5(contract).statements),
      databaseFunctions: renderNeonContractV5(contract).functions.map(f => f.name),
      rootModes: ['Review','RunOnce','Inspect'], installed: false, runtimeEnabled: false, cloudCalls: 0, privateReads: 0, dbQueries: 0 };
    console.log(JSON.stringify(result, null, 2)); return result;
  }
  const required = ['mode','installation','approved-installation-sha', ...(a.mode === 'Review' ? ['job'] :
    a.mode === 'RunOnce' ? ['manifest','approved-manifest-sha'] : ['manifest','execution-reference'])];
  must(required.every(k => typeof a[k] === 'string' && a[k]) && Object.keys(a).every(k => required.includes(k) || k === 'lineage'), 'LIVE_ARGUMENT_SET');
  must(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === 'veinyyxy/TechlongSoftware' &&
    process.env.GITHUB_REF === 'refs/heads/main' && /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA) &&
    process.env.GITHUB_WORKFLOW_REF === 'veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-execute.yml@refs/heads/main', 'REVIEWED_GITHUB_WORKFLOW_REQUIRED');
  const run = { repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), commitSha: process.env.GITHUB_SHA };
  const app = await createCloudApplicationV5({
    capsule: JSON.parse(await readFile(new URL('./material/public-capsule-v5.json', import.meta.url), 'utf8')),
    links: a.lineage ? await publicJson(a.lineage) : [], installation: await publicJson(a.installation),
    approvedInstallationSha256: a['approved-installation-sha'], code: { commitSha: run.commitSha, closureSha256: closure.closureSha256 }, run,
    credentials: async () => ({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN, expiration: new Date(process.env.TECHLONG_AWS_CREDENTIAL_EXPIRATION) }),
  });
  try {
    const signal = AbortSignal.timeout(3600000); let result;
    if (a.mode === 'Review') {
      const r = await app.review({ jobId: a.job, signal }); result = { manifestSha256: r.manifest.manifestSha256, saved: r.saved, executionApproved: false };
    } else {
      const manifest = await publicJson(a.manifest);
      const r = a.mode === 'RunOnce' ? await app.runOnce({ manifest, approvedManifestSha256: a['approved-manifest-sha'], signal }) :
        await app.inspect({ manifest, ...await publicJson(a['execution-reference']), signal });
      result = { outcome: r.report.outcome ?? r.report.result?.outcome, saved: r.saved, retryAllowed: false };
    }
    console.log(JSON.stringify({ mode: a.mode, ...result }, null, 2)); return result;
  } finally { app.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mainV5().catch(() => {
  console.error('CLOUD_WORKER_V5_REQUIRES_INSPECT_NO_RETRY'); process.exitCode = 1;
});
