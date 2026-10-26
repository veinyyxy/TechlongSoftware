// One fixed evidence object, not an activation or a deployment capability.
import {createHash} from 'node:crypto';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
export const must=(v,c)=>{if(!v)throw Error('RECOVERY_PACKAGE_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const K=Object.freeze({bucket:'techlong-sandbox-cloud-worker-evidence-402010193138',owner:'402010193138',region:'ca-central-1',
  sourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',sourceUserId:'AIDAV3GNMXTZEO7SHLC2X',
  jobId:'job_9b57b43a6b88f37202b29170',basisSha256:'c7baeb6471d48c01f99144d299225e33fe2d8f8eb9763f9d976cdb053374c7c0',
  packageSha256:'07d9d9475033b35cc6a38597946c40a8389ccd4409c177122878590e94975ce7',bytes:384888,rawBytes:558921,
  rawSha256:'c4762e903f9c9e1d7d4d0683a6ebd72dc6ccefcb067c7134547962627e8df5d5',basisExpiresAt:1793126877695,
  file:'F:/ChatGPT_workshop/techlong-w9f-request-20261025-a/publication-package.json',
  slot:'F:/ChatGPT_workshop/techlong-w9l-recovery-package.intent.json',inspectSlot:'F:/ChatGPT_workshop/techlong-w9l-recovery-package.inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-w9l-recovery-package-review.md',validMs:24*3600000,
  publicationProof:'F:/ChatGPT_workshop/techlong-w9k-publication-completed-verified-20261025-a.json',
  publicationProofSha256:'97eae297a9093e832b13fda14f6de317b4d5e6ca4a1c118a55b65036c1199ed1',
  requestProof:'F:/ChatGPT_workshop/techlong-w9f-request-execution-completed-verified-20261025-a.json',
  requestProofSha256:'64b1ebf45dc66fbbdba4be2feec3d7d7c51bafe7419d908a1ce9ace773c0593f',
  runtimeSource:'0494b2be7b0f559ac991533137dfb1b0388ac7a9',reusableCommit:'4c09548ab9852a4f3e948f0686f8c81251cda73b',
  closureSha256:'30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374'});
export const packageKey=()=>`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-${K.basisSha256}.json`;
export const checksum=()=>Buffer.from(K.packageSha256,'hex').toString('base64');
export async function makePackageReview({sourceCommit,pins,ci,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&Number.isSafeInteger(createdAt)&&createdAt<K.basisExpiresAt&&
    ci?.sourceCommit===sourceCommit&&ci.status==='completed'&&ci.conclusion==='success'&&ci.attempt===1&&
    /^[1-9][0-9]{0,15}$/.test(ci.runId)&&/^[1-9][0-9]{0,15}$/.test(ci.jobId)&&pins.length>=10&&
    new Set(pins.map(v=>v.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)),'REVIEW_INPUT');
  const body={schema:'techlong/recovery-package-upload-review/v1',sourceCommit,pins,ci,createdAt,expiresAt:Math.min(createdAt+K.validMs,K.basisExpiresAt),
    permanentSlot:K.slot,inspectSlot:K.inspectSlot,riskFile:K.riskFile,
    package:{file:K.file,rawBytes:K.rawBytes,rawSha256:K.rawSha256,canonicalBytes:K.bytes,sha256:K.packageSha256,basisSha256:K.basisSha256,
      basisExpiresAt:K.basisExpiresAt,jobId:K.jobId,objectCount:7,historicalEvidenceNotCurrentDatabaseProof:true},
    publication:{proofFile:K.publicationProof,proofRawSha256:K.publicationProofSha256,requestProofFile:K.requestProof,requestProofRawSha256:K.requestProofSha256,
      runtimeSource:K.runtimeSource,reusableCommit:K.reusableCommit,closureSha256:K.closureSha256},
    put:{Bucket:K.bucket,ExpectedBucketOwner:K.owner,Key:packageKey(),ContentType:'application/json',ContentLength:K.bytes,
      IfNoneMatch:'*',ServerSideEncryption:'AES256',ChecksumSHA256:checksum()},
    requiredPreflight:{notYetObserved:true,region:K.region,versioning:'Enabled',encryption:'AES256',ownership:'BucketOwnerEnforced',
      allFourPublicAccessBlocks:true,policyIsPublic:false,targetHead:'404_WITHOUT_DELETE_MARKER',freshWithinMs:180000,finalReadWithinMs:30000},
    effects:{conditionalPuts:1,sourceStsReads:2,bucketMetadataReads:6,targetHeadReads:2,localPackageContentReads:1,githubCiGets:3,
      independentSourceStsReads:1,independentFixedVersionGets:1,iamWrites:0,secretValueReads:0,pemReads:0,sqlConnections:0,
      controllerActivations:0,workflowDispatches:0,cellCreates:0,automaticWriteRetries:0},
    risks:{historicalBusinessMetadataUploaded:true,privateBucketDoesNotRemoveIamReaderAccess:true,providerAndAuditLogs:true,
      headIsCurrentVersionOnly:true,concurrentReadsNotCas:true,unknownPutAcknowledgementMayLeaveBillableObject:true,
      conditionalConflictNeverAutomaticallyRetried:true,noAutomaticDeleteRollbackResetOrReplay:true,sourceLoginMayExpire:true,lowCostNotZero:true},
    preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyPackageReview(m,approved,now,inspect=false){
  must(same(m,await makePackageReview(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt-120000,'APPROVAL_EXPIRED_OR_TOO_LATE');
}
export function assertSourceIdentity(who){must(who?.Account===K.owner&&who.Arn===K.sourceArn&&who.UserId===K.sourceUserId,'SOURCE_IDENTITY');}
export function assertBucket(p){
  assertSourceIdentity(p.source);const e=p.encryption?.Rules,o=p.ownership?.Rules;
  must(p.region===K.region&&p.versioning?.Status==='Enabled'&&e?.length===1&&
    e[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm==='AES256'&&!e[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID&&
    o?.length===1&&o[0].ObjectOwnership==='BucketOwnerEnforced'&&p.policyIsPublic===false&&
    ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets'].every(k=>p.publicAccess?.[k]===true)&&
    p.targetAbsent===true&&p.deleteMarker===false,'BUCKET_OR_TARGET');
}
export function assertAck(a){must(a?.key===packageKey()&&typeof a.versionId==='string'&&a.versionId.length>0&&a.versionId.length<=1024&&
  a.versionId!=='null'&&a.encryption==='AES256'&&a.checksum===checksum(),'PUT_ACK');return {key:a.key,versionId:a.versionId,sha256:K.packageSha256};}
// A test may supply a synthetic verifier as a code capability, never via JSON/CLI.
export function packageUploadRunner({verifyBody=body=>typeof body==='string'&&Buffer.byteLength(body)===K.bytes&&hash(body)===K.packageSha256}={}){
return async function upload({manifest:m,approved,io,now=Date.now}){
  const approve=()=>verifyPackageReview(m,approved,now());await approve();await io.assertSource();
  const started=now(),p=await io.preflight();assertBucket(p);must(now()-started<180000,'STALE_PREFLIGHT');
  await io.record('preflight',p);const body=await io.readPackage();must(verifyBody(body)===true,'BODY_CHANGED');
  await approve();await io.assertSource();await io.consume({manifestSha256:m.manifestSha256,claimedAt:now(),packageSha256:K.packageSha256,retryAllowed:false});
  let phase='SLOT_CONSUMED';
  try{
    phase='FINAL_READ';const final=await io.finalRead();assertSourceIdentity(final.source);must(final.targetAbsent===true&&final.deleteMarker===false&&now()-started<180000,'FINAL_READ_CHANGED');
    const finalAt=now();await approve();await io.assertSource();must(now()-finalAt<30000,'FINAL_READ_STALE');
    phase='PUT_ONCE';const ack=await io.put(body);await io.record('put-ack-unverified',ack);const reference=assertAck(ack);await io.record('put-ack',ack);
    return {outcome:'RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT',reference,controllerActivated:false,workflowDispatched:false,retryAllowed:false};
  }catch{return {outcome:'RECOVERY_PACKAGE_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',phase,controllerActivated:false,workflowDispatched:false,retryAllowed:false};}
};}
export const uploadPackageOnce=packageUploadRunner();
