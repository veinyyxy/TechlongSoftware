import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { AwsSdkSharedCellCleanupAuthority, SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN, type AwsSdkSharedCellCleanupAuthorityDependencies } from "./aws-sdk-shared-cell-cleanup-authority.ts";
import { createNeonSharedCellAdmissionFenceWriter } from "./neon-shared-cell-admission-fence.ts";
import { createNeonCellTtlCleanupJobProducer } from "./neon-cell-ttl-cleanup-jobs.ts";
import { createNeonSealedCellOwnershipSourceV3, type SealedPlanCertificateV1 } from "./neon-sealed-cell-ownership-source-v3.ts";
import { createPreparedSealedCellDrainCoordinatorV3 } from "./prepared-sealed-cell-drain-coordinator-v3.ts";
import { sha256Hex } from "./hash.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 as pin } from "./sealed-cell-cleanup-lambda-context-v3.ts";

export async function createAwsSdkPreparedSealedCellDrainV3(input: { readerDatabaseUrl: string; writerDatabaseUrl: string; expectedRegisteredCertificate: SealedPlanCertificateV1; certificateSha256: string }) {
  if (input.certificateSha256 !== pin || await sha256Hex(input.expectedRegisteredCertificate) !== pin) throw new Error("SEALED_DRAIN_CERTIFICATE_REJECTED");
  try { const reader = new URL(input.readerDatabaseUrl), writer = new URL(input.writerDatabaseUrl);
    if (decodeURIComponent(reader.username) !== "techlong_cell_cleanup_reader" || decodeURIComponent(writer.username) !== "techlong_cell_drain" ||
      reader.hostname !== writer.hostname || reader.pathname !== writer.pathname || !reader.password || !writer.password ||
      [reader, writer].some(u => !["postgres:", "postgresql:"].includes(u.protocol) || !u.hostname.endsWith(".neon.tech") || (u.port && u.port !== "5432") || !["require", "verify-full"].includes(u.searchParams.get("sslmode") ?? ""))) throw new Error();
  } catch { throw new Error("SEALED_DRAIN_DATABASE_BINDING_REJECTED"); }
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1, credentials: fromEnv() }));
  const authority = new AwsSdkSharedCellCleanupAuthority({ tableArn: SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN }, { client: client as unknown as AwsSdkSharedCellCleanupAuthorityDependencies["client"],
    commands: { get: GetCommand as unknown as AwsSdkSharedCellCleanupAuthorityDependencies["commands"]["get"], put: class { constructor() { throw new Error("SEALED_DRAIN_AUTHORITY_WRITE_FORBIDDEN"); } } } });
  const root = createPreparedSealedCellDrainCoordinatorV3({ authority: { observe: r => authority.observe(r) }, admissions: createNeonSharedCellAdmissionFenceWriter(input.writerDatabaseUrl),
    jobs: createNeonCellTtlCleanupJobProducer(input.writerDatabaseUrl), source: createNeonSealedCellOwnershipSourceV3(input.readerDatabaseUrl, input.expectedRegisteredCertificate), certificateSha256: pin });
  return Object.freeze({ ...root, dispose: () => client.destroy() });
}
