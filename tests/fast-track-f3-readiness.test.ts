import test from "node:test";
import assert from "node:assert/strict";
import { compileFastTrackF3Readiness, type F3ReadOnlyEvidence, type F3RegionalPrices } from "../lib/deployments/execution/fast-track-f3-readiness.ts";
function fixture() {
  const reads: F3ReadOnlyEvidence["reads"] = [
    { label: "SourceIdentity", readSucceeded: true, data: { Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" } },
    { label: "Aurora16_14", readSucceeded: true, data: { DBEngineVersions: [{ EngineVersion: "16.14", Status: "available", SupportsLimitlessDatabase: false, ServerlessV2FeaturesSupport: { MinCapacity: 0 } }] } },
    { label: "Aurora16_14Serverless", readSucceeded: true, data: { OrderableDBInstanceOptions: [{ EngineVersion: "16.14", DBInstanceClass: "db.serverless", StorageType: "aurora" }] } },
    { label: "CellCluster", readSucceeded: true, data: { clusters: [], failures: [{ reason: "MISSING" }] } },
    { label: "SandboxDatabaseClusters", readSucceeded: true, data: [] },
    { label: "AuthorityTable", readSucceeded: true, data: { Table: { OnDemandThroughput: { MaxReadRequestUnits: 5 } } } },
    { label: "CellJanitor", readSucceeded: true, data: { mode: "PLAN_ONLY" } },
    { label: "CellGlobalSchedule", readSucceeded: true, data: { State: "DISABLED" } },
    { label: "Certificates", readSucceeded: true, data: { CertificateSummaryList: [{ Status: "ISSUED", DomainName: "api.techlong.cloud" }] } },
    { label: "ControlTrustStores", readSucceeded: true, data: { TrustStores: [] } },
    { label: "HostedZones", readSucceeded: true, data: [] },
    { label: "Budgets", readSucceeded: true, data: [{ name: "techlong-sandbox-402010193138-ca-central-1", limit: { Amount: "10.0", Unit: "USD" } }] },
    { label: "CostAllocationTags", readSucceeded: true, data: { CostAllocationTags: [{ TagKey: "Environment", Status: "Active" }] } },
    { label: "cell:cell-sandbox-1", readSucceeded: true, data: null },
    { label: "runtime:cell-sandbox-1:lifecycle-v2", readSucceeded: true, data: null },
  ];
  const dimensions: Array<[string, string, number, string?]> = [["AmazonECS", "CAN1-Fargate-vCPU-Hours:perCPU", .04456],
    ["AmazonECS", "CAN1-Fargate-GB-Hours", .004865], ["AWSELB", "CAN1-LoadBalancerUsage", .02475, "LoadBalancing:Application"],
    ["AWSELB", "CAN1-LCUUsage", .0088, "LoadBalancing:Application"], ["AWSELB", "CAN1-TS-LoadBalancerUsage", .0055, "LoadBalancing:Application"],
    ["AmazonRDS", "CAN1-Aurora:ServerlessV2Usage", .14], ["AmazonVPC", "CAN1-PublicIPv4:InUseAddress", .005]];
  const prices: F3RegionalPrices = { region: "ca-central-1", currency: "USD", snapshots: [...new Set(dimensions.map(d => d[0]))].map(service => ({ service,
    url: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/ca-central-1/index.json`, sha256: "a".repeat(64),
    selected: dimensions.filter(d => d[0] === service).map((d, i) => ({ sku: `fixture-${i}`, attributes: { regionCode: "ca-central-1", usagetype: d[1], ...(d[3] ? { operation: d[3] } : {}) }, unit: "hours", usd: String(d[2]) })) })) };
  return { evidence: { reads }, prices };
}
test("observed current cloud blockers never become cloud approval or runtime capability", () => {
  const f = fixture(), r = compileFastTrackF3Readiness(f.evidence, f.prices, true);
  assert.equal(r.deploymentAuthorized, false); assert.equal(r.runtimeEnabled, false); assert.equal(r.cloudMutationPerformed, false);
  for (const code of ["AURORA_16_14_SERVERLESS", "CELL_ABSENT", "COST_ALLOCATION_TAG", "ORIGINAL_IMAGE_CANDIDATES"]) assert.equal(r.gates.find(g => g.code === code)!.status, "pass");
  for (const code of ["ADMISSION_READ_CAPACITY", "EXECUTABLE_TTL_CLEANUP", "SANDBOX_WILDCARD_CERTIFICATE", "CONTROL_MTLS_TRUSTSTORE", "BUDGET_50_USD", "ACTIVATION_AND_CELL_AUTHORITY"]) assert.ok(r.blockers.includes(code));
  assert.equal(r.estimate.hardCap, false); assert.equal(r.estimate.permanentAlwaysOnWithin50Usd, false);
  assert.ok(Math.abs(r.estimate.coreHourlyUsd - .2076225) < 1e-10);
  assert.ok(r.estimate.fourHourCoreAndOneShotUsd > .83 && r.estimate.fourHourCoreAndOneShotUsd < .84);
  assert.ok(r.estimate.continuous730HoursHalfAcuCoreUsd > 100);
});
test("failed/duplicate provider reads remain unverified, and a mode flag cannot activate cleanup", () => {
  const f = fixture();
  f.evidence.reads.push({ label: "SourceIdentity", readSucceeded: true, data: { Account: "402010193138" } });
  f.evidence.reads.find(r => r.label === "Aurora16_14")!.readSucceeded = false;
  f.evidence.reads.find(r => r.label === "CellJanitor")!.data = { mode: "EXECUTABLE" };
  const r = compileFastTrackF3Readiness(f.evidence, f.prices, true);
  assert.equal(r.gates.find(g => g.code === "SOURCE_IDENTITY")!.status, "unverified");
  assert.equal(r.gates.find(g => g.code === "AURORA_16_14_SERVERLESS")!.status, "unverified");
  assert.ok(r.blockers.includes("EXECUTABLE_TTL_CLEANUP"));
});
test("wrong region, feed origin, currency, ambiguous price or missing used-LCU dimension is refused", () => {
  const f = fixture();
  for (const mutate of [(p: F3RegionalPrices) => { p.currency = "CAD"; }, (p: F3RegionalPrices) => { p.region = "us-east-1"; },
    (p: F3RegionalPrices) => { p.snapshots[0].url = "https://example.com/prices"; },
    (p: F3RegionalPrices) => { p.snapshots[0].selected.push(p.snapshots[0].selected[0]); },
    (p: F3RegionalPrices) => { p.snapshots.find(s => s.service === "AWSELB")!.selected = p.snapshots.find(s => s.service === "AWSELB")!.selected.filter(d => d.attributes.usagetype !== "CAN1-LCUUsage"); }]) {
    const changed = structuredClone(f.prices); mutate(changed);
    assert.throws(() => compileFastTrackF3Readiness(f.evidence, changed, true));
  }
});
