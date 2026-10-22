// One disabled Web identity. No password, LOGIN, shared-PUBLIC or default-ACL changes.
import {createHash} from 'node:crypto';
import {PROFILE,QUERIES,assess} from '../platform-web-database-v1/catalog.mjs';
export {PROFILE};
export const ROLE=PROFILE.role,CONNECTION_LIMIT=5;
export const must=(v,code)=>{if(!v)throw Error('WEB_ROLE_'+code);};
export const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
export const same=(a,b)=>canonical(a)===canonical(b);
export const hash=v=>createHash('sha256').update(v).digest('hex');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const qrole=quote(ROLE),table=n=>'public.'+quote(n);
export const TABLES=Object.freeze([...PROFILE.selectTables,'user_credentials','auth_sessions'].sort());
export const STATEMENTS=Object.freeze([
  `CREATE ROLE ${qrole} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${CONNECTION_LIMIT}`,
  `ALTER ROLE ${qrole} SET search_path TO pg_catalog, public, pg_temp`,
  `GRANT USAGE ON SCHEMA public TO ${qrole}`,
  `GRANT SELECT ON TABLE ${PROFILE.selectTables.map(table).join(', ')} TO ${qrole}`,
  `GRANT SELECT (${PROFILE.credentialsSelectColumns.map(quote).join(', ')}) ON TABLE public.user_credentials TO ${qrole}`,
  `GRANT UPDATE (${PROFILE.credentialsUpdateColumns.map(quote).join(', ')}) ON TABLE public.user_credentials TO ${qrole}`,
  `GRANT SELECT, INSERT, DELETE ON TABLE public.auth_sessions TO ${qrole}`,
]);
export const INSTALL_SQL=STATEMENTS.map(s=>s+';').join('\n')+'\n';
export const LOCK_SQL=`LOCK TABLE ${TABLES.map(table).join(', ')} IN ACCESS SHARE MODE`;
export const SETTINGS=Object.freeze(["SET LOCAL search_path=pg_catalog","SET LOCAL statement_timeout='15s'",
  "SET LOCAL lock_timeout='3s'","SET LOCAL createrole_self_grant=''"]);
export const SCOPE=Object.freeze({installerConnections:1,independentReadConnections:1,maxConnections:2,writeTransactions:1,
  readOnlyTransactions:1,persistentStatements:7,createRoles:1,alterRoleSearchPaths:1,grantStatements:5,metadataSelectsMax:23,
  accessShareLockStatements:1,sessionLocalSettingsMax:7,businessRowReads:0,businessDataWrites:0,passwordChanges:0,
  loginActivations:0,awsCalls:0,secretValueReads:0,deployments:0,deletions:0,applicationWriteRetries:0});
export const normalized=c=>({...c,identity:{...c.identity,read_only:'on'}});
const publicHas=(acl,p)=>acl.some(a=>a.grantee==='0'&&a.privilege===p);
export function assertBaseline(c){
  const b=normalized(c),a=assess(b),actor=c.identity.actor_role;
  must(Number(c.identity.server_version_num)>=160000&&actor?.createRole===true&&actor.super===false&&
    c.identity.actor===c.identity.session_actor&&c.identity.database_metadata.owner===actor.oid&&a.candidateRole===null&&
    a.missingTables.length===0&&a.missingCredentialColumns.length===0&&a.publicDefinerPaths.length===0&&
    a.publicRelationGrants.length===0&&a.authUserTriggers.length===0,'BASELINE');
  for(const name of TABLES){const r=c.relations.find(t=>t.schema==='public'&&t.name===name);
    must(r?.kind==='r'&&r.owner===actor.oid&&!r.rls&&!r.forceRls,'BASELINE_TABLE');}
  must(same(c.identity.database_metadata.acl.filter(a=>a.grantee==='0').map(a=>a.privilege).sort(),['CONNECT','TEMPORARY'])&&
    c.schemas.every(s=>!publicHas(s.acl,'CREATE')&&(s.name==='public'||!publicHas(s.acl,'USAGE'))),'PUBLIC_LAYOUT');
  return {tables:TABLES.length,actorOid:actor.oid,temporaryFromPublic:true};
}
export function assertFresh(c,baseline){assertBaseline(c);must(same(normalized(c),normalized(baseline)),'BASELINE_DRIFT');}
export async function catalogRows(client,target,readOnly,onIdentity=async()=>{}){
  const out={};
  for(const q of QUERIES){const r=await client.query(q.sql);must(r.rows?.length===1,'CATALOG_ROW');
    if(q.name==='identity'){out.identity=r.rows[0];must(out.identity.actor===target.actor&&out.identity.session_actor===target.actor&&
      out.identity.database===target.database&&out.identity.read_only===(readOnly?'on':'off'),'IDENTITY');await onIdentity(out.identity);}
    else{must(Array.isArray(r.rows[0].items)&&r.rows[0].items.length<=1000,'CATALOG_LIMIT');out[q.name]=r.rows[0].items;}}
  must(Buffer.byteLength(JSON.stringify(out))<=2*1024*1024,'CATALOG_SIZE');return out;
}
function grants(actual,expected,roleOid,grantors){
  const newEntries=actual.filter(a=>a.grantee===roleOid);
  must(same(newEntries.map(a=>a.privilege).sort(),[...expected].sort())&&newEntries.every(a=>a.grantable===false&&
    (a.grantor===undefined||grantors.includes(a.grantor))),'GRANT_DELTA');
  return actual.filter(a=>a.grantee!==roleOid);
}
export function assertInstalled(c,baseline,roleOid){
  assertBaseline(baseline);const b=structuredClone(c),r=b.identity.candidate_role,actor=b.identity.actor_role;
  must(/^[1-9][0-9]*$/.test(roleOid??'')&&r?.oid===roleOid&&r.name===ROLE&&r.login===false&&r.inherit===false&&
    r.super===false&&r.createRole===false&&r.createDb===false&&r.replication===false&&r.bypassRls===false&&
    r.connectionLimit===CONNECTION_LIMIT&&r.hasRoleSettings===true,'ROLE_ATTRIBUTES');
  b.identity.candidate_role=null;
  for(const t of b.relations){
    const expected=t.schema==='public'?(PROFILE.selectTables.includes(t.name)?['SELECT']:t.name==='auth_sessions'?PROFILE.sessionPrivileges:[]):[];
    t.acl=grants(t.acl,expected,roleOid,[t.owner,actor.oid]);
    for(const col of t.columns){const allowed=[];
      if(t.schema==='public'&&t.name==='user_credentials'){
        if(PROFILE.credentialsSelectColumns.includes(col.name))allowed.push('SELECT');
        if(PROFILE.credentialsUpdateColumns.includes(col.name))allowed.push('UPDATE');}
      col.acl=grants(col.acl,allowed,roleOid,[t.owner,actor.oid]);}
  }
  for(const s of b.schemas)s.acl=grants(s.acl,s.name==='public'?['USAGE']:[],roleOid,[s.owner,actor.oid]);
  const links=b.memberships.filter(m=>m.roleOid===roleOid||m.memberOid===roleOid);
  must(links.length===1&&links[0].role===ROLE&&links[0].roleOid===roleOid&&links[0].memberOid===actor.oid&&
    links[0].admin===true&&links[0].inherit===false&&links[0].set===false,'CREATOR_MEMBERSHIP');
  b.memberships=b.memberships.filter(m=>m.roleOid!==roleOid&&m.memberOid!==roleOid);
  must(same(normalized(b),normalized(baseline)),'UNREVIEWED_DELTA');
  return {roleOid,login:false,tableSelectGrants:PROFILE.selectTables.length,credentialSelectColumns:PROFILE.credentialsSelectColumns.length,
    credentialUpdateColumns:PROFILE.credentialsUpdateColumns.length,sessionPrivileges:[...PROFILE.sessionPrivileges],
    creatorAdmin:true,creatorInherit:false,creatorSet:false,temporaryFromPublic:true,unreviewedDelta:false};
}
