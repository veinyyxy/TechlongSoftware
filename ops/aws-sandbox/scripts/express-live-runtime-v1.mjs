import { SecretsManagerClient, DescribeSecretCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand, ListTasksCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { CloudFormationClient, DescribeStacksCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPreparedExpressFirstDeploymentRuntimeV1 } from '../../../lib/deployments/execution/express-first-deployment-runtime-v1.ts';
import { createExpressLivePersistenceV1 } from '../../../lib/deployments/execution/express-live-persistence-v1.ts';
import { createExpressLiveJournalV1 } from '../../../lib/deployments/execution/express-live-journal-v1.ts';
import { createAwsSdkExpressLiveInfrastructureV1 } from '../../../lib/deployments/execution/aws-sdk-express-live-infrastructure-v1.ts';
import { createAcceptanceReadonlyNeonSql } from '../../../lib/deployments/execution/single-tenant-control-bindings.ts';
import { loadExpressPrivateControlSourcesV1 } from '../../../lib/deployments/execution/express-private-control-v1.ts';
import { EXPRESS_LIVE_RESOURCES_V1 as C } from '../../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { observeExpressLiveMetadataV1 } from './express-live-metadata-v1.mjs';
import { createExpressInstalledDatabaseObserverV1 } from './express-live-database-observer-v1.mjs';
import { LIVE_PRIVATE, expressLiveCodeBindingV1 } from './express-live-local-inputs-v1.mjs';
const exec = promisify(execFile);

export const EXPRESS_READY_INSPECT_SQL_V1 = `SELECT d.id AS deployment_id,d.app_instance_id,d.plan_hash,d.configuration_hash,d.artifact_ref,
 d.status AS deployment_status,a.status AS instance_status,a.access_url,j.id AS job_id,j.status AS job_status,
 j.attempts,j.max_attempts,j.lease_owner,j.lease_token IS NULL AS lease_cleared,
 d.outputs::jsonb->>'observationSha256' AS observation_sha256,d.outputs::jsonb->>'expressDeliveryPlanSha256' AS delivery_plan_sha256,
 d.outputs::jsonb->>'stackId' AS stack_id,
 r.owner_deployment_id,r.created_by_deployment_id,r.generation,r.stable_identity_hash,r.lifecycle_status,r.runtime_secret_ref,
 o.epoch,o.intent,o.state AS operation_state,o.operation_hash,o.marker
 FROM public.app_instance_deployments d JOIN public.app_instances a ON a.id=d.app_instance_id
 JOIN public.deployment_jobs j ON j.deployment_id=d.id AND j.id=$2
 JOIN public.deployment_tenant_resources r ON r.app_instance_id=a.id
 JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id
 AND o.generation=r.generation AND o.epoch=r.external_operation_epoch WHERE d.id=$1 AND a.id=$3`;

export function validateExpressReadyInspectionV1(rows, plan, jobId) {
  const r = rows[0], f = plan.pendingExternalFence;
  if (rows.length !== 1 || r.deployment_id !== plan.scope.deploymentId || r.app_instance_id !== plan.scope.appInstanceId || r.job_id !== jobId ||
      r.plan_hash !== plan.scope.planHash || r.configuration_hash !== plan.scope.configurationHash || r.artifact_ref !== plan.scope.artifactRef ||
      r.deployment_status !== 'ready' || r.instance_status !== 'active' || r.job_status !== 'succeeded' ||
      r.lease_cleared !== true || r.lease_owner !== null || Number(r.attempts) !== 1 || Number(r.max_attempts) !== 1 ||
      r.owner_deployment_id !== plan.scope.deploymentId || r.created_by_deployment_id !== plan.scope.deploymentId ||
      Number(r.generation) !== 1 || r.stable_identity_hash !== f.resourceFence.identity.stableIdentityHash || r.lifecycle_status !== 'verified' ||
      r.runtime_secret_ref !== plan.futureTemplate.parameters.TenantRuntimeSecretArn || Number(r.epoch) !== 1 || r.intent !== 'provision' ||
      r.operation_state !== 'active' || r.operation_hash !== f.operationHash || r.marker !== f.marker ||
      !new RegExp('^arn:aws:cloudformation:ca-central-1:402010193138:stack/' + plan.futureTemplate.stackName +
        '/[a-f0-9-]{36}$').test(r.stack_id || '') ||
      r.delivery_plan_sha256 !== plan.planSha256 || !/^[a-f0-9]{64}$/.test(r.observation_sha256 || '') ||
      r.access_url !== 'https://' + plan.proposedDnsCreate.ChangeBatch.Changes[0].ResourceRecordSet.Name.slice(0, -1))
    throw Error('LIVE_READY_PLATFORM_NOT_PROVED');
  return { deploymentId: r.deployment_id, appInstanceId: r.app_instance_id, jobId, deploymentStatus: r.deployment_status,
    instanceStatus: r.instance_status, jobStatus: r.job_status, observationSha256: r.observation_sha256 };
}

/** Concrete lazy composition. Review/Inspect never call openControl/observe.
 * The caller verifies fresh exact manifest+closure BEFORE invoking Run. */
export async function createExpressLiveRuntimeV1({ inputs, plan, databaseUrl, codeBindingSha256, save }) {
  const prepared = await createPreparedExpressFirstDeploymentRuntimeV1({ delivery: inputs.delivery,
    subscriptionId: plan.subscriptionId, databaseUrl });
  if (prepared.delivery.materialSha256 !== plan.materialSha256 || canonicalJson(prepared.scope) !== canonicalJson(plan.scope)) throw Error('LIVE_RUNTIME_SCOPE_DRIFT');
  const sql = createAcceptanceReadonlyNeonSql(databaseUrl), journal = createExpressLiveJournalV1();
  const infrastructure = await createAwsSdkExpressLiveInfrastructureV1(plan);
  const observer = createExpressInstalledDatabaseObserverV1({ program: inputs.snapshot, journal, save });
  const config = { region: 'ca-central-1', maxAttempts: 1, ignoreConfiguredEndpointUrls: true,
    credentials: fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } }) };
  const ec = new ECSClient(config), cc = new CloudFormationClient(config), sm = new SecretsManagerClient(config), sts = new STSClient(config);
  let privateOpened = false, valueRead = false;
  const send = (client, command, signal) => client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  const props = plan.futureTemplate.template.Resources;
  return {
    infrastructure, journal, repository: prepared.repository, persistence: createExpressLivePersistenceV1(databaseUrl),
    async preflight(signal) {
      if ((await expressLiveCodeBindingV1(inputs.history)).codeBindingSha256 !== codeBindingSha256) throw Error('LIVE_RUNTIME_CODE_DRIFT');
      // Current DB first, metadata snapshot last: do not relabel an older
      // metadata timestamp after a potentially slow Aurora auto-resume.
      const installedDatabase = await observer.observe('preflight', signal);
      const metadata = await observeExpressLiveMetadataV1({ inputs, plan, sql, signal });
      await save('run-preflight.json', metadata);
      return { planSha256: plan.planSha256, checkedAt: metadata.checkedAt, inventorySha256: await sha256Hex(metadata),
        codeBindingSha256, configuration: inputs.delivery.configuration, installedDatabase,
        namespacesAbsent: true, computeAndImagesUnchanged: true, cfnV8Unchanged: true };
    },
    observeInstalledDatabase: signal => observer.observe('after_bootstrap', signal),
    async openControl(signal) {
      signal.throwIfAborted(); if (privateOpened) throw Error('LIVE_PRIVATE_LOAD_ALREADY_ENTERED'); privateOpened = true;
      const sources = await loadExpressPrivateControlSourcesV1({ directory: LIVE_PRIVATE, plan: inputs.privatePlan });
      try {
        if (await sha256Hex(sources.publicParameters) !== plan.publicParametersSha256) throw Error('LIVE_PRIVATE_PUBLIC_PARAMETERS_DRIFT');
        const b = inputs.source.material.binding;
        const sdk = { identity: s => send(sts, new GetCallerIdentityCommand({}), s),
          describe: (arn, s) => { if (arn !== b.runtimeSecret.arn) throw Error('LIVE_FIRST_OWNER_SECRET_TARGET');
            return send(sm, new DescribeSecretCommand({ SecretId: arn }), s); },
          value: (arn, version, s) => { if (valueRead || arn !== b.runtimeSecret.arn || version !== b.runtimeSecret.versionId) throw Error('LIVE_FIRST_OWNER_VALUE_ENTRY');
            valueRead = true; return send(sm, new GetSecretValueCommand({ SecretId: arn, VersionId: version, VersionStage: 'AWSCURRENT' }), s); } };
        const composed = await prepared.composeLiveControl({ sources, sdk, expectedSourceUserId: 'AIDAV3GNMXTZEO7SHLC2X' });
        return { control: composed.control, compiler: composed.compiler, dispose: () => sources.dispose() };
      } catch { sources.dispose(); throw Error('LIVE_CONTROL_COMPOSITION_FAILED'); }
    },
    async inspectReady({ jobId, signal }) {
      // New readonly Neon adapter/transaction, not an echoed write response.
      const rows = await createAcceptanceReadonlyNeonSql(databaseUrl).query(EXPRESS_READY_INSPECT_SQL_V1,
        [plan.scope.deploymentId, jobId, plan.scope.appInstanceId], signal);
      await save('ready-platform-observation.json', rows);
      const result = validateExpressReadyInspectionV1(rows, plan, jobId);
      await infrastructure.assertEpoch(signal);
      const stacks = await send(cc, new DescribeStacksCommand({ StackName: plan.futureTemplate.stackName }), signal), stack = stacks.Stacks?.[0];
      if (stacks.Stacks?.length !== 1 || stack.StackStatus !== 'CREATE_COMPLETE' || stack.RoleARN !== C.cloudFormationRoleArn ||
          stack.StackId !== rows[0].stack_id ||
          canonicalJson((stack.Tags || []).map(t => [t.Key, t.Value]).sort()) !== canonicalJson(Object.entries(plan.futureTemplate.tags).sort())) throw Error('LIVE_READY_STACK_UNPROVED');
      const resources = await send(cc, new ListStackResourcesCommand({ StackName: stack.StackId }), signal);
      if (resources.NextToken || resources.StackResourceSummaries?.length !== 7 || resources.StackResourceSummaries.some(r => r.ResourceStatus !== 'CREATE_COMPLETE')) throw Error('LIVE_READY_INVENTORY_UNPROVED');
      const service = await send(ec, new DescribeServicesCommand({ cluster: 'cell-sandbox-1', services: [props.TenantService.Properties.ServiceName] }), signal), svc = service.services?.[0];
      const td = resources.StackResourceSummaries.find(r => r.LogicalResourceId === 'TenantTaskDefinition')?.PhysicalResourceId;
      if (service.failures?.length || service.services?.length !== 1 || svc.status !== 'ACTIVE' || svc.desiredCount !== 1 || svc.runningCount !== 1 ||
          svc.pendingCount !== 0 || svc.taskDefinition !== td) throw Error('LIVE_READY_SERVICE_UNPROVED');
      const definition = (await send(ec, new DescribeTaskDefinitionCommand({ taskDefinition: td }), signal)).taskDefinition;
      const container = definition?.containerDefinitions?.[0], binding = inputs.source.material.binding;
      const expectedSecrets = [...['hmac_secret_key', 'jwt_secret_key', 'stripe_secret_key', 'stripe_webhook_secret'].map(k => ({
        name: k.toUpperCase(), valueFrom: binding.runtimeSecret.arn + ':' + k + '::' + binding.runtimeSecret.versionId })),
      { name: 'SAAS_CONTROL_PUBLIC_KEY', valueFrom: C.controlPublicKeyArn + ':::' + C.controlPublicKeyVersion }];
      if (definition?.taskDefinitionArn !== td || definition.executionRoleArn !== C.taskExecutionRoleArn || definition.taskRoleArn !== binding.access.applicationRoleArn ||
          definition.containerDefinitions?.length !== 1 || container.image !== plan.scope.artifactRef ||
          canonicalJson([...(container.secrets || [])].sort((a, b) => a.name.localeCompare(b.name))) !== canonicalJson(expectedSecrets.sort((a, b) => a.name.localeCompare(b.name))))
        throw Error('LIVE_READY_TASK_DEFINITION_UNPROVED');
      const listed = await send(ec, new ListTasksCommand({ cluster: 'cell-sandbox-1', serviceName: svc.serviceName, desiredStatus: 'RUNNING' }), signal);
      if (listed.nextToken || listed.taskArns?.length !== 1) throw Error('LIVE_READY_RUNNING_TASK_UNPROVED');
      const tasks = await send(ec, new DescribeTasksCommand({ cluster: 'cell-sandbox-1', tasks: listed.taskArns }), signal), task = tasks.tasks?.[0];
      if (tasks.failures?.length || tasks.tasks?.length !== 1 || task.taskDefinitionArn !== td || task.lastStatus !== 'RUNNING' ||
          task.containers?.length !== 1 || task.containers[0].imageDigest !== plan.scope.artifactRef.split('@')[1]) throw Error('LIVE_READY_IMAGE_DIGEST_UNPROVED');
      const cli = async args => {
        const r = await exec('aws', [...args, '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1', '--output', 'json', '--no-cli-pager'],
          { windowsHide: true, signal, timeout: 30000, maxBuffer: 512000,
            env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_CLI_AUTO_PROMPT: 'off', AWS_PAGER: '' } });
        return JSON.parse(r.stdout);
      };
      const targetGroup = resources.StackResourceSummaries.find(r => r.LogicalResourceId === 'TenantTargetGroup')?.PhysicalResourceId;
      const health = await cli(['elbv2', 'describe-target-health', '--target-group-arn', targetGroup]);
      if (health.TargetHealthDescriptions?.length !== 1 || health.TargetHealthDescriptions[0].TargetHealth?.State !== 'healthy' ||
          health.TargetHealthDescriptions[0].Target?.Port !== 3000) throw Error('LIVE_READY_TARGET_HEALTH_UNPROVED');
      const expected = plan.proposedDnsCreate.ChangeBatch.Changes[0].ResourceRecordSet;
      const dns = await cli(['route53', 'list-resource-record-sets', '--hosted-zone-id', plan.proposedDnsCreate.HostedZoneId,
        '--start-record-name', expected.Name, '--max-items', '2']);
      const aliases = (dns.ResourceRecordSets || []).filter(r => r.Name === expected.Name && r.Type === 'A');
      const dnsName = s => String(s || '').toLowerCase().replace(/\.$/, '').replace(/^dualstack\./, '');
      if (aliases.length !== 1 || aliases[0].AliasTarget?.HostedZoneId !== expected.AliasTarget.HostedZoneId ||
          dnsName(aliases[0].AliasTarget.DNSName) !== dnsName(expected.AliasTarget.DNSName) || aliases[0].AliasTarget.EvaluateTargetHealth !== false)
        throw Error('LIVE_READY_DNS_ALIAS_UNPROVED');
      await save('ready-provider-observation.json', { stackId: stack.StackId, taskDefinitionArn: td, taskArn: task.taskArn,
        imageDigest: task.containers[0].imageDigest, desired: svc.desiredCount, running: svc.runningCount,
        exactDnsAliasVerified: true, exactTargetHealthy: true, checkedAt: Date.now() });
      return result;
    },
    dispose() { infrastructure.dispose(); ec.destroy(); cc.destroy(); sm.destroy(); sts.destroy(); },
  };
}
