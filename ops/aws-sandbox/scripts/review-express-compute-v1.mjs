// Two separately journaled CFN API entries only after fresh exact approval.
// No SQL, GetSecretValue, IAM mutation, job/TTL, ECS task/service or DNS writer.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, open, access, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import * as cfnSdk from '@aws-sdk/client-cloudformation';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import core from '../../../lib/deployments/execution/express-compute-reviewed-v1.cjs';
import db from '../../../lib/deployments/execution/aurora-database-contract-v2.cjs';
import { renderExpressSingleTenantCellV1 } from '../../../lib/deployments/cloudformation/express-single-tenant-cell-v1.ts';
import { observeExpressCompute, computeClientConfig, COMPUTE_CERTIFICATE, COMPUTE_TRUSTSTORE } from './express-compute-observer-v1.mjs';
const exec = promisify(execFile), hash = v => createHash('sha256').update(v).digest('hex');
const root = path.resolve('F:/ChatGPT_workshop'), repo = fileURLToPath(new URL('../../../', import.meta.url));
const fail = c => { throw Error(c); }, raw = process.argv.slice(2), pairs = [];
if (raw.length % 2) fail('COMPUTE_ARGUMENTS_REJECTED');
for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
const a = Object.fromEntries(pairs), mode = a['--mode'], out = path.resolve(a['--output'] || '');
const keys = mode === 'Review' ? ['--mode', '--output', '--prices'] : mode === 'Inspect' ? ['--mode', '--output', '--manifest', '--approved-sha', '--run-directory'] : ['--mode', '--output', '--manifest', '--approved-sha'];
if (!['Review', 'Run', 'Inspect'].includes(mode) || pairs.length !== keys.length || new Set(pairs.map(p => p[0])).size !== keys.length ||
    Object.keys(a).some(k => !keys.includes(k)) || Object.values(a).some(v => !v) || path.dirname(out).toLowerCase() !== root.toLowerCase() ||
    !/^techlong-express-c5d-compute-[a-z0-9-]+$/.test(path.basename(out))) fail('COMPUTE_ARGUMENTS_REJECTED');
await mkdir(out);
const save = async (name, v) => { const f = await open(path.join(out, name), 'wx'); try { await f.writeFile(JSON.stringify(v, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
const json = async f => { const b = await readFile(f); if (b.length > 4_000_000) fail('COMPUTE_INPUT_SIZE'); return JSON.parse(b); };
const vacant = async slot => { try { await access(root + '/' + slot); fail('COMPUTE_PERMANENT_SLOT_OCCUPIED'); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
const consume = async (slot, data) => { const f = await open(root + '/' + slot, 'wx'); try { await f.writeFile(JSON.stringify({ ...data, consumedAt: Date.now(), retryAuthorized: false }) + '\n'); await f.sync(); } finally { await f.close(); } };
const materialFile = root + '/techlong-express-delivery-c5c-20261015-r1.review.json';
const oldFile = root + '/techlong-d001-cell-foundation-inspect-20261013-ebeef325-r2/snapshot.json';
const seedFile = path.join(repo, 'ops/aws-sandbox/reviews/aurora-dual-mode-c5c-store-seed.executed.json');
let manifest, writes = 0, rootConsumed = false, lastPhase = 'LOCAL_BINDING', receipt = null;
const config = computeClientConfig(), cfn = new cfnSdk.CloudFormationClient(config), sts = new STSClient(config);
const signal = AbortSignal.timeout(55 * 60000);
const send = (command, timeout = 30000) => cfn.send(command, { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
const who = async () => { const r = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  if (r.Account !== '402010193138' || r.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' || r.UserId !== 'AIDAV3GNMXTZEO7SHLC2X') fail('COMPUTE_SOURCE_CHANGED'); };
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'DATABASE_URL', 'PGHOST', 'PGPASSWORD', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'].some(k => process.env[k]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('COMPUTE_ENV_CONFLICT');
  if (hash(await readFile(materialFile)) !== 'f744acf7846b8e39498fef6cd1911356d867b54c32d4c71aaa6109fa3f7d263e' ||
      hash(await readFile(oldFile)) !== '564a0fc392a0935eb663e5887c85f9adcdeab81dcd328b125dbdd74c3fb54889') fail('COMPUTE_HISTORY_CHANGED');
  const material = (await json(materialFile)).material, oldSnapshot = await json(oldFile), seed = await json(seedFile), seedSha = hash(await readFile(seedFile));
  if (seed.state !== 'DEFAULT_STORE_COMMITTED_AND_INDEPENDENTLY_VERIFIED_NOT_READY' || seed.approvedAttemptComplete !== true || seed.readyVerified !== false ||
      seed.independentInspect?.outcome !== 'STORE_SEED_INDEPENDENTLY_OBSERVED_NOT_READY' || seed.target.database !== material.binding.tenantDatabase ||
      seed.independentInspect.transaction.after.storeRows !== 1 || !seed.independentInspect.transaction.commitAcknowledged) fail('COMPUTE_APPROVED_SEED_EVIDENCE_REQUIRED');
  for (const f of seed.evidenceFiles) if (hash(await readFile(f.path)) !== f.rawFileSha256) fail('COMPUTE_SEED_EVIDENCE_CHANGED');
  const pins = [], seen = new Set();
  const pin = async name => { const f = await realpath(name); if (seen.has(f.toLowerCase())) return; seen.add(f.toLowerCase());
    const text = (await readFile(f, 'utf8')).replace(/\r\n/g, '\n'); pins.push({ filename: f, sha256: hash(text) });
    if (!/\.(?:ts|mjs|cjs|js)$/.test(f)) return;
    for (const m of text.matchAll(/(?:from\s*|(?:require|import)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(f), m[1]); let found;
      for (const v of [base, base + '.js', base + '.cjs', base + '.ts']) { try { await access(v); found = v; break; } catch { /* exact suffixes */ } }
      if (!found) fail('COMPUTE_DEPENDENCY_UNRESOLVED'); await pin(found);
    } };
  for (const f of [fileURLToPath(import.meta.url), path.join(repo, 'ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts'), seedFile, path.join(repo, 'package-lock.json')]) await pin(f);
  pins.sort((x, y) => x.filename.localeCompare(y.filename));
  const binding = { pins, materialFileSha256: hash(await readFile(materialFile)), oldSnapshotSha256: hash(await readFile(oldFile)), nodeVersion: process.version }, codeSha = db.digest(binding);
  await save('code-binding.json', { ...binding, codeBindingSha256: codeSha });
  if (mode !== 'Review') {
    const file = await realpath(a['--manifest']); if (path.dirname(path.dirname(file)).toLowerCase() !== root.toLowerCase() || path.basename(file) !== 'manifest.json' ||
        !/^techlong-express-c5d-compute-/.test(path.basename(path.dirname(file)))) fail('COMPUTE_MANIFEST_PATH_REJECTED');
    manifest = await json(file); const { manifestSha256, ...body } = manifest;
    if (a['--approved-sha'] !== manifestSha256 || db.digest(body) !== manifestSha256 || manifest.codeBindingSha256 !== codeSha || manifest.seedEvidenceSha256 !== seedSha) fail('COMPUTE_MANIFEST_OR_CODE_CHANGED');
    if (mode === 'Run') core.approval(manifest, a['--approved-sha'], codeSha, Date.now());
    const rerender = await renderExpressSingleTenantCellV1({ cell: { environment: material.environment,
      requestedAt: Date.parse(manifest.draft.reviewDeadline) - 3 * 3600000, availabilityZones: ['ca-central-1a', 'ca-central-1b'],
      certificateArn: COMPUTE_CERTIFICATE, controlTrustStoreArn: COMPUTE_TRUSTSTORE }, binding: material.binding });
    if (db.canonicalJson(rerender) !== db.canonicalJson(manifest.draft)) fail('COMPUTE_RENDER_CHANGED');
  }
  const control = async () => {
    try { const r = await exec(process.execPath, ['--experimental-strip-types', '--env-file-if-exists=.env.local', 'ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts', '--review', materialFile],
      { cwd: repo, timeout: 65000, maxBuffer: 128000, windowsHide: true, env: { ...process.env, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_MAX_ATTEMPTS: '1' } });
      const v = JSON.parse(r.stdout); if (v.result?.outcome !== 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED') fail('COMPUTE_CONTROL_PLANE_OCCUPIED'); return v; }
    catch { fail('COMPUTE_CONTROL_PLANE_READ_FAILED'); } };
  const observe = async draft => observeExpressCompute({ tags: draft.tags, oldStackId: core.OLD, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
  const waitDeleted = async () => { const until = Date.now() + 10 * 60000;
    while (Date.now() < until) { const r = await send(new cfnSdk.DescribeStacksCommand({ StackName: core.OLD }));
      if (r.Stacks?.length !== 1 || r.Stacks[0].StackId !== core.OLD) fail('COMPUTE_OLD_UUID_UNPROVED');
      if (r.Stacks[0].StackStatus === 'DELETE_COMPLETE') return;
      if (r.Stacks[0].StackStatus !== 'DELETE_IN_PROGRESS') fail('COMPUTE_OLD_DELETE_NOT_COMPLETE');
      await delay(10000, undefined, { signal }); } fail('COMPUTE_OLD_DELETE_PENDING_INSPECT_ONLY'); };
  const attributed = async (id, token) => { let next; const events = [], seen = new Set();
    do { if (next && seen.has(next) || seen.size > 5) fail('COMPUTE_EVENT_PAGINATION'); if (next) seen.add(next);
      const r = await send(new cfnSdk.DescribeStackEventsCommand({ StackName: id, NextToken: next })); events.push(...r.StackEvents || []); next = r.NextToken;
    } while (next);
    return events.some(e => e.StackId === id && e.PhysicalResourceId === id && e.ResourceType === 'AWS::CloudFormation::Stack' && e.ResourceStatus === 'CREATE_COMPLETE' && e.ClientRequestToken === token);
  };
  if (mode === 'Review') {
    for (const slot of [core.RUN_SLOT, core.DELETE_SLOT, core.CREATE_SLOT]) await vacant(slot);
    const draft = await renderExpressSingleTenantCellV1({ cell: { environment: material.environment, requestedAt: Date.now(),
      availabilityZones: ['ca-central-1a', 'ca-central-1b'], certificateArn: COMPUTE_CERTIFICATE, controlTrustStoreArn: COMPUTE_TRUSTSTORE }, binding: material.binding });
    const priceFile = await realpath(a['--prices']);
    if (path.basename(priceFile) !== 'selected-prices.json' || path.dirname(path.dirname(priceFile)).toLowerCase() !== root.toLowerCase()) fail('COMPUTE_PRICE_PATH_REJECTED');
    const feed = await json(priceFile), estimate = core.prices(feed, hash(await readFile(priceFile)), Date.now());
    // Raw official feeds are preserved by the existing price collector.
    for (const s of feed.snapshots) if (hash(await readFile(path.join(path.dirname(priceFile), s.service + '.json'))) !== s.sha256) fail('COMPUTE_PRICE_FEED_CHANGED');
    const validation = await send(new cfnSdk.ValidateTemplateCommand({ TemplateBody: draft.templateBody }));
    if (validation.Capabilities?.length || validation.Parameters?.length !== 4) fail('COMPUTE_TEMPLATE_VALIDATION_FAILED');
    lastPhase = 'READONLY_PRECONDITIONS'; const facts = await observe(draft), controlPlane = await control();
    await save('facts.json', facts); await save('control-plane.json', controlPlane);
    manifest = core.prepare({ draft, facts, oldSnapshot, controlPlane, seedEvidenceSha256: seedSha, codeBindingSha256: codeSha, estimate, now: Date.now() });
    await save('manifest.json', manifest); await save('template.json', draft.template); await save('requests.json', core.requests(manifest));
    await save('template-validation.json', { parameters: validation.Parameters, capabilities: validation.Capabilities || [] });
    const result = { mode, directory: out, manifestSha256: manifest.manifestSha256, expiresAt: new Date(manifest.expiresAt).toISOString(), cellDeadlineTag: draft.reviewDeadline,
      estimate, proposedDirectAwsWrites: 2, actualAwsWrites: writes, slotConsumed: rootConsumed, sqlConnections: 0, privateReads: 0, runtimeEnabled: false, readyVerified: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } else if (mode === 'Run') {
    for (const slot of [core.RUN_SLOT, core.DELETE_SLOT, core.CREATE_SLOT]) await vacant(slot);
    receipt = await core.executeReviewedCompute(manifest, {
      approve: () => { signal.throwIfAborted(); core.approval(manifest, a['--approved-sha'], codeSha, Date.now()); },
      observe: async draft => { lastPhase = writes ? 'POST_RETIREMENT_READONLY' : 'PRE_RETIREMENT_READONLY'; return observe(draft); },
      control, who, save, now: Date.now, outputDirectory: out, waitDeleted,
      credentialsEnough: async () => { const creds = await config.credentials();
        if (!(creds.expiration instanceof Date) || creds.expiration.getTime() < Date.now() + 300000) fail('COMPUTE_CREDENTIALS_TOO_SHORT'); },
      consume: async (slot, data) => { await consume(slot, data); if (slot === core.RUN_SLOT) rootConsumed = true; },
      deleteStack: async request => { signal.throwIfAborted(); lastPhase = 'OLD_DELETE_SUBMITTED'; writes++; return send(new cfnSdk.DeleteStackCommand(request)); },
      createStack: async request => { signal.throwIfAborted(); lastPhase = 'COMPUTE_CREATE_SUBMITTED'; writes++; return send(new cfnSdk.CreateStackCommand(request)); },
    });
    // Submission is deliberately not reported as completion. Inspect has no
    // write path and can be repeated for async progress, including after expiry.
    const result = { mode, outcome: 'EXPRESS_COMPUTE_CREATE_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT', directory: out, receipt,
      awsWriteApiInvocations: writes, rootConsumed, automaticRetries: 0, sqlConnections: 0, privateReads: 0, runtimeEnabled: false, readyVerified: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } else {
    const run = await realpath(a['--run-directory']);
    if (path.dirname(run).toLowerCase() !== root.toLowerCase() || !/^techlong-express-c5d-compute-/.test(path.basename(run))) fail('COMPUTE_RUN_PATH_REJECTED');
    const slot = await json(root + '/' + core.RUN_SLOT);
    if (slot.manifestSha256 !== manifest.manifestSha256 || path.resolve(slot.outputDirectory).toLowerCase() !== run.toLowerCase() || slot.retryAuthorized !== false) fail('COMPUTE_MATCHING_ATTEMPT_REQUIRED');
    lastPhase = 'INDEPENDENT_READONLY_INSPECT'; const facts = await observe(manifest.draft); await save('facts.json', facts);
    try { receipt = await json(path.join(run, 'create-receipt.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const createSlot = await json(root + '/' + core.CREATE_SLOT).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (receipt && (receipt.manifestSha256 !== manifest.manifestSha256 || receipt.clientRequestToken !== core.requests(manifest).create.ClientRequestToken)) fail('COMPUTE_RECEIPT_CHANGED');
    if (!receipt && createSlot?.manifestSha256 === manifest.manifestSha256 && facts.stack?.stackId !== core.OLD) receipt = facts.stack ? {
      stackId: facts.stack.stackId, manifestSha256: manifest.manifestSha256, clientRequestToken: core.requests(manifest).create.ClientRequestToken, recoveredByReadonlyObservation: true } : null;
    let observation = { outcome: 'COMPUTE_PENDING_OR_UNPROVED_READONLY_ONLY', stackId: facts.stack?.stackId || null, status: facts.stack?.status || 'ABSENT',
      writeRetryAuthorized: false, operatorDeleteAuthorized: false, runtimeEnabled: false, readyVerified: false };
    if (receipt && facts.stack?.status === 'CREATE_COMPLETE') observation = core.checkCreatedStack(facts, manifest, receipt, await attributed(receipt.stackId, receipt.clientRequestToken), Date.now());
    await save('observation.json', observation); if (receipt) await save('observed-receipt.json', receipt);
    const result = { mode, directory: out, ...observation, actualAwsWrites: 0, sqlConnections: 0, privateReads: 0 };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  }
} catch (e) {
  const code = /^COMPUTE_[A-Z0-9_]+$/.test(e.message || '') ? e.message : ['CredentialsProviderError', 'ExpiredToken', 'ExpiredTokenException'].includes(e.name) ? 'COMPUTE_SOURCE_REFRESH_REQUIRED' : 'COMPUTE_LOCAL_OR_PROVIDER_FAILED';
  await save('stopped.json', { mode, code, lastPhase, manifestSha256: manifest?.manifestSha256 || null, awsWriteApiInvocations: writes,
    rootConsumed, receipt, automaticRetries: 0, sqlConnections: 0, secretValueReads: 0, privateBundleReads: 0, runtimeEnabled: false, readyVerified: false });
  console.error(code); process.exitCode = 1;
} finally { cfn.destroy(); sts.destroy(); }
