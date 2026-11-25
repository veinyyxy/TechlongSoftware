import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { rootCertificates } from "node:tls";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { awsSandboxTenantStackName } from "../lib/deployments/cloudformation/tenant-stack.ts";
import { FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT } from "../lib/deployments/execution/first-open-tenant-network.ts";
import { createFirstOpenInspectorSdk, readFirstOpenPrivateTechnical } from "../ops/platform-hosting-v1/first-open-inspector-sdk.ts";
import { createFirstOpenRdsInspector } from "../ops/platform-hosting-v1/first-open-rds-inspector.ts";
import { createTenantPostgresAdapter } from "../ops/platform-hosting-v1/first-open-tenant-postgres.mjs";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE } from "../ops/platform-hosting-v1/first-open-task-identity.ts";

const now = 1_700_000_000_000;
const baselineDigest = "1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a";
const ownerMarker = "tl_owner_" + "a".repeat(32) + "_g1";
const privateDns = "internal-firstopen-ca1.ca-central-1.elb.amazonaws.com";
const route53Endpoint = "https://vpce-0123456789abcdeff-abc.route53.us-east-1.vpce.amazonaws.com";
const databaseName = "tenant_fixturedoc_db";
const scope = { productId: "product_fixture", environmentId: "env_fixture" };
const approval = { instanceId: "app_fixturedoc", workspaceId: "workspace_a", hostname: "fixture.sandbox.techlong.cloud",
  baselineDigest, databaseSchemaVersion: "app-v1", dnsTarget: privateDns, writeBefore: now + 15_000 };
const stackName = awsSandboxTenantStackName(approval.instanceId);
const stack = name => `arn:aws:cloudformation:${region}:${account}:stack/${name}/12345678-1234-1234-1234-123456789abc`;
const stackId = stack(stackName);
const ecs = `arn:aws:ecs:${region}:${account}:`;
const elb = `arn:aws:elasticloadbalancing:${region}:${account}:`;
const serviceArn = ecs + "service/ca-cell/fixture";
const taskDefinitionArn = ecs + "task-definition/fixture:4";
const taskArn = ecs + "task/ca-cell/" + "c".repeat(32);
const albPath = "app/private-fixture/" + "f".repeat(16);
const targetArn = elb + "targetgroup/fixture/" + "d".repeat(16);
const listener = port => `${elb}listener/${albPath}/${String(port).padStart(16, "0")}`;
const ruleFor = (port, id) => listener(port).replace(":listener/", ":listener-rule/") + "/" + String(id).padStart(16, "0");
const versionId = "e".repeat(64);
const runtimeSecretArn = `arn:aws:secretsmanager:${region}:${account}:secret:tenant/fixture-runtime-aBc123`;
const controlSecretArn = `arn:aws:secretsmanager:${region}:${account}:secret:tenant/fixture-control-aBc123`;
const repository = `${account}.dkr.ecr.${region}.amazonaws.com/techlong-speedfeast-backend`;
const imageArtifact = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { digest: "sha256:" + "2".repeat(64) }, layers: [] });
const manifestDigest = "sha256:" + createHash("sha256").update(imageArtifact).digest("hex");
const release = { id: "release_" + "a".repeat(32), productId: scope.productId, component: "tenant_api",
  source: { repository: "techlong/backend" }, status: "ecr_verified",
  image: { repository, manifestDigest, platformDigest: manifestDigest },
  compatibility: { applicationPort: 3000, databaseProfiles: ["full_password"], schemaVersions: ["app-v1"], clientApiVersions: ["v1"] } };
const dbInstanceIdentifier = "techlong-sandbox-tenant-pg16";
const host = dbInstanceIdentifier + ".abcdef123456.ca-central-1.rds.amazonaws.com";
const tenant = { host, dbInstanceIdentifier, dbiResourceId: "db-" + "A".repeat(24), database: databaseName,
  owner: "tenant_owner", username: "tenant_reader", applicationRole: "tenant_app", databaseOid: "16400", ownershipMarker: ownerMarker,
  databaseUrl: `postgresql://tenant_reader:synthetic@${host}/${databaseName}?sslmode=verify-full`, runtimeSecretArn };
const ingress = { albArn: elb + "loadbalancer/" + albPath, dnsName: privateDns, httpsListenerArn: listener(443),
  controlListenerArn: listener(8443), vpcId: "vpc-" + "a".repeat(17), clusterArn: ecs + "cluster/ca-cell" };
const privateSubnetIds = ["subnet-1234567890abcdef0", "subnet-89abcdef"];
const approvedSubnets = privateSubnetIds.join(",");
const outsideSubnet = "subnet-87abcdef";
const sampling = { cellStackId: stack("techlong-sandbox-cell-sandbox-1"), platformStackId: stack("techlong-sandbox-platform-hosting-v1"),
  hostedZoneId: "ZFIXTURE001", apiHostname: approval.hostname,
  cellOutputParameters: { HttpsListenerArn: "HttpsListenerArn", ControlListenerArn: "ControlListenerArn", ClusterName: "ClusterName",
    SubnetIds: FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT },
  database: { kind: "instance", identifier: dbInstanceIdentifier, profile: "full_password", schemaVersion: "app-v1" },
  secrets: [{ arn: runtimeSecretArn, versionId }, { arn: controlSecretArn, versionId }],
  persistence: { bucket: "fixture-firstopen-media", providerVariable: "UPLOAD_PROVIDER", bucketVariable: "UPLOADS_BUCKET", verificationSha256: "c".repeat(64) } };
const marker = { name: databaseName, roleName: tenant.applicationRole, ownershipMarker: ownerMarker, baselineDigest };
const approvedMaterial = { stackName, sampling, privateSubnetIds, ingress, tenant, route53Endpoint };
const serviceNetwork = { assignPublicIp: "DISABLED", subnets: [...privateSubnetIds].reverse() };
const observedService = { serviceArn, clusterArn: ingress.clusterArn, taskDefinition: taskDefinitionArn,
  networkConfiguration: { awsvpcConfiguration: serviceNetwork }, loadBalancers: [{ containerName: "speedfeast-backend" }] };
const attachedEni = { type: "ElasticNetworkInterface", status: "ATTACHED", details: [
  { name: "networkInterfaceId", value: "eni-1234567890abcdef0" }, { name: "subnetId", value: privateSubnetIds[0] },
] };
const observedTask = { taskArn, clusterArn: ingress.clusterArn, taskDefinitionArn, group: "service:fixture", lastStatus: "RUNNING",
  attachments: [attachedEni] };
function fixture({ patch = {}, secretVersions = { [versionId]: ["AWSCURRENT"] },
  material = approvedMaterial, tenantSubnetValue = approvedSubnets, cellSubnetValues = [approvedSubnets] } = {}) {
  const calls = [], physicalResources = [
    ["TenantService", serviceArn, "AWS::ECS::Service"], ["TenantTaskDefinition", taskDefinitionArn, "AWS::ECS::TaskDefinition"],
    ["TenantTargetGroup", targetArn, "AWS::ElasticLoadBalancingV2::TargetGroup"],
    ["TenantHttpsRule", ruleFor(443, 1), "AWS::ElasticLoadBalancingV2::ListenerRule"],
    ["TenantControlRule", ruleFor(8443, 2), "AWS::ElasticLoadBalancingV2::ListenerRule"],
    ["TenantControlRejectRule", ruleFor(8443, 3), "AWS::ElasticLoadBalancingV2::ListenerRule"],
  ].map(([LogicalResourceId, PhysicalResourceId, ResourceType]) => ({ LogicalResourceId, PhysicalResourceId, ResourceType, ResourceStatus: "CREATE_COMPLETE" }));
  const taskDefinition = { taskDefinitionArn, containerDefinitions: [{ name: "speedfeast-backend", image: `${repository}@${manifestDigest}`,
    environment: [{ name: "UPLOAD_PROVIDER", value: "s3" }, { name: "UPLOADS_BUCKET", value: sampling.persistence.bucket }],
    secrets: [{ valueFrom: `${runtimeSecretArn}:database_url::${versionId}` }, { valueFrom: `${controlSecretArn}:key::${versionId}` }] }] };
  const readOnly = { "cloudformation:get-template": { TemplateBody: "{}" },
    "cloudformation:list-stack-resources": { StackResourceSummaries: physicalResources }, "cloudformation:list-change-sets": { Summaries: [] },
    "rds:describe-db-instances": { DBInstances: [{ DBInstanceArn: `arn:aws:rds:${region}:${account}:db:${dbInstanceIdentifier}`,
      DBInstanceIdentifier: dbInstanceIdentifier, DbiResourceId: tenant.dbiResourceId, DBInstanceStatus: "available", Engine: "postgres",
      EngineVersion: "16.14", PubliclyAccessible: false, StorageEncrypted: true, Endpoint: { Address: host, Port: 5432 },
      DBSubnetGroup: { VpcId: ingress.vpcId } }] },
    "ecs:describe-services": { services: [observedService] }, "ecs:describe-task-definition": { taskDefinition },
    "ecs:list-tasks": { taskArns: [taskArn] }, "ecs:describe-tasks": { tasks: [observedTask] },
    "elbv2:describe-listeners": { Listeners: [443, 8443].map(port => ({ ListenerArn: listener(port), LoadBalancerArn: ingress.albArn,
      Port: port, Protocol: "HTTPS", MutualAuthentication: { Mode: port === 8443 ? "verify" : "off" } })) },
    "elbv2:describe-load-balancers": { LoadBalancers: [{ LoadBalancerArn: ingress.albArn, DNSName: privateDns,
      VpcId: ingress.vpcId, Scheme: "internal", State: { Code: "active" } }] },
    "elbv2:describe-target-groups": { TargetGroups: [{ TargetGroupArn: targetArn, VpcId: ingress.vpcId, Port: 3000 }] },
    "elbv2:describe-target-health": { TargetHealthDescriptions: [{ Target: { Id: "10.1.1.2" }, TargetHealth: { State: "healthy" } }] },
    "elbv2:describe-rules": { Rules: [{ RuleArn: ruleFor(443, 1), Conditions: [{ Field: "host-header", Values: [approval.hostname] }],
      Actions: [{ Type: "forward", TargetGroupArn: targetArn }] }, { RuleArn: ruleFor(8443, 2) }, { RuleArn: ruleFor(8443, 3) }] },
    "route53:list-resource-record-sets": { ResourceRecordSets: [{ Name: approval.hostname + ".", Type: "A", AliasTarget: { DNSName: privateDns + "." } }] },
    "s3api:head-bucket": {}, "ecr:batch-get-image": { images: [{ imageManifest: imageArtifact, imageId: { imageDigest: manifestDigest } }] },
    ...patch };
  const identity = { roleArn: FIRST_OPEN_TASK_ROLE, credentials: () => assert.fail("synthetic reader used SDK credentials") };
  const reader = createFirstOpenRdsInspector({ approval, scope, release, identity, material: () => material, now: () => now }, {
    openCloud(credentials, endpoint) {
      assert.equal(credentials, identity.credentials);
      assert.equal(endpoint, route53Endpoint);
      return {
        caller: async () => { calls.push("caller"); return { Account: account, Arn: `arn:aws:sts::${account}:assumed-role/TechlongSandboxFirstOpenTaskRole/test` }; },
        async read(service, operation, input) {
          const key = service + ":" + operation;
          calls.push(key);
          if (key === "cloudformation:describe-stacks") {
            const values = { HttpsListenerArn: ingress.httpsListenerArn, ControlListenerArn: ingress.controlListenerArn,
              ClusterName: ingress.clusterArn, VpcId: ingress.vpcId };
            return { Stacks: [{ StackId: input.StackName, StackStatus: "CREATE_COMPLETE", CreationTime: new Date(now).toISOString(),
              Parameters: Object.entries({ ...values, SubnetIds: tenantSubnetValue }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
              Outputs: [...Object.entries(values).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })),
                ...cellSubnetValues.map(OutputValue => ({ OutputKey: FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT, OutputValue }))] }] };
          }
          if (key === "secretsmanager:describe-secret") return { ARN: input.SecretId, VersionIdsToStages: secretVersions };
          assert.ok(Object.hasOwn(readOnly, key), key);
          return readOnly[key];
        },
      };
    },
    database: async input => { assert.deepEqual(input.tenant, tenant); calls.push("readOnlySql"); return marker; },
    technical: async input => {
      assert.equal(input.albDnsName, privateDns); assert.equal(input.hostname, approval.hostname); calls.push(input.path);
      return { status: 200, tlsVerified: true, checkedAt: now };
    },
  });
  return { reader, calls, capture: extra => reader.capture({ stackId, hostname: approval.hostname, databaseName, signal: new AbortController().signal, ...extra }) };
}

test("T4.2 RDS Inspector samples one bound private tenant and forwards provider facts to the existing checks", async () => {
  const f = fixture();
  const capture = await f.capture();
  assert.deepEqual(capture.database, marker);
  assert.equal(capture.facts.artifact.manifest, imageArtifact);
  assert.equal(capture.facts.databaseProfile, "full_password");
  assert.deepEqual(capture.facts.service.networkConfiguration.awsvpcConfiguration, serviceNetwork);
  assert.deepEqual(capture.facts.tasks, [observedTask]);
  assert.deepEqual(f.calls.slice(-3), ["readOnlySql", "/health", "/ready"]);
  await assert.rejects(f.capture(), /ECS_FIRST_OPEN_INSPECTOR_SCOPE/);
});

test("T4.2 RDS Inspector requires the sealed private subnet pair, the exact Cell output and tenant stack parameter", async () => {
  for (const material of [
    { ...approvedMaterial, privateSubnetIds: undefined },
    { ...approvedMaterial, privateSubnetIds: [privateSubnetIds[0], privateSubnetIds[0]] },
    { ...approvedMaterial, privateSubnetIds: [privateSubnetIds[0], "subnet-ABCDEF00"] },
    { ...approvedMaterial, sampling: { ...sampling, cellOutputParameters: { ...sampling.cellOutputParameters, SubnetIds: "SubnetIds" } } },
  ]) {
    const f = fixture({ material });
    await assert.rejects(f.capture(), /ECS_FIRST_OPEN_INSPECTOR_TENANT_NETWORK_SCOPE/);
    assert.deepEqual(f.calls, []);
  }
  for (const cellSubnetValues of [[], [privateSubnetIds[0] + "," + outsideSubnet], [approvedSubnets, approvedSubnets]]) {
    const f = fixture({ cellSubnetValues });
    await assert.rejects(f.capture(), /ECS_FIRST_OPEN_INSPECTOR_TENANT_NETWORK_SCOPE/);
    assert.ok(!f.calls.includes("ecs:describe-services"));
  }
  const f = fixture({ tenantSubnetValue: privateSubnetIds[0] + "," + outsideSubnet });
  await assert.rejects(f.capture(), /RELEASE_CELL_REFERENCE_CHANGED/);
  assert.ok(!f.calls.includes("ecs:describe-services"));
});

test("T4.2 RDS Inspector rejects service network drift before any task, SQL or health read", async () => {
  for (const awsvpcConfiguration of [
    { ...serviceNetwork, assignPublicIp: "ENABLED" }, { ...serviceNetwork, assignPublicIp: undefined },
    { ...serviceNetwork, subnets: [privateSubnetIds[0], outsideSubnet] },
    { ...serviceNetwork, subnets: [privateSubnetIds[0], privateSubnetIds[0]] },
  ]) {
    const f = fixture({ patch: { "ecs:describe-services": { services: [{ ...observedService, networkConfiguration: { awsvpcConfiguration } }] } } });
    await assert.rejects(f.capture(), /ECS_FIRST_OPEN_INSPECTOR_TENANT_NETWORK_SCOPE/);
    assert.equal(f.calls.at(-1), "ecs:describe-services");
  }
});

test("T4.2 RDS Inspector rejects missing, misbound and unexpected ECS task ENIs before SQL or health", async () => {
  const outsideEni = { ...attachedEni, details: [attachedEni.details[0], { name: "subnetId", value: outsideSubnet }] };
  for (const patch of [
    { "ecs:list-tasks": { taskArns: [] } },
    { "ecs:list-tasks": { taskArns: [taskArn], nextToken: "unobserved-page" } },
    ...[[], [{ ...observedTask, taskArn: ecs + "task/ca-cell/" + "a".repeat(32) }],
      [{ ...observedTask, taskDefinitionArn: taskDefinitionArn.replace(":4", ":5") }],
      [{ ...observedTask, group: "service:other" }], [{ ...observedTask, lastStatus: "STOPPED" }],
      ...[[], [outsideEni], [attachedEni, attachedEni], [{ ...attachedEni, status: "DETACHING" }],
        [{ ...attachedEni, details: [attachedEni.details[1]] }],
        [{ ...attachedEni, details: [...attachedEni.details, attachedEni.details[1]] }],
      ].map(attachments => [{ ...observedTask, attachments }]),
    ].map(tasks => ({ "ecs:describe-tasks": { tasks } })),
  ]) {
    const f = fixture({ patch });
    await assert.rejects(f.capture(), /ECS_FIRST_OPEN_INSPECTOR_TENANT_NETWORK_SCOPE/);
    assert.ok(["ecs:list-tasks", "ecs:describe-tasks"].includes(f.calls.at(-1)));
  }
});

test("T4.2 RDS Inspector proves the selected task Secret version independently of AWSCURRENT", async () => {
  const current = "f".repeat(64);
  const retained = fixture({ secretVersions: { [versionId]: ["AWSPREVIOUS"], [current]: ["AWSCURRENT"] } });
  const capture = await retained.capture();
  assert.equal(capture.facts.relatedBindings[runtimeSecretArn], versionId);
  const changed = fixture({ secretVersions: { [current]: ["AWSCURRENT"] } });
  await assert.rejects(changed.capture(), /RELEASE_FIXED_SECRET_VERSION_CHANGED/);
  assert.ok(!changed.calls.includes("readOnlySql"));
});

test("T4.2 RDS Inspector refuses wrong tenant, public listener and wrong database metadata before health or SQL", async () => {
  const unbound = fixture();
  await assert.rejects(unbound.capture({ stackId: stack("another-stack") }), /ECS_FIRST_OPEN_INSPECTOR_SCOPE/);
  assert.deepEqual(unbound.calls, []);
  const openAlb = fixture({ patch: { "elbv2:describe-load-balancers": { LoadBalancers: [{ LoadBalancerArn: ingress.albArn, DNSName: privateDns,
    VpcId: ingress.vpcId, Scheme: "internet-facing" }] } } });
  await assert.rejects(openAlb.capture(), /ECS_FIRST_OPEN_INSPECTOR_ALB_SCOPE/);
  const openRds = fixture({ patch: { "rds:describe-db-instances": { DBInstances: [{ DBInstanceIdentifier: dbInstanceIdentifier, PubliclyAccessible: true }] } } });
  await assert.rejects(openRds.capture(), /ECS_FIRST_OPEN_INSPECTOR_RDS_SCOPE/);
  assert.ok([...openAlb.calls, ...openRds.calls].every(action => !["readOnlySql", "/health", "/ready"].includes(action)));
});

test("T4.2 Inspector SDK rejects non-private Route 53 endpoints and mutation commands before dispatch", async () => {
  const credentials = () => assert.fail("forbidden SDK path called credentials");
  assert.throws(() => createFirstOpenInspectorSdk(credentials, "https://route53.amazonaws.com"), /ECS_FIRST_OPEN_INSPECTOR_SCOPE/);
  const sdk = createFirstOpenInspectorSdk(credentials, route53Endpoint);
  await assert.rejects(sdk.read("secretsmanager", "get-secret-value", {}, new AbortController().signal), /ECS_FIRST_OPEN_INSPECTOR_OPERATION/);
  assert.throws(() => readFirstOpenPrivateTechnical({ path: "/ready", hostname: approval.hostname, albDnsName: "public.example.net",
    signal: new AbortController().signal, now: () => now }), /ECS_FIRST_OPEN_INSPECTOR_HTTP_SCOPE/);
});

test("T4.2 tenant Inspector SQL uses a fresh read-only connection and observes database terminal and app role ownership independently", async () => {
  const logs = [];
  const metadata = (kind, values = {}) => JSON.stringify({ schemaVersion: 1, kind, ownershipMarker: ownerMarker,
    marker: { resourceGeneration: 1, ownershipMarker: ownerMarker, ...values } });
  const databaseComment = metadata("techlong_tenant_database", {
    lifecycleState: "verified", baselineDigest, migrationContract: "speedfeast-saas-control-v1",
  });
  const roleComment = metadata("techlong_tenant_role");
  const identity = { database: databaseName, username: tenant.username, effectiveUsername: tenant.username,
    owner: tenant.owner, databaseOid: tenant.databaseOid, databaseComment, serverVersionNum: 160014, serverAddress: "10.1.2.3",
    port: 5432, inRecovery: false, readOnly: "on", tls: true };
  const make = role => createTenantPostgresAdapter({ target: { ...tenant, kind: "rds", engine: "postgres", port: 5432 },
    databaseUrl: tenant.databaseUrl, ca: rootCertificates[0], createClient(options) {
      assert.equal(options.ssl.rejectUnauthorized, true);
      assert.equal(options.ssl.servername, tenant.host);
      const client = new EventEmitter();
      client.connect = async () => { logs.push("connect"); };
      client.end = async () => { logs.push("end"); };
      client.query = async (sql, values) => {
        if (sql.startsWith("SELECT current_database")) return { rows: [identity] };
        if (sql.startsWith("SELECT pg_catalog.shobj_description")) {
          logs.push("sample");
          assert.deepEqual(values, [tenant.applicationRole]);
          return { rows: [{ databaseComment, roleComment: role, address: "10.1.2.3", applicationRoleVerified: true, saasMigrated: true }] };
        }
        logs.push(sql);
        return { rows: [] };
      };
      return client;
    } });
  const options = { applicationRole: tenant.applicationRole, baselineDigest, signal: new AbortController().signal,
    backendDirectory: fileURLToPath(new URL("../ops/platform-hosting-v1/first-open-backend", import.meta.url)) };
  assert.deepEqual(await make(roleComment).inspectFirstOpen(options), marker);
  assert.deepEqual(logs, ["connect", "BEGIN READ ONLY", "SET LOCAL search_path = pg_catalog", "sample", "ROLLBACK", "end"]);
  await assert.rejects(make(roleComment).inspectFirstOpen({ ...options, baselineDigest: "1".repeat(64) }), /TENANT_POSTGRES_BASELINE_UNAPPROVED/);
  await assert.rejects(make(metadata("techlong_tenant_role", { resourceGeneration: 2 })).inspectFirstOpen(options),
    /TENANT_POSTGRES_INSPECTION_UNVERIFIED/);
});
