import path from 'node:path';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { prepareExpressLiveDeliveryReviewV1, runReviewedExpressLiveDeliveryV1 } from '../../../lib/deployments/execution/express-live-delivery-runner-v1.ts';
import { createAcceptanceReadonlyNeonSql } from '../../../lib/deployments/execution/single-tenant-control-bindings.ts';
import { loadExpressLiveInputsV1, expressLiveCodeBindingV1, LIVE_BASE, LIVE_PLATFORM } from './express-live-local-inputs-v1.mjs';
import { observeExpressLiveMetadataV1 } from './express-live-metadata-v1.mjs';
import { createExpressLiveRuntimeV1 } from './express-live-runtime-v1.mjs';

const pairs = [], raw = process.argv.slice(2);
if (raw.length % 2) throw Error('LIVE_CLI_ARGUMENTS');
for (let n = 0; n < raw.length; n += 2) pairs.push([raw[n], raw[n + 1]]);
const args = Object.fromEntries(pairs), mode = args['--mode'], out = path.resolve(args['--output'] || '');
const required = ['Check', 'Review'].includes(mode) ? ['--mode', '--output'] : ['--mode', '--output', '--manifest', '--approved-sha'];
if (!['Check', 'Review', 'Run', 'Inspect'].includes(mode) || pairs.length !== required.length ||
    new Set(pairs.map(p => p[0])).size !== pairs.length || required.some(k => !args[k]) || Object.keys(args).some(k => !required.includes(k)) ||
    path.dirname(out).toLowerCase() !== path.resolve(LIVE_BASE).toLowerCase() || !/^techlong-express-c5h-[a-z0-9-]+$/.test(path.basename(out))) throw Error('LIVE_CLI_ARGUMENTS');
await mkdir(out);
const save = async (name, value) => { const f = await open(path.join(out, name), 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2) + '\n'); await f.sync(); } finally { await f.close(); } };
let runtime, phase = 'local', usedRun = false;
try {
  if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
    'PGHOST', 'PGPASSWORD', 'PGUSER', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'].some(k => process.env[k]) ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.cwd().toLowerCase() !== path.resolve(LIVE_PLATFORM).toLowerCase()) throw Error('LIVE_CLI_ENVIRONMENT_REJECTED');
  const inputs = await loadExpressLiveInputsV1(), binding = await expressLiveCodeBindingV1(inputs.history);
  await save('code-binding.json', binding);
  if (mode === 'Check') {
    const plan = await inputs.plan();
    // A valid-shaped synthetic URL exercises the REAL lazy constructor, but
    // no method capable of query/send/private-load is called in Check.
    runtime = await createExpressLiveRuntimeV1({ inputs, plan, codeBindingSha256: binding.codeBindingSha256,
      databaseUrl: 'postgresql://check:check@local-check.neon.tech/unused', save });
    await save('local-plan.json', plan);
    const result = { mode, outcome: 'LOCAL_COMPOSITION_CHECKED_NOT_REVIEWED', directory: out, codeBindingSha256: binding.codeBindingSha256,
      codeFiles: binding.pins.length, historyFiles: inputs.history.length, AWSCalls: 0, SQLConnections: 0, privateReads: 0,
      permanentSlotsConsumed: 0, executionAuthorized: false };
    await save('result.json', result); console.log(JSON.stringify(result, null, 2));
  } else {
    // Never export the Neon URL into process.env/child processes/Aurora config.
    const localEnv = parseEnv(await readFile(path.join(LIVE_PLATFORM, '.env.local'), 'utf8'));
    const databaseUrl = localEnv.DATABASE_URL || '';
    const sql = createAcceptanceReadonlyNeonSql(databaseUrl);
    const signal = AbortSignal.timeout(mode === 'Run' ? 59 * 60000 : 150000);
    if (mode === 'Review') {
      phase = 'readonly_metadata'; const initialPlan = await inputs.plan();
      const metadata = await observeExpressLiveMetadataV1({ inputs, plan: initialPlan, sql, signal });
      await save('metadata.json', metadata);
      // Only time/tags are rerendered after reads. Names/owner/epoch/image and
      // DNS stay identical; the observer's real timestamp is never rewritten.
      const plan = await inputs.plan(), review = await prepareExpressLiveDeliveryReviewV1({ plan, codeBindingSha256: binding.codeBindingSha256, now: Date.now() });
      if (canonicalJson(plan.scope) !== canonicalJson(initialPlan.scope) ||
          canonicalJson(plan.proposedEpochTransaction) !== canonicalJson(initialPlan.proposedEpochTransaction) ||
          canonicalJson(plan.proposedDnsCreate) !== canonicalJson(initialPlan.proposedDnsCreate)) throw Error('LIVE_REVIEW_TARGET_CHANGED');
      const riskDocument = 'docs/aws-auto-deployment-aurora-dual-mode-c5h2-live-entry.md';
      const body = { schema: 'techlong/express-live-manifest/v2', plan, review, codeBindingSha256: binding.codeBindingSha256,
        metadataSha256: await sha256Hex(metadata), historySha256: await sha256Hex(inputs.history),
        riskDocument, riskDocumentSha256: await sha256Hex(await readFile(path.join(LIVE_PLATFORM, riskDocument), 'utf8')),
        limits: { sourceCloudWrites: 3, neonWriteTransactions: 10, auroraReadonlyConnections: 2, auroraNormalQueriesPerConnection: 12,
          privateBundleLoads: 1, runtimeSecretValueReads: 1, provisionPosts: 1, iamWrites: 0, automaticWriteRetries: 0,
          bootstrapGetMaximum: 12, initializedAndControlGets: 2 },
        monthlyBudgetTargetUSD: 50, hardCostCap: false, feeAutoStopInstalled: false, cloudResourcesCreatedNow: 0,
        risks: [
          'Independent child two-hour window after expired parent tag; no parent renewal or automatic deletion/fee stop. Existing and leftover resources continue billing; 50 USD/month is a target, not a cap.',
          'Three Source cloud write calls create initial authority, a seven-resource workload through CFN and one exact DNS A alias. CFN OnFailure ROLLBACK can delete new stack resources, and rollback/partial failure can leave billable resources. No script delete/update/grant/rebuild/reseed/restore.',
          'One private bundle load includes the historical eight-field private material in memory; only JWT/mTLS control sources are exposed. One fixed runtime Secret value is read by the operator to derive the first owner password; ECS separately injects its fixed refs.',
          'Two Source-postgres IAM/TLS READ ONLY transactions use the frozen eight SELECTs; privileged credentials, schema/role metadata and seed counts are exposed to provider logs and Aurora can resume with nonzero ACU/I/O charges. No SQL business writes or automatic SQL retry.',
          'Up to ten Neon write transactions, one provision POST and cloud actions are not one cross-service transaction. Failed or uncertain submission can leave running job/authority/stack/DNS/tenant business data. Never automatically compensate, retry or reset slots.',
          'The exact original tenant DB, physical OIDs, schema/role/catalog/ACL hashes, one default store and pristine state must match before claim and after bootstrap. Matching checks are not a cross-service CAS or protection from privileged concurrent changes.',
          'Admission expires after fifteen minutes; run has a fixed maximum fifty-five-minute kernel deadline and one-hour job lease. Permanent slots are consumed before each attempt, including two read-only database entries; local journal tampering/filesystem failures are not eliminated.',
          'Initialized/effective configuration and actual ECS image checks plus atomic instance/deployment/job writeback are required. Commit or provider success can be lost with its response; independent Inspect is read-only and does not replay operations.',
        ], currentAuroraStateProved: false, permissionSimulationPerformed: false, actualLogAccessProved: false,
        executionAuthorized: false, runtimeEnabled: false, readyVerified: false };
      const manifest = { ...body, manifestSha256: await sha256Hex(body) };
      await save('manifest.json', manifest);
      const result = { mode, outcome: 'FRESH_MANIFEST_REQUIRES_EXACT_HUMAN_APPROVAL', directory: out, manifestSha256: manifest.manifestSha256,
        admissionExpiresAt: new Date(review.admissionExpiresAt).toISOString(), proposedChildDeadline: plan.deadlineTag,
        sdkReadonlyCalls: metadata.sdkCalls, cliReadonlyCalls: metadata.cliCalls, neonReadonlyTransactions: 1,
        auroraConnections: 0, actualWrites: 0, privateReads: 0, permanentSlotsConsumed: 0 };
      await save('result.json', result); console.log(JSON.stringify(result, null, 2));
    } else {
      phase = 'validate_exact_approval';
      const manifestFile = path.resolve(args['--manifest']);
      if (path.basename(manifestFile) !== 'manifest.json' || path.dirname(path.dirname(manifestFile)).toLowerCase() !== path.resolve(LIVE_BASE).toLowerCase() ||
          !/^techlong-express-c5h-/.test(path.basename(path.dirname(manifestFile)))) throw Error('LIVE_MANIFEST_PATH_REJECTED');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), { manifestSha256, ...body } = manifest;
      if (manifestSha256 !== args['--approved-sha'] || await sha256Hex(body) !== manifestSha256 ||
          manifest.schema !== 'techlong/express-live-manifest/v2' || manifest.riskDocument !== 'docs/aws-auto-deployment-aurora-dual-mode-c5h2-live-entry.md' ||
          binding.codeBindingSha256 !== manifest.codeBindingSha256 || await sha256Hex(inputs.history) !== manifest.historySha256 ||
          await sha256Hex(await readFile(path.join(LIVE_PLATFORM, manifest.riskDocument), 'utf8')) !== manifest.riskDocumentSha256)
        throw Error('LIVE_EXACT_APPROVAL_OR_CLOSURE_REJECTED');
      if (canonicalJson(await inputs.plan(manifest.plan.renderRequestedAt)) !== canonicalJson(manifest.plan)) throw Error('LIVE_MANIFEST_PLAN_REDERIVATION_REJECTED');
      if (mode === 'Run' && (Date.now() < manifest.review.preparedAt || Date.now() >= manifest.review.admissionExpiresAt)) throw Error('LIVE_APPROVAL_EXPIRED_NO_WRITE');
      // A completed/ambiguous run cannot connect SQL again through a new SHA.
      if (mode === 'Run') for (const entry of ['admit', 'database_observe_preflight']) {
        try { await access(LIVE_BASE + '/techlong-express-c5h-first-delivery-v1/' + entry + '.permanent-slot.json'); throw Error('LIVE_PERMANENT_ENTRY_OCCUPIED_NO_RETRY'); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      runtime = await createExpressLiveRuntimeV1({ inputs, plan: manifest.plan, databaseUrl, codeBindingSha256: binding.codeBindingSha256, save });
      phase = mode;
      let result;
      if (mode === 'Run') {
        usedRun = true;
        result = await runReviewedExpressLiveDeliveryV1({ plan: manifest.plan, review: manifest.review,
          approvedReviewSha256: manifest.review.reviewSha256, ports: runtime, signal });
      } else {
        const jobId = 'job_' + (await sha256Hex({ deploymentId: manifest.plan.scope.deploymentId,
          planSha256: manifest.plan.scope.planHash, purpose: 'express-supervised-first-apply/v1' })).slice(0, 24);
        await runtime.infrastructure.assertIdentity(signal);
        result = { outcome: 'PLATFORM_READY_AND_ECS_IMAGE_VERIFIED_PRIOR_INITIALIZATION_RECEIPT_ONLY',
          ...await runtime.inspectReady({ plan: manifest.plan, jobId, signal }), auroraConnections: 0,
          privateReads: 0, actualWrites: 0, initializedApiRerun: false };
      }
      await save('result.json', { mode, manifestSha256, ...result }); console.log(JSON.stringify({ mode, manifestSha256, ...result }, null, 2));
      if (result.outcome === 'REQUIRES_INDEPENDENT_INSPECT_NO_RETRY') process.exitCode = 1;
    }
  }
} catch (e) {
  const code = /^(?:LIVE_|EXPRESS_)[A-Z0-9_]+$/.test(e.message || '') ? e.message : 'LIVE_LOCAL_OR_PROVIDER_FAILED';
  await save('stopped.json', { phase, code, usedRun, automaticWriteRetry: false,
    mutationsNotAssumedAbsentAfterRunEntry: usedRun, readCounts: e.readCounts || null });
  console.error(code); process.exitCode = 1;
} finally { runtime?.dispose(); }
