// Exact legacy compatibility only. This module cannot grant, revoke or LOGIN.
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {inspectControlPrivilegesV6} from '../platform-publisher-v6/privileges.mjs';
const must=(v,c)=>{if(!v)throw Error('ACTIVATION_COMPAT_'+c);};
export async function assessLegacyCompatibilityV6(c,p,{expectedLogin=false}={}){
  must(p?.schema==='techlong/platform-legacy-invoker-trigger-compatibility-proposal/v6'&&p.functionCount===27&&
    p.functions?.length===27&&new Set(p.functions.map(f=>f.oid)).size===27&&new Set(p.functions.map(f=>f.name)).size===27&&
    /^[0-9]+$/.test(p.serviceRoleOid)&&/^[0-9]+$/.test(p.expectedFunctionOwnerOid)&&
    p.functions.every(f=>f.schema==='public'&&f.owner===p.expectedFunctionOwnerOid&&f.types===''&&
      (f.config===null||canonicalJson(f.config)===canonicalJson(['search_path=pg_catalog']))&&
      f.definer===false&&f.language==='plpgsql'&&f.returnType==='trigger'&&/^[a-f0-9]{64}$/.test(f.bodySha256))&&
    await sha256Hex(p.functions)===p.functionSnapshotSha256,'PROPOSAL');
  const strict=inspectControlPrivilegesV6(c,p.serviceRoleOid,{expectedLogin});
  const exact=canonicalJson(c.unexpected_executable_functions)===canonicalJson(p.functions);
  const blockers=strict.blockers.filter(k=>k!=='unexpected_executable_functions'||!exact);
  return {state:blockers.length?'EXACT_COMPATIBILITY_REJECTED':'EXACT_COMPATIBILITY_ELIGIBLE_FOR_SEPARATE_APPROVAL',
    eligibleForReviewedCredentialInstall:blockers.length===0,blockers,exactLegacyFunctionSnapshotMatched:exact,
    legacyFunctionCount:exact?27:0,functionSnapshotSha256:p.functionSnapshotSha256,roleOid:c.role?.oid??null,
    roleLogin:c.role?.login??null,temporaryObjectsAllowed:c.temporary_objects_allowed===true,
    compatibilityAccepted:false,loginAuthorized:false,automaticAllowlisting:false,automaticRevokes:0};
}
