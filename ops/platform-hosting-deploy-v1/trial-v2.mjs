// One new acceptance trial after verified W7p cleanup, not a retry of W7o.
import {P,same} from '../platform-ecs-v1/contract.mjs';
const must=(v,c)=>{if(!v)throw Error('PLATFORM_HOSTING_DEPLOY_'+c);};
export const Q=Object.freeze({generation:2,phase:'W7q',
  previousStackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/54a0d7d0-ce87-11f1-aa1a-0eb4b7868f6f',
  previousTaskDefinition:`arn:aws:ecs:${P.region}:${P.account}:task-definition/${P.family}:1`,
  cleanupManifestSha256:'d71670b132fe6e0613ff4f9a97970d5a89fa05b118c04ee5366c7d40eac7829d',
  cleanupObservedFile:'ops/aws-sandbox/reviews/platform-hosting-w7p.cleanup-observed.json',
  cleanupObservedSha256:'1fefdab3b33a9a3dc250b239db0fec487497d652ed72d66ceb3b1ab4599808d6',
  cleanupVerificationFile:'F:/ChatGPT_workshop/techlong-platform-hosting-cleanup-909671516a0e75efbfec4b22856b6089/offline-verification.json',
  cleanupVerificationSha256:'b2b5795e53da938243fc7173d67d49cc6f23a932b4813501dc97e24f259c83b6',
  previousCreateIntentSha256:'02b50fdd7c0bf5a0204a6be5ae889c03e332f94490cfed09f1ebfe3e916e1581',
  previousDeleteIntentSha256:'bd0fb933d6098af3e9daf8b1fbe75daaf0641b50900c74dab0b5ffa5d5d5d199'});
const clusterArn=`arn:aws:ecs:${P.region}:${P.account}:cluster/${P.cluster}`;
const serviceArn=`arn:aws:ecs:${P.region}:${P.account}:service/${P.cluster}/${P.service}`;
export function assertRetiredHosting({stack,cluster,service,definition,definitions}){
  must(stack?.StackId===Q.previousStackId&&stack.StackStatus==='DELETE_COMPLETE','PREVIOUS_STACK_NOT_DELETED');
  const missing=(x,key,names)=>Array.isArray(x?.[key])&&x[key].length===0&&x.failures?.length===1&&
    x.failures[0].reason==='MISSING'&&names.includes(x.failures[0].arn);
  const c=cluster?.clusters?.[0],s=service?.services?.[0];
  const clusterMissing=missing(cluster,'clusters',[P.cluster,clusterArn]);
  must(clusterMissing||(cluster?.clusters?.length===1&&!cluster.failures?.length&&c.clusterArn===clusterArn&&c.clusterName===P.cluster&&
    c.status==='INACTIVE'&&c.runningTasksCount===0&&c.pendingTasksCount===0&&c.activeServicesCount===0&&c.registeredContainerInstancesCount===0),'RETIRED_CLUSTER');
  const serviceMissing=service?.clusterNotFound===true&&clusterMissing||missing(service,'services',[P.service,serviceArn]);
  must(serviceMissing||(service?.services?.length===1&&!service.failures?.length&&s.serviceArn===serviceArn&&s.serviceName===P.service&&
    s.status==='INACTIVE'&&s.desiredCount===0&&s.runningCount===0&&s.pendingCount===0),'RETIRED_SERVICE');
  const definitionMissing=definition?.absent===true;
  must(definitionMissing||(definition?.taskDefinitionArn===Q.previousTaskDefinition&&definition.family===P.family&&definition.status==='INACTIVE'),'RETIRED_DEFINITION');
  must(same(Object.keys(definitions??{}).sort(),['ACTIVE','DELETE_IN_PROGRESS','INACTIVE']),'RETIRED_LIST_STATUSES');
  for(const [status,x]of Object.entries(definitions))must(!x.nextToken&&Array.isArray(x.taskDefinitionArns)&&
    (status==='INACTIVE'?(x.taskDefinitionArns.length<=1&&x.taskDefinitionArns.every(a=>a===Q.previousTaskDefinition)):x.taskDefinitionArns.length===0),'RETIRED_DEFINITION_LIST');
  must(!definitionMissing||definitions.INACTIVE.taskDefinitionArns.length===0,'RETIRED_DEFINITION_CONFLICT');
  return {generation:2,previousStackId:Q.previousStackId,previousStackStatus:'DELETE_COMPLETE',
    clusterState:clusterMissing?'MISSING':'INACTIVE',serviceState:serviceMissing?'MISSING':'INACTIVE',
    previousTaskDefinition:Q.previousTaskDefinition,previousTaskDefinitionStatus:definitionMissing?'ABSENT':'INACTIVE',
    listedInactiveDefinitions:[...definitions.INACTIVE.taskDefinitionArns],activeDefinitions:0,deletingDefinitions:0};
}
