// Explicit external test-engine path only; no Neon credentials, application dependency or network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readCompensationSchema } from "../../../scripts/shared-cell-author-compensation-schema.ts";
const enginePath = process.argv[2];
if (!enginePath) throw new Error("An explicit external PGlite module path is required.");
const { PGlite } = await import(pathToFileURL(enginePath).href);
const db = await PGlite.create();
try {
  await db.exec("SET search_path = public, pg_catalog; CREATE TABLE deployment_environments(id text PRIMARY KEY); BEGIN;");
  for (const filename of ["0009_shared_cell_author_compensation_persistence.sql", "0010_shared_cell_author_compensation_grant_lifecycle.sql"]) {
    const sql = await readFile(new URL(`../../../db/postgres-migrations/${filename}`, import.meta.url), "utf8");
    await db.exec(sql.replace(/\r\n?/g, "\n"));
  }
  const schema = await readCompensationSchema(db);
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const schemaSha256 = createHash("sha256").update(JSON.stringify(canonical(schema))).digest("hex");
  assert.equal(schema.columns.length, 77);
  await db.exec("ROLLBACK;");
  assert.equal((await readCompensationSchema(db)).relations.length, 0);
  console.log(JSON.stringify({ engine: "PGlite 0.5.8", version: (await db.query("SHOW server_version_num")).rows[0].server_version_num, schemaSha256, schema }));
} finally { await db.close(); }
