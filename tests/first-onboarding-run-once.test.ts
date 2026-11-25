import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { SecretsManagerServiceException } from "@aws-sdk/client-secrets-manager";
import { firstOpenBuyerSignerSecretName } from "../lib/buyer-forward/signer-binding.ts";
import { buildFirstOnboardingJob, reviewFirstOnboarding, type FirstOnboardingReviewRow } from "../lib/deployments/first-onboarding.ts";
import { FIRST_OPEN_BASELINE_BINDING as fixed, FIRST_OPEN_BASELINE_BUCKET, FIRST_OPEN_BASELINE_OBJECTS as originals,
  firstOpenBaselineHeadRequest, projectFirstOpenBaselineHeads } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { sandboxFirstOpenClaimDdl, sandboxFirstOpenClaimPorts } from "../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { sandboxFirstOpenPolicyDrafts } from "../lib/deployments/execution/first-onboarding-run-permissions.ts";
import { createSandboxFirstOpenRunOnce, checkSandboxFirstOpenApproval, SANDBOX_FIRST_OPEN as s,
  SANDBOX_FIRST_OPEN_STACK, type SandboxFirstOpenPorts } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { validateApprovedBaseline } from "../lib/deployments/execution/tenant-database.ts";
import { bindSandboxFirstOpenRunOnce } from "../lib/deployments/execution/first-onboarding-run-composition.ts";
import { FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF, firstOnboardingApprovalSha256, verifyFirstOnboardingApprovalBinding,
  type FirstOnboardingDeferredCleanupApprovalDraft } from "../lib/deployments/execution/first-onboarding-approval.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { completeFirstOpenBuyerParameters } from "../lib/deployments/execution/first-open-buyer-binding.ts";
import { sealFirstOpenTaskBinding } from "../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { compileExpressBootstrapCandidateV3, expressBootstrapCandidateDigestV3, FIRST_OPEN_MANAGEMENT_SQL_USER } from "../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { FIRST_OPEN_G1_TAG_PROOF_MODE, firstOnboardingInitialSecretVersion } from "../lib/deployments/execution/first-onboarding-express.ts";
import { deriveFirstOpenTaskRelease, firstOpenVersion, type FirstOpenTaskRelease } from "../lib/deployments/execution/first-onboarding-version.ts";
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";
import { FIRST_OPEN_INSPECTOR_SQL_USER, firstOpenExpressDatabase, firstOpenIndependentDatabase, type FirstOpenBackendPorts, type Sql } from "../ops/aws-sandbox/first-open-express-database.ts";
import { assertFirstOpenG1InspectedMetadata, firstOpenBaselineSource, firstOpenBuyerSigningMaterial, firstOpenInitialSecret }
  from "../ops/aws-sandbox/first-open-express-aws.ts";
import { observeFirstOpenTaggedG1 } from "../ops/aws-sandbox/first-open-paired-runtime.ts";
import type { TenantExternalOperationFence } from "../lib/deployments/execution/contracts.ts";
import { sandboxFirstOpenMiddleDdl } from "../ops/aws-sandbox/first-onboarding-middle-ddl.ts";
import { firstOnboardingMiddleRepositorySource } from "./first-onboarding-middle-source.mjs";
import { createSandboxFirstOpenMiddleRepository, FIRST_OPEN_MIDDLE_RPC, FIRST_OPEN_MIDDLE_WORKER,
  FIRST_OPEN_AUTHORITY_KEY, FIRST_OPEN_AUTHORITY_POLICY } from "../lib/deployments/execution/first-onboarding-middle.ts";
import { cycleFixture } from "./instance-release-cycle-fixture.ts";
import { authorizeFirstOpenLaunch, firstOpenPeerRun, launchFirstOpenJob, sealedFirstOpenHost,
  type FirstOpenLaunchRecord, type LocalLaunch } from "../ops/aws-sandbox/first-open-workflow-launcher.ts";
import { createHash } from "node:crypto";
import { v3Environment } from "./fixtures/cell-stack-v3.ts";

const now = Date.UTC(2026, 10, 19), writeBefore = now + 900_000;
const workspaceId = "wsp_beb2aa5868a9d1c10c257348"; // ID only, used to exercise the real scope hash; all stored rows below are synthetic.
const notCalled = async (): Promise<never> => assert.fail("an out-of-scope port was called");
const { bucket, objects } = fixed;
const controlledWindow = { startAt: now, claimBefore: now + 300_000, workloadExpiresAt: now + 7_200_000,
  factsExpireAt: writeBefore, cleanupReviewSha256: "1".repeat(64), cleanupPermissionsEvidenceSha256: "2".repeat(64) };
const signerPin = { arn: `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${firstOpenBuyerSignerSecretName}-Sg0001`, versionId: "7".repeat(64) };
const fixtureBuyerSigningKey = Buffer.alloc(32, 7).toString("base64url");

const runtimeFence = () => {
  const ownershipMarker = "tl_owner_" + s.stableIdentity.slice(0, 32) + "_g1";
  const externalFence: TenantExternalOperationFence = {
    schemaVersion: 1, epoch: 1, state: "active", intent: "provision", ownerDeploymentId: s.deploymentId,
    operationHash: "9".repeat(64), marker: `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1`,
    resourceFence: { schemaVersion: 1, generation: 1, ownerDeploymentId: s.deploymentId, ownershipMarker,
      identity: { schemaVersion: 1, appInstanceId: s.instanceId, workspaceId, productId: s.productId, environmentId: s.environmentId,
        cellKey: "cell-sandbox-1", stableIdentityHash: s.stableIdentity, databaseName: s.tenantDatabase, roleName: s.tenantRole,
        secretName: s.secretName.slice(0, -3) } },
  };
  return { fence: externalFence.resourceFence, externalFence, signal: new AbortController().signal };
};

test("first open initializes only the newly owned target and the inspector independently reads its OIDs", async () => {
  const { approval } = await fixture(), express = approval.express!, approvedSha256 = await sha256Hex(approval);
  const program = compileExpressBootstrapCandidateV3({ target: express.target, nonce: express.nonce, scope: {
    appInstanceId: s.instanceId, workspaceId, productId: s.productId, environmentId: s.environmentId, cellKey: "cell-sandbox-1",
  } });
  const x = runtimeFence(), context = { ...x, runtimeSecretRef: "arn:fixture", idempotencyKey: "fixture" };
  const result = (row: Record<string, unknown> = {}) => ({ rowCount: 1, rows: [row] });
  const commands: string[] = [], databaseRoutes: string[] = [], journal: string[] = [];
  let created = false, occupied = false, prepareCalls = 0, activated = false, marker = "", inspectorDbOid = "20001", otherConnectable = 0;
  const ids = { roleOid: "20002", databaseOid: "20001", managerRoleOid: "20004" };
  const manager = express.target.managementUsername;
  const broker = "sf_fc41597f_lifecycle_definer";
  const sql = (database: string): Sql => async (text, values) => {
    commands.push(text);
    databaseRoutes.push(database);
    if (text === "owners") return result({ roles: created ? [{ name: s.tenantRole, oid: ids.roleOid, login: activated, comment: program.comments.role }] : [],
      databases: created ? [{ name: s.tenantDatabase, oid: ids.databaseOid, ownerOid: ids.managerRoleOid, owner: manager, connect: true,
        comment: marker || program.comments.database }] : occupied ? [{ name: s.tenantDatabase, oid: "30001", ownerOid: "16410", owner: "postgres", connect: true }] : [] });
    if (text.includes("pg_try_advisory_lock")) return result({ locked: true });
    if (text === "empty") return result({ objects: "0", closed_public_schema: "1" });
    if (text === "catalog") return result({ identity: { relations: Array.from({ length: 7 }, (_, i) => ({ kind: "S", name: "seq" + i })) } });
    if (text === "role") return result({ oid: ids.roleOid, name: s.tenantRole, login: activated, iam_role_oid: "16389",
      inherit: false, superuser: false, create_db: false, create_role: false, replication: false, bypass_rls: false, settings: false, owns_objects: false,
      connection_limit: -1, valid_until: null, config: null, other_connectable_databases: otherConnectable,
      members: [{ name: broker, grantor: "rdsadmin", admin: true, inherit: false, set: false }],
      parents: activated ? [{ name: "rds_iam", oid: "16389", grantor: broker, admin: false, inherit: false, set: false }] : [] });
    if (text.includes("first_open_fc41597f.activate_role")) {
      assert.equal(database, "postgres");
      assert.deepEqual(values, [program.comments.role, ids.databaseOid]);
      activated = true;
      return result();
    }
    if (text.startsWith("COMMENT ON DATABASE")) marker = text.split(" IS '")[1].slice(0, -1);
    if (text.includes("AS singleton")) return result({ singleton: true });
    return result();
  };
  const read = (user: string) => <T>(_signal: AbortSignal, run: (q: Sql) => Promise<T>) => run(async (text, values) =>
    text.includes("current_database()") ? result({ database: s.tenantDatabase, database_oid: user === FIRST_OPEN_INSPECTOR_SQL_USER ? inspectorDbOid : ids.databaseOid,
      session_role_oid: user === FIRST_OPEN_INSPECTOR_SQL_USER ? "20003" : ids.roleOid, session_other_connectable_databases: 0,
      username: user, session_username: user, owner: manager, owner_oid: ids.managerRoleOid,
      version: 170009, read_only: "on", tls: true, marker }) : sql(s.tenantDatabase)(text, values));
  let pinReads = 0;
  const backend: FirstOpenBackendPorts = {
    async prepare(candidate) {
      prepareCalls++;
      assert.equal(occupied, false, "a pre-existing database must not reach the create port");
      assert.equal(created, false, "the create port must not be replayed");
      assert.notEqual(candidate, program); assert.deepEqual(candidate, program); created = true; return ids;
    },
    management: (_, run) => run(sql("postgres")),
    pair(dbOid, _, run) { assert.equal(dbOid, ids.databaseOid); return run(sql("postgres"), sql(s.tenantDatabase)); },
    async compileBaseline() { return { tables: ["saas_instances"], restoreSql: "restore-pinned", verificationSql: "verify-pinned" }; },
    migrations: () => [{ sql: "migration-pinned" }],
    ownersSql: "owners", emptySql: "empty", catalogSql: "catalog", roleSql: "role", countsSql: () => "counts",
    verifyCounts: () => {}, verifyCatalog: () => ({ catalogSha256: "7".repeat(64),
      structureSha256: commands.includes("migration-pinned") ? "93d3c7eb62bbdd3e38f0a3943c9d44d607b419d562fcbd73ebd2fccf319e876b" :
        "868ca1351fc83ae6d202dfc1539345c63b39c21e82c0194bef402b7b3f9e223e", sequences: 7 }),
  };
  const connectDatabase = (deadline = writeBefore) => firstOpenExpressDatabase({ approval: express, approvalSha256: approvedSha256, deadline,
    expectedOperationSha256: x.externalFence.operationHash,
    now: () => now, backend, applicationRead: read(s.tenantRole),
    journal: { async beforeStage(o) { journal.push("intent:" + o.stage); }, async stageObserved(o) { journal.push("ack:" + o.stage); } },
    async readBaseline() { pinReads++; return { archiveBytes: Buffer.alloc(0), manifestBytes: Buffer.alloc(0) }; },
  });
  const database = connectDatabase();
  const wrong = [() => connectDatabase().prepare({ ...context, program, sql: "SELECT 1" } as Parameters<typeof database.prepare>[0]),
    () => connectDatabase().prepare({ ...context, program: { ...program, nonce: "other" } }),
    () => connectDatabase().prepare({ ...context, program, externalFence: { ...context.externalFence, operationHash: "8".repeat(64) } }),
    () => connectDatabase().restore({ ...context, baseline: express.baseline, archiveVersionId: express.baseline.archiveVersionId,
      manifestVersionId: express.baseline.manifestVersionId }),
    () => connectDatabase(now).prepare({ ...context, program }),
  ];
  for (const reject of wrong) await assert.rejects(reject(), /NO_RETRY|WINDOW_CLOSED|DATABASE_EPOCH_CHANGED/);
  assert.equal(commands.length, 0);
  assert.equal(pinReads, 0);
  assert.equal(created, false);
  occupied = true;
  const occupiedDatabase = connectDatabase();
  await assert.rejects(occupiedDatabase.inspect(x), /DATABASE_NAMESPACE_OCCUPIED/);
  await assert.rejects(occupiedDatabase.prepare({ ...context, program }), /ENTRY_CLOSED/);
  await assert.rejects(connectDatabase().prepare({ ...context, program }), /DATABASE_NAMESPACE_OCCUPIED/);
  assert.deepEqual(commands, ["owners", "owners"]);
  assert.equal(prepareCalls, 0);
  assert.equal(pinReads, 0);
  occupied = false;
  assert.equal((await database.inspect(x)).state, "missing");
  assert.equal((await database.prepare({ ...context, program })).resultingState, "empty");
  assert.equal((await database.inspect(x)).state, "empty");
  const pinned = express.baseline;
  await database.restore({ ...context, baseline: pinned, archiveVersionId: pinned.archiveVersionId, manifestVersionId: pinned.manifestVersionId });
  assert.equal((await database.inspect(x)).state, "baseline_restored");
  const migrated = await database.migrateSaas({ ...context, command: "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas", migrationContract: s.schemaVersion });
  await database.activateApplication({ ...x, target: express.target, applicationRoleArn: s.applicationRole, migrationEvidenceSha256: migrated.evidenceHash });
  const verified = await database.verify({ ...x, expectedBaselineDigest: objects.archive.sha256, expectedMigrationContract: s.schemaVersion });
  assert.equal(verified.receipt.applicationAccess?.databaseLoginVerified, true);
  assert.equal((await database.inspect(x)).state, "verified");
  assert.equal(pinReads, 1);
  assert.deepEqual(journal, ["intent:restore-empty-baseline", "ack:restore-empty-baseline", "intent:migrate-saas", "ack:migrate-saas",
    "intent:activate-exact-application", "ack:activate-exact-application"]);
  assert.equal(commands.filter(q => q === "COMMIT").length, 3);
  assert.ok(commands.indexOf("restore-pinned") < commands.indexOf("migration-pinned"));
  assert.ok(commands.lastIndexOf("COMMIT") < commands.findIndex(c => c.includes("first_open_fc41597f.activate_role")));
  assert.equal(databaseRoutes[commands.indexOf("restore-pinned")], s.tenantDatabase);
  assert.equal(databaseRoutes[commands.indexOf("migration-pinned")], s.tenantDatabase);
  assert.ok(commands.some(c => c.startsWith("GRANT SELECT (singleton_key) ON TABLE public.saas_instances TO ")));
  assert.equal(prepareCalls, 1);
  assert.ok(!commands.some(c => /\b(?:DROP DATABASE|ALTER ROLE|GRANT rds_iam|SET ROLE)\b/i.test(c)));
  const inspect = () => firstOpenIndependentDatabase(approvedSha256, backend.roleSql, read(FIRST_OPEN_INSPECTOR_SQL_USER));
  const observe = inspect();
  const coordinate = { signal: x.signal, databaseName: s.tenantDatabase, roleName: s.tenantRole };
  const { tlsVerified, transactionReadOnly, ...independent } = await observe(coordinate);
  assert.ok(tlsVerified && transactionReadOnly);
  assert.deepEqual(independent, verified.identity);
  await assert.rejects(observe(coordinate), /INSPECTOR_SCOPE_CHANGED/);
  // The read-only transaction is not sufficient if it is using an admin.
  await assert.rejects(firstOpenIndependentDatabase(approvedSha256, backend.roleSql, read("postgres"))(coordinate), /TARGET_READ_UNPROVED/);
  inspectorDbOid = "20003";
  await assert.rejects(inspect()(coordinate), /TARGET_READ_UNPROVED/);
  inspectorDbOid = ids.databaseOid; otherConnectable = 1;
  await assert.rejects(inspect()(coordinate), /ROLE_OR_ISOLATION_CHANGED/);
  await assert.rejects(database.prepare({ ...context, program }), /NO_RETRY/);
  await assert.rejects(database.inspect(x), /ENTRY_CLOSED/);
});

test("fixed baseline requests only the recorded version and stops on a different response", async () => {
  const requests: unknown[] = [];
  const read = firstOpenBaselineSource({ async send(command: { input: unknown }) {
    requests.push(command.input);
    return { Body: (async function* () { assert.fail("wrong version body read"); })(), VersionId: "other", ContentLength: objects.archive.bytes };
  } } as unknown as Parameters<typeof firstOpenBaselineSource>[0]);
  const { signal } = runtimeFence();
  await assert.rejects(read(signal), /FIXED_BASELINE_READ_FAILED/);
  assert.deepEqual(requests, [{ Bucket: bucket, Key: objects.archive.key, VersionId: objects.archive.versionId, ExpectedBucketOwner: s.account }]);
  await assert.rejects(read(signal), /BASELINE_READ_ALREADY_USED/);
});

test("the signer-only reader pins one version, refuses mixed/full g1 and cannot retry after any ACK", async () => {
  const { signal } = runtimeFence();
  const base = { ARN: signerPin.arn, Name: firstOpenBuyerSignerSecretName, VersionId: signerPin.versionId, SecretString: fixtureBuyerSigningKey };
  for (const changed of [null, { VersionId: "8".repeat(64) }, { Name: s.secretName }, { SecretString: JSON.stringify({ hmac_secret_key: fixtureBuyerSigningKey }) },
    { SecretBinary: new Uint8Array(32) }]) {
    let reads = 0;
    const read = firstOpenBuyerSigningMaterial({ async send(command: { input: Record<string, unknown> }, options: { abortSignal: AbortSignal }) {
      reads++;
      assert.equal(command.constructor.name, "GetSecretValueCommand");
      assert.deepEqual(command.input, { SecretId: signerPin.arn, VersionId: signerPin.versionId });
      assert.equal(options.abortSignal, signal);
      return { ...base, ...changed };
    } } as unknown as Parameters<typeof firstOpenBuyerSigningMaterial>[0], signerPin);
    if (changed) await assert.rejects(read(signal), /BUYER_SIGNER_READ_UNPROVED/);
    else assert.equal(await read(signal), fixtureBuyerSigningKey);
    await assert.rejects(read(signal), /BUYER_SIGNER_READ_ALREADY_USED/);
    assert.equal(reads, 1);
  }
  assert.throws(() => firstOpenBuyerSigningMaterial({ send: notCalled } as unknown as Parameters<typeof firstOpenBuyerSigningMaterial>[0],
    { ...signerPin, arn: `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-xY1234` }), /BUYER_SIGNER_PIN_REQUIRED/);
});

test("only one approval-derived g1 Secret is created; web HMAC does not derive the owner and no ACK retry", async () => {
  const x = runtimeFence(), approvedSha256 = "6".repeat(64);
  const version = await firstOnboardingInitialSecretVersion({ approvalSha256: approvedSha256, name: s.secretName,
    jobId: s.jobId, epoch: x.externalFence, baselineDigest: objects.archive.sha256 });
  const req = { ...x, name: s.secretName, requestSha256: version, initialVersionId: version, idempotencyKey: "fixture" };
  const arn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-xY1234`;
  for (const ackKnown of [true, false]) {
    const commandNames: string[] = [];
    let tags: unknown, creates = 0, ownerSeeds = 0;
    const port = firstOpenInitialSecret({ approvedSha256, client: { async send(command: { input: Record<string, unknown> }) {
      commandNames.push(command.constructor.name);
      switch (command.constructor.name) {
        case "DescribeSecretCommand":
          if (!creates) throw Object.assign(Error(), { name: "ResourceNotFoundException" });
          return { ARN: arn, Name: s.secretName, Tags: tags, VersionIdsToStages: { [version]: ["AWSCURRENT"] } };
        case "CreateSecretCommand":
          creates++;
          assert.equal(command.input.Name, s.secretName);
          assert.equal(command.input.ClientRequestToken, version);
          assert.equal(command.input.KmsKeyId, undefined);
          const material = JSON.parse(String(command.input.SecretString));
          const keys = Object.keys(material).sort();
          assert.deepEqual(keys, ["hmac_secret_key", "jwt_secret_key", "stripe_secret_key", "stripe_webhook_secret"]);
          assert.equal(material.hmac_secret_key, fixtureBuyerSigningKey);
          tags = command.input.Tags;
          if (!ackKnown) throw Error("synthetic unknown result");
          return { ARN: arn, Name: s.secretName, VersionId: version };
        default: assert.fail("unexpected Secret command");
      }
    } } as unknown as Parameters<typeof firstOpenInitialSecret>[0]["client"],
    sts: { async send() { return { Account: s.account, Arn: `arn:aws:sts::${s.account}:assumed-role/TechlongSandboxProvisionerRole/fixture` }; } } as unknown as Parameters<typeof firstOpenInitialSecret>[0]["sts"],
    async loadTenantPaymentMaterial({ jobId, instanceId, approvalSha256 }) {
      return { jobId, instanceId, approvalSha256, buyerSigningKey: fixtureBuyerSigningKey,
        payment: { stripeSecretKey: "sk_test_" + "z".repeat(40), stripeWebhookSecret: "whsec_" + "z".repeat(40) } };
    },
    rememberOwnerSeed({ key, arn: ownerArn, versionId }) {
      ownerSeeds++;
      assert.notEqual(key, fixtureBuyerSigningKey);
      assert.match(key, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(ownerArn, arn);
      assert.equal(versionId, version);
    },
    });
    assert.equal((await port.inspectRuntimeSecret(x)).state, "missing");
    await assert.rejects(port.createInitial({ ...req, initialVersionId: "7".repeat(64) }), /SECRET_CREATE_SCOPE_CHANGED/);
    if (ackKnown) {
      assert.deepEqual((await port.createInitial(req)).metadata, await port.inspectRuntimeSecret(x));
      assert.deepEqual(commandNames, ["DescribeSecretCommand", "CreateSecretCommand", "DescribeSecretCommand"]);
    } else {
      await assert.rejects(port.createInitial(req), /SECRET_CREATE_UNVERIFIED_NO_RETRY/);
      assert.deepEqual(commandNames, ["DescribeSecretCommand", "CreateSecretCommand"]);
    }
    await assert.rejects(port.createInitial(req), /SECRET_CREATE_SCOPE_CHANGED/);
    assert.equal(creates, 1);
    assert.equal(ownerSeeds, ackKnown ? 1 : 0);
  }
});

test("approved g1 proof requires independent exact tags, then only the two same-tag denials in order", async () => {
  for (const mode of ["denied", "arn-allowed", "name-allowed", "unknown", "lookalike", "wrong-tags", "other-stage", "unapproved", "wrong-ack"] as const) {
    const x = runtimeFence(), approvedSha256 = "6".repeat(64);
    const versionId = await firstOnboardingInitialSecretVersion({ approvalSha256: approvedSha256, name: s.secretName,
      jobId: s.jobId, epoch: x.externalFence, baselineDigest: objects.archive.sha256 });
    const arn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-xY1234`;
    const ack = { arn, versionId, externalFence: x.externalFence };
    const seq: string[] = [];
    let tags: { Key: string; Value: string }[] = [];
    const port = firstOpenInitialSecret({ approvedSha256,
      ...(mode !== "unapproved" && { g1StandaloneTagProof: FIRST_OPEN_G1_TAG_PROOF_MODE }),
      client: { async send(command: { input: Record<string, unknown> }) {
        switch (command.constructor.name) {
          case "DescribeSecretCommand":
            seq.push("vacancy"); assert.deepEqual(command.input, { SecretId: s.secretName });
            throw Object.assign(Error(), { name: "ResourceNotFoundException" });
          case "CreateSecretCommand":
            seq.push("create"); assert.equal(command.input.ClientRequestToken, versionId);
            tags = structuredClone(command.input.Tags) as typeof tags;
            return { ARN: arn, Name: s.secretName, VersionId: versionId };
          case "TagResourceCommand": {
            const byArn = command.input.SecretId === arn;
            assert.deepEqual(command.input, { SecretId: byArn ? arn : s.secretName, Tags: tags });
            seq.push(byArn ? "arn" : "name");
            if (mode === "arn-allowed" && byArn || mode === "name-allowed" && !byArn) return {};
            if (mode === "unknown") throw Error("mock network stop");
            const name = byArn ? "AccessDeniedException" : "AccessDenied";
            if (mode === "lookalike") throw Object.assign(Error(), { name });
            throw new SecretsManagerServiceException({ name, $fault: "client", $metadata: { httpStatusCode: byArn ? 400 : 403 } });
          }
          default: return assert.fail("unexpected command");
        }
      } } as unknown as Parameters<typeof firstOpenInitialSecret>[0]["client"],
      sts: { async send() { return { Account: s.account, Arn: `arn:aws:sts::${s.account}:assumed-role/TechlongSandboxProvisionerRole/fixture` }; } } as
        unknown as Parameters<typeof firstOpenInitialSecret>[0]["sts"],
      async loadTenantPaymentMaterial(args) {
        return { ...args, buyerSigningKey: fixtureBuyerSigningKey,
          payment: { stripeSecretKey: "sk_test_" + "z".repeat(40), stripeWebhookSecret: "whsec_" + "z".repeat(40) } };
      },
    });
    await port.inspectRuntimeSecret(x);
    await port.createInitial({ ...x, name: s.secretName, requestSha256: versionId, initialVersionId: versionId, idempotencyKey: "fixture" });
    assert.equal(tags.length, 8);
    const observed = async (coordinates: typeof ack, signal: AbortSignal) => {
      seq.push("independent"); assert.deepEqual(coordinates, ack);
      assertFirstOpenG1InspectedMetadata({ ARN: arn, Name: s.secretName,
        Tags: mode === "wrong-tags" ? [...tags.slice(0, -1), tags[0]] : tags,
        VersionIdsToStages: { [versionId]: mode === "other-stage" ? ["AWSCURRENT", "AWSPENDING"] : ["AWSCURRENT"] } }, coordinates, signal);
    };
    const testGate = port.verifyStandaloneTagDenials(mode === "wrong-ack" ? { ...ack, arn: arn.slice(0, -1) + "0" } : ack, x.signal, observed);
    if (mode === "denied") await testGate;
    else await assert.rejects(testGate, /G1_(TAG_PROOF_SCOPE|TAG_STANDALONE_ALLOWED|TAG_DENIAL_UNPROVED|INSPECT_TAGS|INSPECT_VERSION)/);
    const expected = ["vacancy", "create", ...(!["unapproved", "wrong-ack"].includes(mode) ? ["independent"] : []),
      ...(["denied", "arn-allowed", "name-allowed", "unknown", "lookalike"].includes(mode) ? ["arn"] : []),
      ...(["denied", "name-allowed"].includes(mode) ? ["name"] : [])];
    assert.deepEqual(seq, expected, mode);
    if (mode !== "wrong-ack") { // a malformed invocation consumed no AWS attempts
      await assert.rejects(port.verifyStandaloneTagDenials(ack, x.signal, observed), /G1_TAG_PROOF_SCOPE/);
      assert.deepEqual(seq, expected);
    }
  }
});

test("tagged g1 Inspector binds the returned ARN suffix, exact version and fence before its one ARN read", async () => {
  const { externalFence, signal } = runtimeFence(), versionId = "5".repeat(64), suffix = "xY1234";
  const arn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-${suffix}`;
  const planned = { versionId, externalFence };
  const projection = { secretReferenceSha256: await sha256Hex(arn), versionIdSha256: await sha256Hex(versionId),
    g1e1FenceSha256: await sha256Hex(externalFence) };
  let reads = 0;
  const read = async (id: string, abort: AbortSignal) => {
    reads++; assert.equal(id, arn); assert.equal(abort, signal);
    return { ARN: arn, Name: s.secretName, VersionIdsToStages: { [versionId]: ["AWSCURRENT"] }, Tags: Object.entries({
      ManagedBy: "techlong-sandbox", SecretSchema: "techlong-runtime-four-key-v2", DatabaseProfile: "express_iam",
      ResourceGeneration: "1", StableIdentity: s.stableIdentity, AppInstanceId: s.instanceId, DeploymentId: s.deploymentId,
      OwnershipMarker: externalFence.resourceFence.ownershipMarker,
    }).map(([Key, Value]) => ({ Key, Value })) };
  };
  for (const payload of [projection, { ...projection, g1ArnSuffix: "xY1235" },
    { ...projection, g1ArnSuffix: suffix, versionIdSha256: "b".repeat(64) },
    { ...projection, g1ArnSuffix: suffix, g1e1FenceSha256: "c".repeat(64) }]) {
    await assert.rejects(observeFirstOpenTaggedG1(payload, planned, read, signal), /G1_REQUEST/);
  }
  assert.equal(reads, 0);
  assert.deepEqual(await observeFirstOpenTaggedG1({ ...projection, g1ArnSuffix: suffix }, planned, read, signal), { arn, projection });
  assert.equal(reads, 1);
});

async function fixture(taskRelease?: FirstOpenTaskRelease) {
  const { planningInput } = await cycleFixture(), legacy = structuredClone(planningInput.release);
  legacy.id = s.releaseId; legacy.productId = s.productId;
  Object.assign(legacy.image, { repository: s.imageRepository, manifestDigest: s.imageDigest, platformDigest: s.imageDigest });
  Object.assign(legacy.compatibility, { applicationPort: 3000, schemaVersions: [s.schemaVersion], clientApiVersions: [s.clientApi] });
  const release = taskRelease ?? legacy, v = firstOpenVersion(taskRelease);
  const clock = taskRelease ? taskRelease.firstOpenScope.publication.publishedAt + 60_000 : now;
  const writeBefore = clock + 900_000;
  const fixedWindow = { ...controlledWindow, startAt: clock, claimBefore: clock + 300_000,
    workloadExpiresAt: clock + 7_200_000, factsExpireAt: writeBefore };
  const configuration = { fixture: true }, desiredPlan = { resources: { tenant: { database: { databaseName: s.tenantDatabase, roleName: s.tenantRole } } } };
  const scope = { appInstanceId: s.instanceId, workspaceId, tenantKey: "pending_" + s.instanceId, subscriptionId: s.subscriptionId,
    templateVersionId: "tplver_fixture", environmentId: s.environmentId, accountId: s.account, planId: "pln_fixture",
    releaseId: v.releaseId, artifactRef: v.artifactRef,
    planHash: await sha256Hex(desiredPlan), configurationHash: await sha256Hex(configuration) };
  const held = (await buildFirstOnboardingJob(scope))!;
  assert.equal(held.jobId, s.jobId); assert.equal(held.deploymentId, s.deploymentId);
  const row: FirstOnboardingReviewRow = { ...scope, configuration, desiredPlan, slug: s.hostname.split(".")[0], subscriptionEnd: writeBefore + 900_000,
    instancePendingFirstOpen: true, subscriptionActiveAndCurrent: true, scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef },
    job: { id: held.jobId, deploymentId: held.deploymentId, dedupeKey: held.dedupeKey, jobType: "apply", status: "pending", payload: held.payload,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null } };
  const review = (await reviewFirstOnboarding({ ...row, scope, release }, taskRelease))!;
  const approval: Parameters<ReturnType<typeof createSandboxFirstOpenRunOnce>>[0] = {
    jobId: s.jobId, reviewSha256: review.reviewSha256, capabilitySha256: "a".repeat(64), baselineDigest: objects.archive.sha256,
    databaseSchemaVersion: s.schemaVersion, hostname: s.hostname, dnsTarget: "synthetic-elb.ca-central-1.elb.amazonaws.com", writeBefore,
    controlledWindow: fixedWindow,
    ...(taskRelease ? { taskRelease } : {}),
    completion: { clientApiVersion: s.clientApi, deriveG1Secret: true },
    express: {
      target: { schema: "techlong/express-management-target/v3", clusterArn: s.clusterArn, clusterResourceId: s.clusterId,
        endpoint: "techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com", port: 5432, observedEngineVersion: "17.9", managementDatabase: "postgres",
        managementUsername: FIRST_OPEN_MANAGEMENT_SQL_USER, stableIdentity: s.stableIdentity, resourceGeneration: 1, tenantDatabase: s.tenantDatabase, tenantUsername: s.tenantRole },
      nonce: "a".repeat(32), applicationRoleArn: s.applicationRole, lifecycleRoleArn: s.lifecycleRole, independentRoleArn: s.inspectorRole,
      environmentParametersSha256: "b".repeat(64), mediaPublicBaseUrl: "https://synthetic.cloudfront.net", buyerForwardSigner: signerPin, baseline: {
        contract: "speedfeast-pg16.14-tenant-baseline-v1", archiveS3Uri: `s3://${bucket}/${objects.archive.key}`,
        manifestS3Uri: `s3://${bucket}/${objects.manifest.key}`, archiveSha256: objects.archive.sha256,
        approvedArchiveSha256: objects.archive.sha256, manifestSha256: objects.manifest.sha256, sourceDatabase: "speedfeast",
        archiveVersionId: objects.archive.versionId, manifestVersionId: objects.manifest.versionId,
      },
      sampling: { cellStackId: s.cellStack, platformStackId: s.platformStack, hostedZoneId: s.zone, apiHostname: s.hostname,
        cellOutputParameters: Object.fromEntries(["ClusterName", "VpcId", "SubnetIds", "HttpsListenerArn", "ControlListenerArn"].map(k => [k, k])),
        database: { kind: "cluster", identifier: "techlong-sandbox-express-d001", profile: "express_iam", schemaVersion: s.schemaVersion },
        persistence: { bucket: s.bucket, providerVariable: "IMAGE_STORAGE_PROVIDER", bucketVariable: "IMAGE_S3_BUCKET", verificationSha256: "c".repeat(64) },
        secrets: [{ arn: s.controlArn, versionId: s.controlVersion }] },
    },
  };
  approval.capabilitySha256 = expressBootstrapCandidateDigestV3(compileExpressBootstrapCandidateV3({
    target: approval.express!.target, nonce: approval.express!.nonce, scope: {
      appInstanceId: s.instanceId, workspaceId, productId: s.productId, environmentId: s.environmentId, cellKey: "cell-sandbox-1",
    },
  }));
  const calls: string[] = [];
  const ports: SandboxFirstOpenPorts = {
    repository: { loadContext: async job => {
      calls.push("context"); assert.equal(job.id, s.jobId); assert.equal(job.deploymentId, s.deploymentId);
      assert.match(job.leaseToken, /^lease_[a-f0-9]{32}$/); assert.equal(job.leaseExpiresAt, writeBefore);
      throw Error("SYNTHETIC_STOP_BEFORE_ANY_DEPLOYMENT_WORK");
    }, beginStep: notCalled, finishStep: notCalled, heartbeat: notCalled, claimTenantResourceGeneration: notCalled,
    recordTenantResourceLifecycle: notCalled, reserveEnvironmentCapacity: notCalled, assertTenantExternalOperation: notCalled, transitionDeployment: notCalled },
    cloud: { region: s.region, describeTenantStack: notCalled, getCallerIdentity: notCalled, createStack: notCalled },
    control: { provision: notCalled, readConfiguration: notCalled, waitUntilHealthy: notCalled }, controlPayloadCompiler: { compile: notCalled },
    cellPreflight: { verify: notCalled }, cleanupReadiness: { verify: notCalled, async verifyBeforeClaim({ scope, jobId, approvalSha256, window, signal }) {
      calls.push("preclaim"); assert.equal(jobId, s.jobId); assert.equal(approvalSha256, await firstOnboardingApprovalSha256(approval));
      assert.deepEqual(window, { ...fixedWindow, writeBefore }); signal.throwIfAborted();
      return { scopeSha256: await sha256Hex(scope), reviewSha256: fixedWindow.cleanupReviewSha256,
        permissionsEvidenceSha256: fixedWindow.cleanupPermissionsEvidenceSha256, cellStackId: s.cellStack, verifiedAt: clock,
        expiresAt: fixedWindow.workloadExpiresAt, responsibleCallerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
        order: "workload_database_role_generation_secret_then_cell" };
    } }, provisionEpoch: notCalled,
    async readHeldJob() { calls.push("read"); return row; }, async readFixedRelease() { calls.push("release"); return release; },
    async claimHeldJob(b) { calls.push("claim"); assert.equal(b[0], s.jobId); assert.equal(b[4], s.deploymentId); return { jobId: s.jobId }; },
    async verifyEmptyExpressCapability() { calls.push("capability"); return { profile: "express_iam", restrictedManagementReady: true, evidenceSha256: approval.capabilitySha256 }; },
    express: { database: { inspect: notCalled, prepare: notCalled, restore: notCalled, migrateSaas: notCalled, activateApplication: notCalled, verify: notCalled },
      secret: { inspectRuntimeSecret: notCalled, createInitial: notCalled },
      independent: { caller: async () => { calls.push("independent"); return { accountId: s.account,
        arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxFirstOpenInspector/synthetic-run" }; },
      database: notCalled, read: notCalled, getTechnical: notCalled },
      completionClient: { query: notCalled }, completionReadClient: { query: notCalled } },
  };
  return { approval, ports, row, calls, clock, release, scope };
}

test("the exception requires independently pinned publication and a coherent same-task held row before its one claim", async () => {
  const { originalA, proof, trusted, taskRelease } = await firstOpenTaskReleaseFixture();
  assert.equal(firstOpenVersion().releaseId, originalA.id);
  assert.notEqual(taskRelease.id, originalA.id);
  assert.equal(taskRelease.status, "candidate");
  assert.notEqual(taskRelease.schema, "techlong/stored-release-candidate/v1");
  await assert.rejects(deriveFirstOpenTaskRelease(originalA, proof, { ...trusted, proofSha256: "f".repeat(64) }), /PUBLICATION_NOT_VERIFIED/);
  for (const changed of [{ jobId: "job_" + "a".repeat(24) }, { registryManifestDigest: proof.imageConfigDigest }, { candidateArtifactId: 1 }]) {
    await assert.rejects(deriveFirstOpenTaskRelease(originalA, { ...proof, ...changed }, trusted), /PUBLICATION_MISMATCH/);
  }
  const x = await fixture(taskRelease);
  assert.equal(await reviewFirstOnboarding({ ...x.row, scope: x.scope, release: x.release }), null);
  assert.equal(await reviewFirstOnboarding({ ...x.row, scope: x.scope, release: originalA }, taskRelease), null);
  const old = await fixture();
  const sha = await sha256Hex(x.approval);
  await assert.rejects(createSandboxFirstOpenRunOnce({ ...x.ports, readHeldJob: old.ports.readHeldJob }, () => x.clock)(x.approval, sha), /HELD_JOB_SCOPE/);
  await assert.rejects(createSandboxFirstOpenRunOnce({ ...x.ports, readFixedRelease: old.ports.readFixedRelease }, () => x.clock)(x.approval, sha), /RELEASE_SCOPE/);
  assert.ok(!x.calls.includes("claim"));
  x.calls.length = 0;
  const run = createSandboxFirstOpenRunOnce(x.ports, () => x.clock);
  await assert.rejects(run(x.approval, sha), /SYNTHETIC_STOP_BEFORE_ANY_DEPLOYMENT_WORK/);
  await assert.rejects(run(x.approval, sha), /ENTRY_ALREADY_USED/);
  assert.equal(x.calls.filter(c => c === "claim").length, 1);
});

test("the deferred cleanup intent excludes only the evidence digest and cannot run without the independently pinned full approval", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { approval, ports, clock, calls } = await fixture(taskRelease);
  approval.approvalBinding = FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF;
  const draft: FirstOnboardingDeferredCleanupApprovalDraft = { ...structuredClone(approval), taskRelease,
    approvalBinding: FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF,
    controlledWindow: { ...approval.controlledWindow! } };
  delete draft.controlledWindow.cleanupPermissionsEvidenceSha256;
  const intent = await firstOnboardingApprovalSha256(draft), formal = await sha256Hex(approval);
  assert.equal(await firstOnboardingApprovalSha256(approval), intent);
  assert.notEqual(intent, formal);
  assert.equal(Object.hasOwn(draft.controlledWindow, "cleanupPermissionsEvidenceSha256"), false);
  assert.equal(approval.controlledWindow!.cleanupPermissionsEvidenceSha256, "2".repeat(64));

  const changedProof = structuredClone(approval);
  changedProof.controlledWindow!.cleanupPermissionsEvidenceSha256 = "3".repeat(64);
  assert.equal(await firstOnboardingApprovalSha256(changedProof), intent);
  assert.notEqual(await sha256Hex(changedProof), formal);
  await assert.rejects(verifyFirstOnboardingApprovalBinding(changedProof, intent, formal), /APPROVAL_BINDING/);
  for (const changed of [
    { ...draft, writeBefore: draft.writeBefore + 1 },
    { ...draft, controlledWindow: { ...draft.controlledWindow, cleanupReviewSha256: "3".repeat(64) } },
    { ...draft, express: { ...draft.express!, environmentParametersSha256: "3".repeat(64) } },
  ]) assert.notEqual(await firstOnboardingApprovalSha256(changed), intent);
  for (const wrong of [
    { ...approval, jobId: "job_" + "a".repeat(24) },
    { ...approval, taskRelease: undefined },
    { ...approval, taskRelease: { ...taskRelease, image: { ...taskRelease.image, verificationSha256: "3".repeat(64) } } },
    { ...approval, approvalBinding: "unknown" as typeof approval.approvalBinding },
  ]) await assert.rejects(firstOnboardingApprovalSha256(wrong), /APPROVAL_BINDING/);

  const run = createSandboxFirstOpenRunOnce(ports, () => clock);
  await assert.rejects(run(approval, intent), /APPROVAL_SHA/);
  await assert.rejects(run(changedProof, intent, formal), /APPROVAL_SHA/);
  await assert.rejects(run(approval, formal, formal), /APPROVAL_SHA/);
  await assert.rejects(run(draft as typeof approval, intent, await sha256Hex(draft)), /APPROVAL_SHA/);
  assert.deepEqual(calls, []);
  assert.equal(await verifyFirstOnboardingApprovalBinding(approval, intent, formal), true);
  await assert.rejects(run(approval, intent, formal), /SYNTHETIC_STOP_BEFORE_ANY_DEPLOYMENT_WORK/);
  await assert.rejects(run(approval, intent, formal), /ENTRY_ALREADY_USED/);
  assert.equal(calls.filter(v => v === "claim").length, 1);

  const legacy = (await fixture()).approval, legacySha = await sha256Hex(legacy);
  assert.equal(await firstOnboardingApprovalSha256(legacy), legacySha);
  assert.equal(await verifyFirstOnboardingApprovalBinding(legacy, legacySha), true);
  await assert.rejects(verifyFirstOnboardingApprovalBinding(legacy, legacySha, legacySha), /APPROVAL_BINDING/);
});

test("the second slot is covered by both approval hashes and never claims without an independently sealed binding", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { approval, clock, ports, calls } = await fixture(taskRelease);
  approval.approvalBinding = FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF;
  const oldIntent = await firstOnboardingApprovalSha256(approval);
  approval.express!.secondSlot = { schema: "techlong/fc41597f-second-slot/v1", admissionEpoch: 7,
    environmentPolicy: { ...v3Environment().policy, maxTenants: 2 }, listenerPriority: 102 };
  const intent = await firstOnboardingApprovalSha256(approval), formal = await sha256Hex(approval);
  assert.notEqual(intent, oldIntent);
  await checkSandboxFirstOpenApproval(approval, intent, clock, formal);
  for (const override of [{ listenerPriority: 104 }, { admissionEpoch: 8 }]) {
    const changed = structuredClone(approval);
    Object.assign(changed.express!.secondSlot!, override);
    await assert.rejects(checkSandboxFirstOpenApproval(changed, intent, clock, await sha256Hex(changed)), /APPROVAL_SHA/);
    await assert.rejects(checkSandboxFirstOpenApproval(changed, await firstOnboardingApprovalSha256(changed), clock, formal), /APPROVAL_SHA/);
  }
  const oldApprovalType = { ...approval, approvalBinding: undefined };
  await assert.rejects(checkSandboxFirstOpenApproval(oldApprovalType, await sha256Hex(oldApprovalType), clock), /SECOND_SLOT_REVIEW/);
  await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => clock)(approval, intent, formal), /SECOND_SLOT_NO_INDEPENDENT_BINDING/);
  assert.equal(calls.length, 0);

  const listener = `arn:aws:elasticloadbalancing:${s.region}:${s.account}:listener/app/techlong-sandbox-fixture/12345678/`;
  const controlRef = `${s.controlArn}:::${s.controlVersion}`;
  const tenantStackParameters = completeFirstOpenBuyerParameters({ ClusterName: "cell-sandbox-1", VpcId: "vpc-0123456789abcdef0",
    SubnetIds: "subnet-0123456789abcdef0,subnet-0123456789abcdef1", TaskSecurityGroupId: "sg-0123456789abcdef0",
    HttpsListenerArn: listener + "aaaaaaaa", ControlListenerArn: listener + "bbbbbbbb", TaskExecutionRoleArn: s.executionRole,
    ControlPublicKeyValueFrom: controlRef, StripePublishableKey: `pk_test_${"a".repeat(24)}` });
  approval.express!.environmentParametersSha256 = await sha256Hex(tenantStackParameters);
  const scopedIntent = await firstOnboardingApprovalSha256(approval), scopedFormal = await sha256Hex(approval);
  const sealed = await sealFirstOpenTaskBinding({ approvalSha256: scopedIntent, parametersSha256: approval.express!.environmentParametersSha256,
    environment: { ...v3Environment(), policy: approval.express!.secondSlot!.environmentPolicy },
    binding: { environmentId: s.environmentId, status: "active", workerRoleArn: s.workerRole, cloudFormationRoleArn: s.cfnRole, tenantStackParameters },
    express: { controlRef, applicationRoleArn: s.applicationRole } });
  const protectedPorts: SandboxFirstOpenPorts = { ...ports, express: { ...ports.express, independent: undefined, handoff: {
    async checkIdentity() { calls.push("independent"); }, verifyInitialSecret: notCalled, verifyRuntime: notCalled,
  } } };
  const unproved = { ...protectedPorts, cleanupReadiness: { ...ports.cleanupReadiness,
    async verifyBeforeClaim(x: Parameters<NonNullable<SandboxFirstOpenPorts["cleanupReadiness"]["verifyBeforeClaim"]>>[0]) {
      return { ...await ports.cleanupReadiness.verifyBeforeClaim!(x), scopeSha256: "0".repeat(64) };
    },
  } };
  await assert.rejects(createSandboxFirstOpenRunOnce(unproved, () => clock, sealed)(approval, scopedIntent, scopedFormal), /CLEANUP/);
  assert.deepEqual(calls.slice(-2), ["independent", "preclaim"]);
  assert.ok(!calls.includes("claim"));
  const run = createSandboxFirstOpenRunOnce(protectedPorts, () => clock, sealed);
  await assert.rejects(run(approval, scopedIntent, scopedFormal), /SYNTHETIC_STOP_BEFORE_ANY_DEPLOYMENT_WORK/);
  await assert.rejects(run(approval, scopedIntent, scopedFormal), /ENTRY_ALREADY_USED/);
  assert.deepEqual(calls.slice(-4), ["independent", "preclaim", "claim", "context"]);
  assert.equal(calls.filter(x => x === "claim").length, 1);
});

test("the fixed entry reaches the real worker's sole claim, then never replays the invocation", async () => {
  const { approval, ports, calls } = await fixture(), run = createSandboxFirstOpenRunOnce(ports, () => now);
  const sha = await sha256Hex(approval);
  await assert.rejects(run(approval, sha), /SYNTHETIC_STOP_BEFORE_ANY_DEPLOYMENT_WORK/);
  await assert.rejects(run(approval, sha), /ENTRY_ALREADY_USED/);
  assert.deepEqual(calls, ["read", "release", "capability", "independent", "preclaim", "claim", "context"]);
  const denied = await fixture(), deniedSha = await sha256Hex(denied.approval);
  denied.ports.verifyEmptyExpressCapability = async () => ({ profile: "express_iam", emptyDatabaseInitializationVerified: true,
    evidenceSha256: denied.approval.capabilitySha256 });
  await assert.rejects(createSandboxFirstOpenRunOnce(denied.ports, () => now)(denied.approval, deniedSha), /EMPTY_EXPRESS_UNPROVED/);
  assert.deepEqual(denied.calls, ["read", "release"]);
  const downgrade = { ...approval, express: { ...approval.express!, target: { ...approval.express!.target, managementUsername: "postgres" as const } } };
  await assert.rejects(checkSandboxFirstOpenApproval(downgrade, await sha256Hex(downgrade), now), /PROVIDER_SCOPE/);
  const withoutSigner = structuredClone(approval);
  delete withoutSigner.express!.buyerForwardSigner;
  await assert.rejects(checkSandboxFirstOpenApproval(withoutSigner, await sha256Hex(withoutSigner), now), /BUYER_SIGNER_PIN_REQUIRED/);
});

test("protected GitHub entry verifies checkout, original attempt, sealed payload and claim window before adapters", async () => {
  const { approval } = await fixture(), a = "1".repeat(40), b = "2".repeat(40), hash = "3".repeat(64);
  const record = { schema: "techlong/sandbox-first-open-protected-launch/v1",
    approval, inspectorSeed: {}, hostSha256: { management: hash, runonce: hash, inspect: hash },
    release: { schema: "techlong/sandbox-first-open-release/v1", jobId: s.jobId, workflowId: "108",
      callerCommit: a, runtimeCommit: b, approvalSha256: await sha256Hex(approval), actorId: "14145707",
      startAt: now, claimBefore: approval.controlledWindow!.claimBefore, writeBefore },
  } as unknown as FirstOpenLaunchRecord;
  const release = await sha256Hex(record.release);
  const env = { GITHUB_REPOSITORY: "veinyyxy/TechlongSoftware", GITHUB_REPOSITORY_ID: "1323312747", GITHUB_REPOSITORY_OWNER_ID: "14145707",
    GITHUB_ACTOR_ID: "14145707", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "144", GITHUB_SHA: a, GITHUB_WORKFLOW_REF: "veinyyxy/TechlongSoftware/.github/workflows/sandbox-first-open-v1.yml@refs/heads/main",
    FIRST_OPEN_APPROVED_LAUNCH_SHA256: await sha256Hex(record), FIRST_OPEN_APPROVED_RELEASE_SHA256: release, FIRST_OPEN_RELEASE: release,
    FIRST_OPEN_PAIR: hash, FIRST_OPEN_INSPECT_RUN: "0", FIRST_OPEN_PROTECTED_RECORD: JSON.stringify(record), GH_TOKEN: "fixture_token" };
  const input: LocalLaunch = { role: "inspect", env, actualCheckout: b, expectedCheckout: b };
  assert.equal((await authorizeFirstOpenLaunch(input, now)).trustedReleaseSha256, release);
  for (const wrong of [{ ...input, actualCheckout: a }, { ...input, env: { ...env, GITHUB_RUN_ATTEMPT: "2" } },
    { ...input, env: { ...env, FIRST_OPEN_PROTECTED_RECORD: "" } }]) {
    await assert.rejects(launchFirstOpenJob({ ...wrong, peerRunId: "145",
      async readHost() { return assert.fail("must not access any adapter"); } }, runtimeFence().signal, () => now), /FIRST_OPEN_LAUNCH_/);
  }
  await assert.rejects(authorizeFirstOpenLaunch(input, record.release.claimBefore), /CODE_OR_WINDOW/);
  const common = { run_attempt: 1, workflow_id: 108, event: "workflow_dispatch", path: ".github/workflows/sandbox-first-open-v1.yml",
    head_branch: "main", head_sha: a, conclusion: null, status: "in_progress", actor: { id: 14145707 }, triggering_actor: { id: 14145707 },
    repository: { id: 1323312747, owner: { id: 14145707 }, full_name: "veinyyxy/TechlongSoftware" }, head_repository: { id: 1323312747 } };
  const self = { ...common, id: 144, display_title: "first-open-fc41597f-inspect-" + hash };
  const peer = { ...common, id: 145, display_title: "first-open-fc41597f-runonce-" + hash + "-144" };
  const fetcher = async (url: string | Request | URL, options?: RequestInit) => {
    assert.equal(options?.method, "GET");
    return Response.json(String(url).endsWith("/runs/144") ? self : { workflow_runs: [peer] });
  };
  assert.equal(await firstOpenPeerRun(input, runtimeFence().signal, () => now, fetcher), "145");
  await assert.rejects(firstOpenPeerRun(input, runtimeFence().signal, () => now, async url =>
    Response.json(String(url).endsWith("/runs/144") ? self : { workflow_runs: [peer, { ...peer, id: 146 }] })), /PEER_AMBIGUOUS/);
});

test("protected adapter is loaded only from the exact bytes and only exposes its assigned role", async () => {
  const bytes = Buffer.from("export const firstOpenHost = { management: async () => ({ fixture: true }) };");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const source = bytes.toString("base64");
  await assert.rejects(sealedFirstOpenHost(source, "management", "a".repeat(64)), /SEALED_HOST/);
  await assert.rejects(sealedFirstOpenHost(source, "runonce", digest), /SEALED_HOST/);
  const host = await sealedFirstOpenHost(source, "management", digest);
  assert.deepEqual(Object.keys(host), ["management"]);
});

test("offline composition refuses to share a connection between completion and readback", async () => {
  const { approval, ports, calls } = await fixture();
  const approvedSha256 = await sha256Hex(approval), sql = { query: notCalled };
  assert.throws(() => bindSandboxFirstOpenRunOnce({ approval, approvedSha256,
    sql: { review: { query: notCalled }, claim: { query: notCalled }, completion: sql, inspection: sql },
    aws: { ...ports.cloud, applySupervisedTenantStack: notCalled }, ports,
    runtimeGrantEvidenceSha256: "4".repeat(64), verifyRuntimeGrant: notCalled }), /COMPOSITION_SCOPE/);
  assert.deepEqual(calls, []);
});

test("first-open middle only sends fixed RPC calls; SQL candidate rejects a changed repository", async () => {
  const f = await fixture(), scope = { approvalSha256: await sha256Hex(f.approval), planHash: f.row.deployment.planHash,
    configurationHash: f.row.deployment.configurationHash, writeBefore, window: controlledWindow };
  const source = firstOnboardingMiddleRepositorySource();
  const ddl = await sandboxFirstOpenMiddleDdl(scope, source);
  assert.match(ddl, /SECURITY DEFINER SET search_path TO pg_catalog,public,pg_temp/);
  assert.match(ddl, /WHEN 'activate_epoch' THEN/);
  assert.match(ddl, /p_op='readiness'/);
  assert.doesNotMatch(ddl, /WHEN '(claim|complete|cleanup)' THEN|\bEXECUTE\s+p_/);
  await assert.rejects(sandboxFirstOpenMiddleDdl(scope, source + "\n// drift"), /FIRST_OPEN_MIDDLE_REPOSITORY_SHA/);
  assert.deepEqual(FIRST_OPEN_AUTHORITY_POLICY.Statement[0].Condition["ForAllValues:StringEquals"]["dynamodb:LeadingKeys"], [FIRST_OPEN_AUTHORITY_KEY]);
  const lease = { jobId: s.jobId, deploymentId: s.deploymentId, workerId: FIRST_OPEN_MIDDLE_WORKER, attempt: 1,
    leaseToken: "lease_" + "d".repeat(32) };
  let calls = 0;
  const repo = createSandboxFirstOpenMiddleRepository({ scope, now: () => now, sql: { async query(sql, params) {
    calls++;
    assert.equal(sql, FIRST_OPEN_MIDDLE_RPC);
    assert.deepEqual(params.slice(0, 3), [scope.approvalSha256, lease.leaseToken, "heartbeat"]);
    assert.equal(JSON.parse(params[3])[6], writeBefore);
    return { rows: [{ row: { id: s.jobId } }] };
  } } });
  assert.equal(await repo.heartbeat({ lease, now, leaseDurationMs: 120_000, notAfter: writeBefore }), true);
  assert.throws(() => repo.heartbeat({ lease, now, leaseDurationMs: 120_000, notAfter: writeBefore + 1 }), /HEARTBEAT_WINDOW/);
  assert.throws(() => repo.heartbeat({ lease: { ...lease, jobId: "job_other" }, now, leaseDurationMs: 120_000, notAfter: writeBefore }), /MIDDLE_LEASE/);
  assert.equal(calls, 1);
});

test("only the exact approved window can start, and skipped time never reaches an adapter", async () => {
  const { approval, ports, calls } = await fixture(), sha = await sha256Hex(approval);
  for (const t of [now - 1, controlledWindow.claimBefore, writeBefore]) {
    await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => t)(approval, sha), /WINDOW_CLOSED|RUN_WINDOW/);
  }
  const invalid = structuredClone(approval);
  invalid.controlledWindow!.workloadExpiresAt += 1000;
  const malformedSha = await sha256Hex(invalid);
  await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => now)(invalid, sha), /APPROVAL_SHA/);
  await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => now)(invalid, malformedSha), /CONTROLLED_WINDOW_INVALID/);
  delete invalid.controlledWindow;
  await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => now)(invalid, await sha256Hex(invalid)), /CONTROLLED_WINDOW_INVALID/);
  invalid.controlledWindow = { ...controlledWindow, factsExpireAt: writeBefore - 1 };
  await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => now)(invalid, await sha256Hex(invalid)), /CONTROLLED_WINDOW_INVALID/);
  invalid.controlledWindow = { ...controlledWindow, claimBefore: controlledWindow.claimBefore + 1 };
  await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => now)(invalid, await sha256Hex(invalid)), /CONTROLLED_WINDOW_INVALID/);
  assert.deepEqual(calls, []);
});

test("bad cleanup evidence or a clock reaching claim cutoff during proof never sends claim", async () => {
  for (const bad of ["expiry", "permissions", "stack", "stale", "clock"] as const) {
    const { approval, ports, calls } = await fixture(), good = ports.cleanupReadiness.verifyBeforeClaim!;
    let clock = now;
    ports.cleanupReadiness.verifyBeforeClaim = async x => {
      const v = await good(x);
      if (bad === "expiry") v.expiresAt -= 1000;
      if (bad === "permissions") v.permissionsEvidenceSha256 = "f".repeat(64);
      if (bad === "stack") v.cellStackId += "/other";
      if (bad === "stale") v.verifiedAt -= 30_001;
      if (bad === "clock") { clock = controlledWindow.claimBefore; v.verifiedAt = clock; }
      return v;
    };
    await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => clock)(approval, await sha256Hex(approval)),
      bad === "clock" ? /CLAIM_WINDOW_CLOSED/ : /CLEANUP_READINESS_UNPROVED/);
    assert.equal(calls.includes("claim"), false);
  }
});

test("rejects cross-task, altered, swapped and fallback baselines without calling an adapter", async () => {
  const { approval, ports, calls } = await fixture(), run = createSandboxFirstOpenRunOnce(ports, () => now);
  for (const [update, code] of [
    [(a: typeof approval) => { a.jobId = "job_" + "b".repeat(24); }, /TASK_SCOPE/],
    [(a: typeof approval) => { a.writeBefore = now; }, /WINDOW/],
    [(a: typeof approval) => { a.express!.baseline.archiveVersionId = "null"; }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.baseline.manifestVersionId = "another-valid-version"; }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.baseline.archiveVersionId = objects.manifest.versionId; }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.baseline.manifestS3Uri += ".other"; }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.baseline.archiveS3Uri = `s3://${FIRST_OPEN_BASELINE_BUCKET}/${originals.archive.key}`; }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.baseline.manifestSha256 = "0".repeat(64); }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.sampling.secrets[0].versionId = "0".repeat(64); }, /PROVIDER_SCOPE/],
  ] as const) {
    const changed = structuredClone(approval); update(changed);
    await assert.rejects(run(changed, await sha256Hex(changed)), code);
  }
  await assert.rejects(run(approval, "d".repeat(64)), /APPROVAL_SHA/);
  assert.deepEqual(calls, []);
  await checkSandboxFirstOpenApproval(approval, await sha256Hex(approval), now);
  assert.throws(() => validateApprovedBaseline(approval.express!.baseline), /Tenant baseline/);
  assert.throws(() => validateApprovedBaseline(approval.express!.baseline, "job_other"), /Tenant baseline/);
  assert.deepEqual(validateApprovedBaseline(approval.express!.baseline, s.jobId), approval.express!.baseline);
  const genericBaseline = { ...approval.express!.baseline, archiveS3Uri: "s3://legacy-baselines/_migration/schema.dump",
    manifestS3Uri: "s3://legacy-baselines/_migration/schema.manifest.json" };
  assert.throws(() => validateApprovedBaseline(genericBaseline, s.jobId), /Tenant baseline/);
  assert.deepEqual(validateApprovedBaseline(genericBaseline, "job_other"), genericBaseline);
});

test("a cross-workspace or already consumed job never reaches the claim port", async () => {
  for (const mutate of [
    (r: FirstOnboardingReviewRow) => { r.workspaceId = "wsp_wrong"; },
    (r: FirstOnboardingReviewRow) => { r.job.attempts = 1; },
  ]) {
    const { approval, ports, row, calls } = await fixture();
    mutate(row);
    await assert.rejects(createSandboxFirstOpenRunOnce(ports, () => now)(approval, await sha256Hex(approval)), /HELD_JOB_/);
    assert.deepEqual(calls, ["read"]);
  }
});

test("historical HEAD plan still describes the original, uncopied object keys", () => {
  const [a, m] = ["archive", "manifest"].map(k => firstOpenBaselineHeadRequest(k as "archive" | "manifest"));
  assert.equal(a.Bucket, m.Bucket);
  assert.equal(a.ExpectedBucketOwner, s.account);
  assert.equal(a.ChecksumMode, "ENABLED");
  assert.deepEqual([a.Key, m.Key], [originals.archive.key, originals.manifest.key]);
  const first = { VersionId: "an-exact/version", ContentLength: originals.archive.bytes,
    ChecksumType: "FULL_OBJECT", ChecksumSHA256: Buffer.from(originals.archive.sha256, "hex").toString("base64") };
  const second = { VersionId: "a-manifest", ContentLength: originals.manifest.bytes, ChecksumType: "COMPOSITE" };
  assert.deepEqual(projectFirstOpenBaselineHeads({ archive: first, manifest: second }).map(r => r.status),
    ["PIN_MATCHES", "FIXED_VERSION_BYTE_CHECK_REQUIRED"]);
  assert.deepEqual(projectFirstOpenBaselineHeads({ archive: { ...first, VersionId: "null" }, manifest: { ...second, ContentLength: 1 } }).map(r => r.status),
    ["UNPINNED", "MISMATCH"]);
});

const copiedBaselineReceipt = new URL("../docs/evidence/sandbox-first-open-baseline-copy-fc41597f-continuation.verified.json", import.meta.url);
test("local first-open baseline binding matches the private copy receipt", {
  skip: existsSync(copiedBaselineReceipt) ? false : "Private operations receipt is not part of the source checkout",
}, () => {
  const evidence = JSON.parse(readFileSync(copiedBaselineReceipt, "utf8"));
  assert.equal(evidence.status, "FIXED_BASELINE_COPIES_VERIFIED");
  assert.equal(fixed.jobId, evidence.jobId);
  assert.equal(bucket, evidence.bucket);
  assert.deepEqual(Object.entries(objects).map(([kind, object]) => ({ kind, ...object })),
    evidence.objects.map(({ kind, key, sha256, bytes, versionId }: { kind: string; key: string; sha256: string; bytes: number; versionId: string }) =>
      ({ kind, key, sha256, bytes, versionId })));
});

test("first-open baseline grants are fixed to the two exact object versions", () => {
  const versions = { archiveVersionId: objects.archive.versionId, manifestVersionId: objects.manifest.versionId };
  const p = sandboxFirstOpenPolicyDrafts(versions);
  assert.equal(p.runtimeSecretReadPending, true);
  assert.deepEqual(p.lifecycle.Statement.filter(a => a.Action.startsWith("s3:")), Object.values(objects).map(({ key, versionId }) => ({
    Effect: "Allow", Action: "s3:GetObjectVersion", Resource: `arn:aws:s3:::${bucket}/${key}`, Condition: { StringEquals: { "s3:VersionId": versionId } },
  })));
  assert.match(JSON.stringify(p.submitter), new RegExp(SANDBOX_FIRST_OPEN_STACK));
  assert.doesNotMatch(JSON.stringify(p), /ListBucket|UpdateStack|DeleteStack|DeleteObject|PutSecretValue|CreateRole|AssumeRole/);
  assert.throws(() => sandboxFirstOpenPolicyDrafts({ ...versions, archiveVersionId: "another-valid-version" }), /BASELINE_VERSION/);
  assert.throws(() => sandboxFirstOpenPolicyDrafts({ ...versions, manifestVersionId: versions.archiveVersionId }), /BASELINE_VERSION/);
});

test("planned g1 policy denies missing and wrong versions without changing other secret scopes", () => {
  const { objects } = fixed;
  const baseline = { archiveVersionId: objects.archive.versionId, manifestVersionId: objects.manifest.versionId };
  const versionId = "c".repeat(64);
  const unbound = sandboxFirstOpenPolicyDrafts(baseline);
  const bound = sandboxFirstOpenPolicyDrafts({ ...baseline, plannedRuntimeSecretVersionId: versionId });
  const { execution: before, ...otherRoles } = unbound;
  const { execution: after, ...otherBoundRoles } = bound;
  assert.deepEqual(otherBoundRoles, otherRoles);
  const Resource = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-??????`;
  const Action = "secretsmanager:GetSecretValue", key = "secretsmanager:VersionId";
  assert.deepEqual(after.Statement, [...before.Statement,
    { Effect: "Allow", Action, Resource, Condition: { StringEquals: { [key]: versionId } } },
    { Effect: "Deny", Action, Resource, Condition: { Null: { [key]: "true" } } },
    { Effect: "Deny", Action, Resource, Condition: { Null: { [key]: "false" }, StringNotEquals: { [key]: versionId } } },
  ]);
});

test("claim SQL uses immutable scope and narrow RPC calls, not agent-supplied SQL or a replay", async () => {
  const sha = "a".repeat(64);
  const ddl = sandboxFirstOpenClaimDdl({ approvalSha256: sha, planHash: "b".repeat(64), configurationHash: "c".repeat(64), writeBefore, window: controlledWindow });
  assert.match(ddl, /REVOKE ALL ON FUNCTION techlong_first_onboarding_claim\.claim\(text,jsonb\) FROM PUBLIC/);
  assert.match(ddl, new RegExp(s.jobId));
  assert.match(ddl, /SET search_path TO pg_catalog/);
  assert.match(ddl, new RegExp(`FOR UPDATE OF j,d,a,s,w,e[\\s\\S]+db_clock AS MATERIALIZED[\\s\\S]+FROM eligible[\\s\\S]+t.now_ms>=${now} AND t.now_ms<${controlledWindow.claimBefore}`));
  assert.doesNotMatch(ddl, /\$\d+|CREATE ROLE|GRANT (?:SELECT|UPDATE) ON|EXECUTE format/);
  let submits = 0;
  const client = sandboxFirstOpenClaimPorts({ async query(sql, params) {
    assert.equal(sql, "SELECT techlong_first_onboarding_claim.review() AS result"); assert.deepEqual(params, []);
    return { rows: [{ result: { job: { id: s.jobId } } }] };
  } }, { async query(sql, params) {
    submits++; assert.equal(sql, "SELECT * FROM techlong_first_onboarding_claim.claim($1::text,$2::jsonb)");
    assert.equal(params[0], sha); assert.equal(JSON.parse(params[1]).length, 8);
    throw Error("AMBIGUOUS_RESPONSE");
  } }, sha);
  assert.equal((await client.readHeldJob())?.job.id, s.jobId);
  const b = [s.jobId, "worker", "lease_token", writeBefore, s.deploymentId, "{}", "{}", "{}", "{}", s.instanceId, workspaceId,
    s.subscriptionId, "tenant", s.environmentId, s.account, "pln_fixture", "tplver_fixture", "pending"];
  await assert.rejects(client.claimHeldJob(b), /AMBIGUOUS_RESPONSE/);
  await assert.rejects(client.claimHeldJob(b), /ALREADY_SUBMITTED/);
  assert.equal(submits, 1);
});
