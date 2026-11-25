import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { createPostgresDatabase } from "./postgres-adapter.ts";

type SqlClient = NeonQueryFunction<false, true>;

export function createNeonPostgresDatabase(
  databaseUrl: string | (() => string),
  createClient: (url: string) => SqlClient = url => neon(url, { fullResults: true }),
): ApplicationDatabase {
  let client: SqlClient | undefined;
  let clientUrl: string | undefined;

  function getClient(): SqlClient {
    const url = typeof databaseUrl === "string" ? databaseUrl : databaseUrl();
    if (!client || clientUrl !== url) {
      client = createClient(url);
      clientUrl = url;
    }
    return client;
  }

  return createPostgresDatabase({
    query: async ({ text, values }) => getClient().query(text, values),
    batch: (statements) => getClient().transaction(
      transaction => statements.map(({ text, values }) => transaction.query(text, values)),
      { fullResults: true },
    ),
  });
}
