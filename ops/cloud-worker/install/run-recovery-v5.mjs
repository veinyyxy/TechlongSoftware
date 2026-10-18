import { readFile, mkdir, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertLocalEnvironmentV5, materialBindingV5, INSTALL_LOCAL_V5, writePublicOnceV5 } from './local-io-v5.mjs';
import { createRecoveryIoV5, recoveryHistoryV5, recoverySourceBindingV5, RECOVERY_SLOT_V5 } from './recovery-local-io-v5.mjs';
import { prepareRecoveryV5, recoverLockedV5, RECOVERY_ANCHOR_V5 as A } from './recovery-v5.mjs';
import { canonicalJson } from '../../../lib/deployments/execution/hash.ts';
import { safeRecoveryFailureV5 } from './neon-recovery-sql-v5.mjs';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
const must = (v, code) => { if (!v) throw Error(code); };
const json = async f => { const raw = await readFile(f, 'utf8'); must(Buffer.byteLength(raw) < 2000000, 'RECOVERY_JSON_SIZE'); return JSON.parse(raw); };
async function fixedDirectory(input, kind) {
  const p = path.resolve(input), base = await realpath(INSTALL_LOCAL_V5.base);
  must(path.dirname(p).toLowerCase() === base.toLowerCase() && new RegExp('^techlong-w5e-recovery-' + kind + '-[a-z0-9-]+$').test(path.basename(p)),
    'RECOVERY_FIXED_DIRECTORY'); return p;
}
export async function mainRecoveryV5(args = process.argv.slice(2)) {
  const a = {}; must(args.length % 2 === 0, 'RECOVERY_ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    must(/^--[a-z-]+$/.test(args[i]) && !Object.hasOwn(a, args[i]) && args[i + 1], 'RECOVERY_ARGUMENTS'); a[args[i]] = args[i + 1];
  }
  const mode = a['--mode'], keys = ['--mode','--output', ...(mode === 'RecoverLocked' ? ['--manifest','--approved-sha'] :
    mode === 'Inspect' ? ['--run-directory'] : [])];
  must(['Review','RecoverLocked','Inspect'].includes(mode) && Object.keys(a).length === keys.length && keys.every(k => a[k]), 'RECOVERY_ARGUMENT_SET');
  assertLocalEnvironmentV5();
  const out = await fixedDirectory(a['--output'], mode === 'Review' ? 'review' : mode === 'RecoverLocked' ? 'run' : 'inspect'); await mkdir(out);
  const capsule = await json(new URL('../material/public-capsule-v5.json', import.meta.url)), io = createRecoveryIoV5({ output: out, capsule });
  try {
    let result;
    if (mode !== 'Inspect') {
      // Neither Review nor a newly generated manifest can bypass a used recovery slot.
      try { await access(RECOVERY_SLOT_V5); throw Error('RECOVERY_SLOT_ALREADY_USED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const source = await recoverySourceBindingV5(), material = await materialBindingV5(), history = await recoveryHistoryV5();
      if (mode === 'Review') {
        const prestate = await io.preflight(); await io.record('prestate', prestate);
        const manifest = await prepareRecoveryV5({ prestate, source, material, history, now: Date.now() });
        await io.record('manifest', manifest);
        result = { mode, manifestSha256: manifest.manifestSha256, actionsSha256: manifest.actionsSha256,
          expiresAt: new Date(manifest.expiresAt).toISOString(), externalWrites: 0, originalPrivateReads: 0,
          newSlotConsumed: false, runtimeEnabled: false, scope: 'EXISTING_LOCKED_RESOURCES_TWO_FIXED_VERSION_PUTS_ONE_NEON_TRANSACTION' };
      } else {
        const f = await realpath(a['--manifest']);
        must(path.basename(f) === 'manifest.json' && path.dirname(f) === await fixedDirectory(path.dirname(f), 'review'), 'RECOVERY_MANIFEST_PATH');
        const m = await json(f); await io.record('approved-manifest', m);
        result = await recoverLockedV5({ manifest: m, approvedSha256: a['--approved-sha'], source, material, history, io });
        if (result.outcome.includes('PARTIAL')) process.exitCode = 1;
      }
    } else {
      const run = await realpath(await fixedDirectory(a['--run-directory'], 'run'));
      const partial = await io.inspectPartial(); await io.record('partial-metadata', partial);
      const binding = await json(path.join(run, 'installation-binding.json')).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (!binding) result = { mode, outcome: 'RECOVERY_PARTIAL_METADATA_ONLY_NO_RECOVERY_WRITE_AUTHORITY', externalWrites: 0,
        originalPrivateReads: 0, sourceSecretValueReads: 0, retryAllowed: false, runtimeEnabled: false };
      else {
        await assertInstallationV5(binding, binding.installationSha256, await loadNeonContractV5());
        must(canonicalJson([binding.databaseSecret,binding.controlSecret]) === canonicalJson(A.secrets), 'RECOVERY_BINDING_SECRET_REFS');
        const proof = await io.inspectInstalled(binding.neon);
        must(proof.roleId === binding.roleId && proof.tableId === binding.tableId, 'RECOVERY_BINDING_IDS');
        result = { mode, outcome: 'RECOVERY_LOCKED_INSTALL_INDEPENDENT_METADATA_VERIFIED', bindingSha256: binding.installationSha256,
          proof, externalWrites: 0, originalPrivateReads: 0, sourceSecretValueReads: 0,
          cloudOidcOrSecretReadPathProved: false, passwordAuthenticationNotRepeated: true, runtimeEnabled: false, retryAllowed: false };
      }
    }
    await io.record('summary', result); console.log(JSON.stringify({ ...result, output: out }, null, 2)); return result;
  } catch (e) {
    const result = { mode, outcome: 'RECOVERY_STOPPED_INSPECT_ONLY', failure: safeRecoveryFailureV5(e), counts: io.counts(),
      retryAllowed: false, runtimeEnabled: false };
    await writePublicOnceV5(out, 'failure', result); console.log(JSON.stringify(result, null, 2)); process.exitCode = 1; return result;
  } finally { io.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mainRecoveryV5().catch(() => {
  console.error('RECOVERY_ARGUMENT_OR_LOCAL_SETUP_REJECTED_NO_AUTOMATIC_RETRY'); process.exitCode = 1;
});
