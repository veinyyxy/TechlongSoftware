import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellStackEvidenceV3, assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { AwsSdkCellParentInstallationReaderV4, assertCellParentInstallationV4 } from "./aws-sdk-cell-birth-parent-installation-v4.ts";
import { NeonCellParentDatabaseV4, assertCellParentOpenDatabaseV4, type CellParentOpenDatabaseV4 } from "./neon-cell-parent-control-v4.ts";
import { CELL_PARENT_KEY_V4 as parentKey, CELL_PARENT_WORKFLOW_KEYS_V4, prepareCellBirthParentReviewV4, decodeCellBirthParentRecordV4,
  type CellBirthParentReviewV4, type CellParentRuntimeBindingV4, type CellBirthParentRecordV4 } from "./cell-birth-parent-v4.ts";
import { type CellParentRegistrySdkV4 } from "./aws-sdk-cell-birth-parent-v4.ts";
import { type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { type CellBirthDelegationV3 } from "./cell-birth-lifecycle-v3.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 } from "./failed-cell-birth-ddb-v1.ts";
import { CELL_BIRTH_REGISTRATION_KEY_V3 } from "./cell-birth-registration-v3.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 as certificateSha } from "./sealed-cell-cleanup-lambda-context-v3.ts";

export const CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4 = "cell-birth-v4:registration-attempt:cell:cell-sandbox-1";
export const CELL_PARENT_REGISTRATION_EXCLUSIONS_V4 = Object.freeze([parentKey, ...Object.values(FAILED_BIRTH_DDB_KEYS_V1),
  ...Object.values(CELL_PARENT_WORKFLOW_KEYS_V4), CELL_BIRTH_REGISTRATION_KEY_V3]);
export interface CellParentSourceRegistrationReviewV4 {
  schemaVersion: 4; protocol: "cell-parent-source-registration-review-v4"; parentReview: CellBirthParentReviewV4;
  databaseStateSha256: string; certificateSha256: string; codeBindingSha256: string; attemptKey: string;
  exclusions: readonly string[]; reviewedAt: number; expiresAt: number;
  scope: { sourceTransactionsMaximum: 2; parentRegistrationOnly: true; secretReadsByRegistrar: false; databaseWrites: false; installIamOrPolicyOrFunction: false; invokeOrDeployCell: false };
  risks: { localAndCloudPermanentSlots: true; sourceWindowHasBroadDataWrites: true; metadataIsNotEffectivePermissionProof: true; crossServiceNonAtomic: true; noAutomaticRetryOrReset: true; registrationDelegatesInlineCleanup: true; nonzeroCost: true };
  manifestSha256: string;
}
const scope = Object.freeze({ sourceTransactionsMaximum: 2 as const, parentRegistrationOnly: true as const, secretReadsByRegistrar: false as const,
  databaseWrites: false as const, installIamOrPolicyOrFunction: false as const, invokeOrDeployCell: false as const });
const risks = Object.freeze({ localAndCloudPermanentSlots: true as const, sourceWindowHasBroadDataWrites: true as const, metadataIsNotEffectivePermissionProof: true as const,
  crossServiceNonAtomic: true as const, noAutomaticRetryOrReset: true as const, registrationDelegatesInlineCleanup: true as const, nonzeroCost: true as const });
const hash = /^[a-f0-9]{64}$/, localOwners = new WeakSet<object>(), used = new WeakSet<object>();
function window(review: CellParentSourceRegistrationReviewV4, now: number) { cellV3Clock(now); if (now < review.reviewedAt || now >= review.expiresAt) cellV3Fail("CELL_PARENT_SOURCE_REGISTRATION_EXPIRED"); }
async function parentRecord(review: CellBirthParentReviewV4, at: number): Promise<Readonly<CellBirthParentRecordV4>> {
  const body = { schemaVersion: 4 as const, protocol: "approved-cell-birth-full-parent-v4" as const, manifest: review.manifest, approvedManifestSha256: review.manifestSha256, approvedAt: at };
  return decodeCellBirthParentRecordV4({ ...body, parentSha256: await sha256Hex(body) });
}
/** Cold JSON decoding does not mint an installed runtime brand or borrow the
 * old WeakSet review. It validates the EXACT approved data, then registration
 * must independently recollect real Source/metadata/RESERVED/limited DB proof. */
export async function decodeCellParentSourceRegistrationReviewV4(raw: unknown): Promise<Readonly<CellParentSourceRegistrationReviewV4>> {
  const r = raw as CellParentSourceRegistrationReviewV4;
  if (!cellV3Exact(r, ["schemaVersion", "protocol", "parentReview", "databaseStateSha256", "certificateSha256", "codeBindingSha256", "attemptKey", "exclusions", "reviewedAt", "expiresAt", "scope", "risks", "manifestSha256"]) ||
    r.schemaVersion !== 4 || r.protocol !== "cell-parent-source-registration-review-v4" || r.attemptKey !== CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4 ||
    canonicalJson(r.exclusions) !== canonicalJson(CELL_PARENT_REGISTRATION_EXCLUSIONS_V4) || canonicalJson(r.scope) !== canonicalJson(scope) || canonicalJson(r.risks) !== canonicalJson(risks) ||
    [r.databaseStateSha256, r.codeBindingSha256, r.manifestSha256].some(h => !hash.test(h)) || r.certificateSha256 !== certificateSha) cellV3Fail("CELL_PARENT_SOURCE_REVIEW_SCOPE_INVALID");
  const p = r.parentReview;
  if (!cellV3Exact(p, ["manifest", "manifestSha256", "registrationAuthorized", "runtimeEnabled"]) || p.registrationAuthorized !== false || p.runtimeEnabled !== false) cellV3Fail("CELL_PARENT_SOURCE_REVIEW_DATA_INVALID");
  const validatedParent = await parentRecord(p, p.manifest.reviewedAt); [r.reviewedAt, r.expiresAt].forEach(cellV3Clock);
  if (r.reviewedAt !== p.manifest.reviewedAt || r.expiresAt !== p.manifest.expiresAt || await sha256Hex(p.manifest) !== p.manifestSha256) cellV3Fail("CELL_PARENT_SOURCE_REVIEW_TIME_INVALID");
  const { manifestSha256, ...body } = r; if (await sha256Hex(body) !== manifestSha256) cellV3Fail("CELL_PARENT_SOURCE_REVIEW_HASH_INVALID");
  // The existing strict decoder re-renders the canonical plan and mints its
  // real plan brand. Do not discard that brand with a final JSON/structured copy.
  return cellV3Freeze({ ...structuredClone(r), parentReview: { ...p, manifest: validatedParent.manifest } });
}
function checkReserved(stack: CellStackSnapshotV3, review: CellBirthParentReviewV4, now: number) {
  assertCellStackSnapshotV3(stack); const p = review.manifest.plan, d = review.manifest.delegation;
  if (stack.profile !== "source_inspection" || stack.phase !== "RESERVED" || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.stackStatus) || stack.resources.length || stack.failedCreationOrPhase ||
    stack.stackId !== d.stackId || stack.birthIntentSha256 !== p.birthIntentSha256 || stack.templateCanonicalSha256 !== p.templateCanonicalSha256 || stack.observedAt > now || now - stack.observedAt > 30000) cellV3Fail("CELL_PARENT_SOURCE_LIVE_RESERVED_REQUIRED");
}
function checkDatabase(db: CellParentOpenDatabaseV4, review: CellBirthParentReviewV4, now: number) {
  assertCellParentOpenDatabaseV4(db, now, true);
  if (db.protectionSha256 !== review.manifest.failedProtectionSha256 || db.certificateSha256 !== certificateSha) cellV3Fail("CELL_PARENT_SOURCE_REAL_DATABASE_PROTECTION_REQUIRED");
}
const absent = (authority_key: string) => ({ TableName: table, Key: { authority_key }, ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" });
const put = (authority_key: string, value: unknown) => { const { Key: _key, ...c } = absent(authority_key); void _key; const record_json = canonicalJson(value);
  if (Buffer.byteLength(record_json) > 131072) cellV3Fail("CELL_PARENT_SOURCE_RECORD_SIZE_INVALID"); return { ...c, Item: { authority_key, schema_version: 4, record_json } }; };
/** Trusted durable local attempt capability: the CLI adapter must create its
 * single fixed file with wx+flush; a new process may not replace or remove it. */
export interface CellParentRegistrationAttemptStoreV4 { claimOnce(approvalSha256: string): Promise<boolean> }
export class AwsSdkCellParentSourceRegistrarV4 {
  private readonly sdk: CellParentRegistrySdkV4; private readonly installation: AwsSdkCellParentInstallationReaderV4; private readonly stack: AwsSdkCellStackEvidenceV3;
  private readonly db: NeonCellParentDatabaseV4; private readonly attempt: CellParentRegistrationAttemptStoreV4; private readonly now: () => number;
  constructor(input: { sdk: CellParentRegistrySdkV4; installation: AwsSdkCellParentInstallationReaderV4; stack: AwsSdkCellStackEvidenceV3; database: NeonCellParentDatabaseV4; attempt: CellParentRegistrationAttemptStoreV4; now?: () => number }) {
    if (!(input.installation instanceof AwsSdkCellParentInstallationReaderV4) || !(input.stack instanceof AwsSdkCellStackEvidenceV3) || !(input.database instanceof NeonCellParentDatabaseV4) || typeof input.attempt?.claimOnce !== "function") cellV3Fail("CELL_PARENT_SOURCE_CAPABILITIES_INVALID");
    this.sdk = Object.freeze({ sts: Object.freeze({ send: input.sdk.sts.send.bind(input.sdk.sts) }), ddb: Object.freeze({ send: input.sdk.ddb.send.bind(input.sdk.ddb) }), commands: Object.freeze({ ...input.sdk.commands }) });
    this.installation = input.installation; this.stack = input.stack; this.db = input.database; this.attempt = Object.freeze({ claimOnce: input.attempt.claimOnce.bind(input.attempt) }); this.now = input.now ?? Date.now;
  }
  private async identity(signal: AbortSignal) { signal.throwIfAborted(); const r = await this.sdk.sts.send(new this.sdk.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
    if (r.Account !== "402010193138" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") cellV3Fail("CELL_PARENT_SOURCE_EXACT_IDENTITY_REQUIRED"); }
  private async exclusions(signal: AbortSignal, attempt: unknown = null) {
    await this.identity(signal); const keys = [...CELL_PARENT_REGISTRATION_EXCLUSIONS_V4, CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4], r = await this.sdk.ddb.send(new this.sdk.commands.transactGet({
      TransactItems: keys.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) }), { abortSignal: signal }); signal.throwIfAborted();
    const list = r.Responses as { Item?: unknown }[];
    if (!Array.isArray(list) || list.length !== keys.length || list.some(x => !x || !cellV3Exact(x, x.Item === undefined ? [] : ["Item"])) || list.slice(0, -1).some(x => x.Item !== undefined) ||
      canonicalJson(list.at(-1)?.Item ?? null) !== canonicalJson(attempt)) cellV3Fail("CELL_PARENT_SOURCE_PERMANENT_SLOT_OR_EXCLUSION_OCCUPIED"); await this.identity(signal);
  }
  private async live(review: CellBirthParentReviewV4, signal: AbortSignal) {
    const m = review.manifest, installation = await this.installation.read(m.runtimeBinding, m.delegation.stackId, signal);
    const stack = await this.stack.read(m.plan, m.delegation.stackId, signal); if (!("protocol" in stack)) cellV3Fail("CELL_PARENT_SOURCE_RESERVED_MISSING");
    const db = await this.db.readOpen(signal, true), now = cellV3Clock(this.now());
    assertCellParentInstallationV4(installation, now); if (installation.profile !== "source_inspection") cellV3Fail("CELL_PARENT_SOURCE_INSTALLATION_PROFILE_REQUIRED");
    checkReserved(stack, review, now); checkDatabase(db, review, now); return { installation, stack, db };
  }
  async review(input: { plan: CellStackPlanV3; delegation: CellBirthDelegationV3; binding: CellParentRuntimeBindingV4; failedProtectionSha256: string; codeBindingSha256: string; signal: AbortSignal }) {
    if (!hash.test(input.codeBindingSha256)) cellV3Fail("CELL_PARENT_SOURCE_CODE_BINDING_REQUIRED"); await this.identity(input.signal); await this.exclusions(input.signal);
    const installation = await this.installation.read(input.binding, input.delegation.stackId, input.signal), reserved = await this.stack.read(input.plan, input.delegation.stackId, input.signal);
    if (!("protocol" in reserved)) cellV3Fail("CELL_PARENT_SOURCE_RESERVED_MISSING"); const db = await this.db.readOpen(input.signal, true), now = cellV3Clock(this.now());
    const parentReview = await prepareCellBirthParentReviewV4({ plan: input.plan, delegation: input.delegation, reserved, installation, failedProtectionSha256: input.failedProtectionSha256, now });
    checkDatabase(db, parentReview, now); await this.exclusions(input.signal);
    const body = { schemaVersion: 4 as const, protocol: "cell-parent-source-registration-review-v4" as const, parentReview, databaseStateSha256: db.stateSha256, certificateSha256: db.certificateSha256,
      codeBindingSha256: input.codeBindingSha256, attemptKey: CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4, exclusions: CELL_PARENT_REGISTRATION_EXCLUSIONS_V4,
      reviewedAt: now, expiresAt: parentReview.manifest.expiresAt, scope, risks };
    return decodeCellParentSourceRegistrationReviewV4({ ...body, manifestSha256: await sha256Hex(body) });
  }
  async installOnce(input: { review: unknown; approvedManifestSha256: string; currentCodeBindingSha256: string; signal: AbortSignal }) {
    const review = await decodeCellParentSourceRegistrationReviewV4(input.review), signal = input.signal;
    if (input.approvedManifestSha256 !== review.manifestSha256 || input.currentCodeBindingSha256 !== review.codeBindingSha256) cellV3Fail("CELL_PARENT_SOURCE_EXACT_COLD_APPROVAL_REQUIRED");
    window(review, this.now()); await this.identity(signal); await this.exclusions(signal); let live = await this.live(review.parentReview, signal);
    if (live.db.stateSha256 !== review.databaseStateSha256) cellV3Fail("CELL_PARENT_SOURCE_DATABASE_PRESTATE_DRIFT"); window(review, this.now()); await this.exclusions(signal);
    const record = await parentRecord(review.parentReview, cellV3Clock(this.now()));
    if (!await this.attempt.claimOnce(review.manifestSha256)) return { outcome: "LOCAL_REGISTRATION_SLOT_OCCUPIED_INSPECT_ONLY", writesAttempted: 0, retryAuthorized: false };
    const attempt = cellV3Freeze({ schemaVersion: 4, protocol: "cell-parent-source-permanent-attempt-v4", approvedManifestSha256: review.manifestSha256, parentSha256: record.parentSha256, attemptedAt: cellV3Clock(this.now()) }), item = put(CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4, attempt).Item;
    window(review, this.now()); await this.identity(signal); window(review, this.now()); signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(), TransactItems: [
      ...CELL_PARENT_REGISTRATION_EXCLUSIONS_V4.map(k => ({ ConditionCheck: absent(k) })), { Put: put(CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4, attempt) },
    ] }), { abortSignal: signal }); signal.throwIfAborted(); }
    catch { return { outcome: "REGISTRATION_ATTEMPT_UNCERTAIN_INSPECT_ONLY", writesAttempted: 1, retryAuthorized: false }; }
    const owner = {}; localOwners.add(owner);
    // Never mint ownership from a read of the attempt item, including same-token
    // successful replay or another process. All proofs are recollected here.
    await this.exclusions(signal, item); live = await this.live(review.parentReview, signal); window(review, this.now());
    if (live.db.stateSha256 !== review.databaseStateSha256) cellV3Fail("CELL_PARENT_SOURCE_DATABASE_PREWRITE_DRIFT"); await this.exclusions(signal, item);
    assertCellParentInstallationV4(live.installation, this.now()); checkReserved(live.stack, review.parentReview, this.now()); checkDatabase(live.db, review.parentReview, this.now());
    if (!localOwners.has(owner) || used.has(owner)) cellV3Fail("CELL_PARENT_SOURCE_PRIVATE_ONCE_OWNERSHIP_REQUIRED"); used.add(owner); window(review, this.now()); signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(), TransactItems: [
      ...CELL_PARENT_REGISTRATION_EXCLUSIONS_V4.filter(k => k !== parentKey).map(k => ({ ConditionCheck: absent(k) })),
      { ConditionCheck: { TableName: table, Key: { authority_key: CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4 }, ConditionExpression: "#schema = :schema AND #json = :json",
        ExpressionAttributeNames: { "#schema": "schema_version", "#json": "record_json" }, ExpressionAttributeValues: { ":schema": 4, ":json": canonicalJson(attempt) }, ReturnValuesOnConditionCheckFailure: "NONE" } },
      { Put: put(parentKey, record) },
    ] }), { abortSignal: signal }); signal.throwIfAborted(); return { outcome: "PARENT_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", parentSha256: record.parentSha256, writesAttempted: 2, retryAuthorized: false }; }
    catch { return { outcome: "PARENT_SUBMISSION_UNCERTAIN_INSPECT_ONLY", parentSha256: record.parentSha256, writesAttempted: 2, retryAuthorized: false }; }
  }
}
