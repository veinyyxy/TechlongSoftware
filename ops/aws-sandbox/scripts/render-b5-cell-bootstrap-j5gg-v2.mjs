import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const deployedCommit = "6a4e2b29ea42922602e20dda40979c74cbe3cd21";
const templateSpec =
  `${deployedCommit}:ops/aws-sandbox/cloudformation/s3-b5-cell-bootstrap.template.json`;
const janitorSpec =
  `${deployedCommit}:ops/aws-sandbox/lambda/cell-janitor.cjs`;
const sourceMarker = "__CELL_JANITOR_INLINE_SOURCE__";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..", "..");

export const j5ggAuthorityV2ChildRawSha256 =
  "a768753c50de3fd3e13a1366ac5493768f794a0635c54274438c9606c1ad11e6";
export const j5ggAuthorityV2ChildCanonicalSha256 =
  "4f42f95d7e0b43b309d87acf2fb4795b136a1b40643d433e84606849d46d4673";

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

export async function renderJ5ggAuthorityV2ChildTemplate() {
  const template = JSON.parse(readPinnedGitObject(templateSpec));
  const janitorSource = readPinnedGitObject(janitorSpec);
  if (
    template.Resources?.CellJanitorFunction?.Properties?.Code?.ZipFile !==
    sourceMarker
  ) {
    throw new Error("Pinned J5g-g authority-v2 child source marker is missing.");
  }
  template.Resources.CellJanitorFunction.Properties.Code.ZipFile = janitorSource;
  const rendered = `${JSON.stringify(template)}\n`;
  const raw = createHash("sha256").update(rendered, "utf8").digest("hex");
  const canonical = createHash("sha256")
    .update(canonicalJson(template), "utf8")
    .digest("hex");
  if (
    raw !== j5ggAuthorityV2ChildRawSha256 ||
    canonical !== j5ggAuthorityV2ChildCanonicalSha256
  ) {
    throw new Error("Pinned J5g-g authority-v2 child failed its fixed hashes.");
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
      "usage: node render-b5-cell-bootstrap-j5gg-v2.mjs --output <path>",
    );
  }
  const outputPath = path.resolve(process.cwd(), output);
  await writeFile(outputPath, await renderJ5ggAuthorityV2ChildTemplate(), {
    encoding: "utf8",
    flag: "w",
  });
  console.log(`Rendered fixed J5g-g authority-v2 child template: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
