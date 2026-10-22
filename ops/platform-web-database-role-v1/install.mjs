// Transaction coordinator; client creation and local permanent fencing live in local.mjs.
import {SESSION_SQL} from '../platform-web-database-v1/catalog.mjs';
import {STATEMENTS,SETTINGS,LOCK_SQL,must,assertFresh,assertInstalled,catalogRows} from './contract.mjs';
import {readEffective,assertEffective} from './effective.mjs';
export async function installTransaction({client,target,baseline,expiresAt,record,roleIdentity,now=Date.now}){
  let begun=false,commitAttempted=false,acknowledgedStatements=0;
  const window=()=>must(now()<Date.parse(expiresAt),'APPROVAL_EXPIRED');
  try{
    window();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE');begun=true;
    for(const sql of SETTINGS)await client.query(sql);
    // Shared locks block conflicting DDL, not ordinary row writes. Not an ACL/cluster CAS.
    await client.query(LOCK_SQL);
    const pre=await catalogRows(client,target,false);assertFresh(pre,baseline);const preflightAt=now();await record('preflight',pre);
    for(let n=0;n<STATEMENTS.length;n++){window();if(n===0)must(now()-preflightAt<30000,'PREFLIGHT_STALE');await client.query(STATEMENTS[n]);acknowledgedStatements++;}
    let roleOid;
    const post=await catalogRows(client,target,false,async identity=>{
      roleOid=identity.candidate_role?.oid;must(roleOid,'CREATED_ROLE_ID');await roleIdentity(roleOid);
    });
    const installed=assertInstalled(post,baseline,roleOid),effective=await readEffective(client),privileges=assertEffective(effective,post,roleOid);
    await record('before-commit',{post,effective,installed,privileges});window();
    await record('commit-intent',{roleOid,atUtc:new Date(now()).toISOString(),retryAllowed:false});commitAttempted=true;
    const ack=await client.query('COMMIT');must(ack.command==='COMMIT','COMMIT_ACK');begun=false;
    await record('commit-ack',{roleOid,command:ack.command,atUtc:new Date(now()).toISOString()});
    return {roleOid,commitAcknowledged:true,installed,privileges};
  }catch(e){if(begun){try{await client.query('ROLLBACK');await record('rollback',{commitAttempted,acknowledgedStatements});}catch{/* Outcome still requires independent readback. */}}throw e;}
}
export async function independentRead({client,target,baseline,roleOid,record}){
  let begun=false;
  try{
    await client.query(SESSION_SQL.begin);begun=true;for(const sql of SESSION_SQL.settings)await client.query(sql);
    const catalog=await catalogRows(client,target,true);await record('independent-catalog',catalog);
    if(!catalog.identity.candidate_role){assertFresh(catalog,baseline);await client.query('COMMIT');begun=false;
      return {state:'ROLE_ABSENT_BASELINE_RESTORED',roleOid:null};}
    must(roleOid,'ROLE_OWNERSHIP_UNPROVED');const installed=assertInstalled(catalog,baseline,roleOid),effective=await readEffective(client);
    const privileges=assertEffective(effective,catalog,roleOid);await record('independent-effective',{effective,installed,privileges});
    await client.query('COMMIT');begun=false;return {state:'EXACT_NOLOGIN_ROLE_OBSERVED',roleOid,installed,privileges};
  }catch(e){if(begun)try{await client.query('ROLLBACK');}catch{/* Read-only cleanup only. */}throw e;}
}
