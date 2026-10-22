import {CLOSED_BINDINGS} from '../platform-hosting-v1/contract.mjs';
import {P,must,same} from './contract.mjs';
export const tags=nonce=>[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-access-v1'},{Key:'ReviewNonce',Value:nonce}];
export function trust(){return {Version:'2012-10-17',Statement:[{Sid:'SameAccountEcsTasksOnly',Effect:'Allow',Principal:{Service:'ecs-tasks.amazonaws.com'},Action:'sts:AssumeRole',
  Condition:{StringEquals:{'aws:SourceAccount':P.account},ArnLike:{'aws:SourceArn':`arn:aws:ecs:${P.region}:${P.account}:*`}}}]};}
export function executionPolicy(){return {Version:'2012-10-17',Statement:[
  {Sid:'RegionalEcrToken',Effect:'Allow',Action:'ecr:GetAuthorizationToken',Resource:'*',Condition:{StringEquals:{'aws:RequestedRegion':P.region}}},
  {Sid:'ExactRepositoryPull',Effect:'Allow',Action:['ecr:BatchCheckLayerAvailability','ecr:GetDownloadUrlForLayer','ecr:BatchGetImage'],Resource:P.repositoryArn},
  {Sid:'ExactWebLogStreams',Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:`arn:aws:logs:${P.region}:${P.account}:log-group:${P.logGroup}:log-stream:web/*`},
  {Sid:'ExactWebSecret',Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:P.secretArn},
  {Sid:'FixedSecretVersionForwardedDecrypt',Effect:'Allow',Action:'kms:Decrypt',Resource:P.kmsArn,Condition:{StringEquals:{
    'kms:ViaService':`secretsmanager.${P.region}.amazonaws.com`,'kms:CallerAccount':P.account,
    'kms:EncryptionContext:SecretARN':P.secretArn,'kms:EncryptionContext:SecretVersionId':P.secretVersion}}}
]};}
export function accessTemplate(nonce){must(/^[a-f0-9]{32}$/.test(nonce),'NONCE');return {AWSTemplateFormatVersion:'2010-09-09',
  Description:'Platform Web ECS execution identity only; no hosting resources or application task role',
  Resources:{ExecutionBoundary:{Type:'AWS::IAM::ManagedPolicy',Properties:{ManagedPolicyName:P.boundary,Path:'/',Description:'Maximum execution-only ECR log and fixed Web Secret access',PolicyDocument:executionPolicy()}},
    ExecutionRole:{Type:'AWS::IAM::Role',Properties:{RoleName:P.role,Path:'/',MaxSessionDuration:3600,PermissionsBoundary:{Ref:'ExecutionBoundary'},
      AssumeRolePolicyDocument:trust(),Policies:[{PolicyName:P.inline,PolicyDocument:executionPolicy()}],Tags:tags(nonce)}}},
  Outputs:{ExecutionRoleArn:{Value:{'Fn::GetAtt':['ExecutionRole','Arn']}},BoundaryArn:{Value:{Ref:'ExecutionBoundary'}}}};}
const ref=n=>({Ref:n}),att=(n,a)=>({'Fn::GetAtt':[n,a]});
export function hostingTemplate(){
  const t=[{Key:'Environment',Value:'aws-sandbox'},{Key:'Purpose',Value:'platform-web-two-hour'},{Key:'HostingExpiresAt',Value:ref('HostingExpiresAt')}];
  const r=(Type,Properties,extra={})=>({Type,Properties,...extra});
  return {AWSTemplateFormatVersion:'2010-09-09',Description:'DRAFT separate approval: one 0.5-vCPU/1-GiB Web task and HTTPS ALB, two-hour intent, no automatic cleanup',
    Parameters:{HostingExpiresAt:{Type:'String',AllowedPattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$',Description:'Derived at future approved CreateStack start plus two hours; tag is not an automatic stop'}},
    Resources:{
      TaskSecurityGroup:r('AWS::EC2::SecurityGroup',{GroupDescription:'Platform Web: ingress only from reviewed ALB, outbound TLS',VpcId:P.vpc,
        SecurityGroupEgress:[{IpProtocol:'tcp',FromPort:443,ToPort:443,CidrIp:'0.0.0.0/0'}],Tags:t}),
      AlbSecurityGroup:r('AWS::EC2::SecurityGroup',{GroupDescription:'Platform HTTPS public ingress; egress to Web task only',VpcId:P.vpc,
        SecurityGroupIngress:[{IpProtocol:'tcp',FromPort:443,ToPort:443,CidrIp:'0.0.0.0/0'}],
        SecurityGroupEgress:[{IpProtocol:'tcp',FromPort:3000,ToPort:3000,DestinationSecurityGroupId:ref('TaskSecurityGroup')}],Tags:t}),
      TaskIngress:r('AWS::EC2::SecurityGroupIngress',{GroupId:ref('TaskSecurityGroup'),IpProtocol:'tcp',FromPort:3000,ToPort:3000,SourceSecurityGroupId:ref('AlbSecurityGroup')}),
      LogGroup:r('AWS::Logs::LogGroup',{LogGroupName:P.logGroup,RetentionInDays:7,Tags:t}),
      Cluster:r('AWS::ECS::Cluster',{ClusterName:P.cluster,ClusterSettings:[{Name:'containerInsights',Value:'disabled'}],Tags:t}),
      LoadBalancer:r('AWS::ElasticLoadBalancingV2::LoadBalancer',{Name:P.alb,Type:'application',Scheme:'internet-facing',IpAddressType:'ipv4',Subnets:[...P.subnets],SecurityGroups:[ref('AlbSecurityGroup')],
        LoadBalancerAttributes:[{Key:'deletion_protection.enabled',Value:'false'},{Key:'routing.http.drop_invalid_header_fields.enabled',Value:'true'},
          {Key:'routing.http.desync_mitigation_mode',Value:'strictest'},{Key:'routing.http.preserve_host_header.enabled',Value:'true'}],Tags:t}),
      TargetGroup:r('AWS::ElasticLoadBalancingV2::TargetGroup',{Name:P.targetGroup,TargetType:'ip',VpcId:P.vpc,Protocol:'HTTP',Port:3000,HealthCheckEnabled:true,
        HealthCheckPath:'/api/health',HealthCheckProtocol:'HTTP',HealthCheckIntervalSeconds:30,HealthCheckTimeoutSeconds:5,HealthyThresholdCount:2,UnhealthyThresholdCount:2,
        Matcher:{HttpCode:'200'},TargetGroupAttributes:[{Key:'deregistration_delay.timeout_seconds',Value:'30'}],Tags:t}),
      HttpsListener:r('AWS::ElasticLoadBalancingV2::Listener',{LoadBalancerArn:ref('LoadBalancer'),Port:443,Protocol:'HTTPS',SslPolicy:P.sslPolicy,
        Certificates:[{CertificateArn:P.certificate}],DefaultActions:[{Type:'forward',TargetGroupArn:ref('TargetGroup')}]}),
      TaskDefinition:r('AWS::ECS::TaskDefinition',{Family:P.family,RequiresCompatibilities:['FARGATE'],NetworkMode:'awsvpc',Cpu:'512',Memory:'1024',
        ExecutionRoleArn:P.roleArn,RuntimePlatform:{CpuArchitecture:'X86_64',OperatingSystemFamily:'LINUX'},
        ContainerDefinitions:[{Name:'web',Image:P.image,Essential:true,User:'1000:1000',ReadonlyRootFilesystem:false,
          LinuxParameters:{InitProcessEnabled:true,Capabilities:{Drop:['ALL']}},PortMappings:[{ContainerPort:3000,Protocol:'tcp',AppProtocol:'http'}],
          Environment:Object.entries({...CLOSED_BINDINGS,NODE_ENV:'production',PORT:'3000',AUTH_SESSION_DAYS:'1',TECHLONG_PLATFORM_INGRESS:'alb-https-v1',
            TECHLONG_PLATFORM_PUBLIC_ORIGIN:'https://'+P.domain}).map(([Name,Value])=>({Name,Value})),
          Secrets:[{Name:'DATABASE_URL',ValueFrom:P.secretArn+':databaseUrl::'+P.secretVersion}],
          LogConfiguration:{LogDriver:'awslogs',Options:{'awslogs-group':ref('LogGroup'),'awslogs-region':P.region,'awslogs-stream-prefix':'web','mode':'non-blocking','max-buffer-size':'1m'}},
          HealthCheck:{Command:['CMD-SHELL',"node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))\""],Interval:30,Timeout:5,Retries:3,StartPeriod:60}}],Tags:t}),
      Service:r('AWS::ECS::Service',{ServiceName:P.service,Cluster:ref('Cluster'),TaskDefinition:ref('TaskDefinition'),LaunchType:'FARGATE',PlatformVersion:'1.4.0',DesiredCount:1,
        EnableExecuteCommand:false,HealthCheckGracePeriodSeconds:90,DeploymentConfiguration:{MaximumPercent:100,MinimumHealthyPercent:0,DeploymentCircuitBreaker:{Enable:true,Rollback:false}},
        NetworkConfiguration:{AwsvpcConfiguration:{AssignPublicIp:'ENABLED',Subnets:[...P.subnets],SecurityGroups:[ref('TaskSecurityGroup')]}},
        LoadBalancers:[{ContainerName:'web',ContainerPort:3000,TargetGroupArn:ref('TargetGroup')}],PropagateTags:'SERVICE',Tags:t},{DependsOn:['HttpsListener','TaskIngress']}),
      DnsRecord:r('AWS::Route53::RecordSet',{HostedZoneId:P.hostedZone,Name:P.domain+'.',Type:'A',AliasTarget:{DNSName:att('LoadBalancer','DNSName'),HostedZoneId:att('LoadBalancer','CanonicalHostedZoneID'),EvaluateTargetHealth:true}})
    },Outputs:{Url:{Value:'https://'+P.domain},HostingExpiresAt:{Value:ref('HostingExpiresAt')}}};
}
export function assertTemplates(access,hosting,nonce){must(same(access,accessTemplate(nonce))&&same(hosting,hostingTemplate()),'TEMPLATE_DRIFT');
  return {accessResources:Object.keys(access.Resources).length,hostingDraftResources:Object.keys(hosting.Resources).length};}
