import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { CreateStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { R, hash, same, recoveryPlan, assertRecoveryWindow, requireRecovery as must } from './express-workload-recovery-plan-v1.mjs';
import { recoveryClients, observeRecovery } from './express-workload-recovery-observer-v1.mjs';

const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop';
const HISTORY = [
  ['F:/ChatGPT_workshop/techlong-express-c5h-review-20261015-r3/manifest.json', 'd31d1f84e81da596b2648dff6712ce159a88715e4fceed8de1c7082dc56b77e9'],
  ['F:/ChatGPT_workshop/techlong-express-c5h-run-20261015-r2/run-preflight.json', '126b188a2976ea0964e7521820805273f5a4c9edd9f9f9fd98d0bc137beb5c74'],
  ['F:/ChatGPT_workshop/techlong-express-c5j-deletion-inspect-20261016-r1/result.json', '9bebb00b2d4e75afec7332a406ed6f82af04d8ac49d1c29d595ff9cddec6ff44'],
  ['F:/ChatGPT_workshop/techlong-express-c5j-survivors-inspect-20261016-r1/result.json', '6ea139215d91dd93eee22013d6a290ca777e34a7a19db0ac62dec9318ecd2112'],
];
const FILES = ['ops/aws-sandbox/scripts/express-workload-recovery-plan-v1.mjs', 'ops/aws-sandbox/scripts/express-workload-recovery-observer-v1.mjs',
  'ops/aws-sandbox/scripts/review-express-workload-recovery-v1.mjs', 'ops/aws-sandbox/scripts/express-image-repair-plan-v1.mjs',
  'ops/aws-sandbox/scripts/express-image-repair-observer-v1.mjs', 'package.json', 'package-lock.json', R.risk,
  'ops/aws-sandbox/reviews/aurora-dual-mode-c5i-publication.executed.json'];
async function inputs() {
  const values = [], pins = [];
  for (const [file, sha] of HISTORY) { const raw = await readFile(file); must(hash(raw) === sha, 'HISTORY_CHANGED'); values.push(JSON.parse(raw)); }
  for (const file of FILES) pins.push({ file, rawFileSha256: hash(await readFile(path.join(ROOT, file))) });
  return { historical: values[0], historicalPreflight: values[1], binding: { pins, history: HISTORY } };
}
async function saveFile(file, value) { const f = await open(file, 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } }
async function emptySlot() { try { await access(R.slot); throw Error('WORKLOAD_RECOVERY_SLOT_OCCUPIED_NO_RETRY'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } }
export async function main(raw = process.argv.slice(2)) {
  must(raw.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
  const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
  const required = ['Check', 'Review'].includes(mode) ? ['--mode', '--output'] : ['--mode', '--output', '--manifest', '--approved-sha'];
  must(['Check', 'Review', 'Run', 'Inspect'].includes(mode) && pairs.length === required.length && new Set(pairs.map(p => p[0])).size === pairs.length &&
    required.every(k => args[k]) && Object.keys(args).every(k => required.includes(k)), 'ARGUMENTS');
  const directory = p => path.dirname(p).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-c5k-[a-z0-9-]+$/.test(path.basename(p));
  must(directory(out) && process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase(), 'LOCATION');
  must(!['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CA_BUNDLE',
    'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE'].some(k => process.env[k]) &&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out); const save = (file, value) => saveFile(path.join(out, file), value);
  let api, phase = 'local', consumed = false;
  try {
    const input = await inputs(); await save('binding.json', input.binding);
    if (mode !== 'Inspect') await emptySlot();
    if (mode === 'Check') {
      const plan = recoveryPlan(input.historical, Date.now()); await save('plan.json', plan);
      const result = { mode, outcome: 'LOCAL_SCOPE_COMPILED_NOT_FRESH_REVIEW', directory: out, requestSha256: plan.requestSha256,
        sdkCalls: 0, cliCalls: 0, SQLConnections: 0, actualWrites: 0, permanentSlotsConsumed: 0, executionAuthorized: false };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2)); return;
    }
    let manifest, plan;
    if (mode !== 'Review') {
      const file = path.resolve(args['--manifest']); must(path.basename(file) === 'manifest.json' && directory(path.dirname(file)), 'MANIFEST_PATH');
      manifest = JSON.parse(await readFile(file, 'utf8')); const { manifestSha256, ...body } = manifest;
      must(/^[a-f0-9]{64}$/.test(args['--approved-sha']) && manifestSha256 === args['--approved-sha'] && hash(body) === manifestSha256 &&
        manifest.schema === 'techlong/workload-only-recovery-manifest/v1' && same(input.binding, manifest.binding), 'EXACT_APPROVAL_CLOSURE');
      plan = recoveryPlan(input.historical, manifest.plan.preparedAt); must(same(plan, manifest.plan), 'PLAN_CHANGED');
      if (mode === 'Run') assertRecoveryWindow(plan, Date.now());
      else { const slot = JSON.parse(await readFile(R.slot, 'utf8')); must(slot.manifestSha256 === manifestSha256 && slot.requestSha256 === plan.requestSha256, 'INSPECT_CORRELATION'); }
    } else plan = recoveryPlan(input.historical, Date.now());
    const env = parseEnv(await readFile(path.join(ROOT, '.env.local'), 'utf8')), databaseUrl = env.DATABASE_URL;
    api = recoveryClients(); phase = 'readonly_preflight';
    const observation = await observeRecovery({ ...input, api, plan, databaseUrl, phase: mode === 'Inspect' ? 'after' : 'before',
      baseline: manifest?.baseline, signal: AbortSignal.timeout(180000) });
    await save('observation.json', observation);
    if (mode === 'Review') {
      // Only the finite workload window is rendered after reads; the observation
      // timestamp remains real, not re-labelled as a newer provider snapshot.
      plan = recoveryPlan(input.historical, Date.now());
      const body = { schema: 'techlong/workload-only-recovery-manifest/v1', plan, binding: input.binding, baseline: observation.baseline,
        observationSha256: hash(observation), riskDocument: R.risk, reviewIsNotExecutionApproval: true };
      manifest = { ...body, manifestSha256: hash(body) }; await save('manifest.json', manifest);
    } else if (mode === 'Run') {
      const final = await inputs(); must(same(final.binding, input.binding), 'CODE_CHANGED_DURING_PREFLIGHT');
      assertRecoveryWindow(plan, Date.now()); must(Date.now() - observation.checkedAt <= 30000, 'FINAL_FACT_WINDOW');
      phase = 'consume_new_permanent_slot';
      await saveFile(R.slot, { schema: 'techlong/workload-only-recovery-slot/v1', consumedAt: new Date().toISOString(), manifestSha256: manifest.manifestSha256,
        requestSha256: plan.requestSha256, clientRequestToken: plan.request.ClientRequestToken, retryAllowed: false });
      consumed = true; phase = 'create_submission';
      assertRecoveryWindow(plan, Date.now()); must(Date.now() - observation.checkedAt <= 30000, 'POST_SLOT_FACT_WINDOW');
      const r = await api.cfn.send(new CreateStackCommand(plan.request), { abortSignal: AbortSignal.timeout(30000) });
      must(r.StackId && r.StackId !== R.stack && r.StackId.startsWith('arn:aws:cloudformation:ca-central-1:402010193138:stack/' + R.name + '/'), 'NEW_UUID_ACK');
      await save('submission.json', { stackId: r.StackId, requestId: r.$metadata?.requestId, acknowledgedAt: new Date().toISOString() });
      phase = 'wait'; const deadline = Date.now() + 30 * 60000;
      for (;;) {
        const s = (await api.cfn.send(new DescribeStacksCommand({ StackName: r.StackId }), { abortSignal: AbortSignal.timeout(30000) })).Stacks?.[0];
        must(s?.StackId === r.StackId, 'WAIT_ID'); if (s.StackStatus === 'CREATE_COMPLETE') break;
        must(s.StackStatus === 'CREATE_IN_PROGRESS' && Date.now() < deadline, 'CREATE_NOT_COMPLETE_INSPECT_ONLY');
        console.log(JSON.stringify({ phase, status: s.StackStatus, retryAllowed: false })); await delay(15000);
      }
      phase = 'readonly_after';
      const after = await observeRecovery({ ...input, api, plan, databaseUrl, phase: 'after', baseline: manifest.baseline, signal: AbortSignal.timeout(180000) });
      must(after.live.stackId === r.StackId, 'ACK_READBACK_ID'); await save('after.json', after);
    }
    const result = { mode, outcome: mode === 'Review' ? 'FRESH_RECOVERY_REVIEW_REQUIRES_EXACT_HUMAN_APPROVAL'
      : mode === 'Inspect' ? 'RECOVERED_HOSTING_INDEPENDENTLY_VERIFIED_PLATFORM_UNCHANGED' : 'RECOVERY_READBACK_REQUIRES_INDEPENDENT_INSPECT',
      directory: out, manifestSha256: manifest.manifestSha256, admissionExpiresAt: new Date(plan.admissionExpiresAt).toISOString(), workloadExpiresAt: plan.expiresAt,
      actualWriteSubmissions: mode === 'Run' ? 1 : 0, iamWrites: 0, platformWrites: 0, auroraConnections: 0, operatorSecretValueReads: 0,
      applicationRequests: 0, permanentSlotsConsumed: consumed ? 1 : 0, readyVerified: false, retryAllowed: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const code = /^(WORKLOAD_RECOVERY|IMAGE_REPAIR)_[A-Z0-9_]+$/.test(e.message || '') ? e.message :
      ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name)
        ? 'WORKLOAD_RECOVERY_SOURCE_REFRESH_REQUIRED' : 'WORKLOAD_RECOVERY_PROVIDER_OR_LOCAL_FAILURE';
    const result = { mode, phase, outcome: consumed ? 'SUBMISSION_REQUIRES_INDEPENDENT_INSPECT_NO_RETRY' : 'STOPPED_NO_CLOUD_WRITE', code,
      permanentSlotConsumedThisProcess: consumed, retryAllowed: false, readyVerified: false };
    await save('failure.json', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  } finally { api?.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
