import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {serverOptions} from './contract.mjs';

export async function main(args=process.argv.slice(2)){
  const options=serverOptions(args,process.env);process.env.NODE_ENV='production';
  // No vinext CLI dotenv discovery and no Vite/Workers/Sites config loading.
  const {startProdServer}=await import('vinext/server/prod-server');
  const {server}=await startProdServer({...options,outDir:fileURLToPath(new URL('../../dist-platform',import.meta.url))});
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),10000);timer.unref();
    server.close(()=>{clearTimeout(timer);process.exit(0);});};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('PLATFORM_HOSTING_START_REFUSED');process.exitCode=1;
});
