// LOCAL installer adapter. Deliberately not imported by the cloud runtime.
import { readFile, writeFile, lstat, realpath, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import * as cfn from '@aws-sdk/client-cloudformation';
import * as iam from '@aws-sdk/client-iam';
import * as ddb from '@aws-sdk/client-dynamodb';
import * as sm from '@aws-sdk/client-secrets-manager';
import * as s3 from '@aws-sdk/client-s3';
import { readAwsInstallInventoryV5, readNeonInstallInventoryV5, INSTALL_CANDIDATE_V5 as C } from './inventory-v5.mjs';
import { INSTALL_SCOPE_V5 as I, foundationTemplateV5, secretResourcePolicyV5, evidenceBucketPolicyV5 } from './plan-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
import { scramVerifierV5, neonInstallStatementsV5 } from './neon-install-sql-v5.mjs';
export { scramVerifierV5, neonInstallStatementsV5 } from './neon-install-sql-v5.mjs';
import { NEON_CATALOG_SQL_V5, verifyNeonCatalogV5 } from '../neon-persistence-v5.mjs';
import { createCloudControlSourcesV5, CLOUD_CONTROL_V5 } from '../cloud-control-v5.mjs';
import { createEvidencePortV5 } from '../cloud-evidence-v5.mjs';
import { validateDatabaseMaterialV5 } from '../cloud-application-v5.mjs';
import { computeCloudClosureV5 } from '../closure-v5.mjs';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const exec = promisify(execFile), repo = fileURLToPath(new URL('../../../', import.meta.url));
const must = (v, code) => { if (!v) throw Error(code); }, same = (a, b) => canonicalJson(a) === canonicalJson(b);
const rawSha = v => createHash('sha256').update(v).digest('hex');
export const INSTALL_LOCAL_V5 = Object.freeze({ base: 'F:/ChatGPT_workshop',
  slot: 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-install.permanent-slot.json',
  privateDirectory: 'F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2',
  summarySha256: '9daf504a6d4cd3b281cb9632f41c45085d6f531f6af96680e44f05c8a805fd63' });
export async function writePublicOnceV5(directory, name, value) {
  must(/^[a-zA-Z0-9.-]+$/.test(name), 'INSTALL_RECEIPT_NAME');
  const text = JSON.stringify(value, null, 2) + '\n';
  must(!/postgres(?:ql)?:\/\/|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|SCRAM-SHA-256\$|\bASIA[A-Z0-9]{16}\b/.test(text), 'INSTALL_RECEIPT_PRIVATE_VALUE');
  await writeFile(path.join(directory, name + '.json'), text, { flag: 'wx', flush: true });
}
export function assertLocalEnvironmentV5() {
  must(process.platform === 'win32' && process.version === 'v22.19.0' && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' &&
    !['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE',
      'DATABASE_URL','PGHOST','PGPASSWORD','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].some(k => process.env[k]), 'INSTALL_LOCAL_ENVIRONMENT');
  for (const k of Object.keys(process.env)) must(!/^AWS_ENDPOINT_URL/.test(k), 'INSTALL_ENDPOINT_OVERRIDE');
}
export async function sourceBindingV5() {
  const git = async args => (await exec('git', args, { cwd: repo, windowsHide: true, maxBuffer: 3000000 })).stdout;
  must((await git(['branch','--show-current'])).trim() === 'main' && (await git(['status','--porcelain'])).trim() === '', 'INSTALL_CLEAN_MAIN_REQUIRED');
  const commit = (await git(['rev-parse','HEAD'])).trim(), closure = await computeCloudClosureV5();
  const files = new Set(closure.pins.map(p => p.file));
  const local = (await git(['ls-files','-z','ops/cloud-worker',
    'tests/cloud-worker-installer-v5.test.mjs','scripts/ci/verify-cloud-neon-v5.mjs',
    'docs/aws-auto-deployment-cloud-worker-w5e-installer.md'])).split('\0').filter(Boolean);
  local.forEach(f => files.add(f));
  const pins = await Promise.all([...files].sort().map(async file => ({ file,
    normalizedLfSha256: rawSha((await readFile(path.join(repo, file), 'utf8')).replaceAll('\r\n','\n')) })));
  return { commit, node: process.version, runtimeClosureSha256: closure.closureSha256, files: pins };
}
export async function materialBindingV5() {
  const dir = INSTALL_LOCAL_V5.privateDirectory;
  must((await realpath(dir)).toLowerCase() === path.resolve(dir).toLowerCase() && !(await lstat(dir)).isSymbolicLink(), 'INSTALL_MATERIAL_DIRECTORY');
  const summary = await readFile(path.join(dir, 'summary.json'), 'utf8'), binding = await readFile(path.join(dir, 'binding.json'), 'utf8');
  must(rawSha(summary) === INSTALL_LOCAL_V5.summarySha256, 'INSTALL_PUBLIC_MATERIAL_HISTORY');
  const s = JSON.parse(summary), b = JSON.parse(binding), stat = await lstat(path.join(dir, 'private-material.json'));
  must(await sha256Hex(b) === s.bindingSha256 && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 60000,
    'INSTALL_MATERIAL_PUBLIC_BINDING');
  return { directory: dir, summarySha256: rawSha(summary), bindingSha256: rawSha(binding), privateFileSize: stat.size,
    privateFileContentReadDuringReview: false, originalEightFieldBundleIncludesStripeInMemory: true,
    uploadOnlyFiveControlPemFields: true };
}
async function readControlOnce(material, fingerprints) {
  // Same original two-principal ACL requirement, but one minimal projection.
  // No ACL repair, JWT issuance, Stripe request or second private file read.
  must(same(material, await materialBindingV5()), 'INSTALL_MATERIAL_DRIFT');
  const dir = INSTALL_LOCAL_V5.privateDirectory;
  const aclScript = "$ErrorActionPreference='Stop';$taskDir=$env:TECHLONG_CREDENTIAL_DIR;" +
    "$taskSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;" +
    "$taskPaths=@($taskDir)+@(@('summary.json','binding.json','private-material.json','control-public-key.pem','acl-proof.json')|ForEach-Object{Join-Path $taskDir $_});" +
    "foreach($taskPath in $taskPaths){$taskAcl=Get-Acl -LiteralPath $taskPath;" +
    "if($taskPath -eq $taskDir -and -not $taskAcl.AreAccessRulesProtected){throw 'ACL'};" +
    "$taskRules=@($taskAcl.Access);if($taskRules.Count -ne 2){throw 'ACL'};" +
    "$taskPrincipals=@($taskRules|ForEach-Object{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value});" +
    "if($taskPrincipals -notcontains $taskSid -or $taskPrincipals -notcontains 'S-1-5-18'){throw 'ACL'};" +
    "foreach($taskRule in $taskRules){if($taskRule.AccessControlType -ne 'Allow' -or $taskRule.FileSystemRights -ne 'FullControl'){throw 'ACL'}}};'VERIFIED'";
  const env = { ...process.env, TECHLONG_CREDENTIAL_DIR: dir };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'psmodulepath') delete env[k];
  must((await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command',aclScript],
    { windowsHide: true, timeout: 15000, env, maxBuffer: 1000 })).stdout.trim() === 'VERIFIED', 'INSTALL_PRIVATE_ACL');
  for (const name of ['summary.json','binding.json','private-material.json','control-public-key.pem','acl-proof.json']) {
    const file = path.join(dir, name), stat = await lstat(file);
    must(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 100000 &&
      (await realpath(file)).toLowerCase() === path.resolve(file).toLowerCase(), 'INSTALL_PRIVATE_FILE');
  }
  const raw = JSON.parse(await readFile(path.join(dir, 'private-material.json'), 'utf8'));
  const names = ['signingPrivateKeyPem','signingPublicKeyPem','clientCertificatePem','clientPrivateKeyPem','clientCaPem'];
  must(Object.keys(raw).sort().join(',') === [...names,'stripeSecretKey','stripeWebhookSecret','stripePublishableKey'].sort().join(',') &&
    Object.values(raw).every(v => typeof v === 'string'), 'INSTALL_OLD_PRIVATE_SHAPE');
  const payload = { schema: CLOUD_CONTROL_V5.schema, appInstanceId: CLOUD_CONTROL_V5.appInstanceId,
    ...Object.fromEntries(names.map(k => [k, raw[k]])) };
  const proof = await createCloudControlSourcesV5(payload, fingerprints); proof.dispose();
  return payload;
}
const ownerCatalogSql = NEON_CATALOG_SQL_V5.replace('current_user AS current_user, session_user AS session_user',
  'r.rolname::text AS current_user, r.rolname::text AS session_user').replace('r.rolname=current_user', "r.rolname='techlong_cloud_worker_v5'");
export function createLocalInstallIoV5({ output, capsule }) {
  const cfg = { region: 'ca-central-1', ignoreConfiguredEndpointUrls: true, maxAttempts: 1 },
    credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', ignoreCache: true, clientConfig: cfg });
  const clients = { cfn: new cfn.CloudFormationClient({ ...cfg, credentials }), iam: new iam.IAMClient({ ...cfg, region: 'us-east-1', credentials }),
    ddb: new ddb.DynamoDBClient({ ...cfg, credentials }), sm: new sm.SecretsManagerClient({ ...cfg, credentials }), s3: new s3.S3Client({ ...cfg, credentials }) };
  const allowed = new Set(['DescribeStacksCommand','GetTemplateCommand','ListStackResourcesCommand','CreateStackCommand',
    'GetRoleCommand','ListRolePoliciesCommand','ListAttachedRolePoliciesCommand','GetRolePolicyCommand','GetPolicyCommand','GetPolicyVersionCommand',
    'DescribeTableCommand','DescribeTimeToLiveCommand','HeadBucketCommand','GetPublicAccessBlockCommand','GetBucketEncryptionCommand',
    'GetBucketOwnershipControlsCommand','GetBucketVersioningCommand','GetBucketPolicyCommand',
    'DescribeSecretCommand','GetResourcePolicyCommand','CreateSecretCommand','PutResourcePolicyCommand','PutSecretValueCommand']);
  const send = (client, command) => { must(allowed.has(command.constructor.name), 'INSTALL_FIXED_API_ALLOWLIST');
    return client.send(command, { abortSignal: AbortSignal.timeout(30000) }); };
  const policy = v => JSON.parse(typeof v === 'string' ? decodeURIComponent(v) : JSON.stringify(v));
  let privateUrl, ownerUrl, ownerTarget, storedControl;
  const owner = async () => { if (!ownerUrl) {
    const e = parseEnv(await readFile(new URL('../../../.env.local', import.meta.url), 'utf8')); ownerUrl = e.DATABASE_URL;
    const u = new URL(ownerUrl); must(['postgres:','postgresql:'].includes(u.protocol) &&
      /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) && (!u.port || u.port === '5432') &&
      /^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname) && decodeURIComponent(u.username) === 'neondb_owner' &&
      ['require','verify-full'].includes(u.searchParams.get('sslmode')), 'INSTALL_OWNER_TLS');
    if (ownerTarget) must(ownerTarget === await sha256Hex({ host: u.hostname, port: 5432, database: u.pathname.slice(1),
      role: 'neondb_owner', transport: 'NeonHTTPS' }), 'INSTALL_OWNER_TARGET_DRIFT');
  } return ownerUrl; };
  const catalog = async url => {
    const sql = neon(url, { fullResults: true }), text = url === privateUrl ? NEON_CATALOG_SQL_V5 : ownerCatalogSql;
    const [r] = await sql.transaction(tx => [tx.query(text, [])], { isolationLevel: 'RepeatableRead', readOnly: true,
      fetchOptions: { signal: AbortSignal.timeout(30000) } });
    must(r.rowCount === 1, 'INSTALL_CATALOG_ROW_COUNT'); return r.rows[0];
  };
  const deriveNeon = async row => ({ ownerOid: row.schema.owner, roleOid: String(row.role.oid),
    functionOids: Object.fromEntries(row.functions.map(f => [f.name, f.oid])), endpointSha256: await sha256Hex({
      host: new URL(await owner()).hostname, port: 5432, database: new URL(ownerUrl).pathname.slice(1), role: C.roleDb, transport: 'NeonHTTPS' }) });
  const verifyFoundation = async ref => {
    must(new RegExp('^arn:aws:cloudformation:ca-central-1:402010193138:stack/' + I.foundationStack + '/[a-f0-9-]{36}$').test(ref.stackId), 'INSTALL_FOUNDATION_UUID');
    const [st, template, resources, role, names, attached, inline, boundary, table, ttl, bp] = await Promise.all([
      send(clients.cfn, new cfn.DescribeStacksCommand({ StackName: ref.stackId })),
      send(clients.cfn, new cfn.GetTemplateCommand({ StackName: ref.stackId, TemplateStage: 'Original' })),
      send(clients.cfn, new cfn.ListStackResourcesCommand({ StackName: ref.stackId })),
      send(clients.iam, new iam.GetRoleCommand({ RoleName: C.role })),
      send(clients.iam, new iam.ListRolePoliciesCommand({ RoleName: C.role })),
      send(clients.iam, new iam.ListAttachedRolePoliciesCommand({ RoleName: C.role })),
      send(clients.iam, new iam.GetRolePolicyCommand({ RoleName: C.role, PolicyName: 'ExactSandboxWorkerV5' })),
      send(clients.iam, new iam.GetPolicyCommand({ PolicyArn: C.boundary })),
      send(clients.ddb, new ddb.DescribeTableCommand({ TableName: C.table })),
      send(clients.ddb, new ddb.DescribeTimeToLiveCommand({ TableName: C.table })),
      send(clients.s3, new s3.GetBucketPolicyCommand({ Bucket: C.bucket, ExpectedBucketOwner: '402010193138' })),
    ]);
    const t = foundationTemplateV5(capsule), r = t.Resources, v = await send(clients.iam,
      new iam.GetPolicyVersionCommand({ PolicyArn: C.boundary, VersionId: boundary.Policy.DefaultVersionId }));
    must(st.Stacks?.length === 1 && st.Stacks[0].StackStatus === 'CREATE_COMPLETE' && st.Stacks[0].StackId === ref.stackId &&
      st.Stacks[0].DisableRollback === true && st.Stacks[0].EnableTerminationProtection === true &&
      same(JSON.parse(template.TemplateBody), t) && !resources.NextToken && resources.StackResourceSummaries?.length === 5 &&
      resources.StackResourceSummaries.every(x => r[x.LogicalResourceId]?.Type === x.ResourceType && x.ResourceStatus === 'CREATE_COMPLETE') &&
      role.Role?.Arn === I.roleArn && role.Role.PermissionsBoundary?.PermissionsBoundaryArn === C.boundary && role.Role.MaxSessionDuration === 3600 &&
      same(policy(role.Role.AssumeRolePolicyDocument), r.WorkerRole.Properties.AssumeRolePolicyDocument) &&
      !names.IsTruncated && same(names.PolicyNames, ['ExactSandboxWorkerV5']) && !attached.IsTruncated && attached.AttachedPolicies?.length === 0 &&
      same(policy(inline.PolicyDocument), r.WorkerRole.Properties.Policies[0].PolicyDocument) &&
      boundary.Policy.DefaultVersionId === 'v1' && same(policy(v.PolicyVersion.Document), r.Boundary.Properties.PolicyDocument) &&
      table.Table?.TableStatus === 'ACTIVE' && table.Table.DeletionProtectionEnabled === true &&
      table.Table.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST' &&
      same(table.Table.KeySchema, r.Journal.Properties.KeySchema) && !table.Table.GlobalSecondaryIndexes?.length && !table.Table.LocalSecondaryIndexes?.length &&
      ttl.TimeToLiveDescription?.TimeToLiveStatus === 'DISABLED' && same(JSON.parse(bp.Policy), evidenceBucketPolicyV5()), 'INSTALL_FOUNDATION_LAYOUT');
    const ep = createEvidencePortV5(command => send(clients.s3, command)); await ep.verify(AbortSignal.timeout(60000));
    must(/^AROA[A-Z0-9]{17}$/.test(role.Role.RoleId) && /^[a-f0-9-]{36}$/.test(table.Table.TableId), 'INSTALL_ACTUAL_RESOURCE_IDS');
    return { roleId: role.Role.RoleId, tableId: table.Table.TableId, lockedTrustVerified: true };
  };
  const verifySecret = async (ref, a, hasValue) => {
    const [d, p] = await Promise.all([send(clients.sm, new sm.DescribeSecretCommand({ SecretId: ref.arn })),
      send(clients.sm, new sm.GetResourcePolicyCommand({ SecretId: ref.arn }))]);
    must(d.ARN === ref.arn && d.Name === a.name && !d.DeletedDate && !d.KmsKeyId &&
      same(JSON.parse(p.ResourcePolicy), secretResourcePolicyV5()) &&
      same(d.VersionIdsToStages ?? {}, hasValue ? { [a.versionId]: ['AWSCURRENT'] } : {}), 'INSTALL_SECRET_ISOLATION_OR_VERSION');
    return { arn: ref.arn, versionId: a.versionId, isolated: true, fixedVersionPresent: hasValue };
  };
  return Object.freeze({
    async preflight() {
      await access(INSTALL_LOCAL_V5.base);
      const [aws, n] = await Promise.all([readAwsInstallInventoryV5(), readNeonInstallInventoryV5()]);
      let foundation;
      try { await send(clients.cfn, new cfn.DescribeStacksCommand({ StackName: I.foundationStack })); foundation = { state: 'READ' }; }
      catch (e) { foundation = { state: e.name === 'ValidationError' && e.message === `Stack with id ${I.foundationStack} does not exist` ? 'ABSENT_AT_CHECK' : 'UNKNOWN_NOT_ABSENT' }; }
      ownerTarget = n.targetFingerprintSha256; return { aws, neon: n, foundation, finishedAt: Date.now() };
    },
    async consumeSlot(value) { await writeFile(INSTALL_LOCAL_V5.slot, JSON.stringify(value) + '\n', { flag: 'wx', flush: true }); },
    record: (name, value) => writePublicOnceV5(output, name, value),
    async createFoundation(a) {
      const r = await send(clients.cfn, new cfn.CreateStackCommand({ StackName: I.foundationStack, TemplateBody: JSON.stringify(a.template),
        Capabilities: a.capabilities, DisableRollback: true, EnableTerminationProtection: true,
        Tags: [{ Key: 'Environment', Value: 'aws-sandbox' }, { Key: 'Purpose', Value: 'cloud-worker-v5' }] }));
      must(r.StackId, 'INSTALL_CREATE_STACK_ACK'); const ref = { stackId: r.StackId };
      // Save ACK before waiting, so independent Inspect can use the UUID even
      // if the process is interrupted during a read-only poll.
      await writePublicOnceV5(output, 'foundation-submission', ref);
      for (let i = 0; i < 80; i++) {
        const d = await send(clients.cfn, new cfn.DescribeStacksCommand({ StackName: ref.stackId })), status = d.Stacks?.[0]?.StackStatus;
        if (status === 'CREATE_COMPLETE') return ref;
        must(status === 'CREATE_IN_PROGRESS', 'INSTALL_FOUNDATION_STOPPED');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      throw Error('INSTALL_FOUNDATION_PENDING_NO_RETRY');
    }, verifyFoundation,
    async createEmptySecret(a) {
      const r = await send(clients.sm, new sm.CreateSecretCommand({ Name: a.name,
        Description: 'One-shot cloud deployment worker v5; Source-managed, isolated before value',
        Tags: [{ Key: 'Environment', Value: 'aws-sandbox' }, { Key: 'Purpose', Value: 'cloud-worker-v5' }] }));
      must(new RegExp('^arn:aws:secretsmanager:ca-central-1:402010193138:secret:' + a.name + '-[A-Za-z0-9]{6}$').test(r.ARN) && r.Name === a.name &&
        !r.VersionId, 'INSTALL_EMPTY_SECRET_ACK'); return { arn: r.ARN };
    },
    async isolateSecret(ref) { await send(clients.sm, new sm.PutResourcePolicyCommand({ SecretId: ref.arn,
      ResourcePolicy: JSON.stringify(secretResourcePolicyV5()), BlockPublicPolicy: true })); return { arn: ref.arn, policyPut: true }; }, verifySecret,
    async loadControl(material, fingerprints) { storedControl = await readControlOnce(material, fingerprints); return storedControl; },
    async installNeon() {
      const url = new URL(await owner()), password = randomBytes(48).toString('hex'), verifier = scramVerifierV5(password);
      const statements = await neonInstallStatementsV5(verifier), sql = neon(ownerUrl, { fullResults: true });
      // One transaction; no exception/log contains SQL, verifier or provider body.
      await sql.transaction(tx => statements.map(text => tx.query(text, [])), { isolationLevel: 'Serializable', readOnly: false,
        fetchOptions: { signal: AbortSignal.timeout(90000) } });
      const u = new URL('postgresql://' + url.host + url.pathname); u.username = C.roleDb; u.password = password; u.searchParams.set('sslmode','verify-full');
      privateUrl = u.href;
      const row = await catalog(await owner()), expected = await deriveNeon(row);
      await verifyNeonCatalogV5(row, await loadNeonContractV5(), expected); return expected;
    },
    async verifyDedicatedNeon(expected) {
      must(privateUrl, 'INSTALL_MEMORY_PASSWORD_REQUIRED'); await validateDatabaseMaterialV5({ schema: 'techlong/cloud-worker-neon-material/v5', databaseUrl: privateUrl }, expected.endpointSha256);
      await verifyNeonCatalogV5(await catalog(privateUrl), await loadNeonContractV5(), expected);
    },
    async putDatabase(ref) {
      must(privateUrl, 'INSTALL_DATABASE_MEMORY_MATERIAL');
      await verifySecret(ref, { name: C.secrets[0], versionId: ref.versionId }, false);
      const r = await send(clients.sm, new sm.PutSecretValueCommand({ SecretId: ref.arn, ClientRequestToken: ref.versionId,
        SecretString: JSON.stringify({ schema: 'techlong/cloud-worker-neon-material/v5', databaseUrl: privateUrl }) }));
      must(r.ARN === ref.arn && r.VersionId === ref.versionId, 'INSTALL_SECRET_VALUE_ACK'); return { ...ref, valuePut: true };
    },
    async putControl(ref, payload) {
      must(payload === storedControl && payload, 'INSTALL_CONTROL_MEMORY_MATERIAL');
      await verifySecret(ref, { name: C.secrets[1], versionId: ref.versionId }, false);
      const r = await send(clients.sm, new sm.PutSecretValueCommand({ SecretId: ref.arn, ClientRequestToken: ref.versionId, SecretString: JSON.stringify(payload) }));
      must(r.ARN === ref.arn && r.VersionId === ref.versionId, 'INSTALL_SECRET_VALUE_ACK'); return { ...ref, valuePut: true };
    },
    async inspect({ foundation, refs, neon: expected }) {
      const f = await verifyFoundation(foundation);
      for (let i = 0; i < 2; i++) await verifySecret(refs[i], { name: C.secrets[i], versionId: I.secretVersions[i] }, true);
      const target = new URL(await owner());
      must(expected.endpointSha256 === await sha256Hex({ host: target.hostname, port: 5432, database: target.pathname.slice(1),
        role: C.roleDb, transport: 'NeonHTTPS' }), 'INSTALL_INSPECT_ENDPOINT_DRIFT');
      const row = await catalog(await owner()), actual = await deriveNeon(row);
      must(same(actual, expected), 'INSTALL_NEON_IDS_OR_ENDPOINT_DRIFT');
      await verifyNeonCatalogV5(row, await loadNeonContractV5(), expected);
      return { outcome: 'LOCKED_INSTALL_METADATA_VERIFIED', ...f, sourceSecretValuesRead: 0,
        passwordAuthenticationProvedByInspect: false, expectedInstalledBindingRequired: true };
    },
    async inspectPartial() {
      // No writes/private loads/Secret values, even if the previous invocation
      // lost every acknowledgement. Absence and UNKNOWN remain distinct.
      const [aws, n] = await Promise.all([readAwsInstallInventoryV5(), readNeonInstallInventoryV5()]);
      let stack = null; try { const r = await send(clients.cfn, new cfn.DescribeStacksCommand({ StackName: I.foundationStack }));
        stack = r.Stacks?.[0] ? { stackId: r.Stacks[0].StackId, status: r.Stacks[0].StackStatus } : null; } catch { /* UNPROVED, not absence */ }
      return { outcome: 'PARTIAL_METADATA_ONLY_NO_RECOVERY_AUTHORIZED', aws, neon: n, foundation: stack,
        slotPresent: await access(INSTALL_LOCAL_V5.slot).then(() => true, () => false), retryAllowed: false,
        secretValuesRead: 0, privateBundleReads: 0, externalWrites: 0, runtimeEnabled: false };
    },
    disposePrivate() { privateUrl = undefined; ownerUrl = undefined; ownerTarget = undefined; storedControl = undefined; },
    dispose() { privateUrl = undefined; ownerUrl = undefined; ownerTarget = undefined; storedControl = undefined; Object.values(clients).forEach(c => c.destroy()); },
  });
}
