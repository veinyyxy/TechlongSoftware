// Read-only production preparation. Never exposes a writer or retries a connection.
import pg from 'pg';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,DATABASE_V6 as D} from '../platform-publisher-v6/io.mjs';
import {readTransferState} from '../platform-request-v6/transfer-state.mjs';
import {TRANSFER as T} from '../platform-request-v6/transfer.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
const must=(ok,code)=>{if(!ok)throw Error('CURRENT_DATABASE_'+code);};
export const NEW_LEDGER_SQL=`SELECT
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY plan_sha),'[]') FROM deployment_control_v6.plans p WHERE job_id=$1) AS plans,
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.plan_sha),'[]') FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=$1) AS approvals,
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY plan_sha),'[]') FROM deployment_control_v6.dispatch_attempts a WHERE job_id=$1) AS attempts`;
export async function readTransferredSnapshot(client,{contract,expected=D,now=Date.now}){
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query('SET LOCAL search_path=pg_catalog');
    const identity=(await client.query(`SELECT current_user::text AS actor,session_user::text AS session_actor,current_database() AS database,
      (SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS oid,current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation`)).rows[0];
    must(identity.actor===expected.ownerRole&&identity.session_actor===expected.ownerRole&&identity.database===expected.database&&
      identity.oid===expected.ownerOid&&identity.read_only==='on'&&identity.isolation==='repeatable read','IDENTITY_OR_TRANSACTION');
    const state=await readTransferState(client,{contract,expected,now}),rows=(await client.query(NEW_LEDGER_SQL,[T.newJobId])).rows;
    must(rows.length===1&&Object.values(rows[0]).every(v=>Array.isArray(v)&&v.length<=3),'NEW_LEDGER');
    const ro=(await client.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0];must(ro.ro==='on','READ_ONLY');
    const result={state,newLedger:rows[0],checkedAt:now()};assertEvidenceSafeV5(result);
    await client.query('COMMIT');return result;
  }catch(e){try{await client.query('ROLLBACK');}catch{/* no retry */}throw e;}
}
export async function readCurrentDatabaseOnce({auth,contract}){
  const counts={configReadAttempts:0,connectionAttempts:0,queries:0,retries:0};let raw,config;
  try{
    counts.configReadAttempts++;let url=await readAuthV6(auth);config=await publisherDatabaseConfigV6(url);url=undefined;
    raw=new pg.Client({...config,options:'',application_name:'Techlong-Transferred-Review-ReadOnly-Prepare'});config=undefined;
    let failed=false;raw.on('error',()=>{failed=true;});counts.connectionAttempts++;await raw.connect();
    must(raw.connection.stream.encrypted===true&&raw.connection.stream.authorized===true,'TLS');
    const client={async query(text,values){must(!failed&&++counts.queries<=45&&
      (/^SELECT\b/.test(text)||['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','SET LOCAL search_path=pg_catalog','COMMIT','ROLLBACK'].includes(text)),'SQL_BUDGET_OR_OPERATION');
      return raw.query(text,values);}};
    return {snapshot:await readTransferredSnapshot(client,{contract}),counts};
  }catch{throw Object.assign(Error('CURRENT_DATABASE_READ_STOPPED_NO_RETRY'),{counts});}
  finally{config=undefined;if(raw)try{await raw.end();}catch{/* no retry */}}
}
