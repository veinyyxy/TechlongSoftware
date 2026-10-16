// Reviewed exact queued job -> existing provider -> atomic same-job completion.
// No HTTP launcher, queue poller, retry, IAM installer or database provisioner.
import path from 'node:path';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExpressLiveInputsV1, LIVE_PRIVATE } from './express-live-local-inputs-v1.mjs';
import { hostingInputs } from './review-express-hosting-resume-v1.mjs';
import { initializedCodeBindingV3 } from './run-express-initialized-worker-v3.mjs';
import { createInitializedAwsV3 } from './aws-express-initialized-workload-v3.mjs';
import { prepareInitializedWorkloadV3, assertRunWindowV3, freeze, same } from './express-initialized-workload-v3.mjs';
import { W4_RISK_FILE, W4_ZERO_LEASE_TOKEN, requireW4 as must, createPlatformWorkerReaderV4,
  admitPlatformJobV4, preparePlatformReviewV4, assertPlatformManifestShapeV4, assertCurrentPlatformRowsV4, assertClaimMatchesReviewV4 } from './express-platform-worker-v4.mjs';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../../../lib/deployments/initialized-platform-request-v1.ts';
import { prepareExpressInitializedWorkerV2 } from '../../../lib/deployments/execution/express-initialized-worker-v2.ts';
import { compilePlatformInitializedClaimV4, compilePlatformInitializedCompleteV4, verifyPlatformInitializedCompletionReadbackV4,
  createPlatformInitializedPersistenceV4 } from '../../../lib/deployments/execution/express-platform-claim-v4.ts';
import { createExpressInitializedSingleJobRunnerV2 } from '../../../lib/deployments/execution/express-initialized-job-runner-v2.ts';
import { loadExpressPrivateControlSourcesV1 } from '../../../lib/deployments/execution/express-private-control-v1.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)), BASE = 'F:/ChatGPT_workshop';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => { const f = await open(file, 'wx', 0o600); try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
function directory(value) { const p = path.resolve(value || ''); must(path.dirname(p).toLowerCase() === path.resolve(BASE).toLowerCase() &&
  /^techlong-platform-w4-[a-z0-9-]+$/.test(path.basename(p)), 'OUTPUT_DIRECTORY'); return p; }
function assertEnvironment() {
  must(!['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CA_BUNDLE',
    'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
    'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLROOTCERT']
    .some(k => process.env[k] || process.env[k.toLowerCase()]) && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' &&
    !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT_OVERRIDE');
}
function slots(requestId) { must(/^[a-f0-9]{64}$/.test(requestId), 'REQUEST_ID'); return path.join(BASE, 'techlong-platform-w4-permanent-slots-v1', requestId); }
async function unusedRequest(requestId) {
  try { await access(path.join(slots(requestId), 'run.json')); must(false, 'REQUEST_ALREADY_ATTEMPTED'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function consumeFactory(requestId, manifestSha256, runDirectory) {
  const folder = slots(requestId); await mkdir(folder, { recursive: true });
  return async (entry, requestSha256) => {
    must(['run', 'claim_job', 'create_workload', 'private_control_load', 'atomic_complete'].includes(entry) && /^[a-f0-9]{64}$/.test(requestSha256), 'JOURNAL_ENTRY');
    await save(path.join(folder, entry + '.json'), { schema: 'techlong/platform-worker-entry/v4', manifestSha256, requestSha256,
      runDirectory, jobRequestId: requestId, consumedAt: Date.now(), state: 'CONSUMED_BEFORE_ATTEMPT', retryAllowed: false });
  };
}
export async function platformCodeBindingV4(history) {
  const prior = await initializedCodeBindingV3(history), pins = [...prior.pins], seen = new Set(pins.map(p => p.file.toLowerCase()));
  async function pin(file) {
    const absolute = path.resolve(ROOT, file); must(absolute.toLowerCase().startsWith(path.resolve(ROOT).toLowerCase() + path.sep), 'CODE_OUTSIDE_ROOT');
    const relative = path.relative(ROOT, absolute).replaceAll('\\', '/'); if (seen.has(relative.toLowerCase())) return;
    seen.add(relative.toLowerCase()); const code = await readFile(absolute, 'utf8'); pins.push({ file: relative, rawFileSha256: await sha256Hex(code) });
    if (!/\.(ts|tsx|mjs|js)$/.test(absolute)) return;
    for (const match of code.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const p = path.resolve(path.dirname(absolute), match[1]); let found;
      for (const f of [p, p + '.ts', p + '.mjs', p + '.js', p + '.tsx', path.join(p, 'index.ts')]) {
        try { await access(f); found = f; break; } catch { /* next explicit extension */ }
      }
      must(found, 'CODE_IMPORT_UNRESOLVED'); await pin(found);
    }
  }
  await pin('ops/aws-sandbox/scripts/run-express-platform-worker-v4.mjs'); await pin(W4_RISK_FILE);
  await pin('ops/aws-sandbox/reviews/aurora-dual-mode-w3-worker-root.executed.json');
  const preparedFile = 'ops/aws-sandbox/reviews/aurora-dual-mode-w4a-platform-entry.prepared.json', w4a = await json(path.join(ROOT, preparedFile));
  await pin(preparedFile); for (const p of w4a.ownPins) await pin(p.file);
  // Refresh actual public bytes, not only previously captured digest strings.
  for (const p of history) must(await sha256Hex(await readFile(p.path, 'utf8')) === p.rawFileSha256, 'PUBLIC_HISTORY_DRIFT');
  pins.sort((a, b) => a.file.localeCompare(b.file));
  return { nodeVersion: process.version, pins, publicHistory: history };
}
export async function platformPublicContextV4() {
  const inputs = await loadExpressLiveInputsV1(), prior = await hostingInputs();
  const root = await prepareExpressInitializedWorkerV2({ delivery: { ...inputs.delivery,
    scope: { ...inputs.delivery.scope, ownerDeploymentId: S.deploymentId } }, existingDefaultStoreId: S.existingDefaultStoreId });
  must(root.materialSha256 === S.materialSha256, 'PUBLIC_MATERIAL');
  const executed = await json(path.join(ROOT, 'ops/aws-sandbox/reviews/aurora-dual-mode-w3-worker-root.executed.json'));
  must(executed.approvedManifestSha256 === 'bf4bd8b45acc0a01d1e24451e219891ee9d30521ac41a17e0d460fb584909937' &&
    executed.liveCoordinates.stackId.endsWith('/74a79560-c981-11f1-bfcc-06ffde30f30d') && executed.liveCoordinates.taskDefinitionArn.endsWith(':4'), 'KNOWN_W3_PREDECESSOR');
  const history = [...inputs.history], readProof = async name => {
    const file = BASE + '/techlong-worker-w3-run-20261016-r1/' + name, pin = executed.rawEvidence.find(p => p.path === file);
    const raw = await readFile(file, 'utf8'); must(pin && await sha256Hex(raw) === pin.rawFileSha256, 'W3_PUBLIC_EVIDENCE');
    history.push({ path: file, rawFileSha256: pin.rawFileSha256 }); return JSON.parse(raw);
  };
  const provider = await readProof('provider-after.json'), completion = await readProof('completion-reference.json');
  const proof = JSON.parse(completion.outputs).expressInitializedWorkerRunsV2[executed.run.jobId];
  must(await sha256Hex(proof) === executed.run.receiptSha256 && proof.stackId === provider.stackId &&
    proof.providerObservationSha256 === provider.providerObservationSha256 && provider.physical.TenantTaskDefinition === executed.liveCoordinates.taskDefinitionArn,
  'W3_RECEIPT_PROVIDER_COORDINATE');
  const originalReview = await json(BASE + '/techlong-worker-w3-review-20261016-r2/manifest.json');
  const oldBinding = await initializedCodeBindingV3(inputs.history);
  must(same(oldBinding.pins, originalReview.binding.pins), 'PROVEN_W3_CODE_CHANGED');
  const predecessor = { jobId: executed.run.jobId, stackId: provider.stackId,
    taskDefinitionArn: provider.physical.TenantTaskDefinition, receiptSha256: executed.run.receiptSha256 };
  const base = { compute: inputs.compute, iam: { cfnRole: inputs.cfnInventory.role,
    roles: inputs.iamBefore.roles.filter(r => ['TechlongSandboxTaskRole', 'TechlongSandboxTaskExecutionRole'].includes(r.name)),
    policies: [inputs.cfnInventory.policy, inputs.iamBefore.boundary] }, predecessorStackId: predecessor.stackId,
  predecessorTaskDefinitionArn: predecessor.taskDefinitionArn, expectedTaskSha256: prior.readyTaskSha256,
  janitorCodeSha256: 'LTQwSFbnrnl9fjdg2N7GCxLCKiKHeDBBjNWsQ4EdWdA=', epochItem: inputs.previousPlan.proposedEpochTransaction.TransactItems[1].Put.Item,
  hostedZoneId: inputs.previousPlan.proposedDnsCreate.HostedZoneId, dnsRecord: inputs.previousPlan.proposedDnsCreate.ChangeBatch.Changes[0].ResourceRecordSet };
  const privateSource = { directory: LIVE_PRIVATE, summarySha256: inputs.privatePlan.historicalSummarySha256,
    containsUnexposedPaymentKeys: true, runtimeSecretValueApiAuthorized: false, applicationGets: 2, initializationPosts: 0 };
  return { inputs, root, base, predecessor, privateSource, binding: await platformCodeBindingV4(history) };
}

export async function main(args = process.argv.slice(2)) {
  must(args.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < args.length; n += 2) pairs.push([args[n], args[n + 1]]);
  const a = Object.fromEntries(pairs), mode = a['--mode'];
  const keys = mode === 'CheckRuntime' ? ['--mode'] : mode === 'CheckSources' ? ['--mode', '--output'] : mode === 'Review' ? ['--mode', '--job-id', '--output'] :
    mode === 'RunOnce' ? ['--mode', '--manifest', '--approved-sha', '--output'] : ['--mode', '--manifest', '--run', '--output'];
  must(['CheckRuntime', 'CheckSources', 'Review', 'RunOnce', 'Inspect'].includes(mode) && pairs.length === keys.length &&
    Object.keys(a).length === pairs.length && keys.every(k => a[k]) && process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase(), 'ARGUMENTS');
  assertEnvironment();
  if (mode === 'CheckRuntime') { const result = { mode, state: 'EXACT_PLATFORM_JOB_REVIEW_RUN_INSPECT_ROOT_READY_NOT_ACTIVATED',
    cloudWrites: 0, databaseQueries: 0, privateReads: 0, newIamRequiredByCode: false, createsNewJob: false, queuePollerEnabled: false };
    console.log(JSON.stringify(result, null, 2)); return result; }
  const out = directory(a['--output']); await mkdir(out); const put = (name, value) => save(path.join(out, name), value);
  let api, privateSources, reader, stage = 'local_approval', entered = false;
  const signal = AbortSignal.timeout(mode === 'RunOnce' ? 23 * 60000 : 180000);
  try {
    let manifest;
    if (['RunOnce', 'Inspect'].includes(mode)) {
      const file = path.resolve(a['--manifest']); directory(path.dirname(file)); must(path.basename(file) === 'manifest.json', 'MANIFEST_FILENAME');
      manifest = await json(file); await assertPlatformManifestShapeV4(manifest); const { manifestSha256 } = manifest;
      if (mode === 'RunOnce') { must(a['--approved-sha'] === manifestSha256, 'SPECIFIC_MANIFEST_APPROVAL_REQUIRED'); assertRunWindowV3(manifest, Date.now()); }
    }
    if (mode === 'CheckSources') {
      stage = 'public_sources_only'; const c = await platformPublicContextV4();
      await put('binding.json', c.binding);
      const result = { mode, outcome: 'PUBLIC_SOURCE_AND_EXACT_W3_PREDECESSOR_BINDING_PASSED', codePins: c.binding.pins.length,
        predecessor: c.predecessor, materialSha256: c.root.materialSha256, databaseQueries: 0, cloudCalls: 0, privateReads: 0, slotsConsumed: 0 };
      await put('result.json', result); console.log(JSON.stringify(result, null, 2)); return result;
    }
    const configured = parseEnv(await readFile(path.join(ROOT, '.env.local'), 'utf8'));
    must(configured.DEPLOYMENT_WORKER_ENABLED !== 'true' && configured.AWS_APPLY_ENABLED !== 'true', 'GLOBAL_QUEUE_MUST_STAY_OFF');
    const databaseUrl = configured.DATABASE_URL, url = new URL(databaseUrl);
    const endpointSha256 = await sha256Hex([url.hostname, url.port || '5432', url.pathname, url.username]);
    reader = createPlatformWorkerReaderV4(databaseUrl);
    let observed;
    if (mode === 'Review') {
      stage = 'read_exact_held_job'; observed = await reader.read(a['--job-id'], signal);
      await unusedRequest(JSON.parse(observed.job.payload).requestId);
    }
    stage = 'public_sources'; const c = await platformPublicContextV4();
    if (mode === 'Review') {
      stage = 'admit_exact_platform_job';
      const admission = await admitPlatformJobV4({ root: c.root, observed, predecessor: c.predecessor, now: Date.now() });
      api = createInitializedAwsV3(c.base); stage = 'readonly_provider_review'; const cell = await api.readCell(signal);
      const workload = await prepareInitializedWorkloadV3({ root: c.root, jobPlan: admission.jobPlan, cell, publicParameters: c.inputs.privateReceipt.publicParameters });
      const preflight = await api.inspectBefore(workload, admission.jobPlan, signal); await put('provider-review.json', preflight);
      manifest = await preparePlatformReviewV4({ admission, workload, binding: c.binding, endpointSha256, preflight, predecessor: c.predecessor, privateSource: c.privateSource });
      await put('manifest.json', manifest);
      const result = { mode, outcome: 'READY_FOR_EXACT_QUEUED_JOB_APPROVAL_NO_WRITES', manifestSha256: manifest.manifestSha256,
        jobId: manifest.jobPlan.jobId, queuedRowSha256: manifest.queue.rowSha256, programs: manifest.programs,
        claimBy: new Date(manifest.jobPlan.claimBy).toISOString(), workloadExpiresAt: new Date(workload.workloadExpiresAt).toISOString(),
        counts: api.counts(), reads: reader.counts(), jobInserts: 0, cloudWrites: 0, databaseWrites: 0, privateReads: 0, slotsConsumed: 0 };
      await put('result.json', result); console.log(JSON.stringify(result, null, 2)); return result;
    }
    stage = 'rebuild_exact_manifest';
    must(same(manifest.binding, c.binding) && manifest.endpointSha256 === endpointSha256 && same(manifest.predecessor, c.predecessor) &&
      same(manifest.privateSource, c.privateSource) && same(manifest.jobPlan.material, c.root.material), 'MANIFEST_CODE_SOURCE_DRIFT');
    const admission = await admitPlatformJobV4({ root: c.root, observed: { snapshot: manifest.jobPlan.snapshot, job: manifest.queue.row,
      jobs: [manifest.queue.row, manifest.queue.proofJob], requester: manifest.queue.requester, checkedAt: manifest.queue.observedAt },
    predecessor: c.predecessor, now: manifest.jobPlan.preparedAt });
    must(same(admission, { jobPlan: manifest.jobPlan, queue: manifest.queue, programs: manifest.programs }), 'QUEUE_OR_PROGRAM_DERIVATION');
    const workload = await prepareInitializedWorkloadV3({ root: c.root, jobPlan: manifest.jobPlan, publicParameters: c.inputs.privateReceipt.publicParameters,
      cell: { stackId: c.base.compute.stackId, outputs: manifest.workload.cellOutputs, parentTagExpiresAt: manifest.workload.parentTagExpiresAt, activeCellCount: 1, activeTenantCount: 0 } });
    must(same(workload, manifest.workload), 'WORKLOAD_DERIVATION'); manifest = freeze(manifest); api = createInitializedAwsV3(c.base);
    if (mode === 'Inspect') {
      stage = 'independent_inspect'; const run = directory(a['--run']), originalActor = manifest.queue.requester.id;
      observed = await reader.read(manifest.jobPlan.jobId, signal, originalActor);
      let completion = 'NOT_PROVED', provider = 'NOT_PROVED';
      const boundSlot = async (entry, hash) => { const slot = await json(path.join(slots(manifest.jobPlan.requestId), entry + '.json'));
        must(slot.manifestSha256 === manifest.manifestSha256 && slot.requestSha256 === hash &&
          path.resolve(slot.runDirectory) === run && slot.jobRequestId === manifest.jobPlan.requestId, 'INSPECT_SLOT_BINDING'); };
      try {
        const ref = await json(path.join(run, 'completion-reference.json'));
        await boundSlot('run', manifest.manifestSha256); await boundSlot('atomic_complete', await sha256Hex(ref));
        must(ref.queuedRowSha256 === manifest.queue.rowSha256 && ref.completionContractSha256 === manifest.programs.completionContractSha256 &&
          await sha256Hex(JSON.parse(ref.outputs).expressInitializedWorkerRunsV2[manifest.jobPlan.jobId]) === ref.receiptSha256 &&
          observed.jobs.some(j => same(j, manifest.queue.proofJob)), 'COMPLETION_REFERENCE_OR_PRIOR_PROOF_DRIFT');
        const template = await compilePlatformInitializedClaimV4({ plan: manifest.jobPlan, queuedJob: manifest.queue.row,
          approvedPlanSha256: manifest.jobPlan.planSha256, leaseToken: W4_ZERO_LEASE_TOKEN });
        await verifyPlatformInitializedCompletionReadbackV4({ plan: manifest.jobPlan, queuedJob: manifest.queue.row, lease: template.lease,
          snapshot: observed.snapshot, job: observed.job, expectedOutputs: ref.outputs });
        completion = 'SAME_PLATFORM_JOB_SUCCEEDED_OLD_ROWS_PRESERVED';
      } catch { /* Ambiguous/missing acknowledgement is read-only, never replay. */ }
      try {
        const ack = await json(path.join(run, 'create-ack.json'));
        await boundSlot('run', manifest.manifestSha256); await boundSlot('create_workload', workload.requestSha256);
        await api.inspectAfter(workload, manifest.jobPlan, ack.stackId, signal); provider = 'EXACT_WORKLOAD_PROVED';
      } catch { /* expired/deleted/unknown != current health */ }
      const result = { mode, manifestSha256: manifest.manifestSha256, completion, provider, jobId: manifest.jobPlan.jobId,
        jobStatus: observed.job?.status ?? 'ABSENT', checkedAt: Date.now(), counts: api.counts(), reads: reader.counts(),
        databaseWrites: 0, cloudWrites: 0, privateReads: 0, retryAllowed: false };
      await put('result.json', result); console.log(JSON.stringify(result, null, 2)); return result;
    }
    stage = 'run_readonly_preflight'; await unusedRequest(manifest.jobPlan.requestId);
    observed = await reader.read(manifest.jobPlan.jobId, signal); assertCurrentPlatformRowsV4(manifest, observed, Date.now());
    const preflight = await api.inspectBefore(workload, manifest.jobPlan, signal); await put('run-preflight.json', preflight);
    must(same(await platformCodeBindingV4(c.binding.publicHistory), manifest.binding), 'POST_PREFLIGHT_CODE_DRIFT'); assertRunWindowV3(manifest, Date.now());
    const consume = await consumeFactory(manifest.jobPlan.requestId, manifest.manifestSha256, out);
    await consume('run', manifest.manifestSha256); entered = true; assertRunWindowV3(manifest, Date.now());
    await put('run-reference.json', { manifestSha256: manifest.manifestSha256, jobPlanSha256: manifest.jobPlan.planSha256,
      queuedRowSha256: manifest.queue.rowSha256, requestSha256: workload.requestSha256 });
    const repository = createPlatformInitializedPersistenceV4(databaseUrl, manifest.queue.row);
    const persisted = { ...repository,
      async claim(request, s) { const compiled = await assertClaimMatchesReviewV4(manifest, request);
        await consume('claim_job', compiled.programSha256); return repository.claim(request, s); },
      async complete(request, s) { const compiled = await compilePlatformInitializedCompleteV4({ ...request, queuedJob: manifest.queue.row });
        const ref = { programSha256: compiled.programSha256, outputs: compiled.outputs, receiptSha256: compiled.receiptSha256,
          queuedRowSha256: manifest.queue.rowSha256, completionContractSha256: manifest.programs.completionContractSha256 };
        await put('completion-reference.json', ref); await consume('atomic_complete', await sha256Hex(ref));
        const result = await repository.complete(request, s);
        // W2 already rechecks the original nine rows/new job. W3's additional
        // success is a separate retained row: independently compare it as well.
        const after = await reader.read(manifest.jobPlan.jobId, s, manifest.queue.requester.id);
        must(after.jobs.some(j => same(j, manifest.queue.proofJob)), 'PRIOR_SUCCESSFUL_JOB_DRIFT_REQUIRES_INSPECT');
        return { ...result, priorSuccessfulProofJobPreserved: true }; },
    };
    let controlOpened = false, privateLoadAttempted = false; const used = new Set();
    const readback = { async readConfiguration(request) {
      must(!controlOpened, 'PRIVATE_LOAD_REENTRY'); controlOpened = true; request.signal.throwIfAborted();
      await consume('private_control_load', workload.publicParametersSha256);
      privateLoadAttempted = true;
      privateSources = await loadExpressPrivateControlSourcesV1({ directory: LIVE_PRIVATE, plan: c.inputs.privatePlan });
      must(await sha256Hex(privateSources.publicParameters) === workload.publicParametersSha256, 'PRIVATE_PUBLIC_PARAMETERS_DRIFT');
      const guarded = { async send(r, options) { const key = r.method + ' ' + new URL(r.url).pathname;
        must(r.method === 'GET' && ['GET /api/saas/readiness', 'GET /api/saas/control'].includes(key) && !used.has(key), 'CONTROL_REQUEST_BUDGET');
        used.add(key); return privateSources.controlTransport.send(r, options); } };
      return c.root.composeInitializedReadback({ transport: guarded, tokens: privateSources.controlTokens }).readConfiguration(request);
    } };
    const runner = createExpressInitializedSingleJobRunnerV2({ plan: manifest.jobPlan, repository: persisted,
      workload: api.bindOnce(workload, manifest.jobPlan, consume, put), readback });
    stage = 'exact_queued_job_run'; const outcome = await runner.runOnce({ approvedPlanSha256: manifest.jobPlan.planSha256, signal });
    const result = { mode, manifestSha256: manifest.manifestSha256, ...outcome, counts: api.counts(), reads: reader.counts(),
      privatePackageLoadAttempts: privateLoadAttempted ? 1 : 0, privatePackageLoaded: Boolean(privateSources), applicationGetAttempts: used.size, newJobs: 0, sourceSecretValueReads: 0,
      samePlatformJob: true, queuePollerEnabled: false, retryAllowed: false };
    await put('result.json', result); console.log(JSON.stringify(result, null, 2)); if (result.outcome === 'INSPECT_REQUIRED_NO_RETRY') process.exitCode = 1; return result;
  } catch (e) {
    const code = /^(PLATFORM_W4|INITIALIZED_W3)_[A-Z0-9_]+$/.test(e.message || '') ? e.message :
      ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name) ? 'SOURCE_REFRESH_REQUIRED' : 'SANITIZED_REQUIRES_INSPECT';
    const result = { mode, outcome: 'STOPPED_NO_AUTOMATIC_RETRY', stage, code, rootEntered: entered, counts: api?.counts(), reads: reader?.counts(),
      retryAllowed: false, queuePollerEnabled: false };
    await put('result.json', result); console.log(JSON.stringify(result, null, 2)); process.exitCode = 1; return result;
  } finally { privateSources?.dispose(); api?.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error(JSON.stringify({ outcome: 'UNHANDLED_FAILURE_REQUIRES_INSPECT_NO_RETRY', retryAllowed: false })); process.exitCode = 1;
});
