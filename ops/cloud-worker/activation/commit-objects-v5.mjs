// Local preparation only: isolated index and unreachable commit objects, no branch/ref/worktree change.
import { spawn } from 'node:child_process';
import { writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderPinnedJobV5, renderPinnedCallerV5, ACTIVATION_V5 as A } from './release-v5.mjs';
const root = 'E:/NodejsProject/TechlongSoftware', base = 'F:/ChatGPT_workshop';
const must = v => { if (!v) throw Error('ACTIVATION_LOCAL_GIT'); };
export function gitLocalV5(args,{ input = '',env = {} } = {}) {
  return new Promise((resolve,reject) => {
    const child = spawn('git',args,{ cwd: root,windowsHide: true,env: { ...process.env,...env },stdio: ['pipe','pipe','pipe'] });
    child.stdout.setEncoding('utf8');
    let out = '',bad = false; const timer = setTimeout(() => { bad = true; child.kill(); },30000);
    child.stdout.on('data',b => { out += b; if (out.length > 3000000) { bad = true; child.kill(); } });
    child.stderr.on('data',() => {}); child.on('error',() => { clearTimeout(timer); reject(Error('ACTIVATION_GIT_UNAVAILABLE')); });
    child.on('close',code => { clearTimeout(timer); if (code !== 0 || bad) reject(Error('ACTIVATION_GIT_STOPPED_NO_RETRY')); else resolve(out); });
    child.stdin.on('error',() => {}); child.stdin.end(input);
  });
}
const hash = v => createHash('sha256').update(v).digest('hex');
export async function prepareReleaseObjectsV5({ sourceCommit,runtimeCommit,output,now = Date.now() }) {
  const out = path.resolve(output);
  must(path.dirname(out).toLowerCase() === path.resolve(base).toLowerCase() && /^techlong-w5f-release-[a-z0-9-]+$/.test(path.basename(out)) &&
    /^[a-f0-9]{40}$/.test(sourceCommit) && /^[a-f0-9]{40}$/.test(runtimeCommit));
  must((await gitLocalV5(['rev-parse','HEAD'])).trim() === sourceCommit && (await gitLocalV5(['branch','--show-current'])).trim() === 'main' &&
    (await gitLocalV5(['status','--porcelain'])).trim() === '');
  for (const file of [A.caller,A.reusable]) {
    try { await access(path.join(root,file)); must(false); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    must((await gitLocalV5(['ls-files','--',file])).trim() === '');
  }
  const index = path.join(out,'release.index'), env = { GIT_INDEX_FILE: index,GIT_AUTHOR_DATE: new Date(now).toISOString(),GIT_COMMITTER_DATE: new Date(now).toISOString() };
  try { await access(index); must(false); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await gitLocalV5(['read-tree',sourceCommit],{ env });
  const make = async (file,contents,parent,message) => {
    const blob = (await gitLocalV5(['hash-object','-w','--stdin'],{ input: contents })).trim(); must(/^[a-f0-9]{40}$/.test(blob));
    await gitLocalV5(['update-index','--add','--cacheinfo','100644,' + blob + ',' + file],{ env });
    const tree = (await gitLocalV5(['write-tree'],{ env })).trim();
    const commit = (await gitLocalV5(['commit-tree',tree,'-p',parent],{ env,input: message + '\n' })).trim();
    must(/^[a-f0-9]{40}$/.test(commit) && (await gitLocalV5(['show',commit + ':' + file])).replaceAll('\r\n','\n') === contents);
    return { commit,tree,parent,file,normalizedLfSha256: hash(contents) };
  };
  const reusable = await make(A.reusable,renderPinnedJobV5(runtimeCommit),sourceCommit,'feat(deployment): publish reviewed frozen-source reusable worker');
  const caller = await make(A.caller,renderPinnedCallerV5(reusable.commit),reusable.commit,'feat(deployment): publish reviewed pinned worker dispatcher');
  must((await gitLocalV5(['diff','--name-only',sourceCommit,caller.commit])).trim().split(/\r?\n/).sort().join(',') === [A.caller,A.reusable].sort().join(','));
  must((await gitLocalV5(['rev-parse','HEAD'])).trim() === sourceCommit && (await gitLocalV5(['status','--porcelain'])).trim() === '');
  const result = { schema: 'techlong/cloud-worker-reviewed-release-objects/v5',sourceCommit,runtimeCommit,reusable,caller,
    preparedAt: now,pushRefspec: caller.commit + ':refs/heads/main',forcePush: false,branchesCreated: 0,mainMoved: false,
    worktreeFilesChanged: 0,remoteWrites: 0,objectsUnsigned: true };
  await writeFile(path.join(out,'release.json'),JSON.stringify(result,null,2) + '\n',{ flag: 'wx',flush: true }); return result;
}
export async function assertReleaseObjectsV5(r) {
  must(r.schema === 'techlong/cloud-worker-reviewed-release-objects/v5' && r.forcePush === false && r.branchesCreated === 0 &&
    r.reusable.parent === r.sourceCommit && r.caller.parent === r.reusable.commit && r.reusable.file === A.reusable && r.caller.file === A.caller &&
    r.pushRefspec === r.caller.commit + ':refs/heads/main');
  for (const [p,text] of [[r.reusable,renderPinnedJobV5(r.runtimeCommit)],[r.caller,renderPinnedCallerV5(r.reusable.commit)]]) {
    must(hash(text) === p.normalizedLfSha256 && (await gitLocalV5(['show',p.commit + ':' + p.file])).replaceAll('\r\n','\n') === text &&
      (await gitLocalV5(['rev-parse',p.commit + '^'])).trim() === p.parent && (await gitLocalV5(['rev-parse',p.commit + '^{tree}'])).trim() === p.tree);
  }
  must((await gitLocalV5(['diff','--name-only',r.sourceCommit,r.caller.commit])).trim().split(/\r?\n/).sort().join(',') === [A.caller,A.reusable].sort().join(','));
  return r;
}
