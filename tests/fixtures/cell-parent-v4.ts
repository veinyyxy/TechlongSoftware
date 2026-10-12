import assert from "node:assert/strict";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { CELL_PARENT_KEY_V4 as key, CELL_PARENT_BOUNDARY_V4, CELL_PARENT_INLINE_V4, CELL_PARENT_TABLE_ID_V4,
  cellParentIamDocumentsV4, cellParentTableFreezePolicyV4, prepareCellBirthParentReviewV4, approveCellBirthParentRecordV4,
  type CellParentRuntimeBindingV4 } from "../../lib/deployments/execution/cell-birth-parent-v4.ts";
import { AwsSdkCellParentInstallationReaderV4, type CellParentInstallationSdkV4 } from "../../lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts";
import { AwsSdkCellParentRegistryReaderV4, AwsSdkCellParentProvisionPublisherV4, type CellParentRegistrySdkV4 } from "../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { createPreparedCellBirthParentRootV4 } from "../../lib/deployments/execution/prepared-cell-birth-parent-root-v4.ts";
import { compileCellBirthDelegationV3 } from "../../lib/deployments/execution/cell-birth-lifecycle-v3.ts";
import { v3Fixture, v3Now, v3StackId } from "./cell-stack-v3.ts";
type Json = Record<string, unknown>;
const at = v3Now + 2000, roleId = "AROAV3GNMXTZTESTPAREN1", bundleSha = "b".repeat(64), signal = () => new AbortController().signal,
  functionArn = "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3" as const;
// Metadata/atomic SDK fixtures are NOT live IAM/table-policy acceptance proofs.
export async function cellParentFixtureV4() {
  let time = at, runtime = false, loseWrite = false;
  const items = new Map<string, Json>(), writes: Json[] = [], committed = new Map<string, string>(), readFaults: Record<string, unknown> = {};
  const binding: CellParentRuntimeBindingV4 = { functionArn, functionVersion: "$LATEST", revisionId: "fixture-revision-123456", zipCodeSha256Base64: Buffer.alloc(32, 1).toString("base64"),
    bundleSha256: bundleSha, roleId, boundaryVersionId: "v1", tablePolicyRevisionId: "12345", sourceWindowClosesAt: at + 60000,
    tablePolicySha256: await sha256Hex(cellParentTableFreezePolicyV4(at + 60000)) };
  const docs = cellParentIamDocumentsV4(v3StackId), commands = Object.fromEntries(["identity", "table", "tablePolicy", "role", "inlineNames", "attached", "inline", "boundary", "boundaryVersion", "functionConfig", "transactGet", "transactWrite"].map(kind => [kind, class { kind = kind; input: Json; constructor(input: Json) { this.input = input; } }])) as unknown as CellParentInstallationSdkV4["commands"] & CellParentRegistrySdkV4["commands"];
  const data: Record<string, Json> = {
    table: { Table: { TableArn: "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority", TableId: CELL_PARENT_TABLE_ID_V4, TableStatus: "ACTIVE", KeySchema: [{ AttributeName: "authority_key", KeyType: "HASH" }] } },
    tablePolicy: { Policy: canonicalJson(cellParentTableFreezePolicyV4(binding.sourceWindowClosesAt)), RevisionId: binding.tablePolicyRevisionId },
    role: { Role: { Arn: "arn:aws:iam::402010193138:role/TechlongSandboxCellLifecycleCoordinatorRoleV3", RoleId: roleId, AssumeRolePolicyDocument: encodeURIComponent(canonicalJson(docs.trust)), PermissionsBoundary: { PermissionsBoundaryArn: CELL_PARENT_BOUNDARY_V4 } } },
    inlineNames: { PolicyNames: [CELL_PARENT_INLINE_V4], IsTruncated: false }, attached: { AttachedPolicies: [], IsTruncated: false },
    inline: { RoleName: "TechlongSandboxCellLifecycleCoordinatorRoleV3", PolicyName: CELL_PARENT_INLINE_V4, PolicyDocument: encodeURIComponent(canonicalJson(docs.inline)) },
    boundary: { Policy: { Arn: CELL_PARENT_BOUNDARY_V4, DefaultVersionId: "v1" } },
    boundaryVersion: { PolicyVersion: { VersionId: "v1", IsDefaultVersion: true, Document: encodeURIComponent(canonicalJson(docs.boundary)) } },
    functionConfig: { FunctionArn: functionArn, FunctionName: "techlong-sandbox-cell-lifecycle-coordinator-v3", Version: "$LATEST", Role: "arn:aws:iam::402010193138:role/TechlongSandboxCellLifecycleCoordinatorRoleV3",
      CodeSha256: binding.zipCodeSha256Base64, RevisionId: binding.revisionId, Runtime: "nodejs22.x", Handler: "cell-birth-coordinator-v4.handler", State: "Active", LastUpdateStatus: "Successful", PackageType: "Zip", Timeout: 120, MemorySize: 256, Architectures: ["x86_64"] },
  };
  const send = async (raw: unknown) => {
    const c = raw as { kind: string; input: Json };
    if (c.kind === "identity") return runtime ? { Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellLifecycleCoordinatorRoleV3/fixture-session", UserId: `${readFaults.roleId ?? roleId}:fixture-session` } :
      { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: "AIDAV3GNMXTZEO7SHLC2X" };
    if (c.kind === "transactGet") return { Responses: (c.input.TransactItems as Json[]).map(a => { const k = String(((a.Get as Json).Key as Json).authority_key), v = items.get(k); return v ? { Item: structuredClone(v) } : {}; }) };
    if (c.kind === "transactWrite") {
      writes.push(structuredClone(c.input)); const token = String(c.input.ClientRequestToken), text = canonicalJson(c.input);
      if (committed.has(token)) { assert.equal(committed.get(token), text); return {}; }
      const touched = new Set<string>(), actions = c.input.TransactItems as Json[];
      for (const a of actions) { const p = a.Put as Json | undefined, x = (p ?? a.ConditionCheck) as Json, k = String(p ? (p.Item as Json).authority_key : (x.Key as Json).authority_key);
        assert.equal(touched.has(k), false); touched.add(k); const old = items.get(k);
        if (x.ConditionExpression === "attribute_not_exists(#key)") { if (old) throw Error("occupied"); }
        else { const vals = x.ExpressionAttributeValues as Json; if (!old || old.schema_version !== vals[":schema"] || old.record_json !== vals[":json"] || (vals[":rev"] !== undefined && old.revision !== vals[":rev"])) throw Error("changed"); }
      }
      for (const a of actions) if (a.Put) { const v = (a.Put as Json).Item as Json; items.set(String(v.authority_key), structuredClone(v)); }
      committed.set(token, text); if (loseWrite) throw Error("private diagnostics"); return {};
    }
    if (!data[c.kind]) throw Error("unexpected fixture command"); return structuredClone(data[c.kind]);
  };
  const client = { send }, installationSdk: CellParentInstallationSdkV4 = { sts: client, iam: client, ddb: client, lambda: client, commands }, registrySdk: CellParentRegistrySdkV4 = { sts: client, ddb: client, commands };
  const source = await v3Fixture("RESERVED", "CREATE_COMPLETE", "source_inspection"), reserved = await source.read(); assert.ok("protocol" in reserved);
  const delegation = await compileCellBirthDelegationV3({ plan: source.plan, reserved, coordinatorCodeSha256: bundleSha, coordinatorRoleId: roleId, now: at });
  const sourceMeta = new AwsSdkCellParentInstallationReaderV4(installationSdk, "source_inspection", () => time), installedMeta = await sourceMeta.read(binding, v3StackId, signal());
  const review = await prepareCellBirthParentReviewV4({ plan: source.plan, reserved, delegation, installation: installedMeta, failedProtectionSha256: "e".repeat(64), now: at });
  const record = await approveCellBirthParentRecordV4({ review, approvedManifestSha256: review.manifestSha256, now: at });
  items.set(key, { authority_key: key, schema_version: 4, record_json: canonicalJson(record) });
  runtime = true; time = binding.sourceWindowClosesAt;
  const local = { bundleSha256: bundleSha, functionName: "techlong-sandbox-cell-lifecycle-coordinator-v3", functionVersion: "$LATEST", invokedFunctionArn: functionArn },
    runtimeMeta = new AwsSdkCellParentInstallationReaderV4(installationSdk, "lifecycle_coordinator", () => time),
    registry = new AwsSdkCellParentRegistryReaderV4(registrySdk, runtimeMeta, "lifecycle_coordinator", local, () => time), paid = await v3Fixture("PAID", "UPDATE_COMPLETE", "lifecycle_coordinator"); paid.setTime(time);
  const publisher = new AwsSdkCellParentProvisionPublisherV4(registrySdk, registry, paid.reader, () => time), root = createPreparedCellBirthParentRootV4({ registry, publisher, stack: paid.reader, now: () => time }),
    event = { schemaVersion: 3, action: "reconcile_approved_cell_birth_v3", birthIntentSha256: source.plan.birthIntentSha256, stackId: v3StackId };
  return { now: () => time, binding, data, items, writes, registrySdk, runtimeMeta, local, source, reserved, delegation, installedMeta, review, record, registry, paid, publisher, root, event, readFaults,
    setTime: (n: number) => { time = n; paid.setTime(n); }, loseWrite: () => { loseWrite = true; }, useSource: () => { runtime = false; } };
}
