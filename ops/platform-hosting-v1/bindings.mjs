// Build-only alias for cloudflare:workers in the isolated Node candidate.
// The original Workers code and cloud execution closure are not modified.
import {CLOSED_BINDINGS} from './contract.mjs';
import {PUBLIC_CONTROL_BINDINGS,PRIVATE_CONTROL_BINDINGS,hostedControlBinding} from './control-runtime.mjs';
if(typeof window!=='undefined')throw Error('PLATFORM_HOSTING_SERVER_BINDINGS_ONLY');
const bindings={...CLOSED_BINDINGS};
for(const name of ['DATABASE_URL','AUTH_SESSION_DAYS'])Object.defineProperty(bindings,name,{enumerable:true,
  get:()=>process.env[name]});
for(const name of [...PUBLIC_CONTROL_BINDINGS,...PRIVATE_CONTROL_BINDINGS])Object.defineProperty(bindings,name,{enumerable:true,
  get:()=>hostedControlBinding(name)});
// No D1/R2/Stripe emulation. Private controller values have no env fallback here:
// only the explicitly installed, live hosted capability can supply them.
export const env=Object.freeze(bindings);
