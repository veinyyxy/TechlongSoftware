import { env } from "cloudflare:workers";
import { createNeonPostgresDatabase } from "./postgres-neon.ts";

function bindingDatabaseUrl() {
  return typeof env.DATABASE_URL === "string"
    ? env.DATABASE_URL.trim()
    : typeof process !== "undefined" ? process.env.DATABASE_URL?.trim() : undefined;
}

const neonDatabase = createNeonPostgresDatabase(() => {
  const configured = bindingDatabaseUrl();
  if (!configured) {
    throw new Error("PostgreSQL DATABASE_URL is unavailable. Configure the Neon pooled connection string.");
  }
  return configured;
});

function nativeDatabase() {
  // The isolated Node build supplies this object. Workers and local Neon do
  // not import the native driver's Node TCP dependencies.
  const configured = env.TECHLONG_SAAS_CONTROL_NATIVE_DB;
  if (configured === undefined) return undefined;
  const database = configured as Partial<ApplicationDatabase> | null;
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw new Error("SaaS control database binding is invalid.");
  }
  return database as ApplicationDatabase;
}

export function getPostgresDatabase(): ApplicationDatabase {
  return nativeDatabase() ?? neonDatabase;
}

export function hasPostgresDatabaseUrl(): boolean {
  return Boolean(nativeDatabase() || bindingDatabaseUrl() ||
    (typeof process !== "undefined" && process.env.DATABASE_URL?.trim()));
}
