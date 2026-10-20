import { env } from 'cloudflare:workers';
import { createPlatformController } from './controller.ts';
import { releaseReady, ControlError } from './contract.ts';
import { INSTALLED_BINDING_V6 } from './installed-binding.ts';
import { localRuntimeLeaseV6, verifiedRuntimeLeaseV6, CONTROL_ORIGIN_V6 } from './configuration.ts';
import { createNeonControlLedger } from './ledger.ts';
import { createGitHubController } from './github.ts';

function binding(name:string):unknown {
  const value=(env as unknown as Record<string,unknown>)[name];
  return value === undefined && typeof process !== 'undefined' ? process.env[name] : value;
}
export function platformControlEnabled() {
  // Publishing the binding alone never provisions private runtime capabilities.
  return INSTALLED_BINDING_V6.state==='PUBLISHED'&&releaseReady(INSTALLED_BINDING_V6.platform)&&
    binding('TECHLONG_PLATFORM_CONTROLLER_ENABLED')==='true'&&binding('TECHLONG_PLATFORM_CONTROL_LOCAL')==='true'&&
    localRuntimeLeaseV6(binding('TECHLONG_PLATFORM_CONTROLLER_LEASE'),INSTALLED_BINDING_V6.platform,Date.now())!==null;
}
async function verifiedLease(){if(!platformControlEnabled())return null;
  return verifiedRuntimeLeaseV6(binding('TECHLONG_PLATFORM_CONTROLLER_LEASE'),INSTALLED_BINDING_V6.platform,Date.now());}
export function platformControlOrigin(){return platformControlEnabled()?CONTROL_ORIGIN_V6:null;}
const controller=createPlatformController({enabled:platformControlEnabled,release:INSTALLED_BINDING_V6.platform,
  sourceCommit:()=>localRuntimeLeaseV6(binding('TECHLONG_PLATFORM_CONTROLLER_LEASE'),INSTALLED_BINDING_V6.platform,Date.now())?.sourceCommit??null,
  verifyRuntime:async()=>{if(!await verifiedLease())throw new ControlError('CONTROL_RUNTIME_LEASE',409);},
  ledger:()=>createNeonControlLedger(()=>binding('TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL')),
  github:()=>createGitHubController({release:INSTALLED_BINDING_V6.platform,fetch,
    privateKey:async()=>{const value=binding('TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY');
      if(typeof value!=='string')throw new ControlError('CONTROL_KEY_BINDING',503);return value;}}),
});
export const getPlatformControlStatus=controller.status;
export const actPlatformControl=controller.act;
