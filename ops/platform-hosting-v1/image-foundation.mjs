// Review-only compiler. No clients, credential discovery, grants or cloud writes.
export const IMAGE_FOUNDATION=Object.freeze({account:'402010193138',region:'ca-central-1',
  stack:'techlong-sandbox-platform-image-foundation-v1',repository:'techlong-sandbox-platform-web',
  role:'TechlongSandboxPlatformImagePublisherV1',boundary:'TechlongSandboxPlatformImagePublishBoundaryV1'});
export function lockedImageFoundation(){
  const s=IMAGE_FOUNDATION,arn=`arn:aws:ecr:${s.region}:${s.account}:repository/${s.repository}`;
  const tags=[{Key:'Project',Value:'Techlong'},{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-image-v1'}];
  const permissions={Version:'2012-10-17',Statement:[
    {Sid:'RegistryAuthentication',Effect:'Allow',Action:['ecr:GetAuthorizationToken'],Resource:'*',Condition:{StringEquals:{'aws:RequestedRegion':s.region}}},
    {Sid:'OnlyNewPlatformRepository',Effect:'Allow',Action:['ecr:BatchCheckLayerAvailability','ecr:InitiateLayerUpload',
      'ecr:UploadLayerPart','ecr:CompleteLayerUpload','ecr:PutImage','ecr:BatchGetImage','ecr:GetDownloadUrlForLayer',
      'ecr:DescribeImages','ecr:DescribeRepositories','ecr:DescribeImageScanFindings'],Resource:arn},
  ]};
  return {AWSTemplateFormatVersion:'2010-09-09',Description:'W7d review-only new platform ECR and LOCKED publisher; no deployment or Secret authority',
    Metadata:{phase:'W7d',executionApproved:false,initialTrust:'DENY_ALL',publicationRequiresSeparateReview:true},
    Resources:{
      PlatformWebRepository:{Type:'AWS::ECR::Repository',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{
        RepositoryName:s.repository,ImageTagMutability:'IMMUTABLE',ImageScanningConfiguration:{ScanOnPush:true},
        EncryptionConfiguration:{EncryptionType:'AES256'},EmptyOnDelete:false,Tags:tags}},
      PlatformImageBoundary:{Type:'AWS::IAM::ManagedPolicy',Properties:{ManagedPolicyName:s.boundary,
        Description:'Maximum ECR-only permissions; initial role trust explicitly denies all sessions',PolicyDocument:permissions}},
      PlatformImagePublisher:{Type:'AWS::IAM::Role',Properties:{RoleName:s.role,MaxSessionDuration:3600,
        AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Sid:'LockedNoSessions',Effect:'Deny',Principal:'*',
          Action:['sts:AssumeRole','sts:AssumeRoleWithWebIdentity','sts:AssumeRoleWithSAML']}]},
        PermissionsBoundary:{Ref:'PlatformImageBoundary'},Policies:[{PolicyName:'OnlyPlatformWebRepository',PolicyDocument:structuredClone(permissions)}],Tags:tags}},
    },Outputs:{RepositoryArn:{Value:{'Fn::GetAtt':['PlatformWebRepository','Arn']}},PublisherRoleArn:{Value:{'Fn::GetAtt':['PlatformImagePublisher','Arn']}}}};
}
