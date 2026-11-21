import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import type { CheckedBuildFiles, ReleaseBuildArtifact, ReleaseBuildRun } from "../../lib/deployments/releases/production.ts";
import type { ReleaseEnvironmentConfig } from "../../lib/deployments/releases/handoff.ts";
import type { RegistryBuildTarget, RegistryReadback } from "../../lib/deployments/releases/production.ts";

export const firstOpenSandboxPublication = Object.freeze({
  jobId: "job_fc41597f9b5ba8e02b338ecf",
  instanceId: "app_bbd626d7d3806af686073211",
  sourceCommit: "f1848d5fd74c2232d901b726218893155cd7aec8",
  candidateRunId: 44951254081,
  candidateArtifactId: 14724569595,
  scanArtifactId: 14724569582,
  registryRepository: "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast",
  imageConfigDigest: "sha256:66426353df19bb777c1d8faaea5976da37e92bb978fdc2151a0c02dfb7eee970",
  tag: "app-shaf1848d5fd74c2232d901b726218893155cd7aec8-r44951254081-a1",
} as const);
const p = firstOpenSandboxPublication;
export const firstOpenCandidateZipSha256 = "1d09a9a4a6ab337c898366c3360ebb1bcb9e7f1708793d5effcd5e384fedc3b5";
export const firstOpenArchiveSha256 = "16714425e16de9788ace27cb975ecd46f8f5c296e876b3d8f0f7bf91cf9f400c";
const scanZipSha256 = "097d75c7ef15b8ac1817cf39bc1dd23fa2a80123a3b1585ee53708786c9a635b";
const reportSha256 = "2b05a4c65de9d178db4ba35f5335f3a1609f52c886618f62c4134d25cf84ad18";
const scannerArchiveSha256 = "c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f";
const candidateExpiresAt = "2026-11-22T21:23:49Z", scanExpiresAt = "2026-11-28T21:23:44Z";
const verifiedAt = Date.parse("2026-11-21T21:26:50.824Z"), expiration = Date.parse(candidateExpiresAt);
const backend = "veinyyxy/SpeedFeast_Backend_main", backendId = 1064124445;
const operator = "veinyyxy/TechlongSoftware", operatorId = "1323312747", reviewerId = 14145707;
const workflow = ".github/workflows/sandbox-first-open-image-publish-v1.yml";
const hex = /^[a-f0-9]{64}$/, digest = /^sha256:[a-f0-9]{64}$/, runId = /^[1-9][0-9]{0,19}$/;
const must = (ok: unknown, code: string) => { if (!ok) throw new Error("FIRST_OPEN_PUBLICATION_" + code); };
const exception = { id: "CVE-2026-124709", package: "libssl3t64", version: "3.5.7-1~deb13u3",
  baseDigest: "sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2" };

export type FirstOpenBackendPublicationProof = typeof firstOpenSandboxPublication & {
  schema: "techlong/first-open-sandbox-app-publication/v1";
  reviewSha256: string;
  registryManifestDigest: string;
  publishedAt: number;
  publicationRunId: string;
};

export function assertFirstOpenBackendPublicationProof(proof: FirstOpenBackendPublicationProof) {
  must(proof?.schema === "techlong/first-open-sandbox-app-publication/v1" &&
    Object.entries(p).every(([key, value]) => proof[key as keyof typeof p] === value) &&
    hex.test(proof.reviewSha256) && digest.test(proof.registryManifestDigest) &&
    ![p.imageConfigDigest, "sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0"]
      .includes(proof.registryManifestDigest) &&
    runId.test(proof.publicationRunId) && proof.publicationRunId !== String(p.candidateRunId) &&
    Number.isSafeInteger(proof.publishedAt) && proof.publishedAt >= verifiedAt && proof.publishedAt < expiration,
    "PROOF_SCOPE");
}

export const firstOpenPublicationCodeFiles = [
  workflow, "scripts/sandbox-first-open-image-publish.ts", "ops/releases/first-open-sandbox-publication.ts",
  "ops/releases/first-open-sandbox-publication-runtime.ts", "ops/releases/promotion-runtime.ts", "ops/releases/build-artifact.ts",
  "ops/releases/extract-build-artifact.py", "ops/releases/import-source.ts", "ops/releases/aws-runtime.ts",
  "lib/deployments/releases/production.ts", "lib/deployments/execution/hash.ts", "package.json", "package-lock.json",
] as const;

export interface FirstOpenPublicationReview {
  schema: "techlong/first-open-sandbox-publication-review/v1";
  enabled: true;
  jobId: typeof p.jobId;
  instanceId: typeof p.instanceId;
  candidateZipSha256: string;
  scanZipSha256: string;
  observedAt: number;
  writeBefore: number;
  preflightSha256: string;
  environment: ReleaseEnvironmentConfig;
  codeArtifacts: { path: string; sha256: string }[];
}

export interface FirstOpenPublicationJob {
  repository: string; repositoryId: string; runId: string; runAttempt: number;
  sourceSha: string; ref: string; event: string; actor: string; actorId: string; workflowRef: string;
}

export async function validateFirstOpenPublicationReview(r: FirstOpenPublicationReview, approvedSha: string,
  code: FirstOpenPublicationReview["codeArtifacts"], now: number) {
  must(r?.schema === "techlong/first-open-sandbox-publication-review/v1" && r.enabled === true &&
    r.jobId === p.jobId && r.instanceId === p.instanceId && r.candidateZipSha256 === firstOpenCandidateZipSha256 &&
    r.scanZipSha256 === scanZipSha256 && hex.test(r.preflightSha256) && hex.test(approvedSha) && await sha256Hex(r) === approvedSha,
    "APPROVAL_REQUIRED");
  must(Number.isSafeInteger(r.observedAt) && Number.isSafeInteger(r.writeBefore) &&
    r.observedAt >= verifiedAt && r.observedAt <= now && now < r.writeBefore &&
    r.writeBefore <= Math.min(expiration, r.observedAt + 5 * 3600_000), "EXPIRED");
  must(canonicalJson(code.map(x => x.path)) === canonicalJson(firstOpenPublicationCodeFiles) &&
    code.every(x => hex.test(x.sha256)) && canonicalJson(code) === canonicalJson(r.codeArtifacts), "CODE_CHANGED");
  const e = r.environment, promotion = e?.promotion;
  must(e?.accountId === "402010193138" && e.region === "ca-central-1" && e.repositoryId === operatorId &&
    e.environmentName === "techlong-sandbox-deploy" && e.environmentId === 24613410405 && e.reviewerId === reviewerId &&
    e.deploySubject === "repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy" &&
    e.evidence?.owner === e.accountId && e.evidence.bucket === "techlong-sandbox-cloud-worker-evidence-402010193138" &&
    e.evidence.prefix === "instance-releases" && promotion?.roleArn === "arn:aws:iam::402010193138:role/TechlongSandboxInstanceReleasePublisherRole" &&
    promotion.sourceRepository === backend && promotion.sourceRepositoryId === backendId && promotion.imageRepository === p.registryRepository &&
    /^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong\/sandbox\/instance-release\/backend-build-read-token-v1-[A-Za-z0-9]{6}$/.test(promotion.artifactToken?.arn) &&
    /^[A-Za-z0-9-]{32,64}$/.test(promotion.artifactToken?.versionId), "AUTHORITY");
}

export function assertFirstOpenPublicationJob(j: FirstOpenPublicationJob) {
  must(j.repository === operator && j.repositoryId === operatorId && j.event === "workflow_dispatch" &&
    j.ref === "refs/heads/main" && j.runAttempt === 1 && /^[a-f0-9]{40}$/.test(j.sourceSha) && runId.test(j.runId) &&
    j.actorId === String(reviewerId) && j.actor === "veinyyxy" &&
    j.workflowRef === `${operator}/${workflow}@refs/heads/main`, "JOB_SCOPE");
}

export function checkFirstOpenPublicationSources(run: ReleaseBuildRun & { workflow_id?: number },
  artifact: ReleaseBuildArtifact, scan: ReleaseBuildArtifact, now: number) {
  must(run.id === p.candidateRunId && run.run_attempt === 1 && run.conclusion === "success" && run.status === "completed" &&
    run.event === "push" && run.head_branch === "main" && run.head_sha === p.sourceCommit &&
    run.workflow_id === 377674976 && run.path === ".github/workflows/backend-image-candidate.yml" &&
    run.repository?.id === backendId && run.repository?.full_name === backend && run.head_repository?.id === backendId,
    "RUN_MISMATCH");
  for (const [a, id, prefix, sha, bytes, expires] of [
    [artifact, p.candidateArtifactId, "sandbox-checked-app-", firstOpenCandidateZipSha256, 72671316, candidateExpiresAt],
    [scan, p.scanArtifactId, "os-scan-app-", scanZipSha256, 18211, scanExpiresAt],
  ] as const) {
    must(a.id === id && a.name === `${prefix}${p.sourceCommit}-${p.candidateRunId}-1` && a.expired === false &&
      a.size_in_bytes === bytes && a.digest === "sha256:" + sha && Date.parse(a.expires_at) === Date.parse(expires) &&
      now < Date.parse(expires) && a.workflow_run?.id === p.candidateRunId && a.workflow_run?.head_sha === p.sourceCommit &&
      a.workflow_run?.head_branch === "main" && a.workflow_run?.repository_id === backendId &&
      a.workflow_run?.head_repository_id === backendId, "ARTIFACT_MISMATCH");
  }
}

/** Raw scan bytes are separately fingerprinted; never reinterpret the accepted HIGH as a clean result. */
export async function verifyFirstOpenPublicationFiles(files: CheckedBuildFiles, scanFiles: { report: string; summary: string }, now: number) {
  const checksums = [
    [firstOpenArchiveSha256, "image.tar.gz"], [await sha256Hex(files.receipt), "candidate-receipt.json"],
    [await sha256Hex(files.selfCheck), "self-check.json"],
  ].map(([hash, name]) => `${hash}  ${name}`).sort();
  must(files.zipSha256 === firstOpenCandidateZipSha256 && files.zipSizeBytes === 72671316 &&
    files.archiveSha256 === firstOpenArchiveSha256 && files.archiveSizeBytes > 0 &&
    canonicalJson(files.checksums.trim().split(/\r?\n/).sort()) === canonicalJson(checksums), "ARCHIVE_MISMATCH");
  const check = JSON.parse(files.selfCheck), receipt = JSON.parse(files.receipt);
  must(canonicalJson(check) === canonicalJson({ schemaVersion: 1, outcome: "APP_CONTAINER_SMOKE_VERIFIED", nodeVersion: "v24.18.0",
    uid: 65532, platform: "linux/amd64", healthStatus: 200, readyStatus: 503, network: "none", cloudMutationPerformed: false }) &&
    canonicalJson(check) === canonicalJson(receipt.selfCheck) && receipt.schemaVersion === 1 &&
    receipt.status === "BUILT_SANDBOX_EXCEPTION_NOT_PUBLISHED" && receipt.kind === "app" && receipt.platform === "linux/amd64" &&
    receipt.sourceCommit === p.sourceCommit && receipt.runId === String(p.candidateRunId) && receipt.runAttempt === "1" &&
    receipt.imageConfigDigest === p.imageConfigDigest && receipt.registryManifestDigest === null &&
    ["ecrPublished", "ecsDeploymentPerformed", "awsMutationPerformed", "baselineApproved", "runtimeEnabled"]
      .every(k => receipt[k] === false), "CANDIDATE_RECEIPT");
  const summary = JSON.parse(scanFiles.summary);
  must(canonicalJson(summary) === canonicalJson(receipt.osSecurityScan) && summary.schemaVersion === 1 &&
    summary.outcome === "OS_SANDBOX_SINGLE_HIGH_ACCEPTED" && summary.scanner === "Trivy" && summary.scannerVersion === "0.75.0" &&
    summary.scope === "os" && summary.scannerArchiveSha256 === scannerArchiveSha256 && summary.reportSha256 === reportSha256 &&
    await sha256Hex(scanFiles.report) === reportSha256 && hex.test(summary.databaseSha256) && hex.test(summary.databaseMetadataSha256) &&
    canonicalJson(summary.sandboxException) === canonicalJson(exception) &&
    canonicalJson(summary.findingSeverityCounts) === canonicalJson({ HIGH: 1, CRITICAL: 0 }) &&
    summary.imageConfigDigest === p.imageConfigDigest &&
    ["ignoredFindingsAllowed", "ignoreUnfixedAllowed", "ecrScanPerformed", "cloudMutationPerformed"].every(k => summary[k] === false), "SCAN_SUMMARY");
  const report = JSON.parse(scanFiles.report), os = report.Metadata?.OS;
  const groups = Array.isArray(report.Results) ? report.Results.filter((x: { Class: string }) => x.Class === "os-pkgs") : [];
  const findings = groups[0]?.Vulnerabilities;
  must(report.ArtifactName === `speedfeast-app-candidate:${p.sourceCommit}` && report.ArtifactType === "container_image" &&
    report.Metadata?.ImageID === p.imageConfigDigest && canonicalJson(os) === canonicalJson(summary.os) &&
    os?.Family === "debian" && /^13(\.\d+)*$/.test(os.Name) && os.EOSL !== true &&
    groups.length === 1 && Array.isArray(groups[0].Packages) && groups[0].Packages.length === summary.packageCount && summary.packageCount >= 10 &&
    Array.isArray(findings) && findings.length === 1 && findings[0].Severity === "HIGH" &&
    findings[0].VulnerabilityID === exception.id && findings[0].PkgName === exception.package &&
    findings[0].InstalledVersion === exception.version && [undefined, null, ""].includes(findings[0].FixedVersion), "RAW_SCAN_SCOPE");
  const dbAt = Date.parse(summary.databaseUpdatedAt), validUntil = Math.min(expiration, dbAt + 48 * 3600_000);
  must(Number.isFinite(dbAt) && dbAt <= now + 300_000 && now < validUntil, "SCAN_AGE");
  return { imageRepository: p.registryRepository, imageConfigDigest: p.imageConfigDigest, validUntil } satisfies RegistryBuildTarget;
}

export async function firstOpenPublicationProof(readback: RegistryReadback, target: RegistryBuildTarget, reviewSha256: string,
  job: FirstOpenPublicationJob, now: number): Promise<FirstOpenBackendPublicationProof> {
  const { verifyRegistryBuild } = await import("../../lib/deployments/releases/production.ts");
  const verified = await verifyRegistryBuild(target, readback, now);
  // Docker loaded and pushed one linux/amd64 app; no mutable or multi-platform selector enters the task.
  must(target.imageRepository === p.registryRepository && target.imageConfigDigest === p.imageConfigDigest &&
    readback.platform === undefined && verified.manifestDigest === verified.platformDigest, "REGISTRY_PLATFORM");
  assertFirstOpenPublicationJob(job);
  const proof: FirstOpenBackendPublicationProof = { schema: "techlong/first-open-sandbox-app-publication/v1",
    ...p, reviewSha256, registryManifestDigest: verified.manifestDigest, publishedAt: now, publicationRunId: job.runId };
  assertFirstOpenBackendPublicationProof(proof);
  return Object.freeze(proof);
}
