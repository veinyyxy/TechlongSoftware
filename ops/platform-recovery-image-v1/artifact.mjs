// Fixed original W9n artifact; shares original archive/load/scan checks.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepare,inspect,scan} from '../platform-image-publication-v2/artifact.mjs';
import {must} from '../platform-image-publication-v2/plan.mjs';
import {C,protocol} from './candidate.mjs';
export async function main(args=process.argv.slice(2),env=process.env){
  const [mode,dir,cache,...extra]=args;
  must(!extra.length&&dir&&['prepare','prepare-publication','inspect','scan'].includes(mode)&&
    (mode==='scan'?!!cache:cache===undefined),'RECOVERY_ARTIFACT_ARGUMENTS');
  if(mode.startsWith('prepare'))return prepare(dir,env,{protocol,publication:mode==='prepare-publication'});
  return mode==='inspect'?inspect(dir,{candidate:C}):scan(dir,cache,{candidate:C});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main()
  .then(v=>console.log(JSON.stringify(v))).catch(()=>{console.error('RECOVERY_IMAGE_ARTIFACT_REFUSED');process.exitCode=1;});
