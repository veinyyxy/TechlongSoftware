/** A diagnostic compiler, NOT a cloud authority or live-runtime capability.
 * Pure data in; no provider, DNS, secret, database or filesystem access. */
export interface F3ReadOnlyEvidence {
  reads: Array<{ label: string; readSucceeded: boolean; data?: unknown; errorCode?: string }>;
}
export interface F3PriceDimension {
  attributes: Record<string, string>;
  unit: string;
  usd: string;
  sku: string;
}
export interface F3RegionalPrices {
  region: string;
  currency: string;
  snapshots: Array<{ service: string; url: string; sha256: string; selected: F3PriceDimension[] }>;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : []; }
function statements(value: unknown) { return list(record(value).Statement); }

export function compileFastTrackF3Readiness(evidence: F3ReadOnlyEvidence, prices: F3RegionalPrices,
  originalCandidatesVerified: boolean) {
  const get = (label: string) => {
    const matches = evidence.reads.filter(r => r.label === label);
    return matches.length === 1 && matches[0].readSucceeded ? matches[0] : null;
  };
  const data = (label: string) => record(get(label)?.data);
  const gates: Array<{ code: string; status: "pass" | "blocked" | "unverified"; detail: string }> = [];
  const gate = (code: string, observed: boolean, ready: boolean, detail: string) => gates.push({ code, status: !observed ? "unverified" : ready ? "pass" : "blocked", detail });
  const source = data("SourceIdentity");
  gate("SOURCE_IDENTITY", !!get("SourceIdentity"), source.Account === "402010193138" && source.Arn === "arn:aws:iam::402010193138:user/techlong-sandbox-dev", "Source identity is read-only evidence, not approval.");
  const engine = list(data("Aurora16_14").DBEngineVersions);
  const options = list(data("Aurora16_14Serverless").OrderableDBInstanceOptions);
  gate("AURORA_16_14_SERVERLESS", !!get("Aurora16_14") && !!get("Aurora16_14Serverless"),
    engine.length === 1 && engine[0].EngineVersion === "16.14" && engine[0].Status === "available" && engine[0].SupportsLimitlessDatabase === false &&
    record(engine[0].ServerlessV2FeaturesSupport).MinCapacity === 0 && options.some(o => o.DBInstanceClass === "db.serverless" && o.StorageType === "aurora" && o.EngineVersion === "16.14"),
    "Regional availability does not prove actual RDS session identity or baseline restore.");
  const cluster = data("CellCluster");
  gate("CELL_ABSENT", !!get("CellCluster") && !!get("SandboxDatabaseClusters"),
    list(cluster.clusters).length === 0 && list(cluster.failures).some(f => f.reason === "MISSING") && Array.isArray(get("SandboxDatabaseClusters")?.data) && (get("SandboxDatabaseClusters")!.data as unknown[]).length === 0,
    "No paid Cell observed; existing absence never authorizes creation.");
  const table = record(data("AuthorityTable").Table), throughput = record(table.OnDemandThroughput);
  gate("ADMISSION_READ_CAPACITY", !!get("AuthorityTable"), Number(throughput.MaxReadRequestUnits) >= 100 || throughput.MaxReadRequestUnits === -1,
    `Current max read units: ${String(throughput.MaxReadRequestUnits)}. Per-query checks read activation+epoch before and after SQL; 100 RRU/s is a proposed allowance, not a live throughput guarantee.`);
  const lambda = data("CellJanitor"), schedule = data("CellGlobalSchedule");
  gate("EXECUTABLE_TTL_CLEANUP", !!get("CellJanitor") && !!get("CellGlobalSchedule"),
    false, `Observed mode=${String(lambda.mode)}, schedule=${String(schedule.State ?? schedule.state)}. Executable owned-resource cleanup, lease loss and live expiry proof are still required; switching a flag is insufficient.`);
  const certificates = list(data("Certificates").CertificateSummaryList);
  gate("SANDBOX_WILDCARD_CERTIFICATE", !!get("Certificates"), certificates.some(c => c.Status === "ISSUED" &&
    (c.DomainName === "*.sandbox.techlong.cloud" || (Array.isArray(c.SubjectAlternativeNameSummaries) && c.SubjectAlternativeNameSummaries.includes("*.sandbox.techlong.cloud")))),
    "Existing api.techlong.cloud certificate is not the sandbox wildcard. Exact SAN/expiry readback is required before deployment.");
  gate("CONTROL_MTLS_TRUSTSTORE", !!get("ControlTrustStores"), false,
    `${list(data("ControlTrustStores").TrustStores).length} stores observed. An exact ACTIVE store, private client material and end-to-end mTLS verification are not proved.`);
  gate("DNS_AUTOMATION", !!get("HostedZones"), false, "No reviewed DNS provider write capability/zone/record readback. Domain currently uses Namecheap; do not silently create a Route53 zone.");
  const policies = record(data("Inline:TechlongSandboxTenantLifecycleTaskRole/ImmutableReceiptsAndGenerationSecretRead").PolicyDocument);
  const actions = statements(policies).flatMap(s => Array.isArray(s.Action) ? s.Action : [s.Action]);
  gate("PREPARED_TASK_IAM", !!get("Inline:TechlongSandboxTenantLifecycleTaskRole/ImmutableReceiptsAndGenerationSecretRead"), false,
    `Existing inline actions: ${[...new Set(actions)].join(",")}. Prepared admission/baseline scopes and a dedicated boundary still require fresh installation and effective-permission proof.`);
  const budgetList = get("Budgets")?.data;
  const budget = list(budgetList).find(b => b.name === "techlong-sandbox-402010193138-ca-central-1");
  const budgetLimit = record(budget?.limit);
  gate("BUDGET_50_USD", !!get("Budgets"), budgetLimit.Unit === "USD" && Number(budgetLimit.Amount) === 50,
    `Live tagged monthly budget: ${String(budgetLimit.Amount)} USD; desired target 50 USD. Neither is a hard billing cutoff.`);
  const tags = list(data("CostAllocationTags").CostAllocationTags);
  gate("COST_ALLOCATION_TAG", !!get("CostAllocationTags"), tags.some(t => t.TagKey === "Environment" && t.Status === "Active"), "Billing usage and budget figures remain delayed, not a real-time account balance.");
  const serviceRoles = ["AWSServiceRoleForECS", "AWSServiceRoleForRDS", "AWSServiceRoleForElasticLoadBalancing"];
  gate("REQUIRED_SERVICE_LINKED_ROLES", serviceRoles.every(role => evidence.reads.some(r => r.label === `ServiceLinkedRole:${role}`)),
    serviceRoles.every(role => typeof get(`ServiceLinkedRole:${role}`)?.data === "string"),
    "ECS/RDS roles are observed; ELB role is missing. Any creation/automatic bootstrap must be explicitly included in a fresh scope.");
  gate("ORIGINAL_IMAGE_CANDIDATES", true, originalCandidatesVerified, "Original ZIP/receipt/checksum verification only; no Docker load or registry publication proof.");
  const imageTags = list(data("EcrImages").imageDetails).flatMap(i => Array.isArray(i.imageTags) ? i.imageTags : []);
  gate("PREPARED_ROOT_PUBLISHED", !!get("EcrImages"), false, `${imageTags.length} existing image tags retained. New reviewed root publication, digest/scan readback and task registration are not proved.`);
  gate("BASELINE_APPROVED_AND_INSTALLED", true, false, "Private 73-table schema-only baseline is unapproved; bucket and immutable objects have not been installed.");
  gate("ACTIVATION_AND_CELL_AUTHORITY", !!get("cell:cell-sandbox-1") && !!get("runtime:cell-sandbox-1:lifecycle-v2"), false, "Both reads are currently absent. No installer or fresh conditional write authority exists.");
  gate("LIVE_ENDPOINT_LEASE_AND_CLEANUP", true, false, "Fargate metadata/credentials/volume, RDS session, cross-system leases/TTL and final cleanup need actual provider acceptance.");
  if (prices.region !== "ca-central-1" || prices.currency !== "USD") throw new Error("Wrong regional price evidence");
  const rate = (service: string, usage: string, operation?: string) => {
    const feeds = prices.snapshots.filter(s => s.service === service && s.url === `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/ca-central-1/index.json` && /^[a-f0-9]{64}$/.test(s.sha256));
    const matches = feeds.flatMap(s => s.selected).filter(p => p.attributes.regionCode === "ca-central-1" && p.attributes.usagetype === usage && (!operation || p.attributes.operation === operation));
    if (matches.length !== 1 || !Number.isFinite(Number(matches[0].usd)) || Number(matches[0].usd) <= 0) throw new Error("Ambiguous or missing price dimension");
    return { usd: Number(matches[0].usd), sku: matches[0].sku };
  };
  const rates = { cpu: rate("AmazonECS", "CAN1-Fargate-vCPU-Hours:perCPU"), memory: rate("AmazonECS", "CAN1-Fargate-GB-Hours"),
    alb: rate("AWSELB", "CAN1-LoadBalancerUsage", "LoadBalancing:Application"), lcu: rate("AWSELB", "CAN1-LCUUsage", "LoadBalancing:Application"),
    trustStore: rate("AWSELB", "CAN1-TS-LoadBalancerUsage", "LoadBalancing:Application"), acu: rate("AmazonRDS", "CAN1-Aurora:ServerlessV2Usage"),
    ipv4: rate("AmazonVPC", "CAN1-PublicIPv4:InUseAddress") };
  const taskHour = .25 * rates.cpu.usd + .5 * rates.memory.usd;
  const coreHour = taskHour + rates.alb.usd + rates.lcu.usd + rates.trustStore.usd + 3 * rates.ipv4.usd + rates.acu.usd;
  const oneShotTotal = 8 * (2 / 60) * (taskHour + rates.ipv4.usd);
  return { schemaVersion: 1 as const, outcome: "F3_PREFLIGHT_BLOCKED_REVIEW_ONLY" as const,
    cloudMutationPerformed: false as const, runtimeEnabled: false as const, deploymentAuthorized: false as const,
    gates, blockers: gates.filter(g => g.status !== "pass").map(g => g.code), monthlyBudgetTargetUsd: 50,
    rates, estimate: { assumptions: { cellNominalTtlHours: 3, billedHourAllowance: 4, applicationTasks: 1, cpu: .25, memoryGb: .5,
      auroraPeakAcu: 1, usedLcu: 1, publicIpv4: 3, associatedTrustStores: 1, oneShotTasks: 8, oneShotMinutes: 2 },
      coreHourlyUsd: coreHour, oneShotComputeAndIpv4Usd: oneShotTotal, fourHourCoreAndOneShotUsd: 4 * coreHour + oneShotTotal,
      continuous730HoursPeakAcuCoreUsd: 730 * coreHour,
      continuous730HoursHalfAcuCoreUsd: 730 * (coreHour - .5 * rates.acu.usd),
      excluded: ["storage", "database I/O", "backup", "data transfer", "Secrets Manager", "S3/ECR", "DynamoDB", "logging", "Lambda/Scheduler", "tax", "cleanup overrun"],
      hardCap: false as const, permanentAlwaysOnWithin50Usd: false as const } };
}
