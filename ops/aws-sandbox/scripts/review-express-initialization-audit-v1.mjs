import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { A, hash, same, auditProgram, auditWindow, assertAuditWindow, requireAudit as must } from './express-initialization-audit-plan-v1.mjs';
import { runInitializationAudit } from './express-initialization-audit-runtime-v1.mjs';
import { recoveryClients, observeRecovery } from './express-workload-recovery-observer-v1.mjs';
const ROOT = 'E:/NodejsProject/TechlongSoftware', BACKEND = 'E:/NodejsProject/SpeedFeast_Backend_main', BASE = 'F:/ChatGPT_workshop';
const req = createRequire(BACKEND + '/package.json');
const K1 = BASE + '/techlong-express-c5k-review-20261016-r2/manifest.json';
const K1_SHA = '4b194dc34fa44bc23c1999d21363351b14177fd0e57e62bce5726f75c8e95e10';
const SEED = BASE + '/techlong-express-c5c-store-seed-inspect-20261015-r1/program.json';
async function saveFile(file, value) { const f = await open(file, 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } }
async function loadInputs() {
  const k1 = JSON.parse(await readFile(K1, 'utf8')), { manifestSha256, ...body } = k1;
  must(manifestSha256 === K1_SHA && hash(body) === K1_SHA, 'K1_MANIFEST_CHANGED');
  const history = [], get = async (file, expected) => { const raw = await readFile(file); must(!expected || hash(raw) === expected, 'HISTORY_CHANGED');
    history.push({ file, rawFileSha256: hash(raw) }); return JSON.parse(raw); };
  const historical = await get(k1.binding.history[0][0], k1.binding.history[0][1]);
  const historicalPreflight = await get(k1.binding.history[1][0], k1.binding.history[1][1]);
  await get(K1); const seed = await get(SEED, '44815f7494479e583d8fb829532a11bd494e6e455e7eca94ed849d7ef189869d');
  const executed = await get(ROOT + '/ops/aws-sandbox/reviews/aurora-dual-mode-c5k-workload-recovery.executed.json');
  must(executed.state === 'K1_RECOVERED_HOSTING_INDEPENDENTLY_VERIFIED_PLATFORM_UNCHANGED' && executed.approvedManifestSha256 === K1_SHA &&
    executed.submission.stackId === A.stackId && executed.independent.live.taskDefinitionArn === A.taskDefinitionArn, 'K1_NOT_VERIFIED');
  for (const pin of executed.evidenceFiles) await get(pin.path, pin.rawFileSha256);
  const pins = [...k1.binding.pins];
  for (const pin of pins) must(hash(await readFile(path.join(ROOT, pin.file))) === pin.rawFileSha256, 'K1_CODE_CHANGED');
  const more = ['ops/aws-sandbox/scripts/express-initialization-audit-plan-v1.mjs',
    'ops/aws-sandbox/scripts/express-initialization-audit-runtime-v1.mjs', 'ops/aws-sandbox/scripts/review-express-initialization-audit-v1.mjs', A.risk];
  for (const name of more) pins.push({ file: name, rawFileSha256: hash(await readFile(path.join(ROOT, name))) });
  for (const name of ['package.json', 'package-lock.json', 'services/saas/tenant-readiness-v1.cjs', 'services/saas/aurora_connections_v2.js',
    'services/saas/database_contract_v2.cjs', 'services/saas/control_service.js'])
    pins.push({ file: BACKEND + '/' + name, rawFileSha256: hash(await readFile(BACKEND + '/' + name)) });
  const program = auditProgram({ historical, seed, readiness: req('./services/saas/tenant-readiness-v1.cjs') });
  return { k1, historical, historicalPreflight, program, binding: { pins, history, nodeVersion: process.version } };
}
function planFor(input, preparedAt) {
  const plan = { schema: 'techlong/initialization-audit-plan/v1', ...auditWindow(preparedAt, input.k1.plan.expiresAt),
    stackId: A.stackId, taskDefinitionArn: A.taskDefinitionArn, program: input.program,
    purpose: 'CLASSIFY_POST_500_STATE_WITHOUT_POST_OR_PRIVATE_CONTROL',
    limits: { auroraConnections: 1, normalSqlCalls: 14, maximumRollbackCalls: 1, cloudWrites: 0, sqlBusinessWrites: 0,
      secretValueReads: 0, privateBundleReads: 0, applicationRequests: 0, platformWrites: 0, automaticRetries: 0 },
    riskDocument: A.risk, noProvisionAuthority: true, noPlatformReadyAuthority: true, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false };
  assertAuditWindow(plan, preparedAt); return plan;
}
async function slotEmpty() { try { await access(A.slot); throw Error('INITIALIZATION_AUDIT_SLOT_OCCUPIED_NO_RETRY'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function metadata(input, api, databaseUrl, signal) {
  const o = await observeRecovery({ ...input, api, databaseUrl, plan: input.k1.plan, baseline: input.k1.baseline, phase: 'after', signal });
  must(o.live.stackId === A.stackId && o.live.taskDefinitionArn === A.taskDefinitionArn, 'HOSTING_IDENTITY_CHANGED'); return o;
}
export async function main(raw = process.argv.slice(2)) {
  must(raw.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
  const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
  const keys = ['Check', 'Review'].includes(mode) ? ['--mode', '--output'] : mode === 'Inspect'
    ? ['--mode', '--output', '--manifest', '--approved-sha', '--run'] : ['--mode', '--output', '--manifest', '--approved-sha'];
  const directory = d => path.dirname(d).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-k2a-[a-z0-9-]+$/.test(path.basename(d));
  must(['Check', 'Review', 'Run', 'Inspect'].includes(mode) && pairs.length === keys.length && keys.every(k => args[k]) &&
    new Set(pairs.map(p => p[0])).size === pairs.length && Object.keys(args).every(k => keys.includes(k)) && directory(out), 'ARGUMENTS');
  must(process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase() &&
    !['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CA_BUNDLE',
      'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PGHOST', 'PGHOSTADDR', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE',
      'PGPASSFILE', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY'].some(k => process.env[k]) && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' &&
    !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out); const save = (file, value) => saveFile(path.join(out, file), value);
  let api, phase = 'local', consumed = false;
  try {
    const input = await loadInputs(); await save('binding.json', input.binding);
    if (mode !== 'Inspect') await slotEmpty();
    let plan, manifest;
    if (['Run', 'Inspect'].includes(mode)) {
      const file = path.resolve(args['--manifest']); must(path.basename(file) === 'manifest.json' && directory(path.dirname(file)), 'MANIFEST_PATH');
      manifest = JSON.parse(await readFile(file, 'utf8')); const { manifestSha256, ...body } = manifest;
      must(manifestSha256 === args['--approved-sha'] && /^[a-f0-9]{64}$/.test(manifestSha256) && hash(body) === manifestSha256 &&
        manifest.schema === 'techlong/initialization-audit-manifest/v1' && same(input.binding, manifest.binding), 'EXACT_APPROVAL');
      plan = planFor(input, manifest.plan.preparedAt); must(same(plan, manifest.plan), 'PLAN_CHANGED');
      if (mode === 'Run') assertAuditWindow(plan, Date.now());
    } else plan = planFor(input, Date.now());
    if (mode === 'Check') {
      const roots = req('./services/saas/aurora_connections_v2').loadAtsRoots();
      await save('program.json', input.program);
      const r = { mode, outcome: 'FIXED_READONLY_SQL_PROGRAM_COMPILED_NO_CONNECTION', statements: input.program.statements.length,
        normalSqlCallsIfApproved: 14, publicAtsRootsVerified: roots.length, sdkCalls: 0, SQLConnections: 0, cloudWrites: 0, permanentSlotsConsumed: 0 };
      await save('result.json', r); console.log(JSON.stringify(r, null, 2)); return;
    }
    const databaseUrl = parseEnv(await readFile(ROOT + '/.env.local', 'utf8')).DATABASE_URL;
    api = recoveryClients(); phase = 'readonly_metadata';
    const before = await metadata(input, api, databaseUrl, AbortSignal.timeout(180000)); await save('metadata.json', before);
    if (mode === 'Review') {
      plan = planFor(input, Date.now());
      const body = { schema: 'techlong/initialization-audit-manifest/v1', plan, binding: input.binding,
        metadataSha256: hash(before), historicalPlatformBaselineSha256: hash(input.k1.baseline), reviewIsNotExecutionApproval: true };
      manifest = { ...body, manifestSha256: hash(body) }; await save('manifest.json', manifest);
    } else if (mode === 'Run') {
      phase = 'one_readonly_aurora_transaction';
      const receipt = await runInitializationAudit({ program: input.program, save, signal: AbortSignal.timeout(180000), async consume() {
        const final = await loadInputs(); must(same(input.binding, final.binding), 'CODE_CHANGED');
        assertAuditWindow(plan, Date.now()); must(Date.now() - before.checkedAt <= 30000, 'METADATA_TOO_OLD');
        await saveFile(A.slot, { schema: 'techlong/initialization-audit-slot/v1', consumedAt: new Date().toISOString(),
          manifestSha256: manifest.manifestSha256, programSha256: hash(input.program), runDirectory: out, retryAllowed: false });
        consumed = true; assertAuditWindow(plan, Date.now()); must(Date.now() - before.checkedAt <= 30000, 'POST_SLOT_FACT_WINDOW');
      } });
      await save('classification.json', { facts: receipt.facts, receiptSha256: hash(receipt), platformStateAtSqlCommitNotAtomicallyProved: true });
      phase = 'readonly_after'; const after = await metadata(input, api, databaseUrl, AbortSignal.timeout(180000));
      await save('after.json', after);
    } else {
      phase = 'independent_local_receipt'; const run = path.resolve(args['--run']); must(directory(run), 'RUN_PATH');
      const slot = JSON.parse(await readFile(A.slot, 'utf8'));
      must(slot.manifestSha256 === manifest.manifestSha256 && slot.programSha256 === hash(input.program) && path.resolve(slot.runDirectory) === run, 'SLOT_CORRELATION');
      const receipt = JSON.parse(await readFile(run + '/sql-receipt.json', 'utf8'));
      const classification = JSON.parse(await readFile(run + '/classification.json', 'utf8'));
      must(receipt.readOnly === true && receipt.connections === 1 && receipt.sqlCalls === 14 && receipt.clientTlsVerified && receipt.backendTlsVerified &&
        receipt.facts.statementsSha256 === input.program.statementsSha256 && receipt.facts.provisionAuthorized === false &&
        classification.receiptSha256 === hash(receipt) && same(classification.facts, receipt.facts) && receipt.target.database === A.database &&
        receipt.target.databaseOid === A.databaseOid && receipt.target.user === 'postgres' && receipt.target.endpoint === A.endpoint, 'RECEIPT_INVALID');
      await save('receipt-inspect.json', { receiptRawFileSha256: hash(await readFile(run + '/sql-receipt.json')), receiptSha256: hash(receipt),
        facts: receipt.facts, noSecondAuroraConnection: true, sameSnapshotNotNewDatabaseProof: true });
    }
    const r = { mode, outcome: mode === 'Review' ? 'READONLY_AURORA_AUDIT_REQUIRES_EXACT_HUMAN_APPROVAL'
      : mode === 'Run' ? 'SQL_AUDIT_SAVED_REQUIRES_INDEPENDENT_METADATA_AND_RECEIPT_INSPECT' : 'AUDIT_RECEIPT_INTEGRITY_AND_HOSTING_INDEPENDENTLY_INSPECTED',
      directory: out, manifestSha256: manifest.manifestSha256, admissionExpiresAt: new Date(plan.admissionExpiresAt).toISOString(),
      workloadExpiresAt: plan.workloadExpiresAt, operatorAuroraConnections: mode === 'Run' ? 1 : 0, cloudWrites: 0, sqlBusinessWrites: 0,
      secretValueReads: 0, privateBundleReads: 0, applicationRequests: 0, permanentSlotsConsumed: consumed ? 1 : 0, provisionAuthorized: false, readyVerified: false };
    await save('result.json', r); console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    const code = /^(INITIALIZATION_AUDIT|WORKLOAD_RECOVERY|IMAGE_REPAIR)_[A-Z0-9_]+$/.test(e.message || '') ? e.message :
      ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name)
        ? 'INITIALIZATION_AUDIT_SOURCE_REFRESH_REQUIRED' : 'INITIALIZATION_AUDIT_PROVIDER_OR_LOCAL_FAILURE';
    const r = { mode, phase, code, outcome: consumed ? 'READ_ATTEMPT_CONSUMED_INSPECT_ONLY_NO_RECONNECT' : 'STOPPED_NO_AURORA_CONNECTION',
      permanentSlotConsumedThisProcess: consumed, cloudWrites: 0, sqlBusinessWrites: 0, automaticRetries: 0, provisionAuthorized: false };
    await save('failure.json', r); console.error(JSON.stringify(r, null, 2)); process.exitCode = 1;
  } finally { api?.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
