// New recovery proposal only; original approved/failing factory stays immutable.
// No clients, live operations, environment discovery or automatic repair.
import {createHash} from 'node:crypto';
import {lockedImageFoundation,IMAGE_FOUNDATION as S} from '../platform-hosting-v1/image-foundation.mjs';
export const RECOVERY_SCOPE=Object.freeze({account:S.account,region:S.region,
  stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-image-foundation-v1/5db98d40-cd82-11f1-8f8c-06fff229a471',
  boundaryPolicyId:'ANPAV3GNMXTZP2F37SEFP',repositoryCreatedAt:'2026-10-21T19:05:26.229Z',
  originalTemplateSha256:'c97085b1447d20c4815eb9064589948a0159c61b14c3baee7aed00bd855c82b9',
  changeSetName:'platform-image-locked-trust-recovery-v1',clientToken:'techlong-platform-image-locked-trust-recovery-v1'});
const must=(v,c)=>{if(!v)throw Error('PLATFORM_IMAGE_RECOVERY_'+c);};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function recoveryTemplate(){
  const t=lockedImageFoundation();
  // Exact account principal is valid for AssumeRole. NO Allow statements means
  // WebIdentity/SAML/service/cross-account paths remain implicitly denied too.
  t.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement[0].Principal={AWS:`arn:aws:iam::${S.account}:root`};
  t.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement[0].Action=['sts:AssumeRole'];
  return t;
}
export function assertRecoveryTemplate(t){
  must(same(t,recoveryTemplate()),'TEMPLATE_DRIFT');return true;
}
export function templateDigest(t){return createHash('sha256').update(JSON.stringify(t,null,2)+'\n').digest('hex');}
export function assertRecoverySnapshot(v){
  must(v?.source?.Account===S.account&&v.source.Arn===`arn:aws:iam::${S.account}:user/techlong-sandbox-dev`&&
    v.source.UserId==='AIDAV3GNMXTZEO7SHLC2X','SOURCE');
  must(v.stack?.id===RECOVERY_SCOPE.stackId&&v.stack.status==='CREATE_FAILED'&&v.stack.disableRollback===true&&
    v.stack.roleArn===null&&v.stack.parameters?.length===0&&same(v.template,lockedImageFoundation()),'STACK');
  const expected=[['PlatformWebRepository','AWS::ECR::Repository',S.repository,'CREATE_COMPLETE'],
    ['PlatformImageBoundary','AWS::IAM::ManagedPolicy',`arn:aws:iam::${S.account}:policy/${S.boundary}`,'CREATE_COMPLETE'],
    ['PlatformImagePublisher','AWS::IAM::Role',S.role,'CREATE_FAILED']];
  must(Array.isArray(v.resources)&&v.resources.length===3&&expected.every(([id,type,physical,status])=>
    v.resources.filter(r=>r.logicalId===id&&r.type===type&&r.physicalId===physical&&r.status===status).length===1),'RESOURCES');
  must(v.role?.state==='ABSENT','ROLE_ALREADY_PRESENT');
  must(v.repository?.arn===`arn:aws:ecr:${S.region}:${S.account}:repository/${S.repository}`&&
    v.repository.createdAt===RECOVERY_SCOPE.repositoryCreatedAt&&v.repository.imageCount===0&&v.repository.noNextPage===true&&
    v.repository.tagMutability==='IMMUTABLE'&&v.repository.scanOnPush===true&&v.repository.encryption==='AES256'&&
    v.repository.exclusions?.length===0,'REPOSITORY');
  must(v.boundary?.arn===`arn:aws:iam::${S.account}:policy/${S.boundary}`&&v.boundary.policyId===RECOVERY_SCOPE.boundaryPolicyId&&
    v.boundary.defaultVersion==='v1'&&v.boundary.attachmentCount===0&&v.boundary.boundaryUsageCount===0&&
    same(v.boundary.document,lockedImageFoundation().Resources.PlatformImageBoundary.Properties.PolicyDocument),'BOUNDARY');
  return true;
}
export function recoveryChangeSetRequest(){
  return {StackName:RECOVERY_SCOPE.stackId,ChangeSetName:RECOVERY_SCOPE.changeSetName,ChangeSetType:'UPDATE',
    ClientToken:RECOVERY_SCOPE.clientToken,Capabilities:['CAPABILITY_NAMED_IAM'],
    Description:'Review only: retry absent publisher with valid locked trust; preserve existing ECR and boundary',
    TemplateBody:JSON.stringify(recoveryTemplate(),null,2)+'\n',Parameters:[],IncludeNestedStacks:false,ImportExistingResources:false};
}
export function inspectRecoveryChangeSet(v){
  must(v?.StackId===RECOVERY_SCOPE.stackId&&v.ChangeSetName===RECOVERY_SCOPE.changeSetName&&
    typeof v.ChangeSetId==='string'&&v.ChangeSetId.startsWith(`arn:aws:cloudformation:${S.region}:${S.account}:changeSet/${RECOVERY_SCOPE.changeSetName}/`),'CHANGE_SET_IDENTITY');
  must(v.Status==='CREATE_COMPLETE'&&v.ExecutionStatus==='AVAILABLE'&&!v.NextToken&&v.IncludeNestedStacks!==true&&
    v.Parameters?.length===0&&v.Capabilities?.length===1&&v.Capabilities[0]==='CAPABILITY_NAMED_IAM'&&!v.RoleARN,'CHANGE_SET_STATE');
  must(v.Changes?.length===1&&v.Changes[0].Type==='Resource','CHANGE_COUNT');
  const r=v.Changes[0].ResourceChange;
  must(r?.LogicalResourceId==='PlatformImagePublisher'&&r.ResourceType==='AWS::IAM::Role'&&
    (!r.PhysicalResourceId||r.PhysicalResourceId===S.role)&&['Add','Modify'].includes(r.Action)&&
    (r.Action==='Add'?(r.Replacement===undefined||r.Replacement==='False'):r.Replacement==='False'),'CHANGE_SCOPE');
  if(r.Action==='Modify'){
    must(r.Scope?.length===1&&r.Scope[0]==='Properties'&&Array.isArray(r.Details)&&r.Details.length>0&&r.Details.every(d=>
      d.Target?.Attribute==='Properties'&&d.Target.Name==='AssumeRolePolicyDocument'&&d.Target.RequiresRecreation==='Never'),'CHANGE_DETAILS');
  }
  return {state:'UNEXECUTED_ROLE_ONLY_RECOVERY_CHANGESET_VERIFIED',executionAuthorized:false,
    retainedRepositoryAndBoundary:true,roleAction:r.Action};
}
