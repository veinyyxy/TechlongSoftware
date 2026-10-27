// One round authorization, then up to one delegated dispatch per registered mode.
// No HTTP/browser login, no GitHub environment-approval API, no I/O on import.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,noLinks,absent} from '../platform-image-source-v2/files.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {keyMetadata} from '../platform-operator-v6/files.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {D,digest,must,same,grant,validateGrant,seedPlan,slot,safeCode,historyProof} from './policy.mjs';
import {dispatchOnce} from './operation.mjs';
import {createIo,readEnvironment} from './io.mjs';
import {captureReadiness} from './readiness.mjs';
export const ROOTS=['ops/platform-delegated-approval-v1/local.mjs','ops/platform-operator-v6/key-metadata.ps1',D.riskFile,
  'tests/platform-delegated-approval-v1.test.mjs','.github/workflows/platform-recovery-hosting-candidate.yml','package.json','package-lock.json'];
const BASE='F:/ChatGPT_workshop',json=async f=>JSON.parse(await readText(f,4000000));
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
const clean=expected=>{const head=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||head===expected),'SOURCE');return head;};
const output=v=>{must(/^F:\/ChatGPT_workshop\/techlong-delegated-approval-[a-z0-9-]+$/.test(v??''),'OUTPUT');return v;};
export function parseArgs(args){if(same(args,['--check']))return {'--mode':'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let k=0;k<args.length;k+=2){must(!Object.hasOwn(a,args[k])&&args[k+1]&&!args[k+1].startsWith('--'),'ARGS');a[args[k]]=args[k+1];}
  const mode=a['--mode'],fields=mode==='Snapshot'?['--mode','--output']:mode==='PrepareSaved'?['--mode','--output','--environment-file','--ledger-file','--ci-run']:
    ['--mode','--grant','--approved-sha','--action','--plan-sha'];
  must(['Snapshot','PrepareSaved','DispatchReviewed'].includes(mode)&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  if(mode!=='DispatchReviewed')output(a['--output']);else must(D.modes.includes(a['--action'])&&digest(a['--plan-sha']),'TARGET');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a['--mode']==='Check'){const r={outcome:'DELEGATED_WEB_APPROVAL_AVAILABLE_NOT_AUTHORIZED',webLoginRequired:false,
    githubEnvironmentApproval:'user-required',privateReads:0,awsCalls:0,sqlConnections:0,dispatches:0};console.log(JSON.stringify(r));return r;}
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');await noLinks(BASE);
  const source=clean(),collect=()=>pins({roots:ROOTS});
  if(a['--mode']==='Snapshot'){const out=output(a['--output']);await absent(out);await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v),
    guard=async()=>{clean(source);};
    const ep=await readEnvironment();await record('environment',{checkedAt:Date.now(),environment:ep});
    const state=await captureReadiness({auth:await authMetadataV6(),guard,record});
    const r={outcome:'DELEGATION_READINESS_VERIFIED',githubEnvironmentGets:1,counts:state.counts,awsCalls:0,keyContentReads:0,dispatches:0};
    await record('result',r);console.log(JSON.stringify(r));return r;}
  if(a['--mode']==='PrepareSaved'){
    const out=output(a['--output']),file=a['--environment-file'],lf=a['--ledger-file'];await absent(out);
    must(/^F:\/ChatGPT_workshop\/techlong-delegated-approval-[a-z0-9-]+\/environment\.json$/.test(file??''),'ENVIRONMENT_FILE');
    const saved=await json(file);must(Number.isSafeInteger(saved.checkedAt)&&saved.checkedAt<=Date.now()&&Date.now()-saved.checkedAt<7200000,'ENVIRONMENT_AGE');
    must(/^F:\/ChatGPT_workshop\/techlong-delegated-approval-[a-z0-9-]+\/ledger\.json$/.test(lf??''),'LEDGER_FILE');const ledger=await json(lf);
    must(Number.isSafeInteger(ledger.checkedAt)&&ledger.checkedAt<=Date.now()&&Date.now()-ledger.checkedAt<7200000&&
      ledger.delegatorActiveVerified===true&&ledger.jobHeldVerified===true&&ledger.counts?.configReads===1&&ledger.counts.connections===1&&
      ledger.counts.queries<=25&&ledger.counts.writes===0,'LEDGER_AGE_OR_SCOPE');
    for(const mode of D.modes)await absent(slot(mode));
    const issuedAt=Date.now(),g=await grant({sourceCommit:source,pins:await collect(),ci:await readCi(a['--ci-run'],source),
      seed:await seedPlan(source,issuedAt),environment:saved.environment,history:historyProof(ledger.plans),key:await keyMetadata(D.keyPath),auth:await authMetadataV6(),issuedAt});
    await validateGrant(g,g.grantSha256,Date.now());await compatibility(source);clean(source);await mkdir(out);await write(out+'/grant.json',g);
    const r={outcome:'DELEGATION_PREPARED_NOT_APPROVED',grantSha256:g.grantSha256,expiresAt:g.expiresAt,reviewLatestStartAt:g.reviewLatestStartAt,seedPlanSha256:g.seed.planSha256,
      configurationContentReads:0,keyContentReads:0,sqlConnections:0,awsCalls:0,dispatches:0};await write(out+'/result.json',r);console.log(JSON.stringify(r));return r;
  }
  const file=a['--grant'];must(typeof file==='string'&&path.basename(file)==='grant.json','GRANT_FILE');output(path.dirname(file).replaceAll('\\','/'));
  const g=await validateGrant(await json(file),a['--approved-sha'],Date.now());must(g.sourceCommit===source&&same(await collect(),g.pins),'SOURCE_PINS');await compatibility(source);
  const mode=a['--action'],target=a['--plan-sha'],out=BASE+'/techlong-delegated-approval-run-'+g.grantSha256+'-'+mode.toLowerCase();
  await absent(slot(mode));await absent(out);await mkdir(out);const record=(n,v)=>write(out+'/'+n+'.json',v),start=Date.now();
  const guard=async()=>{await validateGrant(g,a['--approved-sha'],Date.now());must(Date.now()-start<D.runMs,'OPERATION_DEADLINE');
    clean(source);must(same(await collect(),g.pins),'SOURCE_DRIFT');};
  await record('approved-grant',g);
  const io=createIo({grant:g,mode,planSha256:target,record,guard,
    claim:()=>write(slot(mode),{grantSha256:g.grantSha256,sourceCommit:source,mode,planSha256:target,output:out,actor:'delegated_operator',consumedAt:Date.now(),retryAllowed:false}),
    verifyCi:async()=>must(same(await readCi(g.ci.runId,source),g.ci),'CI_DRIFT')});
  const r=await dispatchOnce({grant:g,approved:a['--approved-sha'],mode,planSha256:target,io});console.log(JSON.stringify(r));
  if(r.outcome.includes('STOPPED'))process.exitCode=1;return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'DELEGATED_APPROVAL_ENTRY_STOPPED_NO_RETRY',code:safeCode(e)}));process.exitCode=1;
});
