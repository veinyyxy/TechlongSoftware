import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT } from "../lib/deployments/execution/first-open-tenant-network.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { bindFirstOpenRdsCell } from "../ops/platform-hosting-v1/first-open-rds-cell.ts";

const account = "402010193138";
const region = "ca-central-1";
const elb = `arn:aws:elasticloadbalancing:${region}:${account}:`;
const cellStackId = `arn:aws:cloudformation:${region}:${account}:stack/techlong-sandbox-cell-sandbox-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;
const trustStoreArn = `${elb}truststore/fixture/0000000000000000`;
const now = () => 1_800_000_000_000;
const legacySubnetIds = ["subnet-11111111111111111", "subnet-22222222222222222"];
const defaultPrivateSubnetIds = ["subnet-33333333333333333", "subnet-44444444444444444"];
const ingress = {
  albArn: `${elb}loadbalancer/app/fixture/0000000000000000`,
  dnsName: "internal-fixture.ca-central-1.elb.amazonaws.com",
  httpsListenerArn: `${elb}listener/app/fixture/0000000000000000/1111111111111111`,
  controlListenerArn: `${elb}listener/app/fixture/0000000000000000/2222222222222222`,
  clusterArn: `arn:aws:ecs:${region}:${account}:cluster/cell-sandbox-1`,
  vpcId: "vpc-33333333333333333",
};
const tenant = { dbInstanceIdentifier: "fixture", dbiResourceId: "db-fixture", host: "fixture.abcdef.ca-central-1.rds.amazonaws.com" };

async function fixture({ privateSubnetIds = defaultPrivateSubnetIds, changeOutputs = () => {} } = {}) {
  const scope = { environmentId: "env_fixture" };
  const binding = {
    environmentId: scope.environmentId,
    status: "active",
    workerRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxProvisionerRole`,
    cloudFormationRoleArn: `arn:aws:iam::${account}:role/TechlongSandboxCloudFormationExecutionRole`,
    tenantStackParameters: {
      VpcId: ingress.vpcId, ClusterName: "cell-sandbox-1", HttpsListenerArn: ingress.httpsListenerArn,
      ControlListenerArn: ingress.controlListenerArn, SubnetIds: legacySubnetIds.join(","),
    },
  };
  const template = { Resources: {} };
  const pin = {
    templateSha256: await sha256Hex(template), parametersSha256: await sha256Hex(binding.tenantStackParameters),
    privateSubnetIds, trustStoreArn,
    cleanup: {
      scopeSha256: await sha256Hex(scope), reviewSha256: "a".repeat(64), permissionsEvidenceSha256: "b".repeat(64),
      observedAt: now() - 100, validUntil: now() + 120_000, expiresAt: now() + 900_000,
      responsibleCallerArn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`,
    },
  };
  const cellOutputParameters = {
    ClusterName: "ClusterName", HttpsListenerArn: "HttpsListenerArn", ControlListenerArn: "ControlListenerArn",
    SubnetIds: FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT,
  };
  const outputs = { ...binding.tenantStackParameters, SubnetIds: [...legacySubnetIds].reverse().join(", "),
    [FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT]: privateSubnetIds.join(",") };
  changeOutputs(outputs);
  const calls = [];
  const responses = {
    "describe-stacks": { Stacks: [{ StackId: cellStackId, StackStatus: "UPDATE_COMPLETE",
      Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] },
    "get-template": { TemplateBody: JSON.stringify(template) },
    "describe-load-balancers": { LoadBalancers: [{ LoadBalancerArn: ingress.albArn, Scheme: "internal", DNSName: ingress.dnsName, VpcId: ingress.vpcId }] },
    "describe-listeners": { Listeners: [
      { ListenerArn: ingress.httpsListenerArn, LoadBalancerArn: ingress.albArn, Port: 443, Protocol: "HTTPS" },
      { ListenerArn: ingress.controlListenerArn, LoadBalancerArn: ingress.albArn, Port: 8443, Protocol: "HTTPS",
        MutualAuthentication: { Mode: "verify", TrustStoreArn: trustStoreArn, TrustStoreAssociationStatus: "active" } },
    ] },
    "describe-db-instances": { DBInstances: [{ DBInstanceArn: `arn:aws:rds:${region}:${account}:db:${tenant.dbInstanceIdentifier}`,
      DbiResourceId: tenant.dbiResourceId, Engine: "postgres", EngineVersion: "16.14", DBInstanceStatus: "available",
      PubliclyAccessible: false, StorageEncrypted: true, DeletionProtection: true, Endpoint: { Address: tenant.host, Port: 5432 },
      DBSubnetGroup: { VpcId: ingress.vpcId } }] },
  };
  const options = { pin, scope, cellStackId, ingress, tenant, cellOutputParameters, now, writeBefore: now() + 60_000,
    async read(_service, operation) {
      assert.ok(Object.hasOwn(responses, operation));
      calls.push(operation);
      return responses[operation];
    } };
  return { options, binding, calls, signal: new AbortController().signal };
}

test("Cell observes both subnet outputs and binds the approved private IDs into its evidence hash", async () => {
  const first = await fixture();
  const second = await fixture({ privateSubnetIds: ["subnet-55555555555555555", "subnet-66666666666666666"] });
  const digests = [];
  for (const item of [first, second]) {
    const cell = await bindFirstOpenRdsCell(item.options);
    await cell.checkBinding(item.binding);
    digests.push(await cell.observeSecurity(item.binding, item.signal));
    assert.deepEqual(item.calls, ["describe-stacks", "get-template", "describe-load-balancers", "describe-listeners", "describe-db-instances"]);
  }
  assert.match(digests[0], /^[a-f0-9]{64}$/);
  assert.notEqual(digests[0], digests[1]);
});

test("Cell stops before provider reads when the approved private list is invalid or overlaps a legacy subnet", async () => {
  const invalid = await fixture({ privateSubnetIds: [defaultPrivateSubnetIds[0], defaultPrivateSubnetIds[0]] });
  await assert.rejects(bindFirstOpenRdsCell(invalid.options), /ECS_FIRST_OPEN_CELL_EVIDENCE_SCOPE/);
  assert.deepEqual(invalid.calls, []);
  const overlap = await fixture({ privateSubnetIds: [defaultPrivateSubnetIds[0], legacySubnetIds[1]] });
  const cell = await bindFirstOpenRdsCell(overlap.options);
  await assert.rejects(cell.checkBinding(overlap.binding), /ECS_FIRST_OPEN_CELL_BINDING_CHANGED/);
  assert.deepEqual(overlap.calls, []);
});

test("Cell rejects a missing, replaced or reordered private output and a changed legacy output", async () => {
  for (const changeOutputs of [
    outputs => { delete outputs[FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT]; },
    outputs => { outputs[FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT] = legacySubnetIds.join(","); },
    outputs => { outputs[FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT] = [...defaultPrivateSubnetIds].reverse().join(","); },
    outputs => { outputs.SubnetIds = defaultPrivateSubnetIds.join(","); },
  ]) {
    const item = await fixture({ changeOutputs });
    const cell = await bindFirstOpenRdsCell(item.options);
    await cell.checkBinding(item.binding);
    await assert.rejects(cell.observeSecurity(item.binding, item.signal), /ECS_FIRST_OPEN_CELL_OUTPUT_UNVERIFIED/);
    assert.deepEqual(item.calls, ["describe-stacks"]);
  }
});
