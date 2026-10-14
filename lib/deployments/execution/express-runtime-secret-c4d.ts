import {randomBytes} from 'node:crypto';
import db from './aurora-database-contract-v2.cjs';
import {buildExpressRuntimeCandidateV7,finalizeExpressRuntimeCandidateV7} from './express-runtime-candidate-v7.ts';
import {assertDiagnosticFacts,type DiagnosticFacts} from './aurora-express-c2-diagnostic-review.ts';

export const C4D_SCOPE=Object.freeze({appInstanceId:'app_e897a4377bce498b9c5ee9e64509dcad',workspaceId:'ws_ac46ffc6778f44f5a4b5332c41bb9f33',
  productId:'prd_restaurant_order_system',environmentId:'env_aws_sandbox_ca_central_1',cellKey:'cell-sandbox-1' as const});
export const C4D_RUN_SLOT='techlong-d002-express-c4d-secret-create-v1.permanent-slot.json';
export const C4D_INSPECT_SLOT='techlong-d002-express-c4d-secret-inspect-v1.permanent-slot.json';
export const C4D_PRIVATE_DIRECTORY='techlong-d001-credentials-20261013-r2';
export const C4D_PAYMENT_BINDING_SHA='1a3540d7529e1b5839fbd85fcf47f76a05b95c8c5496148e636a75ada5e24834';
const HISTORY_SHA='624478cdb00bac5fd9c2c566400955eb6adf37e18150c16f3dc6b01c5fe9c262';
function fail(code:string):never{throw Object.assign(Error(code),{code,retryable:false});}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export function compileRuntimeSecretExposureC4d(input:{roleId:string;roleArn:string;boundaryArn:string;boundaryPolicyId:string;defaultVersion:string;
  inlinePolicyNames:string[];attachedPolicyArns:string[];inlineDocument:Record<string,unknown>;boundaryDocument:Record<string,unknown>}){
  const pattern='arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/*';
  const allows=(doc:Record<string,unknown>)=>Array.isArray(doc.Statement)&&doc.Statement.some((s:Record<string,unknown>)=>s.Effect==='Allow'&&
    (s.Action==='secretsmanager:GetSecretValue'||Array.isArray(s.Action)&&s.Action.includes('secretsmanager:GetSecretValue'))&&s.Resource===pattern&&s.Condition===undefined);
  if(input.roleId!=='AROAV3GNMXTZJHJWAN4IR'||input.roleArn!=='arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole'||
    input.boundaryArn!=='arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary'||input.boundaryPolicyId!=='ANPAV3GNMXTZHXSTCQBZC'||
    !/^v[1-9][0-9]*$/.test(input.defaultVersion)||db.canonicalJson(input.inlinePolicyNames)!==db.canonicalJson(['PullSandboxImageAndRuntimeSecrets'])||
    input.attachedPolicyArns.length||!allows(input.inlineDocument)||!allows(input.boundaryDocument))fail('C4D_EXISTING_SECRET_EXPOSURE_CHANGED');
  return freeze({roleId:input.roleId,roleArn:input.roleArn,boundaryArn:input.boundaryArn,boundaryPolicyId:input.boundaryPolicyId,defaultVersion:input.defaultVersion,
    inlineDocumentSha256:db.digest(input.inlineDocument),boundaryDocumentSha256:db.digest(input.boundaryDocument),matchingAllowResource:pattern,
    newSecretMatchesExistingReadAllowStatements:true,effectiveSecretReadVerified:false});
}
type SecretExposureC4d=ReturnType<typeof compileRuntimeSecretExposureC4d>;
export function prepareRuntimeSecretReviewC4d({facts,exposure,codeBindingSha256,versionToken,now}:{facts:DiagnosticFacts;exposure:SecretExposureC4d;codeBindingSha256:string;versionToken:string;now:number}){
  assertDiagnosticFacts(facts,facts.binding,now);
  if(!/^[a-f0-9]{64}$/.test(codeBindingSha256)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(versionToken)||
    facts.binding.clusterResourceId!=='cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM'||facts.binding.engineVersion!=='17.9'||
    facts.binding.writerResourceId!=='db-NVAQZTKV2FPTHGITOQE563CPAY')fail('C4D_REVIEW_INPUT_REJECTED');
  if(Object.keys(exposure).sort().join(',')!=='boundaryArn,boundaryDocumentSha256,boundaryPolicyId,defaultVersion,effectiveSecretReadVerified,inlineDocumentSha256,matchingAllowResource,newSecretMatchesExistingReadAllowStatements,roleArn,roleId'||
    exposure.roleId!=='AROAV3GNMXTZJHJWAN4IR'||exposure.roleArn!=='arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole'||
    exposure.boundaryArn!=='arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary'||exposure.boundaryPolicyId!=='ANPAV3GNMXTZHXSTCQBZC'||
    exposure.matchingAllowResource!=='arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/*'||
    !/^v[1-9][0-9]*$/.test(exposure.defaultVersion)||![exposure.inlineDocumentSha256,exposure.boundaryDocumentSha256].every(v=>/^[a-f0-9]{64}$/.test(v))||
    !exposure.newSecretMatchesExistingReadAllowStatements||exposure.effectiveSecretReadVerified!==false)fail('C4D_EXISTING_SECRET_EXPOSURE_CHANGED');
  const candidate=buildExpressRuntimeCandidateV7(C4D_SCOPE);
  const body={schema:'techlong/express-runtime-secret-review/c4d',preparedAt:new Date(now).toISOString(),expiresAt:new Date(now+6*3600000).toISOString(),
    codeBindingSha256,facts,exposure,candidate,request:{...candidate.request,ClientRequestToken:versionToken},
    predecessorObservationFileSha256:HISTORY_SHA,privateSource:{directory:C4D_PRIVATE_DIRECTORY,file:'private-material.json',
      bindingSha256:C4D_PAYMENT_BINDING_SHA,readOnlyAfterApproval:true,selectedKeys:['stripeSecretKey','stripeWebhookSecret'],
      newKeys:['hmac_secret_key','jwt_secret_key'],noDatabasePasswordOrToken:true},
    slots:{run:C4D_RUN_SLOT,inspect:C4D_INSPECT_SLOT},
    limits:{createSecretCalls:1,independentDescribeSecretCalls:1,privateMaterialReads:1,iamWrites:0,sqlConnections:0,sqlWrites:0,
      secretValueReads:0,deleteCalls:0,retries:0,metadataCallsPerModeMaximum:16},
    risks:['One new billed Secret uses the default AWS-managed KMS key; 50 USD/month is a target, not a cap.',
      'Existing tenant-bound Stripe test credentials are reused, not fabricated or sent to Stripe again. Local JSON also contains other private keys; only payment fields are selected, but its raw buffer can reside in memory.',
      'New HMAC/JWT keys and payment values exist in process/SDK memory and are sent only to the regional AWS Secrets Manager endpoint; JS disposal is best effort, not guaranteed erasure.',
      'The existing ECS execution-role inline policy and shared boundary already allow GetSecretValue on techlong/sandbox/*. Creating this matching Secret exposes it to those existing Allow statements even with zero IAM writes; other administrator/policy access is not fully inventoried, and effective SCP/session/KMS permissions are not verified.',
      'Metadata, ACL checks, CreateSecret and readback are not CAS. Concurrent actors can race, alter values/stages or reproduce public tags/version IDs; metadata-only readback does not prove secret contents or consumers.',
      'Source remains an existing administrator. Its AWS Login refresh can fail; services/providers may record request/connection metadata. No new access boundary is installed.',
      'The permanent create and inspect slots never reset or retry. Submission timeout/lost response/local receipt failure may leave a billed Secret in unknown state; no automatic deletion, compensation, rotation or version retry.',
      'C4c is historical live isolation evidence, not a new SQL check. This Secret does not enable application LOGIN, grant IAM/SQL access, install authority, publish ECR or deploy ECS.',
      'The independent readback uses DescribeSecret only. No GetSecretValue, payment provider call, password, IAM token or DATABASE_URL is included.'],
    runtimeEnabled:false,readyVerified:false,executionAuthorized:false};
  return freeze({...body,manifestSha256:db.digest(body)});
}
export type RuntimeSecretReviewC4d=ReturnType<typeof prepareRuntimeSecretReviewC4d>;
export function assertRuntimeSecretApprovalC4d(r:RuntimeSecretReviewC4d,approved:string,codeSha:string,now:number){
  const {manifestSha256,...body}=r;
  if(approved!==manifestSha256||manifestSha256!==db.digest(body)||r.codeBindingSha256!==codeSha||
    !Number.isFinite(Date.parse(r.preparedAt))||now<Date.parse(r.preparedAt)||now>=Date.parse(r.expiresAt))fail('C4D_FRESH_APPROVAL_REQUIRED');
  const expected=prepareRuntimeSecretReviewC4d({facts:r.facts,exposure:r.exposure,codeBindingSha256:codeSha,versionToken:r.request.ClientRequestToken,now:Date.parse(r.preparedAt)});
  if(db.canonicalJson(r)!==db.canonicalJson(expected))fail('C4D_REVIEW_SCOPE_DRIFT');
}
/** Called only inside an approved, consumed one-shot create. Never persist or hash these values. */
export function generateRuntimeSecretMaterialC4d(payment:unknown){
  if(!payment||typeof payment!=='object'||Array.isArray(payment))fail('C4D_PAYMENT_INPUT_REJECTED');
  const p=payment as Record<string,unknown>;
  if(Object.keys(p).sort().join(',')!=='stripeSecretKey,stripeWebhookSecret'||typeof p.stripeSecretKey!=='string'||typeof p.stripeWebhookSecret!=='string'||
    !/^sk_test_[A-Za-z0-9]{16,256}$/.test(p.stripeSecretKey)||!/^whsec_[A-Za-z0-9]{16,256}$/.test(p.stripeWebhookSecret)||
    [p.stripeSecretKey,p.stripeWebhookSecret].some(s=>/replace|placeholder|dummy|example|your[_-]?/i.test(s)))fail('C4D_PAYMENT_INPUT_REJECTED');
  return {hmac_secret_key:randomBytes(32).toString('base64url'),jwt_secret_key:randomBytes(32).toString('base64url'),
    stripe_secret_key:p.stripeSecretKey,stripe_webhook_secret:p.stripeWebhookSecret};
}
export function observeRuntimeSecretC4d(r:RuntimeSecretReviewC4d,m:Record<string,unknown>){
  const b=r.facts.binding;
  const result=finalizeExpressRuntimeCandidateV7({candidate:r.candidate,metadata:m,base:{schema:'techlong/database-binding/v2',profile:'express_iam',
    clusterArn:b.clusterArn,clusterResourceId:b.clusterResourceId,endpoint:b.endpoint,port:5432,observedEngineVersion:b.engineVersion,
    tenantDatabase:'tenant_a0da1748bc4d5419_db',tenantUsername:'tenant_a0da1748bc4d5419_role',managementDatabase:'postgres',managementUsername:'postgres',
    stableIdentity:r.candidate.stableIdentity,resourceGeneration:1,tlsTrust:'ats-roots/v1',access:{authentication:'iam',internetAccessGatewayEnabled:true,
      applicationRoleArn:'arn:aws:iam::402010193138:role/TechlongSandboxTaskRole',lifecycleRoleArn:'arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole'}}});
  if(result.binding.runtimeSecret.versionId!==r.request.ClientRequestToken||m.PrimaryRegion!==undefined&&m.PrimaryRegion!=='ca-central-1'||
    m.ReplicationStatus!==undefined&&(!Array.isArray(m.ReplicationStatus)||m.ReplicationStatus.length!==0))fail('C4D_SECRET_VERSION_OR_REPLICA_CHANGED');
  return result;
}
/** Desired additions only; not policies, live IAM evidence or installation authority. */
export function runtimeIamNextStepC4d(r:RuntimeSecretReviewC4d,actual?:ReturnType<typeof observeRuntimeSecretC4d>){
  const root=`arn:aws:rds-db:ca-central-1:402010193138:dbuser:${r.facts.binding.clusterResourceId}/`;
  return freeze({schema:'techlong/express-runtime-iam-next-step/c4d',dataOnlyNotPolicy:true,
    application:{role:'TechlongSandboxTaskRole',connectResource:root+'tenant_a0da1748bc4d5419_role'},
    lifecycle:{role:'TechlongSandboxTenantLifecycleTaskRole',connectResource:root+'postgres'},
    execution:{role:'TechlongSandboxTaskExecutionRole',secretResource:actual?.binding.runtimeSecret.arn??null,versionId:actual?.binding.runtimeSecret.versionId??null},
    existingRolesAndBoundariesMustBeFreshlyInspected:true,sharedBoundaryChangesMustBeExplicitlyReviewed:true,
    noWildcardSecretPlaceholder:true,installationAuthorized:false});
}
