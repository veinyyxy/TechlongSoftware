import { neon } from "@neondatabase/serverless";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { NeonSerializableSnapshotSqlClient } from "./neon-shared-cell-zero-tenant-source.ts";
import type { ReadSerializableSharedCellOwnershipSnapshotInput } from "./shared-cell-zero-tenant-evidence.ts";
import { SEALED_PLAN_CATALOG_READ_V1 } from "./sealed-plan-catalog-read-v1.ts";

const deploymentId="dep_d00144511731f1c20991aa56";
const instanceId="app_fb1962e93a9a4cc2acf046170593d9e3";
const environmentId="env_aws_sandbox_ca_central_1";
const functionBodySha256="16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66";
const digest=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/;
const certificateKeys=["deployment_id","environment_id","app_instance_id","original_row_sha256","original_plan_bytes_sha256",
 "original_plan_hash","business_state_sha256","approved_registration_sha256","protection_schema_sha256","sealed_at"] as const;

export interface SealedPlanCertificateV1 {
 deployment_id: typeof deploymentId;
 environment_id: typeof environmentId;
 app_instance_id: typeof instanceId;
 original_row_sha256:string;
 original_plan_bytes_sha256:string;
 original_plan_hash:string;
 business_state_sha256:string;
 approved_registration_sha256:string;
 protection_schema_sha256:string;
 sealed_at:number;
}
export class SealedCellOwnershipSourceError extends Error {
 readonly code:string;
 constructor(code:string){super(code);this.code=code;}
}
function fail(code:string):never{throw new SealedCellOwnershipSourceError(code);}
function object(v:unknown):Record<string,unknown>{return v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}
function keys(v:unknown,names:readonly string[]){return v!==null&&typeof v==="object"&&!Array.isArray(v)&&canonicalJson(Object.keys(v).sort())===canonicalJson([...names].sort());}
function freeze<T>(v:T):T{if(v!==null&&typeof v==="object"){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function integer(v:unknown){if(typeof v==="string"&&!/^(0|[1-9][0-9]*)$/.test(v))fail("SEALED_SOURCE_INTEGER_INVALID");
 const n=typeof v==="number"?v:typeof v==="string"?Number(v):NaN;if(!Number.isSafeInteger(n)||n<0)fail("SEALED_SOURCE_INTEGER_INVALID");return n;}
function rows(v:unknown){const r=object(v).rows;if(!Array.isArray(r)||r.some(x=>x===null||typeof x!=="object"||Array.isArray(x)))fail("SEALED_SOURCE_ROWS_INVALID");return r as Record<string,unknown>[];}
function orderedIds(v:unknown){const r=rows(v);if(r.length>10000||r.some(x=>!keys(x,["id"])||typeof x.id!=="string"||!id.test(x.id)))fail("SEALED_SOURCE_IDS_INVALID");
 const values=r.map(x=>x.id as string);if(new Set(values).size!==values.length||canonicalJson(values)!==canonicalJson([...values].sort()))fail("SEALED_SOURCE_IDS_INVALID");return values;}
function certificate(raw:unknown):Readonly<SealedPlanCertificateV1>{
 const v=object(JSON.parse(canonicalJson(raw)));
 if(!keys(v,certificateKeys)||v.deployment_id!==deploymentId||v.environment_id!==environmentId||v.app_instance_id!==instanceId||
  certificateKeys.filter(k=>k.endsWith("sha256")||k==="original_plan_hash").some(k=>typeof v[k]!=="string"||!digest.test(v[k] as string))||
  integer(v.sealed_at)<1)fail("SEALED_SOURCE_CERTIFICATE_INVALID");
 return freeze({...v,sealed_at:integer(v.sealed_at)}) as unknown as Readonly<SealedPlanCertificateV1>;
}

const envSql=`SELECT e.id AS environment_id,e.expected_account_id AS account_id,e.region,e.cell_key,e.admission_state,
 e.admission_epoch,e.admission_fence_sha256,e.admission_provision_operation_hash,e.admission_stack_id,e.admission_cell_expires_at,e.admission_changed_at,
 (extract(epoch FROM transaction_timestamp())*1000)::bigint AS observed_at,
 current_user AS reader_role,(SELECT NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls) FROM pg_catalog.pg_roles r WHERE r.rolname=current_user) AS limited_reader,
 (NOT pg_catalog.has_schema_privilege(current_user,'public','CREATE') AND NOT EXISTS(
 SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
 AND (pg_catalog.pg_has_role(current_user,c.relowner,'MEMBER') OR pg_catalog.has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')))) AS no_owner_or_table_write
 FROM public.deployment_environments e WHERE e.id=$1 AND e.kind='aws_sandbox' AND e.driver='aws_ecs_cell' AND e.status='active'`;
const certSql=`SELECT r.deployment_id,r.environment_id,r.app_instance_id,r.original_row_sha256,r.original_plan_bytes_sha256,r.original_plan_hash,
 r.business_state_sha256,r.approved_registration_sha256,r.protection_schema_sha256,r.sealed_at,
 f.sealed AS fence_sealed,f.sealed_at AS fence_sealed_at,f.revision AS fence_revision,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(d)::text,'UTF8')),'hex') AS live_row_sha256,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(d.desired_plan,'UTF8')),'hex') AS live_plan_bytes_sha256,d.plan_hash AS live_plan_hash,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') AS fingerprint_body_sha256,
 (p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::pg_catalog.text[] AND p.prorettype='pg_catalog.text'::pg_catalog.regtype
 AND p.pronargs=0 AND l.lanname='plpgsql' AND NOT pg_catalog.pg_has_role(current_user,p.proowner,'MEMBER')) AS fingerprint_function_safe,
 catalog.live_protection_sha256
 FROM public.deployment_plan_only_isolations r JOIN public.app_instance_deployments d ON d.id=r.deployment_id
 JOIN public.deployment_plan_only_isolation_fences f ON f.deployment_id=r.deployment_id
 JOIN pg_catalog.pg_proc p ON p.oid='public.sealed_plan_protection_hash_v1()'::pg_catalog.regprocedure
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang CROSS JOIN (${SEALED_PLAN_CATALOG_READ_V1}) catalog WHERE r.environment_id=$1`;
export const SEALED_CELL_OWNERSHIP_SQL_V3=Object.freeze({
 searchPath:`SELECT pg_catalog.set_config('search_path','pg_catalog',true) AS search_path`,
 environment:envSql,certificate:certSql,
 active:`SELECT DISTINCT i.id FROM public.app_instances i JOIN public.app_instance_deployments d ON d.app_instance_id=i.id WHERE d.environment_id=$1 AND i.status IN ('pending','active') ORDER BY i.id`,
 associations:`SELECT i.id AS instance_id,d.id AS deployment_id FROM public.app_instances i JOIN public.app_instance_deployments d ON d.app_instance_id=i.id WHERE d.environment_id=$1 AND i.status IN ('pending','active') ORDER BY i.id,d.id`,
 capacity:`SELECT deployment_id AS id FROM public.deployment_environment_capacity_reservations WHERE environment_id=$1 ORDER BY deployment_id`,
 deployments:`SELECT id FROM public.app_instance_deployments WHERE environment_id=$1 AND status NOT IN ('rolled_back','canceled') ORDER BY id`,
 resources:`SELECT app_instance_id AS id FROM public.deployment_tenant_resources WHERE environment_id=$1 AND lifecycle_status<>'destroyed' ORDER BY app_instance_id`,
 schedules:`SELECT id FROM public.deployment_cleanup_schedules WHERE environment_id=$1 AND status NOT IN ('succeeded','canceled') ORDER BY id`,
});

/** Independent uninstalled read protocol. Not structurally a schema2 source. */
export class NeonSealedCellOwnershipSourceV3 {
 private readonly sql:NeonSerializableSnapshotSqlClient;
 private readonly expected:Readonly<SealedPlanCertificateV1>;
 constructor(sql:NeonSerializableSnapshotSqlClient,expectedRegisteredCertificate:SealedPlanCertificateV1){
  if(typeof sql?.transaction!=="function")fail("SEALED_SOURCE_CLIENT_INVALID");
  this.sql=Object.freeze({transaction:sql.transaction.bind(sql)});this.expected=certificate(expectedRegisteredCertificate);
 }
 async readCertifiedSerializableSnapshot(input:ReadSerializableSharedCellOwnershipSnapshotInput){
  if(!keys(input,["accountId","region","cellId","environmentId","signal"])||input.accountId!=="402010193138"||input.region!=="ca-central-1"||
   input.cellId!=="cell-sandbox-1"||input.environmentId!==environmentId||typeof input.signal?.throwIfAborted!=="function")fail("SEALED_SOURCE_INPUT_INVALID");
  input.signal.throwIfAborted();let results:unknown[];
  try{results=await this.sql.transaction(tx=>Object.entries(SEALED_CELL_OWNERSHIP_SQL_V3).map(([kind,statement])=>tx.query(statement,kind==="searchPath"?[]:[environmentId])),
   {isolationLevel:"Serializable",readOnly:true,deferrable:true,fullResults:true,fetchOptions:{signal:input.signal}});
  }catch{input.signal.throwIfAborted();return fail("SEALED_SOURCE_READ_FAILED");}
  input.signal.throwIfAborted();if(!Array.isArray(results)||results.length!==9)fail("SEALED_SOURCE_RESULTS_INVALID");
  const settings=rows(results[0]);if(settings.length!==1||!keys(settings[0],["search_path"])||settings[0].search_path!=="pg_catalog")fail("SEALED_SOURCE_SEARCH_PATH_INVALID");
  results=results.slice(1);
  const environments=rows(results[0]),certificates=rows(results[1]);
  if(environments.length!==1||certificates.length!==1)fail("SEALED_SOURCE_CERTIFICATE_OR_ENVIRONMENT_MISSING");
  const e=environments[0],r=certificates[0];
  if(!keys(e,["environment_id","account_id","region","cell_key","admission_state","admission_epoch","admission_fence_sha256","admission_provision_operation_hash",
   "admission_stack_id","admission_cell_expires_at","admission_changed_at","observed_at","reader_role","limited_reader","no_owner_or_table_write"])||
   e.environment_id!==environmentId||e.account_id!=="402010193138"||e.region!=="ca-central-1"||e.cell_key!=="cell-sandbox-1"||
   e.reader_role!=="techlong_cell_cleanup_reader"||e.limited_reader!==true||e.no_owner_or_table_write!==true||e.admission_state!=="draining"||
   typeof e.admission_fence_sha256!=="string"||!digest.test(e.admission_fence_sha256)||typeof e.admission_provision_operation_hash!=="string"||!digest.test(e.admission_provision_operation_hash)||
   typeof e.admission_stack_id!=="string"||!/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(e.admission_stack_id))fail("SEALED_SOURCE_ENVIRONMENT_OR_READER_INVALID");
  const observed=integer(e.observed_at),expires=integer(e.admission_cell_expires_at),changed=integer(e.admission_changed_at),epoch=integer(e.admission_epoch);
  if(epoch<1||expires<1||changed<expires||observed<changed||observed<this.expected.sealed_at)fail("SEALED_SOURCE_ADMISSION_INVALID");
  if(!keys(r,[...certificateKeys,"fence_sealed","fence_sealed_at","fence_revision","live_row_sha256","live_plan_bytes_sha256","live_plan_hash",
   "fingerprint_body_sha256","fingerprint_function_safe","live_protection_sha256"]))fail("SEALED_SOURCE_CERTIFICATE_FIELDS_INVALID");
  const actual=certificate(Object.fromEntries(certificateKeys.map(k=>[k,r[k]])));
  if(canonicalJson(actual)!==canonicalJson(this.expected)||r.fence_sealed!==true||integer(r.fence_sealed_at)!==actual.sealed_at||integer(r.fence_revision)<1||
   r.live_row_sha256!==actual.original_row_sha256||r.live_plan_bytes_sha256!==actual.original_plan_bytes_sha256||r.live_plan_hash!==actual.original_plan_hash||
   r.fingerprint_body_sha256!==functionBodySha256||r.fingerprint_function_safe!==true||r.live_protection_sha256!==actual.protection_schema_sha256)
   fail("SEALED_SOURCE_CERTIFICATE_OR_PROTECTION_MISMATCH");
  const rawActive=orderedIds(results[2]),associations=rows(results[3]);
  const associationKeys=associations.map(a=>{
   if(!keys(a,["instance_id","deployment_id"])||typeof a.instance_id!=="string"||!id.test(a.instance_id)||typeof a.deployment_id!=="string"||!id.test(a.deployment_id))fail("SEALED_SOURCE_ASSOCIATIONS_INVALID");
   if(a.deployment_id===deploymentId&&a.instance_id!==instanceId)fail("SEALED_SOURCE_ASSOCIATIONS_INVALID");
   return `${a.instance_id}\u0000${a.deployment_id}`;
  });
  if(associationKeys.length>10000||new Set(associationKeys).size!==associationKeys.length||canonicalJson(associationKeys)!==canonicalJson([...associationKeys].sort())||
   canonicalJson([...new Set(associations.map(a=>a.instance_id))].sort())!==canonicalJson(rawActive))fail("SEALED_SOURCE_ASSOCIATIONS_INCOMPLETE");
  const active=rawActive.filter(i=>associations.some(a=>a.instance_id===i&&a.deployment_id!==deploymentId));
  const capacity=orderedIds(results[4]),rawDeployments=orderedIds(results[5]),resources=orderedIds(results[6]),schedules=orderedIds(results[7]);
  if(!rawDeployments.includes(deploymentId))fail("SEALED_SOURCE_ORIGINAL_DEPLOYMENT_NOT_VISIBLE");
  const rawOwnershipWitness={activeTenantIds:rawActive,nonterminalDeploymentIds:rawDeployments,activeTenantDeploymentAssociations:associations};
  const state={schemaVersion:3 as const,protocol:"sealed-cell-ownership-v3" as const,accountId:"402010193138" as const,region:"ca-central-1" as const,
   cellId:"cell-sandbox-1" as const,environmentId,admissionState:"draining" as const,admissionEpoch:epoch,admissionFenceSha256:e.admission_fence_sha256,
   admissionProvisionOperationHash:e.admission_provision_operation_hash,admissionStackId:e.admission_stack_id,admissionCellExpiresAt:expires,admissionChangedAt:changed,
   sealedCertificates:[actual],fingerprintFunctionBodySha256:functionBodySha256,activeTenantIds:active,activeCapacityReservationIds:capacity,
   nonterminalDeploymentIds:rawDeployments.filter(d=>d!==deploymentId),liveTenantResourceIds:resources,nonterminalTenantCleanupScheduleIds:schedules,rawOwnershipWitness};
  const ownershipStateSha256=await sha256Hex(state);input.signal.throwIfAborted();
  return freeze({...state,isolationLevel:"Serializable" as const,readOnly:true as const,deferrable:true as const,dbObservedAt:observed,
   ownershipStateSha256,runtimeActivationAuthorized:false as const});
 }
}
export function createNeonSealedCellOwnershipSourceV3(databaseUrl:string,expected:SealedPlanCertificateV1){
 try{const url=new URL(databaseUrl);
  if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname.endsWith(".neon.tech")||decodeURIComponent(url.username)!=="techlong_cell_cleanup_reader"||
   !url.password||(url.port&&url.port!=="5432")||!["require","verify-full"].includes(url.searchParams.get("sslmode")??""))throw new Error();
  return new NeonSealedCellOwnershipSourceV3(neon(databaseUrl,{fullResults:true}) as unknown as NeonSerializableSnapshotSqlClient,expected);
 }catch{return fail("SEALED_SOURCE_DATABASE_URL_OR_CERTIFICATE_INVALID");}
}
