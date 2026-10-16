import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { neon } from '@neondatabase/serverless';
import { loadRecoveryInputs } from './review-express-initialization-recovery-v1.mjs';
import { C, hash, same, must, readyPlan, assertWindow, stableSnapshot, makeReceipt, compileReadyProgram, validateReadySnapshot } from './express-ready-reconciliation-plan-v1.mjs';
import { observeReconciliation, recoveryClients, readReconciliationState } from './express-ready-reconciliation-observer-v1.mjs';
import { openReadyReader } from './express-ready-reconciliation-control-v1.mjs';
const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop';
async function saveFile(file, data) { const f = await open(file, 'wx'); try { await f.writeFile(JSON.stringify(data, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } }
async function absent(file) { try { await access(file); must(false, 'PERMANENT_SLOT_OCCUPIED'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
export async function loadReadyInputs() {
  const base = await loadRecoveryInputs(), history = [];
  const get = async (file, expected) => { const raw = await readFile(file); must(!expected || hash(raw) === expected, 'INITIALIZED_HISTORY_CHANGED');
    history.push({ file, rawFileSha256: hash(raw) }); return JSON.parse(raw); };
  const initialized = await get(ROOT + '/ops/aws-sandbox/reviews/aurora-dual-mode-k2b-initialization-recovery.executed.json');
  must(initialized.approvedManifestSha256 === C.initializedManifestSha && initialized.applicationInitializedVerified === true &&
    initialized.effectiveConfigurationVerified === true && initialized.platformUnchanged === true && initialized.platformReady === false, 'INITIALIZED_HISTORY');
  for (const pin of initialized.evidenceFiles) await get(pin.path, pin.rawFileSha256);
  const previous = await get(BASE + '/techlong-express-k2b-review-20261016-r2/manifest.json');
  const { manifestSha256, ...body } = previous; must(manifestSha256 === C.initializedManifestSha && hash(body) === manifestSha256, 'INITIALIZED_MANIFEST');
  must(same(previous.binding, base.binding), 'INITIALIZED_CODE_CHANGED');
  const pins = [];
  for (const file of ['ops/aws-sandbox/scripts/express-ready-reconciliation-plan-v1.mjs',
    'ops/aws-sandbox/scripts/express-ready-reconciliation-observer-v1.mjs', 'ops/aws-sandbox/scripts/express-ready-reconciliation-control-v1.mjs',
    'ops/aws-sandbox/scripts/review-express-ready-reconciliation-v1.mjs', C.risk]) pins.push({ file, rawFileSha256: hash(await readFile(ROOT + '/' + file)) });
  return { base, initialized, binding: { initializedBinding: base.binding, history, pins, nodeVersion: process.version } };
}
export async function main(raw = process.argv.slice(2)) {
  must(raw.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
  const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
  const directory = d => path.dirname(d).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-k2c-[a-z0-9-]+$/.test(path.basename(d));
  const keys = ['Check', 'Review'].includes(mode) ? ['--mode', '--output'] : mode === 'Inspect'
    ? ['--mode', '--output', '--manifest', '--approved-sha', '--run'] : ['--mode', '--output', '--manifest', '--approved-sha'];
  must(['Check', 'Review', 'Run', 'Inspect'].includes(mode) && pairs.length === keys.length && keys.every(k => args[k]) &&
    new Set(pairs.map(p => p[0])).size === pairs.length && Object.keys(args).every(k => keys.includes(k)) && directory(out), 'ARGUMENTS');
  must(process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase() &&
    !['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CA_BUNDLE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PGHOST', 'PGHOSTADDR', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'PGOPTIONS',
      'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY'].some(k => process.env[k]) &&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out); const save = (file, data) => saveFile(out + '/' + file, data);
  let api, reader, phase = 'local', rootConsumed = false, writeIntent = false, inspectConsumed = false, acknowledged = false;
  try {
    const input = await loadReadyInputs(); await save('binding.json', input.binding);
    if (mode !== 'Inspect') { await absent(C.slot); await absent(C.writeSlot); await absent(C.inspectSlot); }
    if (mode === 'Check') {
      const result = { mode, outcome: 'READY_RECONCILIATION_CLOSURE_CHECKED_NO_ACTION', ownPins: input.binding.pins.length,
        previousRawPins: input.base.binding.rawPins.length, previousClosurePins: input.base.binding.legacyImportClosure.pins.length,
        cloudCalls: 0, privateLoads: 0, secretValues: 0, auroraConnections: 0, httpRequests: 0, platformWrites: 0, slotsConsumed: 0 };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2)); return;
    }
    const databaseUrl = parseEnv(await readFile(ROOT + '/.env.local', 'utf8')).DATABASE_URL;
    api = recoveryClients(); let plan, manifest, program;
    if (['Run', 'Inspect'].includes(mode)) {
      const file = path.resolve(args['--manifest']); must(path.basename(file) === 'manifest.json' && directory(path.dirname(file)), 'MANIFEST_PATH');
      manifest = JSON.parse(await readFile(file, 'utf8')); const { manifestSha256, ...body } = manifest;
      must(manifestSha256 === args['--approved-sha'] && /^[a-f0-9]{64}$/.test(manifestSha256) && hash(body) === manifestSha256 &&
        manifest.schema === 'techlong/manual-ready-reconciliation-manifest/v1' && same(input.binding, manifest.binding), 'EXACT_APPROVAL');
      plan = readyPlan({ ...input, snapshot: manifest.plan.expectedSnapshot, catalogServerSha256: manifest.plan.catalogServerSha256,
        endpointSha256: manifest.plan.endpointSha256 }, manifest.plan.preparedAt);
      must(same(plan, manifest.plan), 'PLAN_CHANGED'); assertWindow(plan, Date.now(), mode === 'Run');
      if (mode === 'Inspect') {
        const run = path.resolve(args['--run']); must(directory(run), 'RUN_PATH');
        const root = JSON.parse(await readFile(C.slot, 'utf8')), write = JSON.parse(await readFile(C.writeSlot, 'utf8'));
        program = JSON.parse(await readFile(run + '/submission.json', 'utf8'));
        must(root.manifestSha256 === manifest.manifestSha256 && write.manifestSha256 === manifest.manifestSha256 &&
          path.resolve(root.runDirectory) === run && path.resolve(write.runDirectory) === run &&
          write.programSha256 === program.programSha256 && same(program, compileReadyProgram(plan, program.receipt, input.base.historical)), 'SUBMISSION_CORRELATION');
        await absent(C.inspectSlot);
      }
    }
    phase = 'readonly_provider';
    const observe = async (name, platformPhase, receipt) => {
      const o = await observeReconciliation({ api, historical: input.base.historical, historicalPreflight: input.base.historicalPreflight,
        plan: input.base.k1.plan, databaseUrl, baseline: input.base.k1.baseline, signal: AbortSignal.timeout(180000),
        platformPhase, reconciliationPlan: plan, receipt }); await save(name, o); return o;
    };
    const hosting = await observe('metadata.json', mode === 'Inspect' ? 'ready' : 'before', program?.receipt);
    phase = 'readonly_platform_state';
    const state = await readReconciliationState({ databaseUrl, historical: input.base.historical, receipt: program?.receipt,
      signal: AbortSignal.timeout(30000) }); await save('state.json', state);
    if (mode === 'Review') {
      plan = readyPlan({ ...input, ...state }, Date.now());
      const body = { schema: 'techlong/manual-ready-reconciliation-manifest/v1', plan, binding: input.binding,
        metadataSha256: hash(hosting), stateSha256: hash(state), preparationIsNotExecutionApproval: true };
      manifest = { ...body, manifestSha256: hash(body) }; await save('manifest.json', manifest);
    } else {
      must(state.endpointSha256 === plan.endpointSha256 && state.catalog.server_sha256 === plan.catalogServerSha256, 'SOURCE_OR_CATALOG_CHANGED');
      if (mode === 'Run') must(same(stableSnapshot(state.snapshot), plan.expectedSnapshot), 'EXACT_OLD_ROWS_CHANGED');
      else validateReadySnapshot(state.snapshot, plan, program.receipt);
      const recheck = async (admission = false) => {
        assertWindow(plan, Date.now(), admission); must(same(input.binding, (await loadReadyInputs()).binding), 'CODE_OR_HISTORY_CHANGED');
      };
      await recheck(mode === 'Run');
      if (mode === 'Run') {
        must(Date.now() - hosting.checkedAt <= plan.cloudMaximumAgeMs, 'HOSTING_TOO_OLD');
        await saveFile(C.slot, { schema: 'techlong/manual-ready-attempt/v1', manifestSha256: manifest.manifestSha256,
          consumedAt: new Date().toISOString(), runDirectory: out, retryAuthorized: false }); rootConsumed = true;
      } else {
        await saveFile(C.inspectSlot, { schema: 'techlong/manual-ready-inspect-attempt/v1', manifestSha256: manifest.manifestSha256,
          consumedAt: new Date().toISOString(), runDirectory: args['--run'], repeatAuthorized: false }); inspectConsumed = true;
      }
      await recheck(mode === 'Run'); phase = 'fresh_readonly_application';
      reader = await openReadyReader({ base: input.base, plan });
      const observed = await reader.read(AbortSignal.timeout(30000)), checkedAt = Date.now();
      await save('application-proof.json', { checkedAt, observed, exactStoreVerified: true, requests: reader.counts(), freshAuthenticatedReadback: true });
      if (mode === 'Run') {
        const receipt = makeReceipt(plan, manifest.manifestSha256, observed, hosting, checkedAt);
        program = compileReadyProgram(plan, receipt, input.base.historical); await save('submission.json', program);
        await recheck(); must(Date.now() - hosting.checkedAt <= plan.cloudMaximumAgeMs && Date.now() - checkedAt <= plan.apiMaximumAgeMs, 'FINAL_FACT_WINDOW');
        await saveFile(C.writeSlot, { schema: 'techlong/manual-ready-write-attempt/v1', manifestSha256: manifest.manifestSha256,
          programSha256: program.programSha256, consumedAt: new Date().toISOString(), runDirectory: out, retryAuthorized: false }); writeIntent = true;
        assertWindow(plan, Date.now()); must(Date.now() - hosting.checkedAt <= plan.cloudMaximumAgeMs && Date.now() - checkedAt <= plan.apiMaximumAgeMs, 'POST_SLOT_FACT_WINDOW');
        phase = 'single_serializable_ready_transaction';
        const sql = neon(databaseUrl, { fullResults: true });
        const results = await sql.transaction(tx => program.statements.map(q => tx.query(q.text, q.values)),
          { readOnly: false, isolationLevel: 'Serializable', fullResults: true, fetchOptions: { signal: AbortSignal.timeout(30000) } });
        must(results.length === 7 && results.every(r => r.rowCount === 1) && results.slice(1).every(r => r.rows[0]?.accepted === 1), 'COMMIT_RESPONSE_NOT_PROVED');
        acknowledged = true; await save('transaction-ack.json', { acknowledgedAt: new Date().toISOString(), programSha256: program.programSha256,
          transactionCount: 1, changedRows: 3, statementResults: 7, retryAuthorized: false });
        phase = 'readonly_after'; await observe('after.json', 'ready', receipt);
        const after = await readReconciliationState({ databaseUrl, historical: input.base.historical, receipt, signal: AbortSignal.timeout(30000) });
        await save('after-state.json', after); validateReadySnapshot(after.snapshot, plan, receipt);
        must(after.catalog.server_sha256 === plan.catalogServerSha256, 'AFTER_CATALOG_CHANGED');
      }
    }
    const result = { mode, outcome: mode === 'Review' ? 'READY_RECONCILIATION_REQUIRES_FRESH_EXACT_APPROVAL'
      : mode === 'Run' ? 'READY_TRANSACTION_ACKNOWLEDGED_AND_READ_BACK_REQUIRES_INDEPENDENT_INSPECT' : 'READY_PLATFORM_AND_INITIALIZED_CONFIGURATION_INDEPENDENTLY_VERIFIED',
      directory: out, manifestSha256: manifest.manifestSha256, admissionExpiresAt: new Date(plan.admissionExpiresAt).toISOString(),
      executionExpiresAt: new Date(plan.executionExpiresAt).toISOString(), workloadExpiresAt: plan.workloadExpiresAt,
      cloudWrites: 0, auroraConnections: 0, secretValueReads: 0, provisionPosts: 0, privateBundleLoads: reader ? 1 : 0,
      requests: reader?.counts() || {}, writeTransactionAcknowledgedThisProcess: acknowledged,
      attemptSlotConsumedThisProcess: rootConsumed, writeSlotConsumedThisProcess: writeIntent, inspectSlotConsumedThisProcess: inspectConsumed,
      readyVerified: mode === 'Inspect', automaticRetries: 0 };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const code = /^(READY_RECONCILIATION|INITIALIZATION_RECOVERY|WORKLOAD_RECOVERY|IMAGE_REPAIR)_[A-Z0-9_]+$/.test(e.message || '') ? e.message
      : ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name)
        ? 'READY_RECONCILIATION_SOURCE_REFRESH_REQUIRED' : 'READY_RECONCILIATION_PROVIDER_OR_LOCAL_FAILURE';
    const result = { mode, phase, code, outcome: rootConsumed || mode === 'Inspect' ? 'PRESERVE_EVIDENCE_NO_WRITE_RETRY' : 'STOPPED_BEFORE_NEW_ATTEMPT',
      rootConsumed, writeIntentConsumed: writeIntent, acknowledged, inspectConsumed, requests: reader?.counts() || {},
      cloudWrites: 0, auroraConnections: 0, secretValueReads: 0, provisionPosts: 0, automaticRetries: 0, readyVerified: false };
    await save('failure.json', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  } finally { reader?.dispose(); api?.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
