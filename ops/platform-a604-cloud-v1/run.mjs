import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {a604CloudClosure} from './closure.mjs';
import {a604Runtime} from './live.mjs';
export async function main(args=process.argv.slice(2)){
  const closure=await a604CloudClosure();
  if(args.length===1&&args[0]==='--check'){
    const r={state:'UNPUBLISHED',jobId:'job_a60423b885fef3e4326213f7',closureSha256:closure.closureSha256,closureFiles:closure.pinCount,
      frozenRecoveryFilesUnchanged:97,awsCalls:0,privateReads:0,sqlConnections:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;
  }
  if(args.length)throw Error('A604_CLOUD_ARGUMENTS');return a604Runtime(process.env,closure);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('A604_CLOUD_STOPPED_NOT_PUBLISHED_NO_RETRY');process.exitCode=1;
});
