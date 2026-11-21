import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";

export const FIRST_OPEN_TTL_SECONDS = 7200;
export const FIRST_OPEN_CLEANUP_RESERVE_MS = 5 * 60_000;
const FIRST_OPEN_EXECUTION_RESERVE_MS = 10 * 60_000;
export const FIRST_OPEN_CELL_STACK = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1";

export interface FirstOpenControlledWindow {
  startAt: number;
  claimBefore: number;
  workloadExpiresAt: number;
  factsExpireAt: number;
  cleanupReviewSha256: string;
  cleanupPermissionsEvidenceSha256: string;
}

export type FirstOpenExecutionWindow = Readonly<FirstOpenControlledWindow & { writeBefore: number }>;

/** The existing one-shot approval binds these numbers; accepting a window is
 * not itself proof of human approval or authority to start a workload. */
export function firstOpenExecutionWindow(jobId: string, writeBefore: number, window?: FirstOpenControlledWindow) {
  if (jobId !== FIRST_OPEN_BASELINE_BINDING.jobId && window === undefined) return undefined;
  if (jobId !== FIRST_OPEN_BASELINE_BINDING.jobId || !window ||
    ![window.startAt, window.claimBefore, window.workloadExpiresAt, window.factsExpireAt, writeBefore].every(Number.isSafeInteger) ||
    window.startAt <= 0 || window.startAt % 1000 !== 0 ||
    window.startAt >= window.claimBefore || writeBefore - window.claimBefore < FIRST_OPEN_EXECUTION_RESERVE_MS ||
    window.workloadExpiresAt !== window.startAt + FIRST_OPEN_TTL_SECONDS * 1000 ||
    writeBefore > Math.min(window.startAt + 60 * 60_000, window.workloadExpiresAt - FIRST_OPEN_CLEANUP_RESERVE_MS, window.factsExpireAt) ||
    ![window.cleanupReviewSha256, window.cleanupPermissionsEvidenceSha256].every(x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x))) {
    throw Error("FIRST_ONBOARDING_CONTROLLED_WINDOW_INVALID");
  }
  return Object.freeze({ ...window, writeBefore });
}

export function assertFirstOpenClaimTime(window: FirstOpenExecutionWindow, now: number) {
  if (!Number.isSafeInteger(now) || now < window.startAt || now >= window.claimBefore) {
    throw Error("FIRST_ONBOARDING_CLAIM_WINDOW_CLOSED");
  }
}
