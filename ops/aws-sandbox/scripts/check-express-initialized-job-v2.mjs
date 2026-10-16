// W2 READ ONLY integration check. No run/write mode exists in this script.
// EXPLAIN without ANALYZE plans the compiled SQL; it does not run that SQL.
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { loadExpressLiveInputsV1 } from './express-live-local-inputs-v1.mjs';
import { prepareExpressInitializedWorkerV2 } from '../../../lib/deployments/execution/express-initialized-worker-v2.ts';
import { prepareExpressInitializedJobV2, compileExpressInitializedClaimV2,
  compileExpressInitializedLeaseCheckV2 } from '../../../lib/deployments/execution/express-initialized-job-v2.ts';
import { createExpressInitializedJobNeonV2 } from '../../../lib/deployments/execution/express-initialized-job-neon-v2.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';

export async function checkInitializedJobReadOnlyV2() {
  let stage = 'public_history';
  try {
  const signal = AbortSignal.timeout(90000);
  const input = await loadExpressLiveInputsV1();
  const deploymentId = 'dep_7c99bd249470184852f0dc74', predecessorJobId = 'job_202c8dc12a8bf379f3a7c693';
  const root = await prepareExpressInitializedWorkerV2({ delivery: { ...input.delivery,
    scope: { ...input.delivery.scope, ownerDeploymentId: deploymentId } },
  existingDefaultStoreId: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87' });
  const env = parseEnv(await readFile(new URL('../../../.env.local', import.meta.url), 'utf8'));
  const repository = createExpressInitializedJobNeonV2(env.DATABASE_URL);
  stage = 'neon_readonly_snapshot';
  const observed = await repository.readSnapshot({ deploymentId, predecessorJobId }, signal);
  const snapshot = observed.snapshot, r = snapshot.resource, o = snapshot.operation;
  const externalFence = { schemaVersion: 1, resourceFence: { schemaVersion: 1, generation: r.generation,
    ownerDeploymentId: r.owner_deployment_id, ownershipMarker: r.ownership_marker, identity: { schemaVersion: 1,
      appInstanceId: r.app_instance_id, workspaceId: r.workspace_id, productId: r.product_id,
      environmentId: r.environment_id, cellKey: r.cell_key, stableIdentityHash: r.stable_identity_hash,
      databaseName: r.database_name, roleName: r.role_name, secretName: r.secret_name } },
    ownerDeploymentId: o.owner_deployment_id, epoch: o.epoch, intent: o.intent, marker: o.marker,
    operationHash: o.operation_hash, state: o.state };
  const now = observed.checkedAt;
  stage = 'compile_exact_coordinate';
  const plan = await prepareExpressInitializedJobV2({ material: root.material, materialSha256: root.materialSha256,
    snapshot, externalFence, requestId: await sha256Hex({ purpose: 'W2_READ_ONLY_COMPILE_CHECK_NOT_EXECUTION_REVIEW', now, snapshot }),
    now, deadline: now + 3600000 });
  // Equality here exercises a pure compiler only. Never call repository.claim.
  const claim = await compileExpressInitializedClaimV2({ plan, approvedPlanSha256: plan.planSha256,
    leaseToken: 'lease_' + randomUUID().replaceAll('-', '') });
  const guard = await compileExpressInitializedLeaseCheckV2(plan, claim.lease);
  const statements = [...claim.statements, ...guard.statements];
  if (statements.length !== 5) throw Error('W2_UNEXPECTED_QUERY_BUDGET');
  const sql = neon(env.DATABASE_URL, { fullResults: true });
  stage = 'neon_readonly_explain';
  const explained = await sql.transaction(tx => statements.map(q => tx.query('EXPLAIN (FORMAT JSON) ' + q.text, q.values)), {
    isolationLevel: 'RepeatableRead', readOnly: true, fetchOptions: { signal },
  });
  // EXPLAIN's command tag has no affected-row count; inspect its plan row.
  if (explained.length !== 5 || explained.some(r => r.rows.length !== 1 || !Object.hasOwn(r.rows[0], 'QUERY PLAN')))
    throw Error('W2_EXPLAIN_RESULT_REJECTED');
  return { schema: 'techlong/initialized-worker-w2-readonly-check/v1', checkedAt: new Date().toISOString(),
    materialSha256: root.materialSha256, deploymentId, predecessorJobId,
    oldDeploymentStatus: snapshot.deployment.status, oldJobStatus: snapshot.predecessorJob.status,
    appStatus: snapshot.app.status, resourceStatus: r.lifecycle_status, activeEpoch: o.epoch,
    snapshotRowHashes: await Promise.all(Object.entries(snapshot).map(async ([key, row]) => ({ key, sha256: await sha256Hex(row) }))),
    planCompiled: true, planIsExecutionReview: false, jobCreated: false,
    databaseTransactions: 2, databaseReadOnlyTransactions: 2, snapshotSelects: 1,
    explainWithoutAnalyze: statements.map(q => q.key), explainedStatements: explained.length,
    statementsExecutedForMutation: 0, cloudWrites: 0, jobWrites: 0, businessWrites: 0,
    privatePackageLoads: 0, secretValueReads: 0, auroraConnections: 0, applicationRequests: 0,
    runtimeEnabled: false, productionCompatibilityVerified: false,
    note: 'Real Neon snapshot and planner checks only. No claim, live lease, provider/control proof or completion was executed.' };
  } catch (e) {
    // Deliberately never expose DB URLs, SQL parameter values or provider text.
    const known = ['EXPRESS_INITIALIZED_JOB_REJECTED', 'EXPRESS_INITIALIZED_NEON_READ_REQUIRES_INSPECT_NO_RETRY',
      'EXPRESS_INITIALIZED_NEON_TLS_NEON_REQUIRED'];
    throw Object.assign(Error('W2_READONLY_CHECK_FAILED_NO_WRITE_MODE'), { safeStage: stage,
      safeCode: known.includes(e?.message) ? e.message : 'UNCLASSIFIED_SANITIZED_FAILURE',
      sqlState: /^[A-Z0-9]{5}$/.test(e?.code) ? e.code : undefined,
      sqlPosition: /^\d{1,6}$/.test(e?.position) ? Number(e.position) : undefined,
      diagnostic: ['operator does not exist', 'syntax error', 'could not determine data type', 'inconsistent types deduced',
        'column reference', 'permission denied', 'read-only transaction'].find(s => String(e?.message).includes(s)) });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') !== '--check-readonly') throw Error('W2_READONLY_FLAG_REQUIRED');
  try { console.log(JSON.stringify(await checkInitializedJobReadOnlyV2(), null, 2)); }
  catch (e) { console.error(JSON.stringify({ outcome: 'W2_READONLY_CHECK_FAILED_NO_WRITE_MODE', stage: e.safeStage,
    code: e.safeCode, sqlState: e.sqlState, sqlPosition: e.sqlPosition, diagnostic: e.diagnostic, retryAllowed: false })); process.exitCode = 1; }
}
