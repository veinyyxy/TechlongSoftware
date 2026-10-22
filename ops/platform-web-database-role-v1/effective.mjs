import {ROLE,PROFILE,must,CONNECTION_LIMIT,same} from './contract.mjs';
const normalPrivileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
const tableBits=normalPrivileges.map(p=>`'${p}',pg_catalog.has_table_privilege(s.oid,c.oid,'${p}')`).join(',');
const columnBits=['SELECT','INSERT','UPDATE','REFERENCES'].map(p=>`'${p}',pg_catalog.has_column_privilege(s.oid,c.oid,col.attnum,'${p}')`).join(',');
export const EFFECTIVE_SQL=`WITH service AS (SELECT oid,rolconnlimit,rolconfig FROM pg_catalog.pg_roles WHERE rolname='${ROLE}')
 SELECT jsonb_build_object('oid',s.oid::text,'connectionLimit',s.rolconnlimit,'config',s.rolconfig) AS role_settings,
 (SELECT jsonb_build_object('CONNECT',pg_catalog.has_database_privilege(s.oid,d.oid,'CONNECT'),
 'CREATE',pg_catalog.has_database_privilege(s.oid,d.oid,'CREATE'),'TEMPORARY',pg_catalog.has_database_privilege(s.oid,d.oid,'TEMPORARY'))
 FROM pg_catalog.pg_database d WHERE d.datname=current_database()) AS database_privileges,
 (SELECT coalesce(jsonb_agg(item),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',n.nspname,
 'USAGE',pg_catalog.has_schema_privilege(s.oid,n.oid,'USAGE'),'CREATE',pg_catalog.has_schema_privilege(s.oid,n.oid,'CREATE')) AS item
 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' ORDER BY n.nspname LIMIT 1001) q) AS schemas,
 (SELECT coalesce(jsonb_agg(item),'[]'::jsonb) FROM (SELECT jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
 'table',CASE WHEN c.relkind<>'S' THEN jsonb_build_object(${tableBits}) ELSE NULL END,
 'sequence',CASE WHEN c.relkind='S' THEN jsonb_build_object('SELECT',pg_catalog.has_sequence_privilege(s.oid,c.oid,'SELECT'),
 'UPDATE',pg_catalog.has_sequence_privilege(s.oid,c.oid,'UPDATE'),'USAGE',pg_catalog.has_sequence_privilege(s.oid,c.oid,'USAGE')) ELSE NULL END,
 'columns',CASE WHEN c.relkind<>'S' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('name',col.attname,${columnBits}) ORDER BY col.attnum),'[]'::jsonb)
 FROM pg_catalog.pg_attribute col WHERE col.attrelid=c.oid AND col.attnum>0 AND NOT col.attisdropped) ELSE '[]'::jsonb END) AS item
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','S','f')
 ORDER BY n.nspname,c.relname,c.oid LIMIT 1001) q) AS relations FROM service s`;
export async function readEffective(client){const r=await client.query(EFFECTIVE_SQL);must(r.rows?.length===1,'EFFECTIVE_ROLE');
  const e=r.rows[0];must(e.schemas?.length<=1000&&e.relations?.length<=1000&&Buffer.byteLength(JSON.stringify(e))<2*1024*1024,'EFFECTIVE_LIMIT');return e;}
export function assertEffective(e,c,roleOid){
  must(e.role_settings?.oid===roleOid&&e.role_settings.connectionLimit===CONNECTION_LIMIT&&e.role_settings.config?.length===1&&
    e.role_settings.config[0].replace(/\s/g,'')==='search_path=pg_catalog,public,pg_temp'&&
    same(e.database_privileges,{CONNECT:true,CREATE:false,TEMPORARY:true}),'EFFECTIVE_ROLE_DATABASE');
  must(same(e.schemas.map(s=>s.name).sort(),c.schemas.map(s=>s.name).sort())&&
    same(e.relations.map(t=>[t.schema,t.name,t.kind]).sort(),c.relations.map(t=>[t.schema,t.name,t.kind]).sort()),'EFFECTIVE_COVERAGE');
  for(const s of e.schemas)must(s.USAGE===(s.name==='public')&&s.CREATE===false,'EFFECTIVE_SCHEMA');
  for(const t of e.relations){const allowed=t.schema==='public'?(PROFILE.selectTables.includes(t.name)?['SELECT']:t.name==='auth_sessions'?PROFILE.sessionPrivileges:[]):[];
    const original=c.relations.find(r=>r.schema===t.schema&&r.name===t.name);
    if(t.kind==='S'){must(t.table===null&&Object.values(t.sequence).every(v=>v===false),'EFFECTIVE_SEQUENCE');continue;}
    must(same(t.columns.map(col=>col.name),original.columns.map(col=>col.name)),'EFFECTIVE_COLUMN_COVERAGE');
    must(Object.keys(t.table).length===normalPrivileges.length,'EFFECTIVE_TABLE_SHAPE');
    for(const p of normalPrivileges)must(t.table[p]===allowed.includes(p),'EFFECTIVE_TABLE');
    for(const col of t.columns)for(const p of ['SELECT','INSERT','UPDATE','REFERENCES']){
      const specific=t.schema==='public'&&t.name==='user_credentials'&&
        ((p==='SELECT'&&PROFILE.credentialsSelectColumns.includes(col.name))||(p==='UPDATE'&&PROFILE.credentialsUpdateColumns.includes(col.name)));
      must(col[p]===(allowed.includes(p)||specific),'EFFECTIVE_COLUMN');}
  }
  return {exactTableColumnAndSchemaPrivileges:true,connectFromPublic:true,temporaryFromPublic:true,roleConfigExact:true};
}
