import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { renderAwsSandboxSharedCellStack } from "../../../lib/deployments/cloudformation/shared-cell-stack.ts";
import { approvedSharedCellResourceTypes } from "./render-b5-cell-lifecycle-management.mjs";
import { canonicalJson } from "./verify-change-set-template.mjs";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const executionRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
const templateBucket =
  "techlong-sandbox-build-source-402010193138-ca-central-1";
const templatePrefix = "b5-shared-cell/templates/sha256";
const currentJanitorMode = "PLAN_ONLY";
const currentJanitorAcceptedAction = "inspect_cell_cleanup_plan";
const scheduledCleanupAction = "delete_shared_cell_stack";
const canonicalTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const expectedTagKeys = Object.freeze([
  "Environment",
  "ManagedBy",
  "CellId",
  "ExpiresAt",
]);

const sandboxEnvironment = Object.freeze({
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: accountId,
  region,
  cellKey: cellId,
  baseDomain: "sandbox.techlong.cloud",
  applyEnabled: false,
  status: "active",
  policy: Object.freeze({
    budgetLimitCents: 1_000,
    ttlSeconds: 7_200,
    maxCells: 1,
    maxTenants: 1,
    maxTaskCount: 1,
    allowedProfiles: Object.freeze(["standard-v1"]),
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
  }),
});

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson([...expectedKeys].sort())
  );
}

function parseRequestedAt(value) {
  if (typeof value !== "string" || !canonicalTimestampPattern.test(value)) {
    throw new Error(
      "requestedAt must be an exact canonical UTC timestamp with milliseconds.",
    );
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new Error("requestedAt must identify a real canonical UTC instant.");
  }
  return milliseconds;
}

function assertCompilerInput(input) {
  const keys = [
    "allowPlanOnlyAuthoring",
    "availabilityZones",
    "cellJanitorFunctionArn",
    "cellSchedulerGroupName",
    "cellSchedulerInvokeRoleArn",
    "certificateArn",
    "controlTrustStoreArn",
    "requestedAt",
  ];
  if (!exactKeys(input, keys)) {
    throw new Error("Shared Cell author candidate input keys are not exact.");
  }
  if (
    !Array.isArray(input.availabilityZones) ||
    input.availabilityZones.length !== 2 ||
    input.availabilityZones.some((value) => typeof value !== "string")
  ) {
    throw new Error("Exactly two Shared Cell availability zones are required.");
  }
  if (typeof input.allowPlanOnlyAuthoring !== "boolean") {
    throw new Error("allowPlanOnlyAuthoring must be an exact boolean.");
  }
}

function assertArrayEquals(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} drifted from its reviewed contract.`);
  }
}

function assertRenderedPlan(plan, requestedAt, input) {
  if (
    plan.schemaVersion !== 1 ||
    plan.accountId !== accountId ||
    plan.region !== region ||
    plan.stackName !== stackName ||
    plan.safety.renderOnly !== true ||
    plan.safety.applyReady !== false ||
    plan.safety.callsAws !== false ||
    plan.safety.createsChargeableResources !== true ||
    plan.safety.cellTtlSeconds !== 10_800 ||
    plan.safety.cleanupBufferSeconds !== 900
  ) {
    throw new Error("Shared Cell render safety contract drifted.");
  }

  const resources = plan.template?.Resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    throw new Error("Shared Cell template Resources are missing.");
  }
  const resourceTypes = [
    ...new Set(
      Object.values(resources).map((resource) => {
        if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
          throw new Error("Shared Cell template contains an invalid resource.");
        }
        return resource.Type;
      }),
    ),
  ];
  if (
    approvedSharedCellResourceTypes.length !== 18 ||
    resourceTypes.length !== 18
  ) {
    throw new Error("Shared Cell author allowlist must contain exactly 18 resource types.");
  }
  assertArrayEquals(
    resourceTypes,
    approvedSharedCellResourceTypes,
    "Shared Cell resource-type allowlist",
  );
  const resourceValues = Object.values(resources);
  if (
    resourceValues.filter(
      (resource) => resource.Type === "AWS::RDS::DBCluster",
    ).length !== 1 ||
    resourceValues.filter(
      (resource) => resource.Type === "AWS::RDS::DBInstance",
    ).length !== 1 ||
    resourceValues.filter(
      (resource) =>
        resource.Type === "AWS::ElasticLoadBalancingV2::LoadBalancer",
    ).length !== 1 ||
    resourceValues.some(
      (resource) =>
        resource.Type === "AWS::EC2::NatGateway" ||
        resource.Type === "AWS::EC2::VPCEndpoint",
    )
  ) {
    throw new Error("Shared Cell chargeable-resource boundary drifted.");
  }

  const expiresAt = new Date(requestedAt + 10_800_000).toISOString();
  const cleanupAt = expiresAt.replace(/\.\d{3}Z$/, "");
  const expectedTags = {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-cell-operator",
    CellId: cellId,
    ExpiresAt: expiresAt,
  };
  if (!exactKeys(plan.tags, expectedTagKeys)) {
    throw new Error("Shared Cell stack must have exactly four reviewed tags.");
  }
  if (canonicalJson(plan.tags) !== canonicalJson(expectedTags)) {
    throw new Error("Shared Cell stack tag values drifted.");
  }
  if (plan.parameters.CleanupAt !== cleanupAt) {
    throw new Error("Shared Cell CleanupAt does not match its three-hour TTL.");
  }
  if (plan.template?.Outputs?.CellExpiresAt?.Value !== expiresAt) {
    throw new Error(
      "Shared Cell CellExpiresAt output does not match its tag and CleanupAt TTL.",
    );
  }
  const expectedParameters = {
    AvailabilityZoneA: input.availabilityZones[0],
    AvailabilityZoneB: input.availabilityZones[1],
    CertificateArn: input.certificateArn,
    ControlTrustStoreArn: input.controlTrustStoreArn,
    CellJanitorFunctionArn: input.cellJanitorFunctionArn,
    CellSchedulerInvokeRoleArn: input.cellSchedulerInvokeRoleArn,
    CellSchedulerGroupName: input.cellSchedulerGroupName,
    CleanupAt: cleanupAt,
  };
  if (
    !exactKeys(plan.parameters, Object.keys(expectedParameters)) ||
    canonicalJson(plan.parameters) !== canonicalJson(expectedParameters)
  ) {
    throw new Error("Shared Cell template parameter values drifted.");
  }

  const schedule = resources.CellCleanupSchedule;
  const scheduleProperties = schedule?.Properties;
  if (
    Object.keys(resources)[0] !== "CellCleanupSchedule" ||
    schedule?.Type !== "AWS::Scheduler::Schedule" ||
    scheduleProperties?.Name !== "techlong-sandbox-cell-sandbox-1-ttl" ||
    canonicalJson(scheduleProperties?.GroupName) !==
      canonicalJson({ Ref: "CellSchedulerGroupName" }) ||
    scheduleProperties?.ActionAfterCompletion !== "DELETE" ||
    scheduleProperties?.FlexibleTimeWindow?.Mode !== "OFF" ||
    scheduleProperties?.State !== "ENABLED" ||
    scheduleProperties?.ScheduleExpression?.["Fn::Sub"] !== "at(${CleanupAt})" ||
    scheduleProperties?.ScheduleExpressionTimezone !== "UTC" ||
    canonicalJson(scheduleProperties?.Target?.Arn) !==
      canonicalJson({ Ref: "CellJanitorFunctionArn" }) ||
    canonicalJson(scheduleProperties?.Target?.RoleArn) !==
      canonicalJson({ Ref: "CellSchedulerInvokeRoleArn" }) ||
    scheduleProperties?.Target?.RetryPolicy?.MaximumEventAgeInSeconds !== 3_600 ||
    scheduleProperties?.Target?.RetryPolicy?.MaximumRetryAttempts !== 10
  ) {
    throw new Error("Shared Cell cleanup schedule contract drifted.");
  }
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (logicalId === "CellCleanupSchedule") continue;
    const dependencies = Array.isArray(resource.DependsOn)
      ? resource.DependsOn
      : [resource.DependsOn].filter(Boolean);
    if (!dependencies.includes("CellCleanupSchedule")) {
      throw new Error(
        `${logicalId} must depend directly on the Shared Cell cleanup schedule.`,
      );
    }
  }
  let cleanupEvent;
  try {
    cleanupEvent = JSON.parse(scheduleProperties.Target.Input);
  } catch {
    throw new Error("Shared Cell cleanup schedule event is not valid JSON.");
  }
  const expectedEvent = {
    schemaVersion: 1,
    action: scheduledCleanupAction,
    stackName,
    cellId,
  };
  if (canonicalJson(cleanupEvent) !== canonicalJson(expectedEvent)) {
    throw new Error("Shared Cell cleanup schedule event drifted.");
  }
  return { cleanupAt, cleanupEvent, expiresAt, resourceTypes, scheduleProperties };
}

function parameterEntries(parameters) {
  return [
    "AvailabilityZoneA",
    "AvailabilityZoneB",
    "CertificateArn",
    "ControlTrustStoreArn",
    "CellJanitorFunctionArn",
    "CellSchedulerInvokeRoleArn",
    "CellSchedulerGroupName",
    "CleanupAt",
  ].map((ParameterKey) => ({
    ParameterKey,
    ParameterValue: parameters[ParameterKey],
  }));
}

function tagEntries(tags) {
  return expectedTagKeys.map((Key) => ({ Key, Value: tags[Key] }));
}

export function compileB5SharedCellAuthorCandidate(input) {
  assertCompilerInput(input);
  const requestedAt = parseRequestedAt(input.requestedAt);
  const plan = renderAwsSandboxSharedCellStack({
    environment: sandboxEnvironment,
    requestedAt,
    availabilityZones: input.availabilityZones,
    certificateArn: input.certificateArn,
    controlTrustStoreArn: input.controlTrustStoreArn,
    cellJanitorFunctionArn: input.cellJanitorFunctionArn,
    cellSchedulerInvokeRoleArn: input.cellSchedulerInvokeRoleArn,
    cellSchedulerGroupName: input.cellSchedulerGroupName,
  });
  const rendered = assertRenderedPlan(plan, requestedAt, input);
  const acceptedPlanEvent = {
    schemaVersion: 1,
    action: currentJanitorAcceptedAction,
  };
  const janitorCompatible =
    currentJanitorMode !== "PLAN_ONLY" ||
    canonicalJson(rendered.cleanupEvent) === canonicalJson(acceptedPlanEvent);
  if (janitorCompatible) {
    throw new Error(
      "Expected the deployed PLAN_ONLY Janitor incompatibility, but the cleanup event contract changed.",
    );
  }
  if (!input.allowPlanOnlyAuthoring) {
    throw new Error(
      "Shared Cell author candidate rejected: delete_shared_cell_stack is incompatible with the deployed PLAN_ONLY Janitor; pass --allow-plan-only-authoring only to compile a non-executable local candidate.",
    );
  }

  if (plan.templateBody !== JSON.stringify(plan.template)) {
    throw new Error("Shared Cell raw template body is not the exact rendered template.");
  }
  const rawSha256 = sha256(plan.templateBody);
  const canonicalSha256 = sha256(canonicalJson(plan.template));
  const changeSetName = `${stackName}-${rawSha256.slice(0, 16)}`;
  const templateKey = `${templatePrefix}/${rawSha256}.json`;
  const templateUrl =
    `https://${templateBucket}.s3.${region}.amazonaws.com/${templateKey}`;
  const templateArn = `arn:aws:s3:::${templateBucket}/${templateKey}`;

  const manifest = {
    schemaVersion: 1,
    candidateKind: "b5-shared-cell-author",
    identity: { accountId, region, cellId, stackName },
    requestedAt: input.requestedAt,
    cellExpiresAt: rendered.expiresAt,
    cleanupAt: rendered.cleanupAt,
    immutableTemplate: {
      bucket: templateBucket,
      key: templateKey,
      arn: templateArn,
      url: templateUrl,
      contentType: "application/json",
      byteLength: Buffer.byteLength(plan.templateBody, "utf8"),
      rawSha256,
      canonicalSha256,
    },
    changeSet: {
      name: changeSetName,
      type: "CREATE",
      description:
        `B5 Shared Cell author candidate; raw=${rawSha256}; canonical=${canonicalSha256}`,
      roleArn: executionRoleArn,
      capabilities: [],
      includeNestedStacks: false,
      resourceTypes: rendered.resourceTypes,
      parameters: parameterEntries(plan.parameters),
      tags: tagEntries(plan.tags),
    },
    cleanupSchedule: {
      logicalId: "CellCleanupSchedule",
      name: rendered.scheduleProperties.Name,
      groupName: input.cellSchedulerGroupName,
      state: rendered.scheduleProperties.State,
      expression: `at(${rendered.cleanupAt})`,
      timezone: rendered.scheduleProperties.ScheduleExpressionTimezone,
      targetFunctionArn: input.cellJanitorFunctionArn,
      targetRoleArn: input.cellSchedulerInvokeRoleArn,
      event: rendered.cleanupEvent,
    },
    compatibility: {
      compatible: false,
      currentJanitorMode,
      currentJanitorAcceptedEvent: acceptedPlanEvent,
      scheduledCleanupEvent: rendered.cleanupEvent,
      blockers: [
        {
          code: "PLAN_ONLY_JANITOR_EVENT_INCOMPATIBLE",
          message:
            "The deployed PLAN_ONLY Janitor accepts only inspect_cell_cleanup_plan, not delete_shared_cell_stack.",
        },
      ],
    },
    readiness: {
      localCandidateValidated: true,
      authoringOnly: true,
      cloudApplyReady: false,
      executionReady: false,
      planOnlyAuthoringAcknowledged: true,
    },
    safety: {
      callsAws: false,
      createsChargeableResources: false,
      compiledTemplateCreatesChargeableResources: true,
      maxCells: plan.safety.maxCells,
      maxAuroraClusters: plan.safety.maxAuroraClusters,
      maxAuroraInstances: plan.safety.maxAuroraInstances,
      maxAcu: plan.safety.maxAcu,
      natGateways: plan.safety.natGateways,
      interfaceEndpoints: plan.safety.interfaceEndpoints,
      cellTtlSeconds: plan.safety.cellTtlSeconds,
      cleanupBufferSeconds: plan.safety.cleanupBufferSeconds,
    },
    worstCaseCostBoundary: {
      monthlyBudgetUsd: 10,
      budgetEnforcement: "ALERT_ONLY_NOT_HARD_CAP",
      exactUsdEstimateProvided: false,
      zeroCostGuaranteed: false,
      limits: {
        maxCells: 1,
        maxAuroraClusters: 1,
        maxAuroraInstances: 1,
        maxAuroraAcu: 1,
        maxApplicationLoadBalancers: 1,
        natGateways: 0,
        interfaceEndpoints: 0,
        cellTtlSeconds: 10_800,
      },
      notices: [
        "The USD 10 monthly AWS Budget is an alert, not a hard spending cap.",
        "This resource boundary is neither an exact USD estimate nor a zero-cost guarantee.",
      ],
    },
  };
  return {
    schemaVersion: 1,
    manifest,
    templateSnapshot: {
      encoding: "utf8",
      trailingNewline: false,
      body: plan.templateBody,
      byteLength: manifest.immutableTemplate.byteLength,
      rawSha256,
      canonicalSha256,
    },
  };
}

export function serializeB5SharedCellAuthorCandidate(candidate) {
  return `${canonicalJson(candidate)}\n`;
}

function usage() {
  return [
    "usage: node --experimental-strip-types compile-b5-shared-cell-author-candidate.mjs",
    "  --requested-at <canonical UTC with milliseconds>",
    "  --availability-zone-a <az> --availability-zone-b <az>",
    "  --certificate-arn <arn> --control-trust-store-arn <arn>",
    "  --cell-janitor-function-arn <arn>",
    "  --cell-scheduler-invoke-role-arn <arn>",
    "  --cell-scheduler-group-name <name>",
    "  --allow-plan-only-authoring",
  ].join("\n");
}

function parseArguments(argv) {
  const valueOptions = new Set([
    "--requested-at",
    "--availability-zone-a",
    "--availability-zone-b",
    "--certificate-arn",
    "--control-trust-store-arn",
    "--cell-janitor-function-arn",
    "--cell-scheduler-invoke-role-arn",
    "--cell-scheduler-group-name",
  ]);
  const values = new Map();
  let allowPlanOnlyAuthoring = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--allow-plan-only-authoring") {
      if (allowPlanOnlyAuthoring) {
        throw new Error("--allow-plan-only-authoring may be specified only once.");
      }
      allowPlanOnlyAuthoring = true;
      continue;
    }
    if (!valueOptions.has(option)) {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (values.has(option)) {
      throw new Error(`${option} may be specified only once.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires one non-empty value.`);
    }
    values.set(option, value);
    index += 1;
  }
  for (const option of valueOptions) {
    if (!values.has(option)) throw new Error(`${option} is required.`);
  }
  return {
    requestedAt: values.get("--requested-at"),
    availabilityZones: [
      values.get("--availability-zone-a"),
      values.get("--availability-zone-b"),
    ],
    certificateArn: values.get("--certificate-arn"),
    controlTrustStoreArn: values.get("--control-trust-store-arn"),
    cellJanitorFunctionArn: values.get("--cell-janitor-function-arn"),
    cellSchedulerInvokeRoleArn: values.get(
      "--cell-scheduler-invoke-role-arn",
    ),
    cellSchedulerGroupName: values.get("--cell-scheduler-group-name"),
    allowPlanOnlyAuthoring,
  };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const candidate = compileB5SharedCellAuthorCandidate(input);
  process.stdout.write(serializeB5SharedCellAuthorCandidate(candidate));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  });
}
