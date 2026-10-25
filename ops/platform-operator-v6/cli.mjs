import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {makeReview,validateInput,verifyReview,must,same,intentName} from './review.mjs';
import {assertEnvironment,jsonFile,evidenceRoot,cleanSource,sourcePins,keyMetadata,newDirectory,writeOnce,absent} from './files.mjs';
import {inspectOnce} from './inspect.mjs';
import {verifyBundle} from './bundle.mjs';
import {livePorts} from './live.mjs';
import {validateFollowupInput,makeFollowupReview,verifyFollowupReview,followRunOnceOnce} from './followup.mjs';

export function parseArgs(args){
  const [command,...rest]=args,names={prepare:['--input'],'inspect-once':['--manifest','--approved-sha','--human-ready'],
    'prepare-followup':['--input'],'follow-runonce':['--manifest','--approved-sha','--human-ready'],
    'verify-bundle':['--bundle','--output']};must(Object.hasOwn(names,command)&&rest.length===names[command].length*2,'ARGUMENTS');
  const flags={};for(let n=0;n<rest.length;n+=2){must(names[command].includes(rest[n])&&!Object.hasOwn(flags,rest[n])&&rest[n+1]&&!rest[n+1].startsWith('--'),'ARGUMENTS');flags[rest[n]]=rest[n+1];}
  must(names[command].every(n=>flags[n]),'ARGUMENTS');return {command,flags};
}
export async function main(args=process.argv.slice(2),notify=value=>console.log(JSON.stringify(value))){
  const {command,flags:f}=parseArgs(args);assertEnvironment();
  if(command==='verify-bundle'){
    const result=await verifyBundle(await jsonFile(path.resolve(f['--bundle'])));await writeOnce(path.resolve(f['--output']),result);notify(result);return result;
  }
  const following=command==='prepare-followup'||command==='follow-runonce',verify=following?verifyFollowupReview:verifyReview;
  if(command==='prepare'||command==='prepare-followup'){
    const input=await (following?validateFollowupInput:validateInput)(await jsonFile(path.resolve(f['--input']),200000)),root=await evidenceRoot(input.evidenceRoot),source=await cleanSource();
    const m=await (following?makeFollowupReview:makeReview)({input,operatorSourceCommit:source,pins:await sourcePins(),key:await keyMetadata(input.keyPath),createdAt:Date.now()});
    await cleanSource(source);const dir=await newDirectory(root,'review-'+m.manifestSha256);await writeOnce(path.join(dir,'manifest.json'),m);
    const result={outcome:following?'FOLLOWUP_PREPARED_NOT_APPROVED':'INSPECT_PREPARED_NOT_APPROVED',manifest:path.join(dir,'manifest.json'),manifestSha256:m.manifestSha256,
      expiresAtUtc:new Date(m.expiresAt).toISOString(),lastStartAtUtc:new Date(m.lastStartAt).toISOString(),
      expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
      sourceMatchesOriginalRun:source===input.plan.sourceCommit,privateContentReads:0,networkCalls:0,slotConsumed:false};notify(result);return result;
  }
  const m=await jsonFile(path.resolve(f['--manifest']),500000);must(f['--human-ready']==='yes','HUMAN_READY');
  await verify(m,f['--approved-sha'],Date.now(),true);await cleanSource(m.operatorSourceCommit);
  must(same(await sourcePins(),m.pins),'SOURCE_PINS');const root=await evidenceRoot(m.input.evidenceRoot);
  await absent(path.join(root,intentName(m)));
  const output=await newDirectory(root,'run-'+m.manifestSha256);await writeOnce(path.join(output,'approved-manifest.json'),m);
  const io=await livePorts(m,output,notify,{verify});
  try{
    const result=await (following?followRunOnceOnce:inspectOnce)({manifest:m,approved:f['--approved-sha'],io});
    notify({...result,output});if(!result.independentCloudAcceptanceVerified)process.exitCode=1;return result;
  }finally{await io.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error(JSON.stringify({outcome:'OPERATOR_STOPPED_NO_RETRY',detailsWithheld:true,independentCloudAcceptanceVerified:false}));process.exitCode=1;
});
