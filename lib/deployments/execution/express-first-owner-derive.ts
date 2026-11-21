import { hkdfSync } from "node:crypto";
import { canonicalJson } from "./hash.ts";

/** Preserve the existing Express owner-password domain separation. Caller
 * owns and clears the HMAC key and the returned password bytes. */
export function deriveExpressFirstOwnerPassword(key: Buffer, scope: {
  stableIdentity: string; appInstanceId: string; templateVersionId: string; generation: number; versionId: string;
}): Buffer {
  return Buffer.from(hkdfSync("sha256", key, Buffer.from(scope.stableIdentity, "hex"), Buffer.from(canonicalJson({
    protocol: "techlong-first-owner-password-v1", appInstanceId: scope.appInstanceId, templateVersionId: scope.templateVersionId,
    generation: scope.generation, versionId: scope.versionId,
  })), 32));
}
