// Exactly one guarded existing-stack update; all remaining cloud operations read metadata.
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {CloudFormationClient,UpdateStackCommand,DescribeStacksCommand} from '@aws-sdk/client-cloudformation';
import {createVerifiedCredentialPort} from '../platform-operations-v6/credentials.mjs';
import {currentCloudInventory} from './current-cloud.mjs';
import {K,P} from '../platform-hosted-window-v6/contract.mjs';
import {CYCLE_SCOPE,cycleUpdateRequest,validateCycleReview,must,same} from './cycle-plan.mjs';
export async function cycleCloud({manifest:m,approved,guard,assertClaim,deadline,signal,inspect=false,validateReview=validateCycleReview}){
  must(typeof assertClaim==='function','EXPLICIT_CLAIM_PORT');
  const limit=inspect?CYCLE_SCOPE.inspectAwsMetadataMax:CYCLE_SCOPE.runAwsMetadataMax,counts={metadata:0,updates:0};
  const handler=()=>new NodeHttpHandler({httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000});
  const base={region:P.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true},loader=fromLoginCredentials({profile:P.profile,ignoreCache:true});
  const tick=()=>must(++counts.metadata<=limit,'AWS_METADATA_BUDGET');
  const source=createVerifiedCredentialPort({guard,deadline,expectedIdentity:{Account:P.account,Arn:P.sourceArn,UserId:P.sourceId},load:()=>loader(),
    verifyIdentity:async credentials=>{tick();const c=new STSClient({...base,credentials,endpoint:'https://sts.ca-central-1.amazonaws.com',requestHandler:handler()});
      try{return await c.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});}finally{c.destroy();}}});
  const cfn=new CloudFormationClient({...base,credentials:source.credentials,endpoint:'https://cloudformation.ca-central-1.amazonaws.com',requestHandler:handler()});
  let snapshots=0;
  return Object.freeze({credentials:source.credentials,async preflight(){await guard();await source.credentials();},counts:()=>({...counts,...source.counts()}),
    async snapshot(){await guard();must(++snapshots<=(inspect?1:2),'SNAPSHOT_BUDGET');const available=Math.min(80,limit-counts.metadata);
      must(available>=60,'SNAPSHOT_METADATA_BUDGET');const reader=await currentCloudInventory({maxMetadata:available});
      try{const v=await reader.snapshot();counts.metadata+=v.metadataCalls;must(counts.metadata<=limit,'AWS_METADATA_BUDGET');return v;}
      catch{counts.metadata+=available;throw Error('HOSTED_CYCLE_SNAPSHOT_STOPPED');}finally{reader.close();}},
    async lease(){await guard();tick();const r=await cfn.send(new DescribeStacksCommand({StackName:K.stackId}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      must(r.Stacks?.length===1&&r.Stacks[0].StackId===K.stackId&&r.Stacks[0].StackStatus==='UPDATE_COMPLETE','INSTALLED_LEASE_STACK');
      return JSON.parse(r.Stacks[0].Parameters.find(p=>p.ParameterKey==='ControllerLease').ParameterValue);},
    async stack(){await guard();tick();const r=await cfn.send(new DescribeStacksCommand({StackName:K.stackId}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      must(r.Stacks?.length===1&&r.Stacks[0].StackId===K.stackId,'STACK_ID');return {StackId:K.stackId,StackStatus:r.Stacks[0].StackStatus,
        LastUpdatedTime:r.Stacks[0].LastUpdatedTime?.toISOString()??null};},
    async update(intent){must(!inspect&&counts.updates===0,'UPDATE_ONCE');await guard();await validateReview(m,approved,Date.now(),{running:true});
      await assertClaim();must(intent.manifestSha256===approved&&same(intent.request,cycleUpdateRequest(m,intent.intentAt))&&Date.now()>=intent.intentAt&&
        Date.now()-intent.intentAt<30000,'UPDATE_INTENT');await source.credentials();await guard();
      await assertClaim();must(Date.now()-intent.intentAt<30000,'UPDATE_INTENT_EXPIRED');counts.updates++;
      const r=await cfn.send(new UpdateStackCommand(intent.request),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
      must(r.StackId===K.stackId,'UPDATE_ACK');return {StackId:r.StackId,OperationId:r.OperationId??null,sdkAttempts:r.$metadata?.attempts??null};
    },close(){source.close();cfn.destroy();}});
}
