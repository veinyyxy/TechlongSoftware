// One exact held job. No queue poller, installer, recovery write or init POST.
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../../lib/deployments/initialized-platform-request-v1.ts';
import { createExpressInitializedSingleJobRunnerV2 } from '../../lib/deployments/execution/express-initialized-job-runner-v2.ts';
import { compilePlatformInitializedClaimV4, compilePlatformInitializedCompleteV4 } from '../../lib/deployments/execution/express-platform-claim-v4.ts';
import { admitPlatformJobV4, assertCurrentPlatformRowsV4, assertClaimMatchesReviewV4, W4_ZERO_LEASE_TOKEN } from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import { prepareInitializedWorkloadV3, assertRunWindowV3 } from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
import { EVIDENCE_V5, assertEvidenceSafeV5 } from './cloud-evidence-v5.mjs';
import { renderNeonContractV5 } from './neon-contract-v5.mjs';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export const CLOUD_EFFECTS_V5 = Object.freeze({ durableJournalWrites: 5, sameHeldJobClaimTransactions: 1, createStackCalls: 1,
  workloadResources: 7, privateControlSecretReads: 1, authenticatedGets: 2, atomicCompletionTransactions: 1,
  fixedDatabaseSecretReadsPerMode: 1, immutableEvidenceWrites: true, iamWrites: 0, newJobs: 0, initializationPosts: 0,
  automaticRetries: 0, automaticCleanupGuaranteed: false, maximumMonthlyCostGuaranteed: false });
export async function assertInstallationV5(i, approvedSha, contract) {
  const { installationSha256, ...body } = i;
  must(hash(approvedSha) && installationSha256 === approvedSha && await sha256Hex(body) === approvedSha &&
    i.schema === 'techlong/cloud-worker-installed-binding/v5' && i.installed === true &&
    /^AROA[A-Z0-9]{17}$/.test(i.roleId) && /^[a-f0-9-]{36}$/.test(i.tableId) &&
    i.neon?.contractSha256 === contract.contractSha256 && i.neon.sqlSha256 === await sha256Hex(renderNeonContractV5(contract).statements) && hash(i.neon.endpointSha256) &&
    /^\d+$/.test(i.neon.roleOid) && /^\d+$/.test(i.neon.ownerOid) && i.neon.ownerOid !== i.neon.roleOid &&
    ['read_state','claim','lease','complete'].every(k => /^\d+$/.test(i.neon.functionOids?.[k])) && i.evidenceBucket === EVIDENCE_V5.bucket,
  'INSTALLATION_BINDING_REQUIRED');
  for (const [key, name] of [['databaseSecret','neon-control-v1'],['controlSecret','control-first-acceptance-v1']]) {
    must(new RegExp('^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/' + name + '-[A-Za-z0-9]{6}$').test(i[key]?.arn) &&
      /^[A-Za-z0-9-]{32,64}$/.test(i[key].versionId), 'FIXED_INSTALLED_SECRET_REFERENCE');
  }
  return freeze(structuredClone(i));
}
export async function assertCloudManifestV5(m, { code, installation, context, contract }) {
  const { manifestSha256, ...body } = m;
  must(hash(manifestSha256) && await sha256Hex(body) === manifestSha256 && m.schema === 'techlong/cloud-worker-review/v5' &&
    Object.keys(body).sort().join(',') === 'code,effects,installationSha256,jobPlan,predecessor,preflightSha256,preparationIsNotExecutionApproval,programs,publicCapsuleSha256,queue,riskFile,schema,workload' &&
    same(m.effects, CLOUD_EFFECTS_V5) && m.preparationIsNotExecutionApproval === true &&
    m.riskFile === 'docs/aws-auto-deployment-cloud-worker-w5c.md' && same(m.code, code) && hash(code.closureSha256) && /^[a-f0-9]{40}$/.test(code.commitSha) &&
    m.installationSha256 === installation.installationSha256 && m.publicCapsuleSha256 === context.capsuleSha256 &&
    same(m.predecessor, context.predecessor) && hash(m.preflightSha256) && contract.contractSha256 === installation.neon.contractSha256,
  'CLOUD_MANIFEST_BINDING');
  // Re-admit at the ORIGINAL preparation instant, never restamp an old plan.
  const admission = await admitPlatformJobV4({ root: context.root, predecessor: context.predecessor, now: m.jobPlan.preparedAt,
    observed: { snapshot: m.jobPlan.snapshot, job: m.queue.row, requester: m.queue.requester,
      jobs: [m.jobPlan.snapshot.predecessorJob, m.queue.proofJob, m.queue.row], checkedAt: m.queue.observedAt } });
  must(same(admission, { jobPlan: m.jobPlan, queue: m.queue, programs: m.programs }), 'CLOUD_PLAN_RECONSTRUCTION');
  const w = m.workload, rebuilt = await prepareInitializedWorkloadV3({ root: context.root, jobPlan: m.jobPlan,
    publicParameters: context.publicParameters, cell: { stackId: w.parentStackId, outputs: w.cellOutputs,
      parentTagExpiresAt: w.parentTagExpiresAt, activeCellCount: 1, activeTenantCount: 0 } });
  must(same(rebuilt, w), 'CLOUD_RENDER_RECONSTRUCTION'); assertEvidenceSafeV5(m);
}
export function cloudJournalBindingV5(m, run) {
  must(run.commitSha === m.code.commitSha, 'RUN_COMMIT_MISMATCH');
  return { jobId: m.jobPlan.jobId, requestId: m.jobPlan.requestId, manifestSha256: m.manifestSha256,
    codeSha256: m.code.closureSha256, predecessorReceiptSha256: m.predecessor.receiptSha256,
    notBefore: m.jobPlan.preparedAt, expiresAt: m.jobPlan.deadline, run,
    actions: { run: m.manifestSha256, claim_job: m.programs.claimTemplateSha256, create_workload: m.workload.requestSha256,
      private_control_load: m.installationSha256, atomic_complete: m.programs.completionContractSha256 } };
}
export function providerPublicV5(p) {
  return { stackId: p.stackId, physical: p.physical, taskArn: p.taskArn, imageUri: p.imageUri, checkedAt: p.providerCheckedAt ?? p.checkedAt };
}
// W4c is a trust anchor, not a hard-coded forever-latest deployment. Each next
// link must include its pinned manifest, success receipt AND independent Inspect.
export async function continueCloudContextV5(anchor, links) {
  let context = anchor; const seen = new Set([anchor.predecessor.jobId]);
  must(Array.isArray(links) && links.length <= 64, 'LINEAGE_LENGTH');
  for (const l of links) {
    const { manifest: m, receipt: r, providerObservation: p, inspect: i } = l, { manifestSha256, ...body } = m;
    const { inspectSha256, ...ib } = i;
    must(!seen.has(r.jobId) && await sha256Hex(body) === manifestSha256 && same(m.predecessor, context.predecessor) &&
      m.schema === 'techlong/cloud-worker-review/v5' && same(m.effects, CLOUD_EFFECTS_V5) &&
      r.jobId === m.jobPlan.jobId && r.jobPlanSha256 === m.jobPlan.planSha256 && r.materialSha256 === S.materialSha256 &&
      r.imageUri === S.artifactRef && r.configurationHash === S.configurationHash && r.existingDefaultStoreId === S.existingDefaultStoreId &&
      r.epoch === S.epoch && r.operationHash === S.operationHash && r.initializedVerified === true && r.effectiveConfigurationVerified === true &&
      r.stackId === p.stackId && r.providerCheckedAt === p.checkedAt && await sha256Hex(p) === r.providerObservationSha256 &&
      Object.keys(p.physical).length === 7 && /^arn:aws:ecs:ca-central-1:402010193138:task-definition\/tenant-9c5ee9e64509dcad-task-definition:[1-9][0-9]*$/.test(p.physical.TenantTaskDefinition) &&
      await sha256Hex(ib) === inspectSha256 && i.schema === 'techlong/cloud-worker-independent-inspect/v5' &&
      i.outcome === 'SUCCEEDED_INDEPENDENTLY_VERIFIED' && i.jobId === r.jobId && i.manifestSha256 === manifestSha256 &&
      i.receiptSha256 === await sha256Hex(r) && i.providerObservationSha256 === r.providerObservationSha256 &&
      i.run.runId !== i.executionRun.runId && i.run.commitSha === m.code.commitSha && i.executionRun.commitSha === m.code.commitSha,
    'SUCCESSOR_LINEAGE_NOT_PROVED');
    assertEvidenceSafeV5(l); seen.add(r.jobId);
    const predecessor = { jobId: r.jobId, stackId: r.stackId, taskDefinitionArn: p.physical.TenantTaskDefinition, receiptSha256: await sha256Hex(r) };
    context = Object.freeze({ ...context, predecessor: freeze(predecessor), base: freeze({ ...context.base,
      predecessorStackId: predecessor.stackId, predecessorTaskDefinitionArn: predecessor.taskDefinitionArn }) });
  }
  return context;
}

/** Production composition supplies the SDK provider, fixed Secret loaders,
 * narrow RPC adapter, conditional S3 writer and DynamoDB journal factory.
 * All are lazy; constructing this root performs zero network/private reads. */
export function createCloudWorkerRootV5({ context, installation, contract, code, run, openDatabase, provider,
  openJournal, loadControl, evidence, now = Date.now }) {
  let entered = false;
  const take = () => { must(!entered, 'ROOT_MODE_ONCE'); entered = true; };
  const ref = m => ({ jobId: m.jobPlan.jobId, manifestSha256: m.manifestSha256, run });
  const validate = async m => assertCloudManifestV5(m, { code, installation, context, contract });
  return Object.freeze({ runtimeEnabled: false,
    async review({ jobId, signal }) {
      take(); const db = await openDatabase(signal); await db.verify(signal); await evidence.verify(signal);
      const cell = await provider.readCell(signal), observed = await db.read(jobId, signal);
      const admission = await admitPlatformJobV4({ root: context.root, observed, predecessor: context.predecessor, now: now() });
      const workload = await prepareInitializedWorkloadV3({ root: context.root, jobPlan: admission.jobPlan, cell, publicParameters: context.publicParameters });
      const preflight = await provider.inspectBefore(workload, admission.jobPlan, signal);
      must(preflight.namespacesAbsent === true && preflight.retiredPredecessor === context.predecessor.stackId && preflight.cloudWrites === 0, 'REVIEW_PREFLIGHT');
      const body = { schema: 'techlong/cloud-worker-review/v5', ...admission, workload, predecessor: context.predecessor, code,
        installationSha256: installation.installationSha256, publicCapsuleSha256: context.capsuleSha256,
        preflightSha256: await sha256Hex(preflight), effects: CLOUD_EFFECTS_V5, riskFile: 'docs/aws-auto-deployment-cloud-worker-w5c.md', preparationIsNotExecutionApproval: true };
      const m = freeze({ ...body, manifestSha256: await sha256Hex(body) });
      assertRunWindowV3(m, now()); assertCurrentPlatformRowsV4(m, await db.read(jobId, signal), now()); await validate(m);
      const saved = await evidence.put('manifest.json', ref(m), m, signal);
      return { manifest: m, saved, approved: false, cloudDeploymentCalls: 0 };
    },
    async runOnce({ manifest: m, approvedManifestSha256, signal }) {
      take(); must(hash(approvedManifestSha256) && m.manifestSha256 === approvedManifestSha256, 'FRESH_EXPLICIT_APPROVAL_REQUIRED');
      await validate(m); assertRunWindowV3(m, now()); // before DB Secret/private reads
      const db = await openDatabase(signal); await db.verify(signal); await evidence.verify(signal);
      assertCurrentPlatformRowsV4(m, await db.read(m.jobPlan.jobId, signal), now());
      const journal = await openJournal(cloudJournalBindingV5(m, run), signal), repository = db.bind(m.queue.row);
      const savedEvidence = {};
      const save = async (kind, value) => { const saved = await evidence.put(kind, ref(m), value, signal); savedEvidence[kind] = saved; return saved; };
      let control, result;
      try {
        await journal.consume('run', m.manifestSha256);
        const guarded = { ...repository,
          async claim(request, s) {
            const p = await assertClaimMatchesReviewV4(m, request); assertRunWindowV3(m, now());
            assertCurrentPlatformRowsV4(m, await db.read(m.jobPlan.jobId, s), now());
            await journal.consume('claim_job', p.programSha256); return repository.claim(request, s);
          },
          async complete(request, s) {
            const p = await compilePlatformInitializedCompleteV4({ ...request, queuedJob: m.queue.row });
            await journal.consume('atomic_complete', p.programSha256); return repository.complete(request, s);
          },
        };
        // W2 asks for readback only AFTER provider/lease success. Load control
        // materials at that instant, never before CreateStack's result.
        const readback = { async readConfiguration(request) {
          control = await loadControl({ beforeRead: () => journal.consume('private_control_load', installation.installationSha256), signal: request.signal });
          return context.root.composeInitializedReadback({ transport: control.controlTransport, tokens: control.controlTokens }).readConfiguration(request);
        } };
        result = await createExpressInitializedSingleJobRunnerV2({ plan: m.jobPlan, repository: guarded,
          workload: provider.bindOnce(m.workload, m.jobPlan, (entry, sha) => journal.consume(entry, sha), save), readback, now })
          .runOnce({ approvedPlanSha256: m.jobPlan.planSha256, signal });
        const report = { schema: 'techlong/cloud-worker-run/v5', manifestSha256: m.manifestSha256, jobId: m.jobPlan.jobId,
          run, result, providerCounts: provider.counts(), databaseCounts: db.counts(), controlCounts: control?.counts() ?? null,
          journal: await journal.inspect(), savedEvidence: structuredClone(savedEvidence), retryAllowed: false, independentInspectRequired: true };
        const saved = await save('run.json', report); return { report, saved };
      } finally { control?.dispose(); journal.dispose?.(); }
    },
    async inspect({ manifest: m, executionRun, executionReportReference, signal }) {
      take(); await validate(m); must(run.runId !== executionRun.runId, 'INDEPENDENT_INSPECT_RUN_REQUIRED');
      const db = await openDatabase(signal); await db.verify(signal); await evidence.verify(signal);
      const journal = await openJournal(cloudJournalBindingV5(m, executionRun), signal);
      try {
        const slots = await journal.inspect(), observed = await db.read(m.jobPlan.jobId, signal), d = observed.snapshot.deployment;
        let outcome = 'UNKNOWN_OR_INCOMPLETE_NO_RETRY', receiptSha256 = null, providerObservationSha256 = null;
        const outputs = JSON.parse(d.outputs), receipt = outputs.expressInitializedWorkerRunsV2?.[m.jobPlan.jobId];
        if (slots.state === 'ALL_SLOTS_CONSUMED' && observed.job?.status === 'succeeded' && receipt) {
          const zero = await compilePlatformInitializedClaimV4({ plan: m.jobPlan, queuedJob: m.queue.row,
            approvedPlanSha256: m.jobPlan.planSha256, leaseToken: W4_ZERO_LEASE_TOKEN });
          must(observed.job.payload === zero.statements.at(-1).values[2] && observed.job.lease_owner === null &&
            observed.job.lease_token === null && observed.job.lease_expires_at === null && observed.job.attempts === 1 &&
            receipt.jobId === m.jobPlan.jobId && receipt.jobPlanSha256 === m.jobPlan.planSha256 && receipt.materialSha256 === S.materialSha256 &&
            receipt.initializedVerified === true && receipt.effectiveConfigurationVerified === true, 'INSPECT_JOB_OR_RECEIPT');
          const { jobPlanSha256, completedBy, ...publicProof } = receipt;
          must(jobPlanSha256 === m.jobPlan.planSha256 && completedBy === 'express-initialized-single-job-v2' &&
            Number.isSafeInteger(observed.job.completed_at), 'INSPECT_COMPLETED_ATTRIBUTION');
          const completion = await compilePlatformInitializedCompleteV4({ plan: m.jobPlan, queuedJob: m.queue.row, lease: zero.lease,
            proof: { ...publicProof, leaseToken: zero.lease.leaseToken },
            now: Math.max(receipt.providerCheckedAt, receipt.authorityCheckedAt, receipt.controlCheckedAt) });
          must(completion.outputs === d.outputs, 'INSPECT_FULL_COMPLETION_CONTRACT');
          for (const k of Object.keys(m.jobPlan.snapshot)) if (k !== 'deployment') must(same(observed.snapshot[k], m.jobPlan.snapshot[k]), 'INSPECT_RETAINED_ROW');
          const { outputs: _a, updated_at: _b, ...old } = m.jobPlan.snapshot.deployment;
          const { outputs: _c, updated_at: _d, ...current } = d; void _a; void _b; void _c; void _d;
          must(same(old, current), 'INSPECT_ORIGINAL_READY');
          const before = JSON.parse(m.jobPlan.snapshot.deployment.outputs), rest = structuredClone(outputs); delete rest.expressInitializedWorkerRunsV2[m.jobPlan.jobId];
          must(same(rest, before), 'INSPECT_RECEIPT_APPEND_ONLY');
          const originalRef = { ...ref(m), run: executionRun };
          const execution = await evidence.get('run.json', originalRef, executionReportReference, signal);
          must(execution.manifestSha256 === m.manifestSha256 && same(execution.run, executionRun) &&
            execution.result?.outcome === 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED', 'INSPECT_EXECUTION_REPORT');
          const historical = await evidence.get('provider-after.json', originalRef, execution.savedEvidence['provider-after.json'], signal);
          const originalProvider = providerPublicV5(historical);
          must(await sha256Hex(originalProvider) === receipt.providerObservationSha256 && originalProvider.checkedAt === receipt.providerCheckedAt,
            'INSPECT_HISTORICAL_PROVIDER_EVIDENCE');
          const fresh = providerPublicV5(await providerAfter(m, receipt.stackId, signal));
          must(same({ ...fresh, checkedAt: 0 }, { ...originalProvider, checkedAt: 0 }), 'INSPECT_FRESH_RUNTIME_DRIFT');
          const finalRows = await db.read(m.jobPlan.jobId, signal);
          must(same(finalRows.snapshot, observed.snapshot) && same(finalRows.job, observed.job), 'INSPECT_CONCURRENT_DATABASE_DRIFT');
          receiptSha256 = await sha256Hex(receipt); providerObservationSha256 = receipt.providerObservationSha256;
          outcome = 'SUCCEEDED_INDEPENDENTLY_VERIFIED';
        }
        const body = { schema: 'techlong/cloud-worker-independent-inspect/v5', outcome, jobId: m.jobPlan.jobId,
          manifestSha256: m.manifestSha256, receiptSha256, providerObservationSha256, run, executionRun,
          journal: slots, checkedAt: now(), retryAllowed: false, cloudWrites: 0, databaseWrites: 0, privateControlReads: 0 };
        const report = { ...body, inspectSha256: await sha256Hex(body) }, saved = await evidence.put('inspect.json', ref(m), report, signal);
        return { report, saved };
      } finally { journal.dispose?.(); }
    },
  });
  async function providerAfter(m, stackId, signal) { return provider.inspectAfter(m.workload, m.jobPlan, stackId, signal); }
}
