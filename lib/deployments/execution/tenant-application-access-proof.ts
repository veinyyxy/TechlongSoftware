import { canonicalJson } from "./hash.ts";
import { TenantDatabaseLifecycleError } from "./tenant-database.ts";

export interface TenantApplicationAccessProof {
  policy: "speedfeast-application-access/v1";
  databaseLoginVerified: true;
  evidenceHash: string;
}

export function assertTenantApplicationAccessProof(value: unknown): asserts value is TenantApplicationAccessProof {
  const proof = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  if (!proof || canonicalJson(Object.keys(proof).sort()) !== canonicalJson(["databaseLoginVerified", "evidenceHash", "policy"]) ||
    proof.policy !== "speedfeast-application-access/v1" || proof.databaseLoginVerified !== true ||
    typeof proof.evidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(proof.evidenceHash)) {
    throw new TenantDatabaseLifecycleError("TENANT_APPLICATION_PROOF_INVALID", "Prepared verification requires the exact policy and actual database login evidence.");
  }
}

export function assertPreparedTenantVerifyOutput(value: Record<string, unknown>): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(["applicationAccess", "evidenceHash", "outcome", "resultingState"]) ||
    !["applied", "already_applied"].includes(String(value.outcome)) || value.resultingState !== "verified" ||
    typeof value.evidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.evidenceHash)) {
    throw new TenantDatabaseLifecycleError("TENANT_APPLICATION_PROOF_INVALID", "Prepared verify output is malformed or SQL-only.");
  }
  assertTenantApplicationAccessProof(value.applicationAccess);
}
