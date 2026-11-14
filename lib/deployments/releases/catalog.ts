import { canonicalJson } from "../execution/hash.ts";
import type { SoftwareRelease } from "./contract.ts";
import { ReleasePersistenceUnknown, ReleaseRequestRejected, type ReleaseSqlClient } from "./repository.ts";

/** ADMIN/import port only. Not a new runtime grant/function or automatic catalog collector.
 * Call only with a trusted verifyPublishedRelease result under separately reviewed catalog-write authority. */
export async function registerVerifiedRelease(sql: ReleaseSqlClient, release: SoftwareRelease): Promise<"REGISTERED" | "ALREADY_REGISTERED"> {
  if (release.status !== "ecr_verified") throw new ReleaseRequestRejected("RELEASE_CATALOG_VERIFIED_ONLY");
  const text = canonicalJson(release);
  let inserted;
  try {
    inserted = await sql.query(`insert into deployment_release.releases(id,product_id,component,version,status,document)
      values($1,$2,$3,$4,'ecr_verified',$5::jsonb) on conflict do nothing returning document as result`,
    [release.id, release.productId, release.component, release.version, text]);
  } catch { throw new ReleasePersistenceUnknown(); } // No retry, even if the INSERT actually committed.
  if (inserted.rows.length === 1) {
    if (canonicalJson(inserted.rows[0].result) !== text) throw new ReleasePersistenceUnknown();
    return "REGISTERED";
  }
  if (inserted.rows.length !== 0) throw new ReleasePersistenceUnknown();
  let existing;
  try {
    existing = await sql.query(`select document || jsonb_build_object('status',status) as result from deployment_release.releases
      where id=$1 or (product_id=$2 and component=$3 and version=$4)`, [release.id, release.productId, release.component, release.version]);
  } catch { throw new Error("RELEASE_CATALOG_READ_REQUIRED"); }
  if (existing.rows.length === 1 && canonicalJson(existing.rows[0].result) === text) return "ALREADY_REGISTERED";
  throw new ReleaseRequestRejected("RELEASE_CATALOG_VERSION_CONFLICT");
}
