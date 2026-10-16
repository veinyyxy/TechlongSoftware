// Concrete AWS operations for one initialized-tenant workload. No IAM, DNS,
// DDB, Secret, Aurora or business writer exists here. Only CreateStack writes.
import * as cf from '@aws-sdk/client-cloudformation';
import * as ecs from '@aws-sdk/client-ecs';
import { IAMClient } from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { EXPRESS_LIVE_RESOURCES_V1 as C } from '../../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { assertExpressInitializedStackIdV2 } from '../../../lib/deployments/execution/express-initialized-job-v2.ts';
import { assertExistingSourceAndIam } from './express-image-repair-observer-v1.mjs';
import { taskProjection } from './express-image-repair-plan-v1.mjs';
import { requireW3 as must, same, freeze } from './express-initialized-workload-v3.mjs';

const execute = promisify(execFile), region = 'ca-central-1', profile = 'techlong-sandbox-user';
const tags = rows => Object.fromEntries((rows || []).map(t => [t.Key, t.Value]));
const arn = 'arn:aws:ecs:ca-central-1:402010193138:';
const names = ['ClusterName', 'VpcId', 'SubnetIds', 'TaskSecurityGroupId', 'HttpsListenerArn', 'ControlListenerArn'];
const normalDns = value => String(value || '').toLowerCase().replace(/\.$/, '').replace(/^dualstack\./, '');
const readCommands = new Set(['elbv2/describe-target-groups', 'elbv2/describe-rules', 'elbv2/describe-target-health',
  'elbv2/describe-listeners', 'elbv2/describe-load-balancers', 'logs/describe-log-groups', 'route53/list-resource-record-sets',
  'rds/describe-db-clusters', 'ecr/batch-get-image', 'ecr/describe-image-scan-findings',
  'scheduler/get-schedule', 'lambda/get-function-configuration']);

export function createInitializedAwsV3(base) {
  const config = { region, credentials: fromLoginCredentials({ profile,
    clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } }), maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const api = { cfn: new cf.CloudFormationClient({ ...config, endpoint: 'https://cloudformation.ca-central-1.amazonaws.com' }),
    ecs: new ecs.ECSClient({ ...config, endpoint: 'https://ecs.ca-central-1.amazonaws.com' }), iam: new IAMClient(config),
    sts: new STSClient({ ...config, endpoint: 'https://sts.ca-central-1.amazonaws.com' }),
    ddb: new DynamoDBClient({ ...config, endpoint: 'https://dynamodb.ca-central-1.amazonaws.com' }),
    sm: new SecretsManagerClient({ ...config, endpoint: 'https://secretsmanager.ca-central-1.amazonaws.com' }) };
  let sdkReads = 0, cliReads = 0, createCalls = 0;
  const send = (client, command, signal) => { must(++sdkReads <= 700, 'SDK_TOTAL_BUDGET');
    return client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); };
  const cli = async (args, signal, missingCode) => {
    must(readCommands.has(args.slice(0, 2).join('/')) && ++cliReads <= 160, 'CLI_READ_ALLOWLIST_BUDGET');
    try {
      const { stdout } = await execute('aws', [...args, '--profile', profile, '--region', region, '--output', 'json', '--no-cli-pager',
        ...(args.includes('--max-items') ? [] : ['--no-paginate'])],
        { windowsHide: true, timeout: 30000, maxBuffer: 5000000, signal, env: { ...process.env, AWS_MAX_ATTEMPTS: '1',
          AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } });
      return JSON.parse(stdout);
    } catch (e) {
      if (missingCode && String(e.stderr).includes('(' + missingCode + ') when calling the')) return null;
      throw Error('INITIALIZED_W3_PROVIDER_CLI_READ_FAILED');
    }
  };
  async function identity(signal) {
    const who = await send(api.sts, new GetCallerIdentityCommand({}), signal);
    must(who.Account === '402010193138' && who.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' &&
      who.UserId === 'AIDAV3GNMXTZEO7SHLC2X', 'SOURCE_IDENTITY');
  }
  async function readCell(signal) {
    await identity(signal);
    const [s, t, r, c] = await Promise.all([
      send(api.cfn, new cf.DescribeStacksCommand({ StackName: base.compute.stackId }), signal),
      send(api.cfn, new cf.GetTemplateCommand({ StackName: base.compute.stackId, TemplateStage: 'Original' }), signal),
      send(api.cfn, new cf.ListStackResourcesCommand({ StackName: base.compute.stackId }), signal),
      send(api.ecs, new ecs.DescribeClustersCommand({ clusters: ['cell-sandbox-1'] }), signal),
    ]);
    const stack = s.Stacks?.[0], outputs = Object.fromEntries((stack?.Outputs || []).map(o => [o.OutputKey, o.OutputValue])), cluster = c.clusters?.[0];
    must(s.Stacks?.length === 1 && stack.StackId === base.compute.stackId && stack.StackStatus === 'CREATE_COMPLETE' &&
      same(outputs, base.compute.outputs) && typeof t.TemplateBody === 'string' && await sha256Hex(JSON.parse(t.TemplateBody)) === base.compute.templateSha256 &&
      !r.NextToken && r.StackResourceSummaries?.length === 16 && r.StackResourceSummaries.every(r => r.ResourceStatus === 'CREATE_COMPLETE') &&
      !c.failures?.length && c.clusters?.length === 1 && cluster.clusterName === 'cell-sandbox-1' && cluster.status === 'ACTIVE' &&
      cluster.activeServicesCount === 0 && cluster.runningTasksCount === 0 && cluster.pendingTasksCount === 0, 'CELL_OR_CAPACITY_DRIFT');
    return { stackId: stack.StackId, outputs: Object.fromEntries(names.map(n => [n, outputs[n]])),
      parentTagExpiresAt: tags(stack.Tags).ExpiresAt, activeCellCount: 1, activeTenantCount: 0 };
  }
  async function assertAuthority(job, signal) {
    const f = job.externalFence, stable = f.resourceFence.identity.stableIdentityHash;
    const [legacy, successor] = await Promise.all(['tenant:', 'tenant:aurora-v2:'].map(prefix => send(api.ddb,
      new GetItemCommand({ TableName: C.epochTableArn, Key: { authority_key: { S: prefix + stable } }, ConsistentRead: true }), signal)));
    const expected = base.epochItem;
    must(expected?.authority_key?.S === 'tenant:' + stable && same(legacy.Item, expected) && successor.Item === undefined, 'EXTERNAL_AUTHORITY_DRIFT');
    const record = JSON.parse(legacy.Item.record_json.S);
    must(record.ownerDeploymentId === f.ownerDeploymentId && record.epoch === f.epoch && record.generation === f.resourceFence.generation &&
      record.operationHash === f.operationHash && record.marker === f.marker && record.intent === 'provision', 'EPOCH_COORDINATE');
    return { authorityCheckedAt: Date.now(), authorityObservationSha256: await sha256Hex({ legacy: legacy.Item,
      successorAbsent: true, consistentRead: true }) };
  }
  async function fixedMetadata(workload, job, signal) {
    const [listeners, dns, database, janitor, schedule] = await Promise.all([
      cli(['elbv2', 'describe-listeners', '--listener-arns', workload.cellOutputs.HttpsListenerArn, workload.cellOutputs.ControlListenerArn], signal),
      cli(['route53', 'list-resource-record-sets', '--hosted-zone-id', base.hostedZoneId, '--start-record-name', job.material.tenantHostname + '.',
        '--start-record-type', 'A', '--max-items', '1'], signal),
      cli(['rds', 'describe-db-clusters', '--db-cluster-identifier', 'techlong-sandbox-express-d001'], signal),
      cli(['lambda', 'get-function-configuration', '--function-name', 'techlong-sandbox-janitor'], signal),
      cli(['scheduler', 'get-schedule', '--group-name', 'techlong-sandbox', '--name', 'global-expired-stack-scan'], signal),
    ]);
    const alias = dns.ResourceRecordSets?.[0], wanted = base.dnsRecord, db = database.DBClusters?.[0], b = job.material.binding;
    must(alias?.Name === wanted.Name && alias.Type === 'A' && !alias.ResourceRecords && alias.AliasTarget?.HostedZoneId === wanted.AliasTarget.HostedZoneId &&
      normalDns(alias.AliasTarget.DNSName) === normalDns(wanted.AliasTarget.DNSName) && alias.AliasTarget.EvaluateTargetHealth === false &&
      listeners.Listeners?.length === 2 && listeners.Listeners.every(l => l.Protocol === 'HTTPS') &&
      listeners.Listeners.find(l => l.ListenerArn === workload.cellOutputs.ControlListenerArn)?.MutualAuthentication?.Mode === 'verify', 'DNS_OR_MTLS_LISTENER_DRIFT');
    must(database.DBClusters?.length === 1 && db.DBClusterArn === b.clusterArn && db.DbClusterResourceId === b.clusterResourceId &&
      db.Endpoint === b.endpoint && db.Port === 5432 && db.EngineVersion === '17.9' && db.Status === 'available' &&
      db.IAMDatabaseAuthenticationEnabled === true && db.InternetAccessGatewayEnabled === true && db.VPCNetworkingEnabled === false &&
      same(db.ServerlessV2ScalingConfiguration, { MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 }), 'AURORA_METADATA_DRIFT');
    must(janitor.State === 'Active' && janitor.CodeSha256 === base.janitorCodeSha256 &&
      schedule.State === 'ENABLED' && schedule.ScheduleExpression === 'rate(15 minutes)' && schedule.Target?.Arn === janitor.FunctionArn &&
      same(JSON.parse(schedule.Target.Input), { schemaVersion: 1, action: 'scan_expired_cloudformation_stacks' }), 'EXISTING_JANITOR_DRIFT');
    for (const [SecretId, version] of [[b.runtimeSecret.arn, b.runtimeSecret.versionId], [C.controlPublicKeyArn, C.controlPublicKeyVersion]]) {
      const got = await send(api.sm, new DescribeSecretCommand({ SecretId }), signal);
      must(got.ARN === SecretId && !got.DeletedDate && !got.RotationEnabled && !got.ReplicationStatus?.length &&
        same(got.VersionIdsToStages, { [version]: ['AWSCURRENT'] }), 'FIXED_SECRET_METADATA_DRIFT');
    }
    for (const image of [job.material.images.app, job.material.images.lifecycle]) {
      const digest = image.split('@')[1], got = await cli(['ecr', 'batch-get-image', '--repository-name', 'techlong-sandbox-speedfeast', '--image-ids', 'imageDigest=' + digest], signal);
      const found = got.images?.[0];
      must(got.images?.length === 1 && !got.failures?.length && found.imageId.imageDigest === digest &&
        found.imageManifestMediaType === 'application/vnd.docker.distribution.manifest.v2+json' && 'sha256:' + await sha256Hex(found.imageManifest) === digest, 'ECR_MANIFEST_DRIFT');
      const scan = await cli(['ecr', 'describe-image-scan-findings', '--repository-name', 'techlong-sandbox-speedfeast', '--image-id', 'imageDigest=' + digest], signal);
      must(scan.imageId?.imageDigest === digest && scan.imageScanStatus?.status === 'COMPLETE' && scan.imageScanFindings?.findingSeverityCounts && !(scan.imageScanFindings.findingSeverityCounts.HIGH ||
        scan.imageScanFindings?.findingSeverityCounts?.CRITICAL), 'ECR_SCAN_BLOCKED');
    }
  }
  async function inspectBefore(workload, job, signal) {
    const startedAt = Date.now(), before = { sdkReads, cliReads };
    const cell = await readCell(signal);
    must(same(cell.outputs, workload.cellOutputs) && cell.stackId === workload.parentStackId, 'RENDERED_CELL_DRIFT');
    await assertExistingSourceAndIam({ api, historicalPreflight: base.iam, send: (c, q) => send(c, q, signal) });
    await fixedMetadata(workload, job, signal);
    const props = workload.template.Resources, svcName = props.TenantService.Properties.ServiceName, family = props.TenantTaskDefinition.Properties.Family;
    let absent = false;
    try { await send(api.cfn, new cf.DescribeStacksCommand({ StackName: workload.stackName }), signal); }
    catch (e) { if (e.name === 'ValidationError' && e.message === `Stack with id ${workload.stackName} does not exist`) absent = true; else throw e; }
    const [services, tasks, definitions, target, logs, predecessor, resources, td] = await Promise.all([
      send(api.ecs, new ecs.DescribeServicesCommand({ cluster: 'cell-sandbox-1', services: [svcName] }), signal),
      send(api.ecs, new ecs.ListTasksCommand({ cluster: 'cell-sandbox-1', serviceName: svcName, desiredStatus: 'RUNNING' }), signal),
      send(api.ecs, new ecs.ListTaskDefinitionsCommand({ familyPrefix: family, status: 'ACTIVE' }), signal),
      cli(['elbv2', 'describe-target-groups', '--names', props.TenantTargetGroup.Properties.Name], signal, 'TargetGroupNotFound'),
      cli(['logs', 'describe-log-groups', '--log-group-name-prefix', props.TenantLogGroup.Properties.LogGroupName, '--limit', '5'], signal),
      send(api.cfn, new cf.DescribeStacksCommand({ StackName: base.predecessorStackId }), signal),
      send(api.cfn, new cf.ListStackResourcesCommand({ StackName: base.predecessorStackId }), signal),
      send(api.ecs, new ecs.DescribeTaskDefinitionCommand({ taskDefinition: base.predecessorTaskDefinitionArn }), signal),
    ]);
    const service = services.services?.[0];
    const serviceAbsent = services.services?.length === 0 && services.failures?.length === 1 &&
      services.failures[0].arn === arn + 'service/cell-sandbox-1/' + svcName && services.failures[0].reason === 'MISSING';
    must(absent && (!services.failures?.length && services.services?.length === 1 && service.status === 'INACTIVE' &&
      service.desiredCount === 0 && service.runningCount === 0 && service.pendingCount === 0 || serviceAbsent) &&
      !tasks.nextToken && tasks.taskArns?.length === 0 && !definitions.nextToken && !definitions.taskDefinitionArns?.some(a => a.includes('/' + family + ':')) &&
      !target && !logs.nextToken && !logs.logGroups?.some(g => g.logGroupName === props.TenantLogGroup.Properties.LogGroupName), 'NAMESPACE_NOT_EMPTY');
    must(predecessor.Stacks?.length === 1 && predecessor.Stacks[0].StackId === base.predecessorStackId && predecessor.Stacks[0].StackStatus === 'DELETE_COMPLETE' &&
      !resources.NextToken && resources.StackResourceSummaries?.length === 7 && resources.StackResourceSummaries.every(r => r.ResourceStatus === 'DELETE_COMPLETE') &&
      td.taskDefinition?.taskDefinitionArn === base.predecessorTaskDefinitionArn && td.taskDefinition.status === 'INACTIVE' &&
      await sha256Hex(taskProjection(td.taskDefinition)) === base.expectedTaskSha256, 'PREDECESSOR_NOT_RETIRED');
    for (const [listener, forbidden] of [[workload.cellOutputs.HttpsListenerArn, ['100', '101']], [workload.cellOutputs.ControlListenerArn, ['100']]]) {
      const rules = await cli(['elbv2', 'describe-rules', '--listener-arn', listener], signal);
      must(!rules.NextMarker && rules.Rules && !rules.Rules.some(r => forbidden.includes(r.Priority)), 'LISTENER_PRIORITY_OCCUPIED');
    }
    const validation = await send(api.cfn, new cf.ValidateTemplateCommand({ TemplateBody: workload.request.TemplateBody }), signal);
    must(!validation.Capabilities?.length, 'UNEXPECTED_IAM_CAPABILITY');
    const authority = await assertAuthority(job, signal);
    must(Date.now() - startedAt < 90000, 'PREFLIGHT_TOO_SLOW');
    return { schema: 'techlong/initialized-workload-preflight/v3', startedAt, checkedAt: Date.now(),
      namespacesAbsent: true, retiredPredecessor: base.predecessorStackId, fixedMetadataVerified: true,
      existingIamUnchanged: true, authority, sdkReads: sdkReads - before.sdkReads, cliReads: cliReads - before.cliReads,
      cloudWrites: 0, secretValueReads: 0, applicationRequests: 0 };
  }
  async function inspectAfter(workload, job, stackId, signal) {
    assertExpressInitializedStackIdV2(job, stackId); const checked = Date.now();
    const [stacks, template, resources] = await Promise.all([
      send(api.cfn, new cf.DescribeStacksCommand({ StackName: stackId }), signal),
      send(api.cfn, new cf.GetTemplateCommand({ StackName: stackId, TemplateStage: 'Original' }), signal),
      send(api.cfn, new cf.ListStackResourcesCommand({ StackName: stackId }), signal),
    ]);
    const s = stacks.Stacks?.[0], rows = resources.StackResourceSummaries;
    must(stacks.Stacks?.length === 1 && s.StackId === stackId && stackId !== base.predecessorStackId &&
      s.StackStatus === 'CREATE_COMPLETE' && s.RoleARN === workload.request.RoleARN && same(tags(s.Tags), workload.tags) &&
      typeof template.TemplateBody === 'string' && same(JSON.parse(template.TemplateBody), workload.template) &&
      !resources.NextToken && rows?.length === 7 && workload.resourceInventory.every(e => rows.some(r => r.LogicalResourceId === e.logicalId && r.ResourceType === e.type)) &&
      rows.every(r => r.ResourceStatus === 'CREATE_COMPLETE' && r.PhysicalResourceId), 'CREATED_STACK_NOT_PROVED');
    const parameterSpecs = workload.template.Parameters, got = Object.fromEntries((s.Parameters || []).map(p => [p.ParameterKey, p.ParameterValue]));
    const expected = { ...Object.fromEntries(Object.entries(parameterSpecs).filter(([, v]) => v.Default !== undefined).map(([k, v]) => [k, String(v.Default)])), ...workload.parameters };
    must(same(Object.keys(got).sort(), Object.keys(expected).sort()) && Object.entries(expected).every(([k, v]) =>
      parameterSpecs[k].NoEcho ? got[k] === '****' : got[k] === v), 'STACK_PARAMETERS_DRIFT');
    const physical = Object.fromEntries(rows.map(r => [r.LogicalResourceId, r.PhysicalResourceId]));
    const [sv, td, lt] = await Promise.all([
      send(api.ecs, new ecs.DescribeServicesCommand({ cluster: 'cell-sandbox-1', services: [physical.TenantService] }), signal),
      send(api.ecs, new ecs.DescribeTaskDefinitionCommand({ taskDefinition: physical.TenantTaskDefinition }), signal),
      send(api.ecs, new ecs.ListTasksCommand({ cluster: 'cell-sandbox-1', serviceName: physical.TenantService, desiredStatus: 'RUNNING' }), signal),
    ]);
    const service = sv.services?.[0];
    must(!sv.failures?.length && sv.services?.length === 1 && service.status === 'ACTIVE' && service.desiredCount === 1 && service.runningCount === 1 &&
      service.pendingCount === 0 && service.taskDefinition === physical.TenantTaskDefinition && service.deployments?.length === 1 &&
      service.deployments[0].rolloutState === 'COMPLETED' && !service.enableExecuteCommand && service.platformVersion === '1.4.0' &&
      await sha256Hex(taskProjection(td.taskDefinition)) === base.expectedTaskSha256 && !lt.nextToken && lt.taskArns?.length === 1 &&
      service.loadBalancers?.length === 1 && service.loadBalancers[0].targetGroupArn === physical.TenantTargetGroup, 'ECS_NOT_STABLE');
    const [tasks, health] = await Promise.all([send(api.ecs, new ecs.DescribeTasksCommand({ cluster: 'cell-sandbox-1', tasks: lt.taskArns }), signal),
      cli(['elbv2', 'describe-target-health', '--target-group-arn', physical.TenantTargetGroup], signal)]);
    const task = tasks.tasks?.[0], target = health.TargetHealthDescriptions?.[0];
    const addresses = task?.attachments?.flatMap(a => a.details || []).filter(d => d.name === 'privateIPv4Address').map(d => d.value);
    must(!tasks.failures?.length && tasks.tasks?.length === 1 && task.lastStatus === 'RUNNING' && task.healthStatus === 'HEALTHY' &&
      task.taskDefinitionArn === physical.TenantTaskDefinition && task.containers?.length === 1 && task.containers[0].imageDigest === job.material.images.app.split('@')[1] &&
      health.TargetHealthDescriptions?.length === 1 && target.TargetHealth?.State === 'healthy' && target.Target.Port === 3000 && addresses?.includes(target.Target.Id), 'RUNTIME_IMAGE_OR_TARGET_NOT_PROVED');
    const observation = { stackId, physical, taskArn: task.taskArn, imageUri: job.material.images.app, checkedAt: Date.now() };
    must(Date.now() - checked < 30000 && Date.now() < workload.workloadExpiresAt, 'FINAL_OBSERVATION_EXPIRED');
    return { ...observation, providerObservationSha256: await sha256Hex(observation), providerCheckedAt: observation.checkedAt };
  }
  return Object.freeze({ readCell, inspectBefore, inspectAfter,
    bindOnce(workload, jobPlan, consume, save) {
      workload = freeze(structuredClone(workload)); jobPlan = freeze(structuredClone(jobPlan));
      let entered = false;
      return Object.freeze({ async executeOnce({ plan, lease, assertLease, signal }) {
        must(!entered && same(plan, jobPlan) && workload.jobPlanSha256 === plan.planSha256 && lease.jobId === plan.jobId, 'PROVIDER_SCOPE_OR_REENTRY');
        entered = true;
        const before = await inspectBefore(workload, plan, signal); await save('provider-before.json', before);
        await assertLease();
        must(Date.now() - before.checkedAt < 30000 && Date.now() < plan.deadline && Date.now() < workload.workloadExpiresAt, 'FINAL_CREATE_WINDOW');
        await consume('create_workload', workload.requestSha256);
        signal.throwIfAborted(); must(Date.now() - before.checkedAt < 30000 && Date.now() < plan.deadline, 'POST_SLOT_CREATE_WINDOW');
        must(++createCalls === 1, 'CREATE_CALL_BUDGET');
        const ack = await api.cfn.send(new cf.CreateStackCommand(workload.request), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
        must(ack.StackId, 'CREATE_ACK_MISSING'); assertExpressInitializedStackIdV2(plan, ack.StackId);
        await save('create-ack.json', { stackId: ack.StackId, requestId: ack.$metadata?.requestId, acknowledgedAt: Date.now() });
        let complete = false;
        for (let n = 0; n < 60; n++) {
          signal.throwIfAborted(); await assertLease();
          const r = await send(api.cfn, new cf.DescribeStacksCommand({ StackName: ack.StackId }), signal), s = r.Stacks?.[0];
          must(r.Stacks?.length === 1 && s.StackId === ack.StackId, 'WAIT_UUID_DRIFT');
          if (s.StackStatus === 'CREATE_COMPLETE') { complete = true; break; }
          must(s.StackStatus === 'CREATE_IN_PROGRESS', 'CREATE_TERMINAL_REQUIRES_INSPECT');
          console.log(JSON.stringify({ stage: 'wait_workload', poll: n + 1, status: s.StackStatus }));
          await delay(15000, undefined, { signal });
        }
        must(complete, 'CREATE_WAIT_LIMIT');
        const provider = await inspectAfter(workload, plan, ack.StackId, signal), authority = await assertAuthority(plan, signal);
        await save('provider-after.json', { ...provider, ...authority });
        return { materialSha256: plan.materialSha256, ownerDeploymentId: plan.material.scope.ownerDeploymentId,
          generation: plan.material.binding.resourceGeneration, stackId: ack.StackId, workloadExpiresAt: workload.workloadExpiresAt,
          imageUri: plan.material.images.app, configurationHash: plan.material.configurationSha256,
          epoch: plan.externalFence.epoch, operationHash: plan.externalFence.operationHash,
          providerObservationSha256: provider.providerObservationSha256, providerCheckedAt: provider.providerCheckedAt, ...authority };
      } });
    },
    counts: () => ({ sdkReads, cliReads, createCalls }),
    dispose() { Object.values(api).forEach(c => c.destroy()); },
  });
}
