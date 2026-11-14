import { randomUUID } from "node:crypto";
import { sha256Hex, canonicalJson } from "../../lib/deployments/execution/hash.ts";
import { buildReleaseCandidate, verifyPublishedRelease, type ReleaseBuildPolicy } from "../../lib/deployments/releases/production.ts";
import type { CatalogSourceEvidence } from "./import-source.ts";

export const importCodeFiles = ["scripts/instance-release-import.ts", "ops/releases/import-source.ts", "ops/releases/import-review.ts",
  "ops/releases/catalog-transaction.ts", "ops/releases/build-artifact.ts", "ops/releases/extract-build-artifact.py",
  "lib/deployments/releases/production.ts", "lib/deployments/releases/catalog.ts", "lib/deployments/releases/repository.ts",
  "lib/deployments/releases/planning.ts", "lib/deployments/execution/hash.ts"];

/** Pure evidence -> review. No product ID/version/compatibility inference from image labels. */
export async function prepareCatalogRegistration(source: CatalogSourceEvidence, policy: ReleaseBuildPolicy,
  sourceFile: string, sourceRawSha256: string, codeArtifacts: { path: string; sha256: string }[], now: number) {
  if (source.schema !== "techlong/catalog-source-evidence/v1" || source.status !== "SOURCE_AND_ECR_VERIFIED_PRODUCT_BINDING_PENDING" ||
    source.catalogWritten || source.awsWrites !== 0 || now >= source.validUntil || policy.imageRepository !== source.imageRepository ||
    policy.repository !== source.profile.repository || policy.repositoryId !== source.profile.repositoryId ||
    policy.nodeVersion !== source.profile.nodeVersion || policy.scannerVersion !== source.profile.scannerVersion ||
    policy.scannerArchiveSha256 !== source.profile.scannerArchiveSha256 || !/^[a-f0-9]{64}$/.test(sourceRawSha256) ||
    canonicalJson(codeArtifacts.map(a => a.path)) !== canonicalJson(importCodeFiles) || codeArtifacts.some(a => !/^[a-f0-9]{64}$/.test(a.sha256))) {
    throw new Error("RELEASE_IMPORT_SOURCE_OR_POLICY_REJECTED");
  }
  const candidate = await buildReleaseCandidate(policy, source.run, source.artifact, source.files, now);
  const release = await verifyPublishedRelease(candidate, source.registry.readback, now);
  return { schema: "techlong/catalog-registration-review/v1" as const, id: randomUUID(), status: "AWAITING_APPROVAL" as const,
    preparedAt: now, validUntil: source.validUntil, automaticExtension: false,
    sourceEvidence: { path: sourceFile, rawSha256: sourceRawSha256 }, codeArtifacts,
    policy: { productId: policy.productId, version: policy.version, repository: policy.repository, repositoryId: policy.repositoryId,
      imageRepository: policy.imageRepository, nodeVersion: policy.nodeVersion, scannerVersion: policy.scannerVersion,
      scannerArchiveSha256: policy.scannerArchiveSha256, compatibility: release.compatibility },
    release, releaseSha256: await sha256Hex(release),
    target: { configPath: ".env.local", configKey: "DATABASE_URL", database: "neondb", installer: "neondb_owner", schemaOid: 237571, releasesOid: 237572 },
    limits: { configReads: 1, connections: 2, sqlSubmissions: 64, catalogInsertSubmissions: 1, catalogRows: 1,
      awsCalls: 0, githubCalls: 0, secretValueReads: 0, privateKeyReads: 0, maxExecutionMs: 600000 },
    steps: ["Verify sealed source/code/release SHA before reading the fixed config once",
      "One verified-TLS writer: validate installer/OIDs/closed rights, temporarily grant owner SET in transaction, exact INSERT only, close SET before COMMIT",
      "Close writer; one new verified-TLS connection independently selects the exact row in its own temporary owner transaction and closes SET before COMMIT",
      "Save metadata/digests; no runtime enable, workload restore, promotion, cleanup or automatic retry"],
    risks: ["Broad installer/config in memory; PostgreSQL/provider logs may expose connection/statement material",
      "Each transaction performs fixed role-membership writes; the independent inspection is NOT an entirely READ ONLY transaction",
      "Only one catalog row may be inserted, not business/instance/binding rows; conflicts/revocation are not overwritten",
      "Cross-connection verification is not atomic; lost COMMIT ACK retains UNKNOWN, no application write replay or automatic compensation",
      "Creator ADMIN remains; code closes SET/INHERIT but cannot make a broad administrator unable to regrant access",
      "Local config selects the intended existing Neon control database; installer/database/schema/table IDs are checked, not a new hostname/branch inventory"],
    retryAllowed: false, runtimeEnabled: false, cloudWrites: 0, credentialCreation: false };
}

export type CatalogRegistrationReview = Awaited<ReturnType<typeof prepareCatalogRegistration>>;
