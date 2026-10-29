// SOURCE-selected explicit entry. The default is closed before any private I/O.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ROOT,environment,git,pins,readText,writeOnce,noLinks,absent} from '../platform-image-source-v2/files.mjs';
import {readCi} from '../platform-recovery-hosting-v1/ci.mjs';
import {compatibility} from '../platform-recovery-hosting-v1/compatibility.mjs';
import {authMetadataV6} from '../platform-local-v6/local.mjs';
import {keyMetadata} from '../platform-operator-v6/files.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertPreparationReadiness} from '../platform-a604-operator-v1/local.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {SELECTED_CYCLE} from './operator-source.mjs';
import {createCycleComposition} from './composition.mjs';
import {bindWorkflowSource,must,same,RISK} from './cycle.mjs';
import {createWholeCycleFlow} from './whole.mjs';
import {createWholeCycleIo} from './io.mjs';
import {bindBuyerWorkflowSource,prepareBuyerFromSource} from './buyer-compatibility.mjs';
const BASE='F:/ChatGPT_workshop',ROOTS=['ops/platform-reviewed-cycle-v1/local.mjs','ops/platform-reviewed-cycle-v1/live.mjs',
  'ops/platform-reviewed-cycle-v1/closure.mjs','ops/platform-operator-v6/key-metadata.ps1',RISK,'tests/platform-reviewed-cycle-v1.test.mjs',
  'ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs','tests/buyer-publication-cycle-v1.test.mjs',
  '.github/workflows/platform-recovery-hosting-candidate.yml','package.json','package-lock.json'];
const evidence=f=>{must(/^F:\/ChatGPT_workshop\/techlong-[A-Za-z0-9/_.-]+\.json$/.test(f??'')&&!f.includes('..'),'EVIDENCE_PATH');return f;};
const json=async f=>JSON.parse(await readText(evidence(f),5000000));
export function parseArgs(args){
  if(same(args,['--check']))return {mode:'Check'};const a={};must(args.length%2===0,'ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'ARGS');a[args[i]]=args[i+1];}
  const fields={PrepareSaved:['--mode','--ci-run','--environment-file','--ledger-file','--output'],RunReviewed:['--mode','--manifest','--approved-sha']}[a['--mode']];
  must(fields&&same(Object.keys(a).sort(),fields.sort()),'MODE');
  if(a['--output'])must(/^F:\/ChatGPT_workshop\/techlong-reviewed-cycle-[a-z0-9-]+$/.test(a['--output']),'OUTPUT');return a;
}
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.mode==='Check'){const r={outcome:SELECTED_CYCLE?'REVIEWED_CYCLE_SOURCE_REQUIRES_APPROVAL':'REVIEWED_CYCLE_SOURCE_NOT_CONFIGURED',
    productionCalls:0,privateContentReads:0,sqlConnections:0,dispatches:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;}
  must(SELECTED_CYCLE,'SOURCE_NOT_CONFIGURED');environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGOPTIONS','PGSERVICE'].some(k=>process.env[k]),'ENVIRONMENT');await noLinks(BASE);
  const head=git(['rev-parse','HEAD']).trim(),clean=()=>must(git(['rev-parse','HEAD']).trim()===head&&git(['branch','--show-current']).trim()==='main'&&
    git(['status','--porcelain']).trim()==='','CLEAN_SOURCE'),collect=()=>pins({roots:ROOTS});clean();await compatibility(head);
  const native=SELECTED_CYCLE.publication.schema==='techlong/buyer-context-publication/v1',
    bind=native?bindBuyerWorkflowSource:bindWorkflowSource,
    source=SELECTED_CYCLE.publication.sourceCommit===null?await bind(SELECTED_CYCLE,head,SELECTED_CYCLE.reusableCommit):SELECTED_CYCLE;
  let buyer,buyerBundle;
  if(native){
    // The path is reviewed SOURCE, not a new CLI/env/manifest override. It is a
    // public evidence bundle, never a config file or private control package.
    const file=evidence(source.buyer?.bundleFile);await noLinks(file);const raw=await readText(file,1000000);
    buyerBundle=JSON.parse(raw);buyer=await prepareBuyerFromSource(source,buyerBundle);
  }
  const c=await createCycleComposition(source,{buyer,buyerBundle}),flow=createWholeCycleFlow(c);must(c.publication.sourceCommit===head,'SOURCE_COMMIT');
  const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeOnce(f,v);};
  for(const f of Object.values(c.slots))await absent(f);
  if(a['--mode']==='PrepareSaved'){
    const ep=await json(a['--environment-file']),ledger=await json(a['--ledger-file']),at=Date.now();
    for(const s of [ep,ledger])assertPreparationReadiness(s,at);
    must(ledger.sourceCommit===head&&ledger.counts?.writes===0&&ledger.counts.configReads===1&&ledger.counts.connections===1&&ledger.counts.queries<=45&&
      await sha256Hex(normalizedState(ledger.snapshot))===c.cycle.requestEvidence.afterSha256&&ledger.plans.every(p=>p.jobId!==c.definition.jobId),'FRESH_BASELINE');
    const grant=await c.policy.grant({sourceCommit:head,pins:await collect(),ci:await readCi(a['--ci-run'],head),environment:ep.environment,
      history:c.capability.history(ledger.plans),auth:await authMetadataV6(),key:await keyMetadata(c.definition.keyPath),issuedAt:at});
    const m=await flow.makeReview({grant,createdAt:at}),out=a['--output'];clean();await absent(out);await mkdir(out);await write(out+'/manifest.json',m);
    console.log(JSON.stringify({outcome:'WHOLE_CYCLE_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,latestStartAt:m.latestStartAt,executionAuthorized:false}));return m;
  }
  const m=await json(a['--manifest']);await flow.verify(m,a['--approved-sha'],Date.now(),true);
  must(m.sourceCommit===head&&same(m.grant.pins,await collect()),'SOURCE_PINS');
  const out=BASE+'/techlong-reviewed-cycle-run-'+m.manifestSha256;await absent(out);await mkdir(out);
  const assertSource=async()=>{clean();must(same(await collect(),m.grant.pins),'SOURCE_PINS');},
    verifyCi=async()=>must(same(await readCi(m.grant.ci.runId,head),m.grant.ci),'EXACT_CI');
  const r=await flow.run({manifest:m,approved:a['--approved-sha'],io:createWholeCycleIo({composition:c,manifest:m,output:out,
    record:(n,v)=>write(out+'/'+n+'.json',v),assertSource,verifyCi})});console.log(JSON.stringify(r));
  if(r.outcome.includes('STOPPED'))process.exitCode=1;return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('REVIEWED_CYCLE_STOPPED_NO_RETRY');process.exitCode=1;});
