import { canonicalJson, sha256Hex } from "./hash.ts";
import { NEON_SEALED_PROBE_ACTION_V1, validateNeonProbeEventV1, validateNeonProbeResponseV1 } from "./readonly-neon-sealed-probe-v1.ts";
const digest = /^[a-f0-9]{64}$/;
export const NEON_SEALED_UPDATE_SCOPE_V1 = Object.freeze({
  existingTtlCodeUpdatesMaximum: 1, synchronousInvocationsMaximum: 1, publishVersion: false,
  lambdaRevisionIdCompareAndSwapRequired: true, existingConfigurationAndDrainCodeUnchanged: true,
  fixedReaderSecretInitialVersionOnly: true, neonHttpsTlsOneReadonlyTransaction: true, fixedSelectQueries: 10,
  serverReadonlySerializableDeferrableSettingsVerified: true, databaseCredentialAndBusinessWritesAllowed: false,
  noIamKeySecretAuthorityCellEcsScheduleOrDeleteGrantChanges: true, admissionGateNeverRewritten: true,
  noAutomaticRollbackRevokeDeleteFillResetOrWriteInvocationRetry: true,
  updateResponseUncertaintyOrConsumedSlotInspectOnly: true, externalInvocationsCannotBeExcluded: true,
  permanentSlot: "techlong-f3b3-readonly-neon-sealed-probe-v1-consumed", runtimeEnabled: false, monthlyBudgetTargetUsd: 50,
});
export interface NeonSealedUpdateInventoryV1 { observedAt: number; stableAnchorSha256: string; state: "OLD_READY" | "CANDIDATE_READY"; revisionId: string; sourcePermissionsAllowed: boolean; }
export interface NeonSealedUpdateManifestV1 {
  schemaVersion: 1; protocol: "readonly-neon-sealed-update-v1"; reviewedAt: number; expiresAt: number; codeSha256: string;
  stableAnchorSha256: string; originalRevisionId: string; artifactDirectory: string; artifactReportFileSha256: string;
  artifact: { zipSha256: string; zipBytes: number; bundleSha256: string; file: "ttl-neon.zip" };
  predecessorInspectionFileSha256: "7a7ac97a3f6fbd69dee36e24d8e2f9c6947fe4b1132b126284c9002f31e888dd";
  event: { schemaVersion: 1; action: typeof NEON_SEALED_PROBE_ACTION_V1; nonce: string }; scope: typeof NEON_SEALED_UPDATE_SCOPE_V1; manifestSha256: string;
}
function fail(code: string): never { throw new Error(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export async function compileNeonSealedUpdateManifestV1(input: { inventory: NeonSealedUpdateInventoryV1; now: number; codeSha256: string; artifactDirectory: string;
  artifactReportFileSha256: string; artifact: NeonSealedUpdateManifestV1["artifact"]; nonce: string }) {
  const i = input.inventory;
  if (i.state !== "OLD_READY" || !i.sourcePermissionsAllowed || !Number.isSafeInteger(i.observedAt) || i.observedAt > input.now || input.now - i.observedAt > 30000) fail("NEON_UPDATE_PREFLIGHT_INVALID");
  const body = { schemaVersion: 1 as const, protocol: "readonly-neon-sealed-update-v1" as const, reviewedAt: input.now, expiresAt: input.now + 3600000, codeSha256: input.codeSha256,
    stableAnchorSha256: i.stableAnchorSha256, originalRevisionId: i.revisionId, artifactDirectory: input.artifactDirectory, artifactReportFileSha256: input.artifactReportFileSha256, artifact: input.artifact,
    predecessorInspectionFileSha256: "7a7ac97a3f6fbd69dee36e24d8e2f9c6947fe4b1132b126284c9002f31e888dd" as const,
    event: { schemaVersion: 1 as const, action: NEON_SEALED_PROBE_ACTION_V1 as typeof NEON_SEALED_PROBE_ACTION_V1, nonce: input.nonce }, scope: NEON_SEALED_UPDATE_SCOPE_V1 };
  const manifest = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateNeonSealedUpdateManifestV1(manifest, input.codeSha256); return manifest;
}
export async function validateNeonSealedUpdateManifestV1(m: NeonSealedUpdateManifestV1, codeSha256: string) {
  const { manifestSha256, ...body } = m;
  if (canonicalJson(Object.keys(m).sort()) !== canonicalJson(["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "stableAnchorSha256", "originalRevisionId", "artifactDirectory", "artifactReportFileSha256", "artifact", "predecessorInspectionFileSha256", "event", "scope", "manifestSha256"].sort()) ||
    m.schemaVersion !== 1 || m.protocol !== "readonly-neon-sealed-update-v1" || !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 ||
    m.codeSha256 !== codeSha256 || !digest.test(codeSha256) || !digest.test(m.stableAnchorSha256) || !/^[a-f0-9-]{36}$/.test(m.originalRevisionId) ||
    !digest.test(m.artifactReportFileSha256) || typeof m.artifactDirectory !== "string" || !m.artifactDirectory ||
    canonicalJson(Object.keys(m.artifact).sort()) !== canonicalJson(["zipSha256", "zipBytes", "bundleSha256", "file"].sort()) ||
    !digest.test(m.artifact.zipSha256) || !digest.test(m.artifact.bundleSha256) || !Number.isSafeInteger(m.artifact.zipBytes) || m.artifact.zipBytes < 1 || m.artifact.zipBytes > 5_000_000 || m.artifact.file !== "ttl-neon.zip" ||
    m.predecessorInspectionFileSha256 !== "7a7ac97a3f6fbd69dee36e24d8e2f9c6947fe4b1132b126284c9002f31e888dd" ||
    canonicalJson(m.scope) !== canonicalJson(NEON_SEALED_UPDATE_SCOPE_V1) || !digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("NEON_UPDATE_MANIFEST_INVALID");
  validateNeonProbeEventV1(m.event);
}
export interface NeonSealedUpdatePortsV1 {
  now(): number; inventory(candidate: boolean): Promise<NeonSealedUpdateInventoryV1>; claimSlot(): Promise<void>; marker(name: string, value: unknown): Promise<void>;
  updateCodeOnce(): Promise<{ revisionId: string; zipSha256: string }>; waitForReadyReadonly(): Promise<void>; invokeOnce(): Promise<unknown>;
}
export async function runNeonSealedUpdateV1(m: NeonSealedUpdateManifestV1, approvedSha: string, codeSha256: string, p: NeonSealedUpdatePortsV1) {
  m = freeze(structuredClone(m)); await validateNeonSealedUpdateManifestV1(m, codeSha256);
  const approve = () => { const now = p.now(); if (approvedSha !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now + 5000 >= m.expiresAt) fail("NEON_UPDATE_FRESH_APPROVAL_REQUIRED"); };
  let stage = "PREFLIGHT", slotConsumed = false, codeUpdates = 0, invocations = 0, response: ReturnType<typeof validateNeonProbeResponseV1> | null = null;
  try {
    approve(); const before = await p.inventory(false);
    if (before.state !== "OLD_READY" || before.stableAnchorSha256 !== m.stableAnchorSha256 || before.revisionId !== m.originalRevisionId || !before.sourcePermissionsAllowed ||
      !Number.isSafeInteger(before.observedAt) || before.observedAt > p.now() || p.now() - before.observedAt > 30000) fail("NEON_UPDATE_PRESTATE_DRIFT");
    approve(); await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    stage = "UPDATE_CODE"; approve(); await p.marker("update-code-attempt.json", { manifestSha256: m.manifestSha256, revisionId: m.originalRevisionId }); approve(); codeUpdates++;
    const updated = await p.updateCodeOnce();
    if (!/^[a-f0-9-]{36}$/.test(updated.revisionId) || updated.revisionId === m.originalRevisionId || updated.zipSha256 !== m.artifact.zipSha256) fail("NEON_UPDATE_RESPONSE_UNCERTAIN");
    await p.marker("update-code-confirmed.json", updated); stage = "READONLY_WAIT"; await p.waitForReadyReadonly();
    const after = await p.inventory(true);
    if (after.state !== "CANDIDATE_READY" || after.stableAnchorSha256 !== m.stableAnchorSha256 || after.revisionId !== updated.revisionId ||
      !Number.isSafeInteger(after.observedAt) || after.observedAt > p.now() || p.now() - after.observedAt > 30000) fail("NEON_UPDATE_POSTSTATE_DRIFT");
    stage = "INVOKE_ONCE"; approve(); await p.marker("invoke-attempt.json", { event: m.event }); approve(); invocations++;
    response = validateNeonProbeResponseV1(m.event, await p.invokeOnce()); await p.marker("invoke-response.json", response);
    return { outcome: "NEON_UPDATE_AND_READ_SUBMITTED_REQUIRES_INSPECT", slotConsumed, codeUpdates, invocations, response, failureStage: null, retryAuthorized: false, runtimeEnabled: false };
  } catch (error) { return { outcome: "NEON_UPDATE_STOPPED_INSPECT_ONLY", slotConsumed, codeUpdates, invocations, response, failureStage: stage,
    failureCode: error instanceof Error && /^NEON_(UPDATE|PROBE)_[A-Z_]+$/.test(error.message) ? error.message : "NEON_UPDATE_OPERATION_UNVERIFIED", retryAuthorized: false, runtimeEnabled: false }; }
}
