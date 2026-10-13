import test from "node:test";
import assert from "node:assert/strict";
import { renderSingleTenantAcceptanceCell } from "../lib/deployments/cloudformation/single-tenant-acceptance-cell.ts";
import { renderAwsSandboxSharedCellStack } from "../lib/deployments/cloudformation/shared-cell-stack.ts";
import { v3Environment, v3Now } from "./fixtures/cell-stack-v3.ts";

const input = () => ({
  environment: v3Environment(), requestedAt: v3Now,
  availabilityZones: ["ca-central-1a", "ca-central-1b"] as [string, string],
  certificateArn: "arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-1234-1234-123456789012",
  controlTrustStoreArn: "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/fixture/abc123",
});

test("first acceptance candidate contains infrastructure, no legacy or deferred control runtime", async () => {
  const draft = input(), before = structuredClone(draft), plan = await renderSingleTenantAcceptanceCell(draft);
  assert.deepEqual(draft, before);
  assert.equal(plan.resourceInventory.length, 25);
  assert.ok(plan.resourceInventory.some(r => r.type === "AWS::RDS::DBCluster"));
  assert.ok(plan.resourceInventory.some(r => r.type === "AWS::ECS::Cluster"));
  assert.ok(plan.resourceInventory.some(r => r.type === "AWS::ElasticLoadBalancingV2::LoadBalancer"));
  assert.ok(plan.resourceInventory.every(r => !/IAM|Lambda|Scheduler/.test(r.type)));
  assert.equal(plan.safety.executionAuthorized, false);
  assert.equal(plan.safety.automaticCleanupInstalled, false);
  assert.equal(plan.safety.supervisedExactArnCleanupMustBeReviewedBeforeCreate, true);
  assert.equal(plan.safety.f3c9ParentOrLegacyAuthorityIssued, false);
  assert.equal(plan.safety.appServiceAndTaskDefinitionIncluded, false);
  assert.equal(plan.safety.monthlyBudgetIsHardCap, false);
  assert.deepEqual(Object.keys(plan.parameters).sort(),
    ["AvailabilityZoneA", "AvailabilityZoneB", "CertificateArn", "ControlTrustStoreArn"]);
  for (const word of ["CellCleanupSchedule", "CellJanitorFunctionArn", "CellLifecycleScheduleV3", "LifecyclePhase", "BirthIntentSha256"])
    assert.equal(plan.templateBody.includes(word), false);
  assert.equal((await renderSingleTenantAcceptanceCell(input())).templateSha256, plan.templateSha256);
});

test("only schedule dependencies and explicit track tags change reused resource definitions", async () => {
  const draft = input(), plan = await renderSingleTenantAcceptanceCell(draft);
  const old = renderAwsSandboxSharedCellStack({ ...draft,
    cellJanitorFunctionArn: "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
    cellSchedulerInvokeRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
    cellSchedulerGroupName: "techlong-sandbox-cell",
  });
  const expected = structuredClone(old.template.Resources) as Record<string, Record<string, unknown>>;
  delete expected.CellCleanupSchedule;
  for (const resource of Object.values(expected)) {
    const dependencies = (resource.DependsOn as string[]).filter(id => id !== "CellCleanupSchedule");
    if (dependencies.length) resource.DependsOn = dependencies; else delete resource.DependsOn;
    const properties = resource.Properties as Record<string, unknown>;
    if (Array.isArray(properties.Tags)) properties.Tags = [...properties.Tags,
      { Key: "DeliveryTrack", Value: "single-tenant-acceptance" }, { Key: "CleanupMode", Value: "supervised-reviewed" }];
  }
  assert.deepEqual(plan.template.Resources, expected);
  assert.ok("CellCleanupSchedule" in (old.template.Resources as object));
  assert.equal(old.safety.cleanupScheduleFirst, true);
  const resources = plan.template.Resources as Record<string, { DependsOn?: string[]; Properties: Record<string, unknown> }>;
  for (const resource of Object.values(resources)) {
    for (const dependency of resource.DependsOn ?? []) assert.ok(dependency in resources);
    const tags = resource.Properties.Tags as { Key: string; Value: string }[] | undefined;
    if (tags) assert.equal(new Set(tags.map(tag => tag.Key)).size, tags.length);
  }
  assert.equal(resources.CellDatabaseWriter.Properties.PubliclyAccessible, false);
  assert.equal(resources.CellDatabaseCluster.Properties.EngineVersion, "16.14");
  assert.deepEqual(resources.CellDatabaseCluster.Properties.ServerlessV2ScalingConfiguration,
    { MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 });
});

test("wrong account, budget, capacity, region, domain and enablement remain rejected", async () => {
  for (const change of [
    (draft: ReturnType<typeof input>) => { draft.environment.expectedAccountId = "123456789012"; },
    (draft: ReturnType<typeof input>) => { draft.environment.policy.budgetLimitCents = 1000; },
    (draft: ReturnType<typeof input>) => { draft.environment.policy.maxTenants = 2; },
    (draft: ReturnType<typeof input>) => { draft.environment.policy.maxTaskCount = 2; },
    (draft: ReturnType<typeof input>) => { draft.environment.region = "us-east-1"; },
    (draft: ReturnType<typeof input>) => { draft.environment.baseDomain = "techlong.cloud"; },
    (draft: ReturnType<typeof input>) => { draft.environment.applyEnabled = true; },
  ]) {
    const draft = input(); change(draft);
    await assert.rejects(() => renderSingleTenantAcceptanceCell(draft));
  }
});
