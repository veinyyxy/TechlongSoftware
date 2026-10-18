// Pure exact release renderer; no GitHub, AWS or local Git mutation.
import { foundationTemplateV5, workerTrustV5, INSTALL_SCOPE_V5 as I } from '../install/plan-v5.mjs';
import { INSTALLED_SHA_V5, ROOT_CLOSURE_V5 } from './runtime-v5.mjs';
export const ACTIVATION_V5 = Object.freeze({ environment: I.environment,ownerId: 14145707,
  caller: I.caller,reusable: I.reusable,installationSha256: INSTALLED_SHA_V5,rootClosureSha256: ROOT_CLOSURE_V5,
  bindingFile: 'ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json',
  evidenceBucket: 'techlong-sandbox-cloud-worker-evidence-402010193138',
  bindingKey: 'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/installation/' + INSTALLED_SHA_V5 + '.json',
  riskFile: 'docs/aws-auto-deployment-cloud-worker-w5f-activation.md',
  slot: 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-activation-v1.permanent-slot.json' });
const must = v => { if (!v) throw Error('ACTIVATION_RENDER_INPUT'); };
export const ENVIRONMENT_BODY_V5 = Object.freeze({ wait_timer: 0,prevent_self_review: false,can_admins_bypass: false,
  reviewers: [{ type: 'User',id: 14145707 }],deployment_branch_policy: { protected_branches: false,custom_branch_policies: true } });
export const BRANCH_BODY_V5 = Object.freeze({ name: 'main',type: 'branch' });
const names = ['mode','job','installation','installationSha','manifest','manifestSha','execution','lineage'];
export function renderPinnedJobV5(sourceCommit) {
  must(/^[a-f0-9]{40}$/.test(sourceCommit));
  return `name: Pinned reviewed cloud worker job
on:
  workflow_call:
    inputs:
${names.map(k => '      ' + k + ': { type: string, ' + (['mode','installation','installationSha'].includes(k) ? 'required: true' : "default: ''") + ' }').join('\n')}
permissions:
  contents: read
  id-token: write
jobs:
  single:
    if: github.repository_id == '1323312747' && github.repository_owner_id == '14145707' && github.actor_id == '14145707' && github.ref == 'refs/heads/main' && github.run_attempt == 1 && github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-24.04
    timeout-minutes: 65
    environment: techlong-sandbox-deploy
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          ref: ${sourceCommit}
          persist-credentials: false
      - name: Require the frozen reviewed source, not caller main
        run: test "$(git rev-parse HEAD)" = '${sourceCommit}'
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: '22.19.0'
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm ci --prefix ops/cloud-worker --ignore-scripts --no-audit --no-fund
      - name: One explicit mode, no fall-through or public private-data artifact
        run: node --experimental-strip-types ops/cloud-worker/activation/runtime-v5.mjs
        env:
          TECHLONG_FROZEN_SOURCE_COMMIT: ${sourceCommit}
          TECHLONG_EXPECTED_INSTALLATION_SHA: ${INSTALLED_SHA_V5}
${names.map(k => '          TECHLONG_INPUT_' + k.toUpperCase() + ': ${{ inputs.' + k + ' }}').join('\n')}
`;
}
export function renderPinnedCallerV5(reusableCommit) {
  must(/^[a-f0-9]{40}$/.test(reusableCommit));
  return `name: Reviewed single held-job deployment
on:
  workflow_dispatch:
    inputs:
      mode:
        type: choice
        options: [VerifyInstall, Review, RunOnce, Inspect]
        default: VerifyInstall
        required: true
      job: { type: string, default: '' }
      installation:
        description: Exact versioned public installation reference from the reviewed publication ACK
        type: string
        required: true
      manifest: { type: string, default: '' }
      manifestSha: { type: string, default: '' }
      execution: { type: string, default: '' }
      lineage: { type: string, default: '' }
permissions:
  contents: read
  id-token: write
concurrency:
  group: single-techlong-sandbox-cloud-worker-v5
  cancel-in-progress: false
jobs:
  reviewed:
    if: github.ref == 'refs/heads/main' && github.run_attempt == 1 && github.actor_id == '14145707'
    uses: veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@${reusableCommit}
    with:
      installationSha: '${INSTALLED_SHA_V5}'
${names.filter(k => k !== 'installationSha').map(k => '      ' + k + ': ${{ inputs.' + k + ' }}').join('\n')}
`;
}
export function activationTemplateV5(capsule,reusableCommit) {
  const t = foundationTemplateV5(capsule), trust = workerTrustV5(reusableCommit);
  trust.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:actor_id'] = '14145707';
  t.Resources.WorkerRole.Properties.AssumeRolePolicyDocument = trust; return t;
}
export function verifyEnvironmentV5(e,branches) {
  const rules = e?.protection_rules, reviewers = rules?.find(r => r.type === 'required_reviewers');
  must(e?.name === I.environment && e.can_admins_bypass === false && e.deployment_branch_policy?.protected_branches === false &&
    e.deployment_branch_policy.custom_branch_policies === true && Array.isArray(rules) && rules.length >= 2 && rules.length <= 3 &&
    new Set(rules.map(r => r.type)).size === rules.length && rules.every(r => ['branch_policy','required_reviewers'].includes(r.type) || r.type === 'wait_timer' && r.wait_timer === 0) &&
    rules.some(r => r.type === 'branch_policy') && reviewers?.prevent_self_review === false && reviewers.reviewers?.length === 1 &&
    reviewers.reviewers[0].type === 'User' && reviewers.reviewers[0].reviewer?.id === 14145707 &&
    branches?.total_count === 1 && branches.branch_policies?.length === 1 && branches.branch_policies[0].name === 'main' &&
    branches.branch_policies[0].type === 'branch');
  return { environmentId: e.id,requiredReviewerId: 14145707,adminBypass: false,mainBranchOnly: true };
}
