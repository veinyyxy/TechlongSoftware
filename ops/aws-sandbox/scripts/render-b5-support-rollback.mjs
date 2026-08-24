import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseCloudFormationTemplateDocument,
  renderCloudFormationTemplateDocument,
} from "./cloudformation-template-document.mjs";
import { renderBootstrapTemplate } from "./render-bootstrap.mjs";

const supportResourceNames = [
  "TenantLifecycleReceiptBucket",
  "TenantLifecycleReceiptBucketPolicy",
  "TenantExternalEpochAuthorityTable",
  "TenantLifecycleTaskRole",
  "DeploymentWorkerRole",
];

const supportOutputNames = [
  "TenantLifecycleReceiptBucketName",
  "TenantLifecycleReceiptBucketArn",
  "TenantExternalEpochAuthorityTableName",
  "TenantExternalEpochAuthorityTableArn",
  "TenantLifecycleTaskRoleArn",
  "DeploymentWorkerRoleArn",
];

const serviceBoundarySupportStatements = new Set([
  "AllowExactTenantLifecycleReceipts",
  "AllowExactExternalEpochAuthority",
  "AllowExactTenantLifecycleRunTask",
  "AllowExactCellOneShotTaskControl",
  "AllowExactCellOneShotTaskRecovery",
  "AllowRunTaskTagAuthorizationOnly",
  "AllowPassOnlySandboxTaskRoles",
  "AllowGenerationOwnedRuntimeSecretLifecycle",
  "AllowLifecycleTaskDefinitionReadback",
  "AllowExactCellManagedMasterSecretRead",
]);

function removePolicyStatements(template, logicalId, sids) {
  const statements =
    template.Resources?.[logicalId]?.Properties?.PolicyDocument?.Statement;
  if (!Array.isArray(statements)) {
    throw new Error(`B5 support rollback source is missing ${logicalId} statements`);
  }
  const observed = new Set(statements.map((statement) => statement.Sid));
  for (const sid of sids) {
    if (!observed.has(sid)) {
      throw new Error(`B5 support rollback source is missing ${logicalId}/${sid}`);
    }
  }
  template.Resources[logicalId].Properties.PolicyDocument.Statement =
    statements.filter((statement) => !sids.has(statement.Sid));
}

export async function renderB5SupportRollbackTemplate() {
  const template = parseCloudFormationTemplateDocument(
    await renderBootstrapTemplate(),
    "Rendered B5 support template",
  );
  for (const resourceName of supportResourceNames) {
    if (!template.Resources?.[resourceName]) {
      throw new Error(`B5 support rollback source is missing ${resourceName}`);
    }
    delete template.Resources[resourceName];
  }
  for (const outputName of supportOutputNames) {
    if (!template.Outputs?.[outputName]) {
      throw new Error(`B5 support rollback source is missing ${outputName}`);
    }
    delete template.Outputs[outputName];
  }
  removePolicyStatements(
    template,
    "ServiceRoleBoundary",
    serviceBoundarySupportStatements,
  );
  removePolicyStatements(
    template,
    "ProvisionerBoundary",
    new Set([
      "AllowExactWorkerCanaryRole",
      "AllowSharedCellReadOnlyPreflight",
    ]),
  );
  const executionPassRole =
    template.Resources?.ExecutionRoleBoundary?.Properties?.PolicyDocument?.Statement?.find(
      (statement) => statement.Sid === "AllowPassOnlySandboxTaskRolesToEcs",
    );
  if (!Array.isArray(executionPassRole?.Resource)) {
    throw new Error(
      "B5 support rollback source is missing ExecutionRoleBoundary/AllowPassOnlySandboxTaskRolesToEcs",
    );
  }
  const lifecycleTaskRoleArn =
    "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole";
  if (!executionPassRole.Resource.includes(lifecycleTaskRoleArn)) {
    throw new Error(
      "B5 support rollback source is missing the lifecycle TaskRole pass grant",
    );
  }
  executionPassRole.Resource = executionPassRole.Resource.filter(
    (resource) => resource !== lifecycleTaskRoleArn,
  );
  const executionTaskDefinitionCleanup =
    template.Resources.ExecutionRoleBoundary.Properties.PolicyDocument.Statement.find(
      (statement) => statement.Sid === "AllowTenantTaskDefinitionCleanup",
    );
  if (!executionTaskDefinitionCleanup) {
    throw new Error(
      "B5 support rollback source is missing ExecutionRoleBoundary/AllowTenantTaskDefinitionCleanup",
    );
  }
  executionTaskDefinitionCleanup.Resource =
    "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-*:*";
  delete executionTaskDefinitionCleanup.Condition;
  const executionTaskDefinitionRegistration =
    template.Resources.ExecutionRoleBoundary.Properties.PolicyDocument.Statement.find(
      (statement) => statement.Sid === "AllowTaggedTaskDefinitionRegistration",
    );
  if (!executionTaskDefinitionRegistration) {
    throw new Error(
      "B5 support rollback source is missing ExecutionRoleBoundary/AllowTaggedTaskDefinitionRegistration",
    );
  }
  executionTaskDefinitionRegistration.Resource = "*";
  template.Description =
    "Techlong AWS Sandbox bootstrap with B5 support resources removed and their boundary permissions revoked.";
  template.Metadata.SafetyBoundary.CreatesB5SupportResources = false;
  template.Metadata.SafetyBoundary.RevokesB5SupportIamCapabilities = true;
  const rendered = renderCloudFormationTemplateDocument(template);
  if (Buffer.byteLength(rendered, "utf8") > 50_000) {
    throw new Error(
      "rendered B5 support rollback exceeds the reviewed direct-body limit",
    );
  }
  return rendered;
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    throw new Error(
      "usage: node render-b5-support-rollback.mjs --output <absolute-or-relative-path>",
    );
  }
  const outputPath = path.resolve(process.cwd(), process.argv[outputIndex + 1]);
  await writeFile(outputPath, await renderB5SupportRollbackTemplate(), {
    encoding: "utf8",
    flag: "w",
  });
  console.log(`Rendered B5 support rollback template: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
