import { readFile,mkdir,realpath,access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ACTIVATION_V5 as A } from './release-v5.mjs';
import { prepareReleaseObjectsV5,assertReleaseObjectsV5,gitLocalV5 } from './commit-objects-v5.mjs';
import { prepareActivationV5,activateV5 } from './plan-v5.mjs';
import { createActivationIoV5 } from './local-io-v5.mjs';
import { assertLocalEnvironmentV5,sourceBindingV5,writePublicOnceV5 } from '../install/local-io-v5.mjs';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { safeActivationFailureV5,requireActivationV5 as must } from './errors-v5.mjs';
const root = new URL('../../../',import.meta.url),base = 'F:/ChatGPT_workshop',digest = v => createHash('sha256').update(v).digest('hex');
const json = async f => JSON.parse(await readFile(f,'utf8'));
export async function activationSourceV5(runtimeCommit) {
  const s = await sourceBindingV5(), files = new Map(s.files.map(f => [f.file,f]));
  for (const file of [A.riskFile,A.bindingFile,'ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.executed.json',
    'tests/cloud-worker-activation-v5.test.mjs','.github/workflows/cloud-worker-activation-candidate.yml']) {
    files.set(file,{ file,normalizedLfSha256: digest((await readFile(new URL(file,root),'utf8')).replaceAll('\r\n','\n')) });
  }
  const pins = [...files.values()].sort((a,b) => a.file.localeCompare(b.file));
  for (let i = 0; i < pins.length; i += 8) await Promise.all(pins.slice(i,i+8).map(async p => {
    const text = await gitLocalV5(['show',runtimeCommit + ':' + p.file]);
    must(digest(text.replaceAll('\r\n','\n')) === p.normalizedLfSha256,'TESTED_FROZEN_CODE');
  }));
  return { ...s,files: pins,runtimeCommit };
}
export async function activationHistoryV5() {
  const record = await readFile(new URL('ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.executed.json',root));
  must(digest(record) === '32d43d0720abf44f3b225f6c15db5d71536dab0c854b4f3e4649914f55fd8528','HISTORY');
  const r = JSON.parse(record), raw = await readFile(r.independentProof.localProof);
  must(digest(raw) === '2fa63beb16632014339253cc88b31ea697ced6c46644dfad73685bf304507793' &&
    r.state === 'LOCKED_INSTALL_COMPLETE_INDEPENDENTLY_VERIFIED_NOT_ACTIVATED','EXECUTION_PROOF');
  const p = JSON.parse(raw);
  for (const f of p.evidenceFiles) { must(f.path.startsWith(base + '/') && !f.path.includes('private-material'),'PUBLIC_HISTORY');
    must(digest(await readFile(f.path)) === f.rawSha256,'HISTORY_CHANGED'); }
  const m = await json(base + '/techlong-w5e-continuation-review-20261017-a/manifest.json');
  for (const f of m.source.files) must(digest((await readFile(new URL(f.file,root),'utf8')).replaceAll('\r\n','\n')) === f.normalizedLfSha256,'OLD_SOURCE_CHANGED');
  return { executionVerified: true,recordRawSha256: digest(record),proofRawSha256: digest(raw),evidenceFilesVerified: p.evidenceFiles.length,
    oldSourcePinsPreserved: m.source.files.length,installationSha256: p.binding.installationSha256 };
}
async function freshDirectory(input,kind) {
  const p = path.resolve(input);
  must(path.dirname(p).toLowerCase() === path.resolve(base).toLowerCase() && new RegExp('^techlong-w5f-' + kind + '-[a-z0-9-]+$').test(path.basename(p)),'DIRECTORY');
  return p;
}
export async function mainActivationV5(args = process.argv.slice(2)) {
  const a = {}; must(args.length % 2 === 0,'ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) { must(/^--[a-z-]+$/.test(args[i]) && !Object.hasOwn(a,args[i]) && args[i+1],'ARGUMENTS'); a[args[i]] = args[i+1]; }
  const mode = a['--mode'],keys = ['--mode','--output',...(mode === 'PrepareRelease' ? ['--runtime-commit'] :
    mode === 'Review' ? ['--release'] : mode === 'Activate' ? ['--manifest','--approved-sha'] : mode === 'Inspect' ? ['--run-directory'] : [])];
  must(['PrepareRelease','Review','Activate','Inspect'].includes(mode) && Object.keys(a).length === keys.length && keys.every(k => a[k]),'ARGUMENT_SET');
  assertLocalEnvironmentV5(); const out = await freshDirectory(a['--output'],mode === 'PrepareRelease' ? 'release' : mode === 'Activate' ? 'run' : mode.toLowerCase()); await mkdir(out);
  if (mode === 'PrepareRelease') {
    try { await access(A.slot); must(false,'SLOT_USED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const source = await activationSourceV5(a['--runtime-commit']); await activationHistoryV5();
    const release = await prepareReleaseObjectsV5({ sourceCommit: source.commit,runtimeCommit: a['--runtime-commit'],output: out });
    const result = { mode,sourceCommit: source.commit,runtimeCommit: release.runtimeCommit,reusableCommit: release.reusable.commit,callerCommit: release.caller.commit,
      branchesCreated: 0,mainMoved: false,remoteWrites: 0,cloudWrites: 0,privateReads: 0,executionAuthorized: false };
    await writePublicOnceV5(out,'summary',result); console.log(JSON.stringify(result,null,2)); return result;
  }
  const capsule = await json(new URL('../material/public-capsule-v5.json',import.meta.url)),binding = await json(new URL(A.bindingFile,root));
  await assertInstallationV5(binding,A.installationSha256,await loadNeonContractV5()); const io = createActivationIoV5({ output: out,capsule,binding });
  try {
    let result;
    if (mode === 'Inspect') {
      const run = await realpath(await freshDirectory(a['--run-directory'],'run')),m = await json(path.join(run,'approved-manifest.json'));
      const { manifestSha256,...body } = m; must(await sha256Hex(body) === manifestSha256,'INSPECT_MANIFEST');
      const partial = await io.inspectPartial(); await io.record('partial-metadata',partial);
      const success = await json(path.join(run,'result.json')).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (success) {
        must(success.manifestSha256 === manifestSha256 && success.outcome === 'ACTIVATED_REQUIRES_INDEPENDENT_INSPECT_NO_DISPATCH','RUN_RECEIPT');
        const proof = await io.inspectActivated(m,success.publication);
        result = { mode,outcome: 'ACTIVATION_INDEPENDENT_METADATA_VERIFIED_NO_DISPATCH',manifestSha256,proof,
          externalWrites: 0,secretValueReads: 0,originalPrivateReads: 0,workflowDispatched: false,retryAllowed: false };
      } else result = { mode,outcome: 'ACTIVATION_PARTIAL_METADATA_ONLY_NO_RETRY_AUTHORITY',externalWrites: 0,secretValueReads: 0,retryAllowed: false };
    } else {
      try { await access(A.slot); must(false,'SLOT_USED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      let release,m;
      if (mode === 'Review') { const f = await realpath(a['--release']); must(path.basename(f) === 'release.json' &&
        path.dirname(f) === await freshDirectory(path.dirname(f),'release'),'RELEASE_PATH'); release = await json(f); }
      else { const f = await realpath(a['--manifest']); must(path.basename(f) === 'manifest.json' &&
        path.dirname(f) === await freshDirectory(path.dirname(f),'review'),'MANIFEST_PATH'); m = await json(f); release = m.actions.release; await io.record('approved-manifest',m); }
      await assertReleaseObjectsV5(release); const source = await activationSourceV5(release.runtimeCommit),history = await activationHistoryV5();
      if (mode === 'Review') {
        const prestate = await io.preflight(); await io.record('prestate',prestate);
        m = await prepareActivationV5({ source,history,binding,capsule,release,prestate,now: Date.now() }); await io.record('manifest',m);
        result = { mode,manifestSha256: m.manifestSha256,actionsSha256: m.actionsSha256,expiresAt: new Date(m.expiresAt).toISOString(),
          changes: m.effects,externalWrites: 0,secretValueReads: 0,originalPrivateReads: 0,activationSlotConsumed: false,workflowDispatched: false };
      } else {
        result = await activateV5({ manifest: m,approvedSha256: a['--approved-sha'],source,history,binding,capsule,release,io });
        if (result.outcome.includes('PARTIAL')) process.exitCode = 1;
      }
    }
    await io.record('summary',result); console.log(JSON.stringify({ ...result,output: out },null,2)); return result;
  } catch (e) {
    const r = { mode,outcome: 'ACTIVATION_STOPPED_INSPECT_ONLY',checkpoint: io.checkpoint(),failure: safeActivationFailureV5(e),counts: io.counts(),retryAllowed: false };
    await writePublicOnceV5(out,'failure',r); console.log(JSON.stringify(r,null,2)); process.exitCode = 1; return r;
  } finally { io.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) mainActivationV5().catch(() => {
  console.error('ACTIVATION_ARGUMENT_OR_LOCAL_SETUP_STOPPED_NO_AUTOMATIC_RETRY'); process.exitCode = 1;
});
