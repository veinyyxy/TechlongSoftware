// One existing-policy version only. Review/Draft/Inspect cannot submit writes.
import path from 'node:path';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import * as iam from '@aws-sdk/client-iam';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { EXPRESS_CFN_READ_POLICY_V1 as K, compileExpressCfnReadPolicyV1, assertExpressCfnReadInventoryV1,
  expressCfnReadInventoryIdentityV1, prepareExpressCfnReadPolicyReviewV1, assertExpressCfnReadPolicyApprovalV1 } from '../../../lib/deployments/execution/express-workload-cfn-read-policy-v1.ts';
const raw = process.argv.slice(2), args = {}, base = path.resolve('F:/ChatGPT_workshop'), hash = b => createHash('sha256').update(b).digest('hex');
const fail = code => { throw Error(code); };
if (raw.length % 2) fail('CFN_READ_ARGUMENTS');
for (let n = 0; n < raw.length; n += 2) { if (args[raw[n]] || !raw[n + 1]) fail('CFN_READ_ARGUMENTS'); args[raw[n]] = raw[n + 1]; }
const mode = args['--mode'], out = path.resolve(args['--output'] || '');
const safeDirectory = p => path.dirname(p).toLowerCase() === base.toLowerCase() && /^techlong-express-c5g-cfn-read-[a-z0-9-]+$/.test(path.basename(p));
if (!['Draft', 'Review', 'Run', 'Inspect'].includes(mode) || !safeDirectory(out) ||
    Object.keys(args).some(k => !['--mode', '--output', '--manifest', '--approved-sha'].includes(k)) ||
    (['Draft', 'Review'].includes(mode) ? args['--manifest'] || args['--approved-sha'] : !args['--manifest'] || !args['--approved-sha'])) fail('CFN_READ_ARGUMENTS');
await mkdir(out);
const save = async (name, value) => { const f = await open(path.join(out, name), 'wx'); try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const decode = d => typeof d === 'string' ? JSON.parse(decodeURIComponent(d)) : d;
const slotPath = path.join(base, K.slot), signal = AbortSignal.timeout(180000);
let readonlyCalls = 0, writeAttempted = false, slotConsumed = false, phase = 'LOCAL_BINDING', ic, sts;
const send = async (client, command) => { if (!['GetCallerIdentityCommand', 'GetRoleCommand', 'ListRolePoliciesCommand', 'ListAttachedRolePoliciesCommand',
  'GetPolicyCommand', 'ListPolicyVersionsCommand', 'GetPolicyVersionCommand', 'ListEntitiesForPolicyCommand'].includes(command.constructor.name) ||
  ++readonlyCalls > 12) fail('CFN_READ_READONLY_SCOPE'); return client.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }); };
const emptySlot = async () => { try { await access(slotPath); fail('CFN_READ_SLOT_OCCUPIED_NO_RETRY'); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
    'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'].some(k => process.env[k]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('CFN_READ_ENV');
  const old = await json('ops/aws-sandbox/reviews/aurora-dual-mode-c5f-live-delivery.preflight.json');
  const history = [];
  for (const ending of ['/roles.json', '/plan.json', '/provider-permissions.json']) {
    const e = old.evidenceFiles.find(e => e.path.endsWith(ending));
    if (!e || hash(await readFile(e.path)) !== e.rawFileSha256) fail('CFN_READ_HISTORY_DRIFT'); history.push(e);
  }
  const historical = await json(history[0].path), before = historical.cloudFormationBoundary.document;
  const expectedTrust = historical.roles.find(r => r.arn === K.roleArn)?.trust;
  const names = ['lib/deployments/execution/express-workload-cfn-read-policy-v1.ts', 'lib/deployments/execution/hash.ts',
    'ops/aws-sandbox/scripts/review-express-cfn-read-policy-v1.mjs', 'tests/express-workload-cfn-read-policy-v1.test.ts',
    'package.json', 'package-lock.json', 'ops/aws-sandbox/reviews/aurora-dual-mode-c5f-live-delivery.preflight.json'];
  const pins = [];
  for (const name of names) pins.push({ name, lfSha256: hash((await readFile(name, 'utf8')).replaceAll('\r\n', '\n')) });
  const codeBindingSha256 = await sha256Hex({ pins, history });
  await save('code-binding.json', { pins, history, codeBindingSha256 });
  const candidate = await compileExpressCfnReadPolicyV1(before), baselineDocumentSha256 = await sha256Hex(before);
  const providerEvidenceSha256 = history[2].rawFileSha256, providers = await json(history[2].path);
  const providerActions = new Set(providers.flatMap(p => Object.values(p.handlers || {}).flatMap(h => h.permissions || [])));
  if (candidate.newUniqueActions.some(a => !providerActions.has(a))) fail('CFN_READ_ACTION_NOT_IN_PINNED_PROVIDER');
  if (historical.cloudFormationBoundary.id !== K.policyId || historical.cloudFormationBoundary.defaultVersion !== 'v7' || !expectedTrust) fail('CFN_READ_HISTORY_SCOPE');
  await save('candidate.json', candidate);
  if (mode === 'Draft') { const result = { mode, outcome: 'OFFLINE_EXACT_POLICY_CANDIDATE_NOT_APPROVABLE', candidateSha256: candidate.candidateSha256,
    codeBindingSha256, newActions: candidate.newUniqueActions, policyCharacters: candidate.request.PolicyDocument.length,
    metadataReads: 0, iamWrites: 0, executionSlotConsumed: false, approvalManifestIssued: false, runtimeEnabled: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2)); process.exit(0); }
  let manifest;
  if (['Run', 'Inspect'].includes(mode)) {
    const filename = path.resolve(args['--manifest']);
    if (path.basename(filename) !== 'manifest.json' || !safeDirectory(path.dirname(filename))) fail('CFN_READ_MANIFEST_PATH');
    manifest = await json(filename);
    await assertExpressCfnReadPolicyApprovalV1(manifest, args['--approved-sha'], codeBindingSha256, mode === 'Inspect' ? manifest.preparedAt : Date.now());
    if (canonicalJson(manifest.candidate) !== canonicalJson(candidate)) fail('CFN_READ_CANDIDATE_DRIFT');
  }
  if (mode !== 'Inspect') await emptySlot();
  const credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', clientConfig: { maxAttempts: 1, ignoreConfiguredEndpointUrls: true } });
  const cfg = { region: 'ca-central-1', credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  ic = new iam.IAMClient(cfg); sts = new STSClient(cfg);
  const inventory = async () => {
    phase = 'IAM_METADATA';
    const who = await send(sts, new GetCallerIdentityCommand({}));
    const role = (await send(ic, new iam.GetRoleCommand({ RoleName: K.roleName }))).Role;
    const inline = await send(ic, new iam.ListRolePoliciesCommand({ RoleName: K.roleName }));
    const attached = await send(ic, new iam.ListAttachedRolePoliciesCommand({ RoleName: K.roleName }));
    const policy = (await send(ic, new iam.GetPolicyCommand({ PolicyArn: K.policyArn }))).Policy;
    const versions = await send(ic, new iam.ListPolicyVersionsCommand({ PolicyArn: K.policyArn }));
    const version = (await send(ic, new iam.GetPolicyVersionCommand({ PolicyArn: K.policyArn, VersionId: policy.DefaultVersionId }))).PolicyVersion;
    const consumers = [];
    for (const PolicyUsageFilter of ['PermissionsBoundary', 'PermissionsPolicy']) {
      const p = await send(ic, new iam.ListEntitiesForPolicyCommand({ PolicyArn: K.policyArn, PolicyUsageFilter, MaxItems: 100 }));
      if (p.IsTruncated) fail('CFN_READ_TRUNCATED_CONSUMERS');
      consumers.push({ roles: (p.PolicyRoles || []).map(r => ({ name: r.RoleName, id: r.RoleId })).sort((a, b) => a.name.localeCompare(b.name)),
        users: (p.PolicyUsers || []).map(r => ({ name: r.UserName, id: r.UserId })), groups: (p.PolicyGroups || []).map(r => ({ name: r.GroupName, id: r.GroupId })) });
    }
    if ([inline, attached, versions].some(r => r.IsTruncated) || version.VersionId !== policy.DefaultVersionId || !version.IsDefaultVersion) fail('CFN_READ_INCOMPLETE_METADATA');
    const f = { observedAt: Date.now(), source: { Account: who.Account, Arn: who.Arn, UserId: who.UserId },
      role: { arn: role.Arn, id: role.RoleId, trust: decode(role.AssumeRolePolicyDocument), boundaryArn: role.PermissionsBoundary?.PermissionsBoundaryArn,
        inlineNames: inline.PolicyNames.sort(), attached: attached.AttachedPolicies.map(p => p.PolicyArn).sort() },
      policy: { arn: policy.Arn, id: policy.PolicyId, defaultVersion: policy.DefaultVersionId, document: decode(version.Document),
        versions: versions.Versions.map(v => ({ id: v.VersionId, isDefault: v.IsDefaultVersion })).sort((a, b) => a.id.localeCompare(b.id)),
        boundaryConsumers: consumers[0], permissionConsumers: consumers[1] } };
    if (f.source.Account !== '402010193138' || f.source.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' || f.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('CFN_READ_SOURCE_CHANGED');
    return f;
  };
  if (mode === 'Inspect') {
    phase = 'INSPECT_SLOT'; const slot = await json(slotPath);
    if (slot.manifestSha256 !== manifest.manifestSha256 || slot.retryAuthorized !== false || !safeDirectory(path.resolve(slot.outputDirectory))) fail('CFN_READ_RUN_SLOT_REQUIRED');
    const f = await inventory(); await save('independent-inventory.json', f);
    const beforeFacts = structuredClone(f); beforeFacts.policy = { ...beforeFacts.policy, defaultVersion: 'v7', document: before,
      versions: [{ id: 'v7', isDefault: true }] };
    assertExpressCfnReadInventoryV1(beforeFacts, Date.now());
    if (canonicalJson(beforeFacts.role) !== canonicalJson(manifest.facts.role) || f.policy.defaultVersion === 'v7' ||
      f.policy.versions.length !== 2 || !f.policy.versions.some(v => v.id === 'v7' && !v.isDefault) ||
      f.policy.versions.filter(v => v.isDefault).length !== 1 || await sha256Hex(f.policy.document) !== candidate.afterDocumentSha256) fail('CFN_READ_INSTALLED_STATE_NOT_PROVED');
    const retained = (await send(ic, new iam.GetPolicyVersionCommand({ PolicyArn: K.policyArn, VersionId: 'v7' }))).PolicyVersion;
    if (retained.IsDefaultVersion || await sha256Hex(decode(retained.Document)) !== baselineDocumentSha256) fail('CFN_READ_OLD_VERSION_NOT_PRESERVED');
    let submitted;
    try { submitted = await json(path.join(slot.outputDirectory, 'submission.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const attributed = submitted?.newDefaultVersion === f.policy.defaultVersion && submitted?.requestSha256 === await sha256Hex(candidate.request);
    const result = { mode, outcome: attributed ? 'EXACT_NEW_READ_POLICY_DEFAULT_V7_RETAINED' : 'MATCHING_POLICY_STATE_SUBMISSION_NOT_ATTRIBUTED',
      defaultVersion: f.policy.defaultVersion, oldVersionRetained: 'v7', readonlyCalls, iamWrites: 0, attributed,
      automaticRetryAuthorized: false, workloadDeployed: false, runtimeEnabled: false, readyVerified: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2)); process.exitCode = attributed ? 0 : 2;
  } else {
    const facts = await inventory(); assertExpressCfnReadInventoryV1(facts, Date.now());
    if (canonicalJson(facts.role.trust) !== canonicalJson(expectedTrust) || await sha256Hex(facts.policy.document) !== baselineDocumentSha256) fail('CFN_READ_BASELINE_DRIFT');
    await save('before.json', facts);
    if (mode === 'Review') {
      manifest = await prepareExpressCfnReadPolicyReviewV1({ candidate, facts, expectedTrust, baselineDocumentSha256,
        codeBindingSha256, providerEvidenceSha256, now: Date.now() });
      await save('manifest.json', manifest);
      const result = { mode, outcome: 'ONE_EXISTING_READ_POLICY_VERSION_REVIEWED_NOT_INSTALLED', manifestSha256: manifest.manifestSha256,
        expiresAt: new Date(manifest.expiresAt).toISOString(), newActions: candidate.newUniqueActions, readonlyCalls, iamWrites: 0,
        executionSlotConsumed: false, runtimeEnabled: false, readyVerified: false };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2));
    } else {
      if (canonicalJson(expressCfnReadInventoryIdentityV1(facts)) !== canonicalJson(expressCfnReadInventoryIdentityV1(manifest.facts))) fail('CFN_READ_PREWRITE_DRIFT');
      await assertExpressCfnReadPolicyApprovalV1(manifest, args['--approved-sha'], codeBindingSha256, Date.now());
      phase = 'CONSUME_SINGLE_WRITE_SLOT'; const slot = await open(slotPath, 'wx'); slotConsumed = true;
      try { await slot.writeFile(JSON.stringify({ manifestSha256: manifest.manifestSha256, codeBindingSha256,
        requestSha256: await sha256Hex(candidate.request), outputDirectory: out, at: new Date().toISOString(), retryAuthorized: false }) + '\n'); await slot.sync(); } finally { await slot.close(); }
      await assertExpressCfnReadPolicyApprovalV1(manifest, args['--approved-sha'], codeBindingSha256, Date.now());
      assertExpressCfnReadInventoryV1(facts, Date.now()); phase = 'CREATE_ONE_POLICY_VERSION'; writeAttempted = true;
      const v = (await ic.send(new iam.CreatePolicyVersionCommand(candidate.request), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })).PolicyVersion;
      if (!/^v[1-9][0-9]*$/.test(v?.VersionId || '') || v.VersionId === 'v7' || v.IsDefaultVersion !== true) fail('CFN_READ_RESPONSE_REQUIRES_INSPECT');
      await save('submission.json', { newDefaultVersion: v.VersionId, requestSha256: await sha256Hex(candidate.request), at: new Date().toISOString() });
      const result = { mode, outcome: 'ONE_POLICY_VERSION_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT', newDefaultVersion: v.VersionId,
        oldVersionNotDeleted: 'v7', readonlyCalls, iamWriteCalls: 1, slotConsumed: true, retryAuthorized: false, runtimeEnabled: false, readyVerified: false };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2));
    }
  }
} catch (e) {
  const stopped = { mode, outcome: writeAttempted ? 'POLICY_SUBMISSION_REQUIRES_INSPECT_NO_RETRY' : 'STOPPED_WITHOUT_IAM_WRITE', phase,
    code: /^CFN_READ_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'CFN_READ_LOCAL_OR_PROVIDER_FAILED',
    providerName: /^[A-Za-z0-9_.-]{1,100}$/.test(e.name || '') ? e.name : null,
    readonlyCalls, iamWriteCallsAttempted: writeAttempted ? 1 : 0, slotConsumed, retryAuthorized: false };
  await save('stopped.json', stopped); console.error(JSON.stringify(stopped)); process.exitCode = 1;
} finally { ic?.destroy(); sts?.destroy(); }
