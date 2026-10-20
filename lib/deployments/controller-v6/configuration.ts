// Public local-runtime lease checks only; no filesystem/network/secret discovery.
import { CONTROL_SCOPE as S, commit, keys, obj, releaseReady } from './contract.ts';
import type { ReleaseBinding } from './contract.ts';
import { sha256Hex } from '../execution/hash.ts';
export const CONTROL_ORIGIN_V6 = 'http://127.0.0.1:3100';
export const CONTROL_RISK_PATH_V6 = 'docs/aws-auto-deployment-platform-w6j-runtime-binding-review.md';
export interface RuntimeLeaseV6 {schema:string;releaseSha256:string;origin:string;sourceCommit:string;issuedAt:number;expiresAt:number}
export function localRuntimeLeaseV6(raw:unknown,release:ReleaseBinding,now:number):RuntimeLeaseV6|null {
  if(!releaseReady(release)||typeof raw!=='string'||raw.length>2048||!Number.isSafeInteger(now)||now<=0)return null;
  try{const p=obj(JSON.parse(raw));keys(p,['schema','releaseSha256','origin','sourceCommit','issuedAt','expiresAt']);
    if(p.schema!=='techlong/platform-local-runtime-lease/v6'||p.origin!==CONTROL_ORIGIN_V6||!commit(p.sourceCommit)||
      typeof p.releaseSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.releaseSha256)||!Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
      Number(p.issuedAt)>now||now>=Number(p.expiresAt)||Number(p.expiresAt)-Number(p.issuedAt)<=0||Number(p.expiresAt)-Number(p.issuedAt)>1800000)return null;
    return p as unknown as RuntimeLeaseV6;
  }catch{return null;}
}
export async function verifiedRuntimeLeaseV6(raw:unknown,release:ReleaseBinding,now:number):Promise<RuntimeLeaseV6|null>{
  const p=localRuntimeLeaseV6(raw,release,now);return p&&p.releaseSha256===await sha256Hex(release)?p:null;
}
export async function assertControllerDatabaseUrlV6(binding:unknown){
  if(typeof binding!=='string'||binding.length>4096)throw Error('CONTROL_DATABASE_BINDING');
  let u:URL;try{u=new URL(binding);}catch{throw Error('CONTROL_DATABASE_BINDING');}
  if(!['postgres:','postgresql:'].includes(u.protocol)||!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname)||
    (u.port&&u.port!=='5432')||!/^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname)||decodeURIComponent(u.username)!==S.databaseRole||!u.password||u.hash||
    u.searchParams.size!==1||u.searchParams.get('sslmode')!=='verify-full')throw Error('CONTROL_DATABASE_BINDING');
  const target={host:u.hostname,port:5432,database:u.pathname.slice(1),actor:'neondb_owner',transport:'PostgresTLSVerifyFull'};
  if(await sha256Hex(target)!=='5d5e52c00c54ed761aac13730f81b1b6f107d7ac06a68a407276132d150690a7')throw Error('CONTROL_DATABASE_BINDING');
  return binding;
}
export function assertControllerNeonTransportV6(host:string,config:{fetchFunction:unknown;fetchEndpoint:string|((host:string,port:number)=>string)}){
  const expected=`https://${host.replace(/^[^.]+\./,'api.')}/sql`;
  if(config.fetchFunction!==undefined||(typeof config.fetchEndpoint==='function'?config.fetchEndpoint(host,5432):config.fetchEndpoint)!==expected)
    throw Error('CONTROL_DATABASE_TRANSPORT');
  return expected;
}
