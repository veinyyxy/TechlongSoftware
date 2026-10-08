import { canonicalJson, sha256Hex } from "./hash.ts";

export const LEGACY_PLAN_TARGET = "dep_d00144511731f1c20991aa56";
export const LEGACY_PLAN_ENVIRONMENT = "env_aws_sandbox_ca_central_1";
export interface LegacyPlanIsolationEvidence {
  deploymentId: string;
  environmentId: string;
  mode: string;
  status: string;
  cellKey: string;
  attempts: number;
  updatedAt: number;
  appInstanceId: string;
  instanceStatus: string;
  subscriptionStatus: string | null;
  deploymentRowSha256: string;
  businessStateSha256: string;
  immutableEnvironmentTriggerSha256: string;
  environmentReferenceImmutable: boolean;
  planSafety: { applyEnabled: boolean; createsAwsResources: boolean; storesSecretValues: boolean };
  relations: { instanceDeploymentCount: number; jobCount: number; resourceCount: number; capacityCount: number; scheduleCount: number; stepCount: number };
  environmentCounts: { activeTenantCount: number; nonterminalDeploymentCount: number; capacityCount: number; liveResourceCount: number; nonterminalScheduleCount: number };
  databaseObservedAt: string;
}
function freezeReview<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeReview);
    Object.freeze(value);
  }
  return value;
}
export async function compileLegacyPlanIsolationReview(raw: LegacyPlanIsolationEvidence) {
  const evidence = JSON.parse(canonicalJson(raw)) as LegacyPlanIsolationEvidence;
  const expected = ["deploymentId", "environmentId", "mode", "status", "cellKey", "attempts", "updatedAt", "appInstanceId", "instanceStatus", "subscriptionStatus", "deploymentRowSha256", "businessStateSha256", "immutableEnvironmentTriggerSha256", "environmentReferenceImmutable", "planSafety", "relations", "environmentCounts", "databaseObservedAt"];
  const nestedKeys = (value: unknown, names: string[]) => value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson(names.sort());
  if (canonicalJson(Object.keys(evidence).sort()) !== canonicalJson(expected.sort()) || evidence.deploymentId !== LEGACY_PLAN_TARGET ||
    evidence.environmentId !== LEGACY_PLAN_ENVIRONMENT || ![evidence.deploymentRowSha256, evidence.businessStateSha256, evidence.immutableEnvironmentTriggerSha256].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) ||
    ![evidence.mode, evidence.status, evidence.cellKey, evidence.instanceStatus].every(v => typeof v === "string" && v.length > 0) ||
    !(evidence.subscriptionStatus === null || (typeof evidence.subscriptionStatus === "string" && evidence.subscriptionStatus.length > 0)) ||
    !Number.isSafeInteger(evidence.updatedAt) || evidence.updatedAt <= 0 || !Number.isSafeInteger(evidence.attempts) || evidence.attempts < 0 ||
    typeof evidence.databaseObservedAt !== "string" || new Date(evidence.databaseObservedAt).toISOString() !== evidence.databaseObservedAt ||
    !nestedKeys(evidence.relations, ["instanceDeploymentCount", "jobCount", "resourceCount", "capacityCount", "scheduleCount", "stepCount"]) ||
    !nestedKeys(evidence.environmentCounts, ["activeTenantCount", "nonterminalDeploymentCount", "capacityCount", "liveResourceCount", "nonterminalScheduleCount"]) ||
    !nestedKeys(evidence.planSafety, ["applyEnabled", "createsAwsResources", "storesSecretValues"]) ||
    Object.values(evidence.planSafety).some(v => typeof v !== "boolean") || typeof evidence.environmentReferenceImmutable !== "boolean" ||
    typeof evidence.appInstanceId !== "string" || !/^app_[a-f0-9]{32}$/.test(evidence.appInstanceId) ||
    Object.values(evidence.relations).some(v => !Number.isSafeInteger(v) || v < 0) ||
    Object.values(evidence.environmentCounts).some(v => !Number.isSafeInteger(v) || v < 0)) throw new Error("LEGACY_PLAN_REVIEW_EVIDENCE_INVALID");
  const candidate = evidence.mode === "plan_only" && evidence.status === "planned" && evidence.cellKey === "cell-demo-1" && evidence.attempts === 0 &&
    evidence.environmentReferenceImmutable && evidence.planSafety.applyEnabled === false && evidence.planSafety.createsAwsResources === false && evidence.planSafety.storesSecretValues === false &&
    evidence.relations.instanceDeploymentCount === 1 && evidence.relations.jobCount === 0 && evidence.relations.resourceCount === 0 &&
    evidence.relations.capacityCount === 0 && evidence.relations.scheduleCount === 0 && evidence.relations.stepCount === 0;
  const body = {
    schemaVersion: 1, stage: "F3b3", outcome: candidate ? "SEALED_PLAN_REGISTRY_CANDIDATE_REQUIRES_NEW_SCHEMA_REVIEW" : "BLOCKED_NOT_AN_EMPTY_NONEXECUTING_PLAN",
    evidence, userDisposition: "PRESERVE_INSTANCE_AND_SUBSCRIPTION_RESEARCH_ISOLATION",
    directEnvironmentIdMoveAllowed: false, disableExistingTriggersAllowed: false,
    customerInstanceMutationAllowed: false, subscriptionMutationAllowed: false, originalDeploymentDeletionAllowed: false,
    recommendedDesign: candidate ? {
      kind: "APPEND_ONLY_SEALED_NONEXECUTING_PLAN_REGISTRY",
      preservesOriginalDeploymentRow: true, preservesOriginalPlanHashAndBytes: true,
      requiresPermanentOriginalRowFreeze: true, requiresBlockOnEveryExecutionReference: true,
      requiresExactSnapshotProtocolUpgrade: true, currentZeroTenantQueryUnchanged: true,
    } : null,
    requiredIndependentApprovals: ["New isolation schema and permanent sealing protections", "Exact one-row registration against fresh snapshot", "Versioned zero-tenant proof protocol; never generic mode=plan_only exclusion"],
    executionAuthorized: false, databaseMutationPerformed: false, cloudMutationPerformed: false, runtimeEnabled: false,
  };
  return freezeReview({ ...body, reviewSha256: await sha256Hex(body) });
}
