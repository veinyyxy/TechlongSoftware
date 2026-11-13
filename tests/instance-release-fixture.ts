import type { ImageUpdatePlan } from "../lib/deployments/releases/contract.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

export const h = (letter: string) => letter.repeat(64);
export const repository = "111111111111.dkr.ecr.ca-central-1.amazonaws.com/example-api";
export async function releaseFixture(instance = "one", request = `request_${instance}`) {
  const stackId = `arn:aws:cloudformation:ca-central-1:111111111111:stack/tenant-${instance}/00000000-0000-4000-8000-000000000001`;
  const plan: ImageUpdatePlan = {
    schema: "techlong/instance-image-update-plan/v1",
    selection: { requestId: request, requestedBy: "operator", workspaceId: `wsp_${instance}`,
      instanceId: `app_${instance}`, environmentId: "sandbox", releaseId: "release_v2" },
    productId: "product_api", component: "tenant_api", accountId: "111111111111", region: "ca-central-1",
    expectedStateRevision: 3, observedAt: 1000, preparedAt: 2000, writeBefore: 18_001_000,
    templateSha256: h("c"), configurationSha256: h("d"), desiredCount: 1,
    compatibility: { databaseProfile: "express_iam", databaseSchemaVersion: "schema-v1",
      runtimePlatform: "linux/amd64", applicationPort: 3000, clientApiVersion: "v1", persistentUploadsReady: true },
    from: { releaseId: "release_v1", imageUri: `${repository}@sha256:${h("a")}`, platformDigest: `sha256:${h("a")}` },
    to: { releaseId: "release_v2", version: "2.0.0", imageUri: `${repository}@sha256:${h("b")}`,
      platformDigest: `sha256:${h("9")}`, sourceRepository: "example/backend", sourceCommit: "1".repeat(40),
      buildRunId: "100", buildAttempt: 1, artifactSha256: h("e"), imageVerificationSha256: h("f") },
    changeSet: { StackName: stackId, ChangeSetType: "UPDATE", UsePreviousTemplate: true,
      Parameters: [{ ParameterKey: "ClusterName", UsePreviousValue: true },
        { ParameterKey: "ImageUri", ParameterValue: `${repository}@sha256:${h("b")}` }] },
    expectedChanges: [{ logicalId: "TenantTaskDefinition", action: "Modify", replacement: "True" },
      { logicalId: "TenantService", action: "Modify", replacement: "False" }],
  };
  return { plan, sha: await sha256Hex(plan), token: "claim-synthetic-0001",
    changeSetId: "arn:aws:cloudformation:ca-central-1:111111111111:changeSet/release-test/00000000-0000-4000-8000-000000000002" };
}
