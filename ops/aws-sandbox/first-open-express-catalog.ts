import { createHash } from "node:crypto";
import { FIRST_OPEN_MANAGEMENT_SQL_USER as owner } from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";
import type { QueryResult } from "./first-open-express-database.ts";
import { stopFirstOpen } from "./first-open-express-scope.ts";

type Acl = { grantee: string; grantor: string };
type Owned = { owner: string; acl: Acl[] };
type Catalog = {
  relations: Owned[];
  functions: (Owned & { extensionOwned: boolean })[];
  types: { owner: string }[];
  extensions: { name: string; owner: string }[];
};
type VerifyOriginal = (result: QueryResult, tables: readonly string[]) => { catalogSha256: string; sequences: number };

/** Validate actual new ownership, then compare structure with the reviewed C4a
 * baseline. Never return the legacy owner projection as a real observation. */
export function verifyFirstOpenCatalog(result: QueryResult, tables: readonly string[], verifyOriginal: VerifyOriginal) {
  const c = result.rows[0]?.identity as Catalog | undefined;
  if (result.rowCount !== 1 || result.rows.length !== 1 || !c ||
    ![c.relations, c.functions, c.types, c.extensions].every(Array.isArray) || c.extensions.length !== 1 ||
    c.extensions[0].name !== "uuid-ossp" || ![owner, "rdsadmin"].includes(c.extensions[0].owner)) {
    return stopFirstOpen("ACTUAL_CATALOG_OWNERSHIP_CHANGED");
  }
  const canonical = canonicalJson(c);
  if (Buffer.byteLength(canonical) > 4_000_000) return stopFirstOpen("ACTUAL_CATALOG_TOO_LARGE");
  const expectOwned = (r: Owned, publicExecute: boolean) => {
    if (r.owner !== owner || !Array.isArray(r.acl) || r.acl.some(a => a.grantor !== owner ||
      (a.grantee !== owner && !(publicExecute && a.grantee === "PUBLIC")))) {
      return stopFirstOpen("ACTUAL_CATALOG_OWNERSHIP_CHANGED");
    }
    return { ...r, owner: "postgres", acl: r.acl.map(a => ({ ...a, grantor: "postgres",
      grantee: a.grantee === owner ? "postgres" : a.grantee })) };
  };
  const projected = { ...c, relations: c.relations.map(r => expectOwned(r, false)),
    functions: c.functions.map(f => f.extensionOwned === true ? f : expectOwned(f, true)),
    types: c.types.map(t => t.owner === owner ? { ...t, owner: "postgres" } : stopFirstOpen("ACTUAL_CATALOG_OWNERSHIP_CHANGED")),
    extensions: [{ ...c.extensions[0], owner: "rdsadmin" }] };
  const old = verifyOriginal({ ...result, rows: [{ ...result.rows[0], identity: projected }] }, tables);
  return { catalogSha256: createHash("sha256").update(canonical).digest("hex"), structureSha256: old.catalogSha256, sequences: old.sequences };
}
