// LOCAL-ONLY candidate. No SDK clients, credential providers, SQL connections,
// original private-material files, execution slots or live Run mode.
import path from 'node:path';
import { readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareExpressLiveDeliveryPlanV2 } from '../../../lib/deployments/execution/express-live-delivery-plan-v1.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const base = 'F:/ChatGPT_workshop', args = process.argv.slice(2), out = path.resolve(args[1] || '');
if (args.length !== 2 || args[0] !== '--output' || path.dirname(out).toLowerCase() !== path.resolve(base).toLowerCase() ||
    !/^techlong-express-c5h-draft-[a-z0-9-]+\.json$/.test(path.basename(out))) throw Error('EXPRESS_DRAFT_ARGUMENTS_REJECTED');
const rawHash = b => createHash('sha256').update(b).digest('hex');
const files = [];
const json = async (file, expected) => {
  const raw = await readFile(file), hash = rawHash(raw);
  if (expected && expected !== hash) throw Error('EXPRESS_DRAFT_LOCAL_EVIDENCE_DRIFT');
  files.push({ path: file.replaceAll('\\', '/'), rawFileSha256: hash }); return JSON.parse(raw);
};
const source = await json(base + '/techlong-express-delivery-c5c-20261015-r1.review.json',
  'f744acf7846b8e39498fef6cd1911356d867b54c32d4c71aaa6109fa3f7d263e');
const previous = await json(base + '/techlong-express-c5f-review-20261015-r3/plan.json');
if (previous.planSha256 !== 'd9afc3e7780651ddaebc333ddab8dcb09b6e74fecef37d9d3c72ad5d9248b92e') throw Error('EXPRESS_DRAFT_OLD_PLAN_DRIFT');
const compute = await json(base + '/techlong-express-c5f-review-20261015-r3/compute.json');
const business = await json(base + '/techlong-d001-business-review-20261013-r3/manifest.json');
const privateCapsule = await json('ops/aws-sandbox/reviews/aurora-dual-mode-c5e-private-control.executed.json');
for (const f of privateCapsule.evidenceFiles) {
  // C5e evidence is its NON-SECRET run/inspect output; never original bundle.
  if (f.path.toLowerCase().includes('private-material.json')) throw Error('EXPRESS_DRAFT_PRIVATE_INPUT_FORBIDDEN');
  if (rawHash(await readFile(f.path)) !== f.rawFileSha256) throw Error('EXPRESS_DRAFT_PRIVATE_RECEIPT_DRIFT');
}
const privateReceipt = await json(privateCapsule.run.directory + '/result.json');
const cfn = await json('ops/aws-sandbox/reviews/aurora-dual-mode-c5g-cfn-read-policy.executed.json');
for (const f of cfn.evidenceFiles) if (rawHash(await readFile(f.path)) !== f.rawFileSha256) throw Error('EXPRESS_DRAFT_CFN_RECEIPT_DRIFT');
const plan = await prepareExpressLiveDeliveryPlanV2({ sourceMaterial: source.material,
  sourceMaterialSha256: source.materialSha256, subscriptionId: previous.subscriptionId,
  configuration: business.material.configuration, configurationSchema: business.inventory.plan.schema,
  privateReceipt, compute, hostedZoneId: previous.proposedDnsCreate.HostedZoneId, now: Date.now(), previousPlan: previous,
  windowAcknowledgement: 'INDEPENDENT_CHILD_WINDOW_PARENT_UNCHANGED_NO_AUTO_CLEANUP' });
const code = [];
for (const file of ['lib/deployments/execution/express-live-delivery-plan-v1.ts',
  'lib/deployments/execution/express-first-claim-program-v1.ts', 'lib/deployments/execution/express-live-persistence-v1.ts',
  'lib/deployments/execution/express-live-delivery-runner-v1.ts', 'lib/deployments/execution/express-live-journal-v1.ts',
  'lib/deployments/execution/aws-sdk-express-live-infrastructure-v1.ts', 'ops/aws-sandbox/scripts/prepare-express-live-delivery-v2.mjs',
  'package.json', 'package-lock.json']) code.push({ path: file, rawFileSha256: rawHash(await readFile(file)) });
const artifact = { schema: 'techlong/express-live-delivery-local-draft/v1', preparedAt: new Date().toISOString(),
  outcome: 'KERNEL_IMPLEMENTED_LIVE_ENTRY_NOT_INSTALLED', plan, evidenceFiles: files, codeFiles: code,
  codeBindingSha256: await sha256Hex(code),
  blockers: ['fresh_exact_cloud_iam_and_database_readonly_preflight_adapter',
    'current_installed_database_observer_after_bootstrap', 'independent_atomic_ready_inspector',
    'private_control_loader_composition_and_exact_runtime_closure_binding', 'fresh_resource_cost_and_execution_approval'],
  AWSCalls: 0, SQLConnections: 0, privateBundleLoads: 0, permanentSlotsConsumed: 0,
  executionAuthorized: false, approvalManifest: false, liveEntryPointInstalled: false };
const output = await open(out, 'wx');
try { await output.writeFile(JSON.stringify(artifact, null, 2) + '\n'); await output.sync(); } finally { await output.close(); }
console.log(JSON.stringify({ outcome: artifact.outcome, output: out.replaceAll('\\', '/'), planSha256: plan.planSha256,
  codeBindingSha256: artifact.codeBindingSha256, parentTag: plan.cellDeadlineTag, proposedChildDeadline: plan.deadlineTag,
  executionAuthorized: false, approvalManifest: false, AWSCalls: 0, SQLConnections: 0 }, null, 2));
