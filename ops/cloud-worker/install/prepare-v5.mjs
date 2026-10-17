// Offline metadata-only preparation. Does not construct credential providers.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { compileInstallReviewV5, workerPermissionsV5, workerTrustV5 } from './plan-v5.mjs';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
export async function prepareInstallV5(output) {
  const out = path.resolve(output), root = path.resolve('F:/ChatGPT_workshop');
  if (path.dirname(out).toLowerCase() !== root.toLowerCase() || !/^techlong-w5d-review-[a-z0-9-]+$/.test(path.basename(out))) throw Error('FRESH_REVIEW_PATH_REQUIRED');
  const capsule = await json(new URL('../material/public-capsule-v5.json', import.meta.url)),
    aws = await json('F:/ChatGPT_workshop/techlong-w5d-inventory-20261017-cloud/aws.json'),
    neon = await json('F:/ChatGPT_workshop/techlong-w5d-inventory-20261017-cloud/neon-catalog-v3.json'),
    github = await json('F:/ChatGPT_workshop/techlong-w5d-inventory-20261017-github/github.json');
  const review = await compileInstallReviewV5({ capsule, aws, neon, github });
  await mkdir(out);
  const files = { 'design-review.json': review, 'foundation.template.json': review.foundationTemplate,
    'worker-permissions.json': workerPermissionsV5(capsule), 'new-secrets.resource-policy.json': review.secretReadIsolationPolicy,
    // Test/example only. This all-zero commit can never be an activation binding.
    'trust-shape.example.json': workerTrustV5('0'.repeat(40)) };
  const receipts = [];
  for (const [name, value] of Object.entries(files)) { const text = JSON.stringify(value, null, 2) + '\n';
    await writeFile(path.join(out, name), text, { flag: 'wx', flush: true }); receipts.push({ file: name, rawSha256: await sha256Hex(text) }); }
  const result = { outcome: 'INSTALL_DESIGN_READY_NOT_EXECUTION_APPROVAL', reviewSha256: review.reviewSha256, output: out, files: receipts,
    permissionDocumentBytes: Buffer.byteLength(JSON.stringify(files['worker-permissions.json'])), foundationResources: Object.keys(review.foundationTemplate.Resources).length,
    cloudWrites: 0, dbWrites: 0, privateReads: 0, runtimeEnabled: false };
  await writeFile(path.join(out, 'preparation.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', flush: true });
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--output') throw Error('OUTPUT_ARGUMENT_REQUIRED');
  prepareInstallV5(process.argv[3]).then(r => console.log(JSON.stringify(r, null, 2))).catch(() => { console.error('INSTALL_DESIGN_REJECTED'); process.exitCode = 1; });
}
