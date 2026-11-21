import { createRequire } from "node:module";
import type { TLSSocket } from "node:tls";
import { FIRST_OPEN_MANAGEMENT_CLAIM_READ } from "../../../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { FIRST_ONBOARDING_COMPLETE_ENTRY, FIRST_ONBOARDING_READ_ENTRY } from "../../../lib/deployments/execution/first-onboarding-completion-entry.ts";
import { FIRST_OPEN_MIDDLE_RPC } from "../../../lib/deployments/execution/first-onboarding-middle.ts";

const prefix = "first_onboarding_fc41597f_";
const schema = "techlong_first_onboarding_claim";
const statements = {
  management: [FIRST_OPEN_MANAGEMENT_CLAIM_READ],
  review: [`SELECT ${schema}.review() AS result`, `SELECT ${schema}.release() AS result`],
  claim: [`SELECT * FROM ${schema}.claim($1::text,$2::jsonb)`],
  middle: [FIRST_OPEN_MIDDLE_RPC],
  complete: [FIRST_ONBOARDING_COMPLETE_ENTRY],
  inspect: [FIRST_ONBOARDING_READ_ENTRY],
};
type Role = keyof typeof statements;
type Client = { connect(): Promise<void>; end(): Promise<void>; query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
  on(event: "error", listener: () => void): void; connection?: { stream?: TLSSocket } };
const fail = (code: string): never => { throw Error("FIRST_OPEN_NEON_" + code); };

export function firstOpenNeonCoordinates(role: Role, url: string) {
  try {
    const u = new URL(url), login = prefix + (role === "management" ? "review" : role);
    if (!["postgres:", "postgresql:"].includes(u.protocol) || !/^[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) ||
      (u.port && u.port !== "5432") || u.pathname !== "/neondb" || u.hash || decodeURIComponent(u.username) !== login || !u.password ||
      [...u.searchParams].some(([k, v]) => k !== "sslmode" || !["require", "verify-full"].includes(v)) ||
      u.searchParams.getAll("sslmode").length > 1) return fail("COORDINATES");
    return { host: u.hostname, port: 5432, database: "neondb", user: login, password: decodeURIComponent(u.password) };
  } catch { return fail("COORDINATES"); }
}

/** No owner/config fallback. Each role gets its own lazy client and only the
 * installed RPC statements; a read login cannot invoke the write adapters. */
export function firstOpenNeonPort(role: Role, url: string, signal: AbortSignal) {
  const coords = firstOpenNeonCoordinates(role, url);
  let opened: Promise<Client> | undefined, client: Client | undefined, closed = false;
  const dispose = async () => {
    signal.removeEventListener("abort", abort);
    closed = true;
    const c = client;
    client = undefined;
    if (c) await c.end().catch(() => {});
  };
  const abort = () => { void dispose(); };
  return {
    async query(statement: string, parameters: unknown[]) {
      signal.throwIfAborted();
      if (closed || !statements[role].includes(statement)) return fail("STATEMENT");
      opened ??= (async () => {
        const { Client } = createRequire(import.meta.url)("pg") as { Client: new (options: object) => Client };
        const c = client = new Client({ ...coords, ssl: { rejectUnauthorized: true, servername: coords.host, minVersion: "TLSv1.2" },
          connectionTimeoutMillis: 8000, statement_timeout: 15000, query_timeout: 16000 });
        c.on("error", abort);
        signal.addEventListener("abort", abort, { once: true });
        await c.connect();
        if (c.connection?.stream?.authorized !== true || c.connection.stream.encrypted !== true) return fail("TLS");
        return c;
      })();
      try {
        const active = await opened;
        signal.throwIfAborted();
        const result = await active.query(statement, parameters);
        signal.throwIfAborted();
        return result;
      } catch { await dispose(); return fail("QUERY_UNVERIFIED"); }
    },
    dispose,
  };
}
