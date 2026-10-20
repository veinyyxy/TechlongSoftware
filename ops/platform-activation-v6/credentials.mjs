// Resource-bound review and once-only credential installation. No clients here.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assessLegacyCompatibilityV6} from './compatibility.mjs';
export const A=Object.freeze({account:'402010193138',region:'ca-central-1',sourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',
  sourceUserId:'AIDAV3GNMXTZEO7SHLC2X',role:'techlong_deployment_controller_v6',roleOid:'180224',ownerOid:'16392',schemaOid:'180226',
  secretName:'techlong/sandbox/platform-controller/neon-v6',versionId:'3574f24e-ecb3-476c-8f71-baa501fd129e',
  targetFingerprintSha256:'5d5e52c00c54ed761aac13730f81b1b6f107d7ac06a68a407276132d150690a7',
  slot:'F:/ChatGPT_workshop/techlong-w6h-controller-credentials.intent.json',
  inspectSlot:'F:/ChatGPT_workshop/techlong-w6h-controller-credentials-inspect.intent.json',
  riskFile:'docs/aws-auto-deployment-platform-w6h-activation-review.md',validMs:48*3600000});
export const must=(v,c)=>{if(!v)throw Error('CONTROLLER_CREDENTIAL_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export function secretPolicyV6(){return {Version:'2012-10-17',Statement:[
  {Sid:'OnlySourceMayReadControllerCredential',Effect:'Deny',Principal:'*',Action:'secretsmanager:GetSecretValue',Resource:'*',
    Condition:{ArnNotEquals:{'aws:PrincipalArn':A.sourceArn}}},
  {Sid:'OnlySourceMayManageControllerCredential',Effect:'Deny',Principal:'*',Action:['secretsmanager:PutSecretValue','secretsmanager:UpdateSecret',
    'secretsmanager:DeleteSecret','secretsmanager:RestoreSecret','secretsmanager:PutResourcePolicy','secretsmanager:DeleteResourcePolicy',
    'secretsmanager:RotateSecret','secretsmanager:CancelRotateSecret','secretsmanager:UpdateSecretVersionStage','secretsmanager:TagResource',
    'secretsmanager:UntagResource','secretsmanager:ReplicateSecretToRegions',
    'secretsmanager:RemoveRegionsFromReplication','secretsmanager:StopReplicationToReplica'],Resource:'*',
    Condition:{ArnNotEquals:{'aws:PrincipalArn':A.sourceArn}}}
]};}
export function verifySecretArnV6(arn){must(typeof arn==='string'&&new RegExp('^arn:aws:secretsmanager:'+A.region+':'+A.account+':secret:'+A.secretName+'-[A-Za-z0-9]{6}$').test(arn),'SECRET_ARN');return arn;}
export async function makeCredentialReviewV6({sourceCommit,pins,ci,prestate,proposal,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&Number.isSafeInteger(createdAt)&&ci?.sourceCommit===sourceCommit&&
    ci.conclusion==='success'&&ci.status==='completed'&&ci.attempt===1&&pins.length>=10&&
    new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)),'SOURCE_CI');
  must(prestate.source?.Account===A.account&&prestate.source.Arn===A.sourceArn&&prestate.source.UserId===A.sourceUserId&&
    prestate.secret.state==='ABSENT'&&prestate.catalog.role.oid===A.roleOid&&prestate.catalog.schema.oid===A.schemaOid&&
    prestate.catalog.installer.oid===A.ownerOid&&prestate.catalog.role.login===false&&proposal.serviceRoleOid===A.roleOid&&
    proposal.expectedFunctionOwnerOid===A.ownerOid&&prestate.targetFingerprintSha256===A.targetFingerprintSha256&&
    prestate.kms?.keyManager==='AWS'&&prestate.kms.arn.startsWith('arn:aws:kms:'+A.region+':'+A.account+':key/')&&
    prestate.workerRole?.id==='AROAV3GNMXTZK5O45RG24','PRESTATE');
  const compatibility=await assessLegacyCompatibilityV6(prestate.privileges,proposal);
  must(compatibility.eligibleForReviewedCredentialInstall,'COMPATIBILITY');
  const body={schema:'techlong/platform-controller-credential-install-review/v6',sourceCommit,pins,ci,prestate,proposal,compatibility,
    createdAt,expiresAt:createdAt+A.validMs,permanentSlot:A.slot,riskFile:A.riskFile,
    action:{secretName:A.secretName,versionId:A.versionId,kms:'aws/secretsmanager',resourcePolicy:secretPolicyV6(),
      order:['CreateEmptySecret','ProtectSourceOnly','PutFixedVersion','AtomicRolePasswordAndLogin','DedicatedReadOnlyConnection','IndependentInspect'],
      roleName:A.role,roleOid:A.roleOid,roleSqlTemplateCanonicalSha256:await sha256Hex(roleLoginSqlV6('A'.repeat(64))),
      independentSecretReadSlot:A.inspectSlot,
      acceptedLegacyFunctionSnapshotSha256:proposal.functionSnapshotSha256},
    effects:{createSecret:1,putResourcePolicy:1,putSecretValue:1,ownerSqlTransactionSubmissions:1,loginRoles:1,
      generatedPasswordBytes:48,independentFixedSecretValueReadsMax:1,privateKeyReads:0,iamRoleChanges:0,workflowPublications:0,dispatches:0,businessWrites:0,automaticRetries:0},
    risks:{crossServiceNonAtomic:true,partialCredentialMayRemain:true,passwordMayReachProviderLogs:true,exactLegacyInvokerTriggersRetained:true,
      publicTemporaryCapabilityRetained:true,noAutomaticRollbackOrDelete:true,metadataIsNotCrossServiceCas:true},preparationIsNotApproval:true};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyCredentialReviewV6(m,approved,now,inspect=false){
  must(same(m,await makeCredentialReviewV6(m)),'MANIFEST_CHANGED');
  if(!inspect)must(approved===m.manifestSha256&&now>=m.createdAt&&now<m.expiresAt,'APPROVAL_OR_EXPIRED');
}
export function roleLoginSqlV6(password){
  must(typeof password==='string'&&/^[A-Za-z0-9_-]{64}$/.test(password),'GENERATED_PASSWORD_FORMAT');
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s'; SELECT pg_catalog.pg_advisory_xact_lock(718061927);
DO $credential$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE oid=${A.roleOid} AND rolname='${A.role}' AND NOT rolcanlogin AND NOT rolsuper AND
   NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls) THEN
   RAISE EXCEPTION 'CONTROLLER_CREDENTIAL_ROLE_DRIFT'; END IF;
 ALTER ROLE ${A.role} PASSWORD '${password}' LOGIN;
END $credential$; COMMIT;`;
}
export function assertOnlyLoginChangedV6(before,after){
  must(after.catalog.role.login===true&&after.privileges.role.login===true,'LOGIN_NOT_OBSERVED');
  const c=structuredClone(after.catalog),p=structuredClone(after.privileges);c.role.login=false;p.role.login=false;
  must(same(c,before.catalog)&&same(p,before.privileges),'POST_ROLE_OR_PERMISSION_DRIFT');
}
export async function installCredentialOnceV6({manifest:m,approved,io,now=Date.now}){
  const approval=()=>verifyCredentialReviewV6(m,approved,now());await approval();await io.assertSource(m);
  const started=now(),current=await io.preflight();must(now()-started<120000&&same(current,m.prestate),'FRESH_PRESTATE_CHANGED');await approval();
  await io.claim({manifestSha256:m.manifestSha256,targetFingerprintSha256:m.prestate.targetFingerprintSha256,claimedAt:now(),retryAllowed:false});
  let phase='SLOT_CONSUMED';
  const guard=async()=>{await approval();must(now()-started<1200000,'ACTIVE_EXECUTION_WINDOW');await io.assertSource(m);};
  try{
    await guard();phase='CREATE_EMPTY_SECRET';const arn=verifySecretArnV6(await io.createEmpty());await io.record('secret-created',{arn,name:A.secretName});
    await guard();phase='PROTECT_SOURCE_ONLY';await io.protect(arn,secretPolicyV6());await io.verifyEmptyProtected(arn);
    await guard();phase='PUT_FIXED_VERSION';await io.putMaterial(arn);await io.record('material-put',{arn,versionId:A.versionId,valueRecorded:false});
    await io.verifyMaterialMetadata(arn);await guard();
    // Re-read both metadata catalogs immediately before the only role transaction.
    phase='FINAL_NOLOGIN_RECHECK';const finalStarted=now(),last=await io.readDatabase();must(same(last.catalog,m.prestate.catalog)&&same(last.privileges,m.prestate.privileges),'LAST_DATABASE_DRIFT');
    await guard();must(now()-finalStarted<30000,'LAST_DATABASE_STALE');phase='ATOMIC_ROLE_PASSWORD_LOGIN';must((await io.activateRole()).commitAcknowledged===true,'COMMIT_ACK_UNKNOWN');
    await io.record('role-commit-ack',{commitAcknowledged:true,roleOid:A.roleOid});
    phase='SAME_PROCESS_READBACK';const post=await io.readDatabase();assertOnlyLoginChangedV6(m.prestate,post);
    must((await assessLegacyCompatibilityV6(post.privileges,m.proposal,{expectedLogin:true})).eligibleForReviewedCredentialInstall,'POST_COMPATIBILITY');
    phase='DEDICATED_ROLE_CONNECTION';const dedicated=await io.verifyDedicated();
    await io.record('installed-database',post);await io.record('dedicated-proof',dedicated);
    return {outcome:'CONTROLLER_CREDENTIAL_INSTALLED_REQUIRES_INDEPENDENT_INSPECT',secretArn:arn,versionId:A.versionId,
      roleOid:A.roleOid,roleLogin:true,compatibilityAcceptedByManifest:m.action.acceptedLegacyFunctionSnapshotSha256,
      independentInspectRequired:true,runtimeEnabled:false,retryAllowed:false};
  }catch{return {outcome:'CONTROLLER_CREDENTIAL_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',phase,runtimeEnabled:false,retryAllowed:false};}
}
