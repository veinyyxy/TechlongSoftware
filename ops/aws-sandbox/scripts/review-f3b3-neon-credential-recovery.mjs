// Separate recovery; old bootstrap/binding/consumed slot are never modified or replayed.
import { Client } from "pg";
import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, DescribeSecretCommand, GetSecretValueCommand, GetResourcePolicyCommand, ListSecretVersionIdsCommand } from "@aws-sdk/client-secrets-manager";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readSealedControlRoleStateV1 } from "../../../lib/deployments/execution/sealed-control-role-management-v1.ts";
import { validateControlCredentialManifestV1, inspectControlCredentialBootstrapV1, controlCredentialTagsV1 } from "../../../lib/deployments/execution/control-credential-bootstrap-v1.ts";
import { compileNeonCredentialRecoveryV1, validateNeonCredentialRecoveryV1, runNeonCredentialRecoveryV1,
  assertNeonCredentialProviderV1, safeNeonCredentialFailureV1, NEON_CREDENTIAL_RECOVERY_SCOPE_V1 } from "../../../lib/deployments/execution/control-credential-neon-recovery-v1.ts";

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith("--")||!args[i+1]||options[args[i]])throw new Error("RECOVERY_ARGUMENTS_INVALID");options[args[i]]=args[i+1];}
const mode=options["--mode"],allowed=mode==="Review"?["--mode","--out"]:mode==="Run"?["--mode","--out","--manifest","--approved-sha"]:["--mode","--out","--manifest"];
if(!["Review","Run","Inspect"].includes(mode)||canonicalJson(Object.keys(options).sort())!==canonicalJson(allowed.sort()))throw new Error("RECOVERY_ARGUMENTS_INVALID");
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=path.resolve("F:/ChatGPT_workshop"),out=path.resolve(options["--out"]);
const bounded=v=>path.dirname(v).toLowerCase()===privateRoot.toLowerCase()&&/^techlong-f3b3-neon-credential-recovery-[a-z0-9-]+$/.test(path.basename(v));
if(!bounded(out))throw new Error("RECOVERY_FRESH_PRIVATE_OUTPUT_REQUIRED");
const oldSlot=path.join(privateRoot,"techlong-f3b3-control-credentials-v1-consumed");
const slot=path.join(privateRoot,NEON_CREDENTIAL_RECOVERY_SCOPE_V1.permanentSlot);
const originalSha="85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54";
const originalFileSha="f8cf6afa721e504715d1645019849be61a1066b43672f6eca8e69f18f077b481";
const priorSubmissionFileSha256="3096211ad3a9edc0621c0ef8f6abab677e2ebf5685f034ec8205cebdfe6fe0fb";
const pinnedArns=["arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-cleanup-readonly-v3-AWZoLG",
 "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-drain-control-QDFwQ9"];
let stage="VERIFY_ORIGINAL_CONSUMED_BINDING",slotConsumed=false;
try{
 const bootstrapBytes=await readFile(path.join(oldSlot,"approved-manifest.json"),"utf8");
 if(await sha256Hex(bootstrapBytes)!==originalFileSha)throw new Error("RECOVERY_ORIGINAL_FILE_DRIFT");
 const bootstrap=JSON.parse(bootstrapBytes);
 if(bootstrap.manifestSha256!==originalSha||canonicalJson(bootstrap.secretVersionIds)!==canonicalJson([
  "3f8047d4-e357-4d32-ae87-861fda5f8253","72eb93b3-1da0-40a2-a5a1-176e6869ae98"]))throw new Error("RECOVERY_ORIGINAL_APPROVAL_DRIFT");
 const prior=await readFile(path.join(privateRoot,"techlong-f3b3-control-credentials-20261008-c3-run/submission-receipt.json"),"utf8");
 if(await sha256Hex(prior)!==priorSubmissionFileSha256)throw new Error("RECOVERY_PRIOR_RECEIPT_DRIFT");
 const submission=JSON.parse(prior);
 if(!submission.slotConsumed||submission.commitConfirmed||!submission.commitAttempted||submission.failureStage!=="DATABASE_COMMIT"||
  submission.outcome!=="CREDENTIAL_COMMIT_UNKNOWN_INSPECT_ONLY"||submission.secretConfirmed?.length!==2||
  submission.secretConfirmed.some((s,i)=>s.arn!==pinnedArns[i]||s.name!==bootstrap.scope.secretNames[i]||s.versionId!==bootstrap.secretVersionIds[i]))
  throw new Error("RECOVERY_PRIOR_PARTIAL_STATE_REQUIRED");
 for(let i=0;i<2;i++){
  const marker=JSON.parse(await readFile(path.join(oldSlot,`secret-${i+1}-confirmed.json`),"utf8"));
  if(canonicalJson(marker)!==canonicalJson(submission.secretConfirmed[i]))throw new Error("RECOVERY_ORIGINAL_MARKER_DRIFT");
 }
 const loginAttempt=JSON.parse(await readFile(path.join(oldSlot,"login-attempt.json"),"utf8"));
 if(loginAttempt.manifestSha256!==originalSha||canonicalJson(loginAttempt.roles)!==canonicalJson(bootstrap.scope.roles))throw new Error("RECOVERY_ORIGINAL_LOGIN_MARKER_DRIFT");
 const url=new URL(process.env.DATABASE_URL??""),user=decodeURIComponent(url.username),database=decodeURIComponent(url.pathname.slice(1));
 const endpoint={host:url.hostname,database,port:5432};
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.password||(url.port&&url.port!=="5432")||url.hash||
  !["require","verify-full"].includes(url.searchParams.get("sslmode"))||[...url.searchParams.keys()].some(k=>!["sslmode","channel_binding"].includes(k)))
  throw new Error("RECOVERY_MANAGER_TLS_TARGET_INVALID");
 const oldFiles=["ops/aws-sandbox/scripts/review-f3b3-control-credentials.mjs","lib/deployments/execution/control-credential-bootstrap-v1.ts",
  "lib/deployments/execution/control-credential-material-v1.ts","lib/deployments/execution/sealed-control-role-management-v1.ts",
  "lib/deployments/execution/sealed-plan-management-v1.ts","lib/deployments/execution/sealed-plan-catalog-read-v1.ts","lib/deployments/execution/hash.ts","package.json","package-lock.json"];
 const hashFiles=async files=>{const hashes=[];for(const file of files)hashes.push({file,sha256:await sha256Hex((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n"))});return sha256Hex(hashes);};
 const bootstrapBinding={targetFingerprintSha256:await sha256Hex({protocol:"neon-sealed-management-target-v1",host:url.hostname,port:5432,database,user}),
  codeSha256:await hashFiles(oldFiles),certificateSha256:"dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f"};
 if(bootstrapBinding.targetFingerprintSha256!=="06e1188c19fe0c8552bd398f192d7489ccae48498216fcd532344d07720cadab"||
  bootstrapBinding.codeSha256!=="3ec561f34c95cf2f80e6ba8a6cebf5572c26d5eeeac28f598d00593960b084c0")throw new Error("RECOVERY_ORIGINAL_CODE_OR_TARGET_DRIFT");
 const binding={...bootstrapBinding,codeSha256:await hashFiles([...oldFiles,"lib/deployments/execution/control-credential-neon-recovery-v1.ts",
  "ops/aws-sandbox/scripts/review-f3b3-neon-credential-recovery.mjs"])};
 const roleSql=(await readFile(path.join(root,"ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql"),"utf8")).replace(/\r\n/g,"\n");
 await validateControlCredentialManifestV1(bootstrap,bootstrapBinding,roleSql,endpoint);
 let occupied=true;try{await lstat(slot);}catch(error){if(error.code==="ENOENT")occupied=false;else throw error;}
 if(mode!=="Inspect"&&occupied)throw new Error("RECOVERY_PERMANENT_SLOT_OCCUPIED_INSPECT_ONLY");
 const connect=async(databaseUrl)=>{
  const target=databaseUrl?new URL(databaseUrl):url;
  if(target.hostname!==endpoint.host||decodeURIComponent(target.pathname.slice(1))!==database||(target.port&&target.port!=="5432"))throw new Error("RECOVERY_AUTH_TARGET_MISMATCH");
  const c=new Client({host:target.hostname,port:5432,user:decodeURIComponent(target.username),password:decodeURIComponent(target.password),database,
   ssl:{rejectUnauthorized:true,servername:target.hostname},enableChannelBinding:true,connectionTimeoutMillis:10000,statement_timeout:30000,query_timeout:35000,
   application_name:"techlong-neon-control-recovery-v1"});c.on("error",()=>undefined);
  try{await c.connect();return c;}catch{await c.end().catch(()=>undefined);throw new Error("RECOVERY_DB_CONNECTION_UNVERIFIED");}
 };
 const readProviderInTransaction=async c=>{
  const p=(await c.query("SELECT current_setting('neon.forward_ddl') AS forward_ddl,current_setting('password_encryption') AS password_encryption,current_setting('server_version_num')::int AS version,(extract(epoch FROM transaction_timestamp())*1000)::bigint AS observed_at")).rows[0];
  const result={forwardDdl:p.forward_ddl,passwordEncryption:p.password_encryption,postgresVersion:p.version,observedAt:Number(p.observed_at)};
  assertNeonCredentialProviderV1(result);return result;
 };
 const readonly=async build=>{const c=await connect();try{
  await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;SET LOCAL search_path=pg_catalog");const result=await build(c);await c.query("COMMIT");return result;
 }finally{await c.end().catch(()=>undefined);}};
 const readDb=()=>readonly(async c=>{
  const r=await readSealedControlRoleStateV1(c);
  if(r.state.preserved.sealed.identity.role!==user||r.state.preserved.sealed.identity.database!==database)throw new Error("RECOVERY_DB_IDENTITY_UNVERIFIED");return r;
 });
 const readProvider=()=>readonly(readProviderInTransaction);
 const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1};
 const login=fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config});
 const sourceClient=async()=>{
  const credentials=await login(),identity=await new STSClient({...config,credentials}).send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(30000)});
  if(identity.Account!=="402010193138"||identity.Arn!=="arn:aws:iam::402010193138:user/techlong-sandbox-dev")throw new Error("RECOVERY_SOURCE_IDENTITY_UNVERIFIED");
  return new SecretsManagerClient({...config,credentials});
 };
 const readOwnSecret=async(index)=>{
  const client=await sourceClient(),arn=pinnedArns[index],name=bootstrap.scope.secretNames[index],versionId=bootstrap.secretVersionIds[index];
  const call=command=>client.send(command,{abortSignal:AbortSignal.timeout(30000)});
  const d=await call(new DescribeSecretCommand({SecretId:arn}));
  if(d.ARN!==arn||d.Name!==name||d.DeletedDate||d.RotationEnabled||d.RotationLambdaARN||d.RotationRules||d.ReplicationStatus?.length||
   (d.PrimaryRegion&&d.PrimaryRegion!=="ca-central-1")||d.KmsKeyId||d.OwningService||d.Type||d.ExternalSecretRotationRoleArn||d.ExternalSecretRotationMetadata?.length||
   canonicalJson(d.VersionIdsToStages)!==canonicalJson({[versionId]:["AWSCURRENT"]})||
   canonicalJson([...(d.Tags??[])].sort((a,b)=>a.Key.localeCompare(b.Key)))!==canonicalJson(controlCredentialTagsV1(bootstrap)))throw new Error("RECOVERY_SECRET_METADATA_DRIFT_NO_VALUE_READ");
  const policy=await call(new GetResourcePolicyCommand({SecretId:arn}));
  if(policy.ARN!==arn||policy.Name!==name||policy.ResourcePolicy)throw new Error("RECOVERY_RESOURCE_POLICY_DRIFT_NO_VALUE_READ");
  const versions=await call(new ListSecretVersionIdsCommand({SecretId:arn,IncludeDeprecated:true,MaxResults:100}));
  if(versions.ARN!==arn||versions.Name!==name||versions.NextToken||versions.Versions?.length!==1||versions.Versions[0].VersionId!==versionId||
   canonicalJson(versions.Versions[0].VersionStages)!=='["AWSCURRENT"]')throw new Error("RECOVERY_ALL_VERSIONS_DRIFT_NO_VALUE_READ");
  const v=await call(new GetSecretValueCommand({SecretId:arn,VersionId:versionId,VersionStage:"AWSCURRENT"}));
  if(v.ARN!==arn||v.Name!==name||v.VersionId!==versionId||canonicalJson(v.VersionStages)!=='["AWSCURRENT"]'||typeof v.SecretString!=="string"||v.SecretBinary)
   throw new Error("RECOVERY_PINNED_VALUE_UNVERIFIED");
  return {name,arn,versionId,stages:v.VersionStages,tags:d.Tags,onlyInitialVersion:true,rotationDisabled:true,noReplicaOrResourcePolicy:true,secretString:v.SecretString};
 };
 const readExistingSecrets=async()=>{const secrets=[];for(let i=0;i<2;i++)secrets.push(await readOwnSecret(i));return {secrets,observedAt:Date.now()};};
 const authenticate=async(role,databaseUrl)=>{const c=await connect(databaseUrl);try{
  await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;SET LOCAL search_path=pg_catalog");
  const r=(await c.query("SELECT current_user AS role,session_user AS session_role,current_database() AS database,current_setting('transaction_read_only') AS read_only,current_setting('default_transaction_read_only') AS default_read_only,current_setting('server_version_num')::int AS version")).rows[0];
  if(r.role!==role||r.session_role!==role||r.database!==database||r.read_only!=="on"||r.version!==180006||r.default_read_only!==(role===bootstrap.scope.roles[0]?"on":"off"))
   throw new Error("RECOVERY_RESTRICTED_AUTH_IDENTITY_UNVERIFIED");await c.query("COMMIT");
 }finally{await c.end().catch(()=>undefined);}};
 const validation={binding,bootstrapBinding,roleSql,endpoint,priorSubmissionFileSha256};
 await mkdir(out);const save=async(name,value)=>{const bytes=JSON.stringify(value,null,2)+"\n";await writeFile(path.join(out,name),bytes,{flag:"wx"});return sha256Hex(bytes);};
 if(mode==="Review"){
  stage="READONLY_RECOVERY_REVIEW";const start=Date.now(),read=await readDb(),provider=await readProvider(),secrets=await readExistingSecrets();
  const m=await compileNeonCredentialRecoveryV1({...validation,bootstrap,read,provider,secrets,startedAt:start,now:Date.now()});
  const fileSha256=await save("review-manifest.json",m);
  await save("read-only-observation.json",{...read,privatePreimage:undefined,provider,secrets:m.secrets,secretValuesPersisted:false,
   originalManifestFileSha256:originalFileSha,priorSubmissionFileSha256,binding,mutationPerformed:false,runtimeEnabled:false});
  console.log(JSON.stringify({mode,out,manifestSha256:m.manifestSha256,fileSha256,codeSha256:binding.codeSha256,expiresAt:new Date(m.expiresAt).toISOString(),
   secretValuesRead:true,passwordsGenerated:false,secretWrites:0,databaseWrites:0,approvalRequired:true,runtimeEnabled:false}));
 }else{
  const file=path.resolve(options["--manifest"]);if(path.basename(file)!=="review-manifest.json"||!bounded(path.dirname(file)))throw new Error("RECOVERY_PRIVATE_MANIFEST_REQUIRED");
  const manifest=JSON.parse(await readFile(file,"utf8"));await validateNeonCredentialRecoveryV1(manifest,validation);
  if(canonicalJson(manifest.bootstrap)!==canonicalJson(bootstrap)||manifest.secrets.some((s,i)=>s.arn!==pinnedArns[i]))throw new Error("RECOVERY_ORIGINAL_PINS_DRIFT");
  if(mode==="Inspect"&&occupied){const approved=JSON.parse(await readFile(path.join(slot,"approved-manifest.json"),"utf8"));
   if(canonicalJson(approved)!==canonicalJson(manifest))throw new Error("RECOVERY_SLOT_APPROVAL_DRIFT");}
  if(mode==="Run"){
   stage="APPROVED_SINGLE_RECOVERY";const result=await runNeonCredentialRecoveryV1({...validation,manifest,approvedSha:options["--approved-sha"],ports:{
    now:Date.now,readDb,readProvider,readExistingSecrets,openDb:()=>connect(),verifyProviderInTransaction:readProviderInTransaction,
    claimSlot:()=>mkdir(slot),saveMarker:async(name,value)=>writeFile(path.join(slot,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"})}});
   slotConsumed=result.slotConsumed;await save("submission-receipt.json",result);console.log(JSON.stringify({mode,out,...result}));
   if(!result.commitConfirmed)process.exitCode=1;
  }
  stage="INDEPENDENT_READONLY_INSPECT";
  const inspect=await inspectControlCredentialBootstrapV1({manifest:bootstrap,binding:bootstrapBinding,roleSql,endpoint,now:Date.now,readDb,readOwnSecret,authenticate});
  const fileSha256=await save("independent-inspect.json",{...inspect,recoveryManifestSha256:manifest.manifestSha256});
  console.log(JSON.stringify({mode:"IndependentInspect",out,fileSha256,outcome:inspect.outcome,credentialReady:inspect.credentialReady,runtimeEnabled:false}));
  if(!inspect.credentialReady)process.exitCode=1;
 }
}catch(error){console.error(JSON.stringify({outcome:"NEON_RECOVERY_NOT_VERIFIED",stage,slotConsumed,failure:safeNeonCredentialFailureV1(error),
 noWriteRetry:true,secretValuesAndSqlWithheld:true,runtimeEnabled:false}));process.exitCode=1;}
