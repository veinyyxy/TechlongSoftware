import { CELL_LIFECYCLE_COORDINATOR_V3, cellV3Exact, cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";

/** Configuration DATA only: no SDK, install, Invoke or concurrency increase.
 * age/retry apply to Lambda's asynchronous queue, not exactly-once delivery,
 * SDK retries, EventBridge retries or already-running invocations. */
export const CELL_PARENT_ASYNC_PLAN_V5 = cellV3Freeze({
  functionArn: CELL_LIFECYCLE_COORDINATOR_V3,
  eventInvokeInput: { FunctionName: CELL_LIFECYCLE_COORDINATOR_V3, Qualifier: "$LATEST", MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0, DestinationConfig: {} },
  concurrencyInput: { FunctionName: CELL_LIFECYCLE_COORDINATOR_V3, ReservedConcurrentExecutions: 0 },
  runtimeEnabled: false, installationAuthorized: false, noAliasVersionScheduleOrDestinationCreated: true,
  sourceReadbackRequired: ["function-config", "function-concurrency", "event-invoke-config", "resource-policy", "event-source-mappings", "aliases", "versions"],
  risks: { replacesExistingAsyncSettings: true, noRevisionIdCasForAsyncConfig: true, duplicateDeliveryStillPossible: true,
    throttleOrServiceRetriesNotDisabledByRetryZero: true, eventMayBeDiscarded: true, partialConfigurationMayRemain: true, nonzeroCost: true },
});
export function assertCellParentAsyncLockedV5(config: Record<string, unknown>, concurrency: Record<string, unknown>) {
  const destinations = config.DestinationConfig as Record<string, unknown>;
  // AWS also represents absent destinations as OnSuccess:{}/OnFailure:{}.
  // Empty Destination is an explicitly supported API value; unknown nested
  // fields or any nonempty target remain a hard stop.
  const noDestinations = destinations && typeof destinations === "object" && !Array.isArray(destinations) &&
    Object.keys(destinations).every(k => ["OnSuccess", "OnFailure"].includes(k)) && Object.values(destinations).every(v =>
      cellV3Exact(v, []) || (cellV3Exact(v, ["Destination"]) && (v as { Destination: unknown }).Destination === ""));
  if (![CELL_LIFECYCLE_COORDINATOR_V3, `${CELL_LIFECYCLE_COORDINATOR_V3}:$LATEST`].includes(String(config.FunctionArn)) ||
    config.MaximumEventAgeInSeconds !== 60 || config.MaximumRetryAttempts !== 0 || concurrency.ReservedConcurrentExecutions !== 0 ||
    !noDestinations) cellV3Fail("CELL_PARENT_V5_ASYNC_OR_LOCK_DRIFT");
  return Object.freeze({ ageSeconds: 60, functionErrorRetries: 0, concurrency: 0, destinations: 0, exactlyOnceProved: false, runtimeEnabled: false });
}
