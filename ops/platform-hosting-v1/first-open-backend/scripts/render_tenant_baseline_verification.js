"use strict";

const { statSync, writeFileSync } = require("node:fs");
const {
  caseFold, compareCodePoints, PYTHON_WHITESPACE, readPythonUtf8Text,
  splitPythonLines, splitPythonWhitespace, stripPythonWhitespace,
} = require("./tenant_baseline_text.js");

const MANIFEST_FORMAT = "speedfeast-database-migration-manifest/v1";
const TENANT_BOOTSTRAP_PURPOSE = "tenant_bootstrap";
const SCHEMA_ONLY_POLICY = "schema_only";
const ALLOWLISTED_SEED_POLICY = "allowlisted_seed_tables";
const MAX_RESTORE_TOC_ENTRIES = 20_000;
const MAX_ROW_COUNT = 9_223_372_036_854_775_807n;
const MAX_PROFILE_SQL_BYTES = 8_000_000;
const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/u;
const INTEGER_JSON_TOKEN = /^-?(?:0|[1-9][0-9]*)$/u;
const TOC_LINE = new RegExp(
  `^([0-9]+);${PYTHON_WHITESPACE}+([0-9]+)${PYTHON_WHITESPACE}+([0-9]+)${PYTHON_WHITESPACE}+(.+)$`, "u",
);

function pairKey(schema, name) {
  return JSON.stringify([schema, name]);
}

function tableKey(schema, name) {
  return pairKey(caseFold(schema), caseFold(name));
}

function tableKeyName(key) {
  return JSON.parse(key).join(".");
}

function compareTablePairs(left, right) {
  return compareCodePoints(left[0], right[0]) || compareCodePoints(left[1], right[1]);
}

// A manifest cannot authorize its own seed data or executable functions.
const APPROVED_SEED_TABLES = new Set([
  pairKey("public", "merchant_permissions"),
  pairKey("public", "merchant_role_permissions"),
]);
const APPROVED_FUNCTIONS = new Set([
  pairKey("public", "default_saas_instance_id()"),
  pairKey("public", "default_store_id()"),
]);

const KNOWN_TOC_DESCRIPTORS = [
  "ACCESS METHOD", "ACL", "AGGREGATE", "BLOB COMMENTS", "BLOBS", "BLOB", "CAST", "CHECK CONSTRAINT",
  "COLLATION", "COMMENT", "CONSTRAINT", "CONVERSION", "DATABASE PROPERTIES", "DEFAULT ACL", "DEFAULT",
  "DOMAIN CONSTRAINT", "DOMAIN", "ENCODING", "EVENT TRIGGER", "EXTENSION", "FK CONSTRAINT",
  "FOREIGN DATA WRAPPER", "FOREIGN SERVER", "FOREIGN TABLE", "FUNCTION", "INDEX ATTACH", "INDEX",
  "MATERIALIZED VIEW DATA", "MATERIALIZED VIEW", "OPERATOR CLASS", "OPERATOR FAMILY", "OPERATOR",
  "POLICY", "PROCEDURE", "PUBLICATION TABLE", "PUBLICATION", "ROW SECURITY", "RULE", "SCHEMA",
  "SEARCHPATH", "SECURITY LABEL", "SEQUENCE OWNED BY", "SEQUENCE SET", "SEQUENCE", "SERVER", "STATISTICS",
  "STDSTRINGS", "TABLE ATTACH", "TABLE DATA", "TABLE", "TEXT SEARCH CONFIGURATION", "TEXT SEARCH DICTIONARY",
  "TEXT SEARCH PARSER", "TEXT SEARCH TEMPLATE", "TRANSFORM", "TRIGGER", "TYPE", "USER MAPPING", "VIEW",
].sort((left, right) => right.length - left.length);

const SENSITIVE_TABLE_NAMES = new Set([
  "order", "orders", "orderitems", "order_items", "orderitem_options", "users", "stores", "store_customers",
  "store_products", "store_categories", "store_product_categories", "dining_tables", "media_assets",
  "product_images", "saas_instances", "saas_entitlements", "saas_licenses", "saas_access_leases",
  "saas_usage_snapshots", "saas_provisioning_operations", "saas_audit_logs",
]);
const SENSITIVE_NAME_FRAGMENT =
  /(user|customer|order|payment|refund|review|notification|device_token|loyalty|reward|redemption|audit|license|access_lease)/u;

class ManifestValidationError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new ManifestValidationError(message);
}

function sqlIdentifier(value) {
  requireCondition(typeof value === "string" && value.length > 0 && !value.includes("\0"),
    "Manifest contains an invalid PostgreSQL identifier");
  return '"' + value.replaceAll('"', '""') + '"';
}

function sqlLiteral(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function normalizedTableKey(value) {
  requireCondition(typeof value === "string" && value.split(".").length === 2,
    "seedTableAllowlist entries must use schema.table names");
  const [schema, name] = value.split(".");
  sqlIdentifier(schema);
  sqlIdentifier(name);
  return tableKey(schema, name);
}

function isSensitiveTable(name) {
  const normalized = caseFold(name);
  return SENSITIVE_TABLE_NAMES.has(normalized) || SENSITIVE_NAME_FRAGMENT.test(normalized);
}

function requireSimpleIdentifier(value, description) {
  requireCondition(typeof value === "string" && SIMPLE_IDENTIFIER.test(value),
    `Restore TOC contains an invalid ${description} identifier`);
}

function tocDescriptor(payload) {
  for (const descriptor of KNOWN_TOC_DESCRIPTORS) {
    if (payload === descriptor || payload.startsWith(descriptor + " ")) {
      return [descriptor, splitPythonWhitespace(payload.slice(descriptor.length))];
    }
  }
  throw new ManifestValidationError("Restore TOC contains an unknown or unapproved object descriptor");
}

function validateRestoreToc(tocText, manifest, normalized, programSql) {
  let profileObjects = new Set();
  if (manifest.schemaProfile != null) {
    const { PROFILE, validateProgramSql } = require("./tenant_baseline_schema_profile.js");
    requireCondition(manifest.schemaProfile === PROFILE && manifest.dataPolicy === SCHEMA_ONLY_POLICY,
      "Unsupported executable schema profile");
    profileObjects = new Set(Object.keys(validateProgramSql(programSql)));
  }
  const usedProfileObjects = new Set();
  function requireProfileObject(value) {
    requireCondition(profileObjects.has(value) && !usedProfileObjects.has(value),
      "Restore TOC contains an unknown or duplicate profile object");
    usedProfileObjects.add(value);
  }

  const manifestTables = new Set(normalized.map(([schema, name]) => tableKey(schema, name)));
  const allowedTableData = new Set(manifest.dataPolicy === ALLOWLISTED_SEED_POLICY
    ? manifest.seedTableAllowlist.map(normalizedTableKey) : []);

  const rawSchemaAllowlist = manifest.schemaObjectAllowlist === undefined ? [] : manifest.schemaObjectAllowlist;
  requireCondition(Array.isArray(rawSchemaAllowlist), "schemaObjectAllowlist must be an array");
  const schemaObjectAllowlist = new Set();
  for (const value of rawSchemaAllowlist) {
    requireCondition(typeof value === "string" && value.length > 0 &&
      Array.from(value).length <= 512 && !/[\r\n\0]/u.test(value), "schemaObjectAllowlist contains an invalid entry");
    schemaObjectAllowlist.add(value);
  }
  requireCondition(schemaObjectAllowlist.size === rawSchemaAllowlist.length,
    "schemaObjectAllowlist contains duplicate entries");

  const usedSchemaObjects = new Set();
  function requireManifestSchemaObject(value) {
    requireCondition(schemaObjectAllowlist.has(value),
      `Restore TOC schema object is not approved by the manifest: ${value}`);
    usedSchemaObjects.add(value);
  }

  const seenDumpIds = new Set();
  const tocTables = new Set();
  const tableDataEntries = new Set();
  let entryCount = 0;
  for (const [index, rawLine] of splitPythonLines(tocText).entries()) {
    const line = stripPythonWhitespace(rawLine);
    if (!line || line.startsWith(";")) continue;
    const match = TOC_LINE.exec(line);
    requireCondition(match !== null, `Restore TOC line ${index + 1} has an invalid format`);
    const [, dumpId, , , payload] = match;
    requireCondition(!seenDumpIds.has(dumpId), "Restore TOC contains duplicate dump IDs");
    seenDumpIds.add(dumpId);
    entryCount++;
    requireCondition(entryCount <= MAX_RESTORE_TOC_ENTRIES, "Restore TOC exceeds the maximum approved entry count");

    const [descriptor, details] = tocDescriptor(payload);
    if (["ENCODING", "STDSTRINGS", "SEARCHPATH"].includes(descriptor)) {
      requireCondition(details.length >= 2 && details[0] === "-" && details[1] === descriptor,
        `Restore TOC contains an invalid ${descriptor} metadata entry`);
      continue;
    }
    if (descriptor === "SCHEMA") {
      requireCondition(details.length >= 3 && details[0] === "-" && details[1] === "public",
        "Restore TOC may create only the public schema");
      continue;
    }
    if (descriptor === "TABLE" || descriptor === "TABLE DATA") {
      requireCondition(details.length >= 3, `Restore TOC contains an invalid ${descriptor} entry`);
      const [schema, name] = details;
      requireSimpleIdentifier(schema, "schema");
      requireSimpleIdentifier(name, "table");
      const key = tableKey(schema, name);
      requireCondition(caseFold(schema) === "public" && manifestTables.has(key),
        `Restore TOC ${descriptor} is not declared by the manifest: ${schema}.${name}`);
      if (descriptor === "TABLE") {
        requireCondition(!tocTables.has(key), `Restore TOC contains a duplicate table: ${schema}.${name}`);
        tocTables.add(key);
      } else {
        requireCondition(allowedTableData.has(key), `Restore TOC TABLE DATA is forbidden for tenant table: ${schema}.${name}`);
        requireCondition(!tableDataEntries.has(key), `Restore TOC contains duplicate TABLE DATA: ${schema}.${name}`);
        tableDataEntries.add(key);
      }
      continue;
    }
    if (descriptor === "SEQUENCE" || descriptor === "SEQUENCE OWNED BY" || descriptor === "INDEX") {
      const [schema, name] = details;
      requireCondition(details.length >= 3 && caseFold(schema) === "public",
        `Restore TOC contains an invalid ${descriptor} entry`);
      const objectType = descriptor === "INDEX" ? "INDEX" : "SEQUENCE";
      requireSimpleIdentifier(schema, "schema");
      requireSimpleIdentifier(name, objectType.toLowerCase());
      requireManifestSchemaObject(`${objectType} ${schema}.${name}`);
      continue;
    }
    if (["DEFAULT", "CONSTRAINT", "CHECK CONSTRAINT", "FK CONSTRAINT"].includes(descriptor)) {
      requireCondition(details.length >= 4, `Restore TOC contains an invalid ${descriptor} entry`);
      const [schema, table, object] = details;
      requireSimpleIdentifier(schema, "schema");
      requireSimpleIdentifier(table, "table");
      requireSimpleIdentifier(object, descriptor === "DEFAULT" ? "column" : "constraint");
      requireCondition(manifestTables.has(tableKey(schema, table)),
        `Restore TOC ${descriptor} targets an undeclared table: ${schema}.${table}`);
      requireManifestSchemaObject(`${descriptor} ${schema}.${table}.${object}`);
      continue;
    }
    if (descriptor === "FUNCTION") {
      requireCondition(details.length >= 3, "Restore TOC contains an invalid FUNCTION entry");
      const [schema, name] = details;
      const value = `FUNCTION ${schema}.${name}`;
      if (profileObjects.size) {
        requireCondition(details.length === 3, "Invalid profile function TOC entry");
        requireProfileObject(value);
      } else {
        requireCondition(APPROVED_FUNCTIONS.has(tableKey(schema, name)),
          `Restore TOC FUNCTION is not approved: ${schema}.${name}`);
      }
      requireManifestSchemaObject(value);
      continue;
    }
    if (descriptor === "EXTENSION" && profileObjects.size) {
      // pg_dump may leave the extension owner field empty.
      requireCondition((details.length === 2 || details.length === 3) &&
        details[0] === "-" && details[1] === "uuid-ossp", "Restore TOC contains an unreviewed extension");
      requireProfileObject("EXTENSION uuid-ossp");
      requireManifestSchemaObject("EXTENSION uuid-ossp");
      continue;
    }
    if (descriptor === "TRIGGER" && profileObjects.size) {
      requireCondition(details.length === 4 && manifestTables.has(pairKey(details[0], details[1])),
        "Restore TOC trigger targets an undeclared table");
      const value = `TRIGGER ${details[0]}.${details[1]}.${details[2]}`;
      requireProfileObject(value);
      requireManifestSchemaObject(value);
      continue;
    }

    // Every descriptor without a reviewed handling branch is denied.
    throw new ManifestValidationError(`Restore TOC object type is forbidden for tenant bootstrap: ${descriptor}`);
  }

  requireCondition(entryCount > 0, "Restore TOC does not contain any entries");
  requireCondition(usedProfileObjects.size === profileObjects.size, "Restore TOC is missing required profile objects");
  if (tocTables.size !== manifestTables.size) {
    const missing = [...manifestTables].filter(key => !tocTables.has(key)).map(key => JSON.parse(key));
    const unexpected = [...tocTables].filter(key => !manifestTables.has(key)).map(key => JSON.parse(key));
    const details = [
      ...missing.sort(compareTablePairs).map(([schema, name]) => `missing:${schema}.${name}`),
      ...unexpected.sort(compareTablePairs).map(([schema, name]) => `unexpected:${schema}.${name}`),
    ];
    throw new ManifestValidationError("Restore TOC table set differs from the manifest: " + details.join(", "));
  }
  const unused = [...schemaObjectAllowlist].filter(value => !usedSchemaObjects.has(value));
  requireCondition(unused.length === 0, "schemaObjectAllowlist contains entries absent from the restore TOC: " +
    unused.sort(compareCodePoints).join(", "));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedTableNames(keys) {
  return keys.map(tableKeyName).sort(compareCodePoints).join(", ");
}

function pythonArchiveHash(value) {
  if (value === undefined) return "";
  if (value === null) return "none";
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
    if (Object.is(value, -0)) return "-0.0";
    // Python's float rendering uses scientific notation outside this exponent range.
    const [coefficient, exponentText] = value.toExponential().split("e");
    const exponent = Number(exponentText);
    if (exponent < -4 || exponent >= 16) {
      return coefficient + "e" + (exponent < 0 ? "-" : "+") + String(Math.abs(exponent)).padStart(2, "0");
    }
    return Number.isInteger(value) ? value.toFixed(1) : String(value);
  }
  return null;
}

function validateManifest(manifest, archiveSha256, sourceDatabaseName) {
  requireCondition(isObject(manifest), "Migration manifest must be a JSON object");
  requireCondition(manifest.format === MANIFEST_FORMAT, "Unsupported migration manifest format");
  requireCondition(manifest.purpose === TENANT_BOOTSTRAP_PURPOSE,
    "Manifest purpose must be tenant_bootstrap; general database exports are forbidden");
  requireCondition(manifest.sourceDatabase === sourceDatabaseName,
    "Manifest sourceDatabase does not match MIGRATION_CONFIRM_SOURCE_DATABASE");
  requireCondition(pythonArchiveHash(manifest.archiveSha256) === archiveSha256,
    "Manifest archiveSha256 does not match the downloaded archive");

  const { dataPolicy, tables } = manifest;
  requireCondition(dataPolicy === SCHEMA_ONLY_POLICY || dataPolicy === ALLOWLISTED_SEED_POLICY,
    "Manifest dataPolicy must be schema_only or allowlisted_seed_tables");
  if (manifest.schemaProfile != null) {
    const { PROFILE } = require("./tenant_baseline_schema_profile.js");
    requireCondition(manifest.schemaProfile === PROFILE && dataPolicy === SCHEMA_ONLY_POLICY,
      "Unsupported executable schema profile");
  }
  requireCondition(Array.isArray(tables) && tables.length > 0, "Migration manifest does not contain any tables");

  const normalized = [];
  const normalizedKeys = new Set();
  for (const table of tables) {
    requireCondition(isObject(table), "Manifest tables must be objects");
    const { schema, table: name, rows } = table;
    sqlIdentifier(schema);
    sqlIdentifier(name);
    requireCondition(typeof rows === "bigint" && rows >= 0n && rows <= MAX_ROW_COUNT,
      `Manifest contains an invalid row count for ${schema}.${name}`);
    const key = tableKey(schema, name);
    requireCondition(!normalizedKeys.has(key), `Manifest contains a duplicate table: ${schema}.${name}`);
    normalizedKeys.add(key);
    normalized.push([schema, name, rows]);
  }

  const sensitive = normalized.filter(([, name, rows]) => rows > 0n && isSensitiveTable(name))
    .map(([schema, name]) => `${schema}.${name}`).sort(compareCodePoints);
  requireCondition(sensitive.length === 0, "Tenant bootstrap sensitive business tables must have zero rows: " + sensitive.join(", "));

  const populatedKeys = normalized.filter(([, , rows]) => rows > 0n).map(([schema, name]) => tableKey(schema, name));
  const rawAllowlist = manifest.seedTableAllowlist;
  if (dataPolicy === SCHEMA_ONLY_POLICY) {
    requireCondition(populatedKeys.length === 0, "schema_only tenant bootstrap requires every table to have zero rows: " +
      sortedTableNames(populatedKeys));
    requireCondition(rawAllowlist == null || (Array.isArray(rawAllowlist) && rawAllowlist.length === 0),
      "schema_only tenant bootstrap cannot declare seedTableAllowlist");
  } else {
    requireCondition(Array.isArray(rawAllowlist) && rawAllowlist.length > 0,
      "allowlisted_seed_tables requires a non-empty seedTableAllowlist");
    const allowlist = new Set(rawAllowlist.map(normalizedTableKey));
    requireCondition(allowlist.size === rawAllowlist.length, "seedTableAllowlist contains duplicate entries");
    const unapproved = [...allowlist].filter(key => !APPROVED_SEED_TABLES.has(key));
    requireCondition(unapproved.length === 0, "seedTableAllowlist contains tables not approved by application policy: " +
      sortedTableNames(unapproved));
    const absent = [...allowlist].filter(key => !normalizedKeys.has(key));
    requireCondition(absent.length === 0, "seedTableAllowlist contains tables absent from the manifest: " + sortedTableNames(absent));
    const outside = populatedKeys.filter(key => !allowlist.has(key));
    requireCondition(outside.length === 0, "Tenant bootstrap contains rows outside seedTableAllowlist: " + sortedTableNames(outside));
  }

  normalized.sort(compareTablePairs);
  if (manifest.schemaProfile != null) {
    const { REQUIRED_TABLES } = require("./tenant_baseline_schema_profile.js");
    requireCondition([...REQUIRED_TABLES].every(name => normalizedKeys.has(pairKey("public", name))),
      "Schema profile requires its referenced business tables");
  }
  return normalized;
}

function parseManifestJson(text) {
  // Preserve Python JSON's non-finite literals and reject oversized integer tokens
  // even when a duplicate key would hide the earlier token from the reviver.
  const usedMarkers = new Set(text.match(/"PythonJsonNaN_[0-9]+"/gu) ?? []);
  let markerIndex = 0;
  let nanToken;
  do {
    nanToken = `"PythonJsonNaN_${markerIndex++}"`;
  } while (usedMarkers.has(nanToken));
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|-Infinity|Infinity|NaN|-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/gu;
  const compatible = text.replace(tokens, (token, offset) => {
    if (token[0] === '"') return token;
    const before = text[offset - 1];
    const after = text[offset + token.length];
    if ((before !== undefined && !" \t\r\n[,:".includes(before)) ||
        (after !== undefined && !" \t\r\n,]}".includes(after))) return token;
    if (token === "NaN") return nanToken;
    if (token === "Infinity") return "1e999";
    if (token === "-Infinity") return "-1e999";
    if (INTEGER_JSON_TOKEN.test(token)) {
      requireCondition(token.length - Number(token[0] === "-") <= 4_300, "Migration manifest contains an oversized JSON integer");
    }
    return token;
  });
  return JSON.parse(compatible, (_key, value, context) => {
    if (context?.source === nanToken) return NaN;
    if (typeof value !== "number") return value;
    const token = context.source;
    return INTEGER_JSON_TOKEN.test(token) ? BigInt(token) : value;
  });
}

function renderVerificationSql(normalized) {
  const values = normalized.map(([schema, name]) => `(${sqlLiteral(schema)}, ${sqlLiteral(name)})`).join(",\n    ");
  const parts = [`DO $speedfeast_verify_tables$
DECLARE
  mismatch text;
BEGIN
  WITH expected(schema_name, table_name) AS (
    VALUES
    ${values}
  ),
  actual(schema_name, table_name) AS (
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      AND schemaname NOT LIKE 'pg_toast%'
  ),
  differences AS (
    SELECT 'missing' AS kind, schema_name, table_name FROM (TABLE expected EXCEPT TABLE actual) AS missing
    UNION ALL
    SELECT 'unexpected' AS kind, schema_name, table_name FROM (TABLE actual EXCEPT TABLE expected) AS unexpected
  )
  SELECT string_agg(kind || ':' || quote_ident(schema_name) || '.' || quote_ident(table_name), ', ')
  INTO mismatch
  FROM differences;

  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'Restored table set differs from the manifest: %', mismatch;
  END IF;
END
$speedfeast_verify_tables$;

`];
  for (const [schema, name, rows] of normalized) {
    parts.push(`DO $speedfeast_verify_rows$
DECLARE
  actual_rows bigint;
BEGIN
  SELECT count(*) INTO actual_rows FROM ${sqlIdentifier(schema)}.${sqlIdentifier(name)};
  IF actual_rows <> ${rows} THEN
    RAISE EXCEPTION 'Row count mismatch for %.%: expected %, got %', ${sqlLiteral(schema)}, ${sqlLiteral(name)}, ${rows}, actual_rows;
  END IF;
END
$speedfeast_verify_rows$;

`);
  }
  return parts.join("");
}

function renderTenantBaselineVerification({ manifestPath, archiveSha256, sourceDatabaseName, tocPath, outputPath, programSqlPath }) {
  const manifest = parseManifestJson(readPythonUtf8Text(manifestPath));
  const normalized = validateManifest(manifest, archiveSha256.toLowerCase(), sourceDatabaseName);
  let programSql;
  if (manifest.schemaProfile != null) {
    requireCondition(programSqlPath !== undefined && statSync(programSqlPath).size <= MAX_PROFILE_SQL_BYTES,
      "Profile requires bounded offline schema SQL");
    programSql = readPythonUtf8Text(programSqlPath);
  }
  validateRestoreToc(readPythonUtf8Text(tocPath), manifest, normalized, programSql);
  let verification = renderVerificationSql(normalized);
  if (manifest.schemaProfile != null) {
    const { renderProfileVerificationSql } = require("./tenant_baseline_schema_profile.js");
    verification += renderProfileVerificationSql();
  }
  writeFileSync(outputPath, verification, "utf8");
}

function main(args) {
  if (args.length !== 5 && args.length !== 6) {
    console.error("Usage: render_tenant_baseline_verification.js MANIFEST ARCHIVE_SHA256 SOURCE_DATABASE RESTORE_TOC OUTPUT_SQL [OFFLINE_SCHEMA_SQL]");
    return 2;
  }
  const [manifestPath, archiveSha256, sourceDatabaseName, tocPath, outputPath, programSqlPath] = args;
  try {
    renderTenantBaselineVerification({ manifestPath, archiveSha256, sourceDatabaseName, tocPath, outputPath, programSqlPath });
  } catch (error) {
    console.error("Tenant bootstrap manifest rejected: " + error.message);
    return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { renderTenantBaselineVerification };
