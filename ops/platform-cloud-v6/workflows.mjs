// Text candidates only. Nothing writes .github/workflows or changes AWS trust.
import {CLOUD_V6 as C,S,must,commit,digest} from './contract.mjs';
const checkout='actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const node='actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
const upload='actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f';
const actor=`github.repository_id == '${S.repositoryId}' && github.repository_owner_id == '${S.ownerId}' && github.actor_id == '${S.candidateBotId}' && github.ref == 'refs/heads/main' && github.run_attempt == 1 && github.event_name == 'workflow_dispatch'`;
export function identityWorkflowV6(sourceCommit) {
  must(commit(sourceCommit),'CONTROL_V6_SOURCE_COMMIT');
  return `name: Reviewed App identity - No AWS
on:
  workflow_dispatch:
    inputs:
      nonce: {type: string, required: true}
      sourceCommit: {type: string, required: true}
permissions:
  contents: read
concurrency:
  group: techlong-platform-app-identity-v6
  cancel-in-progress: false
jobs:
  identity:
    if: ${actor}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    environment: ${C.environment}
    steps:
      - uses: ${checkout}
        with:
          ref: ${sourceCommit}
          persist-credentials: false
      - run: test "$(git rev-parse HEAD)" = '${sourceCommit}'
      - uses: ${node}
        with:
          node-version: '22.19.0'
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: node --experimental-strip-types ops/platform-cloud-v6/identity.mjs
        env:
          TECHLONG_IDENTITY_NONCE: \${{ inputs.nonce }}
          TECHLONG_IDENTITY_SOURCE: \${{ inputs.sourceCommit }}
          TECHLONG_IDENTITY_FROZEN_SOURCE: ${sourceCommit}
      - uses: ${upload}
        with:
          name: platform-app-identity-v6-\${{ github.run_id }}
          path: \${{ runner.temp }}/platform-app-identity-v6.json
          if-no-files-found: error
          retention-days: 7
          overwrite: false
`;
}
export function cloudWorkflowsV6({sourceCommit,reusableCommit,closureSha256,identityProofSha256}) {
  must(commit(sourceCommit) && commit(reusableCommit) && digest(closureSha256) && digest(identityProofSha256),'CONTROL_V6_PUBLICATION_PINS');
  const names=['mode','job','installation','manifest','manifestSha','execution','lineage'];
  const caller=`name: Reviewed platform deployment V6
on:
  workflow_dispatch:
    inputs:
      mode: {type: choice, options: [Review, RunOnce, Inspect], required: true}
${names.slice(1).map(k=>`      ${k}: {type: string, default: ''}`).join('\n')}
permissions:
  contents: read
  id-token: write
concurrency:
  group: single-techlong-sandbox-cloud-worker-v5
  cancel-in-progress: false
jobs:
  reviewed:
    if: ${actor}
    uses: ${S.repository}/.github/workflows/${C.reusableWorkflow}@${reusableCommit}
    with:
${names.map(k=>`      ${k}: \${{ inputs.${k} }}`).join('\n')}
      releaseReusableCommit: '${reusableCommit}'
`;
  const reusable=`name: Pinned platform cloud worker V6
on:
  workflow_call:
    inputs:
${names.map(k=>`      ${k}: {type: string, required: true}`).join('\n')}
      releaseReusableCommit: {type: string, required: true}
permissions:
  contents: read
  id-token: write
jobs:
  single:
    if: ${actor}
    runs-on: ubuntu-24.04
    timeout-minutes: 65
    environment: ${C.environment}
    steps:
      - uses: ${checkout}
        with:
          ref: ${sourceCommit}
          persist-credentials: false
      - run: test "$(git rev-parse HEAD)" = '${sourceCommit}'
      - uses: ${node}
        with:
          node-version: '22.19.0'
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm ci --prefix ops/cloud-worker --ignore-scripts --no-audit --no-fund
      - run: node --experimental-strip-types ops/platform-cloud-v6/run.mjs
        env:
          TECHLONG_FROZEN_SOURCE_COMMIT: ${sourceCommit}
          TECHLONG_REUSABLE_COMMIT: \${{ inputs.releaseReusableCommit }}
          TECHLONG_PLATFORM_RELEASE_STATE: PUBLISHED
          TECHLONG_PLATFORM_CLOSURE_SHA: ${closureSha256}
          TECHLONG_APP_IDENTITY_PROOF_SHA: ${identityProofSha256}
${names.map(k=>`          TECHLONG_INPUT_${k.toUpperCase()}: \${{ inputs.${k} }}`).join('\n')}
`;
  // Reusable text never embeds its own future Git SHA. The caller supplies R,
  // which is checked against GitHub's signed OIDC job_workflow_ref before STS.
  return {caller,reusable,sourceCommit,reusableCommit,closureSha256,identityProofSha256,requiresSeparateTrustApproval:true};
}
