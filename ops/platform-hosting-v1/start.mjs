import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {serverOptions} from './contract.mjs';
import {ingressPolicy,installIngress} from './ingress.mjs';

export async function main(args=process.argv.slice(2)){
  const options=serverOptions(args,process.env);process.env.NODE_ENV='production';
  const policy=ingressPolicy(process.env,options);
  // Derived ONLY from the fixed policy after rejecting caller-supplied vinext overrides.
  if(policy.mode==='alb-https-v1')process.env.VINEXT_TRUSTED_HOSTS=policy.host;
  // No vinext CLI dotenv discovery and no Vite/Workers/Sites config loading.
  const {startProdServer}=await import('vinext/server/prod-server');
  // vinext's public API starts listening immediately. Bootstrap on loopback/ephemeral
  // only, close it, then replace its sole handler BEFORE opening the service port.
  const {server}=await startProdServer({port:0,host:'127.0.0.1',outDir:fileURLToPath(new URL('../../dist-platform',import.meta.url))});
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  installIngress(server,policy);
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(options.port,policy.mode==='loopback'?'127.0.0.1':options.host,()=>{
      server.off('error',reject);resolve();
    });
  });
  console.log('PLATFORM_HOSTING_READY '+policy.mode);
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),10000);timer.unref();
    server.close(()=>{clearTimeout(timer);process.exit(0);});};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('PLATFORM_HOSTING_START_REFUSED');process.exitCode=1;
});
