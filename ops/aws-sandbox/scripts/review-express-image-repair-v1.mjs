import path from 'node:path';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { UpdateStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { C, canonical, hash, same, demand, makeRequest, checkWindow } from './express-image-repair-plan-v1.mjs';
import { clients, observe } from './express-image-repair-observer-v1.mjs';

const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop';
const HISTORY = [
  ['F:/ChatGPT_workshop/techlong-express-c5h-review-20261015-r3/manifest.json', 'd31d1f84e81da596b2648dff6712ce159a88715e4fceed8de1c7082dc56b77e9'],
  ['F:/ChatGPT_workshop/techlong-express-c5h-run-20261015-r2/run-preflight.json', '126b188a2976ea0964e7521820805273f5a4c9edd9f9f9fd98d0bc137beb5c74'],
  ['F:/ChatGPT_workshop/techlong-c5i-publication-inspect-20261015-r1/result.json', '2d50d46481cab0f5932eb49d6b407d08d71aad84b91b077b4f9421de2dd3ca12'],
];
async function localInputs() {
  const values = [];
  for (const [p, expected] of HISTORY) { const raw = await readFile(p); demand(hash(raw) === expected, 'HISTORY_CHANGED'); values.push(JSON.parse(raw)); }
  const files = ['ops/aws-sandbox/scripts/express-image-repair-plan-v1.mjs',
    'ops/aws-sandbox/scripts/express-image-repair-observer-v1.mjs', 'ops/aws-sandbox/scripts/review-express-image-repair-v1.mjs',
    'package.json', 'package-lock.json', C.risk, 'ops/aws-sandbox/reviews/aurora-dual-mode-c5i-publication.executed.json'];
  const pins = [];
  for (const file of files) pins.push({ file, rawFileSha256: hash(await readFile(path.join(ROOT, file))) });
  return { historical: values[0], historicalPreflight: values[1], binding: { pins, history: HISTORY },
    request: makeRequest(values[0]) };
}
async function unoccupied() {
  try { await access(C.slot); throw Error('IMAGE_REPAIR_PERMANENT_SLOT_OCCUPIED_NO_RETRY'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function saveFile(file, value) {
  const f = await open(file, 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
}
function manifestPath(file) {
  const resolved = path.resolve(file || '');
  demand(path.basename(resolved) === 'manifest.json' && path.dirname(path.dirname(resolved)).toLowerCase() === path.resolve(BASE).toLowerCase() &&
    /^techlong-express-c5j-[a-z0-9-]+$/.test(path.basename(path.dirname(resolved))), 'MANIFEST_PATH');
  return resolved;
}
export async function main(raw = process.argv.slice(2)) {
  demand(raw.length % 2 === 0, 'ARGUMENTS');
  const pairs = []; for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
  const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
  const keys = mode === 'Review' ? ['--mode', '--output'] : ['--mode', '--output', '--manifest', '--approved-sha'];
  demand(['Review', 'Run', 'Inspect'].includes(mode) && pairs.length === keys.length && new Set(pairs.map(p => p[0])).size === pairs.length &&
    keys.every(k => args[k]) && Object.keys(args).every(k => keys.includes(k)), 'ARGUMENTS');
  demand(path.dirname(out).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-c5j-[a-z0-9-]+$/.test(path.basename(out)), 'OUTPUT_PATH');
  demand(process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase() &&
    !['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CA_BUNDLE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PGHOST', 'PGPASSWORD', 'PGUSER', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE']
      .some(k => process.env[k]) && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' &&
    !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out);
  const save = (name, value) => saveFile(path.join(out, name), value);
  let api, phase = 'local', consumed = false;
  try {
    const input = await localInputs(); await save('binding.json', input.binding);
    if (mode !== 'Inspect') await unoccupied();
    let manifest;
    if (mode !== 'Review') {
      manifest = JSON.parse(await readFile(manifestPath(args['--manifest']), 'utf8'));
      const { manifestSha256, ...body } = manifest;
      demand(/^[0-9a-f]{64}$/.test(args['--approved-sha']) && manifestSha256 === args['--approved-sha'] && hash(body) === manifestSha256 &&
        manifest.schema === 'techlong/express-image-repair-manifest/v1' && same(manifest.binding, input.binding) && same(manifest.request, input.request),
      'EXACT_APPROVAL_CLOSURE');
      if (mode === 'Run') checkWindow(manifest, Date.now());
    }
    api = clients();
    if (mode === 'Review') {
      phase = 'readonly_review';
      const observation = await observe({ ...input, api, phase: 'before', signal: AbortSignal.timeout(180000) });
      await save('observation.json', observation);
      const preparedAt = Date.now();
      const body = { schema: 'techlong/express-image-repair-manifest/v1', preparedAt, admissionExpiresAt: preparedAt + 2 * 3600000,
        binding: input.binding, request: input.request, baseline: observation.baseline, observationSha256: hash(observation),
        limits: { sourceUpdateStackCalls: 1, directEcsWrites: 0, iamWrites: 0, SQLConnections: 0, operatorSecretReads: 0,
          applicationRequests: 0, platformWrites: 0, automaticWriteRetries: 0, maximumWaitMinutes: 30 },
        existingExpiredTagsUnchanged: true, existingExpiredJobLeaseNotRenewed: true, providerRollbackEnabled: true,
        runtimeSecretInjectionByEcsUnchanged: true, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false,
        feeAutoStopInstalled: false, resourcesContinueBilling: true, readyVerified: false, reviewIsNotExecutionApproval: true };
      manifest = { ...body, manifestSha256: hash(body) }; await save('manifest.json', manifest);
      const result = { mode, outcome: 'REVIEWED_REQUIRES_EXACT_HUMAN_APPROVAL', directory: out, manifestSha256: manifest.manifestSha256,
        admissionExpiresAt: new Date(manifest.admissionExpiresAt).toISOString(), sdkReads: observation.sdkReads, cliReads: observation.cliReads,
        actualWrites: 0, SQLConnections: 0, operatorSecretReads: 0, permanentSlotsConsumed: 0 };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2)); return;
    }
    if (mode === 'Run') {
      phase = 'fresh_readonly_preflight';
      const before = await observe({ ...input, api, phase: 'before', signal: AbortSignal.timeout(180000) });
      await save('preflight.json', before);
      demand(same(before.baseline, manifest.baseline), 'BASELINE_DRIFT');
      // Recheck source/risk/dependency bytes immediately before the sole write.
      const final = await localInputs();
      demand(same(input.binding, final.binding) && same(input.request, final.request), 'CODE_CHANGED_DURING_READS');
      checkWindow(manifest, Date.now()); demand(Date.now() - before.checkedAt <= 30000, 'FINAL_FACT_WINDOW');
      phase = 'consume_unique_slot';
      await saveFile(C.slot, { schema: 'techlong/express-image-repair-slot/v1', manifestSha256: manifest.manifestSha256,
        requestSha256: hash(input.request), clientRequestToken: input.request.ClientRequestToken, consumedAt: new Date().toISOString(), retryAllowed: false });
      consumed = true; phase = 'update_submission';
      const response = await api.cfn.send(new UpdateStackCommand(input.request), { abortSignal: AbortSignal.timeout(30000) });
      demand(response.StackId === C.stack, 'UPDATE_ACK_ID');
      await save('submission.json', { stackId: response.StackId, requestId: response.$metadata?.requestId, submittedAt: new Date().toISOString() });
      phase = 'provider_wait'; const deadline = Date.now() + 30 * 60000;
      for (;;) {
        const r = await api.cfn.send(new DescribeStacksCommand({ StackName: C.stack }), { abortSignal: AbortSignal.timeout(30000) });
        const s = r.Stacks?.[0]; demand(s?.StackId === C.stack, 'WAIT_STACK_ID');
        if (s.StackStatus === 'UPDATE_COMPLETE') break;
        demand(s.StackStatus === 'UPDATE_IN_PROGRESS' || s.StackStatus === 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_TERMINAL_INSPECT_ONLY');
        demand(Date.now() < deadline, 'WAIT_TIMEOUT_INSPECT_ONLY');
        console.log(JSON.stringify({ mode, phase, stackStatus: s.StackStatus, retryAllowed: false }));
        await delay(15000);
      }
    } else {
      // A standalone Inspect never infers permission to submit or consumes a slot.
      const slot = JSON.parse(await readFile(C.slot, 'utf8'));
      demand(slot.manifestSha256 === manifest.manifestSha256 && slot.requestSha256 === hash(input.request) &&
        slot.clientRequestToken === input.request.ClientRequestToken, 'INSPECT_SLOT_CORRELATION');
    }
    phase = 'readonly_after';
    const after = await observe({ ...input, api, phase: 'after', baseline: manifest.baseline, signal: AbortSignal.timeout(180000) });
    await save('after.json', after);
    const result = { mode, outcome: mode === 'Inspect' ? 'IMAGE_REPAIR_INDEPENDENTLY_VERIFIED_NOT_INITIALIZED' : 'IMAGE_REPAIR_READBACK_REQUIRES_INDEPENDENT_INSPECT',
      directory: out, manifestSha256: manifest.manifestSha256, taskDefinitionArn: after.taskDefinitionArn, imageDigest: after.actualImageDigest,
      sourceWriteSubmissions: mode === 'Run' ? 1 : 0, SQLConnections: 0, operatorSecretReads: 0, applicationRequests: 0,
      readyVerified: false, platformUnchanged: true, retryAllowed: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    // Never serialize provider stderr, URL, SDK request or unclassified exceptions.
    const code = /^IMAGE_REPAIR_[A-Z0-9_]+$/.test(e.message || '') ? e.message :
      ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name)
        ? 'IMAGE_REPAIR_SOURCE_REFRESH_REQUIRED' : 'IMAGE_REPAIR_PROVIDER_OR_LOCAL_FAILURE';
    const result = { mode, phase, outcome: consumed ? 'SUBMISSION_REQUIRES_INDEPENDENT_INSPECT_NO_RETRY' : 'STOPPED_NO_CLOUD_WRITE',
      code, permanentSlotConsumedThisProcess: consumed, retryAllowed: false, readyVerified: false };
    await save('failure.json', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  } finally { api?.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
