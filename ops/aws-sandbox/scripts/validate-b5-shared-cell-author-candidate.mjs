import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileB5SharedCellAuthorCandidate,
  serializeB5SharedCellAuthorCandidate,
} from "./compile-b5-shared-cell-author-candidate.mjs";
import { canonicalJson } from "./verify-change-set-template.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const opsRoot = path.resolve(scriptDirectory, "..");
const fixture = Object.freeze({
  requestedAt: "2026-08-09T00:00:00.000Z",
  availabilityZones: Object.freeze(["ca-central-1a", "ca-central-1b"]),
  certificateArn:
    "arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-1234-1234-123456789abc",
  controlTrustStoreArn:
    "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control/0123456789abcdef",
  cellJanitorFunctionArn:
    "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
  cellSchedulerInvokeRoleArn:
    "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
  cellSchedulerGroupName: "techlong-sandbox-cell",
  allowPlanOnlyAuthoring: true,
});

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

assert.throws(
  () =>
    compileB5SharedCellAuthorCandidate({
      ...fixture,
      allowPlanOnlyAuthoring: false,
    }),
  /delete_shared_cell_stack is event-compatible, but the PLAN_ONLY Janitor cannot perform deletion/,
);
assert.throws(
  () =>
    compileB5SharedCellAuthorCandidate({
      ...fixture,
      requestedAt: "2026-08-09T00:00:00Z",
    }),
  /canonical UTC timestamp with milliseconds/,
);
assert.throws(
  () =>
    compileB5SharedCellAuthorCandidate({
      ...fixture,
      availabilityZones: ["ca-central-1a", "ca-central-1a"],
    }),
  /availability zones or render time are invalid/,
);
assert.throws(
  () =>
    compileB5SharedCellAuthorCandidate({
      ...fixture,
      unexpected: true,
    }),
  /input keys are not exact/,
);

const candidate = compileB5SharedCellAuthorCandidate(fixture);
const repeated = compileB5SharedCellAuthorCandidate(fixture);
assert.deepEqual(candidate, repeated);
assert.equal(
  serializeB5SharedCellAuthorCandidate(candidate),
  serializeB5SharedCellAuthorCandidate(repeated),
);
assert.deepEqual(
  JSON.parse(serializeB5SharedCellAuthorCandidate(candidate)),
  candidate,
);

const { manifest, templateSnapshot } = candidate;
assert.equal(candidate.schemaVersion, 1);
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.candidateKind, "b5-shared-cell-author");
assert.deepEqual(manifest.identity, {
  accountId: "402010193138",
  region: "ca-central-1",
  cellId: "cell-sandbox-1",
  stackName: "techlong-sandbox-cell-sandbox-1",
});
assert.equal(manifest.requestedAt, fixture.requestedAt);
assert.equal(manifest.cellExpiresAt, "2026-08-09T03:00:00.000Z");
assert.equal(manifest.cleanupAt, "2026-08-09T03:00:00");

assert.equal(templateSnapshot.encoding, "utf8");
assert.equal(templateSnapshot.trailingNewline, false);
assert.equal(templateSnapshot.byteLength, Buffer.byteLength(templateSnapshot.body, "utf8"));
assert.equal(templateSnapshot.rawSha256, sha256(templateSnapshot.body));
assert.equal(
  templateSnapshot.canonicalSha256,
  sha256(canonicalJson(JSON.parse(templateSnapshot.body))),
);
assert.equal(
  templateSnapshot.rawSha256,
  "b55cbce8d39ffbf185be8dcf9ee66a9ba4dccfceb37c57cff340f9b421c4308c",
);
assert.equal(
  templateSnapshot.canonicalSha256,
  "e7f9075c09ee70e3a55ee1aa11acde53d1c9758616a5572d6d12ad83226294b6",
);
assert.equal(manifest.immutableTemplate.rawSha256, templateSnapshot.rawSha256);
assert.equal(
  manifest.immutableTemplate.canonicalSha256,
  templateSnapshot.canonicalSha256,
);
assert.equal(manifest.immutableTemplate.byteLength, templateSnapshot.byteLength);
assert.equal(
  manifest.immutableTemplate.key,
  `b5-shared-cell/templates/sha256/${templateSnapshot.rawSha256}.json`,
);
assert.equal(
  manifest.immutableTemplate.url,
  `https://techlong-sandbox-build-source-402010193138-ca-central-1.s3.ca-central-1.amazonaws.com/${manifest.immutableTemplate.key}`,
);

assert.equal(
  manifest.changeSet.name,
  "techlong-sandbox-cell-sandbox-1-b55cbce8d39ffbf1",
);
assert.equal(manifest.changeSet.type, "CREATE");
assert.equal(
  manifest.changeSet.roleArn,
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
);
assert.deepEqual(manifest.changeSet.capabilities, []);
assert.equal(manifest.changeSet.includeNestedStacks, false);
assert.equal(manifest.changeSet.resourceTypes.length, 18);
assert.equal(new Set(manifest.changeSet.resourceTypes).size, 18);
assert.deepEqual(manifest.changeSet.resourceTypes, [
  "AWS::Scheduler::Schedule",
  "AWS::EC2::VPC",
  "AWS::EC2::InternetGateway",
  "AWS::EC2::VPCGatewayAttachment",
  "AWS::EC2::Subnet",
  "AWS::EC2::RouteTable",
  "AWS::EC2::Route",
  "AWS::EC2::SubnetRouteTableAssociation",
  "AWS::EC2::SecurityGroup",
  "AWS::EC2::SecurityGroupIngress",
  "AWS::ECS::Cluster",
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::ElasticLoadBalancingV2::Listener",
  "AWS::ElasticLoadBalancingV2::ListenerRule",
  "AWS::RDS::DBSubnetGroup",
  "AWS::Logs::LogGroup",
  "AWS::RDS::DBCluster",
  "AWS::RDS::DBInstance",
]);
assert.deepEqual(manifest.changeSet.tags, [
  { Key: "Environment", Value: "aws-sandbox" },
  { Key: "ManagedBy", Value: "techlong-cell-operator" },
  { Key: "CellId", Value: "cell-sandbox-1" },
  { Key: "ExpiresAt", Value: "2026-08-09T03:00:00.000Z" },
]);
assert.deepEqual(
  Object.fromEntries(
    manifest.changeSet.parameters.map(({ ParameterKey, ParameterValue }) => [
      ParameterKey,
      ParameterValue,
    ]),
  ),
  {
    AvailabilityZoneA: "ca-central-1a",
    AvailabilityZoneB: "ca-central-1b",
    CertificateArn: fixture.certificateArn,
    ControlTrustStoreArn: fixture.controlTrustStoreArn,
    CellJanitorFunctionArn: fixture.cellJanitorFunctionArn,
    CellSchedulerInvokeRoleArn: fixture.cellSchedulerInvokeRoleArn,
    CellSchedulerGroupName: fixture.cellSchedulerGroupName,
    CleanupAt: "2026-08-09T03:00:00",
  },
);

assert.deepEqual(manifest.cleanupSchedule.event, {
  schemaVersion: 1,
  action: "delete_shared_cell_stack",
  stackName: "techlong-sandbox-cell-sandbox-1",
  cellId: "cell-sandbox-1",
});
assert.equal(manifest.cleanupSchedule.expression, "at(2026-08-09T03:00:00)");
assert.equal(manifest.cleanupSchedule.state, "ENABLED");
assert.equal(manifest.compatibility.compatible, false);
assert.equal(manifest.compatibility.reviewedTargetCompatible, true);
assert.equal(manifest.compatibility.deployedCompatibilityVerified, true);
assert.equal(
  manifest.compatibility.probeEvidenceCanonicalSha256,
  "f98e7468920b42403aa04c8323b1f7dd46b85121a1354933083a6158f2a7ea47",
);
assert.equal(manifest.compatibility.reviewedTargetJanitorMode, "PLAN_ONLY");
assert.deepEqual(manifest.compatibility.reviewedTargetJanitorAcceptedEvents, [
  {
    schemaVersion: 1,
    action: "inspect_cell_cleanup_plan",
  },
  {
    schemaVersion: 1,
    action: "delete_shared_cell_stack",
    stackName: "techlong-sandbox-cell-sandbox-1",
    cellId: "cell-sandbox-1",
  },
]);
assert.deepEqual(manifest.compatibility.blockers, []);
assert.deepEqual(manifest.compatibility.executionBlockers.map(({ code }) => code), [
  "PLAN_ONLY_JANITOR_MUTATION_DISABLED",
]);
assert.deepEqual(manifest.readiness, {
  localCandidateValidated: true,
  authoringOnly: true,
  cloudApplyReady: false,
  executionReady: false,
  planOnlyAuthoringAcknowledged: true,
});
assert.equal(manifest.safety.callsAws, false);
assert.equal(manifest.safety.createsChargeableResources, false);
assert.equal(manifest.safety.compiledTemplateCreatesChargeableResources, true);
assert.equal(manifest.safety.maxCells, 1);
assert.equal(manifest.safety.maxAcu, 1);
assert.equal(manifest.safety.natGateways, 0);
assert.equal(manifest.safety.interfaceEndpoints, 0);
assert.equal(manifest.safety.cellTtlSeconds, 10_800);
assert.equal(manifest.safety.cleanupBufferSeconds, 900);
assert.deepEqual(manifest.worstCaseCostBoundary, {
  monthlyBudgetUsd: 10,
  budgetEnforcement: "ALERT_ONLY_NOT_HARD_CAP",
  exactUsdEstimateProvided: false,
  zeroCostGuaranteed: false,
  limits: {
    maxCells: 1,
    maxAuroraClusters: 1,
    maxAuroraInstances: 1,
    maxAuroraAcu: 1,
    maxApplicationLoadBalancers: 1,
    natGateways: 0,
    interfaceEndpoints: 0,
    cellTtlSeconds: 10_800,
  },
  notices: [
    "The USD 10 monthly AWS Budget is an alert, not a hard spending cap.",
    "This resource boundary is neither an exact USD estimate nor a zero-cost guarantee.",
  ],
});

const compiledTemplate = JSON.parse(templateSnapshot.body);
assert.equal(
  compiledTemplate.Outputs.CellExpiresAt.Value,
  manifest.cellExpiresAt,
);
assert.equal(
  manifest.changeSet.tags.find(({ Key }) => Key === "ExpiresAt").Value,
  manifest.cellExpiresAt,
);
assert.equal(
  manifest.changeSet.parameters.find(({ ParameterKey }) => ParameterKey === "CleanupAt")
    .ParameterValue,
  manifest.cellExpiresAt.replace(/\.\d{3}Z$/, ""),
);

const janitorSource = readFileSync(
  path.join(opsRoot, "lambda", "cell-janitor.cjs"),
  "utf8",
);
assert.match(janitorSource, /const PLAN_ACTION = "inspect_cell_cleanup_plan"/);
assert.match(janitorSource, /const DELETE_INTENT_ACTION = "delete_shared_cell_stack"/);
assert.match(janitorSource, /const PLAN_ONLY_MODE = "PLAN_ONLY"/);
assert.match(janitorSource, /event\.action === DELETE_INTENT_ACTION/);
assert.match(
  janitorSource,
  /exactKeys\(event, \["action", "cellId", "schemaVersion", "stackName"\]\)/,
);
assert.match(janitorSource, /event\.stackName === EXPECTED_CELL_STACK_NAME/);
assert.match(janitorSource, /event\.cellId === EXPECTED_CELL_ID/);
assert.doesNotMatch(janitorSource, /DeleteStackCommand|ExecuteChangeSetCommand/);

const compilerSource = readFileSync(
  path.join(scriptDirectory, "compile-b5-shared-cell-author-candidate.mjs"),
  "utf8",
);
assert.doesNotMatch(
  compilerSource,
  /from\s+["']@aws-sdk|node:child_process|execFile(?:Sync)?\s*\(|spawn(?:Sync)?\s*\(/,
);

console.log(
  "B5 Shared Cell deterministic author candidate validated locally (18 resource types, exact TTL/tags/hashes, delete intent event-compatible, PLAN_ONLY execution blocked, no AWS calls).",
);
