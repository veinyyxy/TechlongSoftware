import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Clock, cellV3Fail, cellV3Freeze, CELL_LIFECYCLE_COORDINATOR_V3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { CELL_BIRTH_COORDINATOR_ROLE_V3 } from "./cell-birth-registration-v3.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { CELL_PARENT_TABLE_ID_V4, CELL_PARENT_BOUNDARY_V4, CELL_PARENT_INLINE_V4, cellParentIamDocumentsV4, cellParentTableFreezePolicyV4,
  validateCellParentBindingV4, type CellParentRuntimeBindingV4 } from "./cell-birth-parent-v4.ts";

interface Client { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> }
type Command = new (input: Record<string, unknown>) => unknown;
export interface CellParentInstallationSdkV4 {
  sts: Client; ddb: Client; iam: Client; lambda: Client;
  commands: { identity: Command; table: Command; tablePolicy: Command; role: Command; inlineNames: Command; attached: Command;
    inline: Command; boundary: Command; boundaryVersion: Command; functionConfig: Command };
}
export type CellParentInstallationProfileV4 = "source_inspection" | "lifecycle_coordinator";
export interface CellParentLocalRuntimeV4 { bundleSha256: string; functionName: string; functionVersion: string; invokedFunctionArn: string }
export interface CellParentInstallationV4 {
  schemaVersion: 4; protocol: "live-cell-parent-installation-v4"; profile: CellParentInstallationProfileV4;
  stackId: string; binding: Readonly<CellParentRuntimeBindingV4>; observedAt: number; metadataSha256: string;
  stableDoubleRead: true; policyReadEventuallyConsistent: true; effectiveDataPlaneDenyProved: false;
}
const proofs = new WeakSet<object>();
function decodePolicy(raw: unknown) {
  if (typeof raw !== "string") { if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw; cellV3Fail("CELL_PARENT_POLICY_DOCUMENT_INVALID"); }
  try { return JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)); } catch { return cellV3Fail("CELL_PARENT_POLICY_DOCUMENT_INVALID"); }
}
export function assertCellParentInstallationV4(v: CellParentInstallationV4, now: number, requireRuntime = false) {
  cellV3Clock(now); if (!proofs.has(v) || v.observedAt > now || now - v.observedAt > 30000 || (requireRuntime && v.profile !== "lifecycle_coordinator")) cellV3Fail("CELL_PARENT_INSTALLATION_PROVENANCE_OR_FRESHNESS_INVALID");
}
/** No IAM/Lambda/DDB writes or secret reads. Metadata is not a data-plane deny
 * acceptance test: GetResourcePolicy is eventually consistent. Runtime also
 * compares its actual local bundle bytes to the approved bundle hash; caller
 * event/env digests cannot stand in for that comparison. */
export class AwsSdkCellParentInstallationReaderV4 {
  private readonly sdk: CellParentInstallationSdkV4; private readonly profile: CellParentInstallationProfileV4; private readonly now: () => number;
  constructor(sdk: CellParentInstallationSdkV4, profile: CellParentInstallationProfileV4, now: () => number = Date.now) {
    if (!["source_inspection", "lifecycle_coordinator"].includes(profile)) cellV3Fail("CELL_PARENT_INSTALLATION_PROFILE_INVALID");
    const client = (c: Client) => Object.freeze({ send: c.send.bind(c) });
    this.sdk = Object.freeze({ sts: client(sdk.sts), ddb: client(sdk.ddb), iam: client(sdk.iam), lambda: client(sdk.lambda), commands: Object.freeze({ ...sdk.commands }) });
    this.profile = profile; this.now = now;
  }
  private async identity(roleId: string, signal: AbortSignal) {
    signal.throwIfAborted(); const r = await this.sdk.sts.send(new this.sdk.commands.identity({}), { abortSignal: signal }); signal.throwIfAborted();
    if (r.Account !== "402010193138") cellV3Fail("CELL_PARENT_INSTALLATION_IDENTITY_INVALID");
    if (this.profile === "source_inspection") {
      if (r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") cellV3Fail("CELL_PARENT_INSTALLATION_IDENTITY_INVALID");
    } else if (!/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellLifecycleCoordinatorRoleV3\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(String(r.Arn)) ||
      r.UserId !== `${roleId}:${String(r.Arn).split("/").at(-1)}`) cellV3Fail("CELL_PARENT_INSTALLATION_IDENTITY_INVALID");
  }
  private async collect(binding: CellParentRuntimeBindingV4, stackId: string, signal: AbortSignal) {
    const s = this.sdk, c = s.commands, send = async (client: Client, Command: Command, input: Record<string, unknown>) => {
      signal.throwIfAborted(); const r = await client.send(new Command(input), { abortSignal: signal }); signal.throwIfAborted(); return r;
    };
    const t = (await send(s.ddb, c.table, { TableName: table })).Table as Record<string, unknown>;
    if (!t || t.TableArn !== table || t.TableId !== CELL_PARENT_TABLE_ID_V4 || t.TableStatus !== "ACTIVE" || t.GlobalTableVersion !== undefined ||
      (Array.isArray(t.Replicas) && t.Replicas.length) || canonicalJson(t.KeySchema) !== canonicalJson([{ AttributeName: "authority_key", KeyType: "HASH" }])) cellV3Fail("CELL_PARENT_TABLE_ID_OR_SCHEMA_DRIFT");
    const p = await send(s.ddb, c.tablePolicy, { ResourceArn: table });
    if (p.RevisionId !== binding.tablePolicyRevisionId || await sha256Hex(decodePolicy(p.Policy)) !== binding.tablePolicySha256 ||
      binding.tablePolicySha256 !== await sha256Hex(cellParentTableFreezePolicyV4(binding.sourceWindowClosesAt))) cellV3Fail("CELL_PARENT_TABLE_FREEZE_NOT_OBSERVED");
    const roleName = "TechlongSandboxCellLifecycleCoordinatorRoleV3", r = (await send(s.iam, c.role, { RoleName: roleName })).Role as Record<string, unknown>;
    const expected = cellParentIamDocumentsV4(stackId);
    if (!r || r.Arn !== CELL_BIRTH_COORDINATOR_ROLE_V3 || r.RoleId !== binding.roleId ||
      (r.PermissionsBoundary as Record<string, unknown>)?.PermissionsBoundaryArn !== CELL_PARENT_BOUNDARY_V4 ||
      canonicalJson(decodePolicy(r.AssumeRolePolicyDocument)) !== canonicalJson(expected.trust)) cellV3Fail("CELL_PARENT_ROLE_OR_TRUST_DRIFT");
    const names = await send(s.iam, c.inlineNames, { RoleName: roleName }), attached = await send(s.iam, c.attached, { RoleName: roleName });
    // Exactly one inline and no attached managed policy; pagination is not
    // silently treated as an empty remainder.
    if (names.IsTruncated !== false || attached.IsTruncated !== false || names.Marker !== undefined || attached.Marker !== undefined ||
      canonicalJson(names.PolicyNames) !== canonicalJson([CELL_PARENT_INLINE_V4]) || canonicalJson(attached.AttachedPolicies) !== "[]") cellV3Fail("CELL_PARENT_EXTRA_OR_PARTIAL_ROLE_POLICIES");
    const i = await send(s.iam, c.inline, { RoleName: roleName, PolicyName: CELL_PARENT_INLINE_V4 });
    if (i.RoleName !== roleName || i.PolicyName !== CELL_PARENT_INLINE_V4 || canonicalJson(decodePolicy(i.PolicyDocument)) !== canonicalJson(expected.inline)) cellV3Fail("CELL_PARENT_INLINE_POLICY_DRIFT");
    const b = (await send(s.iam, c.boundary, { PolicyArn: CELL_PARENT_BOUNDARY_V4 })).Policy as Record<string, unknown>;
    if (!b || b.Arn !== CELL_PARENT_BOUNDARY_V4 || b.DefaultVersionId !== binding.boundaryVersionId) cellV3Fail("CELL_PARENT_BOUNDARY_VERSION_DRIFT");
    const v = (await send(s.iam, c.boundaryVersion, { PolicyArn: CELL_PARENT_BOUNDARY_V4, VersionId: binding.boundaryVersionId })).PolicyVersion as Record<string, unknown>;
    if (!v || v.VersionId !== binding.boundaryVersionId || v.IsDefaultVersion !== true || canonicalJson(decodePolicy(v.Document)) !== canonicalJson(expected.boundary)) cellV3Fail("CELL_PARENT_BOUNDARY_DOCUMENT_DRIFT");
    const f = await send(s.lambda, c.functionConfig, { FunctionName: CELL_LIFECYCLE_COORDINATOR_V3, Qualifier: "$LATEST" });
    if (f.FunctionArn !== CELL_LIFECYCLE_COORDINATOR_V3 || f.FunctionName !== "techlong-sandbox-cell-lifecycle-coordinator-v3" || f.Version !== "$LATEST" ||
      f.Role !== CELL_BIRTH_COORDINATOR_ROLE_V3 || f.CodeSha256 !== binding.zipCodeSha256Base64 || f.RevisionId !== binding.revisionId || f.Runtime !== "nodejs22.x" ||
      f.Handler !== "cell-birth-coordinator-v4.handler" || f.State !== "Active" || f.LastUpdateStatus !== "Successful" || f.PackageType !== "Zip" ||
      f.Timeout !== 120 || f.MemorySize !== 256 || canonicalJson(f.Architectures) !== canonicalJson(["x86_64"]) ||
      (f.Layers !== undefined && canonicalJson(f.Layers) !== "[]") || (f.Environment as { Error?: unknown })?.Error !== undefined ||
      Object.keys((f.Environment as { Variables?: Record<string, unknown> })?.Variables ?? {}).length ||
      ((f.VpcConfig as { SubnetIds?: unknown[] })?.SubnetIds?.length ?? 0) || ((f.VpcConfig as { SecurityGroupIds?: unknown[] })?.SecurityGroupIds?.length ?? 0)) cellV3Fail("CELL_PARENT_FUNCTION_CONFIG_OR_CODE_DRIFT");
    return { tableId: t.TableId, policyRevisionId: p.RevisionId, policySha256: binding.tablePolicySha256, roleId: r.RoleId,
      trustSha256: await sha256Hex(expected.trust), permissionSha256: await sha256Hex(expected.boundary), boundaryVersionId: v.VersionId,
      functionRevisionId: f.RevisionId, codeSha256Base64: f.CodeSha256, bundleSha256: binding.bundleSha256 };
  }
  async read(bindingInput: CellParentRuntimeBindingV4, stackId: string, signal: AbortSignal, local?: CellParentLocalRuntimeV4): Promise<CellParentInstallationV4> {
    const binding = validateCellParentBindingV4(bindingInput), start = cellV3Clock(this.now());
    if (this.profile === "lifecycle_coordinator" && (!local || local.bundleSha256 !== binding.bundleSha256 || local.functionName !== "techlong-sandbox-cell-lifecycle-coordinator-v3" ||
      local.functionVersion !== "$LATEST" || local.invokedFunctionArn !== CELL_LIFECYCLE_COORDINATOR_V3)) cellV3Fail("CELL_PARENT_LOCAL_RUNNING_BUNDLE_OR_CONTEXT_DRIFT");
    if (this.profile === "source_inspection" && local !== undefined) cellV3Fail("CELL_PARENT_SOURCE_CANNOT_CLAIM_RUNNING_CODE");
    if (this.profile === "lifecycle_coordinator" && start < binding.sourceWindowClosesAt) cellV3Fail("CELL_PARENT_SOURCE_WINDOW_NOT_CLOSED");
    await this.identity(binding.roleId, signal); const first = await this.collect(binding, stackId, signal), second = await this.collect(binding, stackId, signal); await this.identity(binding.roleId, signal);
    const done = cellV3Clock(this.now()); if (done < start || done - start > 30000 || canonicalJson(first) !== canonicalJson(second)) cellV3Fail("CELL_PARENT_INSTALLATION_READ_DRIFT_OR_STALE");
    const proof = cellV3Freeze({ schemaVersion: 4 as const, protocol: "live-cell-parent-installation-v4" as const, profile: this.profile, stackId, binding,
      observedAt: done, metadataSha256: await sha256Hex(second), stableDoubleRead: true as const, policyReadEventuallyConsistent: true as const, effectiveDataPlaneDenyProved: false as const }); proofs.add(proof); return proof;
  }
}
