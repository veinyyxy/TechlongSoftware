import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SecretsManagerClient, CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { CloudFormationClient, ValidateTemplateCommand } from "@aws-sdk/client-cloudformation";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { readCellFoundationFacts, CELL_PUBLIC_KEY_SECRET, CELL_PUBLIC_KEY_TAGS } from "./single-tenant-cell-live-readonly.ts";
import { prepareCellFoundationReview, decodeCellFoundationReview, assertCellFoundationApproval, createCellFoundationOperationControl,
  prepareUnstartedCellCleanupReview, createUnstartedCellCleanupControl, type CellFoundationPriceEstimate } from "../../../lib/deployments/execution/single-tenant-cell-foundation-review.ts";
import { createAcceptanceCellSdkPort, SingleTenantAcceptanceCellOperations, type AcceptanceCellCreateReceipt } from "../../../lib/deployments/execution/single-tenant-cell-operations.ts";
import { renderSingleTenantAcceptanceCell } from "../../../lib/deployments/cloudformation/single-tenant-acceptance-cell.ts";
import { decodeBusinessBootstrap } from "../../../lib/deployments/execution/single-tenant-business-bootstrap.ts";
import { createBusinessNeonClient, inspectBusinessBootstrap } from "./single-tenant-business-neon.ts";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";

const args: Record<string, string> = {};
for (let n = 2; n < process.argv.length; n += 2) { const key = process.argv[n], value = process.argv[n + 1];
  if (!key?.startsWith("--") || !value || args[key]) throw Error("CELL_FOUNDATION_ARGUMENTS_INVALID"); args[key] = value; }
const mode = args["--mode"], keys = mode === "Review" ? ["--mode", "--out", "--prices"] : mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] :
  mode === "CleanupRun" ? ["--mode", "--out", "--manifest", "--cleanup-manifest", "--run-dir", "--approved-sha"] : ["--mode", "--out", "--manifest", "--run-dir"];
if (!["Review", "Run", "Inspect", "CleanupReview", "CleanupRun"].includes(mode) || canonicalJson(Object.keys(args).sort()) !== canonicalJson(keys.sort())) throw Error("CELL_FOUNDATION_ARGUMENTS_INVALID");
const root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(args["--out"]);
if (path.dirname(out).toLowerCase() !== root.toLowerCase() || !/^techlong-d001-cell-foundation-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_FOUNDATION_FRESH_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (name: string, v: unknown) => { const b = `${JSON.stringify(v, null, 2)}\n`; await writeFile(path.join(out, name), b, { flag: "wx", flush: true }); return sha256Hex(b); };
const readPrivate = async (p: string) => { const resolved = path.resolve(p);
  if (!resolved.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`) || (await realpath(resolved)).toLowerCase() !== resolved.toLowerCase()) throw Error("CELL_FOUNDATION_PRIVATE_PATH_REQUIRED");
  return readFile(resolved, "utf8"); };
const files = ["lib/deployments/execution/single-tenant-cell-foundation-review.ts", "ops/aws-sandbox/scripts/single-tenant-cell-live-readonly.ts",
  "ops/aws-sandbox/scripts/review-single-tenant-cell-foundation.ts", "lib/deployments/execution/single-tenant-cell-operations.ts",
  "lib/deployments/cloudformation/single-tenant-acceptance-cell.ts", "lib/deployments/cloudformation/shared-cell-stack.ts",
  "lib/deployments/execution/single-tenant-cell-iam.ts", "lib/deployments/execution/single-tenant-private-sources.ts",
  "lib/deployments/execution/single-tenant-business-bootstrap.ts", "ops/aws-sandbox/scripts/single-tenant-business-neon.ts",
  "lib/deployments/execution/hash.ts", "lib/deployments/environment.ts", "lib/deployments/preflight.ts", "package-lock.json"];
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const pins = await Promise.all(files.map(async file => ({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) })));
const codeBindingSha256 = await sha256Hex(pins);
const credentials = defaultProvider({ profile: "techlong-sandbox-user" }), config = { region: "ca-central-1", credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const sm = new SecretsManagerClient(config), cfn = new CloudFormationClient(config), iam = new IAMClient(config);
const signal = AbortSignal.timeout(120000), opt = { abortSignal: signal }, now = () => Date.now();
const slot = path.join(root, "techlong-d001-cell-foundation-create.permanent-slot.json"), cellSlot = path.join(root, "techlong-d001-cell-foundation-cell-api.permanent-slot.json"),
  deleteSlot = path.join(root, "techlong-d001-cell-foundation-delete.permanent-slot.json");
const exclusive = (file: string, data: unknown) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", flush: true });
let writes = 0, publicSecretReads = 0, slotConsumed = false;
const business = async () => {
  const r = await decodeBusinessBootstrap(JSON.parse(await readPrivate(path.join(root, "techlong-d001-business-review-20261013-r3/manifest.json"))));
  const owner = JSON.parse(await readPrivate(path.join(root, "techlong-d001-owner-readonly-20261013-r1.json"))), db = await createBusinessNeonClient();
  try { await db.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
    const check = await inspectBusinessBootstrap(db.client, db.hostSha256, r, owner.suppliedEmail);
    const zero = await db.client.query<{ n: number }>("SELECT count(*)::int AS n FROM public.deployment_tenant_resources WHERE cell_key='cell-sandbox-1' AND environment_id='env_aws_sandbox_ca_central_1' AND (lifecycle_status<>'destroyed' OR runtime_secret_ref IS NOT NULL)");
    await db.client.query("ROLLBACK");
    if (!Object.values(check.checks).every(Boolean) || zero.rows[0].n !== 0) throw Error("CELL_FOUNDATION_BUSINESS_STARTED_OR_DRIFTED");
    return { check, noTenantGeneration: true, environment: { ...r.inventory.environment, policy: r.material.targetPolicy } };
  } finally { await db.client.end(); }
};
try {
  await save("code-binding.json", { codeBindingSha256, pins });
  if (mode === "Review") {
    // Never refresh/rebase a consumed foundation attempt.
    try { await readFile(slot); throw Error("CELL_FOUNDATION_SLOT_OCCUPIED_INSPECT_ONLY"); } catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e; }
    const original = JSON.parse(await readPrivate(path.join(root, "techlong-d001-cell-template-20261013-r2/input.json"))), b = await business();
    const cellInput = { ...original, environment: b.environment, requestedAt: Date.now() }, draft = await renderSingleTenantAcceptanceCell(cellInput);
    const facts = await readCellFoundationFacts(draft.tags, signal);
    const priceBytes = await readPrivate(args["--prices"]), feed = JSON.parse(priceBytes);
    const rate = (service: string, usage: string, description?: RegExp) => {
      const rows = feed.snapshots.find((s: { service: string }) => s.service === service)?.selected.filter((r: { attributes: { usagetype: string }; description: string }) => r.attributes.usagetype === usage && (!description || description.test(r.description)));
      if (rows?.length !== 1) throw Error("CELL_FOUNDATION_PRICE_DIMENSION_AMBIGUOUS"); return Number(rows[0].usd); };
    const prices: CellFoundationPriceEstimate = { priceFileSha256: await sha256Hex(priceBytes), observedAt: Date.parse(feed.at), region: "ca-central-1", currency: "USD",
      rates: { albHour: rate("AWSELB", "CAN1-LoadBalancerUsage", /Application LoadBalancer-hour/), truststoreHour: rate("AWSELB", "CAN1-TS-LoadBalancerUsage"),
        lcuHour: rate("AWSELB", "CAN1-LCUUsage", /Application load balancer/), ipv4Hour: rate("AmazonVPC", "CAN1-PublicIPv4:InUseAddress"),
        acuHour: rate("AmazonRDS", "CAN1-Aurora:ServerlessV2Usage"), secretMonth: rate("AWSSecretsManager", "CAN1-AWSSecretsManager-Secrets"),
        storageGbMonth: rate("AmazonRDS", "CAN1-Aurora:StorageUsage"), ioRequest: rate("AmazonRDS", "CAN1-Aurora:StorageIOUsage") } };
    const pub = await readPrivate(path.join(root, "techlong-d001-credentials-20261013-r2/control-public-key.pem"));
    if (await sha256Hex(pub) !== "72f953b9f3dab5269a7a1c08fa7acf684d2d9c379ae446b50e3d8294404f02a2" || /PRIVATE/.test(pub) || createPublicKey(pub).asymmetricKeyDetails?.modulusLength !== 3072) throw Error("CELL_FOUNDATION_PUBLIC_KEY_DRIFT");
    const v = await cfn.send(new ValidateTemplateCommand({ TemplateBody: draft.templateBody }), opt);
    if (v.Capabilities?.length || v.Parameters?.length !== 4) throw Error("CELL_FOUNDATION_TEMPLATE_VALIDATION_MISMATCH");
    const review = await prepareCellFoundationReview({ cellInput, facts, businessInspect: b.check, prices, codeBindingSha256 });
    await save("manifest.json", review); await save("template.json", draft.template); await save("aws-template-validation.json", v);
    process.stdout.write(`${JSON.stringify({ mode, directory: out, manifestSha256: review.manifestSha256, expiresAt: new Date(review.expiresAt).toISOString(),
      cellDeadline: review.cellDeadline, estimate: review.estimate, maximumDirectWrites: 2, writes: 0, checksPassed: facts.checksPassed })}\n`);
  } else {
    const r = await decodeCellFoundationReview(JSON.parse(await readPrivate(args["--manifest"])));
    if (r.codeBindingSha256 !== codeBindingSha256) throw Error("CELL_FOUNDATION_CODE_BINDING_DRIFT");
    const sdk = await createAcceptanceCellSdkPort();
    const publicReceipt = async (dir: string) => JSON.parse(await readPrivate(path.join(path.resolve(dir), "public-key-created.json")));
    const verifyPublic = async (p: { arn: string; versionId: string }) => {
      const prefix = `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${r.publicKeySecret.name}-`;
      if (!p.arn?.startsWith(prefix) || !/^[A-Za-z0-9]{6}$/.test(p.arn.slice(prefix.length)) || p.versionId !== await sha256Hex(`public-key:${r.manifestSha256}`)) throw Error("CELL_FOUNDATION_PUBLIC_RECEIPT_REJECTED");
      const m = await sm.send(new DescribeSecretCommand({ SecretId: p.arn }), opt);
      const tags = Object.fromEntries((m.Tags ?? []).map(t => [t.Key, t.Value]));
      if (m.ARN !== p.arn || m.Name !== r.publicKeySecret.name || m.DeletedDate || m.RotationEnabled || new Set((m.Tags ?? []).map(t => t.Key)).size !== m.Tags?.length ||
        canonicalJson(tags) !== canonicalJson(CELL_PUBLIC_KEY_TAGS) || canonicalJson(m.VersionIdsToStages) !== canonicalJson({ [p.versionId]: ["AWSCURRENT"] })) throw Error("CELL_FOUNDATION_PUBLIC_SECRET_METADATA_DRIFT");
      publicSecretReads++;
      const v = await sm.send(new GetSecretValueCommand({ SecretId: p.arn, VersionId: p.versionId, VersionStage: "AWSCURRENT" }), opt);
      if (v.ARN !== p.arn || v.Name !== r.publicKeySecret.name || v.VersionId !== p.versionId || !v.SecretString || v.SecretBinary || await sha256Hex(v.SecretString) !== r.publicKeySecret.publicKeySha256)
        throw Error("CELL_FOUNDATION_PUBLIC_SECRET_VALUE_DRIFT");
    };
    if (mode === "Run") {
      const approval = () => assertCellFoundationApproval(r, args["--approved-sha"], codeBindingSha256, now());
      approval(); await business(); const draft = await renderSingleTenantAcceptanceCell(r.cellInput);
      const f = await readCellFoundationFacts(draft.tags, signal); approval();
      if (await sha256Hex({ ...f, observedAt: 0 }) !== r.factsSha256 || now() - f.observedAt > 30000) throw Error("CELL_FOUNDATION_PREWRITE_DRIFT");
      const pub = await readPrivate(path.join(root, "techlong-d001-credentials-20261013-r2/control-public-key.pem"));
      if (await sha256Hex(pub) !== r.publicKeySecret.publicKeySha256) throw Error("CELL_FOUNDATION_PUBLIC_KEY_DRIFT");
      await exclusive(slot, { protocol: r.protocol, manifestSha256: r.manifestSha256, codeBindingSha256, consumedAt: now(), maximumDirectWrites: 2 }); slotConsumed = true;
      approval(); const who = await sdk.identity(signal); if (who.Account !== "402010193138" || who.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || who.UserId !== "AIDAV3GNMXTZEO7SHLC2X") throw Error("CELL_FOUNDATION_SOURCE_REJECTED");
      approval(); writes++;
      const versionId = await sha256Hex(`public-key:${r.manifestSha256}`), result = await sm.send(new CreateSecretCommand({ Name: CELL_PUBLIC_KEY_SECRET,
        ClientRequestToken: versionId, SecretString: pub, Tags: Object.entries(CELL_PUBLIC_KEY_TAGS).map(([Key, Value]) => ({ Key, Value })) }), opt);
      if (!result.ARN || result.Name !== CELL_PUBLIC_KEY_SECRET || result.VersionId !== versionId) throw Error("CELL_FOUNDATION_PUBLIC_CREATE_UNCERTAIN");
      const p = { arn: result.ARN, versionId, manifestSha256: r.manifestSha256 };
      await save("public-key-created.json", p);
      const control = createCellFoundationOperationControl({ review: r, approvedSha256: args["--approved-sha"], currentCodeBindingSha256: codeBindingSha256,
        readFacts: s => readCellFoundationFacts(draft.tags, s), verifyPublicKeySecret: () => verifyPublic(p), verifyBusinessUnstarted: async () => { await business(); },
        journal: { consumeCell: data => exclusive(cellSlot, { ...data, codeBindingSha256 }), captureCell: receipt => save("cell-created.json", receipt).then(() => undefined) } });
      const countedSdk = { ...sdk, create: async (i: Record<string, unknown>, s: AbortSignal) => { writes++; return sdk.create(i, s); } };
      const receipt = await new SingleTenantAcceptanceCellOperations(countedSdk, control).create({ draft, approvedReviewSha256: r.manifestSha256, signal });
      const report = { outcome: "FOUNDATION_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT", manifestSha256: r.manifestSha256, codeBindingSha256,
        stackId: receipt.stackId, awsWriteApiInvocations: writes, publicSecretValueReads: publicSecretReads, slotConsumed, runtimeEnabled: false, writesAutomaticallyRetried: false };
      await save("run.json", report); process.stdout.write(`${JSON.stringify({ mode, directory: out, ...report })}\n`);
    } else {
      const runDir = path.resolve(args["--run-dir"]), receipt = JSON.parse(await readPrivate(path.join(runDir, "cell-created.json"))) as AcceptanceCellCreateReceipt;
      const consumed = JSON.parse(await readPrivate(slot));
      if (consumed.manifestSha256 !== r.manifestSha256 || consumed.codeBindingSha256 !== codeBindingSha256 || receipt.reviewSha256 !== r.manifestSha256 || receipt.templateSha256 !== r.templateSha256) throw Error("CELL_FOUNDATION_CAPTURE_NOT_BOUND");
      const deny = async () => { throw Error("CELL_FOUNDATION_READONLY_ONLY"); };
      const reader = new SingleTenantAcceptanceCellOperations(sdk, { beforeCreate: deny, beforeDelete: deny, consume: deny, captureCreated: deny });
      const snapshot = await reader.inspect(receipt, signal); await save("snapshot.json", snapshot);
      if (mode === "Inspect") {
        await verifyPublic(await publicReceipt(runDir));
        const complete = snapshot?.status === "CREATE_COMPLETE" && snapshot.resources.length === 25 && snapshot.resources.every(x => x.status === "CREATE_COMPLETE");
        const report = { observedAt: new Date().toISOString(), outcome: complete ? "CELL_FOUNDATION_VERIFIED_NO_TENANT" : snapshot ? "CELL_PENDING_OR_FAILED_INSPECT_ONLY" : "CELL_EXACT_UUID_ABSENT",
          stackId: receipt.stackId, awsWrites: 0, publicSecretValueReads: publicSecretReads, databaseWrites: 0, runtimeEnabled: false, retryAuthorized: false };
        await business(); await save("inspect.json", report); process.stdout.write(`${JSON.stringify({ mode, directory: out, ...report })}\n`);
      } else {
        if (!snapshot) throw Error("CELL_FOUNDATION_CLEANUP_ALREADY_ABSENT");
        const exec = promisify(execFile), verifyUnstarted = async () => {
          const b = await business();
          const roleFacts = await readCellFoundationFacts(r.facts.simulations.length ? (await renderSingleTenantAcceptanceCell(r.cellInput)).tags : {}, signal);
          if (!Object.values(roleFacts.roleChecks).every(Boolean) || roleFacts.roleMaterialSha256 !== r.facts.roleMaterialSha256 ||
            canonicalJson(roleFacts.defaultKeys) !== canonicalJson(r.facts.defaultKeys)) throw Error("CELL_FOUNDATION_CLEANUP_ROLE_DRIFT");
          const c = await exec("aws", ["ecs", "describe-clusters", "--clusters", "cell-sandbox-1", "--profile", "techlong-sandbox-user", "--region", "ca-central-1", "--output", "json", "--no-cli-pager"], {
            timeout: 15000, windowsHide: true, env: { ...process.env, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true" } });
          const data = JSON.parse(c.stdout), empty = data.clusters?.length === 1 && data.clusters[0].runningTasksCount === 0 && data.clusters[0].pendingTasksCount === 0 && data.clusters[0].activeServicesCount === 0;
          const sim = await iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", ActionNames: ["cloudformation:DeleteStack"], ResourceArns: [receipt.stackId],
            ContextEntries: [{ ContextKeyName: "cloudformation:RoleArn", ContextKeyType: "string", ContextKeyValues: [receipt.serviceRoleArn] }, { ContextKeyName: "aws:RequestedRegion", ContextKeyType: "string", ContextKeyValues: ["ca-central-1"] }] }), opt);
          const allowed = sim.EvaluationResults?.length === 1 && sim.EvaluationResults[0].EvalDecision === "allowed" && !sim.EvaluationResults[0].MissingContextValues?.length;
          if (!empty || !allowed) throw Error("CELL_FOUNDATION_UNSTARTED_CLEANUP_NOT_READY");
          return { observedAt: now(), noDeploymentOrJob: b.check.checks.noDeploymentOrJob, noTenantGeneration: b.noTenantGeneration, noEcsServicesOrTasks: empty, permissionsAllowed: allowed };
        };
        if (mode === "CleanupReview") {
          const proof = await verifyUnstarted(), cleanup = await prepareUnstartedCellCleanupReview(receipt, snapshot, proof, codeBindingSha256);
          await save("cleanup-manifest.json", cleanup); process.stdout.write(`${JSON.stringify({ mode, directory: out, manifestSha256: cleanup.manifestSha256, exactStackId: receipt.stackId, expiresAt: new Date(cleanup.expiresAt).toISOString(), writes: 0 })}\n`);
        } else {
          const raw = JSON.parse(await readPrivate(args["--cleanup-manifest"]));
          const cleanup = await prepareUnstartedCellCleanupReview(raw.receipt, raw.snapshot, raw.proof, raw.codeBindingSha256, raw.reviewedAt);
          if (canonicalJson(raw) !== canonicalJson(cleanup)) throw Error("CELL_FOUNDATION_CLEANUP_MANIFEST_DRIFT");
          const control = createUnstartedCellCleanupControl({ review: cleanup, approvedSha256: args["--approved-sha"], currentCodeBindingSha256: codeBindingSha256,
            verifyStillUnstarted: async () => { await verifyUnstarted(); }, consume: data => exclusive(deleteSlot, { ...data, codeBindingSha256 }) });
          const counted = { ...sdk, delete: async (i: Record<string, unknown>, s: AbortSignal) => { writes++; await sdk.delete(i, s); } };
          const result = await new SingleTenantAcceptanceCellOperations(counted, control).delete({ receipt, approvedReviewSha256: args["--approved-sha"], signal });
          await save("delete-run.json", { ...result, awsWrites: writes, publicKeySecretDeleted: false }); process.stdout.write(`${JSON.stringify({ mode, directory: out, ...result, awsWrites: writes })}\n`);
        }
      }
    }
  }
} catch (e) {
  const text = e instanceof Error ? e.message : "ProviderError", failureCode = /^CELL_FOUNDATION_[A-Z0-9_]+$/.test(text) ? text : e instanceof Error ? e.name : "ProviderError";
  const report = { mode, failureCode, awsWriteApiInvocations: writes, publicSecretValueReads: publicSecretReads, slotConsumed, automaticWriteRetry: false, runtimeEnabled: false };
  await save("stopped.json", report); process.stdout.write(`${JSON.stringify({ directory: out, ...report })}\n`); process.exitCode = 2;
} finally { sm.destroy(); cfn.destroy(); iam.destroy(); }
