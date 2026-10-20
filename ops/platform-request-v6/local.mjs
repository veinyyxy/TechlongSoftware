// W6l operator entry. Prepare has no private reads, SQL or AWS calls.
import {readFile,writeFile,mkdir,realpath,access} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {git} from '../platform-identity-review-v6/publication.mjs';
import {L} from '../platform-local-v6/plan.mjs';
import {authMetadataV6,readAuthV6,serveEnvironmentV6,portFreeV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {assertConfigDirectoryV6} from '../platform-local-v6/child.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {Q,must,same,makeRequestReviewV6,verifyRequestReviewV6,startRequestOnceV6} from './plan.mjs';
import {readRequestStateV6,assertRequestBaselineV6,verifyRequestReadbackV6} from './state.mjs';
export const FILES=['ops/platform-request-v6/plan.mjs','ops/platform-request-v6/local.mjs','ops/platform-request-v6/state.mjs',
  'lib/deployments/reviewed-request-window-v6.ts','lib/deployments/initialized-platform-management.ts','lib/deployments/initialized-platform-http.ts',
  'lib/deployments/initialized-platform-request-v1.ts','lib/deployments/execution/express-initialized-job-neon-v2.ts',
  'components/admin/InitializedDeploymentPanel.tsx','app/api/admin/instances/[instanceId]/initialized-deployment/route.ts',
  'ops/platform-local-v6/local.mjs','ops/platform-local-v6/plan.mjs','ops/platform-local-v6/child.mjs','ops/platform-local-v6/worker.json',
  'ops/platform-local-v6/metadata.ps1','lib/deployments/controller-v6/configuration.ts','lib/deployments/controller-v6/installed-binding.ts',
  'ops/aws-sandbox/reviews/platform-local-v6.executed.json','tests/platform-request-v6.test.mjs','tests/platform-local-v6.test.mjs',
  'scripts/ci/verify-platform-local-v6.mjs','scripts/ci/verify-platform-request-readback-v6.mjs','.github/workflows/platform-cloud-candidate.yml','package.json','package-lock.json',Q.riskFile];
const hash=v=>createHash('sha256').update(v).digest('hex'),json=async f=>JSON.parse(await readFile(f,'utf8'));
async function write(f,v){assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});}
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(L.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function source(expected){const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
  (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected),'SOURCE');return head;}
async function metadata(){
  must(hash(await readFile(Q.previousSlot))===Q.previousSlotSha256&&hash(await readFile(Q.previousInspect))===Q.previousInspectSha256,'OLD_RECEIPTS');
  const old=await json(L.root+'/ops/aws-sandbox/reviews/platform-local-v6.executed.json');
  must(old.state==='LOCAL_LOGIN_REPORTED_RUNTIME_STOPPED_AND_PORT_INDEPENDENTLY_VERIFIED'&&old.runtimeCurrentlyRunningForThisWindow===false,'PREVIOUS_STATE');
  await assertConfigDirectoryV6(L.root);return {auth:await authMetadataV6(),portFree:await portFreeV6(),previousRuntimeStopped:true};
}
async function directory(value,existing=false){const p=path.resolve(value);must(path.dirname(p).toLowerCase()===path.resolve(L.base).toLowerCase()&&
  /^techlong-w6l-held-request-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(L.base)).toLowerCase()===path.resolve(L.base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'DIRECTORY_LINK');return p;}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=['--mode','--output',...(mode==='Prepare'?['--ci-run']:['--manifest','--approved-sha'])];
  must(['Prepare','Start','Inspect'].includes(mode)&&Object.keys(a).length===fields.length&&fields.every(k=>a[k]),'MODE');
  must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(L.root).toLowerCase()&&
    !['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','CLOUDFLARE_ENV'].some(k=>process.env[k])&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&
    !Object.keys(process.env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const output=await directory(a['--output']);let m;
  if(mode!=='Prepare'){const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST_PATH');
    m=await json(f);await verifyRequestReviewV6(m,a['--approved-sha'],Date.now(),mode==='Inspect');must(a['--approved-sha']===m.manifestSha256,'EXACT_APPROVAL');}
  await absent(mode==='Inspect'?Q.inspectSlot:Q.slot);await mkdir(output);
  if(mode==='Prepare'){
    const sourceCommit=await source(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit),meta=await metadata();
    m=await makeRequestReviewV6({sourceCommit,clientRequestId:randomUUID(),pins:await pins(),ci,metadata:meta,createdAt:Date.now()});await source(sourceCommit);
    await write(output+'/manifest.json',m);const r={outcome:'NEW_REQUEST_REVIEW_PREPARED_NOT_STARTED',manifestSha256:m.manifestSha256,target:m.target,
      expiresAtUtc:new Date(m.expiresAt).toISOString(),expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
      authFileReads:0,sqlConnections:0,awsCalls:0,serverStarts:0,newJobs:0,slotConsumed:false};await write(output+'/result.json',r);console.log(JSON.stringify(r,null,2));return r;
  }
  const assertSource=async()=>{await source(m.sourceCommit);must(same(await pins(),m.pins),'PINS');await assertConfigDirectoryV6(L.root);};
  if(mode==='Inspect'){
    const slot=await json(Q.slot);must(slot.manifestSha256===m.manifestSha256&&same(slot.target,m.target),'START_SLOT');await assertSource();
    must(await portFreeV6(),'PORT_STILL_OPEN');must(same(await authMetadataV6(),m.metadata.auth),'AUTH_METADATA_CHANGED');
    const before=await json(path.dirname(a['--manifest'])+'-run/baseline.json'),window=await json(path.dirname(a['--manifest'])+'-run/window.json');
    assertRequestBaselineV6(before);must(window.request.requestId===m.target.requestId&&window.request.jobId===m.target.jobId,'WINDOW');
    await write(Q.inspectSlot,{manifestSha256:m.manifestSha256,claimedAt:Date.now(),privateReadMax:1,retryAllowed:false});
    try{const authUrl=await readAuthV6(m.metadata.auth);
      const after=await readRequestStateV6(authUrl,m.target);await write(output+'/state.json',after);
      const r=await verifyRequestReadbackV6(before,after,m.target,window);await write(output+'/result.json',r);console.log(JSON.stringify(r,null,2));return r;
    }catch{const r={outcome:'REQUEST_READBACK_UNCONFIRMED_NO_RETRY',retryAllowed:false};await write(output+'/result.json',r);process.exitCode=1;console.log(JSON.stringify(r));return r;}
  }
  await readLocalCiV6(m.ci.runId,m.sourceCommit);await write(output+'/approved-manifest.json',m);
  const r=await startRequestOnceV6({manifest:m,approved:a['--approved-sha'],io:{assertSource,metadata,readAuth:readAuthV6,
    claim:v=>write(Q.slot,v),readState:readRequestStateV6,validateBaseline:assertRequestBaselineV6,record:(n,v)=>write(output+'/'+n+'.json',v),serve:serveEnvironmentV6}});
  if(r.outcome.includes('UNKNOWN'))process.exitCode=1;console.log(JSON.stringify({...r,output},null,2));return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({outcome:'HELD_REQUEST_ENTRY_STOPPED_NO_RETRY',
  failure:/^(?:HELD_REQUEST|LOCAL_RUNTIME)_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD',retryAllowed:false}));process.exitCode=1;});
