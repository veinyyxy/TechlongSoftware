import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";

export type FirstOpenProvisionerLane = "install" | "formal-provisioner";
export type FirstOpenProvisionerPhase = "grant" | "relock";
const hex = /^[a-f0-9]{64}$/;
const suffix = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const cfn = "arn:aws:cloudformation:ca-central-1:402010193138:";
const stop = (): never => { throw Error("FIRST_OPEN_FORMAL_PROVISIONER_RECEIPT_UNPROVED"); };

export function firstOpenProvisionerChangeSetName(approvalSha256: string, lane: FirstOpenProvisionerLane, phase: FirstOpenProvisionerPhase) {
  if (!hex.test(approvalSha256) || (lane !== "install" && lane !== "formal-provisioner") || (phase !== "grant" && phase !== "relock")) return stop();
  return `fc41597f-${lane === "install" ? "install-provisioner" : "provisioner"}-${approvalSha256.slice(0, 24)}-${phase}`;
}

export type FirstOpenFormalProvisionerReceipt = {
  schema: "techlong/fc41597f-formal-provisioner-documents/v2";
  lane: "formal-provisioner";
  jobId: string;
  approvalSha256: string;
  releaseSha256: string;
  scopeSha256: string;
  phase: FirstOpenProvisionerPhase;
  exactOwnerStackArn: string;
  changeSetId: string;
  targetSha256: string;
  executedAt: number;
  checkedAt: number;
  executeAckSha256: string;
  projectionSha256: string;
  provisionerDocumentsSha256: string;
  evidenceBucketPolicySha256: string;
  evidence: "MATCHED_INSTALLED_POLICY_DOCUMENTS";
  authorizationProved: false;
};

/** Only a protected digest of the actual independent receipt may supply this
 * projection. It proves installed documents, not IAM evaluation or issuance. */
export async function matchFirstOpenFormalProvisionerReceipt(receipt: FirstOpenFormalProvisionerReceipt | undefined,
  expected: { release: FirstOpenFrozenRelease; releaseSha256: string; scopeSha256: string; phase: FirstOpenProvisionerPhase;
    exactOwnerStackArn: string; targetSha256: string; roles: readonly unknown[]; policies: readonly unknown[]; evidenceBucketPolicySha256: string }, now: number) {
  const p = structuredClone(receipt), e = structuredClone(expected), r = e.release;
  if (!p || p.schema !== "techlong/fc41597f-formal-provisioner-documents/v2" || p.lane !== "formal-provisioner" || p.phase !== e.phase ||
    p.jobId !== r.jobId || p.approvalSha256 !== r.approvalSha256 || p.releaseSha256 !== e.releaseSha256 || p.scopeSha256 !== e.scopeSha256 ||
    p.exactOwnerStackArn !== e.exactOwnerStackArn || p.targetSha256 !== e.targetSha256 ||
    p.evidenceBucketPolicySha256 !== e.evidenceBucketPolicySha256 || p.evidence !== "MATCHED_INSTALLED_POLICY_DOCUMENTS" ||
    p.authorizationProved !== false || ![p.executeAckSha256, p.projectionSha256].every(x => typeof x === "string" && hex.test(x)) ||
    ![p.executedAt, p.checkedAt, now].every(Number.isSafeInteger) || !(r.startAt <= p.executedAt && p.executedAt <= p.checkedAt &&
      p.checkedAt <= now && p.checkedAt < (e.phase === "grant" ? r.claimBefore : r.writeBefore))) return stop();
  const prefix = cfn + `changeSet/${firstOpenProvisionerChangeSetName(r.approvalSha256, "formal-provisioner", e.phase)}/`;
  if (typeof p.changeSetId !== "string" || !p.changeSetId.startsWith(prefix) || !suffix.test(p.changeSetId.slice(prefix.length)) ||
    p.executeAckSha256 !== await sha256Hex({ changeSetId: p.changeSetId, executedAt: p.executedAt, targetSha256: p.targetSha256 }) ||
    p.provisionerDocumentsSha256 !== await sha256Hex({ roles: e.roles, policies: e.policies })) return stop();
  return p;
}
