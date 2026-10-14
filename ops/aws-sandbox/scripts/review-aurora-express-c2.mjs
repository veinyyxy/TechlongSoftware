// Review is read-only. Run/CleanupRun require separate exact fresh approval.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFile, mkdir, open, access, realpath } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { C2_ACTIONS, C2_CLUSTER, C2_CLUSTER_ARN, C2_SOURCE, assertC2Facts, prepareC2Review, assertC2Approval } from '../../../lib/deployments/execution/aurora-express-c2-review.ts';
import contract from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';

const root = 'F:/ChatGPT_workshop', backend = 'E:/NodejsProject/SpeedFeast_Backend_main';
const platform = fileURLToPath(new URL('../../../', import.meta.url));
const cli = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error(code); };
const rawArgs = process.argv.slice(2);
if (rawArgs.length % 2) fail('EXPRESS_C2_ARGUMENTS_REJECTED');
const pairs = rawArgs.reduce((pairs, value, i, values) => {
  if (i % 2 === 0) pairs.push([value, values[i + 1]]); return pairs;
}, []);
if (new Set(pairs.map(([key]) => key)).size !== pairs.length) fail('EXPRESS_C2_ARGUMENTS_REJECTED');
const args = Object.fromEntries(pairs);
const mode = args['--mode'], out = path.resolve(args['--output'] || '');
if (!['Review', 'Run', 'Inspect', 'CleanupReview', 'CleanupRun'].includes(mode) ||
  Object.keys(args).some(k => !['--mode', '--output', '--manifest', '--approved-sha', '--receipt'].includes(k)) ||
  !Object.values(args).every(v => typeof v === 'string' && v.length) ||
  path.dirname(out).toLowerCase() !== path.resolve(root).toLowerCase() ||
  !/^techlong-d002-express-c2-[a-z0-9-]+$/.test(path.basename(out))) fail('EXPRESS_C2_ARGUMENTS_REJECTED');
await mkdir(out); // Must be a new output directory, never overwrite evidence.
const save = async (name, value) => {
  const f = await open(path.join(out, name), 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
};
const privateJson = async filename => {
  const resolved = await realpath(filename);
  if (!resolved.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep) ||
    !/^techlong-d002-express-c2-/.test(path.basename(path.dirname(resolved))) ||
    !['manifest.json', 'created.json', 'binding.json', 'cleanup-manifest.json'].includes(path.basename(resolved)))
    fail('EXPRESS_C2_PRIVATE_INPUT_REJECTED');
  return JSON.parse(await readFile(resolved, 'utf8'));
};
const pinPaths = [[platform, 'ops/aws-sandbox/scripts/review-aurora-express-c2.mjs'],
  [platform, 'lib/deployments/execution/aurora-express-c2-review.ts'],
  [platform, 'lib/deployments/execution/aurora-database-contract-v2.cjs'], [platform, 'package-lock.json'],
  [backend, 'services/saas/aurora_express_admin_probe.js'], [backend, 'services/saas/aurora_connections_v2.js'],
  [backend, 'services/saas/database_contract_v2.cjs'], [backend, 'package-lock.json']];
const pins = await Promise.all(pinPaths.map(async ([repo, name]) => ({ repo, name,
  sha256: hash((await readFile(path.join(repo, name), 'utf8')).replace(/\r\n/g, '\n')) })));
const codeSha = contract.digest(pins);
await save('code-binding.json', { codeBindingSha256: codeSha, pins });
let writes = 0, sqlSessions = 0;
const prefix = path.join(root, 'techlong-d002-express-c2');
const requireBackend = createRequire(path.join(backend, 'package.json'));
const rdsSdk = requireBackend('@aws-sdk/client-rds');
const { inspectExpressAdminC2 } = requireBackend('./services/saas/aurora_express_admin_probe.js');
const credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user',
  clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } });
const config = { region: 'ca-central-1', credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const sts = new STSClient(config), rds = new rdsSdk.RDSClient(config);
const send = (client, command) => client.send(command, { abortSignal: AbortSignal.timeout(45000) });
const aws = async (service, operation, rest = [], query) => {
  const result = await cli('aws', [service, operation, ...rest, '--profile', 'techlong-sandbox-user',
    '--region', 'ca-central-1', '--no-cli-pager', '--output', 'json', ...(query ? ['--query', query] : [])],
  { timeout: 45000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env,
    AWS_MAX_ATTEMPTS: '1', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_CLI_AUTO_PROMPT: 'off' } });
  return JSON.parse(result.stdout);
};
const identity = async () => {
  const v = await send(sts, new GetCallerIdentityCommand({}));
  if (v.Account !== '402010193138' || v.Arn !== C2_SOURCE || v.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('EXPRESS_C2_SOURCE_MISMATCH');
  return { Account: v.Account, Arn: v.Arn, UserId: v.UserId };
};
const facts = async () => {
  const observedAt = new Date().toISOString();
  const [who, plan, clusters, instances, engine, quotas, role, simulation] = await Promise.all([
    identity(), aws('freetier', 'get-account-plan-state', [], '{planType:accountPlanType,planStatus:accountPlanStatus}'),
    aws('rds', 'describe-db-clusters', [], 'DBClusters[].{DBClusterIdentifier:DBClusterIdentifier}'),
    aws('rds', 'describe-db-instances', [], 'DBInstances[].{DBInstanceIdentifier:DBInstanceIdentifier}'),
    aws('rds', 'describe-db-engine-versions', ['--engine', 'aurora-postgresql', '--default-only'], 'DBEngineVersions'),
    aws('rds', 'describe-account-attributes', [], 'AccountQuotas'),
    aws('iam', 'get-role', ['--role-name', 'AWSServiceRoleForRDS'], 'Role.{Arn:Arn,RoleId:RoleId}'),
    aws('iam', 'simulate-principal-policy', ['--policy-source-arn', C2_SOURCE, '--action-names', ...C2_ACTIONS],
      'EvaluationResults[].{EvalActionName:EvalActionName,EvalDecision:EvalDecision,MissingContextValues:MissingContextValues}')]);
  if (engine.length !== 1) fail('EXPRESS_C2_DEFAULT_ENGINE_AMBIGUOUS');
  const q = name => { const found = quotas.filter(q => q.AccountQuotaName === name);
    if (found.length !== 1) fail('EXPRESS_C2_QUOTA_AMBIGUOUS'); return found[0]; };
  const f = { observedAt, identity: who, plan, clusters, instances, defaultEngine: {
    EngineVersion: engine[0].EngineVersion, ServerlessV2FeaturesSupport: engine[0].ServerlessV2FeaturesSupport },
    quotas: { clustersUsed: q('DBClusters').Used, clustersMax: q('DBClusters').Max,
      instancesUsed: q('DBInstances').Used, instancesMax: q('DBInstances').Max },
    rdsServiceRole: role, permissions: simulation };
  assertC2Facts(f, Date.now()); return f;
};
const prices = async () => {
  const url = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ca-central-1/index.json';
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: 'error' });
  if (!response.ok) fail('EXPRESS_C2_PRICE_FEED_FAILED');
  const bytes = await response.text(), feed = JSON.parse(bytes);
  const selected = ['CAN1-Aurora:ServerlessV2Usage', 'CAN1-Aurora:StorageUsage', 'CAN1-Aurora:StorageIOUsage'].map(usage => {
    const products = Object.values(feed.products).filter(p => p.attributes.usagetype === usage && p.attributes.databaseEngine === 'Aurora PostgreSQL');
    if (products.length !== 1) fail('EXPRESS_C2_PRICE_AMBIGUOUS');
    const product = products[0], offers = Object.values(feed.terms.OnDemand[product.sku] || {});
    const dimensions = offers.flatMap(o => Object.values(o.priceDimensions));
    if (dimensions.length !== 1 || !dimensions[0].pricePerUnit.USD) fail('EXPRESS_C2_PRICE_AMBIGUOUS');
    return { sku: product.sku, usage, unit: dimensions[0].unit, usd: Number(dimensions[0].pricePerUnit.USD) };
  });
  if (selected.map(r => r.unit).join(',') !== 'ACU-Hr,GB-Mo,IOs') fail('EXPRESS_C2_PRICE_UNITS_CHANGED');
  const p = { observedAt: new Date().toISOString(), feedSha256: hash(bytes), publicationDate: feed.publicationDate,
    acuHour: selected[0].usd, storageGbMonth: selected[1].usd, ioRequest: selected[2].usd,
    gatewayRate: 'UNCONFIRMED_NOT_ASSUMED_ZERO' };
  await save('prices.json', { ...p, url, selected }); return p;
};
const slot = async (purpose, data) => {
  const f = await open(`${prefix}-${purpose}.permanent-slot.json`, 'wx');
  try { await f.writeFile(JSON.stringify({ ...data, consumedAt: new Date().toISOString() }) + '\n'); await f.sync(); } finally { await f.close(); }
};
const emptySlot = async purpose => {
  try { await access(`${prefix}-${purpose}.permanent-slot.json`); fail('EXPRESS_C2_SLOT_OCCUPIED_INSPECT_ONLY'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
};
const validateManifest = async () => {
  const r = await privateJson(args['--manifest']);
  // Inspect can read expired reviews, but still verifies exact scope/code hashes.
  assertC2Approval(r, r.manifestSha256, codeSha, Date.parse(r.preparedAt)); return r;
};
const createdBinding = async (r, expected) => {
  const clusters = (await send(rds, new rdsSdk.DescribeDBClustersCommand({ DBClusterIdentifier: C2_CLUSTER }))).DBClusters;
  if (clusters?.length !== 1) fail('EXPRESS_C2_CLUSTER_AMBIGUOUS');
  const c = clusters[0], tags = Object.fromEntries((c.TagList || []).map(t => [t.Key, t.Value]));
  if (c.DBClusterArn !== C2_CLUSTER_ARN || c.DBClusterIdentifier !== C2_CLUSTER ||
    !/^cluster-[A-Z0-9]{20,40}$/.test(c.DbClusterResourceId || '') || c.Engine !== 'aurora-postgresql' ||
    !c.IAMDatabaseAuthenticationEnabled || !c.InternetAccessGatewayEnabled || c.VPCNetworkingEnabled !== false ||
    c.MasterUsername !== 'postgres' || c.MasterUserSecret || c.DeletionProtection !== false ||
    contract.canonicalJson(tags) !== contract.canonicalJson(Object.fromEntries(r.request.Tags.map(t => [t.Key, t.Value]))) ||
    c.DBClusterMembers?.length !== 1 || !c.DBClusterMembers[0].IsClusterWriter ||
    !(c.ClusterCreateTime instanceof Date) || !Number.isFinite(c.ClusterCreateTime.getTime()) ||
    c.ClusterCreateTime.getTime() < Date.parse(r.preparedAt) ||
    contract.canonicalJson(c.ServerlessV2ScalingConfiguration) !== contract.canonicalJson(r.request.ServerlessV2ScalingConfiguration))
    fail('EXPRESS_C2_CREATED_CLUSTER_SCOPE_UNPROVEN');
  const member = c.DBClusterMembers[0].DBInstanceIdentifier;
  const rows = (await send(rds, new rdsSdk.DescribeDBInstancesCommand({ DBInstanceIdentifier: member }))).DBInstances;
  if (rows?.length !== 1 || rows[0].DBClusterIdentifier !== C2_CLUSTER || rows[0].DBInstanceClass !== 'db.serverless' ||
    !/^db-[A-Z0-9]{20,40}$/.test(rows[0].DbiResourceId || '') || !(rows[0].InstanceCreateTime instanceof Date) ||
    rows[0].DBInstanceArn !== `arn:aws:rds:ca-central-1:402010193138:db:${member}`) fail('EXPRESS_C2_WRITER_SCOPE_UNPROVEN');
  const b = { manifestSha256: r.manifestSha256, clusterArn: c.DBClusterArn, clusterResourceId: c.DbClusterResourceId,
    createdAt: c.ClusterCreateTime.toISOString(), engineVersion: c.EngineVersion, endpoint: c.Endpoint, port: c.Port,
    writerIdentifier: member, writerArn: rows[0].DBInstanceArn, writerResourceId: rows[0].DbiResourceId,
    writerCreatedAt: rows[0].InstanceCreateTime.toISOString(), tags,
    clusterStatus: c.Status, writerStatus: rows[0].DBInstanceStatus };
  if (expected && contract.canonicalJson(b) !== contract.canonicalJson(expected)) fail('EXPRESS_C2_PHYSICAL_BINDING_DRIFT');
  return b;
};
const pause = () => new Promise(resolve => setTimeout(resolve, 10000));
const waitAbsent = async (kind, id) => {
  const deadline = Date.now() + 20 * 60000;
  for (let i = 0; i < 120 && Date.now() < deadline; i++) {
    try { await send(rds, kind === 'writer' ? new rdsSdk.DescribeDBInstancesCommand({ DBInstanceIdentifier: id }) :
      new rdsSdk.DescribeDBClustersCommand({ DBClusterIdentifier: id })); }
    catch (e) { if (e.name === (kind === 'writer' ? 'DBInstanceNotFoundFault' : 'DBClusterNotFoundFault')) return;
      throw e; }
    await pause();
  }
  fail('EXPRESS_C2_DELETION_PENDING_INSPECT_REQUIRED');
};
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE']
    .some(k => process.env[k]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('EXPRESS_C2_SOURCE_ENV_CONFLICT');
  if (mode === 'Review') {
    await emptySlot('create');
    const p = await prices(), f = await facts();
    const r = prepareC2Review(f, p, codeSha, randomBytes(16).toString('hex'), Date.now());
    await save('manifest.json', r);
    process.stdout.write(JSON.stringify({ mode, directory: out, manifestSha256: r.manifestSha256,
      expiresAt: r.expiresAt, limits: r.limits, estimate: r.estimate, awsWrites: 0 }) + '\n');
  } else if (mode === 'CleanupRun') {
    const cleanup = await privateJson(args['--manifest']);
    const { manifestSha256, ...material } = cleanup;
    const cleanupGuard = () => {
      if (cleanup.schema !== 'techlong/express-c2-cleanup/v1' || manifestSha256 !== contract.digest(material) ||
        args['--approved-sha'] !== manifestSha256 || cleanup.codeBindingSha256 !== codeSha ||
        !Number.isFinite(Date.parse(cleanup.preparedAt)) ||
        Date.parse(cleanup.expiresAt) - Date.parse(cleanup.preparedAt) !== 3600000 ||
        cleanup.maximumWrites !== 2 || cleanup.runtimeEnabled !== false ||
        Date.now() < Date.parse(cleanup.preparedAt) || Date.now() >= Date.parse(cleanup.expiresAt)) fail('EXPRESS_C2_CLEANUP_APPROVAL_REQUIRED');
    };
    cleanupGuard();
    const r = await privateJson(cleanup.creationManifest);
    assertC2Approval(r, r.manifestSha256, codeSha, Date.parse(r.preparedAt));
    if (cleanup.creationManifestSha256 !== r.manifestSha256 || cleanup.deleteFinalSnapshots !== true || cleanup.deleteAutomatedBackups !== true)
      fail('EXPRESS_C2_CLEANUP_SCOPE_REJECTED');
    await identity(); await createdBinding(r, cleanup.binding); cleanupGuard();
    await slot('writer-delete', { manifestSha256 }); cleanupGuard(); writes++;
    await send(rds, new rdsSdk.DeleteDBInstanceCommand({ DBInstanceIdentifier: cleanup.binding.writerIdentifier,
      SkipFinalSnapshot: true, DeleteAutomatedBackups: true }));
    await save('writer-delete-submitted.json', { manifestSha256, writerArn: cleanup.binding.writerArn });
    await waitAbsent('writer', cleanup.binding.writerIdentifier);
    const c = (await send(rds, new rdsSdk.DescribeDBClustersCommand({ DBClusterIdentifier: C2_CLUSTER }))).DBClusters?.[0];
    if (c?.DBClusterArn !== cleanup.binding.clusterArn || c.DbClusterResourceId !== cleanup.binding.clusterResourceId ||
      c.ClusterCreateTime?.toISOString() !== cleanup.binding.createdAt || c.DBClusterMembers?.length ||
      contract.canonicalJson(Object.fromEntries((c.TagList || []).map(t => [t.Key, t.Value]))) !== contract.canonicalJson(cleanup.binding.tags))
      fail('EXPRESS_C2_CLUSTER_DELETE_IDENTITY_DRIFT');
    await identity(); cleanupGuard(); await slot('cluster-delete', { manifestSha256 }); cleanupGuard(); writes++;
    await send(rds, new rdsSdk.DeleteDBClusterCommand({ DBClusterIdentifier: C2_CLUSTER,
      SkipFinalSnapshot: true, DeleteAutomatedBackups: true }));
    await save('cluster-delete-submitted.json', { manifestSha256, clusterArn: C2_CLUSTER_ARN });
    await waitAbsent('cluster', C2_CLUSTER);
    await save('result.json', { outcome: 'DELETE_ABSENCE_OBSERVED_REQUIRES_INDEPENDENT_INSPECT', writes, runtimeEnabled: false });
    process.stdout.write(JSON.stringify({ mode, directory: out, writes, deletedOnly: [cleanup.binding.writerArn, C2_CLUSTER_ARN] }) + '\n');
  } else {
    const r = await validateManifest();
    if (mode === 'Run') {
      assertC2Approval(r, args['--approved-sha'], codeSha, Date.now()); await emptySlot('create');
      const f = await facts();
      if (f.defaultEngine.EngineVersion !== r.facts.defaultEngine.EngineVersion || f.rdsServiceRole.RoleId !== r.facts.rdsServiceRole.RoleId)
        fail('EXPRESS_C2_REVIEW_FACT_DRIFT');
      assertC2Approval(r, args['--approved-sha'], codeSha, Date.now());
      await save('prewrite-facts.json', f); await slot('create', { manifestSha256: r.manifestSha256, requestSha256: contract.digest(r.request) });
      writes++;
      const created = await send(rds, new rdsSdk.CreateDBClusterCommand(r.request));
      await save('created.json', { manifestSha256: r.manifestSha256, clusterArn: created.DBCluster?.DBClusterArn,
        clusterResourceId: created.DBCluster?.DbClusterResourceId, requestId: created.$metadata.requestId });
      let b;
      const observationDeadline = Date.now() + 20 * 60000;
      for (let i = 0; i < 120 && Date.now() < observationDeadline; i++) {
        const rows = (await send(rds, new rdsSdk.DescribeDBClustersCommand({ DBClusterIdentifier: C2_CLUSTER }))).DBClusters;
        if (rows?.[0]?.Status === 'available') { b = await createdBinding(r); break; }
        await pause();
      }
      if (!b || b.writerStatus !== 'available' || b.clusterResourceId !== created.DBCluster?.DbClusterResourceId || b.clusterArn !== created.DBCluster?.DBClusterArn)
        fail('EXPRESS_C2_CREATE_PENDING_OR_IDENTITY_UNPROVEN');
      await save('binding.json', b); await identity();
      if (Date.now() >= Date.parse(r.expiresAt) || Date.now() - Date.parse(b.createdAt) > 20 * 60000)
        fail('EXPRESS_C2_SQL_WINDOW_EXPIRED');
      await createdBinding(r, b);
      const target = { schema: 'techlong/express-admin-target/c2', clusterArn: b.clusterArn, clusterResourceId: b.clusterResourceId,
        endpoint: b.endpoint, observedEngineVersion: b.engineVersion, port: b.port };
      await slot('sql-inspect', { manifestSha256: r.manifestSha256, targetSha256: contract.digest(target) }); sqlSessions++;
      const observation = await inspectExpressAdminC2({ target, credentialProvider: credentials, signal: AbortSignal.timeout(45000) });
      await save('sql-observation.json', observation); await createdBinding(r, b);
      await save('result.json', { outcome: 'EXPRESS_ADMIN_READONLY_OBSERVED_NOT_TENANT_VERIFIED', writes, sqlSessions, runtimeEnabled: false });
      process.stdout.write(JSON.stringify({ mode, directory: out, writes, sqlSessions, runtimeEnabled: false,
        outcome: 'EXPRESS_ADMIN_READONLY_OBSERVED_NOT_TENANT_VERIFIED' }) + '\n');
    } else {
      await identity(); const b = await createdBinding(r);
      await save('binding.json', b);
      if (mode === 'CleanupReview') {
        const receipt = await privateJson(args['--receipt']);
        if (receipt.manifestSha256 !== r.manifestSha256 || receipt.clusterArn !== b.clusterArn || receipt.clusterResourceId !== b.clusterResourceId)
          fail('EXPRESS_C2_CREATE_RECEIPT_REQUIRED_FOR_CLEANUP');
        const material = { schema: 'techlong/express-c2-cleanup/v1', preparedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(), codeBindingSha256: codeSha,
          creationManifest: await realpath(args['--manifest']), creationManifestSha256: r.manifestSha256,
          binding: b, deleteFinalSnapshots: true, deleteAutomatedBackups: true, maximumWrites: 2, runtimeEnabled: false };
        const cleanup = { ...material, manifestSha256: contract.digest(material) };
        await save('cleanup-manifest.json', cleanup);
        process.stdout.write(JSON.stringify({ mode, directory: out, manifestSha256: cleanup.manifestSha256, expiresAt: cleanup.expiresAt, writes: 0 }) + '\n');
      } else process.stdout.write(JSON.stringify({ mode, directory: out, binding: b, writes: 0, sqlSessions: 0 }) + '\n');
    }
  }
} catch (e) {
  const code = /^EXPRESS_C2_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'EXPRESS_C2_OPERATION_FAILED_INSPECT_REQUIRED';
  await save('stopped.json', { code, observedAt: new Date().toISOString(), writesAttempted: writes, sqlSessionsAttempted: sqlSessions,
    retryAuthorized: false, runtimeEnabled: false });
  process.stderr.write(JSON.stringify({ code, directory: out, writesAttempted: writes, sqlSessionsAttempted: sqlSessions,
    retryAuthorized: false }) + '\n'); process.exitCode = 1;
} finally { sts.destroy(); rds.destroy(); }
