import { Client } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readSealedPlanManagementStateV1 } from "../../../lib/deployments/execution/sealed-plan-management-v1.ts";
import { validateSealedCertificateV3 } from "../../../lib/deployments/execution/sealed-cell-cleanup-authority-v3.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 } from "../../../lib/deployments/execution/sealed-cell-cleanup-lambda-context-v3.ts";

const args=process.argv.slice(2),out=args.length===2&&args[0]==="--out"?path.resolve(args[1]):null;
if(!out||path.dirname(out).toLowerCase()!==path.resolve("F:/ChatGPT_workshop").toLowerCase()||!/^techlong-f3b3-control-db-[a-z0-9-]+$/.test(path.basename(out)))throw new Error("FRESH_PRIVATE_READONLY_OUTPUT_REQUIRED");
let client;
try{
 const url=new URL(process.env.DATABASE_URL??"");
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||!url.username||!url.password||(url.port&&url.port!=="5432")||
   !["require","verify-full"].includes(url.searchParams.get("sslmode")))throw new Error("NEON_TLS_TARGET_REQUIRED");
 client=new Client({host:url.hostname,port:5432,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1)),
  ssl:{rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,connectionTimeoutMillis:10000,statement_timeout:30000,query_timeout:35000});
 client.on("error",()=>undefined);await client.connect();
 await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");await client.query("SET LOCAL search_path=pg_catalog");
 const read=await readSealedPlanManagementStateV1(client);
 if(read.state.certificates.length!==1||read.state.fence?.sealed!==true||Number(read.state.fence.revision)!==2)throw new Error("SEAL_MISSING");
 const cert=validateSealedCertificateV3({...read.state.certificates[0],sealed_at:Number(read.state.certificates[0].sealed_at)});
 if(await sha256Hex(cert)!==REGISTERED_SEALED_CERTIFICATE_SHA256_V3||read.state.protectionSha256!==cert.protection_schema_sha256||
  read.state.evidence.originalRowSha256!==cert.original_row_sha256||read.state.evidence.originalPlanBytesSha256!==cert.original_plan_bytes_sha256||
  read.state.identity.role!==decodeURIComponent(url.username)||read.state.identity.database!==decodeURIComponent(url.pathname.slice(1)))throw new Error("SEAL_OR_TARGET_DRIFT");
 const management=(await client.query("SELECT rolname,rolcreaterole,rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user")).rows;
 const roles=(await client.query(`SELECT r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
  pg_catalog.has_schema_privilege(r.oid,'public','CREATE') AS create_public,
  (SELECT pg_catalog.jsonb_agg(p.rolname ORDER BY p.rolname) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles p ON p.oid=m.roleid WHERE m.member=r.oid) AS memberships,
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
   AND (pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER') OR pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR
    pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE'))) AS any_public_owner_or_write
  FROM pg_catalog.pg_roles r WHERE r.rolname IN ('techlong_cell_cleanup_reader','techlong_cell_drain','techlong_cell_drain_writer','techlong_plan_only_registrar') ORDER BY r.rolname`)).rows;
 const publicDefiners=(await client.query(`SELECT p.oid::pg_catalog.regprocedure::text AS function,p.proowner::pg_catalog.regrole::text AS owner
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
  AND p.prorettype<>'pg_catalog.trigger'::pg_catalog.regtype AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE') ORDER BY function`)).rows;
 await client.query("COMMIT");
 const report={schemaVersion:1,outcome:"SEALED_CONTROL_DB_CAPABILITIES_READONLY_NOT_AN_INSTALLATION",observedAt:read.observedAt,
  certificateCanonicalSha256:REGISTERED_SEALED_CERTIFICATE_SHA256_V3,protectionSha256:read.state.protectionSha256,management,roles,publicNontriggerSecurityDefiners:publicDefiners,
  registrationRemainsSealed:true,roleCreationPerformed:false,grantPerformed:false,secretCreationPerformed:false,awsMutationPerformed:false,runtimeEnabled:false};
 await mkdir(out);const bytes=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(out,"control-db-capabilities.json"),bytes,{flag:"wx"});
 console.log(JSON.stringify({outcome:report.outcome,output:out,fileSha256:await sha256Hex(bytes),roleNames:roles.map(r=>r.rolname),
  managementCanCreateRole:management[0]?.rolcreaterole===true,publicNontriggerSecurityDefinerCount:publicDefiners.length,databaseMutationPerformed:false}));
}catch{console.error("CONTROL_DB_CAPABILITIES_NOT_VERIFIED; credentials and diagnostics withheld; no database mutation.");process.exitCode=1;}
finally{await client?.end().catch(()=>undefined);}
