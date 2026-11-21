// AWS-owned at-rest encryption is reported as sse-rds with the legacy
// StorageEncrypted flag false. This proof is for the fixed Express first-open.
/** @param {{ StorageEncryptionType?: unknown, StorageEncrypted?: unknown } | null | undefined} db
 * @returns {"sse-rds" | undefined} */
export function firstOpenExpressStorageProof(db) {
  return db?.StorageEncryptionType === "sse-rds" && db.StorageEncrypted === false ? "sse-rds" : undefined;
}
