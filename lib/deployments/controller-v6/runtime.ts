import { env } from 'cloudflare:workers';
import { createPlatformController } from './controller.ts';
import { PLATFORM_RELEASE, releaseReady, ControlError } from './contract.ts';
import { createNeonControlLedger } from './ledger.ts';
import { createGitHubController } from './github.ts';

function binding(name:string):unknown {
  const value=(env as unknown as Record<string,unknown>)[name];
  return value === undefined && typeof process !== 'undefined' ? process.env[name] : value;
}
export function platformControlEnabled() {
  // Release first: current code cannot even inspect the key binding. Launcher
  // allowlist is intentionally unchanged; no filesystem PEM loader exists here.
  return releaseReady(PLATFORM_RELEASE) && binding('TECHLONG_PLATFORM_CONTROLLER_ENABLED') === 'true';
}
const controller=createPlatformController({enabled:platformControlEnabled,release:PLATFORM_RELEASE,
  ledger:()=>createNeonControlLedger(()=>binding('TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL')),
  github:()=>createGitHubController({release:PLATFORM_RELEASE,fetch,
    privateKey:async()=>{const value=binding('TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY');
      if(typeof value!=='string')throw new ControlError('CONTROL_KEY_BINDING',503);return value;}}),
});
export const getPlatformControlStatus=controller.status;
export const actPlatformControl=controller.act;
