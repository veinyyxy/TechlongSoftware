import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { createNeonPostgresDatabase } from "../db/postgres-neon.ts";
import { createSaasControlDatabaseBinding } from "../ops/platform-hosting-v1/control-database.mjs";
import { readRdsControlDatabaseEnvironment } from "../db/postgres-rds.ts";

const endpoint = "saas-control-fixture.abcde12345.ca-central-1.rds.amazonaws.com";
const dbName = "control_fixture";
const rdsUrl = `postgresql://control_fixture_writer:fixture%3Aonly@${endpoint}/${dbName}?sslmode=verify-full`;
const neonUrl = "postgresql://neon_fixture:fixture@ep-fixture-pooler.us-east-2.aws.neon.tech/control_fixture?sslmode=verify-full";
const awsEnv = {
  AWS_EXECUTION_ENV: "AWS_ECS_FARGATE",
  AWS_REGION: "ca-central-1",
  ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/metadata-fixture",
  TECHLONG_SAAS_CONTROL_DATABASE_MODE: "rds-postgresql",
  TECHLONG_SAAS_CONTROL_RDS_HOST: endpoint,
  TECHLONG_SAAS_CONTROL_RDS_DATABASE: dbName,
  TECHLONG_SAAS_CONTROL_RDS_URL: rdsUrl,
  DATABASE_URL: neonUrl,
};
const CA = rootCertificates[0];
const noNetwork = () => assert.fail("unexpected transport");

test("the normal SaaS database entry selects only the Node host capability", async () => {
  register("./cloudflare-loader.mjs", import.meta.url);
  const { env } = await import("./cloudflare-workers.mock.mjs");
  const { getPostgresDatabase } = await import("../db/postgres.ts");
  const local = getPostgresDatabase();
  const { db } = transactionPool();
  try {
    env.TECHLONG_SAAS_CONTROL_NATIVE_DB = db;
    assert.equal(getPostgresDatabase(), db);
    env.TECHLONG_SAAS_CONTROL_NATIVE_DB = "untrusted binding";
    assert.throws(() => getPostgresDatabase(), /SaaS control database binding is invalid/);
  } finally {
    delete env.TECHLONG_SAAS_CONTROL_NATIVE_DB;
  }
  assert.equal(getPostgresDatabase(), local);
});

test("SaaS local/default and legacy AWS hosting retain the existing Neon configuration", async () => {
  const local = { DATABASE_URL: neonUrl, TECHLONG_SAAS_CONTROL_RDS_URL: rdsUrl };
  for (const env of [local, { ...awsEnv, TECHLONG_SAAS_CONTROL_DATABASE_MODE: "neon" }]) {
    assert.equal(createSaasControlDatabaseBinding(env, { readCa: noNetwork, openPool: noNetwork })(), undefined);
  }
  const inputs = [];
  const db = createNeonPostgresDatabase(neonUrl, (url) => {
    inputs.push(url);
    return {
      query: async (text, args) => {
        inputs.push([text, args]);
        return { rows: [{ value: "1234" }], fields: [{ name: "value", dataTypeID: 20 }], rowCount: 1, command: "SELECT" };
      },
    };
  });
  assert.deepEqual(inputs, []);
  assert.deepEqual(await db.prepare("SELECT ?::bigint AS value").bind("1234").first(), { value: 1234 });
  assert.deepEqual(inputs, [neonUrl, ["SELECT $1::bigint AS value", ["1234"]]]);
});

test("RDS mode requires explicit AWS deployment and a pinned verifiable target, with no Neon fallback", () => {
  for (const override of [
    { AWS_EXECUTION_ENV: undefined },
    { ECS_CONTAINER_METADATA_URI_V4: "https://example.invalid/v4/fixture" },
    { TECHLONG_SAAS_CONTROL_DATABASE_MODE: "unknown" },
    { TECHLONG_SANDBOX_FIRST_PURCHASE: "true" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { TECHLONG_SAAS_CONTROL_RDS_URL: undefined },
    { TECHLONG_SAAS_CONTROL_RDS_URL: neonUrl },
    { TECHLONG_SAAS_CONTROL_RDS_URL: rdsUrl.replace("verify-full", "require") },
    { TECHLONG_SAAS_CONTROL_RDS_URL: rdsUrl + "&sslmode=disable" },
    { TECHLONG_SAAS_CONTROL_RDS_URL: rdsUrl + "&host=127.0.0.1" },
    { TECHLONG_SAAS_CONTROL_RDS_HOST: "other." + endpoint },
    { TECHLONG_SAAS_CONTROL_RDS_HOST: endpoint.replace(".abcde", ".cluster-abcde"),
      TECHLONG_SAAS_CONTROL_RDS_URL: rdsUrl.replace(".abcde", ".cluster-abcde") },
    { TECHLONG_SAAS_CONTROL_RDS_DATABASE: "other_db" },
    { AWS_REGION: "us-west-2" },
  ]) {
    assert.throws(
      () => createSaasControlDatabaseBinding({ ...awsEnv, ...override }, { readCa: noNetwork, openPool: noNetwork })(),
      /^(?:Error: )?SAAS_CONTROL_RDS_(?:DEPLOYMENT_REQUIRED|TARGET_INVALID)$/,
    );
  }
  assert.deepEqual(readRdsControlDatabaseEnvironment(awsEnv), {
    host: endpoint, port: 5432, database: dbName, user: "control_fixture_writer", password: "fixture:only",
  });
});

test("RDS uses the locked CA path interface and explicit TLS hostname verification with a lazy pool", () => {
  assert.throws(
    () => createSaasControlDatabaseBinding(awsEnv, { readCa: () => { throw new Error("missing file"); }, openPool: noNetwork })(),
    /SAAS_CONTROL_RDS_CA_UNAVAILABLE/,
  );
  assert.throws(
    () => createSaasControlDatabaseBinding(awsEnv, { readCa: () => "fake CA", openPool: noNetwork })(),
    /SAAS_CONTROL_RDS_CA_INVALID/,
  );
  const opened = [];
  const binding = createSaasControlDatabaseBinding(awsEnv, {
    readCa: () => CA,
    openPool(options) {
      opened.push(options);
      return { connect: noNetwork, query: noNetwork };
    },
  });
  assert.equal(opened.length, 0);
  assert.equal(binding(), binding());
  assert.equal(opened.length, 1);
  assert.equal(opened[0].host, endpoint);
  assert.equal(opened[0].connectionString, undefined);
  assert.deepEqual(opened[0].ssl, { ca: CA, rejectUnauthorized: true, servername: endpoint, minVersion: "TLSv1.2" });
});

function transactionPool(failAt, rollbackFails = false) {
  const trace = [];
  const visible = [];
  let pending = [];
  const result = command => ({ rows: [], fields: [], rowCount: 0, command });
  const pool = {
    query: noNetwork,
    async connect() {
      trace.push("connect");
      return {
        async query(text, values) {
          trace.push(text);
          if (text === failAt || (text === "ROLLBACK" && rollbackFails)) throw new Error(text + " failed");
          switch (text) {
            case "BEGIN":
            case "ROLLBACK":
              pending = [];
              return result(text);
            case "COMMIT":
              visible.push(...pending);
              return result(text);
            default:
              pending.push(values[0]);
              return { ...result("INSERT"), rowCount: 1 };
          }
        },
        release(destroy) { trace.push(destroy ? "discard" : "release"); },
      };
    },
  };
  const db = createSaasControlDatabaseBinding(awsEnv, { readCa: () => CA, openPool: () => pool })();
  return { db, trace, visible };
}

test("RDS batches commit together and roll back on a failed statement without retrying", async () => {
  const first = "INSERT INTO fixture VALUES ($1)";
  const second = "INSERT INTO fixture_other VALUES ($1)";
  for (const failAt of [undefined, second]) {
    const { db, trace, visible } = transactionPool(failAt);
    const pending = db.batch([
      db.prepare("INSERT INTO fixture VALUES (?)").bind("first"),
      db.prepare("INSERT INTO fixture_other VALUES (?)").bind("second"),
    ]);
    if (failAt) await assert.rejects(pending, /fixture_other/);
    else assert.deepEqual((await pending).map(result => result.meta.rows_written), [1, 1]);
    assert.deepEqual(trace, ["connect", "BEGIN", first, second, failAt ? "ROLLBACK" : "COMMIT", "release"]);
    assert.deepEqual(visible, failAt ? [] : ["first", "second"]);
  }
});

test("RDS discards broken transactions and refuses cross-database batches before connecting", async () => {
  const insert = "INSERT INTO fixture VALUES ($1)";
  for (const failAt of ["BEGIN", "COMMIT", insert]) {
    const { db, trace } = transactionPool(failAt, true);
    await assert.rejects(db.batch([db.prepare(insert).bind("synthetic")]));
    assert.equal(trace.at(-1), "discard");
    assert.equal(trace.filter(operation => operation === "connect").length, 1);
    assert.equal(trace.includes("ROLLBACK"), failAt === insert);
  }
  const { db, trace } = transactionPool();
  const anotherDb = transactionPool().db;
  await assert.rejects(db.batch([anotherDb.prepare(insert).bind("foreign")]), /same database adapter/);
  assert.deepEqual(trace, []);
});
