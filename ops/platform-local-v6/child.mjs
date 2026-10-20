// Sole foreground child. Secrets arrive via an allowlisted environment, never argv/config.vars.
import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {BINDINGS,L,must} from './plan.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {verifiedRuntimeLeaseV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {REQUEST_WINDOW_BINDING_V6,verifiedRequestWindowV6} from '../../lib/deployments/reviewed-request-window-v6.ts';
export async function assertConfigDirectoryV6(root){
  const files=await readdir(path.join(root,'ops/platform-local-v6'));
  must(!files.some(f=>/^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/i.test(f)),'CONFIG_ENV_FILE');
}
export function viteOptionsV6(root,plugins){return {root,configFile:false,envFile:false,envDir:false,mode:'development',
  plugins,logLevel:'silent',clearScreen:false,
  server:{host:'127.0.0.1',port:3100,strictPort:true,allowedHosts:['127.0.0.1'],cors:false,hmr:false,
    fs:{strict:true,allow:[root],deny:['.env','.env.*','**/.env*','**/*.pem','**/*.key','**/*.crt','**/*.p12','**/*.pfx',
      '**/.git/**','**/.aws/**','**/.aws-sandbox/**','**/.local-secrets/**','**/stripe_sandbox/**','**/account.md']},
    watch:{ignored:['**/.env*','**/*.pem','**/*.key','**/.git/**']}}};}
export async function runChildV6({create,now=Date.now,expiresAt,send,onStop,schedule=setTimeout,cancel=clearTimeout}){
  let server,requested=false,clean=false;
  let resolveStop;const stopped=new Promise(resolve=>{resolveStop=resolve;});
  const requestStop=()=>{requested=true;resolveStop();};
  const detach=onStop(requestStop),timer=schedule(requestStop,Math.max(0,expiresAt-now()));
  try{must(now()<expiresAt,'LEASE_EXPIRED');server=await create();
    must(!requested&&now()<expiresAt,'LEASE_EXPIRED');
    await server.listen();must(!requested&&now()<expiresAt,'LEASE_EXPIRED');
    const address=server.httpServer?.address();must(address?.address==='127.0.0.1'&&address.port===3100,'LISTENER');
    send({type:'ready',pid:process.pid,origin:'http://127.0.0.1:3100'});
    if(server.closed)void server.closed.then(requestStop);
    await stopped;
  }finally{cancel(timer);detach();try{if(server)await server.close();clean=true;}finally{send({type:'stopped',clean});}}
  return {clean};
}
export async function childMainV6(){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  must(process.env.TECHLONG_PLATFORM_LOCAL_LAUNCHER_V6==='true'&&typeof process.send==='function'&&process.connected,'PARENT_REQUIRED');
  must(path.resolve(process.cwd()).toLowerCase()===path.resolve(root).toLowerCase(),'ROOT');
  const lease=await verifiedRuntimeLeaseV6(process.env.TECHLONG_PLATFORM_CONTROLLER_LEASE,B.platform,Date.now());must(lease,'LEASE');
  if(process.env[REQUEST_WINDOW_BINDING_V6]){
    const r=await verifiedRequestWindowV6(process.env[REQUEST_WINDOW_BINDING_V6],Date.now());
    must(r&&r.sourceCommit===lease.sourceCommit&&r.issuedAt===lease.issuedAt&&r.expiresAt===lease.expiresAt&&
      process.env.TECHLONG_PLATFORM_CONTROLLER_ENABLED==='false'&&process.env.TECHLONG_PLATFORM_CONTROL_LOCAL==='false'&&
      process.env.TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL===''&&process.env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY===''&&
      process.env.AWS_INITIALIZED_REQUESTS_ENABLED==='true'&&process.env.DEPLOYMENT_WORKER_ENABLED==='false'&&process.env.AWS_APPLY_ENABLED==='false','REQUEST_ONLY_BINDINGS');
  }
  await assertConfigDirectoryV6(root);
  const [{createServer},{default:vinext},{cloudflare}]=await Promise.all([import('vite'),import('vinext'),import('@cloudflare/vite-plugin')]);
  const plugins=[vinext(),cloudflare({configPath:path.join(root,L.config),persistState:false,inspectorPort:false,remoteBindings:false,
    tunnel:false,viteEnvironment:{name:'rsc',childEnvironments:['ssr']},config:{secrets:{required:[...BINDINGS]}}})];
  const send=v=>{if(process.connected)process.send(v);};
  const result=await runChildV6({expiresAt:lease.expiresAt,send,
    onStop:stop=>{const message=v=>{if(v?.type==='stop')void stop();},end=()=>{void stop();};
      process.on('message',message);process.on('disconnect',end);process.on('SIGINT',end);process.on('SIGTERM',end);
      return()=>{process.off('message',message);process.off('disconnect',end);process.off('SIGINT',end);process.off('SIGTERM',end);};},
    create:async()=>{const s=await createServer(viteOptionsV6(root,plugins));
      s.closed=new Promise(resolve=>s.httpServer.once('close',resolve));return s;}});
  process.exitCode=result.clean?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  childMainV6().then(()=>{if(process.connected)process.disconnect();}).catch(()=>{if(process.connected)process.send({type:'stopped',clean:false});process.exit(1);});
