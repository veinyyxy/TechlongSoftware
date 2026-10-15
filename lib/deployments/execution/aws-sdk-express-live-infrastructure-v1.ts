import { CloudFormationClient, CreateStackCommand, DescribeStacksCommand, ListStackResourcesCommand, GetTemplateCommand,
  type CreateStackCommandInput } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient, TransactWriteItemsCommand, GetItemCommand,
  type TransactWriteItemsCommandInput } from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson, sha256Hex } from './hash.ts';
import { EXPRESS_LIVE_RESOURCES_V1 as C } from './express-live-delivery-plan-v1.ts';
import type { ExpressLivePlanV2 } from './express-live-persistence-v1.ts';
import type { TenantExternalOwnershipProof } from './contracts.ts';

const profile = 'techlong-sandbox-user', region = 'ca-central-1';
const expectedIdentity = { Account: '402010193138', Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev', UserId: 'AIDAV3GNMXTZEO7SHLC2X' };
const execute = promisify(execFile);
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }

/** Only exact, factory-rendered requests. All clients use maxAttempts=1.
 * One-shot methods are in-memory guarded BEFORE send, including failures.
 * The caller must additionally use a durable entry journal across processes. */
export async function createAwsSdkExpressLiveInfrastructureV1(plan: ExpressLivePlanV2) {
  const p = structuredClone(plan), { planSha256, ...body } = p;
  if (p.schema !== 'techlong/express-live-delivery-plan/v2' || await sha256Hex(body) !== planSha256 ||
      await sha256Hex(p.futureTemplate.templateBody) !== p.futureTemplate.templateSha256 ||
      p.proposedWorkloadCreate.TemplateBody !== p.futureTemplate.templateBody || p.futureTemplate.resourceInventory.length !== 7 ||
      p.proposedWorkloadCreate.RoleARN !== C.cloudFormationRoleArn || p.proposedWorkloadCreate.OnFailure !== 'ROLLBACK' ||
      p.proposedWorkloadCreate.StackName !== p.futureTemplate.stackName ||
      p.proposedEpochTransaction.TransactItems.length !== 2 || p.proposedDnsCreate.ChangeBatch.Changes.length !== 1 ||
      p.proposedDnsCreate.ChangeBatch.Changes[0].Action !== 'CREATE') fail('EXPRESS_INFRA_PLAN_REJECTED');
  const credentials = fromLoginCredentials({ profile }), config = { region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const cfn = new CloudFormationClient({ ...config, endpoint: 'https://cloudformation.ca-central-1.amazonaws.com' });
  const ddb = new DynamoDBClient({ ...config, endpoint: 'https://dynamodb.ca-central-1.amazonaws.com' });
  const sts = new STSClient({ ...config, endpoint: 'https://sts.ca-central-1.amazonaws.com' });
  const used = new Set<string>();
  const once = (key: string) => { if (used.has(key)) fail('EXPRESS_INFRA_ENTRY_ALREADY_USED'); used.add(key); };
  const safe = async <T>(operation: string, fn: () => Promise<T>) => {
    try { return await fn(); } catch { return fail('EXPRESS_' + operation + '_REQUIRES_INSPECT_NO_RETRY'); }
  };
  // Only non-secret Route53 JSON enters process arguments. Never a password,
  // JWT, database URL, private certificate/key, or Secret value.
  const cli = async (args: string[], signal: AbortSignal): Promise<Record<string, unknown>> => safe('ROUTE53', async () => {
    const { stdout } = await execute('aws', [...args, '--profile', profile, '--region', region, '--output', 'json', '--no-cli-pager'], {
      windowsHide: true, signal, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '', AWS_ENDPOINT_URL: undefined,
        AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true' },
    });
    return JSON.parse(stdout);
  });
  const exactStackId = (id: string) => {
    if (!new RegExp('^arn:aws:cloudformation:ca-central-1:402010193138:stack/' + p.futureTemplate.stackName +
      '/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(id)) fail('EXPRESS_WORKLOAD_UUID_REJECTED');
  };
  const readEpoch = async (signal: AbortSignal): Promise<TenantExternalOwnershipProof> => {
    const put = p.proposedEpochTransaction.TransactItems[1].Put!, check = p.proposedEpochTransaction.TransactItems[0].ConditionCheck!;
    const legacy = await ddb.send(new GetItemCommand({ TableName: C.epochTableArn,
      Key: { authority_key: put.Item.authority_key }, ConsistentRead: true }), { abortSignal: signal });
    const aurora = await ddb.send(new GetItemCommand({ TableName: C.epochTableArn,
      Key: check.Key, ConsistentRead: true }), { abortSignal: signal });
    if (canonicalJson(legacy.Item) !== canonicalJson(put.Item) || aurora.Item) fail('EXPRESS_EXTERNAL_EPOCH_DRIFT');
    const evidence = { protocol: 'express-first-epoch-strong-read/v1', tableArn: C.epochTableArn,
      recordSha256: await sha256Hex(put.Item), revision: 1, legacyStrongReadMatched: true, auroraStrongReadAbsent: true,
      provisionPredecessor: null };
    return { schemaVersion: 1, pendingFence: p.pendingExternalFence, provisionPredecessor: null,
      evidenceHash: await sha256Hex(evidence), evidence };
  };
  return Object.freeze({
    async assertIdentity(signal: AbortSignal) {
      const actual = await safe('SOURCE_IDENTITY', () => sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal }));
      if (Object.entries(expectedIdentity).some(([k, v]) => actual[k as keyof typeof actual] !== v)) fail('EXPRESS_SOURCE_IDENTITY_REJECTED');
    },
    async installEpoch(signal: AbortSignal) {
      once('epoch');
      await safe('EPOCH_SUBMISSION', () => ddb.send(new TransactWriteItemsCommand(
        p.proposedEpochTransaction as TransactWriteItemsCommandInput), { abortSignal: signal }));
      return safe('EPOCH_READBACK', () => readEpoch(signal));
    },
    async assertEpoch(signal: AbortSignal) { await safe('EPOCH_READBACK', () => readEpoch(signal)); },
    async createWorkload(signal: AbortSignal) {
      once('stack');
      const response = await safe('WORKLOAD_SUBMISSION', () => cfn.send(new CreateStackCommand(
        p.proposedWorkloadCreate as CreateStackCommandInput), { abortSignal: signal }));
      if (!response.StackId) fail('EXPRESS_WORKLOAD_UUID_MISSING'); exactStackId(response.StackId); return response.StackId;
    },
    async waitWorkload(stackId: string, signal: AbortSignal) {
      exactStackId(stackId);
      for (let n = 0; n < 180; n++) {
        signal.throwIfAborted();
        const result = await safe('WORKLOAD_READ', () => cfn.send(new DescribeStacksCommand({ StackName: stackId }), { abortSignal: signal }));
        const stack = result.Stacks?.[0];
        if (result.Stacks?.length !== 1 || stack?.StackId !== stackId || stack.RoleARN !== C.cloudFormationRoleArn ||
            canonicalJson(stack.Tags?.map(t => [t.Key, t.Value]).sort()) !== canonicalJson(Object.entries(p.futureTemplate.tags).sort()))
          fail('EXPRESS_WORKLOAD_READBACK_DRIFT');
        if (stack.StackStatus === 'CREATE_COMPLETE') {
          const original = await safe('WORKLOAD_TEMPLATE', () => cfn.send(new GetTemplateCommand({
            StackName: stackId, TemplateStage: 'Original' }), { abortSignal: signal }));
          if (!original.TemplateBody || canonicalJson(JSON.parse(original.TemplateBody)) !== canonicalJson(p.futureTemplate.template))
            fail('EXPRESS_WORKLOAD_TEMPLATE_DRIFT');
          const parameterSchema = p.futureTemplate.template.Parameters as Record<string, { NoEcho?: boolean; Default?: unknown }>;
          const expectedParameters = { ...Object.fromEntries(Object.entries(parameterSchema)
            .filter(([, v]) => v.Default !== undefined).map(([k, v]) => [k, String(v.Default)])), ...p.futureTemplate.parameters };
          const observedParameters = Object.fromEntries((stack.Parameters || []).map(v => [v.ParameterKey!, v.ParameterValue]));
          if (canonicalJson(Object.keys(observedParameters).sort()) !== canonicalJson(Object.keys(expectedParameters).sort()) ||
              Object.entries(expectedParameters).some(([k, v]) => !parameterSchema[k]?.NoEcho && observedParameters[k] !== v))
            fail('EXPRESS_WORKLOAD_PARAMETER_DRIFT');
          // NoEcho Secret REFERENCES cannot be independently compared through
          // DescribeStacks. Never relabel its masks as Secret-value proof.
          const resources = await safe('WORKLOAD_RESOURCES', () => cfn.send(new ListStackResourcesCommand({ StackName: stackId }), { abortSignal: signal }));
          const actual = resources.StackResourceSummaries || [], expected = p.futureTemplate.resourceInventory;
          if (resources.NextToken || actual.length !== 7 || actual.some(r => r.ResourceStatus !== 'CREATE_COMPLETE' || !r.PhysicalResourceId) ||
              expected.some(r => !actual.some(a => a.LogicalResourceId === r.logicalId && a.ResourceType === r.type)))
            fail('EXPRESS_SEVEN_RESOURCES_UNPROVED');
          return { stackId, resourceInventorySha256: await sha256Hex(actual.map(r => ({
            logicalId: r.LogicalResourceId, type: r.ResourceType, physicalId: r.PhysicalResourceId })).sort((a, b) => String(a.logicalId).localeCompare(String(b.logicalId)))) };
        }
        if (stack.StackStatus !== 'CREATE_IN_PROGRESS') fail('EXPRESS_WORKLOAD_TERMINAL_NOT_READY');
        if (n !== 179) await delay(15000, undefined, { signal });
      }
      return fail('EXPRESS_WORKLOAD_POLL_LIMIT_INSPECT_ONLY');
    },
    async createDns(signal: AbortSignal) {
      once('dns');
      const r = await cli(['route53', 'change-resource-record-sets', '--hosted-zone-id', p.proposedDnsCreate.HostedZoneId,
        '--change-batch', JSON.stringify(p.proposedDnsCreate.ChangeBatch)], signal);
      const id = (r.ChangeInfo as { Id?: string })?.Id;
      if (!id || !/^\/change\/[A-Z0-9]+$/.test(id)) fail('EXPRESS_DNS_CHANGE_ID_UNPROVED'); return id;
    },
    async waitDns(changeId: string, signal: AbortSignal) {
      if (!/^\/change\/[A-Z0-9]+$/.test(changeId)) fail('EXPRESS_DNS_CHANGE_ID_REJECTED');
      for (let n = 0; n < 40; n++) {
        const r = await cli(['route53', 'get-change', '--id', changeId], signal), info = r.ChangeInfo as { Id?: string; Status?: string };
        if (info?.Id !== changeId) fail('EXPRESS_DNS_READBACK_DRIFT');
        if (info.Status === 'INSYNC') return;
        if (info.Status !== 'PENDING') fail('EXPRESS_DNS_READBACK_DRIFT');
        if (n !== 39) await delay(15000, undefined, { signal });
      }
      fail('EXPRESS_DNS_POLL_LIMIT_INSPECT_ONLY');
    },
    dispose() { cfn.destroy(); ddb.destroy(); sts.destroy(); },
  });
}
