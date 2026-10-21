import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir} from 'node:fs/promises';
import {must} from './contract.mjs';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const OUTPUT=path.join(ROOT,'dist-platform');
export async function makeBuildConfig(){
  const envDir=path.join(ROOT,'ops/platform-hosting-v1/empty-env');
  must(!(await readdir(envDir)).some(n=>n.startsWith('.env')),'EMPTY_ENV_DIRECTORY');
  const {default:vinext}=await import('vinext');
  return {root:ROOT,configFile:false,envDir,mode:'production',
    // In installed vinext0.0.50 the App Router ignores clientOutDir; Vite's
    // explicit client environment is authoritative for the browser bundle.
    environments:{client:{build:{outDir:path.join(OUTPUT,'client')}}},
    plugins:[{name:'platform-node-server-bindings',enforce:'pre',
      resolveId(id){if(id==='cloudflare:workers'){
        must(this.environment?.name!=='client','CLIENT_BINDING_IMPORT');return path.join(ROOT,'ops/platform-hosting-v1/bindings.mjs');
      }}},...vinext({rscOutDir:path.join(OUTPUT,'server'),ssrOutDir:path.join(OUTPUT,'server/ssr'),clientOutDir:path.join(OUTPUT,'client'),
        nextConfig:{images:{unoptimized:true}}})],
    resolve:{dedupe:['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime']},
  };
}
