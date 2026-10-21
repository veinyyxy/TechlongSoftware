// Proposal only. No AWS clients, credentials, environment discovery or live I/O.
// Keep the failed stack and its unexecuted change set untouched.
import {recoveryTemplate,assertRecoverySnapshot,RECOVERY_SCOPE as R} from '../platform-image-recovery-v1/recovery.mjs';
import {IMAGE_FOUNDATION as S} from '../platform-hosting-v1/image-foundation.mjs';

export const PUBLISHER_V2=Object.freeze({
  account:S.account,region:S.region,stack:'techlong-sandbox-platform-image-publisher-v2',
  role:'TechlongSandboxPlatformImagePublisherV2',clientToken:'techlong-platform-image-publisher-v2',
  boundaryArn:`arn:aws:iam::${S.account}:policy/${S.boundary}`,
  repositoryArn:`arn:aws:ecr:${S.region}:${S.account}:repository/${S.repository}`,
  retainedStackId:R.stackId,
  retainedChangeSetId:`arn:aws:cloudformation:${S.region}:${S.account}:changeSet/${R.changeSetName}/ec0f7450-b25e-47e8-bd2b-7a9dcfe080a3`,
});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const must=(v,c)=>{if(!v)throw Error('PLATFORM_PUBLISHER_V2_'+c);};

export function lockedPublisherFoundation(){
  const role=structuredClone(recoveryTemplate().Resources.PlatformImagePublisher);
  role.Properties.RoleName=PUBLISHER_V2.role;
  // Literal reference only: this new stack must never own/recreate the boundary.
  role.Properties.PermissionsBoundary=PUBLISHER_V2.boundaryArn;
  return {AWSTemplateFormatVersion:'2010-09-09',
    Description:'W7f independent LOCKED publisher only; existing ECR and boundary are references, not managed resources',
    Metadata:{phase:'W7f',executionApproved:false,initialTrust:'NO_ALLOW',publicationRequiresSeparateReview:true,
      retainedFailedStack:PUBLISHER_V2.retainedStackId,retainedUnexecutedChangeSet:PUBLISHER_V2.retainedChangeSetId},
    Resources:{PlatformImagePublisher:role},
    Outputs:{PublisherRoleArn:{Value:{'Fn::GetAtt':['PlatformImagePublisher','Arn']}},
      ExistingRepositoryArn:{Value:PUBLISHER_V2.repositoryArn},ExistingBoundaryArn:{Value:PUBLISHER_V2.boundaryArn}}};
}

export function assertPublisherTemplate(t){
  must(same(t,lockedPublisherFoundation()),'TEMPLATE_DRIFT');return true;
}

export function createPublisherRequest(){
  return {StackName:PUBLISHER_V2.stack,ClientRequestToken:PUBLISHER_V2.clientToken,
    TemplateBody:JSON.stringify(lockedPublisherFoundation(),null,2)+'\n',Capabilities:['CAPABILITY_NAMED_IAM'],
    DisableRollback:true,Parameters:[],Tags:structuredClone(recoveryTemplate().Resources.PlatformImagePublisher.Properties.Tags)};
}

export function assertPublisherPreconditions(v){
  assertRecoverySnapshot(v?.retainedSnapshot);
  must(v.newStack?.state==='ABSENT'&&v.newRole?.state==='ABSENT','NEW_NAMES_NOT_ABSENT');
  const cs=v.retainedChangeSet;
  must(cs?.ChangeSetId===PUBLISHER_V2.retainedChangeSetId&&cs.StackId===R.stackId&&
    cs.Status==='CREATE_COMPLETE'&&cs.ExecutionStatus==='AVAILABLE'&&!cs.NextToken,'RETAINED_CHANGE_SET');
  must(v.changeSetList?.complete===true&&v.changeSetList.ids?.length===1&&
    v.changeSetList.ids[0]===PUBLISHER_V2.retainedChangeSetId,'RETAINED_CHANGE_SET_LIST');
  return {state:'READY_FOR_SEPARATE_CREATE_APPROVAL',executionAuthorized:false,oldChangeSetExecutionAuthorized:false};
}
