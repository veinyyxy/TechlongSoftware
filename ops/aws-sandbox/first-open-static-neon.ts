import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { TLSSocket } from "node:tls";
import { parseEnv } from "node:util";
import { loadFirstOnboardingReview, SELECT_FIRST_ONBOARDING, type FirstOnboardingReviewRow } from "../../lib/deployments/first-onboarding.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { deriveFirstOpenTaskRelease, firstOpenVersion, type FirstOpenBackendPublicationProof } from "../../lib/deployments/execution/first-onboarding-version.ts";
import type { SoftwareRelease } from "../../lib/deployments/releases/contract.ts";
import { firstOpenNeonReserveStatements } from "./first-open-neon-install.ts";
import { firstOpenTaskRebindStatements, verifyFirstOpenTaskRebindReadback } from "./first-open-task-rebind.ts";
import prepared from "./first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };
import original from "../../docs/aws-instance-release-initial-publication-observed-20261117.json" with { type: "json" };

const { scope, portBinding: { neon } } = prepared;
const configPath = new URL("../../.env.local", import.meta.url);
const owner = "neondb_owner", catalogOwner = "deployment_release_owner";
const hex = /^[a-f0-9]{64}$/;
const deny = (reason: string): never => { throw Error("FIRST_OPEN_STATIC_NEON_" + reason); };
const oldHold = "2b3f4adeb2d7ec50028b7da8c6b04e870ae99cd689974ab6e7309592f4c14691";
const allRoles = [...neon.definerRoles, ...Object.values(neon.runtimeLogins)];
const originalA = original.publication.a as SoftwareRelease;
export const FIRST_OPEN_STATIC_NEON_HOST_SHA256 = "956f88b7b5a633675a1acf4c72b2720a54e8b837dc2d55f1d27010f7e9830bcb";
const list = (a: readonly string[]) => a.map(v => "'" + v.replaceAll("'", "''") + "'").join(",");
const noExecutionHistory = `
  AND NOT EXISTS (SELECT 1 FROM public.deployment_step_runs x WHERE x.deployment_id=d.id OR x.job_id=j.id)
  AND NOT EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations x WHERE x.app_instance_id=a.id)`;
const qualifiedHeld = SELECT_FIRST_ONBOARDING.replace(
  /\b(FROM|JOIN) (deployment_jobs|app_instance_deployments|app_instances|workspaces|subscriptions|deployment_environments|deployment_tenant_resources)\b/g, "$1 public.$2",
) + `
  AND d.id=$2 AND a.id=$3 AND s.id=$4 AND e.id=$5 AND encode(sha256(convert_to(a.workspace_id,'UTF8')),'hex')=$6
  AND NOT EXISTS (SELECT 1 FROM deployment_release.instance_state x WHERE x.instance_id=a.id)` + noExecutionHistory;
const approveArgs = [scope.jobId, scope.deploymentId, scope.instanceId, scope.subscriptionId, scope.environmentId, scope.workspaceSha256];

/** Inspector GRANT is a transient permission write, never a READ ONLY operation. */
export const FIRST_OPEN_STATIC_NEON_LIMITS = Object.freeze({
  configurationReads: 1, connections: 2, sql: 32, writerSql: 21, inspectorSql: 11,
  durableCommit: 1, temporaryInspectorGrant: 1, lockTimeoutSeconds: 3, statementTimeoutSeconds: 20,
});

export interface FirstOpenStaticNeonReview {
  schema: "techlong/first-open-static-neon/v1";
  jobId: string;
  hostSha256: string;
  oldReviewSha256: string;
  publicationReviewSha256: string;
  writeBefore: number;
}

type SqlReply = { rows: unknown[]; command: string };
export interface FirstOpenStaticNeonSession {
  query(text: string, values: readonly unknown[], signal: AbortSignal): Promise<SqlReply>;
  close(): Promise<void>;
}
export interface FirstOpenStaticNeonPorts {
  /** Independent physical TLS sessions, without a pool or client reuse. */
  connections: (hostSha256: string) => Promise<(role: "writer" | "inspector", signal: AbortSignal) => Promise<FirstOpenStaticNeonSession>>;
}
export interface FirstOpenStaticNeonJournal {
  /** Create a permanent slot before provider calls; reject if already occupied. */
  consume(slot: "fc41597f-neon-static-v1", intent: { reviewSha256: string; publicationProofSha256: string }): Promise<void>;
  record(stage: "commit-attempt" | "commit-ack" | "readback", receipt: FirstOpenStaticNeonReceipt): Promise<void>;
}
export interface FirstOpenStaticNeonReceipt {
  status: "STOPPED_BEFORE_COMMIT" | "COMMIT_UNKNOWN_STOP" | "COMMITTED_INSPECTION_REQUIRED" | "STATIC_NEON_MATCHED";
  jobId: string;
  sql: number;
  connections: number;
  commitsAttempted: number;
  inspectionGrantsAttempted: number;
  releaseSha256: string;
  newReviewSha256?: string;
}
export class FirstOpenStaticNeonStopped extends Error {
  readonly receipt: FirstOpenStaticNeonReceipt;
  readonly code: string;
  constructor(receipt: FirstOpenStaticNeonReceipt, code: string) {
    super("FIRST_OPEN_STATIC_NEON_" + receipt.status);
    this.receipt = receipt;
    this.code = code;
  }
}

/** The exact commit barrier, also usable with a fault-injected SQL port. */
export async function firstOpenStaticNeonCommitBarrier(receipt: FirstOpenStaticNeonReceipt, ports: {
  guard: () => void;
  record: (stage: "commit-attempt" | "commit-ack") => Promise<void>;
  submitCommitOnce: () => Promise<{ command: string }>;
}) {
  if (receipt.status !== "STOPPED_BEFORE_COMMIT" || receipt.commitsAttempted !== 0) return deny("COMMIT_REPLAY");
  ports.guard();
  // The durable intent must never look like proof that the transaction did
  // not commit if the process exits before its ACK can be recorded.
  receipt.status = "COMMIT_UNKNOWN_STOP";
  await ports.record("commit-attempt");
  ports.guard();
  receipt.commitsAttempted++;
  if ((await ports.submitCommitOnce()).command !== "COMMIT") return deny("COMMIT_NOT_ACKNOWLEDGED");
  receipt.status = "COMMITTED_INSPECTION_REQUIRED";
  await ports.record("commit-ack");
}

const roleReadback = `SELECT
 (pg_catalog.current_database()='neondb' AND current_user='${owner}' AND session_user=current_user
  AND (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())=16396
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND oid=16392 AND rolcreaterole AND NOT rolsuper)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
   WHERE n.nspname='deployment_release' AND n.oid=237571 AND c.relname='releases' AND c.oid=237572
    AND c.relkind='r' AND pg_catalog.pg_get_userbyid(c.relowner)='${catalogOwner}' AND NOT c.relrowsecurity)
  AND NOT pg_catalog.pg_has_role(current_user,'${catalogOwner}','SET') AND NOT pg_catalog.pg_has_role(current_user,'${catalogOwner}','USAGE')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles o ON o.oid=m.roleid
    WHERE o.rolname='${catalogOwner}' AND m.member=16392 AND m.admin_option AND m.grantor<>16392)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles o ON o.oid=m.roleid
    WHERE o.rolname='${catalogOwner}' AND m.member=16392 AND m.grantor=16392 AND (m.admin_option OR m.inherit_option OR m.set_option))
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles r WHERE r.rolname IN (${list(allRoles)})
   AND NOT (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
   AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid)=1
   AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid AND m.member=16392 AND m.grantor<>16392
     AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend dep WHERE dep.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass
     AND dep.refobjid=r.oid AND dep.deptype IN ('o','a','i','r')))=8
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN (${list(neon.schemas)}))
  AND NOT EXISTS (SELECT 1 FROM deployment_release.instance_state WHERE instance_id='${scope.instanceId}')
 ) AS matched,
 (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.grantor),'[]'::pg_catalog.jsonb)
  FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles o ON o.oid=m.roleid WHERE o.rolname='${catalogOwner}' AND m.member=16392) AS membership`;

function one<T>(reply: SqlReply, reason: string): T {
  if (reply.rows.length !== 1) return deny(reason);
  return reply.rows[0] as T;
}

/** Static only; caller must pass independently verified publication proof. */
export async function runFirstOpenStaticNeon(input: {
  review: FirstOpenStaticNeonReview; approvedReviewSha256: string;
  publication: { proof: FirstOpenBackendPublicationProof; proofSha256: string };
  journal: FirstOpenStaticNeonJournal;
}, ports: FirstOpenStaticNeonPorts = { connections: localNeonConnections }, now: () => number = Date.now) {
  const { review, approvedReviewSha256, publication } = structuredClone({
    review: input.review, approvedReviewSha256: input.approvedReviewSha256, publication: input.publication,
  });
  const start = now(), deadline = () => {
    const remaining = review.writeBefore - now();
    if (!Number.isSafeInteger(remaining) || remaining < 1) return deny("WINDOW");
    return AbortSignal.timeout(Math.min(remaining, 21000));
  };
  if (review.schema !== "techlong/first-open-static-neon/v1" || review.jobId !== scope.jobId || review.oldReviewSha256 !== oldHold ||
    review.hostSha256 !== FIRST_OPEN_STATIC_NEON_HOST_SHA256 || !hex.test(approvedReviewSha256) || !hex.test(review.publicationReviewSha256) ||
    await sha256Hex(review) !== approvedReviewSha256 || !Number.isSafeInteger(review.writeBefore) || review.writeBefore <= start ||
    review.writeBefore - start > 3_600_000 || publication.proof.publishedAt > start) return deny("APPROVAL");
  const taskRelease = await deriveFirstOpenTaskRelease(originalA, publication.proof,
    { reviewSha256: review.publicationReviewSha256, proofSha256: publication.proofSha256 });
  const releaseSha256 = await sha256Hex(taskRelease);
  deadline();
  await input.journal.consume("fc41597f-neon-static-v1", { reviewSha256: approvedReviewSha256, publicationProofSha256: publication.proofSha256 });
  let phase: "writer" | "inspector" = "writer";
  const receipt: FirstOpenStaticNeonReceipt = {
    status: "STOPPED_BEFORE_COMMIT", jobId: scope.jobId, sql: 0, connections: 0,
    commitsAttempted: 0, inspectionGrantsAttempted: 0, releaseSha256,
  };
  let current: FirstOpenStaticNeonSession | undefined;
  let writerSql = 0, inspectorSql = 0;
  const q = async (text: string, values: readonly unknown[] = []) => {
    const signal = deadline();
    if (!current || receipt.sql >= FIRST_OPEN_STATIC_NEON_LIMITS.sql ||
      (phase === "writer" ? writerSql >= FIRST_OPEN_STATIC_NEON_LIMITS.writerSql : inspectorSql >= FIRST_OPEN_STATIC_NEON_LIMITS.inspectorSql)) return deny("SQL_CAP");
    receipt.sql++;
    if (phase === "writer") writerSql++; else inspectorSql++;
    return current.query(text, values, signal);
  };
  const snapshot = (stage: Parameters<FirstOpenStaticNeonJournal["record"]>[0]) => input.journal.record(stage, { ...receipt });
  try {
    deadline();
    const connect = await ports.connections(review.hostSha256);
    const sig = deadline();
    receipt.connections++;
    const writer = await connect("writer", sig);
    current = writer;
    await q("BEGIN");
    await q("SET LOCAL search_path TO pg_catalog");
    const held = await loadFirstOnboardingReview(scope.jobId, {
      readOne: async (text, args) => {
        if (text !== SELECT_FIRST_ONBOARDING || args[0] !== scope.jobId) return deny("HELD_SQL");
        return one<FirstOnboardingReviewRow>(await q(qualifiedHeld, approveArgs), "HELD_UNIQUE");
      },
      readRelease: async id => id === originalA.id ? structuredClone(originalA) : null,
    });
    if (!held || held.reviewSha256 !== review.oldReviewSha256) return deny("HELD_PREIMAGE_CHANGED");
    const rebind = await firstOpenTaskRebindStatements({ oldReview: held, originalRelease: originalA, taskRelease,
      approvedTaskReleaseSha256: releaseSha256, trustedPublication: { reviewSha256: review.publicationReviewSha256, proofSha256: publication.proofSha256 },
      writeBefore: review.writeBefore }, now());
    const reserve = firstOpenNeonReserveStatements();
    if (3 + reserve.length + rebind.statements.length + 1 !== FIRST_OPEN_STATIC_NEON_LIMITS.writerSql) return deny("SQL_SHAPE");
    // Reserve against still-held old A; all role and rebind changes share one COMMIT.
    for (const sql of [...reserve, ...rebind.statements]) await q(sql);
    await firstOpenStaticNeonCommitBarrier(receipt, { guard: deadline, record: snapshot, submitCommitOnce: () => q("COMMIT") });
    await writer.close();
    current = undefined;
    const inspectSignal = deadline();
    receipt.connections++;
    const inspector = await connect("inspector", inspectSignal);
    if (inspector === writer) return deny("INDEPENDENT_CONNECTION_REQUIRED");
    current = inspector;
    phase = "inspector";
    await q("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await q("SET LOCAL search_path TO pg_catalog");
    await q("SET LOCAL lock_timeout TO '3s'");
    await q("SET LOCAL statement_timeout TO '20s'");
    const before = one<{matched: boolean; membership: unknown[]}>(await q(roleReadback), "ACL_UNIQUE");
    if (before.matched !== true || !Array.isArray(before.membership)) return deny("ACL_POSTIMAGE");
    const row = one<FirstOnboardingReviewRow>(await q(rebind.independentReadback.review + noExecutionHistory), "READBACK_HELD");
    deadline();
    receipt.inspectionGrantsAttempted++;
    await q("GRANT deployment_release_owner TO SESSION_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER");
    await q("SET LOCAL ROLE deployment_release_owner");
    const found = one<{ release: typeof taskRelease }>(await q(rebind.independentReadback.catalog), "READBACK_CATALOG");
    const observed = await verifyFirstOpenTaskRebindReadback(rebind, row, found.release);
    if ((await q("ROLLBACK")).command !== "ROLLBACK") return deny("INSPECTION_ROLLBACK_NOT_ACKNOWLEDGED");
    const after = one<typeof before>(await q(roleReadback), "ACL_UNIQUE");
    if (after.matched !== true || canonicalJson(after.membership) !== canonicalJson(before.membership)) return deny("ACL_ROLLBACK_UNPROVED");
    receipt.status = "STATIC_NEON_MATCHED";
    receipt.newReviewSha256 = observed.review.reviewSha256;
    await snapshot("readback");
    return { ...receipt, releaseId: taskRelease.id, artifactRef: firstOpenVersion(taskRelease).artifactRef };
  } catch (error) {
    if (receipt.status === "STATIC_NEON_MATCHED") receipt.status = "COMMITTED_INSPECTION_REQUIRED";
    const sanitized = error instanceof Error && /^FIRST_OPEN_[A-Z0-9_]{1,70}$/.test(error.message)
      ? error.message : "PROVIDER_OR_LOCAL_FAILURE";
    // No retry. After an ambiguous COMMIT, only close the session.
    throw new FirstOpenStaticNeonStopped({ ...receipt }, sanitized);
  } finally {
    await current?.close().catch(() => {});
  }
}

type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(config: {text:string; values:readonly unknown[]; query_timeout: number}): Promise<SqlReply>;
  on(event: "error", run: () => void): void;
  connection?: { stream?: TLSSocket };
  password?: string | null;
  connectionParameters?: { password?: string | null };
};

async function localNeonConnections(hostSha256: string) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" || process.env.NODE_EXTRA_CA_CERTS ||
    process.env.PGOPTIONS || process.env.PGSERVICE || process.env.PGSERVICEFILE) return deny("AMBIENT_OVERRIDE");
  const cfg = await lstat(configPath);
  if (!cfg.isFile() || cfg.isSymbolicLink() || cfg.size < 1 || cfg.size >= 65536) return deny("CONFIG_SCOPE");
  const url = new URL(parseEnv(await readFile(configPath, "utf8")).DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/.test(url.hostname) ||
    await sha256Hex(url.hostname) !== hostSha256 || decodeURIComponent(url.username) !== owner ||
    !url.password || url.pathname !== "/neondb" || (url.port && url.port !== "5432") || url.hash ||
    [...url.searchParams].some(([k, v]) => !(k === "sslmode" && ["require", "verify-full"].includes(v)) &&
      !(k === "channel_binding" && ["require", "prefer"].includes(v))) ||
    url.searchParams.getAll("sslmode").length !== 1 || url.searchParams.getAll("channel_binding").length > 1) return deny("COORDINATES");
  const host = url.hostname, enableChannelBinding = url.searchParams.get("channel_binding") === "require";
  let password = decodeURIComponent(url.password);
  url.password = "";
  const { Client } = createRequire(import.meta.url)("pg") as { Client: new (options: object) => PgClient };
  const used = new Set<string>();
  return async (role: "writer" | "inspector", signal: AbortSignal): Promise<FirstOpenStaticNeonSession> => {
    signal.throwIfAborted();
    if (used.has(role) || (role === "inspector" && !used.has("writer"))) return deny("CONNECTION_REPLAY");
    used.add(role);
    const client = new Client({ host, port: 5432, user: owner, database: "neondb", password, options: "", enableChannelBinding,
      ssl: { rejectUnauthorized: true, servername: host, minVersion: "TLSv1.2" },
      connectionTimeoutMillis: 10000, statement_timeout: 20000, query_timeout: 21000, application_name: "techlong-first-open-static-neon" });
    if (role === "inspector") password = "";
    const clear = () => {
      client.password = null;
      if (client.connectionParameters) client.connectionParameters.password = null;
    };
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try { await client.end(); } finally { clear(); }
    };
    const destroy = () => client.connection?.stream?.destroy();
    client.on("error", destroy);
    signal.addEventListener("abort", destroy, { once: true });
    try {
      await client.connect();
      signal.throwIfAborted();
      if (client.connection?.stream?.encrypted !== true || client.connection.stream.authorized !== true) return deny("TLS");
    } catch (e) { await close().catch(() => {}); throw e; }
    finally { signal.removeEventListener("abort", destroy); }
    return { close, async query(text, values, abort) {
      abort.throwIfAborted();
      if (closed) return deny("CONNECTION_CLOSED");
      abort.addEventListener("abort", destroy, { once: true });
      try {
        const reply = await client.query({ text, values, query_timeout: 21000 });
        abort.throwIfAborted();
        return reply;
      } finally { abort.removeEventListener("abort", destroy); }
    } };
  };
}
