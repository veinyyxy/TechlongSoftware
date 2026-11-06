// TEMPORARY operator tool. No import-time cloud access; not part of application runtime.
import {readFile,lstat,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FileStore,AwsCli,permittedOperations} from '../aws-resource-power/cli.mjs';
import {ensure,digest} from '../aws-resource-power/core.mjs';
import {TemporaryAwsCli,TemporaryStore,OPERATIONS} from './cli.mjs';
import {validateEnvironment,environmentStatus,stopEnvironment,startEnvironment} from './environment.mjs';

const run=promisify(execFile),ROOT_SCHEMA='techlong/temporary-environment-state/v1',repo=fileURLToPath(new URL('../../',import.meta.url));
export const DEFAULT_CONFIG=fileURLToPath(new URL('./environment.local.json',import.meta.url));
export const EXTRA_OPERATIONS={reads:{route53:['list-resource-record-sets','get-change'],ecs:['describe-task-definition'],elbv2:['describe-target-health']},writes:{route53:['change-resource-record-sets']}};
const includes=(table,service,operation)=>table[service]?.includes(operation);
export class EnvironmentAwsCli{
  constructor(config,directory,{executable='aws',allowWrites=false,exec=run}={}){
    Object.assign(this,{config,directory,executable,allowWrites,exec});
    this.power=new AwsCli(config,directory,{executable,allowWrites,exec});
    this.idle=new TemporaryAwsCli(config,directory,{executable,allowWrites,exec});
  }
  async call(service,operation,input){
    if(includes(permittedOperations.reads,service,operation)||includes(permittedOperations.writes,service,operation))return this.power.call(service,operation,input);
    if(includes(OPERATIONS.reads,service,operation)||includes(OPERATIONS.writes,service,operation))return this.idle.call(service,operation,input);
    const read=includes(EXTRA_OPERATIONS.reads,service,operation),write=includes(EXTRA_OPERATIONS.writes,service,operation);
    ensure(read||write,'ENVIRONMENT_API_NOT_ALLOWED');ensure(!write||this.allowWrites,'ENVIRONMENT_WRITES_DISABLED');
    const file=path.join(this.directory,`request-${randomUUID()}.json`);await writeFile(file,JSON.stringify(input),{flag:'wx',mode:0o600});
    // Route53 is global: a regional endpoint/signing region fails for this API.
    const region=service==='route53'?'us-east-1':this.config.region,host=service==='elbv2'?'elasticloadbalancing':service,
      endpoint=service==='route53'?'https://route53.amazonaws.com':`https://${host}.${region}.amazonaws.com`;
    try{const r=await this.exec(this.executable,[service,operation,'--cli-input-json',`file://${file.replaceAll('\\','/')}`,'--profile',this.config.profile,'--region',region,'--endpoint-url',endpoint,
      '--output','json','--no-paginate','--no-cli-pager','--no-cli-auto-prompt','--cli-connect-timeout','10','--cli-read-timeout','60'],
      {windowsHide:true,timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true'}});
      return r.stdout.trim()?JSON.parse(r.stdout.replace(/^\uFEFF/,'')):{};
    }catch(e){throw Object.assign(Error('AWS_COMMAND_FAILED'),{code:String(e.stderr??'').match(/An error occurred \(([A-Za-z0-9_.-]+)\)/)?.[1]??'CLI_OR_NETWORK_FAILURE',operation});}
    finally{await unlink(file);}
  }
}
export const HELP=`Temporary AWS test-environment power tool (not a deployment tool)
node scripts/aws-environment.mjs <status|stop|start>
  [--config <JSON>] [--aws-cli <executable>] [--wait-seconds 1800]
  [--execute --confirm-account <12-digit-account>]

Default config: ops/temporary-idle/environment.local.json (gitignored; configure once).
Without --execute: OFFLINE preview, ZERO AWS calls or state-directory writes.
status --execute: read-only live inventory. stop/start --execute: scoped AWS writes.
All live commands require exact account confirmation and enabled:true.
stop: private backup -> ECS=0 -> stop RDS (never delete) -> delete named ALBs -> paid-network idle.
start: saved network -> RDS/ALBs/listeners/rules -> exact DNS aliases -> ECS -> target health.
Each new stop after a completed start gets its own immutable backup, without ARN edits.
No expiry/watch, data import, IAM changes, CFN repair, write retry or automatic cleanup.
Failures/unknown submissions require inspection, not re-run. Preserve the entire state directory.
RDS can auto-start after 7 days; storage/backup/CloudFront/ECR/Secrets and other charges remain.
`;
export function parseEnvironmentArgs(args){
  if(!args.length||args.length===1&&['--help','-h'].includes(args[0]))return {help:true};
  const p={mode:args[0],execute:false};ensure(['stop','start','status'].includes(p.mode),'ENVIRONMENT_MODE');
  const valued=['--config','--confirm-account','--wait-seconds','--aws-cli'];
  for(let i=1;i<args.length;i++){const k=args[i];if(k==='--execute'){ensure(!p.execute,'DUPLICATE_ARGUMENT');p.execute=true;continue;}
    ensure(valued.includes(k)&&p[k]===undefined&&args[i+1]&&!args[i+1].startsWith('--'),'INVALID_ARGUMENT');p[k]=args[++i];}
  p.waitSeconds=p['--wait-seconds']===undefined?1800:Number(p['--wait-seconds']);
  ensure(Number.isInteger(p.waitSeconds)&&p.waitSeconds>=0&&p.waitSeconds<=7200&&(p.mode!=='start'||p.waitSeconds>0),'WAIT_RANGE');
  if(p.execute)ensure(/^\d{12}$/.test(p['--confirm-account']),'EXPLICIT_ACCOUNT_CONFIRMATION_REQUIRED');return p;
}
export function stateDirectory(config){
  const dir=path.resolve(config.stateDirectory),relative=path.relative(repo,dir);
  ensure(path.isAbsolute(config.stateDirectory)&&path.basename(dir).startsWith('aws-environment-')&&path.dirname(dir)!==path.parse(dir).root&&dir!==os.homedir()&&relative!==''&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'PRIVATE_STATE_OUTSIDE_REPOSITORY_REQUIRED');return dir;
}
async function openRoot(config){
  const root=new FileStore(stateDirectory(config));let exists=true;try{await lstat(root.directory);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
  if(!exists){await root.createDirectory();await root.createSnapshot({schema:ROOT_SCHEMA,configSha256:digest(config)},{schema:ROOT_SCHEMA,configSha256:digest(config),cycleId:null,status:'EMPTY'});}
  const snapshot=await root.read('snapshot.json'),j=await root.read('journal.json');
  ensure(snapshot.schema===ROOT_SCHEMA&&j.schema===ROOT_SCHEMA&&snapshot.configSha256===digest(config)&&j.configSha256===digest(config),'ENVIRONMENT_STATE_CONFIG_MISMATCH');
  ensure(j.cycleId===null||/^cycle-[0-9TZ-]+-[a-f0-9]{8}$/.test(j.cycleId),'CYCLE_PATH_INVALID');return {root,j};
}
function cycleStores(root,id){const dir=path.join(root.directory,id);return {cycleStore:new FileStore(dir),idleStore:new TemporaryStore(path.join(dir,'idle')),powerStore:new FileStore(path.join(dir,'power'))};}
export async function executeEnvironmentCommand(p,config,{exec=run,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const c=validateEnvironment(config),directory=stateDirectory(c);
  if(!p.execute)return {mode:p.mode,offlinePreview:true,awsCalls:0,enabled:c.enabled,stateDirectory:directory,accountId:c.accountId,region:c.region,
    services:c.services,databases:c.databases,loadBalancers:c.loadBalancers,dns:c.dns,noAutomaticExpiry:true,dataImport:false};
  ensure(c.enabled&&p['--confirm-account']===c.accountId,'ENVIRONMENT_DISABLED_OR_ACCOUNT_MISMATCH');
  ensure(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.env.AWS_ACCESS_KEY_ID&&!process.env.AWS_SECRET_ACCESS_KEY&&!process.env.AWS_SESSION_TOKEN,'UNSAFE_ENVIRONMENT');
  const {root}=await openRoot(c),release=await root.lock();
  try{
    // Read the pointer AFTER locking: another completed command may have changed it.
    const j=await root.read('journal.json');ensure(j.schema===ROOT_SCHEMA&&j.configSha256===digest(c)&&(j.cycleId===null||/^cycle-[0-9TZ-]+-[a-f0-9]{8}$/.test(j.cycleId)),'ENVIRONMENT_STATE_CONFIG_MISMATCH');
    const cli=new EnvironmentAwsCli(c,root.directory,{executable:p['--aws-cli']??c.awsCliExecutable??'aws',allowWrites:p.mode!=='status',exec}),io={call:cli.call.bind(cli),now,sleep};
    if(p.mode==='status')return {...await environmentStatus({config:c,io}),localCycle:j.cycleId,localStatus:j.status,readOnly:true};
    // Expired credentials must fail before a cycle/attempt is opened, not poison a valid backup.
    const who=await io.call('sts','get-caller-identity',{});ensure(who.Account===c.accountId&&who.Arn===c.expectedPrincipalArn,'ENVIRONMENT_IDENTITY_MISMATCH');
    if(p.mode==='stop'){
      if(j.cycleId&&['STOPPED','STOPPED_WITH_PUBLIC_IP_RESIDUALS'].includes(j.status)){
        const current=await environmentStatus({config:c,io});ensure(current.status==='STOPPED','STOPPED_ENVIRONMENT_CHANGED_INSPECT');return {...current,noWriteReplay:true};
      }
      ensure(j.status==='EMPTY'||j.status==='RUNNING','PREVIOUS_OPERATION_REQUIRES_INSPECTION');
      j.cycleId=`cycle-${new Date(now()).toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;j.status='STOPPING';await root.saveJournal(j);
      const stores=cycleStores(root,j.cycleId);for(const store of Object.values(stores))await store.createDirectory();
      try{const result=await stopEnvironment({config:c,io,...stores,waitSeconds:p.waitSeconds});j.status=result.status;await root.saveJournal(j);return {...result,cycleId:j.cycleId,stateDirectory:directory};}
      catch(e){j.status='STOP_FAILED_INSPECT';await root.saveJournal(j);throw e;}
    }
    ensure(j.cycleId,'NO_STOP_BACKUP_START_REQUIRES_EXISTING_CYCLE');
    ensure(['STOPPED','STOPPED_WITH_PUBLIC_IP_RESIDUALS','RUNNING'].includes(j.status),'PREVIOUS_OPERATION_REQUIRES_INSPECTION');
    const stores=cycleStores(root,j.cycleId);j.status='STARTING';await root.saveJournal(j);
    try{const result=await startEnvironment({config:c,io,...stores,waitSeconds:p.waitSeconds});
      ensure(['ENVIRONMENT_STARTED','RUNNING'].includes(result.status),'START_STATE_CHANGED_INSPECT');j.status='RUNNING';await root.saveJournal(j);return {...result,cycleId:j.cycleId,stateDirectory:directory};}
    catch(e){j.status='START_FAILED_INSPECT';await root.saveJournal(j);throw e;}
  }finally{await release();}
}
export async function main(args=process.argv.slice(2)){
  try{const p=parseEnvironmentArgs(args);if(p.help){console.log(HELP);return;}
    const config=JSON.parse(await readFile(p['--config']??DEFAULT_CONFIG,'utf8'));
    const result=await executeEnvironmentCommand(p,config);console.log(JSON.stringify(result,null,2));
    if(result.status==='STOPPED_WITH_PUBLIC_IP_RESIDUALS'||result.status==='PARTIAL_OR_TRANSITIONING')process.exitCode=2;
  }catch(e){console.error(JSON.stringify({status:'ENVIRONMENT_STOPPED_FOR_INSPECTION',code:/^[A-Za-z0-9_.-]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'DETAILS_WITHHELD',operation:e.operation??null,retry:false,rollback:false}));process.exitCode=1;}
}
