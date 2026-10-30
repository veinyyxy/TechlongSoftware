// One-row retirement recipe only. No connection, credential reader, CLI,
// permanent-slot manager, AWS port or default approval is installed here.
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {performance} from 'node:perf_hooks';

const must=(ok,code)=>{if(!ok)throw Error('TASK_RETIREMENT_'+code);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=v=>/^(0|[1-9][0-9]*)$/.test(String(v))&&Number.isSafeInteger(Number(v));
const sha=sql=>`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${sql})::text,'UTF8')),'hex')`;
export const RETIREMENT_FIELDS=Object.freeze(['status','lease_owner','lease_token','lease_expires_at','updated_at','completed_at']);
const preservedFacts=['deployment_id','app_instance_id','job_id','attempts','max_attempts','payload_matches_review','dedupe_matches_review',
  'job_unchanged_fields_sha256','deployment_row_sha256','outputs_sha256','job_success_receipt_present','job_count','job_ids',
  'other_nonterminal_count','other_leased_count','other_jobs_sha256'];

// Extra execution-time guard: the saved catalog did not cover rewrite rules.
// Never infer that the saved fingerprint proves their absence.
export const RETIREMENT_RULE_GUARD_SQL=`SELECT count(*)::int AS unsafe_update_rule_count
  FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE r.ev_type='2' AND ((n.nspname='public' AND c.relname IN ('deployment_jobs','app_instance_deployments'))
    OR (n.nspname='deployment_control_v6' AND c.relname IN ('plans','approvals','dispatch_attempts')))`;

export function assertRetirementBefore(binding,state,at){
  const f=state?.facts;
  must(binding&&/^job_[a-f0-9]{24}$/.test(binding.jobId)&&/^dep_[a-f0-9]{24}$/.test(binding.deploymentId)&&
    /^app_[a-f0-9]{32}$/.test(binding.appInstanceId)&&integer(binding.originalDeadline)&&integer(binding.expiresAt)&&
    Number.isSafeInteger(at)&&at>=Number(binding.originalDeadline)&&at<Number(binding.expiresAt),'BINDING_OR_TIME');
  must(f&&integer(f.database_now_ms)&&Number(f.database_now_ms)<=at&&at-Number(f.database_now_ms)<5*3600000&&
    Number(binding.expiresAt)<=Number(f.database_now_ms)+5*3600000&&f.timezone==='UTC'&&['on','off'].includes(f.read_only),'FACT_TIME');
  must(f&&f.job_id===binding.jobId&&f.deployment_id===binding.deploymentId&&f.app_instance_id===binding.appInstanceId&&
    f.status==='running'&&f.attempts===1&&f.max_attempts===1&&f.completed_at===null&&f.lease_owner_present===true&&
    f.lease_token_present===true&&f.lease_owner_matches_review===true&&f.payload_matches_review===true&&f.dedupe_matches_review===true&&
    integer(f.lease_expires_at)&&Number(f.lease_expires_at)<at&&integer(f.updated_at)&&Number(f.updated_at)<=at&&
    f.job_success_receipt_present===false&&f.other_nonterminal_count===0&&f.other_leased_count===0,'PRESTATE');
  must(Array.isArray(f.job_ids)&&f.job_count===f.job_ids.length&&f.job_count>0&&f.job_count<=64&&
    same([...new Set(f.job_ids)].sort(),f.job_ids)&&f.job_ids.includes(binding.jobId),'JOB_SET');
  for(const key of ['job_row_sha256','job_unchanged_fields_sha256','deployment_row_sha256','outputs_sha256','other_jobs_sha256'])
    must(hash(f[key]),'ROW_HASH');
  must(hash(state.ledger?.ledger_sha256)&&['plan_count','approval_count','attempt_count'].every(k=>
    Number.isInteger(state.ledger[k])&&state.ledger[k]>=0&&state.ledger[k]<=64)&&Array.isArray(state.ledger.exact_job_states)&&
    state.ledger.exact_job_states.length===2&&state.ledger.exact_job_states.some(v=>v.mode==='Review'&&v.state==='OBSERVED'&&v.proofPresent===true)&&
    state.ledger.exact_job_states.some(v=>v.mode==='RunOnce'&&v.state==='ACKNOWLEDGED'&&v.proofPresent===false),'LEDGER');
  must(hash(state.controlCatalogSha256)&&hash(state.businessCatalogSha256)&&hash(state.protectionSha256)&&
    state.controlFunctionsVerified===9&&state.leaseTokenOrBusinessBodiesReturned===false,'PROTECTION');
  return state;
}

function sameBefore(a,b){
  // Clock/read-only mode are observations, not row fingerprints. All actual
  // before-row fields, ledger and protection pins must still match exactly.
  const project=s=>({...s.facts,database_now_ms:null,read_only:null,timezone:null});
  return same(project(a),project(b))&&same(a.ledger,b.ledger)&&
    ['controlCatalogSha256','businessCatalogSha256','protectionSha256','controlFunctionsVerified',
      'leaseTokenOrBusinessBodiesReturned'].every(k=>same(a[k],b[k]));
}

export function compileRetirementUpdate(binding,baseline,startedAt){
  const {facts:f}=assertRetirementBefore(binding,baseline,startedAt);
  return {text:`WITH stamp AS MATERIALIZED (SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at)
    UPDATE public.deployment_jobs j SET status='canceled',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
      updated_at=stamp.at,completed_at=stamp.at FROM stamp
    WHERE j.id=$1 AND j.deployment_id=$2 AND ${sha('to_jsonb(j)')}=$4
      AND j.status='running' AND j.attempts=1 AND j.max_attempts=1 AND j.completed_at IS NULL
      AND j.lease_owner IS NOT NULL AND j.lease_token IS NOT NULL AND j.lease_expires_at<stamp.at
      AND stamp.at>=$5 AND stamp.at<$5+30000 AND stamp.at<$6
      AND EXISTS(SELECT FROM public.app_instance_deployments d WHERE d.id=$2 AND d.app_instance_id=$3
        AND NOT coalesce((d.outputs::jsonb->'expressInitializedWorkerRunsV2') ? j.id,false))
    RETURNING j.id,j.updated_at::text AS retired_at,${sha('to_jsonb(j)')} AS job_row_sha256`,
    values:[binding.jobId,binding.deploymentId,binding.appInstanceId,f.job_row_sha256,startedAt,Number(binding.expiresAt)]};
}

export function verifyRetirementReadback(binding,before,after,retiredAt,expectedRowSha256){
  assertRetirementBefore(binding,before,Number(retiredAt));
  const a=after?.facts,b=before.facts;
  must(integer(retiredAt)&&Number(retiredAt)<Number(binding.expiresAt)&&a&&a.status==='canceled'&&a.completed_at===String(retiredAt)&&
    a.updated_at===String(retiredAt)&&a.lease_owner_present===false&&a.lease_token_present===false&&a.lease_expires_at===null&&
    a.lease_owner_matches_review===null&&hash(expectedRowSha256)&&a.job_row_sha256===expectedRowSha256&&
    a.job_row_sha256!==b.job_row_sha256,'RETIRED_ROW');
  must(preservedFacts.every(k=>same(a[k],b[k]))&&same(after.ledger,before.ledger)&&
    ['controlCatalogSha256','businessCatalogSha256','protectionSha256','controlFunctionsVerified',
      'leaseTokenOrBusinessBodiesReturned'].every(k=>same(after[k],before[k])),'PRESERVED_ROWS');
  return {outcome:'ONE_TASK_RETIRED_OTHERS_PRESERVED',jobId:binding.jobId,retiredAt:String(retiredAt),
    successReceiptWritten:false,newTaskCreated:false,retryAllowed:false};
}

// The separately reviewed local recipe must supply a restricted TLS client,
// a pinned server-hash reader, fresh exact-resource absence checks, approval
// verification, a durable one-shot slot and an independent read-only connection.
// This function neither manufactures those proofs nor grants their authority.
export function createRetirementTransaction({client,readState,assertStopped,assertApproved,record,now=Date.now,elapsedNow=()=>performance.now()}){
  must(client&&[readState,assertStopped,assertApproved,record].every(v=>typeof v==='function'),'EXPLICIT_PORTS');
  let used=false;
  return async({binding,baseline})=>{
    must(!used,'TRANSACTION_ONCE');used=true;
    binding=structuredClone(binding);baseline=structuredClone(baseline);
    let started=false,committing=false,committed=false,phase='APPROVAL',at=null;
    try{
      // Validate the saved observation at its actual DB epoch. Freshness,
      // lease expiry and the write cutoff are checked again at the live DB
      // epoch below; local UTC is only the separate approval-window gate.
      assertRetirementBefore(binding,baseline,Number(baseline?.facts?.database_now_ms));
      must(Number.isSafeInteger(now())&&now()<Number(binding.expiresAt),'APPROVAL_TIME');await assertApproved();
      phase='EXACT_RESOURCES_STOPPED';const stoppedCheckStarted=elapsedNow();
      must(Number.isFinite(stoppedCheckStarted)&&stoppedCheckStarted>=0,'ELAPSED_CLOCK');await assertStopped(binding);
      phase='BEGIN';await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');started=true;
      await client.query('SET LOCAL search_path=pg_catalog');await client.query("SET LOCAL TimeZone='UTC'");
      await client.query("SET LOCAL lock_timeout='1s'");await client.query("SET LOCAL statement_timeout='15s'");
      // These five short table locks also exclude inserts/phantoms. They may
      // block unrelated controller/job writes; their scope must be approved.
      await client.query('LOCK TABLE deployment_control_v6.plans,deployment_control_v6.approvals,deployment_control_v6.dispatch_attempts,public.app_instance_deployments,public.deployment_jobs IN SHARE ROW EXCLUSIVE MODE');
      at=Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at')).rows[0]?.at);
      assertRetirementBefore(binding,baseline,at);
      const timely=()=>{const elapsed=elapsedNow()-stoppedCheckStarted;
        must(Number.isFinite(elapsed)&&elapsed>=0&&elapsed<30000,'ELAPSED_DEADLINE');
        must(Number.isSafeInteger(now())&&now()<Number(binding.expiresAt),'APPROVAL_TIME');};
      timely();phase='LOCKED_STATE';
      must((await client.query(RETIREMENT_RULE_GUARD_SQL)).rows[0]?.unsafe_update_rule_count===0,'UPDATE_RULES');
      const fresh=await readState(client),snapshotAt=Number(fresh?.facts?.database_now_ms);
      must(Number.isSafeInteger(snapshotAt)&&snapshotAt>=at&&snapshotAt<at+30000,'SNAPSHOT_TIME');
      assertRetirementBefore(binding,fresh,snapshotAt);
      must(sameBefore(baseline,fresh),'STATE_DRIFT');
      const p=compileRetirementUpdate(binding,fresh,snapshotAt);
      await assertApproved();timely();
      await record('retirement-intent',{jobId:binding.jobId,beforeRowSha256:fresh.facts.job_row_sha256,at});
      phase='UPDATE';const r=await client.query(p.text,p.values),row=r.rows?.[0];
      must(r.rowCount===1&&r.rows.length===1&&row.id===binding.jobId&&integer(row.retired_at)&&
        Number(row.retired_at)>=at&&Number(row.retired_at)<at+30000,'UPDATE_RESULT');
      phase='IN_TRANSACTION_READBACK';const after=await readState(client);
      const afterAt=Number(after?.facts?.database_now_ms);
      must(Number.isSafeInteger(afterAt)&&afterAt>=Number(row.retired_at)&&afterAt<at+30000&&afterAt<Number(binding.expiresAt),'READBACK_TIME');
      verifyRetirementReadback(binding,fresh,after,row.retired_at,row.job_row_sha256);
      must((await client.query(RETIREMENT_RULE_GUARD_SQL)).rows[0]?.unsafe_update_rule_count===0,'UPDATE_RULES');
      await record('retirement-precommit',{jobId:binding.jobId,retiredAt:row.retired_at,jobRowSha256:row.job_row_sha256});
      await assertApproved();timely();phase='COMMIT';committing=true;await client.query('COMMIT');committed=true;
      return {outcome:'RETIREMENT_COMMITTED_REQUIRES_INDEPENDENT_READBACK',committed,retiredAt:row.retired_at,
        jobRowSha256:row.job_row_sha256,independentReadbackRequired:true,retryAllowed:false};
    }catch{
      if(started&&!committing)try{await client.query('ROLLBACK');}catch{/* No retry, including failed rollback. */}
      return {outcome:committing?'RETIREMENT_COMMIT_UNKNOWN_REQUIRES_READBACK':'RETIREMENT_STOPPED_REQUIRES_READBACK',
        phase,at,committed,commitSubmissionAttempted:committing,independentReadbackRequired:true,retryAllowed:false};
    }
  };
}
