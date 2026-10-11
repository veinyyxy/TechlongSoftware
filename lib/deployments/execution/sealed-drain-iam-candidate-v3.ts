import { canonicalJson } from "./hash.ts";
import { readonlyKmsRepairDocumentsV1 } from "./readonly-kms-read-repair-v1.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "./readonly-runtime-iam-v1.ts";
/** Uninstalled proposal only: exact reader+writer credentials; all DDB/cloud write denies unchanged. */
export function sealedDrainIamCandidateV3() {
  const old = readonlyKmsRepairDocumentsV1(1), policy = structuredClone(old.identity), reader = targets[0], writer = targets[1];
  const result: Record<string, unknown>[] = [];
  for (const statement of policy.Statement) {
    const s = statement as Record<string, unknown>, c = s.Condition as Record<string, Record<string, unknown>> | undefined;
    if (s.Action === "secretsmanager:GetSecretValue" && s.NotResource === writer.secretArn) s.NotResource = [writer.secretArn, reader.secretArn];
    if (s.Effect === "Allow" && s.Action === "secretsmanager:GetSecretValue" && s.Resource === writer.secretArn) s.Resource = [writer.secretArn, reader.secretArn];
    if (s.Effect === "Deny" && s.Action === "kms:Decrypt" && c?.StringNotEquals?.["kms:EncryptionContext:SecretARN"] === writer.secretArn)
      c.StringNotEquals["kms:EncryptionContext:SecretARN"] = [writer.secretArn, reader.secretArn];
    if (s.Effect === "Deny" && s.Action === "kms:Decrypt" && c?.StringNotEquals?.["kms:EncryptionContext:SecretVersionId"] === writer.secretVersionId) {
      // Per-ARN negated UUID denies preserve correlation; independent lists would permit wrong pairs.
      for (const t of [writer, reader]) result.push({ Effect: "Deny", Action: "kms:Decrypt", Resource: "*", Condition: {
        StringEquals: { "kms:EncryptionContext:SecretARN": t.secretArn }, StringNotEquals: { "kms:EncryptionContext:SecretVersionId": t.secretVersionId } } });
      continue;
    }
    result.push(s);
    if (s.Effect === "Allow" && s.Action === "kms:Decrypt") {
      const extra = structuredClone(s), condition = extra.Condition as Record<string, Record<string, unknown>>;
      condition.StringEquals["kms:EncryptionContext:SecretARN"] = reader.secretArn; condition.StringEquals["kms:EncryptionContext:SecretVersionId"] = reader.secretVersionId; result.push(extra);
    }
  }
  const document = { Version: "2012-10-17", Statement: result }, characters = canonicalJson(document).length;
  if (characters > 6144) throw new Error("SEALED_DRAIN_POLICY_QUOTA_EXCEEDED");
  return { trust: old.trust, boundary: document, identity: structuredClone(document), characters, proposalOnly: true, installationAuthorized: false };
}
