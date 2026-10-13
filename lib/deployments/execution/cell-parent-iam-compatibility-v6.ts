import { canonicalJson, sha256Hex } from "./hash.ts";
import { cellV3Fail, cellV3Freeze } from "../cloudformation/shared-cell-stack-v3.ts";
import { cellParentIamDocumentsV4 } from "./cell-birth-parent-v4.ts";

/** Preserve V4, including every resource/key/version condition. Only the
 * source-function deny excludes forwarded kms:Decrypt. The existing boundary
 * Allow still requires the exact key, Secrets Manager, caller and Secret ARN;
 * the Secrets Manager Get remains source-function + fixed-version restricted.
 * No exception for arbitrary KMS actions or direct decryption is added. */
export function cellParentIamDocumentsV6(stackId: string) {
  const old = cellParentIamDocumentsV4(stackId), boundary: { Version: string; Statement: Record<string, unknown>[] } = structuredClone(old.boundary);
  const statement = boundary.Statement.find(s => s.Sid === "DenyOtherOrMissingSource");
  if (!statement || statement.Effect !== "Deny" || statement.Action !== "*" || Object.hasOwn(statement, "NotAction")) cellV3Fail("CELL_PARENT_V6_SOURCE_DENY_SHAPE_INVALID");
  const replacement = { Sid: statement.Sid, Effect: statement.Effect, NotAction: "kms:Decrypt", Resource: statement.Resource, Condition: statement.Condition };
  boundary.Statement[boundary.Statement.indexOf(statement)] = replacement;
  if (Buffer.byteLength(canonicalJson(boundary)) > 6144) cellV3Fail("CELL_PARENT_V6_POLICY_SIZE_INVALID");
  return cellV3Freeze({ ...old, boundary, inline: structuredClone(boundary), sourceFunctionGuardStillRequiredForSecretRead: true,
    forwardedKmsOnlyException: true, actualForwardedKmsAllowPathVerified: false, installationAuthorized: false, runtimeEnabled: false });
}
/** Exact projection ONLY after the whole actual V6 document matches. It lets
 * the unchanged V4 reader keep its original private proof brand and all other
 * checks. The legacy metadata hash describes this validated compatibility
 * view, not the bytes of the actual V6 IAM document. The actual policy digest
 * must be separately included in installation evidence/review materials. */
export function cellParentIamCompatibilityViewV6(raw: unknown, stackId: string, kind: "boundary" | "inline") {
  if (!["boundary", "inline"].includes(kind)) cellV3Fail("CELL_PARENT_V6_POLICY_KIND_INVALID");
  let document: unknown;
  try { document = typeof raw === "string" ? JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)) : raw; }
  catch { return cellV3Fail("CELL_PARENT_V6_ACTUAL_POLICY_INVALID"); }
  if (canonicalJson(document) !== canonicalJson(cellParentIamDocumentsV6(stackId)[kind])) cellV3Fail("CELL_PARENT_V6_ACTUAL_POLICY_MISMATCH");
  return canonicalJson(cellParentIamDocumentsV4(stackId)[kind]);
}
export async function cellParentIamPolicyDigestV6(stackId: string) { return sha256Hex(cellParentIamDocumentsV6(stackId).boundary); }
