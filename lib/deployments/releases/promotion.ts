import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import { buildReleaseCandidate, verifyPublishedRelease, type ReleaseBuildCandidate, type ReleaseBuildPolicy,
  type ReleaseBuildRun, type ReleaseBuildArtifact, type CheckedBuildFiles, type RegistryReadback } from "./production.ts";
import { assertBoundReleaseRuntime, type ReleaseRuntimeFacts } from "./inspection.ts";
import { planInstanceRelease, RELEASE_SNAPSHOT_MAX_AGE_MS } from "./planning.ts";
import type { InstanceBinding, SoftwareRelease, ImageUpdatePlan } from "./contract.ts";
import { assertReleaseJob, releaseRequestId, type ReleaseJobContext } from "./handoff.ts";
import { ReleasePersistenceUnknown, type ReleaseSqlClient } from "./repository.ts";
import { sampledObservation } from "./sampling.ts";

/** Stored once by the separately reviewed importer, never arbitrary workflow JSON inputs. */
export interface StoredReleaseCandidate {
  schema: "techlong/stored-release-candidate/v1"; id: string; productId: string; component: "tenant_api"; version: string; status: "candidate";
  policy: ReleaseBuildPolicy; run: ReleaseBuildRun; artifact: ReleaseBuildArtifact; files: CheckedBuildFiles;
  build: ReleaseBuildCandidate; candidateSha256: string;
}
export async function sealReleaseCandidate(policy: ReleaseBuildPolicy, run: ReleaseBuildRun, artifact: ReleaseBuildArtifact, files: CheckedBuildFiles, now: number): Promise<StoredReleaseCandidate> {
  const build = await buildReleaseCandidate(policy, run, artifact, files, now);
  return { schema: "techlong/stored-release-candidate/v1", id: build.id, productId: build.productId, component: "tenant_api", version: build.version,
    status: "candidate", policy: { ...policy, compatibility: build.compatibility }, run, artifact, files, build, candidateSha256: await sha256Hex(build) };
}
export async function assertStoredCandidate(c: StoredReleaseCandidate, now: number) {
  const build = await buildReleaseCandidate(c.policy, c.run, c.artifact, c.files, now);
  if (c.schema !== "techlong/stored-release-candidate/v1" || c.status !== "candidate" || c.id !== build.id || c.productId !== build.productId ||
    c.component !== build.component || c.version !== build.version || canonicalJson(build) !== canonicalJson(c.build) ||
    await sha256Hex(build) !== c.candidateSha256) throw new Error("RELEASE_CANDIDATE_CHANGED");
  return build;
}
/** Separate reviewed administrator import, never a runtime direct-DML grant or automatic source scanner. */
export async function registerReleaseCandidate(sql: ReleaseSqlClient, c: StoredReleaseCandidate, now: number) {
  await assertStoredCandidate(c, now);
  let result;
  try { result = await sql.query(`insert into deployment_release.releases(id,product_id,component,version,status,document)
    values($1,$2,'tenant_api',$3,'candidate',$4::jsonb) on conflict do nothing returning document as result`, [c.id, c.productId, c.version, canonicalJson(c)]); }
  catch { throw new ReleasePersistenceUnknown(); }
  if (result.rows.length === 1 && canonicalJson(result.rows[0].result) === canonicalJson(c)) return "CANDIDATE_REGISTERED";
  throw new Error("RELEASE_CANDIDATE_CONFLICT_REQUIRES_INSPECTION");
}
export interface ReleasePromotionIntent {
  schema: "techlong/instance-release-promotion-intent/v1"; job: ReleaseJobContext; requestId: string;
  candidateId: string; candidateSha256: string; bindingSha256: string; sourceSha256: string;
  observedAt: number; writeBefore: number;
  target: { repository: string; tag: string; imageConfigDigest: string; artifactSha256: string; archiveSha256: string; version: string };
  limits: { images: 1; pushSubmissions: 1; createChangeSets: 1; executeChangeSets: 1; restore: false; migration: false };
}
export async function promotionSourceFingerprint(f: ReleaseRuntimeFacts) {
  return sha256Hex({ stackUpdatedAt: f.stackUpdatedAt, resources: f.resources, parameters: f.parameters, roleArn: f.roleArn,
    tags: f.tags, service: f.service.serviceArn, definition: f.service.taskDefinition, relatedBindings: f.relatedBindings });
}
async function eligible(job: ReleaseJobContext, c: StoredReleaseCandidate, b: InstanceBinding, facts: ReleaseRuntimeFacts, now: number) {
  const build = await assertStoredCandidate(c, now), current = b.currentRelease;
  if (!current || b.status !== "active" || !b.initialized || !Number.isSafeInteger(b.stateRevision) || b.stateRevision < 0 ||
    b.instanceId !== job.instanceId || c.id !== job.releaseId || c.productId !== b.productId ||
    build.imageRepository !== b.imageRepository || build.source.repository !== b.sourceRepository || b.runtimePlatform !== "linux/amd64" ||
    build.compatibility.applicationPort !== b.applicationPort || !build.compatibility.databaseProfiles.includes(facts.databaseProfile) ||
    !build.compatibility.schemaVersions.includes(facts.databaseSchemaVersion) || !build.compatibility.clientApiVersions.includes(b.clientApiVersion) ||
    facts.openChangeSetIds.length) throw new Error("RELEASE_PROMOTION_NOT_ELIGIBLE");
  const observation = await assertBoundReleaseRuntime({ selection: { requestId: await releaseRequestId(job), requestedBy: job.actor,
    workspaceId: b.workspaceId, instanceId: b.instanceId, environmentId: b.environmentId, releaseId: c.id },
    changeSet: { StackName: b.stackId, ChangeSetType: "UPDATE", UsePreviousTemplate: true, Parameters: [] },
    templateSha256: b.templateSha256, configurationSha256: b.configurationSha256, desiredCount: b.desiredCount,
    image: { imageUri: `${b.imageRepository}@${current.manifestDigest}`, platformDigest: current.platformDigest },
    compatibility: { databaseProfile: facts.databaseProfile, databaseSchemaVersion: facts.databaseSchemaVersion,
      runtimePlatform: b.runtimePlatform, applicationPort: b.applicationPort, clientApiVersion: b.clientApiVersion, persistentUploadsReady: true } },
  facts, facts.observedAt, now);
  if (now >= observation.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS) throw new Error("RELEASE_PROMOTION_EXPIRED");
  return { build, observation };
}
export async function preparePromotionIntent(job: ReleaseJobContext, c: StoredReleaseCandidate, b: InstanceBinding, facts: ReleaseRuntimeFacts, now: number): Promise<ReleasePromotionIntent> {
  assertReleaseJob(job, job.repository);
  const { build } = await eligible(job, c, b, facts, now);
  return { schema: "techlong/instance-release-promotion-intent/v1", job, requestId: await releaseRequestId(job), candidateId: c.id,
    candidateSha256: c.candidateSha256, bindingSha256: await sha256Hex(b), sourceSha256: await promotionSourceFingerprint(facts),
    observedAt: facts.observedAt, writeBefore: Math.min(facts.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS, build.validUntil),
    target: { repository: build.imageRepository, tag: `app-sha${build.source.commit}-r${build.source.buildRunId}-a1`,
      imageConfigDigest: build.imageConfigDigest, artifactSha256: build.source.artifactSha256, archiveSha256: build.artifact.archiveSha256, version: build.version },
    limits: { images: 1, pushSubmissions: 1, createChangeSets: 1, executeChangeSets: 1, restore: false, migration: false } };
}
export async function assertPromotionBaseline(intent: ReleasePromotionIntent, c: StoredReleaseCandidate, b: InstanceBinding, facts: ReleaseRuntimeFacts, now: number) {
  const rebuilt = await preparePromotionIntent(intent.job, c, b, facts, now);
  if (now >= intent.writeBefore || intent.requestId !== rebuilt.requestId || intent.candidateSha256 !== rebuilt.candidateSha256 ||
    intent.bindingSha256 !== rebuilt.bindingSha256 || intent.sourceSha256 !== rebuilt.sourceSha256 ||
    canonicalJson(intent.target) !== canonicalJson(rebuilt.target) || canonicalJson(intent.limits) !== canonicalJson(rebuilt.limits) ||
    intent.writeBefore > Math.min(intent.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS, c.build.validUntil)) throw new Error("RELEASE_PROMOTION_BASELINE_CHANGED_OR_EXPIRED");
}
export async function encodePromotionHandoff(intent: ReleasePromotionIntent) {
  return { encoded: Buffer.from(canonicalJson(intent)).toString("base64"), sha256: await sha256Hex(intent) };
}
export async function decodePromotionHandoff(encoded: string, sha: string, job: ReleaseJobContext, now: number) {
  if (encoded.length > 16384 || !/^[a-zA-Z0-9+/]+=*$/.test(encoded)) throw new Error("RELEASE_PROMOTION_HANDOFF_REJECTED");
  const intent = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ReleasePromotionIntent;
  if (intent.schema !== "techlong/instance-release-promotion-intent/v1" || await sha256Hex(intent) !== sha ||
    canonicalJson(intent.job) !== canonicalJson(job) || intent.requestId !== await releaseRequestId(job) || now >= intent.writeBefore) throw new Error("RELEASE_PROMOTION_HANDOFF_REJECTED");
  return intent;
}

export interface ReleasePromotionPorts {
  /** Authentic exact-run/ZIP download, validation and ECR push/readback. Never builds or runs application containers. */
  publish(c: StoredReleaseCandidate, intent: ReleasePromotionIntent): Promise<RegistryReadback>;
  audit(kind: "intent" | "push" | "published" | "derived", intent: ReleasePromotionIntent, payload: Record<string, unknown>): Promise<void>;
  confirm(candidateSha: string, release: SoftwareRelease): Promise<SoftwareRelease>;
}
export async function promoteApprovedCandidate(c: StoredReleaseCandidate, intent: ReleasePromotionIntent, ports: ReleasePromotionPorts, now: () => number) {
  await assertStoredCandidate(c, now());
  if (now() >= intent.writeBefore || c.candidateSha256 !== intent.candidateSha256 || c.id !== intent.candidateId) throw new Error("RELEASE_PROMOTION_EXPIRED_OR_CHANGED");
  // Conditional immutable audit is an execution slot: unknown ACK/occupied slot stops, never retries a push.
  await ports.audit("intent", intent, {});
  if (now() >= intent.writeBefore) throw new Error("RELEASE_PROMOTION_EXPIRED");
  const readback = await ports.publish(c, intent);
  const release = await verifyPublishedRelease(c.build, readback, now());
  await ports.audit("published", intent, { release });
  if (now() >= intent.writeBefore) throw new Error("RELEASE_PROMOTION_EXPIRED");
  const registered = await ports.confirm(c.candidateSha256, release);
  if (canonicalJson(registered) !== canonicalJson(release)) throw new Error("RELEASE_PROMOTED_CATALOG_MISMATCH");
  return release;
}
export async function derivePromotedPlan(intent: ReleasePromotionIntent, release: SoftwareRelease, binding: InstanceBinding, facts: ReleaseRuntimeFacts, now: number): Promise<ImageUpdatePlan> {
  if (now >= intent.writeBefore || await sha256Hex(binding) !== intent.bindingSha256 || await promotionSourceFingerprint(facts) !== intent.sourceSha256) throw new Error("RELEASE_PROMOTION_BASELINE_CHANGED_OR_EXPIRED");
  const result = await planInstanceRelease({ selection: { requestId: intent.requestId, requestedBy: intent.job.actor, workspaceId: binding.workspaceId,
    instanceId: binding.instanceId, environmentId: binding.environmentId, releaseId: release.id }, binding, release,
    observation: await sampledObservation(binding, facts), now });
  if (result.status !== "PLANNED" || result.plan.to.releaseId !== intent.candidateId ||
    result.plan.to.artifactSha256 !== intent.target.artifactSha256 || result.plan.to.imageUri.split("@")[0] !== intent.target.repository) throw new Error("RELEASE_PROMOTION_DERIVATION_REJECTED");
  return { ...result.plan, writeBefore: Math.min(result.plan.writeBefore, intent.writeBefore) };
}
export function promotionSummary(intent: ReleasePromotionIntent) {
  return "## Promote one checked app candidate, then update this instance — ONE environment approval\n\n```json\n" +
    JSON.stringify(intent, null, 2) + "\n```\n\nRegistry/platform digest is not known yet and is NOT pre-filled. Approval covers only the original checked archive and the strict verified derivation to ImageUri. " +
    "At most one docker push (multiple ECR layer/manifest API writes), one CFN Create/Execute. No build, lifecycle image, database migration, restore, IAM change, second approval or automatic retry/cleanup. " +
    "Partial ECR uploads/images, audit objects or catalog confirmation may remain if deployment fails; fees and possible service disruption remain.\n";
}
