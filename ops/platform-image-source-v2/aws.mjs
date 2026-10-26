import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {P,must,same,updateRequest} from './review.mjs';
import {templates,publicationProtocol} from '../platform-image-publication-v2/plan.mjs';
import {lockedPublisherFoundation} from '../platform-image-recovery-v2/publisher-foundation.mjs';
import {RECOVERY_SCOPE as R} from '../platform-image-recovery-v1/recovery.mjs';
import {verifyInitialSnapshot} from '../platform-image-publication-v2/inspect-aws.mjs';
export const decode=v=>typeof v==='string'?JSON.parse(decodeURIComponent(v)):v;
const trust=v=>{const p=structuredClone(decode(v));for(const s of p.Statement??[])if(typeof s.Action==='string')s.Action=[s.Action];return p;};
export function identity(v){must(v?.Account===P.account&&v.Arn===`arn:aws:iam::${P.account}:user/techlong-sandbox-dev`&&v.UserId==='AIDAV3GNMXTZEO7SHLC2X','SOURCE_IDENTITY');}
export function verifySnapshot(v,expected,{initial=false}={}){
  if(initial)verifyInitialSnapshot(v);
  identity(v.source);const r=v.role?.Role,t=expected.Resources.PlatformImagePublisher.Properties,base=lockedPublisherFoundation().Resources.PlatformImagePublisher.Properties;
  const stack=v.stack?.Stacks?.[0],resource=v.resources?.StackResourceSummaries?.[0],policy=v.boundary?.Policy;
  must(v.stack?.Stacks?.length===1&&stack.StackId===P.stackId&&['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(stack.StackStatus)&&
    !stack.RoleARN&&!stack.Parameters?.length&&same(JSON.parse(v.template?.TemplateBody??'null'),expected),'SOURCE_STACK_STATE');
  must(v.resources?.StackResourceSummaries?.length===1&&!v.resources.NextToken&&resource.LogicalResourceId==='PlatformImagePublisher'&&
    resource.PhysicalResourceId===P.role&&resource.ResourceType==='AWS::IAM::Role'&&['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(resource.ResourceStatus),'SOURCE_ROLE_RESOURCE');
  must(r?.RoleId===P.roleId&&r.Arn===P.roleArn&&r.Path==='/'&&r.MaxSessionDuration===3600&&
    r.PermissionsBoundary?.PermissionsBoundaryArn===base.PermissionsBoundary&&same(trust(r.AssumeRolePolicyDocument),t.AssumeRolePolicyDocument)&&
    same(decode(v.inline?.PolicyDocument),t.Policies[0].PolicyDocument)&&same(v.inlineNames?.PolicyNames,['OnlyPlatformWebRepository'])&&
    v.inlineNames.IsTruncated===false&&v.managed?.AttachedPolicies?.length===0&&v.managed.IsTruncated===false,'SOURCE_ROLE_STATE');
  must(policy?.Arn===base.PermissionsBoundary&&policy.PolicyId===R.boundaryPolicyId&&policy.DefaultVersionId==='v1'&&
    policy.AttachmentCount===0&&policy.PermissionsBoundaryUsageCount===1&&v.boundaryVersion?.PolicyVersion?.VersionId==='v1'&&
    v.boundaryVersion.PolicyVersion.IsDefaultVersion===true&&same(decode(v.boundaryVersion.PolicyVersion.Document),base.Policies[0].PolicyDocument),'SOURCE_BOUNDARY_STATE');
  const repo=v.repository?.repositories?.[0];
  must(v.repository?.repositories?.length===1&&repo.registryId===P.account&&repo.repositoryName===P.ecrRepository&&
    repo.repositoryArn===`arn:aws:ecr:${P.region}:${P.account}:repository/${P.ecrRepository}`&&new Date(repo.createdAt).toISOString()===R.repositoryCreatedAt&&
    repo.imageTagMutability==='IMMUTABLE'&&!repo.imageTagMutabilityExclusionFilters?.length&&repo.encryptionConfiguration?.encryptionType==='AES256'&&
    repo.imageScanningConfiguration?.scanOnPush===true&&!v.images?.nextToken&&Array.isArray(v.images?.imageDetails),'SOURCE_REPOSITORY_STATE');
  must(v.changeSets?.Summaries?.length===0&&!v.changeSets.NextToken,'SOURCE_PENDING_CHANGE_SETS');
  must(v.provider?.Url==='token.actions.githubusercontent.com'&&same(v.provider.ClientIDList,['sts.amazonaws.com']),'SOURCE_OIDC_PROVIDER');
  must(v.repositoryPolicyPresent===false&&v.registry?.registryId===P.account&&v.registry.scanningConfiguration?.scanType==='BASIC'&&
    v.registry.scanningConfiguration.rules?.length===0,'SOURCE_REGISTRY_LAYOUT');
  if(initial)must(v.images.imageDetails.length===0,'SOURCE_INITIAL_ECR_EMPTY');
  return {locked:t.AssumeRolePolicyDocument.Statement.every(s=>s.Effect!=='Allow'),imageCount:v.images.imageDetails.length};
}
export async function createAws({protocol=publicationProtocol(),request=updateRequest,sourceLogin=false,
  readOnly=false,metadataLimit=Infinity,stsLimit=Infinity}={}){
  const {P,verifyPublishedManifest}=protocol;
  const require=createRequire(new URL('../cloud-worker/package.json',import.meta.url));
  const stsApi=require('@aws-sdk/client-sts'),iamApi=require('@aws-sdk/client-iam'),cfnApi=require('@aws-sdk/client-cloudformation'),ecrApi=require('@aws-sdk/client-ecr');
  const {defaultProvider}=await import('@aws-sdk/credential-provider-node');
  const credentials=sourceLogin?fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true}):defaultProvider({profile:'techlong-sandbox-user'});
  const cfg={region:P.region,credentials,maxAttempts:1,ignoreConfiguredEndpointUrls:true};
  const config=(endpoint,region=P.region)=>({...cfg,region,...(sourceLogin?{endpoint,requestHandler:new NodeHttpHandler({
    httpsAgent:new Agent({family:4,keepAlive:false}),connectionTimeout:5000,socketTimeout:20000})}:{})});
  const clients=()=>({sts:new stsApi.STSClient(config('https://sts.ca-central-1.amazonaws.com')),
    iam:new iamApi.IAMClient(config('https://iam.amazonaws.com','us-east-1')),
    cfn:new cfnApi.CloudFormationClient(config('https://cloudformation.ca-central-1.amazonaws.com')),
    ecr:new ecrApi.ECRClient(config('https://api.ecr.ca-central-1.amazonaws.com'))});
  const counts={sts:0,metadata:0,writes:0};
  const call=(c,cmd)=>{
    if(cmd instanceof cfnApi.UpdateStackCommand){must(!readOnly,'SOURCE_READ_ONLY');counts.writes++;}
    else if(cmd instanceof stsApi.GetCallerIdentityCommand)must(++counts.sts<=stsLimit,'SOURCE_STS_BUDGET');
    else must(++counts.metadata<=metadataLimit,'SOURCE_METADATA_BUDGET');
    return c.send(cmd,{abortSignal:AbortSignal.timeout(30000)});
  },dispose=c=>Object.values(c).forEach(v=>v.destroy());
  const writer=clients(),writes=new Set();
  return {
    counts,
    async snapshot(){
      const c=clients(),v={startedAtUtc:new Date().toISOString()};
      try{
        v.source=await call(c.sts,new stsApi.GetCallerIdentityCommand({}));identity(v.source);
        const boundary=lockedPublisherFoundation().Resources.PlatformImagePublisher.Properties.PermissionsBoundary;
        const work={role:[c.iam,new iamApi.GetRoleCommand({RoleName:P.role})],inline:[c.iam,new iamApi.GetRolePolicyCommand({RoleName:P.role,PolicyName:'OnlyPlatformWebRepository'})],
          inlineNames:[c.iam,new iamApi.ListRolePoliciesCommand({RoleName:P.role})],managed:[c.iam,new iamApi.ListAttachedRolePoliciesCommand({RoleName:P.role})],
          boundary:[c.iam,new iamApi.GetPolicyCommand({PolicyArn:boundary})],boundaryVersion:[c.iam,new iamApi.GetPolicyVersionCommand({PolicyArn:boundary,VersionId:'v1'})],
          stack:[c.cfn,new cfnApi.DescribeStacksCommand({StackName:P.stackId})],template:[c.cfn,new cfnApi.GetTemplateCommand({StackName:P.stackId,TemplateStage:'Original'})],
          resources:[c.cfn,new cfnApi.ListStackResourcesCommand({StackName:P.stackId})],changeSets:[c.cfn,new cfnApi.ListChangeSetsCommand({StackName:P.stackId})],
          repository:[c.ecr,new ecrApi.DescribeRepositoriesCommand({registryId:P.account,repositoryNames:[P.ecrRepository]})],
          images:[c.ecr,new ecrApi.DescribeImagesCommand({registryId:P.account,repositoryName:P.ecrRepository,maxResults:100})],
          registry:[c.ecr,new ecrApi.GetRegistryScanningConfigurationCommand({})],
          provider:[c.iam,new iamApi.GetOpenIDConnectProviderCommand({OpenIDConnectProviderArn:`arn:aws:iam::${P.account}:oidc-provider/token.actions.githubusercontent.com`})]};
        await Promise.all(Object.entries(work).map(async([k,[client,cmd]])=>{v[k]=await call(client,cmd);}));
        try{await call(c.ecr,new ecrApi.GetRepositoryPolicyCommand({registryId:P.account,repositoryName:P.ecrRepository}));v.repositoryPolicyPresent=true;}
        catch(e){if(e.name!=='RepositoryPolicyNotFoundException')throw e;v.repositoryPolicyPresent=false;}
        v.completedAtUtc=new Date().toISOString();return v;
      }finally{dispose(c);}
    },
    async settled(deadline){
      for(let n=0;n<61;n++){
        must(Date.now()<deadline,'SOURCE_CFN_WAIT_DEADLINE');
        const r=await call(writer.cfn,new cfnApi.DescribeStacksCommand({StackName:P.stackId}));
        must(r.Stacks?.length===1&&r.Stacks[0].StackId===P.stackId,'SOURCE_CFN_WAIT_STACK');
        if(!r.Stacks[0].StackStatus.endsWith('_IN_PROGRESS'))return r;
        await new Promise(resolve=>setTimeout(resolve,10000));
      }throw Error('PLATFORM_PUBLISH_V2_SOURCE_CFN_NOT_SETTLED');
    },
    async update(inner,phase){
      must(!readOnly,'SOURCE_READ_ONLY'); // Before Source credential or metadata discovery.
      must(['grant','revoke'].includes(phase)&&!writes.has(phase),'SOURCE_UPDATE_ONCE');
      const who=await call(writer.sts,new stsApi.GetCallerIdentityCommand({}));identity(who);
      const role=await call(writer.iam,new iamApi.GetRoleCommand({RoleName:P.role}));
      must(role.Role?.RoleId===P.roleId&&role.Role.Arn===P.roleArn,'SOURCE_WRITE_ROLE_ID');
      if(phase==='grant')must(Date.now()+60000<Date.parse(inner.grantExpiresAt),'SOURCE_UPDATE_WINDOW');
      writes.add(phase);const r=await call(writer.cfn,new cfnApi.UpdateStackCommand(request(inner,phase)));
      must(r.StackId===P.stackId,'SOURCE_UPDATE_ACK');return {stackId:r.StackId,requestId:r.$metadata?.requestId??null,attempts:r.$metadata?.attempts??null};
    },
    async published(){
      const c=clients();try{
        const who=await call(c.sts,new stsApi.GetCallerIdentityCommand({}));identity(who);
        const response=await call(c.ecr,new ecrApi.BatchGetImageCommand({registryId:P.account,repositoryName:P.ecrRepository,
          imageIds:[{imageTag:P.targetTag}],acceptedMediaTypes:['application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json']}));
        return {response,verified:verifyPublishedManifest(response)};
      }finally{dispose(c);}
    },
    close:()=>dispose(writer),
  };
}
// Pure helper for tests and the controller, never an IAM repair fallback.
export function expectedTemplate(inner,phase){must(['grant','revoke'].includes(phase),'SOURCE_PHASE');return templates(inner)[phase];}
