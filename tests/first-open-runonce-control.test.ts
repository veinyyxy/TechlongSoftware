import assert from "node:assert/strict";
import { hkdfSync } from "node:crypto";
import test from "node:test";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { sandboxFirstOpenPlannedSecretGrant, sandboxFirstOpenPlannedSecretVersionGuard } from "../lib/deployments/execution/first-onboarding-run-permissions.ts";
import type { TenantExternalOperationFence } from "../lib/deployments/execution/contracts.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenExecutionWindow } from "../lib/deployments/execution/first-onboarding-window.ts";
import type { DeploymentEnvironment, DeploymentEnvironmentPolicy } from "../lib/deployments/environment.ts";
import { firstOpenOwnerMemory, checkFirstOpenControlKeys } from "../ops/aws-sandbox/first-open-entry/runner-control.ts";
import { bindFirstOpenRunOnceReadiness, sampleFirstOpenRestoredCell, type FirstOpenIndependentReadiness } from "../ops/aws-sandbox/first-open-entry/runner-readiness.ts";
import { firstOpenSupervisedCleanupDraft } from "../ops/aws-sandbox/first-open-express-cleanup-review.ts";

const t = Date.UTC(2026, 10, 19), writeBefore = t + 900_000, versionId = "a".repeat(64);
const templateVersionId = "tplver_" + "b".repeat(32);
const sourceArn = "arn:aws:iam::402010193138:user/techlong-sandbox-dev" as const;
const sig = () => new AbortController().signal;
function fixedFence(): TenantExternalOperationFence {
  return { schemaVersion: 1, epoch: 1, intent: "provision", state: "active", ownerDeploymentId: s.deploymentId,
    operationHash: "a".repeat(64), marker: `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1`,
    resourceFence: { schemaVersion: 1, generation: 1, ownerDeploymentId: s.deploymentId,
      ownershipMarker: `tl_owner_${s.stableIdentity.slice(0, 32)}_g1`,
      identity: { schemaVersion: 1, appInstanceId: s.instanceId, workspaceId: "wsp_" + "b".repeat(24), productId: s.productId,
        environmentId: s.environmentId, cellKey: "cell-sandbox-1", stableIdentityHash: s.stableIdentity,
        databaseName: s.tenantDatabase, roleName: s.tenantRole, secretName: s.secretName.slice(0, -3) } } };
}

test("first owner is derived only after verified g1, uses the existing domain and is disposed", async () => {
  const externalFence = fixedFence(), signal = sig();
  const store = firstOpenOwnerMemory({ versionId, templateVersionId, fence: externalFence, deadline: writeBefore, signal, now: () => t });
  const request = { appInstanceId: s.instanceId, templateVersionId, signal };
  const coordinate = { arn: `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-Abc123`, versionId, externalFence };
  const key = Buffer.alloc(32, 42);
  assert.throws(() => store.verify(coordinate), /OWNER_BINDING/);
  assert.throws(() => store.rememberOwnerSeed({ ...coordinate, versionId: "2".repeat(64), key: key.toString("base64url") }), /OWNER_BINDING/);
  store.rememberOwnerSeed({ ...coordinate, key: key.toString("base64url") });
  await assert.rejects(store.source.lease(request), /OWNER_LEASE/);
  assert.throws(() => store.verify({ ...coordinate, arn: coordinate.arn.replace("Abc123", "000000") }), /OWNER_BINDING/);
  store.verify(coordinate);
  await assert.rejects(store.source.lease({ ...request, templateVersionId: "tplver_other" }), /OWNER_LEASE/);
  const lease = await store.source.lease(request);
  const expected = Buffer.from(hkdfSync("sha256", key, Buffer.from(s.stableIdentity, "hex"), Buffer.from(canonicalJson({
    protocol: "techlong-first-owner-password-v1", appInstanceId: s.instanceId, templateVersionId,
    generation: 1, versionId,
  })), 32)).toString("base64url");
  assert.equal(lease.read(), expected);
  await assert.rejects(store.source.lease(request), /OWNER_LEASE/);
  lease.dispose();
  assert.throws(() => lease.read(), /OWNER_LEASE/);
  store.dispose();
});

test("mTLS preflight refuses expired windows, changed hashes and invalid PEM even when its hash matches", async () => {
  const keys = { signingPrivateKeyPem: "invalid", signingPublicKeyPem: "invalid", clientCertificatePem: "invalid",
    clientPrivateKeyPem: "invalid", clientCaPem: "invalid" };
  const sha = await sha256Hex("invalid");
  const keysEvidence = { subject: "sandbox-owner", publicKeySha256: sha, clientCaSha256: sha, clientCertificateSha256: sha,
    publicKeyArn: s.controlArn, publicKeyVersionId: s.controlVersion, clientTrustStoreArn: "synthetic",
    templateVersionSha256: sha, businessSha256: sha };
  await assert.rejects(checkFirstOpenControlKeys(keys, keysEvidence, t, t - 1), /KEY_BINDING/);
  await assert.rejects(checkFirstOpenControlKeys(keys, { ...keysEvidence, clientCaSha256: "b".repeat(64) }, t, writeBefore), /KEY_BINDING/);
  await assert.rejects(checkFirstOpenControlKeys(keys, keysEvidence, t, writeBefore), /KEY_BINDING/);
});

type Setup = Parameters<typeof bindFirstOpenRunOnceReadiness>[0];
async function restored() {
  let now = t + 500;
  const setNow = (v: number) => { now = v; }, clock = () => now;
  const prefix = `arn:aws:elasticloadbalancing:${s.region}:${s.account}:`, lbArn = prefix + "loadbalancer/app/synthetic/123abc";
  const dns = "synthetic.ca-central-1.elb.amazonaws.com";
  const outputs = { ClusterName: "synthetic", VpcId: "vpc-example", SubnetIds: "subnet-a,subnet-b", TaskSecurityGroupId: "sg-example",
    HttpsListenerArn: prefix + "listener/app/synthetic/123abc/123", ControlListenerArn: prefix + "listener/app/synthetic/123abc/456" };
  const exact = { businessDenyRuleArn: prefix + "listener-rule/app/synthetic/123abc/123/789",
    controlTrustStoreArn: prefix + "truststore/synthetic/789" };
  const scope = { appInstanceId: s.instanceId, deploymentId: s.deploymentId, environmentId: s.environmentId,
    planHash: "8".repeat(64), configurationHash: "9".repeat(64), artifactRef: s.imageRepository + "@" + s.imageDigest };
  const reviewSha256 = "6".repeat(64), baselineDigest = "7".repeat(64), endpoint = "synthetic.ca-central-1.rds.amazonaws.com";
  const seed = { environment: { id: s.environmentId, expectedAccountId: s.account, region: s.region },
    binding: { tenantStackParameters: outputs }, review: { jobId: s.jobId, reviewSha256, payload: { scope } } } as unknown as Setup["seed"];
  const observed = { sourceArn, checkedAt: t, independentEvidenceSha256: "f".repeat(64) };
  const cleanupReview = { jobId: s.jobId, scopeSha256: await sha256Hex(scope), workloadExpiresAt: t + 7_200_000,
    responsibleCallerArn: sourceArn, order: "workload_database_role_generation_secret_then_cell" as const };
  const cleanupPermissions: FirstOpenIndependentReadiness["cleanupPermissions"] = { ...observed, jobId: s.jobId,
    scopeSha256: cleanupReview.scopeSha256, exactPermissionsVerified: true,
    observation: { scope: firstOpenSupervisedCleanupDraft().scope, effective: {
      sourceDeleteTenantStack: true, cfnDeleteOnlyTenantResources: true, cleanupLoginPostWriteWindow: true, onlyExactRdsDbLogin: true,
      postgres17_9MaintenanceOnly: true, exactDatabaseOwnerDrop: true, guardedApplicationRoleDrop: true,
      sourceDeleteOnlyExactG1: true, postCreateLineageRecheckRequired: true,
    }, grantedPathEvidence: { awsSha256: "1".repeat(64), postgresSha256: "2".repeat(64), guardedRoleRoutineSha256: "3".repeat(64) } },
  };
  const approval = { jobId: s.jobId, reviewSha256, capabilitySha256: "a".repeat(64), baselineDigest,
    databaseSchemaVersion: s.schemaVersion, hostname: s.hostname, dnsTarget: dns, writeBefore,
    controlledWindow: { startAt: t, claimBefore: t + 300_000, workloadExpiresAt: t + 7_200_000, factsExpireAt: writeBefore,
      cleanupReviewSha256: await sha256Hex(cleanupReview), cleanupPermissionsEvidenceSha256: await sha256Hex(cleanupPermissions) },
    express: { target: { clusterArn: s.clusterArn, observedEngineVersion: "17.9", endpoint }, sampling: { cellStackId: s.cellStack } },
  } as Setup["approval"];
  const listeners = { Listeners: [{
    ListenerArn: outputs.HttpsListenerArn, Port: 443, Protocol: "HTTPS", LoadBalancerArn: lbArn, SslPolicy: "synthetic",
    Certificates: [{ CertificateArn: "synthetic" }], DefaultActions: [{ Type: "fixed-response" }],
  }, { ListenerArn: outputs.ControlListenerArn, Port: 8443, Protocol: "HTTPS", LoadBalancerArn: lbArn, SslPolicy: "synthetic",
    Certificates: [{ CertificateArn: "synthetic" }], DefaultActions: [{ Type: "fixed-response" }],
    MutualAuthentication: { Mode: "verify", TrustStoreArn: exact.controlTrustStoreArn, IgnoreClientCertificateExpiry: false } }] };
  const cloud: Record<string, { args: object; value: unknown }> = {
    "describe-stacks": { args: { StackName: s.cellStack }, value: { Stacks: [{ StackId: s.cellStack, StackStatus: "UPDATE_COMPLETE",
      Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] } },
    "describe-listeners": { args: { ListenerArns: [outputs.HttpsListenerArn, outputs.ControlListenerArn] }, value: listeners },
    "describe-rules": { args: { RuleArns: [exact.businessDenyRuleArn] }, value: { Rules: [{ RuleArn: exact.businessDenyRuleArn,
      Priority: "1", IsDefault: false, Conditions: [{ Field: "path-pattern", PathPatternConfig: { Values: ["/api/saas", "/api/saas/*"] } }],
      Actions: [{ Type: "fixed-response", FixedResponseConfig: { StatusCode: "404" } }] }] } },
    "describe-trust-stores": { args: { TrustStoreArns: [exact.controlTrustStoreArn] }, value: {
      TrustStores: [{ TrustStoreArn: exact.controlTrustStoreArn, Status: "ACTIVE" }] } },
    "describe-load-balancers": { args: { LoadBalancerArns: [lbArn] }, value: { LoadBalancers: [{ LoadBalancerArn: lbArn, VpcId: outputs.VpcId,
      DNSName: dns, Scheme: "internet-facing", Type: "application", CanonicalHostedZoneId: "ZEXAMPLE", State: { Code: "active" },
      SecurityGroups: ["sg-a"], AvailabilityZones: [{ SubnetId: "subnet-a" }] }] } },
    "describe-db-clusters": { args: { DBClusterIdentifier: "techlong-sandbox-express-d001" }, value: { DBClusters: [{
      DBClusterArn: s.clusterArn, DbClusterResourceId: s.clusterId, Endpoint: endpoint, Port: 5432, Engine: "aurora-postgresql", EngineVersion: "17.9",
      Status: "available", IAMDatabaseAuthenticationEnabled: true, StorageEncrypted: false, StorageEncryptionType: "sse-rds",
      InternetAccessGatewayEnabled: true, VPCNetworkingEnabled: false,
      DBClusterMembers: [{ DBInstanceIdentifier: "synthetic", IsClusterWriter: true }], VpcSecurityGroups: [],
    }] } },
  };
  const calls: string[] = [];
  const read: Setup["read"] = { async read<T>(_service: string, op: string, args: Record<string, unknown>) {
    calls.push(op); assert.deepEqual(args, cloud[op].args); return structuredClone(cloud[op].value) as T;
  } };
  const restoredCellSha256 = await sha256Hex(await sampleFirstOpenRestoredCell({ approval, seed, exact, read, signal: sig() }));
  calls.length = 0;
  const approvalSha256 = await sha256Hex(approval), grant = sandboxFirstOpenPlannedSecretGrant(versionId);
  const receipt: FirstOpenIndependentReadiness["grant"] = {
    ...observed, jobId: s.jobId, approvalSha256, roleArn: s.executionRole, grantSha256: await sha256Hex(grant),
    independentlyVerifiedEffective: true,
    observation: { roleArn: s.executionRole, action: "secretsmanager:GetSecretValue", secretName: s.secretName,
      resourceArnPattern: `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-??????`, versionId,
      addedPolicyScope: "planned-g1-only", versionGuardSha256: await sha256Hex(sandboxFirstOpenPlannedSecretVersionGuard(versionId)),
      decisions: { exactRequest: "allowed", otherVersion: "denied", omittedVersion: "denied" } },
  };
  const evidence: FirstOpenIndependentReadiness = { restoredCellSha256, restoredCellCoordinates: exact, cleanupReview, cleanupPermissions,
    grant: receipt, grantReceiptSha256: await sha256Hex(receipt) };
  const setup: Setup = { approval, approvalSha256, seed, versionId, evidence, read, now: clock };
  const gate = { scope, jobId: s.jobId, approvalSha256, window: firstOpenExecutionWindow(s.jobId, writeBefore, approval.controlledWindow)!, signal: sig() };
  return { setup, gate, grant, calls, setNow, listeners };
}

test("independent proof and exact preclaim live read combine without a new provider timestamp or replay", async () => {
  const { setup, gate, grant, calls } = await restored();
  const p = await bindFirstOpenRunOnceReadiness(setup);
  assert.equal(calls.length, 0);
  const grantCheck = { approvalSha256: setup.approvalSha256, roleArn: s.executionRole, grant };
  const proof = await p.verifyRuntimeGrant(grantCheck, sig());
  assert.equal(proof.observedAt, t);
  await assert.rejects(p.verifyRuntimeGrant({ ...grantCheck, grant: sandboxFirstOpenPlannedSecretGrant("c".repeat(64)) }, sig()), /GRANT_SCOPE/);
  await assert.rejects(p.cleanupReadiness.verifyBeforeClaim!({ ...gate, jobId: "other" }), /CLEANUP_SCOPE/);
  assert.equal(calls.length, 0);
  const cleanup = await p.cleanupReadiness.verifyBeforeClaim!(gate);
  assert.equal(cleanup.verifiedAt, t + 500);
  assert.deepEqual(calls, ["describe-stacks", "describe-listeners", "describe-rules", "describe-trust-stores", "describe-load-balancers", "describe-db-clusters"]);
  const cell = await p.cellPreflight.verify({ environment: setup.seed.environment, binding: setup.seed.binding, signal: sig() });
  assert.equal(cell.evidenceHash, setup.evidence.restoredCellSha256);
  assert.equal(calls.length, 6);
});

test("cleanup readiness refuses a re-sealed legacy boolean or an unproved guarded role drop", async () => {
  const { setup, calls } = await restored();
  const { observation, ...legacy } = setup.evidence.cleanupPermissions;
  for (const altered of [legacy, { ...legacy, observation: { ...observation, effective: { ...observation.effective, guardedApplicationRoleDrop: false } } }]) {
    const cleanupPermissions = altered as FirstOpenIndependentReadiness["cleanupPermissions"];
    const approval = { ...setup.approval, controlledWindow: { ...setup.approval.controlledWindow!,
      cleanupPermissionsEvidenceSha256: await sha256Hex(cleanupPermissions) } };
    const approvalSha256 = await sha256Hex(approval), grant = { ...setup.evidence.grant, approvalSha256 };
    const evidence = { ...setup.evidence, cleanupPermissions, grant, grantReceiptSha256: await sha256Hex(grant) };
    await assert.rejects(bindFirstOpenRunOnceReadiness({ ...setup, approval, approvalSha256, evidence }), /INDEPENDENT_EVIDENCE/);
  }
  assert.equal(calls.length, 0);
});

test("g1 readiness rejects wrong observed coordinates and unproved or overbroad authorizations even when the receipt SHA matches", async () => {
  const { setup, calls } = await restored();
  const { observation, ...legacy } = setup.evidence.grant;
  for (const grant of [
    legacy,
    { ...legacy, independentlyVerifiedEffective: false,
      observation: { ...observation, decisions: { ...observation.decisions, exactRequest: "denied" } } },
    ...[
      { ...observation, roleArn: s.applicationRole },
      { ...observation, secretName: s.secretName.replace(/g1$/, "g2") },
      { ...observation, versionId: "c".repeat(64) },
      { ...observation, action: "secretsmanager:*" },
      { ...observation, resourceArnPattern: observation.resourceArnPattern.replace(/\?{6}$/, "*") },
      { ...observation, resourceArnPattern: observation.resourceArnPattern.replace(/\?{6}$/, "Abc123") },
      { ...observation, decisions: { ...observation.decisions, exactRequest: "denied" } },
      { ...observation, decisions: { ...observation.decisions, otherVersion: "allowed" } },
      { ...observation, decisions: { ...observation.decisions, omittedVersion: "allowed" } },
      { ...observation, addedPolicyScope: "all-tenants" },
      { ...observation, versionGuardSha256: "0".repeat(64) },
      { ...observation, decisions: { ...observation.decisions, otherVersion: "unknown" } },
    ].map(altered => ({ ...legacy, observation: altered })),
  ]) {
    const evidence = { ...setup.evidence, grant: grant as FirstOpenIndependentReadiness["grant"], grantReceiptSha256: await sha256Hex(grant) };
    await assert.rejects(bindFirstOpenRunOnceReadiness({ ...setup, evidence }), /INDEPENDENT_EVIDENCE/);
  }
  assert.equal(calls.length, 0);
});

function sampleWithExpressOverrides(setup: Setup, overrides: Record<string, unknown>) {
  const read: Setup["read"] = { async read<T>(service: string, op: string, args: Record<string, unknown>) {
    const response = await setup.read.read<T>(service, op, args);
    if (op === "describe-db-clusters") {
      const db = (response as { DBClusters: Record<string, unknown>[] }).DBClusters[0];
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete db[key]; else db[key] = value;
      }
    }
    return response;
  } };
  return sampleFirstOpenRestoredCell({ approval: setup.approval, seed: setup.seed,
    exact: setup.evidence.restoredCellCoordinates, signal: sig(), read });
}

test("fixed Express readiness binds the witnessed internet gateway mode and rejects missing or VPC security groups", async () => {
  const { setup } = await restored();
  const measured = await sampleWithExpressOverrides(setup, {});
  assert.equal(measured.express.internetAccessGatewayEnabled, true);
  assert.equal(measured.express.vpcNetworkingEnabled, false);
  assert.deepEqual(measured.express.securityGroups, []);
  assert.equal(await sha256Hex(measured), setup.evidence.restoredCellSha256);
  const { internetAccessGatewayEnabled, vpcNetworkingEnabled, ...oldExpress } = measured.express;
  assert.equal(internetAccessGatewayEnabled && !vpcNetworkingEnabled, true);
  assert.notEqual(await sha256Hex({ ...measured, express: oldExpress }), setup.evidence.restoredCellSha256);
  for (const overrides of [
    { InternetAccessGatewayEnabled: false }, { InternetAccessGatewayEnabled: undefined },
    { VPCNetworkingEnabled: true }, { VPCNetworkingEnabled: undefined },
    { VpcSecurityGroups: undefined }, { VpcSecurityGroups: null }, { VpcSecurityGroups: {} },
    { VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-unexpected" }] },
  ]) await assert.rejects(sampleWithExpressOverrides(setup, overrides), /EXPRESS_(IDENTITY|NETWORK)/);
});

test("fixed Express readiness binds proven SSE-RDS and refuses unknown, unencrypted or inconsistent metadata", async () => {
  const { setup } = await restored();
  const measured = await sampleWithExpressOverrides(setup, {});
  assert.equal(measured.express.storageEncryptionType, "sse-rds");
  assert.equal(await sha256Hex(measured), setup.evidence.restoredCellSha256);
  const { storageEncryptionType, ...legacyExpress } = measured.express;
  assert.equal(storageEncryptionType, "sse-rds");
  assert.notEqual(await sha256Hex({ ...measured, express: legacyExpress }), setup.evidence.restoredCellSha256);
  for (const overrides of [
    { StorageEncryptionType: "none" }, { StorageEncryptionType: undefined }, { StorageEncryptionType: "unknown" },
    { StorageEncrypted: true }, { StorageEncrypted: undefined }, { StorageEncrypted: true, StorageEncryptionType: "sse-kms" },
  ]) await assert.rejects(sampleWithExpressOverrides(setup, overrides), /EXPRESS_STORAGE_ENCRYPTION/);
  await assert.rejects(sampleWithExpressOverrides(setup, { DbClusterResourceId: "another-cluster" }), /EXPRESS_IDENTITY/);
});

test("restored Cell listener and security-group drift stop before reading the listeners", async () => {
  const { setup } = await restored();
  for (const key of ["HttpsListenerArn", "TaskSecurityGroupId"]) {
    const calls: string[] = [];
    const read = { async read<T>(service: string, op: string, args: Record<string, unknown>) {
      calls.push(op);
      const response = await setup.read.read<T>(service, op, args);
      assert.equal(op, "describe-stacks");
      const stack = (response as { Stacks: { Outputs: { OutputKey: string; OutputValue: string }[] }[] }).Stacks[0];
      stack.Outputs.find(x => x.OutputKey === key)!.OutputValue += "-old";
      return response;
    } };
    await assert.rejects(sampleFirstOpenRestoredCell({ approval: setup.approval, seed: setup.seed,
      exact: setup.evidence.restoredCellCoordinates, read, signal: sig() }), /CELL_OUTPUTS/);
    assert.deepEqual(calls, ["describe-stacks"]);
  }
});

test("changed mTLS, tampered independent receipts and cutoff stop without downstream reads", async () => {
  const { setup, gate, calls, listeners, setNow } = await restored();
  await assert.rejects(bindFirstOpenRunOnceReadiness({ ...setup, evidence: { ...setup.evidence,
    grant: { ...setup.evidence.grant, sourceArn: s.workerRole as typeof sourceArn } } }), /INDEPENDENT_EVIDENCE/);
  assert.equal(calls.length, 0);
  const p = await bindFirstOpenRunOnceReadiness(setup);
  listeners.Listeners[1].MutualAuthentication!.Mode = "off";
  await assert.rejects(p.cleanupReadiness.verifyBeforeClaim!(gate), /CELL_LISTENERS/);
  assert.equal(calls.length, 2);
  setNow(gate.window.claimBefore);
  await assert.rejects(p.cleanupReadiness.verifyBeforeClaim!(gate), /CLEANUP_SCOPE/);
  assert.equal(calls.length, 2);
});

async function secondSlotFixture() {
  const { setup } = await restored();
  const environmentPolicy: DeploymentEnvironmentPolicy = {
    budgetLimitCents: 5_000, ttlSeconds: 7_200, maxCells: 1, maxTenants: 2, maxTaskCount: 1,
    allowedProfiles: ["standard-v1"], allowNatGateway: false, allowInterfaceEndpoints: false,
    databaseEngine: "aurora-postgresql-serverless-v2", auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: "16.14", auroraEngineMode: "provisioned", allowLimitlessDatabase: false,
    databaseMode: "tenant_database", auroraServerlessMinAcu: 0, auroraServerlessMaxAcu: 1,
    auroraSecondsUntilAutoPause: 300, allowDedicatedDatabase: false, allowMultiAzDatabase: false,
    allowRdsProxy: false, allowGlobalDatabase: false, logRetentionDays: 7,
  };
  const environment: DeploymentEnvironment = {
    ...setup.seed.environment, key: "aws-sandbox-ca-central-1", name: "sealed sandbox", kind: "aws_sandbox",
    driver: "aws_ecs_cell", cellKey: "cell-sandbox-1", baseDomain: "sandbox.techlong.cloud",
    applyEnabled: false, status: "active", policy: environmentPolicy,
  };
  const seed = { ...setup.seed, environment };
  const approval: Setup["approval"] = { ...setup.approval,
    express: { ...setup.approval.express!, secondSlot: { schema: "techlong/fc41597f-second-slot/v1", environmentPolicy,
      admissionEpoch: 0, listenerPriority: 102 } } };
  const exact = setup.evidence.restoredCellCoordinates, b = seed.binding.tenantStackParameters;
  const sharedResult = await setup.read.read<{ Rules: Record<string, unknown>[] }>("elbv2", "describe-rules", { RuleArns: [exact.businessDenyRuleArn] });
  const defaultRule = (arn: string) => ({ RuleArn: arn.replace(":listener/", ":listener-rule/") + "/abc", IsDefault: true,
    Priority: "default", Conditions: [], Actions: [{ Type: "fixed-response", FixedResponseConfig: { StatusCode: "404" } }] });
  const oldHost = "first-acceptance.sandbox.techlong.cloud";
  const oldRoute = (arn: string, priority: number, host = oldHost) => ({
    RuleArn: arn.replace(":listener/", ":listener-rule/") + "/" + priority.toString(16), IsDefault: false, Priority: String(priority),
    Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [host] } }], Actions: [{ Type: "forward", TargetGroupArn: "synthetic" }],
  });
  type Rules = { Rules: Record<string, unknown>[]; NextMarker?: string };
  const business: Rules = { Rules: [defaultRule(b.HttpsListenerArn), ...sharedResult.Rules,
    oldRoute(b.HttpsListenerArn, 100), oldRoute(b.HttpsListenerArn, 101)] };
  const control: Rules = { Rules: [defaultRule(b.ControlListenerArn), oldRoute(b.ControlListenerArn, 100)] };
  const exactCalls: string[] = [];
  const read: Setup["read"] = { async read<T>(service: string, operation: string, input: Record<string, unknown>) {
    if (!Object.hasOwn(input, "ListenerArn")) return setup.read.read<T>(service, operation, input);
    assert.equal(service, "elbv2"); assert.equal(operation, "describe-rules");
    assert.deepEqual(Object.keys(input), ["ListenerArn"]);
    assert.ok(input.ListenerArn === b.HttpsListenerArn || input.ListenerArn === b.ControlListenerArn);
    exactCalls.push(input.ListenerArn);
    return structuredClone(input.ListenerArn === b.HttpsListenerArn ? business : control) as T;
  } };
  return { setup, approval, seed, b, exact, read, business, control, oldRoute, exactCalls,
    sample: () => sampleFirstOpenRestoredCell({ approval, seed, exact, read, signal: sig() }) };
}

test("opt-in second slot observes both exact listeners, leaves the incumbent routes untouched and binds the proof to the digest", async () => {
  const x = await secondSlotFixture();
  const legacy = await sampleFirstOpenRestoredCell({ ...x, approval: x.setup.approval, seed: x.setup.seed, signal: sig() });
  assert.deepEqual(x.exactCalls, []);
  assert.equal(Object.hasOwn(legacy, "secondSlotRoutes"), false);
  assert.equal(await sha256Hex(legacy), x.setup.evidence.restoredCellSha256);
  const measured = await x.sample(), { secondSlotRoutes, ...physical } = measured;
  assert.deepEqual(x.exactCalls, [x.b.HttpsListenerArn, x.b.ControlListenerArn]);
  assert.deepEqual(physical, legacy);
  assert.equal(secondSlotRoutes!.hostname, s.hostname);
  assert.deepEqual(secondSlotRoutes!.business.vacantPriorities, [102, 103]);
  assert.deepEqual(secondSlotRoutes!.control.vacantPriorities, [102]);
  x.business.Rules.reverse(); x.control.Rules.reverse();
  assert.equal(await sha256Hex(await x.sample()), await sha256Hex(measured));
  x.control.Rules.push(x.oldRoute(x.b.ControlListenerArn, 199));
  assert.notEqual(await sha256Hex(await x.sample()), await sha256Hex(measured));
});

test("second slot stops on either priority collision or a matching exact or wildcard host, and permits the known denies", async () => {
  for (const [listener, priority] of [["business", 102], ["business", 103], ["control", 102]] as const) {
    const x = await secondSlotFixture();
    const arn = listener === "business" ? x.b.HttpsListenerArn : x.b.ControlListenerArn;
    x[listener].Rules.push(x.oldRoute(arn, priority));
    await assert.rejects(x.sample(), /CELL_ROUTE_PRIORITY/);
  }
  for (const host of [`${s.hostname.toUpperCase()}.`, `*.${s.hostname.split(".").slice(1).join(".")}`, `?${s.hostname.slice(1)}`]) {
    const x = await secondSlotFixture();
    x.business.Rules.push(x.oldRoute(x.b.HttpsListenerArn, 199, host));
    await assert.rejects(x.sample(), /CELL_ROUTE_HOST_OCCUPIED/);
    assert.deepEqual(x.exactCalls, [x.b.HttpsListenerArn]);
  }
});

test("second slot refuses unproved route lists instead of paginating or treating a default forward as a deny", async () => {
  const scenarios = [
    (x: Awaited<ReturnType<typeof secondSlotFixture>>) => { x.business.NextMarker = "unexpected-next-page"; },
    (x: Awaited<ReturnType<typeof secondSlotFixture>>) => { x.business.Rules[0].Actions = [{ Type: "forward" }]; },
    (x: Awaited<ReturnType<typeof secondSlotFixture>>) => { x.business.Rules.push({ ...x.business.Rules[2] }); },
    (x: Awaited<ReturnType<typeof secondSlotFixture>>) => { x.business.Rules[2].Conditions = [{ Field: "path-pattern", Values: ["/*"] }]; },
    (x: Awaited<ReturnType<typeof secondSlotFixture>>) => { x.business.Rules[2].Conditions = [{ Field: "host-header", HostHeaderConfig: { RegexValues: [".*"] } }]; },
  ];
  for (const edit of scenarios) {
    const x = await secondSlotFixture(); edit(x);
    await assert.rejects(x.sample(), /CELL_ROUTE_/);
    assert.deepEqual(x.exactCalls, [x.b.HttpsListenerArn]);
  }
});
