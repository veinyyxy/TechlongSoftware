import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonTemplate(value, label) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!object(parsed)) {
    throw new Error(`${label} must be one JSON template object.`);
  }
  return parsed;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (object(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalTemplateSha256(template) {
  return createHash("sha256")
    .update(canonicalJson(parseJsonTemplate(template, "Template")), "utf8")
    .digest("hex");
}

export function assertExactChangeSetTemplate(expectedTemplate, getTemplateResponse) {
  if (!object(getTemplateResponse) || getTemplateResponse.TemplateBody === undefined) {
    throw new Error("CloudFormation GetTemplate response is missing TemplateBody.");
  }
  const expected = parseJsonTemplate(expectedTemplate, "Expected template");
  const actual = parseJsonTemplate(
    getTemplateResponse.TemplateBody,
    "CloudFormation Change Set TemplateBody",
  );
  const expectedCanonical = canonicalJson(expected);
  const actualCanonical = canonicalJson(actual);
  if (actualCanonical !== expectedCanonical) {
    throw new Error(
      "CloudFormation Change Set TemplateBody does not exactly match the locally rendered reviewed template.",
    );
  }
  return canonicalTemplateSha256(expected);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const hashPath = argument("--hash-template");
  if (hashPath) {
    const template = JSON.parse(await readFile(path.resolve(hashPath), "utf8"));
    console.log(canonicalTemplateSha256(template));
    return;
  }

  const expectedPath = argument("--expected-template");
  const responsePath = argument("--get-template-response");
  if (!expectedPath || !responsePath) {
    throw new Error(
      "usage: node verify-change-set-template.mjs --hash-template <template> OR --expected-template <template> --get-template-response <response>",
    );
  }
  const [expectedTemplate, response] = await Promise.all([
    readFile(path.resolve(expectedPath), "utf8").then(JSON.parse),
    readFile(path.resolve(responsePath), "utf8").then(JSON.parse),
  ]);
  console.log(assertExactChangeSetTemplate(expectedTemplate, response));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
