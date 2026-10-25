// Public contracts only. Live capabilities are isolated in live.mjs.
import path from 'node:path';
import {validatePlan,commit,digest} from '../../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertReferenceV6,resultKeyV6} from '../platform-cloud-v6/contract.mjs';

export const LIMITS=Object.freeze({validMs:48*3600000,runMs:35*60000,maxObjects:8,maxRunGets:80,maxPolls:78});
export const SOURCE_IDENTITY=Object.freeze({Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'});
export const must=(v,c)=>{if(!v)throw Error('PLATFORM_OPERATOR_'+c);};
export const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
// Stable across refreshed approvals: a new SHA must not reopen the same action.
export const intentName=m=>'intent-'+m.input.plan.jobId+'-'+m.input.runId+'.json';
export function exactKeys(v,names){must(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...names].sort().join(','),'FIELDS');}
export async function validateInput(raw){
  const v=structuredClone(raw);exactKeys(v,['schema','plan','runId','resultReference','keyPath','evidenceRoot']);
  must(v.schema==='techlong/platform-operator-input/v6'&&/^[1-9][0-9]{0,15}$/.test(v.runId)&&v.plan?.mode==='RunOnce','INPUT');
  await validatePlan(v.plan,B.platform,v.plan.preparedAt);
  assertReferenceV6(v.resultReference,resultKeyV6(v.plan.jobId,v.plan.inputs.manifestSha,v.runId));
  for(const p of [v.keyPath,v.evidenceRoot])must(typeof p==='string'&&path.isAbsolute(p)&&!/[\r\n\0]/.test(p)&&p.length<2048,'ABSOLUTE_PATH');
  return v;
}
export function validateReviewMetadata({operatorSourceCommit,pins,key,createdAt}){
  must(commit(operatorSourceCommit)&&Number.isSafeInteger(createdAt)&&createdAt>0&&Array.isArray(pins)&&pins.length>=20&&
    new Set(pins.map(p=>p.file)).size===pins.length&&pins.every(p=>{
      exactKeys(p,['file','sha256']);return typeof p.file==='string'&&!path.isAbsolute(p.file)&&!p.file.includes('..')&&digest(p.sha256);
    }),'SOURCE_PINS');
  exactKeys(key,['length','mtimeMs','ctimeMs','identity','protectionSha256','contentRead']);
  must(key.contentRead===false&&key.length>0&&key.length<=16000&&Number.isFinite(key.mtimeMs)&&Number.isFinite(key.ctimeMs)&&
    typeof key.identity==='string'&&digest(key.protectionSha256),'KEY_METADATA');
}
export async function makeReview({input,operatorSourceCommit,pins,key,createdAt}){
  input=await validateInput(input);validateReviewMetadata({operatorSourceCommit,pins,key,createdAt});
  const body={schema:'techlong/platform-operator-inspect-review/v6',input,operatorSourceCommit,pins,key,binding:B,
    createdAt,expiresAt:createdAt+LIMITS.validMs,lastStartAt:createdAt+LIMITS.validMs-LIMITS.runMs,
    effects:{inspectDispatchesMax:1,appKeyReadsMax:1,githubReadCredentialLoadsMax:1,appInstallationTokensMax:1,appTokenRevocationsMax:1,
      sourceCredentialLoadsMax:6,sourceStsGetsMax:6,s3VersionedGetsMax:8,s3LatestHeadsMax:1,githubRunGetsMax:80,
      cloudInspectDatabaseSecretReadsMax:1,cloudInspectReadOnlyTransactionsMax:3,cloudInspectEvidencePutsMax:2,
      localSecretValueReads:0,localSqlConnections:0,cloudResourceWrites:0,databaseWrites:0,jobClaims:0,platformLedgerWrites:0,automaticRetries:0},
    risks:{installationTokenHasActionsWrite:true,privateKeyAndReadCredentialInMemory:true,providerAndLocalLogsPossible:true,
      memoryErasureNotGuaranteed:true,metadataChecksAreNotCas:true,ackMayBeUnknown:true,revocationMayFail:true,
      expiryDoesNotCancelInFlightCalls:true,nonzeroCost:true,permanentSlotNeverReset:true,noAutomaticRetryOrCompensation:true},
    policy:{inspectOnly:true,requiresHumanEnvironmentApproval:true,noHistoricalReplay:true,noPersistedLedgerImport:true,
      noPlatformAcceptanceFlagChange:true,preparationIsNotApproval:true},riskFile:'docs/aws-auto-deployment-platform-w6y-operator-entry.md'};
  return {...body,manifestSha256:await sha256Hex(body)};
}
export async function verifyReview(m,approved,now,starting=false){
  must(same(m,await makeReview(m))&&approved===m.manifestSha256&&Number.isSafeInteger(now)&&now>=m.createdAt&&now<m.expiresAt&&
    (!starting||now<m.lastStartAt),'APPROVAL_OR_EXPIRED');
  // Historical content may be verified offline, but never dispatched on a newer main.
  must(m.operatorSourceCommit===m.input.plan.sourceCommit,'HISTORICAL_SOURCE_NO_DISPATCH');
}
