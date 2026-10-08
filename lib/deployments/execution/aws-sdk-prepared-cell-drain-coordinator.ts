import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AwsSdkSharedCellCleanupAuthority, SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN, type AwsSdkSharedCellCleanupAuthorityDependencies } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { createNeonSharedCellAdmissionFenceWriter } from "./neon-shared-cell-admission-fence.ts";
import { createNeonSerializableSharedCellOwnershipSnapshotSource } from "./neon-shared-cell-zero-tenant-source.ts";
import { SerializableSharedCellCleanupDeletionZeroTenantAdapter } from "./shared-cell-cleanup-deletion-zero-tenant.ts";
import { createPreparedCellDrainCoordinator } from "./prepared-cell-drain-coordinator.ts";
import { createNeonCellTtlCleanupJobProducer } from "./neon-cell-ttl-cleanup-jobs.ts";

export function createAwsSdkPreparedCellDrainCoordinator(databaseUrl: string) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }));
  const authority = new AwsSdkSharedCellCleanupAuthority({ tableArn: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN }, {
    client: client as unknown as AwsSdkSharedCellCleanupAuthorityDependencies["client"], commands: {
      get: GetCommand as unknown as AwsSdkSharedCellCleanupAuthorityDependencies["commands"]["get"],
      // No PutCommand capability is passed to the coordinator's authority reader.
      put: class { constructor() { throw new Error("CELL_DRAIN_AUTHORITY_WRITE_FORBIDDEN"); } },
    },
  });
  return createPreparedCellDrainCoordinator({
    authority: { observe: request => authority.observe(request) },
    admissions: createNeonSharedCellAdmissionFenceWriter(databaseUrl),
    jobs: createNeonCellTtlCleanupJobProducer(databaseUrl),
    ownership: new SerializableSharedCellCleanupDeletionZeroTenantAdapter(createNeonSerializableSharedCellOwnershipSnapshotSource(databaseUrl)),
  });
}
