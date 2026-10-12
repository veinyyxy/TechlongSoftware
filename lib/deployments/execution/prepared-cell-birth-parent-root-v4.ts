import { cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { validateCellBirthTickV3 } from "./cell-birth-lifecycle-v3.ts";
import { AwsSdkCellParentRegistryReaderV4, AwsSdkCellParentProvisionPublisherV4, assertInstalledCellParentV4 } from "./aws-sdk-cell-birth-parent-v4.ts";
import { AwsSdkCellStackEvidenceV3 } from "./aws-sdk-cell-stack-evidence-v3.ts";

/** Real publication composition, cleanup branches remain fail-closed until
 * separately approved credentials/actuators are actually composed. Full parent
 * registration MUST NOT be installed with this incomplete bundle. */
export function createPreparedCellBirthParentRootV4(input: { registry: AwsSdkCellParentRegistryReaderV4; publisher: AwsSdkCellParentProvisionPublisherV4;
  stack: AwsSdkCellStackEvidenceV3; now?: () => number }) {
  if (!(input.registry instanceof AwsSdkCellParentRegistryReaderV4) || !(input.publisher instanceof AwsSdkCellParentProvisionPublisherV4) || !(input.stack instanceof AwsSdkCellStackEvidenceV3)) cellV3Fail("CELL_PARENT_ROOT_CAPABILITIES_INVALID");
  const now = input.now ?? Date.now, read = input.registry.readStrong.bind(input.registry), stack = input.stack.read.bind(input.stack), publish = input.publisher.publishOnce.bind(input.publisher);
  const result = (outcome: string, extra: Record<string, unknown> = {}) => cellV3Freeze({ schemaVersion: 4, mode: "prepared_not_installed", outcome,
    cloudRuntimeInstalled: false, tenantRuntimeEnabled: false, fullCleanupRootCompleted: false, deleteInvocationAttempted: false, retryAuthorized: false, ...extra });
  return Object.freeze({ cloudRuntimeInstalled: false as const, fullCleanupRootCompleted: false as const,
    async run(rawEvent: unknown, signal: AbortSignal) {
      const event = validateCellBirthTickV3(rawEvent); signal.throwIfAborted(); const parent = await read(signal);
      if (!parent) return result("LOCKED_NO_FULL_PARENT", { mutationPerformed: false });
      assertInstalledCellParentV4(parent, now(), true); const d = parent.record.manifest.delegation;
      if (event.birthIntentSha256 !== d.birthIntentSha256 || event.stackId !== d.stackId) cellV3Fail("CELL_PARENT_ROOT_EVENT_DRIFT");
      const current = await stack(parent.record.manifest.plan, d.stackId, signal); signal.throwIfAborted();
      if (!("protocol" in current)) cellV3Fail("CELL_PARENT_ROOT_EXPECTED_STACK_MISSING");
      if (current.failedCreationOrPhase) return result("FAILED_BIRTH_FULL_COMPENSATION_ROOT_NOT_CONNECTED", { mutationPerformed: false });
      if (!current.completePaidStack) return result("NONPAID_PARENT_INSPECT_ONLY", { phase: current.phase, mutationPerformed: false });
      if (now() >= Date.parse(d.cellExpiresAt)) return result("DUE_FULL_TTL_ROOT_NOT_CONNECTED", { mutationPerformed: false });
      const r = await publish(event, signal); return result(r.outcome, r);
    },
  });
}
