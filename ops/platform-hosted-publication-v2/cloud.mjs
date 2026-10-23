// Protected reusable job only. No Source credential/profile or IAM authority.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execute} from '../platform-image-publication-v2/publish.mjs';
import {must} from '../platform-image-publication-v2/plan.mjs';
import {protocol} from './candidate.mjs';
export async function main(args=process.argv.slice(2),env=process.env){
  must(args.length===1&&typeof env.RUNNER_TEMP==='string'&&
    path.resolve(args[0])===path.join(path.resolve(env.RUNNER_TEMP),'platform-hosted-publication-v2'),'HOSTED_CLOUD_DIRECTORY');
  return execute(args[0],env,{protocol});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main()
  .then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('HOSTED_PUBLICATION_REQUIRES_SOURCE_REVOKE_AND_INSPECT');process.exitCode=1;});
