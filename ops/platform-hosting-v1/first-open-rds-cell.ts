import type { DeploymentExecutionBinding, SharedCellSecurityPreflightPort } from "../../lib/deployments/execution/contracts.ts";
import { FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT, isFirstOpenRdsPrivateSubnetIds } from "../../lib/deployments/execution/first-open-tenant-network.ts";
import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import type { SingleDeploymentClaimScope } from "../../lib/deployments/execution/single-deployment-scope.ts";
import type { SupervisedCleanupReadinessPort } from "../../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { createFirstOpenInspectorSdk } from "./first-open-inspector-sdk.ts";
import type { FirstOpenRdsInspectorMaterial } from "./first-open-rds-inspector.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region } from "./first-open-task-identity.ts";

type Reader = ReturnType<typeof createFirstOpenInspectorSdk>["read"];
type Tenant = Omit<FirstOpenRdsInspectorMaterial["tenant"], "databaseUrl">;
export type FirstOpenCellBinding = {
  templateSha256: string;
  parametersSha256: string;
  privateSubnetIds: readonly string[];
  trustStoreArn: string;
  cleanup: { scopeSha256: string; reviewSha256: string; permissionsEvidenceSha256: string; observedAt: number;
    validUntil: number; expiresAt: number; responsibleCallerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" };
};
const sha = /^[a-f0-9]{64}$/;
const cleanupCaller = `arn:aws:iam::${account}:user/techlong-sandbox-dev` as const;
const healthyStacks = ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"];
const trustedRole = `arn:aws:iam::${account}:role/TechlongSandboxProvisionerRole`;
const executionRole = `arn:aws:iam::${account}:role/TechlongSandboxCloudFormationExecutionRole`;
const splitSubnetIds = (value: string) => value.split(",").map(id => id.trim());

export async function bindFirstOpenRdsCell(input: {
  pin: FirstOpenCellBinding; scope: SingleDeploymentClaimScope; cellStackId: string; ingress: FirstOpenRdsInspectorMaterial["ingress"];
  tenant: Tenant; cellOutputParameters: Record<string, string>; writeBefore: number; now: () => number; read: Reader;
}) {
  const { pin, scope, cellStackId, ingress, tenant, cellOutputParameters, writeBefore, now, read } = input;
  const { cleanup } = pin;
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (now() >= writeBefore || now() < cleanup.observedAt || now() >= cleanup.validUntil || cleanup.expiresAt <= now() + 5 * 60_000) {
      throw Error("ECS_FIRST_OPEN_CELL_EVIDENCE_WINDOW");
    }
  };
  if (!isFirstOpenRdsPrivateSubnetIds(pin.privateSubnetIds) || cellOutputParameters.SubnetIds !== FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT ||
    ![pin.templateSha256, pin.parametersSha256, cleanup.reviewSha256, cleanup.permissionsEvidenceSha256].every(v => sha.test(v)) ||
    cleanup.scopeSha256 !== await sha256Hex(scope) || cleanup.responsibleCallerArn !== cleanupCaller ||
    ![cleanup.observedAt, cleanup.validUntil, cleanup.expiresAt].every(Number.isSafeInteger) || cleanup.observedAt > now() ||
    cleanup.validUntil < writeBefore || cleanup.validUntil > cleanup.observedAt + 5 * 60 * 60_000 || cleanup.expiresAt <= writeBefore + 5 * 60_000 ||
    !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(cellStackId) ||
    !/^arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore\/[A-Za-z0-9-]+\/[a-f0-9]{16}$/.test(pin.trustStoreArn)) {
    throw Error("ECS_FIRST_OPEN_CELL_EVIDENCE_SCOPE");
  }
  const privateSubnetIds = [...pin.privateSubnetIds];
  const privateSubnetCsv = privateSubnetIds.join(",");

  const checkBinding = async (binding: DeploymentExecutionBinding | null) => {
    if (binding?.status !== "active" || binding.environmentId !== scope.environmentId || binding.workerRoleArn !== trustedRole ||
      binding.cloudFormationRoleArn !== executionRole || await sha256Hex(binding.tenantStackParameters) !== pin.parametersSha256) {
      throw Error("ECS_FIRST_OPEN_CELL_BINDING_CHANGED");
    }
    const p = binding.tenantStackParameters;
    const legacySubnetIds = typeof p.SubnetIds === "string" ? splitSubnetIds(p.SubnetIds) : [];
    if (p.VpcId !== ingress.vpcId || p.HttpsListenerArn !== ingress.httpsListenerArn || p.ControlListenerArn !== ingress.controlListenerArn ||
      ![p.ClusterName, `arn:aws:ecs:${region}:${account}:cluster/${p.ClusterName}`].includes(ingress.clusterArn) ||
      legacySubnetIds.length < 2 || legacySubnetIds.length > 6 || new Set(legacySubnetIds).size !== legacySubnetIds.length ||
      legacySubnetIds.some(id => !/^subnet-[a-f0-9]{8,17}$/.test(id) || privateSubnetIds.includes(id))) {
      throw Error("ECS_FIRST_OPEN_CELL_BINDING_CHANGED");
    }
  };
  async function observeStack(parameters: DeploymentExecutionBinding["tenantStackParameters"], signal: AbortSignal) {
    check(signal);
    const result = await read("cloudformation", "describe-stacks", { StackName: cellStackId }, signal) as {
      Stacks?: { StackId?: string; StackStatus?: string; Outputs?: { OutputKey?: string; OutputValue?: string }[] }[];
    };
    const stack = result.Stacks?.[0];
    if (result.Stacks?.length !== 1 || stack?.StackId !== cellStackId || !healthyStacks.includes(stack.StackStatus ?? "")) {
      throw Error("ECS_FIRST_OPEN_CELL_STACK_UNVERIFIED");
    }
    const outputs = stack.Outputs ?? [];
    const out = (name: string) => outputs.filter(x => x.OutputKey === name).map(x => x.OutputValue);
    for (const [name, value] of [["VpcId", ingress.vpcId], ["HttpsListenerArn", ingress.httpsListenerArn], ["ControlListenerArn", ingress.controlListenerArn]]) {
      const observed = out(name);
      if (observed.length !== 1 || observed[0] !== value) throw Error("ECS_FIRST_OPEN_CELL_OUTPUT_UNVERIFIED");
    }
    const cluster = out("ClusterName");
    if (cluster.length !== 1 || ![cluster[0], `arn:aws:ecs:${region}:${account}:cluster/${cluster[0]}`].includes(ingress.clusterArn)) {
      throw Error("ECS_FIRST_OPEN_CELL_OUTPUT_UNVERIFIED");
    }
    const legacySubnets = out("SubnetIds");
    const privateSubnets = out(FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT);
    if (legacySubnets.length !== 1 || typeof legacySubnets[0] !== "string" || typeof parameters.SubnetIds !== "string" ||
      splitSubnetIds(legacySubnets[0]).sort().join(",") !== splitSubnetIds(parameters.SubnetIds).sort().join(",") ||
      privateSubnets.length !== 1 || privateSubnets[0] !== privateSubnetCsv) {
      throw Error("ECS_FIRST_OPEN_CELL_OUTPUT_UNVERIFIED");
    }
    for (const name of Object.keys(cellOutputParameters)) {
      if (name === "SubnetIds") continue;
      const values = out(name), expected = parameters[name];
      if (values.length !== 1 || !values[0] || !expected || values[0] !== expected) {
        throw Error("ECS_FIRST_OPEN_CELL_OUTPUT_UNVERIFIED");
      }
    }
    const { TemplateBody } = await read("cloudformation", "get-template", { StackName: cellStackId, TemplateStage: "Original" }, signal) as { TemplateBody?: unknown };
    const document = typeof TemplateBody === "string" ? JSON.parse(TemplateBody) : TemplateBody;
    if (!document || typeof document !== "object" || await sha256Hex(document) !== pin.templateSha256) throw Error("ECS_FIRST_OPEN_CELL_ORIGINAL_CHANGED");
    check(signal);
  }
  async function observeSecurity(binding: DeploymentExecutionBinding, signal: AbortSignal) {
    await observeStack(binding.tenantStackParameters, signal);
    const [alb, listeners, db] = await Promise.all([
      read("elbv2", "describe-load-balancers", { LoadBalancerArns: [ingress.albArn] }, signal),
      read("elbv2", "describe-listeners", { ListenerArns: [ingress.httpsListenerArn, ingress.controlListenerArn] }, signal),
      read("rds", "describe-db-instances", { DBInstanceIdentifier: tenant.dbInstanceIdentifier }, signal),
    ]) as [{ LoadBalancers?: { LoadBalancerArn?: string; Scheme?: string; DNSName?: string; VpcId?: string }[] },
      { Listeners?: { ListenerArn?: string; LoadBalancerArn?: string; Port?: number; Protocol?: string;
        MutualAuthentication?: { Mode?: string; TrustStoreArn?: string; TrustStoreAssociationStatus?: string } }[] },
      { Marker?: string; DBInstances?: { DBInstanceArn?: string; DbiResourceId?: string; Engine?: string; EngineVersion?: string;
        DBInstanceStatus?: string; PubliclyAccessible?: boolean; StorageEncrypted?: boolean; DeletionProtection?: boolean;
        Endpoint?: { Address?: string; Port?: number }; DBSubnetGroup?: { VpcId?: string } }[] }];
    const loadBalancer = alb.LoadBalancers?.[0];
    const https = listeners.Listeners?.find(l => l.ListenerArn === ingress.httpsListenerArn);
    const control = listeners.Listeners?.find(l => l.ListenerArn === ingress.controlListenerArn);
    const database = db.DBInstances?.[0];
    if (alb.LoadBalancers?.length !== 1 || loadBalancer?.LoadBalancerArn !== ingress.albArn || loadBalancer.Scheme !== "internal" ||
      loadBalancer.DNSName !== ingress.dnsName || loadBalancer.VpcId !== ingress.vpcId || listeners.Listeners?.length !== 2 ||
      ![https, control].every(l => l?.Protocol === "HTTPS" && l.LoadBalancerArn === ingress.albArn) || https?.Port !== 443 ||
      control?.Port !== 8443 || control.MutualAuthentication?.Mode !== "verify" || control.MutualAuthentication.TrustStoreArn !== pin.trustStoreArn ||
      control.MutualAuthentication.TrustStoreAssociationStatus !== "active" || db.Marker || db.DBInstances?.length !== 1 ||
      database?.DBInstanceArn !== `arn:aws:rds:${region}:${account}:db:${tenant.dbInstanceIdentifier}` ||
      database.DbiResourceId !== tenant.dbiResourceId || database.Engine !== "postgres" || database.EngineVersion !== "16.14" ||
      database.DBInstanceStatus !== "available" || database.PubliclyAccessible !== false || database.StorageEncrypted !== true ||
      database.DeletionProtection !== true || database.DBSubnetGroup?.VpcId !== ingress.vpcId || database.Endpoint?.Address !== tenant.host ||
      database.Endpoint.Port !== 5432) throw Error("ECS_FIRST_OPEN_CELL_SECURITY_UNVERIFIED");
    check(signal);
    return sha256Hex({ cellStackId, templateSha256: pin.templateSha256, parametersSha256: pin.parametersSha256,
      privateSubnetIds, alb: loadBalancer, https, control, database });
  }
  const sharedCellSecurityPreflight: SharedCellSecurityPreflightPort = {
    async verify({ environment, binding, signal }) {
      if (environment.id !== scope.environmentId || environment.expectedAccountId !== account || environment.region !== region ||
        environment.applyEnabled || environment.cellKey !== "cell-sandbox-1") throw Error("ECS_FIRST_OPEN_CELL_EVIDENCE_SCOPE");
      await checkBinding(binding);
      return { verified: true, evidenceHash: await observeSecurity(binding, signal) };
    },
  };
  const cleanupReadiness: SupervisedCleanupReadinessPort = {
    async verify({ scope: actual, context, signal }) {
      if (await sha256Hex(actual) !== cleanup.scopeSha256 || context.deployment.createdAt + context.environment.policy.ttlSeconds * 1000 !== cleanup.expiresAt) {
        throw Error("ECS_FIRST_OPEN_CLEANUP_EVIDENCE_SCOPE");
      }
      await checkBinding(context.binding);
      await observeStack(context.binding!.tenantStackParameters, signal);
      return { scopeSha256: cleanup.scopeSha256, reviewSha256: cleanup.reviewSha256,
        permissionsEvidenceSha256: cleanup.permissionsEvidenceSha256, cellStackId, verifiedAt: now(), expiresAt: cleanup.expiresAt,
        responsibleCallerArn: cleanupCaller, order: "workload_database_role_generation_secret_then_cell" };
    },
  };
  return { sharedCellSecurityPreflight, cleanupReadiness, observeSecurity, checkBinding };
}
