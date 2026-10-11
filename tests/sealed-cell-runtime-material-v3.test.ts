import assert from "node:assert/strict";
import test from "node:test";
import { readFixedSealedRuntimeMaterialV3, type SealedRuntimeMaterialPortsV3 } from "../lib/deployments/execution/sealed-cell-runtime-material-v3.ts";
import { registeredSealedCertificateV1 as cert } from "./fixtures/registered-sealed-certificate-v1.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 as targets } from "../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { sealedDrainIamCandidateV3 } from "../lib/deployments/execution/sealed-drain-iam-candidate-v3.ts";
import { readonlyKmsRepairDocumentsV1 } from "../lib/deployments/execution/readonly-kms-read-repair-v1.ts";
const signal = () => new AbortController().signal;
async function fixture(kind: "ttl" | "drain" = "drain") {
  const seen: number[] = [], certificateSha256 = await sha256Hex(cert);
  const values = targets.map((t, i) => ({ ARN: t.secretArn, VersionId: t.secretVersionId as string, VersionStages: ["AWSCURRENT"], SecretString: JSON.stringify(i === 0 ? {
    schemaVersion: 3, protocol: "sealed-cell-cleanup-control-v3", databaseUrl: "postgresql://techlong_cell_cleanup_reader:TEST_ONLY@ep-test.ca-central-1.aws.neon.tech/neondb?sslmode=require", certificateSha256, expectedRegisteredCertificate: cert,
  } : { databaseUrl: "postgresql://techlong_cell_drain:WRITER_TEST_ONLY@ep-test.ca-central-1.aws.neon.tech/neondb?sslmode=require" }) }));
  const ports: SealedRuntimeMaterialPortsV3 = { identity: async () => ({ Account: "402010193138", Arn: `arn:aws:sts::402010193138:assumed-role/${targets[kind === "ttl" ? 0 : 1].role}/session` }),
    secret: async i => { seen.push(i); return values[i]; } };
  return { ports, values, seen };
}
test("drain material uses separate reader/writer fixed Secret versions on the same database", async () => {
  const f = await fixture(), m = await readFixedSealedRuntimeMaterialV3("drain", signal(), f.ports);
  assert.deepEqual(f.seen, [0, 1]); assert.equal(new URL(m.readerDatabaseUrl).username, "techlong_cell_cleanup_reader"); assert.equal(new URL(m.writerDatabaseUrl!).username, "techlong_cell_drain"); assert.equal(m.expectedRegisteredCertificate.sealed_at, cert.sealed_at);
});
test("TTL material never reads writer credential and no environment binding is needed", async () => {
  const f = await fixture("ttl"), m = await readFixedSealedRuntimeMaterialV3("ttl", signal(), f.ports); assert.deepEqual(f.seen, [0]); assert.equal(m.writerDatabaseUrl, undefined);
});
test("wrong UUID, Secret stage, certificate, identity or endpoint is sanitized and never yields material", async () => {
  for (const change of ["uuid", "stage", "certificate", "identity", "endpoint"]) { const f = await fixture();
    if (change === "uuid") f.values[0].VersionId = "wrong";
    if (change === "stage") f.values[0].VersionStages = ["AWSPREVIOUS"];
    if (change === "certificate") { const p = JSON.parse(f.values[0].SecretString); p.expectedRegisteredCertificate.original_row_sha256 = "f".repeat(64); f.values[0].SecretString = JSON.stringify(p); }
    if (change === "identity") f.ports.identity = async () => ({ Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev" });
    if (change === "endpoint") f.values[1].SecretString = JSON.stringify({ databaseUrl: "postgresql://techlong_cell_drain:WRITER_TEST_ONLY@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require" });
    await assert.rejects(readFixedSealedRuntimeMaterialV3("drain", signal(), f.ports), e => e instanceof Error && e.message === "SEALED_RUNTIME_MATERIAL_REJECTED");
  }
});
test("dual-Secret IAM candidate preserves all non-Secret/KMS rules and denies wrong UUID correlation", () => {
  const p = sealedDrainIamCandidateV3(), old = readonlyKmsRepairDocumentsV1(1), filter = (s: Record<string, unknown>) => !["secretsmanager:GetSecretValue", "kms:Decrypt"].includes(String(s.Action));
  assert.deepEqual(p.identity.Statement.filter(filter), old.identity.Statement.filter(filter)); assert.deepEqual(p.boundary, p.identity); assert.ok(p.characters <= 6144); assert.equal(p.installationAuthorized, false);
  const denies = p.identity.Statement.filter(s => s.Effect === "Deny" && s.Action === "kms:Decrypt");
  for (const t of targets) assert.ok(denies.some(s => { const c = s.Condition as Record<string, Record<string, unknown>> | undefined; return c?.StringEquals?.["kms:EncryptionContext:SecretARN"] === t.secretArn && c?.StringNotEquals?.["kms:EncryptionContext:SecretVersionId"] === t.secretVersionId; }));
  assert.ok(!JSON.stringify(p.identity).includes("cloudformation:DeleteStack")); assert.ok(!JSON.stringify(p.identity).includes("dynamodb:PutItem"));
});
