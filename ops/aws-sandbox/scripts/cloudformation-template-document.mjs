import { isDeepStrictEqual } from "node:util";

import yaml from "js-yaml";

const MAX_TEMPLATE_DOCUMENT_BYTES = 1_048_576;
const MAX_TEMPLATE_DEPTH = 100;
const MAX_TEMPLATE_NODES = 100_000;
// Inputs stay restricted to JSON values. Adding the timestamp resolver only to
// dumping makes date-like strings (notably AWSTemplateFormatVersion) quoted for
// CloudFormation's YAML parser; strict loading still uses JSON_SCHEMA alone.
const CLOUDFORMATION_DUMP_SCHEMA = yaml.JSON_SCHEMA.extend({
  implicit: [yaml.types.timestamp],
});
const FORBIDDEN_MAPPING_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "<<",
]);

function assertJsonDataModel(value, label) {
  const seen = new WeakSet();
  let nodes = 0;

  function visit(current, path, depth) {
    nodes += 1;
    if (nodes > MAX_TEMPLATE_NODES) {
      throw new Error(`${label} exceeds the bounded JSON node count.`);
    }
    if (depth > MAX_TEMPLATE_DEPTH) {
      throw new Error(`${label} exceeds the bounded JSON nesting depth.`);
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error(`${label} contains a non-finite number at ${path}.`);
      }
      return;
    }
    if (typeof current !== "object") {
      throw new Error(`${label} contains a non-JSON value at ${path}.`);
    }
    if (seen.has(current)) {
      throw new Error(`${label} contains an alias or repeated object at ${path}.`);
    }
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} contains a non-JSON mapping at ${path}.`);
    }
    for (const [key, entry] of Object.entries(current)) {
      if (FORBIDDEN_MAPPING_KEYS.has(key)) {
        throw new Error(`${label} contains forbidden mapping key ${key} at ${path}.`);
      }
      visit(entry, `${path}.${key}`, depth + 1);
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be one template object.`);
  }
  visit(value, "$", 0);
  return value;
}

export function parseCloudFormationTemplateDocument(value, label = "Template") {
  if (value && typeof value === "object") {
    return assertJsonDataModel(value, label);
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a JSON or YAML template document.`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_TEMPLATE_DOCUMENT_BYTES) {
    throw new Error(`${label} exceeds the bounded template document size.`);
  }

  let observedAnchor = false;
  let parsed;
  try {
    parsed = yaml.load(value, {
      schema: yaml.JSON_SCHEMA,
      json: false,
      listener: (_event, state) => {
        if (typeof state.anchor === "string") observedAnchor = true;
      },
    });
  } catch (error) {
    throw new Error(
      `${label} is not strict JSON-or-YAML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (observedAnchor) {
    throw new Error(`${label} may not contain YAML anchors or aliases.`);
  }
  return assertJsonDataModel(parsed, label);
}

export function renderCloudFormationTemplateDocument(template) {
  const reviewed = assertJsonDataModel(template, "Template");
  const rendered = yaml.dump(reviewed, {
    schema: CLOUDFORMATION_DUMP_SCHEMA,
    noRefs: true,
    // CloudFormation treats a document beginning with "{" as JSON before it
    // considers YAML. Keep the root mapping in block form while compacting all
    // nested collections in flow form.
    flowLevel: 1,
    lineWidth: -1,
    sortKeys: false,
  });
  const reparsed = parseCloudFormationTemplateDocument(
    rendered,
    "Rendered template",
  );
  if (!isDeepStrictEqual(reparsed, reviewed)) {
    throw new Error("Rendered YAML did not preserve the exact template object.");
  }
  return rendered;
}
