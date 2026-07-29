import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

neonConfig.webSocketConstructor = WebSocket;

const schemaPath = resolve(process.cwd(), "db", "postgres-schema.sql");
const schemaSql = await readFile(schemaPath, "utf8");
const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  const existing = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  if (existing.rows.length > 0) {
    throw new Error(
      `Refusing to initialize a non-empty public schema (${existing.rows.length} tables found).`,
    );
  }

  await client.query(schemaSql);
  const created = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  console.log(
    JSON.stringify({
      schema: "public",
      tableCount: created.rows.length,
      tables: created.rows.map((row) => row.table_name),
    }),
  );
} finally {
  client.release();
  await pool.end();
}
