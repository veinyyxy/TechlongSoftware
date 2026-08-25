import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-cell-bootstrap-management.template.json",
);
const maximumDirectTemplateBytes = 51_200;
const changeSetNamePattern =
  /^techlong-s3-b5-cell-bootstrap-[a-f0-9]{16}$/;
const templateSha256Pattern = /^[a-f0-9]{64}$/;
const grantExpiryPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const approvedTemplateBucket =
  "techlong-sandbox-build-source-402010193138-ca-central-1";
const approvedTemplatePrefix = "b5-cell-bootstrap/templates/sha256";
const bootstrapExecutionRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellBootstrapCloudFormationExecutionRole";
const approvedResourceTypes = Object.freeze([
  "AWS::Logs::LogGroup",
  "AWS::Lambda::Function",
  "AWS::Scheduler::ScheduleGroup",
  "AWS::Scheduler::Schedule",
]);

export const managementShapes = Object.freeze([
  "Locked",
  "AuthorGrant",
  "ExecuteGrant",
  "RollbackGrant",
]);

function approvedTemplateLocation(approvedTemplateSha256) {
  const key = `${approvedTemplatePrefix}/${approvedTemplateSha256}.json`;
  return {
    arn: `arn:aws:s3:::${approvedTemplateBucket}/${key}`,
    url: `https://${approvedTemplateBucket}.s3.ca-central-1.amazonaws.com/${key}`,
  };
}

function exactGrantInputs(
  shape,
  approvedChangeSetName,
  approvedTemplateSha256,
  grantExpiresAt,
) {
  if (shape === "Locked") {
    if (approvedChangeSetName || approvedTemplateSha256 || grantExpiresAt) {
      throw new Error("Locked management shape accepts no grant inputs");
    }
    return;
  }
  if (!grantExpiryPattern.test(grantExpiresAt ?? "")) {
    throw new Error("temporary management grant requires canonical GrantExpiresAt");
  }
  const timestamp = Date.parse(grantExpiresAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== grantExpiresAt) {
    throw new Error("temporary management grant expiry is not canonical UTC");
  }
  if (
    shape !== "RollbackGrant" &&
    !changeSetNamePattern.test(approvedChangeSetName ?? "")
  ) {
    throw new Error("temporary author/execute grant requires the exact digest-bound Change Set name");
  }
  if (shape !== "RollbackGrant") {
    if (!templateSha256Pattern.test(approvedTemplateSha256 ?? "")) {
      throw new Error(
        "temporary author/execute grant requires the exact lowercase raw template SHA-256",
      );
    }
    const expectedChangeSetName =
      `techlong-s3-b5-cell-bootstrap-${approvedTemplateSha256.slice(0, 16)}`;
    if (approvedChangeSetName !== expectedChangeSetName) {
      throw new Error(
        "digest-bound Change Set name must match the approved raw template SHA-256",
      );
    }
  }
  if (shape === "RollbackGrant" && (approvedChangeSetName || approvedTemplateSha256)) {
    throw new Error(
      "RollbackGrant does not accept a Change Set name or template SHA-256",
    );
  }
}

function expiresBefore(grantExpiresAt) {
  return { DateLessThan: { "aws:CurrentTime": grantExpiresAt } };
}

function authorStatements(
  approvedChangeSetName,
  approvedTemplateSha256,
  grantExpiresAt,
) {
  const changeSetArn =
    `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${approvedChangeSetName}/*`;
  const templateLocation = approvedTemplateLocation(approvedTemplateSha256);
  return [
    {
      Sid: "TemporaryAllowAuthorExactBootstrapChangeSet",
      Effect: "Allow",
      Action: "cloudformation:CreateChangeSet",
      Resource: [
        "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/*",
        changeSetArn,
      ],
      Condition: {
        StringEquals: {
          "aws:RequestedRegion": "ca-central-1",
          "aws:RequestTag/Environment": "aws-sandbox",
          "aws:RequestTag/ManagedBy": "techlong-cell-bootstrap-manager",
          "aws:RequestTag/Component": "b5-cell-bootstrap",
          "cloudformation:TemplateUrl": templateLocation.url,
          "cloudformation:RoleARN": bootstrapExecutionRoleArn,
          "cloudformation:ChangeSetName": approvedChangeSetName,
        },
        "ForAllValues:StringEquals": {
          "aws:TagKeys": ["Environment", "ManagedBy", "Component"],
          "cloudformation:ResourceTypes": approvedResourceTypes,
        },
        Null: { "cloudformation:ResourceTypes": "false" },
        ...expiresBefore(grantExpiresAt),
      },
    },
    {
      Sid: "TemporaryAllowReadExactApprovedBootstrapTemplate",
      Effect: "Allow",
      Action: "s3:GetObject",
      Resource: templateLocation.arn,
      Condition: expiresBefore(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowReadOrDiscardExactBootstrapChangeSet",
      Effect: "Allow",
      Action: ["cloudformation:DeleteChangeSet", "cloudformation:DescribeChangeSet"],
      Resource: changeSetArn,
      Condition: expiresBefore(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowPassBootstrapExecutionRoleForAuthoring",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: bootstrapExecutionRoleArn,
      Condition: {
        StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
        ...expiresBefore(grantExpiresAt),
      },
    },
  ];
}

function executeStatements(approvedChangeSetName, grantExpiresAt) {
  const changeSetArn =
    `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${approvedChangeSetName}/*`;
  return [
    {
      Sid: "TemporaryAllowExecuteExactBootstrapChangeSet",
      Effect: "Allow",
      Action: ["cloudformation:DescribeChangeSet", "cloudformation:ExecuteChangeSet"],
      Resource: changeSetArn,
      Condition: expiresBefore(grantExpiresAt),
    },
  ];
}

function rollbackStatements(grantExpiresAt) {
  return [
    {
      Sid: "TemporaryAllowDeleteExactBootstrapStack",
      Effect: "Allow",
      Action: ["cloudformation:DeleteStack", "cloudformation:DescribeStacks"],
      Resource:
        "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/*",
      Condition: {
        StringEquals: {
          "aws:ResourceTag/Environment": "aws-sandbox",
          "aws:ResourceTag/ManagedBy": "techlong-cell-bootstrap-manager",
          "aws:ResourceTag/Component": "b5-cell-bootstrap",
        },
        ...expiresBefore(grantExpiresAt),
      },
    },
    {
      Sid: "TemporaryAllowPassBootstrapExecutionRoleForRollback",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: bootstrapExecutionRoleArn,
      Condition: {
        StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
        ...expiresBefore(grantExpiresAt),
      },
    },
  ];
}

export async function renderB5CellBootstrapManagementTemplate({
  shape = "Locked",
  approvedChangeSetName = "",
  approvedTemplateSha256 = "",
  grantExpiresAt = "",
} = {}) {
  if (!managementShapes.includes(shape)) {
    throw new Error(`unsupported B5 Cell Bootstrap management shape: ${shape}`);
  }
  exactGrantInputs(
    shape,
    approvedChangeSetName,
    approvedTemplateSha256,
    grantExpiresAt,
  );
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  const statements =
    template.Resources?.CellBootstrapManagerBoundary?.Properties?.PolicyDocument
      ?.Statement;
  if (!Array.isArray(statements)) {
    throw new Error("locked management template is missing the manager policy");
  }
  for (const action of [
    "cloudformation:CreateChangeSet",
    "cloudformation:ExecuteChangeSet",
    "cloudformation:DeleteStack",
    "iam:PassRole",
  ]) {
    const present = statements.some((statement) => {
      const actions = Array.isArray(statement.Action)
        ? statement.Action
        : [statement.Action];
      return statement.Effect === "Allow" && actions.includes(action);
    });
    if (present) throw new Error(`locked management template unexpectedly allows ${action}`);
  }

  template.Metadata.SafetyBoundary.ManagerGrantState = shape.toUpperCase();
  if (shape !== "Locked") {
    template.Metadata.SafetyBoundary.GrantExpiresAt = grantExpiresAt;
  }
  if (approvedChangeSetName) {
    template.Metadata.SafetyBoundary.ApprovedChangeSetName = approvedChangeSetName;
  }
  if (approvedTemplateSha256) {
    template.Metadata.SafetyBoundary.ApprovedTemplateSha256 =
      approvedTemplateSha256;
    template.Metadata.SafetyBoundary.ApprovedTemplateUrl =
      approvedTemplateLocation(approvedTemplateSha256).url;
  }
  if (shape === "AuthorGrant") {
    statements.push(
      ...authorStatements(
        approvedChangeSetName,
        approvedTemplateSha256,
        grantExpiresAt,
      ),
    );
  } else if (shape === "ExecuteGrant") {
    statements.push(...executeStatements(approvedChangeSetName, grantExpiresAt));
  } else if (shape === "RollbackGrant") {
    statements.push(...rollbackStatements(grantExpiresAt));
  }
  template.Description =
    `B5-J4b IAM-only Cell Bootstrap management root (${shape}); it cannot create a Shared Cell.`;
  const rendered = `${JSON.stringify(template)}\n`;
  if (Buffer.byteLength(rendered, "utf8") > maximumDirectTemplateBytes) {
    throw new Error("rendered B5 Cell Bootstrap management template exceeds the direct-body limit");
  }
  return rendered;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : (process.argv[index + 1] ?? "");
}

async function main() {
  const output = argument("--output");
  if (!output) {
    throw new Error(
      "usage: node render-b5-cell-bootstrap-management.mjs --shape <shape> --output <path> [--approved-change-set-name <name> --approved-template-sha256 <raw-sha256> --grant-expires-at <UTC>]",
    );
  }
  const shape = argument("--shape") || "Locked";
  const rendered = await renderB5CellBootstrapManagementTemplate({
    shape,
    approvedChangeSetName: argument("--approved-change-set-name"),
    approvedTemplateSha256: argument("--approved-template-sha256"),
    grantExpiresAt: argument("--grant-expires-at"),
  });
  const outputPath = path.resolve(process.cwd(), output);
  await writeFile(outputPath, rendered, { encoding: "utf8", flag: "w" });
  console.log(`Rendered B5 Cell Bootstrap management template (${shape}): ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
