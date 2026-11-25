import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rootCertificates } from "node:tls";
import { loadFirstOpenTenantPostgresPrograms } from "../ops/platform-hosting-v1/first-open-backend.mjs";
import {
  createTenantPostgresAdapter,
  tenantRdsApplicationConfiguration,
} from "../ops/platform-hosting-v1/first-open-tenant-postgres.mjs";

const backendDirectory = fileURLToPath(new URL("../ops/platform-hosting-v1/first-open-backend/", import.meta.url));
const existing = {
  kind: "local", host: "localhost", port: 5432, database: "fixture_tenant", username: "fixture_role", owner: "fixture_owner",
};
const ownershipMarker = `tl_owner_${"b".repeat(32)}_g1`;
const metadata = JSON.stringify({ schemaVersion: 1, kind: "techlong_tenant_database", ownershipMarker, marker: { ownershipMarker } });
const occupied = { objects: "2", closed_public_schema: "1" };

function fixture(target, options = {}) {
  const calls = [];
  const configs = [];
  const createClient = config => {
    configs.push(config);
    const client = new EventEmitter();
    let readOnly;
    return Object.assign(client, {
      async connect() { calls.push("connect"); },
      async end() { calls.push("end"); },
      async query(text, values) {
        calls.push(values ? [text, values] : text);
        if (text.startsWith("BEGIN")) readOnly = text === "BEGIN READ ONLY";
        if (text.includes("FROM pg_catalog.pg_database")) return { rows: [{
          database: target.database, username: target.username, effectiveUsername: target.username, owner: target.owner,
          serverVersionNum: 150003, serverVersion: "15.3", databaseOid: "16384", databaseComment: metadata,
          serverAddress: "127.0.0.1", port: target.port, tls: Boolean(config.ssl), inRecovery: false, readOnly: readOnly ? "on" : "off",
          ...options.observed,
        }] };
        if (text.includes("AS locked")) return { rows: [{ locked: true }] };
        if (text.includes("closed_public_schema")) return { rows: [options.empty ?? occupied] };
        if (text.includes('FROM "fixture"."orders"')) return { rows: [{ state: "synthetic" }] };
        return { rows: [] };
      },
    });
  };
  return { createClient, calls, configs };
}

test("existing local target validates its actual owner and reads one isolated sample without writing", async () => {
  const { createClient, calls, configs } = fixture(existing);
  const adapter = createTenantPostgresAdapter({ target: existing, localPassword: "fixture", createClient });
  const { identity, sample } = await adapter.readSample({
    schema: "fixture", table: "orders", keyColumn: "id", key: "synthetic-order", columns: ["state"],
  });
  assert.deepEqual(identity, {
    database: existing.database, owner: existing.owner, username: existing.username, databaseOid: "16384",
    serverVersionNum: 150003, serverVersion: "15.3", tls: false,
  });
  assert.deepEqual(sample, { state: "synthetic" });
  assert.equal(configs[0].host, existing.host);
  assert.equal(configs[0].ssl, false);
  assert.equal(calls[1], "BEGIN READ ONLY");
  assert.deepEqual(calls[4][1], ["synthetic-order"]);
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "end"]);
});

test("wrong tenant ownership is rejected before a sample read", async () => {
  const { createClient, calls } = fixture(existing, { observed: { owner: "other_owner" } });
  const adapter = createTenantPostgresAdapter({ target: existing, localPassword: "fixture", createClient });
  await assert.rejects(adapter.readSample({
    schema: "fixture", table: "orders", keyColumn: "id", key: "synthetic-order", columns: ["state"],
  }), { code: "TENANT_POSTGRES_OWNERSHIP" });
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "end"]);
});

test("pinned emptiness check observes existing objects read-only and refuses initialization of an occupied target", async () => {
  const local = { ...existing, owner: existing.username, databaseOid: "16384", ownershipMarker, isolatedEmpty: true };
  const { createClient, calls } = fixture(local, { observed: { serverVersionNum: 160014, serverVersion: "16.14" } });
  const adapter = createTenantPostgresAdapter({ target: local, localPassword: "fixture", createClient });
  const inspected = await adapter.inspectEmpty({ backendDirectory });
  assert.equal(inspected.eligibleEmpty, false);
  assert.equal(calls[1], "BEGIN READ ONLY");
  const programs = await loadFirstOpenTenantPostgresPrograms(backendDirectory);
  const pins = programs.BASELINE_CATALOG_PINS;
  assert.deepEqual(programs.loadSaasPrograms().map(({ name }) => name), ["saas_control.sql", "theme_config.sql"]);
  await assert.rejects(adapter.initialize({ backendDirectory, archiveSha256: pins.archiveSha256, manifestSha256: pins.manifestSha256 }),
    { code: "TENANT_POSTGRES_NOT_EMPTY" });
  assert.equal(calls.filter(call => call === "ROLLBACK").length, 2);
  assert.ok(!calls.includes("COMMIT"));
  assert.ok(calls.every(call => typeof call !== "string" || !/^CREATE|^DROP|^ALTER/.test(call)));
});

test("standard RDS branch pins the instance, hostname, role, database, CA, marker and PG16.14", async () => {
  const rds = {
    ...existing, kind: "rds", engine: "postgres", host: "tenant-fixture.abcdef.ca-central-1.rds.amazonaws.com",
    dbInstanceIdentifier: "tenant-fixture", databaseOid: "16384", ownershipMarker,
  };
  const url = `postgresql://${rds.username}:fixture@${rds.host}:5432/${rds.database}?sslmode=verify-full`;
  const configuration = tenantRdsApplicationConfiguration({ target: rds,
    runtimeSecretArn: "arn:aws:secretsmanager:ca-central-1:123456789012:secret:fixture-ab1234",
    versionId: "a".repeat(36) });
  configuration.validateDatabaseUrl(url);
  assert.equal(configuration.environment.PG_DATABASE_PROFILE, "full_password");
  assert.equal(configuration.environment.PGSSLMODE, "verify-full");
  assert.match(configuration.secret.valueFrom, /database_url::a{36}$/);
  const { createClient, configs } = fixture(rds, { observed: { serverVersionNum: 160014, serverVersion: "16.14" } });
  const ca = rootCertificates[0];
  const adapter = createTenantPostgresAdapter({ target: rds, databaseUrl: url, ca, createClient });
  assert.equal((await adapter.inspect()).tls, true);
  assert.equal(configs[0].host, rds.host);
  assert.equal(configs[0].ssl.ca, ca);
  assert.equal(configs[0].ssl.rejectUnauthorized, true);
  assert.equal(configs[0].ssl.servername, rds.host);
  assert.throws(() => configuration.validateDatabaseUrl(url.replace(rds.database, "foreign_db")), { code: "TENANT_POSTGRES_CREDENTIAL_TARGET" });
  assert.throws(() => createTenantPostgresAdapter({ target: { ...rds, engine: "aurora-postgresql" }, databaseUrl: url, ca, createClient }),
    { code: "TENANT_POSTGRES_TARGET" });
  assert.throws(() => createTenantPostgresAdapter({ target: rds, databaseUrl: url + "&host=other", ca, createClient }),
    { code: "TENANT_POSTGRES_CREDENTIAL_TARGET" });
  const wrongVersion = fixture(rds, { observed: { serverVersionNum: 170009 } });
  await assert.rejects(createTenantPostgresAdapter({ target: rds, databaseUrl: url, ca, createClient: wrongVersion.createClient }).inspect(),
    { code: "TENANT_POSTGRES_RDS_SESSION" });
});
