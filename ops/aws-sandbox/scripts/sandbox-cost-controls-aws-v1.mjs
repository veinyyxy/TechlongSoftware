import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand, ListChangeSetsCommand,
  DescribeChangeSetCommand, CreateChangeSetCommand, ExecuteChangeSetCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, DescribeTableCommand, ListTagsOfResourceCommand, UpdateTableCommand } from "@aws-sdk/client-dynamodb";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as s, costChangeSetNameV1, assertCostChangeSetV1, assertCostProgressV1 } from "../../../lib/deployments/execution/sandbox-cost-controls-v1.ts";
const cfg={region:s.region,ignoreConfiguredEndpointUrls:true,maxAttempts:1},exec=promisify(execFile),equal=(a,b)=>canonicalJson(a)===canonicalJson(b),sortTags=t=>[...t].sort((a,b)=>a.Key.localeCompare(b.Key));
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),fail=code=>{throw Error(code);};
export function createCostControlsAwsRuntimeV1(slot) {
 const provider=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:cfg});
 const session=async()=>{const credentials=await provider(),sts=new STSClient({...cfg,credentials});try{const r=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});
  if(r.Account!==s.accountId||r.Arn!==s.sourceArn||r.UserId!==s.sourceUserId)fail("COST_CONTROL_SOURCE_INVALID");return credentials;}finally{sts.destroy();}};
 const withClient=async(Type,fn)=>{const c=new Type({...cfg,credentials:await session()});try{return await fn(c);}finally{c.destroy();}};
 const send=(c,cmd)=>c.send(cmd,{abortSignal:AbortSignal.timeout(15000)});
 // No budget mutation command is exposed: CloudFormation remains its owner.
 const budgetRead=async(args)=>{if(!["describe-budget","describe-notifications-for-budget","describe-subscribers-for-notification","describe-budget-actions-for-budget","list-tags-for-resource"].includes(args[0]))fail("COST_CONTROL_BUDGET_COMMAND_REJECTED");
  const c=await session();try{const r=await exec("aws",["budgets",...args,"--region","us-east-1","--no-cli-pager","--no-paginate","--output","json","--cli-connect-timeout","10","--cli-read-timeout","20"],
   {windowsHide:true,timeout:30000,maxBuffer:2000000,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:c.accessKeyId,AWS_SECRET_ACCESS_KEY:c.secretAccessKey,AWS_SESSION_TOKEN:c.sessionToken,AWS_MAX_ATTEMPTS:"1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_PAGER:"",AWS_CLI_AUTO_PROMPT:"off"}});
   return r.stdout.trim()?JSON.parse(r.stdout):{};}catch{fail("COST_CONTROL_BUDGET_READ_UNVERIFIED");}};
 const account=["--account-id",s.accountId,"--budget-name",s.budgetName];
 const readBudget=async()=>{const [raw,n,a,tags]=await Promise.all([budgetRead(["describe-budget",...account]),budgetRead(["describe-notifications-for-budget",...account]),budgetRead(["describe-budget-actions-for-budget",...account]),budgetRead(["list-tags-for-resource","--resource-arn",`arn:aws:budgets::${s.accountId}:budget/${s.budgetName}`])]);
  if(n.NextToken||a.NextToken||tags.NextToken||!Array.isArray(n.Notifications)||n.Notifications.length!==5||!Array.isArray(a.Actions)||!Array.isArray(tags.ResourceTags))fail("COST_CONTROL_BUDGET_PAGINATED_OR_UNVERIFIED");
  const b=raw.Budget,fields=["BudgetName","BudgetLimit","BudgetType","TimeUnit","CostFilters","CostTypes","TimePeriod"],readOnly=["CalculatedSpend","LastUpdatedTime","HealthStatus"];
  if(!b||Object.keys(b).some(k=>!fields.includes(k)&&!readOnly.includes(k))||fields.some(k=>b[k]===undefined)||b.HealthStatus?.Status!=="HEALTHY")fail("COST_CONTROL_BUDGET_MODE_UNREVIEWED");
  const config=Object.fromEntries(fields.map(k=>[k,b[k]]));config.BudgetLimit={Amount:String(Number(b.BudgetLimit.Amount)),Unit:b.BudgetLimit.Unit};
  config.TimePeriod={Start:new Date(b.TimePeriod.Start).toISOString(),End:new Date(b.TimePeriod.End).toISOString()};
  const notifications=await Promise.all(n.Notifications.map(async raw=>{if(Object.keys(raw).some(k=>!["NotificationType","ComparisonOperator","Threshold","ThresholdType","NotificationState"].includes(k)))fail("COST_CONTROL_NOTIFICATION_UNREVIEWED");
   // The original pinned CFN template explicitly uses PERCENTAGE; the API omits it for that default.
   const notification={NotificationType:raw.NotificationType,ComparisonOperator:raw.ComparisonOperator,Threshold:raw.Threshold,ThresholdType:raw.ThresholdType??"PERCENTAGE"};
   const request={...notification};if(raw.ThresholdType===undefined)delete request.ThresholdType;
   const r=await budgetRead(["describe-subscribers-for-notification",...account,"--notification",JSON.stringify(request)]);
   if(r.NextToken||!Array.isArray(r.Subscribers))fail("COST_CONTROL_SUBSCRIBERS_UNVERIFIED");
   return{notification,subscribers:r.Subscribers.map(x=>({Address:x.Address,SubscriptionType:x.SubscriptionType})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))};
  }));notifications.sort((a,b)=>a.notification.Threshold-b.notification.Threshold);
  return{config,notifications,tags:sortTags(tags.ResourceTags),actions:a.Actions};};
 const readStack=()=>withClient(CloudFormationClient,async c=>{const [raw,body,res,cs]=await Promise.all([send(c,new DescribeStacksCommand({StackName:s.stackId})),send(c,new GetTemplateCommand({StackName:s.stackId,TemplateStage:"Original"})),send(c,new ListStackResourcesCommand({StackName:s.stackId})),send(c,new ListChangeSetsCommand({StackName:s.stackId}))]);
  if(raw.Stacks?.length!==1||res.NextToken||cs.NextToken||!Array.isArray(res.StackResourceSummaries)||!Array.isArray(cs.Summaries))fail("COST_CONTROL_STACK_PAGINATED_OR_UNVERIFIED");
  const stack=raw.Stacks[0],template=typeof body.TemplateBody==="string"?JSON.parse(body.TemplateBody):body.TemplateBody;
  if(stack.StackId!==s.stackId||stack.StackName!==s.stackName||!stack.Parameters||new Set(stack.Parameters.map(p=>p.ParameterKey)).size!==stack.Parameters.length)fail("COST_CONTROL_STACK_IDENTITY_UNVERIFIED");
  const settings={id:stack.StackId,name:stack.StackName,parameters:Object.fromEntries(stack.Parameters.map(p=>[p.ParameterKey,p.ParameterValue])),templateSha256:await sha256Hex(template),
   tags:sortTags(stack.Tags??[]),roleArn:stack.RoleARN??null,capabilities:stack.Capabilities??[],notificationArns:stack.NotificationARNs??[],resources:res.StackResourceSummaries.map(x=>({logicalId:x.LogicalResourceId,type:x.ResourceType,physicalId:x.PhysicalResourceId})).sort((a,b)=>a.logicalId.localeCompare(b.logicalId))};
  const changeSets=cs.Summaries.map(x=>({id:x.ChangeSetId,name:x.ChangeSetName,status:x.Status,executionStatus:x.ExecutionStatus,includeNested:x.IncludeNestedStacks??false})).sort((a,b)=>a.id.localeCompare(b.id));
  return{settings,status:stack.StackStatus,changeSets,template};});
 const readTable=()=>withClient(DynamoDBClient,async c=>{const [raw,tags]=await Promise.all([send(c,new DescribeTableCommand({TableName:s.tableName})),send(c,new ListTagsOfResourceCommand({ResourceArn:s.tableArn}))]);
  if(tags.NextToken||!raw.Table||raw.Table.TableArn!==s.tableArn||raw.Table.TableId!==s.tableId)fail("COST_CONTROL_TABLE_IDENTITY_UNVERIFIED");const t=raw.Table;
  return{status:t.TableStatus,settings:{id:t.TableId,arn:t.TableArn,maxRead:t.OnDemandThroughput?.MaxReadRequestUnits,maxWrite:t.OnDemandThroughput?.MaxWriteRequestUnits,tags:sortTags(tags.Tags??[]),
   config:{billingMode:t.BillingModeSummary?.BillingMode,tableClass:t.TableClassSummary?.TableClass,deletionProtection:t.DeletionProtectionEnabled??false,attributes:t.AttributeDefinitions,keySchema:t.KeySchema,stream:t.StreamSpecification??null,sse:t.SSEDescription??null,globalIndexes:t.GlobalSecondaryIndexes??[],localIndexes:t.LocalSecondaryIndexes??[],replicas:t.Replicas??[]}}};});
 const permissions=()=>withClient(IAMClient,async c=>{const cases=[["cloudformation:CreateChangeSet",s.stackId,s.region],["cloudformation:ExecuteChangeSet",s.stackId,s.region],["budgets:ModifyBudget",`arn:aws:budgets::${s.accountId}:budget/${s.budgetName}`,"us-east-1"],["dynamodb:UpdateTable",s.tableArn,s.region]],checks=[];
  for(const[action,resource,region]of cases){const r=await send(c,new SimulatePrincipalPolicyCommand({PolicySourceArn:s.sourceArn,ActionNames:[action],ResourceArns:[resource],ContextEntries:[{ContextKeyName:"aws:RequestedRegion",ContextKeyType:"string",ContextKeyValues:[region]}]}));
   if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)fail("COST_CONTROL_PERMISSION_UNVERIFIED");checks.push({action,resource,decision:r.EvaluationResults[0].EvalDecision});}return checks;});
 const inventory=async(checkPermissions)=>{const observedAt=Date.now();const [stack,budget,table,checks]=await Promise.all([readStack(),readBudget(),readTable(),checkPermissions?permissions():Promise.resolve([])]);
  if(Date.now()-observedAt>30000)fail("COST_CONTROL_INVENTORY_STALE");const preservedFailedChangeSets=[];
  if(checkPermissions)await withClient(CloudFormationClient,async c=>{for(const arn of s.oldFailedChangeSetIds){const r=await send(c,new DescribeChangeSetCommand({StackName:s.stackId,ChangeSetName:arn}));if(r.ChangeSetId!==arn||r.StackId!==s.stackId||r.NextToken)fail("COST_CONTROL_OLD_RECORD_UNVERIFIED");preservedFailedChangeSets.push(r);}});
  if(Date.now()-observedAt>30000)fail("COST_CONTROL_INVENTORY_STALE");
  return{observedAt,settings:{stack:stack.settings,budget,table:table.settings},stackStatus:stack.status,tableStatus:table.status,changeSets:stack.changeSets,permissionsAllowed:checkPermissions?checks.length===4&&checks.every(x=>x.decision==="allowed"):false,permissionChecks:checks,preservedFailedChangeSets};};
 const deadline=m=>{const n=Date.now();if(n<m.reviewedAt||n+5000>=m.expiresAt)fail("COST_CONTROL_FRESH_APPROVAL_REQUIRED");};
 const boundSlot=async m=>{if(!equal(JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8")),m))fail("COST_CONTROL_SLOT_MANIFEST_DRIFT");};
 const checkOwnArn=(m,arn)=>{if(!new RegExp(`^arn:aws:cloudformation:${s.region}:${s.accountId}:changeSet/${costChangeSetNameV1(m)}/[a-f0-9-]{36}$`).test(arn))fail("COST_CONTROL_CHANGESET_ARN_UNVERIFIED");};
 const createChangeSetOnce=async m=>{await boundSlot(m);return withClient(CloudFormationClient,async c=>{deadline(m);const r=await send(c,new CreateChangeSetCommand({StackName:s.stackId,ChangeSetName:costChangeSetNameV1(m),ChangeSetType:"UPDATE",TemplateBody:JSON.stringify(m.candidateTemplate),
   Parameters:Object.entries({...m.before.stack.parameters,MonthlyBudgetUsd:"50"}).map(([ParameterKey,ParameterValue])=>({ParameterKey,ParameterValue})),Tags:m.before.stack.tags,IncludeNestedStacks:false,
   Description:`Reviewed F3c3a cost controls ${m.manifestSha256}`,ClientToken:`f3c3a-create-${m.manifestSha256}`}));if(r.StackId!==s.stackId)fail("COST_CONTROL_CHANGESET_STACK_UNVERIFIED");checkOwnArn(m,r.Id);return{changeSetArn:r.Id};});};
 const readReviewedChangeSet=async(m,arn)=>{checkOwnArn(m,arn);return withClient(CloudFormationClient,async c=>{let r;
  for(let n=0;n<15;n++){r=await send(c,new DescribeChangeSetCommand({StackName:s.stackId,ChangeSetName:arn}));if(r.Status==="CREATE_COMPLETE")break;if(!["CREATE_PENDING","CREATE_IN_PROGRESS"].includes(r.Status))fail("COST_CONTROL_CHANGESET_NOT_READY");await sleep(2000);}
  const t=await send(c,new GetTemplateCommand({StackName:s.stackId,ChangeSetName:arn,TemplateStage:"Original"}));assertCostChangeSetV1(m,r,typeof t.TemplateBody==="string"?JSON.parse(t.TemplateBody):t.TemplateBody,arn);});};
 const executeChangeSetOnce=async(m,arn)=>{await boundSlot(m);await readReviewedChangeSet(m,arn);await withClient(CloudFormationClient,async c=>{deadline(m);await send(c,new ExecuteChangeSetCommand({StackName:s.stackId,ChangeSetName:arn,ClientRequestToken:`f3c3a-execute-${m.manifestSha256}`,DisableRollback:true}));});};
 const waitBudgetUpdate=async(m,arn)=>{checkOwnArn(m,arn);for(let n=0;n<20;n++){const r=await readStack();if(r.status==="UPDATE_COMPLETE")return;if(!["UPDATE_IN_PROGRESS","UPDATE_COMPLETE_CLEANUP_IN_PROGRESS","CREATE_COMPLETE"].includes(r.status))fail("COST_CONTROL_BUDGET_UPDATE_UNVERIFIED");await sleep(3000);}fail("COST_CONTROL_BUDGET_UPDATE_PENDING_INSPECT_ONLY");};
 const updateReadLimitOnce=async m=>{await boundSlot(m);const i=await inventory(false);const marker=JSON.parse(await readFile(path.join(slot,"create-confirmed.json"),"utf8"));assertCostProgressV1(m,i,"budget",marker.changeSetArn);
  await withClient(DynamoDBClient,async c=>{deadline(m);const r=await send(c,new UpdateTableCommand({TableName:s.tableName,OnDemandThroughput:{MaxReadRequestUnits:100,MaxWriteRequestUnits:2}}));
   if(r.TableDescription?.TableArn!==s.tableArn||r.TableDescription?.TableId!==s.tableId)fail("COST_CONTROL_READ_LIMIT_RESPONSE_UNVERIFIED");});};
 const inspect=async m=>{let table;for(let n=0;n<15;n++){table=await readTable();if(table.status==="ACTIVE")break;if(table.status!=="UPDATING")fail("COST_CONTROL_TABLE_NOT_READY");await sleep(2000);}
  const i=await inventory(false),own=i.changeSets.filter(c=>c.name===costChangeSetNameV1(m));let costControlsVerified=false;try{if(own.length!==1)fail("COST_CONTROL_CHANGESET_STATE_UNVERIFIED");checkOwnArn(m,own[0].id);assertCostProgressV1(m,i,"complete",own[0].id);costControlsVerified=true;}catch{}
  return{observedAt:Date.now(),costControlsVerified,budgetUsd:Number(i.settings.budget.config.BudgetLimit.Amount),maxReadUnits:i.settings.table.maxRead,maxWriteUnits:i.settings.table.maxWrite,tableId:i.settings.table.id,
   stackId:i.settings.stack.id,stackStatus:i.stackStatus,tableStatus:i.tableStatus,settingsSha256:await sha256Hex(i.settings),oldFailedChangeSetsRemaining:i.changeSets.filter(c=>s.oldFailedChangeSetIds.includes(c.id)).map(c=>c.id),
   ownChangeSet:own.length===1?own[0]:null,exactPriorAlertsSubscribersTagsAndOtherSettingsPreserved:costControlsVerified,writes:0,retryAuthorized:false,paidCellCreated:false,runtimeEnabled:false};};
 return Object.freeze({inventory,createChangeSetOnce,readReviewedChangeSet,executeChangeSetOnce,waitBudgetUpdate,updateReadLimitOnce,inspect});
}
