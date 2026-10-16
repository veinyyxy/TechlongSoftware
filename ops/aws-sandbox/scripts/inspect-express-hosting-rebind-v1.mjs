// K3v: a new, bounded read-only diagnosis. Never invokes the consumed K3r modes.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, open, mkdir } from 'node:fs/promises';
import { parseEnv, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { ECSClient, DescribeServicesCommand, ListTasksCommand, DescribeTasksCommand, DescribeTaskDefinitionCommand } from '@aws-sdk/client-ecs';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { hostingInputs } from './review-express-hosting-resume-v1.mjs';
import { H, hash, same, bindExecution, compileRebind, validateRebound } from './express-hosting-resume-plan-v1.mjs';
import { taskProjection } from './express-workload-recovery-plan-v1.mjs';
import { readResumeState } from './express-hosting-resume-observer-v1.mjs';

const ROOT = 'E:/NodejsProject/TechlongSoftware', BASE = 'F:/ChatGPT_workshop';
const RUN = BASE + '/techlong-express-k3r-run-20261016-r1';
const INSPECT = BASE + '/techlong-express-k3r-inspect-20261016-r1';
const MANIFEST = BASE + '/techlong-express-k3r-review-20261016-r2/manifest.json';
const CAPSULE = 'ops/aws-sandbox/reviews/aurora-dual-mode-k3r-hosting-resume.executed.json';
const exec = promisify(execFile), json = async p => JSON.parse(await readFile(p));
const check = (ok, code) => { if (!ok) throw Error('K3V_' + code); };
const tags = a => Object.fromEntries((a || []).map(t => [t.Key, t.Value]));
async function save(file, data) { const f = await open(file, 'wx'); try { await f.writeFile(JSON.stringify(data, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } }

export function safeFailure(error, stage) {
  const name = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'AbortError', 'TimeoutError', 'NeonDbError', 'CredentialsProviderError',
    'ExpiredToken', 'ExpiredTokenException', 'TokenRefreshRequired', 'Throttling', 'ThrottlingException', 'AccessDenied', 'AccessDeniedException',
    'ValidationError', 'ResourceNotFoundException', 'ServiceUnavailableException'].includes(error?.name) ? error.name : 'OTHER_ERROR';
  const code = /^K3V_[A-Z0-9_]+$/.test(error?.message || '') ? error.message :
    /^(HOSTING_RESUME|WORKLOAD_RECOVERY)_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'PROVIDER_OR_RUNTIME_FAILURE';
  const status = error?.$metadata?.httpStatusCode, requestId = error?.$metadata?.requestId;
  return { stage, name, code, httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    requestId: typeof requestId === 'string' && /^[a-f0-9-]{16,80}$/i.test(requestId) ? requestId : null,
    sqlState: error?.name === 'NeonDbError' && /^[A-Z0-9]{5}$/.test(error?.code || '') ? error.code : null,
    messagesSqlCredentialsAndStackOmitted: true, automaticRetries: 0 };
}

export function verifyContext(m, capsule, input, execution, program, proof, ack) {
  const { manifestSha256, ...body } = m;
  check(hash(body) === manifestSha256 && manifestSha256 === capsule.approvedManifestSha256 && same(m.binding, input.binding), 'MANIFEST_BINDING');
  check(same(execution, bindExecution(m.plan, manifestSha256, execution.startedAt)) &&
    same(program, compileRebind(m.plan, execution, program.receipt, input)) &&
    hash(proof) === program.receipt.publicProofSha256 && proof.length === 3 && proof.every(p => p.expectedResponseVerified) &&
    ack.programSha256 === program.programSha256 && ack.changedRows === 1 && ack.transactions === 1, 'EXECUTED_CORRELATION');
  check(capsule.state === 'RUN_SUCCEEDED_INDEPENDENT_INSPECT_UNCLASSIFIED_STOPPED' && capsule.replayAllowed === false &&
    capsule.independent.completed === false && capsule.independent.failure.inspectConsumed === true &&
    capsule.execution.live.stackId === program.receipt.stackId && capsule.execution.live.taskDefinitionArn === program.receipt.taskDefinitionArn, 'HISTORY_SCOPE');
}

export function verifyHosting({ execution, receipt, previous, stack, resources, template, services, listed, tasks, definition, health }) {
  const desired = JSON.parse(execution.request.TemplateBody), rows = resources.StackResourceSummaries;
  check(stack.StackId === receipt.stackId && stack.StackStatus === 'CREATE_COMPLETE' && stack.RoleARN === execution.request.RoleARN &&
    same(tags(stack.Tags), tags(execution.request.Tags)) && typeof template.TemplateBody === 'string' &&
    same(JSON.parse(template.TemplateBody), desired), 'STACK_SPEC');
  const parameters = Object.fromEntries((stack.Parameters || []).map(p => [p.ParameterKey, p.ParameterValue]));
  check(Object.keys(parameters).length === 20 && execution.request.Parameters.every(p => desired.Parameters[p.ParameterKey].NoEcho
    ? parameters[p.ParameterKey] === '****' : parameters[p.ParameterKey] === p.ParameterValue), 'STACK_PARAMETERS');
  check(!resources.NextToken && rows?.length === 7 && same(Object.fromEntries(rows.map(r => [r.LogicalResourceId, r.ResourceType])), H.resources) &&
    rows.every(r => r.ResourceStatus === 'CREATE_COMPLETE') && rows.find(r => r.LogicalResourceId === 'TenantTaskDefinition').PhysicalResourceId === receipt.taskDefinitionArn, 'SEVEN_RESOURCES');
  const s = services.services?.[0], t = tasks.tasks?.[0];
  check(!services.failures?.length && services.services?.length === 1 && s.status === 'ACTIVE' && s.desiredCount === 1 && s.runningCount === 1 && s.pendingCount === 0 &&
    s.taskDefinition === receipt.taskDefinitionArn && s.deployments?.length === 1 && s.deployments[0].rolloutState === 'COMPLETED' &&
    !listed.nextToken && listed.taskArns?.length === 1 && !tasks.failures?.length && tasks.tasks?.length === 1 &&
    t.taskArn === listed.taskArns[0] && t.lastStatus === 'RUNNING' && t.healthStatus === 'HEALTHY' && t.taskDefinitionArn === receipt.taskDefinitionArn &&
    t.containers?.length === 1 && t.containers[0].imageDigest === H.newDigest && definition.taskDefinition?.status === 'ACTIVE' &&
    definition.taskDefinition.taskDefinitionArn === receipt.taskDefinitionArn && hash(taskProjection(definition.taskDefinition)) === previous.baseline.expectedTaskSha256, 'SERVICE_TASK');
  const spec = { network: s.networkConfiguration, deployment: s.deploymentConfiguration, capacity: s.capacityProviderStrategy,
    platform: s.platformVersion, executeCommand: s.enableExecuteCommand, propagateTags: s.propagateTags,
    loadBalancers: s.loadBalancers?.map(b => ({ containerName: b.containerName, containerPort: b.containerPort })) };
  const target = rows.find(r => r.LogicalResourceId === 'TenantTargetGroup').PhysicalResourceId;
  check(hash(spec) === previous.baseline.serviceSpecSha256 && s.loadBalancers?.length === 1 && s.loadBalancers[0].targetGroupArn === target, 'SERVICE_SPEC');
  const addresses = t.attachments?.flatMap(a => a.details || []).filter(d => d.name === 'privateIPv4Address').map(d => d.value);
  check(health.TargetHealthDescriptions?.length === 1 && health.TargetHealthDescriptions[0].TargetHealth?.State === 'healthy' &&
    health.TargetHealthDescriptions[0].Target.Port === 3000 && addresses?.includes(health.TargetHealthDescriptions[0].Target.Id), 'TARGET_HEALTH');
  return { stackId: stack.StackId, stackStatus: stack.StackStatus, taskDefinitionArn: receipt.taskDefinitionArn,
    taskArn: t.taskArn, imageDigest: t.containers[0].imageDigest, resources: rows.map(r => ({ logicalId: r.LogicalResourceId,
      physicalId: r.PhysicalResourceId, type: r.ResourceType, status: r.ResourceStatus })), running: 1, healthyTargets: 1,
    templateMatchesExecution: true, parametersMatchExecution: true, taskSpecMatchesPriorVerifiedSpec: true };
}

export async function main(args = process.argv.slice(2)) {
  check(args.length === 2 && args[0] === '--output' && process.cwd().toLowerCase() === path.resolve(ROOT).toLowerCase(), 'ARGUMENTS');
  const out = path.resolve(args[1]);
  check(path.dirname(out).toLowerCase() === path.resolve(BASE).toLowerCase() && /^techlong-express-k3v-readonly-[a-z0-9-]+$/.test(path.basename(out)), 'OUTPUT');
  check(!['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CA_BUNDLE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
    'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLROOTCERT']
    .some(k => process.env[k] || process.env[k.toLowerCase()]) && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' &&
    !Object.keys(process.env).some(k => k.startsWith('AWS_ENDPOINT_URL')), 'ENVIRONMENT');
  await mkdir(out); const put = (n, d) => save(out + '/' + n, d);
  const journal = await open(out + '/read-trace.ndjson', 'wx');
  let stage = 'local_evidence', sdkReads = 0, cliReads = 0, neonReadonlyTransactions = 0, diagnostic;
  const clients = [], startedAt = Date.now(), signal = AbortSignal.timeout(180000);
  const log = async entry => { await journal.writeFile(JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); await journal.sync(); };
  const step = async (label, fn) => { stage = label; signal.throwIfAborted(); await log({ stage, state: 'entered' });
    try { const value = await fn(); await log({ stage, state: 'completed' }); return value; }
    catch (error) { diagnostic = safeFailure(error, label); await log({ state: 'failed', ...diagnostic }); throw error; } };
  try {
    const context = await step('local_evidence', async () => {
      const capsule = await json(ROOT + '/' + CAPSULE), m = await json(MANIFEST), input = await hostingInputs();
      const execution = await json(RUN + '/execution-binding.json'), program = await json(RUN + '/rebind-program.json');
      verifyContext(m, capsule, input, execution, program, await json(RUN + '/public-proof.json'), await json(RUN + '/transaction-ack.json'));
      check(capsule.rawEvidence.length === 23, 'EVIDENCE_COUNT');
      for (const f of capsule.rawEvidence) {
        check(f.path.startsWith(RUN + '/') || f.path.startsWith(INSPECT + '/') || [H.slot, H.writeSlot, H.inspectSlot].includes(f.path), 'EVIDENCE_PATH');
        check(hash(await readFile(f.path)) === f.rawFileSha256, 'HISTORICAL_RAW_HASH');
      }
      const ownPins = [];
      for (const file of ['ops/aws-sandbox/scripts/inspect-express-hosting-rebind-v1.mjs', 'tests/express-hosting-rebind-inspect-v1.test.mjs'])
        ownPins.push({ file, rawFileSha256: hash(await readFile(ROOT + '/' + file)) });
      await put('binding.json', { approvedHistoricalManifestSha256: m.manifestSha256, executedCapsuleRawSha256: hash(await readFile(ROOT + '/' + CAPSULE)),
        ownPins, nodeVersion: process.version, historicalCodeAnd23EvidenceExact: true, consumedSlotsPreserved: true, oldModesNotInvoked: true });
      return { m, input, execution, receipt: program.receipt, previous: await json(RUN + '/after-hosting.json') };
    });
    const { input, execution, receipt, previous } = context;
    const config = { region: 'ca-central-1', maxAttempts: 1, ignoreConfiguredEndpointUrls: true,
      credentials: fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } }) };
    const sts = new STSClient({ ...config, endpoint: 'https://sts.ca-central-1.amazonaws.com' }), cfn = new CloudFormationClient(config), ecs = new ECSClient(config);
    clients.push(sts, cfn, ecs);
    const send = (label, client, command) => step(label, () => { check(++sdkReads <= 8, 'SDK_BUDGET'); return client.send(command,
      { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); });
    const who = await send('sts.GetCallerIdentity', sts, new GetCallerIdentityCommand({}));
    check(who.Account === '402010193138' && who.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' && who.UserId === 'AIDAV3GNMXTZEO7SHLC2X', 'SOURCE');
    const described = await send('cfn.DescribeExactStack', cfn, new DescribeStacksCommand({ StackName: receipt.stackId }));
    const stack = described.Stacks?.[0]; check(described.Stacks?.length === 1 && stack.StackId === receipt.stackId, 'EXACT_UUID');
    const resources = await send('cfn.ListExactStackResources', cfn, new ListStackResourcesCommand({ StackName: receipt.stackId }));
    const expired = Date.now() >= Date.parse(execution.expiresAt), deleting = /^(DELETE_|ROLLBACK_)/.test(stack.StackStatus || '');
    await put('inventory.json', { checkedAt: new Date().toISOString(), stackId: stack.StackId, stackStatus: stack.StackStatus, expired, deleting,
      workloadExpiresAt: execution.expiresAt, resources: (resources.StackResourceSummaries || []).map(r => ({ logicalId: r.LogicalResourceId,
        physicalId: r.PhysicalResourceId, type: r.ResourceType, status: r.ResourceStatus })), allResourcesListed: !resources.NextToken });
    let hosting = null;
    if (!expired && !deleting) {
      check(stack.StackStatus === 'CREATE_COMPLETE', 'STACK_NOT_COMPLETE');
      const template = await send('cfn.GetExactTemplate', cfn, new GetTemplateCommand({ StackName: receipt.stackId, TemplateStage: 'Original' }));
      const services = await send('ecs.DescribeExactService', ecs, new DescribeServicesCommand({ cluster: H.cluster, services: [H.service] }));
      const listed = await send('ecs.ListServiceRunningTasks', ecs, new ListTasksCommand({ cluster: H.cluster, serviceName: H.service, desiredStatus: 'RUNNING' }));
      check(!listed.nextToken && listed.taskArns?.length === 1 && listed.taskArns[0].startsWith('arn:aws:ecs:ca-central-1:402010193138:task/' + H.cluster + '/'), 'TASK_COUNT_OR_NAMESPACE');
      const tasks = await send('ecs.DescribeCurrentTask', ecs, new DescribeTasksCommand({ cluster: H.cluster, tasks: listed.taskArns }));
      const definition = await send('ecs.DescribeExactDefinition', ecs, new DescribeTaskDefinitionCommand({ taskDefinition: receipt.taskDefinitionArn }));
      const target = resources.StackResourceSummaries?.find(r => r.LogicalResourceId === 'TenantTargetGroup')?.PhysicalResourceId;
      check(/^arn:aws:elasticloadbalancing:ca-central-1:402010193138:targetgroup\/[a-z0-9-]+\/[a-f0-9]+$/.test(target || ''), 'TARGET_ARN');
      const health = await step('elbv2.DescribeExactTargetHealth', async () => {
        check(++cliReads === 1, 'CLI_BUDGET');
        const result = await exec('aws', ['elbv2', 'describe-target-health', '--target-group-arn', target,
          '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1', '--output', 'json', '--no-cli-pager'],
        { windowsHide: true, timeout: 30000, signal, maxBuffer: 1_000_000,
          env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } });
        return JSON.parse(result.stdout);
      });
      hosting = await step('validate_current_hosting', async () => verifyHosting({ execution, receipt, previous, stack, resources, template, services, listed, tasks, definition, health }));
      check(Date.now() < Date.parse(execution.expiresAt), 'EXPIRED_DURING_OBSERVATION');
      await put('hosting.json', { checkedAt: new Date().toISOString(), ...hosting });
    }
    const state = await step('neon.ReadonlyReceiptSnapshot', async () => {
      check(++neonReadonlyTransactions === 1, 'NEON_BUDGET');
      const databaseUrl = parseEnv(await readFile(ROOT + '/.env.local', 'utf8')).DATABASE_URL;
      return readResumeState({ databaseUrl, input, receipt, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    });
    await step('validate_platform_rebind', async () => {
      validateRebound(state.snapshot, context.m.plan, execution, receipt);
      check(state.endpointSha256 === context.m.plan.endpointSha256 && state.catalog.server_sha256 === context.m.plan.catalogSha256, 'NEON_SOURCE_CATALOG');
    });
    await put('platform.json', { checkedAt: new Date(state.checkedAt).toISOString(), endpointSha256: state.endpointSha256,
      catalogServerSha256: state.catalog.server_sha256, snapshot: state.snapshot, platformRebindVerified: true });
    check(Date.now() - startedAt < 180000, 'READ_WINDOW');
    const result = { schema: 'techlong/hosting-rebind-readonly-diagnosis/v1', outcome: hosting
      ? 'CURRENT_HOSTING_AND_PLATFORM_REBIND_INDEPENDENTLY_VERIFIED' : 'EXIT_INVENTORY_AND_RETAINED_PLATFORM_RECEIPT_VERIFIED',
      startedAt: new Date(startedAt).toISOString(), checkedAt: new Date().toISOString(), exactStackId: receipt.stackId,
      workloadExpiresAt: execution.expiresAt, currentHostingVerified: Boolean(hosting), platformRebindVerified: true,
      oldFailedInspectReplayed: false, oldFailureRootCauseEstablished: false, originalFailurePreserved: true,
      broadIamEcrDnsSecretLayoutReverified: false, additionalApplicationRequests: 0, writes: 0, privateLoads: 0,
      secretValueReads: 0, directAuroraConnections: 0, reinitialized: false, sdkReads, cliReads, neonReadonlyTransactions,
      neonReadonlyStatements: 3, automaticRetries: 0, monthlyBudgetTargetUSD: 50, budgetIsHardCap: false };
    await put('result.json', result); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const result = { schema: 'techlong/hosting-rebind-readonly-diagnosis/v1', outcome: 'READONLY_DIAGNOSIS_STOPPED_NO_RETRY',
      diagnostic: diagnostic || safeFailure(error, stage), sdkReads, cliReads, neonReadonlyTransactions, writes: 0,
      additionalApplicationRequests: 0, privateLoads: 0, secretValueReads: 0, directAuroraConnections: 0, automaticRetries: 0 };
    await put('failure.json', result); console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
  } finally { clients.forEach(c => c.destroy()); await journal.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
