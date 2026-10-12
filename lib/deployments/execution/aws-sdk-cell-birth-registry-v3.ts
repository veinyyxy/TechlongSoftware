import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactGetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellStackEvidenceV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { CELL_BIRTH_REGISTRATION_KEY_V3 as key, decodeCellBirthRegistrationV3, assertCellBirthRegistrationWindowV3, type CellBirthRegistrationV3 } from "./cell-birth-registration-v3.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { validateSealedCellDrainEventV3 } from "./prepared-sealed-cell-drain-coordinator-v3.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
export interface CellBirthRegistrySdkV3 { ddb: Client; sts: Client; commands: { identity: Command; get: Command; transactGet: Command; transactWrite: Command } }
export type CellBirthRegistryProfileV3 = "source_inspection" | "lifecycle_coordinator";
const proofs = new WeakSet<object>(), claims = new WeakSet<object>(), digest = /^[a-f0-9]{64}$/;
function pin(s: CellBirthRegistrySdkV3) { return Object.freeze({ ddb: Object.freeze({ send: s.ddb.send.bind(s.ddb) }), sts: Object.freeze({ send: s.sts.send.bind(s.sts) }), commands: Object.freeze({ ...s.commands }) }); }
async function identity(s: ReturnType<typeof pin>, profile: CellBirthRegistryProfileV3, signal: AbortSignal, roleId?: string) {
  signal.throwIfAborted(); const r = await s.sts.send(new s.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
  if (r.Account !== "402010193138") cellV3Fail("CELL_BIRTH_REGISTRY_IDENTITY_INVALID");
  if (profile === "source_inspection") {
    if (r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") cellV3Fail("CELL_BIRTH_REGISTRY_IDENTITY_INVALID");
  } else if (!/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellLifecycleCoordinatorRoleV3\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(String(r.Arn)) ||
    typeof r.UserId !== "string" || (roleId && r.UserId !== `${roleId}:${String(r.Arn).split("/").at(-1)}`)) cellV3Fail("CELL_BIRTH_REGISTRY_IDENTITY_INVALID");
}
function item(k: string, record: unknown) { const text = canonicalJson(record); if (Buffer.byteLength(text) > 131072) cellV3Fail("CELL_BIRTH_RECORD_TOO_LARGE"); return { authority_key: k, schema_version: 3, record_json: text }; }
function parse(raw: unknown, k: string) {
  const v = raw as Record<string, unknown>;
  if (!cellV3Exact(v, ["authority_key", "schema_version", "record_json"]) || v.authority_key !== k || v.schema_version !== 3 ||
    typeof v.record_json !== "string" || Buffer.byteLength(v.record_json) > 131072) cellV3Fail("CELL_BIRTH_REGISTRY_ITEM_INVALID");
  let r: unknown; try { r = JSON.parse(v.record_json); } catch { return cellV3Fail("CELL_BIRTH_REGISTRY_JSON_INVALID"); }
  if (canonicalJson(r) !== v.record_json) cellV3Fail("CELL_BIRTH_REGISTRY_JSON_INVALID"); return r;
}
function condition(k: string, value: unknown) { return { TableName: table, Key: { authority_key: k }, ConditionExpression: "#schema = :schema AND #json = :json",
  ExpressionAttributeNames: { "#schema": "schema_version", "#json": "record_json" }, ExpressionAttributeValues: { ":schema": 3, ":json": canonicalJson(value) }, ReturnValuesOnConditionCheckFailure: "NONE" }; }
function absentPut(k: string, value: unknown) { return { TableName: table, Item: item(k, value), ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" }; }

export interface InstalledCellBirthRegistrationV3 { schemaVersion: 3; protocol: "strong-installed-cell-birth-registration-v3"; profile: CellBirthRegistryProfileV3; observedAt: number; record: Readonly<CellBirthRegistrationV3> }
export function assertCellBirthRegistrationReadV3(v: InstalledCellBirthRegistrationV3, now: number) {
  if (!proofs.has(v)) cellV3Fail("CELL_BIRTH_REGISTRATION_NOT_STRONGLY_READ"); cellV3Clock(now);
  if (v.observedAt > now || now - v.observedAt > 30000) cellV3Fail("CELL_BIRTH_REGISTRATION_PROOF_STALE");
}
export function assertInstalledCellBirthRegistrationV3(v: InstalledCellBirthRegistrationV3, now: number, codeSha256?: string) {
  assertCellBirthRegistrationReadV3(v, now);
  assertCellBirthRegistrationWindowV3(v.record, now);
  if (codeSha256 !== undefined && (v.profile !== "lifecycle_coordinator" || !digest.test(codeSha256) || codeSha256 !== v.record.manifest.delegation.coordinatorCodeSha256))
    cellV3Fail("CELL_BIRTH_COORDINATOR_CODE_OR_IDENTITY_DRIFT");
}

/** Read-only approval capability. JSON decoding cannot manufacture its brand. */
export class AwsSdkCellBirthRegistryReaderV3 {
  private readonly sdk: ReturnType<typeof pin>; private readonly profile: CellBirthRegistryProfileV3; private readonly now: () => number;
  constructor(sdk: CellBirthRegistrySdkV3, profile: CellBirthRegistryProfileV3, now: () => number = Date.now) {
    if (!["source_inspection", "lifecycle_coordinator"].includes(profile)) cellV3Fail("CELL_BIRTH_REGISTRY_PROFILE_INVALID");
    this.sdk = pin(sdk); this.profile = profile; this.now = now;
  }
  async readStrong({ signal }: { signal: AbortSignal }): Promise<InstalledCellBirthRegistrationV3 | null> {
    const start = cellV3Clock(this.now()); await identity(this.sdk, this.profile, signal);
    const r = await this.sdk.ddb.send(new this.sdk.commands.get({ TableName: table, Key: { authority_key: key }, ConsistentRead: true }), { abortSignal: signal }); signal.throwIfAborted();
    if (r.Item === undefined) { await identity(this.sdk, this.profile, signal); if (cellV3Clock(this.now()) - start > 30000 || this.now() < start) cellV3Fail("CELL_BIRTH_REGISTRY_READ_STALE"); return null; }
    const record = await decodeCellBirthRegistrationV3(parse(r.Item, key)); await identity(this.sdk, this.profile, signal, record.manifest.delegation.coordinatorRoleId);
    const done = cellV3Clock(this.now()); if (done < start || done - start > 30000) cellV3Fail("CELL_BIRTH_REGISTRY_READ_STALE");
    const result = cellV3Freeze({ schemaVersion: 3 as const, protocol: "strong-installed-cell-birth-registration-v3" as const, profile: this.profile, observedAt: done, record }); proofs.add(result); return result;
  }
}

/** Separate Source-only registrar. One absent-key transaction, no update/delete
 * or reset. Exact fresh CFN read is independent of the archived review evidence. */
export class AwsSdkCellBirthRegistrarV3 {
  private readonly sdk: ReturnType<typeof pin>; private readonly stack: AwsSdkCellStackEvidenceV3; private readonly now: () => number;
  constructor(sdk: CellBirthRegistrySdkV3, stack: AwsSdkCellStackEvidenceV3, now: () => number = Date.now) { this.sdk = pin(sdk); this.stack = stack; this.now = now; }
  async installOnce(input: { record: CellBirthRegistrationV3; approvedManifestSha256: string; signal: AbortSignal }) {
    if (!cellV3Exact(input, ["record", "approvedManifestSha256", "signal"])) cellV3Fail("CELL_BIRTH_INSTALL_INPUT_INVALID");
    const r = await decodeCellBirthRegistrationV3(input.record);
    if (input.approvedManifestSha256 !== r.approvedManifestSha256) cellV3Fail("CELL_BIRTH_INSTALL_APPROVAL_MISMATCH");
    const active = () => { const n = cellV3Clock(this.now()); if (n < r.approvedAt || n >= r.manifest.expiresAt) cellV3Fail("CELL_BIRTH_INSTALL_REVIEW_EXPIRED"); };
    active(); await identity(this.sdk, "source_inspection", input.signal);
    const p = r.manifest.plan, d = r.manifest.delegation, s = await this.stack.read(p, d.stackId, input.signal);
    if (!("protocol" in s) || s.profile !== "source_inspection" || s.phase !== "RESERVED" || s.failedCreationOrPhase || s.resources.length ||
      s.observedAt > this.now() || this.now() - s.observedAt > 30000) cellV3Fail("CELL_BIRTH_INSTALL_CURRENT_RESERVED_REQUIRED");
    active(); input.signal.throwIfAborted();
    try {
      await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(),
        TransactItems: [{ Put: absentPut(key, r) }] }), { abortSignal: input.signal }); input.signal.throwIfAborted();
      return { outcome: "SUBMITTED_REQUIRES_INDEPENDENT_READ" as const, retryAuthorized: false as const };
    } catch { return { outcome: "UNKNOWN_OR_REJECTED_INSPECT_ONLY" as const, retryAuthorized: false as const }; }
  }
}

export interface CellBirthDrainIntentV3 { schemaVersion: 3; protocol: "cell-birth-once-drain-intent-v3"; registrationSha256: string; birthIntentSha256: string; stackId: string;
  event: ReturnType<typeof validateSealedCellDrainEventV3>; operationSha256: string; intentSha256: string; preparedAt: number }
export async function compileCellBirthDrainIntentV3(installed: InstalledCellBirthRegistrationV3, event: unknown, now: number) {
  assertInstalledCellBirthRegistrationV3(installed, now); const r = installed.record, d = r.manifest.delegation;
  if (installed.profile !== "lifecycle_coordinator" || now < Date.parse(d.cellExpiresAt)) cellV3Fail("CELL_BIRTH_DRAIN_NOT_DUE_OR_NOT_RUNTIME");
  const e = validateSealedCellDrainEventV3(event), op = { registrationSha256: r.registrationSha256, birthIntentSha256: d.birthIntentSha256, stackId: d.stackId, event: e };
  const body = { schemaVersion: 3 as const, protocol: "cell-birth-once-drain-intent-v3" as const, ...op, operationSha256: await sha256Hex(op), preparedAt: now };
  return cellV3Freeze({ ...body, intentSha256: await sha256Hex(body) });
}
async function decodeIntent(value: unknown, r: CellBirthRegistrationV3): Promise<CellBirthDrainIntentV3> {
  const v = value as CellBirthDrainIntentV3, d = r.manifest.delegation;
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "registrationSha256", "birthIntentSha256", "stackId", "event", "operationSha256", "preparedAt", "intentSha256"]) ||
    v.schemaVersion !== 3 || v.protocol !== "cell-birth-once-drain-intent-v3" || v.registrationSha256 !== r.registrationSha256 || v.birthIntentSha256 !== d.birthIntentSha256 || v.stackId !== d.stackId ||
    !digest.test(v.operationSha256) || !digest.test(v.intentSha256)) cellV3Fail("CELL_BIRTH_DRAIN_INTENT_INVALID");
  cellV3Clock(v.preparedAt); if (v.preparedAt < Date.parse(d.cellExpiresAt) || v.preparedAt < r.approvedAt || v.preparedAt >= d.notAfter) cellV3Fail("CELL_BIRTH_DRAIN_INTENT_WINDOW_INVALID");
  validateSealedCellDrainEventV3(v.event);
  const op = { registrationSha256: v.registrationSha256, birthIntentSha256: v.birthIntentSha256, stackId: v.stackId, event: v.event };
  const { intentSha256, ...body } = v; if (await sha256Hex(op) !== v.operationSha256 || await sha256Hex(body) !== intentSha256) cellV3Fail("CELL_BIRTH_DRAIN_INTENT_HASH_INVALID");
  return cellV3Freeze(structuredClone(v));
}
export interface CellBirthDrainReceiptV3 { schemaVersion: 3; protocol: "cell-birth-once-drain-receipt-v3"; registrationSha256: string; intentSha256: string;
  outcome: "RETURNED_REQUIRES_FRESH_CENSUS" | "INVOCATION_UNCERTAIN_INSPECT_ONLY"; resultSha256: string | null; attemptedAt: number; observedAt: number; receiptSha256: string }
export async function compileCellBirthDrainReceiptV3(intent: CellBirthDrainIntentV3, outcome: CellBirthDrainReceiptV3["outcome"], resultSha256: string | null, attemptedAt: number, observedAt: number) {
  cellV3Clock(attemptedAt); cellV3Clock(observedAt);
  if (attemptedAt < intent.preparedAt || observedAt < attemptedAt || !["RETURNED_REQUIRES_FRESH_CENSUS", "INVOCATION_UNCERTAIN_INSPECT_ONLY"].includes(outcome) ||
    (outcome === "RETURNED_REQUIRES_FRESH_CENSUS" ? !digest.test(String(resultSha256)) : resultSha256 !== null)) cellV3Fail("CELL_BIRTH_DRAIN_RECEIPT_INVALID");
  const body = { schemaVersion: 3 as const, protocol: "cell-birth-once-drain-receipt-v3" as const, registrationSha256: intent.registrationSha256, intentSha256: intent.intentSha256, outcome, resultSha256, attemptedAt, observedAt };
  return cellV3Freeze({ ...body, receiptSha256: await sha256Hex(body) });
}
const actionKey = (r: CellBirthRegistrationV3, kind: "intent" | "receipt") => `cell-birth-v3:drain-${kind}:${r.registrationSha256}`;
export interface CellBirthDrainClaimV3 { intent: CellBirthDrainIntentV3; installed: InstalledCellBirthRegistrationV3 }
export function assertCellBirthDrainClaimV3(v: CellBirthDrainClaimV3) { if (!claims.has(v)) cellV3Fail("CELL_BIRTH_DRAIN_CLAIM_OWNERSHIP_REQUIRED"); }

/** Runtime-only atomic approval ConditionCheck + fixed action slot. Payload SHA
 * is NOT part of the slot key, so changed payload/time cannot buy another call. */
export class AwsSdkCellBirthDrainJournalV3 {
  private readonly sdk: ReturnType<typeof pin>; private readonly now: () => number;
  constructor(sdk: CellBirthRegistrySdkV3, now: () => number = Date.now) { this.sdk = pin(sdk); this.now = now; }
  async readStrong(installed: InstalledCellBirthRegistrationV3, signal: AbortSignal) {
    assertCellBirthRegistrationReadV3(installed, this.now()); const r = installed.record;
    await identity(this.sdk, "lifecycle_coordinator", signal, r.manifest.delegation.coordinatorRoleId);
    const keys = [key, actionKey(r, "intent"), actionKey(r, "receipt")];
    const raw = await this.sdk.ddb.send(new this.sdk.commands.transactGet({ TransactItems: keys.map(k => ({ Get: { TableName: table, Key: { authority_key: k } } })) }), { abortSignal: signal }); signal.throwIfAborted();
    const responses = raw.Responses as { Item?: unknown }[];
    if (!Array.isArray(responses) || responses.length !== 3 || !responses[0]?.Item || canonicalJson(parse(responses[0].Item, key)) !== canonicalJson(r)) cellV3Fail("CELL_BIRTH_JOURNAL_REGISTRATION_DRIFT");
    const intent = responses[1]?.Item ? await decodeIntent(parse(responses[1].Item, keys[1]), r) : null;
    let receipt: CellBirthDrainReceiptV3 | null = null;
    if (responses[2]?.Item) {
      if (!intent) cellV3Fail("CELL_BIRTH_JOURNAL_ORPHAN_RECEIPT"); const v = parse(responses[2].Item, keys[2]) as CellBirthDrainReceiptV3;
      if (!cellV3Exact(v, ["schemaVersion", "protocol", "registrationSha256", "intentSha256", "outcome", "resultSha256", "attemptedAt", "observedAt", "receiptSha256"]) ||
        canonicalJson(v) !== canonicalJson(await compileCellBirthDrainReceiptV3(intent, v.outcome, v.resultSha256, v.attemptedAt, v.observedAt))) cellV3Fail("CELL_BIRTH_JOURNAL_RECEIPT_INVALID"); receipt = cellV3Freeze(v);
    }
    assertCellBirthRegistrationReadV3(installed, this.now()); return { intent, receipt };
  }
  async claimOnce(installed: InstalledCellBirthRegistrationV3, intent: CellBirthDrainIntentV3, signal: AbortSignal): Promise<CellBirthDrainClaimV3 | null> {
    assertInstalledCellBirthRegistrationV3(installed, this.now()); const r = installed.record, checked = await decodeIntent(intent, r);
    if (installed.profile !== "lifecycle_coordinator") cellV3Fail("CELL_BIRTH_CLAIM_RUNTIME_PROOF_REQUIRED");
    if (checked.preparedAt > this.now() || this.now() - checked.preparedAt > 30000) cellV3Fail("CELL_BIRTH_CLAIM_INTENT_STALE");
    await identity(this.sdk, "lifecycle_coordinator", signal, r.manifest.delegation.coordinatorRoleId); assertInstalledCellBirthRegistrationV3(installed, this.now()); signal.throwIfAborted();
    // Each contender gets a DIFFERENT transaction token. DynamoDB replays success
    // for identical tokens for ten minutes; a deterministic intent token would
    // incorrectly give two contenders the same actuator ownership.
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(),
      TransactItems: [{ ConditionCheck: condition(key, r) }, { Put: absentPut(actionKey(r, "intent"), checked) }] }), { abortSignal: signal }); signal.throwIfAborted(); }
    catch { return null; } // no ownership on conditional, timeout, abort or lost reply
    const proof = cellV3Freeze({ intent: checked, installed }); claims.add(proof); return proof;
  }
  async publishReceiptOnce(claim: CellBirthDrainClaimV3, receipt: CellBirthDrainReceiptV3, signal: AbortSignal) {
    assertCellBirthDrainClaimV3(claim); const { installed, intent } = claim, r = installed.record;
    if (canonicalJson(receipt) !== canonicalJson(await compileCellBirthDrainReceiptV3(intent, receipt.outcome, receipt.resultSha256, receipt.attemptedAt, receipt.observedAt))) cellV3Fail("CELL_BIRTH_RECEIPT_CLAIM_MISMATCH");
    // A receipt may be written after the action window closes; it grants nothing.
    await identity(this.sdk, "lifecycle_coordinator", signal, r.manifest.delegation.coordinatorRoleId); signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(),
      TransactItems: [{ ConditionCheck: condition(key, r) }, { ConditionCheck: condition(actionKey(r, "intent"), intent) }, { Put: absentPut(actionKey(r, "receipt"), receipt) }] }), { abortSignal: signal }); signal.throwIfAborted(); return true; }
    catch { return false; }
  }
}

/** Inert SDK construction, lazy fixed credentials, no table creation capability. */
export function createCellBirthRegistrySdkV3(credentials: unknown) {
  const config = { region: "ca-central-1", credentials: credentials as never, ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(config), { marshallOptions: { removeUndefinedValues: false, convertClassInstanceToMap: false } }), sts = new STSClient(config);
  const sdk: CellBirthRegistrySdkV3 = { ddb: ddb as unknown as Client, sts: sts as unknown as Client, commands: { identity: GetCallerIdentityCommand as unknown as Command,
    get: GetCommand as unknown as Command, transactGet: TransactGetCommand as unknown as Command, transactWrite: TransactWriteCommand as unknown as Command } };
  return Object.freeze({ sdk, dispose: () => { ddb.destroy(); sts.destroy(); } });
}
