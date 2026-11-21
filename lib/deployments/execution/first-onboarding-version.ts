import type { SoftwareRelease } from "../releases/contract.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { firstOpenBuyerBinding } from "./first-open-buyer-binding.ts";
import { sha256Hex } from "./hash.ts";

const jobId = FIRST_OPEN_BASELINE_BINDING.jobId;
const instanceId = firstOpenBuyerBinding.tenantId;
const productId = "prd_restaurant_order_system";
const backend = "veinyyxy/SpeedFeast_Backend_main";
const repository = "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast";
const sourceCommit = "f1848d5fd74c2232d901b726218893155cd7aec8";
const candidateRunId = 44951254081;
const artifactZipSha256 = "1d09a9a4a6ab337c898366c3360ebb1bcb9e7f1708793d5effcd5e384fedc3b5";
const imageConfigDigest = "sha256:66426353df19bb777c1d8faaea5976da37e92bb978fdc2151a0c02dfb7eee970";
const tag = `app-sha${sourceCommit}-r${candidateRunId}-a1`;
const approvedSchema = "speedfeast-saas-control-v1";
const approvedClient = "speedfeast-client-api-sha256:90191edd28decd490e95ea35461f9e26200874783a1ffc5f8598406bbc583144";
const hash = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const original = Object.freeze({
  releaseId: "release_00b9c5cfa6bceedc5fd05aa451dca811",
  imageRepository: repository,
  imageDigest: "sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0",
  status: "ecr_verified" as const,
});
export const FIRST_OPEN_TASK_RELEASE_ID = "release_c77f6f23434ce878a0254f1c8869ed6a";
const version = "fc41597f-sandbox-app-f1848d5f-r44951254081";

/** This is a readback, not a grant. The production catalog gates do not
 * recognize it, and the published digest cannot be chosen by the dispatcher. */
export interface FirstOpenBackendPublicationProof {
  schema: "techlong/first-open-sandbox-app-publication/v1";
  jobId: string;
  instanceId: string;
  reviewSha256: string;
  sourceCommit: string;
  candidateRunId: number;
  candidateArtifactId: number;
  scanArtifactId: number;
  registryRepository: string;
  registryManifestDigest: string;
  imageConfigDigest: string;
  tag: string;
  publishedAt: number;
  publicationRunId: string;
}

export interface FirstOpenTaskRelease extends SoftwareRelease {
  schema: "techlong/first-open-task-release/v1";
  status: "candidate"; // FK anchor for this instance; never a D2 promotion candidate.
  firstOpenScope: { jobId: string; instanceId: string; publication: FirstOpenBackendPublicationProof };
}

function assertPublication(p: FirstOpenBackendPublicationProof | undefined): asserts p is FirstOpenBackendPublicationProof {
  if (p?.schema !== "techlong/first-open-sandbox-app-publication/v1" || p.jobId !== jobId || p.instanceId !== instanceId ||
    !hash.test(p.reviewSha256) || p.sourceCommit !== sourceCommit || p.candidateRunId !== candidateRunId ||
    p.candidateArtifactId !== 14724569595 || p.scanArtifactId !== 14724569582 || p.registryRepository !== repository ||
    !digest.test(p.registryManifestDigest) || [original.imageDigest, imageConfigDigest].includes(p.registryManifestDigest) ||
    p.imageConfigDigest !== imageConfigDigest || p.tag !== tag ||
    !Number.isSafeInteger(p.publishedAt) || p.publishedAt < Date.parse("2026-11-21T21:26:50.824Z") ||
    p.publishedAt >= Date.parse("2026-11-22T21:23:49Z") ||
    !/^[1-9][0-9]{0,19}$/.test(p.publicationRunId) || p.publicationRunId === String(candidateRunId)) {
    throw Error("FIRST_OPEN_TASK_PUBLICATION_MISMATCH");
  }
}

const compatible = (c: SoftwareRelease["compatibility"] | undefined) =>
  c?.applicationPort === 3000 && c.requiresMigration === false && c.startupWrites === false &&
  Array.isArray(c.databaseProfiles) && c.databaseProfiles.includes("express_iam") &&
  Array.isArray(c.schemaVersions) && c.schemaVersions.includes(approvedSchema) &&
  Array.isArray(c.clientApiVersions) && c.clientApiVersions.includes(approvedClient);

export function assertFirstOpenTaskRelease(value: unknown): asserts value is FirstOpenTaskRelease {
  const r = value as FirstOpenTaskRelease | undefined;
  const p = r?.firstOpenScope?.publication;
  assertPublication(p);
  if (r?.schema !== "techlong/first-open-task-release/v1" || r.id !== FIRST_OPEN_TASK_RELEASE_ID || r.version !== version ||
    r.status !== "candidate" || r.component !== "tenant_api" || r.productId !== productId ||
    r.firstOpenScope.jobId !== jobId || r.firstOpenScope.instanceId !== instanceId ||
    r.source?.repository !== backend || r.source.commit !== sourceCommit || r.source.buildRunId !== String(candidateRunId) ||
    r.source.buildAttempt !== 1 || r.source.artifactSha256 !== artifactZipSha256 || r.image?.repository !== repository ||
    r.image.manifestDigest !== p.registryManifestDigest || r.image.platformDigest !== p.registryManifestDigest ||
    r.image.runtimePlatform !== "linux/amd64" || !hash.test(r.image.verificationSha256) || !compatible(r.compatibility)) {
    throw Error("FIRST_OPEN_TASK_RELEASE_MISMATCH");
  }
}

export async function verifyFirstOpenTaskRelease(r: FirstOpenTaskRelease) {
  assertFirstOpenTaskRelease(r);
  if (await sha256Hex(r.firstOpenScope.publication) !== r.image.verificationSha256) throw Error("FIRST_OPEN_TASK_PROOF_DIGEST");
}

/** Takes the original immutable A solely for its already-reviewed compatibility
 * contract. Neither A nor any other instance is written by this derivation. */
export async function deriveFirstOpenTaskRelease(originalA: SoftwareRelease, proof: FirstOpenBackendPublicationProof,
  verified: { reviewSha256: string; proofSha256: string }): Promise<FirstOpenTaskRelease> {
  const publication = structuredClone(proof), a = structuredClone(originalA);
  assertPublication(publication);
  const proofSha = await sha256Hex(publication);
  if (verified?.reviewSha256 !== publication.reviewSha256 || verified.proofSha256 !== proofSha) {
    throw Error("FIRST_OPEN_TASK_PUBLICATION_NOT_VERIFIED");
  }
  if (a.id !== original.releaseId || a.productId !== productId || a.component !== "tenant_api" || a.status !== "ecr_verified" ||
    a.source.repository !== backend || a.source.commit !== "b9ca2138738900afc23a6a2ddce141b37a1f0a31" ||
    a.image.repository !== repository || a.image.manifestDigest !== original.imageDigest || a.image.platformDigest !== original.imageDigest ||
    a.image.runtimePlatform !== "linux/amd64" || !compatible(a.compatibility) ||
    await sha256Hex(a) !== "b7aa3406a88a30cc9d38d88809dde6bfd8ee231784c5188ad11c43da62662702") {
    throw Error("FIRST_OPEN_TASK_ORIGINAL_A_MISMATCH");
  }
  const result: FirstOpenTaskRelease = { schema: "techlong/first-open-task-release/v1", id: FIRST_OPEN_TASK_RELEASE_ID,
    productId, component: "tenant_api", version, status: "candidate",
    source: { repository: backend, commit: sourceCommit, buildRunId: String(candidateRunId), buildAttempt: 1, artifactSha256: artifactZipSha256 },
    image: { repository, manifestDigest: publication.registryManifestDigest, platformDigest: publication.registryManifestDigest,
      verificationSha256: proofSha, runtimePlatform: "linux/amd64" },
    compatibility: a.compatibility, firstOpenScope: { jobId, instanceId, publication } };
  assertFirstOpenTaskRelease(result);
  return result;
}

export function firstOpenVersion(r?: FirstOpenTaskRelease) {
  if (r !== undefined) assertFirstOpenTaskRelease(r);
  const v = r ? { releaseId: r.id, imageRepository: r.image.repository, imageDigest: r.image.manifestDigest, status: r.status } : original;
  return { ...v, artifactRef: v.imageRepository + "@" + v.imageDigest };
}
