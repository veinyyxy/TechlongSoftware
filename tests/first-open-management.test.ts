import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { S3Client } from "@aws-sdk/client-s3";
import { compileExpressBootstrapCandidateV3 } from "../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { FIRST_OPEN_BASELINE_BINDING as baseline } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenManagementClaimProof, FIRST_OPEN_MANAGEMENT_CLAIM_READ } from "../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { firstOnboardingCompletionDdl } from "../lib/deployments/execution/first-onboarding-completion-entry.ts";
import { firstOpenBuyerBinding } from "../lib/deployments/execution/first-open-buyer-binding.ts";
import { firstOnboardingInitialSecretVersion, type FirstOnboardingExpressApproval } from "../lib/deployments/execution/first-onboarding-express.ts";
import { firstOpenMiddleOperationHash } from "../lib/deployments/execution/first-onboarding-middle.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenManagementClient, firstOpenManagementMailbox, firstOpenManagementOperationSha256, firstOpenManagementSteps,
  serveFirstOpenManagement, type FirstOpenManagementScope } from "../ops/aws-sandbox/first-open-management-bridge.ts";
import { firstOpenManagementIamDraft, firstOpenManagementNeonDraft } from "../ops/aws-sandbox/first-open-management-install.ts";
import { renderFirstOpenLockedProvisioner } from "../ops/aws-sandbox/scripts/first-open-lifecycle-iam-delta.mjs";
import { firstOpenBuyerSignerSecretName } from "../lib/buyer-forward/signer-binding.ts";
import { requireFirstOpenControlledCfnPreclaimProof, type FirstOpenFixedManagement } from "../ops/aws-sandbox/first-open-express-runtime.ts";
import { firstOpenExpressDatabase, type FirstOpenBackendPorts } from "../ops/aws-sandbox/first-open-express-database.ts";
import { firstOpenSessionArn } from "../ops/aws-sandbox/first-open-sessions.ts";
import { FIRST_OPEN_MANAGER_IDENTITY_SQL, firstOpenManagerSessions, type FirstOpenPg,
  type FirstOpenSigner } from "../ops/aws-sandbox/first-open-express-management.ts";
import type { FirstOpenFrozenRelease } from "../ops/aws-sandbox/first-open-release-entry.ts";
import prepared from "../ops/aws-sandbox/first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };
import bootstrap from "../ops/aws-sandbox/cloudformation/s3-bootstrap.template.json" with { type: "json" };
import { firstOpenTaskReleaseFixture } from "./first-open-task-release-fixture.ts";

const now = Date.UTC(2026, 10, 19, 19), writeBefore = now + 900_000, loginBefore = now + 600_000;
const approvalSha256 = "a".repeat(64), hash = "b".repeat(64), workspaceId = "wsp_beb2aa5868a9d1c10c257348";
const signal = () => new AbortController().signal;
const arn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-aBc123`;

async function fixture() {
  const resource = { schemaVersion: 1, generation: 1, ownerDeploymentId: s.deploymentId,
    ownershipMarker: "tl_owner_" + s.stableIdentity.slice(0, 32) + "_g1",
    identity: { schemaVersion: 1, appInstanceId: s.instanceId, workspaceId, productId: s.productId, environmentId: s.environmentId,
      cellKey: "cell-sandbox-1", stableIdentityHash: s.stableIdentity, databaseName: s.tenantDatabase, roleName: s.tenantRole,
      secretName: s.secretName.slice(0, -3) } } as const;
  const epoch = { schemaVersion: 1, resourceFence: resource, epoch: 1, state: "active", intent: "provision", ownerDeploymentId: s.deploymentId,
    operationHash: prepared.scope.expectedProvisionOperationSha256, marker: `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1` } as const;
  const express = { nonce: "a".repeat(32), target: {
    schema: "techlong/express-management-target/v3", tenantDatabase: s.tenantDatabase, tenantUsername: s.tenantRole,
    stableIdentity: s.stableIdentity, resourceGeneration: 1, clusterArn: s.clusterArn, clusterResourceId: s.clusterId,
    endpoint: "techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com", port: 5432,
    observedEngineVersion: "17.9", managementDatabase: "postgres", managementUsername: "sf_fc41597f_lifecycle",
  }, baseline: { archiveVersionId: baseline.objects.archive.versionId, manifestVersionId: baseline.objects.manifest.versionId,
    archiveSha256: baseline.objects.archive.sha256 } } as FirstOnboardingExpressApproval;
  const scope: FirstOpenManagementScope = { express, fence: { fence: resource, externalFence: epoch }, approvalSha256, releaseSha256: hash,
    runId: "101", writeBefore, applicationLoginBefore: loginBefore,
    initialVersionId: await firstOnboardingInitialSecretVersion({ approvalSha256, name: s.secretName, jobId: s.jobId,
      epoch, baselineDigest: baseline.objects.archive.sha256 }) };
  const calls: string[] = [];
  const receipt = { ...scope.fence, evidenceHash: hash };
  const management: FirstOpenFixedManagement = {
    async checkReady() { calls.push("ready"); },
    database: Object.fromEntries(firstOpenManagementSteps.map(step => [step, async (x: { externalFence: typeof epoch; program?: { target: { tenantDatabase: string } };
      archiveVersionId?: string; migrationEvidenceSha256?: string }) => {
      assert.equal(x.externalFence.operationHash, epoch.operationHash);
      if (step === "prepare") assert.equal(x.program?.target.tenantDatabase, s.tenantDatabase);
      if (step === "restore") assert.equal(x.archiveVersionId, baseline.objects.archive.versionId);
      if (step === "activateApplication") assert.equal(x.migrationEvidenceSha256, hash);
      calls.push(step);
      return step === "verify" ? { receipt, identity: { databaseOid: "50101" } } : receipt;
    }])) as unknown as FirstOpenFixedManagement["database"],
  };
  return { scope, calls, management };
}

test("two sides complete the fixed sequence, with each SQL entry preceded by a live claim check", async () => {
  const { scope, calls, management } = await fixture();
  const values = new Map<string, unknown>(), waiters = new Map<string, (v: unknown) => void>();
  const key = (x: { direction: string; slot: number }) => x.direction + x.slot;
  const wire: Parameters<typeof firstOpenManagementClient>[1] = {
    async put(x, v) { const k = key(x); assert.ok(!values.has(k)); values.set(k, v); waiters.get(k)?.(v); },
    async take(x) { const k = key(x); return values.has(k) ? values.get(k) : new Promise(resolve => waiters.set(k, resolve)); },
  };
  const done = serveFirstOpenManagement(scope, wire, management, async () => { calls.push("claim"); }, signal(), () => now);
  const client = await firstOpenManagementClient(scope, wire, () => now);
  await client.checkReady(approvalSha256, loginBefore, signal());
  const x = { ...scope.fence, signal: signal() }, common = { ...x, runtimeSecretRef: arn, idempotencyKey: "fixture" };
  const { target, nonce, baseline: pins } = scope.express;
  const program = compileExpressBootstrapCandidateV3({ target, nonce, scope: { appInstanceId: s.instanceId, workspaceId, productId: s.productId,
    environmentId: s.environmentId, cellKey: "cell-sandbox-1" } });
  await assert.rejects(client.database.prepare({ ...common, program }), /ORDER/);
  assert.equal(values.size, 1);
  await client.database.inspect(x);
  await client.database.prepare({ ...common, program });
  await client.database.inspect(x);
  await client.database.inspect(x);
  await client.database.restore({ ...common, baseline: pins, archiveVersionId: pins.archiveVersionId, manifestVersionId: pins.manifestVersionId });
  await client.database.inspect(x);
  await client.database.migrateSaas({ ...common, command: "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas", migrationContract: s.schemaVersion });
  await client.database.activateApplication({ ...x, target, applicationRoleArn: s.applicationRole, migrationEvidenceSha256: hash });
  await client.database.inspect(x);
  await client.database.verify({ ...x, expectedBaselineDigest: pins.archiveSha256, expectedMigrationContract: s.schemaVersion });
  await client.database.inspect(x);
  await done;
  assert.deepEqual(calls, ["ready", ...firstOpenManagementSteps.flatMap(s => ["claim", s])]);
  assert.equal(values.size, 23);
  assert.deepEqual(Object.keys(values.get("request2") as object).sort(), ["previousReplySha256", "runtimeSecretArn", "scope", "slot", "step"]);
});

test("Management and Express enforce the current reviewed task's operation fence without accepting the legacy fence", async () => {
  const { taskRelease } = await firstOpenTaskReleaseFixture();
  const { scope: old, calls, management } = await fixture();
  const expected = await firstOpenMiddleOperationHash({ planHash: prepared.scope.planSha256,
    configurationHash: prepared.scope.configurationSha256, taskRelease });
  assert.equal(await firstOpenManagementOperationSha256(taskRelease), expected);
  assert.notEqual(expected, old.fence.externalFence.operationHash);
  const epoch = { ...old.fence.externalFence, operationHash: expected };
  const fence = { fence: old.fence.fence, externalFence: epoch };
  const initialVersionId = await firstOnboardingInitialSecretVersion({ approvalSha256, name: s.secretName, jobId: s.jobId,
    epoch, baselineDigest: baseline.objects.archive.sha256 });
  const current = { ...old, fence, initialVersionId, taskRelease };
  const wire = {
    async put() { calls.push("put"); },
    async take() { throw Error("OFFLINE_TEST_STOP_AT_READY"); },
  };
  await firstOpenManagementClient(current, wire, () => now);
  for (const wrong of [{ ...old, taskRelease }, { ...current, taskRelease: undefined }]) {
    await assert.rejects(firstOpenManagementClient(wrong, wire, () => now), /RELEASE_SCOPE/);
    await assert.rejects(serveFirstOpenManagement(wrong, wire, management, async () => { calls.push("claim"); },
      signal(), () => now), /RELEASE_SCOPE/);
  }
  const tampered = structuredClone(taskRelease);
  tampered.firstOpenScope.publication.publishedAt++;
  await assert.rejects(firstOpenManagementClient({ ...current, taskRelease: tampered }, wire, () => now), /FIRST_OPEN_TASK_PROOF_DIGEST/);
  assert.equal(calls.length, 0);
  await assert.rejects(serveFirstOpenManagement(current, wire, management, async () => { calls.push("claim"); },
    signal(), () => now), /OFFLINE_TEST_STOP_AT_READY/);
  assert.deepEqual(calls, ["ready", "put"]);

  const unused = async () => { throw Error("UNEXPECTED_EXPRESS_CALL"); };
  const backend: FirstOpenBackendPorts = {
    ownersSql: "fixture-owner-inspect", emptySql: "", catalogSql: "", roleSql: "",
    async management(_signal, run) {
      calls.push("express-read");
      return run(async () => ({ rowCount: 1, rows: [{ databases: [], roles: [] }] }));
    },
    prepare: unused, pair: unused, compileBaseline: unused, migrations: () => [],
    countsSql() { throw Error("UNEXPECTED_EXPRESS_CALL"); },
    verifyCounts() { throw Error("UNEXPECTED_EXPRESS_CALL"); },
    verifyCatalog() { throw Error("UNEXPECTED_EXPRESS_CALL"); },
  };
  const database = firstOpenExpressDatabase({ approval: old.express, approvalSha256, expectedOperationSha256: expected,
    deadline: writeBefore, now: () => now, backend, journal: { beforeStage: unused, stageObserved: unused },
    applicationRead: unused, readBaseline: unused });
  await assert.rejects(database.inspect({ ...old.fence, signal: signal() }), /DATABASE_EPOCH_CHANGED/);
  assert.equal((await database.inspect({ ...fence, signal: signal() })).state, "missing");
  assert.deepEqual(calls, ["ready", "put", "express-read"]);
});

test("unclaimed or malformed mailbox requests cannot reach Aurora", async () => {
  for (const extraSql of [true, false]) {
    const { scope, calls, management } = await fixture();
    let ready: { scope: string } | undefined;
    await assert.rejects(serveFirstOpenManagement(scope, {
      async put(_, value) { ready = value as { scope: string }; },
      async take() { return { scope: ready!.scope, slot: 1, step: "inspect", previousReplySha256: await sha256Hex(ready),
        runtimeSecretArn: null, ...(extraSql ? { sql: "SELECT 1" } : {}) }; },
    }, management, firstOpenManagementClaimProof({ async query(sql, values) {
      assert.equal(sql, FIRST_OPEN_MANAGEMENT_CLAIM_READ);
      assert.deepEqual(values, [approvalSha256]);
      return { rows: [{ ready: false }] };
    } }, approvalSha256), signal(), () => now), /MESSAGE_SHAPE|CLAIM_UNPROVED/);
    assert.deepEqual(calls, ["ready"]);
  }
});

test("Management takes only a digest and a fixed object version for the final claimed workload slot", async () => {
  const stackId = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/12345678-1234-1234-1234-123456789abc`;
  for (const addUntrustedFields of [false, true]) {
    const { scope, calls, management } = await fixture();
    let last: { scope: string; slot: number };
    const wire: Parameters<typeof serveFirstOpenManagement>[1] = {
      async put(_, value) { last = value as typeof last; },
      async take(x) {
        const { slot, scope: key } = last;
        assert.equal(x.slot, slot + 1);
        const previousReplySha256 = await sha256Hex(last);
        return x.slot <= firstOpenManagementSteps.length
          ? { scope: key, slot: x.slot, previousReplySha256, step: firstOpenManagementSteps[slot], runtimeSecretArn: slot === 0 ? null : arn }
          : { scope: key, slot: x.slot, previousReplySha256, requestSha256: hash, versionId: "exact.version", putAcknowledgedAt: now,
            ...(addUntrustedFields ? { parameters: { ImageUri: "unreviewed" } } : {}) };
      },
    };
    const done = serveFirstOpenManagement(scope, wire, management, async () => { calls.push("claim"); }, signal(), () => now, async x => {
      assert.equal(calls.at(-1), "claim");
      assert.equal(x.arn, arn);
      assert.equal(x.identity.databaseOid, "50101");
      assert.equal(x.requestSha256, hash);
      assert.equal(x.versionId, "exact.version");
      assert.equal(x.putAcknowledgedAt, now);
      calls.push("submit");
      return { stackId };
    });
    if (addUntrustedFields) await assert.rejects(done, /MESSAGE_SHAPE/);
    else { await done; assert.equal((last! as typeof last & { stackId: string }).stackId, stackId); }
    assert.equal(calls.filter(x => x === "submit").length, addUntrustedFields ? 0 : 1);
  }
});

test("controlled workload boot is bound to the exact writing role, initial denial and independent source", () => {
  const release = { approvalSha256, writeBefore };
  const proof = { schema: "techlong/fc41597f-controlled-cfn-preclaim/v1" as const, jobId: s.jobId, ...release,
    authorRoleArn: s.workerRole, submitterRoleArn: s.lifecycleRole, executionRoleArn: s.cfnRole, checkedAt: now,
    versionedTemplateWriteProtectionSha256: hash, provisionerCreateDeniedSha256: hash, managementInitiallyCreateDeniedSha256: hash,
    authoritySourceSha256: hash };
  assert.deepEqual(requireFirstOpenControlledCfnPreclaimProof(proof, release, now), proof);
  for (const invalid of [undefined, { ...proof, checkedAt: now + 1 }, { ...proof, checkedAt: now - 5 * 3_600_000 },
    { ...proof, managementInitiallyCreateDeniedSha256: "" }, { ...proof, authoritySourceSha256: "" },
    { ...proof, submitterRoleArn: s.workerRole }]) {
    assert.throws(() => requireFirstOpenControlledCfnPreclaimProof(invalid, release, now), /CONTROLLED_CFN_PRECLAIM_PROOF_REQUIRED/);
  }
});

test("mailbox splits put directions and never repeats an unknown write", async () => {
  let writes = 0;
  const client = { async send(cmd: { input: Record<string, unknown> }) {
    writes++;
    assert.equal(cmd.input.IfNoneMatch, "*");
    assert.equal(cmd.input.ServerSideEncryption, "AES256");
    throw Error("unavailable");
  } } as unknown as S3Client;
  const mailbox = firstOpenManagementMailbox(client, "runonce", approvalSha256);
  await assert.rejects(mailbox.put({ direction: "reply", signal: signal(), slot: 0 }, {}), /KEY_SCOPE/);
  await assert.rejects(mailbox.put({ direction: "request", signal: signal(), slot: 1 }, {}), /PUT_STOP_NO_RETRY/);
  assert.equal(writes, 1);
});

test("the lifecycle transport signs as the restricted login on maintenance and only the pinned new database", async () => {
  const { scope: { express: { target } } } = await fixture();
  const databases: unknown[] = [], signers: unknown[] = [];
  let targetOid = "50101";
  const statements: string[] = [];
  const managerRoleOid = "50102";
  const identity = { accessKeyId: "fixture", secretAccessKey: "fixture", sessionToken: "fixture",
    expiration: new Date(now + 120_000) };
  class Client implements FirstOpenPg {
    password: unknown;
    readOnly = false;
    connection = { stream: ({ encrypted: true, authorized: true, servername: target.endpoint, destroy() {} }) as
      NonNullable<NonNullable<FirstOpenPg["connection"]>["stream"]> };
    db: unknown;
    constructor(config: Record<string, unknown>) {
      assert.equal(config.user, "sf_fc41597f_lifecycle");
      assert.equal(config.host, target.endpoint);
      assert.equal((config.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, true);
      assert.ok(config.database === "postgres" || config.database === s.tenantDatabase);
      databases.push(config.database);
      this.db = config.database;
      this.password = config.password;
    }
    async connect() { assert.equal(await (this.password as () => Promise<string>)(), "fixture-signed"); }
    async end() { assert.equal(this.password, null); }
    on() {}
    async query(input: Parameters<FirstOpenPg['query']>[0]) {
      if (typeof input === "string") {
        statements.push(input);
        if (input === "BEGIN READ ONLY") this.readOnly = true;
        return { rowCount: 0, rows: [] };
      }
      if (this.readOnly && input.text !== FIRST_OPEN_MANAGER_IDENTITY_SQL) {
        assert.match(input.text, /^SELECT NOT pg_is_in_recovery/);
        assert.doesNotMatch(input.text, /(?:FROM|SELECT)\s+(?:first_open_fc41597f_cleanup\.)?cleanup_role\(/i);
        assert.deepEqual(input.values, [s.tenantDatabase, s.tenantRole, "sf_fc41597f_lifecycle_definer"]);
        return { rowCount: 1, rows: [{ writer: true, vacant: true, installed: true }] };
      }
      assert.equal(input.text, FIRST_OPEN_MANAGER_IDENTITY_SQL);
      assert.deepEqual(input.values, [s.tenantDatabase]);
      return { rowCount: 1, rows: [{ database: this.db, database_oid: this.db === "postgres" ? "5" : targetOid,
        username: "sf_fc41597f_lifecycle", session_username: "sf_fc41597f_lifecycle", owner_oid: this.db === "postgres" ? "16410" : managerRoleOid,
        role_oid: managerRoleOid, version: 170009, read_only: this.readOnly ? "on" : "off", encoding: "UTF8", tls: true, limited_role: true, no_other_databases: true }] };
    }
  }
  const Signer: FirstOpenSigner = class {
    constructor(config: ConstructorParameters<FirstOpenSigner>[0]) {
      assert.equal(config.credentials, identity);
      assert.equal(config.hostname, target.endpoint);
      signers.push(config.username);
    }
    async getAuthToken() { return "fixture-signed"; }
  };
  const input = { target, Client, Signer, ca: [], credentials: async () => identity };
  assert.throws(() => firstOpenManagerSessions({ ...input, target: { ...target, managementUsername: "postgres" } }), /RESTRICTED_MANAGEMENT_IDENTITY/);
  assert.deepEqual(databases, []);
  const sessions = firstOpenManagerSessions(input);
  await sessions.management(signal(), async (_sql, oid) => assert.equal(oid, managerRoleOid));
  let paired = 0;
  const run = async () => { paired++; };
  await sessions.pair("50101", signal(), run);
  targetOid = "50103";
  await assert.rejects(sessions.pair("50101", signal(), run), /NO_RETRY/);
  assert.equal(paired, 1);
  assert.deepEqual(databases, ["postgres", "postgres", s.tenantDatabase, "postgres", s.tenantDatabase]);
  assert.deepEqual(signers, Array(5).fill("sf_fc41597f_lifecycle"));
  assert.deepEqual(await sessions.verifyCleanup(signal()), { maintenanceWriter: true, tenantAbsent: true, fixedRoutineVisible: true });
  assert.equal(databases.at(-1), "postgres");
  assert.equal(databases.length, 6);
  assert.deepEqual(statements.slice(-2), ["BEGIN READ ONLY", "COMMIT"]);
});

const releaseDraft = { jobId: s.jobId, actorId: "14145707", approvalSha256, startAt: now, claimBefore: now + 60_000,
  applicationLoginBefore: loginBefore, writeBefore, managementReusableCommit: "d".repeat(40),
  runOnceReusableCommit: "e".repeat(40), inspectReusableCommit: "f".repeat(40) } as FirstOpenFrozenRelease;

test("one local install package pins Management trust and leaves the unproved RunOnce writer closed", async () => {
  const p = releaseDraft;
  const aws = firstOpenManagementIamDraft(p);
  const signer = { arn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${firstOpenBuyerSignerSecretName}-Ab12Cd`,
    versionId: "54e22cf8-e142-4448-a175-a37eefa88611" };
  const containingSigner = firstOpenManagementIamDraft(p, signer);
  assert.deepEqual(containingSigner.shared, aws.shared);
  assert.equal(aws.writerFederation.status, "BLOCKED_NO_PROVED_EFFECTIVE_WRITER_SCOPE");
  assert.equal(aws.writerFederation.roleSessionName, firstOpenSessionArn("provisioner").split("/").at(-1));
  assert.equal(aws.writerFederation.roleArn, s.workerRole);
  assert.equal(aws.writerFederation.buyerSigner, null);
  assert.deepEqual(containingSigner.writerFederation.buyerSigner, { ...signer, readBefore: p.claimBefore });
  assert.equal(aws.writerFederation.requiredAws.cellReadback.length, 6);
  assert.deepEqual(aws.writerFederation.requiredAws.authority, ["dynamodb:GetItem", "dynamodb:PutItem"]);
  assert.equal(aws.writerFederation.writeAuthorityProposal.executableApprovalSha256, null);
  assert.equal(aws.writerFederation.writeAuthorityProposal.cloudFormation.immutableTemplateUrl, null);
  assert.doesNotMatch(JSON.stringify(aws.shared), /FirstOpenWriterOnlyOidc|FirstOpenWriterExactBuyerSignerVersion|first-open-run-once-job-v1/);
  assert.throws(() => firstOpenManagementIamDraft(p, { ...signer, versionId: "AWSCURRENT" }), /BUYER_SIGNER_PIN/);
  const key = "token.actions.githubusercontent.com:job_workflow_ref";
  assert.match(aws.shared.lifecycleTrustAppend.Condition.StringEquals[key], /first-open-management-job-v1\.yml@d{40}$/);
  assert.equal(aws.identities.applicationProbeLockedTrustReplacement.Principal.AWS, s.lifecycleRole);
  const dbUserArn = `arn:aws:rds-db:${s.region}:${s.account}:dbuser:${s.clusterId}/sf_fc41597f_lifecycle`;
  const managerDbAllow = aws.shared.lifecyclePolicyAppend.find(p => p.Sid === "FirstOpenManagerDbConnect");
  const managerDbDeny = aws.shared.lifecyclePolicyAppend.find(p => p.Sid === "FirstOpenNoFederatedLifecycleOtherDb");
  assert.equal(managerDbAllow && "Resource" in managerDbAllow && managerDbAllow.Resource, dbUserArn);
  assert.equal(managerDbDeny && "NotResource" in managerDbDeny && managerDbDeny.NotResource, dbUserArn);
  assert.match(JSON.stringify(aws.shared.dedicatedLifecycleBoundaryAllowAppend), /\/sf_fc41597f_lifecycle/);
  assert.doesNotMatch(JSON.stringify(aws.shared), /dbuser:[^"\s]+\/postgres/);
  assert.equal(aws.maxUploads, 23);
  assert.ok(aws.requests.every(r => !aws.replies.includes(r)));
  const db = await firstOpenManagementNeonDraft({ approvalSha256, writeBefore,
    planHash: prepared.scope.planSha256, configurationHash: prepared.scope.configurationSha256,
    window: { startAt: now, claimBefore: p.claimBefore, workloadExpiresAt: now + 7_200_000, factsExpireAt: writeBefore,
      cleanupReviewSha256: hash, cleanupPermissionsEvidenceSha256: hash } },
  readFileSync(new URL("../lib/deployments/execution/neon-repository.ts", import.meta.url), "utf8"));
  assert.match(db.claim, /management_ready\(text\) TO first_onboarding_fc41597f_review/);
  assert.match(db.claim, /lease_expires_at>t\.ms/);
  assert.match(db.claim, new RegExp(prepared.scope.expectedProvisionOperationSha256));
  assert.match(db.middle, /SECURITY DEFINER/);
  assert.match(db.middle, /OR EXISTS\s*\(SELECT 1 FROM public\.deployment_environment_bindings WHERE environment_id\s*=/);
  assert.match(db.completion, /GRANT EXECUTE ON FUNCTION techlong_first_onboarding\.complete/);
  const { buyerOrigin } = firstOpenBuyerBinding;
  assert.ok(db.completion.includes(`access_url='${buyerOrigin}'`));
  assert.ok(db.completion.includes(`'tenantHostname',e.req#>>'{receipt,hostname}','buyerOrigin','${buyerOrigin}'`));
  assert.ok(db.completion.includes(`a.access_url='${buyerOrigin}' AND d.outputs::jsonb->>'buyerOrigin'='${buyerOrigin}'`));
  assert.match(db.completion, /p\.output::jsonb->>'hostname'=a\.slug \|\| '\.sandbox\.techlong\.cloud'/);
});

test("the deny-only Provisioner fence leaves the MFA path intact and cuts off the exact reserved AWS userId", () => {
  const role = bootstrap.Resources.ProvisionerRole, { writerFederation } = firstOpenManagementIamDraft(releaseDraft);
  const candidate = renderFirstOpenLockedProvisioner(role, writerFederation);
  const { Policies, ...originalProps } = candidate.Properties;
  assert.deepEqual(originalProps, role.Properties);
  assert.equal(Object.hasOwn(role.Properties, "Policies"), false);
  assert.equal(Policies.length, 1);
  const Statement = Policies[0].PolicyDocument.Statement as {
    Sid: string; Effect: string; Action: string; Resource: string;
    Condition: { StringEquals: { "aws:userid": string }; DateGreaterThanEquals?: { "aws:CurrentTime": string } };
  }[];
  assert.ok(Buffer.byteLength(JSON.stringify(Policies[0].PolicyDocument)) < 10240);
  assert.ok(Statement.every(s => s.Effect === "Deny" && s.Action === "*" && s.Resource === "*"));
  const before = new Date(writeBefore - 1).toISOString(), at = new Date(writeBefore).toISOString();
  const legacy = writerFederation.roleId + ":techlong-sandbox-provisioner";
  const reserved = writerFederation.roleId + ":" + writerFederation.roleSessionName;
  // Predicate matrix only, alongside the inspection of the actual emitted
  // policy. No unstated OIDC downstream context or IAM simulation is assumed.
  const matches = (uid: string, timestamp: string) => Statement.filter(st =>
    st.Condition.StringEquals["aws:userid"] === uid &&
    (!st.Condition.DateGreaterThanEquals || timestamp >= st.Condition.DateGreaterThanEquals["aws:CurrentTime"])).map(st => st.Sid);
  assert.deepEqual(matches(legacy, before), []);
  assert.deepEqual(matches(legacy, at), []);
  assert.deepEqual(matches("", at), []);
  assert.deepEqual(matches("OTHERROLE:" + writerFederation.roleSessionName, at), []);
  assert.deepEqual(matches(reserved, before), ["FirstOpenFc41597fWriterLocked"]);
  assert.deepEqual(matches(reserved, at), ["FirstOpenFc41597fWriterAfterWindow", "FirstOpenFc41597fWriterLocked"]);
  const changedTrust = structuredClone(role);
  changedTrust.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals["sts:RoleSessionName"] = writerFederation.roleSessionName;
  assert.throws(() => renderFirstOpenLockedProvisioner(changedTrust, writerFederation), /WRITER_ORIGINAL_TRUST/);
  assert.throws(() => renderFirstOpenLockedProvisioner(candidate, writerFederation), /WRITER_ORIGINAL_TRUST/);
  assert.throws(() => renderFirstOpenLockedProvisioner(role, { ...writerFederation, roleId: "CHANGED" }), /WRITER_FENCE_SCOPE/);
  assert.throws(() => renderFirstOpenLockedProvisioner(role, { ...writerFederation, writeBefore: Infinity }), /WRITER_FENCE_SCOPE/);
});

test("scoped completion cannot publish the old buyer or technical API origin as the new buyer entry", () => {
  const scope = { jobId: s.jobId, deploymentId: s.deploymentId, instanceId: s.instanceId, approvalSha256, writeBefore };
  const roles = { definer: "first_onboarding_ci_definer", writer: "first_onboarding_ci_writer", reader: "first_onboarding_ci_reader" };
  for (const buyerOrigin of ["https://buyer.sandbox.techlong.cloud", firstOpenBuyerBinding.apiOrigin,
    "https://app-" + "7".repeat(24) + ".sandbox.techlong.cloud", firstOpenBuyerBinding.buyerOrigin + "/"]) {
    assert.throws(() => firstOnboardingCompletionDdl({ ...scope, buyerOrigin }, roles), /COMPLETION_BUYER_ORIGIN_INVALID/);
  }
  const legacy = firstOnboardingCompletionDdl(scope, roles);
  assert.ok(legacy.includes("access_url='https://' || (e.req#>>'{receipt,hostname}')"));
  assert.ok(legacy.includes("a.access_url='https://' || (d.outputs::jsonb->>'tenantHostname')"));
  assert.doesNotMatch(legacy, /buyerOrigin/);
});
