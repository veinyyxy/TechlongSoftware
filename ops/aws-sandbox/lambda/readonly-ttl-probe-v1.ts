import { createReadonlyLambdaProbeHandlerV1 } from "../../../lib/deployments/execution/readonly-lambda-probe-v1.ts";
/** Probe-only artifact for the exact future TTL function name; no delete/root/journal writer. */
export const handler = createReadonlyLambdaProbeHandlerV1(0);
