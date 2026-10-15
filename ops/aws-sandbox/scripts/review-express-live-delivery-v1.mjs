// Read-only full resource/permission review. No mutation or private-read mode.
import path from 'node:path';
import { readFile, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import * as iam from '@aws-sdk/client-iam';
import * as cfn from '@aws-sdk/client-cloudformation';
import { SecretsManagerClient, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { computeClientConfig } from './express-compute-observer-v1.mjs';
import { prepareExpressLiveDeliveryPlanV1, EXPRESS_LIVE_RESOURCES_V1 as C } from '../../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
const exec = promisify(execFile), base = 'F:/ChatGPT_workshop', hash = b => createHash('sha256').update(b).digest('hex');
const args = process.argv.slice(2), out = path.resolve(args[1] || '');
if (args.length !== 2 || args[0] !== '--output' || path.dirname(out).toLowerCase() !== path.resolve(base).toLowerCase() ||
    !/^techlong-express-c5f-[a-z0-9-]+$/.test(path.basename(out))) throw Error('LIVE_REVIEW_ARGUMENTS');
await mkdir(out);
const save = async (name, value) => { const f = await open(path.join(out, name), 'wx'); try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
const json = async f => JSON.parse(await readFile(f, 'utf8'));
let calls = 0, cliCalls = 0, phase = 'LOCAL_HISTORY', readonlyThrottleRetries = 0;
const signal = AbortSignal.timeout(240000), config = computeClientConfig(), ic = new iam.IAMClient(config), cc = new cfn.CloudFormationClient(config), sm = new SecretsManagerClient(config);
const send = async (client, command) => { signal.throwIfAborted(); if (++calls > 65) throw Error('LIVE_REVIEW_READ_BUDGET'); return client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); };
const child = async argv => { const r = await exec(process.execPath, argv, { cwd: process.cwd(), timeout: 120000, maxBuffer: 512000, windowsHide: true, signal,
  env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true' } }); return JSON.parse(r.stdout); };
const cli = async (argv, missing) => { cliCalls++; try { const r = await exec('aws', [...argv, '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1', '--no-cli-pager', '--output', 'json'],
  { timeout: 30000, maxBuffer: 512000, windowsHide: true, signal, env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true' } }); return JSON.parse(r.stdout);
} catch (e) { if (missing && String(e.stderr).includes('(' + missing + ') when calling the')) return null; throw e; } };
const decode = d => typeof d === 'string' ? JSON.parse(decodeURIComponent(d)) : d;
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'DATABASE_URL', 'PGHOST', 'PGPASSWORD', 'AWS_CONFIG_FILE',
    'AWS_SHARED_CREDENTIALS_FILE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'].some(n => process.env[n]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('LIVE_REVIEW_ENV');
  const sourceFile = base + '/techlong-express-delivery-c5c-20261015-r1.review.json';
  if (hash(await readFile(sourceFile)) !== 'f744acf7846b8e39498fef6cd1911356d867b54c32d4c71aaa6109fa3f7d263e') throw Error('LIVE_REVIEW_SOURCE_DRIFT');
  const source = await json(sourceFile), business = await json(base + '/techlong-d001-business-review-20261013-r3/manifest.json');
  const executed = await json('ops/aws-sandbox/reviews/aurora-dual-mode-c5e-private-control.executed.json');
  if (!executed.approvedAttemptComplete || executed.run?.outcome !== 'PRIVATE_CONTROL_PROVENANCE_REBOUND_NOT_RUNTIME_VERIFIED') throw Error('LIVE_REVIEW_PRIVATE_RECEIPT_REQUIRED');
  for (const f of executed.evidenceFiles) if (hash(await readFile(f.path)) !== f.rawFileSha256) throw Error('LIVE_REVIEW_PRIOR_EVIDENCE_DRIFT');
  const privateReceipt = await json(executed.run.directory + '/result.json');
  const computeDir = base + '/techlong-express-c5d-compute-inspect-' + path.basename(out).slice('techlong-express-'.length);
  phase = 'COMPUTE_AND_CONTROL';
  const compute = await child(['--experimental-strip-types', 'ops/aws-sandbox/scripts/review-express-compute-v1.mjs', '--mode', 'Inspect',
    '--manifest', base + '/techlong-express-c5d-compute-review-20261015-r2/manifest.json', '--approved-sha', '7a0c636b741e1cc0af068046c052f1f09a6dd1bc8f0a62b539f3be609f245423',
    '--run-directory', base + '/techlong-express-c5d-compute-run-20261015-r1', '--output', computeDir]);
  const control = await child(['--experimental-strip-types', '--env-file-if-exists=.env.local', 'ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts', '--review', sourceFile]);
  if (control.result?.outcome !== 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED') throw Error('LIVE_REVIEW_CONTROL_DRIFT');
  await save('compute.json', compute); await save('control-plane.json', control);
  const zones = await cli(['route53', 'list-hosted-zones-by-name', '--dns-name', 'sandbox.techlong.cloud', '--max-items', '1']);
  const zone = zones.HostedZones?.[0];
  if (!zone || zone.Name !== 'sandbox.techlong.cloud.' || zone.Config?.PrivateZone) throw Error('LIVE_REVIEW_DNS_ZONE_UNPROVED');
  const hostedZoneId = zone.Id.replace('/hostedzone/', '');
  const plan = await prepareExpressLiveDeliveryPlanV1({ sourceMaterial: source.material, sourceMaterialSha256: source.materialSha256,
    subscriptionId: control.result.subscriptionId, configuration: business.material.configuration, configurationSchema: business.inventory.plan.schema,
    privateReceipt, compute, hostedZoneId, now: Date.now() });
  await save('plan.json', plan);
  const validate = await send(cc, new cfn.ValidateTemplateCommand({ TemplateBody: plan.futureTemplate.templateBody }));
  if (validate.Capabilities?.length) throw Error('LIVE_REVIEW_UNEXPECTED_IAM_CAPABILITY');
  await save('template-validation.json', { parameters: validate.Parameters, capabilities: validate.Capabilities || [] });
  const providerSchemas = [];
  for (const TypeName of plan.proposedWorkloadCreate.ResourceTypes) {
    const t = await send(cc, new cfn.DescribeTypeCommand({ Type: 'RESOURCE', TypeName })), schema = JSON.parse(t.Schema);
    providerSchemas.push({ TypeName, defaultVersionId: t.DefaultVersionId, handlers: schema.handlers });
  }
  await save('provider-permissions.json', providerSchemas);
  const roles = [];
  for (const [name, id] of [['TechlongSandboxCloudFormationExecutionRole', 'AROAV3GNMXTZKHYBCRSOE'],
    ['TechlongSandboxTaskExecutionRole', 'AROAV3GNMXTZJHJWAN4IR'], ['TechlongSandboxTaskRole', 'AROAV3GNMXTZLH2AU5I5G']]) {
    const r = (await send(ic, new iam.GetRoleCommand({ RoleName: name }))).Role;
    if (r.RoleId !== id) throw Error('LIVE_REVIEW_ROLE_ID_CHANGED');
    const attached = await send(ic, new iam.ListAttachedRolePoliciesCommand({ RoleName: name }));
    const inline = await send(ic, new iam.ListRolePoliciesCommand({ RoleName: name }));
    roles.push({ name, id, arn: r.Arn, trust: decode(r.AssumeRolePolicyDocument), boundaryArn: r.PermissionsBoundary?.PermissionsBoundaryArn,
      attached: attached.AttachedPolicies, inlineNames: inline.PolicyNames });
  }
  const boundaryArn = roles[0].boundaryArn, policy = (await send(ic, new iam.GetPolicyCommand({ PolicyArn: boundaryArn }))).Policy;
  const versions = await send(ic, new iam.ListPolicyVersionsCommand({ PolicyArn: boundaryArn }));
  const version = await send(ic, new iam.GetPolicyVersionCommand({ PolicyArn: boundaryArn, VersionId: policy.DefaultVersionId }));
  await save('roles.json', { roles, cloudFormationBoundary: { arn: boundaryArn, id: policy.PolicyId, defaultVersion: policy.DefaultVersionId,
    versions: versions.Versions.map(v => ({ id: v.VersionId, isDefault: v.IsDefaultVersion })), document: decode(version.PolicyVersion.Document) } });
  const secretMetadata = [];
  for (const [arn, fixed] of [[C.controlPublicKeyArn, C.controlPublicKeyVersion], [source.material.binding.runtimeSecret.arn, source.material.binding.runtimeSecret.versionId]]) {
    const s = await send(sm, new DescribeSecretCommand({ SecretId: arn }));
    if (s.ARN !== arn || s.DeletedDate || !s.VersionIdsToStages?.[fixed]?.includes('AWSCURRENT')) throw Error('LIVE_REVIEW_FIXED_SECRET_METADATA_DRIFT');
    secretMetadata.push({ arn, fixedVersion: fixed, tags: s.Tags, kmsKeyId: s.KmsKeyId || 'alias/aws/secretsmanager', rotationEnabled: s.RotationEnabled || false });
  }
  await save('secrets-metadata.json', secretMetadata);
  const ecsProps = plan.futureTemplate.template.Resources;
  let stackAbsent = false;
  try { await send(cc, new cfn.DescribeStacksCommand({ StackName: plan.futureTemplate.stackName })); }
  catch (e) { if (e.name === 'ValidationError' && String(e.message).includes('Stack with id ' + plan.futureTemplate.stackName + ' does not exist')) stackAbsent = true; else throw e; }
  const dns = await cli(['route53', 'list-resource-record-sets', '--hosted-zone-id', hostedZoneId, '--start-record-name', source.material.tenantHostname, '--max-items', '1']);
  const tenantRecords = (dns.ResourceRecordSets || []).filter(r => r.Name === source.material.tenantHostname + '.');
  const listenerRules = [];
  for (const arn of [compute.outputs.HttpsListenerArn, compute.outputs.ControlListenerArn]) {
    const r = await cli(['elbv2', 'describe-rules', '--listener-arn', arn]); listenerRules.push({ listener: arn, rules: r.Rules });
  }
  const occupiedPriorities = listenerRules.some((l, ix) => l.rules.some(r => (ix === 0 ? ['100', '101'] : ['100']).includes(r.Priority)));
  const service = await cli(['ecs', 'describe-services', '--cluster', 'cell-sandbox-1', '--services', ecsProps.TenantService.Properties.ServiceName]);
  const target = await cli(['elbv2', 'describe-target-groups', '--names', ecsProps.TenantTargetGroup.Properties.Name], 'TargetGroupNotFound');
  const images = [];
  for (const image of Object.values(source.material.images).filter(v => typeof v === 'string' && v.includes('@sha256:'))) {
    const digest = image.split('@')[1], r = await cli(['ecr', 'batch-get-image', '--repository-name', 'techlong-sandbox-speedfeast', '--image-ids', 'imageDigest=' + digest]);
    if (r.images?.length !== 1 || r.images[0].imageId.imageDigest !== digest || r.failures?.length) throw Error('LIVE_REVIEW_PUBLISHED_IMAGE_ABSENT');
    images.push({ digest, mediaType: r.images[0].imageManifestMediaType });
  }
  const namespace = { hostedZoneId, zoneName: zone.Name, stackAbsent, tenantRecords, listenerRules, occupiedPriorities,
    service, targetGroupAbsent: target === null, images };
  await save('namespace.json', namespace);
  const serviceAbsent = service.services?.length === 0 && service.failures?.length === 1 && service.failures[0].reason === 'MISSING' &&
    service.failures[0].arn === 'arn:aws:ecs:ca-central-1:402010193138:service/cell-sandbox-1/' + ecsProps.TenantService.Properties.ServiceName;
  const results = [], ctx = Object.entries({ 'aws:RequestedRegion': 'ca-central-1', ...Object.fromEntries(Object.entries(plan.futureTemplate.tags).flatMap(([k, v]) => [
    ['aws:RequestTag/' + k, v], ['aws:ResourceTag/' + k, v]])), 'cloudformation:RoleArn': C.cloudFormationRoleArn, 'iam:PassedToService': 'ecs-tasks.amazonaws.com' })
    .map(([ContextKeyName, value]) => ({ ContextKeyName, ContextKeyType: 'string', ContextKeyValues: [value] }));
  const sim = async (label, principal, actions, resources, extra = []) => {
    phase = 'SIMULATE_' + label;
    const keys = new Set(extra.map(x => x.ContextKeyName));
    await delay(1100, undefined, { signal });
    let response;
    const request = { PolicySourceArn: principal, ActionNames: actions, ResourceArns: resources, ContextEntries: [...ctx.filter(x => !keys.has(x.ContextKeyName)), ...extra] };
    for (let attempt = 0; attempt < 3; attempt++) { try { response = await send(ic, new iam.SimulatePrincipalPolicyCommand(request)); break; }
      catch (e) { if (e.name !== 'Throttling' || attempt === 2) throw e; readonlyThrottleRetries++; await delay(2000, undefined, { signal }); } }
    const rows = response.EvaluationResults.flatMap(r => r.ResourceSpecificResults?.length ? r.ResourceSpecificResults.map(s => ({ action: r.EvalActionName,
      resource: s.EvalResourceName, decision: s.EvalResourceDecision, missingContext: s.MissingContextValues || r.MissingContextValues || [] })) : [{
      action: r.EvalActionName, resource: r.EvalResourceName, decision: r.EvalDecision, missingContext: r.MissingContextValues || [] }]);
    results.push({ label, principal, rows });
    await save('simulation-' + label + '.json', { label, principal, rows });
  };
  const str = (ContextKeyName, ...ContextKeyValues) => ({ ContextKeyName, ContextKeyType: ContextKeyValues.length > 1 ? 'stringList' : 'string', ContextKeyValues });
  const cfnRole = C.cloudFormationRoleArn, sourceArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev';
  const taskArn = 'arn:aws:ecs:ca-central-1:402010193138:task-definition/' + ecsProps.TenantTaskDefinition.Properties.Family + ':*';
  const serviceArn = 'arn:aws:ecs:ca-central-1:402010193138:service/cell-sandbox-1/' + ecsProps.TenantService.Properties.ServiceName;
  const logArn = 'arn:aws:logs:ca-central-1:402010193138:log-group:' + ecsProps.TenantLogGroup.Properties.LogGroupName;
  await sim('cfn-task', cfnRole, ['ecs:RegisterTaskDefinition', 'ecs:TagResource'], [taskArn]);
  await sim('cfn-service', cfnRole, ['ecs:CreateService', 'ecs:DescribeServices', 'ecs:UpdateService', 'ecs:DeleteService', 'ecs:ListServiceDeployments'], [serviceArn]);
  await sim('cfn-service-deployments', cfnRole, ['ecs:DescribeServiceDeployments'], ['arn:aws:ecs:ca-central-1:402010193138:service-deployment/cell-sandbox-1/' + ecsProps.TenantService.Properties.ServiceName + '/*']);
  await sim('cfn-logs', cfnRole, ['logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:PutRetentionPolicy', 'logs:TagResource', 'logs:ListTagsForResource'], [logArn]);
  await sim('cfn-target-create', cfnRole, ['elasticloadbalancing:CreateTargetGroup'], ['*']);
  await sim('cfn-target-read', cfnRole, ['elasticloadbalancing:DescribeTargetGroupAttributes', 'elasticloadbalancing:DescribeTargetHealth', 'elasticloadbalancing:DescribeTags'],
    ['arn:aws:elasticloadbalancing:ca-central-1:402010193138:targetgroup/' + ecsProps.TenantTargetGroup.Properties.Name + '/*']);
  await sim('cfn-rule-tags-read', cfnRole, ['elasticloadbalancing:DescribeTags'],
    [compute.outputs.HttpsListenerArn.replace(':listener/', ':listener-rule/') + '/*', compute.outputs.ControlListenerArn.replace(':listener/', ':listener-rule/') + '/*']);
  await sim('cfn-log-policies', cfnRole, ['logs:GetDataProtectionPolicy', 'logs:DescribeIndexPolicies'], [logArn]);
  await sim('cfn-log-resource-policies', cfnRole, ['logs:DescribeResourcePolicies'], ['*']);
  await sim('cfn-create-rules', cfnRole, ['elasticloadbalancing:CreateRule'], [compute.outputs.HttpsListenerArn, compute.outputs.ControlListenerArn]);
  await sim('cfn-read', cfnRole, ['ecs:DescribeTaskDefinition', 'elasticloadbalancing:DescribeRules', 'elasticloadbalancing:DescribeTargetGroups', 'logs:DescribeLogGroups'], ['*']);
  await sim('cfn-pass-runtime', cfnRole, ['iam:PassRole'], [C.taskExecutionRoleArn, source.material.binding.access.applicationRoleArn], [str('iam:PassedToService', 'ecs-tasks.amazonaws.com')]);
  await sim('source-create-stack', sourceArn, ['cloudformation:CreateStack'], ['arn:aws:cloudformation:ca-central-1:402010193138:stack/' + plan.futureTemplate.stackName + '/*']);
  await sim('source-pass-cfn', sourceArn, ['iam:PassRole'], [cfnRole], [str('iam:PassedToService', 'cloudformation.amazonaws.com')]);
  await sim('source-initial-epoch', sourceArn, ['dynamodb:PutItem', 'dynamodb:ConditionCheckItem'], [C.epochTableArn],
    [str('dynamodb:LeadingKeys', 'tenant:' + source.material.binding.stableIdentity, 'tenant:aurora-v2:' + source.material.binding.stableIdentity), str('dynamodb:EnclosingOperation', 'TransactWriteItems')]);
  await sim('source-exact-dns', sourceArn, ['route53:ChangeResourceRecordSets'], ['arn:aws:route53:::hostedzone/' + hostedZoneId],
    [str('aws:RequestedRegion', 'us-east-1'), ...[
      ['route53:ChangeResourceRecordSetsNormalizedRecordNames', source.material.tenantHostname],
      ['route53:ChangeResourceRecordSetsRecordTypes', 'A'], ['route53:ChangeResourceRecordSetsActions', 'CREATE']]
      .map(([ContextKeyName, value]) => ({ ContextKeyName, ContextKeyType: 'stringList', ContextKeyValues: [value] }))]);
  await sim('app-iam-connect', source.material.binding.access.applicationRoleArn, ['rds-db:connect'],
    ['arn:aws:rds-db:ca-central-1:402010193138:dbuser:' + source.material.binding.clusterResourceId + '/' + source.material.binding.tenantUsername]);
  for (const s of secretMetadata) await sim('execution-fixed-secret-' + (s.arn === C.controlPublicKeyArn ? 'public-key' : 'runtime'), C.taskExecutionRoleArn,
    ['secretsmanager:GetSecretValue'], [s.arn], [str('secretsmanager:VersionId', s.fixedVersion)]);
  await sim('execution-ecr-token', C.taskExecutionRoleArn, ['ecr:GetAuthorizationToken'], ['*']);
  await sim('execution-image-pull', C.taskExecutionRoleArn, ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'],
    ['arn:aws:ecr:ca-central-1:402010193138:repository/techlong-sandbox-speedfeast']);
  await sim('execution-log-stream', C.taskExecutionRoleArn, ['logs:CreateLogStream', 'logs:PutLogEvents'], [logArn + ':log-stream:*']);
  await save('simulations.json', { results, simulationIsProviderOrKeyPolicyProof: false });
  phase = 'NEON_EXPLAIN';
  const explain = await child(['--experimental-strip-types', '--env-file-if-exists=.env.local', 'ops/aws-sandbox/scripts/explain-express-first-claim-v1.ts', '--plan', path.join(out, 'plan.json').replaceAll('\\', '/')]);
  await save('neon-explain.json', explain);
  const gaps = results.flatMap(g => g.rows.filter(r => r.decision !== 'allowed' || r.missingContext.length).map(r => ({ label: g.label, ...r })));
  const collisions = !stackAbsent || tenantRecords.length > 0 || occupiedPriorities || !serviceAbsent || target !== null;
  const result = { mode: 'ReviewOnly', outcome: gaps.length || collisions ? 'EXACT_DEPLOYMENT_CANDIDATE_HAS_PREFLIGHT_BLOCKERS' : 'EXACT_DEPLOYMENT_CANDIDATE_PREFLIGHT_PASSED_NOT_AUTHORIZED',
    directory: out, at: new Date().toISOString(), planSha256: plan.planSha256, resources: plan.futureTemplate.resourceInventory,
    workloadStackName: plan.futureTemplate.stackName, hostedZoneId, permissionGaps: gaps, namespaceCollision: !!collisions,
    sdkReadonlyCalls: calls, cliReadonlyCalls: cliCalls, readonlyThrottleRetries, proposedDirectAwsWrites: 3, proposedNeonClaimRows: 6,
    policyChangesDerivedFromSimulationAlone: false, proposedWriteCountsExcludeIamActivationAndProvision: true,
    actualWrites: 0, privateReads: 0, executionSlotConsumed: false, executionCliAvailable: false, runtimeEnabled: false, readyVerified: false };
  await save('result.json', result); console.log(JSON.stringify(result, null, 2));
} catch (e) { await save('stopped.json', { code: /^LIVE_REVIEW_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'LIVE_REVIEW_LOCAL_OR_PROVIDER_FAILED', phase,
  providerName: /^[A-Za-z0-9_.-]{1,100}$/.test(e.name || '') ? e.name : null,
  sdkReadonlyCalls: calls, cliReadonlyCalls: cliCalls, actualWrites: 0, privateReads: 0 }); console.error('LIVE_REVIEW_STOPPED_NO_WRITE'); process.exitCode = 1;
} finally { ic.destroy(); cc.destroy(); sm.destroy(); }
