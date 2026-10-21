// One local, explicitly approved authentication check. No runtime/HTTP entry.
import { readFile, lstat, realpath, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGitHubController } from '../lib/deployments/controller-v6/github.ts';
import { CONTROL_SCOPE as S, PLATFORM_RELEASE, assertExact, must } from '../lib/deployments/controller-v6/contract.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const AUTH_PATHS = Object.freeze({
  root: 'E:/NodejsProject/TechlongSoftware',
  key: 'E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem',
  review: 'ops/aws-sandbox/reviews/platform-controller-auth-v6.prepared.json',
  intent: 'F:/ChatGPT_workshop/techlong-controller-auth-v6.intent.json',
  receipt: 'F:/ChatGPT_workshop/techlong-controller-auth-v6.receipt.json',
});
export const AUTH_SOURCES = Object.freeze([
  'scripts/review-platform-controller-auth-v6.mjs', 'scripts/controller-auth-metadata-v6.ps1',
  'lib/deployments/controller-v6/github.ts', 'lib/deployments/controller-v6/contract.ts',
  'lib/deployments/platform-controller-registration-v1.ts', 'lib/deployments/execution/hash.ts',
  'tests/platform-controller-auth-v6.test.mjs', '.github/workflows/platform-controller.yml',
  'docs/aws-auto-deployment-platform-w6b-app-auth-review.md',
]);
const endpoints = Object.freeze([
  ['GET', '/app'], ['GET', `/app/installations/${S.installationId}`],
  ['POST', `/app/installations/${S.installationId}/access_tokens`],
  ['GET', '/installation/repositories'], ['GET', '/users/techlong-sandbox-controller%5Bbot%5D'],
  ['DELETE', '/installation/token'],
]);
const limits = Object.freeze({ keyReads:1, jwtSignatures:1, tokenIssuePosts:1, metadataGets:4, tokenRevokeDeletes:1,
  dispatches:0, awsCalls:0, sqlConnections:0, secretWrites:0, automaticRetries:0 });
const fold = p => path.resolve(p).replaceAll('\\','/').toLowerCase();
const digest = text => createHash('sha256').update(text).digest('hex');
async function sourcePins() {
  return Promise.all(AUTH_SOURCES.map(async file => ({file, normalizedLfSha256:digest((await readFile(new URL('../'+file,import.meta.url),'utf8')).replace(/\r\n/g,'\n'))})));
}
export function authSubject(preparedAt, keyMetadata, pins) {
  return { schema:'techlong/platform-controller-auth-review/v6', state:'PREPARED_NOT_EXECUTED', preparedAt,
    expiresAt:preparedAt+48*3600000, appId:S.appId, installationId:S.installationId, ownerId:S.ownerId,
    repository:S.repository, repositoryId:S.repositoryId, candidateBotId:S.candidateBotId,
    keyPath:AUTH_PATHS.key, keyMetadata, sourcePins:pins, limits,
    endpoints:endpoints.map(([method,pathname])=>({method,url:'https://api.github.com'+pathname})),
    tokenRequest:{repository_ids:[Number(S.repositoryId)],permissions:{actions:'read',contents:'read',metadata:'read'}},
    intentPath:AUTH_PATHS.intent, receiptPath:AUTH_PATHS.receipt,
    keyContentIntegrityProved:false, runtimeRemainsUnpublished:true, installationTotalRepositoryCountProved:false,
    onFailure:'stop_keep_permanent_local_slot_no_reissue_retry_reset_rotation_or_automatic_compensation' };
}
export async function verifyAuthReview(review, approvedSha, now, keyMetadata, pins) {
  must(typeof approvedSha==='string' && /^[a-f0-9]{64}$/.test(approvedSha) && review?.manifestSha256===approvedSha &&
    await sha256Hex(review.subject)===approvedSha,'CONTROL_AUTH_APPROVAL');
  const at=review.subject.preparedAt;
  must(Number.isSafeInteger(at) && at>0 && at<=now && now<at+48*3600000,'CONTROL_AUTH_EXPIRED');
  assertExact(review.subject,authSubject(at,keyMetadata,pins),'CONTROL_AUTH_DRIFT');
}
async function keyMetadata() {
  must(process.platform==='win32' && fold(ROOT)===fold(AUTH_PATHS.root),'CONTROL_AUTH_LOCATION');
  const key=await lstat(AUTH_PATHS.key);
  must(key.isFile() && !key.isSymbolicLink() && fold(await realpath(AUTH_PATHS.key))===fold(AUTH_PATHS.key),'CONTROL_AUTH_FILE');
  // Fixed local program, fixed metadata-only script; no PEM or command interpolation.
  const text=execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',path.join(ROOT,'scripts/controller-auth-metadata-v6.ps1')],
    {encoding:'utf8',timeout:15000,maxBuffer:16000,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const metadata=JSON.parse(text.trim());
  must(metadata.protectedThreePrincipalAcl===true && metadata.keyContentRead===false && metadata.length===key.size,'CONTROL_AUTH_ACL');
  const filename=path.basename(AUTH_PATHS.key);
  const ignored=execFileSync('git',['check-ignore','--',filename],{cwd:ROOT,encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  const tracked=execFileSync('git',['ls-files','--',filename],{cwd:ROOT,encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  must(ignored===filename && tracked==='','CONTROL_AUTH_TRACKED');
  return metadata;
}
export function authAuditFetch(fetcher, audit) {
  const used=new Set();
  return async (input,init) => {
    const url=new URL(String(input)), method=init?.method??'GET';
    const index=endpoints.findIndex(([m,p])=>m===method && p===url.pathname);
    must(url.origin==='https://api.github.com' && !url.search && !url.hash && !url.username && !url.password && index>=0 &&
      !used.has(index) && init?.redirect==='manual' && init?.cache==='no-store','CONTROL_AUTH_ENDPOINT');
    if(method==='POST') assertExact(JSON.parse(String(init.body)),authSubject(1,{},[]).tokenRequest,'CONTROL_AUTH_TOKEN_SCOPE');
    else must(init?.body===undefined,'CONTROL_AUTH_BODY');
    // The only non-sequential operation allowed is cleanup after a failed GET/parser.
    must(index===5 ? used.has(2) : index===used.size,'CONTROL_AUTH_ORDER');
    used.add(index);
    const event={method,pathname:url.pathname,status:null,responseReceived:false}; audit.push(event);
    const response=await fetcher(input,init); event.status=response.status; event.responseReceived=true;
    return response; // Never retain/print credentials, headers, bodies or raw errors.
  };
}
export async function executeAuthOnce(deps) {
  await deps.assertReady();
  await deps.claim(); // Atomic exclusive local file before ANY key read or token request.
  const audit=[]; let keyReads=0, identity=null, reason=null;
  try {
    const client=createGitHubController({release:PLATFORM_RELEASE,now:deps.now,fetch:authAuditFetch(deps.fetch,audit),
      privateKey:async()=>{must(keyReads===0,'CONTROL_AUTH_KEY_READ_LIMIT');keyReads++;return deps.readPrivateKey();}});
    identity=await client.inspectInstallation();
  } catch(e) {
    reason=typeof e?.message==='string' && /^(CONTROL_[A-Z0-9_]+|REGISTRATION_METADATA_MISMATCH)$/.test(e.message) ? e.message : 'CONTROL_AUTH_STOPPED';
  }
  const revoke=audit.find(e=>e.method==='DELETE'), issue=audit.find(e=>e.method==='POST');
  const receipt={schema:'techlong/platform-controller-auth-receipt/v6',manifestSha256:deps.manifestSha256,finishedAt:deps.now(),
    outcome:identity && revoke?.status===204?'AUTH_METADATA_MATCH_TOKEN_REVOKED':'STOPPED_REQUIRES_INSPECTION_NO_RETRY',
    reason,keyReadAttempts:keyReads, tokenIssueAttempted:!!issue, tokenIssueHttp201:issue?.status===201,
    tokenRevocationAttempted:!!revoke, tokenRevocationHttp204:revoke?.status===204,
    tokenMayRemain:!!issue && revoke?.status!==204, identity, audit,
    workflowDispatches:0,awsCalls:0,sqlConnections:0,runtimeEnabled:false,retryAuthorized:false};
  await deps.saveReceipt(receipt); return receipt;
}
async function exclusiveJson(filename,value) {
  must(fold(await realpath(path.dirname(filename)))===fold('F:/ChatGPT_workshop'),'CONTROL_AUTH_OUTPUT_LOCATION');
  const handle=await open(filename,'wx',0o600);
  try {await handle.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await handle.sync();} finally {await handle.close();}
}
async function assertUnusedPaths() {
  for(const filename of [AUTH_PATHS.intent,AUTH_PATHS.receipt]) {
    try {await lstat(filename);} catch(e) {if(e?.code==='ENOENT')continue;throw e;}
    must(false,'CONTROL_AUTH_SLOT_OCCUPIED');
  }
}
async function readReviewedKey(expected) {
  assertExact(await keyMetadata(),expected,'CONTROL_AUTH_KEY_DRIFT');
  const before=await lstat(AUTH_PATHS.key), handle=await open(AUTH_PATHS.key,'r');
  let bytes;
  try {
    const opened=await handle.stat();
    must(opened.isFile() && opened.size===before.size && opened.ino===before.ino && opened.dev===before.dev &&
      opened.mtimeMs===before.mtimeMs && opened.size<=16000,'CONTROL_AUTH_KEY_DRIFT');
    bytes=Buffer.alloc(opened.size+1); const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
    const after=await handle.stat();
    must(bytesRead===opened.size && after.size===opened.size && after.mtimeMs===opened.mtimeMs,'CONTROL_AUTH_KEY_DRIFT');
    assertExact(await keyMetadata(),expected,'CONTROL_AUTH_KEY_DRIFT');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));
  } finally {bytes?.fill(0);await handle.close();}
}
export async function main(args=process.argv.slice(2)) {
  if(args.length===1 && args[0]==='--prepare') {
    await assertUnusedPaths();
    const subject=authSubject(Date.now(),await keyMetadata(),await sourcePins());
    console.log(JSON.stringify({subject,manifestSha256:await sha256Hex(subject)},null,2));return;
  }
  must((args.length===1 && ['--check','--inspect'].includes(args[0])) ||
    (args.length===2 && args[0]==='--approved-manifest-sha'),'CONTROL_AUTH_ARGUMENTS');
  const review=JSON.parse(await readFile(new URL('../'+AUTH_PATHS.review,import.meta.url),'utf8'));
  if(args[0]==='--inspect') {
    // Independent local readback only; no API/key access, no claim, no cleanup retry.
    const raw=await readFile(AUTH_PATHS.receipt,'utf8'), receipt=JSON.parse(raw);
    const intent=JSON.parse(await readFile(AUTH_PATHS.intent,'utf8'));
    must(receipt.schema==='techlong/platform-controller-auth-receipt/v6' && intent.manifestSha256===review.manifestSha256 &&
      receipt.manifestSha256===intent.manifestSha256 && await sha256Hex(review.subject)===review.manifestSha256,'CONTROL_AUTH_RECEIPT');
    console.log(JSON.stringify({receiptSha256:digest(raw),outcome:receipt.outcome,tokenRevocationHttp204:receipt.tokenRevocationHttp204,
      independentLocalReadbackOnly:true,liveProviderStateIndependentlyProved:false,retryAuthorized:false}));return;
  }
  const approvedSha=args[0]==='--check'?review.manifestSha256:args[1];
  const assertReady=async()=>{await assertUnusedPaths();await verifyAuthReview(review,approvedSha,Date.now(),await keyMetadata(),await sourcePins());};
  if(args[0]==='--check') {await assertReady();console.log(JSON.stringify({state:'PREPARED_VERIFIED_NOT_EXECUTED',manifestSha256:approvedSha,keyContentReads:0,externalCalls:0}));return;}
  const receipt=await executeAuthOnce({assertReady,manifestSha256:approvedSha,now:Date.now,fetch:globalThis.fetch,
    claim:()=>exclusiveJson(AUTH_PATHS.intent,{schema:'techlong/platform-controller-auth-intent/v6',manifestSha256:approvedSha,claimedAt:Date.now(),retryAuthorized:false}),
    readPrivateKey:()=>readReviewedKey(review.subject.keyMetadata),saveReceipt:value=>exclusiveJson(AUTH_PATHS.receipt,value)});
  console.log(JSON.stringify({outcome:receipt.outcome,receiptPath:AUTH_PATHS.receipt,tokenRevocationHttp204:receipt.tokenRevocationHttp204,retryAuthorized:false}));
  if(receipt.outcome!=='AUTH_METADATA_MATCH_TOKEN_REVOKED')process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(()=>{console.error('CONTROL_AUTH_ENTRY_STOPPED: no automatic retry; inspect any existing intent/receipt.');process.exitCode=1;});
