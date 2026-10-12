import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, ValidateTemplateCommand } from "@aws-sdk/client-cloudformation";
import { IAMClient, GetRoleCommand } from "@aws-sdk/client-iam";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { renderAwsSandboxSharedCellStackV3, CELL_LIFECYCLE_COORDINATOR_V3 } from "../../../lib/deployments/cloudformation/shared-cell-stack-v3.ts";
import { createCellV3EvidenceFromCredentials } from "../../../lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts";

// Static target policy is a PROPOSAL, not a current Neon row or activation.
// No test fixture is imported. No apply/ARMED/PAID/installer command is exposed.
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c5-cell-v3-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_V3_FRESH_PRIVATE_REVIEW_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const b = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx" }); return sha256Hex(b); };
const cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true }, execute = promisify(execFile); let stage = "LOCAL_BLUEPRINT";
try {
  const oldPinPath = path.join(root, "techlong-f3c4-deployment-prerequisites-20261012-r2/code-binding.json"); if ((await lstat(oldPinPath)).isSymbolicLink()) throw Error("CELL_V3_HISTORY_PATH_INVALID");
  const oldPin = JSON.parse(await readFile(oldPinPath, "utf8")); if (oldPin.codeSha256 !== "66415f118d24c81249ebe9dbcf12ed85a64c5ba7a3c5d674deeb8febe15fbe5e" || await sha256Hex(oldPin.pins) !== oldPin.codeSha256) throw Error("CELL_V3_OLD_CODE_BINDING_DRIFT");
  for (const p of oldPin.pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_V3_OLD_CODE_BINDING_DRIFT");
  const files = [...new Set([...oldPin.pins.map(p => p.file), "lib/deployments/cloudformation/shared-cell-stack.ts", "lib/deployments/cloudformation/shared-cell-stack-v3.ts",
    "lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts", "lib/deployments/execution/cell-birth-lifecycle-v3.ts", "lib/deployments/environment.ts", "lib/deployments/preflight.ts", "lib/deployments/profiles.ts",
    "ops/aws-sandbox/scripts/review-cell-stack-v3.mjs"] )];
  const pins = []; for (const file of files) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256 });
  const environment = { id: "env_aws_sandbox_ca_central_1", key: "aws-sandbox-ca-central-1", name: "AWS Sandbox ca-central-1", kind: "aws_sandbox", driver: "aws_ecs_cell",
    expectedAccountId: "402010193138", region: "ca-central-1", cellKey: "cell-sandbox-1", baseDomain: "sandbox.techlong.cloud", applyEnabled: false, status: "active",
    policy: { budgetLimitCents: 5000, ttlSeconds: 7200, maxCells: 1, maxTenants: 1, maxTaskCount: 1, allowedProfiles: ["standard-v1"], allowNatGateway: false, allowInterfaceEndpoints: false,
      databaseEngine: "aurora-postgresql-serverless-v2", auroraPostgresMinimumVersion: "16.3", auroraPostgresEngineVersion: "16.14", auroraEngineMode: "provisioned", allowLimitlessDatabase: false,
      databaseMode: "tenant_database", auroraServerlessMinAcu: 0, auroraServerlessMaxAcu: 1, auroraSecondsUntilAutoPause: 300, allowDedicatedDatabase: false,
      allowMultiAzDatabase: false, allowRdsProxy: false, allowGlobalDatabase: false, logRetentionDays: 1 } };
  const provider = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  const session = async () => { const credentials = await provider(), c = new STSClient({ ...cfg, credentials }); try { const r = await c.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
    if (r.Account !== "402010193138" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X") throw Error("CELL_V3_SOURCE_INVALID"); return credentials; } finally { c.destroy(); } };
  const nativeRead = async (service, command, args) => {
    if (!["acm/describe-certificate", "elbv2/describe-trust-stores", "ec2/describe-availability-zones", "lambda/get-function-configuration"].includes(`${service}/${command}`)) throw Error("CELL_V3_NATIVE_READ_NOT_ALLOWED");
    const c = await session(); try { const r = await execute("aws", [service, command, ...args, "--region", cfg.region, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
      { timeout: 30000, windowsHide: true, maxBuffer: 2000000, env: { ...process.env, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey,
        AWS_SESSION_TOKEN: c.sessionToken, AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } }); return { present: true, data: JSON.parse(r.stdout) }; }
    catch (e) { if (service === "lambda" && /\(ResourceNotFoundException\)/.test(e.stderr ?? "")) return { present: false, data: null }; throw Error("CELL_V3_NATIVE_READ_UNVERIFIED"); }
  };
  stage = "READONLY_FOUNDATION_AND_COORDINATOR_METADATA";
  const certArn = "arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d", trustArn = "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44";
  const cert = await nativeRead("acm", "describe-certificate", ["--certificate-arn", certArn]), trust = await nativeRead("elbv2", "describe-trust-stores", ["--trust-store-arns", trustArn]), az = await nativeRead("ec2", "describe-availability-zones", ["--filters", "Name=region-name,Values=ca-central-1", "Name=state,Values=available"]);
  if (cert.data.Certificate?.CertificateArn !== certArn || cert.data.Certificate.Status !== "ISSUED" || !["sandbox.techlong.cloud", "*.sandbox.techlong.cloud"].every(n => cert.data.Certificate.SubjectAlternativeNames?.includes(n)) ||
    Date.parse(cert.data.Certificate.NotAfter) <= Date.now() + 86400000 || trust.data.TrustStores?.length !== 1 || trust.data.TrustStores[0].TrustStoreArn !== trustArn || trust.data.TrustStores[0].Status !== "ACTIVE" ||
    trust.data.TrustStores[0].NumberOfCaCertificates !== 1) throw Error("CELL_V3_FOUNDATION_METADATA_UNVERIFIED");
  const zones = ["ca-central-1a", "ca-central-1b"]; if (!zones.every(n => az.data.AvailabilityZones?.some(x => x.ZoneName === n && x.State === "available"))) throw Error("CELL_V3_AVAILABLE_ZONES_UNVERIFIED");
  const functionMeta = await nativeRead("lambda", "get-function-configuration", ["--function-name", CELL_LIFECYCLE_COORDINATOR_V3]);
  const iam = new IAMClient({ ...cfg, credentials: await session() }); const roles = [];
  try { for (const name of ["TechlongSandboxCellCloudFormationExecutionRole", "TechlongSandboxCellLifecycleCoordinatorRoleV3", "TechlongSandboxCellLifecycleSchedulerInvokeRoleV3"]) {
    try { const r = await iam.send(new GetRoleCommand({ RoleName: name }), { abortSignal: AbortSignal.timeout(15000) }); if (r.Role?.RoleName !== name || r.Role.Arn !== `arn:aws:iam::402010193138:role/${name}`) throw Error("CELL_V3_ROLE_IDENTITY_UNVERIFIED");
      roles.push({ name, state: "PRESENT", arn: r.Role.Arn, roleId: r.Role.RoleId, boundaryArn: r.Role.PermissionsBoundary?.PermissionsBoundaryArn ?? null }); }
    catch (e) { if (e.name !== "NoSuchEntity" && e.name !== "NoSuchEntityException") throw e; roles.push({ name, state: "ABSENT" }); }
  } } finally { iam.destroy(); }
  const nonce = randomBytes(16).toString("hex"), plan = await renderAwsSandboxSharedCellStackV3({ base: { environment, requestedAt: Date.now(), availabilityZones: zones, certificateArn: certArn, controlTrustStoreArn: trustArn },
    ownerDeploymentId: `cell_birth_review_${nonce}`, generation: 1, provisionEpoch: 1, launchNonce: nonce });
  const planFileSha256 = await save("cell-stack-v3-plan.json", plan), templateFileSha256 = await save("cell-stack-v3-template.json", plan.template);
  stage = "NONMUTATING_CLOUDFORMATION_TEMPLATE_VALIDATION";
  const cfn = new CloudFormationClient({ ...cfg, credentials: await session() }); let validation;
  try { if (Buffer.byteLength(plan.templateBody) > 51200) throw Error("CELL_V3_TEMPLATE_BODY_TOO_LARGE"); validation = await cfn.send(new ValidateTemplateCommand({ TemplateBody: plan.templateBody }), { abortSignal: AbortSignal.timeout(20000) }); }
  finally { cfn.destroy(); }
  if (validation.Capabilities?.length || !Array.isArray(validation.Parameters) || validation.Parameters.length !== Object.keys(plan.phaseParameters.RESERVED).length ||
    validation.Parameters.find(p => p.ParameterKey === "LifecyclePhase")?.DefaultValue !== "RESERVED") throw Error("CELL_V3_TEMPLATE_VALIDATION_RESULT_UNVERIFIED");
  stage = "SOURCE_ONLY_STACK_ABSENCE_INSPECTION";
  const scope = createCellV3EvidenceFromCredentials(await session(), "source_inspection"); let observed;
  try { observed = await scope.reader.read(plan, null, AbortSignal.timeout(30000)); } finally { scope.dispose(); }
  const snapshotFileSha256 = await save("read-only-snapshot.json", { sourceIdentityVerified: true, cert, trust, az, functionMeta: functionMeta.present ? { present: true, arn: functionMeta.data.FunctionArn,
    role: functionMeta.data.Role, codeSha256Base64: functionMeta.data.CodeSha256, revisionId: functionMeta.data.RevisionId } : { present: false }, roles, validation, stackInspection: observed });
  for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("CELL_V3_CODE_DRIFT_DURING_REVIEW");
  const r = { schemaVersion: 1, protocol: "cell-stack-v3-readonly-review", observedAt: new Date().toISOString(), outcome: "V3_TEMPLATE_VALIDATED_EXECUTION_BLOCKED_UNINSTALLED_COORDINATOR",
    codeSha256, codeBindingFileCount: pins.length, planFileSha256, templateFileSha256, snapshotFileSha256, planSha256: plan.planSha256, birthIntentSha256: plan.birthIntentSha256,
    templateCanonicalSha256: plan.templateCanonicalSha256, stackName: plan.stackName, proposalInputIsNotLiveNeonState: true, plannedBirthOwnerIsNotExistingCustomerDeployment: true,
    templateValidatedByAws: true, templateCapabilities: validation.Capabilities ?? [], phaseDefault: "RESERVED", reservedResourceCount: 0, armedResourceCount: 1,
    paidResourceCount: plan.resourceLogicalIds.length - 1, fullResourceCount: plan.resourceLogicalIds.length, foundationMetadataVerified: true,
    coordinatorFunctionPresent: functionMeta.present, roles, stackInspection: observed, coldDecodeAndScopedChildCompilersImplemented: true,
    liveApprovalRegistryAndCoordinatorInstalled: false, failedBirthAtomicFenceAndCensusImplemented: false, compensatedDeletionActuatorImplemented: false,
    noPhaseRegressionAllowedByApplication: true, externalCfnPhaseRegressionCouldDeleteResources: true, reportIsNotExecutableApprovalManifest: true,
    cloudResourceWrites: 0, iamWrites: 0, lambdaInvocations: 0, secretValuesRead: false, databaseConnected: false, permissionsInstallationAuthorized: false,
    reservationCreateAuthorized: false, armAuthorized: false, paidDeploymentAuthorized: false, runtimeEnabled: false,
    blockers: ["birth_approval_registry_and_coordinator_actual_composition", "failed_birth_activation_provision_exclusion_fence_and_certified_census",
      "once_only_compensation_journal_and_recovery", "dedicated_function_role_scheduler_and_async_delivery_installation", "separately_approved_reserved_armed_paid_session"] };
  const fileSha256 = await save("cell-stack-v3-review.json", r); console.log(JSON.stringify({ out, fileSha256, ...r }));
} catch (e) {
  const r = { outcome: "CELL_V3_READONLY_REVIEW_UNVERIFIED", stage, failureCode: /^CELL_V3_[A-Z_]+$/.test(e.message ?? "") ? e.message : "CELL_V3_REVIEW_FAILED",
    serviceErrorName: ["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "ExpiredToken"].includes(e.name) ? e.name : null, rawDiagnosticsWithheld: true,
    cloudResourceWrites: 0, reservationCreateAuthorized: false, paidDeploymentAuthorized: false, runtimeEnabled: false };
  await save("failure-diagnostic.json", r); console.error(JSON.stringify(r)); process.exitCode = 1;
}
