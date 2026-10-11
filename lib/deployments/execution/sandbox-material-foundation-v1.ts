import { canonicalJson, sha256Hex } from "./hash.ts";
export const MATERIAL_FOUNDATION_SCOPE_V1 = Object.freeze({
  accountId: "402010193138", region: "ca-central-1",
  bucket: "techlong-sandbox-402010193138-ca-central-1-tenant-baselines",
  trustStoreName: "techlong-sandbox-control-v1", maximumWrites: 12,
  serviceLinkedRoleArn: "arn:aws:iam::402010193138:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing",
  sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
  sourceUserId: "AIDAV3GNMXTZEO7SHLC2X", temporarySourceTagPolicyName: "TechlongSandboxControlTrustStoreCreateTagsV1",
  temporaryGrantOnlyExactTrustStoreCreationTags: true, grantExpiresWithApprovalWindow: true,
  immediatelyRevokeTemporaryTagGrantOnSuccessOrFailure: true, revokeExactGrantAllowedAfterApprovalDeadline: true,
  taggingSimulationAllowNotProved: true, controlledLiveCreateAttemptAfterExactGrantReadbackRequiresApproval: true,
  permissionPropagationAndActualCreateSuccessNotGuaranteed: true,
  certificateArn: "arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d",
  archiveSha256: "1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a",
  manifestSha256: "62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971",
  pg16ReceiptSha256: "9b4b2ce704f87c08676a6b7d3f74514296d8d2863c6f25ec59dc5bba57735b27",
  baselineSandboxPublicationApprovedAfterConfirmation: true, baselineRuntimeActivationAuthorized: false,
  ownerEnforced: true, allPublicAccessBlocked: true, encryption: "AES256", conditionalUpload: "If-None-Match:*",
  noVersioningLifecycleReplicationOrAclWrites: true, denyObjectDeleteAndUnconditionalOverwrite: true,
  caIsPublicOnly: true, caAndClientPrivateKeysRemainLocal: true, crlNotInstalled: true,
  noPrivateCaSecretDatabaseCellEcsLambdaOrListenerWrites: true,
  serviceLinkedRoleHasAwsManagedPermissionsAndNoCustomBoundary: true,
  nonAtomicAndNoServiceSidePrestateCas: true, partialFailureMayLeaveResourcesAndPermissions: true,
  noAutomaticResourceDeleteRollbackFillResetOrWriteRetry: true, serviceLinkedRoleIsNotAutomaticallyRevoked: true,
  permanentSlot: "techlong-f3c2-sandbox-material-foundation-v1-consumed", monthlyBudgetTargetUsd: 50,
});
export const MATERIAL_STEPS_V1 = Object.freeze(["create-elb-role", "create-bucket", "set-public-block", "set-encryption", "set-tags", "set-policy", "upload-archive", "upload-manifest", "upload-ca", "create-truststore"] as const);
export type MaterialStepV1 = typeof MATERIAL_STEPS_V1[number];
export interface MaterialPinsV1 { caSha256: string; caBytes: number; clientCertificateSha256: string; materialReceiptSha256: string; archiveBytes: number; manifestBytes: number; }
export interface MaterialInventoryV1 { observedAt: number; anchorSha256: string; absent: boolean; managementPermissionsAllowed: boolean; prerequisitesVerified: boolean; }
export interface MaterialManifestV1 { schemaVersion: 1; protocol: "sandbox-material-foundation-v1"; reviewedAt: number; expiresAt: number; codeSha256: string; anchorSha256: string; scope: typeof MATERIAL_FOUNDATION_SCOPE_V1; material: MaterialPinsV1; manifestSha256: string; }
const digest = /^[a-f0-9]{64}$/, equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const exact = (v: unknown, keys: string[]) => !!v && typeof v === "object" && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort());
function fail(code: string): never { throw Error(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function assertMaterialPinsV1(p: MaterialPinsV1) {
  if (!exact(p, ["caSha256", "caBytes", "clientCertificateSha256", "materialReceiptSha256", "archiveBytes", "manifestBytes"]) ||
    ![p.caSha256, p.clientCertificateSha256, p.materialReceiptSha256].every(s => digest.test(s)) ||
    ![p.caBytes, p.archiveBytes, p.manifestBytes].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1048576)) fail("MATERIAL_FOUNDATION_PINS_INVALID");
}
function fresh(i: MaterialInventoryV1, now: number) { if (!Number.isSafeInteger(i.observedAt) || i.observedAt <= 0 || i.observedAt > now || now - i.observedAt > 30000 || !digest.test(i.anchorSha256) || !i.prerequisitesVerified) fail("MATERIAL_FOUNDATION_INVENTORY_UNVERIFIED"); }
export async function compileMaterialManifestV1(i: MaterialInventoryV1, p: MaterialPinsV1, now: number, codeSha256: string) {
  fresh(i, now); assertMaterialPinsV1(p); if (!i.absent || !i.managementPermissionsAllowed) fail("MATERIAL_FOUNDATION_PRESTATE_OR_PERMISSION_UNVERIFIED");
  const body = { schemaVersion: 1 as const, protocol: "sandbox-material-foundation-v1" as const, reviewedAt: now, expiresAt: now + 3600000, codeSha256, anchorSha256: i.anchorSha256, scope: MATERIAL_FOUNDATION_SCOPE_V1, material: p };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateMaterialManifestV1(m, codeSha256); return m;
}
export async function validateMaterialManifestV1(m: MaterialManifestV1, code: string) {
  if (!exact(m, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "anchorSha256", "scope", "material", "manifestSha256"]) || m.schemaVersion !== 1 || m.protocol !== "sandbox-material-foundation-v1" ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 || !digest.test(code) || code !== m.codeSha256 || !digest.test(m.anchorSha256) || !equal(m.scope, MATERIAL_FOUNDATION_SCOPE_V1)) fail("MATERIAL_FOUNDATION_MANIFEST_INVALID");
  assertMaterialPinsV1(m.material); const { manifestSha256, ...body } = m; if (!digest.test(manifestSha256) || manifestSha256 !== await sha256Hex(body)) fail("MATERIAL_FOUNDATION_MANIFEST_HASH_INVALID");
}
export function materialObjectsV1(p: MaterialPinsV1) { assertMaterialPinsV1(p); const s = MATERIAL_FOUNDATION_SCOPE_V1; return freeze([
  { kind: "archive", key: `approved/${s.archiveSha256}/baseline.dump`, sha256: s.archiveSha256, bytes: p.archiveBytes },
  { kind: "manifest", key: `approved/${s.manifestSha256}/baseline.manifest.json`, sha256: s.manifestSha256, bytes: p.manifestBytes },
  { kind: "ca", key: `mtls/sha256/${p.caSha256}/ca-bundle.pem`, sha256: p.caSha256, bytes: p.caBytes },
]); }
export function materialTagsV1(m: MaterialManifestV1) { return [{ Key: "Project", Value: "Techlong" }, { Key: "Environment", Value: "aws-sandbox" }, { Key: "Purpose", Value: "sandbox-material-foundation-v1" }, { Key: "ApprovalSha256", Value: m.manifestSha256 }, { Key: "CaSha256", Value: m.material.caSha256 }]; }
export function materialTaggingPolicyV1(p: MaterialPinsV1, approvalSha: string, reviewedAt: number, expiresAt: number) {
  assertMaterialPinsV1(p); if (!digest.test(approvalSha) || !Number.isSafeInteger(reviewedAt) || expiresAt - reviewedAt !== 3600000) fail("MATERIAL_FOUNDATION_TAG_POLICY_INVALID");
  const s = MATERIAL_FOUNDATION_SCOPE_V1;
  return { Version: "2012-10-17", Statement: [{ Sid: "ExactTrustStoreTagsOnCreateOnly", Effect: "Allow", Action: "elasticloadbalancing:AddTags",
    Resource: `arn:aws:elasticloadbalancing:${s.region}:${s.accountId}:truststore/${s.trustStoreName}/*`,
    Condition: { StringEquals: { "aws:RequestedRegion": s.region, "elasticloadbalancing:CreateAction": "CreateTrustStore",
      "aws:RequestTag/Project": "Techlong", "aws:RequestTag/Environment": "aws-sandbox", "aws:RequestTag/Purpose": "sandbox-material-foundation-v1", "aws:RequestTag/ApprovalSha256": approvalSha, "aws:RequestTag/CaSha256": p.caSha256 },
      "ForAllValues:StringEquals": { "aws:TagKeys": ["Project", "Environment", "Purpose", "ApprovalSha256", "CaSha256"] }, Null: { "aws:TagKeys": "false" },
      DateGreaterThanEquals: { "aws:CurrentTime": new Date(reviewedAt).toISOString() }, DateLessThan: { "aws:CurrentTime": new Date(expiresAt).toISOString() } } }] };
}
export function materialBucketPolicyV1() {
  const arn = `arn:aws:s3:::${MATERIAL_FOUNDATION_SCOPE_V1.bucket}`;
  return { Version: "2012-10-17", Statement: [
    { Sid: "DenyInsecureTransport", Effect: "Deny", Principal: "*", Action: "s3:*", Resource: [arn, `${arn}/*`], Condition: { Bool: { "aws:SecureTransport": "false" } } },
    { Sid: "DenyUnconditionalPut", Effect: "Deny", Principal: "*", Action: "s3:PutObject", Resource: `${arn}/*`, Condition: { StringNotEquals: { "s3:if-none-match": "*" } } },
    { Sid: "DenyObjectDeletion", Effect: "Deny", Principal: "*", Action: ["s3:DeleteObject", "s3:DeleteObjectVersion"], Resource: `${arn}/*` },
    { Sid: "DenyLifecycleReplicationAndVersioning", Effect: "Deny", Principal: "*", Action: ["s3:PutLifecycleConfiguration", "s3:PutReplicationConfiguration", "s3:PutBucketVersioning"], Resource: arn },
  ] };
}
export interface MaterialPortsV1 {
  now(): number; inventory(permissions: boolean): Promise<MaterialInventoryV1>; verifyMaterial(p: MaterialPinsV1): Promise<void>;
  claimSlot(): Promise<void>; marker(name: string, value: unknown): Promise<void>;
  assertProgress(m: MaterialManifestV1, completed: readonly MaterialStepV1[]): Promise<void>;
  writeOnce(m: MaterialManifestV1, step: MaterialStepV1): Promise<unknown>;
  writeTagGrantOnce(m: MaterialManifestV1): Promise<void>;
  assertTagGrantBound(m: MaterialManifestV1): Promise<void>;
  tagGrantState(m: MaterialManifestV1): Promise<"absent" | "exact">;
  revokeTagGrantOnce(m: MaterialManifestV1): Promise<void>;
}
export async function runMaterialFoundationV1(raw: MaterialManifestV1, approvedSha: string, code: string, p: MaterialPortsV1) {
  const m = freeze(structuredClone(raw)); await validateMaterialManifestV1(m, code);
  const approve = () => { const n = p.now(); if (approvedSha !== m.manifestSha256 || !Number.isSafeInteger(n) || n < m.reviewedAt || n + 5000 >= m.expiresAt) fail("MATERIAL_FOUNDATION_FRESH_APPROVAL_REQUIRED"); };
  let stage = "PREFLIGHT", slotConsumed = false, writeAttempts = 0, grantAttempted = false, temporaryTagGrantRevoked = false;
  let failureStage: string | null = null, failureCode: string | null = null, revokeFailureCode: string | null = null; const completed: MaterialStepV1[] = [];
  try {
    approve(); await p.verifyMaterial(m.material); const i = await p.inventory(true); fresh(i, p.now());
    if (!i.absent || !i.managementPermissionsAllowed || i.anchorSha256 !== m.anchorSha256) fail("MATERIAL_FOUNDATION_PRESTATE_DRIFT");
    approve(); await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    stage = "TEMPORARY_TAG_GRANT"; approve(); await p.marker("tag-grant-attempt.json", { approvedSha }); approve();
    grantAttempted = true; writeAttempts++; await p.writeTagGrantOnce(m); await p.marker("tag-grant-confirmed.json", { approvedSha }); await p.assertTagGrantBound(m);
    for (const step of MATERIAL_STEPS_V1) {
      stage = step; approve(); await p.verifyMaterial(m.material); if (await p.tagGrantState(m) !== "exact") fail("MATERIAL_FOUNDATION_TAG_GRANT_DRIFT"); await p.assertProgress(m, completed); approve();
      await p.marker(`${step}-attempt.json`, { approvedSha, completed: [...completed] }); approve(); writeAttempts++;
      const response = await p.writeOnce(m, step); await p.marker(`${step}-confirmed.json`, { response }); completed.push(step);
    }
  } catch (e) { failureStage = stage; failureCode = e instanceof Error && /^MATERIAL_FOUNDATION_[A-Z_]+$/.test(e.message) ? e.message : "MATERIAL_FOUNDATION_RESULT_UNVERIFIED"; }
  finally {
    if (grantAttempted) { try {
      // This is the separately approved exact cleanup, not a resource rollback.
      // A changed/foreign policy is never deleted; there is no IAM CAS.
      if (await p.tagGrantState(m) === "exact") { await p.marker("tag-revoke-attempt.json", { approvedSha }); writeAttempts++; await p.revokeTagGrantOnce(m); }
      if (await p.tagGrantState(m) !== "absent") fail("MATERIAL_FOUNDATION_TAG_REVOKE_UNVERIFIED");
      temporaryTagGrantRevoked = true; await p.marker("tag-revoke-confirmed.json", { approvedSha, absent: true });
    } catch (e) { revokeFailureCode = e instanceof Error && /^MATERIAL_FOUNDATION_[A-Z_]+$/.test(e.message) ? e.message : "MATERIAL_FOUNDATION_TAG_REVOKE_UNVERIFIED"; } }
  }
  return { outcome: failureStage || revokeFailureCode ? "MATERIAL_FOUNDATION_STOPPED_INSPECT_ONLY" : "MATERIAL_FOUNDATION_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, writeAttempts, completed,
    failureStage, failureCode, revokeFailureCode, temporaryTagGrantRevoked, grantExpiresAt: new Date(m.expiresAt).toISOString(), runtimeEnabled: false, paidCellCreated: false, retryAuthorized: false };
}
