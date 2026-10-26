// Server-only capability, installed explicitly before the application is loaded.
// The bundled alias and the Node entry share this one process-local symbol.
import {CLOSED_BINDINGS,FORBIDDEN,must,serverOptions} from './contract.mjs';
import {ingressPolicy} from './ingress.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {verifiedControllerRuntimeV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {RECOVERY_CONTROL_BINDING,assertRecoveryPublication} from '../platform-recovery-control-v1/binding.mjs';

const SLOT=Symbol.for('techlong.platform.hosted-controller.v6');
const prepared=new WeakSet();
export const PRIVATE_CONTROL_BINDINGS=Object.freeze([
  'TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL','TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY',
]);
export const PUBLIC_CONTROL_BINDINGS=Object.freeze([
  'TECHLONG_PLATFORM_CONTROLLER_ENABLED','TECHLONG_PLATFORM_CONTROL_LOCAL','TECHLONG_PLATFORM_CONTROL_HOSTED',
  'TECHLONG_PLATFORM_CONTROLLER_LEASE',
]);

// Match the application's source-only selector. No environment/input override.
export async function hostedControlRelease(){
  if(RECOVERY_CONTROL_BINDING.state==='PUBLISHED'){
    await assertRecoveryPublication(RECOVERY_CONTROL_BINDING);
    return RECOVERY_CONTROL_BINDING.release;
  }
  must(B.state==='PUBLISHED','HOSTED_RELEASE');return B.platform;
}

export async function prepareHostedControl(env,{now=Date.now}={}){
  // Reject forbidden names without inspecting their possibly private values.
  const forbidden=[...FORBIDDEN,'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI','AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN','AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE'];
  must(!Object.keys(env).some(k=>forbidden.includes(k)&&!PRIVATE_CONTROL_BINDINGS.includes(k)),'HOSTED_FORBIDDEN_ENVIRONMENT');
  const mask=new Set([...PRIVATE_CONTROL_BINDINGS,...PUBLIC_CONTROL_BINDINGS]);
  const shadow=new Proxy(env,{get:(target,key)=>mask.has(key)?CLOSED_BINDINGS[key]:Reflect.get(target,key)});
  const options=serverOptions([],shadow),policy=ingressPolicy(env,options);
  must(policy.mode==='alb-https-v1','HOSTED_INGRESS');
  const release=await hostedControlRelease();
  const values=Object.freeze(Object.fromEntries(PUBLIC_CONTROL_BINDINGS.map(k=>[k,env[k]??CLOSED_BINDINGS[k]])));
  const ctx=await verifiedControllerRuntimeV6(k=>values[k],release,now());
  must(ctx?.mode==='hosted'&&env.TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT===ctx.lease.sourceCommit,'HOSTED_RUNTIME_BINDING');
  const lease=Object.freeze({...ctx.lease}),cache=new Map();let closed=false,last=lease.issuedAt;
  const close=()=>{closed=true;cache.clear();};
  const live=()=>{const t=now();if(!Number.isSafeInteger(t)||t<last||t>=lease.expiresAt)close();last=t;return !closed;};
  must(live(),'HOSTED_EXPIRED');
  const read=name=>{
    if(PRIVATE_CONTROL_BINDINGS.includes(name)){
      // null prevents the controller's generic process.env fallback after closure.
      if(!live())return null;
      if(!cache.has(name)){
        const value=env[name],limit=name.endsWith('PRIVATE_KEY')?16384:4096;
        cache.set(name,typeof value==='string'&&value.length>0&&value.length<=limit?value:null);
      }
      return cache.get(name);
    }
    return PUBLIC_CONTROL_BINDINGS.includes(name)?live()?values[name]:CLOSED_BINDINGS[name]:undefined;
  };
  const capability=Object.freeze({options:Object.freeze(options),policy,lease,live,read,close});
  prepared.add(capability);return capability;
}

export function installHostedControl(capability){
  must(typeof window==='undefined'&&prepared.has(capability)&&!Object.hasOwn(globalThis,SLOT)&&capability.live(),'HOSTED_INSTALL_ONCE');
  Object.defineProperty(globalThis,SLOT,{value:capability,writable:false,configurable:false,enumerable:false});
}
export function hostedControlBinding(name){
  const capability=globalThis[SLOT];
  return capability?capability.read(name):CLOSED_BINDINGS[name];
}
