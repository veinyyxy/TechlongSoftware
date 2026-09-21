import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const reviewedCommit = "f7453eef3b500f3808de96c9238ba7999bef8c1d";
const templateSpec =
  `${reviewedCommit}:ops/aws-sandbox/cloudformation/s3-b5-cell-bootstrap.template.json`;
const janitorSpec =
  `${reviewedCommit}:ops/aws-sandbox/lambda/cell-janitor.cjs`;
const sourceMarker = "__CELL_JANITOR_INLINE_SOURCE__";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..", "..");

export const j5ghDeleteIntentChildRawSha256 =
  "77a57afeaafc2f26b14ad5d1374c816196395a55720de7ab68dea68ac8c802d7";
export const j5ghDeleteIntentChildCanonicalSha256 =
  "d22612f92f46ba9c060166455cd3e3fc9aa2a12fbb2093e892bfbcf9dc39f142";

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function readPinnedGitObject(spec) {
  const safeDirectory = repositoryRoot.replaceAll("\\", "/");
  return execFileSync(
    "git",
    ["-c", `safe.directory=${safeDirectory}`, "show", spec],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
}

export async function renderJ5ghDeleteIntentChildTemplate() {
  const template = JSON.parse(readPinnedGitObject(templateSpec));
  const janitorSource = readPinnedGitObject(janitorSpec);
  if (
    template.Resources?.CellJanitorFunction?.Properties?.Code?.ZipFile !==
    sourceMarker
  ) {
    throw new Error("Pinned J5g-h delete-intent child source marker is missing.");
  }
  template.Resources.CellJanitorFunction.Properties.Code.ZipFile = janitorSource;
  const rendered = `${JSON.stringify(template)}\n`;
  const raw = createHash("sha256").update(rendered, "utf8").digest("hex");
  const canonical = createHash("sha256")
    .update(canonicalJson(template), "utf8")
    .digest("hex");
  if (
    raw !== j5ghDeleteIntentChildRawSha256 ||
    canonical !== j5ghDeleteIntentChildCanonicalSha256
  ) {
    throw new Error("Pinned J5g-h delete-intent child failed its fixed hashes.");
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
      "usage: node render-b5-cell-bootstrap-j5gh-delete-intent.mjs --output <path>",
    );
  }
  const outputPath = path.resolve(process.cwd(), output);
  await writeFile(outputPath, await renderJ5ghDeleteIntentChildTemplate(), {
    encoding: "utf8",
    flag: "w",
  });
  console.log(`Rendered fixed J5g-h delete-intent child template: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
