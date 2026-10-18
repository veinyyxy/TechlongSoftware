import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { sha256Hex,canonicalJson } from '../lib/deployments/execution/hash.ts';
import { renderPinnedJobV5,renderPinnedCallerV5,activationTemplateV5,verifyEnvironmentV5,ACTIVATION_V5 as A } from '../ops/cloud-worker/activation/release-v5.mjs';
import { validateActivationRunV5,verifyCloudInstalledV5,ROOT_CLOSURE_V5,INSTALLED_SHA_V5 } from '../ops/cloud-worker/activation/runtime-v5.mjs';
import { prepareActivationV5,activateV5,assertActivationApprovalV5,verifyActivationChangeSetV5,ACTIVATION_EFFECTS_V5 } from '../ops/cloud-worker/activation/plan-v5.mjs';
import { ActivationAssertionErrorV5,safeActivationFailureV5 } from '../ops/cloud-worker/activation/errors-v5.mjs';
import { mainActivationV5 } from '../ops/cloud-worker/activation/run-activation-v5.mjs';
import { foundationTemplateV5 } from '../ops/cloud-worker/install/plan-v5.mjs';
const capsule = JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8'));
const binding = JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json',import.meta.url),'utf8'));
const now = 1800000000000,source = { commit: 'a'.repeat(40),runtimeCommit: 'b'.repeat(40),files: [{ file: 'test',normalizedLfSha256: 'f'.repeat(64) }] },
  release = { sourceCommit: source.commit,runtimeCommit: source.runtimeCommit,reusable: { commit: 'c'.repeat(40) },caller: { commit: 'd'.repeat(40) } },
  history = { executionVerified: true },run = { repository: 'veinyyxy/TechlongSoftware',runId: '12345',runAttempt: 1,commitSha: source.commit };
const who = { Account: '402010193138',Arn: 'arn:aws:sts::402010193138:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-12345-1',
  UserId: 'AROAV3GNMXTZK5O45RG24:Deploy-12345-1' };
function environment() {
  return [{ id: 123,name: A.environment,can_admins_bypass: false,deployment_branch_policy: { protected_branches: false,custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers',prevent_self_review: false,reviewers: [{ type: 'User',reviewer: { id: 14145707 } }] },{ type: 'branch_policy' }] },
  { total_count: 1,branch_policies: [{ id: 1,name: 'main',type: 'branch' }] }];
}
function prestate() {
  return { finishedAt: now,installed: { foundation: { roleId: binding.roleId,tableId: binding.tableId,lockedTrustVerified: true },metadata: { aws: {
    preservedIam: { iamLayoutUnchanged: true },source: { Arn: 'arn:aws:iam::402010193138:user/techlong-sandbox-dev',Account: '402010193138',UserId: 'AIDAV3GNMXTZEO7SHLC2X' } } } },
  installedProof: { lockedTrustVerified: true },github: { repository: { id: 1323312747,owner: { id: 14145707 },visibility: 'public',default_branch: 'main',permissions: { admin: true } },
    actor: { id: 14145707 },main: source.commit,environments: { total_count: 0,environments: [] },
    oidcSubject: { use_default: true,use_immutable_subject: true,sub_claim_prefix: 'repo:veinyyxy@14145707/TechlongSoftware@1323312747' } },
  currentInstallationSha256: INSTALLED_SHA_V5,bindingObjectAbsent: true };
}
async function fixture() {
  const p = prestate(),m = await prepareActivationV5({ source,history,release,binding,capsule,prestate: p,now }),events = [],records = [];
  let occupied = false,fail,guard,label = 'Setup'; const count = {};
  const call = async name => { await guard(); label = name; events.push(name); count[name] = (count[name] ?? 0) + 1;
    if (fail === name) throw new ActivationAssertionErrorV5('ONLY_WORKER_TRUST_CHANGE'); return { acknowledged: true }; };
  const io = {
    async preflight() { events.push('preflight'); return p; },async consumeSlot() { assert.equal(occupied,false); occupied = true; events.push('slot'); },
    setGuard: f => { guard = f; },record: async (name,value) => records.push({ name,value }),checkpoint: () => label,counts: () => ({ ...count }),
    createEnvironment: () => call('env'),createBranchPolicy: () => call('branch'),publishBinding: () => call('binding'),
    publishRelease: () => call('release'),createChangeSet: () => call('create'),executeChangeSet: () => call('execute'),inspectActivated: () => call('inspect'),
  };
  return { p,m,events,records,count,io,failAt: name => { fail = name; },
    run: () => activateV5({ manifest: m,approvedSha256: m.manifestSha256,source,history,release,binding,capsule,io,now: () => now }) };
}
test('released reusable pins BOTH immutable runtime code and immutable actions; only manual caller has four explicit modes', () => {
  const job = yaml.load(renderPinnedJobV5(source.runtimeCommit)),caller = yaml.load(renderPinnedCallerV5(release.reusable.commit));
  assert.equal(job.jobs.single.environment,A.environment); assert.equal(job.jobs.single.steps[0].with.ref,source.runtimeCommit);
  assert.equal(job.jobs.single.steps[0].with['persist-credentials'],false);
  assert.equal(caller.jobs.reviewed.uses,'veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@' + release.reusable.commit);
  assert.deepEqual(Object.keys(caller.on),['workflow_dispatch']); assert.equal(caller.on.workflow_dispatch.inputs.mode.default,'VerifyInstall');
  assert.deepEqual(caller.on.workflow_dispatch.inputs.mode.options,['VerifyInstall','Review','RunOnce','Inspect']);
  assert.ok(!renderPinnedJobV5(source.runtimeCommit).includes('ref: ${{ github.sha }}'));
  assert.match(renderPinnedJobV5(source.runtimeCommit),/test "\$\(git rev-parse HEAD\)" =/);
  assert.doesNotMatch(renderPinnedJobV5(source.runtimeCommit),/upload-artifact|secrets: inherit|configure-aws-credentials/);
  assert.throws(() => renderPinnedJobV5('main')); assert.throws(() => renderPinnedCallerV5('main'));
});
test('template changes only WorkerRole trust; preserves boundary/inline/table/bucket and adds exact actor + reusable binding', () => {
  const old = foundationTemplateV5(capsule),t = activationTemplateV5(capsule,release.reusable.commit);
  const trust = t.Resources.WorkerRole.Properties.AssumeRolePolicyDocument,conditions = trust.Statement[0].Condition.StringEquals;
  assert.equal(trust.Statement[0].Effect,'Allow'); assert.equal(conditions['token.actions.githubusercontent.com:actor_id'],'14145707');
  assert.equal(conditions['token.actions.githubusercontent.com:repository_id'],'1323312747');
  assert.equal(conditions['token.actions.githubusercontent.com:ref'],'refs/heads/main');
  assert.equal(conditions['token.actions.githubusercontent.com:job_workflow_ref'],'veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@' + release.reusable.commit);
  t.Resources.WorkerRole.Properties.AssumeRolePolicyDocument = old.Resources.WorkerRole.Properties.AssumeRolePolicyDocument;
  assert.deepEqual(t,old);
});
test('one owner reviewer, no admin bypass, main branch not tag: unknown or weaker environment stops', () => {
  assert.equal(verifyEnvironmentV5(...environment()).mainBranchOnly,true);
  const z = environment(); z[0].protection_rules.push({ type: 'wait_timer',wait_timer: 0 }); assert.ok(verifyEnvironmentV5(...z));
  for (const mutate of [x => { x[0].can_admins_bypass = true; },x => { delete x[0].can_admins_bypass; },
    x => { x[0].protection_rules[0].prevent_self_review = true; },x => { x[1].branch_policies[0].name = '*'; },
    x => { x[1].branch_policies[0].type = 'tag'; },x => { x[0].protection_rules[0].reviewers[0].reviewer.id = 1; }]) {
    const x = environment(); mutate(x); assert.throws(() => verifyEnvironmentV5(...x));
  }
});
test('strict ChangeSet accepts real API shape WITHOUT invented ChangeSetType echo, only non-replacing trust property', () => {
  const c = { StackId: 'stack',ChangeSetId: 'change',Status: 'CREATE_COMPLETE',ExecutionStatus: 'AVAILABLE',Changes: [{ ResourceChange: {
    Action: 'Modify',LogicalResourceId: 'WorkerRole',PhysicalResourceId: 'role',ResourceType: 'AWS::IAM::Role',Replacement: 'False',Scope: ['Properties'],
    Details: [{ Target: { Attribute: 'Properties',Name: 'AssumeRolePolicyDocument',RequiresRecreation: 'Never' },Evaluation: 'Static',ChangeSource: 'DirectModification' }] } }] };
  assert.equal(verifyActivationChangeSetV5(c,'stack','role').replacement,false);
  for (const mutate of [x => { x.NextToken = 'more'; },x => { x.Changes.push(x.Changes[0]); },x => { x.Changes[0].ResourceChange.Replacement = 'True'; },
    x => { x.Changes[0].ResourceChange.Details[0].Target.Name = 'PermissionsBoundary'; },x => { x.Changes[0].ResourceChange.Action = 'Add'; },
    x => { x.Changes[0].ResourceChange.Details[0].Evaluation = 'Dynamic'; }]) { const x = structuredClone(c); mutate(x); assert.throws(() => verifyActivationChangeSetV5(x,'stack','role')); }
});
function env() {
  const reference = JSON.stringify({ key: A.bindingKey,versionId: 'reviewed-s3-version',sha256: 'f'.repeat(64) });
  return { GITHUB_ACTIONS: 'true',GITHUB_REPOSITORY: 'veinyyxy/TechlongSoftware',GITHUB_REPOSITORY_ID: '1323312747',GITHUB_REPOSITORY_OWNER_ID: '14145707',
    GITHUB_ACTOR_ID: '14145707',GITHUB_REF: 'refs/heads/main',GITHUB_EVENT_NAME: 'workflow_dispatch',GITHUB_RUN_ATTEMPT: '1',GITHUB_SHA: source.commit,
    GITHUB_RUN_ID: run.runId,GITHUB_WORKFLOW_REF: 'veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-execute.yml@refs/heads/main',
    TECHLONG_FROZEN_SOURCE_COMMIT: source.runtimeCommit,TECHLONG_EXPECTED_INSTALLATION_SHA: INSTALLED_SHA_V5,
    TECHLONG_INPUT_MODE: 'VerifyInstall',TECHLONG_INPUT_JOB: '',TECHLONG_INPUT_INSTALLATION: reference,TECHLONG_INPUT_INSTALLATIONSHA: INSTALLED_SHA_V5,
    TECHLONG_INPUT_MANIFEST: '',TECHLONG_INPUT_MANIFESTSHA: '',TECHLONG_INPUT_EXECUTION: '',TECHLONG_INPUT_LINEAGE: '' };
}
test('before OIDC, bootstrap restricts repo/owner/actor/ref/manual attempt/closure and rejects inherited AWS or jobs in probe', () => {
  assert.equal(validateActivationRunV5(env(),{ closureSha256: ROOT_CLOSURE_V5 }).mode,'VerifyInstall');
  for (const [key,value] of [['GITHUB_REF','refs/heads/other'],['GITHUB_RUN_ATTEMPT','2'],['GITHUB_ACTOR_ID','1'],['GITHUB_EVENT_NAME','push'],
    ['AWS_ACCESS_KEY_ID','INHERITED'],['AWS_ENDPOINT_URL','https://elsewhere'],['TECHLONG_INPUT_JOB','job_' + 'a'.repeat(24)],
    ['TECHLONG_INPUT_INSTALLATIONSHA','0'.repeat(64)],['TECHLONG_INPUT_MANIFEST','{}']]) {
    const e = env(); e[key] = value; assert.throws(() => validateActivationRunV5(e,{ closureSha256: ROOT_CLOSURE_V5 }));
  }
  assert.throws(() => validateActivationRunV5(env(),{ closureSha256: '0'.repeat(64) }));
});
test('probe reads only identity -> exact binding -> fixed DB -> one readonly catalog, with no control/job/write method', async () => {
  const b = structuredClone(binding); b.neon.endpointSha256 = await sha256Hex({ host: 'ep-fixture.ca-central-1.aws.neon.tech',port: 5432,database: 'neondb',role: 'techlong_cloud_worker_v5',transport: 'NeonHTTPS' });
  delete b.installationSha256; b.installationSha256 = await sha256Hex(b);
  const events = [], url = 'postgresql://techlong_cloud_worker_v5:fixture-only@ep-fixture.ca-central-1.aws.neon.tech/neondb?sslmode=verify-full';
  const result = await verifyCloudInstalledV5({ reference: {},run,sourceCommit: source.runtimeCommit,expectedInstallationSha256: b.installationSha256,port: {
    async identity() { events.push('identity'); return who; },async binding() { events.push('binding'); return b; },
    async database(ref) { events.push('database'); assert.deepEqual(ref,b.databaseSecret); return { schema: 'techlong/cloud-worker-neon-material/v5',databaseUrl: url }; },
    async catalog(actual,expected) { events.push('catalog'); assert.equal(actual,url); assert.deepEqual(expected,b.neon); },
  } });
  assert.deepEqual(events,['identity','binding','database','catalog']); assert.equal(result.counters.databaseSecretReads,1);
  assert.equal(result.counters.catalogTransactions,1); assert.equal(result.counters.cloudWrites + result.counters.databaseWrites + result.counters.controlSecretReads,0);
  assert.equal(JSON.stringify(result).includes('fixture-only'),false); assert.equal(JSON.stringify(result).includes('postgresql://'),false);
});
test('wrong cloud role stops before binding/private read; tampered installed binding stops before database read', async () => {
  for (const identity of [who,{ ...who,UserId: 'AROA' + 'X'.repeat(17) + ':Deploy-12345-1' }]) {
    const events = [];
    await assert.rejects(verifyCloudInstalledV5({ reference: {},run,sourceCommit: source.runtimeCommit,port: {
      async identity() { return identity; },async binding() { events.push('binding'); return { ...binding,roleId: 'bad' }; },
      async database() { events.push('private'); throw Error('must not read'); },
    } }));
    assert.equal(events.includes('private'),false); if (identity !== who) assert.equal(events.length,0);
  }
});
test('fresh activation manifest binds six bounded writes, two exact release SHAs, zero dispatch/private/deployment', async () => {
  const f = await fixture(); await assertActivationApprovalV5(f.m,f.m.manifestSha256,{ source,history,capsule,binding,release,now });
  assert.deepEqual(f.m.effects,ACTIVATION_EFFECTS_V5); assert.equal(f.m.actions.release.reusable.commit,release.reusable.commit);
  assert.equal(f.m.actions.release.caller.commit,release.caller.commit); assert.equal(f.m.actions.cloudCredentialOrProbeDispatchAuthorized,false);
  assert.equal(f.m.effects.automaticWorkflowDispatch,0); assert.equal(f.m.effects.secretValueReads,0);
  assert.equal(f.m.actions.publication.ifNoneMatch,'*'); assert.equal(f.m.actions.publication.wholeDocumentSha256,await sha256Hex(binding));
});
test('expired/wrong SHA/tampered action/source/history reject before preflight or consuming the new slot', async () => {
  for (const mutate of [m => { m.expiresAt = now; },m => { m.actions.release.caller.commit = 'f'.repeat(40); },m => { m.effects.automaticWorkflowDispatch = 1; },
    m => { m.source.commit = 'f'.repeat(40); },m => { m.history.executionVerified = false; }]) {
    const f = await fixture(),m = structuredClone(f.m); mutate(m);
    await assert.rejects(activateV5({ manifest: m,approvedSha256: f.m.manifestSha256,source,history,capsule,binding,release,io: f.io,now: () => now }));
    assert.deepEqual(f.events,[]);
  }
  const f = await fixture(); await assert.rejects(activateV5({ manifest: f.m,approvedSha256: '0'.repeat(64),source,history,capsule,binding,release,io: f.io,now: () => now }));
  assert.deepEqual(f.events,[]);
});
test('pre-existing environment/object, changed main/immutable subject/actor or expired preflight fails before slot', async () => {
  for (const mutate of [p => { p.github.environments.total_count = 1; },p => { p.bindingObjectAbsent = false; },p => { p.github.main = 'f'.repeat(40); },
    p => { p.github.actor.id = 1; },p => { p.github.oidcSubject.use_immutable_subject = false; },p => { p.finishedAt = now - 30001; },
    p => { p.installedProof.lockedTrustVerified = false; }]) { const f = await fixture(); mutate(f.p); await assert.rejects(f.run()); assert.deepEqual(f.events,['preflight']); }
});
test('one new slot then environment/branch/binding/release/change-set/execution/inspect, never automatic dispatch', async () => {
  const f = await fixture(),r = await f.run(); assert.equal(r.outcome,'ACTIVATED_REQUIRES_INDEPENDENT_INSPECT_NO_DISPATCH');
  assert.deepEqual(f.events,['preflight','slot','env','branch','binding','release','create','execute','inspect']);
  assert.equal(r.workflowDispatched,false); assert.equal(r.workloadDeployed,false);
  await assert.rejects(f.run()); for (const k of ['env','branch','binding','release','create','execute']) assert.equal(f.count[k],1);
});
test('every partial failure preserves attempts, reports a fixed assertion/checkpoint and never completes later writes or rollback', async () => {
  for (const name of ['env','branch','binding','release','create','execute','inspect']) {
    const f = await fixture(); f.failAt(name); const r = await f.run();
    assert.equal(r.outcome,'ACTIVATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY'); assert.equal(r.checkpoint,name);
    assert.equal(r.failure.activationAssertion,'ONLY_WORKER_TRUST_CHANGE'); assert.equal(f.events.filter(v => v === name).length,1);
    assert.equal(f.events.at(-1),name); assert.equal(f.records.some(v => v.name === 'result'),false);
    await assert.rejects(f.run()); assert.equal(f.events.filter(v => v === name).length,1);
  }
});
test('safe errors do not copy arbitrary provider message or forged assertion field; bounded HTTP status survives', () => {
  const e = Object.assign(Error('postgresql://DO_NOT_SAVE'),{ assertion: 'SECRET',status: 403 });
  const r = safeActivationFailureV5(e); assert.equal(r.activationAssertion,null); assert.equal(r.httpStatus,403);
  assert.equal(JSON.stringify(r).includes('DO_NOT_SAVE'),false); assert.equal(JSON.stringify(r).includes('SECRET'),false);
  assert.equal(safeActivationFailureV5(new ActivationAssertionErrorV5('MAIN_OR_REMOTE_DRIFT')).activationAssertion,'MAIN_OR_REMOTE_DRIFT');
});
test('local activation API surface has no Secret values, SQL writes, direct IAM mutations, cleanup or dispatch', async () => {
  const s = await readFile(new URL('../ops/cloud-worker/activation/local-io-v5.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(s,/GetSecretValueCommand|PutSecretValueCommand|UpdateAssumeRolePolicyCommand|DeleteStackCommand|DeleteObjectCommand|workflow_dispatch/);
  assert.match(s,/DisableRollback: true/); assert.match(s,/IfNoneMatch: '\*'/); assert.match(s,/readOnly: true/);
  const commits = await readFile(new URL('../ops/cloud-worker/activation/commit-objects-v5.mjs',import.meta.url),'utf8');
  assert.match(commits,/GIT_INDEX_FILE/); assert.match(commits,/commit-tree/); assert.doesNotMatch(commits,/checkout|reset --hard|branch.*-b|force: true/);
  for (const mode of ['InstallLocked','RecoverLocked','ContinueLocked','RunOnce','Dispatch']) await assert.rejects(mainActivationV5(['--mode',mode,'--output','unused']));
  assert.equal(canonicalJson(A).includes('private-material'),false);
});
