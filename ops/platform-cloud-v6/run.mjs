import {platformClosureV6} from './closure.mjs';
import {platformRuntimeV6} from './runtime.mjs';
import {CLOUD_RELEASE_V6} from './contract.mjs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export async function main(args=process.argv.slice(2)) {
  const closure=await platformClosureV6();
  if(args.length===1 && args[0]==='--check') {
    const result={state:'CANDIDATE_NOT_PUBLISHED',release:CLOUD_RELEASE_V6.state,closureSha256:closure.closureSha256,
      closureFiles:closure.pinCount,legacyClosureSha256:closure.legacyClosureSha256,modes:['Review','RunOnce','Inspect'],awsCalls:0,privateReads:0,sqlConnections:0};
    console.log(JSON.stringify(result));return result;
  }
  if(args.length)throw Error('CONTROL_V6_ARGUMENTS');
  const result=await platformRuntimeV6(process.env,closure);console.log(JSON.stringify(result));return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(()=>{console.error('CONTROL_V6_STOPPED_REQUIRES_INSPECT_NO_RETRY');process.exitCode=1;});
