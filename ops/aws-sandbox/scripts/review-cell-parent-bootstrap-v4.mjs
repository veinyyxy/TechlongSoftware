import { readFile, writeFile, mkdir, realpath, lstat, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { IAMClient, GetPolicyCommand, GetPolicyVersionCommand, GetRoleCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand, CreatePolicyCommand, CreateRoleCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { createCellParentSdkV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { CELL_PARENT_KEY_V4, CELL_PARENT_TRUST_V4 } from "../../../lib/deployments/execution/cell-birth-parent-v4.ts";
import { CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4, CELL_PARENT_REGISTRATION_EXCLUSIONS_V4 } from "../../../lib/deployments/execution/cell-parent-source-registrar-v4.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as targets, CELL_PARENT_BOOTSTRAP_DENY_V4, CELL_PARENT_INSTALLATION_ORDER_V4,
  prepareCellParentBootstrapReviewV4, decodeCellParentBootstrapReviewV4, runCellParentBootstrapV4, cellParentBootstrapTagsV4 } from "../../../lib/deployments/execution/cell-parent-bootstrap-v4.ts";
import { createCellParentPrivateAttemptV4 } from "../../../lib/deployments/execution/cell-parent-private-attempt-v4.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "../../../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";

// Review/Inspect: readonly only. Run: exact fresh human SHA, fixed wx+flush slot,
// maximum SIX create/configure writes; no permission enablement, Invoke, Secret,
// database, table-policy/authority, CFN or paid-resource actuator exists here.
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) { if (!args[i]?.startsWith("--") || !args[i + 1] || options[args[i]]) throw Error("BOOTSTRAP_ARGUMENTS_INVALID"); options[args[i]] = args[i + 1]; }
const mode = options["--mode"], allowed = mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] : ["--mode", "--out"];
if (!["Review", "Inspect", "Run"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("BOOTSTRAP_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]);
if ((await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9c-bootstrap-[a-z0-9-]+$/.test(path.basename(out))) throw Error("BOOTSTRAP_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx" }); return sha256Hex(text); };
const cfg = { region: targets.region, maxAttempts: 1, ignoreConfiguredEndpointUrls: true }, credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
const iam = new IAMClient({ ...cfg, credentials }), cfn = new CloudFormationClient({ ...cfg, credentials }), clients = createCellParentSdkV4(credentials), native = promisify(execFile);
const call = (client, Command, input) => client.send(new Command(input), { abortSignal: AbortSignal.timeout(25000) });
const parsePolicy = raw => typeof raw === "string" ? JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)) : raw;
let stage = "LOCAL_BINDING", writesAttempted = 0, localSlotConsumed = false, pins, codeBindingSha256, roleId = null;
try {
  const previous = JSON.parse(await readFile(path.join(root, "techlong-f3c9b-parent-prestate-20261012-r1/code-binding.json"), "utf8"));
  if (previous.codeSha256 !== targets.code58Sha256 || previous.pins.length !== 58 || await sha256Hex(previous.pins) !== previous.codeSha256) throw Error("BOOTSTRAP_OLD58_BINDING_INVALID");
  for (const p of previous.pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("BOOTSTRAP_OLD58_CODE_DRIFT");
  pins = [...previous.pins];
  for (const file of ["lib/deployments/execution/cell-parent-source-registrar-v4.ts", "lib/deployments/execution/cell-parent-bootstrap-v4.ts", "lib/deployments/execution/cell-parent-private-attempt-v4.ts",
    "ops/aws-sandbox/scripts/review-cell-parent-bootstrap-v4.mjs", "ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql"])
    pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  codeBindingSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256: codeBindingSha256, old58CodeSha256: previous.codeSha256 });
  const bundleDir = path.join(root, "techlong-f3c9b-parent-bundle-20261012-r1"), reportText = await readFile(path.join(bundleDir, "artifact-review.json"), "utf8"), report = JSON.parse(reportText),
    zipPath = path.join(bundleDir, "cell-birth-parent-v4.zip"), zip = await readFile(zipPath), bundle = await readFile(path.join(bundleDir, "cell-birth-coordinator-v4.mjs"));
  if (await sha256Hex(reportText) !== targets.bundleReportFileSha256 || createHash("sha256").update(zip).digest("hex") !== targets.zipSha256 ||
    createHash("sha256").update(zip).digest("base64") !== targets.zipCodeSha256Base64 || createHash("sha256").update(bundle).digest("hex") !== targets.bundleSha256 ||
    report.bundleSha256 !== targets.bundleSha256 || report.zipSha256 !== targets.zipSha256 || report.fullCleanupRootCompleted !== true || report.installationAuthorized !== false ||
    report.packageLockSha256 !== createHash("sha256").update(await readFile(path.join(repo, "package-lock.json"))).digest("hex")) throw Error("BOOTSTRAP_ARTIFACT_DRIFT");
  for (const p of report.sourcePins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("BOOTSTRAP_BUNDLE_SOURCE_DRIFT");
  const verifyPins = async () => { for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("BOOTSTRAP_FINAL_CODE_DRIFT"); };
  const identity = async () => { const r = await call(clients.registry.sts, clients.registry.commands.identity, {}); if (r.Account !== targets.account || r.Arn !== targets.sourceArn || r.UserId !== targets.sourceUserId) throw Error("BOOTSTRAP_SOURCE_IDENTITY_INVALID"); };
  const readNative = async (service, action, input) => {
    if (!["logs/describe-log-groups", "logs/list-tags-for-resource", "lambda/get-function-concurrency", "lambda/list-tags"].includes(`${service}/${action}`)) throw Error("BOOTSTRAP_NATIVE_READ_NOT_ALLOWED");
    await identity(); const c = await credentials();
    try { const r = await native("aws", [service, action, "--cli-input-json", JSON.stringify(input), "--region", cfg.region, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
      { timeout: 30000, maxBuffer: 500000, windowsHide: true, encoding: "utf8", env: { ...process.env, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey,
        AWS_SESSION_TOKEN: c.sessionToken, AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } }); return JSON.parse(r.stdout); }
    catch { throw Error("BOOTSTRAP_NATIVE_READ_FAILED"); }
  };
  const absentRead = async fn => { try { return await fn(); } catch (e) { if (["NoSuchEntity", "NoSuchEntityException", "ResourceNotFoundException"].includes(e.name)) return null; throw e; } };
  const inspect = async () => {
    await identity(); const started = Date.now(), keys = [...CELL_PARENT_REGISTRATION_EXCLUSIONS_V4, CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4];
    const state = async () => { const r = await call(clients.registry.ddb, clients.registry.commands.transactGet, { TransactItems: keys.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) });
      if (!Array.isArray(r.Responses) || r.Responses.length !== keys.length) throw Error("BOOTSTRAP_REGISTRY_RESPONSE_INVALID"); return r.Responses.map(x => x.Item ?? null); };
    const first = await state(), b = await absentRead(() => call(iam, GetPolicyCommand, { PolicyArn: targets.boundaryArn })), role = await absentRead(() => call(iam, GetRoleCommand, { RoleName: targets.roleName })),
      fn = await absentRead(() => call(clients.installation.lambda, clients.installation.commands.functionConfig, { FunctionName: targets.functionArn, Qualifier: "$LATEST" })),
      logs = await readNative("logs", "describe-log-groups", { logGroupNamePrefix: targets.logGroup, limit: 50 });
    if (!Array.isArray(logs.logGroups) || logs.nextToken) throw Error("BOOTSTRAP_LOG_INVENTORY_PARTIAL"); const log = logs.logGroups.find(x => x.logGroupName === targets.logGroup) ?? null;
    let cellStackNameAbsent = false;
    try { const s = await call(cfn, DescribeStacksCommand, { StackName: "techlong-sandbox-cell-sandbox-1" }); cellStackNameAbsent = Array.isArray(s.Stacks) && s.Stacks.length === 0; }
    catch (e) { if (e.name !== "ValidationError" || !/^Stack with id techlong-sandbox-cell-sandbox-1 does not exist$/.test(e.message)) throw e; cellStackNameAbsent = true; }
    const second = await state(); await identity(); if (canonicalJson(first) !== canonicalJson(second) || Date.now() - started > 30000) throw Error("BOOTSTRAP_PRESTATE_DRIFT_OR_STALE");
    const inventory = { observedAt: Date.now(), boundaryAbsent: !b, roleAbsent: !role, functionAbsent: !fn, logGroupAbsent: !log,
      parentAndAllWorkflowAndRegistrationSlotsAbsent: second.every(v => v === null), cellStackNameAbsent, sourceIdentityVerified: true };
    return { inventory, boundary: b?.Policy ?? null, role: role?.Role ?? null, fn, log };
  };
  const lockedInspect = async (state, approvalSha256) => {
    if (!state.boundary || !state.role || !state.fn || !state.log || !/^[a-f0-9]{64}$/.test(approvalSha256 ?? "")) return { lockedBootstrapVerified: false, reason: "MISSING_OBJECT_OR_APPROVAL" };
    const role = state.role, policy = state.boundary, tags = cellParentBootstrapTagsV4(approvalSha256), version = (await call(iam, GetPolicyVersionCommand, { PolicyArn: targets.boundaryArn, VersionId: policy.DefaultVersionId })).PolicyVersion,
      names = await call(iam, ListRolePoliciesCommand, { RoleName: targets.roleName }), attached = await call(iam, ListAttachedRolePoliciesCommand, { RoleName: targets.roleName }),
      concurrency = await readNative("lambda", "get-function-concurrency", { FunctionName: targets.functionName }), fnTags = await readNative("lambda", "list-tags", { Resource: targets.functionArn }),
      logTags = await readNative("logs", "list-tags-for-resource", { resourceArn: `arn:aws:logs:ca-central-1:402010193138:log-group:${targets.logGroup}` }), f = state.fn;
    const checks = { role: role.Arn === targets.roleArn && /^AROA[A-Z0-9]{16,24}$/.test(role.RoleId ?? "") && role.PermissionsBoundary?.PermissionsBoundaryArn === targets.boundaryArn,
      trust: canonicalJson(parsePolicy(role.AssumeRolePolicyDocument)) === canonicalJson(CELL_PARENT_TRUST_V4),
      denyAll: policy.Arn === targets.boundaryArn && policy.DefaultVersionId === "v1" && version.IsDefaultVersion === true && canonicalJson(parsePolicy(version.Document)) === canonicalJson(CELL_PARENT_BOOTSTRAP_DENY_V4),
      noOtherRolePolicies: names.IsTruncated === false && names.Marker === undefined && canonicalJson(names.PolicyNames) === "[]" && attached.IsTruncated === false && attached.Marker === undefined && canonicalJson(attached.AttachedPolicies) === "[]",
      tags: canonicalJson(Object.fromEntries((role.Tags ?? []).map(t => [t.Key, t.Value]))) === canonicalJson(tags) && canonicalJson(fnTags.Tags) === canonicalJson(tags) && canonicalJson(logTags.tags) === canonicalJson(tags),
      fn: f.FunctionArn === targets.functionArn && f.FunctionName === targets.functionName && f.Role === targets.roleArn && f.CodeSha256 === targets.zipCodeSha256Base64 && f.Version === "$LATEST" &&
        f.Runtime === "nodejs22.x" && f.Handler === "cell-birth-coordinator-v4.handler" && f.PackageType === "Zip" && f.Timeout === 120 && f.MemorySize === 256 && canonicalJson(f.Architectures) === '["x86_64"]' &&
        f.State === "Active" && f.LastUpdateStatus === "Successful" && !(f.Layers?.length) && !Object.keys(f.Environment?.Variables ?? {}).length && !f.Environment?.Error && !(f.VpcConfig?.SubnetIds?.length) && !(f.VpcConfig?.SecurityGroupIds?.length),
      concurrencyZero: concurrency.ReservedConcurrentExecutions === 0, retention: state.log.retentionInDays === 7 };
    await identity(); return { lockedBootstrapVerified: Object.values(checks).every(v => v === true), checks, roleId: role.RoleId, functionRevisionId: f.RevisionId, runtimeEnabled: false };
  };
  const before = await inspect(); stage = "SOURCE_READONLY_PRESTATE_COMPLETE";
  let localSlotPresent = false; try { await access(path.join(root, targets.localBootstrapSlot)); localSlotPresent = true; } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (mode !== "Run") {
    await verifyPins(); const ready = !localSlotPresent && Object.entries(before.inventory).every(([k, v]) => k === "observedAt" || v === true);
    const review = mode === "Review" && ready ? await prepareCellParentBootstrapReviewV4(before.inventory, codeBindingSha256, Date.now()) : null;
    if (review) await save("bootstrap-manifest.json", review);
    let locked = { lockedBootstrapVerified: false };
    if (mode === "Inspect" && localSlotPresent) {
      const local = JSON.parse(await readFile(path.join(root, targets.localBootstrapSlot), "utf8"));
      if (local.protocol !== "cell-parent-permanent-local-attempt-v4" || local.retryAuthorized !== false) throw Error("BOOTSTRAP_LOCAL_ATTEMPT_RECORD_INVALID");
      locked = await lockedInspect(before, local.approvedSha256);
    }
    const summary = { schemaVersion: 4, phase: "F3c9c_LOCKED_CONTROL_BOOTSTRAP_REVIEW", outcome: review ? "LOCKED_BOOTSTRAP_REVIEW_READY_NOT_EXECUTED" : "READONLY_INSPECT_COMPLETE_NO_READY_MANIFEST", ...locked,
      observedAt: new Date().toISOString(), sourceIdentityVerified: true, inventory: before.inventory, localSlotPresent, parentKey: CELL_PARENT_KEY_V4,
      codeBindingSha256, boundFileCount: pins.length, old58Unchanged: true, artifact: { bundleSha256: targets.bundleSha256, zipSha256: targets.zipSha256 },
      manifestSha256: review?.manifestSha256 ?? null, expiresAt: review ? new Date(review.expiresAt).toISOString() : null, installationOrder: CELL_PARENT_INSTALLATION_ORDER_V4,
      sourceRegistrarImplemented: true, sourceRegistrarActuallyUsed: false, effectiveAllowDenyProved: false, installedRuntimeProved: false, runtimeEnabled: false,
      awsWrites: 0, iamWrites: 0, secretValueReads: 0, lambdaInvocations: 0, databaseConnections: 0, paidCellCreationAuthorized: false };
    const reportFileSha256 = await save("bootstrap-review.json", summary); console.log(JSON.stringify({ ...summary, reportFileSha256, output: await realpath(out) }, null, 2));
  } else {
    stage = "EXACT_APPROVAL_GATE";
    const file = path.resolve(options["--manifest"]); if ((await lstat(file)).isSymbolicLink() || !(await realpath(file)).toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw Error("BOOTSTRAP_MANIFEST_PATH_INVALID");
    const review = await decodeCellParentBootstrapReviewV4(JSON.parse(await readFile(file, "utf8")));
    const active = () => { if (Date.now() < review.reviewedAt || Date.now() >= review.expiresAt) throw Error("BOOTSTRAP_APPROVAL_EXPIRED_NO_RETRY"); };
    if (options["--approved-sha"] !== review.manifestSha256 || review.codeBindingSha256 !== codeBindingSha256 || localSlotPresent) throw Error("BOOTSTRAP_NEW_EXACT_APPROVAL_AND_UNUSED_SLOT_REQUIRED");
    active(); await prepareCellParentBootstrapReviewV4(before.inventory, codeBindingSha256, Date.now()); await verifyPins();
    const expectedTags = cellParentBootstrapTagsV4(review.manifestSha256);
    const runtimeFence = async () => { active(); await identity(); await verifyPins(); const role = (await call(iam, GetRoleCommand, { RoleName: targets.roleName })).Role;
      if (!roleId || role?.RoleId !== roleId || role.Arn !== targets.roleArn || role.PermissionsBoundary?.PermissionsBoundaryArn !== targets.boundaryArn || canonicalJson(parsePolicy(role.AssumeRolePolicyDocument)) !== canonicalJson(review.trust) ||
        canonicalJson(Object.fromEntries((role.Tags ?? []).map(t => [t.Key, t.Value]))) !== canonicalJson(expectedTags)) throw Error("BOOTSTRAP_ROLE_ID_OR_TRUST_DRIFT");
      const policy = (await call(iam, GetPolicyCommand, { PolicyArn: targets.boundaryArn })).Policy, version = (await call(iam, GetPolicyVersionCommand, { PolicyArn: targets.boundaryArn, VersionId: policy.DefaultVersionId })).PolicyVersion;
      const names = await call(iam, ListRolePoliciesCommand, { RoleName: targets.roleName }), attached = await call(iam, ListAttachedRolePoliciesCommand, { RoleName: targets.roleName });
      if (policy.Arn !== targets.boundaryArn || policy.DefaultVersionId !== "v1" || version.IsDefaultVersion !== true || canonicalJson(parsePolicy(version.Document)) !== canonicalJson(CELL_PARENT_BOOTSTRAP_DENY_V4) ||
        names.IsTruncated !== false || names.PolicyNames?.length || attached.IsTruncated !== false || attached.AttachedPolicies?.length) throw Error("BOOTSTRAP_LOCKED_IAM_DRIFT"); };
    const nativeWrite = async (r, extra = []) => { active(); await identity(); await verifyPins(); const c = await credentials(); writesAttempted++;
      try { const p = await native("aws", [r.service, r.action, "--cli-input-json", JSON.stringify(r.input), ...extra, "--region", cfg.region, "--no-cli-pager", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "30"],
        { timeout: 45000, maxBuffer: 500000, windowsHide: true, encoding: "utf8", env: { ...process.env, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey,
          AWS_SESSION_TOKEN: c.sessionToken, AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } }); return p.stdout.trim() ? JSON.parse(p.stdout) : {}; }
      catch { throw Error("BOOTSTRAP_NATIVE_WRITE_UNCERTAIN_INSPECT_ONLY"); } };
    const outcome = await runCellParentBootstrapV4(review, options["--approved-sha"], codeBindingSha256, {
      readFreshInventory: async () => (await inspect()).inventory,
      verifySourceAndBytes: async () => { active(); await identity(); await verifyPins(); },
      claimPermanentLocal: async () => { localSlotConsumed = await createCellParentPrivateAttemptV4("bootstrap").claimOnce(review.manifestSha256); return localSlotConsumed; },
      beforeWrite: async i => { stage = `LOCKED_BOOTSTRAP_WRITE_${i + 1}`; active(); await identity(); await verifyPins(); if (i >= 2) await runtimeFence();
        if (i === 2) { await new Promise(resolve => setTimeout(resolve, 10000)); await runtimeFence(); } // Read-only settling, NOT an AssumeRole allow proof or write retry.
      },
      write: async (i, request) => {
      if (i === 0) { if (await absentRead(() => call(iam, GetPolicyCommand, { PolicyArn: targets.boundaryArn }))) throw Error("BOOTSTRAP_BOUNDARY_SLOT_OCCUPIED"); writesAttempted++; await call(iam, CreatePolicyCommand, request.input); }
      else if (i === 1) { if (await absentRead(() => call(iam, GetRoleCommand, { RoleName: targets.roleName }))) throw Error("BOOTSTRAP_ROLE_SLOT_OCCUPIED");
        const p = (await call(iam, GetPolicyCommand, { PolicyArn: targets.boundaryArn })).Policy, v = (await call(iam, GetPolicyVersionCommand, { PolicyArn: targets.boundaryArn, VersionId: p.DefaultVersionId })).PolicyVersion;
        if (p.DefaultVersionId !== "v1" || canonicalJson(parsePolicy(v.Document)) !== canonicalJson(CELL_PARENT_BOOTSTRAP_DENY_V4)) throw Error("BOOTSTRAP_BOUNDARY_DRIFT");
        writesAttempted++; const r = await call(iam, CreateRoleCommand, request.input); roleId = r.Role?.RoleId; if (!/^AROA[A-Z0-9]{16,24}$/.test(roleId ?? "") || r.Role?.Arn !== targets.roleArn) throw Error("BOOTSTRAP_CREATED_ROLE_ID_INVALID"); }
      else if (i === 4) { if (await absentRead(() => call(clients.installation.lambda, clients.installation.commands.functionConfig, { FunctionName: targets.functionArn, Qualifier: "$LATEST" }))) throw Error("BOOTSTRAP_FUNCTION_SLOT_OCCUPIED");
        if (createHash("sha256").update(await readFile(zipPath)).digest("hex") !== targets.zipSha256) throw Error("BOOTSTRAP_ZIP_PREWRITE_DRIFT");
        const r = await nativeWrite(request, ["--zip-file", `fileb://${zipPath}`]); if (r.FunctionArn !== targets.functionArn || r.CodeSha256 !== targets.zipCodeSha256Base64 || r.Role !== targets.roleArn) throw Error("BOOTSTRAP_CREATED_FUNCTION_DRIFT"); }
      else if (i === 5) { const f = await call(clients.installation.lambda, clients.installation.commands.functionConfig, { FunctionName: targets.functionArn, Qualifier: "$LATEST" });
        if (f.Role !== targets.roleArn || f.CodeSha256 !== targets.zipCodeSha256Base64) throw Error("BOOTSTRAP_FUNCTION_PRECONCURRENCY_DRIFT"); await nativeWrite(request); }
      else await nativeWrite(request);
      }, inspectLocked: async () => { await runtimeFence(); return (await lockedInspect(await inspect(), review.manifestSha256)).lockedBootstrapVerified; },
    });
    if (outcome.outcome !== "LOCKED_BOOTSTRAP_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT") throw Error("BOOTSTRAP_WRITE_UNCERTAIN_INDEPENDENT_INSPECT_ONLY");
    await runtimeFence(); const after = await inspect(), locked = await lockedInspect(after, review.manifestSha256);
    if (!locked.lockedBootstrapVerified) throw Error("BOOTSTRAP_POSTWRITE_LOCKED_INSPECT_REQUIRED");
    const report = { outcome: "LOCKED_BOOTSTRAP_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", approvedManifestSha256: review.manifestSha256, codeBindingSha256, roleId,
      functionRevisionId: after.fn.RevisionId, writesAttempted, localSlotConsumed, explicitDenyAllVerified: true, reservedConcurrency: 0, runtimeEnabled: false,
      retryAuthorized: false, secretValueReads: 0, lambdaInvocations: 0, databaseConnections: 0, cellWrites: 0 };
    const reportFileSha256 = await save("bootstrap-run.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
  }
} catch (e) {
  const report = { outcome: writesAttempted ? "BOOTSTRAP_WRITE_UNCERTAIN_INDEPENDENT_INSPECT_ONLY" : "BOOTSTRAP_NO_AWS_WRITE", mode, stage,
    safeCode: /^[A-Z0-9_]{4,120}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    writesAttempted, localSlotConsumed, noRawProviderDiagnosticsPersisted: true, retryAuthorized: false, secretValueReads: 0, lambdaInvocations: 0, databaseConnections: 0, runtimeEnabled: false };
  await save("bootstrap-failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
} finally { iam.destroy(); cfn.destroy(); clients.dispose(); }
