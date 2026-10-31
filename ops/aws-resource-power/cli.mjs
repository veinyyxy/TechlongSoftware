import {readFile,writeFile,mkdir,open,rename,unlink,lstat,chmod} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {validateConfig,stopResources,resumeResources,digest,ensure,SCHEMA} from './core.mjs';

const executeFile=promisify(execFile);
const READS={sts:['get-caller-identity'],rds:['describe-db-clusters','describe-db-instances'],elbv2:[
  'describe-load-balancers','describe-load-balancer-attributes','describe-listeners','describe-listener-attributes',
  'describe-listener-certificates','describe-rules','describe-tags','describe-target-groups']};
const WRITES={rds:['stop-db-cluster','start-db-cluster','stop-db-instance','start-db-instance'],elbv2:[
  'delete-load-balancer','create-load-balancer','modify-load-balancer-attributes','create-listener','modify-listener-attributes','add-listener-certificates','create-rule']};
export const permittedOperations={reads:READS,writes:WRITES}; // No RDS delete, IAM, CFN, DNS or ECS write API exists here.
export class AwsCli{
  constructor(config,directory,{executable='aws',allowWrites=false,exec=executeFile}={}){this.config=config;this.directory=directory;this.executable=executable;this.allowWrites=allowWrites;this.exec=exec;}
  async call(service,operation,input){
    const read=READS[service]?.includes(operation),write=WRITES[service]?.includes(operation);
    ensure(read||write,'AWS_OPERATION_NOT_ALLOWED');ensure(!write||this.allowWrites,'AWS_WRITES_NOT_ENABLED');
    const inputPath=path.join(this.directory,`request-${randomUUID()}.json`);
    await writeFile(inputPath,JSON.stringify(input),{flag:'wx',mode:0o600});
    const host=service==='elbv2'?'elasticloadbalancing':service;
    const args=[service,operation,'--cli-input-json',`file://${inputPath.replaceAll('\\','/')}`,'--profile',this.config.profile,
      '--region',this.config.region,'--endpoint-url',`https://${host}.${this.config.region}.amazonaws.com`,
      '--output','json','--no-paginate','--no-cli-pager','--no-cli-auto-prompt','--cli-connect-timeout','10','--cli-read-timeout','60'];
    try{
      const r=await this.exec(this.executable,args,{windowsHide:true,timeout:90000,maxBuffer:8*1024*1024,
        env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off',AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:'true'}});
      return r.stdout.trim()?JSON.parse(r.stdout.replace(/^\uFEFF/,'')):{};
    }catch(e){
      // Do not emit raw stderr/stdout: only a service code and operation name.
      const code=String(e.stderr??'').match(/An error occurred \(([A-Za-z0-9_.-]+)\)/)?.[1]??'AWS_CLI_OR_NETWORK_ERROR';
      throw Object.assign(Error('AWS_COMMAND_FAILED'),{code,service,operation});
    }finally{await unlink(inputPath);}
  }
}
async function noLinks(file){
  let at=path.resolve(file);for(;;){const s=await lstat(at);ensure(!s.isSymbolicLink(),'STATE_SYMLINK_NOT_ALLOWED');const parent=path.dirname(at);if(parent===at)break;at=parent;}
}
async function privateDirectory(directory){
  await noLinks(path.dirname(directory));await mkdir(directory,{mode:0o700});
  if(process.platform==='win32'){
    const literal=directory.replaceAll("'","''"),script=`$p='${literal}';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($s in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($s),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};Set-Acl -LiteralPath $p -AclObject $acl;`;
    await executeFile('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:20000});
  }else await chmod(directory,0o700);
}
export class FileStore{
  constructor(directory){this.directory=path.resolve(directory);ensure(this.directory!==path.parse(this.directory).root,'STATE_MUST_NOT_BE_ROOT');}
  async createDirectory(){await privateDirectory(this.directory);}
  async read(name){await noLinks(this.directory);const f=path.join(this.directory,name);await noLinks(f);const s=await lstat(f);ensure(s.isFile()&&s.size<10*1024*1024,'STATE_FILE_INVALID');return JSON.parse(await readFile(f,'utf8'));}
  async createSnapshot(snapshot,journal){
    await writeFile(path.join(this.directory,'snapshot.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
    await writeFile(path.join(this.directory,'journal.json'),JSON.stringify(journal,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
  }
  async saveJournal(journal){
    const temp=path.join(this.directory,`journal-${randomUUID()}.tmp`);
    await writeFile(temp,JSON.stringify(journal,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});await rename(temp,path.join(this.directory,'journal.json'));
  }
  async load(){const snapshot=await this.read('snapshot.json'),journal=await this.read('journal.json');ensure(snapshot.schema===SCHEMA&&journal.snapshotSha256===digest(snapshot),'BACKUP_INTEGRITY');return {snapshot,journal};}
  async lock(){await noLinks(this.directory);const file=path.join(this.directory,'.running.lock'),handle=await open(file,'wx',0o600);
    await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await handle.sync();
    return async()=>{await handle.close();await unlink(file);};
  }
}
const HELP=mode=>`AWS resource ${mode} (no AWS access unless --execute is supplied)

${mode==='stop'?'node scripts/aws-cost-stop.mjs --config <JSON>':'node scripts/aws-cost-resume.mjs'} --state <backup-directory>
  [--execute --confirm-account <12-digit-account>] [--wait-seconds 1800] [--aws-cli <executable>]

stop: immutable ALB backup -> stop listed RDS (never delete) -> delete listed Application LBs.
resume: start only RDS originally running -> recreate backed-up ALBs/listeners/rules -> write ARN/DNS mapping.
Without --execute this is an OFFLINE preview, not an AWS dry-run or current inventory.
--state must be a NEW directory for stop; preserve it and use the SAME directory for resume.
No automatic write retries, rollback, DNS/CloudFormation rewrites or database deletion.
RDS may auto-start after 7 days. Storage/backup/other-resource charges can continue.
`;
export function parseArgs(mode,args){
  ensure(['stop','resume'].includes(mode),'INVALID_MODE');if(args.length===1&&['--help','-h'].includes(args[0]))return {help:true};
  const result={execute:false},valued=['--config','--state','--confirm-account','--wait-seconds','--aws-cli'];
  for(let i=0;i<args.length;i++){
    const key=args[i];if(key==='--execute'){ensure(!result.execute,'DUPLICATE_ARGUMENT');result.execute=true;continue;}
    ensure(valued.includes(key)&&result[key]===undefined&&args[i+1]&&!args[i+1].startsWith('--'),'INVALID_ARGUMENT');result[key]=args[++i];
  }
  ensure(result['--state']&&(mode==='stop'?result['--config']:!result['--config']),'CONFIG_OR_STATE_REQUIRED');
  result.waitSeconds=result['--wait-seconds']===undefined?1800:Number(result['--wait-seconds']);
  ensure(Number.isInteger(result.waitSeconds)&&result.waitSeconds>=0&&result.waitSeconds<=7200,'WAIT_RANGE');
  if(result.execute)ensure(/^\d{12}$/.test(result['--confirm-account']),'EXPLICIT_ACCOUNT_CONFIRMATION_REQUIRED');return result;
}
export async function main(mode,args=process.argv.slice(2)){
  let release;
  try{
    const parsed=parseArgs(mode,args);if(parsed.help){console.log(HELP(mode));return;}
    const store=new FileStore(parsed['--state']);
    const config=mode==='stop'?validateConfig(JSON.parse(await readFile(parsed['--config'],'utf8'))):validateConfig((await store.load()).snapshot.config);
    if(!parsed.execute){console.log(JSON.stringify({mode,offlinePreview:true,awsCalls:0,config,stateDirectory:store.directory},null,2));return;}
    ensure(parsed['--confirm-account']===config.accountId,'ACCOUNT_CONFIRMATION_MISMATCH');
    ensure(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.env.AWS_ACCESS_KEY_ID&&!process.env.AWS_SECRET_ACCESS_KEY&&!process.env.AWS_SESSION_TOKEN,'UNSAFE_CREDENTIAL_OR_TLS_ENVIRONMENT');
    if(mode==='resume'&&config.loadBalancerArns.length)ensure(parsed.waitSeconds>0,'RESTORE_REQUIRES_WAIT');
    if(mode==='stop')await store.createDirectory();release=await store.lock();
    const cli=new AwsCli(config,store.directory,{executable:parsed['--aws-cli']??'aws',allowWrites:true}),
      io={call:cli.call.bind(cli),now:Date.now,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
    const result=await (mode==='stop'?stopResources:resumeResources)({config,io,store,waitSeconds:parsed.waitSeconds});
    console.log(JSON.stringify(result,null,2));if(!result.verified)process.exitCode=2;
  }catch(e){
    console.error(JSON.stringify({status:'STOPPED_INSPECT_BACKUP_BEFORE_ANY_RETRY',code:/^[A-Za-z0-9_.-]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'DETAILS_WITHHELD',
      operation:e.operation??null,automaticRetry:false,automaticRollback:false}));process.exitCode=1;
  }finally{if(release)await release();}
}
