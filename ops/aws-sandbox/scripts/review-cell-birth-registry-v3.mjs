import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { createCellBirthRegistrySdkV3, AwsSdkCellBirthRegistryReaderV3 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-registry-v3.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as tableArn } from "../../../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";
import { CELL_BIRTH_REGISTRATION_KEY_V3 } from "../../../lib/deployments/execution/cell-birth-registration-v3.ts";

// Read-only entry. No install/run/claim/invoke/reset command or approval SHA.
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c6-birth-registry-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_BIRTH_FRESH_PRIVATE_REVIEW_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx" }); return sha256Hex(text); };
let stage = "CODE_BINDING";
try {
  const previousPath = path.join(root, "techlong-f3c5-cell-v3-20261012-r1/code-binding.json");
  if ((await lstat(previousPath)).isSymbolicLink()) throw Error("CELL_BIRTH_HISTORY_PATH_INVALID");
  const previous = JSON.parse(await readFile(previousPath, "utf8"));
  if (previous.codeSha256 !== "f69e4250c0c9894b1981579e1e7ddc0a0a70e214536fe53585190a24700209d8" || await sha256Hex(previous.pins) !== previous.codeSha256 || previous.pins.length !== 32) throw Error("CELL_BIRTH_OLD32_BINDING_INVALID");
  for (const p of previous.pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_BIRTH_OLD32_BINDING_DRIFT");
  const files = [...new Set([...previous.pins.map(p => p.file), "lib/deployments/execution/cell-birth-registration-v3.ts", "lib/deployments/execution/aws-sdk-cell-birth-registry-v3.ts",
    "lib/deployments/execution/prepared-cell-birth-coordinator-v3.ts", "ops/aws-sandbox/scripts/review-cell-birth-registry-v3.mjs"] )];
  const pins = []; for (const file of files) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256 });
  stage = "SOURCE_STRONG_READ";
  const cfg = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }, credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  const clients = createCellBirthRegistrySdkV3(credentials), meta = new DynamoDBClient({ ...cfg, credentials });
  let result;
  try {
    const reader = new AwsSdkCellBirthRegistryReaderV3(clients.sdk, "source_inspection"), signal = AbortSignal.timeout(45000);
    const before = await reader.readStrong({ signal });
    const r = await meta.send(new DescribeTableCommand({ TableName: tableArn }), { abortSignal: signal }), t = r.Table;
    if (!t || t.TableArn !== tableArn || t.TableId !== "58c851f4-5b8e-45ce-8933-05c33b17fb21" || t.TableStatus !== "ACTIVE" ||
      t.KeySchema?.length !== 1 || t.KeySchema[0].AttributeName !== "authority_key" || t.KeySchema[0].KeyType !== "HASH") throw Error("CELL_BIRTH_REGISTRY_TABLE_BINDING_DRIFT");
    const after = await reader.readStrong({ signal });
    if ((before?.record.registrationSha256 ?? null) !== (after?.record.registrationSha256 ?? null)) throw Error("CELL_BIRTH_REGISTRY_READ_DRIFT");
    result = { observedAt: new Date().toISOString(), tableArn, tableId: t.TableId, tableStatus: t.TableStatus, registrationKey: CELL_BIRTH_REGISTRATION_KEY_V3,
      registrationState: after ? "PRESENT_REQUIRES_SEPARATE_REVIEW" : "ABSENT", registrationSha256: after?.record.registrationSha256 ?? null,
      sourceIdentityVerifiedBeforeAndAfter: true, independentConsistentReads: 2, tableKeySchemaVerified: true,
      archivedF3c5CellAndCoordinatorAbsenceNotRefreshed: true };
  } finally { clients.dispose(); meta.destroy(); }
  stage = "FINAL_CODE_BINDING";
  for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_BIRTH_FINAL_CODE_BINDING_DRIFT");
  const report = { schemaVersion: 1, phase: "F3c6_REGISTRY_JOURNAL_DRAIN_COORDINATOR_PREPARATION", outcome: "READONLY_REGISTRY_REVIEW_COMPLETE_NOT_INSTALLED", ...result,
    sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", old32CodeSha256: previous.codeSha256, codeSha256, boundFileCount: pins.length,
    approvedScopeIsCurrentlyDrainOnly: true, registrationAuthorized: false, iamInstallationAuthorized: false, cellDeploymentAuthorized: false, runtimeEnabled: false,
    executableApprovalManifestCreated: false, awsResourceWrites: 0, iamWrites: 0, authorityItemWrites: 0, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0,
    actualLambdaCompositionAndCodeIdentityVerificationStillRequired: true, certifiedFailureExclusionFenceAndCensusStillRequired: true,
    ttlAuthorityIssuanceAndDeleteActuationStillRequired: true };
  const reportFileSha256 = await save("birth-registry-review.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: await realpath(out) }, null, 2));
} catch (e) {
  const safeCode = /^[A-Z0-9_]{4,120}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  const report = { outcome: "READONLY_REVIEW_INCOMPLETE", stage, safeCode, noRawProviderDiagnosticsPersisted: true, awsResourceWrites: 0, authorityItemWrites: 0,
    lambdaInvocations: 0, databaseConnections: 0, automaticWriteRetryAuthorized: false };
  await save("read-only-failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
}
