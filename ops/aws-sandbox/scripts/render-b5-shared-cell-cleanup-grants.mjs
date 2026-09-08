import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-shared-cell-cleanup-grants.template.json",
);

const accountId = "402010193138";
const region = "ca-central-1";
const authorityTableArn =
  `arn:aws:dynamodb:${region}:${accountId}:table/techlong-sandbox-tenant-external-epoch-authority`;
const authorityKey = "cell:cell-sandbox-1";
const cellStackName = "techlong-sandbox-cell-sandbox-1";
const cellStackIdPattern = new RegExp(
  `^arn:aws:cloudformation:${region}:${accountId}:stack/${cellStackName}/` +
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
);
const cellCloudFormationRoleArn =
  `arn:aws:iam::${accountId}:role/TechlongSandboxCellCloudFormationExecutionRole`;
const writerTargetRoleArn =
  `arn:aws:iam::${accountId}:role/TechlongSandboxProvisionerRole`;
const janitorTargetRoleArn =
  `arn:aws:iam::${accountId}:role/TechlongSandboxCellJanitorExecutionRole`;
const maximumGrantMilliseconds = 15 * 60_000;
const maximumManagedPolicyCharacters = 6_144;
const maximumDirectTemplateBytes = 51_200;
const digestPattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const sharedCellCleanupGrantShapes = Object.freeze([
  "Locked",
  "AuthorityWriterGrant",
  "AuthorityWriterRevoke",
  "JanitorDeleteGrant",
  "JanitorDeleteRevoke",
]);

const writerLogicalId = "CleanupAuthorityWriterBoundaryCandidate";
const janitorLogicalId = "CellJanitorMutationBoundaryCandidate";

function canonicalTimestamp(value, label) {
  if (!canonicalTimestampPattern.test(value ?? "")) {
    throw new Error(`${label} must be canonical UTC with milliseconds`);
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new Error(`${label} is not a canonical UTC instant`);
  }
  return milliseconds;
}

function digest(value, label) {
  if (!digestPattern.test(value ?? "")) {
    throw new Error(`${label} must be an exact lowercase SHA-256`);
  }
  return value;
}

function assertEmpty(value, label) {
  if (value) throw new Error(`${label} is not accepted by this grant shape`);
}

function assertNoGrantInputs(input, label) {
  for (const key of [
    "approvedCandidateItemSha256",
    "approvedDeletionPlanSha256",
    "approvedCellExpiresAt",
    "approvedCellStackId",
    "cleanupAuthorityExpiresAt",
    "expectedPredecessorItemSha256",
    "grantExpiresAt",
    "reviewedAt",
  ]) {
    if (input[key]) {
      throw new Error(`${label} accepts no grant inputs`);
    }
  }
}

function assertGrantWindow(input) {
  const reviewed = canonicalTimestamp(input.reviewedAt, "ReviewedAt");
  const expires = canonicalTimestamp(input.grantExpiresAt, "GrantExpiresAt");
  const authorityExpires = canonicalTimestamp(
    input.cleanupAuthorityExpiresAt,
    "CleanupAuthorityExpiresAt",
  );
  if (
    expires <= reviewed ||
    expires - reviewed > maximumGrantMilliseconds
  ) {
    throw new Error(
      "temporary cleanup grant must begin at ReviewedAt and expire within 15 minutes",
    );
  }
  if (expires > authorityExpires) {
    throw new Error(
      "temporary cleanup grant must not outlive the cleanup-authority record",
    );
  }
  return { reviewed, expires, authorityExpires };
}

function assertShapeInputs(input) {
  const { shape } = input;
  if (shape === "Locked" || shape.endsWith("Revoke")) {
    assertNoGrantInputs(input, shape);
    return;
  }
  const window = assertGrantWindow(input);
  if (shape === "AuthorityWriterGrant") {
    digest(
      input.expectedPredecessorItemSha256,
      "ExpectedPredecessorItemSha256",
    );
    digest(input.approvedCandidateItemSha256, "ApprovedCandidateItemSha256");
    if (
      input.expectedPredecessorItemSha256 === input.approvedCandidateItemSha256
    ) {
      throw new Error("cleanup authority CAS predecessor and candidate must differ");
    }
    assertEmpty(input.approvedDeletionPlanSha256, "ApprovedDeletionPlanSha256");
    assertEmpty(input.approvedCellExpiresAt, "ApprovedCellExpiresAt");
    assertEmpty(input.approvedCellStackId, "ApprovedCellStackId");
    return;
  }
  digest(input.approvedDeletionPlanSha256, "ApprovedDeletionPlanSha256");
  if (!cellStackIdPattern.test(input.approvedCellStackId ?? "")) {
    throw new Error("ApprovedCellStackId must be the exact Shared Cell Stack ARN");
  }
  const cellExpires = canonicalTimestamp(
    input.approvedCellExpiresAt,
    "ApprovedCellExpiresAt",
  );
  if (cellExpires > window.reviewed) {
    throw new Error("Janitor deletion grant requires an already expired Shared Cell");
  }
  assertEmpty(
    input.expectedPredecessorItemSha256,
    "ExpectedPredecessorItemSha256",
  );
  assertEmpty(input.approvedCandidateItemSha256, "ApprovedCandidateItemSha256");
}

function timeBound(reviewedAt, grantExpiresAt, condition = {}) {
  return {
    ...condition,
    DateGreaterThanEquals: { "aws:CurrentTime": reviewedAt },
    DateLessThan: { "aws:CurrentTime": grantExpiresAt },
  };
}

function authorityWriterGrantStatement(reviewedAt, grantExpiresAt) {
  return {
    Sid: "TemporaryAllowExactCleanupAuthorityCasPut",
    Effect: "Allow",
    Action: "dynamodb:PutItem",
    Resource: authorityTableArn,
    Condition: timeBound(reviewedAt, grantExpiresAt, {
      StringEquals: {
        "aws:RequestedRegion": region,
        "dynamodb:ReturnValues": "NONE",
      },
      "ForAllValues:StringEquals": {
        "dynamodb:LeadingKeys": [authorityKey],
        "dynamodb:Attributes": [
          "authority_key",
          "schema_version",
          "revision",
          "record_json",
        ],
      },
      Null: {
        "dynamodb:LeadingKeys": "false",
        "dynamodb:Attributes": "false",
      },
    }),
  };
}

function janitorDeleteGrantStatements(
  reviewedAt,
  grantExpiresAt,
  approvedCellExpiresAt,
  approvedCellStackId,
) {
  return [
    {
      Sid: "TemporaryAllowDeleteExactExpiredCellStack",
      Effect: "Allow",
      Action: "cloudformation:DeleteStack",
      Resource: approvedCellStackId,
      Condition: timeBound(reviewedAt, grantExpiresAt, {
        StringEquals: {
          "aws:RequestedRegion": region,
          "aws:ResourceTag/Environment": "aws-sandbox",
          "aws:ResourceTag/ManagedBy": "techlong-cell-operator",
          "aws:ResourceTag/CellId": "cell-sandbox-1",
          "aws:ResourceTag/ExpiresAt": approvedCellExpiresAt,
        },
        ArnEquals: {
          "cloudformation:RoleArn": cellCloudFormationRoleArn,
        },
      }),
    },
    {
      Sid: "TemporaryAllowPassOnlyDedicatedCellCloudFormationRole",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: cellCloudFormationRoleArn,
      Condition: timeBound(reviewedAt, grantExpiresAt, {
        StringEquals: {
          "iam:PassedToService": "cloudformation.amazonaws.com",
        },
      }),
    },
  ];
}

function statements(template, logicalId) {
  const value =
    template.Resources?.[logicalId]?.Properties?.PolicyDocument?.Statement;
  if (!Array.isArray(value)) {
    throw new Error(`${logicalId} policy statements are missing`);
  }
  return value;
}

function actions(statement) {
  return Array.isArray(statement.Action)
    ? statement.Action
    : statement.Action
      ? [statement.Action]
      : [];
}

function assertLockedBase(template) {
  if (
    Object.keys(template.Resources ?? {}).length !== 2 ||
    !template.Resources?.[writerLogicalId] ||
    !template.Resources?.[janitorLogicalId]
  ) {
    throw new Error("cleanup grant candidate template must contain exactly two policies");
  }
  for (const logicalId of [writerLogicalId, janitorLogicalId]) {
    const properties = template.Resources[logicalId].Properties;
    if (
      template.Resources[logicalId].Type !== "AWS::IAM::ManagedPolicy" ||
      Object.hasOwn(properties, "Roles") ||
      Object.hasOwn(properties, "Users") ||
      Object.hasOwn(properties, "Groups")
    ) {
      throw new Error(`${logicalId} must remain an unattached candidate policy`);
    }
  }
  const writerAllows = statements(template, writerLogicalId)
    .filter((statement) => statement.Effect === "Allow")
    .flatMap(actions);
  const janitorAllows = statements(template, janitorLogicalId)
    .filter((statement) => statement.Effect === "Allow")
    .flatMap(actions);
  if (writerAllows.includes("dynamodb:PutItem")) {
    throw new Error("locked authority writer unexpectedly allows PutItem");
  }
  for (const action of ["cloudformation:DeleteStack", "iam:PassRole"]) {
    if (janitorAllows.includes(action)) {
      throw new Error(`locked Janitor unexpectedly allows ${action}`);
    }
  }
  const safety = template.Metadata?.SafetyBoundary;
  if (
    safety?.AuthorityWriterTargetRoleArn !== writerTargetRoleArn ||
    safety?.JanitorTargetRoleArn !== janitorTargetRoleArn ||
    safety?.CellCloudFormationExecutionRoleArn !==
      cellCloudFormationRoleArn ||
    writerTargetRoleArn === janitorTargetRoleArn
  ) {
    throw new Error("cleanup grant role separation metadata drifted");
  }
}

function policyCharacters(document) {
  return JSON.stringify(document).replace(/\s/g, "").length;
}

function assertSizeLimits(template) {
  for (const logicalId of [writerLogicalId, janitorLogicalId]) {
    const characters = policyCharacters(
      template.Resources[logicalId].Properties.PolicyDocument,
    );
    if (characters > maximumManagedPolicyCharacters) {
      throw new Error(
        `${logicalId} has ${characters} non-whitespace policy characters; maximum is ${maximumManagedPolicyCharacters}`,
      );
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(template), "utf8");
  if (bytes > maximumDirectTemplateBytes) {
    throw new Error("cleanup grant candidate template exceeds 51,200 bytes");
  }
}

export async function renderB5SharedCellCleanupGrantsTemplate({
  shape = "Locked",
  expectedPredecessorItemSha256 = "",
  approvedCandidateItemSha256 = "",
  approvedDeletionPlanSha256 = "",
  approvedCellExpiresAt = "",
  approvedCellStackId = "",
  cleanupAuthorityExpiresAt = "",
  reviewedAt = "",
  grantExpiresAt = "",
} = {}) {
  if (!sharedCellCleanupGrantShapes.includes(shape)) {
    throw new Error(`unsupported J5g-c cleanup grant shape: ${shape}`);
  }
  const input = {
    shape,
    expectedPredecessorItemSha256,
    approvedCandidateItemSha256,
    approvedDeletionPlanSha256,
    approvedCellExpiresAt,
    approvedCellStackId,
    cleanupAuthorityExpiresAt,
    reviewedAt,
    grantExpiresAt,
  };
  assertShapeInputs(input);
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  assertLockedBase(template);

  const safety = template.Metadata.SafetyBoundary;
  safety.GrantState = shape.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  if (shape.endsWith("Grant")) {
    safety.ReviewedAt = reviewedAt;
    safety.GrantExpiresAt = grantExpiresAt;
    safety.CleanupAuthorityExpiresAt = cleanupAuthorityExpiresAt;
    safety.ApplicationDigestFenceRequired = true;
    safety.IamCannotBindRecordBodyOrClientRequestToken = true;
  }
  if (shape === "AuthorityWriterGrant") {
    safety.ExpectedPredecessorItemSha256 = expectedPredecessorItemSha256;
    safety.ApprovedCandidateItemSha256 = approvedCandidateItemSha256;
    statements(template, writerLogicalId).push(
      authorityWriterGrantStatement(reviewedAt, grantExpiresAt),
    );
  } else if (shape === "JanitorDeleteGrant") {
    safety.ApprovedDeletionPlanSha256 = approvedDeletionPlanSha256;
    safety.ApprovedCellExpiresAt = approvedCellExpiresAt;
    safety.ApprovedCellStackId = approvedCellStackId;
    statements(template, janitorLogicalId).push(
      ...janitorDeleteGrantStatements(
        reviewedAt,
        grantExpiresAt,
        approvedCellExpiresAt,
        approvedCellStackId,
      ),
    );
  }

  template.Description =
    `Local-only J5g-c unattached Shared Cell cleanup grant contract (${shape}); no AWS apply, Lambda change, Schedule change, or paid Cell is approved.`;
  template.Outputs.ContractState.Value =
    `${safety.GrantState}_UNATTACHED_LOCAL_VALIDATE_ONLY`;
  assertSizeLimits(template);
  return `${JSON.stringify(template)}\n`;
}

function argument(name) {
  const indexes = process.argv.flatMap((value, index) =>
    value === name ? [index] : [],
  );
  if (indexes.length > 1) throw new Error(`${name} may only be provided once`);
  if (indexes.length === 0) return "";
  const value = process.argv[indexes[0] + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function main() {
  const output = argument("--output");
  if (!output) {
    throw new Error(
      "usage: node render-b5-shared-cell-cleanup-grants.mjs --shape <shape> --output <path> [review-bound grant inputs]",
    );
  }
  const rendered = await renderB5SharedCellCleanupGrantsTemplate({
    shape: argument("--shape") || "Locked",
    expectedPredecessorItemSha256: argument(
      "--expected-predecessor-item-sha256",
    ),
    approvedCandidateItemSha256: argument("--approved-candidate-item-sha256"),
    approvedDeletionPlanSha256: argument("--approved-deletion-plan-sha256"),
    approvedCellExpiresAt: argument("--approved-cell-expires-at"),
    approvedCellStackId: argument("--approved-cell-stack-id"),
    cleanupAuthorityExpiresAt: argument("--cleanup-authority-expires-at"),
    reviewedAt: argument("--reviewed-at"),
    grantExpiresAt: argument("--grant-expires-at"),
  });
  const outputPath = path.resolve(process.cwd(), output);
  await writeFile(outputPath, rendered, { encoding: "utf8", flag: "w" });
  console.log(
    `Rendered J5g-c Shared Cell cleanup grant contract (${argument("--shape") || "Locked"}): ${outputPath}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
