// Local-only operator scope. Not imported by either frozen cloud closure.
import {D as OLD} from '../platform-delegated-approval-v1/policy.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {A604_JOB,A604_PROFILE,A604_PUBLICATION} from '../platform-a604-cloud-v1/profile.mjs';
import {bindA604WorkflowPublication,assertA604Publication} from '../platform-a604-cloud-v1/contract.mjs';
export const RISK='docs/aws-auto-deployment-a604-operator-v1.md';
export const D=freeze({...OLD,schema:'techlong/a604-delegated-approval/v1',jobId:A604_JOB,riskFile:RISK,
  slotPrefix:'F:/ChatGPT_workshop/techlong-a604-delegation-v1-',basisExpiresAt:A604_PROFILE.factsAt+A604_PROFILE.validMs});
export const PUBLISH_SLOT='F:/ChatGPT_workshop/techlong-a604-publisher-advance-v1.intent.json';
// Publication requires a later specifically reviewed SOURCE change. It cannot
// be supplied in the grant/material, via an env var or a CLI override.
export const LOCAL_PUBLICATION=freeze({state:'UNPUBLISHED',template:A604_PUBLICATION,reusableCommit:null});
export async function publicationAt(sourceCommit,at){
  if(LOCAL_PUBLICATION.state!=='PUBLISHED')throw Error('A604_OPERATOR_PUBLICATION_NOT_PUBLISHED');
  const p=await bindA604WorkflowPublication(LOCAL_PUBLICATION.template,sourceCommit,LOCAL_PUBLICATION.reusableCommit);
  return assertA604Publication(p,A604_PROFILE,at);
}
