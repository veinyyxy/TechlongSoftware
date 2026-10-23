import {H,P,must,same,canonical,lease,validate,assertBaseline,safeCode} from './contract.mjs';
// One existing CreateStack pattern, with late-bound public lease. No child executor.
export async function run({text,sha,io,now=Date.now}){
  const m=validate(text,sha,now()),started=now();let last=started;
  const guard=async()=>{const at=now();must(at>=last&&at<m.expiresAt&&at-started<H.runMs,'WRITE_WINDOW');last=at;await io.guard(m);};
  const fresh=await io.inventory();assertBaseline(fresh.baseline);
  must(same(fresh.baseline,m.baseline)&&now()>=started&&now()-started<120000,'FRESH_BASELINE');await guard();
  await io.consume({manifestSha256:sha,nonce:m.nonce,startedAtUtc:new Date(now()).toISOString(),retryAllowed:false});
  let stage='SLOT_CONSUMED',stackId=null,controlLease=null,hostingExpiresAt=null,observation=null,acknowledged=false,completed=false;
  const errors=[];
  try{
    stage='FINAL_ACCESS';await io.assertSupply();await guard();
    const at=now();must(at>=last&&at<m.expiresAt&&at-started<H.runMs,'WRITE_WINDOW');
    controlLease=lease(at);hostingExpiresAt=new Date(at+H.hostingMs).toISOString();
    stage='CREATE_HOSTING';await io.record('create-intent',{manifestSha256:sha,nonce:m.nonce,createAtUtc:new Date(at).toISOString(),
      hostingExpiresAt,controlLease,templateSha256:m.templateSha256,retryAllowed:false});
    // Persist-before-submit, then a single SDK attempt. An unknown ACK is NOT retried.
    stackId=await io.create(m.nonce,hostingExpiresAt,controlLease);acknowledged=true;
    await io.record('create-ack',{manifestSha256:sha,nonce:m.nonce,stackId,hostingExpiresAt,controlLease});
    stage='WAIT_HOSTING';const deadline=at+23*60000;
    for(let n=0;n<139&&now()<deadline;n++){
      const s=await io.stack();must(s?.StackId===stackId,'STACK_ID');
      if(s.StackStatus==='CREATE_COMPLETE'){completed=true;break;}
      must(s.StackStatus==='CREATE_IN_PROGRESS','STACK_TERMINAL');await io.pause(10000);
    }must(completed,'OBSERVATION_TIMEOUT');
  }catch(e){errors.push({stage,code:safeCode(e)});}
  // Independent metadata clients, also after failure; never supplemental writes.
  try{observation=await io.observe({nonce:m.nonce,stackId,hostingExpiresAt,controlLease});await io.record('independent-observation',observation);}
  catch(e){errors.push({stage:'INDEPENDENT_METADATA',code:safeCode(e)});}
  const result={schema:'techlong/platform-hosted-deploy-result/v6',manifestSha256:sha,nonce:m.nonce,stackId,hostingExpiresAt,controlLease,
    outcome:acknowledged&&completed&&observation?.verified===true&&!errors.length?'HOSTING_METADATA_VERIFIED_CONTROL_ACCEPTANCE_PENDING':'HOSTING_REQUIRES_INSPECT_NO_RETRY',
    imageDigest:H.imageDigest,imageSource:H.imageSource,url:'https://'+P.domain,errors,awsCalls:io.counts(),
    applicationAcceptancePassed:false,controlAcceptancePassed:false,directSecretValueReads:0,directSql:0,applicationHttp:0,
    managedSecretReadsNotBounded:true,automaticCleanup:false,retryAllowed:false};
  // Keep the canonical lease bytes identical between CFN and ECS verification.
  if(controlLease)must(canonical(controlLease)===canonical(lease(controlLease.issuedAt)),'LEASE_DRIFT');
  await io.record('result',result);return result;
}
