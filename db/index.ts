import { env } from "cloudflare:workers";
import { getPostgresDatabase } from "./postgres";

export function getDatabase() {
  return getPostgresDatabase();
}

/**
 * The original Sites D1 database remains bound as a read-only rollback source
 * during the Neon cutover. Application requests must use getDatabase().
 */
export function getLegacyD1() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` and apply the generated migration.",
    );
  }

  return env.DB;
}
