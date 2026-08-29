import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const legacyCommit = "d74b135c6edcc31211aec8646518bc510a71c527";
const templateSpec =
  `${legacyCommit}:ops/aws-sandbox/cloudformation/s3-b5-cell-bootstrap.template.json`;
const janitorSpec =
  `${legacyCommit}:ops/aws-sandbox/lambda/cell-janitor.cjs`;
const sourceMarker = "__CELL_JANITOR_INLINE_SOURCE__";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..", "..");

export const legacyJ4bChildRawSha256 =
  "8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f";
export const legacyJ4bChildCanonicalSha256 =
  "2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389";

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

export async function renderLegacyJ4bChildTemplate() {
  const template = JSON.parse(readPinnedGitObject(templateSpec));
  const janitorSource = readPinnedGitObject(janitorSpec);
  if (template.Resources?.CellJanitorFunction?.Properties?.Code?.ZipFile !== sourceMarker) {
    throw new Error("Pinned legacy J4b child source marker is missing.");
  }
  template.Resources.CellJanitorFunction.Properties.Code.ZipFile = janitorSource;
  const rendered = `${JSON.stringify(template)}\n`;
  const raw = createHash("sha256").update(rendered, "utf8").digest("hex");
  const canonical = createHash("sha256")
    .update(canonicalJson(template), "utf8")
    .digest("hex");
  if (raw !== legacyJ4bChildRawSha256 || canonical !== legacyJ4bChildCanonicalSha256) {
    throw new Error("Pinned legacy J4b child snapshot failed its fixed hashes.");
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
    throw new Error("usage: node render-b5-cell-bootstrap-j4b-legacy.mjs --output <path>");
  }
  await writeFile(
    path.resolve(process.cwd(), output),
    await renderLegacyJ4bChildTemplate(),
    { encoding: "utf8", flag: "w" },
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
