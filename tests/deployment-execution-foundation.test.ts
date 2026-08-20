import assert from "node:assert/strict";
import test from "node:test";
import { renderAwsSandboxTenantStack } from "../lib/deployments/cloudformation/tenant-stack.ts";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";
import {
  evaluateAwsSandboxPreflight,
} from "../lib/deployments/preflight.ts";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import {
  assertDeploymentTransition,
  canTransitionDeployment,
} from "../lib/deployments/state-machine.ts";
import { buildDeploymentClaimStatement } from "../lib/deployments/lease.ts";
import {
  beginDeploymentStepStatement,
  finishDeploymentStepStatement,
} from "../lib/deployments/step-lease.ts";
import {
  assertSafeDeploymentOutput,
  redactDeploymentError,
} from "../lib/deployments/safety.ts";

const sandbox: DeploymentEnvironment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: "402010193138",
  region: "ca-central-1",
  cellKey: "cell-sandbox-1",
  baseDomain: "sandbox.techlong.cloud",
  applyEnabled: false,
  status: "active",
  policy: {
    budgetLimitCents: 1_000,
    ttlSeconds: 7_200,
    maxCells: 1,
    maxTenants: 1,
    maxTaskCount: 1,
    allowedProfiles: ["standard-v1"],
    allowNatGateway: false,
    allowInterfaceEndpoints: false,
    databaseEngine: "aurora-postgresql-serverless-v2",
    auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: "16.14",
    auroraEngineMode: "provisioned",
    allowLimitlessDatabase: false,
    databaseMode: "tenant_database",
    auroraServerlessMinAcu: 0,
    auroraServerlessMaxAcu: 1,
    auroraSecondsUntilAutoPause: 300,
    allowDedicatedDatabase: false,
    allowMultiAzDatabase: false,
    allowRdsProxy: false,
    allowGlobalDatabase: false,
    logRetentionDays: 1,
  },
};

function tenantRuntimeSecretRef(tenantToken: string, generation = 1): string {
  return (
    `arn:aws:secretsmanager:${sandbox.region}:${sandbox.expectedAccountId}:secret:` +
    `techlong/sandbox/tenant/${tenantToken}/runtime/g${generation}-abcdef`
  );
}

function tenantRuntimeSecretName(tenantToken: string, generation = 1): string {
  return `techlong/sandbox/tenant/${tenantToken}/runtime/g${generation}`;
}

function externalOperation(
  deploymentId = "dep_tenant_one",
  generation = 1,
  epoch = 1,
) {
  return {
    epoch,
    intent: "provision" as const,
    ownerDeploymentId: deploymentId,
    operationHash: "9".repeat(64),
    marker: `tl_epoch_${"8".repeat(24)}_g${generation}_e${epoch}`,
    state: "active" as const,
  };
}

test("models the deployment checkpoints and rejects unsafe jumps", () => {
  assert.equal(canTransitionDeployment("preflight", "database_preparing"), true);
  assert.equal(canTransitionDeployment("database_preparing", "migrating"), true);
  assert.equal(
    canTransitionDeployment("migrating", "infrastructure_provisioning"),
    true,
  );
  assert.throws(
    () => assertDeploymentTransition("planned", "ready"),
    /cannot transition/,
  );
});

test("hard-disables AWS apply and applies capacity rules to create versus reuse", () => {
  const apply = evaluateAwsSandboxPreflight({
    environment: sandbox,
    operation: "apply",
    deploymentProfileKey: "standard-v1",
    observedAccountId: "402010193138",
    observedRegion: "ca-central-1",
    activeCellCount: 1,
    activeTenantCount: 0,
    cellOperation: "reuse",
  });
  assert.equal(apply.ok, false);
  assert.equal(
    apply.checks.find((item) => item.key === "aws_apply_hard_disabled")?.passed,
    false,
  );

  const secondCell = evaluateAwsSandboxPreflight({
    environment: sandbox,
    operation: "render",
    deploymentProfileKey: "standard-v1",
    activeCellCount: 1,
    activeTenantCount: 0,
    cellOperation: "create",
  });
  assert.equal(secondCell.ok, false);
  assert.equal(
    secondCell.checks.find((item) => item.key === "cell_capacity")?.passed,
    false,
  );

  const driftedPolicy: DeploymentEnvironment = {
    ...sandbox,
    policy: { ...sandbox.policy, ttlSeconds: 3_600 },
  };
  const drift = evaluateAwsSandboxPreflight({
    environment: driftedPolicy,
    operation: "render",
    deploymentProfileKey: "standard-v1",
    activeCellCount: 1,
    activeTenantCount: 0,
    cellOperation: "reuse",
  });
  assert.equal(drift.ok, false);
  assert.match(
    drift.checks.find((item) => item.key === "environment_configuration")?.message ?? "",
    /sandbox_ttl_invalid/,
  );
});

test("builds lease bindings in placeholder order and supports expired-job takeover", () => {
  const withoutType = buildDeploymentClaimStatement({
    workerId: "worker-one",
    now: 1_000,
    leaseDurationMs: 5_000,
    leaseToken: "lease_00000000000000000000000000000001",
  });
  assert.deepEqual(withoutType.bindings, [
    "worker-one",
    5_000,
    "lease_00000000000000000000000000000001",
  ]);
  assert.match(withoutType.sql, /clock_timestamp\(\)/);
  assert.match(withoutType.sql, /SET status = 'dead_letter'/);
  assert.match(withoutType.sql, /attempts >= max_attempts/);
  assert.match(
    withoutType.sql,
    /status = 'running' AND lease_expires_at <= db_clock\.now_ms/,
  );
  assert.match(
    withoutType.sql,
    /candidate_job\.attempts < candidate_job\.max_attempts/,
  );
  assert.match(withoutType.sql, /NOT EXISTS/);
  assert.match(withoutType.sql, /sibling\.status = 'running'/);
  assert.doesNotMatch(
    withoutType.sql,
    /sibling\.lease_expires_at > db_clock\.now_ms/,
  );
  assert.match(
    withoutType.sql,
    /FOR UPDATE OF candidate_job, candidate_deployment SKIP LOCKED/,
  );

  const withType = buildDeploymentClaimStatement({
    workerId: "worker-one",
    now: 1_000,
    leaseDurationMs: 5_000,
    leaseToken: "lease_00000000000000000000000000000002",
    jobType: "rollback",
  });
  assert.deepEqual(withType.bindings, [
    "rollback",
    "rollback",
    "rollback",
    "rollback",
    "worker-one",
    5_000,
    "lease_00000000000000000000000000000002",
  ]);
  assert.match(withType.sql, /released_disallowed AS/);
  assert.match(withType.sql, /deployment_jobs\.job_type <> \?/);
  assert.match(withType.sql, /allowed_sibling\.job_type = \?/);
  assert.match(withType.sql, /candidate_job\.job_type = \?/);
});

test("step checkpoints require the current unexpired worker lease", () => {
  assert.match(beginDeploymentStepStatement, /clock_timestamp\(\)/);
  assert.match(beginDeploymentStepStatement, /lease_owner = \?/);
  assert.match(beginDeploymentStepStatement, /lease_token = \?/);
  assert.match(beginDeploymentStepStatement, /lease_expires_at > db_clock\.now_ms/);
  assert.match(beginDeploymentStepStatement, /attempts = \?/);
  assert.match(beginDeploymentStepStatement, /FOR UPDATE OF job/);
  assert.match(beginDeploymentStepStatement, /FROM owned_job/);
  assert.match(
    beginDeploymentStepStatement,
    /ON CONFLICT \(job_id, step_key, input_hash, attempt\) DO NOTHING/,
  );
  assert.doesNotMatch(
    beginDeploymentStepStatement,
    /ON CONFLICT \(deployment_id, step_key, input_hash, attempt\)/,
  );
  assert.match(finishDeploymentStepStatement, /job\.lease_owner = \?/);
  assert.match(finishDeploymentStepStatement, /job\.lease_token = \?/);
  assert.match(
    finishDeploymentStepStatement,
    /job\.lease_expires_at > db_clock\.now_ms/,
  );
  assert.match(finishDeploymentStepStatement, /FOR UPDATE OF job/);
});

test("rejects secrets and redacts credentials before persistence", () => {
  assert.doesNotThrow(() =>
    assertSafeDeploymentOutput({ secretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:tenant" }),
  );
  assert.throws(
    () => assertSafeDeploymentOutput({ private_key: "never persist this" }),
    /sensitive/,
  );
  assert.throws(
    () => assertSafeDeploymentOutput({ clientSecret: "never persist this" }),
    /sensitive/,
  );
  assert.throws(
    () => assertSafeDeploymentOutput({ token: "never persist this" }),
    /sensitive/,
  );
  assert.throws(
    () => assertSafeDeploymentOutput({ aws_secret_access_key: "never persist this" }),
    /sensitive/,
  );
  assert.throws(
    () => assertSafeDeploymentOutput({ value: `AKIA${"A".repeat(16)}` }),
    /secret/,
  );
  assert.doesNotMatch(
    redactDeploymentError("postgresql://owner:password@db.example/app"),
    /owner|password/,
  );
});

test("renders a secret-free fixed-size tenant stack with separate mTLS control routing", () => {
  const plan = new AwsEcsCellPlanOnlyDriver({
    region: sandbox.region,
    cellKey: sandbox.cellKey,
    mode: "aws_sandbox",
  }).buildPlan({
    appInstanceId: "app_tenant_one",
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    planId: "plan_basic",
    subscriptionId: "sub_one",
    tenantKey: "tenant_one",
    deploymentProfileKey: "standard-v1",
  });
  const rendered = renderAwsSandboxTenantStack({
    deploymentId: "dep_tenant_one",
    resourceGeneration: 1,
    externalOperation: externalOperation(),
    runtimeSecretRef: tenantRuntimeSecretRef("tenant_one_123"),
    runtimeSecretName: tenantRuntimeSecretName("tenant_one_123"),
    plan,
    environment: sandbox,
    imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
    tenantHostname: "tenant-one.sandbox.techlong.cloud",
    listenerPriority: 100,
    activeCellCount: 1,
    activeTenantCount: 0,
    requestedAt: Date.UTC(2026, 7, 9),
  });
  const serialized = rendered.templateBody;
  assert.equal(rendered.safety.callsAws, false);
  assert.equal(rendered.safety.createsDatabaseResources, false);
  assert.equal(rendered.safety.controlListenerMtlsRequired, true);
  assert.equal(rendered.safety.fixedTaskCount, 1);
  assert.match(serialized, /ControlListenerArn/);
  assert.match(serialized, /SAAS_REQUIRE_MTLS/);
  assert.match(serialized, /SAAS_TRUST_PROXY_MTLS_HEADER/);
  assert.match(serialized, /aws_alb_verify/);
  assert.match(serialized, /speedfeast-instance:/);
  for (const name of [
    "NODE_ENV",
    "HOST",
    "CORS_ALLOWED_ORIGINS",
    "HMAC_SECRET_KEY",
    "JWT_SECRET_KEY",
    "JWT_EXPIRES_IN",
    "MERCHANT_JWT_EXPIRES_IN",
    "PAYMENT_PROVIDER",
    "SMS_PROVIDER",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_SUCCESS_URL",
    "STRIPE_CANCEL_URL",
    "IMAGE_STORAGE_PROVIDER",
    "IMAGE_S3_BUCKET",
    "IMAGE_PUBLIC_BASE_URL",
    "AWS_REGION",
    "PGSSLMODE",
    "PGSSL_REJECT_UNAUTHORIZED",
    "PGSSLROOTCERT",
  ]) {
    assert.match(serialized, new RegExp(name));
  }
  assert.match(serialized, /\/api\/saas/);
  assert.match(serialized, /DistinctBusinessAndControlListeners/);
  assert.match(serialized, /DeploymentCircuitBreaker/);
  assert.match(
    serialized,
    /\/usr\/local\/share\/ca-certificates\/aws-rds-global-bundle\.pem/,
  );
  const resourceTypes = Object.values(
    rendered.template.Resources as Record<string, { Type: string }>,
  ).map((resource) => resource.Type);
  assert.equal(resourceTypes.some((type) => type.startsWith("AWS::RDS::")), false);
  assert.equal(resourceTypes.includes("AWS::EC2::VPC"), false);
  assert.equal(resourceTypes.includes("AWS::EC2::NatGateway"), false);
  assert.equal(rendered.tags.ManagedBy, "techlong-provisioner");
  assert.equal(rendered.tags.DeploymentId, "dep_tenant_one");
  assert.equal(rendered.tags.ExternalOperationEpoch, "1");
  assert.equal(rendered.tags.ExternalOperationIntent, "provision");
  assert.equal(
    rendered.tags.ExternalOperationMarker,
    externalOperation().marker,
  );
  assert.equal(rendered.tags.ExternalOperationHash, "9".repeat(64));
  assert.match(rendered.clientRequestToken, /-e1-9999999999999999$/);
  assert.equal(rendered.tags.ExpiresAt, "2026-08-09T02:00:00.000Z");
  assert.ok(rendered.requiredExternalParameters.includes("ControlListenerArn"));
  assert.equal(rendered.requiredExternalParameters.includes("DatabaseUrlValueFrom"), false);
  assert.equal(rendered.requiredExternalParameters.includes("HmacSecretKeyValueFrom"), false);
  assert.equal(rendered.requiredExternalParameters.includes("JwtSecretKeyValueFrom"), false);
  assert.equal(rendered.requiredExternalParameters.includes("StripeSecretKeyValueFrom"), false);
  assert.equal(
    rendered.parameters.TenantRuntimeSecretArn,
    tenantRuntimeSecretRef("tenant_one_123"),
  );
  assert.equal(rendered.requiredExternalParameters.includes("PgSslRootCertValueFrom"), false);

  const taskDefinition = (
    rendered.template.Resources as Record<
      string,
      { Properties?: { ContainerDefinitions?: Array<Record<string, unknown>> } }
    >
  ).TenantTaskDefinition;
  const container = taskDefinition.Properties?.ContainerDefinitions?.[0] as {
    Secrets: Array<{
      Name: string;
      ValueFrom: { "Fn::Sub": string } | { Ref: string };
    }>;
    HealthCheck: { Command: string[] };
  };
  assert.deepEqual(container.HealthCheck.Command.slice(0, 3), [
    "CMD",
    "/usr/local/bin/node",
    "-e",
  ]);
  assert.equal(container.HealthCheck.Command.includes("CMD-SHELL"), false);
  const runtimeSecretNames = new Set([
    "DATABASE_URL",
    "HMAC_SECRET_KEY",
    "JWT_SECRET_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      container.Secrets
        .filter((secret) => runtimeSecretNames.has(secret.Name))
        .map((secret) => [
          secret.Name,
          "Fn::Sub" in secret.ValueFrom
            ? secret.ValueFrom["Fn::Sub"]
            : null,
        ]),
    ),
    {
      DATABASE_URL: "${TenantRuntimeSecretArn}:database_url::",
      HMAC_SECRET_KEY: "${TenantRuntimeSecretArn}:hmac_secret_key::",
      JWT_SECRET_KEY: "${TenantRuntimeSecretArn}:jwt_secret_key::",
      STRIPE_SECRET_KEY: "${TenantRuntimeSecretArn}:stripe_secret_key::",
      STRIPE_WEBHOOK_SECRET:
        "${TenantRuntimeSecretArn}:stripe_webhook_secret::",
    },
  );
  assert.deepEqual(
    container.Secrets.find((secret) => secret.Name === "SAAS_CONTROL_PUBLIC_KEY")
      ?.ValueFrom,
    { Ref: "ControlPublicKeyValueFrom" },
  );
  assert.equal(
    (
      rendered.template.Resources as Record<
        string,
        { Properties?: { PlatformVersion?: string } }
      >
    ).TenantService.Properties?.PlatformVersion,
    "1.4.0",
  );

  assert.throws(
    () =>
      renderAwsSandboxTenantStack({
        deploymentId: "dep_tenant_one",
        resourceGeneration: 1,
        externalOperation: externalOperation(),
        runtimeSecretRef: tenantRuntimeSecretRef("tenant_one_123"),
        runtimeSecretName: tenantRuntimeSecretName("tenant_one_123"),
        plan,
        environment: sandbox,
        imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
        tenantHostname: "tenant-one.example.com",
        listenerPriority: 100,
        activeCellCount: 1,
        activeTenantCount: 0,
        requestedAt: Date.UTC(2026, 7, 9),
      }),
    /base domain|preflight/i,
  );
  assert.throws(
    () =>
      renderAwsSandboxTenantStack({
        deploymentId: "dep_tenant_one",
        resourceGeneration: 1,
        externalOperation: {
          ...externalOperation(),
          marker: `tl_epoch_${"8".repeat(24)}_g1_e2`,
        },
        runtimeSecretRef: tenantRuntimeSecretRef("tenant_one_123"),
        runtimeSecretName: tenantRuntimeSecretName("tenant_one_123"),
        plan,
        environment: sandbox,
        imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
        tenantHostname: "tenant-one.sandbox.techlong.cloud",
        listenerPriority: 100,
        activeCellCount: 1,
        activeTenantCount: 0,
        requestedAt: Date.UTC(2026, 7, 9),
      }),
    /active provision external-operation epoch/,
  );
});

test("binds each tenant stack to one exact account-and-region runtime Secret", () => {
  const plan = new AwsEcsCellPlanOnlyDriver({
    region: sandbox.region,
    cellKey: sandbox.cellKey,
    mode: "aws_sandbox",
  }).buildPlan({
    appInstanceId: "app_tenant_one",
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    planId: "plan_basic",
    subscriptionId: "sub_one",
    tenantKey: "tenant_one",
    deploymentProfileKey: "standard-v1",
  });
  const render = (
    runtimeSecretRef: string,
    runtimeSecretName = tenantRuntimeSecretName("tenant_one_123"),
  ) =>
    renderAwsSandboxTenantStack({
      deploymentId: "dep_tenant_one",
      resourceGeneration: 1,
      externalOperation: externalOperation(),
      runtimeSecretRef,
      runtimeSecretName,
      plan,
      environment: sandbox,
      imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
      tenantHostname: "tenant-one.sandbox.techlong.cloud",
      listenerPriority: 100,
      activeCellCount: 1,
      activeTenantCount: 0,
      requestedAt: Date.UTC(2026, 7, 9),
    });
  const tenantOne = tenantRuntimeSecretRef("tenant_one_123");
  const tenantTwo = tenantRuntimeSecretRef("tenant_two_456");
  assert.notEqual(
    render(tenantOne).parameters.TenantRuntimeSecretArn,
    render(tenantTwo, tenantRuntimeSecretName("tenant_two_456")).parameters
      .TenantRuntimeSecretArn,
  );
  for (const rejected of [
    tenantOne.replace(":402010193138:", ":999999999999:"),
    tenantOne.replace(":ca-central-1:", ":us-east-1:"),
    `${tenantOne}:database_url::`,
    "postgresql://owner:password@example.invalid/database",
  ]) {
    assert.throws(() => render(rejected), /runtime Secret.*account and region/i);
  }
  assert.throws(
    () => render(tenantTwo),
    /runtime Secret.*account and region/i,
  );
  assert.throws(
    () =>
      renderAwsSandboxTenantStack({
        deploymentId: "dep_tenant_one",
        resourceGeneration: 2,
        externalOperation: externalOperation("dep_tenant_one", 2),
        runtimeSecretRef: tenantRuntimeSecretRef("tenant_one_123", 1),
        runtimeSecretName: tenantRuntimeSecretName("tenant_one_123", 1),
        plan,
        environment: sandbox,
        imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
        tenantHostname: "tenant-one.sandbox.techlong.cloud",
        listenerPriority: 100,
        activeCellCount: 1,
        activeTenantCount: 0,
        requestedAt: Date.UTC(2026, 7, 9),
      }),
    /current resource generation/i,
  );
  assert.throws(
    () =>
      renderAwsSandboxTenantStack({
        deploymentId: "dep_tenant_one",
        resourceGeneration: 1,
        externalOperation: externalOperation(),
        runtimeSecretRef: tenantOne,
        runtimeSecretName: tenantRuntimeSecretName("tenant_one_123"),
        plan,
        environment: sandbox,
        imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
        tenantHostname: "nested.tenant-one.sandbox.techlong.cloud",
        listenerPriority: 100,
        activeCellCount: 1,
        activeTenantCount: 0,
        requestedAt: Date.UTC(2026, 7, 9),
      }),
    /exactly one tenant label/i,
  );
});
