// W4a read-only integration check. No DML is executed: every generated write
// statement is sent only to EXPLAIN (never ANALYZE), in a READ ONLY transaction.
// Synthetic future clock/admin/queued row/proof are syntax inputs, NOT a review,
// live admission, authenticated readback, durable job or execution approval.
import path from 'node:path';
import { readFile, open } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { loadExpressLiveInputsV1 } from './express-live-local-inputs-v1.mjs';
import { externalFenceFromSnapshotV3 } from './express-initialized-workload-v3.mjs';
import { prepareExpressInitializedWorkerV2 } from '../../../lib/deployments/execution/express-initialized-worker-v2.ts';
import { createExpressInitializedJobNeonV2 } from '../../../lib/deployments/execution/express-initialized-job-neon-v2.ts';
import { prepareExpressInitializedJobV2 } from '../../../lib/deployments/execution/express-initialized-job-v2.ts';
import { INITIALIZED_PLATFORM_SCOPE as s, INITIALIZED_REVIEW_HOLD_AT, projectInitializedDeployment,
  prepareInitializedPlatformRequest } from '../../../lib/deployments/initialized-platform-request-v1.ts';
import { compilePlatformInitializedClaimV4, compilePlatformInitializedLeaseCheckV4,
  compilePlatformInitializedCompleteV4 } from '../../../lib/deployments/execution/express-platform-claim-v4.ts';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.argv[2];
let stage = 'arguments';
const must = (v, label) => { if (!v) throw Object.assign(Error('CHECK_REJECTED'), { checkCode: label }); };
async function check() {
  must(process.argv.length === 3 && process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase() &&
    path.dirname(path.resolve(output)).toLowerCase() === path.resolve('F:/ChatGPT_workshop').toLowerCase() &&
    /^techlong-platform-w4a-readonly-[a-z0-9-]+\.json$/.test(path.basename(output)), 'ARGUMENTS');
  const configured = parseEnv(await readFile(path.join(ROOT, '.env.local'), 'utf8'));
  must(configured.AWS_INITIALIZED_REQUESTS_ENABLED !== 'true' && process.env.AWS_INITIALIZED_REQUESTS_ENABLED !== 'true', 'LOCAL_GATE_MUST_REMAIN_OFF');
  const repository = createExpressInitializedJobNeonV2(configured.DATABASE_URL), sql = neon(configured.DATABASE_URL, { fullResults: true });
  const signal = AbortSignal.timeout(90000), options = { isolationLevel: 'RepeatableRead', readOnly: true, fetchOptions: { signal } };
  stage = 'read_existing_rows';
  const before = await repository.readSnapshot({ deploymentId: s.deploymentId, predecessorJobId: 'job_202c8dc12a8bf379f3a7c693',
    newJobId: 'job_e4147af2f10faf37b51ec9a3' }, signal);
  const [jobsResult] = await sql.transaction(tx => [tx.query(`SELECT id,deployment_id,status,payload,created_at,completed_at
    FROM public.deployment_jobs WHERE deployment_id=$1 ORDER BY created_at DESC,id DESC`, [s.deploymentId])], options);
  const d = before.snapshot.deployment;
  const deployment = { id: d.id, appInstanceId: d.app_instance_id, environmentId: d.environment_id, mode: d.mode,
    status: d.status, planHash: d.plan_hash, configurationHash: d.configuration_hash, artifactRef: d.artifact_ref, outputs: JSON.parse(d.outputs) };
  const projection = projectInitializedDeployment({ deployment, jobs: jobsResult.rows, gateEnabled: false, now: Date.now() });
  stage = 'real_saved_receipt_projection';
  must(projection.view.supported && projection.view.latest?.jobId === before.job.id && before.job.status === 'succeeded' &&
    projection.view.canRequest === false && projection.view.liveCloudChecked === false, 'REAL_PROJECTION');
  must(!jobsResult.rows.some(j => ['pending', 'running', 'retry_wait'].includes(j.status)), 'NO_ACTIVE_JOB');

  stage = 'public_material';
  const inputs = await loadExpressLiveInputsV1(); // Only public summary/binding/history.
  const root = await prepareExpressInitializedWorkerV2({ delivery: { ...inputs.delivery,
    scope: { ...inputs.delivery.scope, ownerDeploymentId: s.deploymentId } }, existingDefaultStoreId: s.existingDefaultStoreId });
  must(root.materialSha256 === s.materialSha256, 'PUBLIC_MATERIAL');
  const syntaxNow = Math.max(Date.now(), projection.view.latest.expiresAt) + 1000;
  stage = 'syntax_only_compilers';
  const request = await prepareInitializedPlatformRequest({ deployment, jobs: jobsResult.rows, gateEnabled: true, now: syntaxNow,
    adminUserId: 'usr_w4_syntax_only', body: { clientRequestId: '00000000-0000-4000-8000-000000000004', deploymentId: s.deploymentId,
      intent: 'restore_initialized_workload' } });
  must(request.program && !request.existingJobId, 'SYNTAX_REQUEST_ONLY');
  const plan = await prepareExpressInitializedJobV2({ material: root.material, materialSha256: root.materialSha256, snapshot: before.snapshot,
    externalFence: externalFenceFromSnapshotV3(before.snapshot), requestId: request.requestId, now: syntaxNow + 1000, deadline: syntaxNow + 3600000 });
  const queued = { id: plan.jobId, deployment_id: s.deploymentId, job_type: 'reconcile', dedupe_key: plan.dedupeKey, status: 'pending',
    payload: canonicalJson(request.program.payload), attempts: 0, max_attempts: 1, available_at: INITIALIZED_REVIEW_HOLD_AT,
    created_at: syntaxNow, updated_at: syntaxNow, completed_at: null, lease_owner: null, lease_token: null, lease_expires_at: null };
  const claim = await compilePlatformInitializedClaimV4({ plan, queuedJob: queued, approvedPlanSha256: plan.planSha256, leaseToken: 'lease_' + '0'.repeat(32) });
  const guard = await compilePlatformInitializedLeaseCheckV4(plan, queued, claim.lease);
  const complete = await compilePlatformInitializedCompleteV4({ plan, queuedJob: queued, lease: claim.lease, now: syntaxNow + 3000,
    proof: { materialSha256: s.materialSha256, jobId: plan.jobId, leaseToken: claim.lease.leaseToken,
      stackId: projection.view.latest.stackId, workloadExpiresAt: syntaxNow + 7200000, imageUri: s.artifactRef,
      configurationHash: s.configurationHash, existingDefaultStoreId: s.existingDefaultStoreId, epoch: s.epoch, operationHash: s.operationHash,
      providerObservationSha256: '1'.repeat(64), providerCheckedAt: syntaxNow + 2000,
      authorityObservationSha256: '2'.repeat(64), authorityCheckedAt: syntaxNow + 2000,
      controlObservationSha256: '3'.repeat(64), controlCheckedAt: syntaxNow + 2000, initializedVerified: true, effectiveConfigurationVerified: true } });
  const programs = [{ key: 'syntax_only_request_insert', text: request.program.text, values: request.program.values },
    ...claim.statements, ...guard.statements, ...complete.statements];
  stage = 'readonly_explain_without_analyze';
  const plans = await sql.transaction(tx => programs.map(q => tx.query('EXPLAIN (FORMAT JSON, COSTS OFF) ' + q.text, q.values)), options);
  // EXPLAIN is a utility command: node-postgres-compatible rowCount can be
  // null even though its one QUERY PLAN row is present.
  must(plans.length === 11 && plans.every(r => r.rows.length === 1 && Array.isArray(r.rows[0]['QUERY PLAN'])), 'EXPLAIN_ONLY');
  stage = 'independent_after_read';
  const after = await repository.readSnapshot({ deploymentId: s.deploymentId, predecessorJobId: 'job_202c8dc12a8bf379f3a7c693', newJobId: before.job.id }, signal);
  must(canonicalJson(before.snapshot) === canonicalJson(after.snapshot) && canonicalJson(before.job) === canonicalJson(after.job), 'OLD_ROWS_PRESERVED');
  const [afterJobs] = await sql.transaction(tx => [tx.query(`SELECT id,deployment_id,status,payload,created_at,completed_at
    FROM public.deployment_jobs WHERE deployment_id=$1 ORDER BY created_at DESC,id DESC`, [s.deploymentId])], options);
  must(canonicalJson(afterJobs.rows) === canonicalJson(jobsResult.rows), 'NO_QUEUE_CHANGE');
  // Verify the 76 previously approved W3 source pins, without loading private sources.
  const historical = JSON.parse(await readFile('F:/ChatGPT_workshop/techlong-worker-w3-review-20261016-r2/manifest.json', 'utf8'));
  stage = 'w3_code_pins';
  for (const p of historical.binding.pins) must(await sha256Hex(await readFile(path.join(ROOT, p.file), 'utf8')) === p.rawFileSha256, 'W3_PIN_UNCHANGED');
  const report = { schema: 'techlong/platform-w4a-readonly-check/v1', outcome: 'READONLY_PROJECTION_AND_SQL_PLANNING_PASSED', checkedAt: Date.now(),
    projection: projection.view, syntaxOnly: { syntheticFutureClockAndAdminAndQueueAndProof: true, executionReviewCreated: false,
      explainWithoutAnalyzeStatements: programs.length, programSha256: await sha256Hex(programs) },
    oldSnapshotSha256: await sha256Hex(before.snapshot), oldJobSha256: await sha256Hex(before.job), jobsSha256: await sha256Hex(jobsResult.rows),
    oldRowsAndJobsUnchanged: true, w3CodePinsUnchanged: historical.binding.pins.length,
    effects: { neonReadOnlyTransactions: 5, sqlDmlExecuted: 0, cloudCalls: 0, cloudWrites: 0, privatePackageReads: 0,
      secretValueReads: 0, applicationRequests: 0, executionSlotsConsumed: 0, requestGateActivated: false, globalQueueActivated: false },
    limitation: 'SQL planning and current saved receipt only; no real request/claim/completion, AWS live health or queued-job CLI execution acceptance' };
  const handle = await open(output, 'wx', 0o600); try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n'); } finally { await handle.close(); }
  console.log(JSON.stringify({ outcome: report.outcome, output, checkedAt: report.checkedAt, state: projection.view.state,
    explainStatements: programs.length, effects: report.effects }, null, 2));
}
check().catch(e => { console.error(JSON.stringify({ outcome: 'READONLY_CHECK_FAILED_NO_WRITE_RETRY', stage,
  checkCode: /^[A-Z0-9_]+$/.test(e.checkCode ?? '') ? e.checkCode : undefined,
  sqlState: /^[A-Z0-9]{5}$/.test(e.code ?? '') ? e.code : undefined, rawErrorsSuppressed: true,
  note: 'No write statement or AWS/private/app action exists in this checker. Do not infer SQL compatibility from a failed check.' })); process.exitCode = 1; });
