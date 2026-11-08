// Temporary operator CLI: private reviewed plans, existing-stack CFN updates only.
import {readFile,lstat,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FileStore} from '../aws-resource-power/cli.mjs';
import {ensure} from '../aws-resource-power/core.mjs';
import {hash,ROLES} from './environment-cfn.mjs';
import {validateEnvironment,configHash,captureEnvironment,publicStatus,prepareEnvironmentPlan,executeEnvironmentPlan} from './environment.mjs';
const run=promisify(execFile),ROOT_SCHEMA='techlong/temporary-environment-state/v2',repo=fileURLToPath(new URL('../../',import.meta.url));
async function implementationHash(){const files=['scripts/aws-environment.mjs','ops/temporary-idle/environment.mjs','ops/temporary-idle/environment-cfn.mjs','ops/temporary-idle/environment-lifecycle.mjs','ops/temporary-idle/environment-cli.mjs','ops/aws-resource-power/core.mjs','ops/aws-resource-power/cli.mjs','ops/deployment-baseline/existing-tenant.template.json'];return hash(await Promise.all(files.map(async file=>({file,content:(await readFile(path.join(repo,file),'utf8')).replaceAll('\r\n','\n')}))));}
export const DEFAULT_CONFIG=fileURLToPath(new URL('./environment-cfn.local.json',import.meta.url));
export const EXTRA_OPERATIONS={reads:{
 sts:['get-caller-identity'],cloudformation:['describe-stacks','get-template','list-stack-resources','list-change-sets','describe-change-set'],
 ecs:['describe-services','describe-task-definition','list-services'],'application-autoscaling':['describe-scalable-targets'],
 rds:['describe-db-clusters','describe-db-instances'],elbv2:['describe-load-balancers','describe-tags','describe-listeners','describe-rules','describe-target-health'],
 route53:['list-resource-record-sets','get-change']},
 writes:{cloudformation:['create-change-set','execute-change-set'],rds:['stop-db-cluster','start-db-cluster','stop-db-instance','start-db-instance'],route53:['change-resource-record-sets']}};
const allowed=(table,s,o)=>table[s]?.includes(o);
export class EnvironmentAwsCli{
 constructor(config,directory,{executable='aws',allowWrites=false,exec=run}={}){Object.assign(this,{config,directory,executable,allowWrites,exec});}
 async call(service,operation,input){
  const read=allowed(EXTRA_OPERATIONS.reads,service,operation),write=allowed(EXTRA_OPERATIONS.writes,service,operation);
  ensure(read||write,'ENVIRONMENT_API_NOT_ALLOWED');ensure(!write||this.allowWrites,'ENVIRONMENT_WRITES_DISABLED');
  if(service==='cloudformation'){
   ensure(ROLES.some(r=>this.config.stacks[r].stackId===input.StackName),'EXACT_STACK_UUID_REQUIRED');
   if(write)ensure(operation==='create-change-set'?input.ChangeSetType==='UPDATE'&&!Object.hasOwn(input,'DeploymentMode')&&!Object.hasOwn(input,'DeploymentConfig')&&!input.RoleARN&&!input.Capabilities?.length&&!input.ImportExistingResources&&!input.IncludeNestedStacks:/^arn:aws:cloudformation:/.test(input.ChangeSetName)&&input.ChangeSetName.includes(':changeSet/tl-env-')&&input.DisableRollback===false,'ONLY_REVIEWED_EXISTING_STACK_UPDATES');
  }
  if(service==='rds'){
   const cluster=operation.includes('cluster'),id=cluster?input.DBClusterIdentifier:input.DBInstanceIdentifier;
   ensure(this.config.databases.some(d=>d.kind===(cluster?'cluster':'instance')&&d.id===id),'EXACT_DATABASE_REQUIRED');
  }
  if(service==='route53'){
   if(operation==='get-change')ensure(typeof input.Id==='string'&&input.Id.startsWith('/change/'),'EXACT_CHANGE_ID_REQUIRED');
   else ensure(input.HostedZoneId===this.config.externalApiAlias.zoneId,'EXACT_ZONE_REQUIRED');
   if(write){const rows=input.ChangeBatch?.Changes;ensure(rows?.length===1&&rows[0].Action==='UPSERT'&&rows[0].ResourceRecordSet?.Type==='A'&&rows[0].ResourceRecordSet?.Name?.toLowerCase().replace(/\.$/,'')===this.config.externalApiAlias.name.toLowerCase().replace(/\.$/,''),'ONLY_EXTERNAL_API_ALIAS_WRITE_ALLOWED');}
  }
  const file=path.join(this.directory,'request-'+randomUUID()+'.json');await writeFile(file,JSON.stringify(input),{flag:'wx',mode:0o600});
  const region=service==='route53'?'us-east-1':this.config.region,host=service==='elbv2'?'elasticloadbalancing':service,endpoint=service==='route53'?'https://route53.amazonaws.com':'https://'+host+'.'+region+'.amazonaws.com';
  try{const r=await this.exec(this.executable,[service,operation,'--cli-input-json','file://'+file.replaceAll('\\','/'),'--profile',this.config.profile,'--region',region,'--endpoint-url',endpoint,
   '--output','json','--no-paginate','--no-cli-pager','--no-cli-auto-prompt','--cli-connect-timeout','10','--cli-read-timeout','60'],
   {windowsHide:true,timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true'}});
   return r.stdout.trim()?JSON.parse(r.stdout.replace(/^\uFEFF/,'')):{};
  }catch(e){throw Object.assign(Error('AWS_COMMAND_FAILED'),{code:String(e.stderr??'').match(/An error occurred \(([A-Za-z0-9_.-]+)\)/)?.[1]??'CLI_OR_NETWORK_FAILURE',operation});}
  finally{await unlink(file);}
 }
}
export const HELP=`Temporary CFN-owned test-environment tool; not a production runtime feature.
node scripts/aws-environment.mjs <status|plan-stop|plan-start|stop|start>
 [--config JSON] [--aws-cli executable] [--wait-seconds 1800]
 [--execute --confirm-account 12-digit-account]
 stop/start additionally require --plan UUID --approved-plan-sha SHA256

Without --execute: offline preview, no AWS credentials/calls or state-directory writes.
plan-stop/plan-start --execute: read-only preparation and private five-hour plan.
stop/start --execute: fresh preflight, exact approved plan, single submissions, independent verification.
CFN scales/removes/restores resources in the same stacks; no direct ELB/ECS writes or DeleteStack.
Databases are retained and only stopped/started. Console DNS remains CFN-owned.
No new IAM, images, data import, resource expiry, read/write retry or automatic cleanup.
Preserve all old v1 backups; no automatic migration, fallback or replay.
Start requires a fresh role-scope review acknowledgement before preparing the approved plan.
Failures/unknown submissions require inspection, not lock deletion or re-running a phase.
RDS may auto-start after 7 days; remaining storage/backups/logs/CDN/ECR/Secrets can still charge.
`;
export function parseEnvironmentArgs(args){
 if(!args.length||args.length===1&&['--help','-h'].includes(args[0]))return {help:true};
 const p={mode:args[0],execute:false};ensure(['status','plan-stop','plan-start','stop','start'].includes(p.mode),'ENVIRONMENT_MODE');
 const valued=['--config','--confirm-account','--wait-seconds','--aws-cli','--plan','--approved-plan-sha'];
 for(let i=1;i<args.length;i++){const k=args[i];if(k==='--execute'){ensure(!p.execute,'DUPLICATE_ARGUMENT');p.execute=true;continue;}ensure(valued.includes(k)&&p[k]===undefined&&args[i+1]&&!args[i+1].startsWith('--'),'INVALID_ARGUMENT');p[k]=args[++i];}
 p.waitSeconds=p['--wait-seconds']===undefined?1800:Number(p['--wait-seconds']);ensure(Number.isInteger(p.waitSeconds)&&p.waitSeconds>=1&&p.waitSeconds<=7200,'WAIT_RANGE');
 if(p.execute){ensure(/^\d{12}$/.test(p['--confirm-account']),'EXPLICIT_ACCOUNT_CONFIRMATION_REQUIRED');if(['stop','start'].includes(p.mode))ensure(/^[a-f0-9-]{36}$/.test(p['--plan']??'')&&/^[a-f0-9]{64}$/.test(p['--approved-plan-sha']??''),'EXACT_PLAN_AND_SHA_REQUIRED');}
 if(!['stop','start'].includes(p.mode))ensure(!p['--plan']&&!p['--approved-plan-sha'],'PLAN_ARGUMENTS_ONLY_FOR_APPLY');
 return p;
}
export function stateDirectory(c){
 const dir=path.resolve(c.stateDirectory),relative=path.relative(repo,dir);
 ensure(path.isAbsolute(c.stateDirectory)&&path.basename(dir).startsWith('aws-environment-cfn-')&&path.dirname(dir)!==path.parse(dir).root&&dir!==os.homedir()&&relative!==''&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'NEW_PRIVATE_V2_STATE_OUTSIDE_REPOSITORY_REQUIRED');return dir;
}
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function openRoot(c){
 const root=new FileStore(stateDirectory(c));if(!await exists(root.directory)){await root.createDirectory();await root.createSnapshot({schema:ROOT_SCHEMA,configSha256:configHash(c)},{schema:ROOT_SCHEMA,configSha256:configHash(c),completedPlanId:null,completedMode:null,pendingPlanId:null});}
 const s=await root.read('snapshot.json'),j=await root.read('journal.json');ensure(s.schema===ROOT_SCHEMA&&j.schema===ROOT_SCHEMA&&s.configSha256===configHash(c)&&j.configSha256===configHash(c),'ENVIRONMENT_STATE_CONFIG_MISMATCH');return root;
}
function planStore(root,id){ensure(/^[a-f0-9-]{36}$/.test(id),'PLAN_ID_INVALID');return new FileStore(path.join(root.directory,'plan-'+id));}
async function loadPlan(s){const snapshot=await s.read('snapshot.json'),j=await s.read('journal.json');ensure(snapshot.schema==='techlong/temporary-environment-plan-file/v2'&&j.planSha256===hash(snapshot.plan),'PLAN_BACKUP_INTEGRITY');return {plan:snapshot.plan,journal:j};}
async function priorContext(root,j){
 if(!j.completedPlanId)return {base:null,expectedMode:null};const s=planStore(root,j.completedPlanId),{plan}=await loadPlan(s);
 const attempt=new FileStore(path.join(s.directory,'attempt')),record=await attempt.read('journal.json'),snap=await attempt.read('snapshot.json');ensure(hash(snap.plan)===record.planSha256&&record.planSha256===hash(plan)&&['STOPPED','RUNNING'].includes(record.status),'COMPLETED_CYCLE_INTEGRITY');
 ensure(j.completedMode===(record.status==='STOPPED'?'stopped':'running'),'ROOT_COMPLETED_MODE_MISMATCH');return {base:plan.base,expectedMode:j.completedMode};
}
export async function executeEnvironmentCommand(p,config,{exec=run,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),progress=()=>{}}={}){
 const c=validateEnvironment(config),directory=stateDirectory(c);
 if(!p.execute)return {mode:p.mode,offlinePreview:true,awsCalls:0,enabled:c.enabled,stateDirectory:directory,stackIds:Object.fromEntries(ROLES.map(r=>[r,c.stacks[r].stackId])),databases:c.databases,cfnOnly:true,noAutomaticExpiry:true,requiresFreshApprovedPlan:['stop','start'].includes(p.mode),noDataImport:true};
 ensure(c.enabled&&p['--confirm-account']===c.accountId,'ENVIRONMENT_DISABLED_OR_ACCOUNT_MISMATCH');ensure(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.env.AWS_ACCESS_KEY_ID&&!process.env.AWS_SECRET_ACCESS_KEY&&!process.env.AWS_SESSION_TOKEN,'UNSAFE_ENVIRONMENT');
 const root=await openRoot(c),release=await root.lock();
 try{
  const rootJournal=await root.read('journal.json');ensure(rootJournal.schema===ROOT_SCHEMA&&rootJournal.configSha256===configHash(c),'STATE_CHANGED_AFTER_LOCK');
  const cli=new EnvironmentAwsCli(c,root.directory,{executable:p['--aws-cli']??c.awsCliExecutable??'aws',allowWrites:['stop','start'].includes(p.mode),exec}),io={call:cli.call.bind(cli),now,sleep,progress};
  const context=await priorContext(root,rootJournal);
  if(p.mode==='status'&&rootJournal.pendingPlanId){
   const who=await io.call('sts','get-caller-identity',{});ensure(who.Account===c.accountId&&who.Arn===c.expectedPrincipalArn&&who.UserId===c.expectedPrincipalUserId,'ENVIRONMENT_IDENTITY_MISMATCH');
   const s=planStore(root,rootJournal.pendingPlanId),attempt=new FileStore(path.join(s.directory,'attempt')),j=await attempt.read('journal.json'),stacks={};
   for(const role of ROLES){const r=await io.call('cloudformation','describe-stacks',{StackName:c.stacks[role].stackId});ensure(r.Stacks?.length===1&&r.Stacks[0].StackId===c.stacks[role].stackId,'EXACT_STACK_UUID_REQUIRED');stacks[role]={stackId:r.Stacks[0].StackId,status:r.Stacks[0].StackStatus};}
   return {status:'NEEDS_INSPECTION',pendingPlanId:rootJournal.pendingPlanId,readOnly:true,stacks,completedStages:j.completedStages,actions:j.actions,error:j.error??null,retry:false,zeroAccountCharges:false};
  }
  if(p.mode==='status')return {...publicStatus(await captureEnvironment({config:c,io,...context}),c),readOnly:true,pendingPlanId:rootJournal.pendingPlanId};
  ensure(!rootJournal.pendingPlanId,'PREVIOUS_OPERATION_REQUIRES_INSPECTION');
  if(p.mode.startsWith('plan-')){
   const plan=await prepareEnvironmentPlan({config:c,io,mode:p.mode.slice(5),...context,waitSeconds:p.waitSeconds});plan.parentCompletedPlanId=rootJournal.completedPlanId;plan.implementationSha256=await implementationHash();
   const s=planStore(root,plan.id);await s.createDirectory();await s.createSnapshot({schema:'techlong/temporary-environment-plan-file/v2',plan},{schema:ROOT_SCHEMA,planSha256:hash(plan),status:'PREPARED'});
   return {status:'PLAN_PREPARED_NOT_EXECUTED',mode:plan.mode,planId:plan.id,planSha256:hash(plan),implementationSha256:plan.implementationSha256,limits:plan.limits,writeBefore:new Date(plan.writeBefore).toISOString(),privatePlanDirectory:s.directory,cloudWrites:0,roleScopeReviewRequiredBeforeStart:plan.writePolicy.roleScopeReviewRequiredBeforeStart};
  }
  const s=planStore(root,p['--plan']),{plan,journal:pj}=await loadPlan(s);ensure(plan.mode===p.mode&&hash(plan)===p['--approved-plan-sha']&&plan.parentCompletedPlanId===rootJournal.completedPlanId,'PLAN_MODE_SHA_OR_PARENT_MISMATCH');
  ensure(plan.implementationSha256===await implementationHash(),'PLAN_IMPLEMENTATION_CHANGED_REPREPARE');
  ensure(pj.status==='PREPARED','PLAN_ALREADY_ATTEMPTED_NO_REPLAY');const attempt=new FileStore(path.join(s.directory,'attempt'));ensure(!await exists(attempt.directory),'ATTEMPT_EXISTS_NO_REPLAY');await attempt.createDirectory();
  let opened=false;
  try{
   const result=await executeEnvironmentPlan({config:c,io,plan,approvedSha:p['--approved-plan-sha'],store:attempt,onAttemptStarted:async()=>{
    opened=true;pj.status='APPLYING';await s.saveJournal(pj);rootJournal.pendingPlanId=plan.id;await root.saveJournal(rootJournal);
   }});
   pj.status=result.status;await s.saveJournal(pj);rootJournal.completedPlanId=plan.id;rootJournal.completedMode=result.status==='STOPPED'?'stopped':'running';rootJournal.pendingPlanId=null;await root.saveJournal(rootJournal);
   return {...result,planId:plan.id,stateDirectory:directory};
  }catch(e){pj.status=opened?'NEEDS_INSPECTION':'PREFLIGHT_FAILED_NO_CLOUD_WRITE';await s.saveJournal(pj);throw e;}
 }finally{await release();}
}
export async function main(args=process.argv.slice(2)){
 try{const p=parseEnvironmentArgs(args);if(p.help){console.log(HELP);return;}const c=JSON.parse(await readFile(p['--config']??DEFAULT_CONFIG,'utf8'));console.log(JSON.stringify(await executeEnvironmentCommand(p,c,{progress:x=>process.stderr.write(JSON.stringify(x)+'\n')}),null,2));}
 catch(e){console.error(JSON.stringify({status:'ENVIRONMENT_STOPPED_FOR_INSPECTION',code:/^[A-Za-z0-9_.-]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'DETAILS_WITHHELD',operation:e.operation??null,retry:false,rollback:false}));process.exitCode=1;}
}
