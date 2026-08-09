import {
  isDeploymentProfileKey,
  type DeploymentProfileKey,
} from "./profiles.ts";

export type DeploymentEnvironmentKind = "aws_sandbox" | "aws_production";
export type DeploymentEnvironmentStatus = "active" | "inactive";

export interface DeploymentEnvironmentPolicy {
  budgetLimitCents: number;
  ttlSeconds: number;
  maxCells: number;
  maxTenants: number;
  maxTaskCount: number;
  allowedProfiles: DeploymentProfileKey[];
  allowNatGateway: boolean;
  allowInterfaceEndpoints: boolean;
  databaseEngine: "aurora-postgresql-serverless-v2";
  auroraPostgresMinimumVersion: "16.3";
  auroraPostgresEngineVersion: string;
  auroraEngineMode: "provisioned";
  allowLimitlessDatabase: false;
  databaseMode: "tenant_database";
  auroraServerlessMinAcu: 0;
  auroraServerlessMaxAcu: number;
  auroraSecondsUntilAutoPause: number;
  allowDedicatedDatabase: false;
  allowMultiAzDatabase: false;
  allowRdsProxy: false;
  allowGlobalDatabase: false;
  logRetentionDays: number;
}

export interface DeploymentEnvironment {
  id: string;
  key: string;
  name: string;
  kind: DeploymentEnvironmentKind;
  driver: "aws_ecs_cell";
  expectedAccountId: string;
  region: string;
  cellKey: string;
  baseDomain: string;
  applyEnabled: boolean;
  status: DeploymentEnvironmentStatus;
  policy: DeploymentEnvironmentPolicy;
}

const awsAccountPattern = /^\d{12}$/;
const awsRegionPattern = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const safeKeyPattern = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function parseDeploymentEnvironmentPolicy(
  value: unknown,
): DeploymentEnvironmentPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  const rawProfiles = Array.isArray(policy.allowedProfiles)
    ? policy.allowedProfiles
    : [];
  const profiles = rawProfiles.filter(isDeploymentProfileKey);
  if (
    !Number.isSafeInteger(policy.budgetLimitCents) ||
    Number(policy.budgetLimitCents) <= 0 ||
    !Number.isSafeInteger(policy.ttlSeconds) ||
    Number(policy.ttlSeconds) < 300 ||
    !Number.isSafeInteger(policy.maxCells) ||
    Number(policy.maxCells) < 1 ||
    !Number.isSafeInteger(policy.maxTenants) ||
    Number(policy.maxTenants) < 1 ||
    !Number.isSafeInteger(policy.maxTaskCount) ||
    Number(policy.maxTaskCount) < 1 ||
    !Number.isSafeInteger(policy.logRetentionDays) ||
    Number(policy.logRetentionDays) < 1 ||
    profiles.length !== rawProfiles.length ||
    profiles.length === 0 ||
    typeof policy.allowNatGateway !== "boolean" ||
    typeof policy.allowInterfaceEndpoints !== "boolean" ||
    policy.databaseEngine !== "aurora-postgresql-serverless-v2" ||
    policy.auroraPostgresMinimumVersion !== "16.3" ||
    typeof policy.auroraPostgresEngineVersion !== "string" ||
    !/^16\.(?:[3-9]|[1-9][0-9])(?:\.[0-9]+)?$/.test(
      policy.auroraPostgresEngineVersion,
    ) ||
    policy.auroraEngineMode !== "provisioned" ||
    policy.allowLimitlessDatabase !== false ||
    policy.databaseMode !== "tenant_database" ||
    policy.auroraServerlessMinAcu !== 0 ||
    typeof policy.auroraServerlessMaxAcu !== "number" ||
    !Number.isFinite(policy.auroraServerlessMaxAcu) ||
    Number(policy.auroraServerlessMaxAcu) <= 0 ||
    Number(policy.auroraServerlessMaxAcu) > 2 ||
    !Number.isSafeInteger(policy.auroraSecondsUntilAutoPause) ||
    Number(policy.auroraSecondsUntilAutoPause) < 300 ||
    Number(policy.auroraSecondsUntilAutoPause) > 86_400 ||
    policy.allowDedicatedDatabase !== false ||
    policy.allowMultiAzDatabase !== false ||
    policy.allowRdsProxy !== false ||
    policy.allowGlobalDatabase !== false
  ) {
    return null;
  }
  return {
    budgetLimitCents: Number(policy.budgetLimitCents),
    ttlSeconds: Number(policy.ttlSeconds),
    maxCells: Number(policy.maxCells),
    maxTenants: Number(policy.maxTenants),
    maxTaskCount: Number(policy.maxTaskCount),
    allowedProfiles: profiles,
    allowNatGateway: policy.allowNatGateway,
    allowInterfaceEndpoints: policy.allowInterfaceEndpoints,
    databaseEngine: "aurora-postgresql-serverless-v2",
    auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: policy.auroraPostgresEngineVersion,
    auroraEngineMode: "provisioned",
    allowLimitlessDatabase: false,
    databaseMode: "tenant_database",
    auroraServerlessMinAcu: 0,
    auroraServerlessMaxAcu: Number(policy.auroraServerlessMaxAcu),
    auroraSecondsUntilAutoPause: Number(policy.auroraSecondsUntilAutoPause),
    allowDedicatedDatabase: false,
    allowMultiAzDatabase: false,
    allowRdsProxy: false,
    allowGlobalDatabase: false,
    logRetentionDays: Number(policy.logRetentionDays),
  };
}

export function validateDeploymentEnvironment(
  environment: DeploymentEnvironment,
): string[] {
  const errors: string[] = [];
  if (!safeKeyPattern.test(environment.key)) errors.push("environment_key_invalid");
  if (!safeKeyPattern.test(environment.cellKey)) errors.push("cell_key_invalid");
  if (!awsAccountPattern.test(environment.expectedAccountId)) {
    errors.push("account_id_invalid");
  }
  if (!awsRegionPattern.test(environment.region)) errors.push("region_invalid");
  if (
    !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      environment.baseDomain,
    )
  ) {
    errors.push("base_domain_invalid");
  }
  if (environment.driver !== "aws_ecs_cell") errors.push("driver_not_allowed");
  if (environment.kind === "aws_sandbox") {
    if (environment.expectedAccountId !== "402010193138") {
      errors.push("sandbox_account_not_allowlisted");
    }
    if (environment.region !== "ca-central-1") errors.push("sandbox_region_invalid");
    if (environment.cellKey !== "cell-sandbox-1") errors.push("sandbox_cell_key_invalid");
    if (environment.baseDomain !== "sandbox.techlong.cloud") {
      errors.push("sandbox_base_domain_invalid");
    }
    if (environment.applyEnabled) errors.push("sandbox_apply_must_be_disabled");
    if (environment.policy.budgetLimitCents !== 1_000) {
      errors.push("sandbox_budget_invalid");
    }
    if (environment.policy.maxCells !== 1) errors.push("sandbox_cell_limit_invalid");
    if (environment.policy.maxTenants !== 1) errors.push("sandbox_tenant_limit_invalid");
    if (environment.policy.maxTaskCount !== 1) errors.push("sandbox_task_limit_invalid");
    if (environment.policy.ttlSeconds !== 2 * 60 * 60) {
      errors.push("sandbox_ttl_invalid");
    }
    if (
      environment.policy.allowedProfiles.length !== 1 ||
      environment.policy.allowedProfiles[0] !== "standard-v1"
    ) {
      errors.push("sandbox_profile_not_restricted");
    }
    if (environment.policy.allowNatGateway) errors.push("sandbox_nat_not_allowed");
    if (environment.policy.allowInterfaceEndpoints) {
      errors.push("sandbox_interface_endpoints_not_allowed");
    }
    if (environment.policy.databaseEngine !== "aurora-postgresql-serverless-v2") {
      errors.push("sandbox_database_engine_invalid");
    }
    if (environment.policy.auroraPostgresMinimumVersion !== "16.3") {
      errors.push("sandbox_aurora_minimum_version_invalid");
    }
    if (environment.policy.auroraEngineMode !== "provisioned") {
      errors.push("sandbox_aurora_engine_mode_invalid");
    }
    if (environment.policy.allowLimitlessDatabase) {
      errors.push("sandbox_aurora_limitless_not_allowed");
    }
    if (environment.policy.auroraPostgresEngineVersion !== "16.14") {
      errors.push("sandbox_aurora_engine_version_invalid");
    }
    if (environment.policy.databaseMode !== "tenant_database") {
      errors.push("sandbox_database_mode_invalid");
    }
    if (environment.policy.auroraServerlessMinAcu !== 0) {
      errors.push("sandbox_aurora_min_acu_invalid");
    }
    if (
      environment.policy.auroraServerlessMaxAcu !== 1
    ) {
      errors.push("sandbox_aurora_max_acu_too_high");
    }
    if (
      environment.policy.auroraSecondsUntilAutoPause !== 300
    ) {
      errors.push("sandbox_aurora_auto_pause_invalid");
    }
    if (environment.policy.allowDedicatedDatabase) {
      errors.push("sandbox_dedicated_database_not_allowed");
    }
    if (environment.policy.allowMultiAzDatabase) {
      errors.push("sandbox_multi_az_database_not_allowed");
    }
    if (environment.policy.allowRdsProxy) errors.push("sandbox_rds_proxy_not_allowed");
    if (environment.policy.allowGlobalDatabase) {
      errors.push("sandbox_global_database_not_allowed");
    }
  }
  return errors;
}
