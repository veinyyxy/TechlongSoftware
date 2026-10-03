import { open, readFile, readdir, stat, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import {
  beginSealedSharedCellPostgresReadOnly,
  readSealedSharedCellPostgresSnapshot,
  readSealedSharedCellPostgresPostState,
  sealedSharedCellPostgresTargetFingerprint,
} from "./apply-reviewed-shared-cell-postgres-cutover.ts";
import { migrationChecksum } from "./migration-checksum.mjs";
import {
  compileSharedCellAuthorCompensationMigrationReview,
  SHARED_CELL_AUTHOR_COMPENSATION_PREDECESSOR_RECEIPT_SHA256,
  SharedCellAuthorCompensationMigrationReviewError,
} from "../lib/deployments/execution/neon-shared-cell-author-compensation-migration-review.ts";
import { validateSharedCellPostgresMigrationReceipt } from "../lib/deployments/execution/neon-shared-cell-migration-apply.ts";
import type { SharedCellPostgresMigrationDigest } from "../lib/deployments/execution/neon-shared-cell-migration-readiness.ts";

const confirmation = "I_ACKNOWLEDGE_J5GJ6_NEON_READ_ONLY_MIGRATION_REVIEW";
const guardVariable = "TECHLONG_J5GJ6_MIGRATION_REVIEW_GUARD_NONCE";
interface Client {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}
const namespaceSql = `SELECT object_kind, object_name FROM (
  SELECT 'relation'::text AS object_kind, c.relname::text AS object_name
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname ~ '(^scac_|^shared_cell_author_compensation_)'
  UNION ALL
  SELECT 'function', p.proname::text FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname ~ '(^scac_|_scac_|^shared_cell_author_compensation_)'
  UNION ALL
  SELECT 'trigger', t.tgname::text FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname ~ '(^scac_|^shared_cell_author_compensation_)'
  UNION ALL
  SELECT 'constraint', c.conname::text FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname ~ '(^scac_|^shared_cell_author_compensation_)'
) inventory ORDER BY object_kind, object_name`;

/** No write mode, lock, DDL or mutation function is reachable through this collector. */
export async function inspectSharedCellAuthorCompensationMigrationReadiness(client: Client, input: {
  predecessorReceipt: unknown;
  targetFingerprintSha256: string;
  localMigrations: readonly SharedCellPostgresMigrationDigest[];
}) {
  const started = Date.now();
  let began = false;
  // The collector capability itself also rejects writes, independently of PostgreSQL READ ONLY.
  const reads: Client = { release() {}, query: async (sql, values) => {
    if (!/^(SELECT\b|SET LOCAL\b|BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE$|ROLLBACK$)/i.test(sql.trim()) ||
        (sql.trim() !== "ROLLBACK" && Date.now() - started > 30_000)) throw new Error("Read-only collection statement or deadline is invalid.");
    return client.query(sql, values);
  } };
  try {
    began = true;
    await beginSealedSharedCellPostgresReadOnly(reads);
    const inventory = await reads.query(namespaceSql);
    const postState = await readSealedSharedCellPostgresPostState(reads);
    const snapshot = await readSealedSharedCellPostgresSnapshot(reads);
    if (Date.now() - started > 30_000) throw new Error("Read-only collection exceeded its bound.");
    const manifest = await compileSharedCellAuthorCompensationMigrationReview({ ...input, ...snapshot,
      postState, compensationObjects: inventory.rows });
    await reads.query("ROLLBACK");
    began = false;
    return manifest;
  } finally {
    if (began) await reads.query("ROLLBACK");
  }
}

function externalJson(value: string): string {
  if (!path.isAbsolute(value) || path.extname(value) !== ".json") throw new Error("Evidence must use an absolute external JSON path.");
  const resolved = path.resolve(value), relative = path.relative(process.cwd(), resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Evidence must remain outside the repository.");
  return resolved;
}
async function boundedJson(filename: string): Promise<unknown> {
  const info = await stat(filename);
  if (!info.isFile() || info.size < 1 || info.size > 65_536) throw new Error("Predecessor evidence must be a bounded regular JSON file.");
  return JSON.parse(await readFile(filename, "utf8"));
}
async function localCatalog(): Promise<SharedCellPostgresMigrationDigest[]> {
  const directory = path.resolve("db/postgres-migrations");
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith(".sql")).sort();
  return Promise.all(filenames.map(async (filename) => ({ filename, checksum: migrationChecksum(await readFile(path.join(directory, filename), "utf8")) })));
}

async function main(): Promise<void> {
  const allowed = ["--mode", "--predecessor", "--output", "--guard-nonce", "--confirm-read-only"];
  const args = new Map<string, string>();
  if ((process.argv.length - 2) % 2) throw new Error("Arguments must be explicit pairs.");
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    if (!allowed.includes(key) || args.has(key) || !value || value.startsWith("--")) throw new Error("Unknown, repeated or incomplete review argument.");
    args.set(key, value);
  }
  if (args.size !== allowed.length || args.get("--mode") !== "online-inspect" || args.get("--confirm-read-only") !== confirmation) throw new Error("Only explicitly acknowledged read-only inspection is supported.");
  const nonce = args.get("--guard-nonce")!;
  if (!/^[a-f0-9]{64}$/.test(nonce) || process.env[guardVariable] !== nonce) throw new Error("The read-only wrapper guard is required.");
  delete process.env[guardVariable];
  const predecessorPath = externalJson(args.get("--predecessor")!), outputPath = externalJson(args.get("--output")!);
  const predecessor = await validateSharedCellPostgresMigrationReceipt(await boundedJson(predecessorPath));
  if (predecessor.receiptSha256 !== SHARED_CELL_AUTHOR_COMPENSATION_PREDECESSOR_RECEIPT_SHA256) throw new Error("The sealed J5g-e2 postcheck receipt is required.");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || process.env.NEON_DATABASE_URL) throw new Error("Only the reviewed local DATABASE_URL is accepted.");
  const targetFingerprintSha256 = await sealedSharedCellPostgresTargetFingerprint(databaseUrl);
  if (targetFingerprintSha256 !== predecessor.targetFingerprintSha256) throw new Error("Neon target fingerprint mismatch before connecting.");
  const localMigrations = await localCatalog();
  // Check all local bytes before any network request, without extending the old catalog.
  const { SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG } = await import("../lib/deployments/execution/neon-shared-cell-migration-readiness.ts");
  const { SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX } = await import("../lib/deployments/execution/neon-shared-cell-author-compensation-migration-review.ts");
  if (JSON.stringify(localMigrations) !== JSON.stringify([...SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG, ...SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_SUFFIX])) throw new Error("Local 0001-0010 catalog mismatch before connecting.");
  let output: FileHandle | undefined, client: Client | undefined, success = false;
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: databaseUrl, options: "-c default_transaction_read_only=on", max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 1_000 });
  // Connection-level default protects even the first query while the explicit transaction is starting.
  pool.on("error", () => {});
  try {
    output = await open(outputPath, "wx", 0o600);
    client = await pool.connect() as unknown as Client;
    const manifest = await inspectSharedCellAuthorCompensationMigrationReadiness(client, { predecessorReceipt: predecessor, targetFingerprintSha256, localMigrations });
    await output.writeFile(`${JSON.stringify(manifest)}\n`, "utf8");
    await output.sync();
    success = true;
    console.log(JSON.stringify({ mode: "online_inspect", stage: manifest.stage, manifestSha256: manifest.manifestSha256,
      reviewExpiresAt: manifest.reviewExpiresAt, pendingMigrations: manifest.pendingMigrations.map((migration) => migration.filename),
      postgresVersionNumber: manifest.evidence.postgresVersionNumber, clockRoundTripMs: manifest.clockRoundTripMs,
      clockSkewMs: manifest.clockSkewMs, mutationPerformed: false, applyEnabled: false, output: outputPath }));
  } finally {
    client?.release(!success);
    await pool.end();
    if (output) {
      await output.close();
      if (!success) await unlink(outputPath); // Only our exclusively created, incomplete local output.
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch((error) => {
  console.error(JSON.stringify({ code: error instanceof SharedCellAuthorCompensationMigrationReviewError ? error.code : "SHARED_CELL_AUTHOR_COMPENSATION_MIGRATION_INSPECTION_FAILED",
    message: "Read-only migration review failed closed; provider and credential details are withheld.", mutationPerformed: false }));
  process.exitCode = 1;
});
