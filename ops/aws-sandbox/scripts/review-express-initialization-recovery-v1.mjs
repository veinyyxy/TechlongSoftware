import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { DescribeSecretCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { B, hash, same, must, manualRecoveryPlan, assertPristine, assertFreshPristine, assertRecoveryAdmission, assertRecoveryExecution } from './express-initialization-recovery-plan-v1.mjs';
import { A } from './express-initialization-audit-plan-v1.mjs';
import { runInitializationAudit } from './express-initialization-audit-runtime-v1.mjs';
import { loadExpressLiveInputsV1, expressLiveCodeBindingV1 } from './express-live-local-inputs-v1.mjs';
import { recoveryClients, observeRecovery } from './express-workload-recovery-observer-v1.mjs';
import { openManualRecoveryControl, clearFirstOwnerPassword } from './express-initialization-recovery-control-v1.mjs';
const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop';
async function saveFile(file, value) { const f = await open(file, 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } }
async function absent(file) { try { await access(file); must(false, 'PERMANENT_SLOT_OCCUPIED_NO_RETRY'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } }

export async function loadRecoveryInputs() {
  const history = [], get = async (file, expected) => { const bytes = await readFile(file);
    must(!expected || hash(bytes) === expected, 'HISTORY_CHANGED'); history.push({ file, rawFileSha256: hash(bytes) }); return JSON.parse(bytes); };
  const audit = await get(ROOT + '/ops/aws-sandbox/reviews/aurora-dual-mode-k2a-initialization-audit.executed.json');
  assertPristine(audit.sqlReceipt);
  must(audit.sqlReceiptCanonicalSha256 === hash(audit.sqlReceipt) &&
    audit.independent.receiptIntegrity.receiptSha256 === hash(audit.sqlReceipt) &&
    same(audit.independent.receiptIntegrity.facts, audit.sqlReceipt.facts), 'AUDIT_INDEPENDENT_PROOF');
  for (const pin of audit.evidenceFiles) await get(pin.path, pin.rawFileSha256);
  const auditManifest = await get(BASE + '/techlong-express-k2a-review-20261016-r1/manifest.json');
  const { manifestSha256: aSha, ...aBody } = auditManifest;
  must(aSha === B.auditManifestSha && hash(aBody) === aSha, 'AUDIT_MANIFEST');
  for (const pin of auditManifest.binding.history) await get(pin.file, pin.rawFileSha256);
  const k1 = await get(BASE + '/techlong-express-c5k-review-20261016-r2/manifest.json');
  const { manifestSha256: kSha, ...kBody } = k1;
  must(kSha === '4b194dc34fa44bc23c1999d21363351b14177fd0e57e62bce5726f75c8e95e10' && hash(kBody) === kSha, 'K1_MANIFEST');
  const historical = await get(k1.binding.history[0][0], k1.binding.history[0][1]);
  const historicalPreflight = await get(k1.binding.history[1][0], k1.binding.history[1][1]);
  const rawPins = [...auditManifest.binding.pins];
  for (const pin of rawPins) must(hash(await readFile(path.isAbsolute(pin.file) ? pin.file : path.join(ROOT, pin.file))) === pin.rawFileSha256, 'AUDIT_CODE_CHANGED');
  for (const file of ['ops/aws-sandbox/scripts/express-initialization-recovery-plan-v1.mjs',
    'ops/aws-sandbox/scripts/express-initialization-recovery-control-v1.mjs', 'ops/aws-sandbox/scripts/review-express-initialization-recovery-v1.mjs', B.risk])
    rawPins.push({ file, rawFileSha256: hash(await readFile(ROOT + '/' + file)) });
  const publicInputs = await loadExpressLiveInputsV1();
  const legacyImportClosure = await expressLiveCodeBindingV1(publicInputs.history);
  return { audit, auditManifest, k1, historical, historicalPreflight, publicInputs,
    binding: { rawPins, history, legacyImportClosure, nodeVersion: process.version } };
}
async function metadata(input, api, databaseUrl, signal) {
  const value = await observeRecovery({ api, historical: input.historical, historicalPreflight: input.historicalPreflight,
    plan: input.k1.plan, baseline: input.k1.baseline, phase: 'after', databaseUrl, signal });
  must(value.live.stackId === A.stackId && value.live.taskDefinitionArn === A.taskDefinitionArn, 'HOSTING_CHANGED'); return value;
}
export async function main(raw = process.argv.slice(2)) {
  must(raw.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
  const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
  const keys = ['Check', 'Review'].includes(mode) ? ['--mode', '--output'] : mode === 'Inspect'
    ? ['--mode', '--output', '--manifest', '--approved-sha', '--run'] : ['--mode', '--output', '--manifest', '--approved-sha'];
  const directory = d => path.dirname(d).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-k2b-[a-z0-9-]+$/.test(path.basename(d));
  must(['Check', 'Review', 'Run', 'Inspect'].includes(mode) && pairs.length === keys.length && keys.every(k => args[k]) &&
    new Set(pairs.map(p => p[0])).size === pairs.length && Object.keys(args).every(k => keys.includes(k)) && directory(out), 'ARGUMENTS');
  must(process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase() &&
    !['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CA_BUNDLE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PGHOST', 'PGHOSTADDR', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'PGOPTIONS',
      'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY'].some(k => process.env[k]) &&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out); const save = (name, value) => saveFile(out + '/' + name, value);
  let api, control, consumed = false, postAttempted = false, valueReads = 0, phase = 'local', metadataGroups = 0;
  try {
    const input = await loadRecoveryInputs(); await save('binding.json', input.binding);
    let plan, manifest;
    if (mode !== 'Inspect') { await absent(B.slot); await absent(B.postSlot); }
    if (['Run', 'Inspect'].includes(mode)) {
      const file = path.resolve(args['--manifest']); must(path.basename(file) === 'manifest.json' && directory(path.dirname(file)), 'MANIFEST_PATH');
      manifest = JSON.parse(await readFile(file, 'utf8')); const { manifestSha256, ...body } = manifest;
      must(manifestSha256 === args['--approved-sha'] && /^[a-f0-9]{64}$/.test(manifestSha256) && hash(body) === manifestSha256 &&
        manifest.schema === 'techlong/manual-initialization-recovery-manifest/v1' && same(input.binding, manifest.binding), 'EXACT_APPROVAL');
      plan = manualRecoveryPlan(input, manifest.plan.preparedAt); must(same(plan, manifest.plan), 'PLAN_CHANGED');
      if (mode === 'Run') assertRecoveryAdmission(plan, Date.now()); else assertRecoveryExecution(plan, Date.now());
    } else plan = manualRecoveryPlan(input, Date.now());
    if (mode === 'Check') {
      await save('plan.json', plan); const result = { mode, outcome: 'MANUAL_RECOVERY_COMPILED_NO_RUNTIME_ACTION',
        rawCodePins: input.binding.rawPins.length, legacyClosureCodePins: input.binding.legacyImportClosure.pins.length,
        cloudCalls: 0, auroraConnections: 0, privateBundleLoads: 0, secretValueReads: 0, httpRequests: 0, slotsConsumed: 0 };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2)); return;
    }
    const databaseUrl = parseEnv(await readFile(ROOT + '/.env.local', 'utf8')).DATABASE_URL;
    api = recoveryClients(); phase = 'readonly_metadata';
    const observe = async name => { must(++metadataGroups <= (mode === 'Run' ? 3 : 1), 'METADATA_LIMIT');
      const o = await metadata(input, api, databaseUrl, AbortSignal.timeout(180000)); await save(name, o); return o; };
    const before = await observe('metadata.json');
    if (mode === 'Review') {
      plan = manualRecoveryPlan(input, Date.now()); const body = { schema: 'techlong/manual-initialization-recovery-manifest/v1',
        plan, binding: input.binding, metadataSha256: hash(before), reviewIsNotExecutionApproval: true };
      manifest = { ...body, manifestSha256: hash(body) }; await save('manifest.json', manifest);
    } else {
      const signal = AbortSignal.timeout(360000);
      const recheck = async () => { assertRecoveryExecution(plan, Date.now());
        must(same(input.binding, (await loadRecoveryInputs()).binding), 'CODE_OR_HISTORY_CHANGED'); };
      const target = { appInstanceId: plan.historicalScope.appInstanceId, hostname: plan.hostname, externalFence: plan.externalFence, signal };
      const matches = o => o?.ready === true && o.desiredConfigurationHash === plan.historicalScope.configurationHash && o.imageRevision === plan.controlPolicy.imageRevision;
      if (mode === 'Run') {
        phase = 'current_readonly_pristine';
        const receipt = await runInitializationAudit({ program: input.auditManifest.plan.program, save, signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
          async consume() { await recheck(); assertRecoveryAdmission(plan, Date.now());
            must(Date.now() - before.checkedAt <= plan.metadataMaximumAgeMs, 'METADATA_TOO_OLD');
            await saveFile(B.slot, { schema: 'techlong/manual-initialization-recovery-slot/v1', manifestSha256: manifest.manifestSha256,
              programSha256: plan.sqlProgramSha256, consumedAt: new Date().toISOString(), runDirectory: out, retryAllowed: false }); consumed = true;
            assertRecoveryAdmission(plan, Date.now());
            must(Date.now() - before.checkedAt <= plan.metadataMaximumAgeMs, 'POST_READ_SLOT_FACT_WINDOW'); } });
        assertFreshPristine(receipt, plan, Date.now()); await recheck(); phase = 'private_control_load';
        const send = (client, command) => client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
        const secret = plan.controlPolicy.binding.runtimeSecret;
        const sdk = { identity: () => send(api.sts, new GetCallerIdentityCommand({})),
          describe: arn => { must(arn === secret.arn, 'SECRET_TARGET'); return send(api.sm, new DescribeSecretCommand({ SecretId: arn })); },
          value: (arn, version) => { must(!valueReads && arn === secret.arn && version === secret.versionId, 'SECRET_VALUE_LIMIT'); valueReads++;
            return send(api.sm, new GetSecretValueCommand({ SecretId: arn, VersionId: version, VersionStage: 'AWSCURRENT' })); } };
        control = await openManualRecoveryControl({ input, plan, mode, databaseUrl, sdk, async beforePost() {
          phase = 'pre_post_metadata'; const fresh = await observe('pre-post-metadata.json'); await recheck();
          assertFreshPristine(receipt, plan, Date.now());
          must(Date.now() - fresh.checkedAt <= plan.metadataMaximumAgeMs, 'PRE_POST_FACT_WINDOW');
          await saveFile(B.postSlot, { schema: 'techlong/manual-initialization-recovery-post-slot/v1', manifestSha256: manifest.manifestSha256,
            consumedAt: new Date().toISOString(), sqlReceiptSha256: hash(receipt), fencedIdempotencyKey: plan.fencedIdempotencyKey,
            runDirectory: out, postRetryAuthorized: false }); postAttempted = true;
          assertFreshPristine(receipt, plan, Date.now());
          must(Date.now() - fresh.checkedAt <= plan.metadataMaximumAgeMs, 'POST_SUBMISSION_SLOT_FACT_WINDOW');
          phase = 'single_provision_submission';
        } });
        phase = 'authenticated_bootstrap'; must(matches(await control.control.waitUntilHealthy(target)), 'BOOTSTRAP_NOT_PROVED');
        phase = 'compile_first_owner_once'; const payload = await control.compile(signal);
        try {
          await control.control.provision({ ...target, idempotencyKey: plan.idempotencyKey, compiledPayload: payload });
          await save('post-ack.json', { accepted: true, receivedAt: new Date().toISOString(), rawBodyPersisted: false, retryAllowed: false });
        } finally { clearFirstOwnerPassword(payload); }
        phase = 'authenticated_initialized_configuration'; const initialized = await control.control.readConfiguration(target);
        must(matches(initialized), 'INITIALIZED_OR_CONFIGURATION_NOT_PROVED');
        await save('initialized-proof.json', { protocol: 'techlong/manual-initialization-recovery-observation/v1', checkedAt: new Date().toISOString(),
          initialized, exactStoreVerified: true, firstOwnerReceiptVerified: true, httpCounts: control.httpCounts(), platformReady: false });
        phase = 'readonly_after'; await observe('after.json');
      } else {
        phase = 'independent_authenticated_inspect'; const run = path.resolve(args['--run']); must(directory(run), 'RUN_PATH');
        const slot = JSON.parse(await readFile(B.slot, 'utf8')), post = JSON.parse(await readFile(B.postSlot, 'utf8'));
        const receipt = JSON.parse(await readFile(run + '/sql-receipt.json', 'utf8'));
        must(slot.manifestSha256 === manifest.manifestSha256 && post.manifestSha256 === manifest.manifestSha256 &&
          path.resolve(slot.runDirectory) === run && path.resolve(post.runDirectory) === run &&
          slot.programSha256 === plan.sqlProgramSha256 && post.sqlReceiptSha256 === hash(receipt), 'SLOT_RECEIPT_CORRELATION');
        assertPristine(receipt); await recheck();
        control = await openManualRecoveryControl({ input, plan, mode, databaseUrl });
        const initialized = await control.control.readConfiguration(target); must(matches(initialized), 'INDEPENDENT_INITIALIZED_CONFIGURATION_NOT_PROVED');
        await save('independent-proof.json', { checkedAt: new Date().toISOString(), initialized, exactStoreVerified: true,
          httpCounts: control.httpCounts(), sqlReceiptRawFileSha256: hash(await readFile(run + '/sql-receipt.json')),
          freshAuthenticatedApiReadback: true, secondAuroraConnection: false, platformReady: false });
      }
    }
    const result = { mode, outcome: mode === 'Review' ? 'EXPLICIT_MANUAL_INITIALIZATION_REQUIRES_EXACT_APPROVAL'
      : mode === 'Run' ? 'INITIALIZED_CONFIGURATION_SAVED_REQUIRES_INDEPENDENT_INSPECT' : 'INITIALIZED_CONFIGURATION_INDEPENDENTLY_VERIFIED_PLATFORM_UNCHANGED',
      manifestSha256: manifest.manifestSha256, directory: out,
      admissionExpiresAt: new Date(plan.admissionExpiresAt).toISOString(), executionExpiresAt: new Date(plan.executionExpiresAt).toISOString(),
      workloadExpiresAt: plan.workloadExpiresAt, cloudWrites: 0, platformWrites: 0, metadataGroups,
      auroraConnections: mode === 'Run' ? 1 : 0, secretValueReads: valueReads, privateBundleLoads: control ? 1 : 0,
      postAttemptedThisProcess: postAttempted, slotsConsumedThisProcess: consumed ? 1 + Number(postAttempted) : 0,
      httpCounts: control?.httpCounts() || {}, platformReady: false, automaticRetries: 0 };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const code = /^(INITIALIZATION_RECOVERY|INITIALIZATION_AUDIT|EXPRESS_[A-Z0-9]+|WORKLOAD_RECOVERY|IMAGE_REPAIR)_[A-Z0-9_]+$/.test(e.message || '') ? e.message
      : ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name)
        ? 'INITIALIZATION_RECOVERY_SOURCE_REFRESH_REQUIRED' : 'INITIALIZATION_RECOVERY_PROVIDER_OR_LOCAL_FAILURE';
    const result = { mode, phase, code, outcome: consumed || mode === 'Inspect' ? 'INSPECT_ONLY_NO_POST_OR_SQL_RETRY' : 'STOPPED_BEFORE_NEW_READ_ATTEMPT',
      permanentSlotConsumedThisProcess: consumed, postAttemptedThisProcess: postAttempted, secretValueReads: valueReads,
      httpCounts: control?.httpCounts() || {}, cloudWrites: 0, platformWrites: 0, automaticRetries: 0, platformReady: false };
    await save('failure.json', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  } finally { control?.dispose(); api?.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
