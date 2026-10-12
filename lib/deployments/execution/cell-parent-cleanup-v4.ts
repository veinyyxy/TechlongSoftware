import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_V3_CFN_ROLE } from "../cloudformation/shared-cell-stack-v3.ts";
import { assertCellStackSnapshotV3, type CellStackSnapshotV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { assertInstalledCellParentV4, type InstalledCellParentV4, type CellParentRegistrySdkV4 } from "./aws-sdk-cell-birth-parent-v4.ts";
import { CELL_PARENT_KEY_V4 as parentKey, CELL_PARENT_WORKFLOW_KEYS_V4 as work } from "./cell-birth-parent-v4.ts";
import { type FailedCellBirthFenceIntentV1, decodeFailedCellBirthFenceV1 } from "./failed-cell-birth-fence-v1.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 as keys, decodeFailedBirthDdbMarkerV1, type FailedBirthDdbMarkerV1 } from "./failed-cell-birth-ddb-v1.ts";
import { type CertifiedFailedCellBirthSnapshotV1 } from "./neon-failed-cell-birth-source-v1.ts";
import { assertCellParentFailedZeroV4, assertCellParentTtlZeroV4, assertCellParentOpenDatabaseV4, type CellParentTtlZeroV4, type CellParentOpenDatabaseV4 } from "./neon-cell-parent-control-v4.ts";
import { assertCellParentDeleteObservationV4, type CellParentDeleteObservationV4 } from "./aws-sdk-cell-parent-delete-v4.ts";
import { validateSharedCellAuthorityItem, sharedCellAuthorityMarker, sharedCellProvisionOperationIntent, type SharedCellProvisionAuthorityRecord } from "./shared-cell-cleanup-authority.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { randomUUID } from "node:crypto";

const snapshots = new WeakSet<object>(), dbClaims = new WeakSet<object>(), usedDbClaims = new WeakSet<object>(), deleteClaims = new WeakSet<object>(), boundaries = new WeakSet<object>(), usedDeletes = new WeakSet<object>(), issuanceClaims = new WeakSet<object>(), usedIssuance = new WeakSet<object>();
const digest = /^[a-f0-9]{64}$/;
const exact = (key: string, schema: number, value: unknown) => ({ TableName: table, Key: { authority_key: key }, ConditionExpression: "#schema = :schema AND #json = :json",
  ExpressionAttributeNames: { "#schema": "schema_version", "#json": "record_json" }, ExpressionAttributeValues: { ":schema": schema, ":json": canonicalJson(value) }, ReturnValuesOnConditionCheckFailure: "NONE" });
const absent = (key: string) => ({ TableName: table, Key: { authority_key: key }, ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" });
const put = (key: string, schema: number, value: unknown) => { const { Key: _key, ...c } = absent(key); void _key; const text = canonicalJson(value); if (Buffer.byteLength(text) > 131072) cellV3Fail("CELL_PARENT_WORK_ITEM_TOO_LARGE"); return { ...c, Item: { authority_key: key, schema_version: schema, record_json: text } }; };
function parse(raw: unknown, key: string, schema = 4) { const r = raw as Record<string, unknown>;
  if (!cellV3Exact(r, ["authority_key", "schema_version", "record_json"]) || r.authority_key !== key || r.schema_version !== schema || typeof r.record_json !== "string" || Buffer.byteLength(r.record_json) > 131072) cellV3Fail("CELL_PARENT_WORK_ITEM_INVALID");
  let value: unknown; try { value = JSON.parse(r.record_json); } catch { return cellV3Fail("CELL_PARENT_WORK_JSON_INVALID"); } if (canonicalJson(value) !== r.record_json) cellV3Fail("CELL_PARENT_WORK_JSON_INVALID"); return value; }
function checkStack(parent: InstalledCellParentV4, s: CellStackSnapshotV3, now: number) {
  assertInstalledCellParentV4(parent, now, true); assertCellStackSnapshotV3(s); const d = parent.record.manifest.delegation;
  if (s.profile !== "lifecycle_coordinator" || s.stackId !== d.stackId || s.birthIntentSha256 !== d.birthIntentSha256 || s.templateCanonicalSha256 !== d.templateCanonicalSha256 || s.observedAt > now || now - s.observedAt > 30000) cellV3Fail("CELL_PARENT_CLEANUP_STACK_LINEAGE_OR_FRESHNESS_INVALID");
}
/** Explicit metadata-only cleanup lineage. It is NEVER installed/published as
 * a successful runtime predecessor, and never for a partial failure Stack. */
export async function compileParentTtlPredecessorV4(parent: InstalledCellParentV4, s: CellStackSnapshotV3, now: number) {
  checkStack(parent, s, now); const p = parent.record.manifest.plan;
  if (!s.completePaidStack || s.failedCreationOrPhase || now < Date.parse(s.cellExpiresAt)) cellV3Fail("CELL_PARENT_TTL_COMPLETE_DUE_STACK_REQUIRED");
  if (parent.provision) { const v = await validateSharedCellAuthorityItem(parent.provision);
    if (v.record.state !== "provision_verified" || v.record.stackId !== s.stackId || v.record.resourceInventorySha256 !== s.resourceInventorySha256 || v.record.templateCanonicalSha256 !== s.templateCanonicalSha256 ||
      v.record.stackStatus !== s.stackStatus || v.record.ownerDeploymentId !== p.intent.input.ownerDeploymentId || v.record.generation !== p.intent.input.generation || v.record.provisionEpoch !== p.intent.input.provisionEpoch || v.record.cellExpiresAt !== s.cellExpiresAt) cellV3Fail("CELL_PARENT_TTL_PUBLISHED_LINEAGE_DRIFT"); return v.record;
  }
  const source = { schemaVersion: 2 as const, accountId: "402010193138" as const, region: "ca-central-1" as const, cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const, stackId: s.stackId, stackStatus: s.stackStatus as "CREATE_COMPLETE" | "UPDATE_COMPLETE", cellExpiresAt: s.cellExpiresAt,
    cloudFormationRoleArn: CELL_V3_CFN_ROLE as typeof CELL_V3_CFN_ROLE, templateCanonicalSha256: s.templateCanonicalSha256, resourceInventorySha256: s.resourceInventorySha256,
    ownerDeploymentId: p.intent.input.ownerDeploymentId, generation: p.intent.input.generation, provisionEpoch: p.intent.input.provisionEpoch,
    provisionMarker: sharedCellAuthorityMarker({ generation: p.intent.input.generation, epoch: p.intent.input.provisionEpoch }) };
  const unsigned = { ...source, provisionOperationHash: await sha256Hex(sharedCellProvisionOperationIntent(source)), revision: 1, state: "provision_verified" as const }, record = { ...unsigned, recordHash: await sha256Hex(unsigned) };
  await validateSharedCellAuthorityItem({ authority_key: keys.provision, schema_version: 2, revision: 1, record_json: canonicalJson(record) }); return cellV3Freeze(record);
}
export interface ParentDbOperationV4 { schemaVersion: 4; protocol: "cell-parent-once-db-operation-v4"; parentSha256: string; kind: "failed" | "ttl";
  fence: FailedCellBirthFenceIntentV1 | null; predecessor: SharedCellProvisionAuthorityRecord | null; provisionItemJson: string | null; preparedAt: number; operationSha256: string }
export async function prepareParentDbOperationV4(parent: InstalledCellParentV4, kind: ParentDbOperationV4["kind"], value: FailedCellBirthFenceIntentV1 | SharedCellProvisionAuthorityRecord, now: number): Promise<Readonly<ParentDbOperationV4>> {
  assertInstalledCellParentV4(parent, now, true); const body = { schemaVersion: 4 as const, protocol: "cell-parent-once-db-operation-v4" as const, parentSha256: parent.record.parentSha256,
    kind, fence: kind === "failed" ? value as FailedCellBirthFenceIntentV1 : null, predecessor: kind === "ttl" ? value as SharedCellProvisionAuthorityRecord : null,
    provisionItemJson: parent.provision ? canonicalJson(parent.provision) : null, preparedAt: now }; const result = { ...body, operationSha256: await sha256Hex(body) };
  return decodeParentDbOperationV4(result, parent);
}
export async function decodeParentDbOperationV4(raw: unknown, parent: InstalledCellParentV4): Promise<Readonly<ParentDbOperationV4>> {
  const v = raw as ParentDbOperationV4, d = parent.record.manifest.delegation;
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "parentSha256", "kind", "fence", "predecessor", "provisionItemJson", "preparedAt", "operationSha256"]) || v.schemaVersion !== 4 || v.protocol !== "cell-parent-once-db-operation-v4" || v.parentSha256 !== parent.record.parentSha256 || !digest.test(v.operationSha256)) cellV3Fail("CELL_PARENT_DB_OPERATION_INVALID");
  cellV3Clock(v.preparedAt); if (v.preparedAt < parent.record.approvedAt || v.preparedAt < d.notBefore || v.preparedAt >= d.notAfter || v.provisionItemJson !== (parent.provision ? canonicalJson(parent.provision) : null)) cellV3Fail("CELL_PARENT_DB_OPERATION_TIME_OR_PROVISION_DRIFT");
  if (v.kind === "failed") { if (!v.fence || v.predecessor !== null || v.provisionItemJson !== null) cellV3Fail("CELL_PARENT_FAILED_OPERATION_UNADMITTED_REQUIRED");
    await decodeFailedCellBirthFenceV1(v.fence, await sha256Hex(v.fence)); const f = v.fence;
    if (f.stackId !== d.stackId || f.birthIntentSha256 !== d.birthIntentSha256 || f.templateCanonicalSha256 !== d.templateCanonicalSha256 || f.planSha256 !== d.planSha256 || f.ownerDeploymentId !== d.ownerDeploymentId || f.generation !== d.generation || f.provisionEpoch !== d.provisionEpoch || f.cellExpiresAt !== Date.parse(d.cellExpiresAt)) cellV3Fail("CELL_PARENT_FAILED_OPERATION_LINEAGE_DRIFT");
  } else if (v.kind === "ttl") { if (!v.predecessor || v.fence !== null || v.preparedAt < Date.parse(d.cellExpiresAt)) cellV3Fail("CELL_PARENT_TTL_OPERATION_NOT_DUE");
    const p = (await validateSharedCellAuthorityItem({ authority_key: keys.provision, schema_version: 2, revision: 1, record_json: canonicalJson(v.predecessor) })).record;
    if (p.state !== "provision_verified" || p.stackId !== d.stackId || p.templateCanonicalSha256 !== d.templateCanonicalSha256 || p.ownerDeploymentId !== d.ownerDeploymentId || p.generation !== d.generation || p.provisionEpoch !== d.provisionEpoch || p.cellExpiresAt !== d.cellExpiresAt || (parent.provision && parent.provision.record_json !== canonicalJson(p))) cellV3Fail("CELL_PARENT_TTL_OPERATION_LINEAGE_DRIFT");
  } else cellV3Fail("CELL_PARENT_DB_OPERATION_KIND_INVALID");
  const { operationSha256, ...body } = v; if (await sha256Hex(body) !== operationSha256) cellV3Fail("CELL_PARENT_DB_OPERATION_HASH_INVALID"); return cellV3Freeze(structuredClone(v));
}
export interface ParentDeleteAuthorityV4 { schemaVersion: 4; protocol: "cell-parent-certified-delete-authority-v4"; parentSha256: string; dbOperationSha256: string; kind: "failed" | "ttl";
  stackId: string; templateSha256: string; inventorySha256: string; databaseStateSha256: string; preparedAt: number; expiresAt: number; authoritySha256: string }
export async function prepareParentDeleteAuthorityV4(parent: InstalledCellParentV4, op: ParentDbOperationV4, s: CellStackSnapshotV3, zero: CertifiedFailedCellBirthSnapshotV1 | CellParentTtlZeroV4, now: number) {
  checkStack(parent, s, now); await decodeParentDbOperationV4(op, parent);
  if (op.kind === "failed") { const z = zero as CertifiedFailedCellBirthSnapshotV1; assertCellParentFailedZeroV4(z, now);
    if (!s.failedCreationOrPhase || s.completePaidStack || canonicalJson(z.intent) !== canonicalJson(op.fence) || z.protectionSha256 !== parent.record.manifest.failedProtectionSha256 || s.resourceInventorySha256 !== op.fence!.failureInventorySha256 || s.stackStatus !== op.fence!.failedStackStatus || s.phase !== op.fence!.failedPhase) cellV3Fail("CELL_PARENT_FAILED_DELETE_ZERO_OR_STACK_DRIFT");
  } else { const z = zero as CellParentTtlZeroV4; assertCellParentTtlZeroV4(z, op.predecessor!, now);
    if (!s.completePaidStack || s.failedCreationOrPhase || z.protectionSha256 !== parent.record.manifest.failedProtectionSha256 || s.resourceInventorySha256 !== op.predecessor!.resourceInventorySha256 || s.stackStatus !== op.predecessor!.stackStatus) cellV3Fail("CELL_PARENT_TTL_DELETE_ZERO_OR_STACK_DRIFT"); }
  const body = { schemaVersion: 4 as const, protocol: "cell-parent-certified-delete-authority-v4" as const, parentSha256: parent.record.parentSha256, dbOperationSha256: op.operationSha256,
    kind: op.kind, stackId: s.stackId, templateSha256: s.templateCanonicalSha256, inventorySha256: s.resourceInventorySha256, databaseStateSha256: zero.stateSha256,
    preparedAt: now, expiresAt: Math.min(now + 300000, parent.record.manifest.delegation.notAfter) };
  return cellV3Freeze({ ...body, authoritySha256: await sha256Hex(body) });
}
async function decodeAuthority(raw: unknown, parent: InstalledCellParentV4, op: ParentDbOperationV4): Promise<Readonly<ParentDeleteAuthorityV4>> {
  const v = raw as ParentDeleteAuthorityV4, d = parent.record.manifest.delegation;
  if (!cellV3Exact(v, ["schemaVersion", "protocol", "parentSha256", "dbOperationSha256", "kind", "stackId", "templateSha256", "inventorySha256", "databaseStateSha256", "preparedAt", "expiresAt", "authoritySha256"]) ||
    v.schemaVersion !== 4 || v.protocol !== "cell-parent-certified-delete-authority-v4" || v.parentSha256 !== parent.record.parentSha256 || v.dbOperationSha256 !== op.operationSha256 || v.kind !== op.kind ||
    v.stackId !== d.stackId || v.templateSha256 !== d.templateCanonicalSha256 || [v.inventorySha256, v.databaseStateSha256, v.authoritySha256].some(h => !digest.test(h))) cellV3Fail("CELL_PARENT_DELETE_AUTHORITY_INVALID");
  cellV3Clock(v.preparedAt); cellV3Clock(v.expiresAt);
  if (v.preparedAt < op.preparedAt || v.preparedAt >= d.notAfter || v.expiresAt !== Math.min(v.preparedAt + 300000, d.notAfter) ||
    v.inventorySha256 !== (op.fence?.failureInventorySha256 ?? op.predecessor?.resourceInventorySha256)) cellV3Fail("CELL_PARENT_DELETE_AUTHORITY_LINEAGE_OR_CLOCK_INVALID");
  const { authoritySha256, ...body } = v; if (await sha256Hex(body) !== authoritySha256) cellV3Fail("CELL_PARENT_DELETE_AUTHORITY_HASH_INVALID"); return cellV3Freeze(structuredClone(v));
}
export interface ParentDeleteIntentV4 { schemaVersion: 4; protocol: "cell-parent-once-delete-intent-v4"; authoritySha256: string; claimedAt: number;
  request: { StackName: string; RoleARN: typeof CELL_V3_CFN_ROLE; ClientRequestToken: string; DeletionMode: "STANDARD" }; intentSha256: string }
async function deleteIntent(authority: ParentDeleteAuthorityV4, now: number): Promise<Readonly<ParentDeleteIntentV4>> {
  cellV3Clock(now); if (now < authority.preparedAt || now >= authority.expiresAt) cellV3Fail("CELL_PARENT_DELETE_AUTHORITY_EXPIRED");
  const body = { schemaVersion: 4 as const, protocol: "cell-parent-once-delete-intent-v4" as const, authoritySha256: authority.authoritySha256, claimedAt: now,
    request: { StackName: authority.stackId, RoleARN: CELL_V3_CFN_ROLE as typeof CELL_V3_CFN_ROLE, ClientRequestToken: `cell-parent-v4-${authority.authoritySha256}`, DeletionMode: "STANDARD" as const } };
  return cellV3Freeze({ ...body, intentSha256: await sha256Hex(body) });
}
export interface ParentWorkflowSnapshotV4 { observedAt: number; parent: InstalledCellParentV4; dbOperation: Readonly<ParentDbOperationV4> | null;
  dbReceipt: Record<string, unknown> | null; marker: Readonly<FailedBirthDdbMarkerV1> | null; authority: Readonly<ParentDeleteAuthorityV4> | null;
  deleteIntent: Readonly<ParentDeleteIntentV4> | null; deleteReceipt: Record<string, unknown> | null; issuanceIntent: Readonly<ParentIssuanceIntentV4> | null }
export interface ParentIssuanceIntentV4 { schemaVersion: 4; protocol: "cell-parent-once-issuance-v4"; authority: ParentDeleteAuthorityV4; marker: FailedBirthDdbMarkerV1 | null; issuanceSha256: string }
export interface ParentIssuanceClaimV4 { intent: Readonly<ParentIssuanceIntentV4> }
export interface ParentDbClaimV4 { snapshot: ParentWorkflowSnapshotV4; operation: Readonly<ParentDbOperationV4> }
export interface ParentDeleteClaimV4 { snapshot: ParentWorkflowSnapshotV4; intent: Readonly<ParentDeleteIntentV4> }
export interface ParentDeleteBoundaryV4 { snapshot: ParentWorkflowSnapshotV4; stack: CellStackSnapshotV3; zero: CertifiedFailedCellBirthSnapshotV1 | CellParentTtlZeroV4; checkedAt: number }
export function assertParentWorkflowV4(v: ParentWorkflowSnapshotV4, now: number, write = false) { assertInstalledCellParentV4(v.parent, now, write); if (!snapshots.has(v) || v.observedAt > now || now - v.observedAt > 30000) cellV3Fail("CELL_PARENT_WORKFLOW_PROOF_STALE_OR_COPIED"); }
export function assertParentDbClaimV4(v: ParentDbClaimV4) { if (!dbClaims.has(v)) cellV3Fail("CELL_PARENT_DB_ONCE_OWNERSHIP_REQUIRED"); }
export function consumeParentDbClaimV4(claim: ParentDbClaimV4, s: ParentWorkflowSnapshotV4, stack: CellStackSnapshotV3, open: CellParentOpenDatabaseV4, now: number) {
  assertParentDbClaimV4(claim); if (usedDbClaims.has(claim)) cellV3Fail("CELL_PARENT_DB_CLAIM_ALREADY_USED");
  assertParentWorkflowV4(s, now, true); assertCellParentOpenDatabaseV4(open, now, claim.operation.kind === "failed"); checkStack(s.parent, stack, now);
  const op = claim.operation;
  if (!s.dbOperation || canonicalJson(s.dbOperation) !== canonicalJson(op) || s.marker || s.authority || s.deleteIntent ||
    open.protectionSha256 !== s.parent.record.manifest.failedProtectionSha256 || stack.resourceInventorySha256 !== (op.fence?.failureInventorySha256 ?? op.predecessor?.resourceInventorySha256) ||
    (op.kind === "failed" ? !stack.failedCreationOrPhase || stack.stackStatus !== op.fence!.failedStackStatus || stack.phase !== op.fence!.failedPhase || open.environmentIdentitySha256 !== op.fence!.environmentIdentitySha256 : !stack.completePaidStack || now < Date.parse(op.predecessor!.cellExpiresAt))) cellV3Fail("CELL_PARENT_DB_CLAIM_PREWRITE_DRIFT");
  usedDbClaims.add(claim); return op;
}
export async function prepareParentDeleteBoundaryV4(snapshot: ParentWorkflowSnapshotV4, stack: CellStackSnapshotV3, zero: CertifiedFailedCellBirthSnapshotV1 | CellParentTtlZeroV4, now: number) {
  assertParentWorkflowV4(snapshot, now, true); if (!snapshot.dbOperation || !snapshot.authority || snapshot.deleteReceipt) cellV3Fail("CELL_PARENT_DELETE_BOUNDARY_AUTHORITY_REQUIRED");
  const candidate = await prepareParentDeleteAuthorityV4(snapshot.parent, snapshot.dbOperation, stack, zero, snapshot.authority.preparedAt <= now ? now : cellV3Fail("CELL_PARENT_CLOCK_REGRESSED"));
  if (candidate.databaseStateSha256 !== snapshot.authority.databaseStateSha256 || candidate.inventorySha256 !== snapshot.authority.inventorySha256 || now >= snapshot.authority.expiresAt ||
    (snapshot.dbOperation.kind === "failed" && (!snapshot.marker || snapshot.marker.fenceSha256 !== await sha256Hex(snapshot.dbOperation.fence) || snapshot.marker.zeroStateSha256 !== zero.stateSha256))) cellV3Fail("CELL_PARENT_DELETE_BOUNDARY_DRIFT");
  const b = cellV3Freeze({ snapshot, stack, zero, checkedAt: now }); boundaries.add(b); return b;
}
export function consumeParentDeleteClaimV4(claim: ParentDeleteClaimV4, boundary: ParentDeleteBoundaryV4, now: number) {
  if (!deleteClaims.has(claim) || usedDeletes.has(claim) || !boundaries.has(boundary)) cellV3Fail("CELL_PARENT_DELETE_PRIVATE_ONCE_OWNERSHIP_REQUIRED");
  assertParentWorkflowV4(boundary.snapshot, now, true); const saved = boundary.snapshot.deleteIntent;
  if (!saved || canonicalJson(saved) !== canonicalJson(claim.intent) || now < boundary.checkedAt || now - boundary.checkedAt > 30000 || now >= boundary.snapshot.authority!.expiresAt) cellV3Fail("CELL_PARENT_DELETE_ONCE_BOUNDARY_STALE_OR_DRIFTED");
  checkStack(boundary.snapshot.parent, boundary.stack, now); if (boundary.snapshot.dbOperation!.kind === "failed") assertCellParentFailedZeroV4(boundary.zero as CertifiedFailedCellBirthSnapshotV1, now);
  else assertCellParentTtlZeroV4(boundary.zero as CellParentTtlZeroV4, boundary.snapshot.dbOperation!.predecessor!, now);
  usedDeletes.add(claim); return claim.intent.request;
}

/** No Update/Delete/reset. Each action has one fixed Cell slot. Lost response
 * never mints private ownership, even when an independent read sees the item. */
export class AwsSdkCellParentCleanupJournalV4 {
  private readonly sdk: CellParentRegistrySdkV4; private readonly now: () => number;
  constructor(sdk: CellParentRegistrySdkV4, now: () => number = Date.now) { this.sdk = Object.freeze({ sts: Object.freeze({ send: sdk.sts.send.bind(sdk.sts) }), ddb: Object.freeze({ send: sdk.ddb.send.bind(sdk.ddb) }), commands: Object.freeze({ ...sdk.commands }) }); this.now = now; }
  private async identity(parent: InstalledCellParentV4, signal: AbortSignal) {
    signal.throwIfAborted(); const r = await this.sdk.sts.send(new this.sdk.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
    if (r.Account !== "402010193138" || !/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellLifecycleCoordinatorRoleV3\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(String(r.Arn)) || r.UserId !== `${parent.record.manifest.runtimeBinding.roleId}:${String(r.Arn).split("/").at(-1)}`) cellV3Fail("CELL_PARENT_WORKFLOW_RUNTIME_IDENTITY_INVALID");
  }
  private conditions(s: ParentWorkflowSnapshotV4) {
    const p = s.parent; return [ { ConditionCheck: exact(parentKey, 4, p.record) },
      { ConditionCheck: p.provision ? { TableName: table, Key: { authority_key: keys.provision }, ConditionExpression: "#schema = :schema AND #rev = :rev AND #json = :json",
        ExpressionAttributeNames: { "#schema": "schema_version", "#rev": "revision", "#json": "record_json" }, ExpressionAttributeValues: { ":schema": 2, ":rev": p.provision.revision, ":json": p.provision.record_json }, ReturnValuesOnConditionCheckFailure: "NONE" } : absent(keys.provision) },
      { ConditionCheck: absent(keys.activation) }, { ConditionCheck: absent(keys.intent) }, { ConditionCheck: absent(keys.receipt) } ];
  }
  async read(parent: InstalledCellParentV4, signal: AbortSignal): Promise<ParentWorkflowSnapshotV4> {
    assertInstalledCellParentV4(parent, this.now()); await this.identity(parent, signal);
    if (parent.activationPresent || parent.compensationIntentPresent || parent.compensationReceiptPresent) cellV3Fail("CELL_PARENT_WORKFLOW_LEGACY_OR_ACTIVATION_PRESENT");
    const k = [parentKey, keys.provision, keys.activation, keys.marker, keys.intent, keys.receipt, ...Object.values(work)];
    const r = await this.sdk.ddb.send(new this.sdk.commands.transactGet({ TransactItems: k.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) }), { abortSignal: signal }); signal.throwIfAborted();
    const list = r.Responses as { Item?: unknown }[];
    if (!Array.isArray(list) || list.length !== k.length || list.some(x => !x || !cellV3Exact(x, x.Item === undefined ? [] : ["Item"])) ||
      !list[0].Item || canonicalJson(parse(list[0].Item, parentKey)) !== canonicalJson(parent.record) || canonicalJson(list[1].Item ?? null) !== canonicalJson(parent.provision) || list[2].Item || list[4].Item || list[5].Item) cellV3Fail("CELL_PARENT_WORKFLOW_PARENT_OR_EXCLUSION_DRIFT");
    const marker = list[3].Item ? await decodeFailedBirthDdbMarkerV1(parse(list[3].Item, keys.marker, 3)) : null;
    const dbOperation = list[6].Item ? await decodeParentDbOperationV4(parse(list[6].Item, work.dbIntent), parent) : null;
    const authority = list[8].Item ? dbOperation ? await decodeAuthority(parse(list[8].Item, work.authority), parent, dbOperation) : cellV3Fail("CELL_PARENT_ORPHAN_AUTHORITY") : null;
    const di = list[9].Item ? parse(list[9].Item, work.deleteIntent) as ParentDeleteIntentV4 : null;
    const issuanceIntent = list[11].Item ? parse(list[11].Item, work.issuanceIntent) as ParentIssuanceIntentV4 : null;
    if (issuanceIntent) {
      if (!dbOperation || !cellV3Exact(issuanceIntent, ["schemaVersion", "protocol", "authority", "marker", "issuanceSha256"]) || issuanceIntent.schemaVersion !== 4 || issuanceIntent.protocol !== "cell-parent-once-issuance-v4") cellV3Fail("CELL_PARENT_ISSUANCE_INTENT_INVALID");
      await decodeAuthority(issuanceIntent.authority, parent, dbOperation);
      if (dbOperation.kind === "failed") { if (!issuanceIntent.marker || canonicalJson((await decodeFailedBirthDdbMarkerV1(issuanceIntent.marker)).intent) !== canonicalJson(dbOperation.fence)) cellV3Fail("CELL_PARENT_ISSUANCE_MARKER_INVALID"); }
      else if (issuanceIntent.marker !== null) cellV3Fail("CELL_PARENT_ISSUANCE_MARKER_INVALID");
      const { issuanceSha256, ...body } = issuanceIntent; if (await sha256Hex(body) !== issuanceSha256 || (authority && canonicalJson(authority) !== canonicalJson(issuanceIntent.authority)) || (marker && canonicalJson(marker) !== canonicalJson(issuanceIntent.marker))) cellV3Fail("CELL_PARENT_ISSUANCE_HASH_OR_PUBLICATION_DRIFT");
    } else if (authority || marker) cellV3Fail("CELL_PARENT_ISSUANCE_OWNERSHIP_RECORD_REQUIRED");
    if (di && (!authority || !cellV3Exact(di, ["schemaVersion", "protocol", "authoritySha256", "claimedAt", "request", "intentSha256"]) || canonicalJson(di) !== canonicalJson(await deleteIntent(authority, di.claimedAt)))) cellV3Fail("CELL_PARENT_DELETE_INTENT_INVALID");
    const receipts = [7, 10].map(i => list[i].Item ? parse(list[i].Item, k[i]) as Record<string, unknown> : null);
    for (let i = 0; i < receipts.length; i++) if (receipts[i]) {
      const q = receipts[i]!; if (!cellV3Exact(q, ["schemaVersion", "protocol", "parentSha256", "boundSha256", "outcome", "resultSha256", "observedAt", "receiptSha256"]) ||
        q.schemaVersion !== 4 || q.protocol !== (i ? "cell-parent-delete-receipt-v4" : "cell-parent-db-receipt-v4") || q.parentSha256 !== parent.record.parentSha256 ||
        q.boundSha256 !== (i ? di?.intentSha256 : dbOperation?.operationSha256) || !(i ? ["DELETE_COMPLETE_TOKEN_MATCHED", "DELETE_FAILED_TOKEN_MATCHED"] : ["RETURNED_REQUIRES_READ", "UNCERTAIN_INSPECT_ONLY"]).includes(String(q.outcome)) ||
        (q.resultSha256 !== null && !digest.test(String(q.resultSha256)))) cellV3Fail("CELL_PARENT_WORK_RECEIPT_INVALID");
      cellV3Clock(q.observedAt as number); const { receiptSha256, ...b } = q; if (await sha256Hex(b) !== receiptSha256) cellV3Fail("CELL_PARENT_WORK_RECEIPT_HASH_INVALID");
    }
    if ((marker && (!dbOperation || dbOperation.kind !== "failed" || canonicalJson(marker.intent) !== canonicalJson(dbOperation.fence))) || (di && !authority)) cellV3Fail("CELL_PARENT_WORKFLOW_ORPHAN_RECORD");
    await this.identity(parent, signal); assertInstalledCellParentV4(parent, this.now()); const v = cellV3Freeze({ observedAt: cellV3Clock(this.now()), parent, dbOperation, dbReceipt: receipts[0], marker, authority, deleteIntent: di, deleteReceipt: receipts[1], issuanceIntent }); snapshots.add(v); return v;
  }
  private async transaction(s: ParentWorkflowSnapshotV4, additions: Record<string, unknown>[], signal: AbortSignal, requireWindow = true) {
    assertParentWorkflowV4(s, this.now(), requireWindow); await this.identity(s.parent, signal); assertParentWorkflowV4(s, this.now(), requireWindow); signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(), TransactItems: [...this.conditions(s), ...additions] }), { abortSignal: signal }); signal.throwIfAborted(); return true; } catch { return false; }
  }
  async claimDatabaseOnce(s: ParentWorkflowSnapshotV4, op: ParentDbOperationV4, signal: AbortSignal): Promise<ParentDbClaimV4 | null> {
    assertParentWorkflowV4(s, this.now(), true); if (s.dbOperation || s.marker || s.authority || s.deleteIntent || s.deleteReceipt) cellV3Fail("CELL_PARENT_DB_SLOT_OCCUPIED");
    const operation = await decodeParentDbOperationV4(op, s.parent);
    if (operation.preparedAt > this.now() || this.now() - operation.preparedAt > 30000) cellV3Fail("CELL_PARENT_DB_INTENT_STALE");
    if (!await this.transaction(s, [{ ConditionCheck: absent(keys.marker) }, { ConditionCheck: absent(work.authority) }, { ConditionCheck: absent(work.issuanceIntent) }, { ConditionCheck: absent(work.deleteIntent) }, { ConditionCheck: absent(work.deleteReceipt) }, { Put: put(work.dbIntent, 4, operation) }], signal)) return null;
    const claim = cellV3Freeze({ snapshot: s, operation }); dbClaims.add(claim); return claim;
  }
  async claimIssuanceOnce(s: ParentWorkflowSnapshotV4, authority: ParentDeleteAuthorityV4, marker: FailedBirthDdbMarkerV1 | null, signal: AbortSignal): Promise<ParentIssuanceClaimV4 | null> {
    if (!s.dbOperation || s.issuanceIntent || s.authority || s.marker || s.deleteIntent) cellV3Fail("CELL_PARENT_ISSUANCE_SLOT_OCCUPIED");
    const a = await decodeAuthority(authority, s.parent, s.dbOperation), m = marker ? await decodeFailedBirthDdbMarkerV1(marker) : null;
    if ((s.dbOperation.kind === "failed") !== !!m || (m && canonicalJson(m.intent) !== canonicalJson(s.dbOperation.fence)) || a.preparedAt > this.now() || this.now() - a.preparedAt > 30000 || this.now() >= a.expiresAt) cellV3Fail("CELL_PARENT_ISSUANCE_LINEAGE_OR_TIME_INVALID");
    const body = { schemaVersion: 4 as const, protocol: "cell-parent-once-issuance-v4" as const, authority: a, marker: m }, intent = cellV3Freeze({ ...body, issuanceSha256: await sha256Hex(body) });
    if (!await this.transaction(s, [{ ConditionCheck: exact(work.dbIntent, 4, s.dbOperation) }, { ConditionCheck: absent(keys.marker) }, { ConditionCheck: absent(work.authority) },
      { ConditionCheck: absent(work.deleteIntent) }, { Put: put(work.issuanceIntent, 4, intent) }], signal)) return null;
    const claim = cellV3Freeze({ intent }); issuanceClaims.add(claim); return claim;
  }
  async publishIssuanceOnce(claim: ParentIssuanceClaimV4, s: ParentWorkflowSnapshotV4, stack: CellStackSnapshotV3, zero: CertifiedFailedCellBirthSnapshotV1 | CellParentTtlZeroV4, signal: AbortSignal) {
    if (!issuanceClaims.has(claim) || usedIssuance.has(claim) || !s.dbOperation || !s.issuanceIntent || s.marker || s.authority || s.deleteIntent || canonicalJson(claim.intent) !== canonicalJson(s.issuanceIntent)) cellV3Fail("CELL_PARENT_ISSUANCE_PRIVATE_ONCE_OWNERSHIP_REQUIRED");
    assertParentWorkflowV4(s, this.now(), true); const saved = claim.intent.authority, current = await prepareParentDeleteAuthorityV4(s.parent, s.dbOperation, stack, zero, this.now());
    if (current.databaseStateSha256 !== saved.databaseStateSha256 || current.inventorySha256 !== saved.inventorySha256 || this.now() >= saved.expiresAt ||
      (claim.intent.marker && (claim.intent.marker.zeroStateSha256 !== zero.stateSha256 || this.now() >= claim.intent.marker.expiresAt))) cellV3Fail("CELL_PARENT_ISSUANCE_PREWRITE_DRIFT");
    usedIssuance.add(claim); // Burn before any network attempt. Restart cannot re-mint.
    return this.transaction(s, [{ ConditionCheck: exact(work.dbIntent, 4, s.dbOperation) }, { ConditionCheck: exact(work.issuanceIntent, 4, claim.intent) },
      { ConditionCheck: absent(work.deleteIntent) }, ...(claim.intent.marker ? [{ Put: put(keys.marker, 3, claim.intent.marker) }] : [{ ConditionCheck: absent(keys.marker) }]),
      { Put: put(work.authority, 4, saved) }], signal);
  }
  async claimDeleteOnce(boundary: ParentDeleteBoundaryV4, signal: AbortSignal): Promise<ParentDeleteClaimV4 | null> {
    if (!boundaries.has(boundary)) cellV3Fail("CELL_PARENT_DELETE_BOUNDARY_PRIVATE_PROOF_REQUIRED"); const s = boundary.snapshot;
    if (!s.authority || !s.dbOperation || s.deleteIntent || s.deleteReceipt) cellV3Fail("CELL_PARENT_DELETE_SLOT_OCCUPIED");
    const intent = await deleteIntent(s.authority, this.now());
    if (!await this.transaction(s, [{ ConditionCheck: exact(work.dbIntent, 4, s.dbOperation) }, { ConditionCheck: exact(work.authority, 4, s.authority) },
      { ConditionCheck: s.marker ? exact(keys.marker, 3, s.marker) : absent(keys.marker) }, { ConditionCheck: absent(work.deleteReceipt) }, { Put: put(work.deleteIntent, 4, intent) }], signal)) return null;
    const claim = cellV3Freeze({ snapshot: s, intent }); deleteClaims.add(claim); return claim;
  }
  private async writeReceiptOnce(s: ParentWorkflowSnapshotV4, kind: "db" | "delete", outcome: string, resultSha256: string | null, signal: AbortSignal) {
    const op = kind === "db" ? s.dbOperation : s.deleteIntent; if (!op || (kind === "db" ? s.dbReceipt : s.deleteReceipt) ||
      !["RETURNED_REQUIRES_READ", "UNCERTAIN_INSPECT_ONLY", "DELETE_COMPLETE_TOKEN_MATCHED", "DELETE_FAILED_TOKEN_MATCHED"].includes(outcome) || (resultSha256 !== null && !digest.test(resultSha256))) cellV3Fail("CELL_PARENT_RECEIPT_INPUT_INVALID");
    const body = { schemaVersion: 4, protocol: kind === "db" ? "cell-parent-db-receipt-v4" : "cell-parent-delete-receipt-v4", parentSha256: s.parent.record.parentSha256,
      boundSha256: kind === "db" ? s.dbOperation!.operationSha256 : s.deleteIntent!.intentSha256, outcome, resultSha256, observedAt: cellV3Clock(this.now()) }, receipt = { ...body, receiptSha256: await sha256Hex(body) };
    return this.transaction(s, [{ ConditionCheck: exact(kind === "db" ? work.dbIntent : work.deleteIntent, 4, op) }, { Put: put(kind === "db" ? work.dbReceipt : work.deleteReceipt, 4, receipt) }], signal, false);
  }
  async writeDbReceiptOnce(s: ParentWorkflowSnapshotV4, outcome: "RETURNED_REQUIRES_READ" | "UNCERTAIN_INSPECT_ONLY", resultSha256: string | null, signal: AbortSignal) {
    if (!["RETURNED_REQUIRES_READ", "UNCERTAIN_INSPECT_ONLY"].includes(outcome)) cellV3Fail("CELL_PARENT_DB_RECEIPT_OUTCOME_INVALID"); return this.writeReceiptOnce(s, "db", outcome, resultSha256, signal);
  }
  async writeObservedReceiptOnce(s: ParentWorkflowSnapshotV4, observation: CellParentDeleteObservationV4, signal: AbortSignal) {
    assertCellParentDeleteObservationV4(observation, s, this.now());
    if (!["DELETE_COMPLETE_TOKEN_MATCHED", "DELETE_FAILED_TOKEN_MATCHED"].includes(observation.outcome)) cellV3Fail("CELL_PARENT_DELETE_RECEIPT_TERMINAL_EVENT_REQUIRED");
    return this.writeReceiptOnce(s, "delete", observation.outcome, observation.observationSha256, signal);
  }
}
