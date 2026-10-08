import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Only an owned GitHub-hosted service; never consumes DATABASE_URL/.env. */
export async function withGithubPg18Fixture({ output },body){
 if(process.env.GITHUB_ACTIONS!=="true"||process.env.RUNNER_ENVIRONMENT!=="github-hosted"||
  process.env.GITHUB_REPOSITORY!=="veinyyxy/TechlongSoftware"||process.env.GITHUB_WORKFLOW!=="Sealed plan PostgreSQL 18 proof")
  throw new Error("GITHUB_OWNED_PG18_FIXTURE_REQUIRED");
 const target=path.resolve(output),workspace=path.resolve(process.env.GITHUB_WORKSPACE??"");
 if(target!==path.join(workspace,"artifacts","sealed-pg18"))throw new Error("CI_OUTPUT_SCOPE_INVALID");
 const port=Number(process.env.SEALED_PLAN_PG_PORT),password=process.env.SEALED_PLAN_CI_PASSWORD;
 if(!Number.isSafeInteger(port)||port<1024||port>65535||!password)throw new Error("CI_SERVICE_CONFIG_MISSING");
 await mkdir(target,{recursive:true});
 const database=`sealed_ci_${randomBytes(12).toString("hex")}`;
 const clients=new Set(),receipt={sourceMutationPerformed:false,neonMutationPerformed:false,cloudMutationPerformed:false,
  installationAuthorized:false,runtimeEnabled:false,ownedCiDatabaseDropped:false,githubRunId:process.env.GITHUB_RUN_ID,
  githubRunAttempt:process.env.GITHUB_RUN_ATTEMPT,githubHeadSha:process.env.GITHUB_SHA};
 const connectAs=async(db,user)=>{
  const client=new Client({host:"127.0.0.1",port,user,password,database:db,ssl:false,connectionTimeoutMillis:5000,
   statement_timeout:30000,query_timeout:35000});
  client.on("error",()=>undefined);await client.connect();clients.add(client);return client;
 };
 let admin,result,failure;
 const ownedDatabases=new Set();
 try{
  admin=await connectAs("postgres","postgres");
  const identity=(await admin.query("SELECT current_setting('server_version_num')::int AS version,current_database() AS db,current_user AS role")).rows[0];
  if(identity.version!==180006||identity.db!=="postgres"||identity.role!=="postgres")throw new Error("EXACT_CI_PG18_IDENTITY_MISMATCH");
  const testPassword=randomBytes(32).toString("hex");
  await admin.query(`CREATE ROLE cell_admin LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD '${testPassword}'`);
  await admin.query(`CREATE DATABASE "${database}" OWNER cell_admin TEMPLATE template0`);ownedDatabases.add(database);
  const connectDatabase=async(databaseName)=>{
   if(!ownedDatabases.has(databaseName))throw new Error("OWNED_CI_DATABASE_REQUIRED");
   const client=new Client({host:"127.0.0.1",port,user:"cell_admin",password:testPassword,database:databaseName,ssl:false,
    connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:35000});
   client.on("error",()=>undefined);await client.connect();clients.add(client);return client;
  };
  const connect=()=>connectDatabase(database);
  const managementClient=await connect();
  const tables=(await managementClient.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0];
  if(tables.n!==0)throw new Error("OWNED_CI_DATABASE_NOT_EMPTY");
  const withOwnedDatabase=async(proof)=>{
   const sibling=`sealed_ci_${randomBytes(12).toString("hex")}`;
   await admin.query(`CREATE DATABASE "${sibling}" OWNER cell_admin TEMPLATE template0`);ownedDatabases.add(sibling);
   const client=await connectDatabase(sibling);
   try{return await proof({client,connect:()=>connectDatabase(sibling)});}finally{await client.end();clients.delete(client);}
  };
  result=await body({managementClient,connect,withOwnedDatabase,receipt,output:target});
 }catch(error){failure=error;receipt.failureCode=/^[A-Z0-9_]{5,100}$/.test(error.code??"")?error.code:"CI_PG18_PROOF_FAILED";}
 finally{
  for(const client of clients)if(client!==admin)await client.end().catch(()=>undefined);
  if(ownedDatabases.size>0&&admin){
   let dropped=0;
   for(const owned of ownedDatabases){try{await admin.query(`DROP DATABASE "${owned}"`);dropped++;}catch{failure??=new Error("CI_DATABASE_TEARDOWN_UNVERIFIED");}}
   receipt.ownedCiDatabaseDropped=dropped===ownedDatabases.size;receipt.ownedCiDatabaseCountDropped=dropped;
  }
  await admin?.end().catch(()=>undefined);
  const final={...result?.receipt,...receipt,outcome:failure?"SEALED_PG18_PROOF_FAILED":result?.outcome,finishedAt:new Date().toISOString()};
  await writeFile(path.join(target,"ci-receipt.json"),JSON.stringify(final,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({outcome:final.outcome,phase:receipt.phase,ownedCiDatabaseDropped:receipt.ownedCiDatabaseDropped,failureCode:receipt.failureCode}));
 }
 if(failure)process.exitCode=1;
 return result;
}
