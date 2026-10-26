// Explicit CLI only. The compiled binding is CANDIDATE, so no live mode is on.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {assertEnvironment,jsonFile,evidenceRoot,cleanSource,keyMetadata,newDirectory,writeOnce,absent} from '../platform-operator-v6/files.mjs';
import {RECOVERY_CONTROL_BINDING as B,RECOVERY_RISK,assertRecoveryPublication,bindRecoveryPublication} from './binding.mjs';
import {makeRecoveryFollowupReview,verifyRecoveryFollowupReview,followRecoveryRunOnce,recoveryFollowupIntentName} from './followup.mjs';
import {recoveryControlPins,recoveryFollowupLivePorts} from './live.mjs';
import {must,same} from '../platform-recovery-v1/basis-core.mjs';
export function parseRecoveryControlArgs(args){
  if(args.length===1&&args[0]==='--check')return {command:'check',flags:{}};
  const [command,...rest]=args,names={'prepare-followup':['--input'],'follow-runonce':['--manifest','--approved-sha','--human-ready','--package']};
  must(Object.hasOwn(names,command)&&rest.length===names[command].length*2,'CONTROL_CLI_ARGUMENTS');
  const flags={};for(let n=0;n<rest.length;n+=2){must(names[command].includes(rest[n])&&!Object.hasOwn(flags,rest[n])&&
    typeof rest[n+1]==='string'&&rest[n+1]&&!rest[n+1].startsWith('--'),'CONTROL_CLI_ARGUMENTS');flags[rest[n]]=rest[n+1];}
  return {command,flags};
}
async function localBasis(file){const pkg=await jsonFile(path.resolve(file),1000000);
  must(await sha256Hex(pkg)===B.packageReference.sha256,'CONTROL_LOCAL_PACKAGE_HASH');return rebuildRecoveryPackage(pkg);}
export async function main(args=process.argv.slice(2),notify=value=>console.log(JSON.stringify(value))){
  const {command,flags:f}=parseRecoveryControlArgs(args);
  if(command==='check'){if(B.state==='PUBLISHED')await assertRecoveryPublication(B);
    const r={state:B.state,protocol:B.protocol,activationInstalled:B.state==='PUBLISHED',riskFile:RECOVERY_RISK,
    privateReads:0,awsCalls:0,sqlConnections:0,dispatches:0,executionAuthorized:false};notify(r);return r;}
  // The source-bound release is checked before any material/key metadata read.
  assertEnvironment();await assertRecoveryPublication(B);
  const currentSource=await cleanSource(),binding=await bindRecoveryPublication(B,currentSource);
  if(command==='prepare-followup'){
    const raw=await jsonFile(path.resolve(f['--input']),200000);must(raw.schema==='techlong/recovery-followup-material/v1','CONTROL_MATERIAL');
    const basis=await localBasis(raw.packageFile),root=await evidenceRoot(raw.input.evidenceRoot),source=await cleanSource(binding.sourceCommit);
    const m=await makeRecoveryFollowupReview({input:raw.input,binding,basis,operatorSourceCommit:source,pins:await recoveryControlPins(),
      key:await keyMetadata(raw.input.keyPath),createdAt:Date.now()});await cleanSource(source);
    const output=await newDirectory(root,'recovery-review-'+m.manifestSha256);await writeOnce(path.join(output,'manifest.json'),m);
    const r={outcome:'RECOVERY_FOLLOWUP_PREPARED_NOT_APPROVED',manifest:path.join(output,'manifest.json'),manifestSha256:m.manifestSha256,
      expiresAt:m.expiresAt,lastStartAt:m.lastStartAt,privateContentReads:0,networkCalls:0,slotsConsumed:0};notify(r);return r;
  }
  must(f['--human-ready']==='yes','CONTROL_HUMAN_READY');const m=await jsonFile(path.resolve(f['--manifest']),500000),basis=await localBasis(f['--package']);
  await verifyRecoveryFollowupReview(m,f['--approved-sha'],basis,binding,Date.now(),true);await cleanSource(m.operatorSourceCommit);
  must(same(await recoveryControlPins(),m.pins),'CONTROL_SOURCE_PINS');const root=await evidenceRoot(m.input.evidenceRoot);
  await absent(path.join(root,recoveryFollowupIntentName(m)));const output=await newDirectory(root,'recovery-run-'+m.manifestSha256);
  await writeOnce(path.join(output,'approved-manifest.json'),m);
  const io=await recoveryFollowupLivePorts(m,basis,output,notify,binding);
  try{const result=await followRecoveryRunOnce({manifest:m,approved:f['--approved-sha'],basis,binding,io});
    notify({...result,output});if(!result.independentCloudAcceptanceVerified)process.exitCode=1;return result;
  }finally{await io.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('RECOVERY_CONTROL_STOPPED_NO_RETRY');process.exitCode=1;
});
