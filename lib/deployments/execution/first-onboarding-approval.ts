import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { verifyFirstOpenTaskRelease, type FirstOpenTaskRelease } from "./first-onboarding-version.ts";
import type { FirstOpenControlledWindow } from "./first-onboarding-window.ts";
import { sha256Hex } from "./hash.ts";
import type { FirstOnboardingExecutionApproval } from "./worker.ts";

export const FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF = "deferred-cleanup-proof/v1" as const;
const domain = "techlong/fc41597f-install-intent/deferred-cleanup-proof/v1";
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fail = (): never => { throw Error("FIRST_ONBOARDING_APPROVAL_BINDING"); };

export type FirstOnboardingDeferredCleanupApprovalDraft = Omit<FirstOnboardingExecutionApproval, "approvalBinding" | "controlledWindow" | "taskRelease"> & {
  approvalBinding: typeof FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF;
  taskRelease: FirstOpenTaskRelease;
  controlledWindow: Omit<FirstOpenControlledWindow, "cleanupPermissionsEvidenceSha256"> & {
    cleanupPermissionsEvidenceSha256?: string;
  };
};

type ApprovalOrDraft = FirstOnboardingExecutionApproval | FirstOnboardingDeferredCleanupApprovalDraft;

async function digestApproval(a: ApprovalOrDraft) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return fail();
  if (a.approvalBinding === undefined) return sha256Hex(a);
  const { controlledWindow, taskRelease } = a;
  if (a.approvalBinding !== FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF || a.jobId !== FIRST_OPEN_BASELINE_BINDING.jobId || !taskRelease ||
    !controlledWindow || typeof controlledWindow !== "object" || Array.isArray(controlledWindow)) return fail();
  await verifyFirstOpenTaskRelease(taskRelease).catch(fail);
  const { cleanupPermissionsEvidenceSha256, ...intentWindow } = controlledWindow;
  if (cleanupPermissionsEvidenceSha256 !== undefined && !hex(cleanupPermissionsEvidenceSha256)) return fail();
  return sha256Hex({ domain, approval: { ...a, controlledWindow: intentWindow } });
}

/** Freeze the namespace for the exact installation. A deferred intent is
 * not an executable approval; every other supplied field remains bound. */
export function firstOnboardingApprovalSha256(approvalOrDraft: ApprovalOrDraft) {
  return digestApproval(structuredClone(approvalOrDraft));
}

/** `formalApprovalSha256` must come from the separately authenticated,
 * reviewed formal record, never be inferred from the submitted approval. */
export async function verifyFirstOnboardingApprovalBinding(approval: FirstOnboardingExecutionApproval, scopeSha256: string,
  formalApprovalSha256?: string): Promise<true> {
  const a = structuredClone(approval);
  if (!hex(scopeSha256) || await digestApproval(a) !== scopeSha256) return fail();
  if (a.approvalBinding === undefined ? formalApprovalSha256 !== undefined :
    !hex(a.controlledWindow?.cleanupPermissionsEvidenceSha256) || !hex(formalApprovalSha256) || await sha256Hex(a) !== formalApprovalSha256) return fail();
  return true;
}
