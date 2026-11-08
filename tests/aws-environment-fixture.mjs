// Synthetic three-stack AWS model only; never loads credentials or executes a cloud command.
import baseline from '../ops/deployment-baseline/existing-tenant.template.json' with {type:'json'};
import {copy,hash} from '../ops/temporary-idle/environment-cfn.mjs';
import {ENV_SCHEMA} from '../ops/temporary-idle/environment.mjs';
import {DeploymentMode} from '@aws-sdk/client-cloudformation';
export {copy};
export const accountId='111111111111',region='ca-central-1',prefix=`arn:aws:elasticloadbalancing:${region}:${accountId}:`,ecs=`arn:aws:ecs:${region}:${accountId}:`;
export function memoryStore(){return {snapshot:null,journal:null,async createSnapshot(s,j){if(this.snapshot)throw Error('EEXIST');this.snapshot=copy(s);this.journal=copy(j);},async saveJournal(j){this.journal=copy(j);},async read(n){return copy(n==='snapshot.json'?this.snapshot:this.journal);}};}
function templates(){
 const all=Object.fromEntries(['platform','cell','tenant'].map(role=>[role,{AWSTemplateFormatVersion:'2010-09-09',Parameters:{},Resources:Object.fromEntries(Object.entries(baseline.stacks[role].resources).map(([id,Type])=>[id,{Type,Properties:{}}])),Outputs:{}}]));
 for(const role of ['platform','tenant']){const t=all[role],service=role==='platform'?'Service':'TenantService',task=role==='platform'?'TaskDefinition':'TenantTaskDefinition',target=role==='platform'?'TargetGroup':'TenantTargetGroup';t.Resources[service].Properties={ServiceName:role+'-web',DesiredCount:1,TaskDefinition:{Ref:task},LoadBalancers:[{ContainerName:'web',ContainerPort:3000,TargetGroupArn:{Ref:target}}]};t.Resources[task].Properties={Family:role+'-web',ContainerDefinitions:[{Name:'web',Image:'synthetic@sha256:'+'a'.repeat(64),Command:['node','start.mjs'],Environment:[{Name:'TECHLONG_PLATFORM_CONTROLLER_ENABLED',Value:'false'}],Secrets:[{Name:'DATABASE_URL',ValueFrom:'synthetic-fixed-secret-reference'}]}]};}
 all.platform.Resources.LoadBalancer.Properties={Name:'platform-lb'};all.cell.Resources.CellLoadBalancer.Properties={Name:'cell-lb'};
 const listener=(port)=>({Port:port,Protocol:'HTTPS',SslPolicy:'synthetic-tls',Certificates:[{CertificateArn:'synthetic-cert'}]});
 all.platform.Resources.HttpsListener.Properties={...listener(443),LoadBalancerArn:{Ref:'LoadBalancer'}};
 all.platform.Resources.Service.DependsOn=['HttpsListener','TaskIngress'];all.platform.Resources.DnsRecord.Properties={Name:'console.sandbox.example.com.',Type:'A',AliasTarget:{DNSName:{'Fn::GetAtt':['LoadBalancer','DNSName']},HostedZoneId:{'Fn::GetAtt':['LoadBalancer','CanonicalHostedZoneID']},EvaluateTargetHealth:true}};
 all.platform.Outputs={Url:{Value:'https://console.sandbox.example.com'},HostingExpiresAt:{Value:'2026-01-01T00:00:00Z'}};
 all.cell.Parameters={CertificateArn:{Type:'String'},ControlTrustStoreArn:{Type:'String'}};
 all.cell.Resources.BusinessHttpsListener.Properties={...listener(443),LoadBalancerArn:{Ref:'CellLoadBalancer'}};
 all.cell.Resources.ControlMtlsListener.Properties={...listener(8443),LoadBalancerArn:{Ref:'CellLoadBalancer'},MutualAuthentication:{Mode:'verify',TrustStoreArn:{Ref:'ControlTrustStoreArn'}}};
 all.cell.Resources.BusinessControlDenyRule.Properties={ListenerArn:{Ref:'BusinessHttpsListener'}};
 all.cell.Outputs={HttpsListenerArn:{Value:{Ref:'BusinessHttpsListener'}},ControlListenerArn:{Value:{Ref:'ControlMtlsListener'}},VpcId:{Value:{Ref:'CellVpc'}},ClusterName:{Value:{Ref:'CellCluster'}},SubnetIds:{Value:{'Fn::Join':[',',[{Ref:'PublicSubnetA'},{Ref:'PublicSubnetB'}]]}},TaskSecurityGroupId:{Value:{Ref:'TaskSecurityGroup'}},CellExpiresAt:{Value:'2026-01-01T00:00:00Z'}};
 all.tenant.Parameters=Object.fromEntries(['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k=>[k,{Type:'String'}]));
 for(const id of ['TenantListenerRule','TenantBusinessControlDenyRule','TenantControlListenerRule'])all.tenant.Resources[id].Properties={ListenerArn:{Ref:id==='TenantControlListenerRule'?'ControlListenerArn':'HttpsListenerArn'}};
 all.tenant.Resources.TenantService.DependsOn=['TenantListenerRule','TenantBusinessControlDenyRule','TenantControlListenerRule'];all.tenant.Outputs={ServiceName:{Value:{Ref:'TenantService'}},TargetGroupArn:{Value:{Ref:'TenantTargetGroup'}}};return all;
}
export function fixture(){
 const bases=templates(),calls=[],stacks={},plans=new Map(),dbState={cluster:'available',instance:'available'};let counter=1,clock=1000;
 const hex=()=>String(counter++).padStart(16,'a'),stackId=r=>`arn:aws:cloudformation:${region}:${accountId}:stack/${r}-stack/00000000-0000-4000-8000-${String(['platform','cell','tenant'].indexOf(r)+1).padStart(12,'0')}`;
 const config={schema:ENV_SCHEMA,temporary:true,enabled:true,accountId,region,profile:'synthetic',expectedPrincipalArn:`arn:aws:iam::${accountId}:user/test`,expectedPrincipalUserId:'AIDASYNTHETIC',stateDirectory:'C:/synthetic/aws-environment-cfn-test',acknowledgeRoleScopeReview:true,
  stacks:Object.fromEntries(Object.keys(bases).map(r=>[r,{stackId:stackId(r),templateSha256:hash(bases[r]),...(r==='cell'?{}:{desiredCount:1})}])),databases:[{kind:'cluster',id:'test-cluster',resourceId:'cluster-stable'},{kind:'instance',id:'test-db',resourceId:'db-stable'}],externalApiAlias:{zoneId:'ZTEST',name:'api.sandbox.example.com.',owner:'external'}};
 const state={fail:null,wrongUser:false,badTag:false,badController:false,foreignService:false,foreignRule:false,externalScaling:false,unexpectedChange:false,neverComplete:false,unhealthy:false,replacedDb:false,unknownExecute:false};
 function resolve(v,s){if(Array.isArray(v))return v.map(x=>resolve(x,s));if(!v||typeof v!=='object')return v;if(v.Ref)return s.bindings[v.Ref]??s.params[v.Ref];if(v['Fn::Join'])return resolve(v['Fn::Join'][1],s).join(v['Fn::Join'][0]);if(v['Fn::GetAtt']){const [id,prop]=v['Fn::GetAtt'],arn=s.bindings[id];return prop==='DNSName'?dns(arn):'ZALB';}return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x,s)]));}
 const dns=arn=>(arn.includes('/cell-lb/')?'cell-lb':'platform-lb')+'-'+arn.split('/').at(-1)+'.ca-central-1.elb.amazonaws.com';
 function makeId(s,id,type){
  if(type==='AWS::ElasticLoadBalancingV2::LoadBalancer')return prefix+'loadbalancer/app/'+(s.role==='cell'?'cell-lb':'platform-lb')+'/'+hex();
  if(type==='AWS::ElasticLoadBalancingV2::Listener'){const lb=s.bindings[s.role==='cell'?'CellLoadBalancer':'LoadBalancer'];return lb.replace(':loadbalancer/',':listener/')+'/'+hex();}
  if(type==='AWS::ElasticLoadBalancingV2::ListenerRule'){const p=s.template.Resources[id].Properties,listener=resolve(p.ListenerArn,s);return listener.replace(':listener/',':listener-rule/')+'/'+hex();}
  if(type==='AWS::ECS::Service')return ecs+'service/'+(s.role==='tenant'?'cell':'platform')+'/'+s.role+'-web';
  if(type==='AWS::ECS::TaskDefinition')return ecs+'task-definition/'+s.role+'-web:1';
  if(type==='AWS::ECS::Cluster')return s.role==='cell'?'cell':'platform';
  if(type==='AWS::ElasticLoadBalancingV2::TargetGroup')return prefix+'targetgroup/'+s.role+'-tg/'+hex();
  if(type==='AWS::Route53::RecordSet')return 'console.sandbox.example.com';
  if(type==='AWS::Logs::LogGroup')return '/ecs/'+s.role+'-web';
  if(type==='AWS::EC2::VPC')return 'vpc-'+hex();if(type==='AWS::EC2::Subnet')return 'subnet-'+hex();if(type==='AWS::EC2::SecurityGroup')return 'sg-'+hex();return id+'-'+hex();
 }
 function outputs(s){return Object.entries(s.template.Outputs??{}).map(([OutputKey,x])=>({OutputKey,OutputValue:resolve(x.Value,s)}));}
 function syncService(s,oldIds){const id=s.role==='platform'?'Service':'TenantService',td=s.role==='platform'?'TaskDefinition':'TenantTaskDefinition',target=s.role==='platform'?'TargetGroup':'TenantTargetGroup';if(s.role==='cell')return;if(!s.bindings[id]){s.service=null;return;}const count=s.template.Resources[id].Properties.DesiredCount;s.service={serviceArn:s.bindings[id],serviceName:s.role+'-web',clusterArn:ecs+'cluster/'+(s.role==='tenant'?'cell':'platform'),status:'ACTIVE',launchType:'FARGATE',taskDefinition:s.bindings[td],desiredCount:count,runningCount:count,pendingCount:0,createdAt:oldIds[id]?s.service?.createdAt??'initial':new Date(clock).toISOString(),loadBalancers:[{containerName:'web',containerPort:3000,targetGroupArn:s.bindings[target]}],networkConfiguration:{awsvpcConfiguration:{subnets:['synthetic']}},tags:[{key:'aws:cloudformation:stack-id',value:s.id},{key:'aws:cloudformation:logical-id',value:id}]};}
 function bind(s){const ids=copy(s.bindings);for(const k of Object.keys(s.bindings))if(!s.template.Resources[k])delete s.bindings[k];
  for(const type of ['AWS::ElasticLoadBalancingV2::LoadBalancer','AWS::ElasticLoadBalancingV2::Listener',null,'AWS::ElasticLoadBalancingV2::ListenerRule'])for(const [id,r]of Object.entries(s.template.Resources))if(!s.bindings[id]&&(type?r.Type===type:!['AWS::ElasticLoadBalancingV2::LoadBalancer','AWS::ElasticLoadBalancingV2::Listener','AWS::ElasticLoadBalancingV2::ListenerRule'].includes(r.Type)))s.bindings[id]=makeId(s,id,r.Type);syncService(s,ids);
 }
 for(const role of ['cell','platform','tenant']){const s={id:stackId(role),role,template:copy(bases[role]),params:role==='cell'?{CertificateArn:'synthetic-cert',ControlTrustStoreArn:prefix+'truststore/test/one'}:{},bindings:{},last:'2026-01-01T00:00:00Z',roleArn:role==='platform'?null:`arn:aws:iam::${accountId}:role/${role}-execution`};if(role==='tenant')s.params=Object.fromEntries(outputs(stacks.cell).filter(x=>Object.hasOwn(s.template.Parameters,x.OutputKey)).map(x=>[x.OutputKey,x.OutputValue]));stacks[role]=s;bind(s);}
 let api={Name:config.externalApiAlias.name,Type:'A',AliasTarget:{DNSName:'dualstack.'+dns(stacks.cell.bindings.CellLoadBalancer)+'.',HostedZoneId:'ZALB',EvaluateTargetHealth:false}};
 function findRole(id){return Object.values(stacks).find(s=>s.id===id);}
 function resources(s){return Object.entries(s.bindings).map(([id,PhysicalResourceId])=>({LogicalResourceId:id,PhysicalResourceId,ResourceType:s.template.Resources[id].Type,ResourceStatus:'UPDATE_COMPLETE'}));}
 const io={now:()=>clock,sleep:async ms=>{clock+=ms;},call:async(service,operation,input)=>{
  const mutation=['create-change-set','execute-change-set','start-db-instance','stop-db-instance','start-db-cluster','stop-db-cluster','change-resource-record-sets'].includes(operation);calls.push({service,operation,input:copy(input),mutation});if(state.fail===operation)throw Object.assign(Error('synthetic private provider text'),{code:'AccessDenied'});
  if(operation==='get-caller-identity')return {Account:accountId,Arn:state.wrongUser?'wrong':config.expectedPrincipalArn,UserId:config.expectedPrincipalUserId};
  if(service==='cloudformation'){
   const s=findRole(input.StackName);if(!s)throw Error('unscoped stack');
   if(operation==='describe-stacks')return {Stacks:[{StackId:s.id,StackName:s.role+'-stack',StackStatus:state.neverComplete&&s.executed?'UPDATE_IN_PROGRESS':'UPDATE_COMPLETE',CreationTime:'2026-01-01T00:00:00Z',LastUpdatedTime:s.last,...(s.roleArn?{RoleARN:s.roleArn}:{}),Parameters:Object.entries(s.params).map(([ParameterKey,ParameterValue])=>({ParameterKey,ParameterValue})),Outputs:outputs(s),Tags:[{Key:'Project',Value:'test'}]}]};
   if(operation==='get-template')return {TemplateBody:JSON.stringify(input.ChangeSetName?plans.get(input.ChangeSetName).template:s.template)};
   if(operation==='list-stack-resources')return {StackResourceSummaries:resources(s)};
   if(operation==='list-change-sets')return {Summaries:[...plans.values()].filter(p=>p.StackId===s.id).map(p=>({ChangeSetId:p.ChangeSetId,Status:p.Status,ExecutionStatus:p.ExecutionStatus}))};
   if(operation==='create-change-set'){
    if(input.DeploymentMode!==undefined&&!Object.values(DeploymentMode).includes(input.DeploymentMode))throw Object.assign(Error('synthetic invalid AWS deployment-mode enum'),{code:'ValidationError'});
    if(Object.hasOwn(input,'DeploymentMode')||Object.hasOwn(input,'DeploymentConfig'))throw Error('SYNTHETIC_ORDINARY_CHANGE_SET_ONLY');
    const template=JSON.parse(input.TemplateBody),params=copy(s.params);for(const p of input.Parameters)if(!p.UsePreviousValue)params[p.ParameterKey]=p.ParameterValue;const changes=[];
    for(const id of new Set([...Object.keys(s.template.Resources),...Object.keys(template.Resources)])){let Action;if(!s.template.Resources[id])Action='Add';else if(!template.Resources[id])Action='Remove';else if(hash(s.template.Resources[id])!==hash(template.Resources[id]))Action='Modify';if(Action)changes.push({Type:'Resource',ResourceChange:{LogicalResourceId:id,ResourceType:(template.Resources[id]??s.template.Resources[id]).Type,Action,...(Action==='Modify'?{Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:'DesiredCount'}}]}:{})}});}
    if(state.unexpectedChange)changes.push({Type:'Resource',ResourceChange:{LogicalResourceId:'InjectedBucket',ResourceType:'AWS::S3::Bucket',Action:'Add'}});
    const id=`arn:aws:cloudformation:${region}:${accountId}:changeSet/${input.ChangeSetName}/00000000-0000-4000-8000-${String(counter++).padStart(12,'0')}`,p={ChangeSetId:id,StackId:s.id,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Tags:copy(input.Tags),Changes:changes,...(s.roleArn?{RoleARN:s.roleArn}:{}),template,params};plans.set(id,p);return {Id:id,StackId:s.id};
   }
   if(operation==='describe-change-set'){const p=plans.get(input.ChangeSetName);return copy(p);}
   if(operation==='execute-change-set'){const p=plans.get(input.ChangeSetName);s.template=copy(p.template);s.params=copy(p.params);clock++;s.last=new Date(clock).toISOString();bind(s);s.executed=true;p.ExecutionStatus='EXECUTE_COMPLETE';if(state.unknownExecute)throw Object.assign(Error('unknown response'),{code:'NetworkError'});return {};}
  }
  if(service==='rds'){const cluster=operation.includes('cluster'),kind=cluster?'cluster':'instance',d=config.databases.find(x=>x.kind===kind);if(operation.startsWith('stop-'))dbState[kind]='stopped';if(operation.startsWith('start-'))dbState[kind]='available';return cluster?{DBClusters:[{DBClusterIdentifier:d.id,DBClusterArn:`arn:aws:rds:${region}:${accountId}:cluster:${d.id}`,DbClusterResourceId:state.replacedDb?'wrong':d.resourceId,Engine:'aurora-postgresql',Status:dbState[kind]}]}:{DBInstances:[{DBInstanceIdentifier:d.id,DBInstanceArn:`arn:aws:rds:${region}:${accountId}:db:${d.id}`,DbiResourceId:d.resourceId,Engine:'postgres',DBInstanceStatus:dbState[kind]}]};}
  if(operation==='list-services')return {serviceArns:[...Object.values(stacks).filter(s=>s.service&&(s.role==='tenant'?'cell':'platform')===input.cluster).map(s=>s.service.serviceArn),...(state.foreignService?['foreign-service']:[])]};
  if(operation==='describe-scalable-targets')return {ScalableTargets:state.externalScaling?[{}]:[]};
  if(operation==='describe-services'){const s=Object.values(stacks).find(x=>x.service?.serviceArn===input.services[0]);return {services:s?[copy(s.service)]:[]};}
  if(operation==='describe-task-definition')return {taskDefinition:{taskDefinitionArn:input.taskDefinition,status:'ACTIVE',containerDefinitions:[{command:['node','start.mjs'],environment:[{name:'TECHLONG_PLATFORM_CONTROLLER_ENABLED',value:state.badController?'true':'false'}],secrets:[]}]}};
  if(operation==='describe-load-balancers'){const s=Object.values(stacks).find(x=>Object.entries(x.bindings).some(([id,v])=>x.template.Resources[id].Type==='AWS::ElasticLoadBalancingV2::LoadBalancer'&&(input.LoadBalancerArns?.includes(v)||input.Names?.includes(x.template.Resources[id].Properties.Name))));if(!s)throw Object.assign(Error('absent'),{code:'LoadBalancerNotFound'});const id=s.role==='cell'?'CellLoadBalancer':'LoadBalancer',a=s.bindings[id];return {LoadBalancers:[{LoadBalancerArn:a,LoadBalancerName:s.template.Resources[id].Properties.Name,DNSName:dns(a),CanonicalHostedZoneId:'ZALB',Type:'application',State:{Code:'active'}}]};}
  if(operation==='describe-tags'){const arn=input.ResourceArns[0],s=Object.values(stacks).find(s=>Object.values(s.bindings).includes(arn)),id=Object.keys(s.bindings).find(k=>s.bindings[k]===arn);return {TagDescriptions:[{ResourceArn:arn,Tags:state.badTag?[]:[{Key:'aws:cloudformation:stack-id',Value:s.id},{Key:'aws:cloudformation:logical-id',Value:id}]}]};}
  if(operation==='describe-listeners'){const s=Object.values(stacks).find(s=>Object.values(s.bindings).includes(input.LoadBalancerArn));return {Listeners:Object.entries(s.template.Resources).filter(([,r])=>r.Type==='AWS::ElasticLoadBalancingV2::Listener').map(([id,r])=>({...resolve(r.Properties,s),ListenerArn:s.bindings[id],LoadBalancerArn:input.LoadBalancerArn}))};}
  if(operation==='describe-rules'){const rows=Object.values(stacks).flatMap(s=>Object.entries(s.template.Resources).filter(([,r])=>r.Type==='AWS::ElasticLoadBalancingV2::ListenerRule').filter(([,r])=>resolve(r.Properties.ListenerArn,s)===input.ListenerArn).map(([id])=>({RuleArn:s.bindings[id],IsDefault:false})));return {Rules:[{IsDefault:true},...rows,...(state.foreignRule?[{RuleArn:'foreign',IsDefault:false}]:[])]};}
  if(operation==='list-resource-record-sets'){if(input.StartRecordName===config.externalApiAlias.name)return {ResourceRecordSets:[copy(api)],IsTruncated:false};const s=stacks.platform;if(!s.bindings.DnsRecord)return {ResourceRecordSets:[],IsTruncated:false};return {ResourceRecordSets:[{Name:'console.sandbox.example.com.',Type:'A',AliasTarget:{DNSName:dns(s.bindings.LoadBalancer)+'.',HostedZoneId:'ZALB',EvaluateTargetHealth:true}}],IsTruncated:false};}
  if(operation==='change-resource-record-sets'){api=copy(input.ChangeBatch.Changes[0].ResourceRecordSet);return {ChangeInfo:{Id:'/change/synthetic'}};}
  if(operation==='get-change')return {ChangeInfo:{Status:'INSYNC'}};
  if(operation==='describe-target-health')return {TargetHealthDescriptions:[{TargetHealth:{State:state.unhealthy?'unhealthy':'healthy'}}]};
  throw Error('UNEXPECTED_SYNTHETIC_OPERATION_'+service+'_'+operation);
 }};
 return {config,io,calls,state,stacks,baseTemplates:bases,dbState,plans,store:memoryStore(),api:()=>copy(api),advance:ms=>{clock+=ms;}};
}
export const writes=f=>f.calls.filter(x=>x.mutation);
