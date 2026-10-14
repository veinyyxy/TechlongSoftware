import db from './aurora-database-contract-v2.cjs';
import {parseDatabaseBindingV2,buildDatabaseTaskConfigurationV2,type DatabaseBindingV2} from './aurora-database-v2.ts';
const STABLE_IDENTITY='a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d';
function fail():never{throw Error('EXPRESS_RUNTIME_V6_CANDIDATE_REJECTED');}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export function buildExpressSecretCreateCandidateV6(input:{stableIdentity:string;resourceGeneration:number}) {
  if(Object.keys(input).sort().join(',')!=='resourceGeneration,stableIdentity'||input.stableIdentity!==STABLE_IDENTITY||input.resourceGeneration!==1)fail();
  const name=`techlong/sandbox/tenant/${input.stableIdentity.slice(0,16)}/runtime/g${input.resourceGeneration}`;
  const tags={ManagedBy:'techlong-sandbox',SecretSchema:'techlong-runtime-four-key-v2',DatabaseProfile:'express_iam',
    ResourceGeneration:String(input.resourceGeneration),StableIdentity:input.stableIdentity};
  return freeze({schema:'techlong/express-runtime-secret-create-candidate/v6',name,stableIdentity:input.stableIdentity,
    resourceGeneration:input.resourceGeneration,keys:[...db.STABLE_SECRET_KEYS],tags,
    kms:'aws-managed-default-no-custom-key',privateMaterialPrepared:false,clientRequestTokenPrepared:false,
    request:{Name:name,Tags:Object.entries(tags).map(([Key,Value])=>({Key,Value}))},
    executionAuthorized:false,runtimeEnabled:false,secretArn:null,secretVersionId:null});
}
type Candidate=ReturnType<typeof buildExpressSecretCreateCandidateV6>;
type ExpressBase=Omit<Extract<DatabaseBindingV2,{profile:'express_iam'}>,'runtimeSecret'>;
/** Exact metadata-to-binding adapter, not an AWS-authenticated observation.
 * The reviewed future root must supply real metadata and independently verify
 * task roles/permissions. Private material never enters this API or digest.
 */
export function finalizeExpressRuntimeBindingCandidateV6(input:{candidate:Candidate;metadata:Record<string,unknown>;base:ExpressBase}) {
  const {candidate,metadata:m,base}=input;
  const expected=buildExpressSecretCreateCandidateV6({stableIdentity:base.stableIdentity,resourceGeneration:base.resourceGeneration});
  if(db.canonicalJson(candidate)!==db.canonicalJson(expected)||base.profile!=='express_iam'||'runtimeSecret' in base||
    m.Name!==candidate.name||typeof m.ARN!=='string'||!m.ARN.startsWith(`arn:aws:secretsmanager:ca-central-1:402010193138:secret:${candidate.name}-`)||
    !/^[A-Za-z0-9]{6}$/.test(m.ARN.slice(`arn:aws:secretsmanager:ca-central-1:402010193138:secret:${candidate.name}-`.length))||
    m.DeletedDate!==undefined||m.RotationEnabled!==undefined&&m.RotationEnabled!==false||m.KmsKeyId!==undefined&&m.KmsKeyId!=='alias/aws/secretsmanager'||
    ['SecretString','SecretBinary',...db.STABLE_SECRET_KEYS].some(k=>k in m)||!Array.isArray(m.Tags))fail();
  const tags:Record<string,string>={};
  for(const t of m.Tags){if(!t||typeof t.Key!=='string'||typeof t.Value!=='string'||t.Key in tags)fail();tags[t.Key]=t.Value;}
  if(db.canonicalJson(tags)!==db.canonicalJson(candidate.tags)||!m.VersionIdsToStages||typeof m.VersionIdsToStages!=='object'||Array.isArray(m.VersionIdsToStages))fail();
  const versions=m.VersionIdsToStages as Record<string,unknown>,versionId=Object.keys(versions)[0];
  if(Object.keys(versions).length!==1||!/^[A-Za-z0-9-]{32,64}$/.test(versionId)||db.canonicalJson(versions[versionId])!==db.canonicalJson(['AWSCURRENT']))fail();
  const binding=parseDatabaseBindingV2({...base,runtimeSecret:{arn:m.ARN,versionId}});
  if(binding.clusterResourceId!=='cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM'||binding.observedEngineVersion!=='17.9'||
    binding.clusterArn!=='arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001'||
    binding.endpoint!=='techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com'||
    binding.managementDatabase!=='postgres'||binding.managementUsername!=='postgres'||
    binding.tenantDatabase!=='tenant_a0da1748bc4d5419_db'||binding.tenantUsername!=='tenant_a0da1748bc4d5419_role')fail();
  return freeze({schema:'techlong/express-runtime-binding-candidate/v6',binding,
    taskConfiguration:buildDatabaseTaskConfigurationV2(binding),
    metadataDigest:db.digest({arn:m.ARN,name:m.Name,tags,versionId,stages:versions[versionId]}),
    metadataOnlyNotExecutionAuthority:true,secretValuesRead:false,iamPermissionsVerified:false,databaseLoginVerified:false,
    readyVerified:false,executionAuthorized:false,runtimeEnabled:false});
}
