// Fixed GitHub GET + versioned S3 GET transport. Never signs, dispatches or uploads.
import {S3Client} from '@aws-sdk/client-s3';
import {createPublisherReadsV6} from '../platform-publisher-v6/io.mjs';
import {S,resultKeyV6,assertReferenceV6,exactRunV6} from '../platform-cloud-v6/contract.mjs';
import {EVIDENCE_V5 as E,assertEvidenceSafeV5,evidenceKeyV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {CYCLE,CYCLE_SCOPE,must,same} from './cycle-plan.mjs';
export async function boundedText(response,limit){
  must(response.ok&&response.body,'HTTP_RESPONSE');const reader=response.body.getReader(),parts=[];let bytes=0;
  try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;must(bytes<=limit,'HTTP_SIZE');parts.push(r.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
}
export function reviewSummaryFromLog(text,jobId,runId){
  must(typeof text==='string'&&Buffer.byteLength(text)<=CYCLE_SCOPE.downloadedLogBytesMax,'LOG_SIZE');const found=[];
  for(const line of text.split(/\r?\n/)){
    const at=line.indexOf('{"mode":"Review"');if(at<0)continue;let v;try{v=JSON.parse(line.slice(at));}catch{continue;}
    if(v.jobId!==jobId)continue;
    must(Object.keys(v).sort().join(',')==='jobId,manifestSha256,mode,outcome,retryAllowed,saved'&&
      v.outcome==='REVIEW_PREPARED_NOT_APPROVED'&&v.retryAllowed===false,'LOG_SUMMARY');
    assertReferenceV6(v.saved,resultKeyV6(jobId,v.manifestSha256,runId));found.push(v);
  }
  must(found.length===1,'LOG_SUMMARY_COUNT');return found[0];
}
export function createCycleTransport({manifest:rawManifest,ports,now=Date.now}){
  const m=structuredClone(rawManifest);
  const cache=new Map(),runs=new Map(),allowed=new Set(Object.values(m.anchor.references).map(canonicalJson));
  const counts={s3Gets:0,runGets:0,jobsGets:0,logGets:0,logBytes:0};let discovered=false,closed=false;
  const guard=async()=>{must(!closed,'TRANSPORT_CLOSED');await ports.guard();};
  const registerRun=(id,mode)=>{must(/^[1-9][0-9]{0,15}$/.test(id)&&['Review','RunOnce'].includes(mode)&&
    (!runs.has(id)||runs.get(id)===mode)&&!Array.from(runs).some(([key,value])=>key!==id&&value===mode),'EXACT_RUN_SCOPE');runs.set(id,mode);};
  const readRun=async id=>{await guard();must(runs.has(id)&&++counts.runGets<=CYCLE_SCOPE.githubRunGetsMax,'RUN_GET_SCOPE_OR_BUDGET');
    const raw=await ports.readRun(id);exactRunV6({...raw,status:'completed',conclusion:'success'},
      {runId:id,sourceCommit:m.sourceCommit,workflowId:m.binding.platform.workflowId,reusableCommit:m.binding.platform.reusableCommit});return raw;};
  const readObject=async ref=>{await guard();const key=canonicalJson(ref);must(allowed.has(key),'S3_REFERENCE_ALLOWLIST');
    if(!cache.has(key)){must(++counts.s3Gets<=CYCLE_SCOPE.s3VersionGetsMax,'S3_GET_BUDGET');const value=await ports.readObject(ref);
      must(value.versionId===ref.versionId&&value.encryption==='AES256'&&value.contentLength>0&&value.contentLength<=1000000&&
        await sha256Hex(value.value)===ref.sha256,'S3_OBJECT');assertEvidenceSafeV5(value.value);cache.set(key,structuredClone(value));
      await ports.record('object-'+counts.s3Gets,{reference:ref,object:value});}
    return structuredClone(cache.get(key));};
  return Object.freeze({registerRun,readRun,readObject,counts:()=>({...counts}),
    async discover(id){await guard();must(!discovered&&runs.get(id)==='Review','DISCOVER_ONCE');discovered=true;
      const run=await readRun(id);must(run.status==='completed'&&run.conclusion==='success','REVIEW_NOT_COMPLETE');
      counts.jobsGets++;const jobs=await ports.readJobs(id);
      must(jobs.total_count===1&&jobs.jobs?.length===1,'EXACT_REVIEW_JOB');const job=jobs.jobs[0];
      must(String(job.run_id)===id&&job.run_attempt===1&&job.head_sha===m.sourceCommit&&job.status==='completed'&&job.conclusion==='success'&&
        /^[1-9][0-9]{0,15}$/.test(String(job.id)),'REVIEW_JOB_BINDING');counts.logGets++;
      const text=await ports.readLog(String(job.id));counts.logBytes=Buffer.byteLength(text);
      const summary=reviewSummaryFromLog(text,CYCLE.jobId,id);allowed.add(canonicalJson(summary.saved));
      const p=(await readObject(summary.saved)).value;
      must(p.schema==='techlong/platform-cloud-result/v6'&&p.mode==='Review'&&p.jobId===CYCLE.jobId&&p.manifestSha256===summary.manifestSha256&&
        same(p.run,{repository:S.repository,runId:id,runAttempt:1,commitSha:m.sourceCommit}),'REVIEW_RESULT_BINDING');
      assertReferenceV6(p.cloudReportReference,evidenceKeyV5('manifest.json',{jobId:CYCLE.jobId,manifestSha256:summary.manifestSha256}));
      allowed.add(canonicalJson(p.cloudReportReference));const refs={resultReference:summary.saved,manifestReference:p.cloudReportReference,manifestSha256:summary.manifestSha256};
      await ports.record('review-result-discovery',{runId:id,...refs,checkedAt:now(),logIsLocatorNotProof:true});return refs;
    },close(){closed=true;cache.clear();runs.clear();}});
}
export async function openCycleTransport({manifest:m,credentials,guard,loadToken,record,signal}){
  let token=await loadToken();must(typeof token==='string'&&token.length>0&&token.length<16000&&!/[\r\n]/.test(token),'GITHUB_READ_CREDENTIAL');
  const headers=()=>({authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'Techlong-Reviewed-Hosted-Cycle'});
  const url=p=>'https://api.github.com/repos/'+S.repository+'/'+p;
  const get=async(p,json=true)=>{await guard();const r=await fetch(url(p),{method:'GET',headers:headers(),redirect:json?'error':'manual',
    signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});return json?JSON.parse(await boundedText(r,256000)):r;};
  const s3=new S3Client({region:E.region,endpoint:'https://s3.ca-central-1.amazonaws.com',credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true});
  const reads=createPublisherReadsV6({s3,githubToken:token,signal,fetch:async(u,o)=>{must(o.method==='GET','GITHUB_GET_ONLY');await guard();return fetch(u,o);}});
  const transport=createCycleTransport({manifest:m,ports:{guard,record,readRun:reads.readRun,readObject:reads.readObject,
    readJobs:id=>get('actions/runs/'+id+'/attempts/1/jobs?per_page=100'),async readLog(id){
      const r=await get('actions/jobs/'+id+'/logs',false);must(r.status===302,'LOG_REDIRECT');const u=new URL(r.headers.get('location'));
      must(u.protocol==='https:'&&u.hostname.endsWith('.blob.core.windows.net')&&!u.username&&!u.password&&!u.port,'LOG_STORAGE');
      // Signed blob URL only, never forward the GitHub Authorization header.
      const body=await fetch(u,{method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      return boundedText(body,CYCLE_SCOPE.downloadedLogBytesMax);
    }}});
  return Object.freeze({...transport,close(){transport.close();reads.dispose();s3.destroy();token=undefined;}});
}
