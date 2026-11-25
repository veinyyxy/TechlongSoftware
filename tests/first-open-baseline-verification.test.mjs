import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const backendScripts = new URL("../ops/platform-hosting-v1/first-open-backend/scripts/", import.meta.url);
const oracleDirectory = fileURLToPath(new URL("./fixtures/first-open-baseline-python/", import.meta.url));
const oracleScript = path.join(oracleDirectory, "render_tenant_baseline_verification.py");
const renderer = fileURLToPath(new URL("render_tenant_baseline_verification.js", backendScripts));
const portablePython = path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const python = process.env.FIRST_OPEN_BASELINE_TEST_PYTHON ||
  (process.platform === "win32" ? (existsSync(portablePython) ? portablePython : "python") : "python3");
const pythonOptions = ["-B", "-X", "utf8"];
const archiveSha256 = "ab".repeat(32);
const sourceDatabase = "SyntheticTenantBaseline";
const profileName = "speedfeast-empty-schema/2026-10-05/v1";
const schemaFixture = new URL("./fixtures/first-open-baseline-verification/schema-profile.sql", import.meta.url);
const table = (name, rows = 0, schema = "public") => ({ schema, table: name, rows });
const entry = (name) => "TABLE public " + name + " fixture_owner";
const schemaOnly = (tables, options = {}) => ({
  format: "speedfeast-database-migration-manifest/v1",
  purpose: "tenant_bootstrap",
  sourceDatabase,
  archiveSha256,
  dataPolicy: "schema_only",
  tables,
  ...options,
});

const profileTables = ["stores", "system_config", "cartitem", "cart", "saas_instances"];
const profileObjects = [
  "EXTENSION uuid-ossp",
  "FUNCTION public.default_saas_instance_id()",
  "FUNCTION public.default_store_id()",
  "FUNCTION public.refresh_cart_subtotal(uuid)",
  "FUNCTION public.refresh_cart_subtotal_trigger()",
  "FUNCTION public.set_updated_at()",
  "TRIGGER public.cart.trg_cart_set_updated_at",
  "TRIGGER public.cartitem.trg_cartitem_refresh_cart_subtotal",
  "TRIGGER public.cartitem.trg_cartitem_set_updated_at",
  "TRIGGER public.system_config.trg_system_config_set_updated_at",
];
const profileEntries = [
  "ENCODING - ENCODING",
  "STDSTRINGS - STDSTRINGS",
  "SEARCHPATH - SEARCHPATH",
  "SCHEMA - public fixture_owner",
  "EXTENSION - uuid-ossp",
  "FUNCTION public default_saas_instance_id() fixture_owner",
  "FUNCTION public default_store_id() fixture_owner",
  "FUNCTION public refresh_cart_subtotal(uuid) fixture_owner",
  "FUNCTION public refresh_cart_subtotal_trigger() fixture_owner",
  "FUNCTION public set_updated_at() fixture_owner",
  ...profileTables.map(entry),
  "TRIGGER public cart trg_cart_set_updated_at fixture_owner",
  "TRIGGER public cartitem trg_cartitem_refresh_cart_subtotal fixture_owner",
  "TRIGGER public cartitem trg_cartitem_set_updated_at fixture_owner",
  "TRIGGER public system_config trg_system_config_set_updated_at fixture_owner",
];

function tocText(entries, newline = "\n") {
  return ["; Synthetic pg_restore --list", "", ...entries.map((body, i) => (i + 1) + "; 0 0 " + body), ""].join(newline);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 15_000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

async function compare({ manifest, entries, toc, schema, rejection }) {
  const directory = await mkdtemp(path.join(tmpdir(), "first-open-baseline-"));
  const [manifestPath, tocPath, schemaPath, expectedPath, actualPath] =
    ["manifest.json", "restore.toc", "schema.sql", "expected.sql", "actual.sql"].map((name) => path.join(directory, name));
  try {
    await writeFile(manifestPath, typeof manifest === "string" ? manifest : JSON.stringify(manifest), "utf8");
    await writeFile(tocPath, toc ?? tocText(entries), "utf8");
    if (schema !== undefined) await writeFile(schemaPath, schema, "utf8");
    const args = (output) => [manifestPath, archiveSha256.toUpperCase(), sourceDatabase, tocPath, output,
      ...(schema !== undefined ? [schemaPath] : [])];
    const expected = run(python, [...pythonOptions, oracleScript, ...args(expectedPath)]);
    const actual = run(process.execPath, [renderer, ...args(actualPath)]);
    const status = rejection ? 1 : 0;
    assert.equal(expected.status, status, expected.stderr);
    assert.equal(actual.status, status, actual.stderr);
    assert.equal(actual.stdout, expected.stdout);
    if (rejection) {
      assert.match(expected.stderr, rejection);
      assert.equal(actual.stderr.trimEnd(), expected.stderr.trimEnd());
      await assert.rejects(readFile(expectedPath), { code: "ENOENT" });
      await assert.rejects(readFile(actualPath), { code: "ENOENT" });
      return;
    }
    assert.equal(expected.stderr, "");
    assert.equal(actual.stderr, "");
    const expectedSql = await readFile(expectedPath);
    const actualSql = await readFile(actualPath);
    assert.deepEqual(actualSql, expectedSql);
    return actualSql.toString("utf8");
  } finally {
    for (const file of [manifestPath, tocPath, schemaPath, expectedPath, actualPath]) {
      await unlink(file).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await rmdir(directory);
  }
}

test("JavaScript verifies the reviewed pg_restore schema profile like the Python original", async (t) => {
  const schema = (await readFile(schemaFixture, "utf8")).replaceAll("\r\n", "\n");
  const manifest = schemaOnly(profileTables.map((name) => table(name)), {
    schemaProfile: profileName,
    schemaObjectAllowlist: profileObjects,
  });
  const valid = { manifest, entries: profileEntries, schema };
  await t.test("reviewed extension, functions, triggers and all declared tables", async () => {
    const sql = await compare(valid);
    assert.match(sql, /IF actual_rows <> 0 THEN/);
    assert.match(sql, /Schema profile extension mismatch/);
    assert.match(sql, /Schema profile function mismatch/);
    assert.match(sql, /Schema profile trigger mismatch/);
  });
  await t.test("universal newlines at the CLI inputs and LF verification bytes", async () => {
    for (const newline of ["\r\n", "\r"]) {
      const sql = await compare({ ...valid, schema: schema.replaceAll("\n", newline), toc: tocText(profileEntries, newline) });
      assert.ok(!sql.includes("\r"));
      assert.ok(sql.endsWith("$speedfeast_verify_profile$;\n"));
    }
    await compare({ ...valid, toc: tocText(profileEntries, "\u0085").replace("\u0085", "\u2028") });
  });
  const failures = [
    ["extra TOC table", { entries: [...profileEntries, entry("unexpected")] }, /TABLE is not declared/],
    ["missing TOC table", { entries: profileEntries.filter((value) => value !== entry("stores")) }, /missing:public\.stores/],
    ["duplicate TOC table", { entries: [...profileEntries, entry("CART")] }, /duplicate table: public\.CART/],
    ["missing required manifest table", {
      manifest: { ...manifest, tables: manifest.tables.filter(({ table: name }) => name !== "stores") },
    }, /requires its referenced business tables/],
    ["changed function body", { schema: schema.replace("NEW.updated_at = now();", "NEW.updated_at = NULL;") },
      /executable definition differs from reviewed code/],
    ["missing trigger SQL", { schema: schema.slice(0, schema.lastIndexOf("--\n-- Name: ")) },
      /Profile SQL is missing required executable objects/],
    ["missing trigger TOC", { entries: profileEntries.slice(0, -1) }, /Restore TOC is missing required profile objects/],
    ["different extension TOC", { entries: profileEntries.map((value) => value.replace("uuid-ossp", "pgcrypto")) },
      /Restore TOC contains an unreviewed extension/],
    ["different extension SQL", { schema: schema.replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"', "CREATE EXTENSION IF NOT EXISTS pgcrypto") },
      /executable definition differs from reviewed code/],
    ["no offline schema SQL", { schema: undefined }, /Profile requires bounded offline schema SQL/],
  ];
  for (const [name, changes, rejection] of failures) {
    await t.test(name, () => compare({ ...valid, ...changes, rejection }));
  }
});

test("JavaScript retains the legacy schema-only and seed manifest policy", async (t) => {
  const legacyFunction = "FUNCTION public default_store_id() fixture_owner";
  const approvedSeeds = ["merchant_permissions", "merchant_role_permissions"];
  const seedEntries = approvedSeeds.flatMap((name) => [entry(name), "TABLE DATA public " + name + " fixture_owner"]);
  const seed = (tables, seedTableAllowlist = approvedSeeds.map((name) => "public." + name)) =>
    schemaOnly(tables, { dataPolicy: "allowlisted_seed_tables", seedTableAllowlist });

  await t.test("legacy schema-only supports multiple tables and the approved function", async () => {
    const sql = await compare({
      manifest: schemaOnly([table("stores"), table("Order")], { schemaObjectAllowlist: ["FUNCTION public.default_store_id()"] }),
      entries: [entry("stores"), entry("Order"), legacyFunction],
    });
    assert.match(sql, /FROM "public"\."Order";/);
    assert.ok(!sql.includes("$speedfeast_verify_profile$"));
  });
  await t.test("approved seed rows keep exact bigint SQL literals", async () => {
    const manifest = JSON.stringify(seed(
      [table(approvedSeeds[1], "BIGINT_MAX"), table(approvedSeeds[0], "ABOVE_SAFE_INTEGER"), table("Order")],
      ["PUBLIC.MERCHANT_PERMISSIONS", "public.merchant_role_permissions"],
    )).replace('"BIGINT_MAX"', "9223372036854775807").replace('"ABOVE_SAFE_INTEGER"', "9007199254740993");
    const sql = await compare({ manifest, entries: [...seedEntries, entry("Order")] });
    for (const count of ["9223372036854775807", "9007199254740993"]) {
      assert.ok(sql.includes("IF actual_rows <> " + count + " THEN"));
      assert.ok(sql.includes(", " + count + ", actual_rows;"));
    }
  });
  for (const token of ["9223372036854775808", "-1", "1e0", "1.0", "true", '"1"']) {
    await t.test("invalid JSON row count " + token, () => compare({
      manifest: JSON.stringify(seed([table(approvedSeeds[0], "COUNT")], ["public.merchant_permissions"]))
        .replace('"COUNT"', token),
      entries: seedEntries.slice(0, 2),
      rejection: /invalid row count for public\.merchant_permissions/,
    }));
  }

  const rejected = [
    ["legacy extension", schemaOnly([table("cart")]), [entry("cart"), "EXTENSION - uuid-ossp"],
      /object type is forbidden for tenant bootstrap: EXTENSION/],
    ["legacy arbitrary function", schemaOnly([table("cart")]), [entry("cart"), "FUNCTION public arbitrary() fixture_owner"],
      /FUNCTION is not approved/],
    ["legacy function without exact manifest authorization", schemaOnly([table("cart")]), [entry("cart"), legacyFunction],
      /schema object is not approved by the manifest/],
    ["schema-only table data", schemaOnly([table("cart")]), [entry("cart"), "TABLE DATA public cart fixture_owner"],
      /TABLE DATA is forbidden/],
    ["schema-only seed allowlist", schemaOnly([table("cart")], { seedTableAllowlist: ["public.cart"] }), [entry("cart")],
      /schema_only tenant bootstrap cannot declare seedTableAllowlist/],
    ["sensitive rows even with a seed allowlist", seed([table("Order", 1)], ["public.Order"]), [entry("Order")],
      /sensitive business tables must have zero rows/],
    ["business table outside the application seed policy", seed([table("cart")], ["public.cart"]), [entry("cart")],
      /tables not approved by application policy/],
    ["case-fold duplicate seed names", seed([table(approvedSeeds[0])], ["public.merchant_permissions", "PUBLIC.MERCHANT_PERMISSIONS"]),
      seedEntries.slice(0, 2), /seedTableAllowlist contains duplicate entries/],
    ["seed rows outside allowlist", seed([table(approvedSeeds[0]), table("cart", 1)], ["public.merchant_permissions"]),
      [...seedEntries.slice(0, 2), entry("cart")], /rows outside seedTableAllowlist/],
    ["duplicated seed TOC data", seed(approvedSeeds.map((name) => table(name)), approvedSeeds.map((name) => "public." + name)),
      [...seedEntries, seedEntries[1]], /duplicate TABLE DATA/],
  ];
  for (const [name, manifest, entries, rejection] of rejected) {
    await t.test(name, () => compare({ manifest, entries, rejection }));
  }
});

test("JavaScript matches Python identifier case folding, ordering and ASCII TOC checks", async (t) => {
  await t.test("case-fold names for membership and preserve spelling in exact SQL", async () => {
    const names = ["Kiosk", "Zulu", "ſtores", "Kite", "Alpha"];
    const sql = await compare({
      manifest: schemaOnly(names.map((name) => table(name, 0, "PUBLIC"))),
      entries: ["kiosk", "ZULU", "stores", "kite", "ALPHA"].map(entry),
    });
    assert.match(sql, /FROM "PUBLIC"\."ſtores";/);
    assert.match(sql, /\('PUBLIC', 'Alpha'\),\n    \('PUBLIC', 'Kite'\),\n    \('PUBLIC', 'Zulu'\),\n    \('PUBLIC', 'ſtores'\),\n    \('PUBLIC', 'Kiosk'\)/);
  });
  const rejected = [
    ["Unicode full-fold duplicate", ["Straße", "STRASSE"], [entry("strasse")], /Manifest contains a duplicate table/],
    ["dotless i remains distinct", ["kıosk"], [entry("kiosk")], /TABLE is not declared/],
    ["TOC identifier stays ASCII", ["Kiosk"], [entry("Kiosk")], /invalid table identifier/],
  ];
  for (const [name, names, entries, rejection] of rejected) {
    await t.test(name, () => compare({ manifest: schemaOnly(names.map((name) => table(name))), entries, rejection }));
  }
});

test("JavaScript profile exports give the original executable hashes and verification SQL", async () => {
  const profile = require(fileURLToPath(new URL("tenant_baseline_schema_profile.js", backendScripts)));
  const fixturePath = fileURLToPath(schemaFixture);
  const oracle = run(python, [...pythonOptions, "-c", [
    "import json, pathlib, sys",
    "sys.path.insert(0, sys.argv[1])",
    "import tenant_baseline_schema_profile as profile",
    "schema = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')",
    "print(json.dumps([profile.PROFILE, profile.PROGRAMS, sorted(profile.REQUIRED_TABLES),",
    "    profile.validate_program_sql(schema), profile.render_profile_verification_sql()]))",
  ].join("\n"), oracleDirectory, fixturePath]);
  assert.equal(oracle.status, 0, oracle.stderr);
  const [expectedProfile, expectedPrograms, expectedTables, expectedHashes, expectedVerification] = JSON.parse(oracle.stdout);
  const schema = (await readFile(fixturePath, "utf8")).replaceAll("\r\n", "\n");
  assert.equal(profile.PROFILE, expectedProfile);
  assert.deepEqual(Object.entries(profile.PROGRAMS), Object.entries(expectedPrograms));
  assert.deepEqual([...profile.REQUIRED_TABLES].sort(), expectedTables);
  assert.deepEqual(Object.entries(profile.validateProgramSql(schema.replaceAll("\n", "\r\n"))), Object.entries(expectedHashes));
  assert.equal(profile.renderProfileVerificationSql(), expectedVerification);
});
