import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {P,S,hash,must,same,validateOuter,innerReview} from './review.mjs';
import {ROOT,EVIDENCE,cleanSource,pins,readText,writeOnce,absent,directory} from './files.mjs';
import {createAws,verifySnapshot,expectedTemplate} from './aws.mjs';
import {createGithub} from './github.mjs';
import {lockedPublisherFoundation} from '../platform-image-recovery-v2/publisher-foundation.mjs';
export function errorCode(e){return /^[A-Za-z0-9_]+$/.test(e?.message??'')?e.message:(/^[A-Za-z0-9_]+$/.test(e?.name??'')?e.name:'UNKNOWN');}
export async function runControlled({text,approvedSha,ports,now=Date.now,review={validateOuter,innerReview}}){
  const m=review.validateOuter(text,approvedSha,now());const head=await ports.preflight(m);
  const inner=review.innerReview(m,head,now()),innerText=JSON.stringify(inner),innerSha=hash(innerText);
  await ports.consume({schema:'techlong/platform-publication-source-intent/v2',outerSha256:approvedSha,innerSha256:innerSha,
    innerReview:innerText,nonce:m.nonce,head,startedAtUtc:new Date(now()).toISOString(),retryAllowed:false});
  const errors=[];let run,locked=false,published;
  try{
    await ports.record('inner-review',{text:innerText,sha256:innerSha});
    await ports.update(inner,'grant');await ports.verify(inner,'grant');
    const ack=await ports.dispatch(inner,innerText,innerSha);
    await ports.record('dispatch-ack',ack); // durable ACK before any polling/cleanup can fail
    run=await ports.wait(ack,inner,innerSha,m.callerWorkflowId);
    await ports.record('run-completed',run);
  }catch(e){errors.push({stage:'grant_or_publication',code:errorCode(e)});}
  finally{
    // Cleanup authority survives approval expiry/head drift after intent. There
    // is one revoke attempt, no direct-IAM fallback or automatic write replay.
    try{await ports.update(inner,'revoke');}catch(e){errors.push({stage:'revoke',code:errorCode(e)});}
    try{await ports.verify(inner,'revoke');locked=true;}catch(e){errors.push({stage:'locked_inspect',code:errorCode(e)});}
  }
  try{published=await ports.published();}catch(e){errors.push({stage:'publication_inspect',code:errorCode(e)});}
  const result={schema:'techlong/platform-publication-source-result/v2',outerSha256:approvedSha,innerSha256:innerSha,
    outcome:errors.length?'REQUIRES_INDEPENDENT_INSPECT':'PUBLISHED_AND_INDEPENDENTLY_LOCKED',
    runId:run?.id??null,locked,published:published??null,errors,retryAllowed:false};
  await ports.record('result',result);return result;
}
export async function prepare(output){
  must(/^F:\/ChatGPT_workshop\/techlong-platform-source-v2-review-[a-z0-9-]+\.json$/.test(output??''),'SOURCE_PREPARE_OUTPUT');
  await absent(output);await absent(path.join(EVIDENCE,S.intentFile));
  const head=await cleanSource(),aws=await createAws(),gh=createGithub();
  try{
    const snapshot=await aws.snapshot();verifySnapshot(snapshot,lockedPublisherFoundation(),{initial:true});
    const metadata=await gh.metadata(head),sourcePins=await pins();
    const riskSha256=hash((await readText(path.join(ROOT,S.riskFile))).replaceAll('\r\n','\n'));
    const issued=Date.now(),end=Math.min(issued+48*3600000,Date.parse(P.artifactExpiresAt)),nonce=randomBytes(16).toString('hex');
    const m={schema:'techlong/platform-image-source-review/v2',issuedAt:new Date(issued).toISOString(),expiresAt:new Date(end).toISOString(),
      latestStartAt:new Date(end-3600000).toISOString(),nonce,operatorSourceCommit:head,sourceCiRunId:metadata.sourceCi.id,
      callerWorkflowId:metadata.workflow.id,sourcePins,riskSha256,candidate:{...P},reusableCommit:S.reusableCommit,scope:{...S.scope}};
    const text=JSON.stringify(m,null,2)+'\n';validateOuter(text,hash(text));
    await writeOnce(output+'.facts.json',{schema:'techlong/platform-source-prepare-facts/v2',snapshot,metadata,cloudWrites:0,privateValueReads:0});
    await writeOnce(output,m);return {mode:'Prepare',output,manifestSha256:hash(text),expiresAt:m.expiresAt,latestStartAt:m.latestStartAt,
      grantWindow:'Starts only at RunReviewed; maximum 3600 seconds',cloudWrites:0};
  }finally{aws.close();gh.close();}
}
export async function runReviewed(file,approvedSha,notify=console.log){
  must(/^[a-f0-9]{64}$/.test(approvedSha??''),'SOURCE_NEW_APPROVAL_REQUIRED');
  const text=await readText(file),m=validateOuter(text,approvedSha);await cleanSource(m);
  must(hash((await readText(path.join(ROOT,S.riskFile))).replaceAll('\r\n','\n'))===m.riskSha256,'SOURCE_RISK_DRIFT');
  const intent=path.join(EVIDENCE,S.intentFile);await absent(intent);
  const dir=await directory('techlong-platform-source-v2-'+m.nonce),record=(name,value)=>{
    must(/^[a-z0-9-]+$/.test(name),'SOURCE_RECORD_NAME');return writeOnce(path.join(dir,name+'.json'),value);};
  const aws=await createAws(),gh=createGithub();let initial,executedInner;
  try{
    const result=await runControlled({text,approvedSha,ports:{
      async preflight(){
        const head=await cleanSource(m);await absent(intent);const snapshot=await aws.snapshot();await record('preflight-aws',snapshot);
        verifySnapshot(snapshot,lockedPublisherFoundation(),{initial:true});initial=snapshot;
        const metadata=await gh.metadata(head,m);await record('preflight-github',metadata);
        // Recheck local source after asynchronous credential/network latency.
        must(await cleanSource(m)===head,'SOURCE_FINAL_HEAD');return head;
      },
      consume:v=>writeOnce(intent,v),record,
      async update(inner,phase){
        executedInner=inner;
        if(phase==='revoke'){
          // Let a previously submitted asynchronous grant settle before the one
          // revoke attempt. Timeout is not permission to retry or cancel CFN.
          try{await aws.settled(Date.now()+10*60000);}catch(e){await record('revoke-wait-error',{code:errorCode(e)});}
        }
        await record(phase+'-intent',{phase,stackId:P.stackId,template:expectedTemplate(inner,phase),
          startedAtUtc:new Date().toISOString(),automaticRetry:false});
        const ack=await aws.update(inner,phase);await record(phase+'-ack',ack);
      },
      async verify(inner,phase){
        try{await aws.settled(Date.now()+10*60000);}catch(e){await record(phase+'-settle-error',{code:errorCode(e)});}
        // snapshot() constructs independent read clients, never reuses write response.
        const snapshot=await aws.snapshot();await record(phase+'-independent-readback',snapshot);
        verifySnapshot(snapshot,expectedTemplate(inner,phase));
        if(phase==='grant')must(snapshot.images.imageDetails.length===0,'SOURCE_GRANT_REPOSITORY_NOT_EMPTY');
        must(same(snapshot.boundary.Policy,initial.boundary.Policy)&&same(snapshot.repository.repositories,initial.repository.repositories),'SOURCE_REFERENCES_CHANGED');
      },
      async dispatch(inner,innerText,innerSha){
        must(await cleanSource(m)===inner.dispatchCommit,'SOURCE_DISPATCH_HEAD');
        await record('dispatch-intent',{reviewSha256:innerSha,head:inner.dispatchCommit,workflowId:m.callerWorkflowId,automaticRetry:false});
        return gh.dispatch(inner,innerText,innerSha);
      },
      wait:(ack,inner,sha,id)=>gh.wait(ack,inner,sha,id,async value=>{await record('awaiting-human-environment',value);notify(JSON.stringify(value));}),
      async published(){
        const r=await aws.published();await record('independent-registry-manifest',r);
        const snapshot=await aws.snapshot();await record('final-reference-readback',snapshot);
        verifySnapshot(snapshot,expectedTemplate(executedInner,'revoke'));
        must(snapshot.images.imageDetails.length===1&&same(snapshot.images.imageDetails[0].imageTags,[P.targetTag])&&
          snapshot.images.imageDetails[0].imageDigest===r.verified.manifestDigest,'SOURCE_FINAL_ONE_IMAGE');
        return r.verified;
      },
    }});
    return {mode:'RunReviewed',output:path.join(dir,'result.json'),...result};
  }finally{aws.close();gh.close();}
}
export async function inspectReviewed(file,sha){
  const text=await readText(file),parsed=JSON.parse(text);
  // Audit retains the exact approved bytes but may happen after the write window.
  const m=validateOuter(text,sha,Date.parse(parsed.issuedAt));
  const intent=JSON.parse(await readText(path.join(EVIDENCE,S.intentFile)));
  must(intent.outerSha256===sha&&intent.nonce===m.nonce,'SOURCE_AUDIT_INTENT');
  must(typeof intent.innerReview==='string'&&hash(intent.innerReview)===intent.innerSha256,'SOURCE_AUDIT_INNER');
  const inner=JSON.parse(intent.innerReview),aws=await createAws();
  try{
    const snapshot=await aws.snapshot(),errors=[];let state;
    try{state=verifySnapshot(snapshot,expectedTemplate(inner,'revoke'));}catch(e){errors.push(errorCode(e));}
    const output=path.join(EVIDENCE,'techlong-platform-source-v2-inspect-'+Date.now()+'.json');
    const result={mode:'Inspect',outcome:errors.length?'LOCK_NOT_PROVED':'LOCKED_OBSERVED',state:state??null,snapshot,errors,cloudWrites:0};
    await writeOnce(output,result);return {mode:'Inspect',output,outcome:result.outcome,state:result.state,cloudWrites:0};
  }finally{aws.close();}
}
