// Explicit open only. Uses existing reviewed file reader/target and TLS guards.
import pg from 'pg';
import {readAuthV6} from '../platform-local-v6/local.mjs';
import {publisherDatabaseConfigV6,DATABASE_V6 as D} from '../platform-publisher-v6/io.mjs';
import {readTransferState} from './transfer-state.mjs';
import {createTransferTransaction} from './transfer.mjs';
import {must} from './transfer-entry.mjs';
export async function openTransferDatabase({auth,contract,record,profile,snapshotReader=readTransferState,
  transactionFactory=createTransferTransaction,allowTaskUpdate=true}){
  const readState=c=>snapshotReader(c,{contract,...profile?.reader});
  let url=await readAuthV6(auth),config=await publisherDatabaseConfigV6(url);url=undefined;
  const raw=new pg.Client({...config,options:'',application_name:'Techlong-Reviewed-Task-Transfer-V6'});config=undefined;
  let calls=0,failed=false,opened=false;raw.on('error',()=>{failed=true;});
  const client={async query(text,values){must(!failed&&++calls<=80,'SQL_BUDGET_OR_SESSION');
    must(/^(?:SELECT|WITH|BEGIN|COMMIT|ROLLBACK|SET LOCAL|LOCK TABLE)\b/.test(text)||allowTaskUpdate&&/^UPDATE public\.deployment_jobs\b/.test(text),'SQL_PREFIX');return raw.query(text,values);}};
  const close=async()=>{await raw.end();};
  try{
    await raw.connect();opened=true;must(raw.connection.stream.encrypted===true&&raw.connection.stream.authorized===true,'TLS');
    // Verify role/database/session AND transport before any scoped business read.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=pg_catalog');
    const identity=(await client.query(`SELECT current_user::text AS actor,session_user::text AS session_actor,current_database() AS database,
      (SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS oid,current_setting('transaction_read_only') AS read_only`)).rows[0];
    must(identity.actor===D.ownerRole&&identity.session_actor===D.ownerRole&&identity.database===D.database&&identity.oid===D.ownerOid&&identity.read_only==='on','DATABASE_IDENTITY');
    await client.query('COMMIT');
    const readOnly=async()=>{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query('SET LOCAL search_path=pg_catalog');
      try{const before=(await client.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0];must(before.ro==='on','READ_ONLY');
        const state=await readState(client);
        const after=(await client.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0];must(after.ro==='on','READ_ONLY');
        await client.query('COMMIT');return state;
      }catch(e){try{await client.query('ROLLBACK');}catch{/* no retry */}throw e;}
    };
    const transaction=transactionFactory({client,readState,record,profile});
    return {readOnly,transaction,close,counts:()=>({configReads:1,connections:1,queries:calls,automaticRetries:0})};
  }catch(e){try{await close();}catch{/* no retry */}throw Object.assign(Error('TRANSFER_ENTRY_DATABASE_OPEN_FAILED'),
    {code:/^[A-Z0-9]{5}$/.test(e?.code??'')?e.code:undefined,opened});}
}
