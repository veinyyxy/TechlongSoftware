import { createHash } from "node:crypto";
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
export const legacyJ4bLockedRawSha256 =
  "15ec52203f390d29858fb77e032c4d6bff83d5c3678397bf133bf60e6ab9d553";
export const legacyJ4bLockedCanonicalSha256 =
  "5d09bbc9010de13dfdba09b71c13c58711a9238cb09cd78eb767f509b29c07a1";

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function removeActions(statement, removed) {
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  statement.Action = actions.filter((action) => !removed.has(action));
  if (statement.Action.length === 1) statement.Action = statement.Action[0];
}

export async function renderLegacyJ4bLockedManagementTemplate() {
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  template.Description =
    "B5-J4b IAM-only Cell Bootstrap management root (Locked); it cannot create a Shared Cell.";
  delete template.Metadata.SafetyBoundary.CoordinatorMode;
  delete template.Metadata.SafetyBoundary.AuthorityReadOnly;
  const janitorBoundary = template.Resources.CellJanitorBoundary.Properties;
  janitorBoundary.Description =
    "Externally anchored maximum permissions for the locked B5-J4b Shared Cell inventory Janitor.";
  janitorBoundary.PolicyDocument.Statement = janitorBoundary.PolicyDocument.Statement.filter(
    (statement) => ![
      "DenyPlanOnlyCoordinatorMutations",
      "AllowExactCellCleanupEvidenceRead",
      "AllowExactCellCleanupAuthorityRead",
    ].includes(statement.Sid),
  );
  template.Resources.CellJanitorExecutionRole.Properties.Description =
    "Externally bounded locked B5-J4b Lambda role; it can inspect Shared Cell Stack names but cannot delete any Stack.";
  removeActions(
    template.Resources.CellBootstrapExecutionBoundary.Properties.PolicyDocument.Statement.find(
      (statement) => statement.Sid === "AllowExactBootstrapLambdaLifecycle",
    ),
    new Set(["lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration"]),
  );
  removeActions(
    template.Resources.CellBootstrapExecutionBoundary.Properties.PolicyDocument.Statement.find(
      (statement) => statement.Sid === "AllowExactBootstrapScheduleLifecycle",
    ),
    new Set(["scheduler:UpdateSchedule"]),
  );
  const rendered = `${JSON.stringify(template)}\n`;
  const raw = createHash("sha256").update(rendered, "utf8").digest("hex");
  const canonical = createHash("sha256")
    .update(canonicalJson(template), "utf8")
    .digest("hex");
  if (raw !== legacyJ4bLockedRawSha256 || canonical !== legacyJ4bLockedCanonicalSha256) {
    throw new Error("Reconstructed legacy J4b Locked management snapshot failed its fixed hashes.");
  }
  return rendered;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : (process.argv[index + 1] ?? "");
}

async function main() {
  const output = argument("--output");
  if (!output) throw new Error("usage: node render-b5-cell-bootstrap-management-j4b-legacy.mjs --output <path>");
  const outputPath = path.resolve(process.cwd(), output);
  await writeFile(outputPath, await renderLegacyJ4bLockedManagementTemplate(), {
    encoding: "utf8",
    flag: "w",
  });
  console.log(`Reconstructed fixed J4b Locked management template: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
