import contract from './aurora-database-contract-v2.cjs';

export const C2_CLUSTER = 'techlong-sandbox-express-d001';
export const C2_CLUSTER_ARN = `arn:aws:rds:ca-central-1:402010193138:cluster:${C2_CLUSTER}`;
export const C2_SOURCE = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev';
export const C2_ACTIONS = Object.freeze(['ec2:DescribeAvailabilityZones', 'rds:CreateDBCluster',
  'rds:CreateDBInstance', 'rds:EnableInternetAccessGateway', 'rds:AddTagsToResource',
  'rds:DescribeDBClusters', 'rds:DescribeDBInstances', 'rds:DeleteDBCluster', 'rds:DeleteDBInstance', 'rds-db:connect']);
export const C2_RISKS = Object.freeze([
  'Existing Source is an administrator; this tool is a scope guard, not a new IAM least-privilege boundary.',
  'One CreateDBCluster can create a service-managed writer and gateway; no cross-service atomicity or CAS.',
  'Default engine can drift between read and create. Only observed supported facts may reach the SQL diagnostic.',
  'Cloud/SQL metadata and IAM-auth connections can appear in provider logs. IAM tokens stay in process memory.',
  'The public IPv4 gateway is IAM-only; client TLS is verified, backend TLS may differ. This does not prove tenant isolation.',
  'Automatic pause, tags, review expiry and a 50 USD/month goal are not a spending cap or automatic deletion.',
  'Pricing is gross, excluding credits; I/O, transfer, backup and an unconfirmed gateway tariff are not a guaranteed maximum.',
  'Failed/ambiguous submissions can leave billable resources. A consumed attempt never automatically resets or retries.',
  'Cleanup needs a separately approved fresh SHA bound to actual cluster/writer identities; it skips final snapshots and deletes automated backups.',
  'Identifier-based deletion has a read/write race despite immutable-identity checks; cleanup is irreversible and can require manual intervention.',
]);
export interface C2Facts {
  observedAt: string; identity: { Account: string; Arn: string; UserId: string };
  plan: { planType: string; planStatus: string }; clusters: readonly { DBClusterIdentifier?: string }[];
  instances: readonly { DBInstanceIdentifier?: string }[];
  defaultEngine: { EngineVersion?: string; ServerlessV2FeaturesSupport?: { MinCapacity?: number } };
  quotas: { clustersUsed: number; clustersMax: number; instancesUsed: number; instancesMax: number };
  rdsServiceRole: { Arn?: string; RoleId?: string };
  permissions: readonly { EvalActionName?: string; EvalDecision?: string; MissingContextValues?: readonly string[] }[];
}
export function assertC2Facts(f: C2Facts, now: number) {
  const age = now - Date.parse(f.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 30000 || f.identity.Account !== '402010193138' ||
    f.identity.Arn !== C2_SOURCE || f.identity.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' ||
    f.plan.planType !== 'FREE' || f.plan.planStatus !== 'ACTIVE' ||
    !Array.isArray(f.clusters) || !Array.isArray(f.instances) || f.clusters.length >= 2 || f.instances.length >= 2 ||
    f.clusters.some(c => c.DBClusterIdentifier === C2_CLUSTER) ||
    !/^(?:1[6-9]|[2-9][0-9])\.[0-9]{1,2}$/.test(f.defaultEngine.EngineVersion || '') ||
    f.defaultEngine.ServerlessV2FeaturesSupport?.MinCapacity !== 0 ||
    !Object.values(f.quotas).every(q => Number.isSafeInteger(q) && q >= 0) ||
    f.quotas.clustersUsed >= f.quotas.clustersMax || f.quotas.instancesUsed >= f.quotas.instancesMax ||
    f.rdsServiceRole.Arn !== 'arn:aws:iam::402010193138:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS' ||
    !f.rdsServiceRole.RoleId || f.permissions.length !== C2_ACTIONS.length ||
    C2_ACTIONS.some(a => f.permissions.filter(p => p.EvalActionName === a && p.EvalDecision === 'allowed' && !p.MissingContextValues?.length).length !== 1))
    throw Error('EXPRESS_C2_PREFLIGHT_REJECTED');
}
export interface C2Prices { observedAt: string; feedSha256: string; publicationDate: string;
  acuHour: number; storageGbMonth: number; ioRequest: number; gatewayRate: 'UNCONFIRMED_NOT_ASSUMED_ZERO' }
export function prepareC2Review(facts: C2Facts, prices: C2Prices, codeBindingSha256: string, nonce: string, now: number) {
  assertC2Facts(facts, now);
  if (!/^[a-f0-9]{64}$/.test(codeBindingSha256) || !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(prices.feedSha256) || !Number.isFinite(Date.parse(prices.observedAt)) || Date.parse(prices.observedAt) > now ||
    now - Date.parse(prices.observedAt) > 86400000 ||
    ![prices.acuHour, prices.storageGbMonth, prices.ioRequest].every(p => Number.isFinite(p) && p > 0) ||
    prices.gatewayRate !== 'UNCONFIRMED_NOT_ASSUMED_ZERO') throw Error('EXPRESS_C2_REVIEW_INPUT_REJECTED');
  const material = { schema: 'techlong/aurora-express-c2-review/v1', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 3600000).toISOString(), codeBindingSha256, facts, prices,
    request: { DBClusterIdentifier: C2_CLUSTER, Engine: 'aurora-postgresql', WithExpressConfiguration: true,
      DeletionProtection: false, ServerlessV2ScalingConfiguration: { MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 },
      Tags: [{ Key: 'ManagedBy', Value: 'techlong-sandbox' }, { Key: 'DatabaseProfile', Value: 'express_iam' },
        { Key: 'DeliveryTrack', Value: 'D002-C2-admin-facts' }, { Key: 'ProbeNonce', Value: nonce }] },
    limits: { directAwsWrites: 1, extraCreateDBInstanceCalls: 0, sqlSessions: 1, fixedReadonlySqlStatements: 4,
      iamWrites: 0, secretReads: 0, sqlWrites: 0, ecsCalls: 0, maxObservationMinutes: 20 },
    estimate: { currency: 'USD', targetActiveHours: 2, twoHoursMaxCapacityCompute: 2 * prices.acuHour,
      oneGbStorageTwoHours: prices.storageGbMonth * 2 / 730,
      halfAcu730HoursComputeOnly: prices.acuHour * 0.5 * 730,
      oneAcu730HoursComputeOnly: prices.acuHour * 730, spendingCap: false },
    preserved: ['speedfeast-postgres-prod', 'old Full failed Stack', 'public-key Secret', 'Neon business rows', 'F3c9 and all old slots'],
    cleanup: 'Separate fresh SHA after actual cluster/writer capture; max two delete calls; never automatic.',
    risks: C2_RISKS, runtimeEnabled: false, executionAuthorized: false };
  return Object.freeze({ ...material, manifestSha256: contract.digest(material) });
}
export type C2Review = ReturnType<typeof prepareC2Review>;
export function assertC2Approval(r: C2Review, approved: string, codeSha: string, now: number) {
  const { manifestSha256, ...body } = r;
  if (manifestSha256 !== contract.digest(body) || approved !== manifestSha256 || codeSha !== r.codeBindingSha256 ||
    now < Date.parse(r.preparedAt) || now >= Date.parse(r.expiresAt) || r.schema !== 'techlong/aurora-express-c2-review/v1')
    throw Error('EXPRESS_C2_FRESH_APPROVAL_REQUIRED');
  const expected = prepareC2Review(r.facts, r.prices, r.codeBindingSha256,
    r.request.Tags.find(t => t.Key === 'ProbeNonce')?.Value || '', Date.parse(r.preparedAt));
  if (contract.canonicalJson(expected) !== contract.canonicalJson(r)) throw Error('EXPRESS_C2_REVIEW_SCOPE_DRIFT');
}
