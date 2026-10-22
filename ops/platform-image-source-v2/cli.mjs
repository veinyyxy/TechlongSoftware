import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {prepare,runReviewed,inspectReviewed,errorCode} from './runner.mjs';
import {must} from './review.mjs';
export async function main(args=process.argv.slice(2)){
  const [mode,file,sha,...extra]=args;
  must(!extra.length&&((mode==='Prepare'&&file&&!sha)||(['RunReviewed','Inspect'].includes(mode)&&file&&sha)),'SOURCE_ARGUMENTS');
  return mode==='Prepare'?prepare(file):mode==='Inspect'?inspectReviewed(file,sha):runReviewed(file,sha);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main()
  .then(r=>{console.log(JSON.stringify(r,null,2));if(r.outcome==='REQUIRES_INDEPENDENT_INSPECT')process.exitCode=2;})
  .catch(e=>{console.error(JSON.stringify({outcome:'SOURCE_COMMAND_STOPPED',errorCode:errorCode(e),automaticRetry:false}));process.exitCode=1;});
