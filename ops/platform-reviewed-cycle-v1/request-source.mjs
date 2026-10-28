// One SOURCE selection for the shared request transaction; no per-job directory
// and no manifest/env/CLI target override. This is not a published cloud cycle.
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {createHandoffProfile} from '../platform-a604-handoff-v1/profile.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {readText,git} from '../platform-image-source-v2/files.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {readTransferState} from '../platform-request-v6/transfer-state.mjs';
import {RECOVERY_EXTRA_LEDGER_SQL,RECOVERY_PRIOR_JOBS} from '../platform-recovery-v1/request-state.mjs';
import {cycleCloudClosure} from './closure.mjs';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
const must=(v,c)=>{if(!v)throw Error('REQUEST_SOURCE_'+c);};
export const REQUEST_SOURCE=freeze({
  target:{oldJobId:'job_a60423b885fef3e4326213f7',newJobId:'job_a00fc18c13a5d6c6616c8039',
    oldRequestId:'3bb1acc176722d5196a1e507f34e11c0fae512a1cee915a7320ac458047dafe9',clientRequestId:'d520d219-4b60-455e-8596-3730bcb8fe9b',
    requestId:'67181c98fe9ad70988655d66660a2dc0c1127d0a6889d7ebfb91320b9e8b7538',runMs:30000},
  facts:{sourceCommit:'05a1eda2e30526b63c9d9868f6f2171dabd024d2',checkedAt:1793195484061,expiresAt:1793212938110,jobCount:11,
    baselineSha256:'4709aad288e5d485b1f63e8b17e82797123c3f2d3bb1f47d66ed7f7897136e39',ledgerSha256:'b2e48e455e0d70ededdb58b5c4a265cb46cb01bf63aeaef00c2dea855447cde9',
    reviewPlanSha256:'e2934f19fe09f460a8f5bc6ae3eb91b842d9f9f17128de5e612ab60d684dbb8f',reviewRunId:'40607422851',historicalPlanShas:[],
    protection:{catalogSha256:'ff430aee9aa57bdee25d611251683283cdbad76a05d5c746212096e806eb9f33',triggersSha256:'72037e9bea389b19d38ad2875ec350fc8f13eee4d435ba9bb307d664daf621b8'}},
  evidence:{sealFile:'F:/ChatGPT_workshop/techlong-reviewed-cycle-facts-20261028-c/verified.json',sealRawSha256:'797444b7b2260107b990e507bf6107db69b040f8ea682c2cb3aa9331d27388b7',
    databaseFile:'F:/ChatGPT_workshop/techlong-reviewed-cycle-facts-20261028-c/database.json',databaseRawSha256:'cc5f9177eb20f11f9c8aa433d40496f4f4adbfdaf953cc03fc242b828ee91abf'},
  cloudClosureSha256:'0c6f119def3b10efe592f559b29d4d8f929893a28dbc77a065c2746052aa308d',
});
export const REQUEST_RISK='docs/aws-auto-deployment-reviewed-cycle-handoff-v1.md';
const prefix='F:/ChatGPT_workshop/techlong-reviewed-cycle-'+REQUEST_SOURCE.target.newJobId;
export const REQUEST_ENTRY=freeze({slot:prefix+'-request-handoff.intent.json',inspectSlot:prefix+'-request-handoff-inspect.intent.json',
  riskFile:REQUEST_RISK,configPath:'E:/NodejsProject/TechlongSoftware/.env.local'});
export const REQUEST_PROFILE=createHandoffProfile(REQUEST_SOURCE.facts,{target:REQUEST_SOURCE.target,entry:REQUEST_ENTRY,
  successfulPredecessor:'job_9db8466fd95cef0c23ad6bfc',reviewSchema:'techlong/reviewed-cycle-held-request/v1',operatorSchema:'techlong/reviewed-cycle-held-request-operator/v1'});
// Narrow operator-only source bridge, not a claim that old observations were
// sampled at the new HEAD. Original SQL/compiler/role guards cannot change.
export const REQUEST_BRIDGE_FILES=freeze(['ops/platform-a604-handoff-v1/profile.mjs','ops/platform-reviewed-cycle-v1/request-source.mjs',
  'ops/platform-reviewed-cycle-v1/request-local.mjs','tests/platform-reviewed-cycle-handoff-v1.test.mjs',REQUEST_RISK,
  'docs/aws-auto-deployment-execution-runbook.md','docs/aws-auto-deployment-mainline.md','.github/workflows/platform-recovery-hosting-candidate.yml']);
export function assertSourceBridgeFiles(files){must(files.every(f=>REQUEST_BRIDGE_FILES.includes(f)),'SOURCE_BRIDGE_DIFF');}
export async function assertRequestOrigin(head){
  git(['merge-base','--is-ancestor',REQUEST_SOURCE.facts.sourceCommit,head]);
  const files=git(['diff','--name-only',REQUEST_SOURCE.facts.sourceCommit,head]).trim().split(/\r?\n/).filter(Boolean);assertSourceBridgeFiles(files);
  const c=await cycleCloudClosure();must(c.pinCount===110&&c.closureSha256===REQUEST_SOURCE.cloudClosureSha256,'CLOUD_SOURCE_DRIFT');return {capturedSource:REQUEST_SOURCE.facts.sourceCommit,executionSource:head,codeOnlyChangedFiles:files,oldTimesKept:true};
}
export async function savedRequestBaseline(at=Date.now()){
  const e=REQUEST_SOURCE.evidence,raw=await readText(e.sealFile,100000);must(await sha256Hex(raw)===e.sealRawSha256,'SEAL_BYTES');
  const seal=JSON.parse(raw),bytes=await readText(e.databaseFile,4000000);must(await sha256Hex(bytes)===e.databaseRawSha256,'DATABASE_BYTES');
  const db=JSON.parse(bytes);must(seal.outcome==='P2_READONLY_FACTS_VERIFIED_NO_EXECUTION_AUTHORITY'&&db.sourceCommit===REQUEST_SOURCE.facts.sourceCommit&&
    seal.databaseSnapshotSha256===REQUEST_SOURCE.facts.baselineSha256&&seal.preparationExpiresAt===REQUEST_SOURCE.facts.expiresAt,'SAVED_FACTS');
  return REQUEST_PROFILE.assertState(normalizedState(db.snapshot),at);
}
export function requestStateReader(baseline,{clocks=[]}={}){
  const ids=baseline.jobs.map(j=>j.id),target=REQUEST_SOURCE.target;
  return async(client,options)=>{
    const at=Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at')).rows[0].at);
    must(Number.isSafeInteger(at),'DATABASE_CLOCK');clocks.push(at);
    const s=await readTransferState(client,{...options,ledgerJobIds:RECOVERY_PRIOR_JOBS,candidateJobId:target.newJobId});
    must(s.jobs.every(j=>[...ids,target.newJobId].includes(j.id)),'UNKNOWN_JOB');
    const rows=(await client.query(RECOVERY_EXTRA_LEDGER_SQL+', EXISTS(SELECT FROM public.deployment_jobs WHERE (id=$2 OR dedupe_key=$4) AND deployment_id<>$3) AS foreign_candidate',
      [[...ids,target.newJobId],target.newJobId,S.deploymentId,'express-initialized-v2:'+target.requestId])).rows;
    must(rows.length===1&&['plans','approvals','attempts'].every(k=>Array.isArray(rows[0][k])&&rows[0][k].length<=53),'COMPLETE_LEDGER');
    must(rows[0].foreign_candidate===false,'FOREIGN_CANDIDATE');delete rows[0].foreign_candidate;s.ledger=rows[0];return normalizedState(s);
  };
}
