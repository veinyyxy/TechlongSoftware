type Row = Record<string, unknown>;

export type PostgresStatement = { readonly text: string; readonly values: DatabaseValue[] };

export type PostgresResult = {
  rows: Row[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number | null;
  command: string;
};

type PostgresTransport = {
  query(statement: PostgresStatement): Promise<PostgresResult>;
  batch(statements: PostgresStatement[]): Promise<PostgresResult[]>;
};

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

  // Preserve the existing case-insensitive behavior for customer-entered filters.
  return result.replace(/\bLIKE\b/gi, "ILIKE");
}

function toDatabaseResult<T>(result: PostgresResult): DatabaseResult<T> {
  const bigintFields = result.fields.filter(field => field.dataTypeID === 20).map(field => field.name);
  const rows = result.rows.map((source) => {
    const row = { ...source };
    for (const field of bigintFields) {
      const value = row[field];
      if (typeof value !== "string" || !/^-?\d+$/.test(value)) continue;
      const numeric = Number(value);
      if (Number.isSafeInteger(numeric)) row[field] = numeric;
    }
    return row as T;
  });
  const count = result.rowCount ?? 0;
  return {
    success: true,
    results: rows,
    meta: {
      changes: count,
      rows_read: rows.length,
      rows_written: ["INSERT", "UPDATE", "DELETE"].includes(result.command) ? count : 0,
    },
  };
}

export function createPostgresDatabase(transport: PostgresTransport): ApplicationDatabase {
  // Prepared statements are bound to their creating transport and credentials.
  const statements = new WeakMap<DatabasePreparedStatement, PostgresStatement>();

  function prepared(statement: PostgresStatement): DatabasePreparedStatement {
    const binding: DatabasePreparedStatement = {
      bind: (...values) => prepared({ text: statement.text, values }),
      async first<T>() {
        return toDatabaseResult<T>(await transport.query(statement)).results[0] ?? null;
      },
      async all<T>() {
        return toDatabaseResult<T>(await transport.query(statement));
      },
      async run() {
        return toDatabaseResult(await transport.query(statement));
      },
    };
    statements.set(binding, statement);
    return binding;
  }

  return {
    prepare: (text) => prepared({ text: toPostgresPlaceholders(text), values: [] }),
    async batch<T>(batch: DatabasePreparedStatement[]) {
      const queries = batch.map(statement => {
        const query = statements.get(statement);
        if (!query) throw new Error("PostgreSQL batches require statements prepared by the same database adapter.");
        return query;
      });
      return (await transport.batch(queries)).map(result => toDatabaseResult<T>(result));
    },
  };
}
