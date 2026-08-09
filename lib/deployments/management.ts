import { getDatabase } from "@/db";
import { stableId } from "@/lib/domain/ids";
import { env } from "cloudflare:workers";
import { AwsEcsCellPlanOnlyDriver } from "./drivers/aws-ecs-cell";
import {
  parseDeploymentEnvironmentPolicy,
  validateDeploymentEnvironment,
  type DeploymentEnvironment,
  type DeploymentEnvironmentKind,
  type DeploymentEnvironmentStatus,
} from "./environment";
import { prepareDeploymentJobInsert } from "./jobs";
import {
  isDeploymentProfileKey,
  type DeploymentProfileKey,
} from "./profiles";
import type {
  AwsEcsCellDeploymentPlan,
  DeploymentStatus,
} from "./types";

export interface AppInstanceDeploymentView {
  id: string;
  appInstanceId: string;
  subscriptionId: string | null;
  purchaseOrderId: string | null;
  environmentId: string;
  driver: string;
  workflowVersion: string;
  cellKey: string;
  deploymentProfileKey: DeploymentProfileKey;
  mode: "plan_only" | "aws_sandbox" | "aws_production";
  status: DeploymentStatus;
  desiredPlan: AwsEcsCellDeploymentPlan;
  planHash: string;
  configurationHash: string | null;
  idempotencyKey: string;
  artifactRef: string | null;
  controlPayloadHash: string | null;
  currentStep: string | null;
  outputs: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  startedAt: number | null;
  readyAt: number | null;
  failedAt: number | null;
  cancelRequestedAt: number | null;
  rollbackAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface DeploymentRow {
  id: string;
  app_instance_id: string;
  subscription_id: string | null;
  purchase_order_id: string | null;
  environment_id: string;
  driver: string;
  workflow_version: string;
  cell_key: string;
  deployment_profile_key: string;
  mode: "plan_only" | "aws_sandbox" | "aws_production";
  status: DeploymentStatus;
  desired_plan: string;
  plan_hash: string;
  configuration_hash: string | null;
  idempotency_key: string;
  artifact_ref: string | null;
  control_payload_hash: string | null;
  current_step: string | null;
  outputs: string;
  attempts: number;
  last_error: string | null;
  started_at: number | null;
  ready_at: number | null;
  failed_at: number | null;
  cancel_requested_at: number | null;
  rollback_at: number | null;
  created_at: number;
  updated_at: number;
}

interface DeploymentEnvironmentRow {
  id: string;
  key: string;
  name: string;
  kind: DeploymentEnvironmentKind;
  driver: "aws_ecs_cell";
  expected_account_id: string;
  region: string;
  cell_key: string;
  base_domain: string;
  apply_enabled: number;
  policy: string;
  status: DeploymentEnvironmentStatus;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function deploymentBinding(name: string): string | undefined {
  const bindings = env as unknown as Record<string, unknown>;
  const value =
    typeof bindings[name] === "string"
      ? bindings[name]
      : typeof process !== "undefined"
        ? process.env[name]
        : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseDesiredPlan(value: string): AwsEcsCellDeploymentPlan {
  return JSON.parse(value) as AwsEcsCellDeploymentPlan;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toEnvironment(row: DeploymentEnvironmentRow): DeploymentEnvironment {
  const policy = parseDeploymentEnvironmentPolicy(parseObject(row.policy));
  if (!policy) throw new Error(`部署环境 ${row.key} 的策略格式无效。`);
  const environment: DeploymentEnvironment = {
    id: row.id,
    key: row.key,
    name: row.name,
    kind: row.kind,
    driver: row.driver,
    expectedAccountId: row.expected_account_id,
    region: row.region,
    cellKey: row.cell_key,
    baseDomain: row.base_domain,
    applyEnabled: row.apply_enabled === 1,
    status: row.status,
    policy,
  };
  const errors = validateDeploymentEnvironment(environment);
  if (errors.length > 0) {
    throw new Error(`部署环境 ${row.key} 未通过安全校验：${errors.join(", ")}。`);
  }
  return environment;
}

export async function getConfiguredDeploymentEnvironment(
  environmentKey =
    deploymentBinding("AWS_DEPLOYMENT_ENVIRONMENT_KEY") ??
    "aws-sandbox-ca-central-1",
): Promise<DeploymentEnvironment> {
  const row = await getDatabase()
    .prepare(
      `SELECT id, key, name, kind, driver, expected_account_id, region,
        cell_key, base_domain, apply_enabled, policy, status
       FROM deployment_environments
       WHERE key = ?
       LIMIT 1`,
    )
    .bind(environmentKey)
    .first<DeploymentEnvironmentRow>();
  if (!row) throw new Error(`没有找到部署环境：${environmentKey}。`);
  return toEnvironment(row);
}

function toView(row: DeploymentRow): AppInstanceDeploymentView {
  return {
    id: row.id,
    appInstanceId: row.app_instance_id,
    subscriptionId: row.subscription_id,
    purchaseOrderId: row.purchase_order_id,
    environmentId: row.environment_id,
    driver: row.driver,
    workflowVersion: row.workflow_version,
    cellKey: row.cell_key,
    deploymentProfileKey: isDeploymentProfileKey(row.deployment_profile_key)
      ? row.deployment_profile_key
      : "standard-v1",
    mode: row.mode,
    status: row.status,
    desiredPlan: parseDesiredPlan(row.desired_plan),
    planHash: row.plan_hash,
    configurationHash: row.configuration_hash,
    idempotencyKey: row.idempotency_key,
    artifactRef: row.artifact_ref,
    controlPayloadHash: row.control_payload_hash,
    currentStep: row.current_step,
    outputs: parseObject(row.outputs),
    attempts: Number(row.attempts),
    lastError: row.last_error,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    failedAt: row.failed_at,
    cancelRequestedAt: row.cancel_requested_at,
    rollbackAt: row.rollback_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLatestAppInstanceDeployment(
  appInstanceId: string,
): Promise<AppInstanceDeploymentView | null> {
  const row = await getDatabase()
    .prepare(
      `SELECT id, app_instance_id, subscription_id, purchase_order_id,
        environment_id,
        driver, workflow_version, cell_key, deployment_profile_key,
        mode, status, desired_plan, plan_hash, configuration_hash,
        idempotency_key, artifact_ref, control_payload_hash, current_step,
        outputs, attempts, last_error, started_at, ready_at, failed_at,
        cancel_requested_at, rollback_at, created_at, updated_at
       FROM app_instance_deployments
       WHERE app_instance_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(appInstanceId)
    .first<DeploymentRow>();
  return row ? toView(row) : null;
}

export async function ensurePlannedAppInstanceDeployment(input: {
  appInstanceId: string;
  workspaceId: string;
  productId: string;
  planId: string;
  templateVersionId: string;
  subscriptionId: string;
  purchaseOrderId: string | null;
  tenantKey: string;
  deploymentProfileKey: DeploymentProfileKey;
  configurationSnapshot: unknown;
  now?: number;
}): Promise<AppInstanceDeploymentView> {
  const environment = await getConfiguredDeploymentEnvironment();
  const driver = new AwsEcsCellPlanOnlyDriver({
    region: environment.region,
    cellKey: environment.cellKey,
    mode: environment.kind,
  });
  const desiredPlan = driver.buildPlan({
    appInstanceId: input.appInstanceId,
    workspaceId: input.workspaceId,
    productId: input.productId,
    planId: input.planId,
    subscriptionId: input.subscriptionId,
    tenantKey: input.tenantKey,
    deploymentProfileKey: input.deploymentProfileKey,
  });
  const desiredPlanJson = canonicalJson(desiredPlan);
  const planHash = await sha256(desiredPlanJson);
  const configurationHash = await sha256(
    canonicalJson(input.configurationSnapshot),
  );
  const artifactRef = deploymentBinding("AWS_SANDBOX_IMAGE_URI") ?? null;
  const idempotencyKey = await sha256(
    canonicalJson({
      appInstanceId: input.appInstanceId,
      subscriptionId: input.subscriptionId,
      templateVersionId: input.templateVersionId,
      driver: driver.id,
      workflowVersion: driver.workflowVersion,
      deploymentProfileKey: input.deploymentProfileKey,
      environmentId: environment.id,
      configurationHash,
      artifactRef,
      planHash,
    }),
  );
  const id = await stableId("dep", idempotencyKey);
  const now = input.now ?? Date.now();
  // S1 persists the pending outbox intent atomically but leaves the deployment
  // planned. A future S3 worker may move it to queued only after the global
  // execution gates pass and it successfully claims the job.
  const job = await prepareDeploymentJobInsert({
    deploymentId: id,
    jobType: "apply",
    planHash,
    availableAt: now,
    now,
  });
  const db = getDatabase();
  await db.batch([
    db.prepare(
      `INSERT INTO app_instance_deployments (
        id, app_instance_id, subscription_id, purchase_order_id,
        environment_id, driver, workflow_version, cell_key,
        deployment_profile_key, mode, status, desired_plan, plan_hash,
        configuration_hash, idempotency_key, artifact_ref,
        control_payload_hash, current_step, outputs, attempts, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?,
        ?, ?, NULL, NULL, '{}', 0, NULL, ?, ?)
      ON CONFLICT (idempotency_key) DO NOTHING`,
    )
    .bind(
      id,
      input.appInstanceId,
      input.subscriptionId,
      input.purchaseOrderId,
      environment.id,
      driver.id,
      driver.workflowVersion,
      desiredPlan.cellKey,
      input.deploymentProfileKey,
      desiredPlan.mode,
      desiredPlanJson,
      planHash,
      configurationHash,
      idempotencyKey,
      artifactRef,
      now,
      now,
    ),
    job.statement,
  ]);

  const row = await getDatabase()
    .prepare(
      `SELECT id, app_instance_id, subscription_id, purchase_order_id,
        environment_id,
        driver, workflow_version, cell_key, deployment_profile_key,
        mode, status, desired_plan, plan_hash, configuration_hash,
        idempotency_key, artifact_ref, control_payload_hash, current_step,
        outputs, attempts, last_error, started_at, ready_at, failed_at,
        cancel_requested_at, rollback_at, created_at, updated_at
       FROM app_instance_deployments
       WHERE idempotency_key = ?
       LIMIT 1`,
    )
    .bind(idempotencyKey)
    .first<DeploymentRow>();
  if (!row) throw new Error("无法保存应用实例部署计划。");
  return toView(row);
}
