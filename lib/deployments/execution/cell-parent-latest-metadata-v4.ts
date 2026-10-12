import { canonicalJson } from "./hash.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as t } from "./cell-parent-bootstrap-v4.ts";

/** A fixed $LATEST configuration GET may return the precisely qualified ARN.
 * This is metadata normalization only: it does not authorize alias/version
 * invocation, change the approved unqualified target, or mint runtime proof. */
export function cellParentLockedFunctionChecksV4(f: Record<string, unknown>) {
  const environment = f.Environment as { Error?: unknown; Variables?: Record<string, unknown> } | undefined;
  const vpc = f.VpcConfig as { SubnetIds?: unknown[]; SecurityGroupIds?: unknown[] } | undefined;
  return Object.freeze({
    exactLatestIdentity: f.FunctionName === t.functionName && f.Version === "$LATEST" &&
      [t.functionArn, `${t.functionArn}:$LATEST`].includes(String(f.FunctionArn)),
    role: f.Role === t.roleArn,
    zip: f.CodeSha256 === t.zipCodeSha256Base64,
    runtime: f.Runtime === "nodejs22.x" && f.Handler === "cell-birth-coordinator-v4.handler" && f.PackageType === "Zip",
    active: f.State === "Active" && f.LastUpdateStatus === "Successful",
    limits: f.Timeout === 120 && f.MemorySize === 256 && canonicalJson(f.Architectures) === '["x86_64"]',
    noLayers: f.Layers === undefined || f.Layers === null || (Array.isArray(f.Layers) && f.Layers.length === 0),
    noApplicationEnvironment: !environment?.Error && !Object.keys(environment?.Variables ?? {}).length,
    noVpc: !(vpc?.SubnetIds?.length) && !(vpc?.SecurityGroupIds?.length),
  });
}
