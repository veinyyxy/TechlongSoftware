// Operator-side primitives only. Importing this module activates no capability.
import {commit,CONTROL_SCOPE} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';

export const must=(ok,code)=>{if(!ok)throw Error('PLATFORM_OPERATIONS_'+code);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export function assertScope(scope){
  must(scope&&Object.keys(scope).sort().join(',')==='jobId,sourceCommit'&&commit(scope.sourceCommit)&&
    /^job_[a-f0-9]{24}$/.test(scope.jobId)&&scope.jobId!==CONTROL_SCOPE.completedJob,'SCOPE');
  return structuredClone(scope);
}
