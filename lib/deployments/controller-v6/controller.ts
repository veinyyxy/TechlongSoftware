import { CONTROL_SCOPE, ControlError, digest, effects, must, obj, releaseReady, validatePlan,
  type Action, type ControlPlan, type ReleaseBinding } from './contract.ts';
import type { GitHubController, RunAck, RunObservation } from './github.ts';

export interface LedgerEntry { plan: ControlPlan; planSha256: string; actionSha256: string; riskSha256: string;
  attempt: null | {state:string;runId:string|null;status:string|null;conclusion:string|null;proofSha256:string|null} }
export interface ControlLedger {
  load(sha: string): Promise<LedgerEntry>;
  begin(sha: string, action: string, risk: string, admin: string): Promise<void>;
  assertLive(sha: string): Promise<void>;
  acknowledge(sha: string, ack: RunAck): Promise<void>;
  unknown(sha: string): Promise<void>;
  observe(sha: string, observation: RunObservation): Promise<void>;
  status(): Promise<unknown[]>;
}
export function createPlatformController(deps: { enabled: () => boolean; release: ReleaseBinding;
  ledger: () => ControlLedger; github: () => GitHubController; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const enabled = () => deps.enabled() && releaseReady(deps.release);
  const gate = () => must(enabled(),'CONTROL_NOT_ACTIVATED');
  return {
    async status(instanceId: string) {
      if (instanceId !== CONTROL_SCOPE.instanceId || !enabled()) return { enabled:false, plans:[], canApproveEnvironment:false, canRetry:false };
      return { enabled:true, plans:(await deps.ledger().status()).map(projectStatus), canApproveEnvironment:false, canRetry:false };
    },
    async act(instanceId: string, admin: string, action: Action) {
      gate(); must(instanceId === CONTROL_SCOPE.instanceId && /^usr_[a-f0-9]{24}$/.test(admin),'CONTROL_SCOPE');
      const ledger = deps.ledger(), entry = await ledger.load(action.planSha256);
      // Expired plans may be observed, but never submitted; validation checks the
      // immutable structure at its original instant for the observation path.
      const valid = await validatePlan(entry.plan,deps.release,action.operation === 'observe' ? entry.plan.preparedAt : now());
      must(valid.planSha256 === action.planSha256 && entry.planSha256 === valid.planSha256 &&
        entry.actionSha256 === valid.actionSha256 && entry.riskSha256 === valid.plan.riskSha256,'CONTROL_LEDGER_BINDING');
      if (action.operation === 'observe') {
        must(entry.attempt && ['ACKNOWLEDGED','OBSERVED'].includes(entry.attempt.state) && entry.attempt.runId,'CONTROL_NO_EXACT_RUN');
        const observation = await deps.github().observe(valid.plan,entry.attempt.runId);
        await ledger.observe(action.planSha256,observation);
        return { outcome:'RUN_OBSERVED_NOT_DEPLOYMENT_ATTESTATION',...observation,canRetry:false };
      }
      must(action.actionSha256 === valid.actionSha256 && action.riskSha256 === entry.riskSha256 && entry.attempt === null,'CONTROL_APPROVAL_MISMATCH');
      // Atomically store human approval and the permanent submission intent.
      // Failure here stops before any private key, token or network access.
      await ledger.begin(action.planSha256,action.actionSha256,action.riskSha256,admin);
      try {
        const ack = await deps.github().dispatch(valid.plan,async () => {
          gate(); await validatePlan(valid.plan,deps.release,now()); await ledger.assertLive(action.planSha256);
        },ack => ledger.acknowledge(action.planSha256,ack));
        return {outcome:'DISPATCH_ACKNOWLEDGED_REQUIRES_HUMAN_ENVIRONMENT_APPROVAL',...ack,canRetry:false};
      } catch {
        // Conditional only: never overwrite an ACK that may have committed.
        try { await ledger.unknown(action.planSha256); } catch { /* independent readback required */ }
        throw new ControlError('CONTROL_REQUIRES_READBACK_NO_RETRY',503);
      }
    },
  };
}
export function projectStatus(raw: unknown) {
  const v = obj(raw);
  must(digest(v.planSha256) && digest(v.actionSha256) && digest(v.riskSha256) &&
    typeof v.jobId === 'string' && /^job_[a-f0-9]{24}$/.test(v.jobId) && ['Review','RunOnce','Inspect'].includes(String(v.mode)) &&
    typeof v.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(v.sourceCommit) && Number.isSafeInteger(v.expiresAt) &&
    ['AWAITING_APPROVAL','SUBMISSION_STARTED','ACKNOWLEDGED','UNKNOWN','OBSERVED','SLOT_OCCUPIED','EXPIRED'].includes(String(v.state)) &&
    (v.runId === null || typeof v.runId === 'string' && /^[1-9][0-9]{0,15}$/.test(v.runId)), 'CONTROL_STATUS_UNAVAILABLE',503);
  return {planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:v.riskSha256,jobId:v.jobId,
    mode:v.mode as ControlPlan['mode'],sourceCommit:v.sourceCommit,expiresAt:Number(v.expiresAt),state:String(v.state),
    runId:v.runId as string|null,url:v.runId ? `https://github.com/${CONTROL_SCOPE.repository}/actions/runs/${v.runId}` : null,
    status:typeof v.status === 'string' && ['queued','requested','waiting','pending','in_progress','completed'].includes(v.status) ? v.status : null,
    conclusion:typeof v.conclusion === 'string' && ['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure'].includes(v.conclusion) ? v.conclusion : null,
    evidenceAttested:digest(v.proofSha256),effects:effects(v.mode as ControlPlan['mode']),
    deploymentVerified:false,canRetry:false};
}
export type ControllerView = Awaited<ReturnType<ReturnType<typeof createPlatformController>['status']>>;
