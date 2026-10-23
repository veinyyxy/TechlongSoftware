// Explicit operator entry; Prepare has no private-content, SQL or AWS capability.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {Agent} from 'node:https';
import {git} from '../platform-identity-review-v6/publication.mjs';
import {L} from '../platform-local-v6/plan.mjs';
import {authMetadataV6,readAuthV6,readLocalCiV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,createPublisherDatabaseV6,createPublisherReadsV6,DATABASE_V6} from '../platform-publisher-v6/io.mjs';
import {sqlContract} from '../platform-controller-review-v6/install.mjs';
import {createTrustedPublisherV6} from '../platform-cloud-v6/publisher.mjs';
import {EVIDENCE_V5 as E,assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {J,must,same,makeFollowupPublication,verifyFollowupPublication,assertFollowupHeld,reconstructFollowupLineage,validateFollowupPlan,publishFollowupOnce} from './followup.mjs';
export const FILES=['ops/platform-review-v6/followup.mjs','ops/platform-review-v6/followup-local.mjs','ops/platform-publisher-v6/io.mjs',
  'ops/platform-cloud-v6/publisher.mjs','ops/platform-cloud-v6/contract.mjs','ops/platform-controller-v6/install.sql',
  'ops/platform-controller-review-v6/catalog.mjs','ops/platform-controller-review-v6/install.mjs','ops/platform-local-v6/local.mjs',
  'ops/platform-local-v6/metadata.ps1','lib/deployments/controller-v6/installed-binding.ts','lib/deployments/controller-v6/contract.ts',
  'ops/cloud-worker/cloud-worker-root-v5.mjs','ops/cloud-worker/cloud-context-v5.mjs','ops/cloud-worker/material/public-capsule-v5.json',
  'ops/aws-sandbox/reviews/platform-request-followup-w8i.executed.json','tests/platform-review-followup-v6.test.mjs',
  '.github/workflows/platform-cloud-candidate.yml',J.riskFile];
const hash=v=>createHash('sha256').update(v).digest('hex'),json=async f=>JSON.parse(await readFile(f,'utf8'));
async function write(f,v){assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});}
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(L.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
async function source(expected){const head=(await git(['rev-parse','HEAD'])).trim();must((await git(['branch','--show-current'])).trim()==='main'&&
  (await git(['status','--porcelain'])).trim()===''&&(!expected||head===expected),'SOURCE');
  await git(['merge-base','--is-ancestor',J.runtimeSourceCommit,'HEAD']);return head;}
async function directory(value,existing=false){const p=path.resolve(value);must(path.dirname(p).toLowerCase()===path.resolve(L.base).toLowerCase()&&
  /^techlong-w8j-review-plan-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(L.base)).toLowerCase()===path.resolve(L.base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'DIRECTORY_LINK');return p;}
async function parents(){const receipts=[{path:J.heldFile,rawSha256:J.heldFileSha256},{path:J.lineageFile,rawSha256:J.lineageFileSha256},
  {path:J.evidenceFile,rawSha256:J.evidenceSha256}];
  for(const r of receipts)must(hash(await readFile(r.path))===r.rawSha256,'PARENT_RECEIPT');
  const baseline=await json(J.heldFile),prepared=await json(J.lineageFile),evidence=await json(J.evidenceFile);
  must(evidence.state==='FOLLOWUP_HELD_REQUEST_VERIFIED_LOCAL_ENTRY_CLOSED'&&evidence.job.id===J.jobId&&
    prepared.jobId===J.jobId&&prepared.linksSha256===J.lineageSha256,'PARENT_BINDING');return {receipts,baseline,prepared};}
const COUNTS=`SELECT jsonb_build_object('plans',(SELECT count(*)::int FROM deployment_control_v6.plans WHERE job_id=$1),
  'approvals',(SELECT count(*)::int FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=$1),
  'attempts',(SELECT count(*)::int FROM deployment_control_v6.dispatch_attempts WHERE job_id=$1)) AS value`;
async function productionIo(m,output){
  let s3,sts,reads,opened=false,gets=0;const signal=AbortSignal.timeout(120000),record=(n,v)=>write(output+'/'+n+'.json',v);
  const assertSource=async()=>{await source(m.sourceCommit);must(same(await pins(),m.pins)&&same(await authMetadataV6(),m.auth),'SOURCE_OR_AUTH_DRIFT');};
  const readObject=async r=>{must(++gets<=7,'S3_READ_BUDGET');return reads.readObject(r);};
  const io={assertSource,record,readObject,
    async preflight(){const credentials=await fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})();
      must(credentials.expiration instanceof Date&&credentials.expiration.getTime()>Date.now()+120000,'SOURCE_SESSION');
      const cfg={region:L.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true,
        requestHandler:new NodeHttpHandler({httpsAgent:new Agent({family:4}),connectionTimeout:10000,socketTimeout:20000})};
      sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});
      const who=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:signal});
      must(who.Account==='402010193138'&&who.Arn===L.sourceArn&&who.UserId===L.sourceUserId,'SOURCE_IDENTITY');
      s3=new S3Client({...cfg,endpoint:'https://s3.ca-central-1.amazonaws.com'});
      reads=createPublisherReadsV6({s3,githubToken:'NO_GITHUB_CAPABILITY_REVIEW_PUBLICATION',fetch:async()=>{throw Error('NO_GITHUB_CAPABILITY');},signal});},
    claim:()=>write(J.slot,{manifestSha256:m.manifestSha256,jobId:J.jobId,claimedAt:Date.now(),retryAllowed:false}),readAuth:()=>readAuthV6(m.auth),
    async open(auth){must(!opened,'ONE_DATABASE_SESSION');opened=true;
      const client=new pg.Client(await publisherDatabaseConfigV6(auth)),contract=sqlContract((await readFile(L.root+'/ops/platform-controller-v6/install.sql','utf8')).replaceAll('\r\n','\n'));
      const db=createPublisherDatabaseV6({client,expected:DATABASE_V6,contract,release:m.binding.platform,maxWrites:1});client.on('error',()=>db.halt());
      try{await client.connect();await db.verify();}catch{try{await client.end();}catch{/* No retry. */}throw Error('FOLLOWUP_REVIEW_DATABASE_OPEN');}
      const counts=async()=>{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try{const r=await client.query(COUNTS,[J.jobId]);await client.query('COMMIT');must(r.rows.length===1,'COUNTS');return r.rows[0].value;}
        catch(e){try{await client.query('ROLLBACK');}catch{/* Read-only cleanup. */}throw e;}};
      return {...db,counts,assertEmpty:async()=>must(same(await counts(),{plans:0,approvals:0,attempts:0}),'CONTROL_OCCUPIED'),
        dispose:async()=>{db.halt();await client.end();}};},
    assertHeld:o=>assertFollowupHeld(o,m.baseline,Date.now()),
    async lineage(o){const r=m.references,[prior,manifest,provider,inspect]=await Promise.all([r.priorLineage,r.manifest,r.provider,r.inspect].map(async ref=>(await readObject(ref)).value));
      const outputs=typeof o.snapshot.deployment.outputs==='string'?JSON.parse(o.snapshot.deployment.outputs):o.snapshot.deployment.outputs;
      return reconstructFollowupLineage({priorLinks:prior,manifest,provider,inspect,receipt:outputs.expressInitializedWorkerRunsV2?.[J.priorJobId],
        capsule:await json(L.root+'/ops/cloud-worker/material/public-capsule-v5.json')});},
    async putLineage(links){assertEvidenceSafeV5(links);const body=canonicalJson(links);must(hash(body)===J.lineageSha256,'LINEAGE_BODY');
      const ack=await s3.send(new PutObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:J.lineageKey,Body:body,IfNoneMatch:'*',
        ServerSideEncryption:'AES256',ContentType:'application/json',ChecksumSHA256:Buffer.from(J.lineageSha256,'hex').toString('base64')}),{abortSignal:signal});
      must(ack.VersionId&&ack.ServerSideEncryption==='AES256','LINEAGE_ACK');return {key:J.lineageKey,sha256:J.lineageSha256,versionId:ack.VersionId};},
    async publishReview({db,reference,guard}){const publisher=createTrustedPublisherV6({release:m.binding.platform,sourceCommit:m.runtimeSourceCommit,
      frozenSourceCommit:m.binding.publisher.frozenSourceCommit,ports:{readObject,readHeldJob:async id=>{must(id===J.jobId,'EXACT_JOB');
        const o=await db.readHeldJob(id);await io.assertHeld(o);return o;},writeOwner:async q=>{
        const v=await validateFollowupPlan(JSON.parse(q.values[3]),m,reference);await record('proposed-plan',v);await guard();await db.writeOwner(q);}}});
      return publisher.publishReview({jobId:J.jobId,installationReference:m.references.installation,lineageReference:reference});},
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
  const output=await directory(a['--output']);await absent(mode==='Inspect'?J.inspectSlot:J.slot);const p=await parents();let m;
  if(mode!=='Prepare'){const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','MANIFEST');
    m=await json(f);await verifyFollowupPublication(m,a['--approved-sha'],Date.now(),mode==='Inspect');
    must(same(p.receipts,m.receipts)&&same(p.baseline,m.baseline)&&same(p.prepared.references,m.references),'PARENT_BINDING');}
  await mkdir(output);
  if(mode==='Prepare'){
    const sourceCommit=await source(),ci=await readLocalCiV6(a['--ci-run'],sourceCommit),auth=await authMetadataV6();
    m=await makeFollowupPublication({sourceCommit,pins:await pins(),ci,auth,baseline:p.baseline,references:p.prepared.references,receipts:p.receipts,createdAt:Date.now()});await source(sourceCommit);
    await write(output+'/manifest.json',m);const result={outcome:'FOLLOWUP_REVIEW_PREPARED_NOT_APPROVED',manifestSha256:m.manifestSha256,jobId:J.jobId,
      operatorSourceCommit:m.sourceCommit,runtimeSourceCommit:m.runtimeSourceCommit,expiresAtUtc:new Date(m.expiresAt).toISOString(),
      latestStartAtUtc:new Date(m.latestStartAt).toISOString(),expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
      authContentReads:0,sqlConnections:0,awsCalls:0,slotsConsumed:0,executionApproved:false};await write(output+'/result.json',result);console.log(JSON.stringify(result,null,2));return result;
  }
  const io=await productionIo(m,output);
  try{
    if(mode==='Publish'){await readLocalCiV6(m.ci.runId,m.sourceCommit);await write(output+'/approved-manifest.json',m);
      const r=await publishFollowupOnce({manifest:m,approved:a['--approved-sha'],io});console.log(JSON.stringify(r,null,2));if(r.outcome.includes('UNKNOWN'))process.exitCode=1;return r;}
    const run=path.dirname(a['--manifest'])+'-run',slot=await json(J.slot),proposed=await json(run+'/proposed-plan.json'),ref=await json(run+'/lineage-reference.json');
    must(slot.manifestSha256===m.manifestSha256&&slot.jobId===J.jobId,'PUBLISH_SLOT');const v=await validateFollowupPlan(proposed.plan,m,ref);must(same(v,proposed),'PROPOSED_PLAN');
    await io.assertSource();await io.preflight();await write(J.inspectSlot,{manifestSha256:m.manifestSha256,planSha256:v.planSha256,claimedAt:Date.now(),retryAllowed:false});
    let db;try{db=await io.open(await io.readAuth());const entry=await db.loadPlan(v.planSha256),counts=await db.counts();await io.assertHeld(await db.readHeldJob(J.jobId));
      const links=(await io.readObject(ref)).value;must(same(links,await json(run+'/lineage.json'))&&same(counts,{plans:1,approvals:0,attempts:0})&&
        entry.attempt===null&&same(entry.plan,v.plan)&&entry.planSha256===v.planSha256&&entry.actionSha256===v.actionSha256&&entry.riskSha256===v.plan.riskSha256,'READBACK');
      const result={outcome:'FOLLOWUP_REVIEW_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED',jobId:J.jobId,planSha256:v.planSha256,actionSha256:v.actionSha256,
        riskSha256:v.plan.riskSha256,runtimeSourceCommit:m.runtimeSourceCommit,planExpiresAt:v.plan.expiresAt,checkedAt:Date.now(),planStillLive:Date.now()<v.plan.expiresAt,
        controlCounts:counts,heldJobUnchanged:true,executionApproved:false,retryAllowed:false};await io.record('result',result);console.log(JSON.stringify(result,null,2));return result;
    }catch{const result={outcome:'FOLLOWUP_REVIEW_INSPECT_UNCONFIRMED_NO_RETRY',retryAllowed:false};await io.record('result',result);console.log(JSON.stringify(result));process.exitCode=1;return result;}
    finally{await db?.dispose();}
  }finally{await io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'FOLLOWUP_REVIEW_ENTRY_STOPPED_NO_RETRY',code:/^FOLLOWUP_REVIEW_[A-Z_]+$/.test(e?.message??'')?e.message:'DETAILS_WITHHELD',retryAllowed:false}));process.exitCode=1;
});
