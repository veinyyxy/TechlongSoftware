// Explicit operator entry. Prepare uses public files and GitHub CI metadata only.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Agent} from 'node:https';
import pg from 'pg';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client} from '@aws-sdk/client-s3';
import {git} from '../platform-identity-review-v6/publication.mjs';
import {L} from '../platform-local-v6/plan.mjs';
import {authMetadataV6,readAuthV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,createPublisherDatabaseV6,createPublisherReadsV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {sqlContract} from '../platform-controller-review-v6/install.mjs';
import {createTrustedPublisherV6,ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {J,assertFollowupHeld} from './followup.mjs';
import {sourceCompatibility} from '../platform-hosted-window-v6/compatibility.mjs';
import {R,must,same,LEDGER_SQL,makeRefreshReview,verifyRefreshReview,refreshedPlan,assertRefreshLedger,publishRefreshOnce} from './refresh.mjs';
export const FILES=['ops/platform-review-v6/refresh.mjs','ops/platform-review-v6/refresh-local.mjs','ops/platform-review-v6/followup.mjs',
  'ops/platform-publisher-v6/io.mjs','ops/platform-cloud-v6/publisher.mjs','ops/platform-cloud-v6/contract.mjs','ops/platform-controller-v6/install.sql',
  'ops/platform-controller-review-v6/catalog.mjs','ops/platform-controller-review-v6/install.mjs','ops/platform-local-v6/local.mjs',
  'ops/platform-local-v6/metadata.ps1','ops/platform-hosted-window-v6/compatibility.mjs','ops/platform-hosted-window-v6/contract.mjs',
  'ops/platform-hosted-window-v6/local.mjs','lib/deployments/controller-v6/installed-binding.ts','lib/deployments/controller-v6/contract.ts',
  'lib/deployments/controller-v6/github.ts','ops/cloud-worker/cloud-worker-root-v5.mjs','ops/cloud-worker/cloud-context-v5.mjs',
  'ops/cloud-worker/material/public-capsule-v5.json','tests/platform-review-refresh-v6.test.mjs','tests/fixtures/platform-review-refresh-v6.mjs',
  'scripts/ci/verify-platform-review-refresh-pg-v6.mjs','.github/workflows/platform-cloud-candidate.yml',R.riskFile];
const hash=v=>createHash('sha256').update(v).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
async function write(file,v){assertEvidenceSafeV5(v);await writeFile(file,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});}
async function absent(file){try{await access(file);must(false,'SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(L.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function source(expected){const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
  (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected),'SOURCE');await sourceCompatibility(head);return head;}
async function directory(value,existing=false){const p=path.resolve(value);must(path.dirname(p).toLowerCase()===path.resolve(L.base).toLowerCase()&&
  /^techlong-w8l-review-refresh-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(L.base)).toLowerCase()===path.resolve(L.base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'DIRECTORY_LINK');return p;}
async function parents(){
  const files=[{path:R.readOnlyFile,rawSha256:R.readOnlyFileSha256},{path:R.oldPlanFile,rawSha256:R.oldPlanFileSha256},
    {path:R.publicationFile,rawSha256:R.publicationFileSha256},{path:J.heldFile,rawSha256:J.heldFileSha256},
    {path:J.lineageFile,rawSha256:J.lineageFileSha256},
    {path:J.slot,rawSha256:'810b2b604c0144d135bb1b78eefcd71cdc275493e4163fadbc2c9fdcea697b1f'},
    {path:J.inspectSlot,rawSha256:'c090aa79814e9385dc652265ba47025c7d8980d701248312d6a3dff4f645a815'}];
  for(const f of files)must(hash(await readFile(f.path))===f.rawSha256,'PARENT_DRIFT');
  const oldPlan=await json(R.oldPlanFile),readOnly=await json(R.readOnlyFile),publication=await json(R.publicationFile),baseline=await json(J.heldFile);
  const references={installation:JSON.parse(oldPlan.plan.inputs.installation),lineage:publication.lineageReference};
  must(same(readOnly.oldPlan.planSha256,publication.planSha256)&&same(readOnly.planHashes,[publication.planSha256]),'PARENT_BINDING');
  return {parents:files,oldPlan,readOnly,baseline,references};
}
async function productionIo(m,output){
  let s3,sts,reads,opened=false,gets=0,transactions=0;const signal=AbortSignal.timeout(R.runMs),record=(n,v)=>write(output+'/'+n+'.json',v);
  const tick=()=>must(++transactions<=(m.effects.explicitReadOnlyTransactionsMax),'READ_BUDGET');
  const assertSource=async()=>{await source(m.sourceCommit);must(same(await pins(),m.pins)&&same(await authMetadataV6(),m.auth),'PINS_OR_AUTH_DRIFT');};
  const readObject=async ref=>{must(++gets<=m.effects.s3VersionGetsMax,'S3_READ_BUDGET');return reads.readObject(ref);};
  const io={assertSource,record,readObject,
    async preflight(){const credentials=await fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})();
      must(credentials.expiration instanceof Date&&credentials.expiration.getTime()>Date.now()+R.runMs,'SOURCE_SESSION');
      const cfg={region:L.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true,requestHandler:new NodeHttpHandler({
        httpsAgent:new Agent({family:4}),connectionTimeout:10000,socketTimeout:20000})};
      sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});
      const who=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:signal});
      must(who.Account==='402010193138'&&who.Arn===L.sourceArn&&who.UserId===L.sourceUserId,'SOURCE_IDENTITY');
      s3=new S3Client({...cfg,endpoint:'https://s3.ca-central-1.amazonaws.com'});
      reads=createPublisherReadsV6({s3,signal,githubToken:'NO_GITHUB_CAPABILITY_REVIEW_REFRESH',fetch:async()=>{throw Error('NO_GITHUB_CAPABILITY');}});},
    claim:()=>write(R.slot,{manifestSha256:m.manifestSha256,jobId:R.jobId,claimedAt:Date.now(),retryAllowed:false}),readAuth:()=>readAuthV6(m.auth),
    async open(auth){must(!opened,'ONE_DATABASE_SESSION');opened=true;const client=new pg.Client(await publisherDatabaseConfigV6(auth));
      const contract=sqlContract((await readFile(L.root+'/ops/platform-controller-v6/install.sql','utf8')).replaceAll('\r\n','\n'));
      const db=createPublisherDatabaseV6({client,expected:DATABASE_V6,contract,release:m.binding.platform,maxWrites:1});client.on('error',()=>db.halt());
      try{await client.connect();tick();await db.verify();}catch{try{await client.end();}catch{}throw Error('REVIEW_REFRESH_DATABASE_OPEN');}
      return {readHeldJob:async id=>{tick();return db.readHeldJob(id);},writeOwner:db.writeOwner,
        async ledger(){tick();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          try{const r=await client.query(LEDGER_SQL,[R.jobId]);must(r.rows.length===1,'LEDGER_ROW');await client.query('COMMIT');return r.rows[0].value;}
          catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}},
        dispose:async()=>{db.halt();await client.end();}};},
    async publishReview({db,guard,notBefore}){let submitted=false;
      const p=createTrustedPublisherV6({release:m.binding.platform,sourceCommit:m.sourceCommit,frozenSourceCommit:m.binding.publisher.frozenSourceCommit,
        ports:{readObject,readHeldJob:async id=>{must(id===R.jobId,'EXACT_JOB');const v=await db.readHeldJob(id);await assertFollowupHeld(v,m.baseline,Date.now());return v;},
          writeOwner:async q=>{must(!submitted,'ONE_SQL_SUBMISSION');const v=await refreshedPlan(JSON.parse(q.values[3]),m,notBefore,Date.now());
            must(same(q,ownerQueryV6('plan',v)),'EXACT_PLAN_SQL');await record('proposed-plan',v);await guard();
            await assertRefreshLedger(await db.ledger(),m,Date.now());await guard();submitted=true;await db.writeOwner(q);}}});
      return p.publishReview({jobId:R.jobId,installationReference:m.references.installation,lineageReference:m.references.lineage});},
    dispose:async()=>{reads?.dispose();s3?.destroy();sts?.destroy();},
  };return io;
}
export async function main(args=process.argv.slice(2)){
  must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(L.root).toLowerCase()&&
    !['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS'].some(k=>process.env[k])&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&
    !Object.keys(process.env).some(k=>/^AWS_ENDPOINT_URL|^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=['--mode','--output',...(mode==='Prepare'?['--ci-run']:['--manifest','--approved-sha'])];
  must(['Prepare','Publish','Inspect'].includes(mode)&&Object.keys(a).length===fields.length&&fields.every(k=>a[k]),'MODE');
  const output=await directory(a['--output']);await absent(mode==='Inspect'?R.inspectSlot:R.slot);const p=await parents();let m;
  if(mode==='Prepare'){
    const sourceCommit=await source(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit);
    m=await makeRefreshReview({...p,sourceCommit,ci,auth:await authMetadataV6(),pins:await pins(),compatibility:await sourceCompatibility(sourceCommit),createdAt:Date.now()});
    await source(sourceCommit);await mkdir(output);await write(output+'/manifest.json',m);
    const result={outcome:'REVIEW_REFRESH_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,sourceCommit,jobId:R.jobId,
      preservedOldPlanSha256:R.oldPlanSha256,expiresAtUtc:new Date(m.expiresAt).toISOString(),latestStartAtUtc:new Date(m.latestStartAt).toISOString(),
      authContentReads:0,sqlConnections:0,awsCalls:0,slotsConsumed:0,executionApproved:false};await write(output+'/result.json',result);console.log(JSON.stringify(result,null,2));return result;
  }
  const file=path.resolve(a['--manifest']);await directory(path.dirname(file),true);must(path.basename(file)==='manifest.json','MANIFEST_PATH');
  m=await verifyRefreshReview(await json(file),a['--approved-sha'],Date.now(),mode==='Inspect');
  must(same(p.parents,m.parents)&&same(p.baseline,m.baseline)&&same(p.oldPlan,m.oldPlan)&&same(p.readOnly,m.readOnly)&&same(p.references,m.references),'PARENTS');
  const assertSource=async()=>{await source(m.sourceCommit);must(same(await pins(),m.pins)&&same(await sourceCompatibility(m.sourceCommit),m.compatibility),'PINS');};
  await assertSource();await mkdir(output);const io=await productionIo(m,output);
  try{
    if(mode==='Publish'){await readLocalCiV6(m.ci.runId,m.sourceCommit);await io.record('approved-manifest',m);
      const r=await publishRefreshOnce({manifest:m,approved:a['--approved-sha'],io:{...io,assertSource}});console.log(JSON.stringify(r,null,2));if(r.outcome.includes('UNKNOWN'))process.exitCode=1;return r;}
    const run=path.dirname(file)+'-run',slot=await json(R.slot),proposed=await json(run+'/proposed-plan.json');
    must(slot.manifestSha256===m.manifestSha256&&slot.jobId===R.jobId,'PUBLISH_SLOT');
    const v=await refreshedPlan(proposed.plan,m,m.createdAt,Date.now());must(same(v,proposed),'PROPOSED_PLAN');
    await io.preflight();await write(R.inspectSlot,{manifestSha256:m.manifestSha256,planSha256:v.planSha256,claimedAt:Date.now(),retryAllowed:false});let db;
    try{db=await io.open(await io.readAuth());const ledger=await assertRefreshLedger(await db.ledger(),m,Date.now(),v);
      await assertFollowupHeld(await db.readHeldJob(R.jobId),m.baseline,Date.now());
      const links=(await io.readObject(m.references.lineage)).value;must(same(links,(await json(J.lineageFile)).links),'LINEAGE_READBACK');
      const result={outcome:'REVIEW_REFRESH_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED',jobId:R.jobId,runtimeSourceCommit:m.sourceCommit,
        planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:v.plan.riskSha256,planExpiresAt:v.plan.expiresAt,checkedAt:Date.now(),
        preservedOldPlanSha256:R.oldPlanSha256,oldPlanUnchanged:true,oldPlanExpired:true,planHashes:ledger.entries.map(e=>e.planSha256).sort(),
        controlCounts:ledger.counts,heldJobUnchanged:true,executionApproved:false,retryAllowed:false};await io.record('result',result);console.log(JSON.stringify(result,null,2));return result;
    }catch{const result={outcome:'REVIEW_REFRESH_INSPECT_UNCONFIRMED_NO_RETRY',retryAllowed:false};await io.record('result',result);console.log(JSON.stringify(result));process.exitCode=1;return result;}
    finally{await db?.dispose();}
  }catch(e){await io.record('entry-stop',{outcome:'REVIEW_REFRESH_ENTRY_STOPPED_NO_RETRY',code:/^REVIEW_REFRESH_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
    errorType:/^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'DETAILS_WITHHELD',retryAllowed:false});throw e;
  }finally{await io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'REVIEW_REFRESH_ENTRY_STOPPED_NO_RETRY',code:/^REVIEW_REFRESH_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',
    errorType:/^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'DETAILS_WITHHELD',retryAllowed:false}));process.exitCode=1;
});
