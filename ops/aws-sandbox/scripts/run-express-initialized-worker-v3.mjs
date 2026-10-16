// One reviewed initialized-tenant workload, never a queue/daemon/first apply.
import path from 'node:path';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadExpressLiveInputsV1, LIVE_PRIVATE } from './express-live-local-inputs-v1.mjs';
import { hostingInputs } from './review-express-hosting-resume-v1.mjs';
import { createInitializedAwsV3 } from './aws-express-initialized-workload-v3.mjs';
import { prepareInitializedWorkloadV3, externalFenceFromSnapshotV3, assertRunWindowV3, same, freeze, requireW3 as must } from './express-initialized-workload-v3.mjs';
import { prepareExpressInitializedWorkerV2 } from '../../../lib/deployments/execution/express-initialized-worker-v2.ts';
import { prepareExpressInitializedJobV2, compileExpressInitializedClaimV2, compileExpressInitializedCompleteV2,
  verifyExpressInitializedCompletionReadbackV2 } from '../../../lib/deployments/execution/express-initialized-job-v2.ts';
import { createExpressInitializedJobNeonV2 } from '../../../lib/deployments/execution/express-initialized-job-neon-v2.ts';
import { createExpressInitializedSingleJobRunnerV2 } from '../../../lib/deployments/execution/express-initialized-job-runner-v2.ts';
import { loadExpressPrivateControlSourcesV1 } from '../../../lib/deployments/execution/express-private-control-v1.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)), BASE = 'F:/ChatGPT_workshop';
export const W3_RISK_FILE = 'docs/aws-auto-deployment-aurora-dual-mode-w3-execution-review.md';
const DEPLOYMENT = 'dep_7c99bd249470184852f0dc74', OLD_JOB = 'job_202c8dc12a8bf379f3a7c693';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, data) => { const f = await open(file, 'wx', 0o600); try { await f.writeFile(JSON.stringify(data, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
function assertEnvironment() {
  must(!['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CA_BUNDLE',
    'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
    'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGOPTIONS'].some(k => process.env[k] || process.env[k.toLowerCase()]) &&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT_OVERRIDE');
}
export async function initializedCodeBindingV3(history) {
  const seen = new Set(), pins = [];
  async function pin(file) {
    const absolute = path.resolve(ROOT, file); must(absolute.toLowerCase().startsWith(path.resolve(ROOT).toLowerCase() + path.sep), 'CODE_OUTSIDE_ROOT');
    if (seen.has(absolute.toLowerCase())) return; seen.add(absolute.toLowerCase());
    const bytes = await readFile(absolute), text = bytes.toString('utf8'); pins.push({ file: path.relative(ROOT, absolute).replaceAll('\\', '/'), rawFileSha256: await sha256Hex(text) });
    if (!/\.(ts|mjs|cjs|js)$/.test(absolute)) return;
    for (const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const p = path.resolve(path.dirname(absolute), m[1]); let found;
      for (const candidate of [p, p + '.js', p + '.ts', p + '.cjs', path.join(p, 'index.js')]) {
        try { await access(candidate); found = candidate; break; } catch { /* next explicit extension */ }
      }
      must(found, 'CODE_IMPORT_UNRESOLVED'); await pin(found);
    }
  }
  await pin('ops/aws-sandbox/scripts/run-express-initialized-worker-v3.mjs');
  await pin('package-lock.json'); await pin(W3_RISK_FILE);
  pins.sort((a, b) => a.file.localeCompare(b.file));
  return { nodeVersion: process.version, pins, publicHistory: history };
}
async function publicContext() {
  const inputs = await loadExpressLiveInputsV1(), prior = await hostingInputs();
  const root = await prepareExpressInitializedWorkerV2({ delivery: { ...inputs.delivery,
    scope: { ...inputs.delivery.scope, ownerDeploymentId: DEPLOYMENT } }, existingDefaultStoreId: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87' });
  const historicalMetadataPath = BASE + '/techlong-express-k3r-review-20261016-r2/metadata.json';
  const metadataBytes = await readFile(historicalMetadataPath), oldMetadata = JSON.parse(metadataBytes);
  must(oldMetadata.baseline.expectedTaskSha256 === prior.readyTaskSha256, 'KNOWN_TASK_SPEC_PROVENANCE');
  const base = { compute: inputs.compute, iam: { cfnRole: inputs.cfnInventory.role,
    roles: inputs.iamBefore.roles.filter(r => ['TechlongSandboxTaskRole', 'TechlongSandboxTaskExecutionRole'].includes(r.name)),
    policies: [inputs.cfnInventory.policy, inputs.iamBefore.boundary] },
    predecessorStackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/ab4aa8c0-c966-11f1-b068-0ecbbd896a2b',
    predecessorTaskDefinitionArn: 'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:3',
    expectedTaskSha256: prior.readyTaskSha256, janitorCodeSha256: 'LTQwSFbnrnl9fjdg2N7GCxLCKiKHeDBBjNWsQ4EdWdA=',
    epochItem: inputs.previousPlan.proposedEpochTransaction.TransactItems[1].Put.Item,
    hostedZoneId: inputs.previousPlan.proposedDnsCreate.HostedZoneId,
    dnsRecord: inputs.previousPlan.proposedDnsCreate.ChangeBatch.Changes[0].ResourceRecordSet };
  const history = [...inputs.history, { path: historicalMetadataPath, rawFileSha256: await sha256Hex(metadataBytes.toString('utf8')) }];
  // publicContext only consumes public history, never private-material.json.
  return { inputs, root, base, binding: await initializedCodeBindingV3(history) };
}
function directory(value) {
  const p = path.resolve(value || ''); must(path.dirname(p).toLowerCase() === path.resolve(BASE).toLowerCase() &&
    /^techlong-worker-w3-[a-z0-9-]+$/.test(path.basename(p)), 'OUTPUT_OR_MANIFEST_DIRECTORY'); return p;
}
async function consumeFactory(requestId, manifestSha256, runDirectory) {
  must(/^[a-f0-9]{64}$/.test(requestId) && /^[a-f0-9]{64}$/.test(manifestSha256), 'JOURNAL_ID');
  const folder = path.join(BASE, 'techlong-worker-w3-permanent-slots-v1', requestId); await mkdir(folder, { recursive: true });
  return async (entry, requestSha256) => {
    must(['run', 'claim_job', 'create_workload', 'private_control_load', 'atomic_complete'].includes(entry) && /^[a-f0-9]{64}$/.test(requestSha256), 'JOURNAL_ENTRY');
    await save(path.join(folder, entry + '.json'), { schema: 'techlong/initialized-worker-entry/v3',
      manifestSha256, requestSha256, runDirectory, consumedAt: Date.now(), state: 'CONSUMED_BEFORE_ATTEMPT', retryAllowed: false });
  };
}
export async function main(args = process.argv.slice(2)) {
  must(args.length % 2 === 0, 'ARGUMENTS'); const pairs = [];
  for (let n = 0; n < args.length; n += 2) pairs.push([args[n], args[n + 1]]);
  const a = Object.fromEntries(pairs), mode = a['--mode'];
  const keys = mode === 'CheckRuntime' ? ['--mode'] : mode === 'Review' ? ['--mode', '--output'] :
    mode === 'RunOnce' ? ['--mode', '--output', '--manifest', '--approved-sha'] : ['--mode', '--output', '--manifest', '--run'];
  must(['CheckRuntime', 'Review', 'RunOnce', 'Inspect'].includes(mode) && Object.keys(a).length === pairs.length &&
    keys.length === pairs.length && keys.every(k => a[k]) && process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase(), 'ARGUMENTS');
  assertEnvironment();
  if (mode === 'CheckRuntime') { const result = { mode, state: 'REVIEWED_SINGLE_JOB_ROOT_CODE_READY_NOT_RUNNING',
    globalWorkerEnabled: false, cloudWrites: 0, databaseQueries: 0, privateReads: 0, newIamRequiredByCode: false };
    console.log(JSON.stringify(result, null, 2)); return result; }
  const out = directory(a['--output']); await mkdir(out);
  const put = (name, data) => save(path.join(out, name), data);
  let api, privateSources, stage = 'public_inputs', entered = false;
  const signal = AbortSignal.timeout(mode === 'RunOnce' ? 23 * 60000 : 180000);
  try {
    const c = await publicContext(); const databaseUrl = parseEnv(await readFile(ROOT + '/.env.local', 'utf8')).DATABASE_URL;
    const url = new URL(databaseUrl), endpointSha256 = await sha256Hex([url.hostname, url.port || '5432', url.pathname, url.username]);
    const repository = createExpressInitializedJobNeonV2(databaseUrl); api = createInitializedAwsV3(c.base);
    let manifest;
    if (mode === 'Review') {
      stage = 'readonly_review'; const current = await repository.readSnapshot({ deploymentId: DEPLOYMENT, predecessorJobId: OLD_JOB }, signal);
      const cell = await api.readCell(signal), now = Date.now();
      const jobPlan = await prepareExpressInitializedJobV2({ material: c.root.material, materialSha256: c.root.materialSha256,
        snapshot: current.snapshot, externalFence: externalFenceFromSnapshotV3(current.snapshot),
        requestId: await sha256Hex({ purpose: 'initialized-worker-v3', nonce: randomUUID(), now }), now, deadline: now + 3600000 });
      const workload = await prepareInitializedWorkloadV3({ root: c.root, jobPlan, cell, publicParameters: c.inputs.privateReceipt.publicParameters });
      const before = await api.inspectBefore(workload, jobPlan, signal); await put('provider-review.json', before);
      const body = { schema: 'techlong/initialized-worker-review/v3', jobPlan, workload, binding: c.binding, endpointSha256,
        preflightSha256: await sha256Hex(before), riskFile: W3_RISK_FILE, privateSource: { directory: LIVE_PRIVATE,
          summarySha256: c.inputs.privatePlan.historicalSummarySha256, containsUnexposedPaymentKeys: true,
          runtimeSecretValueApiAuthorized: false, applicationGets: 2, initializationPosts: 0 },
        effects: { newJobs: 1, sourceCreateStackCalls: 1, childResources: 7, atomicCompletionRows: 2,
          iamWrites: 0, secretWrites: 0, authorityWrites: 0, dnsWrites: 0, auroraConnections: 0, automaticRetries: 0 },
        preparationIsNotExecutionApproval: true };
      manifest = freeze({ ...body, manifestSha256: await sha256Hex(body) });
      await put('manifest.json', manifest);
      const result = { mode, outcome: 'READY_FOR_SPECIFIC_APPROVAL_NO_WRITES', manifestSha256: manifest.manifestSha256,
        claimBy: new Date(jobPlan.claimBy).toISOString(), workloadExpiresAt: new Date(workload.workloadExpiresAt).toISOString(),
        jobId: jobPlan.jobId, requestSha256: workload.requestSha256, counts: api.counts(), cloudWrites: 0, jobWrites: 0,
        privateReads: 0, applicationRequests: 0, manifest: path.join(out, 'manifest.json') };
      await put('result.json', result); console.log(JSON.stringify(result, null, 2)); return result;
    }
    const manifestFile = path.resolve(a['--manifest']); directory(path.dirname(manifestFile)); must(path.basename(manifestFile) === 'manifest.json', 'MANIFEST_FILENAME');
    manifest = await json(manifestFile); const { manifestSha256, ...body } = manifest;
    must(manifest.schema === 'techlong/initialized-worker-review/v3' && /^[a-f0-9]{64}$/.test(manifestSha256) && await sha256Hex(body) === manifestSha256 &&
      same(manifest.binding, c.binding) && manifest.endpointSha256 === endpointSha256 && same(manifest.jobPlan.material, c.root.material), 'MANIFEST_CODE_SOURCE_DRIFT');
    await compileExpressInitializedClaimV2({ plan: manifest.jobPlan, approvedPlanSha256: manifest.jobPlan.planSha256, leaseToken: 'lease_' + '0'.repeat(32) });
    const rebuilt = await prepareInitializedWorkloadV3({ root: c.root, jobPlan: manifest.jobPlan, publicParameters: c.inputs.privateReceipt.publicParameters,
      cell: { stackId: c.base.compute.stackId, outputs: manifest.workload.cellOutputs, parentTagExpiresAt: manifest.workload.parentTagExpiresAt, activeCellCount: 1, activeTenantCount: 0 } });
    must(same(rebuilt, manifest.workload), 'WORKLOAD_REQUEST_DERIVATION'); manifest = freeze(manifest);
    if (mode === 'Inspect') {
      stage = 'independent_inspect'; const run = directory(a['--run']), runRef = await json(path.join(run, 'run-reference.json'));
      must(runRef.manifestSha256 === manifestSha256, 'RUN_REFERENCE');
      const observed = await repository.readSnapshot({ deploymentId: DEPLOYMENT, predecessorJobId: OLD_JOB, newJobId: manifest.jobPlan.jobId }, signal);
      let completion = 'NOT_PROVED', provider = 'NOT_PROVED';
      try {
        const reference = await json(path.join(run, 'completion-reference.json'));
        const slot = await json(path.join(BASE, 'techlong-worker-w3-permanent-slots-v1', manifest.jobPlan.requestId, 'atomic_complete.json'));
        must(slot.manifestSha256 === manifestSha256 && slot.requestSha256 === await sha256Hex(reference) && slot.runDirectory === run, 'COMPLETION_SLOT_REFERENCE');
        verifyExpressInitializedCompletionReadbackV2({ plan: manifest.jobPlan, snapshot: observed.snapshot, job: observed.job, expectedOutputs: reference.outputs });
        completion = 'NEW_JOB_SUCCEEDED_OLD_ROWS_PRESERVED';
      } catch { /* no inference from an absent/unknown write acknowledgement */ }
      try { const ack = await json(path.join(run, 'create-ack.json')); await api.inspectAfter(manifest.workload, manifest.jobPlan, ack.stackId, signal); provider = 'EXACT_WORKLOAD_PROVED'; }
      catch { /* expired/deleted/unhealthy/unknown is not current ready */ }
      const result = { mode, manifestSha256, completion, provider, jobStatus: observed.job?.status ?? 'ABSENT',
        checkedAt: Date.now(), counts: api.counts(), cloudWrites: 0, databaseWrites: 0, privateReads: 0, retryAllowed: false };
      await put('result.json', result); console.log(JSON.stringify(result, null, 2)); return result;
    }
    must(a['--approved-sha'] === manifestSha256, 'SPECIFIC_MANIFEST_APPROVAL_REQUIRED'); assertRunWindowV3(manifest, Date.now());
    stage = 'run_readonly_preflight';
    const current = await repository.readSnapshot({ deploymentId: DEPLOYMENT, predecessorJobId: OLD_JOB, newJobId: manifest.jobPlan.jobId }, signal);
    must(current.job === null && same(current.snapshot, manifest.jobPlan.snapshot), 'BEFORE_CLAIM_ROWS_OR_JOB_DRIFT');
    const preflight = await api.inspectBefore(manifest.workload, manifest.jobPlan, signal); await put('run-preflight.json', preflight);
    must(same(await initializedCodeBindingV3(c.binding.publicHistory), manifest.binding), 'POST_PREFLIGHT_CODE_DRIFT'); assertRunWindowV3(manifest, Date.now());
    const consume = await consumeFactory(manifest.jobPlan.requestId, manifestSha256, out);
    await consume('run', manifestSha256); entered = true; assertRunWindowV3(manifest, Date.now());
    await put('run-reference.json', { manifestSha256, jobPlanSha256: manifest.jobPlan.planSha256, requestSha256: manifest.workload.requestSha256 });
    const persisted = { ...repository,
      async claim(request, s) { const compiled = await compileExpressInitializedClaimV2(request);
        await consume('claim_job', compiled.programSha256); return repository.claim(request, s); },
      async complete(request, s) { const compiled = await compileExpressInitializedCompleteV2(request);
        const reference = { programSha256: compiled.programSha256, outputs: compiled.outputs, receiptSha256: compiled.receiptSha256 };
        await put('completion-reference.json', reference);
        await consume('atomic_complete', await sha256Hex(reference)); return repository.complete(request, s); },
    };
    let controlOpened = false; const used = new Set();
    const readback = { initializationPostAllowed: false, executionAuthorized: false, async readConfiguration(request) {
      must(!controlOpened, 'PRIVATE_LOAD_REENTRY'); controlOpened = true; request.signal.throwIfAborted();
      await consume('private_control_load', manifest.workload.publicParametersSha256);
      privateSources = await loadExpressPrivateControlSourcesV1({ directory: LIVE_PRIVATE, plan: c.inputs.privatePlan });
      must(await sha256Hex(privateSources.publicParameters) === manifest.workload.publicParametersSha256, 'PRIVATE_PUBLIC_PARAMETERS_DRIFT');
      const guarded = { async send(r, options) { const url = new URL(r.url), key = r.method + ' ' + url.pathname;
        must(r.method === 'GET' && ['GET /api/saas/readiness', 'GET /api/saas/control'].includes(key) && !used.has(key), 'CONTROL_REQUEST_BUDGET');
        used.add(key); return privateSources.controlTransport.send(r, options); } };
      return c.root.composeInitializedReadback({ transport: guarded, tokens: privateSources.controlTokens }).readConfiguration(request);
    } };
    const runner = createExpressInitializedSingleJobRunnerV2({ plan: manifest.jobPlan, repository: persisted,
      workload: api.bindOnce(manifest.workload, manifest.jobPlan, consume, put), readback });
    stage = 'single_job_run'; const outcome = await runner.runOnce({ approvedPlanSha256: manifest.jobPlan.planSha256, signal });
    const result = { mode, manifestSha256, ...outcome, counts: api.counts(), privatePackageLoads: controlOpened ? 1 : 0, applicationGets: used.size,
      sourceSecretValueReads: 0, globalWorkerEnabled: false, retryAllowed: false };
    await put('result.json', result); console.log(JSON.stringify(result, null, 2));
    if (result.outcome === 'INSPECT_REQUIRED_NO_RETRY') process.exitCode = 1;
    return result;
  } catch (e) {
    const code = /^(INITIALIZED_W3|IMAGE_REPAIR)_[A-Z0-9_]+$/.test(e.message || '') ? e.message :
      ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name) ? 'SOURCE_REFRESH_REQUIRED' : 'SANITIZED_REQUIRES_INSPECT';
    const result = { mode, outcome: 'STOPPED_NO_AUTOMATIC_RETRY', stage, code, rootEntered: entered,
      counts: api?.counts(), retryAllowed: false, globalWorkerEnabled: false };
    await put('result.json', result); console.log(JSON.stringify(result, null, 2)); process.exitCode = 1; return result;
  } finally { privateSources?.dispose(); api?.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error(JSON.stringify({ outcome: 'UNHANDLED_FAILURE_REQUIRES_INSPECT_NO_RETRY', retryAllowed: false })); process.exitCode = 1; });
}
