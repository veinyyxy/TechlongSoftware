// K3b one-shot inventory: metadata and one Neon READ ONLY transaction only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, open } from 'node:fs/promises';
import { parseEnv, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { hostingInputs } from './review-express-hosting-resume-v1.mjs';
import { readResumeState } from './express-hosting-resume-observer-v1.mjs';
import { H, hash, same, validateRebound } from './express-hosting-resume-plan-v1.mjs';
import { safeFailure } from './inspect-express-hosting-rebind-v1.mjs';

const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop', exec = promisify(execFile);
const READS = new Set(['sts/get-caller-identity', 'cloudformation/describe-stacks', 'cloudformation/list-stack-resources',
  'ecs/describe-services', 'ecs/list-services', 'ecs/list-tasks', 'ecs/describe-tasks', 'ecs/describe-task-definition',
  'logs/describe-log-groups', 'elbv2/describe-target-groups', 'elbv2/describe-target-health', 'elbv2/describe-rules',
  'elbv2/describe-load-balancers', 'elbv2/describe-load-balancer-attributes', 'elbv2/describe-listeners',
  'ec2/describe-nat-gateways', 'ec2/describe-network-interfaces', 'rds/describe-db-clusters', 'secretsmanager/describe-secret',
  'ecr/describe-images', 'scheduler/get-schedule', 'lambda/get-function-configuration', 'route53/list-resource-record-sets',
  'freetier/get-account-plan-state', 'dynamodb/get-item', 'dynamodb/describe-table']);
const check = (v, code) => { if (!v) throw Error('K3B_' + code); };
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] !== undefined).map(k => [k, o[k]]));
const rows = v => (v || []).map(r => pick(r, ['LogicalResourceId', 'PhysicalResourceId', 'ResourceType', 'ResourceStatus', 'LastUpdatedTimestamp']));
const stackView = r => ({ stacks: (r.Stacks || []).map(s => pick(s, ['StackId', 'StackName', 'StackStatus', 'CreationTime', 'DeletionTime', 'Tags', 'RoleARN'])), complete: !r.NextToken });
async function save(file, data) { const f = await open(file, 'wx'); try { await f.writeFile(JSON.stringify(data, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } }
const json = async p => JSON.parse(await readFile(p));
export function exitAssessment({ expiresAt, observedAt, stackStatus, service, taskCount, resources, physicalReferencesAbsent = false }) {
  const expired = Date.parse(observedAt) >= Date.parse(expiresAt);
  const allSevenDeleted = resources.length === 7 && same(Object.fromEntries(resources.map(r => [r.LogicalResourceId, r.ResourceType])), H.resources) && resources.every(r => r.ResourceStatus === 'DELETE_COMPLETE');
  const computeStopped = service?.runningCount === 0 && service?.pendingCount === 0 && service?.desiredCount === 0 && taskCount === 0;
  return { expired, allSevenDeleted, computeStopped, physicalReferencesAbsent, workloadExitProved: stackStatus === 'DELETE_COMPLETE' && allSevenDeleted && computeStopped && physicalReferencesAbsent,
    fullStopBillingProved: false, dataDeletionAuthorized: false, parentDeletionAuthorized: false };
}
export function allowedRead(args) { return READS.has(args.slice(0, 2).join('/')); }
export function parseReadOutput(stdout, command) {
  // execFile has already proved exit code zero. AWS CLI can suppress an empty
  // GetItem body (no Item). This exception is not used for any other operation.
  if (stdout.trim() === '' && command[0] === 'dynamodb' && command[1] === 'get-item') return {};
  return JSON.parse(stdout);
}

export async function main(args = process.argv.slice(2)) {
  check(args.length === 2 && args[0] === '--output' && process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase(), 'ARGUMENTS');
  const out = path.resolve(args[1]); check(path.dirname(out).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-k3b-inventory-[a-z0-9-]+$/.test(path.basename(out)), 'OUTPUT');
  check(!['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CA_BUNDLE',
    'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGOPTIONS']
    .some(k => process.env[k] || process.env[k.toLowerCase()]) && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out); const put = (n, v) => save(out + '/' + n + '.json', v);
  const observations = {}, startedAt = new Date().toISOString(), signal = AbortSignal.timeout(240000); let cliReads = 0, neonTransactions = 0, stage = 'local';
  const read = async (label, command, project, missing = []) => {
    stage = label; check(allowedRead(command) && ++cliReads <= 38, 'READ_ALLOWLIST_BUDGET'); signal.throwIfAborted();
    let observation;
    try { const r = await exec('aws', [...command, '--profile', 'techlong-sandbox-user', '--region', command[0] === 'freetier' ? 'us-east-1' : 'ca-central-1', '--output', 'json', '--no-cli-pager', '--no-paginate'],
      { windowsHide: true, timeout: 30000, signal, maxBuffer: 5_000_000, env: { ...process.env, AWS_MAX_ATTEMPTS: '1',
        AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } });
      const data = parseReadOutput(r.stdout, command); observation = { stage, checkedAt: new Date().toISOString(), presence: 'PRESENT', data: project(data) };
    } catch (e) {
      const providerCode = /\(([A-Za-z0-9]+)\) when calling/.exec(String(e.stderr || ''))?.[1];
      const known = ['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation', 'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired',
        'ResourceNotFoundException', 'ValidationError', 'TargetGroupNotFound', 'RuleNotFound', 'LoadBalancerNotFound', 'DBClusterNotFoundFault', 'ServiceNotFoundException'];
      observation = { stage, checkedAt: new Date().toISOString(), presence: missing.includes(providerCode) ? 'ABSENT' : 'UNKNOWN',
        diagnostic: { ...safeFailure(e, stage), providerCode: known.includes(providerCode) ? providerCode : 'UNCLASSIFIED_CLI_ERROR' } };
      if (['ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired'].includes(providerCode)) { await put(label, observation); throw Error('K3B_SOURCE_REFRESH_REQUIRED'); }
    }
    observations[label] = observation; await put(label, observation); return observation;
  };
  try {
    const vPath = 'ops/aws-sandbox/reviews/aurora-dual-mode-k3v-hosting-rebind.verified.json', v = await json(ROOT + '/' + vPath);
    check(v.currentHostingAndPlatformIndependentlyVerified, 'PRIOR_VERIFIED');
    for (const f of v.rawEvidence) check(hash(await readFile(f.path)) === f.rawFileSha256, 'PRIOR_RAW_HASH');
    for (const f of v.binding.ownPins) check(hash(await readFile(ROOT + '/' + f.file)) === f.rawFileSha256, 'PRIOR_CODE');
    const old = await json(ROOT + '/' + v.historicalEvidence.path);
    check(hash(await readFile(ROOT + '/' + v.historicalEvidence.path)) === v.historicalEvidence.rawFileSha256, 'PRIOR_CAPSULE');
    for (const f of old.rawEvidence) check(hash(await readFile(f.path)) === f.rawFileSha256, 'OLD_RAW_HASH');
    const input = await hostingInputs(), m = await json(BASE + '/techlong-express-k3r-review-20261016-r2/manifest.json');
    check(same(input.binding, m.binding), 'FROZEN_BINDING');
    const e = await json(old.run.directory + '/execution-binding.json'), p = await json(old.run.directory + '/rebind-program.json');
    const baseline = (await json(BASE + '/techlong-express-k3r-review-20261016-r2/metadata.json')).baseline;
    const physical = id => v.hosting.resources.find(r => r.logicalId === id).physicalId;
    const parent = id => baseline.cell.resources.find(r => r.id === id).physicalId;
    await put('binding', { priorCapsule: vPath, priorRawSha256: hash(await readFile(ROOT + '/' + vPath)), priorRawFilesVerified: 29,
      scriptRawSha256: hash(await readFile(fileURLToPath(import.meta.url))), nodeVersion: process.version, noOldModeInvoked: true });
    const who = await read('source', ['sts', 'get-caller-identity'], d => pick(d, ['Account', 'Arn', 'UserId']));
    check(who.presence === 'PRESENT' && who.data.Account === '402010193138' && who.data.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' && who.data.UserId === 'AIDAV3GNMXTZEO7SHLC2X', 'SOURCE');
    const ws = await read('workload-stack', ['cloudformation', 'describe-stacks', '--stack-name', p.receipt.stackId], stackView);
    const wr = await read('workload-resources', ['cloudformation', 'list-stack-resources', '--stack-name', p.receipt.stackId], d => ({ rows: rows(d.StackResourceSummaries), complete: !d.NextToken }));
    const service = await read('workload-service', ['ecs', 'describe-services', '--cluster', H.cluster, '--services', H.service], d => ({ services: (d.services || []).map(s => pick(s,
      ['serviceArn', 'serviceName', 'status', 'desiredCount', 'runningCount', 'pendingCount', 'taskDefinition', 'loadBalancers'])), failures: d.failures }));
    const tasks = await read('workload-tasks', ['ecs', 'list-tasks', '--cluster', H.cluster, '--service-name', H.service, '--desired-status', 'RUNNING', '--max-results', '10'], d => ({ arns: d.taskArns || [], complete: !d.nextToken }));
    if (tasks.data?.arns.length && tasks.data.arns.length <= 10) await read('task-details', ['ecs', 'describe-tasks', '--cluster', H.cluster, '--tasks', ...tasks.data.arns], d => ({ tasks: (d.tasks || []).map(t => pick(t,
      ['taskArn', 'taskDefinitionArn', 'lastStatus', 'healthStatus', 'cpu', 'memory', 'launchType', 'startedAt', 'attachments'])), failures: d.failures }));
    await read('task-definition', ['ecs', 'describe-task-definition', '--task-definition', p.receipt.taskDefinitionArn], d => pick(d.taskDefinition, ['taskDefinitionArn', 'status', 'cpu', 'memory', 'family']));
    await read('log-group', ['logs', 'describe-log-groups', '--log-group-name-prefix', physical('TenantLogGroup'), '--limit', '5'], d => ({ groups: (d.logGroups || []).filter(g => g.logGroupName === physical('TenantLogGroup')).map(g => pick(g, ['logGroupName', 'retentionInDays', 'storedBytes', 'arn'])), complete: !d.nextToken }));
    await read('target-group', ['elbv2', 'describe-target-groups', '--target-group-arns', physical('TenantTargetGroup')], d => d, ['TargetGroupNotFound']);
    await read('target-health', ['elbv2', 'describe-target-health', '--target-group-arn', physical('TenantTargetGroup')], d => d, ['TargetGroupNotFound']);
    for (const id of ['TenantBusinessControlDenyRule', 'TenantListenerRule', 'TenantControlListenerRule'])
      await read('rule-' + id, ['elbv2', 'describe-rules', '--rule-arns', physical(id)], d => d, ['RuleNotFound']);
    await read('parent-stack', ['cloudformation', 'describe-stacks', '--stack-name', baseline.cell.id], stackView);
    await read('parent-resources', ['cloudformation', 'list-stack-resources', '--stack-name', baseline.cell.id], d => ({ rows: rows(d.StackResourceSummaries), complete: !d.NextToken }));
    await read('cluster-services', ['ecs', 'list-services', '--cluster', H.cluster, '--max-results', '10'], d => ({ arns: d.serviceArns || [], complete: !d.nextToken }));
    await read('cluster-tasks', ['ecs', 'list-tasks', '--cluster', H.cluster, '--desired-status', 'RUNNING', '--max-results', '10'], d => ({ arns: d.taskArns || [], complete: !d.nextToken }));
    const alb = parent('CellLoadBalancer');
    await read('load-balancer', ['elbv2', 'describe-load-balancers', '--load-balancer-arns', alb], d => d, ['LoadBalancerNotFound']);
    await read('load-balancer-attributes', ['elbv2', 'describe-load-balancer-attributes', '--load-balancer-arn', alb], d => d, ['LoadBalancerNotFound']);
    await read('load-balancer-target-groups', ['elbv2', 'describe-target-groups', '--load-balancer-arn', alb], d => ({ groups: d.TargetGroups, complete: !d.NextMarker }));
    for (const [key, arn] of [['business', baseline.cell.outputs.HttpsListenerArn], ['control', baseline.cell.outputs.ControlListenerArn]])
      await read('listener-rules-' + key, ['elbv2', 'describe-rules', '--listener-arn', arn], d => ({ rules: d.Rules, complete: !d.NextMarker }));
    await read('nat-gateways', ['ec2', 'describe-nat-gateways', '--filter', 'Name=vpc-id,Values=' + baseline.cell.outputs.VpcId, '--max-results', '5'], d => ({ gateways: (d.NatGateways || []).map(g => pick(g, ['NatGatewayId', 'State', 'VpcId', 'SubnetId'])), complete: !d.NextToken }));
    await read('network-interfaces', ['ec2', 'describe-network-interfaces', '--filters', 'Name=vpc-id,Values=' + baseline.cell.outputs.VpcId, '--max-results', '100'], d => ({ interfaces: (d.NetworkInterfaces || []).map(n => ({ ...pick(n, ['NetworkInterfaceId', 'InterfaceType', 'Status', 'VpcId', 'SubnetId', 'RequesterManaged', 'Groups']), publicIp: n.Association?.PublicIp || null })), complete: !d.NextToken }));
    await read('aurora', ['rds', 'describe-db-clusters', '--db-cluster-identifier', 'techlong-sandbox-express-d001'], d => ({ clusters: (d.DBClusters || []).map(c => pick(c,
      ['DBClusterIdentifier', 'DBClusterArn', 'DbClusterResourceId', 'Status', 'Engine', 'EngineVersion', 'EngineMode', 'InternetAccessGatewayEnabled', 'VPCNetworkingEnabled', 'ServerlessV2ScalingConfiguration', 'ServerlessV2PlatformVersion', 'DeletionProtection', 'BackupRetentionPeriod', 'DBClusterMembers', 'StorageType', 'StorageEncrypted', 'TagList'])) }));
    const secretArns = [input.base.historical.plan.futureTemplate.parameters.TenantRuntimeSecretArn,
      'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/control-public-key-first-acceptance-PfBjiq'];
    for (let n = 0; n < secretArns.length; n++) await read('secret-' + (n + 1), ['secretsmanager', 'describe-secret', '--secret-id', secretArns[n]], d => pick(d,
      ['ARN', 'Name', 'DeletedDate', 'RotationEnabled', 'KmsKeyId', 'VersionIdsToStages', 'Tags']), ['ResourceNotFoundException']);
    await read('image', ['ecr', 'describe-images', '--repository-name', H.repository, '--image-ids', 'imageDigest=' + H.newDigest], d => ({ images: (d.imageDetails || []).map(i => pick(i, ['imageDigest', 'imageSizeInBytes', 'imagePushedAt', 'imageTags'])) }));
    await read('janitor-schedule', ['scheduler', 'get-schedule', '--group-name', 'techlong-sandbox', '--name', 'global-expired-stack-scan'], d => pick(d, ['Arn', 'State', 'ScheduleExpression', 'Target']));
    await read('janitor-function', ['lambda', 'get-function-configuration', '--function-name', 'techlong-sandbox-janitor'], d => pick(d, ['FunctionArn', 'State', 'Role', 'CodeSha256', 'LastUpdateStatus']));
    await read('dns', ['route53', 'list-resource-record-sets', '--cli-input-json', JSON.stringify({ HostedZoneId: input.base.historical.plan.proposedDnsCreate.HostedZoneId,
      StartRecordName: 'first-acceptance.sandbox.techlong.cloud.', StartRecordType: 'A', MaxItems: '1' })], d => ({ records: (d.ResourceRecordSets || []).filter(r => r.Name === 'first-acceptance.sandbox.techlong.cloud.' && r.Type === 'A'), truncated: d.IsTruncated }));
    await read('account-plan', ['freetier', 'get-account-plan-state'], d => ({ ...pick(d, ['accountId', 'accountPlanType', 'accountPlanStatus', 'accountPlanExpirationDate']), creditAmountOmitted: true }));
    const tx = input.base.historical.plan.proposedEpochTransaction.TransactItems;
    for (let n = 0; n < tx.length; n++) { const item = tx[n].Put || tx[n].ConditionCheck;
      await read('authority-' + (n + 1), ['dynamodb', 'get-item', '--table-name', item.TableName, '--key', JSON.stringify(item.Key || { authority_key: item.Item.authority_key }), '--consistent-read'], d => ({ itemPresent: Boolean(d.Item), itemSha256: hash(d.Item || null), matchesPrior: tx[n].Put ? same(d.Item, item.Item) : d.Item === undefined })); }
    await read('authority-table', ['dynamodb', 'describe-table', '--table-name', (tx[0].Put || tx[0].ConditionCheck).TableName], d => pick(d.Table, ['TableArn', 'TableStatus', 'TableSizeBytes', 'ItemCount', 'BillingModeSummary', 'OnDemandThroughput', 'ProvisionedThroughput']));
    stage = 'neon-readonly'; neonTransactions++;
    const state = await readResumeState({ databaseUrl: parseEnv(await readFile(ROOT + '/.env.local', 'utf8')).DATABASE_URL, input, receipt: p.receipt,
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    let unchanged = true; try { validateRebound(state.snapshot, m.plan, e, p.receipt); } catch { unchanged = false; }
    await put('platform', { checkedAt: new Date(state.checkedAt).toISOString(), snapshot: state.snapshot, priorRebindInvariantVerified: unchanged,
      sourceAndCatalogMatch: state.endpointSha256 === m.plan.endpointSha256 && state.catalog.server_sha256 === m.plan.catalogSha256 });
    const checkedAt = new Date().toISOString(), assessment = exitAssessment({ expiresAt: e.expiresAt, observedAt: checkedAt,
      stackStatus: ws.data?.stacks?.[0]?.StackStatus, service: service.data?.services?.[0], taskCount: tasks.data?.complete ? tasks.data.arns.length : undefined, resources: wr.data?.complete ? wr.data.rows : [],
      physicalReferencesAbsent: observations['target-group'].presence === 'ABSENT' && observations['target-health'].presence === 'ABSENT' &&
        ['TenantBusinessControlDenyRule', 'TenantListenerRule', 'TenantControlListenerRule'].every(id => observations['rule-' + id].presence === 'ABSENT') &&
        observations['log-group'].data?.complete && observations['log-group'].data.groups.length === 0 && observations['task-definition'].data?.status === 'INACTIVE' });
    const result = { schema: 'techlong/express-exit-inventory/v1', startedAt, checkedAt, workloadStackId: p.receipt.stackId,
      workloadExpiresAt: e.expiresAt, assessment, completeReadAttempts: Object.keys(observations).length,
      unknownStages: Object.values(observations).filter(o => o.presence === 'UNKNOWN').map(o => o.stage), cliReads, neonReadonlyTransactions: neonTransactions,
      cloudWrites: 0, sqlWrites: 0, applicationRequests: 0, privateBundleLoads: 0, secretValueReads: 0, directAuroraConnections: 0, automaticRetries: 0,
      invoiceOrCostExplorerRead: false, actualCostTotalKnown: false, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false,
      retentionDefault: 'PRESERVE_INITIALIZED_TENANT_DATABASE_AND_HISTORY', monitoringOrDeletionScheduled: false };
    await put('result', result); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const result = { outcome: 'INVENTORY_STOPPED_NO_RETRY', diagnostic: { ...safeFailure(error, stage),
      code: /^K3B_[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'PROVIDER_OR_RUNTIME_FAILURE' }, cliReads, neonTransactions,
      cloudWrites: 0, sqlWrites: 0, automaticRetries: 0 };
    await put('failure', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
