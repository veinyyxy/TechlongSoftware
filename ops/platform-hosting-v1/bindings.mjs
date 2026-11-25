// Build-only alias for cloudflare:workers in the isolated Node candidate.
// The original Workers code and cloud execution closure are not modified.
import {CLOSED_BINDINGS} from './contract.mjs';
import {createSaasControlDatabaseBinding} from './control-database.mjs';
import {createFirstOpenWebInvokeBinding} from './first-open-web-invoke.ts';
import {PUBLIC_CONTROL_BINDINGS,PRIVATE_CONTROL_BINDINGS,hostedControlBinding} from './control-runtime.mjs';
import {SANDBOX_PURCHASE_BINDINGS} from '../../lib/purchases/sandbox-first-purchase-config.ts';
if(typeof window!=='undefined')throw Error('PLATFORM_HOSTING_SERVER_BINDINGS_ONLY');
const bindings={...CLOSED_BINDINGS};
Object.defineProperty(bindings,'TECHLONG_SAAS_CONTROL_NATIVE_DB',{get:createSaasControlDatabaseBinding(process.env)});
Object.defineProperty(bindings,'TECHLONG_FIRST_OPEN_WEB_NOTIFY',{get:createFirstOpenWebInvokeBinding(process.env)});
for(const name of ['DATABASE_URL','AUTH_SESSION_DAYS','TECHLONG_PLATFORM_INGRESS','TECHLONG_PLATFORM_PUBLIC_ORIGIN',...SANDBOX_PURCHASE_BINDINGS])Object.defineProperty(bindings,name,{enumerable:true,
  get:()=>process.env[name]});
for(const name of [...PUBLIC_CONTROL_BINDINGS,...PRIVATE_CONTROL_BINDINGS])Object.defineProperty(bindings,name,{enumerable:true,
  get:()=>hostedControlBinding(name)});
// No D1/R2 or general Stripe bindings. Private controller values have no env fallback here:
// only the explicitly installed, live hosted capability can supply them.
export const env=Object.freeze(bindings);
