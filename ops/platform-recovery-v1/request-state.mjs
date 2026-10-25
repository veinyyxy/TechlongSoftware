// Exact three historical job generations plus the one future candidate. No I/O
// on import; the existing reader retains role/OID/catalog/admission guards.
import {readTransferState} from '../platform-request-v6/transfer-state.mjs';
import {normalizedState} from '../platform-request-v6/transfer.mjs';
import {RECOVERY,must} from './basis.mjs';
export const RECOVERY_PRIOR_JOBS=Object.freeze(['job_6e2e115c80301595512f11fb','job_6a1129afcebfc9fb580517c9']);
export const RECOVERY_EXTRA_LEDGER_SQL=`SELECT
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY plan_sha),'[]') FROM deployment_control_v6.plans p WHERE job_id=ANY($1::text[])) AS plans,
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.plan_sha),'[]') FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=ANY($1::text[])) AS approvals,
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY plan_sha),'[]') FROM deployment_control_v6.dispatch_attempts a WHERE job_id=ANY($1::text[])) AS attempts`;
export async function readRecoveryRequestState(client,{contract,expected,target=RECOVERY}={}){
  const s=await readTransferState(client,{contract,expected,ledgerJobIds:RECOVERY_PRIOR_JOBS,candidateJobId:target.newJobId});
  const rows=(await client.query(RECOVERY_EXTRA_LEDGER_SQL,[[target.oldJobId,target.newJobId]])).rows;
  must(rows.length===1&&['plans','approvals','attempts'].every(k=>Array.isArray(rows[0][k])&&rows[0][k].length<=8),'REQUEST_EXTRA_LEDGER');
  s.ledger=Object.fromEntries(['plans','approvals','attempts'].map(k=>[k,[...s.ledger[k],...rows[0][k]]]));
  must(s.ledger.plans.every(p=>[...RECOVERY_PRIOR_JOBS,target.oldJobId,target.newJobId].includes(p.job_id)),'REQUEST_LEDGER_SCOPE');
  return normalizedState(s);
}
