import db from './aurora-database-contract-v2.cjs';
import {parseDatabaseBindingV2,buildDatabaseTaskConfigurationV2,type DatabaseBindingV2} from './aurora-database-v2.ts';
import {createAuroraLifecycleTaskV2,type AuroraLifecycleScope} from './aurora-lifecycle-v2.ts';
const ID='a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d';
function fail():never{throw Error('EXPRESS_RUNTIME_V7_CANDIDATE_REJECTED');}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export function buildExpressRuntimeCandidateV7(scope:AuroraLifecycleScope){
  if(Object.keys(scope).sort().join(',')!=='appInstanceId,cellKey,environmentId,productId,workspaceId'||db.digest(scope)!==ID)fail();
  const stem=scope.appInstanceId.toLowerCase().replace(/[^a-z0-9]/g,'').slice(-28);
  const name=`techlong/sandbox/tenant/${stem}_${ID.slice(0,10)}/runtime/g1`;
  const tags={ManagedBy:'techlong-sandbox',SecretSchema:'techlong-runtime-four-key-v2',DatabaseProfile:'express_iam',ResourceGeneration:'1',StableIdentity:ID};
  return freeze({schema:'techlong/express-runtime-candidate/v7',scope:structuredClone(scope),stableIdentity:ID,resourceGeneration:1,
    name,tags,keys:[...db.STABLE_SECRET_KEYS],request:{Name:name,Tags:Object.entries(tags).map(([Key,Value])=>({Key,Value}))},
    usesExistingLifecycleV2Naming:true,kms:'aws-managed-default-no-custom-key',secretArn:null,secretVersionId:null,
    privateMaterialPrepared:false,executionAuthorized:false,runtimeEnabled:false,readyVerified:false});
}
type Candidate=ReturnType<typeof buildExpressRuntimeCandidateV7>;
type Base=Omit<Extract<DatabaseBindingV2,{profile:'express_iam'}>,'runtimeSecret'>;
/** Exact existing-wire compatibility, not authenticated AWS/IAM/runtime proof. */
export function finalizeExpressRuntimeCandidateV7({candidate,metadata:m,base}:{candidate:Candidate;metadata:Record<string,unknown>;base:Base}){
  const expected=buildExpressRuntimeCandidateV7(candidate.scope);
  if(db.canonicalJson(candidate)!==db.canonicalJson(expected)||base.stableIdentity!==ID||base.resourceGeneration!==1||base.profile!=='express_iam'||
    'runtimeSecret' in base||m.Name!==candidate.name||typeof m.ARN!=='string'||
    !new RegExp('^arn:aws:secretsmanager:ca-central-1:402010193138:secret:'+candidate.name+'-[A-Za-z0-9]{6}$').test(m.ARN)||
    m.DeletedDate!==undefined||m.RotationEnabled!==undefined&&m.RotationEnabled!==false||m.KmsKeyId!==undefined&&m.KmsKeyId!=='alias/aws/secretsmanager'||
    ['SecretString','SecretBinary',...db.STABLE_SECRET_KEYS].some(k=>k in m)||!Array.isArray(m.Tags)||
    !m.VersionIdsToStages||typeof m.VersionIdsToStages!=='object'||Array.isArray(m.VersionIdsToStages))fail();
  const tags:Record<string,string>={};
  for(const t of m.Tags){if(!t||typeof t.Key!=='string'||typeof t.Value!=='string'||t.Key in tags)fail();tags[t.Key]=t.Value;}
  const versions=m.VersionIdsToStages as Record<string,unknown>,version=Object.keys(versions)[0];
  if(db.canonicalJson(tags)!==db.canonicalJson(candidate.tags)||Object.keys(versions).length!==1||!/^[A-Za-z0-9-]{32,64}$/.test(version)||
    db.canonicalJson(versions[version])!==db.canonicalJson(['AWSCURRENT']))fail();
  const binding=parseDatabaseBindingV2({...base,runtimeSecret:{arn:m.ARN,versionId:version}});
  if(binding.profile!=='express_iam'||binding.clusterArn!=='arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001'||
    binding.clusterResourceId!=='cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM'||binding.observedEngineVersion!=='17.9'||
    binding.endpoint!=='techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com'||
    binding.tenantDatabase!=='tenant_a0da1748bc4d5419_db'||binding.tenantUsername!=='tenant_a0da1748bc4d5419_role'||
    binding.managementDatabase!=='postgres'||binding.managementUsername!=='postgres'||
    binding.access.applicationRoleArn!=='arn:aws:iam::402010193138:role/TechlongSandboxTaskRole'||
    binding.access.lifecycleRoleArn!=='arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole')fail();
  // Inert task construction exercises the exact shared v2 name/identity rule.
  // No epoch/activation is installed and no executable invocation is emitted.
  createAuroraLifecycleTaskV2({operation:'inspect',scope:candidate.scope,ownerDeploymentId:'c4c-metadata-compatibility-only',binding,epoch:1});
  return freeze({schema:'techlong/express-runtime-binding-candidate/v7',binding,taskConfiguration:buildDatabaseTaskConfigurationV2(binding),
    existingLifecycleV2NameCompatible:true,metadataOnlyNotExecutionAuthority:true,secretValuesRead:false,
    iamPermissionsVerified:false,databaseLoginVerified:false,readyVerified:false,executionAuthorized:false,runtimeEnabled:false});
}
