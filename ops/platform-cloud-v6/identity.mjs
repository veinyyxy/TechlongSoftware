import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {CLOUD_V6 as C,S,must,commit,digest,keys,obj,exactRunV6} from './contract.mjs';
export async function identityProofV6(env,senderId) {
  must(env.GITHUB_ACTIONS==='true' && env.GITHUB_REPOSITORY===S.repository && env.GITHUB_REPOSITORY_ID===S.repositoryId &&
    env.GITHUB_REPOSITORY_OWNER_ID===S.ownerId && env.GITHUB_ACTOR_ID===S.candidateBotId && String(senderId)===S.candidateBotId &&
    env.GITHUB_ACTOR===C.actorLogin && env.GITHUB_TRIGGERING_ACTOR===C.actorLogin && env.GITHUB_REF==='refs/heads/main' &&
    env.GITHUB_EVENT_NAME==='workflow_dispatch' && env.GITHUB_RUN_ATTEMPT==='1' && /^[1-9][0-9]{0,15}$/.test(env.GITHUB_RUN_ID) &&
    commit(env.GITHUB_SHA) && env.GITHUB_SHA===env.TECHLONG_IDENTITY_SOURCE && commit(env.TECHLONG_IDENTITY_FROZEN_SOURCE) && digest(env.TECHLONG_IDENTITY_NONCE) &&
    env.GITHUB_WORKFLOW_REF===`${S.repository}/.github/workflows/${C.identityWorkflow}@refs/heads/main` &&
    !['ACTIONS_ID_TOKEN_REQUEST_TOKEN','ACTIONS_ID_TOKEN_REQUEST_URL','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN',
      'TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].some(k=>env[k]) &&
    env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','CONTROL_V6_IDENTITY_CONTEXT');
  const body={schema:'techlong/platform-app-identity/v6',appId:S.appId,installationId:S.installationId,
    repositoryId:S.repositoryId,ownerId:S.ownerId,actorId:S.candidateBotId,senderId:String(senderId),
    actor:C.actorLogin,runId:env.GITHUB_RUN_ID,runAttempt:1,sourceCommit:env.GITHUB_SHA,frozenSourceCommit:env.TECHLONG_IDENTITY_FROZEN_SOURCE,nonce:env.TECHLONG_IDENTITY_NONCE,
    workflowFile:C.identityWorkflow,awsCalls:0,oidcRequested:false,privateKeyRead:false,deploymentPerformed:false};
  return {...body,proofSha256:await sha256Hex(body)};
}
export async function verifyIdentityProofV6(proof,run,expected) {
  keys(obj(expected),['nonce','sourceCommit','frozenSourceCommit','workflowId','runId']);
  must(digest(expected.nonce) && commit(expected.sourceCommit),'CONTROL_V6_IDENTITY_EXPECTED');
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:S.repository,GITHUB_REPOSITORY_ID:S.repositoryId,GITHUB_REPOSITORY_OWNER_ID:S.ownerId,
    GITHUB_ACTOR_ID:S.candidateBotId,GITHUB_ACTOR:C.actorLogin,GITHUB_TRIGGERING_ACTOR:C.actorLogin,GITHUB_REF:'refs/heads/main',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:expected.runId,GITHUB_SHA:expected.sourceCommit,
    TECHLONG_IDENTITY_SOURCE:expected.sourceCommit,TECHLONG_IDENTITY_FROZEN_SOURCE:expected.frozenSourceCommit,TECHLONG_IDENTITY_NONCE:expected.nonce,
    GITHUB_WORKFLOW_REF:`${S.repository}/.github/workflows/${C.identityWorkflow}@refs/heads/main`};
  const rebuilt=await identityProofV6(env,S.candidateBotId);
  must(JSON.stringify(proof)===JSON.stringify(rebuilt) || await sha256Hex(proof)===await sha256Hex(rebuilt),'CONTROL_V6_IDENTITY_PROOF');
  exactRunV6(run,{...expected,workflowFile:C.identityWorkflow});
  return {state:'EXACT_APP_ACTOR_RUN_VERIFIED_NOT_AWS_AUTHORIZATION',proofSha256:proof.proofSha256,actorId:S.candidateBotId,
    runId:expected.runId,sourceCommit:expected.sourceCommit,canDeploy:false};
}
async function main() {
  // Only a separately published/approved identity workflow calls this entry.
  const eventPath=process.env.GITHUB_EVENT_PATH;
  must(typeof eventPath==='string','CONTROL_V6_EVENT');
  const raw=await readFile(eventPath,'utf8');must(Buffer.byteLength(raw)<32000,'CONTROL_V6_EVENT_SIZE');
  const event=JSON.parse(raw),proof=await identityProofV6(process.env,event.sender?.id);
  must(event.inputs?.nonce===proof.nonce && event.inputs?.sourceCommit===proof.sourceCommit,'CONTROL_V6_EVENT_INPUTS');
  const output=path.join(process.env.RUNNER_TEMP,'platform-app-identity-v6.json');
  await writeFile(output,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(proof));
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(()=>{console.error('CONTROL_V6_IDENTITY_STOPPED_NO_RETRY');process.exitCode=1;});
