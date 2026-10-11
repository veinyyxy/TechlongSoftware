import { canonicalJson, sha256Hex } from "./hash.ts";
import { NEON_SEALED_PROBE_ACTION_V1, validateNeonProbeEventV1, validateNeonProbeResponseV1 } from "./readonly-neon-sealed-probe-v1.ts";

export const NEON_INVOKE_PREDECESSOR_V1 = Object.freeze({
  approvedManifestSha256: "c3635097594bdd1443fe4cf814507da14a33ab4723c668ab7a068b5e1cd756f1",
  receiptFileSha256: "996477536dc68fb9b881149431824131631bd7b545723dd2b628ccb4a799aa0b",
  firstInspectionFileSha256: "1750fbd0471720b467cecd43338e2f8eeb6c5f411c67c44aae65c66924b860d0",
  independentInspectionFileSha256: "5ebd0746af63127e2a1d7802f7462d21cc3f18d2a13ecfd68caa5549f889e6d9",
  confirmedUpdateFileSha256: "96cd762447da182110d1994ffde314f1639a347915180de4bd3b62854bb32df2",
  codeBindingSha256: "d7919f4aa2827b89276198d731c2e2f444d88b4165a7c52a81c3e58d6c172aba",
  installedZipSha256: "0f2330afbef3e801faf3645f96610d293349705743ae0748de22198391a25533",
  installedZipBytes: 277794,
  completedRevisionId: "80270648-9f62-488b-a99c-4d6a86558302",
  fullAnchorSha256: "33a5f0257d699b689fa0ec4aa4d852ca5f67aba1e19fdc130d5d893fc3280301",
  stableAnchorSha256: "3d373a6602d2bbcc111b8879ffa37385ef5a7ce74d9bbad1f7390dbe18d5689a",
});
export const NEON_SEALED_INVOKE_SCOPE_V1 = Object.freeze({
  codeUpdates: 0, configurationOrTagUpdates: 0, synchronousInvocationsMaximum: 1,
  noIamKeySecretAuthorityCellEcsScheduleOrDatabaseBusinessWrites: true,
  fixedReaderSecretInitialVersionOnly: true, neonHttpsTlsOneReadonlyTransaction: true, fixedSelectQueries: 10,
  completedRevisionCodeConfigurationAndFullAnchorPinned: true,
  metadataChecksAreNotInvocationServerSideCas: true, externallyAuthorizedInvocationsCannotBeExcluded: true,
  noAutomaticRollbackRevokeDeleteFillResetOrInvocationRetry: true,
  oldConsumedSlotsAndCodeBindingsPreserved: true,
  permanentSlot: "techlong-f3b3-readonly-neon-sealed-invoke-v1-consumed", runtimeEnabled: false, monthlyBudgetTargetUsd: 50,
});
export interface NeonSealedInvokeInventoryV1 {
  observedAt: number; predecessorAnchorSha256: string; stableAnchorSha256: string;
  state: "CANDIDATE_READY"; revisionId: string; sourcePermissionsAllowed: boolean;
}
export interface NeonSealedInvokeManifestV1 {
  schemaVersion: 1; protocol: "readonly-neon-sealed-invoke-v1"; reviewedAt: number; expiresAt: number; codeSha256: string;
  fullAnchorSha256: string; stableAnchorSha256: string; completedRevisionId: string;
  predecessor: typeof NEON_INVOKE_PREDECESSOR_V1;
  event: { schemaVersion: 1; action: typeof NEON_SEALED_PROBE_ACTION_V1; nonce: string };
  scope: typeof NEON_SEALED_INVOKE_SCOPE_V1; manifestSha256: string;
}
const digest = /^[a-f0-9]{64}$/;
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function fail(code: string): never { throw new Error(code); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function matchNeonSealedInvokeInventoryV1(i: NeonSealedInvokeInventoryV1) {
  const p = NEON_INVOKE_PREDECESSOR_V1;
  if (i.state !== "CANDIDATE_READY" || i.predecessorAnchorSha256 !== p.fullAnchorSha256 || i.stableAnchorSha256 !== p.stableAnchorSha256 ||
    i.revisionId !== p.completedRevisionId) fail("NEON_INVOKE_COMPLETED_PRESTATE_DRIFT");
}
function fresh(i: NeonSealedInvokeInventoryV1, now: number) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(i.observedAt) || i.observedAt < 1 || i.observedAt > now || now - i.observedAt > 30000) fail("NEON_INVOKE_INVENTORY_STALE");
}
export async function compileNeonSealedInvokeManifestV1(input: { inventory: NeonSealedInvokeInventoryV1; now: number; codeSha256: string; nonce: string }) {
  matchNeonSealedInvokeInventoryV1(input.inventory); fresh(input.inventory, input.now);
  if (!input.inventory.sourcePermissionsAllowed) fail("NEON_INVOKE_SOURCE_PERMISSION_NOT_VERIFIED");
  const body = { schemaVersion: 1 as const, protocol: "readonly-neon-sealed-invoke-v1" as const, reviewedAt: input.now, expiresAt: input.now + 3600000,
    codeSha256: input.codeSha256, fullAnchorSha256: input.inventory.predecessorAnchorSha256, stableAnchorSha256: input.inventory.stableAnchorSha256,
    completedRevisionId: input.inventory.revisionId, predecessor: NEON_INVOKE_PREDECESSOR_V1,
    event: { schemaVersion: 1 as const, action: NEON_SEALED_PROBE_ACTION_V1 as typeof NEON_SEALED_PROBE_ACTION_V1, nonce: input.nonce }, scope: NEON_SEALED_INVOKE_SCOPE_V1 };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateNeonSealedInvokeManifestV1(m, input.codeSha256); return m;
}
export async function validateNeonSealedInvokeManifestV1(m: NeonSealedInvokeManifestV1, codeSha256: string) {
  const { manifestSha256, ...body } = m;
  if (!equal(Object.keys(m).sort(), ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "fullAnchorSha256", "stableAnchorSha256", "completedRevisionId", "predecessor", "event", "scope", "manifestSha256"].sort()) ||
    m.schemaVersion !== 1 || m.protocol !== "readonly-neon-sealed-invoke-v1" || !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 ||
    !digest.test(codeSha256) || m.codeSha256 !== codeSha256 || !equal(m.predecessor, NEON_INVOKE_PREDECESSOR_V1) || !equal(m.scope, NEON_SEALED_INVOKE_SCOPE_V1) ||
    m.fullAnchorSha256 !== m.predecessor.fullAnchorSha256 || m.stableAnchorSha256 !== m.predecessor.stableAnchorSha256 || m.completedRevisionId !== m.predecessor.completedRevisionId ||
    !digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("NEON_INVOKE_MANIFEST_INVALID");
  validateNeonProbeEventV1(m.event);
}
export interface NeonSealedInvokePortsV1 {
  now(): number; inventory(): Promise<NeonSealedInvokeInventoryV1>; claimSlot(): Promise<void>;
  marker(name: string, value: unknown): Promise<void>; invokeOnce(): Promise<unknown>;
}
export async function runNeonSealedInvokeV1(input: { manifest: NeonSealedInvokeManifestV1; approvedSha: string; codeSha256: string; ports: NeonSealedInvokePortsV1 }) {
  const m = freeze(structuredClone(input.manifest)), p = input.ports; await validateNeonSealedInvokeManifestV1(m, input.codeSha256);
  const approve = () => { const now = p.now(); if (input.approvedSha !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now + 5000 >= m.expiresAt) fail("NEON_INVOKE_FRESH_APPROVAL_REQUIRED"); };
  let stage = "PREFLIGHT", slotConsumed = false, invocationAttempts = 0;
  let response: ReturnType<typeof validateNeonProbeResponseV1> | null = null;
  try {
    approve(); const i = await p.inventory(); matchNeonSealedInvokeInventoryV1(i); fresh(i, p.now());
    if (!i.sourcePermissionsAllowed) fail("NEON_INVOKE_SOURCE_PERMISSION_NOT_VERIFIED");
    approve(); await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    stage = "INVOKE_ONCE"; approve(); await p.marker("invoke-attempt.json", { event: m.event, completedRevisionId: m.completedRevisionId }); approve(); invocationAttempts++;
    response = validateNeonProbeResponseV1(m.event, await p.invokeOnce()); await p.marker("invoke-response.json", response);
    return { outcome: "NEON_INVOKE_SUBMITTED_REQUIRES_INSPECT", slotConsumed, codeUpdates: 0, invocationAttempts, response, failureStage: null, retryAuthorized: false, runtimeEnabled: false };
  } catch (error) {
    return { outcome: "NEON_INVOKE_STOPPED_INSPECT_ONLY", slotConsumed, codeUpdates: 0, invocationAttempts, response, failureStage: stage,
      failureCode: error instanceof Error && /^NEON_(INVOKE|UPDATE|PROBE)_[A-Z_]+$/.test(error.message) ? error.message : "NEON_INVOKE_OPERATION_UNVERIFIED", retryAuthorized: false, runtimeEnabled: false };
  }
}
