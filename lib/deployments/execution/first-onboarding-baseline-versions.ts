/** Original source and offline HEAD contract, retained for historical evidence. */
export const FIRST_OPEN_BASELINE_BUCKET = "techlong-sandbox-402010193138-ca-central-1-tenant-baselines";
const owner = "402010193138";
const archiveSha = "1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a";
const manifestSha = "62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971";
export const FIRST_OPEN_BASELINE_OBJECTS = Object.freeze({
  archive: Object.freeze({ key: `approved/${archiveSha}/baseline.dump`, sha256: archiveSha, bytes: 203375 }),
  manifest: Object.freeze({ key: `approved/${manifestSha}/baseline.manifest.json`, sha256: manifestSha, bytes: 26502 }),
});
export type FirstOpenBaselineKind = keyof typeof FIRST_OPEN_BASELINE_OBJECTS;
export const validFirstOpenVersionId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_+=./-]{1,1024}$/.test(id) && id !== "null";

const jobId = "job_fc41597f9b5ba8e02b338ecf";
const prefix = `first-open-baselines/${jobId}/g1/`;
const fixedVersion = (kind: FirstOpenBaselineKind, versionId: string) => {
  const original = FIRST_OPEN_BASELINE_OBJECTS[kind];
  return Object.freeze({ ...original, key: prefix + original.key.slice("approved/".length), versionId });
};
// The two fixed-version HEAD receipts in sandbox-first-open-baseline-copy-fc41597f-continuation.verified.json.
export const FIRST_OPEN_BASELINE_BINDING = Object.freeze({
  jobId,
  bucket: "techlong-sandbox-cloud-worker-evidence-402010193138",
  objects: Object.freeze({
    archive: fixedVersion("archive", "F0IEF0BdsnrwTj6lhYHNeBSbzsz7Sx7K"),
    manifest: fixedVersion("manifest", "FYqR4mLX2pK3tcQjbyW1UtoJ1.LX3dFc"),
  }),
});

export function isFixedFirstOpenBaseline(baseline: object, reviewedJobId: string) {
  const { jobId, bucket, objects } = FIRST_OPEN_BASELINE_BINDING;
  const b = baseline as Record<string, unknown>;
  return reviewedJobId === jobId && b.approvedArchiveSha256 === objects.archive.sha256 &&
    (["archive", "manifest"] as const).every(kind => b[`${kind}S3Uri`] === `s3://${bucket}/${objects[kind].key}` &&
      b[`${kind}Sha256`] === objects[kind].sha256 && b[`${kind}VersionId`] === objects[kind].versionId);
}

export function firstOpenBaselineHeadRequest(kind: FirstOpenBaselineKind) {
  return { Bucket: FIRST_OPEN_BASELINE_BUCKET, Key: FIRST_OPEN_BASELINE_OBJECTS[kind].key,
    ExpectedBucketOwner: owner, ChecksumMode: "ENABLED" as const };
}

interface HeadProjection {
  VersionId?: string; ContentLength?: number; DeleteMarker?: boolean;
  ChecksumSHA256?: string; ChecksumType?: string;
}

/** Missing/unversioned/deleted/ambiguous metadata is not proof of absence or of
 * byte identity. The caller does not fall back to "latest" or GET automatically. */
export function projectFirstOpenBaselineHeads(heads: Record<FirstOpenBaselineKind, HeadProjection>) {
  return (["archive", "manifest"] as const).map(kind => {
    const { key, sha256, bytes } = FIRST_OPEN_BASELINE_OBJECTS[kind], head = heads[kind];
    const base = { kind, key, bytes, sha256 };
    if (!validFirstOpenVersionId(head?.VersionId) || head.DeleteMarker) return { ...base, versionId: null, status: "UNPINNED" as const };
    const versionId = head.VersionId;
    if (head.ContentLength !== bytes) return { ...base, versionId, status: "MISMATCH" as const };
    if (head.ChecksumType !== "FULL_OBJECT" || !head.ChecksumSHA256) {
      return { ...base, versionId, status: "FIXED_VERSION_BYTE_CHECK_REQUIRED" as const };
    }
    const expected = btoa(String.fromCharCode(...sha256.match(/../g)!.map(b => Number.parseInt(b, 16))));
    return { ...base, versionId, status: head.ChecksumSHA256 === expected ? "PIN_MATCHES" as const : "MISMATCH" as const };
  });
}
