import { randomUUID } from "node:crypto";
import { encodeReleaseHandoff, releaseRequestId, releasePlanSummary, decodeReleaseHandoff,
  type ReleaseJobContext, type ReleaseEnvironmentConfig } from "./handoff.ts";
import { sampleInstanceRelease, sampledObservation, type ReleaseMetadataApi } from "./sampling.ts";
import { assertReleaseArtifact, assertReleaseRuntime } from "./inspection.ts";
import { prepareInstanceRelease, executeInstanceRelease } from "./update.ts";
import type { PostgresReleaseRepository } from "./repository.ts";
import { preparePromotionIntent, encodePromotionHandoff, decodePromotionHandoff, promotionSummary, assertPromotionBaseline,
  promoteApprovedCandidate, derivePromotedPlan, type ReleasePromotionPorts } from "./promotion.ts";
import { sha256Hex } from "../execution/hash.ts";

/** Pure wiring over injected authenticated ports; never loads credentials, dispatches or approves. */
export async function prepareReleaseWorkflowJob(job: ReleaseJobContext, environment: ReleaseEnvironmentConfig, dependencies: {
  repository: Pick<PostgresReleaseRepository, "context" | "prepare" | "recordDecision"> & Partial<Pick<PostgresReleaseRepository, "candidate">>;
  api: ReleaseMetadataApi; now: () => number;
}) {
  const { repository, api, now } = dependencies;
  const context = await repository.context(job.instanceId), release = context?.releases.find(r => r.id === job.releaseId);
  if (!context || !release || context.binding.accountId !== environment.accountId || context.binding.region !== environment.region ||
    context.binding.environmentId !== environment.controlEnvironmentId) throw new Error("RELEASE_SELECTION_NOT_REGISTERED");
  if (release.status === "candidate") {
    if (!environment.promotion || !repository.candidate || context.activeRequestId) throw new Error("RELEASE_PROMOTION_NOT_ACTIVATED_OR_BUSY");
    const candidate = await repository.candidate(job.releaseId), current = context.releases.find(r => r.id === context.binding.currentRelease?.id);
    if (!candidate || !current || candidate.policy.repository !== environment.promotion.sourceRepository ||
      candidate.policy.repositoryId !== environment.promotion.sourceRepositoryId || candidate.policy.imageRepository !== environment.promotion.imageRepository) throw new Error("RELEASE_CANDIDATE_NOT_REGISTERED");
    const facts = await sampleInstanceRelease(context.binding, current, api, now);
    const intent = await preparePromotionIntent(job, candidate, context.binding, facts, now()), h = await encodePromotionHandoff(intent);
    return { outputs: { status: "PROMOTION_PLANNED", enabled: "true", handoff: h.encoded, handoff_sha: h.sha256 } as Record<string, string>, summary: promotionSummary(intent), ok: true };
  }
  const started = now(), facts = await sampleInstanceRelease(context.binding, release, api, now);
  const selection = { requestId: await releaseRequestId(job), requestedBy: job.actor, workspaceId: context.binding.workspaceId,
    instanceId: job.instanceId, environmentId: environment.controlEnvironmentId, releaseId: job.releaseId };
  const prepared = await prepareInstanceRelease({ selection, binding: context.binding, release,
    observation: await sampledObservation(context.binding, facts), now: now() }, {
    prepare: async (plan, sha) => {
      await assertReleaseArtifact(plan.to, facts); await assertReleaseRuntime(plan, facts, "from", started, now());
      return repository.prepare(plan, sha);
    }, recordDecision: repository.recordDecision.bind(repository),
  });
  if (prepared.result.status !== "PLANNED") return {
    outputs: { status: prepared.result.status, enabled: "true" } as Record<string, string>,
    summary: `## Instance API release: ${prepared.result.status}\n\nNo CloudFormation or ECR writes.\n`,
    ok: prepared.result.status === "NO_CHANGE",
  };
  const h = await encodeReleaseHandoff(job, prepared.result.plan);
  return { outputs: { status: "PLANNED", enabled: "true", handoff: h.encoded, handoff_sha: h.sha256 } as Record<string, string>,
    summary: releasePlanSummary(job, prepared.result.plan), ok: true };
}

export async function deployReleaseWorkflowJob(job: ReleaseJobContext, environment: ReleaseEnvironmentConfig,
  encoded: string, sha: string, dependencies: Parameters<typeof executeInstanceRelease>[1], promotion?: {
    ports: ReleasePromotionPorts; api: () => ReleaseMetadataApi;
    repository: Pick<PostgresReleaseRepository, "candidate" | "preparePromoted">;
  }) {
  if (encoded.length <= 16384 && JSON.parse(Buffer.from(encoded, "base64").toString("utf8")).schema === "techlong/instance-release-promotion-intent/v1") {
    if (!environment.promotion || !promotion) throw new Error("RELEASE_PROMOTION_NOT_ACTIVATED");
    const intent = await decodePromotionHandoff(encoded, sha, job, dependencies.now());
    const candidate = await promotion.repository.candidate(job.releaseId);
    if (!candidate) throw new Error("RELEASE_CANDIDATE_NOT_REGISTERED");
    const source = async () => {
      const context = await dependencies.repository.context(job.instanceId), current = context?.releases.find(r => r.id === context.binding.currentRelease?.id);
      if (!context || !current || context.activeRequestId) throw new Error("RELEASE_PROMOTION_CONTEXT_BUSY");
      const facts = await sampleInstanceRelease(context.binding, current, promotion.api(), dependencies.now);
      await assertPromotionBaseline(intent, candidate, context.binding, facts, dependencies.now());
      return { context, facts };
    };
    await source(); // Recheck the approved source before any ECR/catalog mutation; stopped is not restored.
    const release = await promoteApprovedCandidate(candidate, intent, promotion.ports, dependencies.now);
    const { context, facts } = await source(); // Source must still match after the non-atomic promotion.
    const plan = await derivePromotedPlan(intent, release, context.binding, facts, dependencies.now()), planSha = await sha256Hex(plan);
    await promotion.repository.preparePromoted(plan, planSha, intent);
    await promotion.ports.audit("derived", intent, { planSha256: planSha, plan });
    const h = await encodeReleaseHandoff(job, plan);
    return deployReleaseWorkflowJob(job, environment, h.encoded, h.sha256, dependencies);
  }
  const handoff = await decodeReleaseHandoff(encoded, sha, job, dependencies.now());
  const request = await dependencies.repository.request(handoff.requestId);
  if (!request?.plan || request.planSha256 !== handoff.planSha256 || request.plan.selection.instanceId !== job.instanceId ||
    request.plan.selection.releaseId !== job.releaseId || request.plan.selection.requestedBy !== job.actor ||
    request.plan.selection.environmentId !== environment.controlEnvironmentId || request.plan.writeBefore !== handoff.writeBefore) throw new Error("RELEASE_HANDOFF_REQUEST_CHANGED");
  return executeInstanceRelease({ requestId: handoff.requestId, approvedPlanSha256: handoff.planSha256,
    runId: job.runId, runAttempt: job.runAttempt, claimToken: randomUUID(), readBefore: dependencies.now() + 45 * 60_000,
    maxChangeSetReads: 40, maxStackReads: 60, pollIntervalMs: 10_000 }, dependencies);
}
