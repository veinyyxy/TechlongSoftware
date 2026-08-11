const sensitiveKeyPattern = /(?:password|passwd|secret|token|private[_-]?key|credential)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Produces a log-safe copy. Control request bodies must never be logged in
 * their original form because initial provisioning contains a one-time owner
 * password.
 */
export function redactControlSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactControlSecrets);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactControlSecrets(item),
    ]),
  );
}

/**
 * Best-effort removal of the only runtime secret allowed in the compiled
 * provisioning object. The string also lives briefly in the serialized HTTPS
 * request buffer, but is never persisted in a deployment snapshot or result.
 */
export function clearFirstOwnerPassword(payload: Record<string, unknown>): void {
  const owner = payload.first_owner;
  if (!isRecord(owner) || !Object.hasOwn(owner, "password")) return;
  delete owner.password;
}
