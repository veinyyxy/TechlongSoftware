// TEMPORARY: standalone operator entry. Production code must never import this directory.
import {readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {FileStore,AwsCli} from '../aws-resource-power/cli.mjs';
import {stopResources,resumeResources,digest,ensure} from '../aws-resource-power/core.mjs';
import {SCHEMA,validateConfig,idle,restoreNetwork,resumeCompute,waitForExpiry} from './core.mjs';

export const OPERATIONS={
  reads:{sts:['get-caller-identity'],ecs:['describe-services','list-tasks','describe-tasks'],
    'application-autoscaling':['describe-scalable-targets'],scheduler:['get-schedule'],events:['describe-rule','list-targets-by-rule'],
    ec2:['describe-nat-gateways','describe-route-tables','describe-vpc-endpoints','describe-addresses','describe-network-interfaces'],
    rds:['describe-db-clusters','describe-db-instances'],elbv2:['describe-load-balancers','describe-target-groups']},
  writes:{ecs:['update-service','stop-task'],'application-autoscaling':['register-scalable-target'],scheduler:['update-schedule'],events:['disable-rule','enable-rule'],
    ec2:['delete-route','delete-nat-gateway','delete-vpc-endpoints','release-address','allocate-address','create-nat-gateway','create-route','create-vpc-endpoint']},
};
const run=promisify(execFile);
export class TemporaryAwsCli{
  constructor(config,directory,{executable='aws',allowWrites=false,exec=run}={}){Object.assign(this,{config,directory,executable,allowWrites,exec});}
  async call(service,operation,input){
    const read=OPERATIONS.reads[service]?.includes(operation),write=OPERATIONS.writes[service]?.includes(operation);
    ensure(read||write,'TEMPORARY_API_NOT_ALLOWED');ensure(!write||this.allowWrites,'TEMPORARY_WRITES_DISABLED');
    const file=path.join(this.directory,`request-${randomUUID()}.json`);await writeFile(file,JSON.stringify(input),{flag:'wx',mode:0o600});
    const host=service==='elbv2'?'elasticloadbalancing':service;
    try{const r=await this.exec(this.executable,[service,operation,'--cli-input-json',`file://${file.replaceAll('\\','/')}`,'--profile',this.config.profile,'--region',this.config.region,
      '--endpoint-url',`https://${host}.${this.config.region}.amazonaws.com`,'--output','json','--no-paginate','--no-cli-pager','--no-cli-auto-prompt','--cli-connect-timeout','10','--cli-read-timeout','60'],
      {windowsHide:true,timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true'}});
      return r.stdout.trim()?JSON.parse(r.stdout.replace(/^\uFEFF/,'')):{};
    }catch(e){throw Object.assign(Error('AWS_COMMAND_FAILED'),{code:String(e.stderr??'').match(/An error occurred \(([A-Za-z0-9_.-]+)\)/)?.[1]??'CLI_OR_NETWORK_FAILURE',operation});}
    finally{await unlink(file);}
  }
}
export class TemporaryStore extends FileStore{
  async load(){const snapshot=await this.read('snapshot.json'),journal=await this.read('journal.json');ensure(snapshot.schema===SCHEMA&&journal.schema===SCHEMA&&journal.snapshotSha256===digest(snapshot),'TEMPORARY_BACKUP_INTEGRITY');return {snapshot,journal};}
}
const HELP=`TEMPORARY test-cost idle controls. Remove this directory and entry point before normal production operation.
node scripts/aws-temporary-idle.mjs <idle|watch|restore-network|restore-power|resume-compute> --state <directory>
  --config <JSON>                         required for idle/watch only
  --execute --confirm-account <account>   otherwise OFFLINE preview: zero AWS calls
  --wait-seconds 1800                     read-only polling limit, 0..7200
  --aws-cli <executable>                  optional AWS CLI v2 path
  --power-state <directory>               existing ALB/RDS backup, if not nested under this state
  --bindings-reviewed                    required before resume-compute

Config temporary:true + enabled:true is required for all live operations. Defaults are disabled.
watch waits locally for the fixed expiresAt, then runs idle once; it is NOT a cloud-installed scheduler.
Order: idle -> restore-network -> restore-power (existing tool) -> review bindings -> resume-compute.
Standalone tasks / expired one-shot schedules are NOT replayed. No VPC/RDS/ECR deletion API.
`;
export function parseArgs(args){
  if(!args.length||args.length===1&&['--help','-h'].includes(args[0]))return {help:true};
  const mode=args[0],p={mode,execute:false,bindingsReviewed:false};ensure(['idle','watch','restore-network','restore-power','resume-compute'].includes(mode),'MODE');
  const valued=['--config','--state','--confirm-account','--wait-seconds','--aws-cli','--power-state'];
  for(let i=1;i<args.length;i++){const k=args[i];if(k==='--execute'||k==='--bindings-reviewed'){const key=k==='--execute'?'execute':'bindingsReviewed';ensure(p[key]===false,'DUPLICATE_ARGUMENT');p[key]=true;continue;}
    ensure(valued.includes(k)&&p[k]===undefined&&args[i+1]&&!args[i+1].startsWith('--'),'ARGUMENT');p[k]=args[++i];}
  ensure(p['--state']&&(['idle','watch'].includes(mode)?p['--config']:!p['--config']),'STATE_OR_CONFIG');p.waitSeconds=p['--wait-seconds']===undefined?1800:Number(p['--wait-seconds']);
  ensure(Number.isInteger(p.waitSeconds)&&p.waitSeconds>=0&&p.waitSeconds<=7200,'WAIT_RANGE');if(p.execute)ensure(/^\d{12}$/.test(p['--confirm-account']),'ACCOUNT_CONFIRMATION_REQUIRED');return p;
}
export async function main(args=process.argv.slice(2)){
  let release;
  try{
    const p=parseArgs(args);if(p.help){console.log(HELP);return;}
    const store=new TemporaryStore(p['--state']),fresh=['idle','watch'].includes(p.mode),loaded=fresh?null:await store.load(),c=validateConfig(fresh?JSON.parse(await readFile(p['--config'],'utf8')):loaded.snapshot.config);
    if(!p.execute){console.log(JSON.stringify({mode:p.mode,temporary:true,offlinePreview:true,awsCalls:0,enabled:c.enabled,stateDirectory:store.directory,targets:{services:c.services,standaloneTasks:c.standaloneTasks.length,natGatewayIds:c.natGatewayIds,endpointIds:c.endpointIds,allocationIds:c.allocationIds},vpcDeletionSupported:false},null,2));return;}
    ensure(c.enabled&&p['--confirm-account']===c.accountId,'TEMPORARY_SWITCH_OR_ACCOUNT');
    ensure(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.env.AWS_ACCESS_KEY_ID&&!process.env.AWS_SECRET_ACCESS_KEY&&!process.env.AWS_SESSION_TOKEN,'UNSAFE_ENVIRONMENT');
    if(fresh)await store.createDirectory();release=await store.lock();
    const adapter=new TemporaryAwsCli(c,store.directory,{executable:p['--aws-cli']??'aws',allowWrites:true}),io={call:adapter.call.bind(adapter),now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))};
    const powerStore=()=>new FileStore(p['--power-state']??path.join(store.directory,'power'));
    const powerIo=(cfg,s)=>{const a=new AwsCli(cfg,s.directory,{executable:p['--aws-cli']??'aws',allowWrites:true});return {call:a.call.bind(a),now:Date.now,sleep:io.sleep};};
    let result;
    if(fresh){if(p.mode==='watch'){console.log(JSON.stringify({status:'TEMPORARY_WATCH_WAITING',expiresAt:c.expiresAt,awsCallsBeforeDeadline:0,requiresComputerAndCredentials:true}));await waitForExpiry(c,io);}
      result=await idle({config:c,io,store,waitSeconds:p.waitSeconds,powerStop:async cfg=>{const s=powerStore();await s.createDirectory();const unlock=await s.lock();try{return await stopResources({config:cfg,io:powerIo(cfg,s),store:s,waitSeconds:p.waitSeconds});}finally{await unlock();}}});
    }else if(p.mode==='restore-network')result=await restoreNetwork({io,store,waitSeconds:p.waitSeconds});
    else if(p.mode==='restore-power'){
      ensure(loaded.journal.status==='NETWORK_RESTORED_COMPUTE_STILL_IDLE','NETWORK_RESTORE_FIRST');const s=powerStore(),unlock=await s.lock();
      try{const proof=await s.load();ensure(proof.snapshot.config.accountId===c.accountId&&proof.snapshot.config.region===c.region,'POWER_SCOPE');
        if(proof.journal.status==='RESOURCES_RECREATED_BINDINGS_REQUIRE_REVIEW')result={status:'POWER_ALREADY_RESTORED_NO_WRITE_REPLAY',mapping:proof.journal.mapping};
        else result=await resumeResources({io:powerIo(proof.snapshot.config,s),store:s,waitSeconds:p.waitSeconds});
      }finally{await unlock();}
    }else result=await resumeCompute({io,store,waitSeconds:p.waitSeconds,powerProof:await powerStore().load(),bindingsReviewed:p.bindingsReviewed});
    console.log(JSON.stringify(result,null,2));if(result.status==='IDLE_WITH_PUBLIC_IP_RESIDUALS'||result.verified===false)process.exitCode=2;
  }catch(e){console.error(JSON.stringify({status:'TEMPORARY_STOPPED_INSPECT_STATE',code:/^[A-Za-z0-9_.-]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'DETAILS_WITHHELD',operation:e.operation??null,retry:false,rollback:false}));process.exitCode=1;}
  finally{if(release)await release();}
}
