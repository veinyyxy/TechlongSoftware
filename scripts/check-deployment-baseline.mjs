import { readFile } from 'node:fs/promises';
import { compareBindings, compareDeclarations, draftImageUpdate } from '../ops/deployment-baseline/review.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Offline only: node scripts/check-deployment-baseline.mjs <platform.json> <cell.json> <tenant.json> [bindings.json [current-image@sha256:... proposed-image@sha256:...]]');
} else {
  try {
    if (![3, 4, 6].includes(args.length)) throw Error('INVALID_ARGUMENT_COUNT');
    const templates = {};
    for (const [i, role] of ['platform', 'cell', 'tenant'].entries()) {
      templates[role] = JSON.parse(await readFile(args[i], 'utf8'));
    }
    const bindings = args.length > 3 ? JSON.parse(await readFile(args[3], 'utf8')) : undefined;
    const result = args.length === 6 ? draftImageUpdate(templates, bindings, ...args.slice(4)) :
      { ...compareDeclarations(templates), bindings: bindings && compareBindings(bindings) };
    console.log(JSON.stringify(result, null, 2));
    if (result.matchesHistoricalDeclarations === false || result.bindings?.matchesSuppliedBindings === false) process.exitCode = 1;
  } catch (e) {
    console.error(/^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_LOCAL_TEMPLATE_INPUT');
    process.exitCode = 1;
  }
}
