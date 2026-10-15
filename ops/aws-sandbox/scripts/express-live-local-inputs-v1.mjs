// Fixed non-secret provenance only. Original private materials are NOT read.
import path from 'node:path';
import { readFile, realpath, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareExpressPrivateControlRebindV1 } from '../../../lib/deployments/execution/express-private-control-v1.ts';
import { prepareExpressLiveDeliveryPlanV2 } from '../../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
export const LIVE_BASE = 'F:/ChatGPT_workshop';
export const LIVE_BACKEND = 'E:/NodejsProject/SpeedFeast_Backend_main';
export const LIVE_PRIVATE = LIVE_BASE + '/techlong-d001-credentials-20261013-r2';
export const LIVE_PLATFORM = fileURLToPath(new URL('../../../', import.meta.url));
export const rawHash = v => createHash('sha256').update(v).digest('hex');
export async function loadExpressLiveInputsV1() {
  const history = [];
  const json = async (file, pin) => {
    if (/private-material\.json$/i.test(file)) throw Error('LIVE_PRIVATE_INPUT_NOT_ALLOWED_HERE');
    const bytes = await readFile(file), digest = rawHash(bytes);
    if (bytes.length > 4_000_000 || pin && digest !== pin) throw Error('LIVE_LOCAL_HISTORY_CHANGED');
    history.push({ path: file.replaceAll('\\', '/'), rawFileSha256: digest }); return JSON.parse(bytes);
  };
  const source = await json(LIVE_BASE + '/techlong-express-delivery-c5c-20261015-r1.review.json', 'f744acf7846b8e39498fef6cd1911356d867b54c32d4c71aaa6109fa3f7d263e');
  const previousPlan = await json(LIVE_BASE + '/techlong-express-c5f-review-20261015-r3/plan.json');
  if (previousPlan.planSha256 !== 'd9afc3e7780651ddaebc333ddab8dcb09b6e74fecef37d9d3c72ad5d9248b92e') throw Error('LIVE_HISTORICAL_PLAN_CHANGED');
  const compute = await json(LIVE_BASE + '/techlong-express-c5f-review-20261015-r3/compute.json');
  const business = await json(LIVE_BASE + '/techlong-d001-business-review-20261013-r3/manifest.json');
  const summary = await json(LIVE_PRIVATE + '/summary.json', '9daf504a6d4cd3b281cb9632f41c45085d6f531f6af96680e44f05c8a805fd63');
  const binding = await json(LIVE_PRIVATE + '/binding.json');
  const privateCapsule = await json(path.join(LIVE_PLATFORM, 'ops/aws-sandbox/reviews/aurora-dual-mode-c5e-private-control.executed.json'));
  const privateReceipt = await json(privateCapsule.run.directory + '/result.json');
  for (const f of privateCapsule.evidenceFiles) await json(f.path, f.rawFileSha256);
  const cfn = await json(path.join(LIVE_PLATFORM, 'ops/aws-sandbox/reviews/aurora-dual-mode-c5g-cfn-read-policy.executed.json'));
  for (const f of cfn.evidenceFiles) await json(f.path, f.rawFileSha256);
  const cfnInventory = await json(cfn.independentInspect.directory + '/independent-inventory.json');
  const iamBefore = await json(LIVE_BASE + '/techlong-d002-express-c4h-review-20261015-r2/iam-metadata.json');
  const snapshot = await json(LIVE_BASE + '/techlong-express-c5c-store-seed-inspect-20261015-r1/program.json',
    '44815f7494479e583d8fb829532a11bd494e6e455e7eca94ed849d7ef189869d');
  const privatePlan = await prepareExpressPrivateControlRebindV1({ sourceMaterial: source.material,
    sourceMaterialSha256: source.materialSha256, subscriptionId: previousPlan.subscriptionId,
    historicalBinding: binding, historicalSummary: summary, historicalSummarySha256: history.find(x => x.path.endsWith('/summary.json')).rawFileSha256 });
  const delivery = { scope: source.material.scope, sourcePlan: source.material.sourcePlan,
    sourcePlanSha256: source.material.sourcePlanSha256, configuration: business.material.configuration,
    configurationSha256: source.material.configurationSha256, configurationSchema: business.inventory.plan.schema,
    environment: source.material.environment, binding: source.material.binding,
    databaseOid: source.material.databaseOid, roleOid: source.material.roleOid, tenantHostname: source.material.tenantHostname };
  return { source, previousPlan, compute, privateReceipt, privatePlan, delivery, cfnInventory, iamBefore, snapshot, history,
    async plan(now = Date.now()) { return prepareExpressLiveDeliveryPlanV2({ sourceMaterial: source.material,
      sourceMaterialSha256: source.materialSha256, subscriptionId: previousPlan.subscriptionId, configuration: delivery.configuration,
      configurationSchema: delivery.configurationSchema, privateReceipt, compute, hostedZoneId: previousPlan.proposedDnsCreate.HostedZoneId,
      now, previousPlan, windowAcknowledgement: 'INDEPENDENT_CHILD_WINDOW_PARENT_UNCHANGED_NO_AUTO_CLEANUP' }); } };
}

/** Resolve the actual local import closure, not a stale project-wide snapshot.
 * Backend dynamic require roots are explicit. Locks bind external dependencies;
 * this is integrity checking, not a claim that npm packages were re-audited. */
export async function expressLiveCodeBindingV1(history) {
  const seen = new Set(), pins = [];
  const pin = async file => {
    const resolved = await realpath(file), key = resolved.toLowerCase(); if (seen.has(key)) return; seen.add(key);
    if (![LIVE_PLATFORM, LIVE_BACKEND].some(root => key.startsWith(path.resolve(root).toLowerCase() + path.sep))) throw Error('LIVE_CODE_OUTSIDE_REPOSITORIES');
    const code = (await readFile(resolved, 'utf8')).replace(/\r\n/g, '\n'); pins.push({ path: resolved.replaceAll('\\', '/'), sha256: rawHash(code) });
    if (!/\.(?:ts|mjs|cjs|js)$/.test(resolved)) return;
    for (const m of code.matchAll(/(?:from\s*|(?:require|import)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(resolved), m[1]); let found;
      for (const name of [base, base + '.js', base + '.cjs', base + '.ts', base + '/index.js']) {
        try { await access(name); found = name; break; } catch { /* exact next suffix */ }
      }
      if (!found) throw Error('LIVE_CODE_IMPORT_UNRESOLVED'); await pin(found);
    }
  };
  for (const file of [path.join(LIVE_PLATFORM, 'ops/aws-sandbox/scripts/review-express-live-delivery-v2.mjs'),
    path.join(LIVE_PLATFORM, 'lib/deployments/execution/express-live-delivery-runner-v1.ts'),
    path.join(LIVE_PLATFORM, 'lib/deployments/execution/express-first-deployment-runtime-v1.ts'),
    path.join(LIVE_PLATFORM, 'package.json'), path.join(LIVE_PLATFORM, 'package-lock.json'),
    LIVE_BACKEND + '/package-lock.json', LIVE_BACKEND + '/services/saas/aurora_connections_v2.js',
    LIVE_BACKEND + '/services/saas/tenant-readiness-v1.cjs']) await pin(file);
  pins.sort((a, b) => a.path.localeCompare(b.path));
  const body = { pins, history, nodeVersion: process.version };
  return { ...body, codeBindingSha256: await sha256Hex(body) };
}
