import { getPostgresDatabase } from "@/db/postgres";

const TABLES = [
  "users",
  "products",
  "app_instance_templates",
  "app_instance_template_versions",
  "plans",
  "workspaces",
  "subscriptions",
  "payment_records",
  "payment_checkout_sessions",
  "app_instances",
  "subscription_purchase_orders",
  "payment_webhook_events",
  "workspace_members",
  "workspace_product_entitlements",
] as const;

type TableName = (typeof TABLES)[number];
type DatabaseRow = Record<string, D1Value>;

const ALLOWED_SCHEMA_SEEDS: Partial<Record<TableName, Set<string>>> = {
  products: new Set(["prd_restaurant_order_system"]),
  app_instance_templates: new Set(["tpl_restaurant_standard"]),
  app_instance_template_versions: new Set([
    "tplver_restaurant_standard_v1",
  ]),
};

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function readRows(
  database: D1Database,
  table: TableName,
): Promise<DatabaseRow[]> {
  const result = await database
    .prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY id`)
    .all<DatabaseRow>();
  return result.results;
}

async function readTargetIds(
  database: D1Database,
  table: TableName,
): Promise<string[]> {
  const result = await database
    .prepare(`SELECT id FROM ${quoteIdentifier(table)} ORDER BY id`)
    .all<{ id: string }>();
  return result.results.map((row) => row.id);
}

function makeUpsert(
  database: D1Database,
  table: TableName,
  row: DatabaseRow,
): D1PreparedStatement {
  const columns = Object.keys(row);
  if (!columns.length || !columns.includes("id")) {
    throw new Error(`Cannot migrate ${table}: row has no primary key.`);
  }
  const quotedColumns = columns.map(quoteIdentifier);
  const updates = quotedColumns
    .filter((column) => column !== '"id"')
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const sql = `INSERT INTO ${quoteIdentifier(table)} (
      ${quotedColumns.join(", ")}
    ) VALUES (${columns.map(() => "?").join(", ")})
    ON CONFLICT (id) DO UPDATE SET ${updates}`;
  return database
    .prepare(sql)
    .bind(...columns.map((column) => row[column]));
}

async function upsertRows(
  database: D1Database,
  table: TableName,
  rows: DatabaseRow[],
): Promise<void> {
  const batchSize = 40;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const statements = rows
      .slice(offset, offset + batchSize)
      .map((row) => makeUpsert(database, table, row));
    await database.batch(statements);
  }
}

export interface DatabaseMigrationTableReport {
  table: TableName;
  sourceRows: number;
  targetRows: number;
}

export async function inspectDatabaseMigration(
  source: D1Database,
): Promise<DatabaseMigrationTableReport[]> {
  const target = getPostgresDatabase();
  const reports: DatabaseMigrationTableReport[] = [];
  for (const table of TABLES) {
    const [sourceRows, targetRows] = await Promise.all([
      source
        .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
        .first<{ count: number }>(),
      target
        .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
        .first<{ count: number }>(),
    ]);
    reports.push({
      table,
      sourceRows: Number(sourceRows?.count ?? 0),
      targetRows: Number(targetRows?.count ?? 0),
    });
  }
  return reports;
}

export async function migrateD1ToPostgres(
  source: D1Database,
): Promise<DatabaseMigrationTableReport[]> {
  const target = getPostgresDatabase();
  const sourceRowsByTable = new Map<TableName, DatabaseRow[]>();

  for (const table of TABLES) {
    const sourceRows = await readRows(source, table);
    const sourceIds = new Set(sourceRows.map((row) => String(row.id)));
    const existingTargetIds = await readTargetIds(target, table);
    const allowedSeeds = ALLOWED_SCHEMA_SEEDS[table] ?? new Set<string>();
    const unexpected = existingTargetIds.filter(
      (id) => !sourceIds.has(id) && !allowedSeeds.has(id),
    );
    if (unexpected.length) {
      throw new Error(
        `Neon target table ${table} contains unexpected rows; migration stopped.`,
      );
    }
    sourceRowsByTable.set(table, sourceRows);
  }

  for (const table of TABLES) {
    await upsertRows(target, table, sourceRowsByTable.get(table) ?? []);
  }

  const report = await inspectDatabaseMigration(source);
  const mismatch = report.find(
    (item) => item.sourceRows !== item.targetRows,
  );
  if (mismatch) {
    throw new Error(
      `Row count mismatch after migration: ${mismatch.table} has ${mismatch.sourceRows} D1 rows and ${mismatch.targetRows} Neon rows.`,
    );
  }
  return report;
}
