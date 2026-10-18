import { readFile, mkdir, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertLocalEnvironmentV5, materialBindingV5, INSTALL_LOCAL_V5, writePublicOnceV5 } from './local-io-v5.mjs';
import { createContinuationIoV5, continuationSourceBindingV5, continuationHistoryV5, CONTINUATION_SLOT_V5 } from './continuation-local-io-v5.mjs';
import { prepareContinuationV5, continueLockedV5 } from './continuation-v5.mjs';
import { continuationRequireV5 as must, safeContinuationFailureV5 } from './continuation-secrets-v5.mjs';
import { RECOVERY_ANCHOR_V5 as A } from './recovery-v5.mjs';
import { canonicalJson } from '../../../lib/deployments/execution/hash.ts';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
const json = async f => { const raw = await readFile(f,'utf8'); must(Buffer.byteLength(raw) < 2000000,'CONT_BINDING'); return JSON.parse(raw); };
async function directory(input,kind) {
  const p = path.resolve(input), base = await realpath(INSTALL_LOCAL_V5.base);
  must(path.dirname(p).toLowerCase() === base.toLowerCase() && new RegExp('^techlong-w5e-continuation-' + kind + '-[a-z0-9-]+$').test(path.basename(p)),'CONT_BINDING');
  return p;
}
export async function mainContinuationV5(args = process.argv.slice(2)) {
  const a = {}; must(args.length % 2 === 0,'CONT_BINDING');
  for (let i = 0; i < args.length; i += 2) { must(/^--[a-z-]+$/.test(args[i]) && !Object.hasOwn(a,args[i]) && args[i+1],'CONT_BINDING'); a[args[i]] = args[i+1]; }
  const mode = a['--mode'], keys = ['--mode','--output',...(mode === 'ContinueLocked' ? ['--manifest','--approved-sha'] : mode === 'Inspect' ? ['--run-directory'] : [])];
  must(['Review','ContinueLocked','Inspect'].includes(mode) && keys.length === Object.keys(a).length && keys.every(k => a[k]),'CONT_BINDING');
  assertLocalEnvironmentV5(); const out = await directory(a['--output'],mode === 'Review' ? 'review' : mode === 'Inspect' ? 'inspect' : 'run'); await mkdir(out);
  const io = createContinuationIoV5({ output: out,capsule: await json(new URL('../material/public-capsule-v5.json',import.meta.url)) });
  try {
    let result;
    if (mode !== 'Inspect') {
      try { await access(CONTINUATION_SLOT_V5); must(false,'CONT_SLOT'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const source = await continuationSourceBindingV5(), material = await materialBindingV5(), history = await continuationHistoryV5();
      if (mode === 'Review') {
        const prestate = await io.preflight(); await io.record('prestate',prestate);
        const m = await prepareContinuationV5({ prestate,source,material,history,now: Date.now() }); await io.record('manifest',m);
        result = { mode,manifestSha256: m.manifestSha256,actionsSha256: m.actionsSha256,expiresAt: new Date(m.expiresAt).toISOString(),
          externalWrites: 0,originalPrivateReads: 0,sourceSecretValueReads: 0,newSlotConsumed: false,runtimeEnabled: false };
      } else {
        const f = await realpath(a['--manifest']);
        must(path.basename(f) === 'manifest.json' && path.dirname(f) === await directory(path.dirname(f),'review'),'CONT_BINDING');
        const m = await json(f); await io.record('approved-manifest',m);
        result = await continueLockedV5({ manifest: m,approvedSha256: a['--approved-sha'],source,material,history,io });
        if (result.outcome.includes('PARTIAL')) process.exitCode = 1;
      }
    } else {
      const run = await realpath(await directory(a['--run-directory'],'run')), p = await io.inspectPartial(); await io.record('partial-metadata',p);
      const b = await json(path.join(run,'installation-binding.json')).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (!b) result = { mode,outcome: 'CONTINUATION_PARTIAL_METADATA_ONLY_NO_RECOVERY_AUTHORITY',externalWrites: 0,originalPrivateReads: 0,
        sourceSecretValueReads: 0,runtimeEnabled: false,retryAllowed: false };
      else {
        await assertInstallationV5(b,b.installationSha256,await loadNeonContractV5());
        must(canonicalJson([b.databaseSecret,b.controlSecret]) === canonicalJson(A.secrets),'CONT_BINDING');
        const proof = await io.inspectInstalled(b.neon); must(proof.roleId === b.roleId && proof.tableId === b.tableId,'CONT_BINDING');
        result = { mode,outcome: 'CONTINUATION_LOCKED_INSTALL_INDEPENDENT_METADATA_VERIFIED',bindingSha256: b.installationSha256,proof,
          externalWrites: 0,originalPrivateReads: 0,sourceSecretValueReads: 0,passwordAuthenticationNotRepeated: true,
          cloudOidcOrSecretReadPathProved: false,runtimeEnabled: false,retryAllowed: false };
      }
    }
    await io.record('summary',result); console.log(JSON.stringify({ ...result,output: out },null,2)); return result;
  } catch (e) {
    const result = { mode,outcome: 'CONTINUATION_STOPPED_INSPECT_ONLY',checkpoint: io.checkpoint(),failure: safeContinuationFailureV5(e),
      counts: io.counts(),retryAllowed: false,runtimeEnabled: false };
    await writePublicOnceV5(out,'failure',result); console.log(JSON.stringify(result,null,2)); process.exitCode = 1; return result;
  } finally { io.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mainContinuationV5().catch(() => {
  console.error('CONTINUATION_ARGUMENT_OR_LOCAL_SETUP_REJECTED_NO_AUTOMATIC_RETRY'); process.exitCode = 1;
});
