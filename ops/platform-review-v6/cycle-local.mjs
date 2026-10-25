// Explicit Windows single-cycle entry. Prepare/ConfirmPage never open private material.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {environment,git,ROOT,readText,writeOnce,noLinks,absent,pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {authMetadataV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {P} from '../platform-hosted-window-v6/contract.mjs';
import {currentParents,validateSavedAudit} from './current-local.mjs';
import {verifyCurrentHosting} from './current-cloud.mjs';
import {assertTransferredBaseline,createTransferredReviewPublisher,TRANSFERRED_CYCLE} from './transferred-cycle.mjs';
import {createHostedCycleDriver,hostedReadyReceipt} from './hosted-driver.mjs';
import {openCycleDatabase,verifyPublishedReview} from './cycle-database.mjs';
import {openCycleTransport,boundedText} from './cycle-transport.mjs';
import {cycleCloud} from './cycle-window-cloud.mjs';
import {createCycleRun} from './cycle-run.mjs';
import {CYCLE,makeCycleReview,validateCycleReview,verifyCycleWindow,must,same} from './cycle-plan.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {normalizedState} from '../platform-request-v6/transfer.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {operatorFailure} from './operator-failure.mjs';
import {prepareCloudContextV5} from '../cloud-worker/cloud-context-v5.mjs';
import {continueCloudContextV5,assertInstallationV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {loadNeonContractV5} from '../cloud-worker/neon-contract-v5.mjs';
import {admitPlatformJobV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
const BASE='F:/ChatGPT_workshop',proofFile=BASE+'/techlong-w8t-production-preparation-verified-20261024-a.json';
const proofRawSha='97fabc5b950e21e10a6358342b4108e0718c8786b9c62a1c1060ad44781bbfc9';
const prepFile=BASE+'/techlong-w8t-pipeline-preparation-20261024-a/preparation.json',audit=BASE+'/techlong-w8t-current-prepare-20261024-a';
export const CYCLE_ROOTS=['ops/platform-review-v6/cycle-local.mjs','ops/platform-review-v6/cycle-plan.mjs','ops/platform-review-v6/cycle-run.mjs',
  'ops/platform-review-v6/cycle-window-cloud.mjs','ops/platform-review-v6/cycle-database.mjs','ops/platform-review-v6/cycle-transport.mjs',
  'ops/platform-local-v6/metadata.ps1','scripts/controller-auth-metadata-v6.ps1',I.sql,CYCLE.riskFile,
  'tests/platform-cycle-v6.test.mjs','tests/platform-cycle-transport-v6.test.mjs','.github/workflows/platform-cloud-candidate.yml','package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,3000000));
async function record(out,name,value){must(/^[a-z0-9-]+$/.test(name),'RECORD_NAME');assertEvidenceSafeV5(value);await writeOnce(path.join(out,name+'.json'),value);}
async function optional(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function validateDirectory(file,prefix){const p=path.resolve(file);must(path.dirname(p).toLowerCase()===path.resolve(BASE).toLowerCase()&&
  new RegExp('^'+prefix+'[a-z0-9-]+$').test(path.basename(p)),'DIRECTORY');await noLinks(BASE);return p;}
export function parseCycleArgs(args){
  const a=Object.create(null);must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n])&&typeof args[n+1]==='string','ARGS');a[args[n]]=args[n+1];}
  const mode=a['--mode'],fields=mode==='Prepare'?['--mode','--ci-run','--output']:mode==='ConfirmPage'?['--mode','--manifest','--approved-sha','--ready-through-lease']:
    ['--mode','--manifest','--approved-sha','--output'];
  must(['Prepare','RunReviewed','Inspect','ConfirmPage'].includes(mode)&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k])&&
    (mode!=='ConfirmPage'||a['--ready-through-lease']==='yes'),'ARGS');return a;
}
async function checkSource(expected,{full=false,pins,roots=CYCLE_ROOTS}={}){
  const head=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&git(['status','--porcelain']).trim()===''&&(!expected||head===expected),'CLEAN_FROZEN_MAIN');
  if(full&&pins)must(same(await collectPins({roots}),pins),'CODE_PINS');return head;
}
export async function loadCyclePreparation(at=Date.now()){
  const raw=await readText(proofFile,3000000);must(await sha256Hex(raw)===proofRawSha,'PREPARATION_CLOSURE');const proof=JSON.parse(raw);
  for(const a of proof.artifacts)must(await sha256Hex(await readText(a.file,3000000))===a.rawSha256,'PREPARATION_ARTIFACT');
  const preparation=await json(prepFile),parents=await currentParents();
  const {manifestSha256,...body}=preparation;must(await sha256Hex(body)===manifestSha256&&proof.preparationSha256===manifestSha256&&proof.readonlyPermissionFullyConsumed===true,'PREPARATION_DIGEST');
  await validateSavedAudit({cloud:await json(audit+'/cloud-inventory.json'),database:await json(audit+'/database-snapshot.json'),...parents,now:at});
  return {preparation,...parents};
}
function notify(name,v){if(!name.startsWith('awaiting-'))return;
  console.log(JSON.stringify({notice:name,...v,...(Number.isSafeInteger(v.deadline)?{deadlineUtc:new Date(v.deadline).toISOString(),
    deadlineWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(v.deadline)}:{})}));}
const LEGACY_PROTOCOL=Object.freeze({cycle:CYCLE,roots:CYCLE_ROOTS,parseArgs:parseCycleArgs,makeReview:makeCycleReview,validateReview:validateCycleReview,
  loadPreparation:loadCyclePreparation,verifyCurrent:verifyCurrentHosting,outputPrefix:'techlong-w8u-hosted-cycle-',
  publicationSlot:TRANSFERRED_CYCLE.publicationSlot,handoffSlot:TRANSFERRED_CYCLE.handoffSlot,assertOnline:()=>null,assertAvailable:()=>{}});
// A reviewed entry supplies a fixed protocol. Never select one from manifest JSON.
export async function executeCycleMain(args,protocol=LEGACY_PROTOCOL){
  const cfg={...LEGACY_PROTOCOL,...protocol};
  const {cycle:CYCLE,roots:CYCLE_ROOTS,makeReview:makeCycleReview,validateReview:validateCycleReview,loadPreparation:loadCyclePreparation,
    verifyCurrent:verifyCurrentHosting,publicationSlot,handoffSlot}=cfg;
  const source=(expected,options={})=>checkSource(expected,{...options,roots:CYCLE_ROOTS}),directory=file=>validateDirectory(file,cfg.outputPrefix);
  const a=cfg.parseArgs(args),mode=a['--mode'];environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(ROOT).toLowerCase()&&
    !['DATABASE_URL','PGHOST','PGPORT','PGPASSWORD','PGSERVICE','PGOPTIONS'].some(k=>process.env[k]),'ENVIRONMENT');
  if(mode==='Prepare'){
    const out=await directory(a['--output']);await absent(out);for(const f of [CYCLE.slot,CYCLE.inspectSlot,publicationSlot,handoffSlot])await absent(f);
    const sourceCommit=await source(),p=await loadCyclePreparation(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit);
    const m=await makeCycleReview({sourceCommit,pins:await collectPins({roots:CYCLE_ROOTS}),ci,compatibility:await sourceCompatibility(sourceCommit),
      preparation:p.preparation,anchor:p.anchor,auth:await authMetadataV6(),nonce:randomBytes(16).toString('hex'),createdAt:Date.now(),
      riskSha256:await sha256Hex((await readText(path.resolve(ROOT,CYCLE.riskFile),3000000)).replaceAll('\r\n','\n'))});
    await source(sourceCommit);await mkdir(out,{mode:0o700});await record(out,'manifest',m);
    const r={outcome:'HOSTED_CYCLE_PREPARED_REQUIRES_EXACT_NEW_APPROVAL',manifestSha256:m.manifestSha256,sourceCommit,
      expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),privateReads:0,awsCalls:0,sqlConnections:0,executionSlots:0};
    await record(out,'result',r);console.log(JSON.stringify({...r,output:out}));return r;
  }
  const file=path.resolve(a['--manifest']),root=await directory(path.dirname(file));must(path.basename(file)==='manifest.json','MANIFEST_FILE');const m=await json(file);
  await validateCycleReview(m,a['--approved-sha'],Date.now(),{inspect:mode==='Inspect',running:mode==='ConfirmPage'});
  const online=mode==='RunReviewed'?cfg.assertOnline(a,m,Date.now()):null;
  const p=await loadCyclePreparation(m.createdAt);must(same(m.preparation,p.preparation)&&same(m.anchor,p.anchor),'PREPARATION_BINDING');
  await source(m.sourceCommit,{full:true,pins:m.pins});must(same(await sourceCompatibility(m.sourceCommit),m.compatibility),'SOURCE_COMPATIBILITY');
  const run=root+'-run';
  if(mode==='ConfirmPage'){
    must(same(await json(CYCLE.slot),{manifestSha256:m.manifestSha256,output:run,sourceCommit:m.sourceCommit}),'CYCLE_SLOT');
    const v=await json(run+'/window-verified.json'),intent=await json(run+'/window-intent.json');
    must(v.verified.rootEventId&&same(v.controlLease,intent.controlLease)&&intent.manifestSha256===m.manifestSha256&&v.hosting.taskDefinition===v.verified.taskDefinition,'WINDOW_RECEIPT');
    const ready=await hostedReadyReceipt({manifestSha256:m.manifestSha256,scope:{sourceCommit:m.sourceCommit,jobId:CYCLE.jobId},lease:v.controlLease,
      release:m.binding.platform,hosting:v.hosting,checkedAt:Date.now(),humanReadyUntil:v.controlLease.expiresAt});
    await record(run,'page-ready',ready);console.log(JSON.stringify({outcome:'HOSTED_PAGE_READINESS_RECORDED_NOT_EXECUTION_APPROVAL',checkedAt:ready.checkedAt}));return ready;
  }
  const inspect=mode==='Inspect',out=await directory(a['--output']);must(out===root+(inspect?'-inspect':'-run'),'OUTPUT_BINDING');await absent(out);
  await absent(inspect?CYCLE.inspectSlot:CYCLE.slot);if(!inspect)for(const f of [CYCLE.inspectSlot,publicationSlot,handoffSlot])await absent(f);
  await readLocalCiV6(m.ci.runId,m.sourceCommit);
  const deadline=Date.now()+(inspect?10*60000:CYCLE.runMs),signal=AbortSignal.timeout(inspect?10*60000:CYCLE.runMs);let active=inspect,db,cloud,transport,closed=false,outputReady=false,publicPageGets=0;
  const guard=async()=>{signal.throwIfAborted();must(Date.now()<deadline,'RUN_DEADLINE');await validateCycleReview(m,a['--approved-sha'],Date.now(),{inspect,running:active});await source(m.sourceCommit);};
  const assertClaim=async()=>{await guard();must(same(await json(CYCLE.slot),{manifestSha256:m.manifestSha256,output:run,sourceCommit:m.sourceCommit}),'CYCLE_SLOT');await source(m.sourceCommit,{full:true,pins:m.pins});};
  const counts=()=>({cloud:cloud?.counts()??null,database:db?.counts()??null,transport:transport?.counts()??null,publicPageGets});
  const close=async()=>{if(closed)return;closed=true;transport?.close();await db?.close();cloud?.close();};
  try{
    cloud=await cycleCloud({manifest:m,approved:a['--approved-sha'],guard,assertClaim,deadline,signal,inspect,validateReview:validateCycleReview});await cloud.preflight();
    // An expired Source session consumes no config/connection/slot/output. A
    // human may explicitly continue after refresh; this process never retries.
    await mkdir(out,{mode:0o700});outputReady=true;await record(out,'approved-manifest',m);if(online)await record(out,'human-online-before-window',online);
    const contract=sqlContract((await readText(path.resolve(ROOT,I.sql),3000000)).replaceAll('\r\n','\n'));
    if(inspect){
      await assertClaim();const intent=await json(run+'/window-intent.json');await record(out,'inspect-intent',{manifestSha256:m.manifestSha256,readOnly:true});
      await writeOnce(CYCLE.inspectSlot,{manifestSha256:m.manifestSha256,output:out});
      const inventory=await cloud.snapshot();await record(out,'window-inventory',inventory);const verified=verifyCycleWindow(inventory,m,intent);
      db=await openCycleDatabase({auth:m.auth,contract,manifest:m,guard,assertClaim,inspect:true});const snapshot=await db.snapshot();await record(out,'control-snapshot',snapshot);
      const old=normalizedState(snapshot.state),expected=m.anchor.after;
      must(same(old.ledger,expected.ledger)&&same(old.protection,expected.protection)&&
        same(old.jobs.filter(j=>j.id!==CYCLE.jobId),expected.jobs.filter(j=>j.id!==CYCLE.jobId)),'OLD_ROWS_OR_PROTECTION_CHANGED');
      const candidates=[await optional(run+'/publish-proposed-review-plan.json'),await optional(run+'/handoff-proposed-runonce-plan.json')].filter(Boolean);
      for(const row of snapshot.newLedger.plans){const v=await validatePlan(row.body,m.binding.platform,row.body.preparedAt);
        must(v.planSha256===row.plan_sha&&v.actionSha256===row.action_sha&&v.plan.sourceCommit===m.sourceCommit&&v.plan.jobId===CYCLE.jobId&&
          candidates.some(p=>p.planSha256===v.planSha256&&same(p.plan,v.plan)),'UNEXPECTED_CONTROL_PLAN');}
      const admin=expected.jobs.find(j=>j.id===CYCLE.jobId).payload.requestedByUserId;
      must(snapshot.newLedger.approvals.every(a=>a.admin_id===admin&&snapshot.newLedger.plans.some(p=>p.plan_sha===a.plan_sha)),'UNEXPECTED_APPROVAL_ACTOR');
      const r={outcome:'WINDOW_AND_CONTROL_INDEPENDENT_READBACK_RECORDED',verified,newControlCounts:Object.fromEntries(Object.entries(snapshot.newLedger).map(([k,v])=>[k,v.length])),
        jobStatus:old.jobs.find(j=>j.id===CYCLE.jobId)?.status,controlActive:Date.now()<intent.controlLease.expiresAt,counts:counts(),
        requiresReconciliation:snapshot.newLedger.attempts.some(a=>['UNKNOWN','SUBMISSION_STARTED'].includes(a.state)),
        workloadAcceptanceVerified:false,cloudInspectDispatched:false,retryAllowed:false};await record(out,'result',r);console.log(JSON.stringify(r));return r;
    }
    let currentLease,ready,proposed;
    const writeEvent=async(n,v)=>{await record(out,n,v);notify(n,v);};
    const baseline=async()=>{const inventory=await cloud.snapshot();await record(out,'preflight-window-inventory',inventory);
      const b=verifyCurrentHosting(inventory,p.hosting);must(same(b,m.preparation.baseline),'CLOUD_BASELINE_DRIFT');
      db=await openCycleDatabase({auth:m.auth,contract,manifest:m,guard,assertClaim});const snapshot=await db.snapshot();await assertTransferredBaseline(m.anchor,snapshot);await record(out,'preflight-database',snapshot);
      transport=await openCycleTransport({manifest:m,credentials:cloud.credentials,guard,record:(n,v)=>record(out,n,v),signal,
        loadToken:async()=>{const raw=git(['credential','fill'],`protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n`);return raw.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9);}});
      const install=(await transport.readObject(m.anchor.references.installation)).value,links=(await transport.readObject(m.anchor.references.lineage)).value;
      await assertInstallationV5(install,m.binding.platform.installationSha256,await loadNeonContractV5());
      const context=await continueCloudContextV5(await prepareCloudContextV5(await json(path.resolve(ROOT,'ops/cloud-worker/material/public-capsule-v5.json'))),links);
      await admitPlatformJobV4({root:context.root,predecessor:context.predecessor,observed:await db.readHeldJob(CYCLE.jobId),now:Date.now()});
      await guard();return {checkedAt:inventory.checkedAt,lastUpdatedTime:inventory.rawMetadata.stack.Stacks[0].LastUpdatedTime};};
    const freshReady=async()=>{await cloud.credentials();return {sourceCommit:m.sourceCommit,jobId:CYCLE.jobId,checkedAt:Date.now(),humanReadyUntil:ready.humanReadyUntil,
      mainFrozen:true,leaseVerified:true,publisherAdapterReady:true,controllerReady:true,independentInspectorReady:true,replacementIndependentlyVerified:true,
      sourceCredentialsReady:true,environmentApprovalPageReady:true};};
    const assertInstalled=async()=>{await guard();await assertClaim();must(same(await cloud.lease(),currentLease),'INSTALLED_LEASE_CHANGED');};
    const flow=createCycleRun({manifest:m,approved:a['--approved-sha'],cycle:CYCLE,validateReview:validateCycleReview,io:{guard,preflight:baseline,counts,close,record:writeEvent,
      claim:async()=>{cfg.assertAvailable(online,Date.now()+31*60000,Date.now());await source(m.sourceCommit,{full:true,pins:m.pins});await writeOnce(CYCLE.slot,{manifestSha256:m.manifestSha256,output:run,sourceCommit:m.sourceCommit});active=true;},
      update:intent=>{cfg.assertAvailable(online,intent.controlLease.expiresAt,Date.now());return cloud.update(intent);},stack:()=>cloud.stack(),wait:ms=>new Promise(r=>setTimeout(r,ms)),windowSnapshot:()=>cloud.snapshot(),
      async drive({lease,hosting}){
        currentLease=lease;
        const driver=createHostedCycleDriver({scope:{sourceCommit:m.sourceCommit,jobId:CYCLE.jobId},release:m.binding.platform,
          frozenSourceCommit:m.binding.publisher.frozenSourceCommit,manifestSha256:m.manifestSha256,
          loadReady:()=>optional(out+'/page-ready.json'),record:writeEvent,
          preconfirmedReadiness:cfg.preconfirmedReadiness?input=>cfg.preconfirmedReadiness({...input,manifest:m,online}):null,
          probePage:async()=>{await guard();must(publicPageGets++===0,'PAGE_GET_ONCE');const r=await fetch('https://'+P.domain+'/login?returnTo=%2Fadmin',{method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
            must(r.status===200&&(r.headers.get('content-type')??'').includes('text/html'),'PAGE_PROBE');await boundedText(r,250000);},
          publishReview:async input=>{ready=input.ready;
            const publisher=createTransferredReviewPublisher({anchor:m.anchor,sourceCommit:m.sourceCommit,lease,ports:{assertApproved:guard,assertSource:()=>source(m.sourceCommit),
              assertTransferEvidence:async()=>{const x=await loadCyclePreparation(m.createdAt);must(same(x.anchor,m.anchor),'ANCHOR_DRIFT');},readLease:()=>cloud.lease(),
              readiness:freshReady,readBaseline:()=>db.snapshot(),readObject:transport.readObject,readHeldJob:db.readHeldJob,writeOwner:db.publish,
              claim:()=>writeOnce(publicationSlot,{manifestSha256:m.manifestSha256,output:out}),
              record:async(n,v)=>{if(n==='proposed-review-plan')proposed=v;await record(out,'publish-'+n,v);},dispose:async()=>{}}});
            const result=await publisher.once();must(result.outcome==='TRANSFERRED_REVIEW_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT'&&proposed,'PUBLICATION_STOPPED');
            const entry=await db.loadPlan(result.planSha256);must(same(entry.plan,proposed.plan),'PUBLISHED_PLAN_DRIFT');
            await record(out,'publish-independent-readback',await verifyPublishedReview(await db.snapshot(),entry,m));return proposed;
          },live:{loadPlan:async sha=>{const e=await db.loadPlan(sha);must(e.plan.sourceCommit===m.sourceCommit&&e.plan.jobId===CYCLE.jobId,'EXACT_PLAN');
              if(e.attempt?.runId)transport.registerRun(e.attempt.runId,e.plan.mode);return e;},readRun:transport.readRun,discover:transport.discover,
            ports:{assertApproved:assertInstalled,assertSource:()=>source(m.sourceCommit),readiness:freshReady,loadPlan:db.loadPlan,readRun:transport.readRun,
              readObject:transport.readObject,observeRun:db.observe,writeOwner:db.advance,
              claim:()=>writeOnce(handoffSlot,{manifestSha256:m.manifestSha256,output:out}),record:(n,v)=>record(out,'handoff-'+n,v),dispose:async()=>{}}}});
        return driver({lease,hosting,signal});
      }}});
    const result=await flow();console.log(JSON.stringify(result));if(result.outcome!=='HOSTED_CYCLE_RUNONCE_TERMINAL_REQUIRES_INDEPENDENT_INSPECT')process.exitCode=1;return result;
  }catch(e){const stopped={outcome:outputReady?'HOSTED_CYCLE_ENTRY_STOPPED_NO_RETRY':'HOSTED_CYCLE_SOURCE_PRECHECK_STOPPED_NO_OUTPUT',
    counts:e.counts??counts(),outputCreated:outputReady,retryAllowed:false,
    failure:operatorFailure(e,'CYCLE_ENTRY',outputReady?(inspect?'INSPECT_ENTRY':'RUN_ENTRY'):'SOURCE_PRECHECK')};
    if(outputReady)await record(out,'stopped',stopped);else console.error(JSON.stringify(stopped));throw Error('HOSTED_CYCLE_ENTRY_STOPPED_NO_RETRY');}
  finally{await close();}
}
export async function main(args=process.argv.slice(2)){return executeCycleMain(args);}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('HOSTED_CYCLE_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;});
