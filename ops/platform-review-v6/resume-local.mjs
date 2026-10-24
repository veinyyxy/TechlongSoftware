// Explicit operator only. Preparing never reads owner credentials or writes SQL.
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Agent} from 'node:https';
import pg from 'pg';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client} from '@aws-sdk/client-s3';
import {environment,git,pins as collectPins,readText,writeOnce,noLinks,absent} from '../platform-image-source-v2/files.mjs';
import {L} from '../platform-local-v6/plan.mjs';
import {authMetadataV6,readAuthV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,createPublisherDatabaseV6,createPublisherReadsV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {sqlContract} from '../platform-controller-review-v6/install.mjs';
import {createTrustedPublisherV6,ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertFollowupHeld} from './followup.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {hash} from '../platform-hosted-window-v6/contract.mjs';
import {N,J,R,must,same,LEDGER_SQL,makeResumeReview,verifyResume,knownPair,newResumePlan,assertResumeLedger,publishResumeOnce} from './resume.mjs';
export const ROOTS=['ops/platform-review-v6/resume.mjs','ops/platform-review-v6/resume-local.mjs',
  'tests/platform-compatible-window-v6.test.mjs',N.riskFile,'.github/workflows/platform-cloud-candidate.yml',
  'scripts/ci/verify-platform-review-refresh-pg-v6.mjs','package.json','package-lock.json'];
const json=async f=>JSON.parse(await readText(f,3000000));
async function write(f,v){assertEvidenceSafeV5(v);await writeOnce(f,v);}
async function source(expected){const s=git(['rev-parse','HEAD']).trim();must(git(['branch','--show-current']).trim()==='main'&&
  git(['status','--porcelain']).trim()===''&&(!expected||s===expected),'CLEAN_MAIN');await sourceCompatibility(s);return s;}
async function directory(p){p=path.resolve(p);must(path.dirname(p).toLowerCase()===path.resolve(L.base).toLowerCase()&&
  /^techlong-w8n-review-resume-[a-z0-9-]+$/.test(path.basename(p)),'DIRECTORY');await noLinks(L.base);return p;}
export async function resumeParents(){
  const recovery=await json(N.recoveryFile);must(hash(await readText(N.recoveryFile,3000000))===N.recoverySha&&
    recovery.outcome==='HOSTED_RECOVERY_INDEPENDENTLY_VERIFIED_NO_NEW_WINDOW'&&recovery.verified.stackStatus==='UPDATE_ROLLBACK_COMPLETE','RECOVERY_PROOF');
  const parents=[{path:N.recoveryFile,rawSha256:N.recoverySha},...recovery.artifacts,
    {path:N.readOnlyFile,rawSha256:N.readOnlySha},{path:R.oldPlanFile,rawSha256:R.oldPlanFileSha256},
    {path:N.priorFile,rawSha256:N.priorFileSha},{path:J.heldFile,rawSha256:J.heldFileSha256},{path:J.lineageFile,rawSha256:J.lineageFileSha256},
    {path:R.slot,rawSha256:'7e9219ea1f47e18a6575440a1453d32e6900e93e2509c6cc9386a8cb1cc3e73f'},
    {path:R.inspectSlot,rawSha256:'7714be3c156d32bef1f8a7d0175a5280c597b40f8c60de3d4555ddc49dfd9f3a'}];
  for(const p of parents)must(hash(await readText(p.path,3000000))===p.rawSha256,'PARENT_HASH');
  const oldPlans=await knownPair([await json(R.oldPlanFile),await json(N.priorFile)],Date.now());
  return {parents,oldPlans,baseline:await json(J.heldFile),readOnly:await json(N.readOnlyFile),references:{
    installation:JSON.parse(oldPlans[0].plan.inputs.installation),lineage:JSON.parse(oldPlans[0].plan.inputs.lineage)}};
}
async function productionIo(m,out){
  let sts,s3,reads,opened=false,transactions=0,gets=0;const signal=AbortSignal.timeout(N.runMs),record=(n,v)=>write(out+'/'+n+'.json',v);
  const tick=()=>must(++transactions<=m.effects.explicitReadOnlyTransactionsMax,'READ_BUDGET');
  const assertSource=async()=>{await source(m.sourceCommit);must(same(await collectPins({roots:ROOTS}),m.pins)&&same(await authMetadataV6(),m.auth),'SOURCE_OR_AUTH');};
  const readObject=async ref=>{must(++gets<=m.effects.s3VersionGetsMax,'OBJECT_BUDGET');return reads.readObject(ref);};
  const io={record,assertSource,readObject,
    async preflight(){const provider=fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true}),credentials=await provider();
      must(credentials.expiration instanceof Date&&credentials.expiration.getTime()>Date.now()+N.runMs,'SOURCE_SESSION');
      const cfg={region:L.region,credentials:provider,maxAttempts:1,ignoreConfiguredEndpointUrls:true,requestHandler:new NodeHttpHandler({
        httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:10000,socketTimeout:20000})};
      sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});const who=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:signal});
      must(who.Account==='402010193138'&&who.Arn===L.sourceArn&&who.UserId===L.sourceUserId,'SOURCE_IDENTITY');
      s3=new S3Client({...cfg,endpoint:'https://s3.ca-central-1.amazonaws.com'});
      reads=createPublisherReadsV6({s3,signal,githubToken:'NO_GITHUB_CAPABILITY_REVIEW_RESUME',fetch:async()=>{throw Error('NO_GITHUB_CAPABILITY');}});},
    claim:()=>write(N.slot,{manifestSha256:m.manifestSha256,jobId:J.jobId,consumedAt:Date.now(),retryAllowed:false}),readAuth:()=>readAuthV6(m.auth),
    async open(auth){must(!opened,'ONE_CONNECTION');opened=true;const client=new pg.Client(await publisherDatabaseConfigV6(auth));
      const contract=sqlContract((await readFile(L.root+'/ops/platform-controller-v6/install.sql','utf8')).replaceAll('\r\n','\n')),
        db=createPublisherDatabaseV6({client,expected:DATABASE_V6,contract,release:m.binding.platform,maxWrites:1});client.on('error',()=>db.halt());
      try{await client.connect();tick();await db.verify();}catch{try{await client.end();}catch{}throw Error('REVIEW_RESUME_DATABASE_OPEN');}
      return {readHeldJob:async id=>{tick();return db.readHeldJob(id);},writeOwner:db.writeOwner,
        async ledger(){tick();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          try{const r=await client.query(LEDGER_SQL,[J.jobId]);must(r.rows.length===1,'LEDGER_ROW');await client.query('COMMIT');return r.rows[0].value;}
          catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}},dispose:async()=>{db.halt();await client.end();}};},
    async publishReview({db,guard,notBefore}){let submitted=false;
      const publisher=createTrustedPublisherV6({release:m.binding.platform,sourceCommit:m.sourceCommit,frozenSourceCommit:m.binding.publisher.frozenSourceCommit,
        ports:{readObject,readHeldJob:async id=>{must(id===J.jobId,'EXACT_JOB');const v=await db.readHeldJob(id);await assertFollowupHeld(v,m.baseline,Date.now());return v;},
          writeOwner:async q=>{must(!submitted,'ONE_SQL_SUBMISSION');const v=await newResumePlan(JSON.parse(q.values[3]),m,notBefore,Date.now());
            must(same(q,ownerQueryV6('plan',v)),'EXACT_SQL');await record('proposed-plan',v);await guard();
            await assertResumeLedger(await db.ledger(),m,Date.now());await guard();submitted=true;await db.writeOwner(q);}}});
      return publisher.publishReview({jobId:J.jobId,installationReference:m.references.installation,lineageReference:m.references.lineage});},
    dispose:async()=>{reads?.dispose();s3?.destroy();sts?.destroy();},
  };return io;
}
export async function main(args=process.argv.slice(2)){
  environment();must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(L.root).toLowerCase(),'PLATFORM');
  const a={};must(args.length%2===0,'ARGS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(a,args[n]),'ARGS');a[args[n]]=args[n+1];}
  const mode=a['--mode'],fields=mode==='Prepare'?['--mode','--output','--ci-run']:['--mode','--output','--manifest','--approved-sha'];
  must(['Prepare','Publish','Inspect'].includes(mode)&&same(Object.keys(a).sort(),fields.sort())&&fields.every(k=>a[k]),'MODE');
  const out=await directory(a['--output']);await absent(out);await absent(mode==='Inspect'?N.inspectSlot:N.slot);const p=await resumeParents();let m;
  if(mode==='Prepare'){
    const sourceCommit=await source(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit);
    m=await makeResumeReview({...p,sourceCommit,ci,pins:await collectPins({roots:ROOTS}),auth:await authMetadataV6(),
      compatibility:await sourceCompatibility(sourceCommit),createdAt:Date.now()});await source(sourceCommit);await absent(N.inspectSlot);
    await mkdir(out);await write(out+'/manifest.json',m);const r={outcome:'REVIEW_RESUME_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,
      sourceCommit,expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
      authContentReads:0,sqlConnections:0,awsCalls:0,slotsConsumed:0,planPublications:0};await write(out+'/result.json',r);console.log(JSON.stringify(r,null,2));return r;
  }
  const file=path.resolve(a['--manifest']);await directory(path.dirname(file));must(path.basename(file)==='manifest.json'&&
    out===path.dirname(file)+(mode==='Inspect'?'-inspect':'-run'),'MANIFEST_OUTPUT');
  m=await verifyResume(await json(file),a['--approved-sha'],Date.now(),mode==='Inspect');
  for(const key of ['parents','oldPlans','baseline','readOnly','references'])must(same(p[key],m[key]),'PARENTS');
  await source(m.sourceCommit);must(same(await collectPins({roots:ROOTS}),m.pins)&&same(await sourceCompatibility(m.sourceCommit),m.compatibility),'SOURCE_PINS');
  await mkdir(out);const io=await productionIo(m,out);
  try{
    if(mode==='Publish'){await absent(N.inspectSlot);await readLocalCiV6(m.ci.runId,m.sourceCommit);await io.record('approved-manifest',m);
      const r=await publishResumeOnce({manifest:m,approved:a['--approved-sha'],io});console.log(JSON.stringify(r,null,2));if(r.outcome.includes('UNKNOWN'))process.exitCode=1;return r;}
    const slot=await json(N.slot),next=await json(path.dirname(file)+'-run/proposed-plan.json');
    must(slot.manifestSha256===m.manifestSha256&&slot.jobId===J.jobId&&same(next,await newResumePlan(next.plan,m,m.createdAt,Date.now())),'RUN_BINDING');
    await io.preflight();await write(N.inspectSlot,{manifestSha256:m.manifestSha256,planSha256:next.planSha256,consumedAt:Date.now(),retryAllowed:false});let db;
    try{db=await io.open(await io.readAuth());const ledger=await assertResumeLedger(await db.ledger(),m,Date.now(),next);
      await assertFollowupHeld(await db.readHeldJob(J.jobId),m.baseline,Date.now());
      must(same((await io.readObject(m.references.lineage)).value,(await json(J.lineageFile)).links),'LINEAGE');
      const r={outcome:'REVIEW_RESUME_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED',jobId:J.jobId,runtimeSourceCommit:m.sourceCommit,
        planSha256:next.planSha256,actionSha256:next.actionSha256,riskSha256:next.plan.riskSha256,planExpiresAt:next.plan.expiresAt,checkedAt:Date.now(),
        preservedPlanHashes:m.oldPlans.map(v=>v.planSha256).sort(),oldPlansUnchangedAndExpired:true,
        planHashes:ledger.entries.map(v=>v.planSha256).sort(),controlCounts:ledger.counts,heldJobUnchanged:true,executionApproved:false,retryAllowed:false};
      await io.record('result',r);console.log(JSON.stringify(r,null,2));return r;
    }catch{const r={outcome:'REVIEW_RESUME_INSPECT_UNCONFIRMED_NO_RETRY',retryAllowed:false};await io.record('result',r);console.log(JSON.stringify(r));process.exitCode=1;return r;}
    finally{await db?.dispose();}
  }catch(e){await io.record('entry-stop',{outcome:'REVIEW_RESUME_ENTRY_STOPPED_NO_RETRY',errorType:e.name,retryAllowed:false});throw e;}
  finally{await io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'REVIEW_RESUME_ENTRY_STOPPED_NO_RETRY',code:/^REVIEW_RESUME_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
    errorType:/^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'Unknown',retryAllowed:false}));process.exitCode=1;
});
