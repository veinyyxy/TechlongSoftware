// Exact a604 SOURCE capability. A manifest cannot select another package/profile.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {A604_JOB,A604_PROFILE,HANDOFF} from '../platform-a604-cloud-v1/profile.mjs';
import {K as OLD,hash,assertBucket,assertSourceIdentity,packageUploadRunner} from '../platform-recovery-package-v1/plan.mjs';
export {hash,assertBucket,assertSourceIdentity};
export const must=(ok,c)=>{if(!ok)throw Error('A604_PACKAGE_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const K=freeze({bucket:OLD.bucket,owner:OLD.owner,region:OLD.region,sourceArn:OLD.sourceArn,sourceUserId:OLD.sourceUserId,validMs:OLD.validMs,
  jobId:A604_JOB,basisSha256:'61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40',
  packageSha256:'03e32f4b3f1f364cab53593d662b8744fb6081f7960d153c0da928946286986e',bytes:390134,rawBytes:583850,
  rawSha256:'8ce5fa0974dbf0cc2b5d9f467c01bc27c556cb8091362e46e8e56b6f804cc0d5',basisExpiresAt:A604_PROFILE.factsAt+A604_PROFILE.validMs,
  file:'F:/ChatGPT_workshop/techlong-a604-operator-package-20261027-a/candidate.json',
  slot:'F:/ChatGPT_workshop/techlong-a604-package-v1.intent.json',inspectSlot:'F:/ChatGPT_workshop/techlong-a604-package-v1.inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-a604-package-upload-review.md',
  readinessFile:'F:/ChatGPT_workshop/techlong-a604-publication-readonly-verified-20261027-a.json',
  readinessRawSha256:'f20abc74c22999c8009922e178d62d70136203a23ed8d9e3db60e80166bf0565',readinessAt:1793127430689,
  runtimeSource:'72a29559f914768a8df57c8e3e6b4ed940697e54',closureSha256:'f4e76cfb90ef04cb4229c6f720f08603130335d84c35cb638817f7209e0d1269'});
export const packageKey=()=>`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-${K.basisSha256}.json`;
export const checksum=()=>Buffer.from(K.packageSha256,'hex').toString('base64');
export async function makeReview({sourceCommit,pins,ci,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&Number.isSafeInteger(createdAt)&&createdAt>=K.readinessAt&&createdAt<K.basisExpiresAt&&
    ci?.sourceCommit===sourceCommit&&ci.testedSourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    /^[1-9][0-9]{0,15}$/.test(ci.runId)&&/^[1-9][0-9]{0,15}$/.test(ci.jobId)&&Array.isArray(pins)&&pins.length>=20&&
    new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>typeof p.file==='string'&&/^[a-f0-9]{64}$/.test(p.sha256)),'REVIEW_INPUT');
  const body={schema:'techlong/a604-package-upload-review/v1',sourceCommit,pins,ci,createdAt,expiresAt:Math.min(createdAt+K.validMs,K.basisExpiresAt),
    permanentSlot:K.slot,inspectSlot:K.inspectSlot,riskFile:K.riskFile,
    package:{file:K.file,rawBytes:K.rawBytes,rawSha256:K.rawSha256,canonicalBytes:K.bytes,sha256:K.packageSha256,basisSha256:K.basisSha256,jobId:K.jobId,objectCount:7,
      candidateWrapperNotUploaded:true,historicalEvidenceNotCurrentDatabaseProof:true},
    readiness:{file:K.readinessFile,rawSha256:K.readinessRawSha256,checkedAt:K.readinessAt,fullBaselineSha256:HANDOFF.actualAfterSha256,
      isHistoricalAtExecution:true,doesNotReplaceFutureWorkerPreflight:true},
    newFacts:{approvalScope:'new-a604-basis-only',profileSha256:await sha256Hex(A604_PROFILE),factsAt:A604_PROFILE.factsAt,
      databaseCheckedAt:A604_PROFILE.databaseCheckedAt,observedBy:A604_PROFILE.observedBy,expiresAt:K.basisExpiresAt,
      originalBasisExpiresAt:HANDOFF.originalBasisExpiresAt,originalBasisExtended:false,futureRuntimeActivationAuthorized:false},
    put:{Bucket:K.bucket,ExpectedBucketOwner:K.owner,Key:packageKey(),ContentType:'application/json',ContentLength:K.bytes,IfNoneMatch:'*',ServerSideEncryption:'AES256',ChecksumSHA256:checksum()},
    requiredPreflight:{region:K.region,versioning:'Enabled',encryption:'AES256',ownership:'BucketOwnerEnforced',allFourPublicAccessBlocks:true,
      policyIsPublic:false,targetHead:'404_WITHOUT_DELETE_MARKER',freshWithinMs:180000,finalReadWithinMs:30000},
    effects:{conditionalPuts:1,sourceStsReads:2,bucketMetadataReads:6,targetHeadReads:2,localPackageContentReads:1,githubCiGets:3,
      independentSourceStsReads:1,independentFixedVersionGets:1,iamWrites:0,secretValueReads:0,pemReads:0,sqlConnections:0,
      workflowPublications:0,controllerActivations:0,workflowDispatches:0,cellCreates:0,automaticWriteRetries:0},
    risks:{historicalBusinessMetadataUploaded:true,privateBucketDoesNotRemoveIamReaderAccess:true,providerAndAuditLogs:true,
      canonicalizationIsProtocolSpecific:true,headIsCurrentVersionOnly:true,concurrentReadsNotCas:true,unknownPutAcknowledgementMayLeaveBillableObject:true,
      conditionalConflictNeverAutomaticallyRetried:true,noAutomaticDeleteRollbackResetOrReplay:true,sourceLoginMayExpire:true,lowCostNotZero:true},
    laterPublication:{required:true,packageVersionId:'from-successful-independent-inspection-only',workflowFiles:['.github/workflows/cloud-worker-platform-job-v6.yml','.github/workflows/cloud-worker-platform-v6.yml'],
      runtimeSource:K.runtimeSource,closureSha256:K.closureSha256,trustOnly:true,permissionsExpansion:false,authorized:false},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyReview(m,approved,at,inspect=false){
  must(same(m,await makeReview(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&at>=m.createdAt&&at<m.expiresAt-120000,'APPROVAL_EXPIRED_OR_TOO_LATE');return m;
}
export function assertAck(a){must(a?.key===packageKey()&&typeof a.versionId==='string'&&/^[A-Za-z0-9._-]{1,256}$/.test(a.versionId)&&
  a.versionId!=='null'&&a.encryption==='AES256'&&a.checksum===checksum(),'PUT_ACK');return {key:a.key,versionId:a.versionId,sha256:K.packageSha256};}
export function createUploadRunner({verifyBody=body=>typeof body==='string'&&Buffer.byteLength(body)===K.bytes&&hash(body)===K.packageSha256}={}){
  return packageUploadRunner({verifyBody,capability:{target:K,verifyReview,assertBucket,assertSourceIdentity,assertAck}});
}
export const uploadOnce=createUploadRunner();
// This is provenance of the exact human approval, NOT a runtime activation.
export async function factsApproval(m,approved){await verifyReview(m,approved,m.createdAt);must(approved===m.manifestSha256,'APPROVAL');
  return {state:'APPROVED',manifestSha256:m.manifestSha256,profileSha256:m.newFacts.profileSha256,factsAt:m.newFacts.factsAt,
    databaseCheckedAt:m.newFacts.databaseCheckedAt,observedBy:m.newFacts.observedBy,expiresAt:m.newFacts.expiresAt,originalBasisExtended:false};}
