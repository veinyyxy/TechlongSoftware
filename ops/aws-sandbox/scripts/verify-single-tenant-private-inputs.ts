import { writeFile } from "node:fs/promises";
import { loadAcceptancePrivateSources } from "../../../lib/deployments/execution/single-tenant-private-loader.ts";
import { createAcceptanceControlBindingSources, createAcceptanceReadonlyNeonSql } from "../../../lib/deployments/execution/single-tenant-control-bindings.ts";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { ACCEPTANCE_CONTROL_INPUTS } from "../../../lib/deployments/execution/single-tenant-private-sources.ts";

// Existing local protected bundle only; expected digest comes from the
// preparation receipt. No AWS API, no token issuance, no HTTP control call.
if (process.argv.length !== 6 || process.argv[2] !== "--dir" || process.argv[4] !== "--summary-sha") throw Error("ACCEPTANCE_PRIVATE_VERIFY_ARGUMENTS_INVALID");
try {
  const loaded = await loadAcceptancePrivateSources({ directory: process.argv[3], expectedSummarySha256: process.argv[5] });
  const { sources, binding } = loaded, signal = AbortSignal.timeout(30000);
  try {
    const sql = createAcceptanceReadonlyNeonSql(process.env.DATABASE_URL ?? ""), controls = await createAcceptanceControlBindingSources(binding, sql);
    const app = await controls.bindings.loadForAppInstance({ appInstanceId: binding.scope.appInstanceId, signal });
    const template = await controls.templateVersions.loadById({ templateVersionId: binding.templateVersionId, signal });
    let absentGenerationRejected = false, foreignTokenRejected = false, foreignTransportRejected = false;
    try { await controls.runtimeBindings.load({ appInstanceId: binding.scope.appInstanceId, templateVersionId: binding.templateVersionId, signal }); }
    catch (e) { if (e instanceof Error && e.message === "ACCEPTANCE_FIRST_OWNER_VERIFIED_GENERATION_REQUIRED") absentGenerationRejected = true; else throw e; }
    try { await sources.controlTokens.issue({ instanceId: "app_foreign", audience: "speedfeast-instance:app_foreign", scope: "speedfeast:control", signal }); }
    catch (e) { foreignTokenRejected = e instanceof Error && e.message === "ACCEPTANCE_CONTROL_TOKEN_SCOPE_REJECTED"; }
    try { await sources.controlTransport.send({ method: "GET", url: "https://foreign.example.invalid:8443/", headers: {} }, { signal }); }
    catch (e) { foreignTransportRejected = e instanceof Error && e.message === "ACCEPTANCE_CONTROL_ENDPOINT_REJECTED"; }
    const serialized = JSON.stringify(sources);
    const checks = { restrictedAclVerified: loaded.aclVerified, appConfigurationReloaded: !!app && await sha256Hex(app.resolvedConfiguration) === binding.scope.configurationHash,
      publishedSchemaReloaded: template?.status === "published" && template.configurationSchema.schemaVersion === 2,
      absentGenerationRejected, foreignTokenRejected, foreignTransportRejected,
      serializedSourcesExcludeSecretMaterial: !/PRIVATE KEY|BEGIN CERTIFICATE|sk_test_|whsec_/.test(serialized),
      exactHostname: sources.summary.exactControlHostname === ACCEPTANCE_CONTROL_INPUTS.hostname };
    const receipt = { protocol: "d001-private-inputs-independent-readonly", observedAt: new Date().toISOString(), summarySha256: loaded.summarySha256, checks,
      outcome: Object.values(checks).every(Boolean) ? "PRIVATE_INPUTS_VERIFIED_RUNTIME_DISABLED" : "PRIVATE_INPUTS_INSPECT_REQUIRED",
      databaseWrites: 0, awsWrites: 0, awsSecretValueReads: 0, bearerTokensIssued: 0, controlHttpCalls: 0, runtimeEnabled: false };
    const bytes = `${JSON.stringify(receipt, null, 2)}\n`, file = "F:/ChatGPT_workshop/techlong-d001-private-inputs-inspect-20261013-r2.json";
    await writeFile(file, bytes, { flag: "wx", flush: true });
    process.stdout.write(`${JSON.stringify({ ...receipt, file, fileSha256: await sha256Hex(bytes) })}\n`);
    if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
  } finally { sources.dispose(); }
} catch (e) {
  const failureCode = e instanceof Error && /^ACCEPTANCE_[A-Z0-9_]+$/.test(e.message) ? e.message : e instanceof Error ? e.name : "ProviderError";
  process.stdout.write(`${JSON.stringify({ failureCode, awsWrites: 0, databaseWrites: 0, valuesPrinted: false, automaticWriteRetry: false })}\n`); process.exitCode = 2;
}
