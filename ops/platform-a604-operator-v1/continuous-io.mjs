// Explicit CLI-only ports. Construction does not discover credentials or connect.
import pg from 'pg';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client} from '@aws-sdk/client-s3';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {git,readText,ROOT,absent,writeOnce} from '../platform-image-source-v2/files.mjs';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,createPublisherReadsV6} from '../platform-publisher-v6/io.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {readLaunchSnapshot} from '../platform-recovery-launch-v1/io.mjs';
import {createDispatchOperation} from '../platform-delegated-approval-v1/operation.mjs';
import {exactRunV6,resultKeyV6,assertReferenceV6,S} from '../platform-cloud-v6/contract.mjs';
import {reviewTiming} from '../platform-delegated-publisher-v1/successor.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {P} from '../platform-recovery-hosting-v1/plan.mjs';
import {D,PUBLISH_SLOT,INSPECT_PUBLISH_SLOT} from './scope.mjs';
import {slot,auditKey,oldHistory,must,same} from './policy.mjs';
import {readA604State,createA604DispatchIo,createA604PublisherIo} from './io.mjs';
import {CONTINUOUS} from './continuous.mjs';

async function boundedText(response,max){
  must(response.body,'CONTINUOUS_BODY');const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;must(size<=max,'CONTINUOUS_BODY_SIZE');parts.push(r.value);}}
  finally{reader.releaseLock();}return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,size));
}
export function extractReviewReference(logs,{jobId,runId,mode='Review'}){
  must(['Review','RunOnce','Inspect'].includes(mode),'CONTINUOUS_LOG_MODE');
  must(typeof logs==='string'&&Buffer.byteLength(logs)<=2000000,'CONTINUOUS_LOG_SIZE');const candidates=[];
  for(const line of logs.split(/\r?\n/)){const start=line.indexOf('{');if(start<0)continue;let v;
    try{v=JSON.parse(line.slice(start));}catch{continue;}
    if(v.mode===mode&&v.jobId===jobId&&v.saved)candidates.push(v);
  }
  must(candidates.length===1,'CONTINUOUS_LOG_RESULT');const value=candidates[0];
  assertReferenceV6(value.saved,resultKeyV6(jobId,value.manifestSha256,runId));return value.saved;
}
const defaults={D,CONTINUOUS,PUBLISH_SLOT,INSPECT_PUBLISH_SLOT,slot,auditKey,oldHistory,readA604State,createA604DispatchIo,createA604PublisherIo};
export function createContinuousIo({manifest:m,output,record,policy,assertSource,verifyCi,capability}){
  const D=capability?.definition??defaults.D,CONTINUOUS=capability?.continuous??defaults.CONTINUOUS,
    PUBLISH_SLOT=capability?.publishSlot??defaults.PUBLISH_SLOT,INSPECT_PUBLISH_SLOT=capability?.inspectSlot??defaults.INSPECT_PUBLISH_SLOT,
    slot=capability?.slot??defaults.slot,auditKey=capability?.auditKey??defaults.auditKey,oldHistory=capability?.history??defaults.oldHistory,
    readA604State=capability?.readState??defaults.readA604State,createA604DispatchIo=capability?.dispatchIo??defaults.createA604DispatchIo,
    createA604PublisherIo=capability?.publisherIo??defaults.createA604PublisherIo;
  let token,closed=false;const g=m.grant;
  const counts={monitorGithubGets:0,officialLogDownloads:0,captureSts:0,captureS3Gets:0,configReads:0,connections:0,queries:0,runOnceDispatches:0};
  const auth=()=>{if(!token){let raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath='+S.repository+'.git\n\n');
    token=raw.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);raw=undefined;must(token,'CONTINUOUS_GITHUB_AUTH');}return token;};
  const get=async(suffix,manual=false)=>{must(!closed&&++counts.monitorGithubGets<=m.effects.monitorGithubGetsMax,'CONTINUOUS_GITHUB_BUDGET');
    // All requests from this adapter are GET; no environment approval endpoint.
    must(new RegExp('^actions/(?:runs/[1-9][0-9]*(?:/attempts/1/jobs\\?per_page=100|/pending_deployments)?|jobs/[1-9][0-9]*/logs)$').test(suffix),'CONTINUOUS_GET_SCOPE');
    const r=await fetch('https://api.github.com/repos/'+S.repository+'/'+suffix,{headers:{authorization:'Bearer '+auth(),accept:'application/vnd.github+json'},
      redirect:manual?'manual':'error',signal:AbortSignal.timeout(20000)});
    if(manual)return r;must(r.status===200,'CONTINUOUS_GITHUB_READ');return JSON.parse(await boundedText(r,300000));};
  const exact=run=>exactRunV6(run,{runId:String(run.id),sourceCommit:m.sourceCommit,workflowId:g.binding.release.workflowId,reusableCommit:g.binding.release.reusableCommit});
  return {record,assertSource,verifyCi,
    async assertUnused(){for(const f of [CONTINUOUS.slot,slot('Review'),slot('RunOnce'),slot('Inspect'),PUBLISH_SLOT,INSPECT_PUBLISH_SLOT])await absent(f);},
    claim:v=>writeOnce(CONTINUOUS.slot,{...v,output,consumedAt:Date.now(),retryAllowed:false}),
    dispatchReview(grant,guard){must(same(grant,g),'CONTINUOUS_GRANT');return this.dispatch('Review',g.seed.planSha256,guard);},
    async dispatch(mode,planSha256,guard){
      must(D.modes.includes(mode),'CONTINUOUS_MODE');const started=Date.now(),localGuard=async()=>{await guard();must(Date.now()-started<D.runMs,'CONTINUOUS_DISPATCH_DEADLINE');};
      const io=createA604DispatchIo({grant:g,mode,planSha256,record:(n,v)=>record('dispatch-'+n,v),guard:localGuard,verifyCi,
        claim:()=>writeOnce(slot(mode),{grantSha256:g.grantSha256,sourceCommit:m.sourceCommit,mode,planSha256,
          outerSha256:m.manifestSha256,output,consumedAt:Date.now(),retryAllowed:false})});
      return createDispatchOperation({definition:D,approve:policy.approve,target:policy.target,history:oldHistory,key:auditKey,historyModes:D.modes})
        ({grant:g,approved:g.grantSha256,mode,planSha256,io});
    },
    async waitReview(ack,deadline,guard){let announced=false;
      for(let i=0;i<CONTINUOUS.pollsMax;i++){
        await guard();must(Date.now()<deadline,'CONTINUOUS_WAIT_EXPIRED');const r=await get('actions/runs/'+ack.runId);
        must(String(r.id)===ack.runId&&r.head_sha===m.sourceCommit&&r.run_attempt===1&&r.event==='workflow_dispatch'&&
          r.head_branch==='main'&&String(r.actor?.id)===g.binding.release.actorId&&String(r.workflow_id)===g.binding.release.workflowId,'CONTINUOUS_RUN_IDENTITY');
        if(r.status==='completed'){must(r.conclusion==='success','CONTINUOUS_RUN_FAILED');exact(r);await record('review-run',r);return r;}
        if(r.status==='waiting'&&!announced){const pending=await get('actions/runs/'+ack.runId+'/pending_deployments');
          must(pending.length===1&&pending[0].environment?.id===24613410405&&pending[0].environment.name===D.environment&&
            pending[0].reviewers?.some(x=>x.type==='User'&&x.reviewer?.id===14145707),'CONTINUOUS_HUMAN_GATE');
          announced=true;const notice={outcome:'REVIEW_GITHUB_ENVIRONMENT_WAITING',mode:ack.mode,runId:ack.runId,url:ack.url,environment:D.environment};
          await record('human-gate',notice);console.log(JSON.stringify(notice));}
        await new Promise(resolve=>setTimeout(resolve,Math.min(CONTINUOUS.pollMs,Math.max(1,deadline-Date.now()))));
      }throw Error('A604_CONTINUOUS_POLL_BUDGET');
    },
    async capture(ack,run,guard){let sts,s3,reads,c;
      try{
        await guard();exact(run);const jobs=await get('actions/runs/'+ack.runId+'/attempts/1/jobs?per_page=100');
        must(jobs.total_count===1&&jobs.jobs.length===1&&String(jobs.jobs[0].run_id)===ack.runId&&jobs.jobs[0].head_sha===m.sourceCommit&&
          jobs.jobs[0].steps.every(s=>s.status==='completed'&&s.conclusion==='success'),'CONTINUOUS_JOB_STEPS');
        const log=await get('actions/jobs/'+jobs.jobs[0].id+'/logs',true);must(log.status===302,'CONTINUOUS_LOG_LOCATION');
        const location=new URL(log.headers.get('location'));must(location.protocol==='https:'&&
          (location.hostname.endsWith('.blob.core.windows.net')||location.hostname.endsWith('.actions.githubusercontent.com')),'CONTINUOUS_LOG_HOST');
        must(++counts.officialLogDownloads===1,'CONTINUOUS_LOG_ONCE');const response=await fetch(location,{redirect:'error',signal:AbortSignal.timeout(20000)});
        must(response.status===200,'CONTINUOUS_LOG_DOWNLOAD');const logs=await boundedText(response,2000000),resultReference=extractReviewReference(logs,{jobId:D.jobId,runId:ack.runId,mode:ack.mode});
        await record('review-result-reference',{reference:resultReference,logSha256:await sha256Hex(logs)});
        const cfg={region:P.region,credentials:fromLoginCredentials({profile:P.profile,ignoreCache:true}),maxAttempts:1,ignoreConfiguredEndpointUrls:true};
        sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});must(++counts.captureSts===1,'CONTINUOUS_STS_ONCE');
        const id=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(20000)});
        must(id.Account===P.account&&id.Arn===P.sourceArn&&id.UserId===P.sourceId,'CONTINUOUS_SOURCE');
        s3=new S3Client({...cfg,endpoint:'https://s3.ca-central-1.amazonaws.com'});reads=createPublisherReadsV6({s3,fetch,githubToken:auth()});
        const objects=[],read=async reference=>{await guard();must(++counts.captureS3Gets<=(ack.mode==='Review'?4:6),'CONTINUOUS_OBJECT_BUDGET');
          const object=await reads.readObject(reference);objects.push({reference,object});return object.value;};
        const result=await read(resultReference);must(result.mode===ack.mode&&result.jobId===D.jobId&&result.run.runId===ack.runId,'CONTINUOUS_RESULT');
        const envelopeRef=ack.mode==='Review'?result.cloudReportReference:JSON.parse(ack.plan.inputs.manifest);
        assertReferenceV6(envelopeRef,`worker-v5/${S.instanceId}/${D.jobId}/${result.manifestSha256}/manifest.json`);
        const envelope=await read(envelopeRef);
        // Preserve the original15m claim,8m execution and2m publication reserves.
        if(ack.mode==='Review'){const timing=reviewTiming(envelope.innerManifest,g.binding.factsApproval.expiresAt,Date.now());
          must(timing.expiresAt>Date.now()+120000,'CONTINUOUS_PREPARE_WINDOW');}
        else{
          assertReferenceV6(result.cloudReportReference,`worker-v5/${S.instanceId}/${D.jobId}/${envelope.innerManifest.manifestSha256}/run-${ack.runId}-1/${ack.mode==='RunOnce'?'run':'inspect'}.json`);
          await read(result.cloudReportReference);
          if(ack.mode==='RunOnce'){
            assertReferenceV6(result.executionReference,`worker-v5/${S.instanceId}/${D.jobId}/${result.manifestSha256}/execution-reference-${ack.runId}-v1.json`);
            await read(result.executionReference);
          }
        }
        await read(g.binding.packageReference);await read(JSON.parse(g.seed.plan.inputs.installation));
        await guard();must(++counts.configReads===1,'CONTINUOUS_CONFIG_ONCE');let url=await readAuthV6(g.auth),config=await publisherDatabaseConfigV6(url);url=undefined;
        c=new pg.Client({...config,application_name:'Techlong-A604-Continuous-Readiness'});config=undefined;c.on('error',()=>{closed=true;});counts.connections++;
        await c.connect();must(c.connection.stream.encrypted===true&&c.connection.stream.authorized===true,'CONTINUOUS_TLS');
        const reader={async query(text,values){must((!closed||text==='ROLLBACK')&&++counts.queries<=45,'CONTINUOUS_SQL_BUDGET');await guard();
          must((/^SELECT\b/.test(text)&&(!/^SELECT\s+(?:deployment_control_v6|techlong_cloud_worker_v5)\./.test(text)||
            text==='SELECT deployment_control_v6.load_plan($1) AS value'))||
            ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','SET LOCAL search_path=pg_catalog','COMMIT','ROLLBACK'].includes(text),'CONTINUOUS_READONLY_SQL');
          return c.query(text,values);}};
        const contract=sqlContract((await readText(ROOT+'/'+I.sql,3000000)).replaceAll('\r\n','\n'));let entry;
        const snapshot=await readLaunchSnapshot(reader,{contract,readState:async(q,options)=>{const state=await readA604State(q,options);
          const r=await q.query('SELECT deployment_control_v6.load_plan($1) AS value',[ack.planSha256]);must(r.rows.length===1,'CONTINUOUS_ENTRY');entry=r.rows[0].value;return state;}});
        const captured={entry,snapshot,objects,resultReference};await record('captured-material',captured);return captured;
      }finally{try{await c?.end();}finally{reads?.dispose();sts?.destroy();s3?.destroy();}}
    },
    async publisherIo(inner,captured,guard){return createA604PublisherIo({manifest:inner,
      packageValue:captured.objects.find(o=>same(o.reference,g.binding.packageReference)).object.value,
      record:(n,v)=>record('publisher-'+n,v),assertSource:guard,verifyCi,
      claim:v=>writeOnce(PUBLISH_SLOT,{...v,outerSha256:m.manifestSha256,output,consumedAt:Date.now(),retryAllowed:false}),githubToken:auth});},
    async close(){closed=true;token=undefined;await record('continuous-io-counts',{...counts,githubEnvironmentApprovals:0,resourceWrites:0,secretValueReads:0,automaticRetries:0});},
  };
}
