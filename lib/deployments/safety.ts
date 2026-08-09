const sensitiveOutputKey =
  /(?:password|passwd|passphrase|authorization|databaseurl|secret|token|privatekey|credential|awsaccesskey|awssecretaccesskey)/i;
const sensitiveOutputValue =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\bpostgres(?:ql)?:\/\/[^\s]+|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/i;

export function redactDeploymentError(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/gi, "[redacted-private-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
    .replace(/\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, "[redacted-credential-url]")
    .replace(
      /([?&](?:access_token|token|password|secret|signature|key)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+\b/g, "[redacted-provider-key]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-aws-key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]");
}

export function normalizeDeploymentError(
  value: string | null | undefined,
  fallback: string,
): string {
  return redactDeploymentError(value?.trim() || fallback).slice(0, 500);
}

export function assertSafeDeploymentOutput(value: Record<string, unknown>): void {
  const serialized = JSON.stringify(value);
  if (serialized.length > 32 * 1024) {
    throw new Error("Deployment step output exceeds 32 KiB.");
  }
  const visit = (item: unknown, path: string): void => {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!item || typeof item !== "object") {
      if (typeof item === "string" && sensitiveOutputValue.test(item)) {
        throw new Error(`Deployment step output contains a secret at ${path}.`);
      }
      return;
    }
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "");
      const permittedSecretReference = /secret(?:arn|ref)$/i.test(normalizedKey);
      if (sensitiveOutputKey.test(normalizedKey) && !permittedSecretReference) {
        throw new Error(`Deployment step output key is sensitive: ${path}.${key}.`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "output");
}
