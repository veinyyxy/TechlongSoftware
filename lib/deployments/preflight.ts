import type { DeploymentProfileKey } from "./profiles.ts";
import {
  validateDeploymentEnvironment,
  type DeploymentEnvironment,
} from "./environment.ts";

export interface DeploymentPreflightCheck {
  key: string;
  passed: boolean;
  message: string;
}

export interface DeploymentPreflightResult {
  ok: boolean;
  checks: DeploymentPreflightCheck[];
}

export interface AwsSandboxPreflightInput {
  environment: DeploymentEnvironment;
  operation: "render" | "apply";
  deploymentProfileKey: DeploymentProfileKey;
  observedAccountId?: string;
  observedRegion?: string;
  activeCellCount: number;
  activeTenantCount: number;
  cellOperation: "reuse" | "create";
}

function check(key: string, passed: boolean, message: string): DeploymentPreflightCheck {
  return { key, passed, message };
}

export function evaluateAwsSandboxPreflight(
  input: AwsSandboxPreflightInput,
): DeploymentPreflightResult {
  const configurationErrors = validateDeploymentEnvironment(input.environment);
  const checks: DeploymentPreflightCheck[] = [
    check(
      "environment_kind",
      input.environment.kind === "aws_sandbox",
      input.environment.kind === "aws_sandbox"
        ? "Deployment environment is an AWS sandbox."
        : "AWS sandbox preflight cannot evaluate a production environment.",
    ),
    check(
      "environment_configuration",
      configurationErrors.length === 0,
      configurationErrors.length
        ? `Sandbox policy is invalid: ${configurationErrors.join(", ")}.`
        : "Sandbox policy is valid.",
    ),
    check(
      "environment_active",
      input.environment.status === "active",
      input.environment.status === "active"
        ? "Deployment environment is active."
        : "Deployment environment is inactive.",
    ),
    check(
      "profile_allowlist",
      input.environment.policy.allowedProfiles.includes(
        input.deploymentProfileKey,
      ),
      input.environment.policy.allowedProfiles.includes(input.deploymentProfileKey)
        ? "Deployment profile is allowed."
        : "Deployment profile is not allowed in this environment.",
    ),
    check(
      "cell_capacity",
      Number.isSafeInteger(input.activeCellCount) &&
        (input.cellOperation === "reuse"
          ? input.activeCellCount >= 1 &&
            input.activeCellCount <= input.environment.policy.maxCells
          : input.activeCellCount < input.environment.policy.maxCells),
      input.cellOperation === "reuse"
        ? "The selected existing cell must be active and within the environment limit."
        : "A new cell must fit below the environment limit.",
    ),
    check(
      "tenant_capacity",
      Number.isSafeInteger(input.activeTenantCount) &&
        input.activeTenantCount < input.environment.policy.maxTenants,
      "A new tenant must fit within the environment policy.",
    ),
  ];

  if (input.observedAccountId !== undefined) {
    checks.push(
      check(
        "aws_account",
        input.observedAccountId === input.environment.expectedAccountId,
        "Observed AWS account must match the configured allowlist.",
      ),
    );
  }
  if (input.observedRegion !== undefined) {
    checks.push(
      check(
        "aws_region",
        input.observedRegion === input.environment.region,
        "Observed AWS region must match the configured region.",
      ),
    );
  }
  if (input.operation === "apply") {
    checks.push(
      check(
        "aws_apply_hard_disabled",
        false,
        "AWS apply is not implemented in S1 and cannot be enabled by configuration.",
      ),
    );
  }

  return { ok: checks.every((item) => item.passed), checks };
}

export class DeploymentPreflightError extends Error {
  readonly code = "DEPLOYMENT_PREFLIGHT_FAILED";
  readonly result: DeploymentPreflightResult;

  constructor(result: DeploymentPreflightResult) {
    super(
      result.checks
        .filter((item) => !item.passed)
        .map((item) => item.message)
        .join(" ") || "Deployment preflight failed.",
    );
    this.result = result;
  }
}

export function assertAwsSandboxPreflight(
  input: AwsSandboxPreflightInput,
): DeploymentPreflightResult {
  const result = evaluateAwsSandboxPreflight(input);
  if (!result.ok) throw new DeploymentPreflightError(result);
  return result;
}
