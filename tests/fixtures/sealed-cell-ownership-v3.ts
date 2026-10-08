import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { NeonSealedCellOwnershipSourceV3, type SealedPlanCertificateV1 } from "../../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts";
import type { NeonSerializableSnapshotSqlClient } from "../../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts";
import { compileSharedCellAdmissionDrainIntent } from "../../lib/deployments/execution/shared-cell-admission-fence.ts";
import { sharedCellAuthorityMarker, sharedCellProvisionOperationIntent } from "../../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { SharedCellCleanupStackEvidencePort, type VerifiedSharedCellCleanupStackEvidence } from "../../lib/deployments/execution/shared-cell-cleanup-authority-operator.ts";

export const now = Date.parse("2026-10-08T19:00:00.000Z");
export async function sealedEvidenceFixture(overrides: Partial<SealedPlanCertificateV1> = {}, hashes: { templateCanonicalSha256?: string; resourceInventorySha256?: string } = {}) {
  const operation = {
    schemaVersion: 2 as const, accountId: "402010193138" as const, region: "ca-central-1" as const,
    cellId: "cell-sandbox-1" as const, stackName: "techlong-sandbox-cell-sandbox-1" as const,
    stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012",
    stackStatus: "CREATE_COMPLETE" as const, cellExpiresAt: new Date(now - 60_000).toISOString(),
    cloudFormationRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const,
    templateCanonicalSha256: hashes.templateCanonicalSha256 ?? "1".repeat(64), resourceInventorySha256: hashes.resourceInventorySha256 ?? "2".repeat(64), ownerDeploymentId: "deployment_fixture_owner",
    generation: 1, provisionEpoch: 1, provisionMarker: sharedCellAuthorityMarker({ generation: 1, epoch: 1 }),
  };
  const unsigned = { ...operation, provisionOperationHash: await sha256Hex(sharedCellProvisionOperationIntent(operation)),
    revision: 1, state: "provision_verified" as const };
  const predecessor = { ...unsigned, recordHash: await sha256Hex(unsigned) };
  const drain = await compileSharedCellAdmissionDrainIntent(predecessor);
  const cert: SealedPlanCertificateV1 = {
    deployment_id: "dep_d00144511731f1c20991aa56", app_instance_id: "app_fb1962e93a9a4cc2acf046170593d9e3",
    environment_id: "env_aws_sandbox_ca_central_1", original_row_sha256: "a".repeat(64), original_plan_bytes_sha256: "b".repeat(64),
    original_plan_hash: "c".repeat(64), business_state_sha256: "d".repeat(64), approved_registration_sha256: "e".repeat(64),
    protection_schema_sha256: "f".repeat(64), sealed_at: now - 120_000, ...overrides,
  };
  const results: { rows: Record<string, unknown>[] }[] = [
    { rows: [{ search_path: "pg_catalog", row_security: "off" }] },
    { rows: [{ environment_id: cert.environment_id, account_id: operation.accountId, region: operation.region, cell_key: operation.cellId,
      admission_state: "draining", admission_epoch: 1, admission_fence_sha256: drain.fenceSha256,
      admission_provision_operation_hash: predecessor.provisionOperationHash, admission_stack_id: predecessor.stackId,
      admission_cell_expires_at: now - 60_000, admission_changed_at: now - 30_000, observed_at: now,
      reader_role: "techlong_cell_cleanup_reader", limited_reader: true, no_owner_or_table_write: true }] },
    { rows: [{ ...cert, fence_sealed: true, fence_sealed_at: cert.sealed_at, fence_revision: 3,
      live_row_sha256: cert.original_row_sha256, live_plan_bytes_sha256: cert.original_plan_bytes_sha256, live_plan_hash: cert.original_plan_hash,
      fingerprint_body_sha256: "16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66",
      fingerprint_function_safe: true, live_protection_sha256: cert.protection_schema_sha256 }] },
    { rows: [{ id: cert.app_instance_id }] },
    { rows: [{ instance_id: cert.app_instance_id, deployment_id: cert.deployment_id }] },
    { rows: [] }, { rows: [{ id: cert.deployment_id }] }, { rows: [] }, { rows: [] },
  ];
  let reads = 0;
  const sql: NeonSerializableSnapshotSqlClient = { async transaction() { reads++; return structuredClone(results); } };
  const source = new NeonSealedCellOwnershipSourceV3(sql, cert);
  class FixtureStack extends SharedCellCleanupStackEvidencePort {
    constructor() { super(); }
    async readVerifiedCleanupStackEvidence(): Promise<VerifiedSharedCellCleanupStackEvidence> {
      return this.markVerified({ schemaVersion: 1, verified: true, observedAt: now, accountId: operation.accountId,
        region: operation.region, cellId: operation.cellId, stackName: operation.stackName, stackId: operation.stackId,
        stackStatus: operation.stackStatus, cellExpiresAt: operation.cellExpiresAt, cloudFormationRoleArn: operation.cloudFormationRoleArn,
        templateCanonicalSha256: operation.templateCanonicalSha256, resourceInventorySha256: operation.resourceInventorySha256 });
    }
  }
  const stack = await new FixtureStack().readVerifiedCleanupStackEvidence();
  return { predecessor, source, stack, results, cert, reads: () => reads };
}
