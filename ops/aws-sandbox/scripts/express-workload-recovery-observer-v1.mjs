// Only live reads, bounded and explicitly separated from the single CreateStack entry.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { neon } from '@neondatabase/serverless';
import * as cf from '@aws-sdk/client-cloudformation';
import * as ecs from '@aws-sdk/client-ecs';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { clients, assertExistingSourceAndIam } from './express-image-repair-observer-v1.mjs';
import { R, hash, same, taskProjection, expectedTaskProjection, requireRecovery as must, validatePlatform } from './express-workload-recovery-plan-v1.mjs';
const exec = promisify(execFile), tags = a => Object.fromEntries((a || []).map(t => [t.Key, t.Value]));

export const PLATFORM_SQL = `SELECT d.id AS deployment_id,d.app_instance_id,d.status AS deployment_status,d.plan_hash,d.configuration_hash,d.artifact_ref,d.desired_plan,
 a.status AS instance_status,a.configuration_snapshot,j.id AS job_id,j.status AS job_status,j.attempts,j.max_attempts,
 j.lease_token IS NULL AS lease_cleared,j.lease_expires_at,j.updated_at AS job_updated_at,
 j.lease_expires_at < (extract(epoch from clock_timestamp())*1000)::bigint AS lease_expired,
 d.updated_at AS deployment_updated_at,d.outputs::jsonb->>'stackId' AS stack_id,d.outputs::jsonb->>'observationSha256' AS observation_sha256,
 r.owner_deployment_id,r.generation,r.lifecycle_status,r.destroyed_at IS NOT NULL AS resource_marked_destroyed,
 o.epoch,o.intent,o.state AS operation_state,o.operation_hash,o.marker,
 e.status AS environment_status,e.apply_enabled,e.admission_state,e.admission_epoch,e.admission_stack_id,e.policy AS environment_policy,
 w.status AS workspace_status,sub.status AS subscription_status,
 sub.current_period_end>(extract(epoch from clock_timestamp())*1000)::bigint AS subscription_current,
 (a.workspace_id=$4 AND a.product_id=$5 AND a.template_version_id=$6 AND d.environment_id=$7
   AND d.subscription_id=$8 AND a.subscription_id=$8 AND sub.workspace_id=$4 AND sub.product_id=$5 AND sub.template_version_id=$6
   AND e.kind='aws_sandbox' AND e.expected_account_id='402010193138' AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1') AS business_scope_matches,
 (SELECT count(*)::int FROM public.app_instance_deployments WHERE app_instance_id=a.id) AS app_deployments,
 (SELECT count(*)::int FROM public.deployment_jobs WHERE deployment_id=d.id) AS deployment_jobs
 FROM public.app_instance_deployments d JOIN public.app_instances a ON a.id=d.app_instance_id
 JOIN public.deployment_jobs j ON j.deployment_id=d.id AND j.id=$2
 JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
 JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
 JOIN public.deployment_environments e ON e.id=d.environment_id JOIN public.workspaces w ON w.id=a.workspace_id
 JOIN public.subscriptions sub ON sub.id=d.subscription_id WHERE d.id=$1 AND a.id=$3`;

export function recoveryClients() {
  const api = clients(), sm = new SecretsManagerClient(api.config);
  return { ...api, sm, destroy() { sm.destroy(); api.destroy(); } };
}
export async function observeRecovery({ api, historical, historicalPreflight, plan, databaseUrl, phase, baseline, signal }) {
  const startedAt = Date.now(); let sdkReads = 0, cliReads = 0;
  const send = (client, command) => { must(++sdkReads <= 45, 'SDK_READ_BUDGET');
    return client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); };
  const cli = async (args, missing) => {
    must(++cliReads <= 20, 'CLI_READ_BUDGET');
    try { const r = await exec('aws', [...args, '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1', '--output', 'json', '--no-cli-pager'],
      { windowsHide: true, signal, timeout: 30000, maxBuffer: 5_000_000, env: { ...process.env, AWS_MAX_ATTEMPTS: '1',
        AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } }); return JSON.parse(r.stdout); }
    catch (e) { if (missing && String(e.stderr).includes('(' + missing + ') when calling the')) return null;
      throw Object.assign(Error('WORKLOAD_RECOVERY_CLI_READ_FAILED'), { name: e.name }); }
  };
  await assertExistingSourceAndIam({ api, historicalPreflight, send });
  const [old, oldResources, cell, cellTemplate, cellResources] = await Promise.all([
    send(api.cfn, new cf.DescribeStacksCommand({ StackName: R.stack })), send(api.cfn, new cf.ListStackResourcesCommand({ StackName: R.stack })),
    send(api.cfn, new cf.DescribeStacksCommand({ StackName: historical.plan.computeStackId })),
    send(api.cfn, new cf.GetTemplateCommand({ StackName: historical.plan.computeStackId, TemplateStage: 'Original' })),
    send(api.cfn, new cf.ListStackResourcesCommand({ StackName: historical.plan.computeStackId })),
  ]);
  must(old.Stacks?.length === 1 && old.Stacks[0].StackId === R.stack && old.Stacks[0].StackStatus === 'DELETE_COMPLETE' &&
    !oldResources.NextToken && oldResources.StackResourceSummaries?.length === 7 && oldResources.StackResourceSummaries.every(r => r.ResourceStatus === 'DELETE_COMPLETE'), 'PREDECESSOR_NOT_DELETED');
  const parent = cell.Stacks?.[0], outputs = Object.fromEntries((parent?.Outputs || []).map(o => [o.OutputKey, o.OutputValue]));
  must(cell.Stacks?.length === 1 && parent.StackId === historical.plan.computeStackId && parent.StackStatus === 'CREATE_COMPLETE' &&
    typeof cellTemplate.TemplateBody === 'string' && hash(JSON.parse(cellTemplate.TemplateBody)) === historical.plan.computeTemplateSha256 &&
    Object.entries(historical.plan.cellOutputs).every(([k, v]) => outputs[k] === v) && !cellResources.NextToken &&
    cellResources.StackResourceSummaries?.length === 16 && cellResources.StackResourceSummaries.every(r => r.ResourceStatus === 'CREATE_COMPLETE'), 'CELL_DRIFT');
  let current;
  try { current = (await send(api.cfn, new cf.DescribeStacksCommand({ StackName: R.name }))).Stacks?.[0]; }
  catch (e) { if (!(e.name === 'ValidationError' && e.message === `Stack with id ${R.name} does not exist`)) throw e; }
  if (phase === 'before') must(!current, 'WORKLOAD_NAME_OCCUPIED');
  const desiredTemplate = JSON.parse(plan.request.TemplateBody), props = desiredTemplate.Resources;
  const [sv, original, listed, log, janitor, schedule, image, scan, repo, scanning, records, rds, listeners] = await Promise.all([
    send(api.ecs, new ecs.DescribeServicesCommand({ cluster: R.cluster, services: [R.service] })),
    send(api.ecs, new ecs.DescribeTaskDefinitionCommand({ taskDefinition: R.oldTask })),
    send(api.ecs, new ecs.ListTasksCommand({ cluster: R.cluster, serviceName: R.service, desiredStatus: 'RUNNING' })),
    cli(['logs', 'describe-log-groups', '--log-group-name-prefix', props.TenantLogGroup.Properties.LogGroupName, '--limit', '5']),
    cli(['lambda', 'get-function-configuration', '--function-name', 'techlong-sandbox-janitor']),
    cli(['scheduler', 'get-schedule', '--group-name', 'techlong-sandbox', '--name', 'global-expired-stack-scan']),
    cli(['ecr', 'batch-get-image', '--repository-name', R.repository, '--image-ids', 'imageDigest=' + R.newDigest]),
    cli(['ecr', 'describe-image-scan-findings', '--repository-name', R.repository, '--image-id', 'imageDigest=' + R.newDigest]),
    cli(['ecr', 'describe-repositories', '--repository-names', R.repository]), cli(['ecr', 'get-registry-scanning-configuration']),
    cli(['route53', 'list-resource-record-sets', '--hosted-zone-id', historical.plan.proposedDnsCreate.HostedZoneId,
      '--start-record-name', 'first-acceptance.sandbox.techlong.cloud.', '--start-record-type', 'A', '--max-items', '1']),
    cli(['rds', 'describe-db-clusters', '--db-cluster-identifier', 'techlong-sandbox-express-d001']),
    cli(['elbv2', 'describe-listeners', '--listener-arns', outputs.HttpsListenerArn, outputs.ControlListenerArn]),
  ]);
  must(janitor.State === 'Active' && janitor.Role === 'arn:aws:iam::402010193138:role/TechlongSandboxJanitorExecutionRole' && janitor.CodeSha256 === R.janitorCodeSha256 &&
    schedule.State === 'ENABLED' && schedule.ScheduleExpression === 'rate(15 minutes)' && schedule.Target?.Arn === janitor.FunctionArn &&
    same(JSON.parse(schedule.Target.Input), { schemaVersion: 1, action: 'scan_expired_cloudformation_stacks' }), 'JANITOR_DRIFT');
  const im = image.images?.[0], counts = scan.imageScanFindings?.findingSeverityCounts;
  must(image.images?.length === 1 && !image.failures?.length && im.imageId?.imageDigest === R.newDigest &&
    im.imageManifestMediaType === 'application/vnd.docker.distribution.manifest.v2+json' && 'sha256:' + hash(im.imageManifest) === R.newDigest &&
    JSON.parse(im.imageManifest).config?.digest === R.configDigest && scan.imageId?.imageDigest === R.newDigest && scan.imageScanStatus?.status === 'COMPLETE' &&
    counts && !(counts.HIGH || counts.CRITICAL) && repo.repositories?.length === 1 && repo.repositories[0].repositoryUri === R.registry + '/' + R.repository && repo.repositories[0].imageTagMutability === 'IMMUTABLE' &&
    repo.repositories[0].imageScanningConfiguration?.scanOnPush && scanning.scanningConfiguration?.scanType === 'BASIC', 'ECR_PROOF');
  const normalDns = d => ({ ...d, AliasTarget: d?.AliasTarget && { ...d.AliasTarget, DNSName: d.AliasTarget.DNSName.replace(/\.$/, '').replace(/^dualstack\./, '') } });
  must(same(normalDns(records.ResourceRecordSets?.[0]), normalDns(historical.plan.proposedDnsCreate.ChangeBatch.Changes[0].ResourceRecordSet)), 'DNS_CHANGED');
  const db = rds.DBClusters?.[0];
  must(rds.DBClusters?.length === 1 && db.DBClusterArn === 'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001' &&
    db.DbClusterResourceId === 'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM' && db.Status === 'available' && db.EngineVersion === '17.9' &&
    db.IAMDatabaseAuthenticationEnabled === true && db.InternetAccessGatewayEnabled === true && db.VPCNetworkingEnabled === false, 'AURORA_METADATA_CHANGED');
  must(listeners.Listeners?.length === 2 && listeners.Listeners.every(l => l.Protocol === 'HTTPS') &&
    listeners.Listeners.find(l => l.ListenerArn === outputs.ControlListenerArn)?.MutualAuthentication?.Mode === 'verify', 'LISTENERS_CHANGED');
  const fixed = [[historical.plan.futureTemplate.parameters.TenantRuntimeSecretArn, '0f45d29f-02d4-4117-99b1-c06645aa3c6e'],
    ['arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/control-public-key-first-acceptance-PfBjiq', '75d8da0af103e1e10e6d3341cbd50226fea7ce5e5aac8d150ab9e447b6340680']];
  for (const [SecretId, version] of fixed) {
    const s = await send(api.sm, new DescribeSecretCommand({ SecretId }));
    must(s.ARN === SecretId && !s.DeletedDate && !s.RotationEnabled && same(s.VersionIdsToStages, { [version]: ['AWSCURRENT'] }), 'FIXED_SECRET_CHANGED');
  }
  for (const entry of historical.plan.proposedEpochTransaction.TransactItems) {
    const wanted = entry.Put?.Item, p = entry.Put || entry.ConditionCheck;
    const got = await send(api.ddb, new GetItemCommand({ TableName: p.TableName, Key: p.Key || { authority_key: wanted.authority_key }, ConsistentRead: true }));
    must(wanted ? same(got.Item, wanted) : got.Item === undefined, 'AUTHORITY_CHANGED');
  }
  const url = new URL(databaseUrl); must(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname.endsWith('.neon.tech'), 'NEON_URL');
  const sql = neon(databaseUrl, { fullResults: true }), identity = historical.plan.pendingExternalFence.resourceFence.identity;
  const [result] = await sql.transaction([sql.query(PLATFORM_SQL, [historical.plan.scope.deploymentId, 'job_202c8dc12a8bf379f3a7c693', historical.plan.scope.appInstanceId,
    identity.workspaceId, identity.productId, historical.plan.templateVersionId, historical.plan.scope.environmentId, historical.plan.subscriptionId])],
  { readOnly: true, fullResults: true, fetchOptions: { signal } });
  must(result.rows?.length === 1, 'PLATFORM_ROWS');
  const platform = validatePlatform(result.rows[0], historical);
  must(original.taskDefinition?.taskDefinitionArn === R.oldTask && original.taskDefinition.status === 'INACTIVE', 'ORIGINAL_TASK_CHANGED');
  const expectedTaskSha256 = hash(expectedTaskProjection(original.taskDefinition)), service = sv.services?.[0];
  let live = null;
  if (phase === 'before') {
    must(!sv.failures?.length && sv.services?.length === 1 && service.status === 'INACTIVE' && service.desiredCount === 0 && service.runningCount === 0 &&
      service.pendingCount === 0 && !listed.nextToken && listed.taskArns?.length === 0 &&
      !log.logGroups?.some(g => g.logGroupName === props.TenantLogGroup.Properties.LogGroupName), 'OLD_SERVICE_OR_LOG_OCCUPIED');
    const [target, active] = await Promise.all([
      cli(['elbv2', 'describe-target-groups', '--names', props.TenantTargetGroup.Properties.Name], 'TargetGroupNotFound'),
      cli(['ecs', 'list-task-definitions', '--family-prefix', R.family, '--status', 'ACTIVE']),
    ]);
    must(!target && !active.nextToken && active.taskDefinitionArns?.length === 0, 'TARGET_OR_TASK_NAME_OCCUPIED');
    for (const [listener, forbidden] of [[outputs.HttpsListenerArn, ['100', '101']], [outputs.ControlListenerArn, ['100']]]) {
      const rules = await cli(['elbv2', 'describe-rules', '--listener-arn', listener]);
      must(!rules.NextMarker && rules.Rules && !rules.Rules.some(r => forbidden.includes(r.Priority)), 'LISTENER_PRIORITY_OCCUPIED');
    }
  } else {
    must(current && current.StackId !== R.stack && current.StackStatus === 'CREATE_COMPLETE' && current.RoleARN === R.role &&
      same(tags(current.Tags), tags(plan.request.Tags)), 'NEW_STACK_PROOF');
    const actualParameters = Object.fromEntries((current.Parameters || []).map(p => [p.ParameterKey, p.ParameterValue]));
    must(Object.keys(actualParameters).length === 20 && plan.request.Parameters.every(p => desiredTemplate.Parameters[p.ParameterKey].NoEcho
      ? actualParameters[p.ParameterKey] === '****' : actualParameters[p.ParameterKey] === p.ParameterValue), 'NEW_STACK_PARAMETERS');
    const [template, resources, events, td, tasks] = await Promise.all([
      send(api.cfn, new cf.GetTemplateCommand({ StackName: current.StackId, TemplateStage: 'Original' })),
      send(api.cfn, new cf.ListStackResourcesCommand({ StackName: current.StackId })), send(api.cfn, new cf.DescribeStackEventsCommand({ StackName: current.StackId })),
      send(api.ecs, new ecs.DescribeTaskDefinitionCommand({ taskDefinition: service.taskDefinition })),
      send(api.ecs, new ecs.DescribeTasksCommand({ cluster: R.cluster, tasks: listed.taskArns || [] })),
    ]);
    const rows = resources.StackResourceSummaries, task = tasks.tasks?.[0];
    must(typeof template.TemplateBody === 'string' && same(JSON.parse(template.TemplateBody), desiredTemplate) && !resources.NextToken && rows?.length === 7 &&
      same(Object.fromEntries(rows.map(r => [r.LogicalResourceId, r.ResourceType])), R.resources) && rows.every(r => r.ResourceStatus === 'CREATE_COMPLETE') &&
      events.StackEvents?.some(e => e.PhysicalResourceId === current.StackId && e.ResourceStatus === 'CREATE_COMPLETE' && e.ClientRequestToken === plan.request.ClientRequestToken), 'NEW_STACK_SPEC_OR_CORRELATION');
    must(!sv.failures?.length && sv.services?.length === 1 && service.status === 'ACTIVE' && service.desiredCount === 1 && service.runningCount === 1 && service.pendingCount === 0 &&
      service.deployments?.length === 1 && service.deployments[0].rolloutState === 'COMPLETED' && !listed.nextToken && listed.taskArns?.length === 1 &&
      !tasks.failures?.length && tasks.tasks?.length === 1 && task.lastStatus === 'RUNNING' && task.healthStatus === 'HEALTHY' && task.taskDefinitionArn === service.taskDefinition &&
      task.containers?.length === 1 && task.containers[0].imageDigest === R.newDigest && hash(taskProjection(td.taskDefinition)) === expectedTaskSha256 &&
      rows.find(r => r.LogicalResourceId === 'TenantTaskDefinition').PhysicalResourceId === service.taskDefinition, 'NEW_SERVICE_PROOF');
    must(service.loadBalancers?.length === 1 && service.loadBalancers[0].targetGroupArn ===
      rows.find(r => r.LogicalResourceId === 'TenantTargetGroup').PhysicalResourceId, 'NEW_SERVICE_TARGET');
    const health = await cli(['elbv2', 'describe-target-health', '--target-group-arn', rows.find(r => r.LogicalResourceId === 'TenantTargetGroup').PhysicalResourceId]);
    const addresses = task.attachments?.flatMap(a => a.details || []).filter(d => d.name === 'privateIPv4Address').map(d => d.value);
    must(health.TargetHealthDescriptions?.length === 1 && health.TargetHealthDescriptions[0].TargetHealth?.State === 'healthy' &&
      health.TargetHealthDescriptions[0].Target.Port === 3000 && addresses?.includes(health.TargetHealthDescriptions[0].Target.Id), 'NEW_TARGET_HEALTH');
    live = { stackId: current.StackId, taskDefinitionArn: service.taskDefinition, taskArn: task.taskArn, digest: task.containers[0].imageDigest };
  }
  const serviceSpec = { network: service.networkConfiguration, deployment: service.deploymentConfiguration,
    capacity: service.capacityProviderStrategy, platform: service.platformVersion, executeCommand: service.enableExecuteCommand,
    propagateTags: service.propagateTags, loadBalancers: service.loadBalancers?.map(b => ({ containerName: b.containerName, containerPort: b.containerPort })) };
  const stable = { serviceSpecSha256: hash(serviceSpec), cell: { id: parent.StackId, role: parent.RoleARN, tags: tags(parent.Tags), outputs, resources: cellResources.StackResourceSummaries.map(r =>
    ({ id: r.LogicalResourceId, physicalId: r.PhysicalResourceId, type: r.ResourceType })).sort((a, b) => a.id.localeCompare(b.id)) },
    platform, expectedTaskSha256, janitor: { code: janitor.CodeSha256, scheduleArn: schedule.Arn, target: schedule.Target, state: schedule.State },
    listenersSha256: hash(listeners.Listeners), dnsSha256: hash(records.ResourceRecordSets[0]) };
  if (baseline) must(same(stable, baseline), 'BASELINE_CHANGED');
  const validation = await send(api.cfn, new cf.ValidateTemplateCommand({ TemplateBody: plan.request.TemplateBody }));
  must(!validation.Capabilities?.length, 'TEMPLATE_CAPABILITY');
  must(Date.now() - startedAt < 180000, 'READ_SET_EXPIRED');
  return { schema: 'techlong/workload-only-recovery-observation/v1', startedAt, checkedAt: Date.now(), phase, baseline: stable, live,
    sdkReads, cliReads, neonReadonlyTransactions: 1, auroraConnections: 0, operatorSecretValueReads: 0, actualWrites: 0,
    namespaceAbsenceCurrentlyProved: true, legacyAuthorityUnchanged: true, platformUnchanged: true, readyVerified: false };
}
