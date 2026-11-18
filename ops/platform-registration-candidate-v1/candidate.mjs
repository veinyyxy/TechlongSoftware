// No AWS, registry authentication, business connection, or upload paths here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCandidateScan } from '../platform-hosting-v1/security-scan.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const REVIEW = '06d91b3eb875568af5d3f9b9a9015d9a949571dc0ec8427b0ad2e764bbd8c720';
const ARCHIVE_FILE = 'image.tar.gz';
const SHA = /^[a-f0-9]{64}$/;
const OID = /^[a-f0-9]{40}$/;
const CONFIG = /^sha256:[a-f0-9]{64}$/;
const fixedFiles = ['lib/auth/credentials.ts', 'lib/auth/sandbox-registration.ts'];
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ?
  Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const hash = b => createHash('sha256').update(b).digest('hex');
const recipe = JSON.parse(await readFile(path.join(root,'docs/evidence/sandbox-registration-platform-update.prepared.json'),'utf8')).candidate.sourceRecipe;
assert.equal(hash(JSON.stringify(canon(recipe))), REVIEW, 'reviewed source recipe');
assert.deepEqual(recipe.overlay.map(x=>x.path), fixedFiles);

const git = (args, env=process.env) => execFileSync('git', ['-C',root,...args], {
  env, maxBuffer: 4*1024*1024, stdio:['ignore','pipe','ignore'],
});
async function buildArchive(dir) {
  assert.ok(OID.test(recipe.base) && OID.test(recipe.fix));
  const objects=path.join(dir,'objects');
  await mkdir(dir);
  await mkdir(objects);
  // Alternate objects are read-only; all new trees and the temporary index stay outside checkout.
  const env={...process.env,GIT_INDEX_FILE:path.join(dir,'index'),GIT_OBJECT_DIRECTORY:objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES:git(['rev-parse','--path-format=absolute','--git-path','objects']).toString().trim()};
  git(['merge-base','--is-ancestor',recipe.base,recipe.fix]);
  git(['read-tree',recipe.base],env);
  for(const f of recipe.overlay) {
    const entry=git(['ls-tree',recipe.fix,'--',f.path]).toString().trim();
    const parts=/^100644 blob ([a-f0-9]{40})\t([^\n]+)$/.exec(entry);
    assert.ok(parts?.[2]===f.path && SHA.test(f.sha256));
    assert.equal(hash(git(['cat-file','blob',parts[1]])),f.sha256);
    git(['update-index','--add','--cacheinfo',`100644,${parts[1]},${f.path}`],env);
  }
  const tree=git(['write-tree'],env).toString().trim();
  assert.ok(OID.test(tree));
  const changed=git(['diff-tree','--no-commit-id','--name-status','-r',recipe.base,tree],env).toString().trim().split('\n');
  assert.deepEqual(changed,[`M\t${fixedFiles[0]}`,`A\t${fixedFiles[1]}`]);
  git(['archive','--format=tar',`--output=${path.join(dir,'source.tar')}`,tree],env);
  const proof={sourceRecipe:recipe,sourceRecipeSha256:REVIEW,sourceTreeOid:tree};
  await writeFile(path.join(dir,'source-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  return proof;
}

async function readJson(file,max) {
  const s=await lstat(file);
  assert.ok(s.isFile() && s.size>0 && s.size<=max);
  return JSON.parse(await readFile(file,'utf8'));
}
async function hashArchive(file) {
  const s=await lstat(file), digest=createHash('sha256');
  assert.ok(s.isFile() && s.size>0 && s.size<1610612736);
  let bytes=0;
  for await(const chunk of createReadStream(file)) { bytes+=chunk.length; assert.ok(bytes<1610612736); digest.update(chunk); }
  assert.equal(bytes,s.size);
  return {archiveFile:ARCHIVE_FILE,archiveBytes:bytes,archiveSha256:digest.digest('hex')};
}
function inspectConfig(rows) {
  assert.equal(rows.length,1);
  const i=rows[0], env=i.Config?.Env??[], names=env.map(x=>x.split('=')[0]);
  assert.ok(CONFIG.test(i.Id) && i.Os==='linux' && i.Architecture==='amd64' && i.Config?.User==='node' && i.Config.WorkingDir==='/app');
  assert.deepEqual(i.Config.Cmd,['node','ops/platform-hosting-v1/start.mjs']);
  assert.deepEqual(i.Config.Entrypoint,['docker-entrypoint.sh']);
  assert.ok(!i.Config.Volumes && !i.Config.OnBuild?.length && new Set(names).size===names.length &&
    names.every(n=>['PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','PORT'].includes(n)) &&
    ['NODE_VERSION=24.18.0','NODE_ENV=production','PORT=3000'].every(k=>env.includes(k)));
  return i.Id;
}
async function seal(dir,cache) {
  const e=process.env;
  assert.ok(e.GITHUB_ACTIONS==='true' && e.GITHUB_EVENT_NAME==='workflow_dispatch' && e.GITHUB_REF==='refs/heads/main' &&
    e.GITHUB_REPOSITORY==='veinyyxy/TechlongSoftware' && e.GITHUB_REPOSITORY_ID==='1323312747' && e.GITHUB_RUN_ATTEMPT==='1' &&
    OID.test(e.GITHUB_SHA) && e.GITHUB_SHA===e.REVIEWED_ORCHESTRATION_SHA && /^[1-9][0-9]{5,19}$/.test(e.GITHUB_RUN_ID));
  assert.ok(!Object.keys(e).some(k=>/^(AWS_|ACTIONS_ID_TOKEN_REQUEST_|DATABASE_URL$)/.test(k)&&e[k]));
  const proof=await readJson(path.join(dir,'source-proof.json'),8192);
  assert.deepEqual(proof.sourceRecipe,recipe); assert.equal(proof.sourceRecipeSha256,REVIEW); assert.ok(OID.test(proof.sourceTreeOid));
  const imageConfigDigest=inspectConfig(await readJson(path.join(dir,'image-inspect.json'),262144));
  const scan=checkCandidateScan(await readJson(path.join(dir,'os-scan.json'),40*1024*1024),
    await readJson(path.join(cache,'db/metadata.json'),8192),imageConfigDigest);
  const scanText=JSON.stringify({...scan,recordedAtUtc:new Date().toISOString()},null,2)+'\n';
  await writeFile(path.join(dir,'os-scan-summary.json'),scanText,{flag:'wx'});
  assert.equal(scan.outcome,'OS_HIGH_CRITICAL_ZERO');
  const receipt={schema:'techlong/sandbox-registration-overlay-image/v1',...proof,
    orchestrationCommit:e.GITHUB_SHA,runId:e.GITHUB_RUN_ID,runAttempt:1,imageConfigDigest,os:'linux',architecture:'amd64',
    ...await hashArchive(path.join(dir,ARCHIVE_FILE)),scanSummarySha256:hash(scanText),
    smoke:{networkDisabled:true,closedControl:true,healthAndLogin:true,registrationPageGetOnly:true},
    awsIdentity:false,registryManifestVerified:false};
  const text=JSON.stringify(receipt,null,2)+'\n';
  await writeFile(path.join(dir,'image-receipt.json'),text,{flag:'wx'});
  await writeFile(path.join(dir,'SHA256SUMS'),`${receipt.archiveSha256}  ${ARCHIVE_FILE}\n${hash(text)}  image-receipt.json\n${receipt.scanSummarySha256}  os-scan-summary.json\n`,{flag:'wx'});
  return receipt;
}

const [mode,dir,cache,...extra]=process.argv.slice(2);
try {
  assert.ok(dir && path.isAbsolute(dir) && extra.length===0);
  const result=mode==='source' && !cache ? await buildArchive(dir) : mode==='seal' && cache && path.isAbsolute(cache) ? await seal(dir,cache) : null;
  assert.ok(result);
  console.log(JSON.stringify(result));
} catch {
  console.error('SANDBOX_REGISTRATION_CANDIDATE_REFUSED');
  process.exitCode=1;
}
