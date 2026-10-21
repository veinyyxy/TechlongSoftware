// Read-only CLI. This is deliberately not a grant/publish/dispatch entry point.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {P,must,same} from './plan.mjs';
import {save} from './artifact.mjs';
import {lockedPublisherFoundation} from '../platform-image-recovery-v2/publisher-foundation.mjs';
import {RECOVERY_SCOPE as R} from '../platform-image-recovery-v1/recovery.mjs';
const decode=v=>typeof v==='string'?JSON.parse(decodeURIComponent(v)):v;
function normalizeTrust(v){const c=structuredClone(decode(v));for(const s of c.Statement??[])if(typeof s.Action==='string')s.Action=[s.Action];return c;}
export function verifyInitialSnapshot(v){
  const base=lockedPublisherFoundation(),role=base.Resources.PlatformImagePublisher.Properties;
  must(v.source?.Account===P.account&&v.source.Arn===`arn:aws:iam::${P.account}:user/techlong-sandbox-dev`&&
    v.source.UserId==='AIDAV3GNMXTZEO7SHLC2X','SOURCE_IDENTITY');
  const r=v.role?.Role,s=v.stack?.Stacks?.[0],b=v.boundary?.Policy;
  must(v.stack?.Stacks?.length===1&&s.StackId===P.stackId&&s.StackStatus==='CREATE_COMPLETE'&&!s.RoleARN&&
    !s.Parameters?.length&&same(JSON.parse(v.template?.TemplateBody??'null'),base),'V2_STACK');
  must(v.resources?.StackResourceSummaries?.length===1&&!v.resources.NextToken&&
    v.resources.StackResourceSummaries[0].LogicalResourceId==='PlatformImagePublisher'&&
    v.resources.StackResourceSummaries[0].ResourceType==='AWS::IAM::Role'&&
    v.resources.StackResourceSummaries[0].PhysicalResourceId===P.role&&v.resources.StackResourceSummaries[0].ResourceStatus==='CREATE_COMPLETE','V2_RESOURCE');
  must(r?.RoleId===P.roleId&&r.Arn===P.roleArn&&r.Path==='/'&&r.MaxSessionDuration===3600&&
    r.PermissionsBoundary?.PermissionsBoundaryArn===role.PermissionsBoundary&&
    same(normalizeTrust(r.AssumeRolePolicyDocument),role.AssumeRolePolicyDocument)&&
    same(decode(v.inline?.PolicyDocument),role.Policies[0].PolicyDocument)&&
    same(v.inlineNames?.PolicyNames,['OnlyPlatformWebRepository'])&&v.inlineNames.IsTruncated===false&&
    v.managed?.AttachedPolicies?.length===0&&v.managed.IsTruncated===false,'INITIAL_ROLE_LOCK');
  must(b?.Arn===role.PermissionsBoundary&&b.PolicyId===R.boundaryPolicyId&&b.DefaultVersionId==='v1'&&b.AttachmentCount===0&&
    b.PermissionsBoundaryUsageCount===1&&v.boundaryVersion?.PolicyVersion?.VersionId==='v1'&&
    v.boundaryVersion.PolicyVersion.IsDefaultVersion===true&&same(decode(v.boundaryVersion.PolicyVersion.Document),role.Policies[0].PolicyDocument),'BOUNDARY');
  const repo=v.repository?.repositories?.[0];
  must(v.repository?.repositories?.length===1&&repo.registryId===P.account&&repo.repositoryName===P.ecrRepository&&
    repo.repositoryArn===`arn:aws:ecr:${P.region}:${P.account}:repository/${P.ecrRepository}`&&
    new Date(repo.createdAt).toISOString()===R.repositoryCreatedAt&&repo.imageTagMutability==='IMMUTABLE'&&
    !repo.imageTagMutabilityExclusionFilters?.length&&repo.imageScanningConfiguration?.scanOnPush===true&&
    repo.encryptionConfiguration?.encryptionType==='AES256'&&v.images?.imageDetails?.length===0&&!v.images.nextToken,'ECR_EMPTY');
  return {outcome:'INITIAL_LOCKED_PUBLISHER_AND_EMPTY_ECR_VERIFIED',cloudWrites:0,privateValueReads:0};
}
export async function inspectAws(output,env=process.env){
  must(/^F:\/ChatGPT_workshop\/techlong-platform-publication-v2-[a-z0-9-]+\.json$/.test(output??''),'INSPECT_OUTPUT');
  must(!Object.keys(env).some(k=>/^(AWS_ENDPOINT_URL|AWS_PROFILE$|AWS_ACCESS_KEY_ID$|AWS_SECRET_ACCESS_KEY$|AWS_SESSION_TOKEN$|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&env[k])&&
    env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','SOURCE_OVERRIDE');
  const require=createRequire(new URL('../cloud-worker/package.json',import.meta.url));
  const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
  const {IAMClient,GetRoleCommand,GetRolePolicyCommand,ListRolePoliciesCommand,ListAttachedRolePoliciesCommand,GetPolicyCommand,GetPolicyVersionCommand}=require('@aws-sdk/client-iam');
  const {CloudFormationClient,DescribeStacksCommand,GetTemplateCommand,ListStackResourcesCommand}=require('@aws-sdk/client-cloudformation');
  const {ECRClient,DescribeRepositoriesCommand,DescribeImagesCommand}=require('@aws-sdk/client-ecr');
  const {defaultProvider}=await import('@aws-sdk/credential-provider-node');
  const c={region:P.region,credentials:defaultProvider({profile:'techlong-sandbox-user'}),maxAttempts:1,ignoreConfiguredEndpointUrls:true};
  const sts=new STSClient(c),iam=new IAMClient({...c,region:'us-east-1'}),cfn=new CloudFormationClient(c),ecr=new ECRClient(c);
  const get=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(30000)});
  try{
    const v={schema:'techlong/platform-publication-v2-aws-readonly/v1',startedAtUtc:new Date().toISOString()};
    v.source=await get(sts,new GetCallerIdentityCommand({}));
    must(v.source.Account===P.account&&v.source.Arn===`arn:aws:iam::${P.account}:user/techlong-sandbox-dev`&&v.source.UserId==='AIDAV3GNMXTZEO7SHLC2X','SOURCE_IDENTITY');
    const boundaryArn=lockedPublisherFoundation().Resources.PlatformImagePublisher.Properties.PermissionsBoundary;
    const work={role:[iam,new GetRoleCommand({RoleName:P.role})],inline:[iam,new GetRolePolicyCommand({RoleName:P.role,PolicyName:'OnlyPlatformWebRepository'})],
      inlineNames:[iam,new ListRolePoliciesCommand({RoleName:P.role})],managed:[iam,new ListAttachedRolePoliciesCommand({RoleName:P.role})],
      boundary:[iam,new GetPolicyCommand({PolicyArn:boundaryArn})],boundaryVersion:[iam,new GetPolicyVersionCommand({PolicyArn:boundaryArn,VersionId:'v1'})],
      stack:[cfn,new DescribeStacksCommand({StackName:P.stackId})],template:[cfn,new GetTemplateCommand({StackName:P.stackId,TemplateStage:'Original'})],
      resources:[cfn,new ListStackResourcesCommand({StackName:P.stackId})],repository:[ecr,new DescribeRepositoriesCommand({registryId:P.account,repositoryNames:[P.ecrRepository]})],
      images:[ecr,new DescribeImagesCommand({registryId:P.account,repositoryName:P.ecrRepository,maxResults:100})]};
    await Promise.all(Object.entries(work).map(async([k,[client,command]])=>{v[k]=await get(client,command);}));
    v.completedAtUtc=new Date().toISOString();v.verification=verifyInitialSnapshot(v);await save(output,v);return v.verification;
  }finally{sts.destroy();iam.destroy();cfn.destroy();ecr.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [out,...extra]=process.argv.slice(2);
  Promise.resolve().then(()=>{must(!extra.length,'INSPECT_ARGUMENTS');return inspectAws(out);}).then(r=>console.log(JSON.stringify(r)))
    .catch(e=>{console.error(JSON.stringify({outcome:'READ_ONLY_INSPECT_NOT_COMPLETED',errorCode:/^[A-Za-z0-9_]+$/.test(e?.name)?e.name:'Error'}));process.exitCode=1;});
}
