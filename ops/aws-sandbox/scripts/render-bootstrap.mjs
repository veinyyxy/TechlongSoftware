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

export async function renderBootstrapTemplate() {
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
  const rendered = renderCloudFormationTemplateDocument(template);
  // Keep direct TemplateBody below both the 51,200-byte API limit and the
  // stricter reviewed 50,000-byte headroom gate without changing resources.
  if (Buffer.byteLength(rendered, "utf8") > 50_000) {
    throw new Error(
      "rendered bootstrap template exceeds the reviewed direct-body limit",
    );
  }
  return rendered;
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    throw new Error(
      "usage: node render-bootstrap.mjs --output <absolute-or-relative-path>",
    );
  }
  const outputPath = path.resolve(process.cwd(), process.argv[outputIndex + 1]);
  const rendered = await renderBootstrapTemplate();
  await writeFile(outputPath, rendered, { encoding: "utf8", flag: "w" });
  console.log(`Rendered S3 bootstrap template: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
