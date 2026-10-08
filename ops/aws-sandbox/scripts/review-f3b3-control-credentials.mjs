// Separate approval entry. Review never generates passwords, reads SecretString, or mutates PostgreSQL/AWS.
import { Client } from "pg";
import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, DescribeSecretCommand, CreateSecretCommand, GetSecretValueCommand, GetResourcePolicyCommand, ListSecretVersionIdsCommand } from "@aws-sdk/client-secrets-manager";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readSealedControlRoleStateV1, verifyControlRolePoststateV1 } from "../../../lib/deployments/execution/sealed-control-role-management-v1.ts";
import { CONTROL_CREDENTIAL_ROLES_V1, CONTROL_CREDENTIAL_SECRET_NAMES_V1 } from "../../../lib/deployments/execution/control-credential-material-v1.ts";
import { compileControlCredentialReviewV1, validateControlCredentialManifestV1, runControlCredentialBootstrapV1,
 inspectControlCredentialBootstrapV1 } from "../../../lib/deployments/execution/control-credential-bootstrap-v1.ts";

const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith("--")||!args[i+1]||options[args[i]])throw new Error("CREDENTIAL_ARGUMENTS_INVALID");options[args[i]]=args[i+1];}
const mode=options["--mode"],allowed=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||canonicalJson(Object.keys(options).sort())!==canonicalJson(allowed.sort()))throw new Error("CREDENTIAL_ARGUMENTS_INVALID");
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=path.resolve("F:/ChatGPT_workshop"),out=path.resolve(options["--out"]);
const bounded=v=>path.dirname(v).toLowerCase()===privateRoot.toLowerCase()&&/^techlong-f3b3-control-credentials-[a-z0-9-]+$/.test(path.basename(v));
if(!bounded(out))throw new Error("CREDENTIAL_PRIVATE_OUTPUT_REQUIRED");
const slot=path.join(privateRoot,"techlong-f3b3-control-credentials-v1-consumed");
let stage="LOCAL_BINDING";
try{
 const url=new URL(process.env.DATABASE_URL??"");
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||!url.username||!url.password||
  (url.port&&url.port!=="5432")||!/^\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.hash||
  !["require","verify-full"].includes(url.searchParams.get("sslmode"))||[...url.searchParams.keys()].some(k=>!["sslmode","channel_binding"].includes(k)))throw new Error("CREDENTIAL_NEON_TLS_TARGET_REQUIRED");
 const user=decodeURIComponent(url.username),database=decodeURIComponent(url.pathname.slice(1)),endpoint={host:url.hostname,database,port:5432};
 const priorBytes=await readFile(path.join(privateRoot,"techlong-f3b3-control-roles-v1-consumed/approved-manifest.json"),"utf8");
 if(await sha256Hex(priorBytes)!=="551c2c95e1d762ff9a0f73d4c28590c8d1b4dbb7106f20eac89c265db5688a1b")throw new Error("PRIOR_ROLE_APPROVAL_BYTES_DRIFT");
 const roleReview=JSON.parse(priorBytes);
 if(roleReview.manifestSha256!=="4ef39a5995c8a0d394e1cbb72b2c3e51d8588bd86e8b75e3d6287ba138171cac")throw new Error("PRIOR_ROLE_APPROVAL_DRIFT");
 const files=["ops/aws-sandbox/scripts/review-f3b3-control-credentials.mjs","lib/deployments/execution/control-credential-bootstrap-v1.ts",
  "lib/deployments/execution/control-credential-material-v1.ts","lib/deployments/execution/sealed-control-role-management-v1.ts",
  "lib/deployments/execution/sealed-plan-management-v1.ts","lib/deployments/execution/sealed-plan-catalog-read-v1.ts","lib/deployments/execution/hash.ts",
  "package.json","package-lock.json"];
 const hashes=[];for(const file of files)hashes.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});
 const binding={targetFingerprintSha256:await sha256Hex({protocol:"neon-sealed-management-target-v1",host:url.hostname,port:5432,database,user}),
  codeSha256:await sha256Hex(hashes),certificateSha256:"dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f"};
 const roleSql=(await readFile(path.join(root,"ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql"),"utf8")).replace(/\r\n/g,"\n");
 let occupied=true;try{await lstat(slot);}catch(error){if(error.code==="ENOENT")occupied=false;else throw new Error("CREDENTIAL_SLOT_NOT_VERIFIED");}
 if(mode!=="Inspect"&&occupied)throw new Error("CREDENTIAL_SLOT_OCCUPIED_INSPECT_ONLY");
 const connect=async(databaseUrl)=>{
  const target=databaseUrl?new URL(databaseUrl):url;
  if(target.hostname!==endpoint.host||decodeURIComponent(target.pathname.slice(1))!==database||(target.port&&target.port!=="5432"))throw new Error("CREDENTIAL_AUTH_TARGET_MISMATCH");
  const c=new Client({host:target.hostname,port:5432,user:decodeURIComponent(target.username),password:decodeURIComponent(target.password),database,
   ssl:{rejectUnauthorized:true,servername:target.hostname},enableChannelBinding:true,connectionTimeoutMillis:10000,statement_timeout:30000,query_timeout:35000,
   application_name:"techlong-control-credentials-v1"});c.on("error",()=>undefined);
  try{await c.connect();return c;}catch{await c.end().catch(()=>undefined);throw new Error("CREDENTIAL_DB_CONNECTION_NOT_VERIFIED");}
 };
 const readDb=async()=>{const c=await connect();try{
  await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;SET LOCAL search_path=pg_catalog");const read=await readSealedControlRoleStateV1(c);
  if(read.state.preserved.sealed.identity.role!==user||read.state.preserved.sealed.identity.database!==database)throw new Error("CREDENTIAL_DB_IDENTITY_MISMATCH");
  await c.query("COMMIT");return read;
 }finally{await c.end().catch(()=>undefined);}};
 const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1};
 const login=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config});
 const sourceClients=async()=>{
  // Each operation pins a credential object and verifies STS with that same object; no fallback identity or SDK write retries.
  const credentials=await login(),sts=new STSClient({...config,credentials});
  const identity=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
  if(identity.Account!=="402010193138"||identity.Arn!=="arn:aws:iam::402010193138:user/techlong-sandbox-dev")throw new Error("CREDENTIAL_SOURCE_IDENTITY_NOT_VERIFIED");
  return new SecretsManagerClient({...config,credentials});
 };
 const describe=async(client,name)=>{try{return await client.send(new DescribeSecretCommand({SecretId:name}),{abortSignal:AbortSignal.timeout(30000)});}
  catch(error){if(error.name==="ResourceNotFoundException")return null;throw new Error("CREDENTIAL_SECRET_METADATA_NOT_VERIFIED");}};
 const readAwsAbsent=async()=>{const client=await sourceClients(),secrets=[];
  for(const name of CONTROL_CREDENTIAL_SECRET_NAMES_V1){if(await describe(client,name))throw new Error("CREDENTIAL_SECRET_ALREADY_PRESENT");secrets.push({name,state:"ABSENT"});}
  return {account:"402010193138",arn:"arn:aws:iam::402010193138:user/techlong-sandbox-dev",secrets,observedAt:Date.now()};
 };
 const readOwnSecret=async(index,m)=>{
  const name=CONTROL_CREDENTIAL_SECRET_NAMES_V1[index],client=await sourceClients(),d=await describe(client,name);if(!d)return null;
  const expectedTags=[{Key:"ApprovalSha256",Value:m.manifestSha256},{Key:"Environment",Value:"sandbox"},{Key:"Project",Value:"Techlong"},{Key:"Purpose",Value:"control-credential-bootstrap-v1"}];
  if(d.Name!==name||!new RegExp(`^arn:aws:secretsmanager:ca-central-1:402010193138:secret:${name}-[A-Za-z0-9]{6}$`).test(d.ARN??"")||d.DeletedDate||
   d.RotationEnabled||d.RotationLambdaARN||d.RotationRules||d.ReplicationStatus?.length||d.PrimaryRegion||d.KmsKeyId||d.OwningService||d.Type||
   d.ExternalSecretRotationRoleArn||d.ExternalSecretRotationMetadata?.length||
   canonicalJson(d.VersionIdsToStages)!==canonicalJson({[m.secretVersionIds[index]]:["AWSCURRENT"]})||
   canonicalJson([...(d.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)))!==canonicalJson(expectedTags))throw new Error("CREDENTIAL_OWN_METADATA_MISMATCH_NO_VALUE_READ");
  const policy=await client.send(new GetResourcePolicyCommand({SecretId:d.ARN}),{abortSignal:AbortSignal.timeout(30000)});
  if(policy.ARN!==d.ARN||policy.Name!==name||policy.ResourcePolicy)throw new Error("CREDENTIAL_RESOURCE_POLICY_UNVERIFIED_NO_VALUE_READ");
  // DescribeSecret omits unlabeled/deprecated versions: enumerate those too before claiming an initial-only secret.
  const versions=await client.send(new ListSecretVersionIdsCommand({SecretId:d.ARN,IncludeDeprecated:true,MaxResults:100}),{abortSignal:AbortSignal.timeout(30000)});
  if(versions.ARN!==d.ARN||versions.Name!==name||versions.NextToken||versions.Versions?.length!==1||
    versions.Versions[0].VersionId!==m.secretVersionIds[index]||canonicalJson(versions.Versions[0].VersionStages)!=='["AWSCURRENT"]')throw new Error("CREDENTIAL_ALL_VERSIONS_UNVERIFIED_NO_VALUE_READ");
  const v=await client.send(new GetSecretValueCommand({SecretId:d.ARN,VersionId:m.secretVersionIds[index],VersionStage:"AWSCURRENT"}),{abortSignal:AbortSignal.timeout(30000)});
  if(v.ARN!==d.ARN||v.Name!==name||v.VersionId!==m.secretVersionIds[index]||typeof v.SecretString!=="string"||v.SecretBinary)throw new Error("CREDENTIAL_SECRET_VALUE_UNVERIFIED");
  return {name,arn:d.ARN,versionId:v.VersionId,stages:v.VersionStages,tags:d.Tags,onlyInitialVersion:true,rotationDisabled:true,noReplicaOrResourcePolicy:true,secretString:v.SecretString};
 };
 const authenticate=async(role,databaseUrl)=>{const c=await connect(databaseUrl);try{
  await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;SET LOCAL search_path=pg_catalog");
  const r=(await c.query("SELECT current_user AS role,session_user AS session_role,current_database() AS database,current_setting('transaction_read_only') AS read_only,current_setting('default_transaction_read_only') AS default_read_only,current_setting('server_version_num')::int AS version")).rows;
  if(r.length!==1||r[0].role!==role||r[0].session_role!==role||r[0].database!==database||r[0].read_only!=="on"||r[0].version!==180006||
   r[0].default_read_only!==(role===CONTROL_CREDENTIAL_ROLES_V1[0]?"on":"off"))throw new Error("CREDENTIAL_AUTHENTICATION_IDENTITY_UNVERIFIED");await c.query("COMMIT");
 }finally{await c.end().catch(()=>undefined);}};
 await mkdir(out);const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),bytes,{flag:"wx"});return sha256Hex(bytes);};
 if(mode==="Review"){
  stage="READONLY_REVIEW";
  const feed=await fetch("https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ca-central-1/index.json",{redirect:"error",signal:AbortSignal.timeout(30000)});
  if(!feed.ok)throw new Error("CREDENTIAL_REGION_PRICE_UNVERIFIED");const raw=await feed.text();if(raw.length>10000000)throw new Error("CREDENTIAL_PRICE_TOO_LARGE");
  const prices=JSON.parse(raw),dimensions=[];
  for(const [sku,p] of Object.entries(prices.products)){if(p.attributes.regionCode!=="ca-central-1")continue;
   for(const t of Object.values(prices.terms.OnDemand?.[sku]??{}))for(const d of Object.values(t.priceDimensions))dimensions.push({unit:d.unit,usd:Number(d.pricePerUnit.USD),description:d.description});}
  if(!dimensions.some(d=>d.usd===0.4&&/secret/i.test(d.description))||!dimensions.some(d=>d.usd===0.000005&&/API/i.test(d.description)))throw new Error("CREDENTIAL_PRICING_DIMENSIONS_CHANGED");
  await writeFile(path.join(out,"public-secret-price-feed.json"),raw,{flag:"wx"});
  const price={region:"ca-central-1",currency:"USD",perSecretMonthUsd:0.4,perApiCallUsd:0.000005,publicFeedSha256:await sha256Hex(raw)};
  const start=Date.now(),read=await readDb(),aws=await readAwsAbsent();await verifyControlRolePoststateV1(read,roleReview);
  if(read.stateSha256!=="1528e1e2888bb191200d8bc2224318512cfa63f5aaa138eb324870674f3fe0ef")throw new Error("INSTALLED_NOLOGIN_STATE_DRIFT");
  const manifest=await compileControlCredentialReviewV1({binding,roleReview,roleSql,read,aws,endpoint,secretVersionIds:[randomUUID(),randomUUID()],price,startedAt:start,now:Date.now()});
  await save("read-only-observation.json",{...read,privatePreimage:undefined,aws,binding});const fileSha256=await save("review-manifest.json",manifest);
  console.log(JSON.stringify({mode,out,manifestSha256:manifest.manifestSha256,fileSha256,expiresAt:new Date(manifest.expiresAt).toISOString(),
   secretMonthlyBaseUsd:0.8,perApiCallUsd:0.000005,passwordsGenerated:false,secretValuesRead:false,neonMutationPerformed:false,awsMutationPerformed:false,runtimeEnabled:false}));
 }else{
  const file=path.resolve(options["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!bounded(path.dirname(file)))throw new Error("CREDENTIAL_PRIVATE_MANIFEST_REQUIRED");
  const manifest=JSON.parse(await readFile(file,"utf8"));await validateControlCredentialManifestV1(manifest,binding,roleSql,endpoint);
  if(mode==="Inspect"){
   if(!occupied)throw new Error("CREDENTIAL_SLOT_NOT_CONSUMED_NO_VALUE_READ");const approved=JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8"));
   if(canonicalJson(approved)!==canonicalJson(manifest))throw new Error("CREDENTIAL_SLOT_APPROVAL_MISMATCH");
  }
  if(mode==="Run"){
   stage="APPROVED_RUN";
   const result=await runControlCredentialBootstrapV1({manifest,approvedSha:options["--approved-sha"],binding,roleSql,endpoint,ports:{now:Date.now,readDb,readAwsAbsent,
    createSecret:async request=>{const client=await sourceClients();const r=await client.send(new CreateSecretCommand(request),{abortSignal:AbortSignal.timeout(30000)});return {ARN:r.ARN,Name:r.Name,VersionId:r.VersionId};},
    readSecret:async(i,m)=>{const read=await readOwnSecret(i,m);if(!read)throw new Error("CREDENTIAL_CREATED_SECRET_NOT_FOUND");return read;},openDb:()=>connect(),
    claimSlot:()=>mkdir(slot),saveMarker:async(name,value)=>{await writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"});}}});
   await save("submission-receipt.json",result);console.log(JSON.stringify({mode,out,...result}));if(!result.commitConfirmed)process.exitCode=1;
   if(!result.slotConsumed)throw new Error("CREDENTIAL_SLOT_NOT_CONSUMED_INSPECT_ONLY");
  }
  stage="INDEPENDENT_READONLY_INSPECT";
  const inspected=await inspectControlCredentialBootstrapV1({manifest,binding,roleSql,endpoint,now:Date.now,readDb,readOwnSecret,authenticate});
  const fileSha256=await save("independent-inspect.json",{...inspected,approvedManifestSha256:manifest.manifestSha256});
  console.log(JSON.stringify({mode:"IndependentInspect",out,fileSha256,outcome:inspected.outcome,credentialReady:inspected.credentialReady,runtimeEnabled:false}));
  if(!inspected.credentialReady)process.exitCode=1;
 }
}catch{
 console.error(JSON.stringify({outcome:"CONTROL_CREDENTIALS_NOT_VERIFIED",stage,noWriteRetry:true,credentialsAndRawDiagnosticsWithheld:true,runtimeEnabled:false}));process.exitCode=1;
}
