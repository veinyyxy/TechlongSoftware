import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const deployedCommit = "ae71dac5d4c1e5c05912a630e2696c4645ac2836";
const templateSpec =
  `${deployedCommit}:ops/aws-sandbox/cloudformation/s3-b5-cell-bootstrap.template.json`;
const janitorSpec =
  `${deployedCommit}:ops/aws-sandbox/lambda/cell-janitor.cjs`;
const sourceMarker = "__CELL_JANITOR_INLINE_SOURCE__";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..", "..");

export const deployedJ4cChildRawSha256 =
  "a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986";
export const deployedJ4cChildCanonicalSha256 =
  "74379232124d94b1d2ffb4322edaecd0bdb0534444b8961295175ecadc06c09c";

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

export async function renderDeployedJ4cChildTemplate() {
  const template = JSON.parse(readPinnedGitObject(templateSpec));
  const janitorSource = readPinnedGitObject(janitorSpec);
  if (
    template.Resources?.CellJanitorFunction?.Properties?.Code?.ZipFile !==
    sourceMarker
  ) {
    throw new Error("Pinned deployed J4c child source marker is missing.");
  }
  template.Resources.CellJanitorFunction.Properties.Code.ZipFile = janitorSource;
  const rendered = `${JSON.stringify(template)}\n`;
  const raw = createHash("sha256").update(rendered, "utf8").digest("hex");
  const canonical = createHash("sha256")
    .update(canonicalJson(template), "utf8")
    .digest("hex");
  if (
    raw !== deployedJ4cChildRawSha256 ||
    canonical !== deployedJ4cChildCanonicalSha256
  ) {
    throw new Error("Pinned deployed J4c child snapshot failed its fixed hashes.");
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
      "usage: node render-b5-cell-bootstrap-j4c-deployed.mjs --output <path>",
    );
  }
  await writeFile(
    path.resolve(process.cwd(), output),
    await renderDeployedJ4cChildTemplate(),
    { encoding: "utf8", flag: "w" },
  );
  console.log(`Rendered fixed deployed B5-J4c child template: ${path.resolve(process.cwd(), output)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
