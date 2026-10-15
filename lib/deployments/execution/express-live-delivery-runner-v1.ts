import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson, sha256Hex } from './hash.ts';
import { compileExpressFirstClaimProgramV1 } from './express-first-claim-program-v1.ts';
import type { createAwsSdkExpressLiveInfrastructureV1 } from './aws-sdk-express-live-infrastructure-v1.ts';
import type { createExpressLivePersistenceV1, ExpressLivePlanV2 } from './express-live-persistence-v1.ts';
import type { DeploymentExecutionRepository, DeploymentJobLeaseFence, ClaimedDeploymentJob,
  SaaSControlPort, SaaSControlPayloadCompilerPort, SaaSControlObservation } from './contracts.ts';
import type { DeploymentStatus } from '../state-machine.ts';
import { clearFirstOwnerPassword } from './control-secret-redaction.ts';

const sourceArchiveSha256 = '1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a';
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
export interface ExpressLivePreflightV1 {
  planSha256: string; checkedAt: number; inventorySha256: string; codeBindingSha256: string;
  configuration: Record<string, unknown>;
  // A concrete read-only verifier must supply these from current provider/SQL
  // observations. Historical receipts or caller-supplied defaults do not pass.
  namespacesAbsent: true; computeAndImagesUnchanged: true; cfnV8Unchanged: true;
  installedDatabase: { checkedAt: number; evidenceSha256: string; databaseOid: '16459'; roleOid: '16456';
    databaseName: 'tenant_a0da1748bc4d5419_db'; roleName: 'tenant_a0da1748bc4d5419_role';
    defaultStoreId: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87'; activeDefaultStores: 1;
    initialized: false; sourceArchiveSha256: string };
}
export interface ExpressLiveDeliveryReviewV1 {
  schema: 'techlong/express-live-delivery-review/v1'; planSha256: string; codeBindingSha256: string;
  preparedAt: number; admissionExpiresAt: number;
  independentChildWindowParentUnchanged: true; parentTagDoesNotStopBilling: true;
  manualCleanupRequired: true; providerRollbackPossible: true;
  maxSourceCloudWriteCalls: 3; maxProvisionPosts: 1; maxPrivateBundleLoads: 1; maxRuntimeSecretValueReads: 1;
  automaticWriteRetries: 0; iamWrites: 0; restoreOrMigrationRuns: 0;
  reviewSha256: string;
}
export async function prepareExpressLiveDeliveryReviewV1(input: {
  plan: ExpressLivePlanV2; codeBindingSha256: string; now: number;
}): Promise<ExpressLiveDeliveryReviewV1> {
  const { planSha256, ...body } = input.plan;
  if (await sha256Hex(body) !== planSha256 || input.plan.schema !== 'techlong/express-live-delivery-plan/v2' ||
      !/^[a-f0-9]{64}$/.test(input.codeBindingSha256) || !Number.isSafeInteger(input.now) ||
      input.now < input.plan.renderRequestedAt || input.now - input.plan.renderRequestedAt > 60000 ||
      Date.parse(input.plan.deadlineTag) - input.now < 110 * 60000) fail('EXPRESS_DELIVERY_REVIEW_INPUT_REJECTED');
  const review = { schema: 'techlong/express-live-delivery-review/v1' as const, planSha256, codeBindingSha256: input.codeBindingSha256,
    preparedAt: input.now, admissionExpiresAt: input.now + 15 * 60000, independentChildWindowParentUnchanged: true as const,
    parentTagDoesNotStopBilling: true as const, manualCleanupRequired: true as const, providerRollbackPossible: true as const,
    maxSourceCloudWriteCalls: 3 as const, maxProvisionPosts: 1 as const, maxPrivateBundleLoads: 1 as const,
    maxRuntimeSecretValueReads: 1 as const, automaticWriteRetries: 0 as const, iamWrites: 0 as const, restoreOrMigrationRuns: 0 as const };
  return Object.freeze({ ...review, reviewSha256: await sha256Hex(review) });
}

export interface ExpressLiveDeliveryPortsV1 {
  infrastructure: Awaited<ReturnType<typeof createAwsSdkExpressLiveInfrastructureV1>>;
  persistence: ReturnType<typeof createExpressLivePersistenceV1>;
  repository: DeploymentExecutionRepository;
  /** Must reread exact cloud/IAM/code/Neon/Aurora metadata, never a snapshot
   * relabeled as current. No private bundle or Secret value reads here. */
  preflight(signal: AbortSignal): Promise<ExpressLivePreflightV1>;
  observeInstalledDatabase(signal: AbortSignal): Promise<ExpressLivePreflightV1['installedDatabase']>;
  /** Lazy private loader + existing Express scoped control composition. */
  openControl(signal: AbortSignal): Promise<{ control: SaaSControlPort; compiler: SaaSControlPayloadCompilerPort; dispose(): void }>;
  /** Durable create-exclusive+fsync marker BEFORE every side effect. Root name
   * is fixed across new manifests; a new window cannot bypass a used root. */
  journal: { consume(entry: string, digest: string): Promise<void>; note(entry: string, evidence: Record<string, unknown>): Promise<void> };
  inspectReady(input: { plan: ExpressLivePlanV2; jobId: string; signal: AbortSignal }): Promise<{
    deploymentId: string; appInstanceId: string; jobId: string;
    deploymentStatus: string; instanceStatus: string; jobStatus: string; observationSha256: string;
  }>;
}

/** Supervised, single-admission kernel. Not installed in the general worker.
 * No resume, retry, compensation, migration, grant or cleanup path. A timeout
 * after submission may have committed: return inspect-only, never retransmit.
 * Preflight/private-source adapters still need explicit wiring before a live
 * CLI can expose this function. Construction/testing is NOT deployment proof. */
export async function runReviewedExpressLiveDeliveryV1(input: {
  plan: ExpressLivePlanV2; review: ExpressLiveDeliveryReviewV1; approvedReviewSha256: string;
  ports: ExpressLiveDeliveryPortsV1; signal: AbortSignal; now?: () => number;
}) {
  const p = structuredClone(input.plan), review = structuredClone(input.review), ports = input.ports, now = input.now || Date.now;
  const { reviewSha256, ...reviewBody } = review, { planSha256, ...planBody } = p;
  if (reviewSha256 !== input.approvedReviewSha256 || await sha256Hex(reviewBody) !== reviewSha256 ||
      await sha256Hex(planBody) !== planSha256 || review.planSha256 !== planSha256 ||
      p.schema !== 'techlong/express-live-delivery-plan/v2' || now() < review.preparedAt || now() >= review.admissionExpiresAt)
    fail('EXPRESS_DELIVERY_FRESH_APPROVAL_REQUIRED');
  const expectedReview = await prepareExpressLiveDeliveryReviewV1({ plan: p, codeBindingSha256: review.codeBindingSha256, now: review.preparedAt });
  if (canonicalJson(expectedReview) !== canonicalJson(review)) fail('EXPRESS_DELIVERY_REVIEW_SCOPE_REJECTED');
  input.signal.throwIfAborted();
  await ports.infrastructure.assertIdentity(input.signal);
  const fresh = await ports.preflight(input.signal), db = fresh.installedDatabase;
  const recent = (t: number, maxAge: number) => Number.isSafeInteger(t) && t <= now() && now() - t <= maxAge;
  const exactDatabase = (observed: ExpressLivePreflightV1['installedDatabase'], maxAge: number) => observed &&
    recent(observed.checkedAt, maxAge) && /^[a-f0-9]{64}$/.test(observed.evidenceSha256) &&
    observed.databaseOid === '16459' && observed.roleOid === '16456' && observed.databaseName === 'tenant_a0da1748bc4d5419_db' &&
    observed.roleName === 'tenant_a0da1748bc4d5419_role' && observed.defaultStoreId === 'add89a8c-f43e-81b9-8287-0cb6c5c54f87' &&
    observed.activeDefaultStores === 1 && observed.initialized === false && observed.sourceArchiveSha256 === sourceArchiveSha256;
  if (fresh.planSha256 !== planSha256 || fresh.codeBindingSha256 !== review.codeBindingSha256 || !recent(fresh.checkedAt, 30000) ||
      !/^[a-f0-9]{64}$/.test(fresh.inventorySha256) || await sha256Hex(fresh.configuration) !== p.scope.configurationHash ||
      fresh.namespacesAbsent !== true || fresh.computeAndImagesUnchanged !== true || fresh.cfnV8Unchanged !== true ||
      !exactDatabase(db, 5 * 60000) ||
      now() >= review.admissionExpiresAt) fail('EXPRESS_DELIVERY_FRESH_PREFLIGHT_REQUIRED');
  const executionDeadline = Math.min(now() + 55 * 60000, Date.parse(p.deadlineTag) - 5 * 60000);
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(executionDeadline - now())]);
  let phase = 'admit', stackId: string | null = null, control: Awaited<ReturnType<typeof ports.openControl>> | undefined;
  let claim: Awaited<ReturnType<typeof compileExpressFirstClaimProgramV1>> | undefined;
  const entered = new Set<string>();
  const entry = async (name: string, request: unknown) => {
    signal.throwIfAborted(); if (now() >= executionDeadline || entered.has(name)) fail('EXPRESS_DELIVERY_ENTRY_CLOSED');
    entered.add(name); phase = name; await ports.journal.consume(name, await sha256Hex(request)); signal.throwIfAborted();
  };
  // Root is consumed before the first private read, not after a successful API.
  await entry('admit', { reviewSha256, planSha256 });
  try {
    await entry('private_control_load', { materialSha256: p.materialSha256 });
    control = await ports.openControl(signal);
    const leaseToken = 'lease_' + randomBytes(16).toString('hex');
    const claimInput = { plan: p, configuration: fresh.configuration, environmentPolicy: { ...p.environmentPolicy }, now: now(), leaseToken };
    const claimProgram = await compileExpressFirstClaimProgramV1(claimInput);
    await entry('first_claim', { programSha256: claimProgram.programSha256 });
    claim = await ports.persistence.firstClaim(claimInput, signal);
    if (claim.programSha256 !== claimProgram.programSha256) fail('EXPRESS_DELIVERY_CLAIM_DRIFT');
    const lease: DeploymentJobLeaseFence = { jobId: claim.jobId, deploymentId: p.scope.deploymentId,
      workerId: claim.workerId, leaseToken, attempt: 1 };
    const job: ClaimedDeploymentJob = { id: claim.jobId, deploymentId: p.scope.deploymentId, jobType: 'apply',
      payload: { deploymentId: p.scope.deploymentId, planHash: p.scope.planHash }, attempt: 1, maxAttempts: 1,
      leaseExpiresAt: claim.leaseExpiresAt, leaseToken };
    const check = async () => {
      signal.throwIfAborted(); if (now() >= claim!.leaseExpiresAt - 60000) fail('EXPRESS_DELIVERY_LEASE_TOO_SHORT');
      await ports.infrastructure.assertEpoch(signal);
      if (!await ports.repository.assertTenantExternalOperation({ lease, externalFence: active, requiredState: 'active', now: now() }))
        fail('EXPRESS_DELIVERY_EXTERNAL_FENCE_LOST');
    };
    await entry('install_epoch', p.proposedEpochTransaction);
    const proof = await ports.infrastructure.installEpoch(signal);
    if (canonicalJson(proof.pendingFence) !== canonicalJson(p.pendingExternalFence) ||
        proof.evidenceHash !== await sha256Hex(proof.evidence) || proof.provisionPredecessor !== null)
      fail('EXPRESS_DELIVERY_PROVIDER_PROOF_DRIFT');
    await entry('activate_epoch', { evidenceHash: proof.evidenceHash });
    const activated = await ports.repository.activateTenantExternalOperation({ lease, proof, now: now() });
    if (!activated || canonicalJson(activated) !== canonicalJson({ ...p.pendingExternalFence, state: 'active' })) fail('EXPRESS_DELIVERY_ACTIVATION_REJECTED');
    const active = activated;
    let status: DeploymentStatus = 'preflight';
    const transition = async (to: DeploymentStatus, step: string) => {
      await check(); await entry('status_' + to, { from: status, to, step });
      if (!await ports.repository.transitionDeployment({ lease, from: [status], to, currentStep: step, now: now() }))
        fail('EXPRESS_DELIVERY_STATUS_OR_LEASE_CHANGED');
      status = to;
    };
    await transition('database_preparing', 'reuse_installed_express_database');
    await transition('migrating', 'reuse_existing_migration_receipt_no_migration');
    await transition('infrastructure_provisioning', 'create_reviewed_seven_resource_workload');
    await check(); await entry('create_workload', p.proposedWorkloadCreate);
    stackId = await ports.infrastructure.createWorkload(signal);
    await ports.journal.note('workload_acknowledged', { stackId });
    const workload = await ports.infrastructure.waitWorkload(stackId, signal);
    await check(); await entry('create_dns', p.proposedDnsCreate);
    const dnsChangeId = await ports.infrastructure.createDns(signal);
    await ports.journal.note('dns_acknowledged', { dnsChangeId });
    await ports.infrastructure.waitDns(dnsChangeId, signal);
    await transition('waiting_healthy', 'verify_real_express_bootstrap');
    const target = { appInstanceId: p.scope.appInstanceId,
      hostname: p.proposedDnsCreate.ChangeBatch.Changes[0].ResourceRecordSet.Name.slice(0, -1), externalFence: active, signal };
    const matches = (o: SaaSControlObservation) => o.ready && o.desiredConfigurationHash === p.scope.configurationHash && o.imageRevision === p.scope.artifactRef.split('@')[1];
    let bootstrap: SaaSControlObservation | undefined;
    for (let n = 0; n < 12; n++) {
      await check(); bootstrap = await control.control.waitUntilHealthy(target);
      if (matches(bootstrap)) break;
      if (n !== 11) await delay(10000, undefined, { signal });
    }
    if (!bootstrap || !matches(bootstrap)) fail('EXPRESS_DELIVERY_BOOTSTRAP_UNPROVED');
    // Adopt the existing schema using historical installation provenance plus
    // current preflight SQL/store and actual application bootstrap identity.
    // Do NOT invent restore/migration operations or mark initialized here.
    const databaseReadback = await ports.observeInstalledDatabase(signal);
    if (!exactDatabase(databaseReadback, 30000)) fail('EXPRESS_DELIVERY_CURRENT_DATABASE_PROOF_REQUIRED');
    const adoption = { protocol: 'express-installed-database-adoption/v1', existingDatabaseNotRestored: true,
      sourceArchiveSha256, preflightEvidenceSha256: db.evidenceSha256, currentDatabaseEvidenceSha256: databaseReadback.evidenceSha256,
      workloadInventorySha256: workload.resourceInventorySha256, bootstrapObservationSha256: await sha256Hex(bootstrap) };
    await check(); await entry('adopt_verified_schema', adoption);
    if (!await ports.repository.recordTenantResourceLifecycle({ lease, fence: active.resourceFence, externalFence: active,
      runtimeSecretRef: p.futureTemplate.parameters.TenantRuntimeSecretArn, lifecycleStatus: 'verified',
      baselineDigest: sourceArchiveSha256, migrationContract: 'speedfeast-saas-control-v1', evidence: adoption,
      evidenceHash: await sha256Hex(adoption), now: now() })) fail('EXPRESS_DELIVERY_ADOPTION_REJECTED');
    await transition('configuring', 'provision_once_via_mtls');
    await check(); await entry('compile_first_owner', { configurationHash: p.scope.configurationHash });
    const context = await ports.repository.loadContext(job);
    const compiled = await control.compiler.compile({ context, configurationHash: p.scope.configurationHash, externalFence: active, signal });
    try {
      if (compiled.configurationHash !== p.scope.configurationHash) fail('EXPRESS_DELIVERY_COMPILED_CONFIGURATION_DRIFT');
      await check(); await entry('provision_once', { idempotencyKey: p.idempotencyKey, operationHash: active.operationHash });
      await control.control.provision({ ...target, idempotencyKey: p.idempotencyKey, compiledPayload: compiled.compiledPayload });
    } finally { clearFirstOwnerPassword(compiled.compiledPayload); }
    await transition('verifying', 'verify_initialized_and_effective_configuration');
    await check(); const initialized = await control.control.readConfiguration(target);
    if (!matches(initialized)) fail('EXPRESS_DELIVERY_INITIALIZED_CONFIGURATION_UNPROVED');
    const observationSha256 = await sha256Hex({ bootstrap, initialized, workload, planSha256 });
    await check(); await entry('atomic_ready', { observationSha256, stackId });
    await ports.persistence.finishReady({ plan: p, lease, externalFence: active, configuration: fresh.configuration,
      proof: { planSha256, stackId, observationSha256, configurationHash: p.scope.configurationHash, imageRevision: initialized.imageRevision!,
        resourceEvidenceSha256: await sha256Hex(adoption), checkedAt: now(), bootstrapVerified: true,
        initializedVerified: true, effectiveConfigurationVerified: true }, now: now() }, signal);
    phase = 'independent_ready_inspect';
    const inspected = await ports.inspectReady({ plan: p, jobId: claim.jobId, signal });
    if (inspected.deploymentId !== p.scope.deploymentId || inspected.appInstanceId !== p.scope.appInstanceId ||
        inspected.jobId !== claim.jobId || inspected.deploymentStatus !== 'ready' || inspected.instanceStatus !== 'active' ||
        inspected.jobStatus !== 'succeeded' || inspected.observationSha256 !== observationSha256)
      fail('EXPRESS_DELIVERY_ATOMIC_READY_REQUIRES_INSPECT');
    await ports.journal.note('independent_ready_verified', { ...inspected, stackId });
    return { outcome: 'INITIALIZED_READY_INDEPENDENTLY_VERIFIED' as const, phase, stackId, jobId: claim.jobId,
      planSha256, reviewSha256, observationSha256, retryAllowed: false };
  } catch {
    // Never serialize an SDK/SQL/control error: it may contain private input.
    return { outcome: 'REQUIRES_INDEPENDENT_INSPECT_NO_RETRY' as const, phase, stackId,
      jobId: claim?.jobId || null, planSha256, reviewSha256, retryAllowed: false };
  } finally { control?.dispose(); }
}
