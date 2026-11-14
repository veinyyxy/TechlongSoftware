import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import type { SoftwareRelease } from "./contract.ts";
import { RELEASE_SNAPSHOT_MAX_AGE_MS } from "./planning.ts";
import type { ReleaseMetadataApi } from "./sampling.ts";

/** Trusted product-catalog policy, not instance inputs or a backend self-assertion. */
export interface ReleaseBuildPolicy {
  productId: string; version: string; repository: string; repositoryId: number; imageRepository: string;
  nodeVersion: string; scannerVersion: string; scannerArchiveSha256: string;
  compatibility: SoftwareRelease["compatibility"];
}
export interface ReleaseBuildRun {
  id: number; head_sha: string; head_branch: string; run_attempt: number; path: string;
  event: string; status: string; conclusion: string | null;
  repository: { id: number; full_name: string }; head_repository: { id: number };
}
export interface ReleaseBuildArtifact {
  id: number; name: string; digest: string; size_in_bytes: number; expired: boolean; expires_at: string;
  workflow_run: { id: number; repository_id: number; head_repository_id: number; head_branch: string; head_sha: string };
}
/** Original ZIP and extracted file hashes come from the bounded file adapter, not a checkbox. */
export interface CheckedBuildFiles {
  zipSha256: string; zipSizeBytes: number; archiveSha256: string; archiveSizeBytes: number;
  receipt: string; selfCheck: string; checksums: string;
}
export interface ReleaseBuildCandidate {
  schema: "techlong/release-build-candidate/v1"; status: "candidate"; executionAuthorized: false;
  id: string; productId: string; component: "tenant_api"; version: string;
  source: SoftwareRelease["source"];
  imageRepository: string; imageConfigDigest: string;
  validUntil: number;
  artifact: { id: number; name: string; expiresAt: number; archiveSha256: string };
  checks: { receiptSha256: string; selfCheckSha256: string; securityReportSha256: string; scannerDatabaseSha256: string };
  compatibility: SoftwareRelease["compatibility"];
}
const hash = (s: string) => /^[a-f0-9]{64}$/.test(s);
const digest = (s: string) => /^sha256:[a-f0-9]{64}$/.test(s);
const must = (value: unknown, code: string) => { if (!value) throw new Error(code); };
function parse<T>(text: string): T {
  try { return JSON.parse(text) as T; } catch { throw new Error("RELEASE_BUILD_JSON_INVALID"); }
}
function compatibility(c: SoftwareRelease["compatibility"]): SoftwareRelease["compatibility"] {
  must(c.databaseProfiles.length && c.databaseProfiles.every(v => ["express_iam", "full_password"].includes(v)) &&
    c.schemaVersions.length && c.schemaVersions.every(v => typeof v === "string" && v.length > 0) &&
    c.clientApiVersions.length && c.clientApiVersions.every(v => typeof v === "string" && v.length > 0) &&
    Number.isSafeInteger(c.applicationPort) && c.applicationPort > 0 && c.applicationPort < 65536 &&
    c.requiresMigration === false && c.startupWrites === false, "RELEASE_BUILD_COMPATIBILITY_REQUIRED");
  return { databaseProfiles: [...c.databaseProfiles], schemaVersions: [...c.schemaVersions], clientApiVersions: [...c.clientApiVersions],
    applicationPort: c.applicationPort, requiresMigration: false, startupWrites: false };
}

/** Reuses backend-image-candidate.yml's existing app receipt/SHA256SUMS; never builds/pushes.
 * Run/artifact metadata must be obtained by an authenticated source reader. Hashes are not authentication. */
export async function buildReleaseCandidate(policy: ReleaseBuildPolicy, run: ReleaseBuildRun,
  artifact: ReleaseBuildArtifact, files: CheckedBuildFiles, now: number): Promise<ReleaseBuildCandidate> {
  must(policy.productId && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,99}$/.test(policy.version) &&
    /^\d{12}\.dkr\.ecr\.[a-z]{2}-[a-z]+-\d\.amazonaws\.com\/[a-z0-9][a-z0-9._/-]*$/.test(policy.imageRepository), "RELEASE_BUILD_PRODUCT_INVALID");
  const c = compatibility(policy.compatibility);
  must(Number.isSafeInteger(now) && run.repository.full_name === policy.repository && run.repository.id === policy.repositoryId &&
    run.head_repository.id === policy.repositoryId && Number.isSafeInteger(run.id) && run.id > 0 && run.run_attempt === 1 &&
    /^[a-f0-9]{40}$/.test(run.head_sha) && run.head_branch === "main" && run.path === ".github/workflows/backend-image-candidate.yml" &&
    ["push", "workflow_dispatch"].includes(run.event) && run.status === "completed" && run.conclusion === "success", "RELEASE_BUILD_RUN_REJECTED");
  const expiresAt = Date.parse(artifact.expires_at), a = artifact.workflow_run;
  must(Number.isSafeInteger(artifact.id) && artifact.id > 0 && !artifact.expired && expiresAt > now &&
    artifact.name === `checked-app-${run.head_sha}-${run.id}-1` && a.id === run.id && a.repository_id === policy.repositoryId &&
    a.head_repository_id === policy.repositoryId && a.head_sha === run.head_sha && a.head_branch === "main" &&
    digest(artifact.digest) && artifact.digest === `sha256:${files.zipSha256}` &&
    artifact.size_in_bytes === files.zipSizeBytes && files.zipSizeBytes > 0 && files.zipSizeBytes <= 500 * 1024 * 1024 &&
    files.archiveSizeBytes > 0 && files.archiveSizeBytes <= 471859200 && hash(files.archiveSha256), "RELEASE_BUILD_ARTIFACT_REJECTED");
  must([files.receipt, files.selfCheck, files.checksums].every(v => Buffer.byteLength(v) <= 65536), "RELEASE_BUILD_FILE_TOO_LARGE");
  const receiptSha = await sha256Hex(files.receipt), checkSha = await sha256Hex(files.selfCheck);
  const expected = { "image.tar.gz": files.archiveSha256, "candidate-receipt.json": receiptSha, "self-check.json": checkSha };
  const entries = files.checksums.trim().split(/\r?\n/).map(line => /^([a-f0-9]{64})  (image\.tar\.gz|candidate-receipt\.json|self-check\.json)$/.exec(line));
  must(entries.length === 3 && entries.every(Boolean) && new Set(entries.map(e => e![2])).size === 3 &&
    entries.every(e => e![1] === expected[e![2] as keyof typeof expected]), "RELEASE_BUILD_CHECKSUM_MISMATCH");
  interface SelfCheck { schemaVersion: number; outcome: string; nodeVersion: string; uid: number; platform: string;
    healthStatus: number; readyStatus: number; network: string; cloudMutationPerformed: boolean }
  interface Scan { schemaVersion: number; outcome: string; scanner: string; scannerVersion: string; scannerArchiveSha256: string;
    scope: string; imageConfigDigest: string; os: { Family: string; Name: string }; packageCount: number;
    findingSeverityCounts: { HIGH: number; CRITICAL: number }; databaseUpdatedAt: string;
    ignoredFindingsAllowed: boolean; ignoreUnfixedAllowed: boolean; ecrScanPerformed: boolean; cloudMutationPerformed: boolean;
    reportSha256: string; databaseMetadataSha256: string; databaseSha256: string }
  interface Receipt { schemaVersion: number; status: string; kind: string; sourceCommit: string; runId: string; runAttempt: string;
    platform: string; imageConfigDigest: string; registryManifestDigest: null; selfCheck: SelfCheck; osSecurityScan: Scan;
    ecrPublished: boolean; ecsDeploymentPerformed: boolean; awsMutationPerformed: boolean; baselineApproved: boolean; runtimeEnabled: boolean }
  const r = parse<Receipt>(files.receipt), check = parse<SelfCheck>(files.selfCheck);
  must(r.schemaVersion === 1 && r.status === "BUILT_SELF_CHECKED_NOT_PUBLISHED" && r.kind === "app" &&
    r.sourceCommit === run.head_sha && r.runId === String(run.id) && r.runAttempt === "1" && r.platform === "linux/amd64" &&
    digest(r.imageConfigDigest) && r.registryManifestDigest === null && r.ecrPublished === false && r.ecsDeploymentPerformed === false &&
    r.awsMutationPerformed === false && r.baselineApproved === false && r.runtimeEnabled === false &&
    canonicalJson(r.selfCheck) === canonicalJson(check), "RELEASE_BUILD_RECEIPT_REJECTED");
  must(check.schemaVersion === 1 && check.outcome === "APP_CONTAINER_SMOKE_VERIFIED" && check.nodeVersion === policy.nodeVersion &&
    check.uid === 65532 && check.platform === "linux/amd64" && check.healthStatus === 200 && check.readyStatus === 503 &&
    check.network === "none" && check.cloudMutationPerformed === false, "RELEASE_BUILD_SELF_CHECK_REJECTED");
  const scan = r.osSecurityScan, age = now - Date.parse(scan.databaseUpdatedAt);
  must(scan.schemaVersion === 1 && scan.outcome === "OS_HIGH_CRITICAL_ZERO" && scan.scanner === "Trivy" && scan.scope === "os" &&
    scan.scannerVersion === policy.scannerVersion && scan.scannerArchiveSha256 === policy.scannerArchiveSha256 && hash(scan.scannerArchiveSha256) &&
    scan.imageConfigDigest === r.imageConfigDigest && scan.os.Family === "debian" && /^(12|13)(\.\d+)*$/.test(scan.os.Name) &&
    Number.isSafeInteger(scan.packageCount) && scan.packageCount >= 10 && scan.findingSeverityCounts.HIGH === 0 && scan.findingSeverityCounts.CRITICAL === 0 &&
    scan.ignoredFindingsAllowed === false && scan.ignoreUnfixedAllowed === false && scan.ecrScanPerformed === false && scan.cloudMutationPerformed === false &&
    age >= -300000 && age <= 48 * 3600_000 && [scan.reportSha256, scan.databaseMetadataSha256, scan.databaseSha256].every(hash), "RELEASE_BUILD_SCAN_REJECTED");
  const id = "release_" + (await sha256Hex({ productId: policy.productId, component: "tenant_api", version: policy.version })).slice(0, 32);
  return { schema: "techlong/release-build-candidate/v1", status: "candidate", executionAuthorized: false,
    id, productId: policy.productId, component: "tenant_api", version: policy.version,
    source: { repository: policy.repository, commit: run.head_sha, buildRunId: String(run.id), buildAttempt: 1, artifactSha256: files.zipSha256 },
    imageRepository: policy.imageRepository, imageConfigDigest: r.imageConfigDigest,
    validUntil: Math.min(expiresAt, Date.parse(scan.databaseUpdatedAt) + 48 * 3600_000),
    artifact: { id: artifact.id, name: artifact.name, expiresAt, archiveSha256: files.archiveSha256 },
    checks: { receiptSha256: receiptSha, selfCheckSha256: checkSha, securityReportSha256: scan.reportSha256, scannerDatabaseSha256: scan.databaseSha256 },
    compatibility: c };
}

export interface RegistryImage {
  registryId: string; repositoryName: string; imageId: { imageDigest: string }; imageManifest: string;
}
export interface RegistryReadback {
  observedAt: number;
  root: { images?: RegistryImage[]; failures?: unknown[] };
  platform?: { images?: RegistryImage[]; failures?: unknown[] };
}

/** Accept only actual ECR BatchGetImage original bytes, not a publisher's success boolean.
 * Config digest, single-platform manifest digest and OCI-index digest stay distinct. */
export async function verifyPublishedRelease(candidate: ReleaseBuildCandidate, readback: RegistryReadback, now: number): Promise<SoftwareRelease> {
  must(candidate.status === "candidate" && candidate.executionAuthorized === false && digest(candidate.imageConfigDigest) &&
    Number.isSafeInteger(candidate.validUntil) && now < candidate.validUntil &&
    Number.isSafeInteger(now) && Number.isSafeInteger(readback.observedAt) && readback.observedAt <= now &&
    now < readback.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS, "RELEASE_REGISTRY_FACTS_REJECTED");
  const match = /^(\d{12})\.dkr\.ecr\.([a-z]{2}-[a-z]+-\d)\.amazonaws\.com\/(.+)$/.exec(candidate.imageRepository);
  must(match, "RELEASE_REGISTRY_REPOSITORY_REJECTED");
  const one = async (result: RegistryReadback["root"]) => {
    must(!result.failures?.length && result.images?.length === 1, "RELEASE_REGISTRY_IMAGE_MISSING");
    const image = result.images![0];
    must(image.registryId === match![1] && image.repositoryName === match![3] && digest(image.imageId.imageDigest) &&
      Buffer.byteLength(image.imageManifest) <= 1_048_576 && `sha256:${await sha256Hex(image.imageManifest)}` === image.imageId.imageDigest,
    "RELEASE_REGISTRY_BYTES_MISMATCH");
    return image;
  };
  const root = await one(readback.root), manifest = parse<{ schemaVersion: number; config?: { digest: string };
    manifests?: { digest: string; platform?: { os: string; architecture: string } }[] }>(root.imageManifest);
  must(manifest.schemaVersion === 2, "RELEASE_REGISTRY_MANIFEST_REJECTED");
  let platform = root;
  if (manifest.manifests) {
    const amd64 = manifest.manifests.filter(m => m.platform?.os === "linux" && m.platform.architecture === "amd64");
    must(amd64.length === 1 && digest(amd64[0].digest) && readback.platform, "RELEASE_REGISTRY_PLATFORM_REJECTED");
    platform = await one(readback.platform!);
    must(platform.imageId.imageDigest === amd64[0].digest, "RELEASE_REGISTRY_PLATFORM_REJECTED");
  } else must(!readback.platform, "RELEASE_REGISTRY_UNEXPECTED_PLATFORM");
  const platformManifest = parse<{ schemaVersion: number; config?: { digest: string }; manifests?: unknown }>(platform.imageManifest);
  must(platformManifest.schemaVersion === 2 && !platformManifest.manifests && platformManifest.config?.digest === candidate.imageConfigDigest,
    "RELEASE_REGISTRY_CONFIG_MISMATCH");
  const imageProof = { candidate, manifestDigest: root.imageId.imageDigest, platformDigest: platform.imageId.imageDigest };
  return { id: candidate.id, productId: candidate.productId, component: "tenant_api", version: candidate.version, status: "ecr_verified",
    source: { repository: candidate.source.repository, commit: candidate.source.commit, buildRunId: candidate.source.buildRunId,
      buildAttempt: candidate.source.buildAttempt, artifactSha256: candidate.source.artifactSha256 },
    image: { repository: candidate.imageRepository, manifestDigest: root.imageId.imageDigest, platformDigest: platform.imageId.imageDigest,
      verificationSha256: await sha256Hex(imageProof), runtimePlatform: "linux/amd64" }, compatibility: compatibility(candidate.compatibility) };
}

/** Read-only adapter over the existing fixed ecr:BatchGetImage metadata port. At most two reads.
 * The root digest is from separately trusted publication evidence, never a mutable tag. */
export async function readPublishedRelease(candidate: ReleaseBuildCandidate, manifestDigest: string,
  api: Pick<ReleaseMetadataApi, "read">, now: () => number): Promise<SoftwareRelease> {
  must(digest(manifestDigest) && now() < candidate.validUntil, "RELEASE_REGISTRY_REFERENCE_REJECTED");
  const target = /^(\d{12})\.dkr\.ecr\.([a-z]{2}-[a-z]+-\d)\.amazonaws\.com\/(.+)$/.exec(candidate.imageRepository);
  must(target, "RELEASE_REGISTRY_REPOSITORY_REJECTED");
  const read = (value: string) => api.read<RegistryReadback["root"]>("ecr", "batch-get-image", {
    registryId: target![1], repositoryName: target![3], imageIds: [{ imageDigest: value }],
  });
  const root = await read(manifestDigest);
  must(root.images?.length === 1 && !root.failures?.length && root.images[0].imageId.imageDigest === manifestDigest,
    "RELEASE_REGISTRY_REQUEST_MISMATCH");
  must(Buffer.byteLength(root.images![0].imageManifest) <= 1_048_576, "RELEASE_REGISTRY_BYTES_MISMATCH");
  const manifest = parse<{ manifests?: { digest: string; platform?: { os: string; architecture: string } }[] }>(root.images![0].imageManifest);
  const children = manifest.manifests?.filter(m => m.platform?.os === "linux" && m.platform.architecture === "amd64");
  if (children) must(children.length === 1 && digest(children[0].digest), "RELEASE_REGISTRY_PLATFORM_REJECTED");
  const platform = children ? await read(children[0].digest) : undefined;
  return verifyPublishedRelease(candidate, { observedAt: now(), root, platform }, now());
}
