import {P,B,must,safeCode,assertInventory} from './contract.mjs';
export async function deployHosting({manifest:m,sha,io,now=Date.now}){
  const started=now(),guard=async()=>{must(now()<Date.parse(m.expiresAt)&&now()-started<20*60000,'WRITE_WINDOW');await io.cloud.source();};
  const pre=await io.cloud.inventory();assertInventory(pre,m.inventory);await guard();
  await io.consume({manifestSha256:sha,nonce:m.nonce,startedAtUtc:new Date(now()).toISOString(),retryAllowed:false});
  let phase='SLOT_CONSUMED',stackId,hostingExpiresAt,createAck=false,completed=false,observation;const errors=[];
  try{
    phase='CREATE_HOSTING';await guard();await io.cloud.assertAccessFresh();
    const createAt=now();must(createAt<Date.parse(m.expiresAt)&&createAt-started<20*60000,'WRITE_WINDOW');
    hostingExpiresAt=new Date(createAt+2*3600000).toISOString();await io.record('create-intent',{createAtUtc:new Date(createAt).toISOString(),hostingExpiresAt,roleId:B.roleId});
    stackId=await io.cloud.create(m.nonce,hostingExpiresAt);createAck=true;await io.record('create-ack',{stackId,hostingExpiresAt});
    phase='WAIT_HOSTING';const deadline=createAt+25*60000;
    while(now()<deadline){const s=await io.cloud.stack();must(s?.StackId===stackId,'STACK_ID');
      if(s.StackStatus==='CREATE_COMPLETE'){completed=true;break;}must(s.StackStatus==='CREATE_IN_PROGRESS','STACK_TERMINAL');await io.pause(10000);}
    must(completed,'OBSERVATION_TIMEOUT');
  }catch(e){errors.push({stage:phase,code:safeCode(e)});}
  // Metadata only, also after failure/ambiguous Create ACK. No second Create or cleanup.
  try{observation=await io.cloud.observe(m.nonce,stackId,hostingExpiresAt);await io.record('independent-observation',observation);}
  catch(e){errors.push({stage:'INDEPENDENT_OBSERVATION',code:safeCode(e)});}
  const ok=createAck&&completed&&errors.length===0&&observation?.verified===true;
  const result={schema:'techlong/platform-hosting-deployment-result/v1',manifestSha256:sha,nonce:m.nonce,
    outcome:ok?'HOSTING_METADATA_VERIFIED_APPLICATION_ACCEPTANCE_PENDING':'HOSTING_REQUIRES_REVIEW_NO_RETRY',
    stackId:stackId??null,roleId:B.roleId,hostingExpiresAt:hostingExpiresAt??null,url:'https://'+P.domain,errors,awsCalls:{...io.cloud.counts},
    directSecretValueReads:0,directSqlConnections:0,directHttpRequests:0,applicationAcceptancePassed:false,automaticCleanup:false,retryAllowed:false};
  await io.record('result',result);return result;
}
