import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { sha256Hex, canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { createCellBirthRegistrySdkV3, AwsSdkCellBirthRegistryReaderV3 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-registry-v3.ts";
import { AwsSdkFailedBirthDdbReaderV1 } from "../../../lib/deployments/execution/aws-sdk-failed-cell-birth-ddb-v1.ts";
import { FAILED_BIRTH_DDB_KEYS_V1 } from "../../../lib/deployments/execution/failed-cell-birth-ddb-v1.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as tableArn } from "../../../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";

// Fresh read-only entry, no credentials/Secret values, installs, helper execute,
// journal writes, DeleteStack or mutation approval inputs.
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c8-failed-birth-ddb-[a-z0-9-]+$/.test(path.basename(out))) throw Error("FAILED_BIRTH_DDB_FRESH_PRIVATE_REVIEW_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx" }); return sha256Hex(text); };
let stage = "CODE_BINDING";
try {
  const history = path.join(root, "techlong-f3c7-failed-birth-prestate-20261012-r3/code-binding.json");
  if ((await lstat(history)).isSymbolicLink()) throw Error("FAILED_BIRTH_DDB_HISTORY_PATH_INVALID");
  const previous = JSON.parse(await readFile(history, "utf8"));
  if (previous.codeSha256 !== "361360c24888c562a0c64e98c436545438bb79ba83c3e204770321a896c71b7a" || previous.pins.length !== 42 || await sha256Hex(previous.pins) !== previous.codeSha256) throw Error("FAILED_BIRTH_DDB_OLD42_BINDING_INVALID");
  for (const p of previous.pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("FAILED_BIRTH_DDB_OLD42_BINDING_DRIFT");
  const files = [...previous.pins.map(p => p.file), "lib/deployments/execution/failed-cell-birth-ddb-v1.ts", "lib/deployments/execution/aws-sdk-failed-cell-birth-ddb-v1.ts",
    "lib/deployments/execution/aws-sdk-failed-cell-birth-recovery-v1.ts", "ops/aws-sandbox/scripts/review-failed-cell-birth-ddb-v1.mjs"];
  const pins = []; for (const file of files) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256 });
  stage = "SOURCE_TRANSACTIONAL_READ";
  const cfg = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }, credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  const clients = createCellBirthRegistrySdkV3(credentials), meta = new DynamoDBClient({ ...cfg, credentials });
  let result;
  try {
    const reader = new AwsSdkFailedBirthDdbReaderV1(clients.sdk), registry = new AwsSdkCellBirthRegistryReaderV3(clients.sdk, "source_inspection"), signal = AbortSignal.timeout(45000);
    const before = await reader.readStrong(signal), registered = await registry.readStrong({ signal });
    const r = await meta.send(new DescribeTableCommand({ TableName: tableArn }), { abortSignal: signal }), t = r.Table;
    if (!t || t.TableArn !== tableArn || t.TableId !== "58c851f4-5b8e-45ce-8933-05c33b17fb21" || t.TableStatus !== "ACTIVE" ||
      t.KeySchema?.length !== 1 || t.KeySchema[0].AttributeName !== "authority_key" || t.KeySchema[0].KeyType !== "HASH") throw Error("FAILED_BIRTH_DDB_TABLE_BINDING_DRIFT");
    const after = await reader.readStrong(signal);
    const state = v => ({ markerSha256: v.marker?.markerSha256 ?? null, intentSha256: v.intent?.intentSha256 ?? null, receiptSha256: v.receipt?.receiptSha256 ?? null,
      provisionPresent: v.provisionPresent, activationPresent: v.activationPresent, provisionItemSha256: v.provisionItemSha256, activationItemSha256: v.activationItemSha256 });
    if (canonicalJson(state(before)) !== canonicalJson(state(after))) throw Error("FAILED_BIRTH_DDB_READ_DRIFT");
    result = { observedAt: new Date(after.observedAt).toISOString(), tableArn, tableId: t.TableId, tableStatus: t.TableStatus,
      keys: FAILED_BIRTH_DDB_KEYS_V1, state: state(after), sourceIdentityVerifiedBeforeAndAfter: true, independentTransactionalReads: 2,
      oldDrainRegistrationPresent: registered !== null, oldDrainRegistrationSha256: registered?.record.registrationSha256 ?? null,
      oldDrainRegistrationDeletesFailure: registered?.record.manifest.scope.deleteFailedBirth ?? false,
      legacyPublisherPermissionIsolationProved: false, guardedActivationAndProvisionTransactionDraftsOnly: true,
      exactStackRecoveryNotInvokedWithoutRealIntent: true, archivedCellAbsenceNotRefreshed: true };
  } finally { clients.dispose(); meta.destroy(); }
  stage = "FINAL_CODE_BINDING";
  for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("FAILED_BIRTH_DDB_FINAL_CODE_BINDING_DRIFT");
  const report = { schemaVersion: 1, phase: "F3c8_FAILED_BIRTH_DDB_EXCLUSION_AND_COMPENSATION_JOURNAL", outcome: "READONLY_PRESTATE_VERIFIED_NOT_INSTALLED", ...result,
    sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", old42CodeSha256: previous.codeSha256, codeSha256, boundFileCount: pins.length,
    mutationApprovalManifestCreated: false, iamInstallationAuthorized: false, markerInstallationAuthorized: false, journalReservationAuthorized: false,
    cellDeletionAuthorized: false, paidCellDeploymentAuthorized: false, runtimeEnabled: false,
    awsResourceWrites: 0, iamWrites: 0, authorityItemWrites: 0, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0,
    legacyPublisherIsolationAndFullParentDeleteScopeStillRequired: true, deleteActuatorAndActualRuntimeCompositionStillRequired: true };
  const reportFileSha256 = await save("failed-birth-ddb-review.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: await realpath(out) }, null, 2));
} catch (e) {
  const safeCode = /^[A-Z0-9_]{4,120}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  const report = { outcome: "READONLY_REVIEW_INCOMPLETE", stage, safeCode, noRawProviderDiagnosticsPersisted: true,
    awsResourceWrites: 0, authorityItemWrites: 0, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0, automaticWriteRetryAuthorized: false };
  await save("read-only-failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
}
