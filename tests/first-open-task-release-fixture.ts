import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { deriveFirstOpenTaskRelease, type FirstOpenBackendPublicationProof } from "../lib/deployments/execution/first-onboarding-version.ts";
import type { SoftwareRelease } from "../lib/deployments/releases/contract.ts";
import verifiedA from "../docs/aws-instance-release-initial-publication-observed-20261117.json" with { type: "json" };

export async function firstOpenTaskReleaseFixture() {
  const originalA = structuredClone(verifiedA.publication.a) as SoftwareRelease;
  const proof: FirstOpenBackendPublicationProof = {
    schema: "techlong/first-open-sandbox-app-publication/v1",
    jobId: "job_fc41597f9b5ba8e02b338ecf", instanceId: "app_bbd626d7d3806af686073211",
    reviewSha256: "9".repeat(64), sourceCommit: "f1848d5fd74c2232d901b726218893155cd7aec8",
    candidateRunId: 44951254081, candidateArtifactId: 14724569595, scanArtifactId: 14724569582,
    registryRepository: originalA.image.repository, registryManifestDigest: "sha256:" + "e".repeat(64),
    imageConfigDigest: "sha256:66426353df19bb777c1d8faaea5976da37e92bb978fdc2151a0c02dfb7eee970",
    tag: "app-shaf1848d5fd74c2232d901b726218893155cd7aec8-r44951254081-a1",
    publishedAt: Date.parse("2026-11-21T21:30:00Z"), publicationRunId: "44959999999",
  };
  const trusted = { reviewSha256: proof.reviewSha256, proofSha256: await sha256Hex(proof) };
  return { originalA, proof, trusted, taskRelease: await deriveFirstOpenTaskRelease(originalA, proof, trusted) };
}
