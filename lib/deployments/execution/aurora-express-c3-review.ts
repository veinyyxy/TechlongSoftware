import db from './aurora-database-contract-v2.cjs';
import bootstrap from './aurora-express-bootstrap-v3.cjs';
import { assertDiagnosticFacts, type DiagnosticFacts, type ExistingExpressBinding } from './aurora-express-c2-diagnostic-review.ts';

export const c3AttemptSlot = 'techlong-d002-express-c3-bootstrap-g1.permanent-slot.json';
export const c3InspectSlot = 'techlong-d002-express-c3-bootstrap-g1-inspect.permanent-slot.json';
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export interface SqlProgramIdentity {
  archiveSha256: string; manifestSha256: string; restoreSqlSha256: string; verificationSqlSha256: string;
  pg17CatalogSqlSha256: string; rowCountsSqlSha256: string;
  migrations: readonly { name: string; sha256: string }[]; tables: number;
  transaction: string; maximumTenantDatabaseBytes: number; runtimeEnabled: boolean;
}
export function prepareC3Review(input: { facts: DiagnosticFacts; expectedBinding: ExistingExpressBinding;
  candidateInput: { target: unknown; scope: unknown; nonce: string }; sqlProgram: SqlProgramIdentity;
  codeBindingSha256: string; historySha256: string }, now: number) {
  assertDiagnosticFacts(input.facts, input.expectedBinding, now);
  const p = bootstrap.compileExpressBootstrapV3(input.candidateInput), b = input.expectedBinding, sql = input.sqlProgram;
  if (!sha(input.codeBindingSha256) || !sha(input.historySha256) || b.engineVersion !== '17.9' ||
    p.target.clusterArn !== b.clusterArn || p.target.clusterResourceId !== b.clusterResourceId || p.target.endpoint !== b.endpoint ||
    sql.archiveSha256 !== bootstrap.BASELINE.archiveSha256 || sql.manifestSha256 !== bootstrap.BASELINE.manifestSha256 ||
    ![sql.restoreSqlSha256, sql.verificationSqlSha256, sql.pg17CatalogSqlSha256, sql.rowCountsSqlSha256].every(sha) ||
    sql.tables !== 73 || sql.transaction !== 'restore-and-migrate-atomic' || sql.maximumTenantDatabaseBytes !== 536870912 || sql.runtimeEnabled !== false ||
    db.canonicalJson(sql.migrations) !== db.canonicalJson([
      { name: 'saas_control.sql', sha256: '4da7a9d7974efa0cbab6196bc21a7618c052c11bec8cdd4390e2e24f0d22c8bf' },
      { name: 'theme_config.sql', sha256: 'eec8838c01101f009b18f838525a64e100e59300c460a52006cb96568c809c14' }]))
    throw Error('EXPRESS_C3_REVIEW_BINDING_REJECTED');
  const body = { schema: 'techlong/express-schema-bootstrap-review/c3', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 3600000).toISOString(), facts: input.facts, expectedBinding: b,
    candidateInput: input.candidateInput, bootstrapProgramSha256: bootstrap.digest(p),
    sqlProgram: sql, sqlProgramSha256: db.digest(sql), codeBindingSha256: input.codeBindingSha256, historySha256: input.historySha256,
    expectedManagementDatabaseOid: '5', expectedManagementRoleOid: '16410',
    attemptSlot: c3AttemptSlot, independentInspectSlot: c3InspectSlot,
    limits: { maximumRunSqlConnections: 3, maximumIndependentInspectSqlConnections: 2,
      runMetadataCallsMaximum: 18, inspectMetadataCallsMaximum: 9, connectTimeoutMs: 30000,
      transportGroupDeadlineMs: 120000, temporaryCredentialsMinimumRemainingMs: 300000,
      prepareStatementsIncludingTransactionControl: 15, restoreAndMigrateTransactions: 1, tables: 73, migrationSeedRows: 9,
      awsResourceWrites: 0, iamWrites: 0, secretValueReads: 0, loginChanges: 0, applicationGrants: 0, automaticRetries: 0 },
    risks: [
      'Existing Source is an administrator. This is local reviewed bootstrap, not least-privilege Fargate/runtime authority.',
      'SQL and native connections can resume the existing cluster and incur ACU, storage and I/O costs; 50 USD/month is not a hard cap.',
      'Prepare has separate role and database commits. Failure can leave NOLOGIN roles, a guard-owned disconnected database, or a promoted empty database.',
      'Restore and migration share one transaction, but a lost COMMIT response or journal/inspection failure can leave committed schema and nine seeds.',
      'No automatic rollback/down, deletion, fill, slot reset or write retry. A failed transaction is disposed; its final server state requires inspection.',
      'Readback, cooperative locks, Source snapshots and OID checks are not a cross-service CAS; concurrent privileged administrators can race.',
      'IAM tokens stay in memory, but JS/driver erasure is best effort. Official AWS/PostgreSQL/provider logs may contain SQL and connection metadata.',
      'This installs trusted pinned schema functions/triggers. The PG17 catalog is a security-bounded observation, not an automatically learned ready fingerprint.',
      '512 MiB is a tenant-database gate, not proof of total cluster/free-plan storage or compatibility with app IAM/Secret-v2/Fargate.',
      'PUBLIC CONNECT on other databases is unchanged; tenant remains NOLOGIN. No rds_iam membership, app privilege, merchant account or runtime is enabled.',
      'New database owner is postgres; current nonce/OIDs/journal must be used for future separately approved cleanup. Old empty-cluster cleanup is not reusable.',
      'Both independent permanent slots are one-shot. Inspect may have to stop after consumption, and metadata-only inspection does not prove schema state.'
    ], runtimeEnabled: false, lifecycleCompatible: false, executionAuthorized: false };
  return Object.freeze({ ...structuredClone(body), manifestSha256: db.digest(body) });
}
export type C3Review = ReturnType<typeof prepareC3Review>;
export function assertC3Approval(r: C3Review, approvedSha: string, codeSha: string, now: number) {
  const { manifestSha256, ...body } = r;
  if (!sha(approvedSha) || r.schema !== 'techlong/express-schema-bootstrap-review/c3' || approvedSha !== manifestSha256 ||
    db.digest(body) !== manifestSha256 || r.codeBindingSha256 !== codeSha || now < Date.parse(r.preparedAt) || now >= Date.parse(r.expiresAt))
    throw Error('EXPRESS_C3_FRESH_APPROVAL_REQUIRED');
  const expected = prepareC3Review({ facts: r.facts, expectedBinding: r.expectedBinding, candidateInput: r.candidateInput,
    sqlProgram: r.sqlProgram, codeBindingSha256: codeSha, historySha256: r.historySha256 }, Date.parse(r.preparedAt));
  if (db.canonicalJson(expected) !== db.canonicalJson(r)) throw Error('EXPRESS_C3_REVIEW_SCOPE_DRIFT');
}
