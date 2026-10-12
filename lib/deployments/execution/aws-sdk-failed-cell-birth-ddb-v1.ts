import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { type CellBirthRegistrySdkV3 } from "./aws-sdk-cell-birth-registry-v3.ts";
import { type AwsSdkCellStackEvidenceV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { type NeonFailedCellBirthSourceV1 } from "./neon-failed-cell-birth-source-v1.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 as keys, decodeFailedBirthDdbMarkerV1, assertFailedBirthDdbApprovalV1, assertFailedBirthCurrentPairV1,
  decodeFailedBirthCompensationJournalIntentV1, failedBirthAbsentConditionV1 as absent, failedBirthExactConditionV1 as exact, failedBirthAbsentPutV1 as put,
  type FailedBirthDdbMarkerV1, type FailedBirthDdbApprovalV1, type FailedBirthCompensationJournalIntentV1 } from "./failed-cell-birth-ddb-v1.ts";
import { assertFailedBirthDeletionObservationV1, type FailedBirthDeletionObservationV1 } from "./aws-sdk-failed-cell-birth-recovery-v1.ts";

const proofs = new WeakSet<object>();
function pin(s: CellBirthRegistrySdkV3) { return Object.freeze({ ddb: Object.freeze({ send: s.ddb.send.bind(s.ddb) }), sts: Object.freeze({ send: s.sts.send.bind(s.sts) }), commands: Object.freeze({ ...s.commands }) }); }
async function source(s: ReturnType<typeof pin>, signal: AbortSignal) {
  signal.throwIfAborted(); const r = await s.sts.send(new s.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
  if (r.Account !== "402010193138" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") cellV3Fail("FAILED_BIRTH_DDB_SOURCE_IDENTITY_INVALID");
}
function parse(raw: unknown, key: string) {
  const v = raw as Record<string, unknown>;
  if (!cellV3Exact(v, ["authority_key", "schema_version", "record_json"]) || v.authority_key !== key || v.schema_version !== 3 ||
    typeof v.record_json !== "string" || Buffer.byteLength(v.record_json) > 131072) cellV3Fail("FAILED_BIRTH_DDB_ITEM_INVALID");
  let r: unknown; try { r = JSON.parse(v.record_json); } catch { return cellV3Fail("FAILED_BIRTH_DDB_JSON_INVALID"); }
  if (canonicalJson(r) !== v.record_json) cellV3Fail("FAILED_BIRTH_DDB_JSON_INVALID"); return r;
}
export interface FailedBirthCompensationReceiptV1 {
  schemaVersion: 1; protocol: "failed-cell-birth-compensation-read-only-receipt-v1";
  markerSha256: string; intentSha256: string; outcome: "DELETE_COMPLETE_TOKEN_MATCHED" | "DELETE_FAILED_TOKEN_MATCHED";
  observationSha256: string; observedAt: number; receiptSha256: string;
}
async function receiptRecord(marker: FailedBirthDdbMarkerV1, intent: FailedBirthCompensationJournalIntentV1, outcome: FailedBirthCompensationReceiptV1["outcome"], observationSha256: string, observedAt: number) {
  cellV3Clock(observedAt);
  if (!["DELETE_COMPLETE_TOKEN_MATCHED", "DELETE_FAILED_TOKEN_MATCHED"].includes(outcome) || !/^[a-f0-9]{64}$/.test(observationSha256) || observedAt < intent.preparedAt) cellV3Fail("FAILED_BIRTH_RECEIPT_FIELDS_INVALID");
  const body = { schemaVersion: 1 as const, protocol: "failed-cell-birth-compensation-read-only-receipt-v1" as const,
    markerSha256: marker.markerSha256, intentSha256: intent.intentSha256, outcome, observationSha256, observedAt };
  return cellV3Freeze({ ...body, receiptSha256: await sha256Hex(body) });
}
export interface FailedBirthDdbSnapshotV1 {
  schemaVersion: 1; protocol: "strong-failed-cell-birth-ddb-snapshot-v1"; observedAt: number;
  marker: Readonly<FailedBirthDdbMarkerV1> | null; intent: Readonly<FailedBirthCompensationJournalIntentV1> | null;
  receipt: Readonly<FailedBirthCompensationReceiptV1> | null;
  provisionPresent: boolean; activationPresent: boolean; provisionItemSha256: string | null; activationItemSha256: string | null;
}
export function assertFailedBirthDdbSnapshotV1(v: FailedBirthDdbSnapshotV1, now: number, requireExcluded = false) {
  cellV3Clock(now); if (!proofs.has(v) || v.observedAt > now || now - v.observedAt > 30000) cellV3Fail("FAILED_BIRTH_DDB_PROOF_PROVENANCE_OR_FRESHNESS_INVALID");
  if (requireExcluded && (!v.marker || v.provisionPresent || v.activationPresent)) cellV3Fail("FAILED_BIRTH_DDB_EXCLUSION_NOT_PROVED");
}
/** Five exact keys, one transactional snapshot, STS on both sides. Existing
 * activation/provision items are opaque blockers, never reinterpreted as zero. */
export class AwsSdkFailedBirthDdbReaderV1 {
  private readonly sdk: ReturnType<typeof pin>; private readonly now: () => number;
  constructor(sdk: CellBirthRegistrySdkV3, now: () => number = Date.now) { this.sdk = pin(sdk); this.now = now; }
  async readStrong(signal: AbortSignal): Promise<FailedBirthDdbSnapshotV1> {
    const start = cellV3Clock(this.now()); await source(this.sdk, signal);
    const k = [keys.marker, keys.intent, keys.receipt, keys.provision, keys.activation];
    const r = await this.sdk.ddb.send(new this.sdk.commands.transactGet({ TransactItems: k.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) }), { abortSignal: signal }); signal.throwIfAborted();
    const responses = r.Responses as { Item?: unknown }[];
    if (!Array.isArray(responses) || responses.length !== 5 || responses.some(x => !x || !cellV3Exact(x, x.Item === undefined ? [] : ["Item"]))) cellV3Fail("FAILED_BIRTH_DDB_RESPONSES_INVALID");
    const marker = responses[0].Item === undefined ? null : await decodeFailedBirthDdbMarkerV1(parse(responses[0].Item, keys.marker));
    const intent = responses[1].Item === undefined ? null : marker ? await decodeFailedBirthCompensationJournalIntentV1(parse(responses[1].Item, keys.intent), marker) : cellV3Fail("FAILED_BIRTH_DDB_ORPHAN_INTENT");
    let receipt: FailedBirthCompensationReceiptV1 | null = null;
    if (responses[2].Item !== undefined) {
      if (!marker || !intent) cellV3Fail("FAILED_BIRTH_DDB_ORPHAN_RECEIPT");
      const v = parse(responses[2].Item, keys.receipt) as FailedBirthCompensationReceiptV1;
      if (canonicalJson(v) !== canonicalJson(await receiptRecord(marker, intent, v.outcome, v.observationSha256, v.observedAt))) cellV3Fail("FAILED_BIRTH_DDB_RECEIPT_INVALID");
      receipt = cellV3Freeze(v);
    }
    const provisionPresent = responses[3].Item !== undefined, activationPresent = responses[4].Item !== undefined;
    for (const n of [3, 4]) if (responses[n].Item !== undefined) {
      const raw = responses[n].Item as Record<string, unknown>;
      if (!raw || raw.authority_key !== k[n] || Buffer.byteLength(canonicalJson(raw)) > 400000) cellV3Fail("FAILED_BIRTH_DDB_BLOCKER_ITEM_INVALID");
    }
    await source(this.sdk, signal); const done = cellV3Clock(this.now()); if (done < start || done - start > 30000) cellV3Fail("FAILED_BIRTH_DDB_READ_STALE");
    const v = cellV3Freeze({ schemaVersion: 1 as const, protocol: "strong-failed-cell-birth-ddb-snapshot-v1" as const, observedAt: done, marker, intent, receipt, provisionPresent, activationPresent,
      provisionItemSha256: provisionPresent ? await sha256Hex(responses[3].Item) : null, activationItemSha256: activationPresent ? await sha256Hex(responses[4].Item) : null }); proofs.add(v); return v;
  }
}

/** Narrow Source marker writer. Fresh DB/CFN recollection is mandatory. A marker
 * is permanent but does NOT prove legacy publication permissions are isolated. */
export class AwsSdkFailedBirthDdbMarkerWriterV1 {
  private readonly sdk: ReturnType<typeof pin>; private readonly reader: AwsSdkFailedBirthDdbReaderV1;
  private readonly stack: AwsSdkCellStackEvidenceV3; private readonly zero: NeonFailedCellBirthSourceV1; private readonly now: () => number;
  constructor(sdk: CellBirthRegistrySdkV3, stack: AwsSdkCellStackEvidenceV3, zero: NeonFailedCellBirthSourceV1, now: () => number = Date.now) {
    this.sdk = pin(sdk); this.reader = new AwsSdkFailedBirthDdbReaderV1(sdk, now); this.stack = stack; this.zero = zero; this.now = now;
  }
  async installOnce(input: { approval: FailedBirthDdbApprovalV1; plan: CellStackPlanV3; signal: AbortSignal }) {
    if (!cellV3Exact(input, ["approval", "plan", "signal"])) cellV3Fail("FAILED_BIRTH_MARKER_WRITE_INPUT_INVALID");
    assertFailedBirthDdbApprovalV1(input.approval, this.now()); const m = input.approval.marker, signal = input.signal;
    const before = await this.reader.readStrong(signal);
    if (before.marker || before.intent || before.receipt || before.provisionPresent || before.activationPresent) cellV3Fail("FAILED_BIRTH_MARKER_SLOT_OR_AUTHORITY_OCCUPIED");
    const zero = await this.zero.readCertifiedUnadmittedSnapshot({ intent: m.intent, fenceSha256: m.fenceSha256, signal });
    const failed = await this.stack.read(input.plan, m.intent.stackId, signal);
    if (!("protocol" in failed) || failed.profile !== "source_inspection") cellV3Fail("FAILED_BIRTH_MARKER_SOURCE_STACK_REQUIRED");
    assertFailedBirthCurrentPairV1(input.plan, failed, zero, this.now());
    if (zero.stateSha256 !== m.zeroStateSha256 || zero.protectionSha256 !== m.protectionSha256 || await sha256Hex(zero.certificate) !== m.certificateSha256) cellV3Fail("FAILED_BIRTH_MARKER_SOURCE_DRIFT");
    await source(this.sdk, signal); assertFailedBirthDdbApprovalV1(input.approval, this.now());
    assertFailedBirthCurrentPairV1(input.plan, failed, zero, this.now()); signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(), TransactItems: [
      { ConditionCheck: absent(keys.provision) }, { ConditionCheck: absent(keys.activation) },
      { ConditionCheck: absent(keys.intent) }, { ConditionCheck: absent(keys.receipt) }, { Put: put(keys.marker, m) },
    ] }), { abortSignal: signal }); signal.throwIfAborted(); return { outcome: "MARKER_SUBMITTED_REQUIRES_INDEPENDENT_READ" as const, retryAuthorized: false, deletionAuthorized: false }; }
    catch { return { outcome: "MARKER_UNCERTAIN_INSPECT_ONLY" as const, retryAuthorized: false, deletionAuthorized: false }; }
  }
}

/** Fixed per-Cell slot, NOT per payload/birth/time. Reserving an immutable plan
 * is not actuator ownership. No DeleteStack client or deletion claim exists. */
export class AwsSdkFailedBirthCompensationJournalV1 {
  private readonly sdk: ReturnType<typeof pin>; private readonly now: () => number;
  constructor(sdk: CellBirthRegistrySdkV3, now: () => number = Date.now) { this.sdk = pin(sdk); this.now = now; }
  async reserveIntentOnce(input: { snapshot: FailedBirthDdbSnapshotV1; intent: FailedBirthCompensationJournalIntentV1; approvedIntentSha256: string; signal: AbortSignal }) {
    if (!cellV3Exact(input, ["snapshot", "intent", "approvedIntentSha256", "signal"])) cellV3Fail("FAILED_BIRTH_JOURNAL_WRITE_INPUT_INVALID");
    const s = input.snapshot; assertFailedBirthDdbSnapshotV1(s, this.now(), true); const m = s.marker!;
    if (s.intent || s.receipt) cellV3Fail("FAILED_BIRTH_COMPENSATION_SLOT_OCCUPIED");
    const intent = await decodeFailedBirthCompensationJournalIntentV1(input.intent, m);
    if (input.approvedIntentSha256 !== intent.intentSha256 || intent.preparedAt > this.now() || this.now() - intent.preparedAt > 30000 || this.now() >= m.expiresAt) cellV3Fail("FAILED_BIRTH_JOURNAL_APPROVAL_OR_TIME_INVALID");
    await source(this.sdk, input.signal); assertFailedBirthDdbSnapshotV1(s, this.now(), true);
    if (intent.preparedAt > this.now() || this.now() - intent.preparedAt > 30000 || this.now() >= m.expiresAt) cellV3Fail("FAILED_BIRTH_JOURNAL_APPROVAL_OR_TIME_INVALID"); input.signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(), TransactItems: [
      { ConditionCheck: exact(keys.marker, m) }, { ConditionCheck: absent(keys.provision) }, { ConditionCheck: absent(keys.activation) },
      { ConditionCheck: absent(keys.receipt) }, { Put: put(keys.intent, intent) },
    ] }), { abortSignal: input.signal }); input.signal.throwIfAborted(); return { outcome: "INTENT_RESERVED_REQUIRES_INDEPENDENT_READ" as const, deletionAuthorized: false, retryAuthorized: false }; }
    catch { return { outcome: "INTENT_UNCERTAIN_INSPECT_ONLY" as const, deletionAuthorized: false, retryAuthorized: false }; }
  }
  async publishReadOnlyReceiptOnce(input: { snapshot: FailedBirthDdbSnapshotV1; observation: FailedBirthDeletionObservationV1; signal: AbortSignal }) {
    if (!cellV3Exact(input, ["snapshot", "observation", "signal"])) cellV3Fail("FAILED_BIRTH_RECEIPT_WRITE_INPUT_INVALID");
    const s = input.snapshot; assertFailedBirthDdbSnapshotV1(s, this.now(), true); if (!s.marker || !s.intent || s.receipt) cellV3Fail("FAILED_BIRTH_RECEIPT_SLOT_INVALID");
    assertFailedBirthDeletionObservationV1(input.observation, s.intent, this.now()); const o = input.observation;
    if (o.outcome !== "DELETE_COMPLETE_TOKEN_MATCHED" && o.outcome !== "DELETE_FAILED_TOKEN_MATCHED") cellV3Fail("FAILED_BIRTH_TERMINAL_TOKEN_EVENT_REQUIRED");
    const receipt = await receiptRecord(s.marker, s.intent, o.outcome, o.observationSha256, o.observedAt);
    await source(this.sdk, input.signal); assertFailedBirthDdbSnapshotV1(s, this.now(), true);
    assertFailedBirthDeletionObservationV1(o, s.intent, this.now()); input.signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(), TransactItems: [
      { ConditionCheck: exact(keys.marker, s.marker) }, { ConditionCheck: exact(keys.intent, s.intent) },
      { ConditionCheck: absent(keys.provision) }, { ConditionCheck: absent(keys.activation) }, { Put: put(keys.receipt, receipt) },
    ] }), { abortSignal: input.signal }); input.signal.throwIfAborted(); return { outcome: "RECEIPT_SUBMITTED_REQUIRES_INDEPENDENT_READ" as const, retryAuthorized: false }; }
    catch { return { outcome: "RECEIPT_UNCERTAIN_INSPECT_ONLY" as const, retryAuthorized: false }; }
  }
}
