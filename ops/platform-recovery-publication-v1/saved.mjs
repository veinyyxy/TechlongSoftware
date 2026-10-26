// The two prior human-approved read scopes are consumed. No live fallback.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROOFS,Q,hash,validateBaseline} from './plan.mjs';
import {must,same} from '../platform-publication-v6/plan.mjs';
const rawHash=b=>createHash('sha256').update(b).digest('hex');
export async function loadSavedBaseline(){
  const verified=[];
  for(const ref of PROOFS){
    const raw=await readFile(ref.file);must(raw.length<1000000&&rawHash(raw)===ref.rawSha256,'RECOVERY_PROOF_BYTES');
    const proof=JSON.parse(raw);must(proof.allClientsClosed===true&&proof.actual.writes===0&&proof.actual.slotsConsumed===0,'RECOVERY_READ_ONLY_PROOF');
    for(const a of proof.artifacts){
      must(/^F:\/ChatGPT_workshop\/techlong-w9[ij]-[a-z0-9.-]+$/.test(a.file),'RECOVERY_PROOF_PATH');
      const bytes=await readFile(a.file);must(bytes.length===a.bytes&&rawHash(bytes)===a.rawSha256,'RECOVERY_ARCHIVE_DRIFT');
    }
    verified.push(proof);
  }
  must(same(verified[1].parent,PROOFS[0]),'RECOVERY_PROOF_CHAIN');
  const a=JSON.parse(await readFile('F:/ChatGPT_workshop/techlong-w9i-metadata-read-20261025-b.result.json','utf8')),
    t=JSON.parse(await readFile('F:/ChatGPT_workshop/techlong-w9j-template-branch-read-20261025-a.result.json','utf8'));
  must(a.finishedAt===verified[0].finishedAt&&t.finishedAt===verified[1].finishedAt&&
    a.outcome==='BOUNDED_PUBLICATION_METADATA_READ_COMPLETE'&&t.template.stage==='Original'&&t.template.stackId===t.templateMetadata.stackId,'RECOVERY_READ_RESULTS');
  const x=a.metadata,r=x.workerRole,b=x.managedPolicies[0];
  const source={Account:x.source.Account,Arn:x.source.Arn,UserId:x.source.UserId};
  const baseline={proofs:PROOFS,observedAt:a.finishedAt,supplementalAt:t.finishedAt,source,template:t.template.body,
    resources:x.managementStack.resources.map(v=>({logicalId:v.logicalId,type:v.type,physicalId:v.physicalId})).sort((a,b)=>a.logicalId.localeCompare(b.logicalId)),
    iam:{roleId:r.id,arn:r.arn,name:r.name,trust:r.trust,attached:r.attached,inline:r.inline.map(v=>({name:v.name,document:v.document})),
      boundary:{arn:b.arn,policyId:b.id,defaultVersion:b.defaultVersion,documentSha256:b.sha256,document:b.document}},
    branchRule:{id:t.branchRules.branch_policies[0].id,name:t.branchRules.branch_policies[0].name,type:t.branchRules.branch_policies[0].type},
    workflowIds:{caller:x.github.caller.id,reusable:x.github.reusable.id}};
  must(x.github.caller.path===Q.caller&&x.github.reusable.path===Q.reusable&&hash(t.template.body)===t.template.canonicalSha256,'RECOVERY_TARGET_PATHS');
  validateBaseline(baseline);return baseline;
}
