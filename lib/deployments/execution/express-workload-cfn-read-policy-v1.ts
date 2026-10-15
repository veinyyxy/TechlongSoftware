import { canonicalJson, sha256Hex } from './hash.ts';

export const EXPRESS_CFN_READ_POLICY_V1 = Object.freeze({
  roleName: 'TechlongSandboxCloudFormationExecutionRole', roleId: 'AROAV3GNMXTZKHYBCRSOE',
  roleArn: 'arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole',
  policyArn: 'arn:aws:iam::402010193138:policy/TechlongSandboxCloudFormationExecutionBoundary',
  policyId: 'ANPAV3GNMXTZOQPIXOKJ4', beforeVersion: 'v7',
  slot: 'techlong-express-c5g-workload-cfn-read-policy-v1.permanent-slot.json',
});
type Statement = { Sid?: string; Effect: string; Action?: string | string[]; Resource?: string | string[]; [key: string]: unknown };
export type ExpressIamPolicyDocumentV1 = { Version: string; Statement: Statement[] };
export interface ExpressCfnReadInventoryV1 {
  observedAt: number;
  source: { Account?: string; Arn?: string; UserId?: string };
  role: { arn: string; id: string; trust: unknown; boundaryArn: string; inlineNames: string[]; attached: string[] };
  policy: { arn: string; id: string; defaultVersion: string; document: ExpressIamPolicyDocumentV1;
    versions: { id: string; isDefault: boolean }[]; boundaryConsumers: unknown; permissionConsumers: unknown };
}
const K = EXPRESS_CFN_READ_POLICY_V1, prefix = 'arn:aws:', region = 'ca-central-1', account = '402010193138';
const service = `${prefix}ecs:${region}:${account}:service/cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service`;
const deployments = `${prefix}ecs:${region}:${account}:service-deployment/cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service/*`;
const target = `${prefix}elasticloadbalancing:${region}:${account}:targetgroup/tenant-9c5ee9e64509dcad-target-g/*`;
const listenerPrefix = `${prefix}elasticloadbalancing:${region}:${account}:listener-rule/app/techlong-sandbox-cell-sandbox-1/77888e84c19e8b86/`;
const rules = [listenerPrefix + '469c2b642a33bfc1/*', listenerPrefix + 'bc69b195b69bc2d9/*'];
const log = `${prefix}logs:${region}:${account}:log-group:/saas/cell-sandbox-1/tenant-9c5ee9e64509dcad`;
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export function assertExpressCfnReadInventoryV1(f: ExpressCfnReadInventoryV1, now: number) {
  const consumers = { roles: [{ name: K.roleName, id: K.roleId }], users: [], groups: [] };
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(f?.observedAt) || now < f.observedAt || now - f.observedAt > 90000 ||
      f.source?.Account !== account || f.source.Arn !== `arn:aws:iam::${account}:user/techlong-sandbox-dev` || f.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' ||
      f.role?.arn !== K.roleArn || f.role.id !== K.roleId || f.role.boundaryArn !== K.policyArn || f.role.inlineNames.length !== 0 ||
      !same(f.role.attached, [K.policyArn]) || f.policy?.arn !== K.policyArn || f.policy.id !== K.policyId || f.policy.defaultVersion !== K.beforeVersion ||
      !same(f.policy.versions, [{ id: K.beforeVersion, isDefault: true }]) || !same(f.policy.boundaryConsumers, consumers) ||
      !same(f.policy.permissionConsumers, consumers)) fail('CFN_READ_EXACT_FRESH_INVENTORY_REQUIRED');
}
/** Append-only policy compiler. It preserves every old statement and adds no
 * mutation, stream write, PassRole, wildcard action or new principal. */
export async function compileExpressCfnReadPolicyV1(before: ExpressIamPolicyDocumentV1) {
  const old = structuredClone(before);
  if (old?.Version !== '2012-10-17' || !Array.isArray(old.Statement) || old.Statement.length < 1 ||
      Object.keys(old).sort().join(',') !== 'Statement,Version' || old.Statement.some(s => !s || typeof s !== 'object' || s.Sid?.startsWith('C5g'))) fail('CFN_READ_BASELINE_DOCUMENT_REJECTED');
  const allow = (Sid: string, Action: string[], Resource: string[]): Statement => ({ Sid, Effect: 'Allow', Action, Resource,
    Condition: { StringEquals: { 'aws:RequestedRegion': region } } });
  const additions = [
    allow('C5gExactServiceDeploymentsList', ['ecs:ListServiceDeployments'], [service]),
    allow('C5gExactServiceDeploymentsRead', ['ecs:DescribeServiceDeployments'], [service, deployments]),
    allow('C5gExactTargetGroupRead', ['elasticloadbalancing:DescribeTargetGroupAttributes', 'elasticloadbalancing:DescribeTargetHealth', 'elasticloadbalancing:DescribeTags'], [target]),
    allow('C5gExactListenerRulesTags', ['elasticloadbalancing:DescribeTags'], rules),
    // Both documented log-group ARN forms, never another group or stream-write action.
    allow('C5gExactLogPoliciesRead', ['logs:GetDataProtectionPolicy'], [log, log + ':*']),
    allow('C5gRegionalLogPoliciesInventory', ['logs:DescribeIndexPolicies', 'logs:DescribeResourcePolicies'], ['*']),
  ];
  const document = { ...old, Statement: [...old.Statement, ...additions] };
  if (canonicalJson(document).length > 6144) fail('CFN_READ_MANAGED_POLICY_SIZE_LIMIT');
  const checks = additions.map(s => ({ label: s.Sid!, actions: s.Action as string[], resources: s.Resource as string[] }));
  const body = { schema: 'techlong/express-cfn-read-policy-candidate/v1' as const, policyArn: K.policyArn,
    beforeDocumentSha256: await sha256Hex(old), afterDocumentSha256: await sha256Hex(document), document, additions,
    newUniqueActions: [...new Set(additions.flatMap(s => s.Action as string[]))].sort(), checks,
    deltaDocument: { Version: '2012-10-17', Statement: additions },
    request: { PolicyArn: K.policyArn, PolicyDocument: canonicalJson(document), SetAsDefault: true },
    preservesOldStatements: true, oldPolicyVersionDeleted: false, serviceBoundaryChanged: false,
    taskExecutionPolicyChanged: false, resourceMutationAuthorized: false, executionAuthorized: false };
  return freeze({ ...body, candidateSha256: await sha256Hex(body) });
}
type Candidate = Awaited<ReturnType<typeof compileExpressCfnReadPolicyV1>>;
export function expressCfnReadInventoryIdentityV1(f: ExpressCfnReadInventoryV1) {
  return { source: f.source, role: f.role, policy: f.policy };
}
export async function prepareExpressCfnReadPolicyReviewV1(input: { candidate: Candidate; facts: ExpressCfnReadInventoryV1;
  expectedTrust: unknown; baselineDocumentSha256: string; codeBindingSha256: string; providerEvidenceSha256: string; now: number }) {
  const { candidate, facts, now } = structuredClone(input);
  assertExpressCfnReadInventoryV1(facts, now);
  if (!same(facts.role.trust, input.expectedTrust) || !/^[a-f0-9]{64}$/.test(input.codeBindingSha256) || !/^[a-f0-9]{64}$/.test(input.providerEvidenceSha256) ||
      await sha256Hex(facts.policy.document) !== input.baselineDocumentSha256 || candidate.beforeDocumentSha256 !== input.baselineDocumentSha256 ||
      !same(await compileExpressCfnReadPolicyV1(facts.policy.document), candidate)) fail('CFN_READ_REVIEW_INPUT_REJECTED');
  const body = { schema: 'techlong/express-cfn-read-policy-review/v1' as const, preparedAt: now, expiresAt: now + 3600000,
    candidate, facts, expectedTrust: input.expectedTrust, baselineDocumentSha256: input.baselineDocumentSha256,
    codeBindingSha256: input.codeBindingSha256, providerEvidenceSha256: input.providerEvidenceSha256, slot: K.slot,
    newSimulatorCallsRequired: false, actualProviderAccessVerified: false,
    limits: { createPolicyVersion: 1, setAsDefaultInSameCall: true, deleteOldVersions: 0, otherIamWrites: 0,
      cloudFormationOrEcsDeployments: 0, sqlConnections: 0, privateOrSecretValueReads: 0, automaticRetries: 0 },
    risks: [
      'One new managed policy version becomes default immediately for the existing role where this same policy is both attached identity policy and permissions boundary. This is persistent new read permission, not a temporary grant; v7 is retained, no automatic revoke or rollback.',
      'New permissions include regional DescribeIndexPolicies and DescribeResourcePolicies on all CloudWatch Logs index/resource policies because these actions have no narrower resource scope. Existing broad historical permissions are preserved, not endorsed or widened by these additions.',
      'IAM updates are not CAS. Role IDs, consumer rosters, default v7, all versions, trust and full document are rechecked, but privileged concurrent changes after checks remain possible. Propagation is not guaranteed; simulations do not prove service-provider or log-stream access.',
      'A consumed permanent slot, failed/lost response or partial observation is inspect-only. No write retry, version deletion, rollback, completion, slot reset or second install is authorized. A new version may remain active even when the process fails.',
      'If CloudFormation manages the existing policy, this direct IAM document update can introduce drift; a later stack update can overwrite it. No stack/template reconciliation is performed or authorized here.',
      'This IAM-only step does not renew Cell tags, create workload/DNS/authority/job, read private material, initialize business data or prove ready. Existing resources continue billing; 50 USD per month is a target, not a hard cap.',
    ], runtimeEnabled: false, readyVerified: false };
  return freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
type Manifest = Awaited<ReturnType<typeof prepareExpressCfnReadPolicyReviewV1>>;
export async function assertExpressCfnReadPolicyApprovalV1(m: Manifest, sha: string, code: string, now: number) {
  const { manifestSha256, ...body } = m;
  if (manifestSha256 !== sha || await sha256Hex(body) !== sha || code !== m.codeBindingSha256 || !Number.isSafeInteger(now) ||
      now < m.preparedAt || now >= m.expiresAt || !same(await prepareExpressCfnReadPolicyReviewV1({ ...m, now: m.preparedAt }), m)) fail('CFN_READ_FRESH_EXACT_APPROVAL_REQUIRED');
}
