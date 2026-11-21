import type { TenantDatabaseLifecycleState, TenantDatabaseMutationReceipt } from "../../lib/deployments/execution/contracts.ts";
import { compileExpressBootstrapCandidateV3, FIRST_OPEN_MANAGEMENT_SCHEMA as managerSchema,
  FIRST_OPEN_MANAGEMENT_SQL_USER as manager, type ExpressManagementTargetV3 } from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import type { FirstOnboardingDatabaseIdentity, FirstOnboardingExpressApproval, FirstOnboardingExpressPorts } from "../../lib/deployments/execution/first-onboarding-express.ts";
import { FIRST_OPEN_BASELINE_BINDING as baseline, isFixedFirstOpenBaseline } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { sameFirstOpenFence, stopFirstOpen, validOid, type FirstOpenFenceInput } from "./first-open-express-scope.ts";
import { FIRST_OPEN_INSPECTOR_SQL_USER, FIRST_OPEN_SQL_DEFINER as definer } from "./first-open-express-management.ts";
export { FIRST_OPEN_INSPECTOR_SQL_USER } from "./first-open-express-management.ts";

type Row = Record<string, unknown>;
export type QueryResult = { rowCount: number | null; rows: Row[] };
export type Sql = (text: string, values?: unknown[]) => Promise<QueryResult>;
export type FirstOpenJournal = { beforeStage(facts: Row): Promise<void>; stageObserved(facts: Row): Promise<void> };
type BootstrapProgram = ReturnType<typeof compileExpressBootstrapCandidateV3>;
type Oids = { databaseOid: string; roleOid: string };
type PreparedOids = Oids & { managerRoleOid: string };
type BaselineProgram = { tables: readonly string[]; restoreSql: string; verificationSql: string };
type CatalogEntry = { oid: string; name: string; login?: boolean; owner?: string; ownerOid?: string; connect?: boolean; comment: string };

// The loader binds these to the existing backend providers; tests substitute
// transports, not the first-open state machine or its SQL.
export interface FirstOpenBackendPorts {
  prepare(program: BootstrapProgram, signal: AbortSignal, journal: FirstOpenJournal): Promise<PreparedOids>;
  management<T>(signal: AbortSignal, run: (sql: Sql) => Promise<T>): Promise<T>;
  pair<T>(databaseOid: string, signal: AbortSignal, run: (management: Sql, tenant: Sql) => Promise<T>): Promise<T>;
  compileBaseline(bytes: { archiveBytes: Buffer; manifestBytes: Buffer }): Promise<BaselineProgram>;
  migrations(): readonly { sql: string }[];
  ownersSql: string;
  emptySql: string;
  catalogSql: string;
  roleSql: string;
  countsSql(tables: readonly string[]): string;
  verifyCounts(result: QueryResult, tables: readonly string[], migrated: boolean): void;
  verifyCatalog(result: QueryResult, tables: readonly string[]): { catalogSha256: string; structureSha256: string; sequences: number };
}
export type FirstOpenReadSession = <T>(signal: AbortSignal, run: (sql: Sql) => Promise<T>) => Promise<T>;
const archiveSha = baseline.objects.archive.sha256;
const owner = "tl_owner_" + s.stableIdentity.slice(0, 32) + "_g1";
const oidValues = [s.tenantRole, s.tenantDatabase];
const baselineCatalog = "868ca1351fc83ae6d202dfc1539345c63b39c21e82c0194bef402b7b3f9e223e"; // verified empty C3g catalog
const activeCatalog = "93d3c7eb62bbdd3e38f0a3943c9d44d607b419d562fcbd73ebd2fccf319e876b"; // verified migrated C4a catalog, before app ACL
const singletonSql = "SELECT EXISTS(SELECT 1 FROM public.saas_instances WHERE singleton_key=TRUE) AS singleton";
const identitySql = `SELECT current_database() AS database, current_user AS username, session_user AS session_username,
 current_setting('server_version_num')::integer AS version, current_setting('transaction_read_only') AS read_only,
 (SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS session_role_oid,
 COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS tls,
 d.oid::text AS database_oid, d.datdba::text AS owner_oid, pg_get_userbyid(d.datdba) AS owner,
 shobj_description(d.oid,'pg_database') AS marker
 FROM pg_catalog.pg_database d WHERE d.datname=current_database()`;
const inspectorIdentitySql = identitySql.replace(" d.oid::text AS database_oid", ` (SELECT count(*)::int FROM pg_catalog.pg_database other
 WHERE other.datallowconn AND other.datname<>current_database() AND has_database_privilege(current_user,other.oid,'CONNECT')) AS session_other_connectable_databases,
 d.oid::text AS database_oid`);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const commandKeys = (input: object, ...fields: string[]) => {
  if (!same(Object.keys(input).sort(), ["fence", "externalFence", "signal", ...fields].sort())) {
    stopFirstOpen("FIXED_OPERATION_FIELDS_CHANGED");
  }
};
const quote = (s: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(s)) return stopFirstOpen("SQL_IDENTIFIER_CHANGED");
  return `"${s}"`;
};
const app = quote(s.tenantRole), db = quote(s.tenantDatabase);
const one = (r: QueryResult) => {
  if (r.rowCount !== 1 || r.rows.length !== 1) return stopFirstOpen("CATALOG_ROW_CHANGED");
  return r.rows[0];
};
const readyComment = (approvalSha256: string, ids: Oids) => canonicalJson({
  schema: "techlong/first-open-express-ready/v1", jobId: s.jobId, approvalSha256, clusterResourceId: s.clusterId,
  ownershipMarker: owner, baselineDigest: archiveSha, schemaVersion: s.schemaVersion, databaseOid: ids.databaseOid, roleOid: ids.roleOid,
});

export function assertFirstOpenApplicationRole(row: Row, active: boolean, roleOid: string) {
  const parents = active ? [{ name: "rds_iam", oid: "16389", grantor: definer, admin: false, inherit: false, set: false }] : [];
  if (row.oid !== roleOid || row.name !== s.tenantRole || row.login !== active || row.iam_role_oid !== "16389" ||
    ["inherit", "superuser", "create_db", "create_role", "replication", "bypass_rls", "settings", "owns_objects"].some(k => row[k] !== false) ||
    row.connection_limit !== -1 || row.valid_until !== null || row.config !== null || row.other_connectable_databases !== 0 ||
    !same(row.parents, parents) || !Array.isArray(row.members) || row.members.length !== 1 ||
    row.members.some(m => m?.name !== definer || m.grantor !== "rdsadmin" ||
      m.admin !== true || m.inherit !== false || m.set !== false)) return stopFirstOpen("ROLE_OR_ISOLATION_CHANGED");
}

function checkTargetRead(row: Row, user: string, approvalSha256: string, roleOid: string, managerOid?: string) {
  const sessionRoleMatches = user === FIRST_OPEN_INSPECTOR_SQL_USER
    ? validOid(row.session_role_oid) && row.session_role_oid !== roleOid && row.session_role_oid !== row.owner_oid &&
      row.session_other_connectable_databases === 0
    : user === s.tenantRole && row.session_role_oid === roleOid;
  if (row.database !== s.tenantDatabase || row.username !== user || row.session_username !== user || row.owner !== manager ||
    !validOid(row.owner_oid) || row.owner_oid === roleOid || (managerOid && row.owner_oid !== managerOid) ||
    !sessionRoleMatches ||
    row.version !== 170009 || row.tls !== true || row.read_only !== "on" || !validOid(row.database_oid) || !validOid(roleOid) ||
    row.marker !== readyComment(approvalSha256, { databaseOid: row.database_oid, roleOid })) return stopFirstOpen("TARGET_READ_UNPROVED");
  return row.database_oid;
}

export function firstOpenIndependentDatabase(approvalSha256: string, roleSql: string, session: FirstOpenReadSession) {
  let used = false;
  return async ({ databaseName, roleName, signal }: { databaseName: string; roleName: string; signal: AbortSignal }) => {
    signal.throwIfAborted();
    if (used || databaseName !== s.tenantDatabase || roleName !== s.tenantRole) return stopFirstOpen("INSPECTOR_SCOPE_CHANGED");
    used = true;
    return session(signal, async sql => {
      const row = one(await sql(inspectorIdentitySql));
      const role = one(await sql(roleSql, oidValues));
      if (!validOid(role.oid)) return stopFirstOpen("TARGET_ROLE_OID_CHANGED");
      const databaseOid = checkTargetRead(row, FIRST_OPEN_INSPECTOR_SQL_USER, approvalSha256, role.oid);
      assertFirstOpenApplicationRole(role, true, role.oid);
      if (one(await sql(singletonSql)).singleton !== true) stopFirstOpen("SCHEMA_UNPROVED");
      return { ...databaseIdentity(databaseOid, role.oid), tlsVerified: true as const, transactionReadOnly: true as const };
    });
  };
}

const databaseIdentity = (databaseOid: string, roleOid: string): FirstOnboardingDatabaseIdentity => ({
  databaseOid, roleOid, name: s.tenantDatabase, roleName: s.tenantRole, ownershipMarker: owner, baselineDigest: archiveSha,
  schemaVersion: s.schemaVersion, clusterResourceId: s.clusterId, otherConnectableDatabases: 0,
});

export function firstOpenExpressDatabase(input: {
  approval: FirstOnboardingExpressApproval; approvalSha256: string; expectedOperationSha256: string; deadline: number; now(): number;
  backend: FirstOpenBackendPorts; journal: FirstOpenJournal; applicationRead: FirstOpenReadSession;
  readBaseline(signal: AbortSignal): Promise<{ archiveBytes: Buffer; manifestBytes: Buffer }>;
}): FirstOnboardingExpressPorts["database"] {
  const { backend, approvalSha256, expectedOperationSha256 } = input;
  if (![approvalSha256, expectedOperationSha256].every(sha => /^[a-f0-9]{64}$/.test(sha))) return stopFirstOpen("REVIEW_SCOPE_REQUIRED");
  const target: ExpressManagementTargetV3 = structuredClone(input.approval.target);
  const nonce = input.approval.nonce, guardName = "tl_prepare_" + nonce;
  if (target.managementDatabase !== "postgres" || target.managementUsername !== manager || target.tenantDatabase !== s.tenantDatabase ||
    target.tenantUsername !== s.tenantRole) return stopFirstOpen("RESTRICTED_MANAGEMENT_IDENTITY_REQUIRED");
  let state: TenantDatabaseLifecycleState = "missing", epoch: string | undefined, ids: PreparedOids | undefined, program: BootstrapProgram | undefined;
  let baselineProgram: BaselineProgram | undefined, evidenceHash: string | undefined, migrationsHash: string | undefined;
  let activated = false, failed = false, busy = false;
  const window = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (input.now() >= input.deadline) stopFirstOpen("WINDOW_CLOSED");
  };
  const check = (x: FirstOpenFenceInput) => {
    window(x.signal); sameFirstOpenFence(x);
    if (x.externalFence.operationHash !== expectedOperationSha256) stopFirstOpen("DATABASE_EPOCH_CHANGED");
  };
  // A failed or ambiguous provider result consumes this in-process entry. It
  // does not turn into an adoption, compensation, or automatic retry.
  async function guarded<T>(x: FirstOpenFenceInput, action: () => Promise<T>): Promise<T> {
    check(x);
    if (failed || busy) return stopFirstOpen("DATABASE_ENTRY_CLOSED");
    busy = true; epoch ??= x.externalFence.operationHash;
    try { const result = await action(); check(x); return result; }
    catch (error) {
      failed = true;
      if (error instanceof Error && error.message === "FIRST_OPEN_EXPRESS_DATABASE_NAMESPACE_OCCUPIED") throw error;
      return stopFirstOpen("DATABASE_OPERATION_STOPPED_NO_RETRY");
    }
    finally { busy = false; }
  }
  async function owners(sql: Sql) {
    const row = one(await sql(backend.ownersSql, [[s.tenantRole, guardName], s.tenantDatabase]));
    if (!Array.isArray(row.databases) || !Array.isArray(row.roles) || row.databases.length > 1 || row.roles.length > 1) {
      return stopFirstOpen("DATABASE_NAMESPACE_CHANGED");
    }
    const d = row.databases[0] as CatalogEntry | undefined, r = row.roles[0] as CatalogEntry | undefined;
    if (!ids || !program) {
      if (d || r) stopFirstOpen("DATABASE_NAMESPACE_OCCUPIED");
    } else if (d?.name !== s.tenantDatabase || r?.name !== s.tenantRole || d.oid !== ids.databaseOid || r.oid !== ids.roleOid ||
      d.owner !== manager || d.ownerOid !== ids.managerRoleOid || d.connect !== true ||
      d.comment !== (activated ? readyComment(approvalSha256, ids) : program.comments.database) ||
      r.comment !== program.comments.role || r.login !== activated) stopFirstOpen("DATABASE_OWNERSHIP_CHANGED");
    return row;
  }
  async function transaction<T>(x: FirstOpenFenceInput, stage: string, run: (sql: Sql) => Promise<T>, afterTargetCommit?: (sql: Sql) => Promise<void>) {
    if (!ids || !program) return stopFirstOpen("DATABASE_PREPARE_REQUIRED");
    const before = ids;
    return backend.pair(ids.databaseOid, x.signal, async (management, tenant) => {
      const key = canonicalJson({ schema: "techlong/express-bootstrap-lock/v3", stableIdentity: s.stableIdentity, generation: 1 });
      if (one(await management("SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS locked", [key])).locked !== true) {
        return stopFirstOpen("DATABASE_LOCK_BUSY");
      }
      await owners(management);
      await input.journal.beforeStage({ stage, ...before });
      check(x);
      const query: Sql = async (text, values) => { check(x); const r = await tenant(text, values); check(x); return r; };
      await query("BEGIN");
      await query("SET LOCAL search_path = pg_catalog");
      const result = await run(query);
      // The owned sessions close on errors, rolling back only an open transaction.
      // A lost COMMIT ack never triggers another COMMIT or another transaction.
      await query("COMMIT");
      if (afterTargetCommit) {
        const maintenance: Sql = async (text, values) => { check(x); const r = await management(text, values); check(x); return r; };
        await afterTargetCommit(maintenance);
      }
      await input.journal.stageObserved({ stage, ...before });
      return result;
    });
  }
  const receipt = async (x: FirstOpenFenceInput, operation: TenantDatabaseMutationReceipt["operation"],
    resultingState: TenantDatabaseMutationReceipt["resultingState"], evidence: unknown): Promise<TenantDatabaseMutationReceipt> => {
    evidenceHash = await sha256Hex({ operation, resultingState, epoch, evidence });
    state = resultingState;
    return { fence: x.fence, externalFence: x.externalFence, operation, resultingState, outcome: "applied", evidenceHash };
  };
  return Object.freeze<FirstOnboardingExpressPorts["database"]>({
    inspect(x) {
      return guarded(x, async () => {
        commandKeys(x);
        const row = await backend.management(x.signal, owners);
        const occupied = state !== "missing";
        return { fence: x.fence, externalFence: x.externalFence, state, databaseExists: occupied, roleExists: occupied,
          databaseOwnershipMarker: occupied ? owner : null, roleOwnershipMarker: occupied ? owner : null,
          baselineDigest: ["baseline_restored", "saas_migrated", "verified"].includes(state) ? archiveSha : null,
          migrationContract: ["saas_migrated", "verified"].includes(state) ? s.schemaVersion : null,
          evidenceHash: await sha256Hex({ row, state, evidenceHash: evidenceHash ?? null }) };
      });
    },
    prepare(x) {
      return guarded(x, async () => {
        commandKeys(x, "program", "runtimeSecretRef", "idempotencyKey");
        if (state !== "missing" || program || await sha256Hex(x.fence.identity.workspaceId) !== s.workspaceSha256) {
          return stopFirstOpen("BOOTSTRAP_SCOPE_CHANGED");
        }
        const scope = { appInstanceId: s.instanceId, workspaceId: x.fence.identity.workspaceId,
          productId: s.productId, environmentId: s.environmentId, cellKey: "cell-sandbox-1" } as const;
        const fixedProgram = compileExpressBootstrapCandidateV3({ target, nonce, scope });
        if (!same(x.program, fixedProgram)) return stopFirstOpen("BOOTSTRAP_SCOPE_CHANGED");
        // Explicit early refusal plus a second absence check under the
        // prepare port's lock; CREATE DATABASE itself has no adopt path.
        await backend.management(x.signal, owners);
        check(x);
        program = fixedProgram; // never execute the caller's program object
        const observed = await backend.prepare(program, x.signal, input.journal);
        if (!validOid(observed.databaseOid) || !validOid(observed.roleOid) || !validOid(observed.managerRoleOid) ||
          observed.roleOid === observed.managerRoleOid) return stopFirstOpen("BOOTSTRAP_OIDS_UNPROVED");
        ids = observed;
        return receipt(x, "prepare_empty_database", "empty", ids);
      });
    },
    restore(x) {
      return guarded(x, async () => {
        commandKeys(x, "archiveVersionId", "manifestVersionId", "baseline", "runtimeSecretRef", "idempotencyKey");
        if (state !== "empty" || x.archiveVersionId !== baseline.objects.archive.versionId ||
          x.manifestVersionId !== baseline.objects.manifest.versionId || !isFixedFirstOpenBaseline(x.baseline, s.jobId)) {
          return stopFirstOpen("RESTORE_PINS_CHANGED");
        }
        const compiled = await backend.compileBaseline(await input.readBaseline(x.signal));
        check(x);
        await transaction(x, "restore-empty-baseline", async q => {
          const empty = one(await q(backend.emptySql));
          if (String(empty.objects) !== "0" || String(empty.closed_public_schema) !== "1") stopFirstOpen("DATABASE_NOT_EMPTY");
          await q(compiled.restoreSql); await q(compiled.verificationSql);
          backend.verifyCounts(await q(backend.countsSql(compiled.tables)), compiled.tables, false);
          const checked = backend.verifyCatalog(await q(backend.catalogSql), compiled.tables);
          if (checked.structureSha256 !== baselineCatalog || checked.sequences !== 7) stopFirstOpen("RESTORED_CATALOG_CHANGED");
        });
        baselineProgram = compiled;
        return receipt(x, "restore_approved_baseline", "baseline_restored", baseline.objects);
      });
    },
    migrateSaas(x) {
      return guarded(x, async () => {
        commandKeys(x, "command", "migrationContract", "runtimeSecretRef", "idempotencyKey");
        const compiled = baselineProgram;
        if (state !== "baseline_restored" || !compiled || x.migrationContract !== s.schemaVersion ||
          x.command !== "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas") return stopFirstOpen("MIGRATION_SCOPE_CHANGED");
        const catalog = await transaction(x, "migrate-saas", async q => {
          backend.verifyCounts(await q(backend.countsSql(compiled.tables)), compiled.tables, false);
          await q("SET LOCAL search_path = pg_catalog, public");
          for (const migration of backend.migrations()) await q(migration.sql);
          await q("SET LOCAL search_path = pg_catalog");
          backend.verifyCounts(await q(backend.countsSql(compiled.tables)), compiled.tables, true);
          const checked = backend.verifyCatalog(await q(backend.catalogSql), compiled.tables);
          if (checked.structureSha256 !== activeCatalog || checked.sequences !== 7) stopFirstOpen("MIGRATED_CATALOG_CHANGED");
          return checked;
        });
        const result = await receipt(x, "migrate_saas", "saas_migrated", catalog);
        migrationsHash = result.evidenceHash;
        return result;
      });
    },
    activateApplication(x) {
      return guarded(x, async () => {
        commandKeys(x, "target", "applicationRoleArn", "migrationEvidenceSha256");
        const expected = ids, compiled = baselineProgram;
        if (activated || state !== "saas_migrated" || !expected || !compiled || x.migrationEvidenceSha256 !== migrationsHash ||
          x.applicationRoleArn !== s.applicationRole || !same(x.target, target)) return stopFirstOpen("ACTIVATION_SCOPE_CHANGED");
        await transaction(x, "activate-exact-application", async q => {
          assertFirstOpenApplicationRole(one(await q(backend.roleSql, oidValues)), false, expected.roleOid);
          const catalog = await q(backend.catalogSql);
          if (backend.verifyCatalog(catalog, compiled.tables).structureSha256 !== activeCatalog) stopFirstOpen("MIGRATED_CATALOG_CHANGED");
          const relations = one(catalog).identity as { relations: { name: string; kind: string }[] };
          const sequences = relations.relations.filter(r => r.kind === "S").map(r => `public.${quote(r.name)}`);
          if (sequences.length !== 7 || new Set(sequences).size !== 7) stopFirstOpen("SEQUENCES_CHANGED");
          const inspector = quote(FIRST_OPEN_INSPECTOR_SQL_USER);
          for (const sql of [
            `GRANT CONNECT ON DATABASE ${db} TO ${app}`, `GRANT USAGE ON SCHEMA public TO ${app}`,
            `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${compiled.tables.map(t => `public.${quote(t)}`).join(", ")} TO ${app}`,
            `GRANT USAGE ON SEQUENCE ${sequences.join(", ")} TO ${app}`,
            `GRANT CONNECT ON DATABASE ${db} TO ${inspector}`, `GRANT USAGE ON SCHEMA public TO ${inspector}`,
            `GRANT SELECT (singleton_key) ON TABLE public.saas_instances TO ${inspector}`,
            `COMMENT ON DATABASE ${db} IS '${readyComment(approvalSha256, expected)}'`,
          ]) await q(sql);
        }, async q => {
          // This broker exists only on the maintenance database. A successful
          // target COMMIT precedes the sole LOGIN request; a lost ACK stops.
          one(await q(`SELECT ${managerSchema}.activate_role($1::text,$2::oid)`, [program!.comments.role, expected.databaseOid]));
          assertFirstOpenApplicationRole(one(await q(backend.roleSql, oidValues)), true, expected.roleOid);
        });
        activated = true;
        await backend.management(x.signal, owners);
        return { fence: x.fence, externalFence: x.externalFence, outcome: "applied", databaseName: s.tenantDatabase,
          roleName: s.tenantRole, applicationRoleArn: s.applicationRole, otherConnectableDatabases: 0,
          evidenceHash: await sha256Hex({ ...expected, migrationsHash, applicationRoleArn: s.applicationRole }) };
      });
    },
    verify(x) {
      return guarded(x, async () => {
        commandKeys(x, "expectedBaselineDigest", "expectedMigrationContract");
        const expected = ids;
        if (!activated || state !== "saas_migrated" || !expected || x.expectedBaselineDigest !== archiveSha ||
          x.expectedMigrationContract !== s.schemaVersion) return stopFirstOpen("VERIFICATION_SCOPE_CHANGED");
        await input.applicationRead(x.signal, async sql => {
          if (checkTargetRead(one(await sql(identitySql)), s.tenantRole, approvalSha256, expected.roleOid, expected.managerRoleOid) !== expected.databaseOid ||
            one(await sql(singletonSql)).singleton !== true) stopFirstOpen("APPLICATION_LOGIN_UNPROVED");
        });
        const verified = await receipt(x, "verify", "verified", { ...expected, migrationsHash, iamLoginVerified: true });
        return { receipt: { ...verified, applicationAccess: { policy: "speedfeast-application-access/v1", databaseLoginVerified: true,
          evidenceHash: verified.evidenceHash } }, identity: databaseIdentity(expected.databaseOid, expected.roleOid) };
      });
    },
  });
}
