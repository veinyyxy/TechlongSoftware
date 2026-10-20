// Prepare unreachable Git objects and a trust-only proposal; NEVER push/execute.
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cloudWorkflowsV6} from '../platform-cloud-v6/workflows.mjs';
import {CLOUD_V6 as C,S} from '../platform-cloud-v6/contract.mjs';
import {git,P} from '../platform-identity-review-v6/publication.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {platformClosureV6} from '../platform-cloud-v6/closure.mjs';
export const FROZEN_V6=Object.freeze({sourceCommit:'ca2b38d8c756dd8fb800a88ded596c93687f278f',
  closureSha256:'828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a',
  identityProofSha256:'1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca',
  stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5',
  oldReusable:'7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c'});
const must=v=>{if(!v)throw Error('ACTIVATION_PUBLICATION_MATERIAL');};
export function appTrustOnlyTemplateV6(template,reusableCommit){
  must(/^[a-f0-9]{40}$/.test(reusableCommit));const t=structuredClone(template),role=t.Resources?.WorkerRole;
  must(role?.Type==='AWS::IAM::Role'&&role.Properties.RoleName==='TechlongSandboxGitHubDeploymentWorkerRole');
  const trust=role.Properties.AssumeRolePolicyDocument;
  const expected={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:'arn:aws:iam::402010193138:oidc-provider/token.actions.githubusercontent.com'},
    Action:'sts:AssumeRoleWithWebIdentity',Condition:{StringEquals:{
      'token.actions.githubusercontent.com:actor_id':S.ownerId,'token.actions.githubusercontent.com:aud':'sts.amazonaws.com',
      'token.actions.githubusercontent.com:environment':C.environment,
      'token.actions.githubusercontent.com:job_workflow_ref':`${S.repository}/.github/workflows/cloud-worker-job.yml@${FROZEN_V6.oldReusable}`,
      'token.actions.githubusercontent.com:ref':'refs/heads/main','token.actions.githubusercontent.com:repository_id':S.repositoryId,
      'token.actions.githubusercontent.com:repository_owner_id':S.ownerId,'token.actions.githubusercontent.com:sub':C.oidcSubject}}}]};
  must(canonicalJson(trust)===canonicalJson(expected));
  const eq=trust.Statement[0].Condition.StringEquals;
  eq['token.actions.githubusercontent.com:actor_id']=S.candidateBotId;
  eq['token.actions.githubusercontent.com:job_workflow_ref']=`${S.repository}/.github/workflows/${C.reusableWorkflow}@${reusableCommit}`;
  const restored=structuredClone(t);
  restored.Resources.WorkerRole.Properties.AssumeRolePolicyDocument=structuredClone(expected);
  must(canonicalJson(restored)===canonicalJson(template));
  return {template:t,changes:[{claim:'actor_id',before:S.ownerId,after:S.candidateBotId},
    {claim:'job_workflow_ref',before:expected.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref'],
      after:eq['token.actions.githubusercontent.com:job_workflow_ref']}],permissionsAndAllOtherResourcesUnchanged:true};
}
export async function prepareAppPublicationObjectsV6({parent,output,template,now=Date.now()}){
  must(/^[a-f0-9]{40}$/.test(parent)&&(await git(['rev-parse','HEAD'])).trim()===parent&&
    (await git(['branch','--show-current'])).trim()==='main'&&(await git(['status','--porcelain'])).trim()==='');
  const archived=JSON.parse(await readFile(P.root+'/ops/aws-sandbox/reviews/platform-cloud-v6.verified.json','utf8')),
    identity=JSON.parse(await readFile(P.root+'/ops/aws-sandbox/reviews/platform-identity-dispatch-v6.executed.json','utf8')),
    closure=await platformClosureV6();
  must(archived.sourceCommit===FROZEN_V6.sourceCommit&&archived.conclusion==='success'&&archived.status==='completed'&&
    archived.unchangedClosures.v6Sha256===FROZEN_V6.closureSha256&&closure.closureSha256===FROZEN_V6.closureSha256&&closure.pinCount===81&&
    identity.frozenSourceCommit===FROZEN_V6.sourceCommit&&identity.artifact.proofSha256===FROZEN_V6.identityProofSha256&&
    identity.independentInspection.conclusion==='success'&&identity.realAppDispatchActorVerified===true&&
    (await git(['diff','--name-only',FROZEN_V6.sourceCommit,parent,'--',...closure.pins.map(p=>p.file)])).trim()==='');
  const caller='.github/workflows/'+S.workflowFile,reusable='.github/workflows/'+C.reusableWorkflow;
  for(const file of [caller,reusable]){
    must((await git(['ls-files','--',file])).trim()==='');
    try{await access(P.root+'/'+file);must(false);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const env={GIT_INDEX_FILE:output+'/publication.index',GIT_AUTHOR_DATE:new Date(now).toISOString(),GIT_COMMITTER_DATE:new Date(now).toISOString()};
  await git(['read-tree',parent],{env});
  const make=async(file,text,base)=>{
    const blob=(await git(['hash-object','-w','--stdin'],{input:text})).trim();
    await git(['update-index','--add','--cacheinfo','100644,'+blob+','+file],{env});
    const tree=(await git(['write-tree'],{env})).trim();
    const commit=(await git(['commit-tree',tree,'-p',base],{env,input:'feat(deployments): prepared App V6 workflow (not published)\n'})).trim();
    must(/^[a-f0-9]{40}$/.test(commit)&&(await git(['show',commit+':'+file])).replaceAll('\r\n','\n')===text);
    return {file,parent:base,commit,tree,blob,normalizedLfSha256:createHash('sha256').update(text).digest('hex')};
  };
  // Reusable text contains no literal of its own future commit. Seed with a
  // real frozen source commit, then verify identical text using the actual R.
  const first=cloudWorkflowsV6({...FROZEN_V6,reusableCommit:FROZEN_V6.sourceCommit});
  const r=await make(reusable,first.reusable,parent),actual=cloudWorkflowsV6({...FROZEN_V6,reusableCommit:r.commit});
  must(first.reusable===actual.reusable);const s=await make(caller,actual.caller,r.commit);
  must((await git(['diff','--name-only',parent,s.commit])).trim().split(/\r?\n/).sort().join(',')===[caller,reusable].sort().join(',')&&
    (await git(['rev-parse','HEAD'])).trim()===parent&&(await git(['status','--porcelain'])).trim()==='');
  const trust=appTrustOnlyTemplateV6(template,r.commit);
  const result={schema:'techlong/platform-app-publication-material/v6',state:'PREPARED_NOT_APPROVED_NOT_PUBLISHED',parent,
    frozen:FROZEN_V6,reusable:r,caller:s,trust,branchesCreated:0,mainMoved:false,remoteWrites:0,awsWrites:0,
    pushRefspec:s.commit+':refs/heads/main',requiresFreshPublicationApproval:true,workflowId:'RESOLVE_AFTER_REVIEWED_PUBLICATION_NOT_GUESSED',
    platformAndPublisherBindingsRemainUnpublished:true};
  await writeFile(output+'/publication-material.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',flush:true});return result;
}
