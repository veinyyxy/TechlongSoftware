import {P,must,policySame,handoffPolicy,safeCode} from './contract.mjs';
import {sourceOnlyPolicy} from '../platform-web-credential-v1/contract.mjs';
export async function installAccess({manifest:m,sha,io,now=Date.now}){
  const start=now(),guard=async()=>{must(now()<Date.parse(m.expiresAt)&&now()-start<20*60000,'ACCESS_WINDOW');await io.cloud.source();};
  const pre=await io.cloud.accessPrestate();must(pre.accessNamesAbsent&&pre.secret.arn===P.secretArn&&pre.kms.arn===P.kmsArn,'ACCESS_PRESTATE');await guard();
  await io.consume({manifestSha256:sha,nonce:m.nonce,startedAtUtc:new Date(now()).toISOString(),retryAllowed:false});
  let stackId,installed,observed,phase='SLOT_CONSUMED',handoffAck=false;const errors=[];
  try{
    phase='CREATE_ACCESS_STACK';await guard();stackId=await io.cloud.createAccess(m.nonce);await io.record('create-ack',{stackId});
    phase='WAIT_ACCESS_STACK';let complete=false;
    for(let n=0;n<60;n++){const s=await io.cloud.stack(P.accessStack);must(s?.StackId===stackId,'STACK_ID');
      if(s.StackStatus==='CREATE_COMPLETE'){complete=true;break;}must(s.StackStatus==='CREATE_IN_PROGRESS','STACK_TERMINAL');await io.pause(10000);}
    must(complete,'STACK_WAIT_TIMEOUT');phase='VERIFY_ACCESS';installed=await io.cloud.inspectAccess(m.nonce,stackId);await io.record('access-installed',installed);
    phase='SECRET_HANDOFF';await guard();await io.cloud.secret(sourceOnlyPolicy());await io.cloud.assertRoleId(installed.roleId);
    await io.cloud.putHandoff();handoffAck=true;await io.record('handoff-ack',{secretArn:P.secretArn,roleId:installed.roleId,policy:handoffPolicy()});
  }catch(e){errors.push({stage:phase,code:safeCode(e)});}
  // Independent metadata only, also after failure. Never a create/policy write retry.
  try{const access=stackId?await io.cloud.inspectAccess(m.nonce,stackId):null,secret=await io.cloud.secret(null);
    observed={access,secret,secretPolicyState:policySame(secret.policy,handoffPolicy())?'HANDOFF':policySame(secret.policy,sourceOnlyPolicy())?'SOURCE_ONLY':'UNREVIEWED'};
    await io.record('independent-observation',observed);
  }catch(e){errors.push({stage:'INDEPENDENT_READ',code:safeCode(e)});}
  const ok=errors.length===0&&handoffAck&&installed?.roleId&&observed?.access?.roleId===installed.roleId&&observed.secretPolicyState==='HANDOFF';
  const result={schema:'techlong/platform-ecs-access-result/v1',manifestSha256:sha,nonce:m.nonce,
    outcome:ok?'ACCESS_HANDOFF_INDEPENDENTLY_VERIFIED':'ACCESS_REQUIRES_REVIEW_NO_RETRY',stackId:stackId??null,
    roleId:installed?.roleId??null,roleArn:P.roleArn,secretArn:P.secretArn,versionId:P.secretVersion,errors,awsCalls:{...io.cloud.counts},
    secretValueReads:0,sqlConnections:0,hostingDeployed:false,hostingWindowStarted:false,retryAllowed:false};await io.record('result',result);return result;
}
