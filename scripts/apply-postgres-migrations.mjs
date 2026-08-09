import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { migrationChecksum } from "./migration-checksum.mjs";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

neonConfig.webSocketConstructor = WebSocket;

const migrationsDirectory = resolve(
  process.cwd(),
  "db",
  "postgres-migrations",
);
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const pool = new Pool({ connectionString });
const client = await pool.connect();
const applied = [];
const skipped = [];

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at bigint NOT NULL
    )
  `);

  for (const filename of migrationFiles) {
    const sql = await readFile(resolve(migrationsDirectory, filename), "utf8");
    // Git stores migrations with LF, while Windows may check them out as CRLF.
    // Normalize line endings so the immutable checksum is cross-platform.
    const checksum = migrationChecksum(sql);
    const existing = await client.query(
      "SELECT checksum FROM schema_migrations WHERE filename = $1 LIMIT 1",
      [filename],
    );

    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(
          `Migration ${filename} was modified after it was applied.`,
        );
      }
      skipped.push(filename);
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum, applied_at)
         VALUES ($1, $2, $3)`,
        [filename, checksum, Date.now()],
      );
      await client.query("COMMIT");
      applied.push(filename);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  console.log(JSON.stringify({ applied, skipped }));
} finally {
  client.release();
  await pool.end();
}
