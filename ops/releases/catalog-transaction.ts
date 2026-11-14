import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import type { SoftwareRelease } from "../../lib/deployments/releases/contract.ts";
import { registerVerifiedRelease } from "../../lib/deployments/releases/catalog.ts";
import type { ReleaseSqlClient } from "../../lib/deployments/releases/repository.ts";

export interface CatalogTarget { installer: string; schemaOid: number; releasesOid: number }
export class CatalogTransactionUnknown extends Error { constructor() { super("RELEASE_CATALOG_TRANSACTION_REQUIRES_INSPECTION"); } }

/** Fixed one-row import/inspection only. Owner SET is temporary inside each transaction.
 * Inspection SELECT is read-only, but its enclosing transaction performs these same role writes. */
async function transact(sql: ReleaseSqlClient, release: SoftwareRelease, target: CatalogTarget, write: boolean) {
  const run = (text: string, values: unknown[] = []) => sql.query(text, values);
  let commitAttempted = false;
  await run("BEGIN");
  try {
    await run("SET LOCAL search_path = pg_catalog");
    await run("SET LOCAL statement_timeout = '15s'"); await run("SET LOCAL lock_timeout = '2s'");
    const identity = await run(`select jsonb_build_object('user',current_user,'session',session_user,'super',r.rolsuper,'createRole',r.rolcreaterole,
      'setOwner',pg_has_role(current_user,o.oid,'SET'),'inheritOwner',pg_has_role(current_user,o.oid,'USAGE'),
      'ownerAdmin',exists(select 1 from pg_auth_members m where m.roleid=o.oid and m.member=r.oid and m.admin_option),
      'schemaOid',n.oid::bigint,'releasesOid',c.oid::bigint,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity)
      as result from pg_roles r cross join pg_roles o join pg_namespace n on n.nspname='deployment_release'
      join pg_class c on c.relnamespace=n.oid and c.relname='releases' and c.relkind='r'
      where r.rolname=current_user and o.rolname='deployment_release_owner'`);
    const value = identity.rows[0]?.result as { user: string; session: string; super: boolean; createRole: boolean; setOwner: boolean;
      inheritOwner: boolean; ownerAdmin: boolean; schemaOid: number; releasesOid: number; owner: string; rls: boolean } | undefined;
    if (identity.rows.length !== 1 || !value || value.user !== target.installer || value.session !== target.installer || value.super ||
      !value.createRole || value.setOwner || value.inheritOwner || !value.ownerAdmin || value.schemaOid !== target.schemaOid ||
      value.releasesOid !== target.releasesOid || value.owner !== "deployment_release_owner" || value.rls) throw new Error("RELEASE_CATALOG_TARGET_OR_OWNER_REJECTED");
    await run("GRANT deployment_release_owner TO SESSION_USER WITH INHERIT FALSE");
    await run("GRANT deployment_release_owner TO SESSION_USER WITH SET TRUE");
    await run("SET LOCAL ROLE deployment_release_owner");
    let status: string;
    if (write) status = await registerVerifiedRelease(sql, release);
    else {
      const result = await run(`select document || jsonb_build_object('status',status) as result from deployment_release.releases
        where id=$1 and product_id=$2 and component='tenant_api' and version=$3`, [release.id, release.productId, release.version]);
      if (result.rows.length !== 1 || canonicalJson(result.rows[0].result) !== canonicalJson(release)) throw new Error("RELEASE_CATALOG_INDEPENDENT_READBACK_MISMATCH");
      status = "INDEPENDENTLY_VERIFIED";
    }
    await run("SET LOCAL ROLE NONE");
    await run("GRANT deployment_release_owner TO SESSION_USER WITH SET FALSE");
    commitAttempted = true; await run("COMMIT");
    const closed = await run(`select jsonb_build_object('setOwner',pg_has_role(current_user,'deployment_release_owner','SET'),
      'inheritOwner',pg_has_role(current_user,'deployment_release_owner','USAGE')) as result`);
    if (canonicalJson(closed.rows[0]?.result) !== canonicalJson({ setOwner: false, inheritOwner: false })) throw new CatalogTransactionUnknown();
    return { status, releaseSha256: await sha256Hex(release), temporaryOwnerAccessClosed: true, businessRowsChanged: 0 };
  } catch (error) {
    if (!commitAttempted) { try { await run("ROLLBACK"); } catch { /* No claim of rollback; never retry. */ } }
    if (commitAttempted || !(error instanceof Error) || !/^[A-Z][A-Z0-9_]+$/.test(error.message)) throw new CatalogTransactionUnknown();
    throw error;
  }
}

export const writeCatalogRelease = (sql: ReleaseSqlClient, release: SoftwareRelease, target: CatalogTarget) => transact(sql, release, target, true);
export const inspectCatalogRelease = (sql: ReleaseSqlClient, release: SoftwareRelease, target: CatalogTarget) => transact(sql, release, target, false);
