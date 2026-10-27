// Source-selected adapters; construction has no credential/private/network I/O.
import {createIo} from '../platform-delegated-approval-v1/io.mjs';
import {createLiveIo,readLaunchSnapshot} from '../platform-recovery-launch-v1/io.mjs';
import {readCandidateSnapshot} from '../platform-a604-handoff-v1/local.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {D} from './scope.mjs';
import {auditKey,must} from './policy.mjs';
export const readA604State=(client,options)=>readCandidateSnapshot(client,options,[]);
export function createA604DispatchIo(options){
  const {grant:g,mode}=options;
  return createIo({...options,capability:{definition:D,auditKey,verifyPreflight:async({client,contract})=>{
    // Review never claims a business job; RunOnce may claim only the same exact
    // held baseline. Inspect follows completed RunOnce and validates its trusted
    // ledger/descriptor; the cloud worker performs independent business reads.
    if(mode==='Inspect')return;
    const state=await readLaunchSnapshot(client,{contract,readState:readA604State});
    const ids=new Set(state.ledger.plans.filter(p=>p.job_id===D.jobId).map(p=>p.plan_sha));
    const base=normalizedState({...state,ledger:{plans:state.ledger.plans.filter(p=>!ids.has(p.plan_sha)),
      approvals:state.ledger.approvals.filter(a=>!ids.has(a.plan_sha)),attempts:state.ledger.attempts.filter(a=>a.job_id!==D.jobId)}});
    must(await sha256Hex(base)===g.baselineSha256,'FULL_HELD_BASELINE_DRIFT');
  }}});
}
export const createA604PublisherIo=options=>createLiveIo({...options,readState:readA604State});
