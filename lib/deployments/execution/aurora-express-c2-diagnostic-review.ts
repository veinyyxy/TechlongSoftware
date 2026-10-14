import contract from './aurora-database-contract-v2.cjs';
import { C2_CLUSTER_ARN, C2_SOURCE } from './aurora-express-c2-review.ts';

export const C2A_SHA = 'b883fbeacbb0ae473f408f296f805a31c50bd865730e3b4d7a2af45387101671';
export interface ExistingExpressBinding {
  manifestSha256: string; clusterArn: string; clusterResourceId: string; createdAt: string;
  engineVersion: string; endpoint: string; port: number; writerIdentifier: string; writerArn: string;
  writerResourceId: string; writerCreatedAt: string; tags: Readonly<Record<string, string>>;
  clusterStatus: string; writerStatus: string;
}
const bindingKeys = ['manifestSha256', 'clusterArn', 'clusterResourceId', 'createdAt', 'engineVersion', 'endpoint',
  'port', 'writerIdentifier', 'writerArn', 'writerResourceId', 'writerCreatedAt', 'tags', 'clusterStatus', 'writerStatus'];
export function validateExistingExpressBinding(b: ExistingExpressBinding) {
  if (!b || Object.keys(b).sort().join(',') !== bindingKeys.slice().sort().join(',') ||
    b.manifestSha256 !== C2A_SHA || b.clusterArn !== C2_CLUSTER_ARN ||
    !/^cluster-[A-Z0-9]{20,40}$/.test(b.clusterResourceId) || !/^db-[A-Z0-9]{20,40}$/.test(b.writerResourceId) ||
    b.writerIdentifier !== 'techlong-sandbox-express-d001-instance-1' ||
    b.writerArn !== `arn:aws:rds:ca-central-1:402010193138:db:${b.writerIdentifier}` ||
    !/^[a-z0-9][a-z0-9.-]{1,200}\.ca-central-1\.rds\.amazonaws\.com$/.test(b.endpoint) || b.port !== 5432 ||
    !/^(?:1[6-9]|[2-9][0-9])\.[0-9]{1,2}$/.test(b.engineVersion) ||
    ![b.createdAt, b.writerCreatedAt].every(t => Number.isFinite(Date.parse(t))) ||
    b.clusterStatus !== 'available' || b.writerStatus !== 'available' ||
    Object.keys(b.tags).sort().join(',') !== 'DatabaseProfile,DeliveryTrack,ManagedBy,ProbeNonce' ||
    b.tags.ManagedBy !== 'techlong-sandbox' || b.tags.DatabaseProfile !== 'express_iam' ||
    b.tags.DeliveryTrack !== 'D002-C2-admin-facts' || !/^[a-f0-9]{32}$/.test(b.tags.ProbeNonce))
    throw Error('EXPRESS_C2B_PHYSICAL_BINDING_REJECTED');
  return structuredClone(b);
}
export interface DiagnosticFacts {
  observedAt: string; source: { Account: string; Arn: string; UserId: string };
  plan: { planType: string; planStatus: string }; binding: ExistingExpressBinding;
  connectPermission: { action: string; resource: string; decision: string; missingContext: readonly string[] };
}
export function assertDiagnosticFacts(f: DiagnosticFacts, expected: ExistingExpressBinding, now: number) {
  validateExistingExpressBinding(f.binding); validateExistingExpressBinding(expected);
  const age = now - Date.parse(f.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 30000 || f.source.Account !== '402010193138' ||
    f.source.Arn !== C2_SOURCE || f.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' ||
    f.plan.planType !== 'FREE' || f.plan.planStatus !== 'ACTIVE' ||
    contract.canonicalJson(f.binding) !== contract.canonicalJson(expected) ||
    f.connectPermission.action !== 'rds-db:connect' || f.connectPermission.decision !== 'allowed' ||
    f.connectPermission.resource !== `arn:aws:rds-db:ca-central-1:402010193138:dbuser:${expected.clusterResourceId}/postgres` ||
    !Array.isArray(f.connectPermission.missingContext) || f.connectPermission.missingContext.length)
    throw Error('EXPRESS_C2B_FRESH_FACTS_REJECTED');
}
export interface DiagnosticHistory {
  originalManifestSha256: string; originalCodeBindingSha256: string;
  createdFileSha256: string; bindingFileSha256: string; stoppedFileSha256: string;
  createSlotFileSha256: string; sqlSlotFileSha256: string;
}
export function prepareDiagnosticReview(facts: DiagnosticFacts, history: DiagnosticHistory, codeBindingSha256: string, now: number) {
  assertDiagnosticFacts(facts, facts.binding, now);
  if (history.originalManifestSha256 !== C2A_SHA || Object.keys(history).sort().join(',') !==
    'bindingFileSha256,createSlotFileSha256,createdFileSha256,originalCodeBindingSha256,originalManifestSha256,sqlSlotFileSha256,stoppedFileSha256' ||
    !Object.values(history).every(s => /^[a-f0-9]{64}$/.test(s)) || !/^[a-f0-9]{64}$/.test(codeBindingSha256))
    throw Error('EXPRESS_C2B_HISTORY_OR_CODE_REJECTED');
  const material = { schema: 'techlong/express-admin-diagnostic-review/c2b', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 3600000).toISOString(), codeBindingSha256, history, facts,
    target: { schema: 'techlong/express-admin-target/c2', clusterArn: facts.binding.clusterArn,
      clusterResourceId: facts.binding.clusterResourceId, endpoint: facts.binding.endpoint, port: facts.binding.port,
      observedEngineVersion: facts.binding.engineVersion },
    limits: { logicalSqlSessions: 1, fixedReadonlySqlStatements: 4, maxNativeConnectMs: 30000, maxSessionMs: 90000,
      maxJournalFrames: 64, awsResourceWrites: 0, secretReads: 0, iamWrites: 0, sqlWrites: 0,
      sdkAndCliMetadataCallsMaximum: 9, retries: 0 },
    attemptSlot: 'techlong-d002-express-c2b-diagnostic-v1.permanent-slot.json',
    risks: ['Retained resources can accrue cost or credits; auto-pause is not a spending cap or automatic deletion.',
      'A new SQL connection can resume an idle cluster; server/provider logs may include connection and catalog metadata.',
      'One pg Client uses native DNS/address selection and may attempt several resolved addresses; this is not a SQL-session retry.',
      'Source is an existing administrator, not a new least-privilege boundary; a temporary Login snapshot must match STS and have 120 seconds left.',
      'Readback and connection are not a cross-service CAS; resource/credential/network state can change after checks.',
      'Journal captures allowlisted stages and codes only, not raw errors/tokens; missing or generic evidence can remain inconclusive.',
      'Consumed new slot never resets/retries. Journal/writeback failures can leave partial local evidence; no automatic repair or cloud cleanup.',
      'Fixed SQL/TLS/identity checks and old consumed slots are preserved; no IAM, business mutation, lifecycle/tenant authority or ready claim.'],
    runtimeEnabled: false, lifecycleCompatible: false, executionAuthorized: false };
  return Object.freeze({ ...material, manifestSha256: contract.digest(material) });
}
export type DiagnosticReview = ReturnType<typeof prepareDiagnosticReview>;
export function assertDiagnosticApproval(r: DiagnosticReview, approvedSha: string, codeSha: string, now: number) {
  const { manifestSha256, ...body } = r;
  if (r.schema !== 'techlong/express-admin-diagnostic-review/c2b' || approvedSha !== manifestSha256 ||
    manifestSha256 !== contract.digest(body) || codeSha !== r.codeBindingSha256 ||
    now < Date.parse(r.preparedAt) || now >= Date.parse(r.expiresAt)) throw Error('EXPRESS_C2B_FRESH_APPROVAL_REQUIRED');
  const expected = prepareDiagnosticReview(r.facts, r.history, codeSha, Date.parse(r.preparedAt));
  if (contract.canonicalJson(expected) !== contract.canonicalJson(r)) throw Error('EXPRESS_C2B_REVIEW_SCOPE_DRIFT');
}
