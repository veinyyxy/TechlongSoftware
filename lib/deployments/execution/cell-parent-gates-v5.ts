import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_LIFECYCLE_COORDINATOR_V3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { CELL_PARENT_KEY_V4, CELL_PARENT_WORKFLOW_KEYS_V4, validateCellParentBindingV4, decodeCellBirthParentRecordV4, type CellParentRuntimeBindingV4 } from "./cell-birth-parent-v4.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 } from "./failed-cell-birth-ddb-v1.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { assertCellParentInstallationV4, type CellParentInstallationV4 } from "./aws-sdk-cell-birth-parent-installation-v4.ts";
import { assertCellParentOpenDatabaseV4, type CellParentOpenDatabaseV4 } from "./neon-cell-parent-control-v4.ts";
import { CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5 } from "./cell-parent-runtime-material-v5.ts";

const readKeys = [CELL_PARENT_KEY_V4, ...Object.values(FAILED_BIRTH_DDB_KEYS_V1), ...Object.values(CELL_PARENT_WORKFLOW_KEYS_V4)];
const writeKeys = [FAILED_BIRTH_DDB_KEYS_V1.provision, FAILED_BIRTH_DDB_KEYS_V1.marker, ...Object.values(CELL_PARENT_WORKFLOW_KEYS_V4)];
const otherKey = "cell-birth-v5:gate-denied:cell:cell-sandbox-other";
/** Every conditional request is unsatisfiable for an absent OR present item,
 * independently of IAM correctness and concurrent item changes. This is still
 * a WRITE API request, not a read-only AWS operation, and requires approval. */
export const CELL_PARENT_GATE_FALSE_CONDITION_V5 = "attribute_exists(#key) AND attribute_not_exists(#key)";
export const CELL_PARENT_GATE_SPEC_V5 = cellV3Freeze({
  protocol: "fixed-cell-parent-gates-v5", functionArn: CELL_LIFECYCLE_COORDINATOR_V3,
  roleId: "AROAV3GNMXTZBYYFRN63O", tableArn: table, readKeys, writeKeys, otherKey,
  failedProtectionSha256: CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5, falseCondition: CELL_PARENT_GATE_FALSE_CONDITION_V5,
  conditionalWriteApiCallsMaximum: 7, secretVersionsRead: "fixed-reader-only", databaseMode: "Serializable ReadOnly Deferrable",
  parentReadModes: ["absent", "exact-approved-parent-sha"],
  otherPrincipalsProved: false, deleteOrPassRoleProved: false, authorityIssuanceAuthorized: false,
});
export interface CellParentGateEventV5 {
  schemaVersion: 5; action: "inspect_fixed_cell_parent_gates_v5"; gateSpecSha256: string;
  binding: CellParentRuntimeBindingV4; stackId: string; reviewedAt: number; expiresAt: number; manifestSha256: string;
  expectedParentSha256: string | null;
}
/** The digest binds a request, NOT human authorization. Only a future separately
 * approved local invocation workflow may submit it. No arbitrary key, SQL,
 * Secret, URL, principal, command, condition or permission document in events. */
export async function validateCellParentGateEventV5(raw: unknown, now: number) {
  cellV3Clock(now); const e = raw as CellParentGateEventV5;
  if (!cellV3Exact(e, ["schemaVersion", "action", "gateSpecSha256", "binding", "stackId", "reviewedAt", "expiresAt", "manifestSha256", "expectedParentSha256"]) ||
    e.schemaVersion !== 5 || e.action !== "inspect_fixed_cell_parent_gates_v5" || e.gateSpecSha256 !== await sha256Hex(CELL_PARENT_GATE_SPEC_V5) ||
    (e.expectedParentSha256 !== null && (typeof e.expectedParentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(e.expectedParentSha256))) ||
    !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(e.stackId)) cellV3Fail("CELL_PARENT_V5_GATE_EVENT_INVALID");
  const binding = validateCellParentBindingV4(e.binding); cellV3Clock(e.reviewedAt); cellV3Clock(e.expiresAt);
  if (binding.roleId !== CELL_PARENT_GATE_SPEC_V5.roleId || e.expiresAt - e.reviewedAt !== 900000 || now < e.reviewedAt || now >= e.expiresAt ||
    now < binding.sourceWindowClosesAt) cellV3Fail("CELL_PARENT_V5_GATE_WINDOW_OR_ROLE_INVALID");
  const { manifestSha256, ...body } = e;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) cellV3Fail("CELL_PARENT_V5_GATE_DIGEST_INVALID");
  return cellV3Freeze({ ...e, binding });
}
type Json = Record<string, unknown>;
const condition = () => ({ ConditionExpression: CELL_PARENT_GATE_FALSE_CONDITION_V5, ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" });
const put = (authority_key: string) => ({ TableName: table, Item: { authority_key, schema_version: 5, record_json: '{"gate":"never-commit"}' }, ...condition() });
export function cellParentGateRequestsV5() {
  const txn = (keys: string[]) => ({ TransactItems: keys.map(k => ({ Put: put(k) })) });
  return cellV3Freeze([
    { id: "allowed_transaction_put_slots", operation: "transactWrite", expect: "condition_failed", input: txn(writeKeys) },
    { id: "allowed_transaction_condition_keys", operation: "transactWrite", expect: "condition_failed", input: { TransactItems: readKeys.map(authority_key => ({ ConditionCheck: { TableName: table, Key: { authority_key }, ...condition() } })) } },
    { id: "deny_parent_put", operation: "transactWrite", expect: "access_denied", input: txn([CELL_PARENT_KEY_V4]) },
    { id: "deny_activation_put", operation: "transactWrite", expect: "access_denied", input: txn([FAILED_BIRTH_DDB_KEYS_V1.activation]) },
    { id: "deny_other_key_put", operation: "transactWrite", expect: "access_denied", input: txn([otherKey]) },
    { id: "deny_mixed_key_transaction", operation: "transactWrite", expect: "access_denied", input: txn([writeKeys[0], otherKey]) },
    { id: "deny_direct_provision_put", operation: "put", expect: "access_denied", input: put(writeKeys[0]) },
  ]);
}
/** ValidationError, missing reasons, throttles/timeouts and condition failures
 * on a NEGATIVE request are never accepted as AccessDenied evidence. Provider
 * messages/items are not returned or logged. */
export function classifyCellParentGateErrorV5(error: unknown, expected: "condition_failed" | "access_denied", count: number) {
  const e = error as { name?: string; CancellationReasons?: { Code?: string; Item?: unknown }[] } | null;
  if (expected === "access_denied") return e?.name === "AccessDeniedException";
  return e?.name === "TransactionCanceledException" && Array.isArray(e.CancellationReasons) && e.CancellationReasons.length === count &&
    e.CancellationReasons.every(r => r?.Code === "ConditionalCheckFailed" && r.Item === undefined);
}
export interface CellParentGatePortsV5 {
  now(): number;
  installation(event: Readonly<CellParentGateEventV5>, signal: AbortSignal): Promise<CellParentInstallationV4>;
  snapshot(input: Json, signal: AbortSignal): Promise<Json>;
  conditional(operation: "transactWrite" | "put", input: Json, signal: AbortSignal): Promise<unknown>;
  reader(signal: AbortSignal): Promise<CellParentOpenDatabaseV4>;
}
/** Optional post-registration mode is bound to the complete real canonical
 * approved record, never mere parent presence. All other slots stay absent.
 * It produces no installed-parent/ownership brand or lifecycle capability. */
export async function inspectCellParentGateSnapshotV5(r: Json, event: Readonly<CellParentGateEventV5>, now: number) {
  if (!Array.isArray(r.Responses) || r.Responses.length !== readKeys.length || r.Responses.slice(1).some(x => !cellV3Exact(x, []))) cellV3Fail("CELL_PARENT_V5_GATE_WORKFLOW_OCCUPIED");
  const first = r.Responses[0] as Json;
  if (event.expectedParentSha256 === null) {
    if (!cellV3Exact(first, [])) cellV3Fail("CELL_PARENT_V5_GATE_UNEXPECTED_PARENT");
    return "ABSENT";
  }
  const item = first?.Item as Json;
  if (!cellV3Exact(first, ["Item"]) || !cellV3Exact(item, ["authority_key", "schema_version", "record_json"]) ||
    item.authority_key !== CELL_PARENT_KEY_V4 || item.schema_version !== 4 || typeof item.record_json !== "string" || Buffer.byteLength(item.record_json) > 131072) cellV3Fail("CELL_PARENT_V5_GATE_EXACT_PARENT_REQUIRED");
  let raw: unknown; try { raw = JSON.parse(item.record_json); } catch { return cellV3Fail("CELL_PARENT_V5_GATE_PARENT_JSON_INVALID"); }
  const parent = await decodeCellBirthParentRecordV4(raw), d = parent.manifest.delegation;
  if (canonicalJson(parent) !== item.record_json || parent.parentSha256 !== event.expectedParentSha256 ||
    canonicalJson(parent.manifest.runtimeBinding) !== canonicalJson(event.binding) || d.stackId !== event.stackId ||
    parent.manifest.failedProtectionSha256 !== CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5 || now < parent.approvedAt || now < d.notBefore || now >= d.notAfter)
    cellV3Fail("CELL_PARENT_V5_GATE_PARENT_BINDING_OR_WINDOW_DRIFT");
  return parent.parentSha256;
}
/** Finite observations only. No parent registration, lifecycle root, real DB
 * writer, publication, delete, activation, rollback, repair or retry branch. */
export async function runCellParentGatesV5(raw: unknown, ports: CellParentGatePortsV5, signal: AbortSignal) {
  const event = await validateCellParentGateEventV5(raw, ports.now()), p = Object.freeze({ now: ports.now.bind(ports), installation: ports.installation.bind(ports),
    snapshot: ports.snapshot.bind(ports), conditional: ports.conditional.bind(ports), reader: ports.reader.bind(ports) });
  const fresh = async () => { signal.throwIfAborted(); await validateCellParentGateEventV5(event, p.now()); };
  const metadata = await p.installation(event, signal); assertCellParentInstallationV4(metadata, p.now(), true);
  if (canonicalJson(metadata.binding) !== canonicalJson(event.binding) || metadata.stackId !== event.stackId) cellV3Fail("CELL_PARENT_V5_GATE_METADATA_DRIFT");
  const snapshotInput = () => ({ TransactItems: readKeys.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) });
  await fresh(); const before = await p.snapshot(snapshotInput(), signal), parentState = await inspectCellParentGateSnapshotV5(before, event, p.now());
  const results: { id: string; observed: "condition_failed" | "access_denied" }[] = [];
  for (const request of cellParentGateRequestsV5()) {
    await fresh(); const input: Json = structuredClone(request.input);
    if (request.operation === "transactWrite") input.ClientRequestToken = randomUUID();
    let expected = false;
    try { await p.conditional(request.operation as "transactWrite" | "put", input, signal); }
    catch (error) { signal.throwIfAborted(); expected = classifyCellParentGateErrorV5(error, request.expect as "condition_failed" | "access_denied", (input.TransactItems as unknown[] | undefined)?.length ?? 1); }
    if (!expected) cellV3Fail("CELL_PARENT_V5_GATE_UNEXPECTED_RESULT_INSPECT_ONLY");
    results.push({ id: request.id, observed: request.expect as "condition_failed" | "access_denied" });
  }
  await fresh(); const reader = await p.reader(signal); assertCellParentOpenDatabaseV4(reader, p.now(), true);
  if (reader.protectionSha256 !== CELL_PARENT_INSTALLED_PROTECTION_SHA256_V5) cellV3Fail("CELL_PARENT_V5_GATE_DATABASE_PROTECTION_DRIFT");
  await fresh(); const after = await p.snapshot(snapshotInput(), signal);
  if (await inspectCellParentGateSnapshotV5(after, event, p.now()) !== parentState || canonicalJson(before.Responses) !== canonicalJson(after.Responses)) cellV3Fail("CELL_PARENT_V5_GATE_SNAPSHOT_DRIFT");
  const final = await p.installation(event, signal); assertCellParentInstallationV4(final, p.now(), true);
  if (canonicalJson(final.binding) !== canonicalJson(metadata.binding) || final.metadataSha256 !== metadata.metadataSha256 || final.stackId !== event.stackId) cellV3Fail("CELL_PARENT_V5_GATE_FINAL_METADATA_DRIFT");
  await fresh();
  return cellV3Freeze({ schemaVersion: 5, protocol: "fixed-cell-parent-gate-observations-v5", outcome: "READY_FOR_INDEPENDENT_SOURCE_INSPECT",
    manifestSha256: event.manifestSha256, observedAt: p.now(), finiteGateObservations: results, conditionalWriteApiCalls: results.length,
    databaseStateSha256: reader.stateSha256, metadataSha256: final.metadataSha256, preAndPostWorkflowSlotsAbsent: true, boundParentState: parentState,
    mutationPerformed: false, readerAuthenticated: true, writerAuthenticated: false, otherPrincipalsProved: false,
    deleteOrPassRoleProved: false, independentSourceInspectRequired: true, authorityIssued: false, retryAuthorized: false, tenantRuntimeEnabled: false });
}
