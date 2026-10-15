// Metadata only. No SQL, Secret values, IAM writer or deployment command.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import * as iamSdk from '@aws-sdk/client-iam';
import { CloudFormationClient, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { compileAcceptanceCellIam, ACCEPTANCE_CELL_IAM as T } from '../../../lib/deployments/execution/single-tenant-cell-iam.ts';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const exec = promisify(execFile), decode = v => typeof v === 'string' ? JSON.parse(decodeURIComponent(v)) : v;
export const COMPUTE_CERTIFICATE = 'arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d';
export const COMPUTE_TRUSTSTORE = 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44';
export function computeClientConfig() { return { region: T.region, maxAttempts: 1, ignoreConfiguredEndpointUrls: true,
  credentials: fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } }) }; }
export async function observeExpressCompute({ tags, oldStackId, signal }) {
  let calls = 0; const config = computeClientConfig(), sts = new STSClient(config), iam = new iamSdk.IAMClient(config), cfn = new CloudFormationClient(config);
  const send = (client, command) => { signal.throwIfAborted(); if (++calls > 38) throw Error('COMPUTE_READ_BUDGET'); return client.send(command, { abortSignal: signal }); };
  const cli = async (args, notFound) => {
    signal.throwIfAborted(); if (++calls > 38) throw Error('COMPUTE_READ_BUDGET');
    try { const r = await exec('aws', [...args, '--profile', 'techlong-sandbox-user', '--region', T.region, '--no-cli-pager', '--output', 'json'],
      { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, signal,
        env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_CLI_AUTO_PROMPT: 'off' } }); return JSON.parse(r.stdout); }
    catch (e) { if (notFound && new RegExp('\\(' + notFound + '\\) when calling the').test(String(e.stderr))) return null; throw e; }
  };
  try {
    const who = await send(sts, new GetCallerIdentityCommand({}));
    if (who.Account !== T.account || who.Arn !== T.sourceArn || who.UserId !== T.sourceUserId) throw Error('COMPUTE_SOURCE_CHANGED');
    const [r, p, v, inline, names, attached, rk, sk, ecsRole, elbRole] = await Promise.all([
      send(iam, new iamSdk.GetRoleCommand({ RoleName: T.roleName })), send(iam, new iamSdk.GetPolicyCommand({ PolicyArn: T.boundaryArn })),
      send(iam, new iamSdk.GetPolicyVersionCommand({ PolicyArn: T.boundaryArn, VersionId: 'v1' })),
      send(iam, new iamSdk.GetRolePolicyCommand({ RoleName: T.roleName, PolicyName: 'FirstAcceptanceCellResourcesV1' })),
      send(iam, new iamSdk.ListRolePoliciesCommand({ RoleName: T.roleName })), send(iam, new iamSdk.ListAttachedRolePoliciesCommand({ RoleName: T.roleName })),
      cli(['kms', 'describe-key', '--key-id', 'alias/aws/rds']), cli(['kms', 'describe-key', '--key-id', 'alias/aws/secretsmanager']),
      send(iam, new iamSdk.GetRoleCommand({ RoleName: 'AWSServiceRoleForECS' })),
      send(iam, new iamSdk.GetRoleCommand({ RoleName: 'AWSServiceRoleForElasticLoadBalancing' })),
    ]);
    const expected = await compileAcceptanceCellIam({ rdsKmsKeyArn: rk.KeyMetadata.Arn, secretsKmsKeyArn: sk.KeyMetadata.Arn });
    const role = r.Role, same = (a, b) => canonicalJson(a) === canonicalJson(b), ts = x => [...x || []].sort((a, b) => a.Key.localeCompare(b.Key));
    if (role?.RoleId !== 'AROAV3GNMXTZESNMKM56K' || role.Arn !== T.roleArn || p.Policy?.PolicyId !== 'ANPAV3GNMXTZL4VMJHXXZ' || p.Policy.DefaultVersionId !== 'v1' ||
        role.PermissionsBoundary?.PermissionsBoundaryArn !== T.boundaryArn || role.MaxSessionDuration !== 3600 || !same(ts(role.Tags), ts(expected.tags)) ||
        !same(decode(role.AssumeRolePolicyDocument), expected.trustDocument) || !same(decode(inline.PolicyDocument), expected.policyDocument) ||
        v.PolicyVersion?.VersionId !== 'v1' || v.PolicyVersion.IsDefaultVersion !== true || !same(decode(v.PolicyVersion.Document), expected.boundaryDocument) ||
        names.IsTruncated || !same(names.PolicyNames, [expected.inlinePolicyName]) || attached.IsTruncated || attached.AttachedPolicies?.length !== 0 ||
        ![rk, sk].every(x => x.KeyMetadata.KeyManager === 'AWS' && x.KeyMetadata.Enabled === true)) throw Error('COMPUTE_EXISTING_IAM_CHANGED');
    const linked = await Promise.all([{ r: ecsRole.Role, service: 'ecs.amazonaws.com' }, { r: elbRole.Role, service: 'elasticloadbalancing.amazonaws.com' }].map(async ({ r, service }) => {
      const trust = decode(r?.AssumeRolePolicyDocument);
      if (!r?.RoleId || r.Path !== '/aws-service-role/' + service + '/' || !trust?.Statement?.some(s => s.Effect === 'Allow' && s.Principal?.Service === service && s.Action === 'sts:AssumeRole')) throw Error('COMPUTE_EXISTING_SERVICE_ROLE_REQUIRED');
      return { arn: r.Arn, id: r.RoleId, service, trustSha256: await sha256Hex(trust) };
    }));
    let stack = null;
    try {
      const result = await send(cfn, new DescribeStacksCommand({ StackName: T.cellName }));
      if (result.Stacks?.length !== 1) throw Error('COMPUTE_STACK_ROWS'); const s = result.Stacks[0];
      const [template, resources] = await Promise.all([send(cfn, new GetTemplateCommand({ StackName: s.StackId, TemplateStage: 'Original' })),
        send(cfn, new ListStackResourcesCommand({ StackName: s.StackId }))]);
      if (resources.NextToken || resources.StackResourceSummaries?.length > 25 || !s.StackId || !s.RoleARN ||
          typeof template.TemplateBody !== 'string' || new Set((s.Tags || []).map(t => t.Key)).size !== (s.Tags || []).length) throw Error('COMPUTE_STACK_METADATA_REJECTED');
      stack = { stackId: s.StackId, status: s.StackStatus, roleArn: s.RoleARN, tags: Object.fromEntries((s.Tags || []).map(t => [t.Key, t.Value])),
        templateSha256: await sha256Hex(JSON.parse(template.TemplateBody)),
        resources: (resources.StackResourceSummaries || []).map(x => ({ logicalId: x.LogicalResourceId, type: x.ResourceType,
          physicalId: x.PhysicalResourceId || null, status: x.ResourceStatus })).sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
        outputs: Object.fromEntries((s.Outputs || []).map(x => [x.OutputKey, x.OutputValue])),
        parameters: Object.fromEntries((s.Parameters || []).map(x => [x.ParameterKey, x.ParameterValue])), terminationProtection: s.EnableTerminationProtection === true };
    } catch (e) { if (!(e.name === 'ValidationError' && e.message === `Stack with id ${T.cellName} does not exist`)) throw e; }
    const [vs, lb, ec, cert, trust, az] = await Promise.all([
      cli(['ec2', 'describe-vpcs', '--filters', 'Name=tag:CellId,Values=cell-sandbox-1']),
      cli(['elbv2', 'describe-load-balancers', '--names', T.cellName], 'LoadBalancerNotFound'),
      cli(['ecs', 'describe-clusters', '--clusters', 'cell-sandbox-1']),
      cli(['acm', 'describe-certificate', '--certificate-arn', COMPUTE_CERTIFICATE]),
      cli(['elbv2', 'describe-trust-stores', '--trust-store-arns', COMPUTE_TRUSTSTORE]),
      cli(['ec2', 'describe-availability-zones', '--zone-names', 'ca-central-1a', 'ca-central-1b']),
    ]);
    if (cert.Certificate?.CertificateArn !== COMPUTE_CERTIFICATE || cert.Certificate.Status !== 'ISSUED' ||
        !cert.Certificate.SubjectAlternativeNames?.includes('*.sandbox.techlong.cloud') || new Date(cert.Certificate.NotAfter).getTime() < Date.now() + 86400000 ||
        trust.TrustStores?.length !== 1 || trust.TrustStores[0].TrustStoreArn !== COMPUTE_TRUSTSTORE || trust.TrustStores[0].Status !== 'ACTIVE' ||
        az.AvailabilityZones?.length !== 2 || !az.AvailabilityZones.every(z => z.State === 'available')) throw Error('COMPUTE_TLS_OR_AZ_CHANGED');
    const contexts = entries => Object.entries(entries).map(([ContextKeyName, value]) => ({ ContextKeyName, ContextKeyValues: [value], ContextKeyType: 'string' }));
    const namespace = `arn:aws:cloudformation:${T.region}:${T.account}:stack/${T.cellName}/*`;
    const cases = [
      { name: 'create', action: 'cloudformation:CreateStack', resource: namespace, ctx: { 'cloudformation:RoleArn': T.roleArn, ...Object.fromEntries(Object.entries(tags).map(([k, v]) => ['aws:RequestTag/' + k, v])) } },
      { name: 'retire', action: 'cloudformation:DeleteStack', resource: oldStackId, ctx: { 'cloudformation:RoleArn': T.roleArn, ...Object.fromEntries(Object.entries(stack?.stackId === oldStackId ? stack.tags : tags).map(([k, v]) => ['aws:ResourceTag/' + k, v])) } },
      { name: 'futureExactCleanupNamespace', action: 'cloudformation:DeleteStack', resource: namespace, ctx: { 'cloudformation:RoleArn': T.roleArn, ...Object.fromEntries(Object.entries(tags).map(([k, v]) => ['aws:ResourceTag/' + k, v])) } },
      { name: 'passRole', action: 'iam:PassRole', resource: T.roleArn, ctx: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } },
    ];
    const simulations = await Promise.all(cases.map(async x => { const r = await send(iam, new iamSdk.SimulatePrincipalPolicyCommand({ PolicySourceArn: T.sourceArn,
      ActionNames: [x.action], ResourceArns: [x.resource], ContextEntries: contexts({ ...x.ctx, 'aws:RequestedRegion': T.region }) })); const e = r.EvaluationResults?.[0];
      return { name: x.name, action: x.action, resource: x.resource, allowed: r.EvaluationResults?.length === 1 && e.EvalActionName === x.action && e.EvalResourceName === x.resource && e.EvalDecision === 'allowed' && !e.MissingContextValues?.length,
        decision: e?.EvalDecision, missingContext: e?.MissingContextValues || [] }; }));
    return { observedAt: Date.now(), source: { Account: who.Account, Arn: who.Arn, UserId: who.UserId }, existingIamVerified: true,
      iam: { roleId: role.RoleId, policyId: p.Policy.PolicyId, boundaryVersion: 'v1', materialSha256: expected.materialSha256, serviceLinkedRoles: linked },
      stack, namespace: { vpcs: (vs.Vpcs || []).map(x => x.VpcId).sort(),
        loadBalancers: (lb?.LoadBalancers || []).map(x => ({ arn: x.LoadBalancerArn, vpcId: x.VpcId, dnsName: x.DNSName, hostedZoneId: x.CanonicalHostedZoneId })),
        ecs: { failures: ec.failures || [], clusters: (ec.clusters || []).map(x => ({ arn: x.clusterArn, name: x.clusterName, status: x.status,
          running: x.runningTasksCount, pending: x.pendingTasksCount, services: x.activeServicesCount })) } },
      prerequisites: { certificateArn: COMPUTE_CERTIFICATE, certificateNotAfter: new Date(cert.Certificate.NotAfter).toISOString(), truststoreArn: COMPUTE_TRUSTSTORE, truststoreActive: true,
        zones: az.AvailabilityZones.map(z => z.ZoneName).sort() }, simulations, metadataCalls: calls, simulationIsProviderProof: false, awsWrites: 0, secretValueReads: 0 };
  } finally { sts.destroy(); iam.destroy(); cfn.destroy(); }
}
