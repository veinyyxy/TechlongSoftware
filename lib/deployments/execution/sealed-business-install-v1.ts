import { canonicalJson, sha256Hex } from "./hash.ts";
import { sealedDrainIamCandidateV3 } from "./sealed-drain-iam-candidate-v3.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "./readonly-runtime-iam-v1.ts";

export const SEALED_BUSINESS_PREDECESSOR_V1 = Object.freeze({
  approvedManifestSha256: "76cadd00835f523d4cd63e2052ccd08badfe25af299dff7bb77b62b7bab76b1f",
  receiptFileSha256: "2b21e9481396b30898fdd559049cfc6a400669844de1fb67939744f2e74e6b65",
  inspectionFileSha256: "2c6c2f25bf6df4eeb88b77c39a247290db2a978a88ac2d1f75be3e8b2b8d86ef",
  responseSha256: "c0c3be88233ffb56398e7e78bb0ec113837926277a3455252fc9e1d9d41f1e55",
  invokeCodeBindingSha256: "c120e4c6ac87ee80289088fba9f98316eae0641ff003ba55eb4cd6414beff7e3",
  buildReportFileSha256: "867781c7e42cff26c749fa0719d3ad360b83f72f0125a74cbffde1620fcb8315",
  policyReviewFileSha256: "18f3174d7fc43cc276403681ebb744ab1d86dee407b67b1f713e53a4792be989",
});
export const SEALED_BUSINESS_ARTIFACTS_V1 = Object.freeze([
  Object.freeze({ index: 0, file: "ttl-v3-fixed.zip", zipSha256: "621a8cd5f45cceedc6e1904e55afed445ca23900cef1b81e268e902e026a1bb5", zipBytes: 362628 }),
  Object.freeze({ index: 1, file: "drain-v3.zip", zipSha256: "20554427b6eaf7cba6f8cf7bd3a78e4aefd8947f2499addd1dd9ecf5d16985c0", zipBytes: 328034 }),
]);
export const SEALED_BUSINESS_INSTALL_SCOPE_V1 = Object.freeze({
  iamWriteCallsMaximum: 2, lambdaCodeUpdatesMaximum: 2, totalWriteCallsMaximum: 4, invocationsMaximum: 0,
  drainExistingBoundaryNewDefaultVersion: "v3", originalPolicyVersionsV1V2Retained: true,
  drainExistingInlineOnly: true, ttlIamUnchanged: true, noPublishOrConfigurationTagAliasConcurrencyUpdate: true,
  noSecretKeyDatabaseAuthorityCellEcsScheduleOrResourceDeletion: true,
  sourceSecretValuesRead: false, databaseConnectionAllowed: false,
  drainInstalledCodeExposesExistingLimitedDatabaseWriteCapability: true,
  ttlJournalAndDeletePermissionsRemainDenied: true, businessInvocationAndActivationNotAuthorized: true,
  externalAuthorizedInvocationsCannotBeExcluded: true,
  iamNonAtomicAndRoleIdCheckNotServiceSideCas: true,
  lambdaPreUpdateRevisionCasRequired: true, asynchronousCompletedRevisionMayDifferFromResponse: true,
  completedRevisionRequiresTwoIdenticalReadyReadonlyObservations: true,
  noAutomaticRollbackRevokeDeleteFillResetOrWriteRetry: true,
  oldRecordsBindingsAndConsumedSlotsPreserved: true,
  sourceLoginAutomaticallyRefreshesButFailureMayLeavePartialInstallation: true,
  secretDirectAllowSimulationNotFullyProved: true,
  permanentSlot: "techlong-f3b3-sealed-business-install-v1-consumed", monthlyBudgetTargetUsd: 50,
});
export type BusinessInstallStateV1 = {
  drainBoundary: "v2" | "v3"; drainInline: "BASE" | "CANDIDATE";
  functions: { index: number; code: "OLD" | "CANDIDATE"; revisionId: string }[];
};
export interface BusinessInstallInventoryV1 {
  observedAt: number; stableAnchorSha256: string; state: BusinessInstallStateV1;
  sourcePermissionsAllowed: boolean;
}
export interface BusinessInstallManifestV1 {
  schemaVersion: 1; protocol: "sealed-business-install-v1"; reviewedAt: number; expiresAt: number;
  codeSha256: string; stableAnchorSha256: string; originalState: BusinessInstallStateV1;
  artifactDirectory: string; artifacts: typeof SEALED_BUSINESS_ARTIFACTS_V1;
  predecessor: typeof SEALED_BUSINESS_PREDECESSOR_V1; documents: ReturnType<typeof sealedDrainIamCandidateV3>;
  resources: { boundaryArn: string; roleArn: string; inline: string; functions: string[] };
  scope: typeof SEALED_BUSINESS_INSTALL_SCOPE_V1; manifestSha256: string;
}
const digest = /^[a-f0-9]{64}$/, revision = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const exact = (v: unknown, keys: string[]) => v !== null && typeof v === "object" && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort());
function fail(code: string): never { throw new Error(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function shape(s: BusinessInstallStateV1) {
  if (!exact(s, ["drainBoundary", "drainInline", "functions"]) || !["v2", "v3"].includes(s.drainBoundary) || !["BASE", "CANDIDATE"].includes(s.drainInline) ||
    !Array.isArray(s.functions) || s.functions.length !== 2 || s.functions.some((f, i) => !exact(f, ["index", "code", "revisionId"]) || f.index !== i || !["OLD", "CANDIDATE"].includes(f.code) || !revision.test(f.revisionId))) fail("BUSINESS_INSTALL_STATE_INVALID");
}
function fresh(i: BusinessInstallInventoryV1, now: number) {
  shape(i.state);
  if (!digest.test(i.stableAnchorSha256) || !Number.isSafeInteger(now) || !Number.isSafeInteger(i.observedAt) || i.observedAt <= 0 || i.observedAt > now || now - i.observedAt > 30000) fail("BUSINESS_INSTALL_INVENTORY_STALE");
}
export const sealedBusinessResourcesV1 = () => ({
  boundaryArn: `arn:aws:iam::402010193138:policy/${targets[1].boundary}`, roleArn: `arn:aws:iam::402010193138:role/${targets[1].role}`, inline: targets[1].inline,
  functions: targets.map(t => `arn:aws:lambda:ca-central-1:402010193138:function:${t.functionName}`),
});
export async function compileBusinessInstallManifestV1(input: { inventory: BusinessInstallInventoryV1; now: number; codeSha256: string; artifactDirectory: string }) {
  const i = input.inventory; fresh(i, input.now);
  if (!i.sourcePermissionsAllowed || i.state.drainBoundary !== "v2" || i.state.drainInline !== "BASE" || i.state.functions.some(f => f.code !== "OLD")) fail("BUSINESS_INSTALL_ORIGINAL_PRESTATE_REQUIRED");
  const body = { schemaVersion: 1 as const, protocol: "sealed-business-install-v1" as const, reviewedAt: input.now, expiresAt: input.now + 3600000,
    codeSha256: input.codeSha256, stableAnchorSha256: i.stableAnchorSha256, originalState: i.state, artifactDirectory: input.artifactDirectory,
    artifacts: SEALED_BUSINESS_ARTIFACTS_V1, predecessor: SEALED_BUSINESS_PREDECESSOR_V1, documents: sealedDrainIamCandidateV3(), resources: sealedBusinessResourcesV1(), scope: SEALED_BUSINESS_INSTALL_SCOPE_V1 };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateBusinessInstallManifestV1(m, input.codeSha256); return m;
}
export async function validateBusinessInstallManifestV1(m: BusinessInstallManifestV1, codeSha256: string) {
  if (!exact(m, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "stableAnchorSha256", "originalState", "artifactDirectory", "artifacts", "predecessor", "documents", "resources", "scope", "manifestSha256"])) fail("BUSINESS_INSTALL_MANIFEST_INVALID");
  shape(m.originalState);
  if (m.schemaVersion !== 1 || m.protocol !== "sealed-business-install-v1" || !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 ||
    !digest.test(codeSha256) || m.codeSha256 !== codeSha256 || !digest.test(m.stableAnchorSha256) || typeof m.artifactDirectory !== "string" || !m.artifactDirectory ||
    m.originalState.drainBoundary !== "v2" || m.originalState.drainInline !== "BASE" || m.originalState.functions.some(f => f.code !== "OLD") ||
    !equal(m.artifacts, SEALED_BUSINESS_ARTIFACTS_V1) || !equal(m.predecessor, SEALED_BUSINESS_PREDECESSOR_V1) || !equal(m.documents, sealedDrainIamCandidateV3()) ||
    !equal(m.resources, sealedBusinessResourcesV1()) || !equal(m.scope, SEALED_BUSINESS_INSTALL_SCOPE_V1)) fail("BUSINESS_INSTALL_MANIFEST_INVALID");
  const { manifestSha256, ...body } = m; if (!digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("BUSINESS_INSTALL_MANIFEST_HASH_INVALID");
}
export interface BusinessInstallPortsV1 {
  now(): number; inventory(withPermissions: boolean): Promise<BusinessInstallInventoryV1>;
  claimSlot(): Promise<void>; marker(name: string, value: unknown): Promise<void>;
  createDefaultV3(expected: BusinessInstallStateV1): Promise<{ versionId?: string; isDefault?: boolean }>;
  putDrainInline(expected: BusinessInstallStateV1): Promise<void>;
  updateCodeOnce(index: 0 | 1, expected: BusinessInstallStateV1): Promise<{ revisionId: string; zipSha256: string }>;
  waitForReadyReadonly(index: 0 | 1, expectedAfterSubmission: BusinessInstallStateV1): Promise<{ revisionId: string; zipSha256: string; readyObservations: 2 }>;
}
export async function runBusinessInstallV1(raw: BusinessInstallManifestV1, approvedSha: string, codeSha256: string, p: BusinessInstallPortsV1) {
  const m = freeze(structuredClone(raw)); await validateBusinessInstallManifestV1(m, codeSha256);
  const approved = () => { const n = p.now(); if (approvedSha !== m.manifestSha256 || !Number.isSafeInteger(n) || n < m.reviewedAt || n + 5000 >= m.expiresAt) fail("BUSINESS_INSTALL_FRESH_APPROVAL_REQUIRED"); };
  let stage = "PREFLIGHT", slotConsumed = false, iamWrites = 0, codeUpdates = 0;
  const expected = structuredClone(m.originalState), confirmed: Record<string, unknown>[] = [];
  const inspect = async (withPermissions = false) => { const i = await p.inventory(withPermissions); fresh(i, p.now());
    if (i.stableAnchorSha256 !== m.stableAnchorSha256 || !equal(i.state, expected) || (withPermissions && !i.sourcePermissionsAllowed)) fail("BUSINESS_INSTALL_PRESTATE_DRIFT"); return i; };
  const attempt = async (name: string) => { stage = name; await inspect(); approved(); await p.marker(`${name}-attempt.json`, { manifestSha256: m.manifestSha256, expectedState: structuredClone(expected) }); approved(); };
  try {
    approved(); await inspect(true); approved(); await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    await attempt("boundary-v3"); iamWrites++; const v = await p.createDefaultV3(structuredClone(expected));
    if (v.versionId !== "v3" || v.isDefault !== true) fail("BUSINESS_INSTALL_BOUNDARY_RESPONSE_UNCERTAIN"); expected.drainBoundary = "v3";
    await p.marker("boundary-v3-confirmed.json", v); confirmed.push({ step: stage, ...v });
    await attempt("drain-inline"); iamWrites++; await p.putDrainInline(structuredClone(expected)); expected.drainInline = "CANDIDATE";
    await p.marker("drain-inline-confirmed.json", { submitted: true }); confirmed.push({ step: stage });
    for (const index of [0, 1] as const) {
      await attempt(`code-${index}`); codeUpdates++; const response = await p.updateCodeOnce(index, structuredClone(expected));
      if (!revision.test(response.revisionId) || response.revisionId === expected.functions[index].revisionId || response.zipSha256 !== m.artifacts[index].zipSha256) fail("BUSINESS_INSTALL_CODE_RESPONSE_UNCERTAIN");
      await p.marker(`code-${index}-submitted.json`, response); expected.functions[index].code = "CANDIDATE"; stage = `code-${index}-readonly-wait`;
      // This independent protocol explicitly binds the completed revision, not the async response revision.
      const ready = await p.waitForReadyReadonly(index, structuredClone(expected));
      if (!revision.test(ready.revisionId) || ready.revisionId === m.originalState.functions[index].revisionId || ready.zipSha256 !== m.artifacts[index].zipSha256 || ready.readyObservations !== 2) fail("BUSINESS_INSTALL_COMPLETED_REVISION_UNVERIFIED");
      expected.functions[index].revisionId = ready.revisionId; await inspect();
      await p.marker(`code-${index}-ready.json`, { ...ready, responseRevisionId: response.revisionId }); confirmed.push({ index, ...ready, responseRevisionId: response.revisionId });
    }
    stage = "FINAL_READONLY_VERIFY"; await inspect();
    return { outcome: "BUSINESS_INSTALL_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, iamWrites, codeUpdates, invocations: 0, confirmed, expectedState: expected,
      failureStage: null, failureCode: null, retryAuthorized: false, businessInvocationAuthorized: false, endToEndDeploymentVerified: false };
  } catch (e) { return { outcome: "BUSINESS_INSTALL_STOPPED_INSPECT_ONLY", slotConsumed, iamWrites, codeUpdates, invocations: 0, confirmed, expectedState: expected, failureStage: stage,
    failureCode: e instanceof Error && /^BUSINESS_INSTALL_[A-Z_]+$/.test(e.message) ? e.message : "BUSINESS_INSTALL_RESULT_UNVERIFIED",
    retryAuthorized: false, businessInvocationAuthorized: false, endToEndDeploymentVerified: false }; }
}
