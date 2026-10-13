import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IAMClient, GetRoleCommand, GetPolicyCommand, GetPolicyVersionCommand, GetRolePolicyCommand,
  ListRolePoliciesCommand, ListAttachedRolePoliciesCommand, SimulatePrincipalPolicyCommand,
  CreatePolicyCommand, CreateRoleCommand, PutRolePolicyCommand } from "@aws-sdk/client-iam";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { ACCEPTANCE_CELL_IAM as t, compileAcceptanceCellIam } from "../../../lib/deployments/execution/single-tenant-cell-iam.ts";
import { decodeCellIamReview, prepareCellIamReview, runCellIamInstall, cellIamSourceSimulationAllowed, type CellIamInventory, type CellIamReview } from "../../../lib/deployments/execution/single-tenant-cell-iam-review.ts";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";

const args: Record<string, string> = {};
for (let n = 2; n < process.argv.length; n += 2) {
  const key = process.argv[n], value = process.argv[n + 1];
  if (!key?.startsWith("--") || !value || args[key]) throw Error("CELL_IAM_ARGUMENTS_INVALID"); args[key] = value;
}
const mode = args["--mode"], required = mode === "Review" ? ["--mode", "--out"] : mode === "Inspect" ? ["--mode", "--out", "--manifest", "--run-report"] : ["--mode", "--out", "--manifest", "--approved-sha"];
if (!["Review", "Run", "Inspect"].includes(mode) || Object.keys(args).sort().join(",") !== required.sort().join(",")) throw Error("CELL_IAM_ARGUMENTS_INVALID");
const root = await realpath("F:/ChatGPT_workshop"), directory = path.resolve(args["--out"]);
if ((await lstat(root)).isSymbolicLink() || path.dirname(directory).toLowerCase() !== root.toLowerCase() ||
  !/^techlong-d001-cell-iam-[a-z0-9-]+$/.test(path.basename(directory))) throw Error("CELL_IAM_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(directory); // exclusive new directory; never overwrite prior evidence
const save = async (name: string, value: unknown) => {
  const body = `${JSON.stringify(value, null, 2)}\n`; await writeFile(path.join(directory, name), body, { flag: "wx", flush: true }); return sha256Hex(body);
};
const exec = promisify(execFile), signal = AbortSignal.timeout(55_000);
const cli = async (argv: string[]) => {
  const r = await exec("aws", [...argv, "--profile", "techlong-sandbox-user", "--region", t.region, "--output", "json", "--no-cli-pager"], { maxBuffer: 2 * 1024 * 1024, timeout: 20000, windowsHide: true });
  return JSON.parse(r.stdout);
};
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const files = ["lib/deployments/execution/single-tenant-cell-iam.ts", "lib/deployments/execution/single-tenant-cell-iam-review.ts",
  "ops/aws-sandbox/scripts/review-single-tenant-cell-iam.ts", "lib/deployments/execution/hash.ts"];
const pins = await Promise.all(files.map(async file => ({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) })));
const codeBindingSha256 = await sha256Hex(pins);
const credentials = defaultProvider({ profile: "techlong-sandbox-user" }), config = { region: t.region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const iam = new IAMClient(config), sts = new STSClient(config);
const opt = { abortSignal: signal }, slot = path.join(root, "techlong-d001-cell-iam-install.permanent-slot.json");
const identity = async () => {
  const r = await sts.send(new GetCallerIdentityCommand({}), opt);
  if (r.Account !== t.account || r.Arn !== t.sourceArn || r.UserId !== t.sourceUserId) throw Error("CELL_IAM_SOURCE_IDENTITY_MISMATCH");
  return { Account: r.Account, Arn: r.Arn, UserId: r.UserId };
};
const absent = async (kind: "role" | "policy") => {
  try { if (kind === "role") await iam.send(new GetRoleCommand({ RoleName: t.roleName }), opt);
    else await iam.send(new GetPolicyCommand({ PolicyArn: t.boundaryArn }), opt); return false;
  } catch (e) { if (e && typeof e === "object" && "name" in e && e.name === "NoSuchEntityException") return true; throw e; }
};
const inventory = async (): Promise<CellIamInventory> => {
  const who = await identity();
  const [roleAbsent, boundaryAbsent, roles, keys, simulation] = await Promise.all([
    absent("role"), absent("policy"),
    Promise.all(["AWSServiceRoleForRDS", "AWSServiceRoleForECS", "AWSServiceRoleForElasticLoadBalancing"].map(RoleName => iam.send(new GetRoleCommand({ RoleName }), opt))),
    Promise.all(["alias/aws/rds", "alias/aws/secretsmanager"].map(alias => cli(["kms", "describe-key", "--key-id", alias]))),
    iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: t.sourceArn, ActionNames: ["iam:CreatePolicy", "iam:CreateRole", "iam:PutRolePolicy"],
      ResourceArns: [t.boundaryArn, t.roleArn], ContextEntries: [{ ContextKeyName: "iam:PermissionsBoundary", ContextKeyType: "string", ContextKeyValues: [t.boundaryArn] }] }), opt),
  ]);
  return { observedAt: Date.now(), identity: who, roleAbsent, boundaryAbsent,
    serviceLinkedRoles: { rds: roles[0].Role?.RoleId ?? "", ecs: roles[1].Role?.RoleId ?? "", elb: roles[2].Role?.RoleId ?? "" },
    keys: { rds: { arn: keys[0].KeyMetadata.Arn, keyManager: keys[0].KeyMetadata.KeyManager, enabled: keys[0].KeyMetadata.Enabled },
      secrets: { arn: keys[1].KeyMetadata.Arn, keyManager: keys[1].KeyMetadata.KeyManager, enabled: keys[1].KeyMetadata.Enabled } },
    sourceInstallSimulationAllowed: cellIamSourceSimulationAllowed(simulation),
  };
};
const decodePolicy = (value?: string) => { if (!value) throw Error("CELL_IAM_POLICY_DOCUMENT_MISSING"); try { return JSON.parse(value); } catch { return JSON.parse(decodeURIComponent(value)); } };
const sortedTags = (value?: { Key?: string; Value?: string }[]) => [...value ?? []].sort((a, b) => (a.Key ?? "").localeCompare(b.Key ?? ""));
const requireWriteWindow = (m: CellIamReview) => {
  signal.throwIfAborted();
  if (args["--approved-sha"] !== m.manifestSha256 || m.codeBindingSha256 !== codeBindingSha256 ||
    Date.now() < m.reviewedAt || Date.now() >= m.expiresAt) throw Error("CELL_IAM_FRESH_EXACT_APPROVAL_REQUIRED");
};
let review: CellIamReview | undefined, expectedPolicyId = "", expectedRoleId = "", sequence = 0, awsWriteApiInvocations = 0;
try {
  await save("code-binding.json", { codeBindingSha256, pins });
  if (mode === "Review") {
    try { await lstat(slot); throw Error("CELL_IAM_PERMANENT_SLOT_OCCUPIED_INSPECT_ONLY"); } catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e; }
    const facts = await inventory();
    await save("inventory.json", facts);
    const material = await compileAcceptanceCellIam({ rdsKmsKeyArn: facts.keys.rds.arn, secretsKmsKeyArn: facts.keys.secrets.arn });
    await save("identity-policy.json", material.policyDocument); await save("boundary-policy.json", material.boundaryDocument);
    const validation = await Promise.all(["identity", "boundary"].map(which => cli(["accessanalyzer", "validate-policy", "--policy-type", "IDENTITY_POLICY",
      "--policy-document", `file://${path.join(directory, `${which}-policy.json`).replaceAll("\\", "/")}`])));
    const codes = (i: number, error: boolean) => (validation[i].findings ?? []).filter((f: { findingType: string }) => (f.findingType === "ERROR") === error).map((f: { issueCode: string }) => f.issueCode).sort();
    const v = { identityErrors: codes(0, true), boundaryErrors: codes(1, true), identityWarnings: codes(0, false), boundaryWarnings: codes(1, false) };
    await save("policy-validation.json", validation);
    review = await prepareCellIamReview({ inventory: facts, validation: v, codeBindingSha256 });
    const fileSha256 = await save("manifest.json", review);
    process.stdout.write(`${JSON.stringify({ mode, directory, manifestSha256: review.manifestSha256, fileSha256, expiresAt: new Date(review.expiresAt).toISOString(),
      maximumIamWrites: 3, writesPerformed: 0, policyBytes: material.policyBytes, boundaryBytes: material.boundaryBytes, validation: v, cellDeploymentAuthorized: false })}\n`);
  } else {
    const manifest = path.resolve(args["--manifest"]);
    if ((await realpath(manifest)).toLowerCase() !== manifest.toLowerCase() || !manifest.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw Error("CELL_IAM_MANIFEST_PATH_INVALID");
    review = await decodeCellIamReview(JSON.parse(await readFile(manifest, "utf8")));
    if (review.codeBindingSha256 !== codeBindingSha256) throw Error("CELL_IAM_CODE_BINDING_DRIFT");
    if (mode === "Run") {
      const approved = args["--approved-sha"];
      const r = await runCellIamInstall({ review, approvedManifestSha256: approved, currentCodeBindingSha256: codeBindingSha256, signal,
        journal: {
          consume: async data => { await writeFile(slot, `${JSON.stringify({ protocol: "d001-cell-iam-permanent-attempt", ...data, consumedAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx", flush: true }); },
          record: data => save(`step-${++sequence}.json`, data).then(() => undefined),
        },
        port: {
          inventory: async () => inventory(),
          async createBoundary(m) {
            await identity();
            requireWriteWindow(m);
            awsWriteApiInvocations++;
            const r = await iam.send(new CreatePolicyCommand({ PolicyName: t.boundaryName, PolicyDocument: canonicalJson(m.material.boundaryDocument), Tags: m.material.tags }), opt);
            expectedPolicyId = r.Policy?.PolicyId ?? ""; return { arn: r.Policy?.Arn ?? "", policyId: expectedPolicyId };
          },
          async createRole(m) {
            await identity();
            const p = await iam.send(new GetPolicyCommand({ PolicyArn: t.boundaryArn }), opt);
            const v = await iam.send(new GetPolicyVersionCommand({ PolicyArn: t.boundaryArn, VersionId: "v1" }), opt);
            if (p.Policy?.PolicyId !== expectedPolicyId || p.Policy?.DefaultVersionId !== "v1" || canonicalJson(decodePolicy(v.PolicyVersion?.Document)) !== canonicalJson(m.material.boundaryDocument)) throw Error("CELL_IAM_CREATED_BOUNDARY_DRIFT");
            requireWriteWindow(m);
            awsWriteApiInvocations++;
            const r = await iam.send(new CreateRoleCommand({ RoleName: t.roleName, AssumeRolePolicyDocument: canonicalJson(m.material.trustDocument),
              PermissionsBoundary: t.boundaryArn, MaxSessionDuration: m.material.maxSessionDuration, Tags: m.material.tags }), opt);
            expectedRoleId = r.Role?.RoleId ?? ""; return { arn: r.Role?.Arn ?? "", roleId: expectedRoleId };
          },
          async putInline(m) {
            await identity();
            const [r, policies, attached] = await Promise.all([iam.send(new GetRoleCommand({ RoleName: t.roleName }), opt),
              iam.send(new ListRolePoliciesCommand({ RoleName: t.roleName }), opt), iam.send(new ListAttachedRolePoliciesCommand({ RoleName: t.roleName }), opt)]);
            if (r.Role?.RoleId !== expectedRoleId || r.Role.PermissionsBoundary?.PermissionsBoundaryArn !== t.boundaryArn ||
              canonicalJson(decodePolicy(r.Role.AssumeRolePolicyDocument)) !== canonicalJson(m.material.trustDocument) ||
              r.Role.MaxSessionDuration !== m.material.maxSessionDuration || canonicalJson(sortedTags(r.Role.Tags)) !== canonicalJson(sortedTags(m.material.tags)) ||
              policies.IsTruncated || policies.PolicyNames?.length || attached.IsTruncated || attached.AttachedPolicies?.length) throw Error("CELL_IAM_CREATED_ROLE_DRIFT");
            requireWriteWindow(m);
            awsWriteApiInvocations++;
            await iam.send(new PutRolePolicyCommand({ RoleName: t.roleName, PolicyName: m.material.inlinePolicyName, PolicyDocument: canonicalJson(m.material.policyDocument) }), opt);
          },
        },
      });
      await save("run.json", { ...r, awsWriteApiInvocations }); process.stdout.write(`${JSON.stringify({ mode, directory, ...r, awsWriteApiInvocations })}\n`);
      if (r.outcome !== "IAM_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT") process.exitCode = 2;
    } else {
      const runPath = path.resolve(args["--run-report"]);
      if ((await realpath(runPath)).toLowerCase() !== runPath.toLowerCase() || !runPath.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw Error("CELL_IAM_RUN_REPORT_PATH_INVALID");
      const run = JSON.parse(await readFile(runPath, "utf8"));
      if (run.manifestSha256 !== review.manifestSha256 || run.codeBindingSha256 !== codeBindingSha256 ||
        run.outcome !== "IAM_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT" || run.awsWriteApiInvocations !== 3 ||
        typeof run.roleId !== "string" || typeof run.policyId !== "string") throw Error("CELL_IAM_RUN_REPORT_REQUIRES_PARTIAL_MANUAL_INSPECT");
      await identity();
      const [r, p, v, inline, names, attached] = await Promise.all([iam.send(new GetRoleCommand({ RoleName: t.roleName }), opt),
        iam.send(new GetPolicyCommand({ PolicyArn: t.boundaryArn }), opt), iam.send(new GetPolicyVersionCommand({ PolicyArn: t.boundaryArn, VersionId: "v1" }), opt),
        iam.send(new GetRolePolicyCommand({ RoleName: t.roleName, PolicyName: review.material.inlinePolicyName }), opt),
        iam.send(new ListRolePoliciesCommand({ RoleName: t.roleName }), opt), iam.send(new ListAttachedRolePoliciesCommand({ RoleName: t.roleName }), opt)]);
      const slotData = JSON.parse(await readFile(slot, "utf8"));
      const checks = { slotMatches: slotData.manifestSha256 === review.manifestSha256 && slotData.codeBindingSha256 === codeBindingSha256,
        roleIdMatchesRun: r.Role?.RoleId === run.roleId, policyIdMatchesRun: p.Policy?.PolicyId === run.policyId,
        roleArn: r.Role?.Arn === t.roleArn, boundaryArn: r.Role?.PermissionsBoundary?.PermissionsBoundaryArn === t.boundaryArn,
        roleSessionDuration: r.Role?.MaxSessionDuration === review.material.maxSessionDuration,
        roleTags: canonicalJson(sortedTags(r.Role?.Tags)) === canonicalJson(sortedTags(review.material.tags)),
        trust: canonicalJson(decodePolicy(r.Role?.AssumeRolePolicyDocument)) === canonicalJson(review.material.trustDocument),
        boundaryDocument: p.Policy?.DefaultVersionId === "v1" && canonicalJson(decodePolicy(v.PolicyVersion?.Document)) === canonicalJson(review.material.boundaryDocument),
        identityDocument: canonicalJson(decodePolicy(inline.PolicyDocument)) === canonicalJson(review.material.policyDocument),
        exactInline: names.IsTruncated !== true && names.PolicyNames?.length === 1 && names.PolicyNames[0] === review.material.inlinePolicyName,
        noAttached: attached.IsTruncated !== true && attached.AttachedPolicies?.length === 0 };
      const result = { mode, observedAt: new Date().toISOString(), manifestSha256: review.manifestSha256, roleId: r.Role?.RoleId, policyId: p.Policy?.PolicyId,
        checks, outcome: Object.values(checks).every(Boolean) ? "IAM_INDEPENDENTLY_VERIFIED_NO_CELL" : "IAM_INSPECT_MISMATCH", writeCalls: 0, runtimeEnabled: false, cellDeploymentAuthorized: false };
      await save("inspect.json", result); process.stdout.write(`${JSON.stringify({ directory, ...result })}\n`);
      if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
    }
  }
} catch (e) {
  const message = e instanceof Error ? e.message : "ProviderError";
  const code = /^CELL_IAM_[A-Z0-9_:]+$/.test(message) ? message : e instanceof Error ? e.name : "ProviderError";
  await save("stopped.json", { mode, failureCode: code, awsWriteApiInvocations, scopeNotExpanded: true, automaticWriteRetry: false });
  process.stdout.write(`${JSON.stringify({ mode, directory, failureCode: code, awsWriteApiInvocations, automaticWriteRetry: false })}\n`); process.exitCode = 2;
} finally { iam.destroy(); sts.destroy(); }
