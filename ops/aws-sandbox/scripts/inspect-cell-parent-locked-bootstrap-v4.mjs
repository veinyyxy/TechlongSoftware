import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { IAMClient, GetPolicyCommand, GetPolicyVersionCommand, GetRoleCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { createCellParentSdkV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { CELL_PARENT_TRUST_V4 } from "../../../lib/deployments/execution/cell-birth-parent-v4.ts";
import { CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4, CELL_PARENT_REGISTRATION_EXCLUSIONS_V4 } from "../../../lib/deployments/execution/cell-parent-source-registrar-v4.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as t, CELL_PARENT_BOOTSTRAP_DENY_V4, cellParentBootstrapTagsV4 } from "../../../lib/deployments/execution/cell-parent-bootstrap-v4.ts";
import { cellParentLockedFunctionChecksV4 } from "../../../lib/deployments/execution/cell-parent-latest-metadata-v4.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "../../../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";

// Independent READ-ONLY verifier for the exact completed 0cb approval. No write
// SDK/CLI command, Invoke, Secret value, DB connection, slot reset or repair.
const approval = "0cb547a6016a508ff5903fb99f804b6cb341147e273e262e1a7a43ef3362676c", approvedCode63 = "3fbde58c8f9a60a85f3174a3c36d1ab33e93da5b52100c124093892706757d34";
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9c-bootstrap-[a-z0-9-]+$/.test(path.basename(out))) throw Error("LOCKED_INSPECT_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out); const save = async (file, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, file), text, { flag: "wx" }); return sha256Hex(text); };
const cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true }, credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg }),
  iam = new IAMClient({ ...cfg, credentials }), cfn = new CloudFormationClient({ ...cfg, credentials }), clients = createCellParentSdkV4(credentials), native = promisify(execFile);
const call = (client, Command, input) => client.send(new Command(input), { abortSignal: AbortSignal.timeout(25000) });
const policy = raw => typeof raw === "string" ? JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)) : raw;
let stage = "CODE_BINDING";
try {
  const old = JSON.parse(await readFile(path.join(root, "techlong-f3c9c-bootstrap-20261012-r3/code-binding.json"), "utf8"));
  if (old.codeSha256 !== approvedCode63 || old.pins.length !== 63 || await sha256Hex(old.pins) !== old.codeSha256) throw Error("LOCKED_INSPECT_APPROVED63_BINDING_INVALID");
  const pins = [...old.pins]; for (const file of ["lib/deployments/execution/cell-parent-latest-metadata-v4.ts", "ops/aws-sandbox/scripts/inspect-cell-parent-locked-bootstrap-v4.mjs"])
    pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  const verify = async () => { for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("LOCKED_INSPECT_CODE_DRIFT"); };
  await verify(); const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256, approvedCode63 });
  const local = JSON.parse(await readFile(path.join(root, t.localBootstrapSlot), "utf8"));
  if (local.protocol !== "cell-parent-permanent-local-attempt-v4" || local.approvedSha256 !== approval || local.retryAuthorized !== false) throw Error("LOCKED_INSPECT_LOCAL_ATTEMPT_INVALID");
  const originalText = await readFile(path.join(root, "techlong-f3c9c-bootstrap-20261012-r3-independent-inspect/bootstrap-review.json"), "utf8"), original = JSON.parse(originalText);
  if (await sha256Hex(originalText) !== "58999cd73bbde25ad48dad48e44db3dc53b07fa893d4d993d14744a4c9674aee" || original.roleId !== "AROAV3GNMXTZBYYFRN63O" || original.functionRevisionId !== "7817b5a5-c53c-4df5-a2a7-e1385fc1d89c") throw Error("LOCKED_INSPECT_ORIGINAL_IDENTITY_BINDING_INVALID");
  const identity = async () => { const i = await call(clients.registry.sts, clients.registry.commands.identity, {}); if (i.Account !== t.account || i.Arn !== t.sourceArn || i.UserId !== t.sourceUserId) throw Error("LOCKED_INSPECT_SOURCE_IDENTITY_INVALID"); };
  const readNative = async (service, action, input) => {
    if (!["logs/describe-log-groups", "logs/list-tags-for-resource", "lambda/get-function-concurrency", "lambda/list-tags"].includes(`${service}/${action}`)) throw Error("LOCKED_INSPECT_ONLY_READ_COMMANDS");
    const c = await credentials(); try {
      const r = await native("aws", [service, action, "--cli-input-json", JSON.stringify(input), "--region", cfg.region, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
        { timeout: 30000, maxBuffer: 500000, windowsHide: true, encoding: "utf8", env: { ...process.env, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey,
          AWS_SESSION_TOKEN: c.sessionToken, AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } }); return JSON.parse(r.stdout);
    } catch { throw Error("LOCKED_INSPECT_NATIVE_READ_FAILED"); }
  };
  const collect = async () => {
    await identity(); const started = Date.now(), expectedTags = cellParentBootstrapTagsV4(approval), keys = [...CELL_PARENT_REGISTRATION_EXCLUSIONS_V4, CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4];
    const readItems = async () => { const r = await call(clients.registry.ddb, clients.registry.commands.transactGet, { TransactItems: keys.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) });
      if (!Array.isArray(r.Responses) || r.Responses.length !== keys.length) throw Error("LOCKED_INSPECT_REGISTRY_INVALID"); return r.Responses.map(x => x.Item ?? null); };
    const before = await readItems(), role = (await call(iam, GetRoleCommand, { RoleName: t.roleName })).Role,
      p = (await call(iam, GetPolicyCommand, { PolicyArn: t.boundaryArn })).Policy, v = (await call(iam, GetPolicyVersionCommand, { PolicyArn: t.boundaryArn, VersionId: p.DefaultVersionId })).PolicyVersion,
      names = await call(iam, ListRolePoliciesCommand, { RoleName: t.roleName }), attached = await call(iam, ListAttachedRolePoliciesCommand, { RoleName: t.roleName }),
      f = await call(clients.installation.lambda, clients.installation.commands.functionConfig, { FunctionName: t.functionArn, Qualifier: "$LATEST" }),
      concurrency = await readNative("lambda", "get-function-concurrency", { FunctionName: t.functionName }), fnTags = await readNative("lambda", "list-tags", { Resource: t.functionArn }),
      logs = await readNative("logs", "describe-log-groups", { logGroupNamePrefix: t.logGroup, limit: 50 }), logTags = await readNative("logs", "list-tags-for-resource", { resourceArn: `arn:aws:logs:ca-central-1:402010193138:log-group:${t.logGroup}` });
    if (!Array.isArray(logs.logGroups) || logs.nextToken) throw Error("LOCKED_INSPECT_LOG_PARTIAL"); const log = logs.logGroups.find(g => g.logGroupName === t.logGroup);
    let stackAbsent = false; try { const r = await call(cfn, DescribeStacksCommand, { StackName: "techlong-sandbox-cell-sandbox-1" }); stackAbsent = Array.isArray(r.Stacks) && !r.Stacks.length; }
    catch (e) { if (e.name !== "ValidationError" || e.message !== "Stack with id techlong-sandbox-cell-sandbox-1 does not exist") throw e; stackAbsent = true; }
    const after = await readItems(); await identity(); if (canonicalJson(before) !== canonicalJson(after) || Date.now() - started > 30000) throw Error("LOCKED_INSPECT_READ_DRIFT_OR_STALE");
    const checks = { role: role?.Arn === t.roleArn && /^AROA[A-Z0-9]{16,24}$/.test(role?.RoleId ?? "") && role?.PermissionsBoundary?.PermissionsBoundaryArn === t.boundaryArn,
      lambdaOnlyTrust: canonicalJson(policy(role.AssumeRolePolicyDocument)) === canonicalJson(CELL_PARENT_TRUST_V4),
      explicitDenyAllBoundary: p.Arn === t.boundaryArn && p.DefaultVersionId === "v1" && v.VersionId === "v1" && v.IsDefaultVersion === true && canonicalJson(policy(v.Document)) === canonicalJson(CELL_PARENT_BOOTSTRAP_DENY_V4),
      noOtherRolePolicies: names.IsTruncated === false && names.Marker === undefined && canonicalJson(names.PolicyNames) === "[]" && attached.IsTruncated === false && attached.Marker === undefined && canonicalJson(attached.AttachedPolicies) === "[]",
      exactTags: canonicalJson(Object.fromEntries((role.Tags ?? []).map(t => [t.Key, t.Value]))) === canonicalJson(expectedTags) && canonicalJson(fnTags.Tags) === canonicalJson(expectedTags) && canonicalJson(logTags.tags) === canonicalJson(expectedTags),
      originalCreatedIdentityStable: role.RoleId === original.roleId && f.RevisionId === original.functionRevisionId,
      ...cellParentLockedFunctionChecksV4(f), reservedConcurrencyZero: concurrency.ReservedConcurrentExecutions === 0, logRetentionSevenDays: log?.retentionInDays === 7,
      parentAndWorkflowAndRegistrationSlotsAbsent: after.every(x => x === null), cellStackNameAbsent: stackAbsent };
    return { checks, roleId: role.RoleId, policyId: p.PolicyId, functionArnObserved: f.FunctionArn, functionRevisionId: f.RevisionId, zipCodeSha256Base64: f.CodeSha256, logGroup: t.logGroup, logStoredBytes: log?.storedBytes ?? null };
  };
  stage = "INDEPENDENT_SOURCE_DOUBLE_READ"; const first = await collect(), second = await collect();
  // Stored-byte counters are not an authorization identity or immutable config.
  const stable = x => ({ ...x, logStoredBytes: undefined }); if (canonicalJson(stable(first)) !== canonicalJson(stable(second))) throw Error("LOCKED_INSPECT_FULL_METADATA_DRIFT");
  await verify(); const locked = Object.values(second.checks).every(v => v === true), result = {
    schemaVersion: 4, phase: "F3c9c_LOCKED_CONTROL_BOOTSTRAP_INDEPENDENT_ACCEPTANCE", outcome: locked ? "LOCKED_BOOTSTRAP_INDEPENDENTLY_VERIFIED" : "LOCKED_BOOTSTRAP_CHECKS_NOT_COMPLETE",
    observedAt: new Date().toISOString(), approvedManifestSha256: approval, approvedCode63, codeSha256, boundFileCount: pins.length, approved63Unchanged: true,
    stableIndependentDoubleRead: true, exactLatestQualifiedArnAcceptedOnly: true, ...second,
    lockedBootstrapVerified: locked, originalRunAndInspectReportsPreserved: true, localSlotConsumed: true, noWriteRetryOrRepairPerformed: true,
    awsWritesThisVerifier: 0, totalApprovedWritesAttempted: 6, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0, runtimeEnabled: false, effectiveAllowPathProved: false };
  const reportFileSha256 = await save("independent-locked-inspect.json", result); console.log(JSON.stringify({ ...result, reportFileSha256, output: out }, null, 2)); if (!locked) process.exitCode = 1;
} catch (e) {
  const report = { outcome: "READONLY_LOCKED_INSPECT_INCOMPLETE", stage, safeCode: /^[A-Z0-9_]{4,120}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    noRawProviderDiagnosticsPersisted: true, awsWritesThisVerifier: 0, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0, retryAuthorized: false, runtimeEnabled: false };
  await save("read-only-failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
} finally { iam.destroy(); cfn.destroy(); clients.dispose(); }
