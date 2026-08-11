import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-cell-bootstrap.template.json",
);
const janitorPath = path.join(root, "lambda", "cell-janitor.cjs");
const sourceMarker = "__CELL_JANITOR_INLINE_SOURCE__";
const maximumDirectTemplateBytes = 51_200;

export async function renderB5CellBootstrapTemplate() {
  const [templateSource, janitorSource] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(janitorPath, "utf8"),
  ]);
  const template = JSON.parse(templateSource);
  const currentSource =
    template.Resources?.CellJanitorFunction?.Properties?.Code?.ZipFile;
  if (currentSource !== sourceMarker) {
    throw new Error("B5 Cell bootstrap Janitor source marker is missing");
  }
  if (!janitorSource.includes('exports.handler = async (event) =>')) {
    throw new Error("B5 Cell Janitor source does not export the reviewed handler");
  }
  template.Resources.CellJanitorFunction.Properties.Code.ZipFile = janitorSource;
  const rendered = `${JSON.stringify(template)}\n`;
  if (Buffer.byteLength(rendered, "utf8") > maximumDirectTemplateBytes) {
    throw new Error(
      "rendered B5 Cell bootstrap exceeds the direct CloudFormation body limit",
    );
  }
  return rendered;
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    throw new Error(
      "usage: node render-b5-cell-bootstrap.mjs --output <absolute-or-relative-path>",
    );
  }
  const outputPath = path.resolve(process.cwd(), process.argv[outputIndex + 1]);
  const rendered = await renderB5CellBootstrapTemplate();
  await writeFile(outputPath, rendered, { encoding: "utf8", flag: "w" });
  console.log(`Rendered B5 Cell bootstrap template: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
