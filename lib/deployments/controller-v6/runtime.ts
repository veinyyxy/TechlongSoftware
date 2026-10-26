import { env } from 'cloudflare:workers';
import { createPlatformController } from './controller.ts';
import { releaseReady, ControlError } from './contract.ts';
import { INSTALLED_BINDING_V6 } from './installed-binding.ts';
import { controllerRuntimeV6, verifiedControllerRuntimeV6, CONTROL_RISK_PATH_V6 } from './configuration.ts';
import { createNeonControlLedger } from './ledger.ts';
import { createGitHubController } from './github.ts';
import { createBoundRecoveryController } from '../../../ops/platform-recovery-control-v1/controller.mjs';
import { RECOVERY_CONTROL_BINDING, RECOVERY_RISK } from '../../../ops/platform-recovery-control-v1/binding.mjs';

function binding(name:string):unknown {
  const value=(env as unknown as Record<string,unknown>)[name];
  return value === undefined && typeof process !== 'undefined' ? process.env[name] : value;
}
function runtimeContext(){
  // Publishing the binding alone never provisions private runtime capabilities.
  return INSTALLED_BINDING_V6.state==='PUBLISHED'&&releaseReady(INSTALLED_BINDING_V6.platform)?
    controllerRuntimeV6(binding,INSTALLED_BINDING_V6.platform,Date.now()):null;
}
// The source-bound candidate cannot be activated by any environment flag.
const recoverySelected=(RECOVERY_CONTROL_BINDING.state as string)==='PUBLISHED';
const recovery=createBoundRecoveryController({read:binding,fetch});
export function platformControlEnabled() { return recoverySelected?recovery.enabled():runtimeContext()!==null; }
async function verifiedLease(){if(!platformControlEnabled())return null;
  return verifiedControllerRuntimeV6(binding,INSTALLED_BINDING_V6.platform,Date.now());}
export function platformControlOrigin(){return recoverySelected?recovery.origin():runtimeContext()?.origin??null;}
export function getPlatformControlRiskFile(){return recoverySelected?RECOVERY_RISK:CONTROL_RISK_PATH_V6;}
const controller=createPlatformController({enabled:platformControlEnabled,release:INSTALLED_BINDING_V6.platform,
  sourceCommit:()=>runtimeContext()?.lease.sourceCommit??null,
  verifyRuntime:async()=>{if(!await verifiedLease())throw new ControlError('CONTROL_RUNTIME_LEASE',409);},
  ledger:()=>createNeonControlLedger(()=>binding('TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL')),
  github:()=>createGitHubController({release:INSTALLED_BINDING_V6.platform,fetch,
    privateKey:async()=>{const value=binding('TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY');
      if(typeof value!=='string')throw new ControlError('CONTROL_KEY_BINDING',503);return value;}}),
});
export const getPlatformControlStatus=recoverySelected?recovery.status:controller.status;
export const actPlatformControl=recoverySelected?recovery.act:controller.act;
