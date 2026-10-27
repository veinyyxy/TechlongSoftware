// Preparation-age policy only. No credential, network, file or writer capability.
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
export const SNAPSHOT_MAX_AGE_MS=5*3600000;
export const PRIOR_READINESS=Object.freeze({sourceCommit:'3b54f199b5a67c1371d869bd2ec9466aa9c0ecd9',observedAt:1793129933490,
  file:'F:/ChatGPT_workshop/techlong-a604-publication-readiness-20261027-b/readiness.json',
  rawSha256:'d92df15ef18e13ffadb432dd147a70af39acaf8c69b6226f55cf7b8c72fd4733',
  baselineSha256:'38d3290a6e434163734bb20582397359f9cafea9a86b462e50e6f8617e7c306d'});
export const TIME_POLICY_FILES=Object.freeze(['ops/platform-a604-publication-v1/readiness.mjs','ops/platform-a604-publication-v1/local.mjs',
  'ops/platform-a604-publication-v1/plan.mjs','tests/platform-a604-publication-v1.test.mjs',
  'docs/aws-auto-deployment-a604-workflow-publication-review.md','docs/aws-auto-deployment-mainline.md']);
const must=(v,c)=>{if(!v)throw Error('A604_PUBLICATION_'+c);},hash=v=>createHash('sha256').update(canonicalJson(v)).digest('hex');
export function assertSnapshotTime(observedAt,now){must(Number.isSafeInteger(observedAt)&&Number.isSafeInteger(now)&&now>=observedAt&&
  now-observedAt<SNAPSHOT_MAX_AGE_MS,'SNAPSHOT_AGE');}
// Explicit test/source capability only; production always uses the fixed export.
export function createReadinessPolicy(prior){const p=Object.freeze(structuredClone(prior));
  const originFor=parent=>({method:'CI_VERIFIED_PREPARATION_TIME_POLICY_ONLY',snapshotFile:p.file,snapshotRawSha256:p.rawSha256,
    capturedSourceCommit:p.sourceCommit,capturedMain:p.sourceCommit,observedAt:p.observedAt,capturedBaselineSha256:p.baselineSha256,
    reviewParent:parent,nonMainLayoutPreserved:true,protectedTargetsUnchanged:true});
  function assertOrigin(origin,baseline,parent,observedAt){if(origin===null)return;
    must(canonicalJson(origin)===canonicalJson(originFor(parent))&&observedAt===p.observedAt&&baseline.main===parent,'SNAPSHOT_ORIGIN');
    const original=structuredClone(baseline);original.main=p.sourceCommit;must(hash(original)===p.baselineSha256,'NON_MAIN_SNAPSHOT_CHANGED');}
  function reviewReadiness(saved,{head,rawSha256,changedFiles=[],ancestor=false,now}){
    assertSnapshotTime(saved.observedAt,now);const baseline=structuredClone(saved.baseline);must(saved.sourceCommit===baseline.main,'CAPTURE_SOURCE');
    if(saved.sourceCommit===head)return {baseline,readinessOrigin:null};
    must(saved.sourceCommit===p.sourceCommit&&saved.observedAt===p.observedAt&&rawSha256===p.rawSha256&&ancestor===true&&
      changedFiles.length>0&&changedFiles.every(f=>TIME_POLICY_FILES.includes(f)),'PREPARATION_SOURCE_DRIFT');
    baseline.main=head;const readinessOrigin=originFor(head);assertOrigin(readinessOrigin,baseline,head,saved.observedAt);return {baseline,readinessOrigin};
  }
  return Object.freeze({assertOrigin,reviewReadiness});
}
export const {assertOrigin,reviewReadiness}=createReadinessPolicy(PRIOR_READINESS);
