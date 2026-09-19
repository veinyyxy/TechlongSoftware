import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderCloudFormationTemplateDocument } from "./cloudformation-template-document.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-bootstrap.template.json",
);
const janitorPath = path.join(root, "lambda", "janitor.cjs");
const deployedJanitorFixturePath = path.join(
  root,
  "lambda",
  "janitor.b5i-deployed.base64",
);
const sourceMarker = "__JANITOR_INLINE_SOURCE__";
const lifecycleTaskRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole";
const authorityTableArn =
  "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority";
const sharedCellAuthorityKey = "cell:cell-sandbox-1";
const grantExpiryPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const reviewedDirectTemplateBodyLimit = 50_300;
const reviewedGrantTemplateBodyLimit = 50_750;
const cloudFormationDirectTemplateBodyLimit = 51_200;
const deployedJanitorBytes = 8_478;
const deployedJanitorSha256 =
  "a5b6d0fd40c4bede585f89316853e0e274113d07f9f11647f7a2f54bf59d22f6";

export function normalizeJanitorSourceLineEndings(source) {
  return source.replace(/\r\n/g, "\n");
}

export function decodeDeployedJanitorSource(fixtureSource, reviewedSource) {
  if (!/^[A-Za-z0-9+/]+={0,2}\r?\n?$/.test(fixtureSource)) {
    throw new Error("deployed Janitor fixture must be exactly one base64 line");
  }
  const encoded = fixtureSource.trimEnd();
  const decodedBytes = Buffer.from(encoded, "base64");
  if (decodedBytes.toString("base64") !== encoded) {
    throw new Error("deployed Janitor fixture is not canonical base64");
  }
  if (decodedBytes.byteLength !== deployedJanitorBytes) {
    throw new Error("deployed Janitor fixture byte length drifted");
  }
  if (
    createHash("sha256").update(decodedBytes).digest("hex") !==
    deployedJanitorSha256
  ) {
    throw new Error("deployed Janitor fixture digest drifted");
  }
  const deployedSource = decodedBytes.toString("utf8");
  if (!Buffer.from(deployedSource, "utf8").equals(decodedBytes)) {
    throw new Error("deployed Janitor fixture must be exact UTF-8 source");
  }
  if (
    normalizeJanitorSourceLineEndings(deployedSource) !==
    normalizeJanitorSourceLineEndings(reviewedSource)
  ) {
    throw new Error(
      "reviewed Janitor logic drifted from the deployed B5-I fixture",
    );
  }
  return deployedSource;
}

function assertCanonicalGrantExpiry(value) {
  if (typeof value !== "string" || !grantExpiryPattern.test(value)) {
    throw new Error(
      "Shared Cell provision authority grant expiry must be canonical UTC with milliseconds",
    );
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(
      "Shared Cell provision authority grant expiry is not a canonical UTC instant",
    );
  }
}

function appendSharedCellProvisionAuthorityGrant(template, grantExpiresAt) {
  assertCanonicalGrantExpiry(grantExpiresAt);
  const statements =
    template.Resources?.ProvisionerBoundary?.Properties?.PolicyDocument
      ?.Statement;
  if (!Array.isArray(statements)) {
    throw new Error("provisioner boundary statements are missing");
  }
  const temporarySid = "TemporaryInstallCellAuthority";
  if (statements.some((statement) => statement?.Sid === temporarySid)) {
    throw new Error(`provisioner boundary already contains ${temporarySid}`);
  }
  statements.push({
    Sid: temporarySid,
    Effect: "Allow",
    Action: "dynamodb:PutItem",
    Resource: authorityTableArn,
    Condition: {
      StringEquals: { "aws:RequestedRegion": "ca-central-1" },
      "ForAllValues:StringEquals": {
        "dynamodb:LeadingKeys": [sharedCellAuthorityKey],
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
      DateLessThan: { "aws:CurrentTime": grantExpiresAt },
    },
  });
}

export async function renderBootstrapTemplate({
  lifecycleTaskRegistrationGrant = false,
  sharedCellProvisionAuthorityGrantExpiresAt = "",
} = {}) {
  if (
    lifecycleTaskRegistrationGrant &&
    sharedCellProvisionAuthorityGrantExpiresAt
  ) {
    throw new Error("bootstrap grant render shapes are mutually exclusive");
  }
  const [templateSource, janitorSource, deployedJanitorFixture] =
    await Promise.all([
      readFile(templatePath, "utf8"),
      readFile(janitorPath, "utf8"),
      readFile(deployedJanitorFixturePath, "utf8"),
    ]);
  const template = JSON.parse(templateSource);
  const currentSource =
    template.Resources?.JanitorFunction?.Properties?.Code?.ZipFile;
  if (currentSource !== sourceMarker) {
    throw new Error("bootstrap template Janitor source marker is missing");
  }
  // The versioned fixture preserves the exact deployed B5-I bytes regardless
  // of checkout EOL conversion. The readable source must remain logic-identical
  // after newline normalization, and changing it requires explicit fixture and
  // lifecycle-shape review.
  template.Resources.JanitorFunction.Properties.Code.ZipFile =
    decodeDeployedJanitorSource(deployedJanitorFixture, janitorSource);
  if (lifecycleTaskRegistrationGrant) {
    const statements =
      template.Resources?.ExecutionRoleBoundary?.Properties?.PolicyDocument
        ?.Statement;
    if (!Array.isArray(statements)) {
      throw new Error("execution boundary statements are missing");
    }
    const passRoleStatements = statements.filter(
      (statement) => statement?.Sid === "AllowPassOnlySandboxTaskRolesToEcs",
    );
    if (passRoleStatements.length !== 1) {
      throw new Error("exact ECS PassRole statement is missing");
    }
    const resources = passRoleStatements[0].Resource;
    if (
      !Array.isArray(resources) ||
      resources.length !== 2 ||
      resources[0] !==
        "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole" ||
      resources[1] !==
        "arn:aws:iam::402010193138:role/TechlongSandboxTaskRole"
    ) {
      throw new Error("locked ECS PassRole resources drifted");
    }
    resources.push(lifecycleTaskRoleArn);
  }
  if (sharedCellProvisionAuthorityGrantExpiresAt) {
    appendSharedCellProvisionAuthorityGrant(
      template,
      sharedCellProvisionAuthorityGrantExpiresAt,
    );
  }
  const rendered = renderCloudFormationTemplateDocument(template);
  const renderedBytes = Buffer.byteLength(rendered, "utf8");
  const reviewedLimit = sharedCellProvisionAuthorityGrantExpiresAt
    ? reviewedGrantTemplateBodyLimit
    : reviewedDirectTemplateBodyLimit;
  // Preserve at least 900 bytes of direct-body headroom for every
  // locked/non-install shape. Only the exact temporary PutItem grant may use
  // the reviewed 50,750-byte ceiling, and every shape must remain below AWS's
  // 51,200-byte direct TemplateBody limit.
  if (
    renderedBytes > reviewedLimit ||
    renderedBytes >= cloudFormationDirectTemplateBodyLimit
  ) {
    throw new Error(
      `rendered bootstrap template exceeds its reviewed direct-body limit (${renderedBytes} bytes; reviewed ${reviewedLimit} bytes)`,
    );
  }
  return rendered;
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    throw new Error(
      "usage: node render-bootstrap.mjs --output <absolute-or-relative-path> [--lifecycle-task-registration-grant] [--shared-cell-provision-authority-grant-expires-at <canonical UTC .fffZ>]",
    );
  }
  const outputPath = path.resolve(process.cwd(), process.argv[outputIndex + 1]);
  const grantExpiryOption =
    "--shared-cell-provision-authority-grant-expires-at";
  const grantExpiryIndexes = process.argv.flatMap((value, index) =>
    value === grantExpiryOption ? [index] : [],
  );
  if (grantExpiryIndexes.length > 1) {
    throw new Error(`${grantExpiryOption} may only be provided once`);
  }
  const grantExpiryIndex = grantExpiryIndexes[0] ?? -1;
  if (
    grantExpiryIndex !== -1 &&
    (!process.argv[grantExpiryIndex + 1] ||
      process.argv[grantExpiryIndex + 1].startsWith("--"))
  ) {
    throw new Error(`${grantExpiryOption} requires a value`);
  }
  const rendered = await renderBootstrapTemplate({
    lifecycleTaskRegistrationGrant: process.argv.includes(
      "--lifecycle-task-registration-grant",
    ),
    sharedCellProvisionAuthorityGrantExpiresAt:
      grantExpiryIndex === -1 ? "" : process.argv[grantExpiryIndex + 1],
  });
  await writeFile(outputPath, rendered, { encoding: "utf8", flag: "w" });
  console.log(`Rendered S3 bootstrap template: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
