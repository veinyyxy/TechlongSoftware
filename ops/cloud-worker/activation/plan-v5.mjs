import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { ACTIVATION_V5 as A, ENVIRONMENT_BODY_V5, BRANCH_BODY_V5, activationTemplateV5 } from './release-v5.mjs';
import { INSTALLED_SHA_V5 } from './runtime-v5.mjs';
import { requireActivationV5 as must,safeActivationFailureV5 } from './errors-v5.mjs';
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
export const ACTIVATION_EFFECTS_V5 = Object.freeze({ githubEnvironmentPut: 1,githubMainBranchPolicyCreate: 1,
  publicBindingS3Put: 1,publishPreparedMainFastForward: 1,foundationChangeSetCreate: 1,foundationChangeSetExecute: 1,
  automaticWorkflowDispatch: 0,oidcSubjectMutation: 0,iamDirectWrites: 0,secretValueReads: 0,privateBundleReads: 0,
  secretWrites: 0,neonWrites: 0,jobOrWorkloadWrites: 0,automaticWriteRetries: 0,rollbackOrCleanup: false,slotReset: false });
export function activationPrestateV5(p,source) {
  const a = p.installed?.metadata?.aws, g = p.github;
  must(p.installed?.foundation?.lockedTrustVerified === true && p.installed.foundation.roleId === 'AROAV3GNMXTZK5O45RG24' &&
    p.installed.foundation.tableId === 'ea69c69e-1c48-481a-83f0-36393c196d9f' && a?.preservedIam?.iamLayoutUnchanged === true &&
    a.source?.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' && a.source.Account === '402010193138' &&
    a.source.UserId === 'AIDAV3GNMXTZEO7SHLC2X' && p.installedProof?.lockedTrustVerified === true &&
    g?.repository?.id === 1323312747 && g.repository.owner.id === 14145707 && g.repository.visibility === 'public' && g.repository.default_branch === 'main' &&
    g.repository.permissions?.admin === true && g.actor?.id === 14145707 && g.main === source.commit && g.environments?.total_count === 0 &&
    g.environments.environments?.length === 0 && g.oidcSubject?.use_default === true && g.oidcSubject.use_immutable_subject === true &&
    g.oidcSubject.sub_claim_prefix === 'repo:veinyyxy@14145707/TechlongSoftware@1323312747' &&
    p.bindingObjectAbsent === true && p.currentInstallationSha256 === INSTALLED_SHA_V5,'LOCKED_INSTALLED_PRESTATE');
  return structuredClone({ source: { arn: a.source.Arn,userId: a.source.UserId },foundation: p.installed.foundation,installedProof: p.installedProof,
    currentInstallationSha256: p.currentInstallationSha256,github: { repositoryId: g.repository.id,ownerId: g.repository.owner.id,actorId: g.actor.id,
      main: g.main,environmentAbsent: true,oidcSubject: g.oidcSubject },bindingObjectAbsent: true });
}
export function verifyActivationChangeSetV5(c,stackId,roleName) {
  const r = c.Changes?.[0]?.ResourceChange;
  must(c.StackId === stackId && c.Status === 'CREATE_COMPLETE' && c.ExecutionStatus === 'AVAILABLE' && !c.NextToken &&
    c.Changes?.length === 1 && r?.Action === 'Modify' && r.LogicalResourceId === 'WorkerRole' &&
    r.PhysicalResourceId === roleName && r.ResourceType === 'AWS::IAM::Role' && r.Replacement === 'False' &&
    same(r.Scope,['Properties']) && r.Details?.length >= 1 && r.Details.every(d => d.Target?.Attribute === 'Properties' &&
      d.Target.Name === 'AssumeRolePolicyDocument' && d.Target.RequiresRecreation === 'Never' && d.ChangeSource === 'DirectModification' &&
      d.Evaluation === 'Static'),'ONLY_WORKER_TRUST_CHANGE');
  return { changeSetId: c.ChangeSetId,stackId,changedLogicalId: 'WorkerRole',replacement: false };
}
export async function activationActionsV5({ capsule,release,binding }) {
  const template = activationTemplateV5(capsule,release.reusable.commit);
  return { release: structuredClone(release),environment: { name: A.environment,body: ENVIRONMENT_BODY_V5,branch: BRANCH_BODY_V5 },
    publication: { bucket: A.evidenceBucket,key: A.bindingKey,ifNoneMatch: '*',encryption: 'AES256',
      installationSha256: binding.installationSha256,wholeDocumentSha256: await sha256Hex(binding) },
    foundation: { template,templateSha256: await sha256Hex(template),onlyResourceChange: 'WorkerRole.AssumeRolePolicyDocument',
      capability: 'CAPABILITY_NAMED_IAM',disableRollback: true },
    sequence: ['ConsumeNewSlot','CreateReviewedEnvironment','CreateMainBranchPolicy','PublishPublicBindingOnce',
      'FastForwardPreparedTwoCommitRelease','CreateTrustOnlyChangeSet','VerifyExactTrustOnlyChange','ExecuteChangeSetOnce','IndependentReadOnlyInspect'],
    cloudCredentialOrProbeDispatchAuthorized: false,actualWorkloadAuthorized: false };
}
export async function prepareActivationV5({ source,release,binding,capsule,prestate,history,now }) {
  must(Number.isSafeInteger(now) && source.commit === release.sourceCommit && /^[a-f0-9]{40}$/.test(source.runtimeCommit) &&
    source.runtimeCommit === release.runtimeCommit && source.files?.length > 0 && history.executionVerified === true,'SOURCE_AND_HISTORY');
  const actions = await activationActionsV5({ capsule,release,binding }), body = { schema: 'techlong/cloud-worker-activation-review/v5',
    preparedAt: now,expiresAt: now + 7200000,source: structuredClone(source),history: structuredClone(history),prestate: activationPrestateV5(prestate,source),actions,
    actionsSha256: await sha256Hex(actions),effects: ACTIVATION_EFFECTS_V5,riskFile: A.riskFile,preparationIsNotExecutionApproval: true };
  return { ...body,manifestSha256: await sha256Hex(body) };
}
export async function assertActivationApprovalV5(m,approved,{ source,history,capsule,binding,release,now }) {
  const { manifestSha256,...body } = m;
  must(/^[a-f0-9]{64}$/.test(approved) && approved === manifestSha256 && await sha256Hex(body) === approved &&
    Object.keys(body).sort().join(',') === ['actions','actionsSha256','effects','expiresAt','history','preparedAt','preparationIsNotExecutionApproval','prestate','riskFile','schema','source'].sort().join(',') &&
    m.schema === 'techlong/cloud-worker-activation-review/v5' && same(m.source,source) && same(m.history,history) &&
    same(m.actions,await activationActionsV5({ capsule,release,binding })) && m.actionsSha256 === await sha256Hex(m.actions) &&
    same(m.effects,ACTIVATION_EFFECTS_V5) && m.preparationIsNotExecutionApproval === true && m.riskFile === A.riskFile &&
    now >= m.preparedAt && now < m.expiresAt && m.expiresAt - m.preparedAt === 7200000,'FRESH_EXACT_APPROVAL');
}
export async function activateV5({ manifest: m,approvedSha256,source,history,capsule,binding,release,io,now = Date.now }) {
  const approve = () => assertActivationApprovalV5(m,approvedSha256,{ source,history,capsule,binding,release,now: now() });
  await approve(); const start = now(), p = await io.preflight(); await approve();
  must(same(activationPrestateV5(p,source),m.prestate) && now() - p.finishedAt <= 30000 && now() - start <= 180000,'FRESH_PRESTATE');
  await io.consumeSlot({ manifestSha256: m.manifestSha256,at: now(),retryAllowed: false,oldSlotsReset: false });
  let phase = 'Environment';
  const guard = async () => { await approve(); must(now() - start < 1200000,'EXECUTION_WINDOW'); };
  io.setGuard(guard);
  const step = async (name,fn) => { await guard(); phase = name; await io.record(name + '.intent',{ manifestSha256: m.manifestSha256,at: now() });
    const r = await fn(); await io.record(name + '.ack',r); return r; };
  try {
    await step('Environment',() => io.createEnvironment());
    await step('MainBranchPolicy',() => io.createBranchPolicy());
    const publication = await step('PublicBinding',() => io.publishBinding(binding));
    await step('PublishWorkflowRelease',() => io.publishRelease(release));
    const change = await step('TrustChangeSet',() => io.createChangeSet(m.actions.foundation.template,m.manifestSha256));
    await step('ExecuteTrustChangeSet',() => io.executeChangeSet(change));
    phase = 'FinalReadOnlyInspect'; const proof = await io.inspectActivated(m);
    const r = { outcome: 'ACTIVATED_REQUIRES_INDEPENDENT_INSPECT_NO_DISPATCH',manifestSha256: m.manifestSha256,publication,proof,
      counts: io.counts(),workflowDispatched: false,cloudPrivateReads: 0,workloadDeployed: false,retryAllowed: false };
    await io.record('result',r); return r;
  } catch (e) {
    const r = { outcome: 'ACTIVATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY',manifestSha256: m.manifestSha256,phase,
      checkpoint: io.checkpoint(),failure: safeActivationFailureV5(e),counts: io.counts(),retryAllowed: false,workloadDeployed: false };
    await io.record('stopped',r); return r;
  }
}
