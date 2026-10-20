// Explicit W6m operator entry. Prepare reads public files/metadata and Git CI only.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {git} from '../platform-identity-review-v6/publication.mjs';
import {authMetadataV6,readAuthV6,readLocalCiV6,portFreeV6} from '../platform-local-v6/local.mjs';
import {L} from '../platform-local-v6/plan.mjs';
import {publisherDatabaseConfigV6,createPublisherDatabaseV6,createPublisherReadsV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {sqlContract} from '../platform-controller-review-v6/install.mjs';
import {EVIDENCE_V5 as E,assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {R,must,same,makeReviewPublicationV6,verifyReviewPublicationV6,assertHeldObservationV6,rebuildLineageV6,publishReviewOnceV6} from './plan.mjs';
const requestBase=L.base+'/techlong-w6l-held-request-20261020-a';
export const FILES=['ops/platform-review-v6/plan.mjs','ops/platform-review-v6/local.mjs','ops/platform-publisher-v6/io.mjs',
  'ops/platform-cloud-v6/publisher.mjs','ops/platform-cloud-v6/contract.mjs','ops/platform-controller-v6/install.sql',
  'ops/platform-controller-review-v6/catalog.mjs','ops/platform-controller-review-v6/install.mjs','ops/platform-local-v6/local.mjs',
  'ops/platform-local-v6/metadata.ps1','lib/deployments/controller-v6/installed-binding.ts','lib/deployments/controller-v6/contract.ts',
  'ops/aws-sandbox/reviews/platform-request-v6.executed.json','ops/aws-sandbox/reviews/cloud-worker-w5r.executed.json',
  'ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json','tests/platform-review-v6.test.mjs',
  '.github/workflows/platform-cloud-candidate.yml',R.riskFile];
const hash=v=>createHash('sha256').update(v).digest('hex'),json=async f=>JSON.parse(await readFile(f,'utf8'));
async function write(f,v){assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});}
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(L.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function source(expected){const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
  (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected),'SOURCE');return head;}
async function publicReceipts(){
  const e=await json(L.root+'/ops/aws-sandbox/reviews/platform-request-v6.executed.json');
  must(e.manifestSha256===R.requestSha&&e.state==='NEW_EXACT_HELD_REQUEST_INDEPENDENTLY_VERIFIED_RUNTIME_CLOSED'&&e.target.jobId===R.jobId,'REQUEST_EVIDENCE');
  for(const r of e.receipts)must(hash(await readFile(r.path))===r.rawSha256,'REQUEST_RECEIPTS');
  const baseline=await json(requestBase+'-inspect/state.json');must(baseline.target.id===R.jobId&&baseline.target.status==='pending'&&
    baseline.target.cloudExecutionAuthorized===false,'REQUEST_STATE');
  return {receipts:e.receipts,baseline};
}
const CONTROL_COUNTS_SQL=`SELECT jsonb_build_object('plans',(SELECT count(*)::int FROM deployment_control_v6.plans WHERE job_id=$1),
  'approvals',(SELECT count(*)::int FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=$1),
  'attempts',(SELECT count(*)::int FROM deployment_control_v6.dispatch_attempts WHERE job_id=$1)) AS value`;
async function productionIo(m,output,baseline){
  let s3,sts,reads,opened=false;const signal=AbortSignal.timeout(120000);
  const record=(n,v)=>write(output+'/'+n+'.json',v);
  const assertSource=async()=>{await source(m.sourceCommit);must(same(await pins(),m.pins)&&same(await authMetadataV6(),m.auth),'SOURCE_OR_AUTH_DRIFT');};
  return {
    assertSource,record,
    async preflight(){const credentials=await fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})();
      must(credentials.expiration instanceof Date&&credentials.expiration.getTime()>Date.now()+120000,'SOURCE_SESSION');
      const cfg={region:L.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true};
      sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});
      const who=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:signal});
      must(who.Account==='402010193138'&&who.Arn===L.sourceArn&&who.UserId===L.sourceUserId,'SOURCE_IDENTITY');
      s3=new S3Client({...cfg,endpoint:'https://s3.ca-central-1.amazonaws.com'});
      // Review publication never needs a GitHub API capability. The existing S3
      // reader is reused with an inert literal and a throwing HTTP transport.
      reads=createPublisherReadsV6({s3,githubToken:'NO_GITHUB_CAPABILITY_REVIEW_PUBLICATION',fetch:async()=>{throw Error('REVIEW_PLAN_NO_HTTP');},signal});
    },
    claim:()=>write(R.slot,{manifestSha256:m.manifestSha256,jobId:R.jobId,claimedAt:Date.now(),retryAllowed:false}),
    readAuth:()=>readAuthV6(m.auth),
    async open(auth){must(!opened,'ONE_DATABASE_SESSION');opened=true;
      const client=new pg.Client(await publisherDatabaseConfigV6(auth));
      const contract=sqlContract((await readFile(L.root+'/ops/platform-controller-v6/install.sql','utf8')).replaceAll('\r\n','\n'));
      const db=createPublisherDatabaseV6({client,expected:DATABASE_V6,contract,release:m.binding.platform,maxWrites:1});
      client.on('error',()=>db.halt());
      try{await client.connect();await db.verify();}catch{try{await client.end();}catch{/* No retry. */}throw Error('REVIEW_PLAN_DATABASE_OPEN');}
      const counts=async()=>{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try{const q=await client.query(CONTROL_COUNTS_SQL,[R.jobId]);await client.query('COMMIT');must(q.rows.length===1,'COUNTS');return q.rows[0].value;}
        catch(e){try{await client.query('ROLLBACK');}catch{/* Read-only cleanup only. */}throw e;}};
      return {...db,counts,assertEmpty:async()=>must(same(await counts(),{plans:0,approvals:0,attempts:0}),'CONTROL_SLOT_OCCUPIED'),
        dispose:async()=>{db.halt();await client.end();}};
    },
    assertHeld:o=>assertHeldObservationV6(o,baseline),
    readObject:r=>reads.readObject(r),
    async lineage(observed){const [manifest,provider,inspect]=await Promise.all([R.manifest,R.provider,R.inspect].map(async r=>(await reads.readObject(r)).value));
      return rebuildLineageV6({observed,manifest,provider,inspect,capsule:await json(L.root+'/ops/cloud-worker/material/public-capsule-v5.json')});},
    async putLineage(links){assertEvidenceSafeV5(links);const body=canonicalJson(links),sha256=hash(body);
      const ack=await s3.send(new PutObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:R.lineageKey,Body:body,
        IfNoneMatch:'*',ServerSideEncryption:'AES256',ContentType:'application/json',ChecksumSHA256:Buffer.from(sha256,'hex').toString('base64')}),{abortSignal:signal});
      must(ack.VersionId&&ack.ServerSideEncryption==='AES256','LINEAGE_ACK');return {key:R.lineageKey,sha256,versionId:ack.VersionId};},
    dispose:async()=>{reads?.dispose();s3?.destroy();sts?.destroy();},
  };
}
async function directory(value,existing=false){const p=path.resolve(value);must(path.dirname(p).toLowerCase()===path.resolve(L.base).toLowerCase()&&
  /^techlong-w6m-review-plan-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(L.base)).toLowerCase()===path.resolve(L.base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'DIRECTORY_LINK');return p;}
export async function main(args=process.argv.slice(2)){
  must(process.platform==='win32'&&path.resolve(process.cwd()).toLowerCase()===path.resolve(L.root).toLowerCase()&&
    !['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS'].some(k=>process.env[k])&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&
    !Object.keys(process.env).some(k=>/^AWS_ENDPOINT_URL|^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],fields=['--mode','--output',...(mode==='Prepare'?['--ci-run']:['--manifest','--approved-sha'])];
  must(['Prepare','Publish','Inspect'].includes(mode)&&Object.keys(a).length===fields.length&&fields.every(k=>a[k]),'MODE');
  const output=await directory(a['--output']);await absent(mode==='Inspect'?R.inspectSlot:R.slot);
  const prior=await publicReceipts();let m;
  if(mode!=='Prepare'){const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST');
    m=await json(f);await verifyReviewPublicationV6(m,a['--approved-sha'],Date.now());must(same(prior.receipts,m.receipts),'RECEIPT_BINDING');}
  await mkdir(output);
  if(mode==='Prepare'){
    const sourceCommit=await source(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit),auth=await authMetadataV6();must(await portFreeV6(),'PORT_OPEN');
    m=await makeReviewPublicationV6({sourceCommit,pins:await pins(),ci,auth,receipts:prior.receipts,createdAt:Date.now()});await source(sourceCommit);
    await write(output+'/manifest.json',m);const r={outcome:'REVIEW_PUBLICATION_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,jobId:R.jobId,
      expiresAtUtc:new Date(m.expiresAt).toISOString(),expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
      authFileReads:0,sqlConnections:0,awsCalls:0,slotConsumed:false};await write(output+'/result.json',r);console.log(JSON.stringify(r,null,2));return r;
  }
  const io=await productionIo(m,output,prior.baseline);
  try{if(mode==='Publish'){await readLocalCiV6(m.ci.runId,m.sourceCommit);await write(output+'/approved-manifest.json',m);
      const r=await publishReviewOnceV6({manifest:m,approved:a['--approved-sha'],io});console.log(JSON.stringify(r,null,2));if(r.outcome.includes('UNKNOWN'))process.exitCode=1;return r;}
    const base=path.dirname(a['--manifest'])+'-run',slot=await json(R.slot),proposed=await json(base+'/proposed-plan.json'),ref=await json(base+'/lineage-reference.json');
    must(slot.manifestSha256===m.manifestSha256&&slot.jobId===R.jobId&&ref.key===R.lineageKey,'PUBLICATION_RECEIPTS');
    const v=await validatePlan(proposed.plan,m.binding.platform,proposed.plan.preparedAt);must(same(v,proposed)&&v.plan.sourceCommit===m.sourceCommit&&
      v.plan.jobId===R.jobId&&v.plan.mode==='Review'&&v.plan.inputs.lineage===canonicalJson(ref),'PROPOSED_PLAN');
    await io.assertSource();await io.preflight();await write(R.inspectSlot,{manifestSha256:m.manifestSha256,planSha256:v.planSha256,claimedAt:Date.now(),retryAllowed:false});
    let db;try{db=await io.open(await io.readAuth());const entry=await db.loadPlan(v.planSha256),counts=await db.counts();
      await io.assertHeld(await db.readHeldJob(R.jobId));const links=(await io.readObject(ref)).value;
      must(same(links,await json(base+'/lineage.json'))&&same(counts,{plans:1,approvals:0,attempts:0})&&entry.attempt===null&&
        same(entry.plan,v.plan)&&entry.planSha256===v.planSha256&&entry.actionSha256===v.actionSha256&&entry.riskSha256===v.plan.riskSha256,'READBACK');
      const r={outcome:'EXACT_REVIEW_PLAN_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED',jobId:R.jobId,planSha256:v.planSha256,actionSha256:v.actionSha256,
        riskSha256:v.plan.riskSha256,planExpiresAt:v.plan.expiresAt,checkedAt:Date.now(),planStillLive:Date.now()<v.plan.expiresAt,controlCounts:counts,
        heldJobUnchanged:true,lineageVersionVerified:true,executionApproved:false,retryAllowed:false};await io.record('result',r);console.log(JSON.stringify(r,null,2));return r;
    }catch{const r={outcome:'REVIEW_PLAN_INSPECT_UNCONFIRMED_NO_RETRY',retryAllowed:false};await io.record('result',r);process.exitCode=1;console.log(JSON.stringify(r));return r;}
    finally{await db?.dispose();}
  }finally{await io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error(JSON.stringify({outcome:'REVIEW_PLAN_ENTRY_STOPPED_NO_RETRY',detailsWithheld:true,retryAllowed:false}));process.exitCode=1;});
