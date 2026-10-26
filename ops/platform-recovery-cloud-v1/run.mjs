import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {recoveryCloudClosure} from './closure.mjs';
import {recoveryRuntime} from './live.mjs';
export async function main(args=process.argv.slice(2)){
  const closure=await recoveryCloudClosure();
  if(args.length===1&&args[0]==='--check'){
    const r={state:'CANDIDATE_NOT_PUBLISHED',protocol:'recovery-envelope/v1',closureSha256:closure.closureSha256,
      closureFiles:closure.pinCount,previousPlatformClosureSha256:closure.previousPlatformClosureSha256,
      awsCalls:0,privateReads:0,sqlConnections:0,executionAuthorized:false};console.log(JSON.stringify(r));return r;
  }
  if(args.length)throw Error('RECOVERY_CLOUD_ARGUMENTS');
  const r=await recoveryRuntime(process.env,closure);console.log(JSON.stringify(r));return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('RECOVERY_CLOUD_STOPPED_REQUIRES_INSPECT_NO_RETRY');process.exitCode=1;
});
