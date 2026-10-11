import { canonicalJson, sha256Hex } from "./hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1, readonlyRuntimeIamDocumentsV1 } from "./readonly-runtime-iam-v1.ts";
import { validateReadonlyProbeResponseV1 } from "./readonly-lambda-install-v1.ts";

export const READONLY_KMS_KEY_ARN_V1 = "arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570";
export const READONLY_KMS_KEY_POLICY_SHA_V1 = "7c8b6b20a7a9a74535e08954eb2cf5435f71cd442a39596e1ea60e43dd631b51";
export const READONLY_KMS_REPAIR_SCOPE_V1 = Object.freeze({
  existingBoundaryDefaultVersionsUpdated: 2, existingInlinePoliciesUpdated: 2, maximumIamWrites: 4,
  originalV1PolicyVersionsRetained: true, noVersionDeletionOrAutomaticCleanup: true,
  existingFunctionCodeAndConfigurationsUnchanged: true, maximumNewSynchronousProbes: 2,
  keyArnPinned: READONLY_KMS_KEY_ARN_V1, decryptOnlyThroughSecretsManager: true,
  callerAccountAndOwnSecretArnAndInitialVersionRequired: true,
  directSecretReadFunctionRegionAwscurrentGuardPreserved: true,
  noKeySecretNeonAuthorityCellEcsOrScheduleMutation: true, databaseConnectionAllowed: false,
  roleIdAndPrestateChecksNotServerSideCas: true, iamUpdatesNonAtomicAndPartialPermissionsMayRemain: true,
  propagationWaitSeconds: 20, propagationWaitDoesNotProveAuthorizationReady: true,
  externallyAuthorizedInvocationsCannotBeExcluded: true,
  noAutomaticDeleteFillRollbackResetWriteOrInvokeRetry: true,
  permanentSlot: "techlong-f3b3-readonly-kms-read-repair-v1-consumed", runtimeEnabled: false, monthlyBudgetTargetUsd: 50,
});
const sha = /^[a-f0-9]{64}$/;
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function fail(code: string): never { throw new Error(code); }
function fresh(at: number, now: number) { if (!Number.isSafeInteger(at) || at <= 0 || at > now || now - at > 30_000) fail("KMS_REPAIR_INVENTORY_STALE"); }
export function readonlyKmsRepairDocumentsV1(index: number) {
  const t = READONLY_RUNTIME_IAM_TARGETS_V1[index]; if (!t) fail("KMS_REPAIR_TARGET_INVALID");
  const old = readonlyRuntimeIamDocumentsV1(index), statements: Record<string, unknown>[] = old.identity.Statement.map(s => {
    const copy = structuredClone(s); delete copy.Sid;
    if (s.Sid === "DenyAllOtherActions") copy.NotAction = [...s.NotAction as string[], "kms:Decrypt"];
    if (s.Sid === "DenyOtherOrMissingSourceFunction") { delete copy.Action; copy.NotAction = "kms:Decrypt"; }
    return copy;
  });
  // Sid is a label, not an authorization operand. Merge ONLY identical resource+condition allows.
  if (index === 0) {
    const a = old.identity.Statement.findIndex(s => s.Sid === "Identity"), b = old.identity.Statement.findIndex(s => s.Sid === "ReadAllStackNamesForDependencyChecks");
    if (canonicalJson(statements[a].Condition) !== canonicalJson(statements[b].Condition) || statements[a].Resource !== statements[b].Resource) fail("KMS_REPAIR_COMPACTION_INVALID");
    statements[a].Action = ["sts:GetCallerIdentity", "cloudformation:ListStacks"]; statements.splice(b, 1);
  }
  const conditions = {
    "kms:ViaService": "secretsmanager.ca-central-1.amazonaws.com", "kms:CallerAccount": "402010193138",
    "kms:EncryptionContext:SecretARN": t.secretArn, "kms:EncryptionContext:SecretVersionId": t.secretVersionId,
  };
  statements.push({ Effect: "Deny", Action: "kms:Decrypt", NotResource: READONLY_KMS_KEY_ARN_V1 });
  // Separate denies are OR in effect; multiple keys in a single StringNotEquals would be AND.
  for (const [key, value] of Object.entries(conditions)) statements.push({ Effect: "Deny", Action: "kms:Decrypt", Resource: "*", Condition: { StringNotEquals: { [key]: value } } });
  // CallerAccount is already mandatory via its separate explicit deny, including the missing-key case.
  const allowConditions = { ...conditions } as Record<string, string>; delete allowConditions["kms:CallerAccount"];
  statements.push({ Effect: "Allow", Action: "kms:Decrypt", Resource: READONLY_KMS_KEY_ARN_V1, Condition: { StringEquals: allowConditions } });
  const policy = { Version: "2012-10-17", Statement: statements };
  if (canonicalJson(policy).length > 6144) throw Object.assign(new Error("KMS_REPAIR_BOUNDARY_QUOTA_EXCEEDED"), { policyCharacters: canonicalJson(policy).length });
  return freeze({ trust: old.trust, boundary: policy, identity: structuredClone(policy) });
}
export type KmsRepairStateV1 = { index: number; boundary: "BASE_V1" | "OWN_V2" | "OTHER"; inline: "BASE" | "OWN_REPAIRED" | "OTHER" };
export interface KmsRepairInventoryV1 { observedAt: number; anchorSha256: string; states: KmsRepairStateV1[]; sourcePermissionsAllowed: boolean; }
export interface KmsRepairManifestV1 {
  schemaVersion: 1; protocol: "readonly-kms-read-repair-v1"; reviewedAt: number; expiresAt: number;
  codeSha256: string; anchorSha256: string; predecessorManifestSha256: "e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e";
  predecessorReceiptFileSha256: "020fdb1cbefacc3af98bf344d7c5cad826f388f7149330ad919efc6b9e6a2c2d";
  documents: ReturnType<typeof readonlyKmsRepairDocumentsV1>[];
  events: { schemaVersion: 1; action: "verify_readonly_runtime_v1"; nonce: string }[];
  scope: typeof READONLY_KMS_REPAIR_SCOPE_V1; manifestSha256: string;
}
function shape(r: KmsRepairInventoryV1) { if (!sha.test(r.anchorSha256) || r.states.length !== 2 || r.states.some((s, i) => s.index !== i ||
  !["BASE_V1", "OWN_V2", "OTHER"].includes(s.boundary) || !["BASE", "OWN_REPAIRED", "OTHER"].includes(s.inline))) fail("KMS_REPAIR_INVENTORY_INVALID"); }
function match(r: KmsRepairInventoryV1, m: KmsRepairManifestV1, states: KmsRepairStateV1[]) {
  shape(r); if (r.anchorSha256 !== m.anchorSha256 || canonicalJson(r.states) !== canonicalJson(states)) fail("KMS_REPAIR_STATE_DRIFT_INSPECT_ONLY");
}
export async function compileKmsRepairManifestV1(input: { inventory: KmsRepairInventoryV1; codeSha256: string; now: number; events: KmsRepairManifestV1["events"] }) {
  shape(input.inventory); fresh(input.inventory.observedAt, input.now);
  if (input.inventory.states.some(s => s.boundary !== "BASE_V1" || s.inline !== "BASE") || !input.inventory.sourcePermissionsAllowed) fail("KMS_REPAIR_BASE_OR_SOURCE_NOT_VERIFIED");
  const body = { schemaVersion: 1 as const, protocol: "readonly-kms-read-repair-v1" as const, reviewedAt: input.now, expiresAt: input.now + 3600000,
    codeSha256: input.codeSha256, anchorSha256: input.inventory.anchorSha256,
    predecessorManifestSha256: "e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e" as const,
    predecessorReceiptFileSha256: "020fdb1cbefacc3af98bf344d7c5cad826f388f7149330ad919efc6b9e6a2c2d" as const,
    documents: [readonlyKmsRepairDocumentsV1(0), readonlyKmsRepairDocumentsV1(1)], events: structuredClone(input.events), scope: READONLY_KMS_REPAIR_SCOPE_V1 };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateKmsRepairManifestV1(m, input.codeSha256); return m;
}
export async function validateKmsRepairManifestV1(m: KmsRepairManifestV1, codeSha256: string) {
  const keys = ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "anchorSha256", "predecessorManifestSha256", "predecessorReceiptFileSha256", "documents", "events", "scope", "manifestSha256"];
  if (canonicalJson(Object.keys(m).sort()) !== canonicalJson(keys.sort()) || m.schemaVersion !== 1 || m.protocol !== "readonly-kms-read-repair-v1" ||
    !sha.test(codeSha256) || m.codeSha256 !== codeSha256 || !sha.test(m.anchorSha256) || !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 ||
    m.predecessorManifestSha256 !== "e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e" ||
    m.predecessorReceiptFileSha256 !== "020fdb1cbefacc3af98bf344d7c5cad826f388f7149330ad919efc6b9e6a2c2d" ||
    canonicalJson(m.documents) !== canonicalJson([readonlyKmsRepairDocumentsV1(0), readonlyKmsRepairDocumentsV1(1)]) ||
    canonicalJson(m.scope) !== canonicalJson(READONLY_KMS_REPAIR_SCOPE_V1) || m.events.length !== 2 || m.events[0].nonce === m.events[1].nonce || m.events.some(e =>
      canonicalJson(Object.keys(e).sort()) !== canonicalJson(["action", "nonce", "schemaVersion"]) || e.schemaVersion !== 1 || e.action !== "verify_readonly_runtime_v1" || !sha.test(e.nonce))) fail("KMS_REPAIR_MANIFEST_INVALID");
  const { manifestSha256, ...body } = m; if (!sha.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("KMS_REPAIR_MANIFEST_HASH_INVALID");
}
export interface KmsRepairPortsV1 {
  now(): number; inventory(): Promise<KmsRepairInventoryV1>; claimSlot(): Promise<void>; marker(name: string, value: unknown): Promise<void>;
  createDefaultV2(index: number, document: unknown): Promise<{ versionId?: string; isDefault?: boolean }>;
  putInline(index: number, document: unknown): Promise<void>; waitForPropagation(): Promise<void>; invokeOnce(index: number, event: KmsRepairManifestV1["events"][number]): Promise<unknown>;
}
export async function runKmsReadRepairV1(input: { manifest: KmsRepairManifestV1; approvedSha: string; codeSha256: string; ports: KmsRepairPortsV1 }) {
  const m = freeze(structuredClone(input.manifest)), p = input.ports;
  await validateKmsRepairManifestV1(m, input.codeSha256);
  const approve = () => { const now = p.now(); if (input.approvedSha !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now + 5000 >= m.expiresAt) fail("KMS_REPAIR_FRESH_APPROVAL_REQUIRED"); };
  approve(); let stage = "PREFLIGHT", slotConsumed = false, iamWrites = 0, invocations = 0;
  const receipts: ReturnType<typeof validateReadonlyProbeResponseV1>[] = [];
  const expected: KmsRepairStateV1[] = [0, 1].map(index => ({ index, boundary: "BASE_V1", inline: "BASE" }));
  const inspect = async () => { const r = await p.inventory(); fresh(r.observedAt, p.now()); match(r, m, expected); return r; };
  try {
    const r = await inspect(); if (!r.sourcePermissionsAllowed) fail("KMS_REPAIR_SOURCE_PERMISSION_NOT_VERIFIED"); approve();
    await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    for (let i = 0; i < 2; i++) {
      await inspect(); stage = `boundary-${i}`; approve(); await p.marker(`${stage}-attempt.json`, { manifestSha256: m.manifestSha256 }); approve(); iamWrites++;
      const v = await p.createDefaultV2(i, m.documents[i].boundary);
      if (v.versionId !== "v2" || v.isDefault !== true) fail("KMS_REPAIR_BOUNDARY_RESPONSE_UNCERTAIN"); expected[i].boundary = "OWN_V2";
      await p.marker(`${stage}-confirmed.json`, { versionId: "v2" });
      await inspect(); stage = `inline-${i}`; approve(); await p.marker(`${stage}-attempt.json`, { manifestSha256: m.manifestSha256 }); approve(); iamWrites++;
      await p.putInline(i, m.documents[i].identity); expected[i].inline = "OWN_REPAIRED"; await p.marker(`${stage}-confirmed.json`, { confirmed: true });
    }
    stage = "PROPAGATION_WAIT"; await p.waitForPropagation();
    for (let i = 0; i < 2; i++) {
      await inspect(); stage = `invoke-${i}`; approve(); await p.marker(`${stage}-attempt.json`, { event: m.events[i] }); approve(); invocations++;
      const response = validateReadonlyProbeResponseV1(i, m.events[i], await p.invokeOnce(i, m.events[i])); receipts.push(response); await p.marker(`${stage}-response.json`, response);
    }
    return { outcome: "KMS_REPAIR_AND_TWO_PROBES_SUBMITTED_REQUIRES_INSPECT", slotConsumed, iamWrites, invocations, receipts, failureStage: null, retryAuthorized: false, runtimeEnabled: false };
  } catch (error) {
    return { outcome: "KMS_REPAIR_STOPPED_INSPECT_ONLY", slotConsumed, iamWrites, invocations, receipts, failureStage: stage,
      failureCode: error instanceof Error && /^KMS_REPAIR_[A-Z_]+$/.test(error.message) ? error.message : "KMS_REPAIR_OPERATION_UNVERIFIED", retryAuthorized: false, runtimeEnabled: false };
  }
}
