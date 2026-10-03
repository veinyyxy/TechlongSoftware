import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  compilePreparedSharedCellAuthorCompensationManagementAction,
  type PreparedSharedCellAuthorCompensationManagementAction,
  type createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules,
} from "./aws-sdk-shared-cell-author-compensation-management.ts";
import {
  SharedCellAuthorCompensationLifecycleReceiptProducer,
} from "./shared-cell-author-compensation-grant-lifecycle.ts";
import {
  executeClaimedSharedCellAuthorCompensationPhaseGrant,
  executeClaimedSharedCellAuthorCompensationPhaseRevoke,
  recoverClaimedSharedCellAuthorCompensationPhaseGrant,
  recoverClaimedSharedCellAuthorCompensationPhaseRevoke,
  type SharedCellAuthorCompensationPhaseGrantMutationPort,
  type SharedCellAuthorCompensationPhaseRevokeMutationPort,
} from "./shared-cell-author-compensation-grant-controller.ts";

export const SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_ENTRY_DEFAULT_ENABLED = false;
export const SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_ONLINE_BLOCKERS = Object.freeze([
  "DEFAULT_RUNTIME_NOT_WIRED",
  "MIGRATIONS_0009_0010_NOT_APPLIED",
  "SPLIT_GRANT_CLOUD_APPLY_DISABLED",
  "EXACT_ARN_IAM_COMPATIBILITY_NOT_VERIFIED",
  "ONLINE_GRANT_MUTATION_REVOKE_DRILL_NOT_APPROVED",
]);

/** Local review only: no credentials, SDK clients, database, or network are constructed. */
export async function reviewSharedCellAuthorCompensationManagementAction(
  input: Parameters<typeof compilePreparedSharedCellAuthorCompensationManagementAction>[0],
) {
  const prepared = await compilePreparedSharedCellAuthorCompensationManagementAction(input);
  return Object.freeze({
    schemaVersion: 1 as const,
    stage: "B5-J5g-j5" as const,
    mode: "LOCAL_REVIEW" as const,
    onlineExecutionReady: false as const,
    blockers: Object.freeze([...SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_ONLINE_BLOCKERS,
      ...(prepared.contract.cellSafety ? [] : ["COMPENSATION_CELL_SAFETY_BINDING_REQUIRED"])]),
    prepared,
  });
}

type Runtime = ReturnType<typeof createAwsSdkSharedCellAuthorCompensationManagementRuntimeFromModules>;
type GrantInput = Omit<Parameters<typeof executeClaimedSharedCellAuthorCompensationPhaseGrant>[0], "contract" | "mutations" | "receiptProducer">;
type RevokeInput = Omit<Parameters<typeof executeClaimedSharedCellAuthorCompensationPhaseRevoke>[0], "contract" | "mutations" | "receiptProducer">;
type RecoverRevokeInput = Omit<Parameters<typeof recoverClaimedSharedCellAuthorCompensationPhaseRevoke>[0], "contract" | "receiptProducer">;

async function approved(prepared: PreparedSharedCellAuthorCompensationManagementAction, digest: string): Promise<void> {
  const body = Object.fromEntries(Object.entries(prepared).filter(([key]) => key !== "preparedActionSha256"));
  if (digest !== prepared.preparedActionSha256 || digest !== await sha256Hex(canonicalJson(body))) {
    throw new Error("The prepared management action must match its explicitly approved digest.");
  }
}

/**
 * Dormant composition seam for a separately approved future online caller.
 * It always delegates through the durable J5g-j3 controller. The current CLI
 * exposes only local review; this object is absent from default runtime wiring.
 */
export function createSharedCellAuthorCompensationManagementEntry(runtime: Runtime) {
  const receiptProducer = new SharedCellAuthorCompensationLifecycleReceiptProducer(runtime.reads);
  return Object.freeze({
    async executeGrant(prepared: PreparedSharedCellAuthorCompensationManagementAction, approvedPreparedActionSha256: string, input: GrantInput) {
      await approved(prepared, approvedPreparedActionSha256);
      if (prepared.request.kind !== "GRANT") throw new Error("Grant entry requires a GRANT action.");
      const mutations = runtime.createMutation(prepared, approvedPreparedActionSha256) as SharedCellAuthorCompensationPhaseGrantMutationPort;
      return executeClaimedSharedCellAuthorCompensationPhaseGrant({ ...input, contract: prepared.contract, receiptProducer, mutations });
    },
    async executeRevoke(prepared: PreparedSharedCellAuthorCompensationManagementAction, approvedPreparedActionSha256: string, input: RevokeInput) {
      await approved(prepared, approvedPreparedActionSha256);
      if (prepared.request.kind !== "REVOKE" || prepared.request.reason !== input.reason) throw new Error("Revoke entry requires the exact REVOKE reason.");
      const mutations = runtime.createMutation(prepared, approvedPreparedActionSha256) as SharedCellAuthorCompensationPhaseRevokeMutationPort;
      return executeClaimedSharedCellAuthorCompensationPhaseRevoke({ ...input, contract: prepared.contract, receiptProducer, mutations });
    },
    async recoverGrant(prepared: PreparedSharedCellAuthorCompensationManagementAction, approvedPreparedActionSha256: string, input: GrantInput) {
      await approved(prepared, approvedPreparedActionSha256);
      if (prepared.request.kind !== "GRANT") throw new Error("Grant recovery requires a GRANT action.");
      return recoverClaimedSharedCellAuthorCompensationPhaseGrant({ ...input, contract: prepared.contract, receiptProducer });
    },
    async recoverRevoke(prepared: PreparedSharedCellAuthorCompensationManagementAction, approvedPreparedActionSha256: string, input: RecoverRevokeInput) {
      await approved(prepared, approvedPreparedActionSha256);
      if (prepared.request.kind !== "REVOKE" || prepared.request.reason !== input.reason) throw new Error("Revoke recovery requires the exact REVOKE reason.");
      return recoverClaimedSharedCellAuthorCompensationPhaseRevoke({ ...input, contract: prepared.contract, receiptProducer });
    },
  });
}
