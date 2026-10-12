import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { sha256Hex, canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { createCellParentSdkV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { CELL_PARENT_KEY_V4, CELL_PARENT_TABLE_ID_V4, CELL_PARENT_WORKFLOW_KEYS_V4 } from "../../../lib/deployments/execution/cell-birth-parent-v4.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "../../../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";
import { CELL_LIFECYCLE_COORDINATOR_V3 } from "../../../lib/deployments/cloudformation/shared-cell-stack-v3.ts";

// Read-only Source inventory, no policy/IAM/parent/Item/function write or Invoke,
// no Secret values, no database connections and no mutation approval inputs.
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9[b]?-parent-prestate-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_PARENT_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx" }); return sha256Hex(text); };
let stage = "CODE_BINDING";
try {
  const history = path.join(root, "techlong-f3c8-failed-birth-ddb-20261012-r2/code-binding.json"); if ((await lstat(history)).isSymbolicLink()) throw Error("CELL_PARENT_HISTORY_PATH_INVALID");
  const old = JSON.parse(await readFile(history, "utf8"));
  if (old.codeSha256 !== "49719dc5f6300bdc8b2042568bd093f246919ef1c53d29bb4a343d623e24fdc1" || old.pins.length !== 46 || await sha256Hex(old.pins) !== old.codeSha256) throw Error("CELL_PARENT_OLD46_BINDING_INVALID");
  for (const p of old.pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_PARENT_OLD46_BINDING_DRIFT");
  const files = [...old.pins.map(p => p.file), "lib/deployments/execution/cell-birth-parent-v4.ts", "lib/deployments/execution/aws-sdk-cell-birth-parent-installation-v4.ts",
    "lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts", "lib/deployments/execution/prepared-cell-birth-parent-root-v4.ts", "ops/aws-sandbox/lambda/cell-birth-coordinator-v4.ts",
    "ops/aws-sandbox/scripts/build-cell-birth-parent-v4.mjs", "ops/aws-sandbox/scripts/review-cell-birth-parent-v4.mjs",
    "lib/deployments/execution/neon-cell-parent-control-v4.ts", "lib/deployments/execution/cell-parent-cleanup-v4.ts",
    "lib/deployments/execution/aws-sdk-cell-parent-delete-v4.ts", "lib/deployments/execution/cell-parent-runtime-material-v4.ts",
    "lib/deployments/execution/prepared-cell-parent-cleanup-runtime-v4.ts"];
  const pins = []; for (const file of files) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256 }); stage = "SOURCE_READONLY_INVENTORY";
  const cfg = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }, credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg }), clients = createCellParentSdkV4(credentials);
  let observed;
  try {
    const { installation: s, registry: r } = clients, signal = AbortSignal.timeout(45000), call = (client, Command, input) => client.send(new Command(input), { abortSignal: signal });
    const identity = async () => { const i = await call(s.sts, s.commands.identity, {}); if (i.Account !== "402010193138" || i.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || i.UserId !== "AIDAV3GNMXTZEO7SHLC2X") throw Error("CELL_PARENT_SOURCE_IDENTITY_INVALID"); };
    await identity();
    const readParent = async () => { const keys = [CELL_PARENT_KEY_V4, ...Object.values(CELL_PARENT_WORKFLOW_KEYS_V4)], v = await call(r.ddb, r.commands.transactGet, { TransactItems: keys.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) });
      if (!Array.isArray(v.Responses) || v.Responses.length !== keys.length) throw Error("CELL_PARENT_PRESTATE_RESPONSE_INVALID"); return v.Responses.map(x => x.Item ?? null); };
    const before = await readParent(), meta = await call(s.ddb, s.commands.table, { TableName: table }), t = meta.Table;
    if (!t || t.TableArn !== table || t.TableId !== CELL_PARENT_TABLE_ID_V4 || t.TableStatus !== "ACTIVE" || canonicalJson(t.KeySchema) !== canonicalJson([{ AttributeName: "authority_key", KeyType: "HASH" }])) throw Error("CELL_PARENT_PRESTATE_TABLE_DRIFT");
    const inspect = async (client, Command, input, absentError) => {
      try { return { state: "PRESENT", value: await call(client, Command, input) }; }
      catch (e) { if (e.name === absentError) return { state: "ABSENT", value: null }; if (["AccessDeniedException", "AccessDenied"].includes(e.name)) return { state: "READ_NOT_PERMITTED", value: null }; throw e; }
    };
    const policy = await inspect(s.ddb, s.commands.tablePolicy, { ResourceArn: table }, "PolicyNotFoundException"),
      role = await inspect(s.iam, s.commands.role, { RoleName: "TechlongSandboxCellLifecycleCoordinatorRoleV3" }, "NoSuchEntityException"),
      fn = await inspect(s.lambda, s.commands.functionConfig, { FunctionName: CELL_LIFECYCLE_COORDINATOR_V3, Qualifier: "$LATEST" }, "ResourceNotFoundException");
    const after = await readParent(); await identity(); if (canonicalJson(before) !== canonicalJson(after)) throw Error("CELL_PARENT_PRESTATE_PARENT_DRIFT");
    let policySha256 = null; if (policy.value) { if (typeof policy.value.Policy !== "string") throw Error("CELL_PARENT_PRESTATE_POLICY_JSON_INVALID"); policySha256 = await sha256Hex(JSON.parse(policy.value.Policy)); }
    observed = { observedAt: new Date().toISOString(), tableArn: table, tableId: t.TableId, tableStatus: t.TableStatus, parentKey: CELL_PARENT_KEY_V4,
      parentState: after[0] ? "PRESENT_REQUIRES_REVIEW" : "ABSENT", parentItemSha256: after[0] ? await sha256Hex(after[0]) : null,
      workflowSlots: Object.values(CELL_PARENT_WORKFLOW_KEYS_V4).map((key, i) => ({ key, state: after[i + 1] ? "PRESENT_REQUIRES_REVIEW" : "ABSENT" })),
      independentParentTransactionalReads: 2, sourceIdentityVerifiedBeforeAndAfter: true,
      tablePolicyState: policy.state, tablePolicyRevisionId: policy.value?.RevisionId ?? null, tablePolicySha256: policySha256,
      coordinatorRoleState: role.state, coordinatorRoleId: role.value?.Role?.RoleId ?? null,
      coordinatorFunctionState: fn.state, coordinatorFunctionCodeSha256: fn.value?.CodeSha256 ?? null, coordinatorFunctionRevisionId: fn.value?.RevisionId ?? null,
      fullRuntimeInstallationProofProduced: false, effectiveDataPlaneDenyProved: false, actualGuardedProvisionCloudAcceptancePerformed: false };
  } finally { clients.dispose(); }
  stage = "FINAL_CODE_BINDING";
  for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_PARENT_FINAL_CODE_BINDING_DRIFT");
  const report = { schemaVersion: 4, phase: "F3c9b_INLINE_FAILURE_TTL_ONCE_DELETE_AND_RECOVERY", outcome: "READONLY_PRESTATE_COMPLETE_NOT_INSTALLED", ...observed,
    old46CodeSha256: old.codeSha256, codeSha256, boundFileCount: pins.length, fullCleanupRootCompleted: true, sourceRegistrarShipped: false, realCleanupCloudAcceptancePerformed: false,
    sourceWindowOrFreezePolicyInstalled: false, mutationApprovalManifestCreated: false, registrationAuthorized: false, iamInstallationAuthorized: false,
    cellDeploymentAuthorized: false, runtimeEnabled: false, awsResourceWrites: 0, iamWrites: 0, authorityItemWrites: 0, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0 };
  const reportFileSha256 = await save("parent-prestate-review.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: await realpath(out) }, null, 2));
} catch (e) {
  const safeCode = /^[A-Z0-9_]{4,120}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  const report = { outcome: "READONLY_PRESTATE_INCOMPLETE", stage, safeCode, noRawProviderDiagnosticsPersisted: true, awsResourceWrites: 0, iamWrites: 0,
    authorityItemWrites: 0, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0, automaticWriteRetryAuthorized: false };
  await save("read-only-failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
}
