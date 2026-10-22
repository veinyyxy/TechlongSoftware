// Fixed system-catalog reads only. No business rows, function bodies or password material.
import {WEB_DATABASE_PROFILE as PROFILE} from '../platform-hosting-v1/database-profile.mjs';
export {PROFILE};
export const ROLE=PROFILE.role;
export const must=(v,code)=>{if(!v)throw Error('WEB_DB_'+code);};
const userSchema="n.nspname !~ '^pg_' AND n.nspname<>'information_schema'";
const acl=(value,kind,owner)=>`coalesce((SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee::text,'grantor',a.grantor::text,
 'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.grantor,a.privilege_type)
 FROM pg_catalog.aclexplode(coalesce(${value},pg_catalog.acldefault(${kind==='relation'?`(CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char"`:`'${kind}'`},${owner}))) a),'[]'::jsonb)`;
const roleFields=`jsonb_build_object('oid',r.oid::text,'name',r.rolname,'login',r.rolcanlogin,'super',r.rolsuper,
 'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,
 'connectionLimit',r.rolconnlimit,'hasRoleSettings',r.rolconfig IS NOT NULL)`;
const arrayQuery=body=>`WITH items AS (${body} LIMIT 1001)
 SELECT coalesce(jsonb_agg(item),'[]'::jsonb) AS items FROM items`;
export const QUERIES=Object.freeze([
  {name:'identity',sql:`SELECT current_database() AS database,current_user AS actor,session_user AS session_actor,
 current_setting('transaction_read_only') AS read_only,current_setting('server_version_num') AS server_version_num,
 (SELECT ${roleFields} FROM pg_catalog.pg_roles r WHERE r.rolname=current_user) AS actor_role,
 (SELECT ${roleFields} FROM pg_catalog.pg_roles r WHERE r.rolname='${ROLE}') AS candidate_role,
 (SELECT jsonb_build_object('oid',d.oid::text,'owner',d.datdba::text,'acl',${acl('d.datacl','d','d.datdba')})
  FROM pg_catalog.pg_database d WHERE d.datname=current_database()) AS database_metadata`},
  {name:'relations',sql:arrayQuery(`SELECT jsonb_build_object('schema',n.nspname,'name',c.relname,'oid',c.oid::text,
 'owner',c.relowner::text,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',${acl('c.relacl','relation','c.relowner')},'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',col.attname,
 'number',col.attnum,'type',pg_catalog.format_type(col.atttypid,col.atttypmod),'notNull',col.attnotnull,
 'hasDefault',col.atthasdef,'identity',col.attidentity,'generated',col.attgenerated,
 'acl',coalesce((SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
 ORDER BY a.grantee,a.privilege_type) FROM pg_catalog.aclexplode(col.attacl) a),'[]'::jsonb)) ORDER BY col.attnum),'[]'::jsonb)
 FROM pg_catalog.pg_attribute col WHERE col.attrelid=c.oid AND col.attnum>0 AND NOT col.attisdropped)) AS item
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE ${userSchema} AND c.relkind IN ('r','p','v','m','S','f') ORDER BY n.nspname,c.relname,c.oid`)},
  {name:'schemas',sql:arrayQuery(`SELECT jsonb_build_object('name',n.nspname,'oid',n.oid::text,'owner',n.nspowner::text,
 'acl',${acl('n.nspacl','n','n.nspowner')}) AS item FROM pg_catalog.pg_namespace n
 WHERE ${userSchema} ORDER BY n.nspname,n.oid`)},
  {name:'routines',sql:arrayQuery(`SELECT jsonb_build_object('schema',n.nspname,'name',p.proname,'oid',p.oid::text,
 'owner',p.proowner::text,'kind',p.prokind,'argumentTypes',pg_catalog.oidvectortypes(p.proargtypes),
 'definer',p.prosecdef,'language',l.lanname,'acl',${acl('p.proacl','f','p.proowner')}) AS item
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE ${userSchema} ORDER BY n.nspname,p.proname,p.oid`)},
  {name:'memberships',sql:arrayQuery(`SELECT jsonb_build_object('role',r.rolname,'roleOid',r.oid::text,
 'member',u.rolname,'memberOid',u.oid::text,'grantor',m.grantor::text,'admin',m.admin_option,
 'inherit',to_jsonb(m)->'inherit_option','set',to_jsonb(m)->'set_option') AS item
 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member
 WHERE r.rolname IN (current_user,'${ROLE}') OR u.rolname IN (current_user,'${ROLE}') ORDER BY r.rolname,u.rolname,m.grantor`)},
  {name:'defaultAcls',sql:arrayQuery(`SELECT jsonb_build_object('owner',d.defaclrole::text,'schema',n.nspname,
 'kind',d.defaclobjtype,'acl',coalesce((SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee::text,
 'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type)
 FROM pg_catalog.aclexplode(d.defaclacl) a),'[]'::jsonb)) AS item
 FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
 ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype`)},
  {name:'authTriggers',sql:arrayQuery(`SELECT jsonb_build_object('table',c.relname,'name',t.tgname,'oid',t.oid::text,
 'enabled',t.tgenabled,'internal',t.tgisinternal,'type',t.tgtype,'functionOid',p.oid::text,'functionSchema',pn.nspname,
 'functionName',p.proname,'definer',p.prosecdef,'functionOwner',p.proowner::text) AS item
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
 WHERE n.nspname='public' AND c.relname IN ('user_credentials','auth_sessions') ORDER BY c.relname,t.tgname,t.oid`)},
]);
export const SESSION_SQL=Object.freeze({begin:'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  settings:["SET LOCAL search_path=pg_catalog","SET LOCAL statement_timeout='15s'","SET LOCAL lock_timeout='3s'"],commit:'COMMIT',rollback:'ROLLBACK'});
export async function readCatalog(client,expected){
  const out={};await client.query(SESSION_SQL.begin);
  try{
    for(const sql of SESSION_SQL.settings)await client.query(sql);
    for(const q of QUERIES){
      const r=await client.query(q.sql);must(r.rows?.length===1,'CATALOG_ROW_COUNT');
      if(q.name==='identity'){
        out.identity=r.rows[0];must(out.identity.read_only==='on'&&out.identity.actor===expected.actor&&
          out.identity.session_actor===expected.actor&&out.identity.database===expected.database,'DATABASE_IDENTITY');
      }else{const a=r.rows[0].items;must(Array.isArray(a)&&a.length<=1000,'CATALOG_TRUNCATED');out[q.name]=a;}
    }
    must(Buffer.byteLength(JSON.stringify(out))<=2*1024*1024,'CATALOG_SIZE');
    await client.query(SESSION_SQL.commit);return out;
  }catch(e){try{await client.query(SESSION_SQL.rollback);}catch{/* Never retry a connection/query. */}throw e;}
}
const publicHas=(a,privilege)=>a.some(x=>x.grantee==='0'&&x.privilege===privilege);
export function assess(c){
  must(c.identity?.read_only==='on'&&Array.isArray(c.relations)&&Array.isArray(c.routines)&&Array.isArray(c.schemas),'ASSESS_INPUT');
  const wanted=[...PROFILE.selectTables,'user_credentials','auth_sessions'];
  const missingTables=wanted.filter(name=>!c.relations.some(r=>r.schema==='public'&&r.name===name&&r.kind==='r'));
  const credential=c.relations.find(r=>r.schema==='public'&&r.name==='user_credentials');
  const missingCredentialColumns=[...new Set([...PROFILE.credentialsSelectColumns,...PROFILE.credentialsUpdateColumns])]
    .filter(name=>!credential?.columns.some(col=>col.name===name));
  const publicSchemaUsage=new Set(c.schemas.filter(s=>publicHas(s.acl,'USAGE')).map(s=>s.name));
  const publicDefinerPaths=c.routines.filter(f=>f.definer&&publicSchemaUsage.has(f.schema)&&publicHas(f.acl,'EXECUTE'))
    .map(f=>({schema:f.schema,name:f.name,oid:f.oid,argumentTypes:f.argumentTypes}));
  const publicRelationGrants=c.relations.filter(r=>publicSchemaUsage.has(r.schema)&&
    (r.acl.some(a=>a.grantee==='0')||r.columns.some(col=>col.acl.some(a=>a.grantee==='0')))).map(r=>({schema:r.schema,name:r.name,oid:r.oid}));
  const authUserTriggers=c.authTriggers.filter(t=>!t.internal);
  return {candidateRole:c.identity.candidate_role,missingTables,missingCredentialColumns,publicDefinerPaths,publicRelationGrants,
    authUserTriggers,installationAuthorized:false,passwordRead:false,businessRowsRead:false,
    note:'Catalog observation only. No grant is installed or declared safe; future role ownership, memberships, PUBLIC paths and trigger semantics require review.'};
}
