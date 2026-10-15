// Concrete metadata only. No simulations, Secret values, SQL/Aurora connection,
// IAM mutations or resource changes. Every read has a hard budget/timeout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveNs } from 'node:dns/promises';
import * as iam from '@aws-sdk/client-iam';
import * as cfn from '@aws-sdk/client-cloudformation';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { SecretsManagerClient, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { inspectExpressDeliveryControlPlaneV1 } from '../../../lib/deployments/execution/express-delivery-control-plane-v1.ts';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { EXPRESS_LIVE_RESOURCES_V1 as C } from '../../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
const exec = promisify(execFile), same = (a, b) => canonicalJson(a) === canonicalJson(b);
const decode = d => typeof d === 'string' ? JSON.parse(decodeURIComponent(d)) : d;
const sorted = a => [...a].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
function fail(code) { throw Error('LIVE_METADATA_' + code); }

export async function observeExpressLiveMetadataV1({ inputs, plan, sql, signal }) {
  const startedAt = Date.now(); let sdkCalls = 0, cliCalls = 0, neonReadonlyAttempts = 0;
  const config = { region: 'ca-central-1', maxAttempts: 1, ignoreConfiguredEndpointUrls: true,
    credentials: fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } }) };
  const sts = new STSClient({ ...config, endpoint: 'https://sts.ca-central-1.amazonaws.com' }), ic = new iam.IAMClient(config),
    cc = new cfn.CloudFormationClient(config), sm = new SecretsManagerClient(config), dc = new DynamoDBClient(config);
  const send = (client, command) => { signal.throwIfAborted(); if (++sdkCalls > 55) fail('READ_BUDGET');
    return client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); };
  const cli = async (args, missing) => {
    signal.throwIfAborted(); if (++cliCalls > 20) fail('CLI_BUDGET');
    try { const r = await exec('aws', [...args, '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1', '--no-cli-pager', '--output', 'json'],
      { windowsHide: true, signal, timeout: 30000, maxBuffer: 4_000_000,
        env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_CLI_AUTO_PROMPT: 'off', AWS_PAGER: '' } }); return JSON.parse(r.stdout); }
    catch (e) { if (missing && String(e.stderr).includes('(' + missing + ') when calling the')) return null; throw e; }
  };
  const consumers = r => ({ roles: (r.PolicyRoles || []).map(x => ({ name: x.RoleName, id: x.RoleId })).sort((a, b) => a.name.localeCompare(b.name)),
    users: (r.PolicyUsers || []).map(x => ({ name: x.UserName, id: x.UserId })).sort((a, b) => a.name.localeCompare(b.name)),
    groups: (r.PolicyGroups || []).map(x => ({ name: x.GroupName, id: x.GroupId })).sort((a, b) => a.name.localeCompare(b.name)) });
  try {
    const who = await send(sts, new GetCallerIdentityCommand({}));
    if (who.Account !== '402010193138' || who.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' || who.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('SOURCE_CHANGED');
    const validation = await send(cc, new cfn.ValidateTemplateCommand({ TemplateBody: plan.futureTemplate.templateBody }));
    if (validation.Capabilities?.length) fail('UNEXPECTED_TEMPLATE_CAPABILITY');
    const roles = [];
    for (const wanted of inputs.iamBefore.roles.filter(r => ['TechlongSandboxTaskExecutionRole', 'TechlongSandboxTaskRole'].includes(r.name))) {
      const RoleName = wanted.name, [rr, names, attached] = await Promise.all([send(ic, new iam.GetRoleCommand({ RoleName })),
        send(ic, new iam.ListRolePoliciesCommand({ RoleName })), send(ic, new iam.ListAttachedRolePoliciesCommand({ RoleName }))]);
      if (names.IsTruncated || attached.IsTruncated || !names.PolicyNames || names.PolicyNames.length > 2) fail('ROLE_INVENTORY');
      const inline = [];
      for (const PolicyName of names.PolicyNames) inline.push({ name: PolicyName,
        document: decode((await send(ic, new iam.GetRolePolicyCommand({ RoleName, PolicyName }))).PolicyDocument) });
      const r = rr.Role, actual = { name: RoleName, id: r?.RoleId, arn: r?.Arn, trust: decode(r?.AssumeRolePolicyDocument),
        boundaryArn: r?.PermissionsBoundary?.PermissionsBoundaryArn, attached: attached.AttachedPolicies || [],
        inline: inline.sort((a, b) => a.name.localeCompare(b.name)), tags: Object.fromEntries((r?.Tags || []).map(t => [t.Key, t.Value])) };
      if (!same(actual, wanted)) fail('TASK_ROLE_DRIFT'); roles.push(actual);
    }
    if (roles.length !== 2) fail('TASK_ROLE_BASELINE');
    const RoleName = 'TechlongSandboxCloudFormationExecutionRole', [role, names, attached] = await Promise.all([
      send(ic, new iam.GetRoleCommand({ RoleName })), send(ic, new iam.ListRolePoliciesCommand({ RoleName })), send(ic, new iam.ListAttachedRolePoliciesCommand({ RoleName }))]);
    const actualCfn = { arn: role.Role?.Arn, id: role.Role?.RoleId, trust: decode(role.Role?.AssumeRolePolicyDocument),
      boundaryArn: role.Role?.PermissionsBoundary?.PermissionsBoundaryArn, inlineNames: (names.PolicyNames || []).sort(),
      attached: (attached.AttachedPolicies || []).map(p => p.PolicyArn).sort() };
    if (names.IsTruncated || attached.IsTruncated || !same(actualCfn, inputs.cfnInventory.role)) fail('CFN_ROLE_DRIFT');
    const policies = [];
    for (const wanted of [inputs.cfnInventory.policy, inputs.iamBefore.boundary]) {
      const PolicyArn = wanted.arn, [policy, versions, boundary, permission] = await Promise.all([
        send(ic, new iam.GetPolicyCommand({ PolicyArn })), send(ic, new iam.ListPolicyVersionsCommand({ PolicyArn })),
        send(ic, new iam.ListEntitiesForPolicyCommand({ PolicyArn, PolicyUsageFilter: 'PermissionsBoundary', MaxItems: 100 })),
        send(ic, new iam.ListEntitiesForPolicyCommand({ PolicyArn, PolicyUsageFilter: 'PermissionsPolicy', MaxItems: 100 }))]);
      if (versions.IsTruncated || boundary.IsTruncated || permission.IsTruncated || policy.Policy?.DefaultVersionId !== wanted.defaultVersion) fail('POLICY_VERSION_DRIFT');
      const doc = await send(ic, new iam.GetPolicyVersionCommand({ PolicyArn, VersionId: wanted.defaultVersion }));
      const actual = { arn: PolicyArn, id: policy.Policy.PolicyId, defaultVersion: policy.Policy.DefaultVersionId,
        document: decode(doc.PolicyVersion?.Document), versions: versions.Versions.map(v => ({ id: v.VersionId, isDefault: v.IsDefaultVersion })),
        boundaryConsumers: consumers(boundary), permissionConsumers: consumers(permission) };
      if (!doc.PolicyVersion?.IsDefaultVersion || !same({ ...actual, versions: sorted(actual.versions) }, { ...wanted, versions: sorted(wanted.versions) })) fail('POLICY_DOCUMENT_OR_CONSUMER_DRIFT');
      policies.push(actual);
    }
    const secrets = [];
    for (const [arn, fixedVersion] of [[C.controlPublicKeyArn, C.controlPublicKeyVersion],
      [inputs.source.material.binding.runtimeSecret.arn, inputs.source.material.binding.runtimeSecret.versionId]]) {
      const s = await send(sm, new DescribeSecretCommand({ SecretId: arn }));
      if (s.ARN !== arn || s.DeletedDate || s.RotationEnabled || s.ReplicationStatus?.length ||
          !same(s.VersionIdsToStages, { [fixedVersion]: ['AWSCURRENT'] })) fail('FIXED_SECRET_DRIFT');
      secrets.push({ arn, fixedVersion, name: s.Name, tags: s.Tags, kmsKeyId: s.KmsKeyId || 'alias/aws/secretsmanager' });
    }
    const [sr, tr, rs] = await Promise.all([send(cc, new cfn.DescribeStacksCommand({ StackName: plan.computeStackId })),
      send(cc, new cfn.GetTemplateCommand({ StackName: plan.computeStackId, TemplateStage: 'Original' })),
      send(cc, new cfn.ListStackResourcesCommand({ StackName: plan.computeStackId }))]);
    const stack = sr.Stacks?.[0], outputs = Object.fromEntries((stack?.Outputs || []).map(v => [v.OutputKey, v.OutputValue]));
    if (sr.Stacks?.length !== 1 || stack.StackId !== plan.computeStackId || stack.StackStatus !== 'CREATE_COMPLETE' ||
        stack.RoleARN !== 'arn:aws:iam::402010193138:role/TechlongSandboxFirstAcceptanceCellExecutionRole' ||
        !same(outputs, inputs.compute.outputs) || !tr.TemplateBody || await sha256Hex(JSON.parse(tr.TemplateBody)) !== plan.computeTemplateSha256 ||
        rs.NextToken || rs.StackResourceSummaries?.length !== 16 || rs.StackResourceSummaries.some(r => r.ResourceStatus !== 'CREATE_COMPLETE')) fail('COMPUTE_DRIFT');
    const props = plan.futureTemplate.template.Resources;
    let stackAbsent = false;
    try { await send(cc, new cfn.DescribeStacksCommand({ StackName: plan.futureTemplate.stackName })); }
    catch (e) { if (e.name === 'ValidationError' && e.message === `Stack with id ${plan.futureTemplate.stackName} does not exist`) stackAbsent = true; else throw e; }
    const [lb, zone, records, service, target, logs, definitions, cluster, rds] = await Promise.all([
      cli(['elbv2', 'describe-load-balancers', '--load-balancer-arns', inputs.compute.loadBalancer.arn]),
      cli(['route53', 'get-hosted-zone', '--id', plan.proposedDnsCreate.HostedZoneId]),
      cli(['route53', 'list-resource-record-sets', '--hosted-zone-id', plan.proposedDnsCreate.HostedZoneId, '--start-record-name', inputs.delivery.tenantHostname, '--max-items', '2']),
      cli(['ecs', 'describe-services', '--cluster', outputs.ClusterName, '--services', props.TenantService.Properties.ServiceName]),
      cli(['elbv2', 'describe-target-groups', '--names', props.TenantTargetGroup.Properties.Name], 'TargetGroupNotFound'),
      cli(['logs', 'describe-log-groups', '--log-group-name-prefix', props.TenantLogGroup.Properties.LogGroupName, '--limit', '5']),
      cli(['ecs', 'list-task-definitions', '--family-prefix', props.TenantTaskDefinition.Properties.Family, '--status', 'ACTIVE']),
      cli(['ecs', 'describe-clusters', '--clusters', outputs.ClusterName]),
      cli(['rds', 'describe-db-clusters', '--db-cluster-identifier', 'techlong-sandbox-express-d001']),
    ]);
    const l = lb.LoadBalancers?.[0], c = cluster.clusters?.[0], database = rds.DBClusters?.[0], b = inputs.source.material.binding;
    if (lb.LoadBalancers?.length !== 1 || l.LoadBalancerArn !== inputs.compute.loadBalancer.arn || l.VpcId !== outputs.VpcId ||
        l.DNSName !== inputs.compute.loadBalancer.dnsName || l.CanonicalHostedZoneId !== inputs.compute.loadBalancer.hostedZoneId || l.State?.Code !== 'active' ||
        cluster.failures?.length || cluster.clusters?.length !== 1 || c.status !== 'ACTIVE' || c.runningTasksCount || c.pendingTasksCount || c.activeServicesCount ||
        zone.HostedZone?.Name !== 'sandbox.techlong.cloud.' || zone.HostedZone.Config?.PrivateZone ||
        !same((await resolveNs('sandbox.techlong.cloud')).sort(), [...zone.DelegationSet.NameServers].sort()) ||
        rds.DBClusters?.length !== 1 || database.DBClusterArn !== b.clusterArn || database.DbClusterResourceId !== b.clusterResourceId ||
        database.Endpoint !== b.endpoint || database.Port !== 5432 || database.Engine !== 'aurora-postgresql' || database.EngineVersion !== '17.9' ||
        database.MasterUsername !== 'postgres' || database.MasterUserSecret || database.IAMDatabaseAuthenticationEnabled !== true ||
        database.InternetAccessGatewayEnabled !== true || database.VPCNetworkingEnabled !== false || database.Status !== 'available' ||
        !same(database.ServerlessV2ScalingConfiguration, { MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 })) fail('NETWORK_DNS_OR_DATABASE_DRIFT');
    const rules = [];
    for (const [listener, forbidden] of [[outputs.HttpsListenerArn, ['100', '101']], [outputs.ControlListenerArn, ['100']]]) {
      const r = await cli(['elbv2', 'describe-rules', '--listener-arn', listener]);
      if (r.NextMarker || !r.Rules || r.Rules.some(v => forbidden.includes(v.Priority))) fail('LISTENER_COLLISION');
      rules.push({ listener, rules: r.Rules });
    }
    const serviceArn = 'arn:aws:ecs:ca-central-1:402010193138:service/cell-sandbox-1/' + props.TenantService.Properties.ServiceName;
    if (!stackAbsent || records.ResourceRecordSets?.some(r => r.Name === inputs.delivery.tenantHostname + '.') ||
        service.services?.length || service.failures?.length !== 1 || service.failures[0].arn !== serviceArn || service.failures[0].reason !== 'MISSING' ||
        target || logs.logGroups?.some(g => g.logGroupName === props.TenantLogGroup.Properties.LogGroupName) ||
        definitions.taskDefinitionArns?.some(a => a.includes('/' + props.TenantTaskDefinition.Properties.Family + ':'))) fail('NAMESPACE_COLLISION');
    const images = [];
    for (const image of [inputs.source.material.images.app, inputs.source.material.images.lifecycle]) {
      const digest = image.split('@')[1], got = await cli(['ecr', 'batch-get-image', '--repository-name', 'techlong-sandbox-speedfeast', '--image-ids', 'imageDigest=' + digest]);
      if (got.images?.length !== 1 || got.failures?.length || got.images[0].imageId.imageDigest !== digest ||
          got.images[0].imageManifestMediaType !== 'application/vnd.docker.distribution.manifest.v2+json') fail('IMAGE_DRIFT');
      images.push({ digest, manifestSha256: await sha256Hex(got.images[0].imageManifest) });
    }
    const control = await inspectExpressDeliveryControlPlaneV1({ material: inputs.source.material,
      materialSha256: inputs.source.materialSha256, signal, port: {
        identity: async () => who, async authority(key) { return (await send(dc, new GetItemCommand({
          TableName: C.epochTableArn, Key: { authority_key: { S: key } }, ConsistentRead: true }))).Item; },
        query: (text, values, s) => { neonReadonlyAttempts++; return sql.query(text, values, s); } } });
    if (control.outcome !== 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED' || control.subscriptionId !== plan.subscriptionId) fail('CONTROL_PLANE_DRIFT');
    const observation = { schema: 'techlong/express-live-metadata/v1', startedAt, checkedAt: Date.now(),
      source: { Account: who.Account, Arn: who.Arn, UserId: who.UserId }, roles, cfnRole: actualCfn, policies, secrets,
      compute: { stackId: stack.StackId, outputs, templateSha256: plan.computeTemplateSha256, resources: rs.StackResourceSummaries },
      templateValidation: { parameters: validation.Parameters, capabilities: validation.Capabilities || [] },
      namespacesAbsent: true, computeAndImagesUnchanged: true, cfnV8Unchanged: true, control, images, rules,
      sdkCalls, cliCalls, sqlReadonlyTransactions: 1, auroraConnections: 0, cloudWrites: 0, secretValueReads: 0 };
    if (observation.checkedAt - startedAt > 90000) fail('OBSERVATION_TOO_SLOW'); return observation;
  } catch (e) {
    const message = /^LIVE_METADATA_/.test(e.message || '') ? e.message : 'LIVE_METADATA_' +
      (['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(e.name) ? 'SOURCE_REFRESH_REQUIRED' : 'PROVIDER_READ_FAILED');
    throw Object.assign(Error(message), { readCounts: { component: 'metadata_only', sdkCalls, cliCalls, neonReadonlyAttempts,
      auroraConnections: 0, actualWrites: 0, privateReads: 0 } });
  } finally { sts.destroy(); ic.destroy(); cc.destroy(); sm.destroy(); dc.destroy(); }
}
