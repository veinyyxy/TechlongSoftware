// SOURCE-bound package only. Original conditional PUT engine is reused intact.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {RECOVERY_SCOPE} from '../platform-recovery-v1/profile.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {K as OLD,hash,assertBucket,assertSourceIdentity,packageUploadRunner} from '../platform-recovery-package-v1/plan.mjs';
import {REQUEST_SOURCE as R} from './request-source.mjs';
export {hash,assertBucket,assertSourceIdentity};
export const must=(v,c)=>{if(!v)throw Error('CYCLE_PACKAGE_'+c);},same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const PROFILE=freeze({...RECOVERY_SCOPE,newJobId:R.target.newJobId,clientRequestId:R.target.clientRequestId,requestId:R.target.requestId,
  stateSha256:'784a22147158686fe15e19abd65ba1f9a172c513b4d7f974e59255c5ac0d88e1',
  factsAt:1793200089592,databaseCheckedAt:1793200101656,observedBy:1793200101656});
const prefix='F:/ChatGPT_workshop/techlong-reviewed-cycle-'+PROFILE.newJobId;
export const T=freeze({bucket:OLD.bucket,owner:OLD.owner,region:OLD.region,sourceArn:OLD.sourceArn,sourceUserId:OLD.sourceUserId,
  validMs:24*3600000,jobId:PROFILE.newJobId,basisSha256:'2cf26916af4f9d8734da18231d2571b23758397c72f1a5566bee5656623d8045',
  packageSha256:'e908e74b0de03ae61a2f36bfe1e9f0423ce3850e341a1a3cdf5f9676553b0700',bytes:403623,rawBytes:605958,
  rawSha256:'969b39fe9d62dd53d9b34ab4dd80b914aad2a50cf5e9e688d61a3bab720bc9ab',
  file:'F:/ChatGPT_workshop/techlong-reviewed-cycle-package-20261028-a/candidate.json',
  cycleId:'ee79cfd6db502930a19afb1d87823cf1a9672a9afb01981f6a361b52146d32fa',
  profileSha256:'e3602b2c4cd7d298c223ed69b0d1ffe4706ef8b2c13fa4bdd96911423f46763d',
  basisExpiresAt:PROFILE.factsAt+PROFILE.validMs,originalPackageBasisExpiresAt:1793282784483,
  preparationEarliestAt:1793194938110,preparationExpiresAt:1793212938110,
  slot:prefix+'-package-upload.intent.json',inspectSlot:prefix+'-package-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-reviewed-cycle-package-upload.md',
  closureSha256:'0c6f119def3b10efe592f559b29d4d8f929893a28dbc77a065c2746052aa308d',
  readiness:[
    {file:'F:/ChatGPT_workshop/techlong-reviewed-cycle-package-20261028-a/verified.json',rawSha256:'056168741efc03aa93bf528e455f5b0aa6223aa40f0fa5366d4ff4266f71f84a'},
    {file:'F:/ChatGPT_workshop/techlong-reviewed-cycle-history-fix-verified-20261028-a.json',rawSha256:'14ce5f3744cab426296719fcb163f1dd38579da2bf88f595a89d65a8d5b32247'},
    {file:'F:/ChatGPT_workshop/techlong-reviewed-cycle-package-20261028-a/source-candidate.json',rawSha256:'2ca3b95c6749a624341a174030550c4052843bfa446877b03cada466cdb411f0'},
    {file:'F:/ChatGPT_workshop/techlong-reviewed-cycle-package-20261028-a/result.json',rawSha256:'d234b52eb8f41c7c1ee3de3cf621c00329b378429cfda072f47d3412471bce8e'}]});
export const packageKey=()=>`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-${T.basisSha256}.json`;
export const checksum=()=>Buffer.from(T.packageSha256,'hex').toString('base64');
export async function makeReview({sourceCommit,pins,ci,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&Number.isSafeInteger(createdAt)&&createdAt>=PROFILE.observedBy&&
    createdAt>=T.preparationEarliestAt&&createdAt<T.preparationExpiresAt&&
    ci?.sourceCommit===sourceCommit&&ci.testedSourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    /^[1-9][0-9]{0,15}$/.test(ci.runId)&&/^[1-9][0-9]{0,15}$/.test(ci.jobId)&&Array.isArray(pins)&&pins.length>=20&&
    new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>typeof p.file==='string'&&!p.file.includes('..')&&!p.file.includes('.env')&&!/\.pem$/.test(p.file)&&/^[a-f0-9]{64}$/.test(p.sha256)),'REVIEW_INPUT');
  must(await sha256Hex(PROFILE)===T.profileSha256,'SOURCE_PROFILE');
  const body={schema:'techlong/reviewed-cycle-package-upload-review/v1',sourceCommit,pins,ci,createdAt,
    expiresAt:Math.min(createdAt+T.validMs,T.basisExpiresAt),permanentSlot:T.slot,inspectSlot:T.inspectSlot,riskFile:T.riskFile,
    package:{file:T.file,rawBytes:T.rawBytes,rawSha256:T.rawSha256,canonicalBytes:T.bytes,sha256:T.packageSha256,basisSha256:T.basisSha256,
      jobId:T.jobId,cycleId:T.cycleId,objectCount:7,candidateWrapperNotUploaded:true,historicalEvidenceNotCurrentDatabaseProof:true},
    readiness:{archives:T.readiness,preparationEarliestAt:T.preparationEarliestAt,preparationExpiresAt:T.preparationExpiresAt,
      historicalFactsSource:'05a1eda2e30526b63c9d9868f6f2171dabd024d2',handoffSource:'a87d2feab7e3f304f1c3f5e07b50c43c506c3658',
      packageSource:'630fcf4188eabcfef1cd7041615309f82683c321',compatibilitySource:'d8c3de1f569cceb756529ec128c94df8631e24f8',
      fullBaselineSha256:'c4d28f90e792b935c4fd3f3b99f80775410d481e0bb15e72f4804cf2da0bea52',
      isHistoricalAtExecution:true,doesNotReplaceFutureWorkerPreflight:true,originalObservedTimesPreserved:true},
    newFacts:{approvalScope:'new-reviewed-cycle-basis-only',profileSha256:T.profileSha256,factsAt:PROFILE.factsAt,
      databaseCheckedAt:PROFILE.databaseCheckedAt,observedBy:PROFILE.observedBy,expiresAt:T.basisExpiresAt,
      originalPackageBasisExpiresAt:T.originalPackageBasisExpiresAt,originalBasisExtended:false,futureRuntimeActivationAuthorized:false},
    put:{Bucket:T.bucket,ExpectedBucketOwner:T.owner,Key:packageKey(),ContentType:'application/json',ContentLength:T.bytes,
      IfNoneMatch:'*',ServerSideEncryption:'AES256',ChecksumSHA256:checksum()},
    requiredPreflight:{notYetObserved:true,region:T.region,versioning:'Enabled',encryption:'AES256',ownership:'BucketOwnerEnforced',
      allFourPublicAccessBlocks:true,policyIsPublic:false,targetHead:'404_WITHOUT_DELETE_MARKER',freshWithinMs:180000,finalReadWithinMs:30000},
    effects:{conditionalPuts:1,sourceStsReads:2,bucketMetadataReads:6,targetHeadReads:2,localCandidateContentReads:1,localReadinessContentReads:4,githubCiGets:3,
      independentSourceStsReads:1,independentFixedVersionGets:1,iamWrites:0,secretValueReads:0,pemReads:0,sqlConnections:0,
      workflowPublications:0,controllerActivations:0,workflowDispatches:0,cellCreates:0,automaticWriteRetries:0},
    risks:{historicalBusinessMetadataUploaded:true,privateBucketDoesNotRemoveIamReaderAccess:true,providerAndAuditLogs:true,
      canonicalizationIsProtocolSpecific:true,headIsCurrentVersionOnly:true,concurrentReadsNotCas:true,unknownPutAcknowledgementMayLeaveBillableObject:true,
      conditionalConflictNeverAutomaticallyRetried:true,noAutomaticDeleteRollbackResetOrReplay:true,sourceLoginMayExpire:true,lowCostNotZero:true},
    laterPublication:{authorized:false,packageVersionId:'from-successful-independent-inspection-only',
      workflowFiles:['.github/workflows/cloud-worker-platform-job-v6.yml','.github/workflows/cloud-worker-platform-v6.yml'],
      cloudClosureSha256:T.closureSha256,trustOnly:true,permissionsExpansion:false},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyReview(m,approved,at,inspect=false){
  must(same(m,await makeReview(m))&&approved===m.manifestSha256,'MANIFEST_OR_APPROVAL');
  if(!inspect)must(Number.isSafeInteger(at)&&at>=m.createdAt&&at<m.expiresAt-120000,'APPROVAL_EXPIRED_OR_TOO_LATE');return m;
}
export function assertAck(a){must(a?.key===packageKey()&&typeof a.versionId==='string'&&/^[A-Za-z0-9._-]{1,256}$/.test(a.versionId)&&
  a.versionId!=='null'&&a.encryption==='AES256'&&a.checksum===checksum(),'PUT_ACK');return {key:a.key,versionId:a.versionId,sha256:T.packageSha256};}
export function createUploadRunner({verifyBody=body=>typeof body==='string'&&Buffer.byteLength(body)===T.bytes&&hash(body)===T.packageSha256}={}){
  return packageUploadRunner({verifyBody,capability:{target:T,verifyReview,assertBucket,assertSourceIdentity,assertAck}});
}
export const uploadOnce=createUploadRunner();
export async function factsApproval(m,approved){await verifyReview(m,approved,m.createdAt);return {state:'APPROVED',manifestSha256:m.manifestSha256,
  profileSha256:m.newFacts.profileSha256,factsAt:m.newFacts.factsAt,databaseCheckedAt:m.newFacts.databaseCheckedAt,
  observedBy:m.newFacts.observedBy,expiresAt:m.newFacts.expiresAt,originalBasisExtended:false};}
