import * as cf from '@aws-sdk/client-cloudformation';
import * as ecs from '@aws-sdk/client-ecs';
import * as iam from '@aws-sdk/client-iam';
import { STSClient } from '@aws-sdk/client-sts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import * as elb from '@aws-sdk/client-elastic-load-balancing-v2';
import * as logs from '@aws-sdk/client-cloudwatch-logs';
import * as dns from '@aws-sdk/client-route-53';
import * as rds from '@aws-sdk/client-rds';
import * as ecr from '@aws-sdk/client-ecr';
import * as scheduler from '@aws-sdk/client-scheduler';
import * as lambda from '@aws-sdk/client-lambda';
import { assertCloudSessionV5, requireCloudV5 as must } from './cloud-session-v5.mjs';
import { canonicalJson } from '../../lib/deployments/execution/hash.ts';
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const decode = value => typeof value === 'string' ? JSON.parse(decodeURIComponent(value)) : value;
const commands = Object.freeze({
  'elb.DescribeTargetGroups': ['elb', elb.DescribeTargetGroupsCommand],
  'elb.DescribeRules': ['elb', elb.DescribeRulesCommand],
  'elb.DescribeTargetHealth': ['elb', elb.DescribeTargetHealthCommand],
  'elb.DescribeListeners': ['elb', elb.DescribeListenersCommand],
  'elb.DescribeLoadBalancers': ['elb', elb.DescribeLoadBalancersCommand],
  'logs.DescribeLogGroups': ['logs', logs.DescribeLogGroupsCommand],
  'dns.ListResourceRecordSets': ['dns', dns.ListResourceRecordSetsCommand],
  'rds.DescribeDBClusters': ['rds', rds.DescribeDBClustersCommand],
  'ecr.BatchGetImage': ['ecr', ecr.BatchGetImageCommand],
  'ecr.DescribeImageScanFindings': ['ecr', ecr.DescribeImageScanFindingsCommand],
  'scheduler.GetSchedule': ['scheduler', scheduler.GetScheduleCommand],
  'lambda.GetFunctionConfiguration': ['lambda', lambda.GetFunctionConfigurationCommand],
});
/** SDK-only replacement for 12 CLI commands. No paginator, Secret value call,
 * SQL, application transport, resource install or mutation is exposed. */
export function createAuxiliaryCloudReadsV5(api) {
  let count = 0;
  return Object.freeze({ async read(operation, input, signal, missingCode) {
    must(Object.hasOwn(commands, operation) && ++count <= 160 && signal instanceof AbortSignal, 'AUXILIARY_READ_ALLOWLIST_OR_BUDGET');
    const [service, Command] = commands[operation];
    try {
      const r = await api[service].send(new Command(structuredClone(input)), {
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
      // Do not propagate Lambda's potentially sensitive environment fields.
      return operation === 'lambda.GetFunctionConfiguration' ? { State: r.State, CodeSha256: r.CodeSha256, FunctionArn: r.FunctionArn } : r;
    } catch (e) {
      if (operation === 'elb.DescribeTargetGroups' && missingCode === 'TargetGroupNotFound' &&
        ['TargetGroupNotFound', 'TargetGroupNotFoundException'].includes(e?.name)) return null;
      throw Error('CLOUD_WORKER_V5_AUXILIARY_READ_FAILED');
    }
  }, count: () => count });
}
export function createCloudAwsClientsV5(session) {
  assertCloudSessionV5(session);
  const regional = session.clientConfig(), global = session.clientConfig(true);
  const api = { cfn: new cf.CloudFormationClient({ ...regional, endpoint: 'https://cloudformation.ca-central-1.amazonaws.com' }),
    ecs: new ecs.ECSClient({ ...regional, endpoint: 'https://ecs.ca-central-1.amazonaws.com' }),
    iam: new iam.IAMClient({ ...global, endpoint: 'https://iam.amazonaws.com' }),
    sts: new STSClient({ ...regional, endpoint: 'https://sts.ca-central-1.amazonaws.com' }),
    ddb: new DynamoDBClient({ ...regional, endpoint: 'https://dynamodb.ca-central-1.amazonaws.com' }),
    sm: new SecretsManagerClient({ ...regional, endpoint: 'https://secretsmanager.ca-central-1.amazonaws.com' }),
    elb: new elb.ElasticLoadBalancingV2Client({ ...regional, endpoint: 'https://elasticloadbalancing.ca-central-1.amazonaws.com' }),
    logs: new logs.CloudWatchLogsClient({ ...regional, endpoint: 'https://logs.ca-central-1.amazonaws.com' }),
    dns: new dns.Route53Client({ ...global, endpoint: 'https://route53.amazonaws.com' }),
    rds: new rds.RDSClient({ ...regional, endpoint: 'https://rds.ca-central-1.amazonaws.com' }),
    ecr: new ecr.ECRClient({ ...regional, endpoint: 'https://api.ecr.ca-central-1.amazonaws.com' }),
    scheduler: new scheduler.SchedulerClient({ ...regional, endpoint: 'https://scheduler.ca-central-1.amazonaws.com' }),
    lambda: new lambda.LambdaClient({ ...regional, endpoint: 'https://lambda.ca-central-1.amazonaws.com' }) };
  return Object.freeze({ api, auxiliary: createAuxiliaryCloudReadsV5(api), destroy() { Object.values(api).forEach(c => c.destroy()); } });
}
/** Same historical role/policy content checks as W3, but identity is checked by
 * the cloud session, never silently accepted as the old IAM User. */
export async function assertCloudIamLayoutV5({ api, historicalPreflight: h, send }) {
  const RoleName = 'TechlongSandboxCloudFormationExecutionRole';
  const [rr, rn, ra] = await Promise.all([send(api.iam, new iam.GetRoleCommand({ RoleName })),
    send(api.iam, new iam.ListRolePoliciesCommand({ RoleName })), send(api.iam, new iam.ListAttachedRolePoliciesCommand({ RoleName }))]);
  must(!rn.IsTruncated && !ra.IsTruncated, 'CFN_ROLE_PAGINATION');
  const r = rr.Role;
  must(same({ arn: r?.Arn, id: r?.RoleId, trust: decode(r?.AssumeRolePolicyDocument), boundaryArn: r?.PermissionsBoundary?.PermissionsBoundaryArn,
    inlineNames: (rn.PolicyNames || []).sort(), attached: (ra.AttachedPolicies || []).map(p => p.PolicyArn).sort() }, h.cfnRole), 'CFN_ROLE_DRIFT');
  for (const wanted of h.policies) {
    const PolicyArn = wanted.arn, p = await send(api.iam, new iam.GetPolicyCommand({ PolicyArn }));
    must(p.Policy?.PolicyId === wanted.id && p.Policy.DefaultVersionId === wanted.defaultVersion, 'POLICY_ID_VERSION');
    const v = await send(api.iam, new iam.GetPolicyVersionCommand({ PolicyArn, VersionId: wanted.defaultVersion }));
    must(v.PolicyVersion?.IsDefaultVersion && same(decode(v.PolicyVersion.Document), wanted.document), 'POLICY_DOCUMENT');
  }
  for (const wanted of h.roles) {
    const RoleName = wanted.name, [rr, n, a] = await Promise.all([send(api.iam, new iam.GetRoleCommand({ RoleName })),
      send(api.iam, new iam.ListRolePoliciesCommand({ RoleName })), send(api.iam, new iam.ListAttachedRolePoliciesCommand({ RoleName }))]);
    must(!n.IsTruncated && !a.IsTruncated && n.PolicyNames?.length === wanted.inline.length, 'TASK_ROLE_INVENTORY');
    const inline = [];
    for (const PolicyName of n.PolicyNames) inline.push({ name: PolicyName,
      document: decode((await send(api.iam, new iam.GetRolePolicyCommand({ RoleName, PolicyName }))).PolicyDocument) });
    const r = rr.Role;
    must(same({ name: RoleName, id: r?.RoleId, arn: r?.Arn, trust: decode(r?.AssumeRolePolicyDocument),
      boundaryArn: r?.PermissionsBoundary?.PermissionsBoundaryArn, attached: a.AttachedPolicies || [],
      inline: inline.sort((a, b) => a.name.localeCompare(b.name)), tags: Object.fromEntries((r?.Tags || []).map(t => [t.Key, t.Value])) }, wanted), 'TASK_ROLE_DRIFT');
  }
  return { iamLayoutUnchanged: true };
}
