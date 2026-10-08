// Read-only provider-specific metadata; no role/password change, no SecretString and no sensitive GUC values.
import { Client } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
const args=process.argv.slice(2),out=args.length===2&&args[0]==="--out"?path.resolve(args[1]):null;
if(!out||path.dirname(out).toLowerCase()!==path.resolve("F:/ChatGPT_workshop").toLowerCase()||
 !/^techlong-f3b3-credential-provider-read-[a-z0-9-]+$/.test(path.basename(out)))throw new Error("FRESH_PRIVATE_PROVIDER_READ_REQUIRED");
let client;
try{
 const url=new URL(process.env.DATABASE_URL??"");
 const user=decodeURIComponent(url.username),database=decodeURIComponent(url.pathname.slice(1));
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||!url.password||
  (url.port&&url.port!=="5432")||!["require","verify-full"].includes(url.searchParams.get("sslmode"))||
  await sha256Hex({protocol:"neon-sealed-management-target-v1",host:url.hostname,port:5432,database,user})!==
   "06e1188c19fe0c8552bd398f192d7489ccae48498216fcd532344d07720cadab")throw new Error("EXACT_PROVIDER_TARGET_REQUIRED");
 client=new Client({host:url.hostname,port:5432,user,password:decodeURIComponent(url.password),database,
  ssl:{rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,connectionTimeoutMillis:10000,statement_timeout:30000,query_timeout:35000});
 client.on("error",()=>undefined);await client.connect();
 await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;SET LOCAL search_path=pg_catalog");
 const identity=(await client.query("SELECT current_user AS role,session_user AS session_role,current_database() AS database,current_setting('transaction_read_only') AS read_only,current_setting('server_version_num')::int AS version,(extract(epoch FROM transaction_timestamp())*1000)::bigint AS observed_at")).rows[0];
 if(identity.role!==user||identity.session_role!==user||identity.database!==database||identity.read_only!=="on"||identity.version!==180006)throw new Error("PROVIDER_IDENTITY_NOT_VERIFIED");
 const settings=(await client.query("SELECT name,setting,vartype FROM pg_catalog.pg_settings WHERE name IN ('neon.forward_ddl','password_encryption','default_transaction_isolation','default_transaction_read_only') ORDER BY name")).rows;
 const extensions=(await client.query("SELECT extname,extversion FROM pg_catalog.pg_extension WHERE extname IN ('neon','pg_stat_statements') ORDER BY extname")).rows;
 const roles=(await client.query("SELECT rolname,rolcanlogin FROM pg_catalog.pg_roles WHERE rolname IN ('techlong_cell_cleanup_reader','techlong_cell_drain') ORDER BY rolname")).rows;
 await client.query("COMMIT");
 const report={schemaVersion:1,mode:"NEON_CREDENTIAL_PROVIDER_METADATA_READONLY",observedAt:Number(identity.observed_at),postgresVersion:identity.version,
  pooledEndpoint:url.hostname.includes("-pooler."),settings,extensions,roles,sensitiveGucsRead:false,secretValuesRead:false,
  databaseMutationPerformed:false,awsCalled:false,writeRetryAllowed:false,exactCommitFailureCauseVerified:false,runtimeEnabled:false};
 await mkdir(out);const bytes=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(out,"provider-metadata.json"),bytes,{flag:"wx"});
 console.log(JSON.stringify({output:out,fileSha256:await sha256Hex(bytes),...report}));
}catch{console.error("PROVIDER_READ_NOT_VERIFIED; no writes or retries; credentials and raw diagnostics withheld.");process.exitCode=1;}
finally{await client?.end().catch(()=>undefined);}
