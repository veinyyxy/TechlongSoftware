import { readFile, mkdir, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareInstallV5, installLockedV5 } from './installer-v5.mjs';
import { createLocalInstallIoV5, sourceBindingV5, materialBindingV5, assertLocalEnvironmentV5,
  INSTALL_LOCAL_V5, writePublicOnceV5 } from './local-io-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
const must = (v, code) => { if (!v) throw Error(code); };
async function fixedDirectory(name, kind) {
  const base = await realpath(INSTALL_LOCAL_V5.base), p = path.resolve(name);
  must(path.dirname(p).toLowerCase() === base.toLowerCase() &&
    new RegExp('^techlong-w5e-' + kind + '-[a-z0-9-]+$').test(path.basename(p)), 'INSTALL_FIXED_DIRECTORY'); return p;
}
async function json(file) {
  const text = await readFile(file, 'utf8'); must(Buffer.byteLength(text) < 2000000, 'INSTALL_JSON_SIZE'); return JSON.parse(text);
}
export async function mainInstallV5(args = process.argv.slice(2)) {
  const a = {}; must(args.length % 2 === 0, 'INSTALL_ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    must(/^--[a-z-]+$/.test(args[i]) && !Object.hasOwn(a, args[i]) && args[i + 1], 'INSTALL_ARGUMENTS'); a[args[i]] = args[i + 1];
  }
  const mode = a['--mode'], required = ['--mode','--output', ...(mode === 'InstallLocked' ? ['--manifest','--approved-sha'] :
    mode === 'Inspect' ? ['--run-directory'] : [])];
  must(['Review','InstallLocked','Inspect'].includes(mode) && Object.keys(a).length === required.length && required.every(k => a[k]), 'INSTALL_ARGUMENT_SET');
  assertLocalEnvironmentV5();
  const output = await fixedDirectory(a['--output'], mode === 'Review' ? 'review' : mode === 'InstallLocked' ? 'install' : 'inspect');
  await mkdir(output); // Create-only; never overwrite a prior record.
  const capsule = await json(new URL('../material/public-capsule-v5.json', import.meta.url));
  const io = createLocalInstallIoV5({ output, capsule });
  try {
    let result;
    if (mode === 'Review') {
      try { await access(INSTALL_LOCAL_V5.slot); throw Error('INSTALL_SLOT_OCCUPIED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const source = await sourceBindingV5(), material = await materialBindingV5(), prestate = await io.preflight();
      await writePublicOnceV5(output, 'prestate', prestate);
      const manifest = await prepareInstallV5({ capsule, prestate, source, material, now: Date.now() });
      await writePublicOnceV5(output, 'manifest', manifest);
      result = { mode, manifestSha256: manifest.manifestSha256, actionsSha256: manifest.actionsSha256,
        expiresAt: new Date(manifest.expiresAt).toISOString(), externalWrites: 0, privateBundleReads: 0, slotConsumed: false,
        runtimeEnabled: false, activationAuthorized: false };
    } else if (mode === 'InstallLocked') {
      const manifestPath = await realpath(a['--manifest']);
      must(path.basename(manifestPath) === 'manifest.json' && path.dirname(manifestPath) ===
        await fixedDirectory(path.dirname(manifestPath), 'review'), 'INSTALL_MANIFEST_PATH');
      const m = await json(manifestPath), source = await sourceBindingV5(), material = await materialBindingV5();
      await writePublicOnceV5(output, 'approved-manifest', m);
      result = await installLockedV5({ manifest: m, approvedSha256: a['--approved-sha'], capsule, source, material, io });
      if (result.outcome.startsWith('PARTIAL')) process.exitCode = 1;
    } else {
      const run = await realpath(await fixedDirectory(a['--run-directory'], 'install'));
      const partial = await io.inspectPartial(); await writePublicOnceV5(output, 'partial-metadata', partial);
      // A complete binding is optional. Partial evidence never grants recovery.
      const binding = await json(path.join(run, 'installation-binding.json')).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (!binding) result = { mode, outcome: 'PARTIAL_OR_UNKNOWN_NO_REPLAY_AUTHORIZED', externalWrites: 0, runtimeEnabled: false };
      else {
        await assertInstallationV5(binding, binding.installationSha256, await loadNeonContractV5());
        const foundation = await json(path.join(run, 'foundation-submission.json'));
        const { roleOid, ownerOid, functionOids, endpointSha256 } = binding.neon;
        const proof = await io.inspect({ foundation, refs: [binding.databaseSecret,binding.controlSecret],
          neon: { roleOid, ownerOid, functionOids, endpointSha256 } });
        must(proof.roleId === binding.roleId && proof.tableId === binding.tableId, 'INSTALL_BINDING_ID_DRIFT');
        result = { mode, outcome: 'LOCKED_INSTALL_INDEPENDENT_METADATA_VERIFIED', bindingSha256: binding.installationSha256,
          proof, externalWrites: 0, privateBundleReads: 0, secretValuesRead: 0, runtimeEnabled: false,
          cloudOidcExchangeProved: false, cloudSecretReadProved: false, retryAllowed: false };
      }
    }
    await writePublicOnceV5(output, 'summary', result); console.log(JSON.stringify({ ...result, output }, null, 2)); return result;
  } catch {
    await writePublicOnceV5(output, 'failure', { mode, outcome: 'STOPPED_REQUIRES_READ_ONLY_INSPECT',
      retryAllowed: false, runtimeEnabled: false }); throw Error('INSTALL_STOPPED_NO_AUTOMATIC_RETRY');
  } finally { io.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mainInstallV5().catch(() => {
  console.error('INSTALL_STOPPED_NO_AUTOMATIC_RETRY'); process.exitCode = 1;
});
