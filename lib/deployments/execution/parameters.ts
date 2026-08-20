import type { DeploymentEnvironment } from "../environment.ts";
import type {
  ApplyReadyTenantStack,
  DeploymentExecutionBinding,
} from "./contracts.ts";
import {
  assertAwsSandboxTenantRuntimeSecretRef,
  type CloudFormationTenantStackPlan,
} from "../cloudformation/tenant-stack.ts";

const secretReferenceParameters = new Set([
  "ControlPublicKeyValueFrom",
]);

const forbiddenEnvironmentTenantSecretParameters = new Set([
  "DatabaseUrlValueFrom",
  "HmacSecretKeyValueFrom",
  "JwtSecretKeyValueFrom",
  "StripeSecretKeyValueFrom",
  "StripeWebhookSecretValueFrom",
  "TenantRuntimeSecretArn",
]);

const exactRoleNames: Record<string, string> = {
  TaskExecutionRoleArn: "TechlongSandboxTaskExecutionRole",
  TaskRoleArn: "TechlongSandboxTaskRole",
  SchedulerInvokeRoleArn: "TechlongSandboxSchedulerInvokeRole",
};

const listenerParameters = new Set(["HttpsListenerArn", "ControlListenerArn"]);

function assertText(name: string, value: string | undefined, maximum = 2_048): string {
  const raw = value ?? "";
  const normalized = raw.trim();
  if (
    raw !== normalized ||
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`CloudFormation parameter ${name} is invalid.`);
  }
  return normalized;
}

function assertArn(input: {
  name: string;
  value: string;
  service: string;
  region: string;
  accountId: string;
  resourcePattern: RegExp;
}): void {
  const pattern = new RegExp(
    `^arn:aws:${input.service}:${input.region.replaceAll("-", "\\-")}:${input.accountId}:${input.resourcePattern.source}$`,
  );
  if (!pattern.test(input.value)) {
    throw new Error(`CloudFormation parameter ${input.name} is outside the AWS allowlist.`);
  }
}

function parseHttpsUrl(name: string, value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`CloudFormation parameter ${name} must be an HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !parsed.hostname.endsWith(".techlong.cloud") && parsed.hostname !== "techlong.cloud"
  ) {
    throw new Error(`CloudFormation parameter ${name} must use the techlong.cloud HTTPS boundary.`);
  }
  return parsed;
}

function validateExternalParameter(input: {
  name: string;
  value: string;
  environment: DeploymentEnvironment;
}): void {
  const value = assertText(input.name, input.value);
  const { name, environment } = input;
  if (name === "ClusterName") {
    if (value !== "cell-sandbox-1") {
      throw new Error("CloudFormation ClusterName is outside the sandbox allowlist.");
    }
    return;
  }
  if (name === "SchedulerGroupName") {
    if (value !== "techlong-sandbox") {
      throw new Error("CloudFormation SchedulerGroupName is outside the sandbox allowlist.");
    }
    return;
  }
  if (name === "VpcId") {
    if (!/^vpc-[a-f0-9]{8,17}$/.test(value)) throw new Error("CloudFormation VpcId is invalid.");
    return;
  }
  if (name === "SubnetIds") {
    const subnets = value.split(",").map((item) => item.trim());
    if (
      subnets.length < 2 ||
      subnets.length > 6 ||
      new Set(subnets).size !== subnets.length ||
      subnets.some((subnet) => !/^subnet-[a-f0-9]{8,17}$/.test(subnet))
    ) {
      throw new Error("CloudFormation SubnetIds must contain two to six unique subnet ids.");
    }
    return;
  }
  if (name === "TaskSecurityGroupId") {
    if (!/^sg-[a-f0-9]{8,17}$/.test(value)) {
      throw new Error("CloudFormation TaskSecurityGroupId is invalid.");
    }
    return;
  }
  if (listenerParameters.has(name)) {
    assertArn({
      name,
      value,
      service: "elasticloadbalancing",
      region: environment.region,
      accountId: environment.expectedAccountId,
      resourcePattern: /listener\/app\/techlong-sandbox-[A-Za-z0-9-]*\/[a-f0-9]+\/[a-f0-9]+/,
    });
    return;
  }
  if (exactRoleNames[name]) {
    const expected = `arn:aws:iam::${environment.expectedAccountId}:role/${exactRoleNames[name]}`;
    if (value !== expected) {
      throw new Error(`CloudFormation parameter ${name} must reference the exact Bootstrap role.`);
    }
    return;
  }
  if (name === "JanitorFunctionArn") {
    assertArn({
      name,
      value,
      service: "lambda",
      region: environment.region,
      accountId: environment.expectedAccountId,
      resourcePattern: /function:techlong-sandbox-janitor/,
    });
    return;
  }
  if (secretReferenceParameters.has(name)) {
    assertArn({
      name,
      value,
      service: "secretsmanager",
      region: environment.region,
      accountId: environment.expectedAccountId,
      resourcePattern: /secret:techlong\/sandbox\/[A-Za-z0-9/_+=.@-]+/,
    });
    return;
  }
  if (name === "ControlIssuer") {
    parseHttpsUrl(name, value);
    return;
  }
  if (name === "CorsAllowedOrigins") {
    const origins = value.split(",").map((item) => item.trim());
    if (origins.length < 1 || origins.length > 5) {
      throw new Error("CloudFormation CorsAllowedOrigins is invalid.");
    }
    origins.forEach((origin) => {
      const parsed = parseHttpsUrl(name, origin);
      if (parsed.pathname !== "/" || parsed.search) {
        throw new Error("CloudFormation CORS origins cannot include paths or query strings.");
      }
    });
    return;
  }
  if (name === "StripePublishableKey") {
    if (!/^pk_test_[A-Za-z0-9]{16,}$/.test(value)) {
      throw new Error("AWS Sandbox only accepts a Stripe test publishable key.");
    }
    return;
  }
  if (name === "StripeSuccessUrl" || name === "StripeCancelUrl" || name === "ImagePublicBaseUrl") {
    parseHttpsUrl(name, value);
    return;
  }
  if (name === "ImageS3Bucket") {
    if (!/^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value)) {
      throw new Error("CloudFormation ImageS3Bucket is invalid.");
    }
    return;
  }
  throw new Error(`CloudFormation parameter ${name} has no validator.`);
}

export function finalizeTenantStackForApply(input: {
  rendered: CloudFormationTenantStackPlan;
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding;
  /** Exact physical Secret name derived from the durable resource generation. */
  expectedRuntimeSecretName: string;
}): ApplyReadyTenantStack {
  if (!input.rendered.safety.renderOnly || input.rendered.safety.applyReady) {
    throw new Error("Only a reviewed render-only tenant stack can be finalized.");
  }
  if (
    input.rendered.accountId !== input.environment.expectedAccountId ||
    input.rendered.region !== input.environment.region
  ) {
    throw new Error("Rendered tenant stack account or region drifted from the environment.");
  }
  for (const name of forbiddenEnvironmentTenantSecretParameters) {
    if (
      input.rendered.requiredExternalParameters.includes(name) ||
      Object.hasOwn(input.binding.tenantStackParameters, name)
    ) {
      throw new Error(
        `Tenant credential parameter ${name} cannot come from the environment binding.`,
      );
    }
  }
  assertAwsSandboxTenantRuntimeSecretRef({
    runtimeSecretRef: input.rendered.parameters.TenantRuntimeSecretArn ?? "",
    accountId: input.environment.expectedAccountId,
    region: input.environment.region,
    expectedSecretName: input.expectedRuntimeSecretName,
  });
  const expected = new Set(input.rendered.requiredExternalParameters);
  const actual = new Set(Object.keys(input.binding.tenantStackParameters));
  const missing = [...expected].filter((name) => !actual.has(name));
  const extras = [...actual].filter((name) => !expected.has(name));
  if (missing.length || extras.length) {
    throw new Error(
      `CloudFormation external parameter set is not exact; missing=${missing.join(",") || "none"}; extra=${extras.join(",") || "none"}.`,
    );
  }
  for (const name of input.rendered.requiredExternalParameters) {
    validateExternalParameter({
      name,
      value: input.binding.tenantStackParameters[name],
      environment: input.environment,
    });
  }
  if (
    input.binding.tenantStackParameters.HttpsListenerArn ===
    input.binding.tenantStackParameters.ControlListenerArn
  ) {
    throw new Error("Business and mTLS control listeners must be different.");
  }
  if (input.binding.cloudFormationRoleArn === input.binding.workerRoleArn) {
    throw new Error("Worker and CloudFormation service roles must be separated.");
  }
  const expectedWorkerRole =
    `arn:aws:iam::${input.environment.expectedAccountId}:role/TechlongSandboxProvisionerRole`;
  const expectedCloudFormationRole =
    `arn:aws:iam::${input.environment.expectedAccountId}:role/TechlongSandboxCloudFormationExecutionRole`;
  if (input.binding.workerRoleArn !== expectedWorkerRole) {
    throw new Error("Execution binding must use the exact Sandbox provisioner role.");
  }
  if (input.binding.cloudFormationRoleArn !== expectedCloudFormationRole) {
    throw new Error("Execution binding must use the exact Sandbox CloudFormation role.");
  }
  const parameters = {
    ...input.binding.tenantStackParameters,
    ...input.rendered.parameters,
  };
  return {
    ...input.rendered,
    parameters,
    cloudFormationRoleArn: input.binding.cloudFormationRoleArn,
    safety: {
      ...input.rendered.safety,
      renderOnly: false,
      applyReady: true,
    },
  };
}
