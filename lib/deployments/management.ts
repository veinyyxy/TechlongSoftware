import { getDatabase } from "@/db";
import { stableId } from "@/lib/domain/ids";
import { env } from "cloudflare:workers";
import { AwsEcsCellPlanOnlyDriver } from "./drivers/aws-ecs-cell";
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
  driver: string;
  workflowVersion: string;
  cellKey: string;
  deploymentProfileKey: DeploymentProfileKey;
  mode: "plan_only";
  status: DeploymentStatus;
  desiredPlan: AwsEcsCellDeploymentPlan;
  planHash: string;
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

interface DeploymentRow {
  id: string;
  app_instance_id: string;
  subscription_id: string | null;
  purchase_order_id: string | null;
  driver: string;
  workflow_version: string;
  cell_key: string;
  deployment_profile_key: string;
  mode: "plan_only";
  status: DeploymentStatus;
  desired_plan: string;
  plan_hash: string;
  idempotency_key: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
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

function toView(row: DeploymentRow): AppInstanceDeploymentView {
  return {
    id: row.id,
    appInstanceId: row.app_instance_id,
    subscriptionId: row.subscription_id,
    purchaseOrderId: row.purchase_order_id,
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
    idempotencyKey: row.idempotency_key,
    attempts: Number(row.attempts),
    lastError: row.last_error,
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
        driver, workflow_version, cell_key, deployment_profile_key,
        mode, status, desired_plan, plan_hash, idempotency_key,
        attempts, last_error, created_at, updated_at
       FROM app_instance_deployments
       WHERE app_instance_id = ?
       ORDER BY created_at DESC
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
  now?: number;
}): Promise<AppInstanceDeploymentView> {
  const driver = new AwsEcsCellPlanOnlyDriver({
    region: deploymentBinding("AWS_REGION"),
    cellKey: deploymentBinding("AWS_DEFAULT_CELL_KEY"),
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
  const idempotencyKey = await sha256(
    canonicalJson({
      appInstanceId: input.appInstanceId,
      subscriptionId: input.subscriptionId,
      templateVersionId: input.templateVersionId,
      driver: driver.id,
      workflowVersion: driver.workflowVersion,
      deploymentProfileKey: input.deploymentProfileKey,
      planHash,
    }),
  );
  const id = await stableId("dep", idempotencyKey);
  const now = input.now ?? Date.now();
  await getDatabase()
    .prepare(
      `INSERT INTO app_instance_deployments (
        id, app_instance_id, subscription_id, purchase_order_id,
        driver, workflow_version, cell_key, deployment_profile_key,
        mode, status, desired_plan, plan_hash, idempotency_key,
        attempts, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plan_only', 'planned', ?, ?, ?,
        0, NULL, ?, ?)
      ON CONFLICT (idempotency_key) DO NOTHING`,
    )
    .bind(
      id,
      input.appInstanceId,
      input.subscriptionId,
      input.purchaseOrderId,
      driver.id,
      driver.workflowVersion,
      desiredPlan.cellKey,
      input.deploymentProfileKey,
      desiredPlanJson,
      planHash,
      idempotencyKey,
      now,
      now,
    )
    .run();

  const row = await getDatabase()
    .prepare(
      `SELECT id, app_instance_id, subscription_id, purchase_order_id,
        driver, workflow_version, cell_key, deployment_profile_key,
        mode, status, desired_plan, plan_hash, idempotency_key,
        attempts, last_error, created_at, updated_at
       FROM app_instance_deployments
       WHERE idempotency_key = ?
       LIMIT 1`,
    )
    .bind(idempotencyKey)
    .first<DeploymentRow>();
  if (!row) throw new Error("无法保存应用实例部署计划。");
  return toView(row);
}
