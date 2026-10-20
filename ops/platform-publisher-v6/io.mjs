// Trusted operator/publisher only. Not imported by a platform HTTP route.
// No credential discovery, App signing, dispatch, SQL DDL or network on import.
import pg from 'pg';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {readFile} from 'node:fs/promises';
import {createTrustedPublisherV6,ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {CLOUD_V6 as C,S,must,digest,commit,keys,obj} from '../platform-cloud-v6/contract.mjs';
import {releaseReady,validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {assertEvidenceSafeV5,EVIDENCE_V5 as E} from '../cloud-worker/cloud-evidence-v5.mjs';
import {platformReadObservationV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import {readControlCatalog} from '../platform-controller-review-v6/catalog.mjs';
import {sqlContract,hash} from '../platform-controller-review-v6/install.mjs';

export const DATABASE_V6=Object.freeze({ownerRole:'neondb_owner',ownerOid:'16392',database:'neondb',roleOid:'180224',schemaOid:'180226',
  targetFingerprintSha256:'5d5e52c00c54ed761aac13730f81b1b6f107d7ac06a68a407276132d150690a7'});
// Publishing this exact source/release binding requires separate approval.
// An environment boolean or caller-supplied PUBLISHED object cannot enable it.
export const PUBLISHER_RELEASE_V6=Object.freeze({state:'UNPUBLISHED',releaseSha256:null,sourceCommit:null,frozenSourceCommit:null});
const prefix=`worker-v5/${S.instanceId}/`,planSql=ownerQueryV6('plan',{planSha256:'',actionSha256:'',plan:{riskSha256:''}}).text;
const proofSql=ownerQueryV6('proof',{planSha256:'a'.repeat(64),proofSha256:'b'.repeat(64)}).text;
const job=v=>typeof v==='string'&&/^job_[a-f0-9]{24}$/.test(v)&&v!==S.completedJob;

export async function publisherDatabaseConfigV6(value,expected=DATABASE_V6){
  let u;try{u=new URL(value);}catch{must(false,'PUBLISHER_DATABASE_TARGET');}
  must(['postgres:','postgresql:'].includes(u.protocol)&&/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname)&&
    (!u.port||u.port==='5432')&&/^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname)&&decodeURIComponent(u.username)===expected.ownerRole&&
    u.password&&!u.hash&&['require','verify-full'].includes(u.searchParams.get('sslmode'))&&
    [...u.searchParams.keys()].every(k=>['sslmode','channel_binding'].includes(k)),'PUBLISHER_DATABASE_TARGET');
  const publicTarget={host:u.hostname,port:5432,database:u.pathname.slice(1),actor:decodeURIComponent(u.username),transport:'PostgresTLSVerifyFull'};
  must(await sha256Hex(publicTarget)===expected.targetFingerprintSha256,'PUBLISHER_DATABASE_FINGERPRINT');
  return {host:u.hostname,port:5432,database:publicTarget.database,user:publicTarget.actor,password:decodeURIComponent(u.password),
    ssl:{rejectUnauthorized:true},options:'',application_name:'Techlong-Trusted-Publisher-V6',connectionTimeoutMillis:15000,query_timeout:30000,statement_timeout:20000};
}

export function createPublisherDatabaseV6({client,expected,contract,release,now=Date.now,maxWrites=1}){
  must([1,2].includes(maxWrites),'PUBLISHER_WRITE_BUDGET');let verified=false,busy=false,halted=false,writes=0;
  async function guarded(fn){
    must(!busy&&!halted,'PUBLISHER_DATABASE_CLOSED_OR_BUSY');busy=true;
    try{return await fn();}catch{halted=true;throw Error('PUBLISHER_DATABASE_REQUIRES_INSPECT_NO_RETRY');}finally{busy=false;}
  }
  async function read(text,values){return guarded(async()=>{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{const r=await client.query(text,values);must(r.rows?.length===1,'PUBLISHER_DATABASE_ROW');
      await client.query('COMMIT');return r.rows[0].value;
    }catch(e){try{await client.query('ROLLBACK');}catch{/* Read-only cleanup only. */}throw e;}
  });}
  return Object.freeze({
    async verify(){return guarded(async()=>{
      must(!verified,'PUBLISHER_DATABASE_VERIFY_ONCE');const c=await readControlCatalog(client);
      must(c.actor===expected.ownerRole&&c.session_actor===c.actor&&c.database===expected.database&&c.installer.oid===expected.ownerOid&&
        c.role?.oid===expected.roleOid&&c.schema?.oid===expected.schemaOid&&c.schema.owner===expected.ownerOid&&
        c.role.name===S.databaseRole&&c.functions.length===9&&
        ['inherit','super','createRole','createDb','replication','bypassRls'].every(k=>c.role[k]===false),'PUBLISHER_OWNER_OR_LAYOUT');
      for(const f of c.functions){const e=contract.functions.find(v=>v.name===f.name);
        must(e&&f.owner===expected.ownerOid&&f.types.replaceAll(' ','')===e.types&&f.language===e.language&&f.definer===true&&
          hash(f.body)===e.bodySha256&&f.publicExecute===false&&f.serviceExecute===e.serviceExecute&&
          canonicalJson(f.config?.map(v=>v.replaceAll(' ','')))===canonicalJson(['search_path=pg_catalog,pg_temp']),'PUBLISHER_FUNCTION_DRIFT');}
      verified=true;return {ownerOid:expected.ownerOid,roleOid:expected.roleOid,schemaOid:expected.schemaOid,functionBodiesVerified:9};
    });},
    async loadPlan(sha){must(verified&&digest(sha),'PUBLISHER_PLAN_READ');
      const v=await read('SELECT deployment_control_v6.load_plan($1) AS value',[sha]);
      must(v&&v.planSha256===sha,'PUBLISHER_PLAN_MISSING');return v;},
    async readHeldJob(id){must(verified&&job(id),'PUBLISHER_EXACT_HELD_JOB');const started=now();
      const v=await read('SELECT techlong_cloud_worker_v5.read_state($1::text) AS value',[id]);
      must(v?.job?.id===id,'PUBLISHER_JOB_READBACK');return platformReadObservationV4(v,v,started,now());},
    async writeOwner(raw){
      const q=structuredClone(raw);
      must(verified&&writes<maxWrites,'PUBLISHER_WRITE_BUDGET');keys(obj(q),['text','values']);
      must(Array.isArray(q.values),'PUBLISHER_WRITE_VALUES');
      if(q.text===planSql){must(q.values.length===4,'PUBLISHER_PLAN_VALUES');
        const v=await validatePlan(JSON.parse(q.values[3]),release,now());
        must(v.planSha256===q.values[0]&&v.actionSha256===q.values[1]&&v.plan.riskSha256===q.values[2],'PUBLISHER_PLAN_WRITE_BINDING');
      }else must(q.text===proofSql&&q.values.length===2&&q.values.every(digest),'PUBLISHER_EXACT_OWNER_SQL');
      return guarded(async()=>{must(writes<maxWrites,'PUBLISHER_WRITE_BUDGET');writes++;await client.query(q.text,q.values);}); // exactly once; ambiguous ACK halts
    },
    halt(){halted=true;},counts:()=>({ownerWriteSubmissions:writes,automaticRetries:0}),
  });
}

async function bytes(stream,limit){
  const parts=[];let size=0;
  try{for await(const part of stream){const b=Buffer.from(part);size+=b.length;must(size<=limit,'PUBLISHER_BODY_SIZE');parts.push(b);}}
  catch(e){stream.destroy?.();throw e;}return Buffer.concat(parts,size);
}
export function createPublisherReadsV6({s3,fetch:request,githubToken,signal=AbortSignal.timeout(120000)}){
  must(typeof githubToken==='string'&&githubToken.length>0&&githubToken.length<=16000,'PUBLISHER_GITHUB_TOKEN');let halted=false;
  async function guarded(fn){must(!halted,'PUBLISHER_READS_HALTED');signal.throwIfAborted();
    try{return await fn();}catch{halted=true;throw Error('PUBLISHER_READ_REQUIRES_INSPECT_NO_RETRY');}}
  return Object.freeze({
    readObject:r=>guarded(async()=>{
      keys(obj(r),['key','sha256','versionId']);must(typeof r.key==='string'&&r.key.startsWith(prefix)&&/^[A-Za-z0-9/_.-]+$/.test(r.key)&&
        !r.key.includes('..')&&digest(r.sha256)&&/^[A-Za-z0-9._-]{1,256}$/.test(r.versionId),'PUBLISHER_OBJECT_REFERENCE');
      const o=await s3.send(new GetObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:r.key,VersionId:r.versionId}),
        {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
      must(o.VersionId===r.versionId&&o.ServerSideEncryption==='AES256'&&Number.isSafeInteger(o.ContentLength)&&
        o.ContentLength>0&&o.ContentLength<=1000000&&o.Body,'PUBLISHER_OBJECT_METADATA');
      const raw=await bytes(o.Body,1000000);must(raw.length===o.ContentLength,'PUBLISHER_OBJECT_LENGTH');
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));assertEvidenceSafeV5(value);
      must(await sha256Hex(value)===r.sha256,'PUBLISHER_OBJECT_HASH');
      return {value,versionId:o.VersionId,encryption:o.ServerSideEncryption,contentLength:o.ContentLength};
    }),
    readRun:id=>guarded(async()=>{
      must(typeof id==='string'&&/^[1-9][0-9]{0,15}$/.test(id),'PUBLISHER_EXACT_RUN');
      const r=await request(`https://api.github.com/repos/${S.repository}/actions/runs/${id}`,{method:'GET',redirect:'error',cache:'no-store',
        headers:{authorization:'Bearer '+githubToken,accept:'application/vnd.github+json','x-github-api-version':'2026-03-10',
          'user-agent':'Techlong-Trusted-Publisher-V6'},signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      must(r.status===200&&r.body,'PUBLISHER_GITHUB_READ');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(r.body,256000)));
    }),
    dispose(){halted=true;githubToken=undefined;},
  });
}

export async function runPublisherOperationV6(operation,raw,{publisher:p,loadPlan}){
  must(['ReviewPlan','AttestAndAdvance','FinalAttest'].includes(operation),'PUBLISHER_OPERATION');
  const input=structuredClone(raw);keys(obj(input),operation==='ReviewPlan'?['jobId','installationReference','lineageReference']:['planSha256','resultReference']);
  if(operation==='ReviewPlan')return p.publishReview(input);
  const entry=await loadPlan(input.planSha256);
  // Check the allowed mode BEFORE the first mutation, not after attestation.
  must(operation==='FinalAttest'?entry.plan.mode==='Inspect':['Review','RunOnce'].includes(entry.plan.mode),'PUBLISHER_OPERATION_MODE');
  const a=await p.attestResult(input.planSha256,input.resultReference);
  if(operation==='FinalAttest')return a;
  return {attestation:a,next:await p.publishSuccessor(input.planSha256,input.resultReference)};
}

// Explicit credentials only, never the default AWS chain or owner DATABASE_URL
// fallback. A separately reviewed operator entry must supply these capabilities.
export async function openProductionPublisherV6({release,sourceCommit,frozenSourceCommit,readOwnerUrl,credentials,githubToken,operation}){
  release=structuredClone(release);credentials=structuredClone(credentials);
  must(PUBLISHER_RELEASE_V6.state==='PUBLISHED'&&PUBLISHER_RELEASE_V6.releaseSha256===await sha256Hex(release)&&
    PUBLISHER_RELEASE_V6.sourceCommit===sourceCommit&&PUBLISHER_RELEASE_V6.frozenSourceCommit===frozenSourceCommit,'PUBLISHER_NOT_ACTIVATED');
  must(releaseReady(release)&&commit(sourceCommit)&&commit(frozenSourceCommit)&&release.installationSha256===C.installationSha256&&
    ['ReviewPlan','AttestAndAdvance','FinalAttest'].includes(operation),
    'PUBLISHER_RELEASE_OR_OPERATION');
  must(typeof githubToken==='string'&&githubToken.length>0&&githubToken.length<=16000&&
    !['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_PATH'].some(k=>process.env[k])&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','PUBLISHER_ENVIRONMENT_OR_TOKEN');
  must(credentials?.accessKeyId&&credentials.secretAccessKey&&credentials.sessionToken&&credentials.expiration instanceof Date&&
    credentials.expiration.getTime()>Date.now()+60000,'PUBLISHER_EXPLICIT_TEMPORARY_CREDENTIALS');
  const config=await publisherDatabaseConfigV6(await readOwnerUrl()),client=new pg.Client(config);
  const sql=(await readFile(new URL('../platform-controller-v6/install.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const db=createPublisherDatabaseV6({client,expected:DATABASE_V6,contract:sqlContract(sql),release,maxWrites:operation==='AttestAndAdvance'?2:1});
  const s3=new S3Client({region:C.region,endpoint:`https://s3.${C.region}.amazonaws.com`,maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials});
  const reads=createPublisherReadsV6({s3,fetch,githubToken});let used=false;
  client.on('error',()=>db.halt());
  try{await client.connect();await db.verify();}catch{reads.dispose();s3.destroy();try{await client.end();}catch{/* No retry. */}
    throw Error('PUBLISHER_OPEN_FAILED_NO_RETRY');}
  const p=createTrustedPublisherV6({release,sourceCommit,frozenSourceCommit,ports:{...reads,...db}});
  return Object.freeze({
    async run(raw){must(!used,'PUBLISHER_OPERATION_ONCE');used=true;
      try{return await runPublisherOperationV6(operation,raw,{publisher:p,loadPlan:db.loadPlan});
      }catch{db.halt();throw Error('PUBLISHER_OPERATION_REQUIRES_INSPECT_NO_RETRY');}},
    counts:db.counts,async dispose(){db.halt();reads.dispose();s3.destroy();await client.end();},
  });
}
