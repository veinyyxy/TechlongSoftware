import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./verify-change-set-template.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function hash(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

async function main() {
  const expectedPath = argument("--expected");
  const actualPath = argument("--actual");
  const hashPath = argument("--hash");
  if (hashPath) {
    const value = JSON.parse(await readFile(path.resolve(hashPath), "utf8"));
    console.log(hash(value));
    return;
  }
  if (!expectedPath || !actualPath) {
    throw new Error(
      "usage: node verify-json-equality.mjs --expected <json> --actual <json> OR --hash <json>",
    );
  }
  const [expected, actual] = await Promise.all([
    readFile(path.resolve(expectedPath), "utf8").then(JSON.parse),
    readFile(path.resolve(actualPath), "utf8").then(JSON.parse),
  ]);
  const expectedCanonical = canonicalJson(expected);
  const actualCanonical = canonicalJson(actual);
  if (expectedCanonical !== actualCanonical) {
    throw new Error("JSON documents do not exactly match after canonicalization");
  }
  console.log(hash(expected));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
