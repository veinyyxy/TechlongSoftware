import { randomUUID } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, GetRoleCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand, GetRolePolicyCommand, GetPolicyCommand, GetPolicyVersionCommand } from "@aws-sdk/client-iam";
import { DynamoDBClient, DescribeTableCommand, GetResourcePolicyCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactGetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { canonicalJson } from "./hash.ts";
import { cellV3Clock, cellV3Exact, cellV3Fail, cellV3Freeze, CELL_LIFECYCLE_COORDINATOR_V3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellStackEvidenceV3, compileV3ProvisionPredecessor } from "./aws-sdk-cell-stack-evidence-v3.ts";
import { validateCellBirthTickV3 } from "./cell-birth-lifecycle-v3.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { validateSharedCellAuthorityItem, type SharedCellAuthorityItem } from "./shared-cell-cleanup-authority.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 as keys, prepareFailedBirthGuardedPublicationV1 } from "./failed-cell-birth-ddb-v1.ts";
import { CELL_PARENT_KEY_V4, CELL_PARENT_WORKFLOW_KEYS_V4 as workKeys, decodeCellBirthParentRecordV4, type CellBirthParentRecordV4 } from "./cell-birth-parent-v4.ts";
import { AwsSdkCellParentInstallationReaderV4, assertCellParentInstallationV4, type CellParentInstallationSdkV4, type CellParentInstallationV4,
  type CellParentInstallationProfileV4, type CellParentLocalRuntimeV4 } from "./aws-sdk-cell-birth-parent-installation-v4.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
export interface CellParentRegistrySdkV4 { sts: Client; ddb: Client; commands: { identity: Command; transactGet: Command; transactWrite: Command } }
export interface InstalledCellParentV4 {
  schemaVersion: 4; protocol: "strong-installed-cell-parent-v4"; profile: CellParentInstallationProfileV4; observedAt: number;
  record: Readonly<CellBirthParentRecordV4>; installation: CellParentInstallationV4;
  provision: Readonly<SharedCellAuthorityItem> | null; activationPresent: boolean; failedMarkerPresent: boolean; compensationIntentPresent: boolean; compensationReceiptPresent: boolean;
  cleanupIntentPresent: boolean; deleteIntentPresent: boolean; cleanupAuthorityPresent: boolean; issuanceIntentPresent: boolean;
}
const proofs = new WeakSet<object>();
function pin(s: CellParentRegistrySdkV4) { return Object.freeze({ sts: Object.freeze({ send: s.sts.send.bind(s.sts) }), ddb: Object.freeze({ send: s.ddb.send.bind(s.ddb) }), commands: Object.freeze({ ...s.commands }) }); }
function parseParent(raw: unknown) {
  const v = raw as Record<string, unknown>;
  if (!cellV3Exact(v, ["authority_key", "schema_version", "record_json"]) || v.authority_key !== CELL_PARENT_KEY_V4 || v.schema_version !== 4 || typeof v.record_json !== "string" || Buffer.byteLength(v.record_json) > 131072) cellV3Fail("CELL_PARENT_STORED_ITEM_INVALID");
  let r: unknown; try { r = JSON.parse(v.record_json); } catch { return cellV3Fail("CELL_PARENT_STORED_JSON_INVALID"); }
  if (canonicalJson(r) !== v.record_json) cellV3Fail("CELL_PARENT_STORED_JSON_INVALID"); return r;
}
async function identity(s: ReturnType<typeof pin>, profile: CellParentInstallationProfileV4, signal: AbortSignal, roleId?: string) {
  signal.throwIfAborted(); const r = await s.sts.send(new s.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
  if (r.Account !== "402010193138") cellV3Fail("CELL_PARENT_REGISTRY_IDENTITY_INVALID");
  if (profile === "source_inspection") {
    if (r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") cellV3Fail("CELL_PARENT_REGISTRY_IDENTITY_INVALID");
  } else if (!/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellLifecycleCoordinatorRoleV3\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(String(r.Arn)) ||
    typeof r.UserId !== "string" || (roleId !== undefined && r.UserId !== `${roleId}:${String(r.Arn).split("/").at(-1)}`)) cellV3Fail("CELL_PARENT_REGISTRY_IDENTITY_INVALID");
}
export function assertInstalledCellParentV4(v: InstalledCellParentV4, now: number, runtime = false) {
  cellV3Clock(now); if (!proofs.has(v) || v.observedAt > now || now - v.observedAt > 30000) cellV3Fail("CELL_PARENT_INSTALLED_PROVENANCE_OR_FRESHNESS_INVALID");
  assertCellParentInstallationV4(v.installation, now, runtime);
  const d = v.record.manifest.delegation;
  if (runtime && (v.profile !== "lifecycle_coordinator" || now < v.record.approvedAt || now < d.notBefore || now >= d.notAfter)) cellV3Fail("CELL_PARENT_RUNTIME_APPROVAL_WINDOW_INVALID");
}
/** A stored JSON record alone never authorizes publication. Runtime needs fresh
 * table/role/policy/config metadata plus its actual local bundle hash. */
export class AwsSdkCellParentRegistryReaderV4 {
  private readonly sdk: ReturnType<typeof pin>; private readonly installation: AwsSdkCellParentInstallationReaderV4;
  private readonly profile: CellParentInstallationProfileV4; private readonly local?: CellParentLocalRuntimeV4; private readonly now: () => number;
  constructor(sdk: CellParentRegistrySdkV4, installation: AwsSdkCellParentInstallationReaderV4, profile: CellParentInstallationProfileV4,
    local?: CellParentLocalRuntimeV4, now: () => number = Date.now) {
    if (!["source_inspection", "lifecycle_coordinator"].includes(profile) || (profile === "lifecycle_coordinator" ? !local : local !== undefined)) cellV3Fail("CELL_PARENT_REGISTRY_PROFILE_INVALID");
    this.sdk = pin(sdk); this.installation = installation; this.profile = profile; this.local = local ? Object.freeze({ ...local }) : undefined; this.now = now;
  }
  private async snapshot(signal: AbortSignal) {
    const k = [CELL_PARENT_KEY_V4, keys.provision, keys.activation, keys.marker, keys.intent, keys.receipt, workKeys.dbIntent, workKeys.deleteIntent, workKeys.authority, workKeys.issuanceIntent];
    const r = await this.sdk.ddb.send(new this.sdk.commands.transactGet({ TransactItems: k.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) }), { abortSignal: signal }); signal.throwIfAborted();
    const list = r.Responses as { Item?: unknown }[];
    if (!Array.isArray(list) || list.length !== k.length || list.some((x, i) => !x || !cellV3Exact(x, x.Item === undefined ? [] : ["Item"]) ||
      (x.Item !== undefined && (!(x.Item as Record<string, unknown>) || (x.Item as Record<string, unknown>).authority_key !== k[i])))) cellV3Fail("CELL_PARENT_REGISTRY_TRANSACTION_INVALID");
    return list;
  }
  async readStrong(signal: AbortSignal): Promise<InstalledCellParentV4 | null> {
    const start = cellV3Clock(this.now()); await identity(this.sdk, this.profile, signal); const first = await this.snapshot(signal);
    if (first[0].Item === undefined) { await identity(this.sdk, this.profile, signal); if (cellV3Clock(this.now()) - start > 30000 || this.now() < start) cellV3Fail("CELL_PARENT_REGISTRY_READ_STALE"); return null; }
    const record = await decodeCellBirthParentRecordV4(parseParent(first[0].Item)), installation = await this.installation.read(record.manifest.runtimeBinding, record.manifest.delegation.stackId, signal, this.local);
    const second = await this.snapshot(signal); await identity(this.sdk, this.profile, signal, record.manifest.runtimeBinding.roleId);
    const done = cellV3Clock(this.now()); if (done < start || done - start > 30000 || canonicalJson(first) !== canonicalJson(second)) cellV3Fail("CELL_PARENT_REGISTRY_READ_DRIFT_OR_STALE");
    const provision = second[1].Item === undefined ? null : (await validateSharedCellAuthorityItem(second[1].Item as SharedCellAuthorityItem)).item;
    const v = cellV3Freeze({ schemaVersion: 4 as const, protocol: "strong-installed-cell-parent-v4" as const, profile: this.profile, observedAt: done, record, installation,
      provision, activationPresent: second[2].Item !== undefined, failedMarkerPresent: second[3].Item !== undefined,
      compensationIntentPresent: second[4].Item !== undefined, compensationReceiptPresent: second[5].Item !== undefined,
      cleanupIntentPresent: second[6].Item !== undefined, deleteIntentPresent: second[7].Item !== undefined, cleanupAuthorityPresent: second[8].Item !== undefined, issuanceIntentPresent: second[9].Item !== undefined }); proofs.add(v); return v;
  }
}
/** Real guarded publisher, no raw item/activation/event target accepted. It
 * recompiles the schema2 predecessor from current complete PAID evidence,
 * re-reads the full parent and binds that JSON in the same write transaction.
 * Every uncertain submission is inspect-only, not an application write retry. */
export class AwsSdkCellParentProvisionPublisherV4 {
  private readonly sdk: ReturnType<typeof pin>; private readonly registry: AwsSdkCellParentRegistryReaderV4; private readonly stack: AwsSdkCellStackEvidenceV3; private readonly now: () => number;
  constructor(sdk: CellParentRegistrySdkV4, registry: AwsSdkCellParentRegistryReaderV4, stack: AwsSdkCellStackEvidenceV3, now: () => number = Date.now) {
    this.sdk = pin(sdk); this.registry = registry; this.stack = stack; this.now = now;
  }
  async publishOnce(rawEvent: unknown, signal: AbortSignal) {
    const event = validateCellBirthTickV3(rawEvent), first = await this.registry.readStrong(signal);
    if (!first) cellV3Fail("CELL_PARENT_APPROVAL_ABSENT"); assertInstalledCellParentV4(first, this.now(), true); const r = first.record, d = r.manifest.delegation;
    if (event.birthIntentSha256 !== d.birthIntentSha256 || event.stackId !== d.stackId) cellV3Fail("CELL_PARENT_PUBLICATION_EVENT_DRIFT");
    if (first.provision) return { outcome: "PROVISION_SLOT_OCCUPIED_INSPECT_ONLY" as const, mutationPerformed: false, retryAuthorized: false, tenantRuntimeEnabled: false };
    if (first.activationPresent || first.failedMarkerPresent || first.compensationIntentPresent || first.compensationReceiptPresent || first.cleanupIntentPresent || first.deleteIntentPresent || first.cleanupAuthorityPresent || first.issuanceIntentPresent) cellV3Fail("CELL_PARENT_PUBLICATION_EXCLUSION_OCCUPIED");
    const s = await this.stack.read(r.manifest.plan, d.stackId, signal);
    if (!("protocol" in s) || s.profile !== "lifecycle_coordinator" || !s.completePaidStack || s.failedCreationOrPhase) cellV3Fail("CELL_PARENT_PUBLICATION_COMPLETE_PAID_REQUIRED");
    const candidate = await compileV3ProvisionPredecessor(r.manifest.plan, s, this.now()), next = await this.registry.readStrong(signal);
    if (!next || canonicalJson(next.record) !== canonicalJson(r)) cellV3Fail("CELL_PARENT_PREPUBLICATION_APPROVAL_DRIFT"); assertInstalledCellParentV4(next, this.now(), true);
    if (next.provision || next.activationPresent || next.failedMarkerPresent || next.compensationIntentPresent || next.compensationReceiptPresent || next.cleanupIntentPresent || next.deleteIntentPresent || next.cleanupAuthorityPresent || next.issuanceIntentPresent || s.observedAt > this.now() || this.now() - s.observedAt > 30000 || this.now() >= Date.parse(d.cellExpiresAt)) cellV3Fail("CELL_PARENT_PREPUBLICATION_EXCLUSION_OR_CLOCK_DRIFT");
    await identity(this.sdk, "lifecycle_coordinator", signal, r.manifest.runtimeBinding.roleId); assertInstalledCellParentV4(next, this.now(), true);
    if (s.observedAt > this.now() || this.now() - s.observedAt > 30000 || this.now() >= Date.parse(d.cellExpiresAt)) cellV3Fail("CELL_PARENT_PREPUBLICATION_EVIDENCE_STALE");
    const draft = prepareFailedBirthGuardedPublicationV1("provision", candidate.item); signal.throwIfAborted();
    try { await this.sdk.ddb.send(new this.sdk.commands.transactWrite({ ClientRequestToken: randomUUID(), TransactItems: [
      { ConditionCheck: { TableName: table, Key: { authority_key: CELL_PARENT_KEY_V4 }, ConditionExpression: "#schema = :schema AND #json = :json",
        ExpressionAttributeNames: { "#schema": "schema_version", "#json": "record_json" }, ExpressionAttributeValues: { ":schema": 4, ":json": canonicalJson(r) }, ReturnValuesOnConditionCheckFailure: "NONE" } },
      ...draft.TransactItems,
      { ConditionCheck: { TableName: table, Key: { authority_key: keys.activation }, ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" } },
      ...[workKeys.dbIntent, workKeys.deleteIntent, workKeys.authority, workKeys.issuanceIntent].map(authority_key => ({ ConditionCheck: { TableName: table, Key: { authority_key }, ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": "authority_key" }, ReturnValuesOnConditionCheckFailure: "NONE" } })),
    ] }), { abortSignal: signal }); signal.throwIfAborted(); return { outcome: "PROVISION_SUBMITTED_REQUIRES_INDEPENDENT_READ" as const, mutationPerformed: true, retryAuthorized: false, tenantRuntimeEnabled: false }; }
    catch { return { outcome: "PROVISION_SUBMISSION_UNCERTAIN_INSPECT_ONLY" as const, mutationPerformed: null, retryAuthorized: false, tenantRuntimeEnabled: false }; }
  }
}

/** Fixed signed GET using the already pinned Smithy runtime. No new SDK/version
 * or package-lock mutation; no arbitrary Lambda URL, method, alias or payload. */
export class CellParentFunctionConfigCommandV4 {
  readonly input: Record<string, unknown>;
  constructor(input: Record<string, unknown>) {
    if (!cellV3Exact(input, ["FunctionName", "Qualifier"]) || input.FunctionName !== CELL_LIFECYCLE_COORDINATOR_V3 || input.Qualifier !== "$LATEST") cellV3Fail("CELL_PARENT_FUNCTION_READ_TARGET_INVALID"); this.input = Object.freeze({ ...input });
  }
}
export function createCellParentSdkV4(credentials: unknown) {
  const config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1, credentials: credentials as never };
  const sts = new STSClient(config), iam = new IAMClient(config), ddb = new DynamoDBClient(config), doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: false } });
  const signer = new SignatureV4({ credentials: credentials as never, region: "ca-central-1", service: "lambda", sha256: Hash.bind(null, "sha256") });
  const lambda: Client = { async send(command, options) {
    if (!(command instanceof CellParentFunctionConfigCommandV4) || !options?.abortSignal) cellV3Fail("CELL_PARENT_LAMBDA_READ_CAPABILITY_INVALID"); options.abortSignal.throwIfAborted();
    const hostname = "lambda.ca-central-1.amazonaws.com", request = await signer.sign(new HttpRequest({ protocol: "https:", hostname, method: "GET",
      path: "/2015-03-31/functions/techlong-sandbox-cell-lifecycle-coordinator-v3/configuration", query: { Qualifier: "$LATEST" }, headers: { host: hostname } }));
    const response = await fetch(`https://${hostname}${request.path}?Qualifier=%24LATEST`, { method: "GET", headers: request.headers, redirect: "error", signal: options.abortSignal });
    const reader = response.body?.getReader(); if (!reader) cellV3Fail("CELL_PARENT_LAMBDA_RESPONSE_INVALID");
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > 131072) { await reader.cancel(); cellV3Fail("CELL_PARENT_LAMBDA_RESPONSE_TOO_LARGE"); } chunks.push(r.value); } } finally { reader.releaseLock(); }
    if (response.status !== 200) { const e = new Error("CELL_PARENT_LAMBDA_READ_FAILED"); e.name = response.status === 404 ? "ResourceNotFoundException" : response.status === 403 ? "AccessDeniedException" : "LambdaReadError"; throw e; }
    let parsed: unknown; try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return cellV3Fail("CELL_PARENT_LAMBDA_RESPONSE_INVALID"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) cellV3Fail("CELL_PARENT_LAMBDA_RESPONSE_INVALID"); options.abortSignal.throwIfAborted(); return parsed as Record<string, unknown>;
  } };
  const registry: CellParentRegistrySdkV4 = { sts: sts as unknown as Client, ddb: doc as unknown as Client,
    commands: { identity: GetCallerIdentityCommand as unknown as Command, transactGet: TransactGetCommand as unknown as Command, transactWrite: TransactWriteCommand as unknown as Command } };
  const installation: CellParentInstallationSdkV4 = { sts: sts as unknown as Client, iam: iam as unknown as Client, ddb: ddb as unknown as Client, lambda,
    commands: { identity: GetCallerIdentityCommand as unknown as Command, table: DescribeTableCommand as unknown as Command, tablePolicy: GetResourcePolicyCommand as unknown as Command,
      role: GetRoleCommand as unknown as Command, inlineNames: ListRolePoliciesCommand as unknown as Command, attached: ListAttachedRolePoliciesCommand as unknown as Command,
      inline: GetRolePolicyCommand as unknown as Command, boundary: GetPolicyCommand as unknown as Command, boundaryVersion: GetPolicyVersionCommand as unknown as Command, functionConfig: CellParentFunctionConfigCommandV4 } };
  return Object.freeze({ registry, installation, dispose: () => { sts.destroy(); iam.destroy(); doc.destroy(); } });
}
