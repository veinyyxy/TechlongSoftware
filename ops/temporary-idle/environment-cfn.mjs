// Temporary three-stack lifecycle primitives; no application/runtime imports or cloud I/O on import.
import {createHash} from 'node:crypto';
import baseline from '../deployment-baseline/existing-tenant.template.json' with {type:'json'};
import {ensure} from '../aws-resource-power/core.mjs';

export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const copy=v=>structuredClone(v);
export const ROLES=['platform','cell','tenant'];
export const SERVICE={platform:'Service',tenant:'TenantService'};
export const EDGE={platform:['Service','DnsRecord','HttpsListener','LoadBalancer'],cell:['BusinessControlDenyRule','BusinessHttpsListener','ControlMtlsListener','CellLoadBalancer'],tenant:['TenantService','TenantBusinessControlDenyRule','TenantControlListenerRule','TenantListenerRule']};
export const CELL_BINDINGS=['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'];
export const tagMap=v=>Object.fromEntries((v??[]).map(x=>[x.Key??x.key,x.Value??x.value]));
export const outputMap=v=>Object.fromEntries((v??[]).map(x=>[x.OutputKey,x.OutputValue]));
const resourceTypes=role=>baseline.stacks[role].resources;
export function references(value){
 const out=new Set();function visit(v){if(Array.isArray(v))return v.forEach(visit);if(!v||typeof v!=='object')return;
  if(typeof v.Ref==='string')out.add(v.Ref);const a=v['Fn::GetAtt'];if(a)out.add(Array.isArray(a)?a[0]:String(a).split('.')[0]);
  if(v.DependsOn)for(const x of [].concat(v.DependsOn))out.add(x);
  const sub=v['Fn::Sub'];if(sub)for(const x of String(Array.isArray(sub)?sub[0]:sub).matchAll(/\$\{([^!.}]+)(?:\.[^}]+)?\}/g))out.add(x[1]);Object.values(v).forEach(visit);
 }visit(value);return [...out];
}
export function assertTemplate(role,t,mode='full'){
 ensure(ROLES.includes(role)&&t&&t.Resources&&!t.Transform,'ONLY_THREE_PLAIN_STACKS_SUPPORTED');
 const expected=Object.entries(resourceTypes(role)).filter(([id])=>mode==='full'||!EDGE[role].includes(id));
 ensure(hash(Object.keys(t.Resources).sort())===hash(expected.map(([id])=>id).sort()),'UNEXPECTED_STACK_RESOURCE_SET');
 for(const [id,type]of expected)ensure(t.Resources[id].Type===type,'RESOURCE_TYPE_CHANGED');
 for(const [id,r]of Object.entries(t.Resources)){
  ensure(!r.Condition,'CONDITIONAL_RESOURCES_UNSUPPORTED');
  ensure(!r.Properties?.SecretString&&!r.Properties?.MasterUserPassword,'INLINE_DATABASE_OR_SECRET_MATERIAL_UNSUPPORTED');
  if(EDGE[role].includes(id))ensure(!r.DeletionPolicy&&!r.UpdateReplacePolicy,'EDGE_DELETE_POLICY_MUST_BE_DEFAULT');
  if(r.Type==='AWS::ElasticLoadBalancingV2::LoadBalancer')ensure(!(r.Properties?.LoadBalancerAttributes??[]).some(a=>a.Key==='deletion_protection.enabled'&&a.Value==='true'),'ALB_PROTECTION_REQUIRES_SEPARATE_CFN_REVIEW');
 }
 if(role==='platform'){
  const cs=t.Resources.TaskDefinition.Properties.ContainerDefinitions;ensure(cs?.length===1,'PLATFORM_CONTAINER_SHAPE');const x=cs[0],env=new Map((x.Environment??[]).map(e=>[e.Name,e.Value]));
  ensure(!x.Command?.includes('--hosted-controller')&&env.get('TECHLONG_PLATFORM_CONTROLLER_ENABLED')==='false'&&!x.Secrets?.some(s=>['TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'].includes(s.Name)),'PLATFORM_CONTROLLER_MUST_STAY_CLOSED');
 }
 return t;
}
export function variant(base,role,mode,count=0){
 assertTemplate(role,base);ensure(['idle','full'].includes(mode)&&Number.isInteger(count)&&count>=0&&count<=2,'INVALID_LIFECYCLE_VARIANT');const t=copy(base);
 if(mode==='idle'){
  for(const id of EDGE[role])delete t.Resources[id];for(const [name,value]of Object.entries(t.Outputs??{}))if(references(value).some(id=>EDGE[role].includes(id)))delete t.Outputs[name];
  ensure(!references({Resources:t.Resources,Outputs:t.Outputs}).some(id=>EDGE[role].includes(id)),'DANGLING_REMOVED_RESOURCE_REFERENCE');
 }else if(SERVICE[role])t.Resources[SERVICE[role]].Properties.DesiredCount=count;
 assertTemplate(role,t,mode);return t;
}
export async function readStack(c,io,role){
 const id=c.stacks[role].stackId,sr=await io.call('cloudformation','describe-stacks',{StackName:id});ensure(sr.Stacks?.length===1&&sr.Stacks[0].StackId===id,'EXACT_STACK_UUID_REQUIRED');const s=sr.Stacks[0];
 ensure(['UPDATE_COMPLETE','CREATE_COMPLETE'].includes(s.StackStatus),'STACK_NOT_READY_INSPECT');
 const tr=await io.call('cloudformation','get-template',{StackName:id,TemplateStage:'Original'}),template=typeof tr.TemplateBody==='string'?JSON.parse(tr.TemplateBody):tr.TemplateBody;
 const rr=await io.call('cloudformation','list-stack-resources',{StackName:id});ensure(!rr.NextToken,'STACK_RESOURCE_PAGE_INCOMPLETE');const items=(rr.StackResourceSummaries??[]).filter(x=>x.ResourceStatus!=='DELETE_COMPLETE'),bindings={};
 for(const x of items){ensure(!bindings[x.LogicalResourceId]&&['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(x.ResourceStatus),'RESOURCE_NOT_READY_OR_DUPLICATE');bindings[x.LogicalResourceId]={type:x.ResourceType,physicalId:x.PhysicalResourceId};}
 ensure(hash(Object.keys(bindings).sort())===hash(Object.keys(template.Resources??{}).sort()),'CFN_BINDINGS_TEMPLATE_MISMATCH');
 for(const [name,r]of Object.entries(template.Resources??{}))ensure(bindings[name].type===r.Type,'CFN_BINDING_TYPE_MISMATCH');
 const keys=Object.keys(template.Parameters??{}).sort();ensure(hash((s.Parameters??[]).map(p=>p.ParameterKey).sort())===hash(keys),'CFN_PARAMETER_KEYS_CHANGED');
 return {role,stackId:id,template,templateSha256:hash(template),bindings,outputs:outputMap(s.Outputs),roleArn:s.RoleARN??null,tagHash:hash(tagMap(s.Tags)),stackTags:copy((s.Tags??[]).filter(t=>!t.Key.toLowerCase().startsWith('aws:'))),lastUpdatedAt:s.LastUpdatedTime??s.CreationTime,
  parameterKeys:keys,parameterHashes:Object.fromEntries((s.Parameters??[]).map(p=>[p.ParameterKey,template.Parameters[p.ParameterKey].NoEcho?null:hash(p.ParameterValue)])),
  // Only public resource/network bindings are retained as values; other parameters stay UsePreviousValue.
  parameters:Object.fromEntries((s.Parameters??[]).filter(p=>CELL_BINDINGS.includes(p.ParameterKey)||['CertificateArn','ControlTrustStoreArn','TenantHostname'].includes(p.ParameterKey)).map(p=>[p.ParameterKey,p.ParameterValue]))};
}
export function assertSameStack(actual,expected){ensure(actual.stackId===expected.stackId&&actual.templateSha256===expected.templateSha256&&actual.roleArn===expected.roleArn&&actual.tagHash===expected.tagHash&&hash(actual.bindings)===hash(expected.bindings)&&hash(actual.parameterHashes)===hash(expected.parameterHashes)&&hash(actual.outputs)===hash(expected.outputs),'STACK_CHANGED_SINCE_PLAN');}
export async function writeOnce(io,store,j,key,service,operation,input){
 ensure(!j.actions[key],'WRITE_ALREADY_ATTEMPTED_INSPECT');ensure(io.now()<j.writeBefore,'PLAN_WRITE_WINDOW_EXPIRED');j.actions[key]={status:'SUBMITTING',service,operation,inputSha256:hash(input),at:io.now()};await store.saveJournal(j);
 try{const r=await io.call(service,operation,input);j.actions[key].status='ACKNOWLEDGED';await store.saveJournal(j);return r;}
 catch(e){j.actions[key].status='UNKNOWN_OR_REJECTED';j.status='NEEDS_INSPECTION';await store.saveJournal(j);throw e;}
}
async function poll(io,test,waitSeconds,code){const end=io.now()+waitSeconds*1000;for(;;){const v=await test();if(v)return v;ensure(io.now()<end,code);await io.sleep(Math.min(30000,end-io.now()));}}
export function changeShape(from,to,overrides={}){
 const changes={};for(const id of Object.keys(from.Resources))if(!to.Resources[id])changes[id]='Remove';
 for(const [id,r]of Object.entries(to.Resources))if(!from.Resources[id])changes[id]='Add';else if(hash(r)!==hash(from.Resources[id])||references(r).some(x=>Object.hasOwn(overrides,x)))changes[id]='Modify';return changes;
}
export function reviewChangeSet(p,{stackId,shape,role}){
 const d=p.DeploymentConfig,standard=d===undefined||d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).every(k=>['Mode','DisableRollback'].includes(k))&&(d.Mode===undefined||d.Mode==='STANDARD')&&(d.DisableRollback===undefined||d.DisableRollback===false);
 // DeploymentMode is a drift-awareness flag, not DeploymentConfig.Mode. Ordinary responses omit it.
 ensure(p.StackId===stackId&&p.Status==='CREATE_COMPLETE'&&p.ExecutionStatus==='AVAILABLE'&&p.DeploymentMode===undefined&&standard&&!p.NextToken&&!p.ParentChangeSetId&&!p.RootChangeSetId&&!p.IncludeNestedStacks&&!p.ImportExistingResources&&!p.Capabilities?.length,'CHANGE_SET_STATE_OR_MODE');
 const rows=p.Changes??[];ensure(rows.length===Object.keys(shape).length&&new Set(rows.map(x=>x.ResourceChange?.LogicalResourceId)).size===rows.length,'CHANGE_SET_SCOPE_COUNT');
 for(const x of rows){const r=x.ResourceChange;ensure(x.Type==='Resource'&&r&&shape[r.LogicalResourceId]===r.Action&&r.ResourceType===resourceTypes(role)[r.LogicalResourceId],'UNEXPECTED_CFN_RESOURCE_CHANGE');
  if(r.Action==='Modify')ensure(r.LogicalResourceId===SERVICE[role]&&r.Replacement==='False'&&(r.Scope??[]).every(s=>s==='Properties')&&(r.Details??[]).every(d=>d.Target?.Attribute==='Properties'&&d.Target?.Name==='DesiredCount'),'ONLY_SERVICE_COUNT_MODIFICATION_ALLOWED');
  if(r.Action==='Remove')ensure(EDGE[role].includes(r.LogicalResourceId)&&!['Retain','Snapshot'].includes(r.PolicyAction),'RETAIN_OR_PROTECTED_REMOVAL');
 }
}
export async function applyStack({c,io,store,j,key,role,current,target,overrides={},waitSeconds}){
 const before=await readStack(c,io,role);assertSameStack(before,current);
 for(const k of Object.keys(overrides))ensure(role==='tenant'&&CELL_BINDINGS.includes(k)&&Object.hasOwn(target.Parameters??{},k),'ONLY_CELL_OUTPUT_PARAMETER_UPDATES');
 const actualOverrides=Object.fromEntries(Object.entries(overrides).filter(([k,v])=>before.parameterHashes[k]!==hash(v)));
 if(before.templateSha256===hash(target)&&!Object.keys(actualOverrides).length)return before;
 const shape=changeShape(before.template,target,actualOverrides);for(const [id,action]of Object.entries(shape))ensure(action==='Modify'?id===SERVICE[role]:EDGE[role].includes(id),'LIFECYCLE_CHANGE_OUTSIDE_ALLOWED_IDS');
 const token='tl-env-'+hash([j.planSha256,key]).slice(0,36),name=token+'-plan',body=JSON.stringify(canonical(target));ensure(Buffer.byteLength(body)<=51200,'TEMPLATE_TOO_LARGE_FOR_INLINE_REVIEW');
 const list=await io.call('cloudformation','list-change-sets',{StackName:before.stackId});ensure(!list.NextToken&&!(list.Summaries??[]).some(x=>x.ExecutionStatus==='AVAILABLE'||['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(x.Status)),'OTHER_AVAILABLE_CHANGE_SET_INSPECT');
 const request={StackName:before.stackId,ChangeSetName:name,ClientToken:token+'-create',ChangeSetType:'UPDATE',IncludeNestedStacks:false,ImportExistingResources:false,TemplateBody:body,Tags:copy(before.stackTags),
  Parameters:Object.keys(target.Parameters??{}).sort().map(k=>Object.hasOwn(actualOverrides,k)?{ParameterKey:k,ParameterValue:actualOverrides[k]}:{ParameterKey:k,UsePreviousValue:true})};
 io.progress?.({stage:key,stackId:before.stackId,status:'CREATING_REVIEWED_CHANGE_SET'});
 const ack=await writeOnce(io,store,j,key+'/create','cloudformation','create-change-set',request);ensure(ack.StackId===before.stackId&&ack.Id?.startsWith(`arn:aws:cloudformation:${c.region}:${c.accountId}:changeSet/${name}/`),'CHANGE_SET_ACK_BINDING');j.changeSets[key]={id:ack.Id,shape};await store.saveJournal(j);
 const p=await poll(io,async()=>{const x=await io.call('cloudformation','describe-change-set',{StackName:before.stackId,ChangeSetName:ack.Id});io.progress?.({stage:key,stackId:before.stackId,status:x.Status});ensure(x.Status!=='FAILED','CHANGE_SET_CREATION_FAILED_INSPECT');return x.Status==='CREATE_COMPLETE'?x:null;},waitSeconds,'CHANGE_SET_WAIT_TIMEOUT_INSPECT');
 // DescribeChangeSet has no RoleARN output. The request omits a new role; fresh DescribeStacks below verifies the inherited stack role before Execute.
 reviewChangeSet(p,{stackId:before.stackId,shape,role});ensure(p.ChangeSetId===ack.Id&&hash(tagMap(p.Tags))===hash(tagMap(before.stackTags)),'CHANGE_SET_TAGS_OR_ID_CHANGED');
 const proposed=await io.call('cloudformation','get-template',{StackName:before.stackId,ChangeSetName:ack.Id,TemplateStage:'Original'});ensure(hash(typeof proposed.TemplateBody==='string'?JSON.parse(proposed.TemplateBody):proposed.TemplateBody)===hash(target),'PROPOSED_TEMPLATE_CHANGED');
 const fresh=(await io.call('cloudformation','describe-stacks',{StackName:before.stackId})).Stacks;ensure(fresh?.length===1&&fresh[0].StackId===before.stackId&&['UPDATE_COMPLETE','CREATE_COMPLETE'].includes(fresh[0].StackStatus)&&(fresh[0].RoleARN??null)===before.roleArn&&(fresh[0].LastUpdatedTime??fresh[0].CreationTime)===before.lastUpdatedAt&&hash(tagMap(fresh[0].Tags))===before.tagHash,'STACK_CHANGED_BEFORE_EXECUTE');
 await writeOnce(io,store,j,key+'/execute','cloudformation','execute-change-set',{StackName:before.stackId,ChangeSetName:ack.Id,ClientRequestToken:token+'-execute',DisableRollback:false});
 await poll(io,async()=>{const r=await io.call('cloudformation','describe-stacks',{StackName:before.stackId}),s=r.Stacks?.[0];ensure(r.Stacks?.length===1&&s.StackId===before.stackId,'ROOT_STACK_BINDING');io.progress?.({stage:key,stackId:before.stackId,status:s.StackStatus});if(s.StackStatus==='UPDATE_COMPLETE')return true;ensure(s.StackStatus.endsWith('_IN_PROGRESS'),'CFN_UPDATE_NOT_ACCEPTED_INSPECT');return false;},waitSeconds,'CFN_UPDATE_WAIT_TIMEOUT_INSPECT');
 const after=await readStack(c,io,role);ensure(after.templateSha256===hash(target)&&after.roleArn===before.roleArn&&after.tagHash===before.tagHash,'APPLIED_TEMPLATE_ROLE_OR_TAG_MISMATCH');
 for(const [id,r]of Object.entries(before.bindings))if(target.Resources[id])ensure(after.bindings[id]?.physicalId===r.physicalId,'RETAINED_RESOURCE_REPLACED');
 for(const [k,v]of Object.entries(actualOverrides))ensure(after.parameterHashes[k]===hash(v),'CELL_OUTPUT_PARAMETER_NOT_APPLIED');
 for(const k of before.parameterKeys)if(!Object.hasOwn(actualOverrides,k))ensure(after.parameterHashes[k]===before.parameterHashes[k],'UNRELATED_PARAMETER_CHANGED');
 const executed=await io.call('cloudformation','describe-change-set',{StackName:before.stackId,ChangeSetName:ack.Id});ensure(executed.ExecutionStatus==='EXECUTE_COMPLETE','CHANGE_SET_NOT_EXECUTE_COMPLETE');
 j.completedStages.push(key);j.stageProofs[key]={templateSha256:after.templateSha256,bindings:after.bindings,outputs:after.outputs};await store.saveJournal(j);return after;
}
