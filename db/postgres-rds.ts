import { X509Certificate } from "node:crypto";
import {
  createPostgresDatabase,
  type PostgresResult,
  type PostgresStatement,
} from "./postgres-adapter.ts";

export const SAAS_CONTROL_DATABASE_MODE = "TECHLONG_SAAS_CONTROL_DATABASE_MODE";
export const RDS_CONTROL_DATABASE_MODE = "rds-postgresql";

type Environment = Readonly<Record<string, string | undefined>>;
type RdsConnection = {
  host: string;
  port: 5432;
  database: string;
  user: string;
  password: string;
};

export function readRdsControlDatabaseEnvironment(env: Environment): RdsConnection | null {
  const mode = env[SAAS_CONTROL_DATABASE_MODE];
  if (mode === undefined || mode === "neon") return null;
  if (mode !== RDS_CONTROL_DATABASE_MODE || env.AWS_EXECUTION_ENV !== "AWS_ECS_FARGATE" ||
      !/^http:\/\/169\.254\.170\.2\/v4\/[a-zA-Z0-9-]{1,128}$/.test(env.ECS_CONTAINER_METADATA_URI_V4 ?? "") ||
      env.TECHLONG_SANDBOX_FIRST_PURCHASE === "true" || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("SAAS_CONTROL_RDS_DEPLOYMENT_REQUIRED");
  }

  return readRdsControlDatabaseTarget(env);
}

/** Parse a pinned target after the caller has verified its host runtime. */
export function readRdsControlDatabaseTarget(env: Environment): RdsConnection {
  try {
    const region = env.AWS_REGION ?? "";
    const url = new URL(env.TECHLONG_SAAS_CONTROL_RDS_URL ?? "");
    const host = env.TECHLONG_SAAS_CONTROL_RDS_HOST ?? "";
    const database = env.TECHLONG_SAAS_CONTROL_RDS_DATABASE ?? "";
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const regionSuffix = `.${region}.rds.amazonaws.com`;
    // RDS DB instance endpoints have an instance name and DNS identifier.
    // Cluster, proxy, alias and alternate-region endpoints are separate bindings.
    const instance = host.slice(0, -regionSuffix.length);
    if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region) || !host.endsWith(regionSuffix) ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9]+$/.test(instance) ||
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== host || (url.port && url.port !== "5432") ||
        !/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(database) || url.pathname !== `/${database}` ||
        !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,62}$/.test(user) || !password || password.includes("\0") ||
        url.hash || [...url.searchParams].length !== 1 || url.searchParams.get("sslmode") !== "verify-full") {
      throw new Error();
    }
    return { host, port: 5432, database, user, password };
  } catch {
    // Driver/URL parse errors can contain the connection string.
    throw new Error("SAAS_CONTROL_RDS_TARGET_INVALID");
  }
}

export function rdsControlPoolOptions(connection: RdsConnection, ca: string) {
  try {
    if (!ca || ca.length > 512 * 1024) throw new Error();
    const blocks = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!blocks?.length || !blocks.every(block => new X509Certificate(block).ca)) throw new Error();
  } catch {
    throw new Error("SAAS_CONTROL_RDS_CA_INVALID");
  }
  // Pass parsed fields, so pg cannot replace ssl settings from a connection URI.
  return {
    ...connection,
    ssl: { ca, rejectUnauthorized: true as const, servername: connection.host, minVersion: "TLSv1.2" as const },
    application_name: "techlong-saas-control",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  };
}

type Queryable = {
  query(text: string, values?: (DatabaseValue | Buffer)[]): Promise<PostgresResult>;
};
type Pool = Queryable & {
  connect(): Promise<Queryable & { release(destroy?: boolean): void }>;
};

function execute(client: Queryable, statement: PostgresStatement) {
  return client.query(statement.text, statement.values.map(value =>
    value instanceof ArrayBuffer ? Buffer.from(value) : value));
}

export function createRdsPostgresDatabase(pool: Pool): ApplicationDatabase {
  return createPostgresDatabase({
    query: statement => execute(pool, statement),
    async batch(statements) {
      if (statements.length === 0) return [];
      const client = await pool.connect();
      let state: "begin" | "transaction" | "commit" | "done" = "begin";
      let discard = false;
      try {
        await client.query("BEGIN");
        state = "transaction";
        const results = [];
        for (const statement of statements) results.push(await execute(client, statement));
        state = "commit";
        await client.query("COMMIT");
        state = "done";
        return results;
      } catch (error) {
        // Failed BEGIN or an unknown COMMIT outcome cannot be safely reused.
        discard = state !== "transaction";
        if (state === "transaction") {
          try { await client.query("ROLLBACK"); } catch { discard = true; }
        }
        throw error;
      } finally {
        client.release(discard);
      }
    },
  });
}
