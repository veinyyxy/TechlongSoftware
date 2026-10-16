import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { CreateStackCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { neon } from '@neondatabase/serverless';
import { loadReadyInputs } from './review-express-ready-reconciliation-v1.mjs';
import { publicInputs, publicGet, REQUESTS } from './review-express-public-smoke-v1.mjs';
import { H, hash, same, must, resumePlan, stable, validateResumeBefore, admission, bindExecution, executionWindow,
  resumeReceipt, compileRebind, validateRebound } from './express-hosting-resume-plan-v1.mjs';
import { observeResume, readResumeState, recoveryClients } from './express-hosting-resume-observer-v1.mjs';
const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop';
async function save(file, data) { const f = await open(file, 'wx'); try { await f.writeFile(JSON.stringify(data, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } }
async function absent(file) { try { await access(file); must(false, 'PERMANENT_SLOT_OCCUPIED'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
export async function hostingInputs() {
  const prior = await loadReadyInputs(), publicBinding = await publicInputs();
  const ready = JSON.parse(await readFile(ROOT + '/ops/aws-sandbox/reviews/aurora-dual-mode-k2c-ready-reconciliation.executed.json'));
  const k2cManifest = JSON.parse(await readFile(BASE + '/techlong-express-k2c-review-20261016-r2/manifest.json'));
  must(same(prior.binding, k2cManifest.binding) && ready.approvedManifestSha256 === k2cManifest.manifestSha256, 'K2C_BINDING_CHANGED');
  const readyMetadata = JSON.parse(await readFile(BASE + '/techlong-express-k2c-inspect-20261016-r1/metadata.json'));
  const pins = [];
  for (const file of ['ops/aws-sandbox/scripts/express-hosting-resume-plan-v1.mjs', 'ops/aws-sandbox/scripts/express-hosting-resume-observer-v1.mjs',
    'ops/aws-sandbox/scripts/review-express-hosting-resume-v1.mjs', 'tests/express-hosting-resume-v1.test.mjs', H.risk])
    pins.push({ file, rawFileSha256: hash(await readFile(ROOT + '/' + file)) });
  return { base: prior.base, ready, k2cManifest, readyPlatform: readyMetadata.baseline.platform, readyTaskSha256: readyMetadata.baseline.expectedTaskSha256,
    binding: { prior: prior.binding, publicBinding, pins, nodeVersion: process.version } };
}
export async function main(raw = process.argv.slice(2)) {
  must(raw.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
  const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
  const directory = p => path.dirname(p).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-k3r-[a-z0-9-]+$/.test(path.basename(p));
  const keys = ['Check', 'Review'].includes(mode) ? ['--mode', '--output'] : mode === 'Run'
    ? ['--mode', '--output', '--manifest', '--approved-sha'] : ['--mode', '--output', '--manifest', '--approved-sha', '--run'];
  must(['Check', 'Review', 'Run', 'Inspect'].includes(mode) && pairs.length === keys.length && keys.every(k => args[k]) &&
    Object.keys(args).every(k => keys.includes(k)) && new Set(pairs.map(p => p[0])).size === pairs.length && directory(out) &&
    process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase(), 'ARGUMENTS_LOCATION');
  must(!['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CA_BUNDLE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
    'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLROOTCERT']
    .some(k => process.env[k] || process.env[k.toLowerCase()]) && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' &&
    !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out); const put = (name, data) => save(out + '/' + name, data);
  let api, phase = 'local', rootConsumed = false, writeConsumed = false, inspectConsumed = false, createEntered = false, committed = false, attempts = 0;
  try {
    const input = await hostingInputs(); await put('binding.json', input.binding);
    if (mode !== 'Inspect') for (const p of [H.slot, H.writeSlot, H.inspectSlot]) await absent(p);
    if (mode === 'Check') { const result = { mode, outcome: 'HOSTING_RESUME_BINDING_CHECKED_NO_ACTION', ownPins: input.binding.pins.length,
      writes: 0, networkCalls: 0, privateLoads: 0, slotsConsumed: 0 }; await put('result.json', result); console.log(JSON.stringify(result, null, 2)); return; }
    const databaseUrl = parseEnv(await readFile(ROOT + '/.env.local', 'utf8')).DATABASE_URL;
    let manifest, plan, execution, program, publicProof;
    if (mode !== 'Review') {
      const file = path.resolve(args['--manifest']); must(path.basename(file) === 'manifest.json' && directory(path.dirname(file)), 'MANIFEST_PATH');
      manifest = JSON.parse(await readFile(file, 'utf8')); const { manifestSha256, ...body } = manifest;
      must(manifestSha256 === args['--approved-sha'] && /^[a-f0-9]{64}$/.test(manifestSha256) && hash(body) === manifestSha256 &&
        manifest.schema === 'techlong/hosting-resume-manifest/v1' && same(input.binding, manifest.binding), 'EXACT_APPROVAL');
      // Re-derive only the reviewed plan; this is not a current observation.
      plan = resumePlan(input, { snapshot: manifest.plan.expectedState, endpointSha256: manifest.plan.endpointSha256,
        catalog: { server_sha256: manifest.plan.catalogSha256 } }, manifest.plan.preparedAt);
      must(same(plan, manifest.plan), 'PLAN_CHANGED');
      if (mode === 'Run') admission(plan, Date.now());
      else {
        const run = path.resolve(args['--run']); must(directory(run), 'RUN_PATH');
        execution = JSON.parse(await readFile(run + '/execution-binding.json'));
        must(same(execution, bindExecution(plan, manifestSha256, execution.startedAt)), 'EXECUTION_DERIVATION'); executionWindow(execution, Date.now());
        const slot = JSON.parse(await readFile(H.slot)), write = JSON.parse(await readFile(H.writeSlot));
        program = JSON.parse(await readFile(run + '/rebind-program.json')); publicProof = JSON.parse(await readFile(run + '/public-proof.json'));
        must(slot.manifestSha256 === manifestSha256 && slot.executionSha256 === hash(execution) && path.resolve(slot.runDirectory) === run &&
          write.manifestSha256 === manifestSha256 && write.programSha256 === program.programSha256 && path.resolve(write.runDirectory) === run &&
          same(program, compileRebind(plan, execution, program.receipt, input)) && hash(publicProof) === program.receipt.publicProofSha256 &&
          publicProof.length === 3 && publicProof.every(p => p.expectedResponseVerified), 'INSPECT_CORRELATION');
        await absent(H.inspectSlot); await save(H.inspectSlot, { manifestSha256, consumedAt: new Date().toISOString(), runDirectory: run, repeatAllowed: false }); inspectConsumed = true;
      }
    }
    api = recoveryClients();
    const observe = async (name, hostPhase, receipt, x = execution) => {
      const value = await observeResume({ api, historical: input.base.historical, historicalPreflight: input.base.historicalPreflight,
        plan: x || plan, databaseUrl, baseline: manifest?.baseline, previousPlatform: input.readyPlatform, priorTaskSha256: input.readyTaskSha256, receipt,
        phase: hostPhase, signal: AbortSignal.timeout(180000) }); await put(name, value); return value;
    };
    const state = async (name, receipt) => { const value = await readResumeState({ databaseUrl, input, receipt, signal: AbortSignal.timeout(30000) }); await put(name, value); return value; };
    const recheck = async () => { must(same(input.binding, (await hostingInputs()).binding), 'CODE_HISTORY_CHANGED');
      if (execution) executionWindow(execution, Date.now()); else admission(plan, Date.now()); };
    phase = 'readonly_preflight';
    if (mode === 'Review') {
      const current = await state('state.json'); plan = resumePlan(input, current, Date.now());
      const hosting = await observe('metadata.json', 'before'); plan = resumePlan(input, current, Date.now());
      const body = { schema: 'techlong/hosting-resume-manifest/v1', plan, binding: input.binding, baseline: hosting.baseline,
        observationSha256: hash(hosting), stateSha256: hash(current), preparationIsNotExecutionApproval: true };
      manifest = { ...body, manifestSha256: hash(body) }; await put('manifest.json', manifest);
    } else if (mode === 'Inspect') {
      const hosting = await observe('metadata.json', 'after', program.receipt);
      must(hosting.live.stackId === program.receipt.stackId && hosting.live.taskDefinitionArn === program.receipt.taskDefinitionArn, 'INDEPENDENT_HOST_ID');
      const current = await state('state.json', program.receipt); validateRebound(current.snapshot, plan, execution, program.receipt);
      must(current.endpointSha256 === plan.endpointSha256 && current.catalog.server_sha256 === plan.catalogSha256, 'INDEPENDENT_SOURCE_CATALOG');
    } else {
      const hosting = await observe('metadata.json', 'before'), current = await state('state.json');
      validateResumeBefore(current.snapshot, input); must(same(stable(current.snapshot), plan.expectedState) && current.endpointSha256 === plan.endpointSha256 &&
        current.catalog.server_sha256 === plan.catalogSha256, 'CURRENT_ROWS_OR_CATALOG_CHANGED');
      await recheck(); must(Date.now() - hosting.checkedAt < 30000, 'CREATE_FACT_WINDOW');
      execution = bindExecution(plan, manifest.manifestSha256, Date.now()); await put('execution-binding.json', execution);
      await save(H.slot, { manifestSha256: manifest.manifestSha256, executionSha256: hash(execution), requestSha256: execution.requestSha256,
        consumedAt: new Date().toISOString(), runDirectory: out, retryAllowed: false }); rootConsumed = true;
      admission(plan, Date.now()); executionWindow(execution, Date.now()); must(Date.now() - hosting.checkedAt < 30000, 'POST_SLOT_FACT_WINDOW');
      phase = 'single_create_stack'; createEntered = true;
      const ack = await api.cfn.send(new CreateStackCommand(execution.request), { abortSignal: AbortSignal.timeout(30000) });
      must(ack.StackId && ack.StackId !== H.stack && ack.StackId.startsWith('arn:aws:cloudformation:ca-central-1:402010193138:stack/' + H.name + '/'), 'CREATE_UUID_ACK');
      await put('submission.json', { stackId: ack.StackId, acknowledgedAt: new Date().toISOString(), requestId: ack.$metadata?.requestId });
      phase = 'wait_create'; const deadline = Date.now() + 30 * 60000; let polls = 0;
      for (;;) {
        executionWindow(execution, Date.now()); must(++polls <= 122, 'POLL_LIMIT');
        const s = (await api.cfn.send(new DescribeStacksCommand({ StackName: ack.StackId }), { abortSignal: AbortSignal.timeout(30000) })).Stacks?.[0];
        must(s?.StackId === ack.StackId, 'WAIT_UUID'); if (s.StackStatus === 'CREATE_COMPLETE') break;
        must(s.StackStatus === 'CREATE_IN_PROGRESS' && Date.now() < deadline, 'CREATE_NOT_COMPLETE_STOP');
        console.log(JSON.stringify({ phase, status: s.StackStatus, mutationRetries: 0 })); await delay(15000);
      }
      phase = 'verify_new_hosting'; const after = await observe('after-hosting.json', 'after');
      must(after.live.stackId === ack.StackId, 'ACK_HOST_CORRELATION'); await recheck();
      phase = 'three_unsigned_gets'; publicProof = []; const overall = AbortSignal.timeout(45000);
      for (const spec of REQUESTS) {
        executionWindow(execution, Date.now()); overall.throwIfAborted();
        await put('http-' + (attempts + 1) + '.intent.json', { manifestSha256: manifest.manifestSha256, path: spec.path, enteredAt: new Date().toISOString(), retryAllowed: false });
        executionWindow(execution, Date.now()); attempts++;
        const observed = await publicGet(spec, AbortSignal.any([overall, AbortSignal.timeout(Math.min(10000, execution.finishBefore - Date.now()))]));
        publicProof.push(observed); await put('http-' + attempts + '.result.json', observed);
      }
      await put('public-proof.json', publicProof);
      const receipt = resumeReceipt(plan, execution, after, publicProof, Date.parse(publicProof.at(-1).checkedAt));
      const beforeWrite = await state('before-write-state.json');
      must(same(stable(beforeWrite.snapshot), plan.expectedState) && beforeWrite.catalog.server_sha256 === plan.catalogSha256 && beforeWrite.endpointSha256 === plan.endpointSha256, 'PREWRITE_DRIFT');
      program = compileRebind(plan, execution, receipt, input); await put('rebind-program.json', program); await recheck();
      const freshness = () => must(Date.now() - receipt.checkedAt < 30000 && Date.now() - receipt.hostingCheckedAt < 30000, 'REBIND_FACT_WINDOW'); freshness();
      await save(H.writeSlot, { manifestSha256: manifest.manifestSha256, programSha256: program.programSha256, consumedAt: new Date().toISOString(), runDirectory: out, retryAllowed: false }); writeConsumed = true;
      executionWindow(execution, Date.now()); freshness(); phase = 'single_neon_rebind';
      const sql = neon(databaseUrl, { fullResults: true });
      const results = await sql.transaction(tx => program.statements.map(q => tx.query(q.text, q.values)),
        { readOnly: false, isolationLevel: 'Serializable', fullResults: true, fetchOptions: { signal: AbortSignal.timeout(30000) } });
      must(results.length === 5 && results.every(r => r.rowCount === 1) && results.slice(1).every(r => r.rows[0]?.accepted === 1), 'COMMIT_NOT_PROVED'); committed = true;
      await put('transaction-ack.json', { acknowledgedAt: new Date().toISOString(), programSha256: program.programSha256, transactions: 1, changedRows: 1, statements: 5 });
      phase = 'readonly_rebound'; const final = await state('after-state.json', receipt); validateRebound(final.snapshot, plan, execution, receipt);
      must(final.catalog.server_sha256 === plan.catalogSha256 && final.endpointSha256 === plan.endpointSha256, 'AFTER_SOURCE_CATALOG');
    }
    const result = { mode, outcome: mode === 'Review' ? 'HOSTING_RESUME_REQUIRES_FRESH_EXACT_APPROVAL' : mode === 'Run'
      ? 'HOSTING_RESUMED_PUBLIC_SMOKE_REBIND_ACK_REQUIRES_INDEPENDENT_INSPECT' : 'HOSTING_PUBLIC_PROOF_AND_PLATFORM_REBIND_INDEPENDENTLY_VERIFIED',
      manifestSha256: manifest.manifestSha256, approvalExpiresAt: new Date(plan.approvalExpiresAt).toISOString(),
      workloadExpiresAt: execution?.expiresAt || 'DERIVED_ONCE_AT_RUN_STARTED_AT_PLUS_7200_SECONDS', rootConsumed, writeConsumed, inspectConsumed,
      createEntered, neonCommitAcknowledgedThisProcess: committed, publicGetAttemptsThisProcess: attempts,
      privateLoads: 0, secretValueReads: 0, directAuroraConnections: 0, applicationPosts: 0, iamWrites: 0, dnsWrites: 0, ddbWrites: 0,
      initializedAgain: false, instanceOrJobChanged: false, automaticRetries: 0, publicProofVerified: mode !== 'Review', independentReadyVerified: mode === 'Inspect' };
    await put('result.json', result); console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    const code = /^(HOSTING_RESUME|WORKLOAD_RECOVERY|IMAGE_REPAIR)_[A-Z0-9_]+$/.test(e.message || '') ? e.message :
      ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name) ? 'HOSTING_RESUME_SOURCE_REFRESH_REQUIRED' : 'HOSTING_RESUME_LOCAL_OR_PROVIDER_FAILURE';
    const result = { mode, phase, code, outcome: 'STOP_PRESERVE_EVIDENCE_NO_RETRY', rootConsumed, writeConsumed, inspectConsumed,
      createEntered, committed, publicGetAttempts: attempts, privateLoads: 0, initializedAgain: false, automaticRetries: 0 };
    await put('failure.json', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  } finally { api?.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
