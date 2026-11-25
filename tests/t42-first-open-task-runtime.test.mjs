import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rootCertificates } from "node:tls";
import test from "node:test";
import {
  FIRST_OPEN_TASK_ACCOUNT, FIRST_OPEN_TASK_REGION, FIRST_OPEN_TASK_CLUSTER, FIRST_OPEN_TASK_FAMILY,
  FIRST_OPEN_TASK_CONTAINER, FIRST_OPEN_TASK_ROLE, attestFirstOpenTask, readFirstOpenTaskBinding,
} from "../ops/platform-hosting-v1/first-open-task-identity.ts";
import { createFirstOpenTaskRds } from "../ops/platform-hosting-v1/first-open-task-rds.mjs";
import { prepareFirstOpenTaskRuntime, runPreparedFirstOpenTask } from "../ops/platform-hosting-v1/first-open-task-runtime.ts";

const now = () => 1_700_000_000_000;
const taskArn = `arn:aws:ecs:${FIRST_OPEN_TASK_REGION}:${FIRST_OPEN_TASK_ACCOUNT}:task/techlong-sandbox-platform/${"8".repeat(32)}`;
const taskDefinitionArn = `arn:aws:ecs:${FIRST_OPEN_TASK_REGION}:${FIRST_OPEN_TASK_ACCOUNT}:task-definition/${FIRST_OPEN_TASK_FAMILY}:7`;
const imageId = "sha256:" + "1".repeat(64);
const config = {
  version: "techlong/ecs-first-open-task/v1", clusterArn: FIRST_OPEN_TASK_CLUSTER,
  family: FIRST_OPEN_TASK_FAMILY, containerName: FIRST_OPEN_TASK_CONTAINER, taskRoleArn: FIRST_OPEN_TASK_ROLE,
  image: `${FIRST_OPEN_TASK_ACCOUNT}.dkr.ecr.${FIRST_OPEN_TASK_REGION}.amazonaws.com/techlong-sandbox-platform-web@${imageId}`,
  controlHost: "control-db.abcdef123456.ca-central-1.rds.amazonaws.com", controlDatabase: "saas_test",
  writeDbRole: "firstopen_write", readDbRole: "firstopen_read",
};
const metadata = {
  Cluster: FIRST_OPEN_TASK_CLUSTER, Family: FIRST_OPEN_TASK_FAMILY, Revision: "7", LaunchType: "FARGATE", TaskARN: taskArn,
  Containers: [{ Name: FIRST_OPEN_TASK_CONTAINER, Image: config.image, ImageID: imageId }],
};
const localCredentials = {
  RoleArn: FIRST_OPEN_TASK_ROLE, AccessKeyId: "ASIA" + "A".repeat(16), SecretAccessKey: "b".repeat(40),
  Token: "c".repeat(32), Expiration: new Date(now() + 60_000).toISOString(),
};
function environment(binding = config) {
  const json = JSON.stringify(binding);
  const url = user => `postgres://${user}:synthetic@${config.controlHost}/${config.controlDatabase}?sslmode=verify-full`;
  return {
    TECHLONG_FIRST_OPEN_TASK_BINDING_JSON: json,
    TECHLONG_FIRST_OPEN_TASK_BINDING_SHA256: createHash("sha256").update(json).digest("hex"),
    AWS_EXECUTION_ENV: "AWS_ECS_FARGATE", AWS_REGION: FIRST_OPEN_TASK_REGION,
    ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/local-task-fixture",
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/local-role-fixture",
    TECHLONG_SAAS_CONTROL_DATABASE_MODE: "rds-postgresql",
    TECHLONG_SAAS_CONTROL_RDS_HOST: config.controlHost, TECHLONG_SAAS_CONTROL_RDS_DATABASE: config.controlDatabase,
    TECHLONG_SAAS_CONTROL_RDS_URL: url(config.writeDbRole), TECHLONG_FIRST_OPEN_CONTROL_READ_RDS_URL: url(config.readDbRole),
  };
}

const local = async url => url.pathname.endsWith("/task") ? metadata : localCredentials;
const signal = () => new AbortController().signal;
const id = "exec_" + "a".repeat(32);
const approval = {
  executionId: id, approvedBy: "usr_firstopen", approvedAt: now() - 5000, jobId: "job_" + "b".repeat(24),
  instanceId: "app_firstopen", workspaceId: "wsp_firstopen", releaseId: "release_" + "c".repeat(32),
  reviewSha256: "d".repeat(64), hostname: "tenant.sandbox.techlong.cloud",
};
const ack = {
  ...approval, startedAt: now() - 4_000, ackAt: now() - 3_000, outcome: "acknowledged", taskArn, taskDefinitionArn,
};

test("T4.2 task identity binds immutable config, ECS direct metadata, exact image and temporary role", async () => {
  const env = environment();
  const binding = readFirstOpenTaskBinding(env);
  const calls = [];
  const readLocal = async url => { calls.push(url.href); return local(url); };
  const result = await attestFirstOpenTask({ env, binding, now, signal: signal(), readLocal });
  assert.equal(result.taskArn, taskArn);
  assert.equal(result.taskDefinitionArn, taskDefinitionArn);
  assert.equal((await result.credentials()).sessionToken, localCredentials.Token);
  assert.deepEqual(calls, [env.ECS_CONTAINER_METADATA_URI_V4 + "/task", "http://169.254.170.2" + env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI]);
  assert.throws(() => readFirstOpenTaskBinding({ ...env, TECHLONG_FIRST_OPEN_TASK_BINDING_JSON: "{}" }), /TASK_BINDING/);
  for (const unapproved of [{ readDbRole: config.writeDbRole }, { taskRoleArn: FIRST_OPEN_TASK_ROLE + "Other" },
    { image: config.image.replace(/@sha256:.+/, ":latest") }, { controlHost: "ep-fixture.neon.tech" }]) {
    assert.throws(() => readFirstOpenTaskBinding(environment({ ...config, ...unapproved })), /TASK_BINDING/);
  }
  for (const injection of [{ ECS_CONTAINER_METADATA_URI_V4: "http://example.invalid/v4/wrong" },
    { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "//example.invalid/v2/credentials/wrong" }, { AWS_PROFILE: "legacy" },
    { AWS_ENDPOINT_URL_STS: "https://example.invalid" }, { HTTP_PROXY: "http://example.invalid" }]) {
    await assert.rejects(attestFirstOpenTask({ env: { ...env, ...injection }, binding, now, signal: signal(),
      readLocal: () => assert.fail("invalid environment caused a provider read") }), /TASK_IDENTITY_ENV/);
  }
  await assert.rejects(attestFirstOpenTask({ env, binding, signal: signal(), now, readLocal: async url =>
    url.pathname.endsWith("/task") ? { ...metadata, Containers: [{ ...metadata.Containers[0], ImageID: "sha256:" + "9".repeat(64) }] } : localCredentials }),
  /TASK_IMAGE_SCOPE/);
  await assert.rejects(attestFirstOpenTask({ env, binding, signal: signal(), now, readLocal: async url =>
    url.pathname.endsWith("/task") ? metadata : { ...localCredentials, RoleArn: FIRST_OPEN_TASK_ROLE + "Different" } }), /TASK_ROLE_SCOPE/);
});

function fixture(rows, environmentKey = "aws-sandbox-ca-central-1") {
  const readOperations = [], writeOperations = [], closed = [], readers = [];
  let createdResources = 0;
  const makeResult = row => ({ rows: row ? [row] : [], fields: [], rowCount: row ? 1 : 0, command: "SELECT" });
  const options = {
    env: environment(), signal: signal(), now, readLocal: local, pause: async () => {},
    openRds: (env, binding) => createFirstOpenTaskRds(env, binding, {
      readCa: () => rootCertificates[0],
      openPool(input) {
        const readOnly = input.user === config.readDbRole;
        assert.equal(input.host, config.controlHost);
        assert.equal(input.database, config.controlDatabase);
        assert.equal(input.ssl.rejectUnauthorized, true);
        assert.equal(input.ssl.servername, config.controlHost);
        const history = readOnly ? readOperations : writeOperations;
        return {
          async query(sql, values) {
            assert.equal(readOnly, false, "read role must use a verified transaction");
            assert.ok(sql.startsWith("SELECT opened.id"));
            assert.deepEqual(values, [id, taskArn, taskDefinitionArn]);
            history.push("approval");
            return makeResult(approval);
          },
          async connect() {
            if (readOnly) readers.push(input.user);
            return {
              async query(sql, values) {
                if (sql.startsWith("SELECT current_database()")) {
                  history.push("session");
                  return makeResult({ database: config.controlDatabase, username: input.user, login: input.user, port: 5432,
                    serverVersionNum: 160014, readOnly: readOnly ? "on" : "off", inRecovery: false, tls: true });
                }
                if (sql.includes("e.dispatch_outcome")) {
                  assert.equal(readOnly, true);
                  assert.deepEqual(values, [id]);
                  history.push("ack");
                  return makeResult(rows.shift());
                }
                history.push(sql);
                return makeResult(null);
              },
              release(destroy) { assert.equal(destroy, true); history.push("release"); },
            };
          },
          async end() { closed.push(input.user); },
        };
      },
    }),
    async createResources({ approval: approved, identity, maxWriteBefore }) {
      createdResources++;
      assert.deepEqual(approved, approval);
      assert.equal(identity.taskArn, taskArn);
      assert.equal(identity.roleArn, FIRST_OPEN_TASK_ROLE);
      assert.equal(maxWriteBefore, approval.approvedAt + 3_600_000);
      return {
        settings: { baselineDigest: "e".repeat(64), databaseSchemaVersion: "fixture-1", dnsTarget: "tenant.internal",
          writeBefore: now() + 20_000 },
        management: { databaseProfile: "full_password",
          config: { workerEnabled: false, applyEnabled: false, environmentKey,
            expectedAccountId: FIRST_OPEN_TASK_ACCOUNT, expectedRegion: FIRST_OPEN_TASK_REGION, workerRoleArn: FIRST_OPEN_TASK_ROLE },
          dependencies: { tenantExternalOperationCoordinator: {}, tenantDatabase: {} } },
        reader: { capture: () => assert.fail("Inspector cannot run before claim") },
      };
    },
  };
  return { options, readOperations, writeOperations, closed, readers, createdResources: () => createdResources };
}

test("T4.2 opening waits for the durable ACK using fresh read-only RDS connections and binds one execution", async () => {
  const f = fixture([{ ...ack, outcome: null, taskArn: null, taskDefinitionArn: null, ackAt: null }, ack]);
  const runtime = await prepareFirstOpenTaskRuntime(id, f.options);
  assert.equal(await runtime.ports.readApproval("exec_" + "f".repeat(32)), null);
  const result = await runtime.ports.readApproval(id);
  assert.equal(result?.jobId, approval.jobId);
  assert.equal(result?.baselineDigest, "e".repeat(64));
  assert.equal(f.createdResources(), 1);
  assert.deepEqual(f.readers, [config.readDbRole, config.readDbRole]);
  assert.deepEqual(f.readOperations, Array.from({ length: 2 }, () => [
    "BEGIN READ ONLY", "SET LOCAL search_path = pg_catalog, public", "session", "ack", "ROLLBACK", "release",
  ]).flat());
  assert.deepEqual(f.writeOperations, ["approval"]);
  await runtime.close();
  assert.deepEqual(f.closed, [config.writeDbRole, config.readDbRole]);
});

test("T4.2 missing, unknown or mismatched task or revision ACK and unverified Worker authority stop before any write", async () => {
  await assert.rejects(prepareFirstOpenTaskRuntime(id, { env: {}, signal: signal(),
    openRds: () => assert.fail("missing resource factory loaded a DB") }), /RUNTIME_UNAVAILABLE/);
  for (const invalid of [null, { ...ack, outcome: "unknown", taskArn: null, taskDefinitionArn: null, ackAt: null },
    { ...ack, taskArn: taskArn.slice(0, -1) + "9" }, { ...ack, taskDefinitionArn: null },
    { ...ack, taskDefinitionArn: taskDefinitionArn.replace(/:7$/, ":8") }, { ...ack, ackAt: null }, { ...ack, ackAt: now() + 1 }]) {
    const f = fixture([invalid]);
    await assert.rejects(runPreparedFirstOpenTask(id, f.options), /DISPATCH_ACK_REQUIRED/);
    assert.deepEqual(f.writeOperations, []);
    assert.equal(f.readers.length, 1);
    assert.equal(f.createdResources(), 0);
    assert.deepEqual(f.closed, [config.writeDbRole, config.readDbRole]);
  }
  const f = fixture([ack], "aws-sandbox");
  await assert.rejects(runPreparedFirstOpenTask(id, f.options), /RDS_AUTHORITY_REQUIRED/);
  assert.deepEqual(f.writeOperations, []);
  assert.deepEqual(f.closed, [config.writeDbRole, config.readDbRole]);
});

test("T4.2 control task RDS requires two exact logins on the same instance and database before opening", () => {
  const env = environment(), binding = readFirstOpenTaskBinding(env);
  for (const wrong of [undefined, env.TECHLONG_SAAS_CONTROL_RDS_URL,
    env.TECHLONG_FIRST_OPEN_CONTROL_READ_RDS_URL.replace(config.controlDatabase, "other")]) {
    assert.throws(() => createFirstOpenTaskRds({ ...env, TECHLONG_FIRST_OPEN_CONTROL_READ_RDS_URL: wrong }, binding,
      { openPool: () => assert.fail("invalid DSN opened a pool") }), /RDS_(?:TARGET_INVALID|SCOPE)/);
  }
});
