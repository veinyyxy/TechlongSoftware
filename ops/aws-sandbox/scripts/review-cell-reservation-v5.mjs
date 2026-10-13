import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { renderAwsSandboxSharedCellStackV3 } from "../../../lib/deployments/cloudformation/shared-cell-stack-v3.ts";
import { CELL_PARENT_LOCKED_UPDATE_V5 as artifact } from "../../../lib/deployments/execution/cell-parent-locked-update-v5.ts";
import { CELL_RESERVATION_V5 as t, prepareReservationReviewV5, decodeReservationReviewV5, assertReservationApprovalV5, assertReservationFoundationV5,
  assertReservedEvidenceV5, reservationParentCommonHashV5, runReservationOnceV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { createReservationAwsV5, reservationCertificateArnV5, reservationTrustStoreArnV5 } from "./cell-reservation-aws-v5.mjs";

// The static environment is an explicit deployment PROPOSAL, not an existing
// customer or a live Neon policy row. This runner never connects to Neon.
const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith("--") || !args[i + 1] || options[args[i]]) throw Error("RESERVATION_ARGUMENTS_INVALID"); options[args[i]] = args[i + 1];
}
const mode = options["--mode"], allowed = mode === "Review" ? ["--mode", "--out"] : mode === "Inspect" ? ["--mode", "--out", "--manifest"] : ["--mode", "--out", "--manifest", "--approved-sha"];
if (!["Review", "Run", "Inspect"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("RESERVATION_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]);
if ((await lstat(root)).isSymbolicLink() || root.toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() ||
  (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9h-reserved-[a-z0-9-]+$/.test(path.basename(out))) throw Error("RESERVATION_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx", flush: true }); return sha256Hex(text); };
const bytesHash = b => createHash("sha256").update(b).digest("hex");
let aws, stage = "LOCAL_BINDING", manifest, result;
try {
  const previous = JSON.parse(await readFile(path.join(root, "techlong-f3c9g-locked-update-20261012-r5/code-binding.json"), "utf8"));
  if (previous.codeSha256 !== t.previous95CodeSha256 || previous.pins.length !== 95 || await sha256Hex(previous.pins) !== t.previous95CodeSha256) throw Error("RESERVATION_OLD95_BINDING_INVALID");
  const pinsMap = new Map(previous.pins.map(p => [p.file, p.sha256])), scanned = new Set();
  const include = async file => {
    if (scanned.has(file)) return; scanned.add(file);
    const absolute = path.resolve(repo, file);
    if (!absolute.toLowerCase().startsWith(repo.toLowerCase()) || (await realpath(absolute)).toLowerCase() !== absolute.toLowerCase() || (await lstat(absolute)).isSymbolicLink()) throw Error("RESERVATION_SOURCE_PATH_INVALID");
    const text = (await readFile(absolute, "utf8")).replace(/\r\n/g, "\n"), sha = await sha256Hex(text);
    if (pinsMap.has(file) && pinsMap.get(file) !== sha) throw Error("RESERVATION_FROZEN_SOURCE_DRIFT"); pinsMap.set(file, sha);
    for (const match of text.matchAll(/\b(?:from\s*|import\s*)["'](\.[^"']+)["']/g))
      await include(path.relative(repo, path.resolve(path.dirname(absolute), match[1])).replaceAll("\\", "/"));
  };
  for (const file of ["lib/deployments/execution/cell-reservation-v5.ts", "ops/aws-sandbox/scripts/cell-reservation-aws-v5.mjs",
    "ops/aws-sandbox/scripts/review-cell-reservation-v5.mjs", "tests/cell-reservation-v5.test.ts"]) await include(file);
  const pins = [...pinsMap].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })), codeSha256 = await sha256Hex(pins);
  const oldSlots = [["techlong-f3c9d-failed-birth-installation.permanent-slot.json", "d113cae152d5eb0a3c4b10e7f16fd07983813bd303c8d0e057d729676f2b7d9e"],
    ["techlong-f3c9e-pg18-reviewed-installation.permanent-slot.json", "f5cb3a943c2751de168afbcf2b71766635a667443a2e22f82fe585e049d6bc39"],
    [artifact.permanentSlot, "fe99f83387cc8f4ab3449276d2573c04442224dd0c5e3c33f1e07f1d9e5fed58"]];
  const verifyFiles = async () => {
    for (const p of pins) {
      const f = path.resolve(repo, p.file);
      if ((await realpath(f)).toLowerCase() !== f.toLowerCase() || (await lstat(f)).isSymbolicLink() || await sha256Hex((await readFile(f, "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("RESERVATION_CODE_BINDING_DRIFT");
    }
    for (const [name, sha] of oldSlots) if ((await lstat(path.join(root, name))).isSymbolicLink() || bytesHash(await readFile(path.join(root, name))) !== sha) throw Error("RESERVATION_OLD_SLOT_DRIFT");
    const directory = path.join(root, artifact.bundleDirectory);
    if ((await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw Error("RESERVATION_FROZEN_ARTIFACT_PATH_INVALID");
    const report = await readFile(path.join(directory, "artifact-review.json"), "utf8"), data = JSON.parse(report);
    if (await sha256Hex(report) !== artifact.artifactReportFileSha256 || bytesHash(await readFile(path.join(directory, artifact.zipName))) !== artifact.zipSha256 ||
      bytesHash(await readFile(path.join(directory, artifact.bundleName))) !== artifact.bundleSha256 || bytesHash(await readFile(path.join(repo, "package-lock.json"))) !== data.packageLockSha256)
      throw Error("RESERVATION_FROZEN_ARTIFACT_DRIFT");
  };
  await verifyFiles(); await save("code-binding.json", { codeSha256, pins, previous95CodeSha256: t.previous95CodeSha256 });
  const slotPath = path.join(root, t.permanentSlot), slot = async () => {
    try { if ((await lstat(slotPath)).isSymbolicLink()) throw Error("RESERVATION_SLOT_PATH_INVALID"); return JSON.parse(await readFile(slotPath, "utf8")); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  };
  const existingSlot = await slot();
  if (mode !== "Review") {
    const filename = path.resolve(options["--manifest"]), directory = path.dirname(filename);
    if (path.basename(filename) !== "reserved-manifest.json" || path.dirname(directory).toLowerCase() !== root.toLowerCase() ||
      !/^techlong-f3c9h-reserved-[a-z0-9-]+$/.test(path.basename(directory)) || (await realpath(filename)).toLowerCase() !== filename.toLowerCase() || (await lstat(filename)).isSymbolicLink()) throw Error("RESERVATION_MANIFEST_PATH_INVALID");
    manifest = await decodeReservationReviewV5(JSON.parse(await readFile(filename, "utf8")));
    const binding = JSON.parse(await readFile(path.join(directory, "code-binding.json"), "utf8"));
    if (manifest.codeBindingSha256 !== codeSha256 || binding.codeSha256 !== codeSha256 || canonicalJson(binding.pins) !== canonicalJson(pins)) throw Error("RESERVATION_REVIEWED_CODE_DRIFT");
    if (mode === "Run") assertReservationApprovalV5(manifest, options["--approved-sha"], codeSha256, Date.now());
  } else {
    if (existingSlot) throw Error("RESERVATION_SLOT_OCCUPIED_INSPECT_ONLY");
    const environment = { id: "env_aws_sandbox_ca_central_1", key: "aws-sandbox-ca-central-1", name: "AWS Sandbox ca-central-1", kind: "aws_sandbox", driver: "aws_ecs_cell",
      expectedAccountId: "402010193138", region: "ca-central-1", cellKey: "cell-sandbox-1", baseDomain: "sandbox.techlong.cloud", applyEnabled: false, status: "active",
      policy: { budgetLimitCents: 5000, ttlSeconds: 7200, maxCells: 1, maxTenants: 1, maxTaskCount: 1, allowedProfiles: ["standard-v1"], allowNatGateway: false, allowInterfaceEndpoints: false,
        databaseEngine: "aurora-postgresql-serverless-v2", auroraPostgresMinimumVersion: "16.3", auroraPostgresEngineVersion: "16.14", auroraEngineMode: "provisioned", allowLimitlessDatabase: false,
        databaseMode: "tenant_database", auroraServerlessMinAcu: 0, auroraServerlessMaxAcu: 1, auroraSecondsUntilAutoPause: 300, allowDedicatedDatabase: false,
        allowMultiAzDatabase: false, allowRdsProxy: false, allowGlobalDatabase: false, logRetentionDays: 1 } };
    const nonce = randomBytes(16).toString("hex");
    const plan = await renderAwsSandboxSharedCellStackV3({ base: { environment, requestedAt: Date.now(), availabilityZones: ["ca-central-1a", "ca-central-1b"],
      certificateArn: reservationCertificateArnV5, controlTrustStoreArn: reservationTrustStoreArnV5 }, ownerDeploymentId: `cell_birth_${nonce}`, generation: 1, provisionEpoch: 1, launchNonce: nonce });
    aws = createReservationAwsV5(plan); stage = "READONLY_REVIEW";
    const [before, validation] = await Promise.all([aws.readBefore(), aws.validate()]);
    if (!before.absence) throw Error("RESERVATION_STACK_ALREADY_PRESENT_INSPECT_ONLY");
    await verifyFiles(); manifest = await prepareReservationReviewV5(plan, before.parent, before.foundation, codeSha256, Date.now());
    await save("readonly-before.json", { ...before, validation }); await save("cell-stack-v3-plan.json", plan); await save("cell-stack-v3-template.json", plan.template);
    const manifestFileSha256 = await save("reserved-manifest.json", manifest);
    result = { outcome: "RESERVATION_REVIEW_READY_NOT_CREATED", manifestSha256: manifest.manifestSha256, manifestFileSha256,
      expiresAt: new Date(manifest.expiresAt).toISOString(), cellExpiresAt: plan.intent.cellExpiresAt,
      requestSha256: manifest.requestSha256, planSha256: plan.planSha256, birthIntentSha256: plan.birthIntentSha256,
      resourceCountInFullTemplate: plan.resourceLogicalIds.length, expectedReservedResourceCount: 0, foundationAndSourceSimulationsVerified: true,
      noOtherCellOrParentWorkflowObserved: true, localSlotPresent: false, cloudWriteCalls: 0 };
  }
  if (mode === "Run") {
    aws = createReservationAwsV5(manifest.plan); stage = "REVIEWED_CREATE_ONCE";
    result = await runReservationOnceV5(manifest, options["--approved-sha"], codeSha256, {
      verifyFilesAndSource: async () => { await verifyFiles(); await aws.identity(); }, readBefore: aws.readBefore,
      claimOnce: async approvedManifestSha256 => {
        try { await writeFile(slotPath, JSON.stringify({ protocol: "cell-reserved-identity-permanent-attempt-v5", approvedManifestSha256, codeBindingSha256: codeSha256,
          requestSha256: manifest.requestSha256, attemptedAt: new Date().toISOString(), retryAuthorized: false }) + "\n", { flag: "wx", flush: true }); return true; }
        catch (e) { if (e.code === "EEXIST") return false; throw Error("RESERVATION_PERMANENT_SLOT_SAVE_FAILED"); }
      }, marker: save, createOnce: aws.createOnce, waitReadOnly: aws.waitReadOnly,
    });
    if (result.outcome !== "RESERVATION_CREATE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED") process.exitCode = 1;
  } else if (mode === "Inspect") {
    aws = createReservationAwsV5(manifest.plan); stage = "INDEPENDENT_READONLY_INSPECT";
    const live = await aws.inspect(null); await verifyFiles(); assertReservationFoundationV5(live.foundation);
    const absent = "state" in live.evidence, parentCommonMatches = await reservationParentCommonHashV5(live.parent, absent, Date.now()) === manifest.parentCommonSha256,
      foundationMatches = await sha256Hex(live.foundation) === manifest.foundationSha256;
    if (!parentCommonMatches || !foundationMatches) throw Error("RESERVATION_INDEPENDENT_LOCK_OR_FOUNDATION_DRIFT");
    const slotMatches = existingSlot?.protocol === "cell-reserved-identity-permanent-attempt-v5" && existingSlot.approvedManifestSha256 === manifest.manifestSha256 &&
      existingSlot.codeBindingSha256 === codeSha256 && existingSlot.requestSha256 === manifest.requestSha256;
    if (!absent) assertReservedEvidenceV5(manifest, live.evidence);
    result = { outcome: !absent && slotMatches && live.stackFlagsVerified ? "RESERVATION_ZERO_RESOURCE_IDENTITY_INDEPENDENTLY_VERIFIED" : "RESERVATION_ABSENT_OR_UNATTRIBUTED_INSPECT_ONLY",
      manifestSha256: manifest.manifestSha256, localSlotPresent: !!existingSlot, slotMatchesManifest: slotMatches,
      stackPresent: !absent, stackId: absent ? null : live.evidence.stackId, reservedResourceCount: absent ? null : live.evidence.resources.length,
      parentCommonMatches, foundationMatches, birthWindowStillLive: Date.now() < Date.parse(manifest.plan.intent.cellExpiresAt), cloudWriteCalls: 0 };
    await save("independent-evidence.json", live);
  }
  const summary = { schemaVersion: 5, mode, phase: "F3c9h_RESERVED_IDENTITY", observedAt: new Date().toISOString(), ...result,
    codeBindingSha256: codeSha256, boundFileCount: pins.length, old95AndFinalArtifactUnchanged: true,
    iamWrites: 0, lambdaInvocations: 0, secretValueReads: 0, neonConnections: 0, tableWrites: 0, parentRegistered: false,
    armedOrPaidCreated: false, runtimeEnabled: false, retryAuthorized: false, effectivePermissionsProved: false };
  const reportFileSha256 = await save("reserved-report.json", summary); console.log(JSON.stringify({ ...summary, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const safeCode = /^(RESERVATION|CELL_PARENT_UPDATE|LOCKED_UPDATE)_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  const failure = { outcome: "RESERVATION_STOPPED_INSPECT_ONLY", mode, stage, safeCode, retryAuthorized: false, runtimeEnabled: false,
    rawProviderDiagnosticsWithheld: true, independentInspectRequired: mode === "Run" };
  await save("failure.json", failure); console.log(JSON.stringify(failure, null, 2)); process.exitCode = 1;
} finally { aws?.dispose(); }
