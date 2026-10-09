import { createReadonlyLambdaProbeHandlerV1 } from "../../../lib/deployments/execution/readonly-lambda-probe-v1.ts";
/** Does not reuse the legacy schema2 drain handler or connect its write-capable database role. */
export const handler = createReadonlyLambdaProbeHandlerV1(1);
