import {
  neon,
  type FieldDef,
  type FullQueryResults,
  type NeonQueryFunction,
  type NeonQueryFunctionInTransaction,
} from "@neondatabase/serverless";
import { env } from "cloudflare:workers";

type Row = Record<string, unknown>;
type SqlClient = NeonQueryFunction<false, true>;

let cachedConnectionString: string | null = null;
let cachedClient: SqlClient | null = null;

function requireDatabaseUrl(): string {
  const bindings = env as unknown as Record<string, unknown>;
  const configured =
    typeof bindings.DATABASE_URL === "string"
      ? bindings.DATABASE_URL.trim()
      : typeof process !== "undefined"
        ? process.env.DATABASE_URL?.trim()
        : "";

  if (!configured) {
    throw new Error(
      "PostgreSQL DATABASE_URL is unavailable. Configure the Neon pooled connection string.",
    );
  }
  return configured;
}

function getSqlClient(): SqlClient {
  const connectionString = requireDatabaseUrl();
  if (cachedClient && cachedConnectionString === connectionString) {
    return cachedClient;
  }

  cachedConnectionString = connectionString;
  cachedClient = neon(connectionString, { fullResults: true });
  return cachedClient;
}

function toPostgresPlaceholders(query: string): string {
  let parameter = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let result = "";

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    const next = query[index + 1];

    if (character === "'" && !inDoubleQuote) {
      result += character;
      if (inSingleQuote && next === "'") {
        result += next;
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += character;
      continue;
    }

    if (character === "?" && !inSingleQuote && !inDoubleQuote) {
      parameter += 1;
      result += `$${parameter}`;
      continue;
    }

    result += character;
  }

  // SQLite LIKE is case-insensitive for ASCII by default. PostgreSQL ILIKE
  // preserves the existing search behavior for customer-entered filters.
  return result.replace(/\bLIKE\b/gi, "ILIKE");
}

function normalizeRows<T>(
  rows: Record<string, unknown>[],
  fields: FieldDef[],
): T[] {
  const bigintFields = new Set(
    fields
      .filter((field) => field.dataTypeID === 20)
      .map((field) => field.name),
  );

  return rows.map((source) => {
    const row = { ...source };
    for (const field of bigintFields) {
      const value = row[field];
      if (typeof value !== "string" || !/^-?\d+$/.test(value)) continue;
      const numeric = Number(value);
      if (Number.isSafeInteger(numeric)) row[field] = numeric;
    }
    return row as T;
  });
}

function toDatabaseResult<T>(
  result: FullQueryResults<false>,
): DatabaseResult<T> {
  const rows = normalizeRows<T>(result.rows as Row[], result.fields);
  return {
    success: true,
    results: rows,
    meta: {
      changes: result.rowCount,
      rows_read: rows.length,
      rows_written:
        result.command === "INSERT" ||
        result.command === "UPDATE" ||
        result.command === "DELETE"
          ? result.rowCount
          : 0,
    },
  };
}

class NeonPreparedStatement implements DatabasePreparedStatement {
  readonly query: string;
  readonly values: DatabaseValue[];

  constructor(query: string, values: DatabaseValue[] = []) {
    this.query = toPostgresPlaceholders(query);
    this.values = values;
  }

  bind(...values: DatabaseValue[]): DatabasePreparedStatement {
    return new NeonPreparedStatement(this.query, values);
  }

  buildQuery(
    client: SqlClient | NeonQueryFunctionInTransaction<false, true>,
  ) {
    return client.query(this.query, this.values);
  }

  private async execute<T>(): Promise<DatabaseResult<T>> {
    const result = await getSqlClient().query(this.query, this.values);
    return toDatabaseResult<T>(result);
  }

  async first<T = unknown>(): Promise<T | null> {
    const result = await this.execute<T>();
    return result.results[0] ?? null;
  }

  async all<T = unknown>(): Promise<DatabaseResult<T>> {
    return this.execute<T>();
  }

  async run(): Promise<DatabaseResult> {
    return this.execute();
  }
}

class NeonDatabase implements ApplicationDatabase {
  prepare(query: string): DatabasePreparedStatement {
    return new NeonPreparedStatement(query);
  }

  async batch<T = unknown>(
    statements: DatabasePreparedStatement[],
  ): Promise<DatabaseResult<T>[]> {
    const prepared = statements.map((statement) => {
      if (!(statement instanceof NeonPreparedStatement)) {
        throw new Error(
          "PostgreSQL batches can only contain Neon prepared statements.",
        );
      }
      return statement;
    });
    const client = getSqlClient();
    const results = await client.transaction(
      (transaction) =>
        prepared.map((statement) => statement.buildQuery(transaction)),
      { fullResults: true },
    );
    return results.map((result) => toDatabaseResult<T>(result));
  }
}

const neonDatabase = new NeonDatabase();

export function getPostgresDatabase(): ApplicationDatabase {
  return neonDatabase;
}

export function hasPostgresDatabaseUrl(): boolean {
  const bindings = env as unknown as Record<string, unknown>;
  return (
    (typeof bindings.DATABASE_URL === "string" &&
      bindings.DATABASE_URL.trim().length > 0) ||
    (typeof process !== "undefined" &&
      Boolean(process.env.DATABASE_URL?.trim()))
  );
}
