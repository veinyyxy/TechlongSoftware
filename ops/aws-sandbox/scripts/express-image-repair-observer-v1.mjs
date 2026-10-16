// Provider reads only. No Secret value API, SQL client, HTTP application call or write command.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as cfn from '@aws-sdk/client-cloudformation';
import * as ecs from '@aws-sdk/client-ecs';
import * as iam from '@aws-sdk/client-iam';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { C, demand, same, hash, imageUri, taskProjection, expectedTaskProjection, assertResources } from './express-image-repair-plan-v1.mjs';

const exec = promisify(execFile), decode = d => typeof d === 'string' ? JSON.parse(decodeURIComponent(d)) : d;
const tags = rows => Object.fromEntries((rows || []).map(r => [r.Key, r.Value]));
export function clients() {
  const config = { region: 'ca-central-1', maxAttempts: 1, ignoreConfiguredEndpointUrls: true,
    credentials: fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } }) };
  const all = { cfn: new cfn.CloudFormationClient(config), ecs: new ecs.ECSClient(config), iam: new iam.IAMClient(config),
    ddb: new DynamoDBClient(config), sts: new STSClient({ ...config, endpoint: 'https://sts.ca-central-1.amazonaws.com' }) };
  return { ...all, destroy() { Object.values(all).forEach(c => c.destroy()); } };
}
export async function observe({ api, historical, historicalPreflight, request, phase, baseline, signal }) {
  const startedAt = Date.now(); let sdkReads = 0, cliReads = 0;
  const send = (client, cmd) => { demand(++sdkReads <= 45, 'SDK_READ_LIMIT');
    return client.send(cmd, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); };
  const cli = async args => {
    demand(++cliReads <= 7, 'CLI_READ_LIMIT');
    const r = await exec('aws', [...args, '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1', '--output', 'json', '--no-cli-pager'],
      { windowsHide: true, signal, timeout: 30000, maxBuffer: 4_000_000,
        env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_CLI_AUTO_PROMPT: 'off', AWS_PAGER: '' } });
    return JSON.parse(r.stdout);
  };
  const who = await send(api.sts, new GetCallerIdentityCommand({}));
  demand(who.Account === '402010193138' && who.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' &&
    who.UserId === 'AIDAV3GNMXTZEO7SHLC2X', 'SOURCE_IDENTITY');
  const RoleName = 'TechlongSandboxCloudFormationExecutionRole';
  const [rr, rn, ra] = await Promise.all([send(api.iam, new iam.GetRoleCommand({ RoleName })),
    send(api.iam, new iam.ListRolePoliciesCommand({ RoleName })), send(api.iam, new iam.ListAttachedRolePoliciesCommand({ RoleName }))]);
  demand(!rn.IsTruncated && !ra.IsTruncated, 'CFN_ROLE_PAGINATION');
  const r = rr.Role, cfnRole = { arn: r?.Arn, id: r?.RoleId, trust: decode(r?.AssumeRolePolicyDocument),
    boundaryArn: r?.PermissionsBoundary?.PermissionsBoundaryArn, inlineNames: (rn.PolicyNames || []).sort(),
    attached: (ra.AttachedPolicies || []).map(p => p.PolicyArn).sort() };
  demand(same(cfnRole, historicalPreflight.cfnRole), 'CFN_ROLE_DRIFT');
  for (const wanted of historicalPreflight.policies) {
    const PolicyArn = wanted.arn, p = await send(api.iam, new iam.GetPolicyCommand({ PolicyArn }));
    demand(p.Policy?.PolicyId === wanted.id && p.Policy.DefaultVersionId === wanted.defaultVersion, 'POLICY_ID_VERSION');
    const v = await send(api.iam, new iam.GetPolicyVersionCommand({ PolicyArn, VersionId: wanted.defaultVersion }));
    demand(v.PolicyVersion?.IsDefaultVersion && same(decode(v.PolicyVersion.Document), wanted.document), 'POLICY_DOCUMENT');
  }
  for (const wanted of historicalPreflight.roles) {
    const RoleName = wanted.name, [rr, names, attached] = await Promise.all([send(api.iam, new iam.GetRoleCommand({ RoleName })),
      send(api.iam, new iam.ListRolePoliciesCommand({ RoleName })), send(api.iam, new iam.ListAttachedRolePoliciesCommand({ RoleName }))]);
    demand(!names.IsTruncated && !attached.IsTruncated && names.PolicyNames?.length === wanted.inline.length, 'TASK_ROLE_INVENTORY');
    const inline = [];
    for (const PolicyName of names.PolicyNames) inline.push({ name: PolicyName,
      document: decode((await send(api.iam, new iam.GetRolePolicyCommand({ RoleName, PolicyName }))).PolicyDocument) });
    const r = rr.Role, actual = { name: RoleName, id: r?.RoleId, arn: r?.Arn, trust: decode(r?.AssumeRolePolicyDocument),
      boundaryArn: r?.PermissionsBoundary?.PermissionsBoundaryArn, attached: attached.AttachedPolicies || [],
      inline: inline.sort((a, b) => a.name.localeCompare(b.name)), tags: tags(r?.Tags) };
    demand(same(actual, wanted), 'TASK_ROLE_DRIFT');
  }
  const [sr, tr, rs, sv] = await Promise.all([
    send(api.cfn, new cfn.DescribeStacksCommand({ StackName: C.stack })),
    send(api.cfn, new cfn.GetTemplateCommand({ StackName: C.stack, TemplateStage: 'Original' })),
    send(api.cfn, new cfn.ListStackResourcesCommand({ StackName: C.stack })),
    send(api.ecs, new ecs.DescribeServicesCommand({ cluster: C.cluster, services: [C.service], include: ['TAGS'] })),
  ]);
  const stack = sr.Stacks?.[0], service = sv.services?.[0];
  demand(sr.Stacks?.length === 1 && stack.StackId === C.stack && stack.StackStatus === (phase === 'before' ? 'CREATE_COMPLETE' : 'UPDATE_COMPLETE') &&
    stack.RoleARN === C.role && same(tags(stack.Tags), tags(request.Tags)), 'STACK_ID_STATUS_ROLE_TAGS');
  const template = typeof tr.TemplateBody === 'string' ? JSON.parse(tr.TemplateBody) : tr.TemplateBody;
  demand(same(template, phase === 'before' ? historical.plan.futureTemplate.template : JSON.parse(request.TemplateBody)), 'STACK_TEMPLATE_DRIFT');
  const parameters = Object.fromEntries((stack.Parameters || []).map(p => [p.ParameterKey, p.ParameterValue]));
  demand(Object.keys(parameters).length === 20, 'PARAMETER_COUNT');
  for (const [k, spec] of Object.entries(historical.plan.futureTemplate.template.Parameters)) {
    const wanted = k === 'ImageUri' ? imageUri(phase === 'before' ? C.oldDigest : C.newDigest)
      : historical.plan.futureTemplate.parameters[k] ?? spec.Default;
    demand(spec.NoEcho ? parameters[k] === '****' : parameters[k] === wanted, 'PARAMETER_DRIFT');
  }
  demand(!rs.NextToken, 'RESOURCE_PAGINATION');
  const physical = assertResources(rs.StackResourceSummaries, phase, baseline?.physical);
  demand(!sv.failures?.length && sv.services?.length === 1 && service.status === 'ACTIVE' && service.desiredCount === 1 &&
    service.runningCount === 1 && service.pendingCount === 0 && service.taskDefinition === physical.TenantTaskDefinition &&
    service.deployments?.length === 1 && service.deployments[0].status === 'PRIMARY' &&
    service.deployments[0].rolloutState === 'COMPLETED' && service.enableExecuteCommand === false &&
    service.platformVersion === '1.4.0', 'SERVICE_NOT_STABLE');
  const [td, lt] = await Promise.all([
    send(api.ecs, new ecs.DescribeTaskDefinitionCommand({ taskDefinition: service.taskDefinition, include: ['TAGS'] })),
    send(api.ecs, new ecs.ListTasksCommand({ cluster: C.cluster, serviceName: C.service, desiredStatus: 'RUNNING' })),
  ]);
  demand(!lt.nextToken && lt.taskArns?.length === 1 && td.taskDefinition?.status === 'ACTIVE', 'TASK_INVENTORY');
  const tasks = await send(api.ecs, new ecs.DescribeTasksCommand({ cluster: C.cluster, tasks: lt.taskArns }));
  const task = tasks.tasks?.[0], container = task?.containers?.[0], digest = phase === 'before' ? C.oldDigest : C.newDigest;
  demand(!tasks.failures?.length && tasks.tasks?.length === 1 && task.taskDefinitionArn === service.taskDefinition &&
    task.lastStatus === 'RUNNING' && task.desiredStatus === 'RUNNING' && task.healthStatus === 'HEALTHY' &&
    task.containers?.length === 1 && container.image === imageUri(digest) && container.imageDigest === digest &&
    container.healthStatus === 'HEALTHY', 'ACTUAL_RUNNING_IMAGE');
  const projection = taskProjection(td.taskDefinition), actualTaskSha256 = hash(projection);
  const serviceProjection = { serviceArn: service.serviceArn, clusterArn: service.clusterArn, desiredCount: service.desiredCount,
    deploymentConfiguration: service.deploymentConfiguration, capacityProviderStrategy: service.capacityProviderStrategy,
    networkConfiguration: service.networkConfiguration, loadBalancers: service.loadBalancers, platformVersion: service.platformVersion,
    enableExecuteCommand: service.enableExecuteCommand, propagateTags: service.propagateTags, tags: tags(service.tags) };
  const noImageParameters = { ...parameters }; delete noImageParameters.ImageUri;
  const stable = { physical, taskBeforeSha256: actualTaskSha256,
    taskAfterSha256: phase === 'before' ? hash(expectedTaskProjection(td.taskDefinition)) : actualTaskSha256,
    taskTagsSha256: hash(tags(td.tags)), serviceSha256: hash(serviceProjection), parametersSha256: hash(noImageParameters),
    outputsSha256: hash(stack.Outputs), stackCreationTime: stack.CreationTime?.toISOString() };
  if (phase === 'after') {
    demand(actualTaskSha256 === baseline.taskAfterSha256 && stable.taskTagsSha256 === baseline.taskTagsSha256 &&
      stable.serviceSha256 === baseline.serviceSha256 && stable.parametersSha256 === baseline.parametersSha256 &&
      stable.outputsSha256 === baseline.outputsSha256 && stable.stackCreationTime === baseline.stackCreationTime, 'AFTER_SPEC_DRIFT');
  }
  const [image, scan, repo, scanning] = await Promise.all([
    cli(['ecr', 'batch-get-image', '--repository-name', C.repository, '--image-ids', 'imageDigest=' + C.newDigest]),
    cli(['ecr', 'describe-image-scan-findings', '--repository-name', C.repository, '--image-id', 'imageDigest=' + C.newDigest]),
    cli(['ecr', 'describe-repositories', '--repository-names', C.repository]), cli(['ecr', 'get-registry-scanning-configuration']),
  ]);
  const im = image.images?.[0], repository = repo.repositories?.[0], counts = scan.imageScanFindings?.findingSeverityCounts;
  demand(image.images?.length === 1 && !image.failures?.length && im.imageId?.imageDigest === C.newDigest &&
    im.imageManifestMediaType === 'application/vnd.docker.distribution.manifest.v2+json' &&
    'sha256:' + hash(im.imageManifest) === C.newDigest && JSON.parse(im.imageManifest).config?.digest === C.configDigest,
  'ECR_MANIFEST');
  demand(scan.imageId?.imageDigest === C.newDigest && scan.imageScanStatus?.status === 'COMPLETE' && counts &&
    !(counts.HIGH || counts.CRITICAL) && repo.repositories?.length === 1 && repository.repositoryUri === C.registry + '/' + C.repository &&
    repository.imageTagMutability === 'IMMUTABLE' && repository.imageScanningConfiguration?.scanOnPush === true &&
    scanning.scanningConfiguration?.scanType === 'BASIC', 'ECR_SCAN_OR_REPOSITORY');
  const transaction = historical.plan.proposedEpochTransaction.TransactItems;
  for (const entry of transaction) {
    const spec = entry.ConditionCheck || entry.Put, expected = entry.Put?.Item;
    const key = spec.Key || { authority_key: expected.authority_key };
    const got = await send(api.ddb, new GetItemCommand({ TableName: spec.TableName, Key: key, ConsistentRead: true }));
    demand(expected ? same(got.Item, expected) : got.Item === undefined, 'AUTHORITY_DRIFT');
  }
  const wantedDns = historical.plan.proposedDnsCreate, targetArn = physical.TenantTargetGroup;
  const [health, records] = await Promise.all([
    cli(['elbv2', 'describe-target-health', '--target-group-arn', targetArn]),
    cli(['route53', 'list-resource-record-sets', '--hosted-zone-id', wantedDns.HostedZoneId,
      '--start-record-name', 'first-acceptance.sandbox.techlong.cloud.', '--start-record-type', 'A', '--max-items', '1']),
  ]);
  const healthy = health.TargetHealthDescriptions, ips = task.attachments?.flatMap(a => a.details || [])
    .filter(d => d.name === 'privateIPv4Address').map(d => d.value) || [];
  demand(healthy?.length === 1 && healthy[0].TargetHealth?.State === 'healthy' && healthy[0].Target.Port === 3000 &&
    ips.includes(healthy[0].Target.Id), 'TARGET_HEALTH');
  const dns = records.ResourceRecordSets?.[0], wantDns = wantedDns.ChangeBatch.Changes[0].ResourceRecordSet;
  const normalizeDns = record => ({ ...record, AliasTarget: record.AliasTarget && { ...record.AliasTarget,
    DNSName: record.AliasTarget.DNSName.replace(/\.$/, '').replace(/^dualstack\./, '') } });
  demand(same(normalizeDns(dns), normalizeDns(wantDns)), 'DNS_DRIFT');
  const validation = await send(api.cfn, new cfn.ValidateTemplateCommand({ TemplateBody: request.TemplateBody }));
  demand(!validation.Capabilities?.length, 'TEMPLATE_CAPABILITIES');
  // Detect a stack change during the other reads. This is not cross-service CAS.
  const final = await send(api.cfn, new cfn.DescribeStacksCommand({ StackName: C.stack }));
  demand(same(final.Stacks?.[0], stack), 'STACK_CHANGED_DURING_READS');
  if (phase === 'after') {
    const events = await send(api.cfn, new cfn.DescribeStackEventsCommand({ StackName: C.stack }));
    demand(events.StackEvents?.some(e => e.PhysicalResourceId === C.stack && e.ResourceType === 'AWS::CloudFormation::Stack' &&
      e.ResourceStatus === 'UPDATE_COMPLETE' && e.ClientRequestToken === request.ClientRequestToken), 'UPDATE_CORRELATION');
  }
  demand(Date.now() - startedAt < 180000, 'READ_SET_TOO_OLD');
  return { schema: 'techlong/express-image-repair-observation/v1', startedAt, checkedAt: Date.now(), phase,
    baseline: stable, taskArn: task.taskArn, taskDefinitionArn: service.taskDefinition, actualImageDigest: digest,
    iamLayoutUnchanged: true, authorityUnchanged: true, dnsUnchanged: true, targetHealthy: true,
    ecrScanComplete: true, high: 0, critical: 0, sdkReads, cliReads, actualWrites: 0,
    SQLConnections: 0, operatorSecretReads: 0, applicationRequests: 0, readyVerified: false };
}
