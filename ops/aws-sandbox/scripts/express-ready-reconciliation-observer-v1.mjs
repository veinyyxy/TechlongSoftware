// K2c provider readback. Frozen K1 observer remains unchanged; this new path
// accepts either the original platform coordinate or independently proved ready.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { neon } from '@neondatabase/serverless';
import * as cf from '@aws-sdk/client-cloudformation';
import * as ecs from '@aws-sdk/client-ecs';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { assertExistingSourceAndIam } from './express-image-repair-observer-v1.mjs';
import { R, hash, same, taskProjection, expectedTaskProjection, requireRecovery as must, validatePlatform } from './express-workload-recovery-plan-v1.mjs';
const exec = promisify(execFile), tags = a => Object.fromEntries((a || []).map(t => [t.Key, t.Value]));

import { PLATFORM_SQL } from './express-workload-recovery-observer-v1.mjs';
export { recoveryClients } from './express-workload-recovery-observer-v1.mjs';
import { validateReadyPlatform, SESSION_SQL, SNAPSHOT_SQL, CATALOG_SQL, scopeValues } from './express-ready-reconciliation-plan-v1.mjs';
import { A } from './express-initialization-audit-plan-v1.mjs';



export async function observeReconciliation({ api, historical, historicalPreflight, plan, databaseUrl, baseline, signal, platformPhase, reconciliationPlan, receipt }) {
  must(['before', 'ready'].includes(platformPhase), 'PLATFORM_PHASE'); const phase = 'after';
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
  const platform = platformPhase === 'before' ? validatePlatform(result.rows[0], historical)
    : validateReadyPlatform(result.rows[0], reconciliationPlan, receipt);
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
    must(current.StackId === A.stackId && service.taskDefinition === A.taskDefinitionArn, 'EXACT_RECOVERED_COORDINATES');
    live = { stackId: current.StackId, taskDefinitionArn: service.taskDefinition, taskArn: task.taskArn, digest: task.containers[0].imageDigest };
  }
  const serviceSpec = { network: service.networkConfiguration, deployment: service.deploymentConfiguration,
    capacity: service.capacityProviderStrategy, platform: service.platformVersion, executeCommand: service.enableExecuteCommand,
    propagateTags: service.propagateTags, loadBalancers: service.loadBalancers?.map(b => ({ containerName: b.containerName, containerPort: b.containerPort })) };
  const stable = { serviceSpecSha256: hash(serviceSpec), cell: { id: parent.StackId, role: parent.RoleARN, tags: tags(parent.Tags), outputs, resources: cellResources.StackResourceSummaries.map(r =>
    ({ id: r.LogicalResourceId, physicalId: r.PhysicalResourceId, type: r.ResourceType })).sort((a, b) => a.id.localeCompare(b.id)) },
    platform, expectedTaskSha256, janitor: { code: janitor.CodeSha256, scheduleArn: schedule.Arn, target: schedule.Target, state: schedule.State },
    listenersSha256: hash(listeners.Listeners), dnsSha256: hash(records.ResourceRecordSets[0]) };
  if (baseline) {
    const withoutPlatform = x => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'platform'));
    must(same(withoutPlatform(stable), withoutPlatform(baseline)), 'HOSTING_BASELINE_CHANGED');
    if (platformPhase === 'before') must(same(platform, baseline.platform), 'PLATFORM_BASELINE_CHANGED');
  }
  const validation = await send(api.cfn, new cf.ValidateTemplateCommand({ TemplateBody: plan.request.TemplateBody }));
  must(!validation.Capabilities?.length, 'TEMPLATE_CAPABILITY');
  must(Date.now() - startedAt < 180000, 'READ_SET_EXPIRED');
  return { schema: 'techlong/ready-reconciliation-provider-observation/v1', startedAt, checkedAt: Date.now(), phase, baseline: stable, live,
    sdkReads, cliReads, neonReadonlyTransactions: 1, auroraConnections: 0, operatorSecretValueReads: 0, actualWrites: 0,
    legacyIamAndAuthorityLayoutVerified: true, legacyAuthorityUnchanged: true, platformUnchanged: platformPhase === 'before', platformReadyProjectionVerified: platformPhase === 'ready', readyVerified: false };
}

/** Three fixed statements in one SERIALIZABLE READ ONLY Neon transaction.
 * Whole-row hashes are computed in PostgreSQL: no lease token/row bodies leave
 * the server. Catalog definitions are returned for review, not executed. */
export async function readReconciliationState({ databaseUrl, historical, receipt = null, signal }) {
  const url = new URL(databaseUrl);
  must(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname.endsWith('.neon.tech'), 'NEON_SOURCE');
  const endpointSha256 = hash([url.hostname, url.port || '5432', decodeURIComponent(url.pathname), decodeURIComponent(url.username)]);
  const sql = neon(databaseUrl, { fullResults: true }), startedAt = Date.now();
  const rows = await sql.transaction(tx => [tx.query(SESSION_SQL, []), tx.query(SNAPSHOT_SQL, scopeValues(historical, receipt)), tx.query(CATALOG_SQL, [])],
    { readOnly: true, isolationLevel: 'Serializable', fullResults: true, fetchOptions: { signal } });
  must(rows.length === 3 && rows.every(r => r.rowCount === 1) && rows[0].rows[0].search_path === 'pg_catalog', 'SNAPSHOT_ROWS');
  const snapshot = rows[1].rows[0], catalog = rows[2].rows[0];
  must(snapshot.read_only === 'on' && Number.isSafeInteger(Number(snapshot.db_now)) &&
    Number(snapshot.db_now) >= startedAt - 5000 && Math.abs(Date.now() - Number(snapshot.db_now)) < 30000 &&
    same(catalog.catalog?.tables?.map(t => t.name).sort(), ['app_instance_deployments', 'app_instances', 'deployment_jobs']) &&
    Array.isArray(catalog.catalog.functions) && /^[a-f0-9]{64}$/.test(catalog.server_sha256), 'SNAPSHOT_CLOCK_OR_CATALOG');
  return { schema: 'techlong/ready-reconciliation-state/v1', startedAt, checkedAt: Date.now(), endpointSha256,
    snapshot, catalog, catalogServerSha256: catalog.server_sha256, readOnlyStatements: 3, platformWrites: 0 };
}
