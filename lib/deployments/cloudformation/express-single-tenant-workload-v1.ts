import type { AwsSandboxTenantStackInput } from './tenant-stack.ts';
import { renderSupervisedTenantWorkloadBase } from './single-tenant-acceptance-workload.ts';
import { buildDatabaseTaskConfigurationV2, parseDatabaseBindingV2, type DatabaseBindingV2 } from '../execution/aurora-database-v2.ts';
import { buildTenantReadinessConfigurationV1 } from '../execution/tenant-readiness-configuration-v1.ts';
import { canonicalJson, sha256Hex } from '../execution/hash.ts';

/** Independent Express render-only entry. Does not bypass the old fixed-image
 * worker/queue, mint ApplyReady or configure/create an AWS resource. */
export async function renderExpressSingleTenantWorkloadV1(input: {
  workload: AwsSandboxTenantStackInput; binding: DatabaseBindingV2;
  databaseOid: string; roleOid: string; configurationHash: string;
}) {
  const w = input.workload, b = parseDatabaseBindingV2(input.binding), cost = w.plan.resources.tenant.costTags;
  const stable = await sha256Hex({ appInstanceId: cost.AppInstanceId, workspaceId: cost.WorkspaceId,
    productId: cost.ProductId, environmentId: w.environment.id, cellKey: w.environment.cellKey });
  if (b.profile !== 'express_iam' || b.stableIdentity !== stable || b.resourceGeneration !== w.resourceGeneration ||
      b.runtimeSecret.arn !== w.runtimeSecretRef || b.tenantDatabase !== w.plan.resources.tenant.database.databaseName ||
      b.tenantUsername !== w.plan.resources.tenant.database.roleName ||
      w.externalOperation.marker !== `tl_epoch_${stable.slice(0, 24)}_g${w.resourceGeneration}_e${w.externalOperation.epoch}` ||
      w.environment.policy.budgetLimitCents !== 5000 || w.environment.policy.maxTaskCount !== 1 ||
      w.plan.deploymentProfileKey !== 'standard-v1' || w.environment.baseDomain !== 'sandbox.techlong.cloud') throw Error('EXPRESS_WORKLOAD_SCOPE_REJECTED');
  const db = buildDatabaseTaskConfigurationV2(b), readiness = buildTenantReadinessConfigurationV1({ binding: b,
    databaseOid: input.databaseOid, roleOid: input.roleOid, appInstanceId: cost.AppInstanceId, configurationHash: input.configurationHash });
  const base = await renderSupervisedTenantWorkloadBase(w), template = structuredClone(base.template);
  const resources = template.Resources as Record<string, { Properties: Record<string, unknown> }>;
  const task = resources.TenantTaskDefinition.Properties;
  const containers = task.ContainerDefinitions as { Environment: { Name: string; Value: unknown }[];
    Secrets: { Name: string; ValueFrom: unknown }[]; HealthCheck: { Command: string[] } }[];
  if (containers.length !== 1) throw Error('EXPRESS_WORKLOAD_BASE_DRIFT');
  const app = containers[0], environment = new Map(app.Environment.map(e => [e.Name, e.Value]));
  for (const name of [...environment.keys()]) if (name.startsWith('PG')) environment.delete(name);
  for (const e of [...db.environment, ...readiness.environment]) environment.set(e.name, e.value);
  app.Environment = [...environment].map(([Name, Value]) => ({ Name, Value }));
  app.Secrets = [...db.secrets.map(s => ({ Name: s.name, ValueFrom: s.valueFrom })),
    ...app.Secrets.filter(s => s.Name === 'SAAS_CONTROL_PUBLIC_KEY')];
  app.HealthCheck.Command = ['CMD', '/usr/local/bin/node', '-e',
    "fetch('http://127.0.0.1:3000/bootstrap-ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"];
  resources.TenantTargetGroup.Properties.HealthCheckPath = '/bootstrap-ready';
  const parameters = template.Parameters as Record<string, Record<string, unknown>>;
  parameters.TaskRoleArn = { ...parameters.TaskRoleArn, AllowedValues: [b.access.applicationRoleArn] };
  template.Metadata = { ...template.Metadata as object, DatabaseProfile: 'express_iam',
    InfrastructureHealthMeansBootstrapOnly: true, DeploymentReadyRequiresAuthenticatedInitializedReconciliation: true };
  const templateBody = canonicalJson(template);
  if (app.Secrets.length !== 5 || app.Environment.some(e => e.Name === 'DATABASE_URL' || e.Name === 'PGPASSWORD') ||
      templateBody.includes(':database_url:') || base.resourceInventory.length !== 7) throw Error('EXPRESS_WORKLOAD_SECRET_OR_RESOURCE_DRIFT');
  return { ...base, protocol: 'single-tenant-express-workload/v1' as const, template, templateBody,
    templateSha256: await sha256Hex(template), parameters: { ...base.parameters, TaskRoleArn: b.access.applicationRoleArn },
    requiredExternalParameters: base.requiredExternalParameters.filter(k => k !== 'TaskRoleArn'),
    databaseBindingSha256: db.bindingSha256, readiness,
    safety: { ...base.safety, executionAuthorized: false, bootstrapHealthIsNotDeploymentReady: true,
      fixedVersionFourKeySecret: true, legacyFullEntryUnchanged: true, applyReady: false } };
}
