import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../../lib/deployments/execution/first-onboarding-run-once.ts";
import { sandboxFirstOpenPlannedSecretGrant, sandboxFirstOpenPlannedSecretVersionGuard } from "../../../lib/deployments/execution/first-onboarding-run-permissions.ts";
import { firstOpenExecutionWindow } from "../../../lib/deployments/execution/first-onboarding-window.ts";
import { firstOpenVersion } from "../../../lib/deployments/execution/first-onboarding-version.ts";
import type { FirstOnboardingExecutionApproval } from "../../../lib/deployments/execution/worker.ts";
import type { SupervisedCleanupReadinessPort } from "../../../lib/deployments/execution/single-tenant-workload-strategy.ts";
import type { SharedCellSecurityPreflightPort } from "../../../lib/deployments/execution/contracts.ts";
import type { ReleaseMetadataApi } from "../../../lib/deployments/releases/sampling.ts";
import type { FirstOpenInspectSeed } from "../first-open-inspect-input.ts";
import { firstOpenCleanupPermissionEvidenceMatches, type FirstOpenCleanupPermissionObservation } from "../first-open-express-cleanup-review.ts";
import { firstOpenExpressStorageProof } from "./express-encryption.mjs";
import { verifyFirstOnboardingApprovalBinding } from "../../../lib/deployments/execution/first-onboarding-approval.ts";
import { matchesFirstOpenSecondSlotEnvironment } from "../../../lib/deployments/execution/first-open-second-slot.ts";

const hex = /^[a-f0-9]{64}$/;
const source = `arn:aws:iam::${s.account}:user/techlong-sandbox-dev` as const;
const order = "workload_database_role_generation_secret_then_cell" as const;
const prefix = `arn:aws:elasticloadbalancing:${s.region}:${s.account}:`;
const outputs = ["ClusterName", "VpcId", "SubnetIds", "TaskSecurityGroupId", "HttpsListenerArn", "ControlListenerArn"] as const;
const fail = (code: string): never => { throw Error("FIRST_OPEN_READINESS_" + code); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const normalizedDns = (v: string) => v.replace(/\.$/, "").replace(/^dualstack\./, "");
const after = (signal: AbortSignal) => signal.throwIfAborted();
const recent = (at: number, now: number, ms: number) => Number.isSafeInteger(at) && at <= now && now - at < ms;
type Read = Pick<ReleaseMetadataApi, "read">;
type CellCoordinates = { businessDenyRuleArn: string; controlTrustStoreArn: string };
type Listener = { ListenerArn: string; LoadBalancerArn: string; Protocol: string; Port: number; SslPolicy?: string;
  Certificates?: { CertificateArn: string }[]; MutualAuthentication?: { Mode: string; TrustStoreArn?: string; IgnoreClientCertificateExpiry?: boolean };
  DefaultActions?: unknown[] };
type RuleCondition = { Field: string; Values?: string[]; RegexValues?: string[];
  HostHeaderConfig?: { Values?: string[]; RegexValues?: string[] }; PathPatternConfig?: { Values: string[] } };
type Rule = { RuleArn: string; Priority: string; IsDefault: boolean; Conditions?: RuleCondition[];
  Actions: { Type: string; FixedResponseConfig?: { StatusCode: string } }[]; Transforms?: unknown[] };
const routeActionTypes = new Set(["forward", "fixed-response", "redirect", "authenticate-cognito", "authenticate-oidc", "jwt-validation"]);
const routeConditionFields = new Set(["host-header", "http-header", "http-request-method", "path-pattern", "query-string", "source-ip"]);

function matchesHostPattern(pattern: string, hostname: string) {
  // ALB host matches are case-insensitive. Treat * as matching across labels;
  // this errs on the side of flagging a pre-existing wildcard as a conflict.
  let hostAt = 0, patternAt = 0, star = -1, starHostAt = 0;
  while (hostAt < hostname.length) {
    if (pattern[patternAt] === hostname[hostAt] || pattern[patternAt] === "?") { hostAt++; patternAt++; }
    else if (pattern[patternAt] === "*") { star = patternAt++; starHostAt = hostAt; }
    else if (star >= 0) { patternAt = star + 1; hostAt = ++starHostAt; }
    else return false;
  }
  while (pattern[patternAt] === "*") patternAt++;
  return patternAt === pattern.length;
}

function hostPatterns(condition: RuleCondition) {
  const config = condition.HostHeaderConfig;
  if ((config !== undefined && (!config || typeof config !== "object" || Array.isArray(config))) ||
    [condition.RegexValues, config?.RegexValues].some(values => values !== undefined && (!Array.isArray(values) || values.length !== 0))) {
    return fail("CELL_ROUTE_HOST_UNPROVED");
  }
  const parsed = [condition.Values, config?.Values].filter(values => values !== undefined).map(values => {
    if (!Array.isArray(values) || values.length === 0 || values.some(v => typeof v !== "string" || !/^[a-z0-9*?.-]{1,128}$/i.test(v))) {
      return fail("CELL_ROUTE_RULES");
    }
    return values.map(v => v.toLowerCase().replace(/\.$/, "")).sort();
  });
  if (parsed.length === 0 || (parsed.length === 2 && !same(parsed[0], parsed[1]))) return fail("CELL_ROUTE_RULES");
  return parsed[0];
}

async function sampleSecondSlotListener(input: { read: Read; signal: AbortSignal; listenerArn: string;
  hostname: string; priorities: number[]; sharedDeny?: Rule }) {
  const { read, signal, listenerArn, hostname, priorities, sharedDeny } = input;
  after(signal);
  const result = await read.read<{ Rules: Rule[]; NextMarker?: string }>("elbv2", "describe-rules", { ListenerArn: listenerArn });
  after(signal);
  if (result?.NextMarker !== undefined || !Array.isArray(result?.Rules) || !result.Rules.length) return fail("CELL_ROUTE_RULES");
  const arns = new Set<string>(), observedPriorities = new Set<number>();
  const rulePrefix = listenerArn.replace(":listener/", ":listener-rule/") + "/";
  let defaults = 0, shared = false;
  for (const r of result.Rules) {
    if (!r || typeof r.RuleArn !== "string" || !r.RuleArn.startsWith(rulePrefix) ||
      !/^[a-f0-9]+$/.test(r.RuleArn.slice(rulePrefix.length)) || arns.has(r.RuleArn) || typeof r.IsDefault !== "boolean" ||
      !Array.isArray(r.Actions) || !r.Actions.length || r.Actions.some(a => !a || !routeActionTypes.has(a.Type)) ||
      (r.Transforms !== undefined && !Array.isArray(r.Transforms))) return fail("CELL_ROUTE_RULES");
    arns.add(r.RuleArn);
    if (r.IsDefault) {
      if (++defaults !== 1 || r.Priority !== "default" ||
        (r.Conditions !== undefined && (!Array.isArray(r.Conditions) || r.Conditions.length !== 0)) || r.Transforms?.length ||
        r.Actions.length !== 1 || r.Actions[0].Type !== "fixed-response" || r.Actions[0].FixedResponseConfig?.StatusCode !== "404") {
        return fail("CELL_ROUTE_DEFAULT_DENY");
      }
      continue;
    }
    if (typeof r.Priority !== "string" || !/^[1-9][0-9]{0,4}$/.test(r.Priority)) return fail("CELL_ROUTE_RULES");
    const priority = Number(r.Priority);
    if (priority > 50_000 || observedPriorities.has(priority) || !Array.isArray(r.Conditions) || !r.Conditions.length ||
      r.Conditions.some(c => !c || !routeConditionFields.has(c.Field))) return fail("CELL_ROUTE_RULES");
    observedPriorities.add(priority);
    if (priorities.includes(priority)) return fail("CELL_ROUTE_PRIORITY");
    // The exact Cell-wide /api/saas denial is already independently bound.
    // It is the only accepted non-default rule that need not carry a host.
    if (sharedDeny && r.RuleArn === sharedDeny.RuleArn) {
      if (!same(r, sharedDeny)) return fail("CELL_ROUTE_SHARED_DENY");
      shared = true;
      continue;
    }
    const hosts = r.Conditions.filter(c => c.Field === "host-header");
    if (hosts.length !== 1) return fail("CELL_ROUTE_HOST_UNPROVED");
    if (hostPatterns(hosts[0]).some(pattern => matchesHostPattern(pattern, hostname))) return fail("CELL_ROUTE_HOST_OCCUPIED");
  }
  if (defaults !== 1 || (sharedDeny && !shared)) return fail("CELL_ROUTE_RULES");
  return { listenerArn, vacantPriorities: priorities,
    observedRuleSetSha256: await sha256Hex([...result.Rules].sort((a, b) => a.RuleArn.localeCompare(b.RuleArn))) };
}

/** Sample only the restored originals. The expectation is prepared by an
 * independent reader, never learned from these writer-side observations. */
export async function sampleFirstOpenRestoredCell(input: { approval: FirstOnboardingExecutionApproval;
  seed: FirstOpenInspectSeed; exact: CellCoordinates; read: Read; signal: AbortSignal }) {
  const { approval, seed, read, signal } = input, target = approval.express?.target;
  const b = seed.binding.tenantStackParameters, httpsArn = b.HttpsListenerArn, controlArn = b.ControlListenerArn;
  const secondSlot = approval.express?.secondSlot;
  if (secondSlot !== undefined && (!matchesFirstOpenSecondSlotEnvironment(secondSlot, seed.environment) || approval.hostname !== s.hostname)) {
    return fail("CELL_ROUTE_APPROVAL");
  }
  const listener = (v: string) => typeof v === "string" && v.startsWith(prefix + "listener/app/") &&
    /^[-a-zA-Z0-9]+\/[a-f0-9]+\/[a-f0-9]+$/.test(v.slice((prefix + "listener/app/").length));
  if (!target || approval.jobId !== s.jobId || target.clusterArn !== s.clusterArn ||
    seed.environment.id !== s.environmentId || seed.environment.expectedAccountId !== s.account || seed.environment.region !== s.region ||
    approval.express?.sampling.cellStackId !== s.cellStack || !listener(httpsArn) || !listener(controlArn) || httpsArn === controlArn) return fail("CELL_COORDINATES");
  const albArn = httpsArn.replace(":listener/", ":loadbalancer/").split("/").slice(0, -1).join("/");
  const { controlTrustStoreArn, businessDenyRuleArn } = input.exact;
  const rulePrefix = httpsArn.replace(":listener/", ":listener-rule/") + "/";
  if (!controlArn.startsWith(httpsArn.slice(0, httpsArn.lastIndexOf("/") + 1)) ||
    !businessDenyRuleArn.startsWith(rulePrefix) || !/^[a-f0-9]+$/.test(businessDenyRuleArn.slice(rulePrefix.length)) ||
    !controlTrustStoreArn.startsWith(prefix + "truststore/") ||
    !/^[a-zA-Z0-9._-]+\/[a-f0-9]+$/.test(controlTrustStoreArn.slice((prefix + "truststore/").length))) return fail("CELL_COORDINATES");
  after(signal);
  const cfn = await read.read<{ Stacks: { StackId: string; StackStatus: string; Outputs: { OutputKey: string; OutputValue: string }[] }[] }>(
    "cloudformation", "describe-stacks", { StackName: s.cellStack });
  after(signal);
  const stack = cfn.Stacks?.[0];
  if (cfn.Stacks?.length !== 1 || stack.StackId !== s.cellStack || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus) ||
    outputs.some(k => stack.Outputs?.filter(x => x.OutputKey === k && x.OutputValue === b[k]).length !== 1 ||
      stack.Outputs?.filter(x => x.OutputKey === k).length !== 1)) return fail("CELL_OUTPUTS");
  const l = await read.read<{ Listeners: Listener[]; NextMarker?: string }>("elbv2", "describe-listeners", { ListenerArns: [httpsArn, controlArn] });
  after(signal);
  const https = l.Listeners?.find(x => x.ListenerArn === httpsArn), control = l.Listeners?.find(x => x.ListenerArn === controlArn);
  const trust = control?.MutualAuthentication?.TrustStoreArn;
  if (l.NextMarker || l.Listeners?.length !== 2 || !https || !control || https.Port !== 443 || control.Port !== 8443 ||
    [https, control].some(x => x.Protocol !== "HTTPS" || x.LoadBalancerArn !== albArn || !x.SslPolicy ||
      x.Certificates?.length !== 1 || !x.Certificates[0].CertificateArn) ||
    ![undefined, "off"].includes(https.MutualAuthentication?.Mode) ||
    control.MutualAuthentication?.Mode !== "verify" || control.MutualAuthentication.IgnoreClientCertificateExpiry === true ||
    trust !== controlTrustStoreArn) return fail("CELL_LISTENERS");
  const rules = await read.read<{ Rules: Rule[]; NextMarker?: string }>(
    "elbv2", "describe-rules", { RuleArns: [businessDenyRuleArn] });
  after(signal);
  const deny = rules.Rules?.[0];
  if (rules.NextMarker || rules.Rules?.length !== 1 || deny.RuleArn !== businessDenyRuleArn || deny.Priority !== "1" || deny.IsDefault !== false ||
    deny.Conditions?.length !== 1 || deny.Conditions[0].Field !== "path-pattern" ||
    !same(deny.Conditions[0].PathPatternConfig?.Values?.slice().sort(), ["/api/saas", "/api/saas/*"]) ||
    deny.Actions?.length !== 1 || deny.Actions[0].Type !== "fixed-response" || deny.Actions[0].FixedResponseConfig?.StatusCode !== "404") {
    return fail("CELL_BUSINESS_DENY");
  }
  const trustView = await read.read<{ TrustStores: { TrustStoreArn: string; Status: string }[]; NextMarker?: string }>(
    "elbv2", "describe-trust-stores", { TrustStoreArns: [controlTrustStoreArn] });
  after(signal);
  const trustStore = trustView.TrustStores?.[0];
  if (trustView.NextMarker || trustView.TrustStores?.length !== 1 || trustStore.TrustStoreArn !== controlTrustStoreArn ||
    trustStore.Status !== "ACTIVE") return fail("CELL_TRUST_STORE");
  const lb = await read.read<{ LoadBalancers: { LoadBalancerArn: string; DNSName: string; VpcId: string; Scheme: string;
    Type: string; CanonicalHostedZoneId: string; State: { Code: string }; SecurityGroups: string[];
    AvailabilityZones: { SubnetId: string }[] }[]; NextMarker?: string }>("elbv2", "describe-load-balancers", { LoadBalancerArns: [albArn] });
  after(signal);
  const alb = lb.LoadBalancers?.[0];
  if (lb.NextMarker || lb.LoadBalancers?.length !== 1 || alb.LoadBalancerArn !== albArn || alb.VpcId !== b.VpcId ||
    alb.Scheme !== "internet-facing" || alb.Type !== "application" || alb.State?.Code !== "active" ||
    typeof alb.DNSName !== "string" || normalizedDns(alb.DNSName) !== normalizedDns(approval.dnsTarget) ||
    !/^Z[A-Z0-9]+$/.test(alb.CanonicalHostedZoneId) || !alb.SecurityGroups?.length || !alb.AvailabilityZones?.length) return fail("CELL_ALB");
  const r = await read.read<{ DBClusters: { DBClusterArn: string; DbClusterResourceId: string; Endpoint: string; Port: number;
    Engine: string; EngineVersion: string; Status: string; IAMDatabaseAuthenticationEnabled: boolean;
    StorageEncrypted?: boolean; StorageEncryptionType?: string;
    InternetAccessGatewayEnabled?: boolean; VPCNetworkingEnabled?: boolean;
    DBClusterMembers: { DBInstanceIdentifier: string; IsClusterWriter: boolean }[]; VpcSecurityGroups?: { VpcSecurityGroupId: string }[] }[]; Marker?: string }>(
    "rds", "describe-db-clusters", { DBClusterIdentifier: s.clusterArn.split(":").at(-1) });
  after(signal);
  const db = r.DBClusters?.[0], writers = db?.DBClusterMembers?.filter(x => x.IsClusterWriter === true);
  if (r.Marker || r.DBClusters?.length !== 1 || db.DBClusterArn !== s.clusterArn || db.DbClusterResourceId !== s.clusterId ||
    db.Endpoint !== target.endpoint || db.Port !== 5432 || db.Engine !== "aurora-postgresql" ||
    db.EngineVersion !== target.observedEngineVersion || db.Status !== "available" || db.IAMDatabaseAuthenticationEnabled !== true ||
    writers?.length !== 1 || !writers[0].DBInstanceIdentifier) return fail("EXPRESS_IDENTITY");
  // This fixed cluster uses Express Internet Access Gateway, not VPC networking.
  if (db.InternetAccessGatewayEnabled !== true || db.VPCNetworkingEnabled !== false ||
    !Array.isArray(db.VpcSecurityGroups) || db.VpcSecurityGroups.length !== 0) return fail("EXPRESS_NETWORK_MODE");
  const storageEncryptionType = firstOpenExpressStorageProof(db);
  if (!storageEncryptionType) return fail("EXPRESS_STORAGE_ENCRYPTION");
  const secondSlotRoutes = secondSlot === undefined ? undefined : { hostname: s.hostname,
    business: await sampleSecondSlotListener({ read, signal, listenerArn: httpsArn, hostname: s.hostname,
      priorities: [secondSlot.listenerPriority, secondSlot.listenerPriority + 1], sharedDeny: deny }),
    control: await sampleSecondSlotListener({ read, signal, listenerArn: controlArn, hostname: s.hostname,
      priorities: [secondSlot.listenerPriority] }) };
  return {
    cellStackId: s.cellStack, outputs: Object.fromEntries(outputs.map(k => [k, b[k]])),
    businessDenyRule: deny, trustStore,
    listeners: [https, control].map(x => ({ arn: x.ListenerArn, port: x.Port, certificate: x.Certificates![0].CertificateArn,
      tlsPolicy: x.SslPolicy, defaultActions: x.DefaultActions, mutual: x.MutualAuthentication ?? { Mode: "off" } })),
    alb: { arn: albArn, dns: normalizedDns(alb.DNSName), zoneId: alb.CanonicalHostedZoneId,
      securityGroups: [...alb.SecurityGroups].sort(), subnets: alb.AvailabilityZones.map(x => x.SubnetId).sort() },
    express: { arn: db.DBClusterArn, resourceId: db.DbClusterResourceId, endpoint: db.Endpoint, version: db.EngineVersion,
      writer: writers[0].DBInstanceIdentifier, storageEncryptionType, internetAccessGatewayEnabled: true as const,
      vpcNetworkingEnabled: false as const, securityGroups: [] as string[] },
    ...(secondSlotRoutes === undefined ? {} : { secondSlotRoutes }),
  };
}

type Grant = ReturnType<typeof sandboxFirstOpenPlannedSecretGrant>;
type Independent = { sourceArn: typeof source; checkedAt: number; independentEvidenceSha256: string };
type GrantDecision = "allowed" | "denied" | "unknown";
/** Sanitized independent authorization projection for the planned g1 scope.
 * Before creation the actual ARN suffix is unknown. These results must cover
 * the installed authorization, not just one simulated suffix or a policy draft.
 * An omitted VersionId includes requests that select by stage (e.g. AWSCURRENT). */
type EffectiveG1GrantObservation = {
  roleArn: string;
  action: string;
  secretName: string;
  resourceArnPattern: string;
  versionId: string;
  addedPolicyScope: "planned-g1-only";
  versionGuardSha256: string;
  decisions: {
    exactRequest: GrantDecision;
    otherVersion: GrantDecision;
    omittedVersion: GrantDecision;
  };
};
export interface FirstOpenIndependentReadiness {
  restoredCellSha256: string;
  restoredCellCoordinates: CellCoordinates;
  cleanupReview: { jobId: string; scopeSha256: string; workloadExpiresAt: number; responsibleCallerArn: typeof source; order: typeof order };
  cleanupPermissions: Independent & { jobId: string; scopeSha256: string; exactPermissionsVerified: true;
    observation: FirstOpenCleanupPermissionObservation };
  grant: Independent & { jobId: string; approvalSha256: string; roleArn: string; grantSha256: string;
    observation: EffectiveG1GrantObservation; independentlyVerifiedEffective: boolean };
  grantReceiptSha256: string;
}

export async function bindFirstOpenRunOnceReadiness(input: { approval: FirstOnboardingExecutionApproval; approvalSha256: string;
  formalApprovalSha256?: string; seed: FirstOpenInspectSeed; versionId: string; evidence: FirstOpenIndependentReadiness; read: Read; now?: () => number }) {
  const { approval, approvalSha256, formalApprovalSha256, seed, versionId } = input, now = input.now ?? Date.now;
  await verifyFirstOnboardingApprovalBinding(approval, approvalSha256, formalApprovalSha256).catch(() => fail("INDEPENDENT_EVIDENCE"));
  const e = structuredClone(input.evidence);
  const window = firstOpenExecutionWindow(approval.jobId, approval.writeBefore, approval.controlledWindow);
  const version = firstOpenVersion(approval.taskRelease);
  const { appInstanceId, deploymentId, environmentId, planHash, configurationHash, artifactRef, releaseId } = seed.review.payload.scope;
  const scope = { appInstanceId, deploymentId, environmentId, planHash, configurationHash, artifactRef };
  const scopeSha256 = await sha256Hex(scope);
  const independent = (r: Independent) => r.sourceArn === source && hex.test(r.independentEvidenceSha256) && recent(r.checkedAt, now(), 5 * 3600_000);
  const plannedGrant = sandboxFirstOpenPlannedSecretGrant(versionId);
  if (typeof plannedGrant.Resource !== "string") return fail("GRANT_SCOPE");
  const grantSha256 = await sha256Hex(plannedGrant);
  const expectedObservation: EffectiveG1GrantObservation = {
    roleArn: s.executionRole, action: plannedGrant.Action, secretName: s.secretName,
    resourceArnPattern: plannedGrant.Resource, versionId,
    addedPolicyScope: "planned-g1-only", versionGuardSha256: await sha256Hex(sandboxFirstOpenPlannedSecretVersionGuard(versionId)),
    decisions: { exactRequest: "allowed", otherVersion: "denied", omittedVersion: "denied" },
  };
  const effective = e.grant.independentlyVerifiedEffective;
  if (!window || seed.review.jobId !== s.jobId || approval.reviewSha256 !== seed.review.reviewSha256 ||
    appInstanceId !== s.instanceId || deploymentId !== s.deploymentId || environmentId !== s.environmentId ||
    artifactRef !== version.artifactRef ||
    (approval.taskRelease && (releaseId !== version.releaseId || !same(seed.release, approval.taskRelease))) ||
    !hex.test(e.restoredCellSha256) || !e.restoredCellCoordinates ||
    ![e.cleanupPermissions, e.grant].every(independent) ||
    [e.cleanupReview.jobId, e.cleanupPermissions.jobId, e.grant.jobId].some(v => v !== s.jobId) ||
    e.cleanupReview.scopeSha256 !== scopeSha256 || e.cleanupReview.workloadExpiresAt !== window.workloadExpiresAt ||
    e.cleanupReview.responsibleCallerArn !== source || e.cleanupReview.order !== order || await sha256Hex(e.cleanupReview) !== window.cleanupReviewSha256 ||
    e.cleanupPermissions.scopeSha256 !== scopeSha256 || e.cleanupPermissions.exactPermissionsVerified !== true ||
    !firstOpenCleanupPermissionEvidenceMatches(e.cleanupPermissions.observation) ||
    await sha256Hex(e.cleanupPermissions) !== window.cleanupPermissionsEvidenceSha256 ||
    e.grant.approvalSha256 !== approvalSha256 || e.grant.roleArn !== s.executionRole || e.grant.grantSha256 !== grantSha256 ||
    effective !== true || !same(e.grant.observation, expectedObservation) ||
    await sha256Hex(e.grant) !== e.grantReceiptSha256) return fail("INDEPENDENT_EVIDENCE");
  let samples = 0, checkedAt = -1, stopped = false;
  const measure = async (signal: AbortSignal, force = false) => {
    after(signal);
    if (stopped || now() >= window.writeBefore || !independent(e.cleanupPermissions) || !independent(e.grant)) return fail("WINDOW_OR_READ_STOPPED");
    if (force || !recent(checkedAt, now(), 25_000)) {
      if (++samples > 4) return fail("READ_BUDGET");
      const beganAt = now();
      try {
        const view = await sampleFirstOpenRestoredCell({ approval, seed, exact: e.restoredCellCoordinates, read: input.read, signal });
        if (await sha256Hex(view) !== e.restoredCellSha256 || !recent(beganAt, now(), 25_000) ||
          now() >= window.writeBefore) return fail("CELL_DRIFT");
      } catch (error) { stopped = true; throw error; }
      checkedAt = beganAt; // age measures from the start, not a re-stamped receipt
    }
    after(signal);
    return checkedAt;
  };
  const cleanup = async (x: { scope: typeof scope; signal: AbortSignal }) => {
    if (!same(x.scope, scope)) return fail("CLEANUP_SCOPE");
    const verifiedAt = await measure(x.signal, true);
    return { scopeSha256, reviewSha256: window.cleanupReviewSha256, permissionsEvidenceSha256: window.cleanupPermissionsEvidenceSha256,
      cellStackId: s.cellStack, verifiedAt, expiresAt: window.workloadExpiresAt, responsibleCallerArn: source, order };
  };
  const cleanupReadiness: SupervisedCleanupReadinessPort = {
    async verify(x) {
      if (x.context.job.id !== s.jobId || !same(x.context.binding, seed.binding)) return fail("CLEANUP_CONTEXT");
      return cleanup(x);
    },
    async verifyBeforeClaim(x) {
      if (x.jobId !== s.jobId || x.approvalSha256 !== approvalSha256 || !same(x.window, window) || now() >= window.claimBefore) return fail("CLEANUP_SCOPE");
      return cleanup(x);
    },
  };
  const cellPreflight: SharedCellSecurityPreflightPort = { async verify(x) {
    if (!same(x.binding, seed.binding) || !same(x.environment, seed.environment)) return fail("CELL_BINDING");
    await measure(x.signal);
    return { verified: true, evidenceHash: e.restoredCellSha256 };
  } };
  return {
    cellPreflight, cleanupReadiness, runtimeGrantEvidenceSha256: e.grantReceiptSha256,
    async verifyRuntimeGrant(x: { approvalSha256: string; roleArn: string; grant: Grant }, signal: AbortSignal) {
      after(signal);
      if (x.approvalSha256 !== approvalSha256 || x.roleArn !== s.executionRole || !independent(e.grant) ||
        await sha256Hex(x.grant) !== grantSha256 || now() >= window.claimBefore) return fail("GRANT_SCOPE");
      return { approvalSha256, roleArn: s.executionRole, grantSha256, evidenceSha256: e.grantReceiptSha256,
        independentlyVerifiedEffective: effective, observedAt: e.grant.checkedAt };
    },
  };
}
