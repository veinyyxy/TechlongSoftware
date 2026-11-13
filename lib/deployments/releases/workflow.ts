import { randomUUID } from "node:crypto";
import { encodeReleaseHandoff, releaseRequestId, releasePlanSummary, decodeReleaseHandoff,
  type ReleaseJobContext, type ReleaseEnvironmentConfig } from "./handoff.ts";
import { sampleInstanceRelease, sampledObservation, type ReleaseMetadataApi } from "./sampling.ts";
import { assertReleaseArtifact, assertReleaseRuntime } from "./inspection.ts";
import { prepareInstanceRelease, executeInstanceRelease } from "./update.ts";
import type { PostgresReleaseRepository } from "./repository.ts";

/** Pure wiring over injected authenticated ports; never loads credentials, dispatches or approves. */
export async function prepareReleaseWorkflowJob(job: ReleaseJobContext, environment: ReleaseEnvironmentConfig, dependencies: {
  repository: Pick<PostgresReleaseRepository, "context" | "prepare" | "recordDecision">;
  api: ReleaseMetadataApi; now: () => number;
}) {
  const { repository, api, now } = dependencies;
  const context = await repository.context(job.instanceId), release = context?.releases.find(r => r.id === job.releaseId);
  if (!context || !release || context.binding.accountId !== environment.accountId || context.binding.region !== environment.region ||
    context.binding.environmentId !== environment.controlEnvironmentId) throw new Error("RELEASE_SELECTION_NOT_REGISTERED");
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
  encoded: string, sha: string, dependencies: Parameters<typeof executeInstanceRelease>[1]) {
  const handoff = await decodeReleaseHandoff(encoded, sha, job, dependencies.now());
  const request = await dependencies.repository.request(handoff.requestId);
  if (!request?.plan || request.planSha256 !== handoff.planSha256 || request.plan.selection.instanceId !== job.instanceId ||
    request.plan.selection.releaseId !== job.releaseId || request.plan.selection.requestedBy !== job.actor ||
    request.plan.selection.environmentId !== environment.controlEnvironmentId || request.plan.writeBefore !== handoff.writeBefore) throw new Error("RELEASE_HANDOFF_REQUEST_CHANGED");
  return executeInstanceRelease({ requestId: handoff.requestId, approvedPlanSha256: handoff.planSha256,
    runId: job.runId, runAttempt: job.runAttempt, claimToken: randomUUID(), readBefore: dependencies.now() + 45 * 60_000,
    maxChangeSetReads: 40, maxStackReads: 60, pollIntervalMs: 10_000 }, dependencies);
}
