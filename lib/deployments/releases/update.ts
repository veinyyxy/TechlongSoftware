import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import { planInstanceRelease } from "./planning.ts";
import type { ImageUpdatePlan, ReleasePlanningInput, ReleaseRequestStatus } from "./contract.ts";
import { createReleaseChangeSetInput, executeReleaseChangeSetInput, reviewImageChangeSet,
  type ReleaseCloudFormationAdapter } from "./adapters.ts";
import { assertReleaseArtifact, assertReleaseRuntime, type IndependentReleaseInspector, type ReleaseRuntimeReader,
  type ReleaseRuntimeFacts } from "./inspection.ts";
import { ReleasePersistenceUnknown, ReleaseRequestRejected, type PostgresReleaseRepository, type ReleaseStopStatus } from "./repository.ts";

/** D2-4's protected job must supply the actual approval binding; this type alone grants nothing. */
export interface ApprovedReleaseRun {
  requestId: string;
  approvedPlanSha256: string;
  runId: string;
  runAttempt: number;
  claimToken: string;
  readBefore: number;
  maxChangeSetReads: number;
  maxStackReads: number;
  pollIntervalMs: number;
}
export interface ReleaseRunResult { requestId: string; status: ReleaseRequestStatus; code: string }

export async function prepareInstanceRelease(input: ReleasePlanningInput,
  repository: Pick<PostgresReleaseRepository, "prepare" | "recordDecision">) {
  const result = await planInstanceRelease(input);
  const request = result.status === "PLANNED" ? await repository.prepare(result.plan, result.planSha256) :
    await repository.recordDecision({ schema: "techlong/instance-release-decision/v1", selection: input.selection,
      status: result.status, reason: result.status === "NO_CHANGE" ? "ALREADY_VERIFIED_IMAGE" : result.reason,
      expectedStateRevision: input.binding.stateRevision, currentReleaseId: input.binding.currentRelease?.id ?? "" });
  return { result, request };
}

async function materialHash(plan: ImageUpdatePlan) {
  return sha256Hex({ ...plan, observedAt: 0, preparedAt: 0, writeBefore: 0 });
}
async function sourceFingerprint(f: ReleaseRuntimeFacts) {
  return sha256Hex({ updatedAt: f.stackUpdatedAt, resources: f.resources, parameters: f.parameters,
    roleArn: f.roleArn, tags: f.tags, taskDefinition: f.service.taskDefinition });
}

/** No process/env/client construction. Only the injected, bounded ports can have side effects.
 * A later re-invocation never resumes a started request or replays an operation. */
export async function executeInstanceRelease(input: ApprovedReleaseRun, dependencies: {
  repository: Pick<PostgresReleaseRepository, "request" | "context" | "claim" | "operation" | "stop" | "complete">;
  cloud: Pick<ReleaseCloudFormationAdapter, "create" | "changes" | "template" | "execute" | "stackState">;
  reader: ReleaseRuntimeReader;
  inspector: IndependentReleaseInspector;
  now: () => number;
  pause: (milliseconds: number) => Promise<void>;
}): Promise<ReleaseRunResult> {
  const { repository, cloud, reader, inspector, now, pause } = dependencies;
  const outcome = (status: ReleaseRequestStatus, code: string): ReleaseRunResult => ({ requestId: input.requestId, status, code });
  const claim = { requestId: input.requestId, token: input.claimToken };
  const stop = async (status: ReleaseStopStatus, code: string) => {
    await repository.stop(claim, status, code); return outcome(status, code);
  };
  let claimed = false;
  try {
    if (!Number.isSafeInteger(input.maxChangeSetReads) || input.maxChangeSetReads < 1 ||
      !Number.isSafeInteger(input.maxStackReads) || input.maxStackReads < 1 ||
      !Number.isSafeInteger(input.pollIntervalMs) || input.pollIntervalMs < 0 || !Number.isSafeInteger(input.readBefore) ||
      input.readBefore <= now() || !/^[0-9]+$/.test(input.runId) || input.runAttempt < 1 || !Number.isSafeInteger(input.runAttempt)) {
      return outcome("BLOCKED", "INVALID_EXECUTION_BUDGET");
    }
    const request = await repository.request(input.requestId), plan = request?.plan;
    if (request?.decision && !plan && request.planSha256 === input.approvedPlanSha256) return outcome(request.status, "NON_EXECUTABLE_DECISION");
    if (!request || !plan || request.planSha256 !== input.approvedPlanSha256 || await sha256Hex(plan) !== request.planSha256 ||
      plan.selection.requestId !== input.requestId) return outcome("BLOCKED", "APPROVED_REQUEST_MISMATCH");
    if (request.status !== "AWAITING_APPROVAL" || Object.keys(request.operations).length) {
      return outcome(["AWAITING_APPROVAL", "CLAIMED", "CHANGE_SET_CREATED", "EXECUTING", "VERIFYING"].includes(request.status) ?
        "RECONCILIATION_REQUIRED" : request.status, "REQUEST_ALREADY_STARTED");
    }
    if (now() >= plan.writeBefore) return await stop("EXPIRED", "ORIGINAL_WRITE_WINDOW_EXPIRED");
    await repository.claim(plan, request.planSha256, input.runId, input.runAttempt, input.claimToken); claimed = true;
    const preflight = async (allowedChangeSetId?: string) => {
      if (now() >= input.readBefore) throw new Error("RELEASE_READ_BUDGET_EXPIRED");
      const context = await repository.context(plan.selection.instanceId);
      const release = context?.releases.find(r => r.id === plan.to.releaseId);
      if (!context || !release || context.activeRequestId !== input.requestId) throw new Error("RELEASE_CONTEXT_CHANGED");
      if (now() >= input.readBefore) throw new Error("RELEASE_READ_BUDGET_EXPIRED");
      const startedAt = now(), facts = await reader.capture(plan);
      if (now() >= input.readBefore) throw new Error("RELEASE_READ_BUDGET_EXPIRED");
      if (facts.openChangeSetIds.some(id => id !== allowedChangeSetId)) throw new Error("RELEASE_OTHER_CHANGE_SET_EXISTS");
      await assertReleaseArtifact(plan, facts);
      const observation = await assertReleaseRuntime(plan, facts, "from", startedAt, now());
      const live = await planInstanceRelease({ selection: plan.selection, binding: context.binding, release, observation, now: now() });
      if (live.status !== "PLANNED" || await materialHash(live.plan) !== await materialHash(plan)) throw new Error("RELEASE_CONTEXT_CHANGED");
      return facts;
    };
    let before: ReleaseRuntimeFacts;
    try { before = await preflight(); }
    catch (error) {
      return await stop(error instanceof Error && error.message === "RELEASE_RESTORE_REQUIRED" ? "BLOCKED_RESTORE_REQUIRED" : "BLOCKED", "LIVE_PREFLIGHT_REJECTED");
    }
    if (now() >= plan.writeBefore || now() >= input.readBefore) return await stop("EXPIRED", "ORIGINAL_WRITE_WINDOW_EXPIRED");
    const suffix = `${input.approvedPlanSha256.slice(0, 32)}-${input.runId}-${input.runAttempt}`;
    const name = `release-${suffix}`, createToken = `create-${suffix}`, executeToken = `execute-${suffix}`;
    const createSha = await sha256Hex(createReleaseChangeSetInput(plan, name, createToken));
    await repository.operation(claim, "create", "INTENT", createSha);
    let changeSetId: string;
    try {
      if (now() >= plan.writeBefore || now() >= input.readBefore) throw new Error("RELEASE_EXPIRED_AFTER_INTENT");
      changeSetId = await cloud.create(plan, input.approvedPlanSha256, name, createToken);
    } catch {
      await repository.operation(claim, "create", "UNKNOWN", createSha);
      return outcome("RECONCILIATION_REQUIRED", "CREATE_SUBMISSION_UNKNOWN");
    }
    await repository.operation(claim, "create", "ACK", createSha, changeSetId);
    let reviewed: ReturnType<typeof reviewImageChangeSet> | undefined;
    for (let i = 0; i < input.maxChangeSetReads && now() < input.readBefore; i++) {
      const cs = await cloud.changes(plan, changeSetId);
      if (cs.Status === "CREATE_PENDING" || cs.Status === "CREATE_IN_PROGRESS") {
        if (i + 1 < input.maxChangeSetReads) await pause(input.pollIntervalMs);
        continue;
      }
      if (now() >= input.readBefore) return await stop("FAILED_NEEDS_INSPECTION", "CHANGE_SET_READ_BUDGET_EXHAUSTED");
      try {
        reviewed = reviewImageChangeSet(plan, input.approvedPlanSha256, changeSetId, cs);
        const parameters = cs.Parameters ?? [];
        if (parameters.length !== plan.changeSet.Parameters.length || new Set(parameters.map(p => p.ParameterKey)).size !== parameters.length ||
          parameters.some(p => !p.ParameterKey || !(p.ParameterKey in before.parameters) || p.ResolvedValue !== undefined ||
            (p.ParameterKey === "ImageUri" ? p.ParameterValue !== plan.to.imageUri || p.UsePreviousValue === true :
              p.ParameterValue === undefined ? p.UsePreviousValue !== true : p.ParameterValue !== before.parameters[p.ParameterKey]))) {
          throw new Error("RELEASE_CHANGE_SET_PARAMETERS_CHANGED");
        }
        if (await sha256Hex(await cloud.template(plan, changeSetId)) !== plan.templateSha256) throw new Error("RELEASE_CANDIDATE_TEMPLATE_CHANGED");
      } catch (error) {
        if (error instanceof Error && ["RELEASE_CHANGE_SET_SCOPE_MISMATCH", "RELEASE_CHANGE_SET_PARAMETERS_CHANGED",
          "RELEASE_CANDIDATE_TEMPLATE_CHANGED"].includes(error.message)) return await stop("REJECTED_CHANGE_SET", "IMAGE_ONLY_REVIEW_REJECTED");
        throw error;
      }
      break;
    }
    if (!reviewed) return await stop("FAILED_NEEDS_INSPECTION", "CHANGE_SET_READ_BUDGET_EXHAUSTED");
    try {
      const fresh = await preflight(changeSetId);
      if (await sourceFingerprint(fresh) !== await sourceFingerprint(before)) throw new Error("RELEASE_SOURCE_CHANGED");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("RELEASE_") && !error.message.startsWith("RELEASE_READ_")) {
        return await stop("REJECTED_CHANGE_SET", "SOURCE_CHANGED_BEFORE_EXECUTE");
      }
      throw error;
    }
    if (now() >= plan.writeBefore || now() >= input.readBefore) return await stop("EXPIRED", "ORIGINAL_WRITE_WINDOW_EXPIRED");
    const executeSha = await sha256Hex(executeReleaseChangeSetInput(reviewed, executeToken));
    await repository.operation(claim, "execute", "INTENT", executeSha);
    const notBefore = now();
    try {
      if (now() >= plan.writeBefore || now() >= input.readBefore) throw new Error("RELEASE_EXPIRED_AFTER_INTENT");
      await cloud.execute(reviewed, executeToken);
    } catch {
      await repository.operation(claim, "execute", "UNKNOWN", executeSha, changeSetId);
      return outcome("RECONCILIATION_REQUIRED", "EXECUTE_SUBMISSION_UNKNOWN");
    }
    await repository.operation(claim, "execute", "ACK", executeSha, changeSetId);
    let terminal = false, sawProgress = false;
    for (let i = 0; i < input.maxStackReads && now() < input.readBefore; i++) {
      const state = await cloud.stackState(plan);
      if (state.status.endsWith("_IN_PROGRESS")) sawProgress = true;
      else if (state.updatedAt > before.stackUpdatedAt || sawProgress) { terminal = true; break; }
      if (i + 1 < input.maxStackReads) await pause(input.pollIntervalMs);
    }
    if (!terminal || now() >= input.readBefore) return await stop("RECONCILIATION_REQUIRED", "STACK_READ_BUDGET_EXHAUSTED");
    const reference = await inspector.inspect({ requestId: input.requestId, planSha256: input.approvedPlanSha256,
      runId: input.runId, runAttempt: input.runAttempt, changeSetId, notBefore, readBefore: input.readBefore });
    if (now() >= input.readBefore) throw new Error("RELEASE_READ_BUDGET_EXPIRED");
    const inspected = await repository.request(input.requestId);
    if (!inspected?.inspection || canonicalJson(inspected.inspection.evidence) !== canonicalJson(reference)) {
      return await stop("FAILED_NEEDS_INSPECTION", "INDEPENDENT_INSPECTION_NOT_RECORDED");
    }
    const completed = await repository.complete(claim);
    return outcome(completed.status, "INDEPENDENT_RESULT_RECORDED");
  } catch (error) {
    // Do not write a second result after an unknown DB commit, nor resume any cloud write.
    return outcome(error instanceof ReleaseRequestRejected && !claimed ? "BLOCKED" : "RECONCILIATION_REQUIRED",
      error instanceof ReleasePersistenceUnknown ? "DATABASE_READBACK_REQUIRED" : error instanceof ReleaseRequestRejected ? "REQUEST_CAS_REJECTED" : "READ_OR_INSPECTION_REQUIRES_REVIEW");
  }
}
