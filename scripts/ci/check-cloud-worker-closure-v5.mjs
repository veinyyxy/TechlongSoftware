// Prove the portable runtime closure, not the local PUBLIC-history packager.
import { readFile, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url))), seen = new Set(), pins = [];
const hash = v => createHash('sha256').update(v).digest('hex');
async function pin(file) {
  const absolute = await realpath(file), relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Cloud closure outside repository');
  if (seen.has(absolute)) return; seen.add(absolute);
  const text = (await readFile(absolute, 'utf8')).replace(/\r\n/g, '\n');
  // No credential files, old local load root, shell, or remote dynamic import.
  const dependencyMetadata = /(?:^|\/)package(?:-lock)?\.json$/.test(relative);
  if (!dependencyMetadata && /\bfromLoginCredentials\b|node:child_process|F:[/\\]|E:[/\\]|\.env\.local|express-live-local-inputs|single-tenant-private-loader|https?:\/\/.*\.mjs['"]/.test(text))
    throw Error('Local-only dependency in cloud runtime: ' + relative);
  pins.push({ file: relative, normalizedLfSha256: hash(text) });
  if (!/\.(?:mjs|js|cjs|ts)$/.test(absolute)) return;
  for (const m of text.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(absolute), m[1]); let found;
    for (const candidate of [base, base + '.ts', base + '.mjs', base + '.js', path.join(base, 'index.ts')]) {
      try { await access(candidate); found = candidate; break; } catch { /* next explicit suffix */ }
    }
    if (!found) throw Error('Unresolved cloud import: ' + relative); await pin(found);
  }
}
for (const f of ['ops/cloud-worker/check-runtime-v5.mjs', 'ops/cloud-worker/material/public-capsule-v5.json',
  'ops/cloud-worker/package.json', 'ops/cloud-worker/package-lock.json', 'package.json', 'package-lock.json']) await pin(path.join(root, f));
pins.sort((a, b) => a.file.localeCompare(b.file));
console.log(JSON.stringify({ schema: 'techlong/cloud-worker-portable-closure/v5', outcome: 'PASSED',
  pinCount: pins.length, pins, normalization: 'CRLF_TO_LF_EXPLICIT_NOT_LEGACY_RAW_PINS',
  awsCalls: 0, databaseQueries: 0, privateReads: 0, runtimeActivated: false }, null, 2));
