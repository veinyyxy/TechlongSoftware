import { readFile, writeFile, mkdir, lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, GetRoleCommand, ListRolePoliciesCommand, GetRolePolicyCommand, ListAttachedRolePoliciesCommand, GetPolicyCommand, GetPolicyVersionCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { compileLiveDirectCostReadinessV1, VERIFIED_DIRECT_COST_OVERRIDE_V1 as pin } from "../../../lib/deployments/execution/cell-deployment-prerequisites-v1.ts";
import { DIRECT_COST_SCOPE_V1 as s } from "../../../lib/deployments/execution/direct-cost-controls-v1.ts";
import { createDirectCostRuntimeV1 } from "./direct-cost-controls-aws-v1.mjs";

// Review-only executable. No Run, IAM installer, Secret value, DB client,
// Lambda invocation, scheduler write or workload deployment entry point.
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c4-deployment-prerequisites-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_PREREQUISITE_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (name, v) => { const b = JSON.stringify(v, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx" }); return sha256Hex(b); };
const equal = (a, b) => canonicalJson(a) === canonicalJson(b), cfg = { region: s.region, maxAttempts: 1, ignoreConfiguredEndpointUrls: true }, execute = promisify(execFile);
const directDir = path.join(root, "techlong-f3c3d-direct-cost-controls-20261012-r1"), directSlot = path.join(root, s.permanentSlot);
const read = async (file, sha) => { if ((await lstat(file)).isSymbolicLink()) throw Error("CELL_PREREQUISITE_HISTORY_PATH_INVALID"); const b = await readFile(file, "utf8"); if (sha && await sha256Hex(b) !== sha) throw Error("CELL_PREREQUISITE_HISTORY_HASH_DRIFT"); return JSON.parse(b); };
let stage = "HISTORICAL_OVERRIDE_BINDING";
try {
  const m = await read(path.join(directDir, "review-manifest.json"), pin.manifestFileSha256), code = await read(path.join(directDir, "code-binding.json"));
  const ownFiles = [...code.pins.map(p => p.file), "lib/deployments/execution/cell-deployment-prerequisites-v1.ts", "lib/deployments/execution/tenant-lifecycle-prepared-review.ts",
    "lib/deployments/execution/tenant-lifecycle-prepared-contract.ts", "lib/deployments/execution/shared-cell-admission-fence.ts", "lib/deployments/execution/shared-cell-cleanup-authority.ts",
    "lib/deployments/execution/prepared-sealed-cell-drain-coordinator-v3.ts", "lib/deployments/execution/sealed-cell-cleanup-lambda-context-v3.ts", "ops/aws-sandbox/scripts/review-cell-deployment-prerequisites-v1.mjs"];
  const ownPins = []; for (const file of ownFiles) ownPins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  const ownCodeSha256 = await sha256Hex(ownPins); await save("code-binding.json", { pins: ownPins, codeSha256: ownCodeSha256 });
  const history = async () => {
    if (m.manifestSha256 !== pin.manifestSha256 || m.codeSha256 !== pin.codeSha256 || code.codeSha256 !== pin.codeSha256 || await sha256Hex(code.pins) !== pin.codeSha256) throw Error("CELL_PREREQUISITE_OVERRIDE_BINDING_INVALID");
    for (const p of ownPins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_PREREQUISITE_CODE_DRIFT");
    for (const p of code.pins) if (ownPins.find(x => x.file === p.file)?.sha256 !== p.sha256) throw Error("CELL_PREREQUISITE_OLD_CODE_DRIFT");
    if ((await lstat(directSlot)).isSymbolicLink()) throw Error("CELL_PREREQUISITE_HISTORY_PATH_INVALID");
    const names = ["approved-manifest.json", "budget-attempt.json", "budget-confirmed.json", "budget-verified.json", "explicit-override-verified.json", "table-attempt.json", "table-confirmed.json"];
    if (!equal((await readdir(directSlot)).sort(), names)) throw Error("CELL_PREREQUISITE_CONSUMED_SLOT_DRIFT");
    const expected = { "approved-manifest.json": m, "budget-attempt.json": { approved: pin.manifestSha256, budgetArn: s.budgetArn }, "budget-confirmed.json": { usd: 50 },
      "budget-verified.json": { usd: 50, cfnParameterUsd: 10, intentionalAmountDrift: true }, "table-attempt.json": { approved: pin.manifestSha256, tableId: s.tableId },
      "table-confirmed.json": { read: 100, write: 2 }, "explicit-override-verified.json": { settingsSha256: pin.settingsSha256, cfnOwnershipRetained: true, cfnAmountUsd: 10, actualBudgetUsd: 50, read: 100, write: 2 } };
    for (const n of names) if (!equal(await read(path.join(directSlot, n)), expected[n])) throw Error("CELL_PREREQUISITE_CONSUMED_SLOT_DRIFT");
    const r = await read(directDir + "-run/submission-receipt.json", pin.receiptFileSha256), v = await read(directDir + "-verify/independent-inspect.json", pin.independentInspectFileSha256);
    if (r.writeAttempts !== 2 || !r.slotConsumed || r.failureCode !== null || !v.targetVerified || v.settingsSha256 !== pin.settingsSha256 || v.observedAt >= m.expiresAt) throw Error("CELL_PREREQUISITE_OLD_EXECUTION_UNVERIFIED");
  };
  await history();
  const provider = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  const session = async () => { const credentials = await provider(), c = new STSClient({ ...cfg, credentials }); try { const id = await c.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
    if (id.Account !== s.accountId || id.Arn !== s.sourceArn || id.UserId !== s.sourceUserId) throw Error("CELL_PREREQUISITE_SOURCE_INVALID"); return credentials; } finally { c.destroy(); } };
  const client = async (Type, fn) => { const c = new Type({ ...cfg, credentials: await session() }); try { return await fn(c); } finally { c.destroy(); } };
  const send = (c, command) => c.send(command, { abortSignal: AbortSignal.timeout(15000) });
  const roleNames = ["TechlongSandboxTenantLifecycleTaskRole", "TechlongSandboxTaskExecutionRole"];
  stage = "READONLY_ROLE_AND_RUNTIME_INVENTORY";
  const roles = await client(IAMClient, async c => { const result = [];
    for (const name of roleNames) {
      const r = await send(c, new GetRoleCommand({ RoleName: name })); if (r.Role?.RoleName !== name || r.Role?.Arn !== `arn:aws:iam::${s.accountId}:role/${name}` || !r.Role.RoleId) throw Error("CELL_PREREQUISITE_ROLE_IDENTITY_INVALID");
      const inline = await send(c, new ListRolePoliciesCommand({ RoleName: name })), attached = await send(c, new ListAttachedRolePoliciesCommand({ RoleName: name }));
      if (inline.IsTruncated || attached.IsTruncated || !Array.isArray(inline.PolicyNames) || !Array.isArray(attached.AttachedPolicies)) throw Error("CELL_PREREQUISITE_ROLE_INVENTORY_TRUNCATED");
      const policies = [];
      for (const n of inline.PolicyNames.sort()) { const p = await send(c, new GetRolePolicyCommand({ RoleName: name, PolicyName: n })); const doc = typeof p.PolicyDocument === "string" ? JSON.parse(decodeURIComponent(p.PolicyDocument)) : p.PolicyDocument;
        if (p.RoleName !== name || p.PolicyName !== n || !doc) throw Error("CELL_PREREQUISITE_ROLE_POLICY_INVALID"); policies.push({ name: n, document: doc, sha256: await sha256Hex(doc) }); }
      const arn = r.Role.PermissionsBoundary?.PermissionsBoundaryArn; let boundary = null;
      if (arn) { const p = await send(c, new GetPolicyCommand({ PolicyArn: arn })); if (p.Policy?.Arn !== arn || !p.Policy.DefaultVersionId) throw Error("CELL_PREREQUISITE_BOUNDARY_INVALID");
        const v = await send(c, new GetPolicyVersionCommand({ PolicyArn: arn, VersionId: p.Policy.DefaultVersionId })); const doc = typeof v.PolicyVersion?.Document === "string" ? JSON.parse(decodeURIComponent(v.PolicyVersion.Document)) : v.PolicyVersion?.Document;
        if (v.PolicyVersion?.IsDefaultVersion !== true || !doc) throw Error("CELL_PREREQUISITE_BOUNDARY_INVALID"); boundary = { arn, defaultVersion: p.Policy.DefaultVersionId, sha256: await sha256Hex(doc), document: doc }; }
      const trust = typeof r.Role.AssumeRolePolicyDocument === "string" ? JSON.parse(decodeURIComponent(r.Role.AssumeRolePolicyDocument)) : r.Role.AssumeRolePolicyDocument;
      result.push({ name, arn: r.Role.Arn, roleId: r.Role.RoleId, maxSessionDuration: r.Role.MaxSessionDuration, trustSha256: await sha256Hex(trust), trust, boundary, inline: policies, attached: attached.AttachedPolicies.map(p => p.PolicyArn).sort() });
    } return result;
  });
  const activation = await client(DynamoDBClient, async c => { const r = await send(c, new GetItemCommand({ TableName: s.tableArn, Key: { authority_key: { S: "runtime:cell-sandbox-1:lifecycle-v2" } }, ConsistentRead: true })); return { key: "runtime:cell-sandbox-1:lifecycle-v2", present: !!r.Item, itemSha256: r.Item ? await sha256Hex(r.Item) : null }; });
  const native = async (service, op, args, absentCodes = []) => {
    if (!["lambda/get-function-configuration", "lambda/get-function-event-invoke-config", "kms/describe-key", "ecs/describe-clusters"].includes(`${service}/${op}`)) throw Error("CELL_PREREQUISITE_READ_COMMAND_REJECTED");
    const c = await session(); try { const r = await execute("aws", [service, op, ...args, "--region", s.region, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
      { windowsHide: true, timeout: 30000, maxBuffer: 2000000, env: { ...process.env, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey, AWS_SESSION_TOKEN: c.sessionToken,
        AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } }); return { present: true, data: JSON.parse(r.stdout) }; }
    catch (e) { const code = /\(([A-Za-z0-9]+)\)/.exec(e.stderr ?? "")?.[1]; if (absentCodes.includes(code)) return { present: false, data: null }; throw Error("CELL_PREREQUISITE_NATIVE_READ_UNVERIFIED"); }
  };
  const cleanup = [];
  for (const name of ["techlong-sandbox-cell-ttl-executor-v3", "techlong-sandbox-cell-drain-coordinator"]) {
    const r = await native("lambda", "get-function-configuration", ["--function-name", name]), asyncConfig = await native("lambda", "get-function-event-invoke-config", ["--function-name", name], ["ResourceNotFoundException"]);
    const f = r.data; if (f.FunctionArn !== `arn:aws:lambda:${s.region}:${s.accountId}:function:${name}`) throw Error("CELL_PREREQUISITE_FUNCTION_IDENTITY_INVALID");
    cleanup.push({ name, arn: f.FunctionArn, role: f.Role, awsCodeSha256Base64: f.CodeSha256, revisionId: f.RevisionId, state: f.State, lastUpdateStatus: f.LastUpdateStatus,
      asyncConfigPresent: asyncConfig.present, asynchronousDeliveryConfig: asyncConfig.data, automaticAuthorityIssuanceVerified: false, failedCreateCompensationVerified: false });
  }
  const kms = await native("kms", "describe-key", ["--key-id", "alias/aws/secretsmanager"]), cluster = await native("ecs", "describe-clusters", ["--clusters", "cell-sandbox-1"]);
  if (kms.data.KeyMetadata?.AWSAccountId !== s.accountId || !/^arn:aws:kms:ca-central-1:402010193138:key\/[a-f0-9-]{36}$/.test(kms.data.KeyMetadata.Arn ?? "")) throw Error("CELL_PREREQUISITE_KMS_IDENTITY_INVALID");
  const currentRoleReadSimulations = await client(IAMClient, async c => { const checks = [];
    for (const [action, resource, key] of [["dynamodb:GetItem", s.tableArn, "runtime:cell-sandbox-1:lifecycle-v2"], ["s3:GetObject", "arn:aws:s3:::techlong-sandbox-402010193138-ca-central-1-tenant-baselines/approved/1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a/baseline.dump", null]]) {
      const r = await send(c, new SimulatePrincipalPolicyCommand({ PolicySourceArn: roles[0].arn, ActionNames: [action], ResourceArns: [resource], ContextEntries: [
        { ContextKeyName: "aws:RequestedRegion", ContextKeyType: "string", ContextKeyValues: [s.region] }, ...(key ? [{ ContextKeyName: "dynamodb:LeadingKeys", ContextKeyType: "stringList", ContextKeyValues: [key] }] : [])] }));
      if (r.IsTruncated || r.EvaluationResults?.length !== 1) throw Error("CELL_PREREQUISITE_SIMULATION_UNVERIFIED"); checks.push({ action, resource, decision: r.EvaluationResults[0].EvalDecision, missingContext: r.EvaluationResults[0].MissingContextValues ?? [] });
    } return checks;
  });
  stage = "FRESH_LIVE_COST_OVERRIDE_READINESS";
  const runtime = createDirectCostRuntimeV1(m.recoveryManifest, path.join(root, "techlong-f3c3a-sandbox-cost-controls-v1-consumed"), path.join(root, "techlong-f3c3c-cost-stack-recovery-v1-consumed"), directSlot, history);
  const snapshot = await runtime.snapshot(false), cost = await compileLiveDirectCostReadinessV1(m, snapshot, await read(path.join(repo, "ops/aws-sandbox/cloudformation/guardrails.template.json")), Date.now());
  const snapshotFileSha256 = await save("read-only-snapshot.json", { cost: snapshot, roles, activation, cleanup, kmsKeyArn: kms.data.KeyMetadata.Arn, cluster, currentRoleReadSimulations });
  const result = { schemaVersion: 1, protocol: "cell-deployment-prerequisites-review-v1", observedAt: new Date().toISOString(), outcome: "COST_OVERRIDE_READY_WORKLOAD_PERMISSIONS_AND_CLEANUP_NOT_READY",
    codeSha256: ownCodeSha256, snapshotFileSha256, cost,
    roles: roles.map(r => ({ name: r.name, arn: r.arn, roleId: r.roleId, maxSessionDuration: r.maxSessionDuration, trustSha256: r.trustSha256, attached: r.attached,
      inline: r.inline.map(({ name, sha256 }) => ({ name, sha256 })), boundary: r.boundary && { arn: r.boundary.arn, defaultVersion: r.boundary.defaultVersion, sha256: r.boundary.sha256 } })),
    activation, cleanup, defaultSecretsManagerKmsKeyArn: kms.data.KeyMetadata.Arn, currentRoleReadSimulations,
    ecsCellAbsent: cluster.data.clusters?.length === 0 && cluster.data.failures?.some(f => f.reason === "MISSING" && ["cell-sandbox-1", "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1"].includes(f.arn)),
    taskIamCandidateRequiresRealInputs: ["one_canonical_tenant_generation_fence", "actual_cell_management_target_and_secret_arn", "actual_generation_secret_arn", "actual_kms_keys", "fresh_role_id_boundary_and_policy_snapshot"],
    v3DrainFragmentRequiresRealProvisionItem: true, v3DrainFragmentIsDisabledAndNotCellDeletionAuthority: true,
    blockers: ["SINGLE_TENANT_TASK_BOUNDARY_AND_EXACT_RUNTIME_INPUTS", "REGISTERED_PREPARED_TASK_AND_ACTIVATION", "V3_AUTOMATED_AUTHORITY_AND_DELETE_JOURNAL_PERMISSIONS", "FAILED_CREATE_COMPENSATION_AND_LIVE_CLEANUP_ACCEPTANCE", "SEPARATELY_APPROVED_PAID_CELL_AND_SINGLE_TENANT_EXECUTION"],
    reportIsNotExecutableApprovalManifest: true, cloudWrites: 0, iamWrites: 0, lambdaInvocations: 0, databaseConnected: false, oldBoundCodeSlotsAndRecordsPreserved: true,
    deploymentAuthorized: false, permissionsInstallationAuthorized: false, runtimeEnabled: false };
  const fileSha256 = await save("prerequisites-review.json", result); console.log(JSON.stringify({ out, fileSha256, ...result }));
} catch (e) {
  const result = { outcome: "CELL_PREREQUISITE_READONLY_REVIEW_UNVERIFIED", stage, failureCode: /^(CELL_PREREQUISITE|DIRECT_COST|COST_RECOVERY|COST_CONTROL)_[A-Z_]+$/.test(e.message ?? "") ? e.message : "CELL_PREREQUISITE_READ_FAILED",
    serviceErrorName: ["CredentialsProviderError", "AccessDeniedException", "AccessDenied", "ExpiredToken"].includes(e.name) ? e.name : null, rawDiagnosticsWithheld: true, cloudWrites: 0, deploymentAuthorized: false, runtimeEnabled: false };
  await save("failure-diagnostic.json", result); console.error(JSON.stringify(result)); process.exitCode = 1;
}
