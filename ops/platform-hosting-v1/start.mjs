import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {serverOptions} from './contract.mjs';
import {ingressPolicy,installIngress} from './ingress.mjs';
import {prepareHostedControl,installHostedControl} from './control-runtime.mjs';

export async function main(args=process.argv.slice(2)){
  const hosted=args.length===1&&args[0]==='--hosted-controller';
  const control=hosted?await prepareHostedControl(process.env):null;
  const options=control?.options??serverOptions(args,process.env);process.env.NODE_ENV='production';
  const policy=control?.policy??ingressPolicy(process.env,options);
  let server;
  try{
  if(control)installHostedControl(control);
  // Derived ONLY from the fixed policy after rejecting caller-supplied vinext overrides.
  if(policy.mode==='alb-https-v1')process.env.VINEXT_TRUSTED_HOSTS=policy.host;
  // No vinext CLI dotenv discovery and no Vite/Workers/Sites config loading.
  const {startProdServer}=await import('vinext/server/prod-server');
  // vinext's public API starts listening immediately. Bootstrap on loopback/ephemeral
  // only, close it, then replace its sole handler BEFORE opening the service port.
  ({server}=await startProdServer({port:0,host:'127.0.0.1',outDir:fileURLToPath(new URL('../../dist-platform',import.meta.url))}));
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  installIngress(server,policy);
  if(control&&!control.live())throw Error('PLATFORM_HOSTING_HOSTED_EXPIRED');
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(options.port,policy.mode==='loopback'?'127.0.0.1':options.host,()=>{
      server.off('error',reject);resolve();
    });
  });
  console.log('PLATFORM_HOSTING_READY '+policy.mode);
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;control?.close();clearTimeout(leaseTimer);
    const timer=setTimeout(()=>process.exit(1),10000);timer.unref();
    server.close(()=>{clearTimeout(timer);process.exit(0);});};
  // Close only control capability: killing a desired ECS task would restart it
  // with the same expired lease and could repeat managed Secret retrieval.
  const leaseTimer=control?setTimeout(()=>{control.close();console.log('PLATFORM_HOSTING_CONTROL_LEASE_CLOSED');},Math.max(0,control.lease.expiresAt-Date.now())):undefined;
  process.once('SIGTERM',stop);process.once('SIGINT',stop);return server;
  }catch(error){control?.close();if(server?.listening)await new Promise(resolve=>server.close(()=>resolve()));throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('PLATFORM_HOSTING_START_REFUSED');process.exitCode=1;
});
