import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import type { ImageUpdatePlan } from "./contract.ts";

export interface ReleaseJobContext {
  repository: string; repositoryId: string; runId: string; runAttempt: number;
  sourceSha: string; ref: string; event: string; actor: string;
  workflowRef: string;
  instanceId: string; releaseId: string; environment: string;
}
export interface ReleaseHandoff {
  schema: "techlong/instance-release-handoff/v1";
  job: ReleaseJobContext;
  requestId: string; planSha256: string; writeBefore: number;
}
export interface ReleaseSecretReference { arn: string; versionId: string; username: string }
export interface ReleaseEnvironmentConfig {
  accountId: string; region: string; repositoryId: string;
  controlEnvironmentId: string;
  environmentName: "techlong-sandbox-deploy"; environmentId: number; reviewerId: number;
  prepareRoleArn: string; executionRoleArn: string; inspectionRoleArn: string;
  prepareSubject: string; deploySubject: string;
  database: { planner: ReleaseSecretReference; executor: ReleaseSecretReference; verifier: ReleaseSecretReference };
  evidence: { bucket: string; owner: string; prefix: string };
  maxMetadataCallsPerSnapshot: number;
  promotion?: {
    roleArn: string; database: ReleaseSecretReference; artifactToken: { arn: string; versionId: string };
    sourceRepository: string; sourceRepositoryId: number; imageRepository: string;
  };
}
export interface ReleaseRuntimeConfig {
  schema: "techlong/instance-release-runtime/v1"; enabled: boolean; repository: string;
  environments: Record<string, ReleaseEnvironmentConfig>;
}

export function assertReleaseJob(job: ReleaseJobContext, repository: string) {
  if (job.repository !== repository || job.event !== "workflow_dispatch" || job.ref !== "refs/heads/main" ||
    job.workflowRef !== `${repository}/.github/workflows/instance-release.yml@refs/heads/main` ||
    job.runAttempt !== 1 || !/^[a-f0-9]{40}$/.test(job.sourceSha) || !/^[0-9]+$/.test(job.runId) ||
    !/^[0-9]+$/.test(job.repositoryId) || !job.actor || ![job.instanceId, job.releaseId].every(v => /^[a-zA-Z0-9_-]{1,100}$/.test(v)) ||
    job.environment !== "sandbox") throw new Error("RELEASE_JOB_BINDING_REJECTED");
}

/** A closed configuration stops before credentials, API calls or SQL. No inherited profile fallback. */
export function releaseEnvironment(config: ReleaseRuntimeConfig, job: ReleaseJobContext): ReleaseEnvironmentConfig | null {
  if (config.schema !== "techlong/instance-release-runtime/v1") throw new Error("RELEASE_CONFIG_REJECTED");
  assertReleaseJob(job, config.repository);
  if (config.enabled === false) return null;
  if (config.enabled !== true) throw new Error("RELEASE_CONFIG_REJECTED");
  const e = config.environments[job.environment];
  if (!e || e.repositoryId !== job.repositoryId || !e.controlEnvironmentId || e.environmentName !== "techlong-sandbox-deploy" ||
    !Number.isSafeInteger(e.environmentId) || e.environmentId < 1 || !Number.isSafeInteger(e.reviewerId) || e.reviewerId < 1 ||
    !/^\d{12}$/.test(e.accountId) || !/^[a-z]{2}-[a-z]+-\d$/.test(e.region) ||
    !Number.isSafeInteger(e.maxMetadataCallsPerSnapshot) || e.maxMetadataCallsPerSnapshot < 1 || e.maxMetadataCallsPerSnapshot > 50 ||
    e.evidence.owner !== e.accountId || !e.evidence.bucket || !/^[a-zA-Z0-9_/-]+$/.test(e.evidence.prefix)) throw new Error("RELEASE_ACTIVATION_INCOMPLETE");
  const roles = [e.prepareRoleArn, e.executionRoleArn, e.inspectionRoleArn];
  if (new Set(roles).size !== 3 || roles.some(r => !r.startsWith(`arn:aws:iam::${e.accountId}:role/`))) throw new Error("RELEASE_ROLE_SEPARATION_REQUIRED");
  if (!e.prepareSubject || !e.deploySubject || e.prepareSubject === e.deploySubject ||
    canonicalJson(Object.keys(e.database).sort()) !== canonicalJson(["executor", "planner", "verifier"])) throw new Error("RELEASE_ACTIVATION_INCOMPLETE");
  for (const [role, secret] of Object.entries(e.database)) {
    if (!secret.arn.startsWith(`arn:aws:secretsmanager:${e.region}:${e.accountId}:secret/`) ||
      !/^[a-zA-Z0-9-]{32,64}$/.test(secret.versionId) || secret.username !== `deployment_release_${role}_login`) throw new Error("RELEASE_DATABASE_IDENTITY_REJECTED");
  }
  if (new Set(Object.values(e.database).map(s => s.arn)).size !== 3) throw new Error("RELEASE_DATABASE_IDENTITY_REJECTED");
  if (e.promotion) {
    const p = e.promotion;
    if (roles.includes(p.roleArn) || !p.roleArn.startsWith(`arn:aws:iam::${e.accountId}:role/`) ||
      p.database.username !== "deployment_release_publisher_login" || Object.values(e.database).some(s => s.arn === p.database.arn) ||
      ![p.database, p.artifactToken].every(s => s.arn.startsWith(`arn:aws:secretsmanager:${e.region}:${e.accountId}:secret/`) && /^[a-zA-Z0-9-]{32,64}$/.test(s.versionId)) ||
      p.sourceRepository !== "veinyyxy/SpeedFeast_Backend_main" || !Number.isSafeInteger(p.sourceRepositoryId) || p.sourceRepositoryId < 1 ||
      p.imageRepository !== `${e.accountId}.dkr.ecr.${e.region}.amazonaws.com/techlong-sandbox-speedfeast`) throw new Error("RELEASE_PROMOTION_ACTIVATION_INCOMPLETE");
  }
  return e;
}

export async function releaseRequestId(job: ReleaseJobContext) {
  return "release_" + (await sha256Hex(job)).slice(0, 32);
}
export async function encodeReleaseHandoff(job: ReleaseJobContext, plan: ImageUpdatePlan) {
  const handoff: ReleaseHandoff = { schema: "techlong/instance-release-handoff/v1", job,
    requestId: plan.selection.requestId, planSha256: await sha256Hex(plan), writeBefore: plan.writeBefore };
  return { encoded: Buffer.from(canonicalJson(handoff)).toString("base64"), sha256: await sha256Hex(handoff), handoff };
}
export async function decodeReleaseHandoff(encoded: string, sha: string, job: ReleaseJobContext, now: number) {
  if (encoded.length > 8192 || !/^[a-zA-Z0-9+/]+=*$/.test(encoded)) throw new Error("RELEASE_HANDOFF_REJECTED");
  const h = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ReleaseHandoff;
  if (h.schema !== "techlong/instance-release-handoff/v1" || await sha256Hex(h) !== sha ||
    canonicalJson(h.job) !== canonicalJson(job) || h.requestId !== await releaseRequestId(job) ||
    !/^[a-f0-9]{64}$/.test(h.planSha256) || !Number.isSafeInteger(h.writeBefore) || now >= h.writeBefore) throw new Error("RELEASE_HANDOFF_REJECTED");
  return h;
}

export function releasePlanSummary(job: ReleaseJobContext, plan: ImageUpdatePlan) {
  return "## Instance API release — expected changes, not a created Change Set\n\n```json\n" + JSON.stringify({
    instance: job.instanceId, release: job.releaseId, environment: job.environment, source: job.sourceSha,
    run: job.runId, attempt: job.runAttempt, request: plan.selection.requestId, stack: plan.changeSet.StackName,
    from: plan.from, to: plan.to, templateSha256: plan.templateSha256, configurationSha256: plan.configurationSha256,
    writeBefore: new Date(plan.writeBefore).toISOString(), maximumCreate: 1, maximumExecute: 1,
    expectedChanges: plan.expectedChanges, databaseMigration: false, automaticRestore: false,
    rollback: "Existing CloudFormation managed rollback; no separate rollback deployment",
    risks: "Possible downtime/concurrent tasks and fees; unknown submissions stop without retry or cleanup; no resource TTL",
  }, null, 2) + "\n```\n\nApprove only this run's techlong-sandbox-deploy environment. No Web approval is required.\n";
}
