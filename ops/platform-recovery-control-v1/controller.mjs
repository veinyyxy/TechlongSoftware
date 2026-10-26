// Lazy production composition, not installed into the current HTTP runtime.
import {createPlatformController} from '../../lib/deployments/controller-v6/controller.ts';
import {controllerRuntimeV6,verifiedControllerRuntimeV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {createNeonControlLedger} from '../../lib/deployments/controller-v6/ledger.ts';
import {createGitHubController} from '../../lib/deployments/controller-v6/github.ts';
import {RECOVERY_CONTROL_BINDING,RECOVERY_RISK,recoveryBindingReady,recoveryPublicationReady,assertRecoveryBinding,assertRecoveryPlanScope,requireRecoveryControl as must} from './binding.mjs';
export function createBoundRecoveryController({read,fetch,now=Date.now,binding=RECOVERY_CONTROL_BINDING,
  ledgerFactory=createNeonControlLedger,githubFactory=createGitHubController}){
  const effective=()=>{if(recoveryBindingReady(binding))return binding;
    if(recoveryPublicationReady(binding)){const r=controllerRuntimeV6(read,binding.release,now());
      if(r)return {...binding,sourceCommit:r.lease.sourceCommit,activation:{...binding.activation,sourceCommit:r.lease.sourceCommit}};}return null;};
  const runtime=()=>effective()?controllerRuntimeV6(read,binding.release,now()):null;
  const verify=async()=>{const e=effective();await assertRecoveryBinding(e);const r=await verifiedControllerRuntimeV6(read,binding.release,now());
    must(r&&r.lease.sourceCommit===e.sourceCommit,'CONTROL_RUNTIME_BINDING');};
  const controller=createPlatformController({enabled:()=>runtime()!==null,release:binding.release??{state:'UNPUBLISHED'},
    now,sourceCommit:()=>runtime()?.lease.sourceCommit??null,verifyRuntime:verify,
    ledger:()=>{const l=ledgerFactory(()=>read('TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL'));
      return {...l,async load(sha){const e=await l.load(sha);assertRecoveryPlanScope(e.plan,effective());return e;},
        async status(){return (await l.status()).filter(p=>p.jobId==='job_9b57b43a6b88f37202b29170'&&
          p.sourceCommit===effective()?.sourceCommit&&p.riskSha256===binding.release.riskSha256);}};},
    github:()=>githubFactory({release:binding.release,fetch,now,privateKey:async()=>{
      await verify();const key=read('TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY');must(typeof key==='string','CONTROL_KEY_BINDING');return key;}})});
  return Object.freeze({...controller,enabled:()=>runtime()!==null,origin:()=>runtime()?.origin??null,riskFile:RECOVERY_RISK,
    activationInstalled:recoveryBindingReady(binding)||recoveryPublicationReady(binding)});
}
