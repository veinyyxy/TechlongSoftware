import { canonicalJson, sha256Hex } from "./hash.ts";
import { CONTROL_CREDENTIAL_ROLES_V1, type ControlCredentialEndpointV1 } from "./control-credential-material-v1.ts";
import { assertControlCredentialSecretV1, validateControlCredentialManifestV1, verifyControlCredentialRoleStateV1,
  type ControlCredentialBindingV1, type ControlCredentialManifestV1, type ControlCredentialSecretReadV1 } from "./control-credential-bootstrap-v1.ts";
import { readSealedControlRoleStateV1, type ControlRoleReadbackV1 } from "./sealed-control-role-management-v1.ts";
import type { SealedPlanManagementSqlClientV1 } from "./sealed-plan-management-v1.ts";

const digest = /^[a-f0-9]{64}$/;
const tables = ["app_instance_deployments", "deployment_jobs", "deployment_step_runs", "deployment_cleanup_schedules",
  "deployment_environment_capacity_reservations", "deployment_tenant_resources", "deployment_tenant_resource_events",
  "deployment_tenant_external_operations", "deployment_tenant_external_operation_events", "deployment_tenant_cleanup_runs",
  "app_instances", "subscriptions", "deployment_environments", "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences"];
export const NEON_CREDENTIAL_RECOVERY_SCOPE_V1 = Object.freeze({
  roles: CONTROL_CREDENTIAL_ROLES_V1, passwordSource: "two pinned existing Secret ARN/VersionId/AWSCURRENT values",
  sqlPasswordForm: "existing plaintext password in ALTER ROLE over verified TLS; server/provider logging exposure accepted",
  passwordEncryptionRequired: "scram-sha-256", forwardDdlRequired: "on; never disabled or bypassed",
  alterRoleCallsMaximum: 2, oneLocalAtomicTransaction: true, providerSynchronizationIsNotAtomicWithLocalTransaction: true,
  createSecretCallsMaximum: 0, secretVersionWritesMaximum: 0, noPasswordGenerationOrRotation: true,
  noNewGrantsIamApiOrRuntime: true, noLocalSecretOrSqlPersistence: true,
  noAutomaticDownDeleteRevokeSlotResetOrWriteRetry: true, loginEnablesExistingRestrictedPrivileges: true,
  permanentSlot: "techlong-f3b3-control-credentials-neon-recovery-v1-consumed", runtimeEnabled: false, monthlyBudgetTargetUsd: 50,
});
export interface NeonCredentialProviderReadV1 {
  forwardDdl: "on"; passwordEncryption: "scram-sha-256"; postgresVersion: 180006; observedAt: number;
}
export interface NeonCredentialSecretsReadV1 { secrets: ControlCredentialSecretReadV1[]; observedAt: number }
export interface NeonCredentialRecoveryManifestV1 {
  schemaVersion: 1; protocol: "neon-existing-control-credential-recovery-v1";
  binding: ControlCredentialBindingV1; bootstrap: ControlCredentialManifestV1;
  priorSubmissionFileSha256: string; reviewedAt: number; expiresAt: number;
  secrets: { name: string; arn: string; versionId: string }[];
  scope: typeof NEON_CREDENTIAL_RECOVERY_SCOPE_V1; manifestSha256: string;
}
export class NeonCredentialRecoveryErrorV1 extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new NeonCredentialRecoveryErrorV1(code); }
function exact(v: unknown, keys: string[]) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson(keys.sort());
}
function frozen<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }
function fresh(at: number, start: number, now: number) {
  if (![at, start, now].every(x => Number.isSafeInteger(x) && x > 0) || now < start || at > now || now - at > 30_000 || now - start > 30_000)
    fail("NEON_RECOVERY_EVIDENCE_STALE");
}
export function assertNeonCredentialProviderV1(p: NeonCredentialProviderReadV1) {
  if (!exact(p, ["forwardDdl", "passwordEncryption", "postgresVersion", "observedAt"]) || p.forwardDdl !== "on" ||
    p.passwordEncryption !== "scram-sha-256" || p.postgresVersion !== 180006) fail("NEON_RECOVERY_PROVIDER_NOT_VERIFIED");
}
async function noLogin(read: ControlRoleReadbackV1, bootstrap: ControlCredentialManifestV1) {
  const result = await verifyControlCredentialRoleStateV1(read, bootstrap);
  if (result.logins.some(x => x !== false) || read.stateSha256 !== bootstrap.roleStateSha256)
    fail("NEON_RECOVERY_REQUIRES_UNCHANGED_TWO_NOLOGIN_ROLES");
}
function secretPins(read: NeonCredentialSecretsReadV1, bootstrap: ControlCredentialManifestV1, endpoint: ControlCredentialEndpointV1) {
  if (!exact(read, ["secrets", "observedAt"]) || read.secrets.length !== 2) fail("NEON_RECOVERY_TWO_EXISTING_SECRETS_REQUIRED");
  const passwords = read.secrets.map((s, i) => new URL(assertControlCredentialSecretV1(s, bootstrap, endpoint, i).databaseUrl).password);
  if (passwords[0] === passwords[1]) fail("NEON_RECOVERY_SECRET_PASSWORD_COLLISION");
  return read.secrets.map(s => ({ name: s.name, arn: s.arn, versionId: s.versionId }));
}
export async function compileNeonCredentialRecoveryV1(input: {
  binding: ControlCredentialBindingV1; bootstrap: ControlCredentialManifestV1; bootstrapBinding: ControlCredentialBindingV1;
  roleSql: string; endpoint: ControlCredentialEndpointV1; priorSubmissionFileSha256: string;
  read: ControlRoleReadbackV1; provider: NeonCredentialProviderReadV1; secrets: NeonCredentialSecretsReadV1; startedAt: number; now: number;
}) {
  await validateControlCredentialManifestV1(input.bootstrap, input.bootstrapBinding, input.roleSql, input.endpoint);
  await noLogin(input.read, input.bootstrap); assertNeonCredentialProviderV1(input.provider);
  if (input.read.transaction.readOnly !== "on" || input.read.transaction.deferrable !== "on") fail("NEON_RECOVERY_REVIEW_NOT_READONLY");
  for (const at of [input.read.observedAt, input.provider.observedAt, input.secrets.observedAt]) fresh(at, input.startedAt, input.now);
  const body = { schemaVersion: 1 as const, protocol: "neon-existing-control-credential-recovery-v1" as const,
    binding: input.binding, bootstrap: input.bootstrap, priorSubmissionFileSha256: input.priorSubmissionFileSha256,
    reviewedAt: input.now, expiresAt: input.now + 3_600_000, secrets: secretPins(input.secrets, input.bootstrap, input.endpoint),
    scope: NEON_CREDENTIAL_RECOVERY_SCOPE_V1 };
  const m = frozen(structuredClone({ ...body, manifestSha256: await sha256Hex(body) }));
  await validateNeonCredentialRecoveryV1(m, input); return m;
}
export async function validateNeonCredentialRecoveryV1(m: NeonCredentialRecoveryManifestV1, input: {
  binding: ControlCredentialBindingV1; bootstrapBinding: ControlCredentialBindingV1; roleSql: string;
  endpoint: ControlCredentialEndpointV1; priorSubmissionFileSha256: string;
}) {
  if (!exact(m, ["schemaVersion", "protocol", "binding", "bootstrap", "priorSubmissionFileSha256", "reviewedAt", "expiresAt", "secrets", "scope", "manifestSha256"]) ||
    m.schemaVersion !== 1 || m.protocol !== "neon-existing-control-credential-recovery-v1" || !digest.test(m.manifestSha256) ||
    !exact(input.binding, ["targetFingerprintSha256", "codeSha256", "certificateSha256"]) || Object.values(input.binding).some(x => !digest.test(x)) ||
    canonicalJson(m.binding) !== canonicalJson(input.binding) || canonicalJson(m.scope) !== canonicalJson(NEON_CREDENTIAL_RECOVERY_SCOPE_V1) ||
    m.priorSubmissionFileSha256 !== input.priorSubmissionFileSha256 || !digest.test(m.priorSubmissionFileSha256) ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3_600_000 ||
    input.binding.targetFingerprintSha256 !== input.bootstrapBinding.targetFingerprintSha256 ||
    input.binding.certificateSha256 !== input.bootstrapBinding.certificateSha256) fail("NEON_RECOVERY_MANIFEST_BINDING_INVALID");
  const { manifestSha256, ...body } = m;
  if (await sha256Hex(body) !== manifestSha256) fail("NEON_RECOVERY_MANIFEST_HASH_INVALID");
  await validateControlCredentialManifestV1(m.bootstrap, input.bootstrapBinding, input.roleSql, input.endpoint);
  if (m.secrets.length !== 2 || m.secrets.some((s, i) => !exact(s, ["name", "arn", "versionId"]) ||
    s.name !== m.bootstrap.scope.secretNames[i] || s.versionId !== m.bootstrap.secretVersionIds[i] ||
    !new RegExp(`^arn:aws:secretsmanager:ca-central-1:402010193138:secret:${s.name}-[A-Za-z0-9]{6}$`).test(s.arn)))
    fail("NEON_RECOVERY_SECRET_PINS_INVALID");
}
function approved(m: NeonCredentialRecoveryManifestV1, sha: string, now: number) {
  if (sha !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now >= m.expiresAt)
    fail("NEON_RECOVERY_FRESH_APPROVAL_REQUIRED");
}
/** Never save server text/detail/query/stack. Even HTTP response bodies may contain credentials. */
export function safeNeonCredentialFailureV1(error: unknown) {
  const e = error as { code?: unknown; message?: unknown } | null;
  const sqlstate = typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : null;
  const text = typeof e?.message === "string" ? e.message : "";
  const http = text.match(/Received HTTP code ([1-5][0-9]{2}) from control plane/);
  return { sqlstate, providerHttpStatus: http ? Number(http[1]) : null,
    classification: error instanceof NeonCredentialRecoveryErrorV1 ? error.code : http ? "NEON_CONTROL_PLANE_HTTP_ERROR" :
      /Failed to perform curl request/.test(text) ? "NEON_CONTROL_PLANE_TRANSPORT_ERROR" : "DATABASE_RESULT_NOT_VERIFIED",
    rawDiagnosticsWithheld: true };
}
export interface NeonCredentialRecoveryPortsV1 {
  now(): number; readDb(): Promise<ControlRoleReadbackV1>; readProvider(): Promise<NeonCredentialProviderReadV1>;
  readExistingSecrets(): Promise<NeonCredentialSecretsReadV1>;
  openDb(): Promise<SealedPlanManagementSqlClientV1 & { end(): Promise<unknown> }>;
  verifyProviderInTransaction(db: SealedPlanManagementSqlClientV1): Promise<NeonCredentialProviderReadV1>;
  claimSlot(): Promise<void>; saveMarker(name: string, value: Record<string, unknown>): Promise<void>;
}
export async function runNeonCredentialRecoveryV1(input: {
  manifest: NeonCredentialRecoveryManifestV1; approvedSha: string; binding: ControlCredentialBindingV1;
  bootstrapBinding: ControlCredentialBindingV1; roleSql: string; endpoint: ControlCredentialEndpointV1;
  priorSubmissionFileSha256: string; ports: NeonCredentialRecoveryPortsV1;
}) {
  const m = frozen(structuredClone(input.manifest)), p = input.ports;
  await validateNeonCredentialRecoveryV1(m, input); approved(m, input.approvedSha, p.now());
  let slotConsumed = false, transaction = false, commitAttempted = false, commitConfirmed = false, alterAttempts = 0, stage = "READONLY_PREFLIGHT";
  let db: Awaited<ReturnType<typeof p.openDb>> | undefined;
  try {
    const start = p.now(), read = await p.readDb(), provider = await p.readProvider(), secrets = await p.readExistingSecrets();
    await noLogin(read, m.bootstrap); assertNeonCredentialProviderV1(provider);
    for (const at of [read.observedAt, provider.observedAt, secrets.observedAt]) fresh(at, start, p.now());
    if (canonicalJson(secretPins(secrets, m.bootstrap, input.endpoint)) !== canonicalJson(m.secrets)) fail("NEON_RECOVERY_EXISTING_SECRET_DRIFT");
    approved(m, input.approvedSha, p.now()); stage = "CLAIM_PERMANENT_RECOVERY_SLOT"; await p.claimSlot(); slotConsumed = true;
    await p.saveMarker("approved-manifest.json", m as unknown as Record<string, unknown>);
    stage = "DATABASE_LOGIN_TRANSACTION"; approved(m, input.approvedSha, p.now()); db = await p.openDb();
    await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); transaction = true;
    await db.query("SET LOCAL search_path=pg_catalog"); await db.query("SET LOCAL lock_timeout='5s'"); await db.query("SET LOCAL statement_timeout='30s'");
    await db.query(`LOCK TABLE ${tables.map(t => `public.${t}`).sort().join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    const dbStart = p.now(), before = await readSealedControlRoleStateV1(db); await noLogin(before, m.bootstrap);
    const inTransaction = await p.verifyProviderInTransaction(db); assertNeonCredentialProviderV1(inTransaction);
    fresh(before.observedAt, dbStart, p.now()); fresh(inTransaction.observedAt, dbStart, p.now());
    await p.saveMarker("login-attempt.json", { roles: [...CONTROL_CREDENTIAL_ROLES_V1], secrets: m.secrets,
      manifestSha256: m.manifestSha256, sqlPasswordForm: m.scope.sqlPasswordForm });
    for (let i = 0; i < 2; i++) {
      fresh(before.observedAt, dbStart, p.now()); fresh(secrets.observedAt, start, p.now()); approved(m, input.approvedSha, p.now());
      const password = new URL(assertControlCredentialSecretV1(secrets.secrets[i], m.bootstrap, input.endpoint, i).databaseUrl).password;
      // Strict 43-character base64url policy validated above: no SQL quoting or injection ambiguity.
      stage = `ALTER_ROLE_${i + 1}`; alterAttempts++;
      await db.query(`ALTER ROLE ${CONTROL_CREDENTIAL_ROLES_V1[i]} WITH LOGIN PASSWORD '${password}'`);
    }
    stage = "VERIFY_TRANSACTION_POSTSTATE";
    const after = await readSealedControlRoleStateV1(db), verified = await verifyControlCredentialRoleStateV1(after, m.bootstrap);
    if (verified.logins.some(x => x !== true)) fail("NEON_RECOVERY_TWO_LOGINS_NOT_ACTIVE");
    fresh(after.observedAt, dbStart, p.now()); approved(m, input.approvedSha, p.now());
    stage = "DATABASE_COMMIT"; commitAttempted = true; await db.query("COMMIT"); transaction = false; commitConfirmed = true;
    return frozen({ outcome: "NEON_RECOVERY_COMMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, alterAttempts, commitAttempted, commitConfirmed,
      failureStage: null, failure: null, secretWrites: 0, retryAuthorized: false, runtimeEnabled: false });
  } catch (error) {
    if (transaction && !commitAttempted) await db?.query("ROLLBACK").catch(() => undefined);
    return frozen({ outcome: commitAttempted ? "NEON_RECOVERY_COMMIT_UNKNOWN_INSPECT_ONLY" : "NEON_RECOVERY_STOPPED_INSPECT_ONLY",
      slotConsumed, alterAttempts, commitAttempted, commitConfirmed, failureStage: stage, failure: safeNeonCredentialFailureV1(error),
      secretWrites: 0, retryAuthorized: false, runtimeEnabled: false });
  } finally { await db?.end().catch(() => undefined); }
}
