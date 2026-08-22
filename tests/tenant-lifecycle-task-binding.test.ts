import assert from "node:assert/strict";
import test from "node:test";

import {
  approvedTenantDatabaseOneShotCommands,
  tenantDatabaseOneShotOperations,
} from "../lib/deployments/execution/ecs-one-shot-task.ts";
import {
  compileOfflineTenantLifecycleTaskBinding,
  type OfflineTenantLifecycleTaskBindingInput,
} from "../lib/deployments/execution/tenant-lifecycle-task-binding.ts";

const imageDigest =
  "sha256:0c4cb3ebfb55a944a24d548ded716d93dd00bcc4d1796c8e9eb588ce385710ae";

function bindingInput(
  overrides: Partial<OfflineTenantLifecycleTaskBindingInput> = {},
): OfflineTenantLifecycleTaskBindingInput {
  return {
    expectedAccountId: "402010193138",
    expectedRegion: "ca-central-1",
    imageUri:
      "402010193138.dkr.ecr.ca-central-1.amazonaws.com/" +
      `techlong-sandbox-speedfeast@${imageDigest}`,
    taskDefinitionArn:
      "arn:aws:ecs:ca-central-1:402010193138:" +
      "task-definition/tenant-lifecycle:7",
    clusterArn:
      "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1",
    taskExecutionRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole",
    lifecycleTaskRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole",
    receiptBucketArn:
      "arn:aws:s3:::techlong-sandbox-402010193138-ca-central-1-tenant-receipts",
    subnetIds: ["subnet-0123456789abcdef0", "subnet-0fedcba9876543210"],
    oneShotSecurityGroupId: "sg-0123456789abcdef0",
    ...overrides,
  };
}

test("compiles one immutable unverified lifecycle intent and six exact commands", () => {
  const binding = compileOfflineTenantLifecycleTaskBinding(bindingInput());

  assert.equal(binding.mode, "offline_reviewed_intent");
  assert.equal(binding.registrationReady, false);
  assert.equal(binding.liveReadbackReady, false);
  assert.equal(
    binding.blocker,
    "tenant_lifecycle_task_definition_live_readback_missing",
  );
  assert.equal(binding.image.digest, imageDigest);
  assert.equal(binding.taskDefinition.family, "tenant-lifecycle");
  assert.equal(binding.taskDefinition.revision, 7);
  assert.equal(
    binding.taskDefinition.containerName,
    "tenant-database-lifecycle",
  );
  assert.equal(
    binding.clusterArn,
    bindingInput().clusterArn,
  );
  assert.equal(
    binding.receiptBucketArn,
    bindingInput().receiptBucketArn,
  );
  assert.deepEqual(
    Object.keys(binding.commands).sort(),
    [...tenantDatabaseOneShotOperations].sort(),
  );
  for (const operation of tenantDatabaseOneShotOperations) {
    assert.deepEqual(
      binding.commands[operation],
      approvedTenantDatabaseOneShotCommands[operation],
    );
    assert.equal(Object.isFrozen(binding.commands[operation]), true);
  }
  assert.deepEqual(binding.networkIntent.candidateSubnetIds, bindingInput().subnetIds);
  assert.equal(
    binding.networkIntent.candidateOneShotSecurityGroupId,
    bindingInput().oneShotSecurityGroupId,
  );
  assert.equal(binding.networkIntent.assignPublicIp, "ENABLED");
  assert.equal(binding.networkIntent.sharedCellEvidenceReady, false);
  assert.equal("runnerConfig" in binding, false);
  assert.equal("apiConfig" in binding, false);

  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.image), true);
  assert.equal(Object.isFrozen(binding.taskDefinition), true);
  assert.equal(Object.isFrozen(binding.commands), true);
  assert.equal(Object.isFrozen(binding.networkIntent), true);
  assert.equal(Object.isFrozen(binding.networkIntent.candidateSubnetIds), true);
});

test("rejects image tags, mutable repositories, and account or region drift", () => {
  const invalidImages = [
    "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast:latest",
    `402010193138.dkr.ecr.ca-central-1.amazonaws.com/other@${imageDigest}`,
    `999999999999.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@${imageDigest}`,
    `402010193138.dkr.ecr.us-east-1.amazonaws.com/techlong-sandbox-speedfeast@${imageDigest}`,
  ];
  for (const imageUri of invalidImages) {
    assert.throws(
      () =>
        compileOfflineTenantLifecycleTaskBinding(
          bindingInput({ imageUri }),
        ),
      /ECR repository|@sha256/i,
    );
  }
  assert.throws(
    () =>
      compileOfflineTenantLifecycleTaskBinding(
        bindingInput({ expectedRegion: "us-east-1" }),
      ),
    /Sandbox account and region/i,
  );
});

test("rejects unpinned or foreign task definitions and clusters", () => {
  const taskDefinitionArns = [
    "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle",
    "arn:aws:ecs:ca-central-1:402010193138:task-definition/other:7",
    "arn:aws:ecs:ca-central-1:999999999999:task-definition/tenant-lifecycle:7",
    "arn:aws:ecs:us-east-1:402010193138:task-definition/tenant-lifecycle:7",
  ];
  for (const taskDefinitionArn of taskDefinitionArns) {
    assert.throws(
      () =>
        compileOfflineTenantLifecycleTaskBinding(
          bindingInput({ taskDefinitionArn }),
        ),
      /tenant-lifecycle family|explicit revision/i,
    );
  }
  assert.throws(
    () =>
      compileOfflineTenantLifecycleTaskBinding(
        bindingInput({
          clusterArn:
            "arn:aws:ecs:ca-central-1:402010193138:cluster/another-cell",
        }),
      ),
    /exact intended Sandbox Cell cluster ARN/i,
  );
});

test("rejects role, receipt, subnet, security-group, and field drift", () => {
  const invalidInputs: Array<{
    override: Partial<OfflineTenantLifecycleTaskBindingInput>;
    message: RegExp;
  }> = [
    {
      override: {
        lifecycleTaskRoleArn:
          "arn:aws:iam::402010193138:role/TechlongSandboxTaskRole",
      },
      message: /task roles/i,
    },
    {
      override: { receiptBucketArn: "arn:aws:s3:::another-bucket" },
      message: /receipt bucket/i,
    },
    {
      override: { subnetIds: ["subnet-0123456789abcdef0"] },
      message: /exactly two candidate subnet ids/i,
    },
    {
      override: { oneShotSecurityGroupId: "sg-not-hex" },
      message: /one-shot security group/i,
    },
  ];
  for (const entry of invalidInputs) {
    assert.throws(
      () =>
        compileOfflineTenantLifecycleTaskBinding(
          bindingInput(entry.override),
        ),
      entry.message,
    );
  }

  const extra = bindingInput() as OfflineTenantLifecycleTaskBindingInput & {
    imageTag?: string;
  };
  extra.imageTag = "latest";
  assert.throws(
    () => compileOfflineTenantLifecycleTaskBinding(extra),
    /unexpected fields/i,
  );
});
