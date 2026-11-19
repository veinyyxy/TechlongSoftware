import assert from "node:assert/strict";
import test from "node:test";
import { buildFirstOnboardingJob, reviewFirstOnboarding, type FirstOnboardingReviewRow } from "../lib/deployments/first-onboarding.ts";
import { FIRST_OPEN_BASELINE_BUCKET, FIRST_OPEN_BASELINE_OBJECTS as objects, firstOpenBaselineHeadRequest,
  projectFirstOpenBaselineHeads } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { sandboxFirstOpenClaimDdl, sandboxFirstOpenClaimPorts } from "../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { sandboxFirstOpenPolicyDrafts } from "../lib/deployments/execution/first-onboarding-run-permissions.ts";
import { createSandboxFirstOpenRunOnce, checkSandboxFirstOpenApproval, SANDBOX_FIRST_OPEN as s,
  SANDBOX_FIRST_OPEN_STACK, type SandboxFirstOpenPorts } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { validateApprovedBaseline } from "../lib/deployments/execution/tenant-database.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { cycleFixture } from "./instance-release-cycle-fixture.ts";

const now = Date.UTC(2026, 10, 19), writeBefore = now + 900_000;
const workspaceId = "wsp_beb2aa5868a9d1c10c257348"; // ID only, used to exercise the real scope hash; all stored rows below are synthetic.
const notCalled = async (): Promise<never> => assert.fail("an out-of-scope port was called");

async function fixture() {
  const { planningInput } = await cycleFixture(), release = structuredClone(planningInput.release);
  release.id = s.releaseId; release.productId = s.productId;
  Object.assign(release.image, { repository: s.imageRepository, manifestDigest: s.imageDigest, platformDigest: s.imageDigest });
  Object.assign(release.compatibility, { applicationPort: 3000, schemaVersions: [s.schemaVersion], clientApiVersions: [s.clientApi] });
  const configuration = { fixture: true }, desiredPlan = { resources: { tenant: { database: { databaseName: s.tenantDatabase, roleName: s.tenantRole } } } };
  const scope = { appInstanceId: s.instanceId, workspaceId, tenantKey: "pending_" + s.instanceId, subscriptionId: s.subscriptionId,
    templateVersionId: "tplver_fixture", environmentId: s.environmentId, accountId: s.account, planId: "pln_fixture",
    releaseId: s.releaseId, artifactRef: s.imageRepository + "@" + s.imageDigest,
    planHash: await sha256Hex(desiredPlan), configurationHash: await sha256Hex(configuration) };
  const held = (await buildFirstOnboardingJob(scope))!;
  assert.equal(held.jobId, s.jobId); assert.equal(held.deploymentId, s.deploymentId);
  const row: FirstOnboardingReviewRow = { ...scope, configuration, desiredPlan, slug: s.hostname.split(".")[0], subscriptionEnd: writeBefore + 900_000,
    instancePendingFirstOpen: true, subscriptionActiveAndCurrent: true, scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef },
    job: { id: held.jobId, deploymentId: held.deploymentId, dedupeKey: held.dedupeKey, jobType: "apply", status: "pending", payload: held.payload,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null } };
  const review = (await reviewFirstOnboarding({ ...row, scope, release }))!;
  const approval: Parameters<ReturnType<typeof createSandboxFirstOpenRunOnce>>[0] = {
    jobId: s.jobId, reviewSha256: review.reviewSha256, capabilitySha256: "a".repeat(64), baselineDigest: objects.archive.sha256,
    databaseSchemaVersion: s.schemaVersion, hostname: s.hostname, dnsTarget: "synthetic-elb.ca-central-1.elb.amazonaws.com", writeBefore,
    completion: { clientApiVersion: s.clientApi, deriveG1Secret: true },
    express: {
      target: { schema: "techlong/express-management-target/v3", clusterArn: s.clusterArn, clusterResourceId: s.clusterId,
        endpoint: "synthetic.ca-central-1.rds.amazonaws.com", port: 5432, observedEngineVersion: "17.9", managementDatabase: "postgres",
        managementUsername: "postgres", stableIdentity: s.stableIdentity, resourceGeneration: 1, tenantDatabase: s.tenantDatabase, tenantUsername: s.tenantRole },
      nonce: "a".repeat(32), applicationRoleArn: s.applicationRole, lifecycleRoleArn: s.lifecycleRole, independentRoleArn: s.inspectorRole,
      environmentParametersSha256: "b".repeat(64), mediaPublicBaseUrl: "https://synthetic.cloudfront.net", baseline: {
        contract: "speedfeast-pg16.14-tenant-baseline-v1", archiveS3Uri: `s3://${FIRST_OPEN_BASELINE_BUCKET}/${objects.archive.key}`,
        manifestS3Uri: `s3://${FIRST_OPEN_BASELINE_BUCKET}/${objects.manifest.key}`, archiveSha256: objects.archive.sha256,
        approvedArchiveSha256: objects.archive.sha256, manifestSha256: objects.manifest.sha256, sourceDatabase: "speedfeast",
        archiveVersionId: "verified-archive/v1", manifestVersionId: "verified-manifest/v2",
      },
      sampling: { cellStackId: s.cellStack, platformStackId: s.platformStack, hostedZoneId: s.zone, apiHostname: s.hostname,
        cellOutputParameters: Object.fromEntries(["ClusterName", "VpcId", "SubnetIds", "HttpsListenerArn", "ControlListenerArn"].map(k => [k, k])),
        database: { kind: "cluster", identifier: "techlong-sandbox-express-d001", profile: "express_iam", schemaVersion: s.schemaVersion },
        persistence: { bucket: s.bucket, providerVariable: "IMAGE_STORAGE_PROVIDER", bucketVariable: "IMAGE_S3_BUCKET", verificationSha256: "c".repeat(64) },
        secrets: [{ arn: s.controlArn, versionId: s.controlVersion }] },
    },
  };
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
    cellPreflight: { verify: notCalled }, cleanupReadiness: { verify: notCalled }, provisionEpoch: notCalled,
    async readHeldJob() { calls.push("read"); return row; }, async readFixedRelease() { calls.push("release"); return release; },
    async claimHeldJob(b) { calls.push("claim"); assert.equal(b[0], s.jobId); assert.equal(b[4], s.deploymentId); return { jobId: s.jobId }; },
    async verifyEmptyExpressCapability() { calls.push("capability"); return { profile: "express_iam", emptyDatabaseInitializationVerified: true, evidenceSha256: approval.capabilitySha256 }; },
    express: { database: { inspect: notCalled, prepare: notCalled, restore: notCalled, migrateSaas: notCalled, activateApplication: notCalled, verify: notCalled },
      secret: { inspectRuntimeSecret: notCalled, createInitial: notCalled },
      independent: { caller: async () => { calls.push("independent"); return { accountId: s.account,
        arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxFirstOpenInspector/synthetic-run" }; },
      database: notCalled, read: notCalled, getTechnical: notCalled },
      completionClient: { query: notCalled }, completionReadClient: { query: notCalled } },
  };
  return { approval, ports, row, calls };
}

test("the fixed entry reaches the real worker's sole claim, then never replays the invocation", async () => {
  const { approval, ports, calls } = await fixture(), run = createSandboxFirstOpenRunOnce(ports, () => now);
  const sha = await sha256Hex(approval);
  await assert.rejects(run(approval, sha), /SYNTHETIC_STOP_BEFORE_ANY_DEPLOYMENT_WORK/);
  await assert.rejects(run(approval, sha), /ENTRY_ALREADY_USED/);
  assert.deepEqual(calls, ["read", "release", "capability", "independent", "claim", "context"]);
});

test("rejects expired, cross-task and unpinned inputs without calling an adapter", async () => {
  const { approval, ports, calls } = await fixture(), run = createSandboxFirstOpenRunOnce(ports, () => now);
  for (const [update, code] of [
    [(a: typeof approval) => { a.jobId = "job_" + "b".repeat(24); }, /TASK_SCOPE/],
    [(a: typeof approval) => { a.writeBefore = now; }, /WINDOW/],
    [(a: typeof approval) => { a.express!.baseline.archiveVersionId = "null"; }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.baseline.manifestS3Uri += ".other"; }, /BASELINE_PINS/],
    [(a: typeof approval) => { a.express!.sampling.secrets[0].versionId = "0".repeat(64); }, /PROVIDER_SCOPE/],
  ] as const) {
    const changed = structuredClone(approval); update(changed);
    await assert.rejects(run(changed, await sha256Hex(changed)), code);
  }
  await assert.rejects(run(approval, "d".repeat(64)), /APPROVAL_SHA/);
  assert.deepEqual(calls, []);
  await checkSandboxFirstOpenApproval(approval, await sha256Hex(approval), now);
  assert.throws(() => validateApprovedBaseline(approval.express!.baseline), /Tenant baseline/);
  assert.deepEqual(validateApprovedBaseline(approval.express!.baseline, true), approval.express!.baseline);
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

test("baseline HEAD plan and IAM version grants cover only the two original objects", () => {
  const [a, m] = ["archive", "manifest"].map(k => firstOpenBaselineHeadRequest(k as "archive" | "manifest"));
  assert.equal(a.Bucket, m.Bucket);
  assert.equal(a.ExpectedBucketOwner, s.account);
  assert.equal(a.ChecksumMode, "ENABLED");
  assert.notEqual(a.Key, m.Key);
  const first = { VersionId: "an-exact/version", ContentLength: objects.archive.bytes,
    ChecksumType: "FULL_OBJECT", ChecksumSHA256: Buffer.from(objects.archive.sha256, "hex").toString("base64") };
  const second = { VersionId: "a-manifest", ContentLength: objects.manifest.bytes, ChecksumType: "COMPOSITE" };
  assert.deepEqual(projectFirstOpenBaselineHeads({ archive: first, manifest: second }).map(r => r.status),
    ["PIN_MATCHES", "FIXED_VERSION_BYTE_CHECK_REQUIRED"]);
  assert.deepEqual(projectFirstOpenBaselineHeads({ archive: { ...first, VersionId: "null" }, manifest: { ...second, ContentLength: 1 } }).map(r => r.status),
    ["UNPINNED", "MISMATCH"]);
  const p = sandboxFirstOpenPolicyDrafts({ archiveVersionId: first.VersionId, manifestVersionId: second.VersionId });
  assert.equal(p.runtimeSecretReadPending, true);
  assert.deepEqual(p.lifecycle.Statement.filter(a => a.Action.startsWith("s3:")).map(a => a.Condition?.StringEquals["s3:VersionId"]), [first.VersionId, second.VersionId]);
  assert.match(JSON.stringify(p.submitter), new RegExp(SANDBOX_FIRST_OPEN_STACK));
  assert.doesNotMatch(JSON.stringify(p), /ListBucket|UpdateStack|DeleteStack|DeleteObject|PutSecretValue|CreateRole|AssumeRole/);
  assert.throws(() => sandboxFirstOpenPolicyDrafts({ archiveVersionId: "null", manifestVersionId: "x" }), /BASELINE_VERSION/);
});

test("claim SQL uses immutable scope and narrow RPC calls, not agent-supplied SQL or a replay", async () => {
  const sha = "a".repeat(64);
  const ddl = sandboxFirstOpenClaimDdl({ approvalSha256: sha, planHash: "b".repeat(64), configurationHash: "c".repeat(64), writeBefore });
  assert.match(ddl, /REVOKE ALL ON FUNCTION techlong_first_onboarding_claim\.claim\(text,jsonb\) FROM PUBLIC/);
  assert.match(ddl, new RegExp(s.jobId));
  assert.match(ddl, /SET search_path TO pg_catalog/);
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
