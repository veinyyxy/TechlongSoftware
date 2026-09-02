import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parseCloudFormationTemplateDocument } from "./cloudformation-template-document.mjs";

function optionValue(name) {
  const indexes = process.argv.flatMap((value, index) =>
    value === name ? [index] : [],
  );
  if (indexes.length !== 1) {
    throw new Error(`${name} must be provided exactly once`);
  }
  const value = process.argv[indexes[0] + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const expectedTemplatePath = optionValue("--expected-template");
const responsePath = optionValue("--get-policy-version-response");
const [templateSource, responseSource] = await Promise.all([
  readFile(expectedTemplatePath, "utf8"),
  readFile(responsePath, "utf8"),
]);
const template = parseCloudFormationTemplateDocument(
  templateSource,
  "Expected bootstrap template",
);
const response = JSON.parse(responseSource);
const expected =
  template.Resources?.ProvisionerBoundary?.Properties?.PolicyDocument;
const observed = response?.PolicyVersion?.Document;
assert.ok(expected && typeof expected === "object" && !Array.isArray(expected));
assert.ok(observed && typeof observed === "object" && !Array.isArray(observed));
assert.equal(response.PolicyVersion.IsDefaultVersion, true);
assert.match(response.PolicyVersion.VersionId, /^v[1-9][0-9]*$/);
assert.deepEqual(
  observed,
  expected,
  "deployed ProvisionerBoundary default policy document drifted from the exact rendered template",
);
process.stdout.write(
  createHash("sha256").update(canonicalJson(observed)).digest("hex"),
);
