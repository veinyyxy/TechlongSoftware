import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-bootstrap.template.json",
);
const janitorPath = path.join(root, "lambda", "janitor.cjs");
const sourceMarker = "__JANITOR_INLINE_SOURCE__";

export async function renderBootstrapTemplate() {
  const [templateSource, janitorSource] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(janitorPath, "utf8"),
  ]);
  const template = JSON.parse(templateSource);
  const currentSource = template.Resources?.JanitorFunction?.Properties?.Code?.ZipFile;
  if (currentSource !== sourceMarker) {
    throw new Error("bootstrap template Janitor source marker is missing");
  }
  template.Resources.JanitorFunction.Properties.Code.ZipFile = janitorSource;
  // Keep the direct TemplateBody under 51,200 bytes so bootstrap does not
  // depend on an S3 bucket that the same stack is responsible for creating.
  const rendered = `${JSON.stringify(template)}\n`;
  if (Buffer.byteLength(rendered, "utf8") > 51_200) {
    throw new Error(
      "rendered bootstrap template exceeds the direct CloudFormation body limit",
    );
  }
  return rendered;
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    throw new Error("usage: node render-bootstrap.mjs --output <absolute-or-relative-path>");
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
