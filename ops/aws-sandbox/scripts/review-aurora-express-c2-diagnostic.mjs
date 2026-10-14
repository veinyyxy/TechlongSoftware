// C2b: read-only review/inspection and separately approved ONE SQL diagnostic.
// No create/modify/delete/grant/invoke/Secret-value command exists here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, open, mkdir, access, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { IAMClient, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam';
import contract from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';
import { C2_CLUSTER, C2_CLUSTER_ARN, C2_SOURCE, assertC2Approval } from '../../../lib/deployments/execution/aurora-express-c2-review.ts';
import { C2A_SHA, validateExistingExpressBinding, assertDiagnosticFacts, prepareDiagnosticReview,
  assertDiagnosticApproval } from '../../../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';

const root = path.resolve('F:/ChatGPT_workshop'), backend = 'E:/NodejsProject/SpeedFeast_Backend_main';
const platform = fileURLToPath(new URL('../../../', import.meta.url)), cli = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), fail = code => { throw Error(code); };
const rawArgs = process.argv.slice(2), pairs = [];
if (rawArgs.length % 2) fail('EXPRESS_C2B_ARGUMENTS_REJECTED');
for (let i = 0; i < rawArgs.length; i += 2) pairs.push([rawArgs[i], rawArgs[i + 1]]);
if (new Set(pairs.map(([key]) => key)).size !== pairs.length) fail('EXPRESS_C2B_ARGUMENTS_REJECTED');
const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
if (!['Review', 'Run', 'Inspect'].includes(mode) ||
  Object.keys(args).some(k => !['--mode', '--manifest', '--approved-sha', '--output'].includes(k)) ||
  !Object.values(args).every(v => typeof v === 'string' && v.length) ||
  path.dirname(out).toLowerCase() !== root.toLowerCase() || !/^techlong-d002-express-c2b-[a-z0-9-]+$/.test(path.basename(out)))
  fail('EXPRESS_C2B_ARGUMENTS_REJECTED');
await mkdir(out);
const save = async (name, value) => {
  const f = await open(path.join(out, name), 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
};
const historical = {
  manifest: path.join(root, 'techlong-d002-express-c2-review-20261014-r2/manifest.json'),
  code: path.join(root, 'techlong-d002-express-c2-run-20261014-r1/code-binding.json'),
  created: path.join(root, 'techlong-d002-express-c2-run-20261014-r1/created.json'),
  binding: path.join(root, 'techlong-d002-express-c2-run-20261014-r1/binding.json'),
  stopped: path.join(root, 'techlong-d002-express-c2-run-20261014-r1/stopped.json'),
  createSlot: path.join(root, 'techlong-d002-express-c2-create.permanent-slot.json'),
  sqlSlot: path.join(root, 'techlong-d002-express-c2-sql-inspect.permanent-slot.json'),
};
const readHistorical = async () => {
  const values = Object.fromEntries(await Promise.all(Object.entries(historical).map(async ([key, filename]) => {
    const bytes = await readFile(filename); return [key, { sha256: hash(bytes), value: JSON.parse(bytes) }];
  })));
  const old = values.code.value;
  if (old.pins.length !== 8 || contract.digest(old.pins) !== old.codeBindingSha256) fail('EXPRESS_C2B_OLD_CODE_BINDING_REJECTED');
  for (const pin of old.pins) {
    if (hash((await readFile(path.join(pin.repo, pin.name), 'utf8')).replace(/\r\n/g, '\n')) !== pin.sha256)
      fail('EXPRESS_C2B_FROZEN_CODE_DRIFT');
  }
  assertC2Approval(values.manifest.value, C2A_SHA, old.codeBindingSha256, Date.parse(values.manifest.value.preparedAt));
  const binding = validateExistingExpressBinding(values.binding.value), created = values.created.value, stopped = values.stopped.value;
  if (created.manifestSha256 !== C2A_SHA || created.clusterArn !== binding.clusterArn || created.clusterResourceId !== binding.clusterResourceId ||
    stopped.code !== 'EXPRESS_C2_INSPECT_FAILED' || stopped.writesAttempted !== 1 || stopped.sqlSessionsAttempted !== 1 ||
    stopped.retryAuthorized !== false || stopped.runtimeEnabled !== false ||
    values.createSlot.value.manifestSha256 !== C2A_SHA || values.sqlSlot.value.manifestSha256 !== C2A_SHA ||
    values.createSlot.value.requestSha256 !== contract.digest(values.manifest.value.request) ||
    values.sqlSlot.value.targetSha256 !== contract.digest({ schema: 'techlong/express-admin-target/c2', clusterArn: binding.clusterArn,
      clusterResourceId: binding.clusterResourceId, endpoint: binding.endpoint, observedEngineVersion: binding.engineVersion, port: binding.port }) ||
    contract.canonicalJson(binding.tags) !== contract.canonicalJson(Object.fromEntries(values.manifest.value.request.Tags.map(t => [t.Key, t.Value]))))
    fail('EXPRESS_C2B_CONSUMED_HISTORY_REJECTED');
  return { oldPins: old.pins, binding, history: { originalManifestSha256: C2A_SHA, originalCodeBindingSha256: old.codeBindingSha256,
    createdFileSha256: values.created.sha256, bindingFileSha256: values.binding.sha256, stoppedFileSha256: values.stopped.sha256,
    createSlotFileSha256: values.createSlot.sha256, sqlSlotFileSha256: values.sqlSlot.sha256 } };
};
const original = await readHistorical();
const additions = [[platform, 'ops/aws-sandbox/scripts/review-aurora-express-c2-diagnostic.mjs'],
  [platform, 'lib/deployments/execution/aurora-express-c2-diagnostic-review.ts'],
  [backend, 'services/saas/aurora_express_admin_diagnostic.js']];
const pins = [...original.oldPins, ...await Promise.all(additions.map(async ([repo, name]) => ({ repo, name,
  sha256: hash((await readFile(path.join(repo, name), 'utf8')).replace(/\r\n/g, '\n')) })))];
const codeSha = contract.digest(pins);
await save('code-binding.json', { codeBindingSha256: codeSha, pins });
const requireBackend = createRequire(path.join(backend, 'package.json')), rdsSdk = requireBackend('@aws-sdk/client-rds');
const { diagnoseExpressAdminC2 } = requireBackend('./services/saas/aurora_express_admin_diagnostic.js');
const credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } });
const config = { region: 'ca-central-1', credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const sts = new STSClient(config), iam = new IAMClient(config), rds = new rdsSdk.RDSClient(config);
let metadataCalls = 0, sqlSessions = 0;
const sendRead = (client, command) => {
  if (!['GetCallerIdentityCommand', 'DescribeDBClustersCommand', 'DescribeDBInstancesCommand', 'SimulatePrincipalPolicyCommand']
    .includes(command.constructor.name) || ++metadataCalls > 9) fail('EXPRESS_C2B_METADATA_COMMAND_OR_LIMIT_REJECTED');
  return client.send(command, { abortSignal: AbortSignal.timeout(45000) });
};
const checkSource = v => {
  if (v.Account !== '402010193138' || v.Arn !== C2_SOURCE || v.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('EXPRESS_C2B_SOURCE_MISMATCH');
  return { Account: v.Account, Arn: v.Arn, UserId: v.UserId };
};
const readBinding = async () => {
  const clusters = (await sendRead(rds, new rdsSdk.DescribeDBClustersCommand({ DBClusterIdentifier: C2_CLUSTER }))).DBClusters;
  if (clusters?.length !== 1) fail('EXPRESS_C2B_CLUSTER_AMBIGUOUS');
  const c = clusters[0];
  if (c.DBClusterArn !== C2_CLUSTER_ARN || c.DBClusterMembers?.length !== 1 || !c.DBClusterMembers[0].IsClusterWriter ||
    !c.IAMDatabaseAuthenticationEnabled || !c.InternetAccessGatewayEnabled || c.VPCNetworkingEnabled !== false ||
    c.MasterUsername !== 'postgres' || c.MasterUserSecret || c.DeletionProtection !== false ||
    contract.canonicalJson(c.ServerlessV2ScalingConfiguration) !== contract.canonicalJson({ MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 }))
    fail('EXPRESS_C2B_CLUSTER_CONFIGURATION_DRIFT');
  const member = c.DBClusterMembers[0].DBInstanceIdentifier;
  if (member !== original.binding.writerIdentifier) fail('EXPRESS_C2B_WRITER_MEMBER_DRIFT');
  const instances = (await sendRead(rds, new rdsSdk.DescribeDBInstancesCommand({ DBInstanceIdentifier: member }))).DBInstances;
  if (instances?.length !== 1 || instances[0].DBClusterIdentifier !== C2_CLUSTER || instances[0].DBInstanceClass !== 'db.serverless')
    fail('EXPRESS_C2B_WRITER_CONFIGURATION_DRIFT');
  const i = instances[0];
  return validateExistingExpressBinding({ manifestSha256: C2A_SHA, clusterArn: c.DBClusterArn, clusterResourceId: c.DbClusterResourceId,
    createdAt: c.ClusterCreateTime?.toISOString(), engineVersion: c.EngineVersion, endpoint: c.Endpoint, port: c.Port,
    writerIdentifier: member, writerArn: i.DBInstanceArn, writerResourceId: i.DbiResourceId, writerCreatedAt: i.InstanceCreateTime?.toISOString(),
    tags: Object.fromEntries((c.TagList || []).map(t => [t.Key, t.Value])), clusterStatus: c.Status, writerStatus: i.DBInstanceStatus });
};
const readFacts = async () => {
  const observedAt = new Date().toISOString(), resource = `arn:aws:rds-db:ca-central-1:402010193138:dbuser:${original.binding.clusterResourceId}/postgres`;
  const [source, binding, permissions, planOutput] = await Promise.all([
    sendRead(sts, new GetCallerIdentityCommand({})).then(checkSource), readBinding(),
    sendRead(iam, new SimulatePrincipalPolicyCommand({ PolicySourceArn: C2_SOURCE, ActionNames: ['rds-db:connect'], ResourceArns: [resource] })),
    cli('aws', ['freetier', 'get-account-plan-state', '--profile', 'techlong-sandbox-user', '--region', 'ca-central-1',
      '--no-cli-pager', '--output', 'json', '--query', '{planType:accountPlanType,planStatus:accountPlanStatus}'],
    { timeout: 45000, maxBuffer: 16384, env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_CLI_AUTO_PROMPT: 'off' } })]);
  metadataCalls++; // The finite CLI call is an additional metadata API.
  if (permissions.EvaluationResults?.length !== 1) fail('EXPRESS_C2B_CONNECT_SIMULATION_AMBIGUOUS');
  const p = permissions.EvaluationResults[0];
  const f = { observedAt, source, binding, plan: JSON.parse(planOutput.stdout), connectPermission: {
    action: p.EvalActionName, resource: p.EvalResourceName, decision: p.EvalDecision, missingContext: p.MissingContextValues || [] } };
  assertDiagnosticFacts(f, original.binding, Date.now()); return f;
};
const slotPath = path.join(root, 'techlong-d002-express-c2b-diagnostic-v1.permanent-slot.json');
const assertSlotEmpty = async () => {
  try { await access(slotPath); fail('EXPRESS_C2B_SLOT_OCCUPIED_INSPECT_ONLY'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
};
const readManifest = async () => {
  const filename = await realpath(args['--manifest']);
  if (!filename.toLowerCase().startsWith(root.toLowerCase() + path.sep) || path.basename(filename) !== 'manifest.json' ||
    !/^techlong-d002-express-c2b-/.test(path.basename(path.dirname(filename)))) fail('EXPRESS_C2B_MANIFEST_PATH_REJECTED');
  const r = JSON.parse(await readFile(filename, 'utf8'));
  assertDiagnosticApproval(r, r.manifestSha256, codeSha, Date.parse(r.preparedAt));
  if (contract.canonicalJson(r.history) !== contract.canonicalJson(original.history) ||
    contract.canonicalJson(r.facts.binding) !== contract.canonicalJson(original.binding)) fail('EXPRESS_C2B_HISTORY_DRIFT');
  return r;
};
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
    'DATABASE_URL', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGSSLCERT', 'PGSSLKEY'].some(k => process.env[k]) ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('EXPRESS_C2B_ENV_CONFLICT');
  if (mode === 'Review') {
    await assertSlotEmpty(); const f = await readFacts();
    const r = prepareDiagnosticReview(f, original.history, codeSha, Date.now()); await save('manifest.json', r);
    process.stdout.write(JSON.stringify({ mode, directory: out, manifestSha256: r.manifestSha256,
      expiresAt: r.expiresAt, limits: r.limits, awsResourceWrites: 0, sqlSessions: 0 }) + '\n');
  } else {
    const r = await readManifest();
    if (mode === 'Run') {
      const approval = () => assertDiagnosticApproval(r, args['--approved-sha'], codeSha, Date.now());
      approval(); await assertSlotEmpty(); const f = await readFacts();
      // Exact in-memory temporary Login snapshot, identity checked with the SAME
      // credentials used to sign the one DB login; never printed/persisted.
      const snapshot = await credentials();
      if (!snapshot.accessKeyId || !snapshot.secretAccessKey || !snapshot.sessionToken || !(snapshot.expiration instanceof Date) ||
        !Number.isFinite(snapshot.expiration.getTime()) || snapshot.expiration.getTime() < Date.now() + 120000)
        fail('EXPRESS_C2B_SOURCE_SNAPSHOT_TOO_SHORT');
      const snapshotSts = new STSClient({ ...config, credentials: snapshot });
      try { checkSource(await sendRead(snapshotSts, new GetCallerIdentityCommand({}))); } finally { snapshotSts.destroy(); }
      assertDiagnosticFacts(f, original.binding, Date.now()); approval();
      await save('preconnection-facts.json', f);
      const journal = await open(path.join(out, 'progress.jsonl'), 'wx'), controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
      let queue = Promise.resolve(), journalFailed = false;
      const event = frame => { queue = queue.then(async () => { await journal.writeFile(JSON.stringify(frame) + '\n'); await journal.sync(); })
        .catch(() => { journalFailed = true; controller.abort(); }); };
      let diagnostic;
      try {
        assertDiagnosticFacts(f, original.binding, Date.now()); approval(); const s = await open(slotPath, 'wx');
        try { await s.writeFile(JSON.stringify({ manifestSha256: r.manifestSha256, targetSha256: contract.digest(r.target),
          consumedAt: new Date().toISOString() }) + '\n'); await s.sync(); } finally { await s.close(); }
        assertDiagnosticFacts(f, original.binding, Date.now()); approval();
        if (snapshot.expiration.getTime() < Date.now() + 90000) fail('EXPRESS_C2B_SOURCE_SNAPSHOT_TOO_SHORT');
        sqlSessions++;
        diagnostic = await diagnoseExpressAdminC2({ target: r.target, credentialProvider: async () => snapshot, signal, onEvent: event });
        await queue;
      } finally { await queue; await journal.close(); }
      if (journalFailed) fail('EXPRESS_C2B_JOURNAL_FAILED_NO_RETRY');
      await save('diagnostic.json', diagnostic);
      const binding = await readBinding(); checkSource(await sendRead(sts, new GetCallerIdentityCommand({})));
      if (contract.canonicalJson(binding) !== contract.canonicalJson(original.binding)) fail('EXPRESS_C2B_POSTCONNECTION_BINDING_DRIFT');
      await save('postconnection-binding.json', binding);
      await save('result.json', { manifestSha256: r.manifestSha256, outcome: diagnostic.outcome,
        failureStage: diagnostic.failureStage, failure: diagnostic.failure, metadataCalls, sqlSessions,
        awsResourceWrites: 0, retryAuthorized: false, runtimeEnabled: false });
      process.stdout.write(JSON.stringify({ mode, directory: out, outcome: diagnostic.outcome, failureStage: diagnostic.failureStage,
        failure: diagnostic.failure, metadataCalls, sqlSessions, awsResourceWrites: 0, retryAuthorized: false }) + '\n');
      if (diagnostic.outcome === 'READONLY_DIAGNOSTIC_STOPPED') process.exitCode = 1;
    } else {
      const f = await readFacts(); await save('facts.json', f);
      process.stdout.write(JSON.stringify({ mode, directory: out, metadataCalls, sqlSessions: 0, awsResourceWrites: 0,
        outcome: 'PHYSICAL_BINDING_OBSERVED_SQL_NOT_REPLAYED' }) + '\n');
    }
  }
} catch (e) {
  const code = /^EXPRESS_C2B_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'EXPRESS_C2B_STOPPED_READONLY_INSPECT_REQUIRED';
  await save('stopped.json', { code, metadataCalls, sqlSessions, awsResourceWrites: 0, retryAuthorized: false, runtimeEnabled: false });
  process.stderr.write(JSON.stringify({ code, directory: out, metadataCalls, sqlSessions, awsResourceWrites: 0, retryAuthorized: false }) + '\n');
  process.exitCode = 1;
} finally { sts.destroy(); iam.destroy(); rds.destroy(); }
