import {SESSION_SQL} from '../platform-web-database-v1/catalog.mjs';
import {catalogRows,LOCK_SQL} from '../platform-web-database-role-v1/contract.mjs';
import {readEffective} from '../platform-web-database-role-v1/effective.mjs';
import {ROLE,must,same,passwordSql,assertWebSnapshot} from './contract.mjs';
export const PROVIDER_SQL="SELECT current_setting('password_encryption') AS password_encryption,current_setting('neon.forward_ddl',true) AS neon_forward_ddl";
export const PROOF_SQL=`SELECT pg_catalog.current_database() AS database,current_user AS actor,session_user AS session_actor,
 pg_catalog.current_setting('transaction_read_only') AS read_only,pg_catalog.current_setting('search_path') AS search_path,
 (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_oid`;
export async function snapshot(client,target,readOnly){
  const catalog=await catalogRows(client,target,readOnly),effective=await readEffective(client),p=await client.query(PROVIDER_SQL);
  must(p.rows?.length===1&&p.rows[0].password_encryption==='scram-sha-256'&&p.rows[0].neon_forward_ddl==='on','CREDENTIAL_PROVIDER');
  return {catalog,effective,provider:p.rows[0]};
}
export async function readSnapshot(client,target){
  await client.query(SESSION_SQL.begin);
  try{for(const s of SESSION_SQL.settings)await client.query(s);const s=await snapshot(client,target,true);await client.query('COMMIT');return s;}
  catch(e){try{await client.query('ROLLBACK');}catch{/* No retry. */}throw e;}
}
export async function activate({client,target,baseline,password,expiresAt,record,now=Date.now}){
  let begun=false,commitAttempted=false;const roleOid=baseline.identity.candidate_role.oid;
  const window=()=>must(now()<Date.parse(expiresAt),'CREDENTIAL_EXPIRED');
  try{
    window();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE');begun=true;
    for(const s of SESSION_SQL.settings)await client.query(s);await client.query(LOCK_SQL);
    const pre=await snapshot(client,target,false);assertWebSnapshot(pre.catalog,pre.effective,baseline,false);const checkedAt=now();
    await record('activation-preflight',pre);window();must(now()-checkedAt<30000,'CREDENTIAL_PREFLIGHT_STALE');
    // Neon requires the original password, not a pre-hashed SCRAM verifier. Never record this SQL.
    await client.query(passwordSql(password));const post=await snapshot(client,target,false);
    assertWebSnapshot(post.catalog,post.effective,baseline,true);await record('activation-post',post);window();
    await record('commit-intent',{roleOid,atUtc:new Date(now()).toISOString(),retryAllowed:false});commitAttempted=true;
    const ack=await client.query('COMMIT');must(ack.command==='COMMIT','CREDENTIAL_COMMIT_ACK');begun=false;
    await record('commit-ack',{roleOid,atUtc:new Date(now()).toISOString(),command:ack.command});return {commitAcknowledged:true};
  }catch(e){if(begun)try{await client.query('ROLLBACK');await record('rollback',{commitAttempted,providerEffectsUnknown:true});}catch{/* Independent read still required. */}throw e;}
}
export async function dedicatedProof(client,target,expectedOid){
  await client.query(SESSION_SQL.begin);
  // Preserve the role's configured search_path for this proof; query functions are qualified.
  try{for(const s of SESSION_SQL.settings.slice(1))await client.query(s);const r=await client.query(PROOF_SQL),p=r.rows?.[0];
    must(r.rows?.length===1&&p.database===target.database&&p.actor===ROLE&&p.session_actor===ROLE&&p.role_oid===expectedOid&&
      p.read_only==='on'&&same(p.search_path.replace(/\s/g,''),'pg_catalog,public,pg_temp'),'CREDENTIAL_AUTH_PROOF');
    await client.query('COMMIT');return {roleOid:p.role_oid,authenticated:true,readOnly:true,searchPathExact:true,businessRowsRead:false};
  }catch(e){try{await client.query('ROLLBACK');}catch{/* No reconnect. */}throw e;}
}
