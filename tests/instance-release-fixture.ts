import type { ImageUpdatePlan } from "../lib/deployments/releases/contract.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

export const h = (letter: string) => letter.repeat(64);
export const repository = "111111111111.dkr.ecr.ca-central-1.amazonaws.com/example-api";
export async function releaseFixture(instance = "one", request = `request_${instance}`) {
  const stackId = `arn:aws:cloudformation:ca-central-1:111111111111:stack/tenant-${instance}/00000000-0000-4000-8000-000000000001`;
  const plan: ImageUpdatePlan = {
    schema: "techlong/instance-image-update-plan/v1",
    selection: { requestId: request, requestedBy: "operator", workspaceId: `wsp_${instance}`,
      instanceId: `app_${instance}`, environmentId: "sandbox", releaseId: "release_v2" },
    productId: "product_api", component: "tenant_api", accountId: "111111111111", region: "ca-central-1",
    expectedStateRevision: 3, observedAt: 1000, preparedAt: 2000, writeBefore: 18_001_000,
    templateSha256: h("c"), configurationSha256: h("d"), desiredCount: 1,
    compatibility: { databaseProfile: "express_iam", databaseSchemaVersion: "schema-v1",
      runtimePlatform: "linux/amd64", applicationPort: 3000, clientApiVersion: "v1", persistentUploadsReady: true },
    from: { releaseId: "release_v1", imageUri: `${repository}@sha256:${h("a")}`, platformDigest: `sha256:${h("a")}` },
    to: { releaseId: "release_v2", version: "2.0.0", imageUri: `${repository}@sha256:${h("b")}`,
      platformDigest: `sha256:${h("9")}`, sourceRepository: "example/backend", sourceCommit: "1".repeat(40),
      buildRunId: "100", buildAttempt: 1, artifactSha256: h("e"), imageVerificationSha256: h("f") },
    changeSet: { StackName: stackId, ChangeSetType: "UPDATE", UsePreviousTemplate: true,
      Parameters: [{ ParameterKey: "ClusterName", UsePreviousValue: true },
        { ParameterKey: "ImageUri", ParameterValue: `${repository}@sha256:${h("b")}` }] },
    expectedChanges: [{ logicalId: "TenantTaskDefinition", action: "Modify", replacement: "True" },
      { logicalId: "TenantService", action: "Modify", replacement: "False" }],
  };
  return { plan, sha: await sha256Hex(plan), token: "claim-synthetic-0001",
    changeSetId: "arn:aws:cloudformation:ca-central-1:111111111111:changeSet/release-test/00000000-0000-4000-8000-000000000002" };
}

/** Synthetic bytes/metadata for the normal backend app artifact contract, no GitHub/AWS reads. */
export async function releaseProductionFixture() {
  const now = Date.UTC(2026, 10, 14), commit = "1".repeat(40), config = `sha256:${h("9")}`;
  const policy = { productId: "product_api", version: "2.0.0", repository: "example/backend", repositoryId: 42,
    imageRepository: repository, nodeVersion: "v24.18.0", scannerVersion: "0.75.0", scannerArchiveSha256: h("1"),
    compatibility: { databaseProfiles: ["express_iam", "full_password"] as ("express_iam" | "full_password")[], schemaVersions: ["schema-v1"],
      clientApiVersions: ["v1"], applicationPort: 3000, requiresMigration: false, startupWrites: false } };
  const run = { id: 100, repository: { id: 42, full_name: policy.repository }, head_repository: { id: 42 },
    head_sha: commit, head_branch: "main", run_attempt: 1, path: ".github/workflows/backend-image-candidate.yml",
    event: "push", status: "completed", conclusion: "success" };
  const artifact = { id: 200, name: `checked-app-${commit}-100-1`, digest: `sha256:${await sha256Hex("synthetic-zip")}`,
    size_in_bytes: 13, expired: false, expires_at: new Date(now + 24 * 3600_000).toISOString(),
    workflow_run: { id: 100, repository_id: 42, head_repository_id: 42, head_branch: "main", head_sha: commit } };
  const check = { schemaVersion: 1, outcome: "APP_CONTAINER_SMOKE_VERIFIED", nodeVersion: "v24.18.0", uid: 65532,
    platform: "linux/amd64", healthStatus: 200, readyStatus: 503, network: "none", cloudMutationPerformed: false };
  const receipt = { schemaVersion: 1, status: "BUILT_SELF_CHECKED_NOT_PUBLISHED", kind: "app", sourceCommit: commit,
    runId: "100", runAttempt: "1", platform: "linux/amd64", imageConfigDigest: config, registryManifestDigest: null,
    selfCheck: check, osSecurityScan: { schemaVersion: 1, outcome: "OS_HIGH_CRITICAL_ZERO", scanner: "Trivy", scannerVersion: "0.75.0",
      scannerArchiveSha256: h("1"), scope: "os", imageConfigDigest: config, os: { Family: "debian", Name: "13.1" }, packageCount: 20,
      findingSeverityCounts: { HIGH: 0, CRITICAL: 0 }, databaseUpdatedAt: new Date(now - 3600_000).toISOString(),
      ignoredFindingsAllowed: false, ignoreUnfixedAllowed: false, ecrScanPerformed: false, cloudMutationPerformed: false,
      reportSha256: h("2"), databaseMetadataSha256: h("3"), databaseSha256: h("4") },
    ecrPublished: false, ecsDeploymentPerformed: false, awsMutationPerformed: false, baselineApproved: false, runtimeEnabled: false };
  const files = { zipSha256: artifact.digest.slice(7), zipSizeBytes: artifact.size_in_bytes,
    archiveSha256: await sha256Hex("synthetic-image"), archiveSizeBytes: 15, receipt: "", selfCheck: "", checksums: "" };
  const repack = async () => {
    files.receipt = JSON.stringify(receipt); files.selfCheck = JSON.stringify(check);
    files.checksums = `${files.archiveSha256}  image.tar.gz\n${await sha256Hex(files.receipt)}  candidate-receipt.json\n${await sha256Hex(files.selfCheck)}  self-check.json\n`;
  };
  await repack();
  const body = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json", config: { digest: config }, layers: [] });
  const image = { registryId: "111111111111", repositoryName: "example-api", imageId: { imageDigest: `sha256:${await sha256Hex(body)}` }, imageManifest: body };
  const registry = { observedAt: now, root: { images: [image], failures: [] as unknown[] } };
  return { now, policy, run, artifact, files, check, receipt, repack, registry, image };
}
