import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_V3_CFN_ROLE, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { decodeFailedCellBirthFenceV1 } from "./failed-cell-birth-fence-v1.ts";
import { assertCertifiedFailedCellBirthSnapshotV1, type CertifiedFailedCellBirthSnapshotV1 } from "./neon-failed-cell-birth-source-v1.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY } from "./shared-cell-cleanup-authority.ts";
import { preparedLifecycleActivationKey } from "./tenant-lifecycle-prepared-contract.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";

export const FAILED_BIRTH_DDB_KEYS_V1 = Object.freeze({
  marker: "cell-birth-v3:failed-unadmitted:cell:cell-sandbox-1",
  intent: "cell-birth-v3:failed-compensation-intent:cell:cell-sandbox-1",
  receipt: "cell-birth-v3:failed-compensation-receipt:cell:cell-sandbox-1",
  provision: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  activation: preparedLifecycleActivationKey,
});
const digest = /^[a-f0-9]{64}$/, approvals = new WeakSet<object>();
export function assertFailedBirthCurrentPairV1(plan: CellStackPlanV3, failure: CellStackSnapshotV3, zero: CertifiedFailedCellBirthSnapshotV1, now: number) {
  assertCellStackPlanV3(plan); assertCellStackSnapshotV3(failure); assertCertifiedFailedCellBirthSnapshotV1(zero, now); cellV3Clock(now);
  const i = zero.intent;
  if (!failure.failedCreationOrPhase || failure.completePaidStack || failure.observedAt > now || now - failure.observedAt > 30000 ||
    plan.birthIntentSha256 !== i.birthIntentSha256 || plan.planSha256 !== i.planSha256 || plan.templateCanonicalSha256 !== i.templateCanonicalSha256 ||
    plan.intent.input.ownerDeploymentId !== i.ownerDeploymentId || plan.intent.input.generation !== i.generation || plan.intent.input.provisionEpoch !== i.provisionEpoch ||
    Date.parse(plan.intent.cellExpiresAt) !== i.cellExpiresAt || failure.stackId !== i.stackId || failure.birthIntentSha256 !== i.birthIntentSha256 ||
    failure.templateCanonicalSha256 !== i.templateCanonicalSha256 || failure.resourceInventorySha256 !== i.failureInventorySha256 ||
    failure.phase !== i.failedPhase || failure.stackStatus !== i.failedStackStatus) cellV3Fail("FAILED_BIRTH_CURRENT_PAIR_DRIFT");
}

/** A separate, narrow Source review. The old drain-only registration is not an
 * approval for this marker, the journal or DeleteStack. */
export async function prepareFailedBirthDdbMarkerV1(input: { plan: CellStackPlanV3; failure: CellStackSnapshotV3; zero: CertifiedFailedCellBirthSnapshotV1; now: number }) {
  if (!cellV3Exact(input, ["plan", "failure", "zero", "now"])) cellV3Fail("FAILED_BIRTH_MARKER_INPUT_INVALID");
  assertFailedBirthCurrentPairV1(input.plan, input.failure, input.zero, input.now);
  const z = input.zero;
  const body = { schemaVersion: 1 as const, protocol: "failed-cell-birth-ddb-exclusion-v1" as const, intent: z.intent, fenceSha256: z.fenceSha256,
    certificateSha256: await sha256Hex(z.certificate), protectionSha256: z.protectionSha256, zeroStateSha256: z.stateSha256,
    databaseObservedAt: z.dbObservedAt, failureObservedAt: input.failure.observedAt, reviewedAt: input.now, expiresAt: input.now + 900000,
    scope: { installExclusionMarkerOnly: true as const, cloudDeletionAuthorized: false as const, runtimeActivationAuthorized: false as const,
      legacyPublisherIsolationProved: false as const, resetReplaceOrRetryAuthorized: false as const } };
  return cellV3Freeze({ ...body, markerSha256: await sha256Hex(body) });
}
export type FailedBirthDdbMarkerV1 = Awaited<ReturnType<typeof prepareFailedBirthDdbMarkerV1>>;
export async function decodeFailedBirthDdbMarkerV1(raw: unknown): Promise<Readonly<FailedBirthDdbMarkerV1>> {
  const v = raw as FailedBirthDdbMarkerV1;
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "intent", "fenceSha256", "certificateSha256", "protectionSha256", "zeroStateSha256", "databaseObservedAt",
    "failureObservedAt", "reviewedAt", "expiresAt", "scope", "markerSha256"]) || v.schemaVersion !== 1 || v.protocol !== "failed-cell-birth-ddb-exclusion-v1" ||
    [v.fenceSha256, v.certificateSha256, v.protectionSha256, v.zeroStateSha256, v.markerSha256].some(s => typeof s !== "string" || !digest.test(s)) ||
    canonicalJson(v.scope) !== canonicalJson({ installExclusionMarkerOnly: true, cloudDeletionAuthorized: false, runtimeActivationAuthorized: false,
      legacyPublisherIsolationProved: false, resetReplaceOrRetryAuthorized: false })) cellV3Fail("FAILED_BIRTH_MARKER_RECORD_INVALID");
  for (const n of [v.databaseObservedAt, v.failureObservedAt, v.reviewedAt, v.expiresAt]) cellV3Clock(n);
  if (v.expiresAt !== v.reviewedAt + 900000 || v.databaseObservedAt > v.reviewedAt || v.failureObservedAt > v.reviewedAt ||
    v.reviewedAt - v.databaseObservedAt > 30000 || v.reviewedAt - v.failureObservedAt > 30000) cellV3Fail("FAILED_BIRTH_MARKER_REVIEW_TIME_INVALID");
  await decodeFailedCellBirthFenceV1(v.intent, v.fenceSha256);
  const { markerSha256, ...body } = v; if (await sha256Hex(body) !== markerSha256) cellV3Fail("FAILED_BIRTH_MARKER_HASH_INVALID");
  return cellV3Freeze(structuredClone(v));
}
export async function approveFailedBirthDdbMarkerV1(input: { marker: FailedBirthDdbMarkerV1; approvedMarkerSha256: string; now: number }) {
  if (!cellV3Exact(input, ["marker", "approvedMarkerSha256", "now"])) cellV3Fail("FAILED_BIRTH_MARKER_APPROVAL_INPUT_INVALID");
  const marker = await decodeFailedBirthDdbMarkerV1(input.marker); cellV3Clock(input.now);
  if (input.approvedMarkerSha256 !== marker.markerSha256 || input.now < marker.reviewedAt || input.now >= marker.expiresAt) cellV3Fail("FAILED_BIRTH_MARKER_APPROVAL_INVALID");
  const a = cellV3Freeze({ marker, approvedAt: input.now }); approvals.add(a); return a;
}
export type FailedBirthDdbApprovalV1 = Awaited<ReturnType<typeof approveFailedBirthDdbMarkerV1>>;
export function assertFailedBirthDdbApprovalV1(v: FailedBirthDdbApprovalV1, now: number) {
  cellV3Clock(now); if (!approvals.has(v) || now < v.approvedAt || now >= v.marker.expiresAt) cellV3Fail("FAILED_BIRTH_MARKER_APPROVAL_PROVENANCE_OR_TIME_INVALID");
}
export function failedBirthAbsentConditionV1(key: string) { return { TableName: table, Key: { authority_key: key },
  ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" }; }
export function failedBirthExactConditionV1(key: string, value: unknown) { return { TableName: table, Key: { authority_key: key },
  ConditionExpression: "#schema = :schema AND #json = :json", ExpressionAttributeNames: { "#schema": "schema_version", "#json": "record_json" },
  ExpressionAttributeValues: { ":schema": 3, ":json": canonicalJson(value) }, ReturnValuesOnConditionCheckFailure: "NONE" }; }
export function failedBirthItemV1(key: string, value: unknown) {
  const text = canonicalJson(value); if (Buffer.byteLength(text) > 131072) cellV3Fail("FAILED_BIRTH_DDB_ITEM_TOO_LARGE");
  return { authority_key: key, schema_version: 3, record_json: text };
}
export function failedBirthAbsentPutV1(key: string, value: unknown) { const { Key: _key, ...condition } = failedBirthAbsentConditionV1(key); void _key;
  return { ...condition, Item: failedBirthItemV1(key, value) }; }

/** Bidirectional publication guard DATA ONLY. Validating an activation draft is
 * not validating/approving its runtime semantics. There is no activation writer
 * in this module. A later approved publisher must use these same atomic checks,
 * not a preceding GetItem or an unguarded legacy PutItem. */
export function prepareFailedBirthGuardedPublicationV1(kind: "provision" | "activation", item: Record<string, unknown>) {
  const key = kind === "provision" ? FAILED_BIRTH_DDB_KEYS_V1.provision : kind === "activation" ? FAILED_BIRTH_DDB_KEYS_V1.activation : "";
  if (!key || !cellV3Exact(item, ["authority_key", "schema_version", "revision", "record_json"]) || item.authority_key !== key ||
    item.schema_version !== 2 || item.revision !== 1 || typeof item.record_json !== "string" || Buffer.byteLength(item.record_json) > 131072) cellV3Fail("FAILED_BIRTH_PUBLICATION_SHAPE_INVALID");
  let raw: unknown; try { raw = JSON.parse(item.record_json); } catch { return cellV3Fail("FAILED_BIRTH_PUBLICATION_JSON_INVALID"); }
  if (canonicalJson(raw) !== item.record_json) cellV3Fail("FAILED_BIRTH_PUBLICATION_JSON_INVALID");
  const { Key: _key, ...c } = failedBirthAbsentConditionV1(key); void _key;
  return cellV3Freeze({ TransactItems: [
    { ConditionCheck: failedBirthAbsentConditionV1(FAILED_BIRTH_DDB_KEYS_V1.marker) },
    { ConditionCheck: failedBirthAbsentConditionV1(FAILED_BIRTH_DDB_KEYS_V1.intent) },
    { ConditionCheck: failedBirthAbsentConditionV1(FAILED_BIRTH_DDB_KEYS_V1.receipt) },
    { Put: { ...c, Item: structuredClone(item) } },
  ], publicationAuthorized: false as const, runtimeActivationAuthorized: false as const, legacyPublisherIsolationProved: false as const });
}

export async function prepareFailedBirthCompensationJournalIntentV1(marker: FailedBirthDdbMarkerV1, now: number) {
  const m = await decodeFailedBirthDdbMarkerV1(marker); cellV3Clock(now);
  if (now < m.reviewedAt || now >= m.expiresAt) cellV3Fail("FAILED_BIRTH_JOURNAL_PREPARE_EXPIRED");
  const body = { schemaVersion: 1 as const, protocol: "failed-cell-birth-compensation-journal-intent-v1" as const,
    markerSha256: m.markerSha256, fenceSha256: m.fenceSha256, stackId: m.intent.stackId, templateCanonicalSha256: m.intent.templateCanonicalSha256,
    failureInventorySha256: m.intent.failureInventorySha256, preparedAt: now,
    scope: { reserveJournalOnly: true as const, deletionAuthorized: false as const, replayOrRetryAuthorized: false as const } };
  const operationSha256 = await sha256Hex(body), request = { StackName: m.intent.stackId, RoleARN: CELL_V3_CFN_ROLE,
    ClientRequestToken: `failed-birth-v1-${operationSha256}`, DeletionMode: "STANDARD" as const };
  return cellV3Freeze({ ...body, operationSha256, request, intentSha256: await sha256Hex({ ...body, operationSha256, request }) });
}
export type FailedBirthCompensationJournalIntentV1 = Awaited<ReturnType<typeof prepareFailedBirthCompensationJournalIntentV1>>;
export async function decodeFailedBirthCompensationJournalIntentV1(raw: unknown, marker: FailedBirthDdbMarkerV1) {
  const v = raw as FailedBirthCompensationJournalIntentV1;
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "markerSha256", "fenceSha256", "stackId", "templateCanonicalSha256", "failureInventorySha256", "preparedAt", "scope", "operationSha256", "request", "intentSha256"]) ||
    canonicalJson(v) !== canonicalJson(await prepareFailedBirthCompensationJournalIntentV1(marker, v.preparedAt))) cellV3Fail("FAILED_BIRTH_JOURNAL_INTENT_INVALID");
  return cellV3Freeze(structuredClone(v));
}
