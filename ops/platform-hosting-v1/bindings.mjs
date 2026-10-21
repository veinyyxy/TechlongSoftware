// Build-only alias for cloudflare:workers in the isolated Node candidate.
// The original Workers code and cloud execution closure are not modified.
import {CLOSED_BINDINGS} from './contract.mjs';
if(typeof window!=='undefined')throw Error('PLATFORM_HOSTING_SERVER_BINDINGS_ONLY');
const bindings={...CLOSED_BINDINGS};
for(const name of ['DATABASE_URL','AUTH_SESSION_DAYS'])Object.defineProperty(bindings,name,{enumerable:true,
  get:()=>process.env[name]});
// No D1/R2 emulation, Stripe key, controller credential or App key fallback.
export const env=Object.freeze(bindings);
