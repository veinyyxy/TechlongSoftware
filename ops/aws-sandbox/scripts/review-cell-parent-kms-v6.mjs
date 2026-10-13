import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulateCustomPolicyCommand } from "@aws-sdk/client-iam";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { decodeReservationReviewV5, reservationParentCommonHashV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { cellParentIamDocumentsV4 } from "../../../lib/deployments/execution/cell-birth-parent-v4.ts";
import { cellParentIamDocumentsV6 } from "../../../lib/deployments/execution/cell-parent-iam-compatibility-v6.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as controls } from "../../../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { READONLY_KMS_KEY_ARN_V1 as keyArn } from "../../../lib/deployments/execution/readonly-kms-read-repair-v1.ts";
import { createReservationAwsV5 } from "./cell-reservation-aws-v5.mjs";

// This entry has NO Run, IAM/CFN write, invocation, credentials dump, Secret
// value, DB or slot-claim actuator. IAM simulations are data-only context cases,
// not actual Secrets Manager/KMS forwarding or effective-permission proof.
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9i-kms-review-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_PARENT_V6_FRESH_PRIVATE_REVIEW_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const b = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx", flush: true }); return sha256Hex(b); },
  hash = b => createHash("sha256").update(b).digest("hex");
let stage = "LOCAL_BINDING", liveAws, iam, sts;
try {
  const prior = JSON.parse(await readFile(path.join(root, "techlong-f3c9h-reserved-20261012-r1/code-binding.json"), "utf8"));
  if (prior.pins.length !== 109 || prior.codeSha256 !== "6426ee882b32787ee5441d291aa1b617dcbae601c2b526fdd21d67a4c04d784d" || await sha256Hex(prior.pins) !== prior.codeSha256) throw Error("CELL_PARENT_V6_OLD109_INVALID");
  const pinMap = new Map(prior.pins.map(p => [p.file, p.sha256]));
  for (const file of ["lib/deployments/execution/cell-parent-iam-compatibility-v6.ts", "lib/deployments/execution/cell-parent-compatibility-v6.ts",
    "ops/aws-sandbox/lambda/cell-birth-coordinator-v6.ts", "ops/aws-sandbox/scripts/build-cell-birth-parent-v6.mjs", "tests/cell-parent-compatibility-v6.test.ts", "ops/aws-sandbox/scripts/review-cell-parent-kms-v6.mjs"])
    pinMap.set(file, await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")));
  const pins = [...pinMap].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })), codeSha256 = await sha256Hex(pins);
  const verify = async () => { for (const p of pins) {
    const f = path.resolve(repo, p.file);
    if ((await lstat(f)).isSymbolicLink() || (await realpath(f)).toLowerCase() !== f.toLowerCase() || await sha256Hex((await readFile(f, "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_PARENT_V6_PIN_DRIFT");
  } };
  await verify(); await save("code-binding.json", { codeSha256, pins, old109CodeSha256: prior.codeSha256 });
  const slotName = "techlong-f3c9h-reserved-identity-create.permanent-slot.json", slotBytes = await readFile(path.join(root, slotName));
  if (hash(slotBytes) !== "89db5acfd987bae79a9f4372d614efee50b58ca0fa95abdfcbba483e7fb2a77b") throw Error("CELL_PARENT_V6_CONSUMED_CREATE_SLOT_DRIFT");
  const manifestText = await readFile(path.join(root, "techlong-f3c9h-reserved-20261012-r1/reserved-manifest.json"), "utf8");
  if (await sha256Hex(manifestText) !== "525fa2722b47d92486c9392e31cb0a4424b96286d9e784a0190693b8e676d7aa") throw Error("CELL_PARENT_V6_HISTORICAL_MANIFEST_DRIFT");
  const manifest = await decodeReservationReviewV5(JSON.parse(manifestText)), stackId = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/01a06ca0-c6bf-11f1-898a-0e285576029b";
  const documents = { old: cellParentIamDocumentsV4(stackId), candidate: cellParentIamDocumentsV6(stackId) };
  await save("permission-proposals.json", { historicalStackId: stackId, documents, installed: false, expiredPlanNotExtended: true });
  stage = "READONLY_SOURCE_AND_STACK"; liveAws = createReservationAwsV5(manifest.plan);
  const live = await liveAws.inspect(stackId);
  if ("state" in live.evidence || live.evidence.phase !== "RESERVED" || live.evidence.stackStatus !== "CREATE_COMPLETE" || live.evidence.resources.length ||
    !live.stackFlagsVerified || await reservationParentCommonHashV5(live.parent, false, Date.now()) !== manifest.parentCommonSha256 ||
    await sha256Hex(live.foundation) !== manifest.foundationSha256) throw Error("CELL_PARENT_V6_CURRENT_STACK_OR_LOCK_DRIFT");
  const liveEvidenceFileSha256 = await save("readonly-stack-and-locks.json", live);
  const cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true }, credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  iam = new IAMClient({ ...cfg, credentials }); sts = new STSClient({ ...cfg, credentials });
  const identity = async () => {
    const r = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
    if (r.Account !== "402010193138" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") throw Error("CELL_PARENT_V6_SOURCE_INVALID");
  };
  const simulate = async (label, doc, secretArn, expected, service = "secretsmanager.ca-central-1.amazonaws.com", resource = keyArn) => {
    const response = await iam.send(new SimulateCustomPolicyCommand({ PolicyInputList: [canonicalJson(doc.boundary)], ActionNames: ["kms:Decrypt"], ResourceArns: [resource],
      ContextEntries: Object.entries({ "aws:RequestedRegion": "ca-central-1", "kms:ViaService": service, "kms:CallerAccount": "402010193138", "kms:EncryptionContext:SecretARN": secretArn })
        .map(([ContextKeyName, value]) => ({ ContextKeyName, ContextKeyType: "string", ContextKeyValues: [value] })) }), { abortSignal: AbortSignal.timeout(25000) });
    const r = response.EvaluationResults?.[0];
    if (response.IsTruncated || response.Marker || response.EvaluationResults?.length !== 1 || r.EvalActionName !== "kms:Decrypt" || r.EvalResourceName !== resource || r.EvalDecision !== expected ||
      (expected === "allowed" && r.MissingContextValues?.length)) throw Error("CELL_PARENT_V6_CONTEXT_SIMULATION_UNVERIFIED");
    return { label, decision: r.EvalDecision, missingContextValues: r.MissingContextValues ?? [], sourceFunctionContextDeliberatelyOmitted: true, actualServiceCallPerformed: false };
  };
  stage = "NONMUTATING_CUSTOM_POLICY_CONTEXT_COMPARISON"; await identity();
  const simulations = [];
  for (const [index, target] of controls.entries()) {
    simulations.push(await simulate(`old-${index}-forwarded-context`, documents.old, target.secretArn, "explicitDeny"));
    simulations.push(await simulate(`candidate-${index}-forwarded-context`, documents.candidate, target.secretArn, "allowed"));
  }
  simulations.push(await simulate("candidate-wrong-service", documents.candidate, controls[0].secretArn, "implicitDeny", "lambda.ca-central-1.amazonaws.com"));
  simulations.push(await simulate("candidate-wrong-secret", documents.candidate, `${controls[0].secretArn}-other`, "implicitDeny"));
  simulations.push(await simulate("candidate-wrong-key", documents.candidate, controls[0].secretArn, "implicitDeny", undefined, keyArn.replace("3af8de5c", "00000000")));
  await identity(); await verify();
  if (hash(await readFile(path.join(root, slotName))) !== hash(slotBytes)) throw Error("CELL_PARENT_V6_SLOT_CHANGED_DURING_REVIEW");
  await save("simulation-cases.json", simulations);
  const report = { schemaVersion: 6, phase: "F3c9i_KMS_COMPATIBILITY_AND_EXPIRED_IDENTITY_REVIEW", observedAt: new Date().toISOString(), outcome: "READONLY_REVIEW_COMPLETE_NO_INSTALL_APPROVAL",
    codeSha256, boundFileCount: pins.length, old109Unchanged: true, liveEvidenceFileSha256, stackId, stackStatus: live.evidence.stackStatus, stackPhase: live.evidence.phase, resourceCount: live.evidence.resources.length,
    cellExpiresAt: manifest.plan.intent.cellExpiresAt, planExpired: Date.now() >= Date.parse(manifest.plan.intent.cellExpiresAt), historicalApprovalExpired: Date.now() >= manifest.expiresAt,
    parentWorkflowAbsent: live.parent.guards.parentWorkflowAndRegistrationAbsent, denyAllAndConcurrencyZeroPreserved: true, originalCreateSlotStillConsumed: true,
    oldPermissionBytes: Buffer.byteLength(canonicalJson(documents.old.boundary)), candidatePermissionBytes: Buffer.byteLength(canonicalJson(documents.candidate.boundary)),
    oldPermissionSha256: await sha256Hex(documents.old.boundary), candidatePermissionSha256: await sha256Hex(documents.candidate.boundary), contextSimulations: simulations,
    actualKmsForwardingOrRootInvocationProved: false, normalizedLegacyMetadataHashIsNotActualV6PolicyDigest: true,
    executableApprovalManifestCreated: false, iamInstallationAuthorized: false, codeUpdateAuthorized: false, retireOrRecreateAuthorized: false,
    cloudWrites: 0, iamWrites: 0, secretValueReads: 0, databaseConnections: 0, lambdaInvocations: 0, runtimeEnabled: false };
  const reportFileSha256 = await save("kms-review-report.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const safeCode = /^CELL_PARENT_V6_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  const report = { outcome: "READONLY_KMS_REVIEW_STOPPED", stage, safeCode, rawDiagnosticsWithheld: true, cloudWrites: 0, iamWrites: 0,
    codeUpdateAuthorized: false, retireOrRecreateAuthorized: false, runtimeEnabled: false };
  await save("failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
} finally { liveAws?.dispose(); iam?.destroy(); sts?.destroy(); }
