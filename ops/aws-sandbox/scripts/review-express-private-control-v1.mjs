// Review never reads private-material.json. Run only loads/rebinds/disposes it;
// neither mode issues a JWT, sends control HTTP, reads an AWS Secret value,
// connects Aurora, mutates Neon/authority/IAM, or deploys resources.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, lstat, access, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareExpressPrivateControlRebindV1, loadExpressPrivateControlSourcesV1 } from '../../../lib/deployments/execution/express-private-control-v1.ts';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const exec = promisify(execFile), digest = b => createHash('sha256').update(b).digest('hex');
const base = 'F:/ChatGPT_workshop', repo = fileURLToPath(new URL('../../../', import.meta.url));
const sourceFile = base + '/techlong-express-delivery-c5c-20261015-r1.review.json';
const privateDir = base + '/techlong-d001-credentials-20261013-r2';
const slot = base + '/techlong-express-c5e-private-control-read-v1.permanent-slot.json';
const c5dReview = base + '/techlong-express-c5d-compute-review-20261015-r2/manifest.json';
const c5dRun = base + '/techlong-express-c5d-compute-run-20261015-r1';
const c5dSha = '7a0c636b741e1cc0af068046c052f1f09a6dd1bc8f0a62b539f3be609f245423';
const oldSummarySha = '9daf504a6d4cd3b281cb9632f41c45085d6f531f6af96680e44f05c8a805fd63';
function fail(code) { throw Error(code); }
const args = process.argv.slice(2), pairs = [];
if (args.length % 2) fail('PRIVATE_REBIND_ARGUMENTS');
for (let n = 0; n < args.length; n += 2) pairs.push([args[n], args[n + 1]]);
const a = Object.fromEntries(pairs), mode = a['--mode'], out = path.resolve(a['--output'] || '');
const names = mode === 'Review' ? ['--mode', '--output'] : ['--mode', '--output', '--manifest', '--approved-sha'];
if (!['Review', 'Run'].includes(mode) || pairs.length !== names.length || new Set(pairs.map(p => p[0])).size !== names.length ||
    Object.keys(a).some(k => !names.includes(k)) || Object.values(a).some(v => !v) || path.dirname(out).toLowerCase() !== path.resolve(base).toLowerCase() ||
    !/^techlong-express-c5e-private-[a-z0-9-]+$/.test(path.basename(out))) fail('PRIVATE_REBIND_ARGUMENTS');
await mkdir(out);
const save = async (name, value) => { const f = await open(path.join(out, name), 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
const json = async f => { const b = await readFile(f); if (b.length > 4_000_000) fail('PRIVATE_REBIND_INPUT_SIZE'); return JSON.parse(b); };
const vacant = async () => { try { await access(slot); fail('PRIVATE_REBIND_PERMANENT_SLOT_OCCUPIED'); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
let consumed = false, privateLoads = 0, manifest, sources;
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'DATABASE_URL', 'PGHOST',
    'PGPASSWORD', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'].some(k => process.env[k]) || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('PRIVATE_REBIND_ENV_CONFLICT');
  await vacant();
  if (digest(await readFile(sourceFile)) !== 'f744acf7846b8e39498fef6cd1911356d867b54c32d4c71aaa6109fa3f7d263e' ||
      digest(await readFile(privateDir + '/summary.json')) !== oldSummarySha) fail('PRIVATE_REBIND_HISTORY_CHANGED');
  const original = await json(sourceFile), oldSummary = await json(privateDir + '/summary.json'), oldBinding = await json(privateDir + '/binding.json');
  const executedFile = path.join(repo, 'ops/aws-sandbox/reviews/aurora-dual-mode-c5d-compute.executed.json'), executed = await json(executedFile);
  if (executed.state !== 'EXPRESS_COMPUTE_COMPLETE_AND_INDEPENDENTLY_VERIFIED_NO_WORKLOAD' || !executed.approvedAttemptComplete ||
      executed.readyVerified !== false || executed.approvedManifestSha256 !== c5dSha) fail('PRIVATE_REBIND_COMPUTE_EVIDENCE_REQUIRED');
  for (const f of executed.evidenceFiles) if (digest(await readFile(f.path)) !== f.rawFileSha256) fail('PRIVATE_REBIND_COMPUTE_EVIDENCE_CHANGED');
  const pins = [], seen = new Set();
  const pin = async name => { const f = await realpath(name); if (seen.has(f.toLowerCase())) return; seen.add(f.toLowerCase());
    const text = (await readFile(f, 'utf8')).replace(/\r\n/g, '\n'); pins.push({ filename: f, sha256: digest(text) });
    if (!/\.(?:ts|mjs|cjs|js)$/.test(f)) return;
    for (const m of text.matchAll(/(?:from\s*|(?:require|import)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const candidate = path.resolve(path.dirname(f), m[1]); let found;
      for (const item of [candidate, candidate + '.js', candidate + '.cjs', candidate + '.ts']) { try { await access(item); found = item; break; } catch { /* suffix */ } }
      if (!found) fail('PRIVATE_REBIND_IMPORT_UNRESOLVED'); await pin(found);
    } };
  for (const f of [fileURLToPath(import.meta.url), path.join(repo, 'lib/deployments/execution/express-first-deployment-runtime-v1.ts'),
    path.join(repo, 'ops/aws-sandbox/scripts/review-express-compute-v1.mjs'), path.join(repo, 'ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts'),
    path.join(repo, 'package-lock.json'), executedFile]) await pin(f);
  pins.sort((x, y) => x.filename.localeCompare(y.filename));
  const binding = { pins, nodeVersion: process.version, sourceFileSha256: digest(await readFile(sourceFile)), historicalSummarySha256: oldSummarySha }, codeSha = await sha256Hex(binding);
  await save('code-binding.json', { ...binding, codeBindingSha256: codeSha });
  const approve = () => { const { manifestSha256, ...body } = manifest || {};
    if (a['--approved-sha'] !== manifestSha256 || digest(canonicalJson(body)) !== manifestSha256 || manifest.codeBindingSha256 !== codeSha ||
        Date.now() < manifest.preparedAt || Date.now() >= manifest.expiresAt) fail('PRIVATE_REBIND_FRESH_EXACT_APPROVAL_REQUIRED'); };
  if (mode === 'Run') {
    const f = await realpath(a['--manifest']);
    if (path.dirname(path.dirname(f)).toLowerCase() !== path.resolve(base).toLowerCase() || path.basename(f) !== 'manifest.json' ||
        !/^techlong-express-c5e-private-/.test(path.basename(path.dirname(f)))) fail('PRIVATE_REBIND_MANIFEST_PATH');
    manifest = await json(f); approve();
  }
  const child = async childArgs => { try { const r = await exec(process.execPath, childArgs,
    { cwd: repo, timeout: 120000, maxBuffer: 256000, windowsHide: true,
      env: { ...process.env, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_MAX_ATTEMPTS: '1' } }); return JSON.parse(r.stdout);
  } catch { fail('PRIVATE_REBIND_READONLY_PREFLIGHT_FAILED'); } };
  const inspectDir = base + '/techlong-express-c5d-compute-inspect-' + path.basename(out).slice('techlong-express-'.length);
  const compute = await child(['--experimental-strip-types', 'ops/aws-sandbox/scripts/review-express-compute-v1.mjs', '--mode', 'Inspect',
    '--manifest', c5dReview, '--approved-sha', c5dSha, '--run-directory', c5dRun, '--output', inspectDir]);
  if (compute.outcome !== 'EXPRESS_COMPUTE_INDEPENDENTLY_VERIFIED_NO_WORKLOAD' || compute.stackId !== executed.newStack.stackId ||
      canonicalJson(compute.outputs) !== canonicalJson(executed.newStack.outputs)) fail('PRIVATE_REBIND_LIVE_COMPUTE_DRIFT');
  const control = await child(['--experimental-strip-types', '--env-file-if-exists=.env.local', 'ops/aws-sandbox/scripts/inspect-express-delivery-control-plane.ts', '--review', sourceFile]);
  if (control.result?.outcome !== 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED') fail('PRIVATE_REBIND_EXISTING_OWNER_OR_DRIFT');
  await save('compute.json', compute); await save('control-plane.json', control);
  const plan = await prepareExpressPrivateControlRebindV1({ sourceMaterial: original.material, sourceMaterialSha256: original.materialSha256,
    subscriptionId: control.result.subscriptionId, historicalBinding: oldBinding, historicalSummary: oldSummary, historicalSummarySha256: oldSummarySha });
  if (plan.targetScope.deploymentId !== control.proposal?.scope?.deploymentId) fail('PRIVATE_REBIND_PROPOSAL_CHANGED');
  await save('rebind-plan.json', plan);
  if (mode === 'Review') {
    // Only non-secret history/metadata and directory stat inspected here; no private
    // material, key-pair validation or ACL-based access is claimed in Review.
    const stat = await lstat(privateDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(privateDir)).toLowerCase() !== path.resolve(privateDir).toLowerCase()) fail('PRIVATE_REBIND_DIRECTORY_CHANGED');
    const now = Date.now(), body = { schema: 'techlong/express-private-control-reviewed/v1', preparedAt: now,
      expiresAt: Math.min(now + 2 * 3600000, Date.parse(compute.outputs.CellExpiresAt) - 30 * 60000),
      codeBindingSha256: codeSha, rebindPlan: plan, computeStackId: compute.stackId, computeTemplateSha256: compute.templateSha256,
      computeEvidenceFile: executedFile, computeEvidenceFileSha256: digest(await readFile(executedFile)),
      localDirectory: privateDir, permanentSlot: slot,
      limits: { localPrivateLoaderInvocations: 1, privateMaterialFileReadsAtMost: 1, awsSecretValueReads: 0, jwtTokensIssued: 0,
        controlHttpCalls: 0, auroraSqlConnections: 0, cloudWrites: 0, neonBusinessWrites: 0, authorityWrites: 0, automaticRetries: 0 },
      risks: ['Loads the original eight-field local bundle, including private RSA/mTLS and Stripe test fields, into process memory. The unchanged loader verifies original ACL, Full binding, public fingerprints and key/certificate pairs; its payment source is not exposed or used.',
        'Only the reviewed new owner ID, actual published Express image and two physical database names are rebound. Original files/ACL/Full validator are not changed. This does not prove live owner/epoch, Secret content, payment authentication, ECS access or ready.',
        'Filesystem/ACL/metadata checks are not atomic or cross-service CAS. A privileged local actor or concurrent cloud change can race checks. Managed runtime/OS dumps or diagnostics could expose in-memory material; JavaScript disposal releases references and cannot promise forensic erasure.',
        'Only non-secret public parameters and fingerprints are saved. No bearer token, control HTTP, AWS Secret value read, Aurora SQL or business/cloud write is permitted. A later real deployment needs fresh authority, memory reload and review of its actual mutations.',
        'The permanent slot is consumed before invoking the legacy loader, including failures before the private file read. No automatic retry, ACL repair, file rebinding, key regeneration, compensation or slot reset. Existing network resources continue billing; the deadline tag is not automatic cleanup.'],
      ownershipClaimed: false, runtimeEnabled: false, readyVerified: false };
    if (body.expiresAt <= now + 300000) fail('PRIVATE_REBIND_DEADLINE_TOO_CLOSE');
    manifest = { ...body, manifestSha256: await sha256Hex(body) };
    await save('manifest.json', manifest);
    const result = { mode, manifestSha256: manifest.manifestSha256, expiresAt: new Date(manifest.expiresAt).toISOString(),
      computeStackId: compute.stackId, proposedDeploymentId: plan.targetScope.deploymentId, codeBindingSha256: codeSha, codePinCount: pins.length,
      privateLoaderInvocations: 0, slotConsumed: false, awsWrites: 0, auroraSqlConnections: 0, readyVerified: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } else {
    approve();
    if (canonicalJson(manifest.rebindPlan) !== canonicalJson(plan) || manifest.localDirectory !== privateDir || manifest.permanentSlot !== slot ||
        manifest.computeStackId !== compute.stackId || manifest.computeTemplateSha256 !== compute.templateSha256 ||
        manifest.computeEvidenceFileSha256 !== digest(await readFile(executedFile))) fail('PRIVATE_REBIND_REVIEW_CHANGED');
    const f = await open(slot, 'wx');
    consumed = true;
    try { await f.writeFile(JSON.stringify({ manifestSha256: manifest.manifestSha256, outputDirectory: out, consumedAt: Date.now(), retryAuthorized: false }) + '\n'); await f.sync(); } finally { await f.close(); }
    approve(); privateLoads++;
    sources = await loadExpressPrivateControlSourcesV1({ directory: privateDir, plan });
    const result = { mode, outcome: 'PRIVATE_CONTROL_PROVENANCE_REBOUND_NOT_RUNTIME_VERIFIED', manifestSha256: manifest.manifestSha256,
      summary: sources.summary, publicParameters: sources.publicParameters, privateLoaderInvocations: privateLoads, slotConsumed: consumed,
      awsWrites: 0, awsSecretValueReads: 0, jwtTokensIssued: 0, controlHttpCalls: 0, auroraSqlConnections: 0,
      liveOwnerOrEpochClaimed: false, runtimeEnabled: false, readyVerified: false };
    sources.dispose(); sources = undefined;
    await save('result.json', result); console.log(JSON.stringify({ mode, outcome: result.outcome, directory: out, slotConsumed: consumed, readyVerified: false }, null, 2));
  }
} catch (e) {
  const code = /^(?:PRIVATE_REBIND|EXPRESS_PRIVATE)_[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'PRIVATE_REBIND_LOCAL_OR_PROVIDER_FAILED';
  await save('stopped.json', { mode, code, manifestSha256: manifest?.manifestSha256 || null, slotConsumed: consumed,
    privateLoaderInvocations: privateLoads, automaticRetries: 0, awsWrites: 0, auroraSqlConnections: 0, jwtTokensIssued: 0, controlHttpCalls: 0 });
  console.error(code); process.exitCode = 1;
} finally { sources?.dispose(); }
