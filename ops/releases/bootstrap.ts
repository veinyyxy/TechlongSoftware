import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { verifyPublishedRelease, type RegistryReadback } from "../../lib/deployments/releases/production.ts";
import { assertStoredCandidate, type StoredReleaseCandidate } from "../../lib/deployments/releases/promotion.ts";
import type { ReleaseEnvironmentConfig } from "../../lib/deployments/releases/handoff.ts";
import type { SoftwareRelease } from "../../lib/deployments/releases/contract.ts";
import type { ReleaseIdentityJob } from "./aws-runtime.ts";
import type { AppPublicationCandidate, AppPublicationIntent } from "./promotion-runtime.ts";
import { writeCatalogRelease, writeCatalogCandidate, inspectCatalogRelease, inspectCatalogCandidate, type CatalogTarget } from "./catalog-transaction.ts";
import type { ReleaseSqlClient } from "../../lib/deployments/releases/repository.ts";

export const bootstrapCodeFiles = [
  ".github/workflows/instance-release-bootstrap.yml", "scripts/instance-release-bootstrap.ts", "ops/releases/bootstrap.ts",
  "ops/releases/promotion-runtime.ts", "ops/releases/aws-runtime.ts", "ops/releases/import-source.ts", "ops/releases/build-artifact.ts",
  "ops/releases/extract-build-artifact.py", "lib/deployments/releases/production.ts", "lib/deployments/releases/promotion.ts",
  "lib/deployments/releases/catalog.ts", "lib/deployments/execution/hash.ts", "ops/releases/catalog-transaction.ts",
  "scripts/instance-release-import.ts", "ops/releases/installation-connection.mjs",
];
export interface BootstrapReview {
  schema: "techlong/instance-release-bootstrap-review/v1"; enabled: true;
  repository: "veinyyxy/TechlongSoftware"; environment: ReleaseEnvironmentConfig;
  observedAt: number; writeBefore: number;
  codeArtifacts: { path: string; sha256: string }[];
  // No raw ZIP, receipt/self-check body or database/business snapshot in the repo review.
  a: Omit<StoredReleaseCandidate, "files">; b: Omit<StoredReleaseCandidate, "files">;
}
export interface BootstrapJob extends ReleaseIdentityJob { actorId: string }
const must = (v: unknown, code: string) => { if (!v) throw new Error(code); };
export function candidateSummary(c: StoredReleaseCandidate): Omit<StoredReleaseCandidate, "files"> {
  return { schema: c.schema, id: c.id, productId: c.productId, component: c.component, version: c.version,
    status: c.status, policy: c.policy, run: c.run, artifact: c.artifact, build: c.build, candidateSha256: c.candidateSha256 };
}
export async function validateBootstrapReview(r: BootstrapReview, sha: string, code: BootstrapReview["codeArtifacts"], now: number) {
  must(r.schema === "techlong/instance-release-bootstrap-review/v1" && r.enabled === true &&
    /^[a-f0-9]{64}$/.test(sha) && await sha256Hex(r) === sha, "RELEASE_BOOTSTRAP_APPROVAL_REQUIRED");
  must(Number.isSafeInteger(r.observedAt) && r.observedAt <= now && Number.isSafeInteger(r.writeBefore) &&
    now < r.writeBefore && r.writeBefore <= r.observedAt + 5 * 3600_000, "RELEASE_BOOTSTRAP_EXPIRED");
  must(canonicalJson(code.map(c => c.path)) === canonicalJson(bootstrapCodeFiles) &&
    code.every(c => /^[a-f0-9]{64}$/.test(c.sha256)) && canonicalJson(code) === canonicalJson(r.codeArtifacts), "RELEASE_BOOTSTRAP_CODE_CHANGED");
  const e = r.environment, p = e.promotion;
  must(r.repository === "veinyyxy/TechlongSoftware" && e.accountId === "402010193138" && e.region === "ca-central-1" &&
    e.repositoryId === "1323312747" && e.environmentName === "techlong-sandbox-deploy" &&
    Number.isSafeInteger(e.environmentId) && e.environmentId > 0 && Number.isSafeInteger(e.reviewerId) && e.reviewerId > 0 &&
    e.deploySubject === "repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy" &&
    e.evidence.owner === e.accountId && e.evidence.bucket === "techlong-sandbox-cloud-worker-evidence-402010193138" &&
    e.evidence.prefix === "instance-releases" && p?.roleArn === "arn:aws:iam::402010193138:role/TechlongSandboxInstanceReleasePublisherRole" &&
    p.sourceRepository === "veinyyxy/SpeedFeast_Backend_main" && p.sourceRepositoryId === 1064124445 &&
    p.imageRepository === "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast" &&
    /^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong\/sandbox\/instance-release\/backend-build-read-token-v1-[A-Za-z0-9]{6}$/.test(p.artifactToken.arn) &&
    /^[A-Za-z0-9-]{32,64}$/.test(p.artifactToken.versionId), "RELEASE_BOOTSTRAP_AUTHORITY_REJECTED");
  for (const c of [r.a, r.b]) {
    must(c.schema === "techlong/stored-release-candidate/v1" && c.status === "candidate" && c.component === "tenant_api" &&
      c.id === c.build.id && c.id === "release_" + (await sha256Hex({ productId: c.policy.productId, component: c.component, version: c.policy.version })).slice(0, 32) &&
      c.productId === c.policy.productId && c.version === c.policy.version && c.build.productId === c.productId && c.build.version === c.version &&
      c.candidateSha256 === await sha256Hex(c.build) && c.build.executionAuthorized === false && c.build.status === "candidate" &&
      c.policy.repository === p!.sourceRepository && c.policy.repositoryId === p!.sourceRepositoryId &&
      c.build.imageRepository === p!.imageRepository && c.policy.imageRepository === p!.imageRepository &&
      c.run.id === Number(c.build.source.buildRunId) && c.run.head_sha === c.build.source.commit &&
      c.artifact.id === c.build.artifact.id && canonicalJson(c.policy.compatibility) === canonicalJson(c.build.compatibility) &&
      r.writeBefore <= c.build.validUntil, "RELEASE_BOOTSTRAP_CANDIDATE_CHANGED");
  }
  must(r.a.productId === r.b.productId && r.a.id !== r.b.id && r.a.run.id !== r.b.run.id &&
    r.a.build.imageConfigDigest !== r.b.build.imageConfigDigest, "RELEASE_BOOTSTRAP_DISTINCT_PAIR_REQUIRED");
}
export function assertBootstrapJob(job: BootstrapJob, r: BootstrapReview) {
  must(job.repository === r.repository && job.repositoryId === r.environment.repositoryId && job.event === "workflow_dispatch" &&
    job.ref === "refs/heads/main" && job.runAttempt === 1 && /^[a-f0-9]{40}$/.test(job.sourceSha) && /^\d+$/.test(job.runId) &&
    job.actorId === String(r.environment.reviewerId) && !!job.actor &&
    job.workflowRef === `${r.repository}/.github/workflows/instance-release-bootstrap.yml@refs/heads/main`, "RELEASE_BOOTSTRAP_JOB_REJECTED");
}
export interface BootstrapPublication {
  schema: "techlong/initial-app-publication/v1"; status: "A_PUBLISHED_CATALOG_NOT_WRITTEN";
  reviewSha256: string; job: BootstrapJob; requestId: string; candidateASha256: string; candidateBSha256: string;
  publishedAt: number; readback: RegistryReadback; release: SoftwareRelease;
}
export async function publishInitialA(r: BootstrapReview, sha: string, job: BootstrapJob,
  ports: { audit(kind: "intent" | "push" | "published", intent: AppPublicationIntent, body: Record<string, unknown>): Promise<void>;
    publish(c: AppPublicationCandidate, intent: AppPublicationIntent): Promise<RegistryReadback> }, now: () => number) {
  must(await sha256Hex(r) === sha, "RELEASE_BOOTSTRAP_APPROVAL_REQUIRED"); assertBootstrapJob(job, r);
  const guard = () => must(now() < r.writeBefore, "RELEASE_BOOTSTRAP_EXPIRED"); guard();
  const c = r.a.build, requestId = "release_" + (await sha256Hex({ reviewSha256: sha, job })).slice(0, 32);
  const intent = { schema: "techlong/initial-app-publication-intent/v1", requestId, candidateSha256: r.a.candidateSha256,
    writeBefore: r.writeBefore, reviewSha256: sha, job, target: { repository: c.imageRepository,
      tag: `app-sha${c.source.commit}-r${c.source.buildRunId}-a1`, imageConfigDigest: c.imageConfigDigest,
      artifactSha256: c.source.artifactSha256, archiveSha256: c.artifact.archiveSha256, version: c.version } };
  await ports.audit("intent", intent, {}); guard();
  const readback = await ports.publish(r.a, intent); guard();
  const release = await verifyPublishedRelease(c, readback, now());
  const result: BootstrapPublication = { schema: "techlong/initial-app-publication/v1", status: "A_PUBLISHED_CATALOG_NOT_WRITTEN",
    reviewSha256: sha, job, requestId, candidateASha256: r.a.candidateSha256, candidateBSha256: r.b.candidateSha256,
    publishedAt: now(), readback, release };
  guard(); await ports.audit("published", intent, { result }); return result;
}

export async function prepareBootstrapCatalog(r: BootstrapReview, sha: string, publication: BootstrapPublication,
  b: StoredReleaseCandidate, now: number) {
  must(await sha256Hex(r) === sha && now < r.writeBefore, "RELEASE_BOOTSTRAP_EXPIRED_OR_CHANGED");
  assertBootstrapJob(publication.job, r);
  must(publication.schema === "techlong/initial-app-publication/v1" && publication.status === "A_PUBLISHED_CATALOG_NOT_WRITTEN" &&
    publication.reviewSha256 === sha && publication.candidateASha256 === r.a.candidateSha256 &&
    publication.candidateBSha256 === r.b.candidateSha256 && publication.publishedAt <= now &&
    publication.publishedAt < r.writeBefore && publication.requestId === "release_" + (await sha256Hex({ reviewSha256: sha, job: publication.job })).slice(0, 32), "RELEASE_BOOTSTRAP_PUBLICATION_CHANGED");
  const a = await verifyPublishedRelease(r.a.build, publication.readback, now);
  await assertStoredCandidate(b, now);
  must(canonicalJson(a) === canonicalJson(publication.release) && canonicalJson(candidateSummary(b)) === canonicalJson(r.b), "RELEASE_BOOTSTRAP_CATALOG_SOURCE_CHANGED");
  return { a, b, target: { configPath: ".env.local", configKey: "DATABASE_URL", database: "neondb", installer: "neondb_owner", schemaOid: 237571, releasesOid: 237572 },
    limits: { configReads: 1, connections: 2, sqlSubmissions: 64, catalogInsertSubmissions: 2, catalogRows: 2, maxExecutionMs: 600000 }, writeBefore: r.writeBefore };
}

export interface BootstrapCatalogInput { review: BootstrapReview; reviewSha256: string; publication: BootstrapPublication; b: StoredReleaseCandidate }
export async function prepareBootstrapRegistration(input: BootstrapCatalogInput, sourceInput: { path: string; rawSha256: string }, now: number) {
  const plan = await prepareBootstrapCatalog(input.review, input.reviewSha256, input.publication, input.b, now);
  return { schema: "techlong/bootstrap-catalog-review/v1" as const, status: "AWAITING_APPROVAL" as const,
    id: input.publication.requestId, sourceInput, ...plan, codeArtifacts: input.review.codeArtifacts };
}

/** Two immutable rows, not a distributed transaction. Never insert B after an A error.
 * The sole fresh inspection connection may inspect attempted rows after an unknown ACK. */
export async function registerBootstrapCatalog(a: SoftwareRelease, b: StoredReleaseCandidate, target: CatalogTarget,
  connect: (label: string) => Promise<{ sql: ReleaseSqlClient; close(): Promise<void> }>, now: () => number,
  save: (name: string, value: unknown) => Promise<void> = async () => {}) {
  const writes: unknown[] = [], inspections: unknown[] = []; let attempted = 0, code: string | null = null;
  const safe = (e: unknown) => e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "RELEASE_BOOTSTRAP_CATALOG_UNKNOWN";
  const writer = await connect("writer");
  try {
    attempted = 1; writes.push(await writeCatalogRelease(writer.sql, a, target)); await save("write-a.json", writes[0]);
    attempted = 2; writes.push(await writeCatalogCandidate(writer.sql, b, target, now)); await save("write-b.json", writes[1]);
  } catch (e) { code = safe(e); } finally { await writer.close(); }
  const inspector = await connect("inspection");
  try {
    inspections.push(await inspectCatalogRelease(inspector.sql, a, target)); await save("inspection-a.json", inspections[0]);
    if (attempted === 2) { inspections.push(await inspectCatalogCandidate(inspector.sql, b, target)); await save("inspection-b.json", inspections[1]); }
  } catch (e) { code ??= safe(e); } finally { await inspector.close(); }
  return { status: !code && writes.length === 2 && inspections.length === 2 ? "A_AND_B_CATALOG_INDEPENDENTLY_VERIFIED" : "STOPPED_REQUIRES_INSPECTION",
    code, attempted, writes, inspections, automaticRetry: false, runtimeEnabled: false };
}
