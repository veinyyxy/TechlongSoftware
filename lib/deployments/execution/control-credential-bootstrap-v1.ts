import { canonicalJson, sha256Hex } from "./hash.ts";
import { readSealedControlRoleStateV1, verifyControlRolePoststateV1, validateControlRoleReviewV1,
  type ControlRoleReadbackV1, type ControlRoleReviewV1 } from "./sealed-control-role-management-v1.ts";
import type { SealedPlanManagementSqlClientV1 } from "./sealed-plan-management-v1.ts";
import { CONTROL_CREDENTIAL_ROLES_V1, CONTROL_CREDENTIAL_SECRET_NAMES_V1, createControlCredentialMaterialsV1,
  controlCredentialActivationSqlV1, assertControlCredentialEndpointV1, type ControlCredentialEndpointV1 } from "./control-credential-material-v1.ts";

const sourceArn = "arn:aws:iam::402010193138:user/techlong-sandbox-dev";
const sha = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const tables = ["app_instance_deployments", "deployment_jobs", "deployment_step_runs", "deployment_cleanup_schedules", "deployment_environment_capacity_reservations",
  "deployment_tenant_resources", "deployment_tenant_resource_events", "deployment_tenant_external_operations", "deployment_tenant_external_operation_events",
  "deployment_tenant_cleanup_runs", "app_instances", "subscriptions", "deployment_environments", "deployment_plan_only_isolations", "deployment_plan_only_isolation_fences"];
export interface ControlCredentialBindingV1 { targetFingerprintSha256: string; codeSha256: string; certificateSha256: string }
export interface ControlCredentialAwsReadV1 { account: "402010193138"; arn: typeof sourceArn; secrets: { name: string; state: "ABSENT" }[]; observedAt: number }
export const CONTROL_CREDENTIAL_SCOPE_V1 = Object.freeze({
  roles: CONTROL_CREDENTIAL_ROLES_V1, secretNames: CONTROL_CREDENTIAL_SECRET_NAMES_V1,
  region: "ca-central-1", sourceArn, randomPasswordBytesPerRole: 32, scram: "SCRAM-SHA-256/4096/16-byte-salt",
  initialSecretStage: "AWSCURRENT", kms: "default AWS-managed aws/secretsmanager; may be provisioned by AWS on first use",
  createSecretCallsMaximum: 2, tagResourcePermissionUsedOnlyByCreateSecretTags: true,
  secretsBeforeOneAtomicRoleLoginTransaction: true, noLocalSecretPersistence: true, noRotationReplicaResourcePolicyOrNewIam: true,
  loginIsRealDatabaseAccessNotRuntimeActivation: true, partialFailureMayLeaveChargedSecretsOrLoginRoles: true,
  noAutomaticDeleteDownResetRevokeOrWriteRetry: true, runtimeEnabled: false, monthlyBudgetTargetUsd: 50,
  permanentSlot: "techlong-f3b3-control-credentials-v1-consumed",
});
export interface ControlCredentialManifestV1 {
  schemaVersion: 1; protocol: "control-credential-bootstrap-v1"; binding: ControlCredentialBindingV1;
  reviewedAt: number; expiresAt: number; endpointSha256: string; roleReview: ControlRoleReviewV1;
  roleStateSha256: string; preservedSha256: string; roleState: ControlRoleReadbackV1["state"];
  secretVersionIds: readonly [string, string]; scope: typeof CONTROL_CREDENTIAL_SCOPE_V1;
  price: { region: "ca-central-1"; currency: "USD"; perSecretMonthUsd: number; perApiCallUsd: number; publicFeedSha256: string };
  manifestSha256: string;
}
export class ControlCredentialErrorV1 extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new ControlCredentialErrorV1(code); }
function exact(v: unknown, keys: string[]) { return v !== null && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson(keys.sort()); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function fresh(at: number, start: number, now: number) {
  if (![at, start, now].every(x => Number.isSafeInteger(x) && x > 0) || now < start || at > now || now - at > 30_000 || now - start > 30_000)
    fail("CONTROL_CREDENTIAL_EVIDENCE_STALE");
}
export function assertControlCredentialAwsAbsentV1(read: ControlCredentialAwsReadV1) {
  if (!exact(read, ["account", "arn", "secrets", "observedAt"]) || read.account !== "402010193138" || read.arn !== sourceArn ||
    read.secrets.length !== 2 || read.secrets.some((x, i) => !exact(x, ["name", "state"]) || x.name !== CONTROL_CREDENTIAL_SECRET_NAMES_V1[i] || x.state !== "ABSENT"))
    fail("CONTROL_CREDENTIAL_AWS_PRESTATE_NOT_ABSENT");
}
export async function compileControlCredentialReviewV1(input: { binding: ControlCredentialBindingV1; roleReview: ControlRoleReviewV1; roleSql: string;
  read: ControlRoleReadbackV1; aws: ControlCredentialAwsReadV1; endpoint: ControlCredentialEndpointV1; secretVersionIds: readonly [string, string];
  price: ControlCredentialManifestV1["price"]; startedAt: number; now: number }) {
  input = freeze(structuredClone(input));
  assertControlCredentialEndpointV1(input.endpoint); assertControlCredentialAwsAbsentV1(input.aws);
  fresh(input.read.observedAt, input.startedAt, input.now); fresh(input.aws.observedAt, input.startedAt, input.now);
  await validateControlRoleReviewV1(input.roleReview, input.roleReview.binding, input.roleSql);
  await verifyControlRolePoststateV1(input.read, input.roleReview);
  if (input.read.transaction.readOnly !== "on" || input.read.transaction.deferrable !== "on") fail("CONTROL_CREDENTIAL_REVIEW_NOT_READONLY");
  const body = { schemaVersion: 1 as const, protocol: "control-credential-bootstrap-v1" as const, binding: input.binding,
    reviewedAt: input.now, expiresAt: input.now + 3_600_000, endpointSha256: await sha256Hex(input.endpoint), roleReview: input.roleReview,
    roleStateSha256: input.read.stateSha256, preservedSha256: input.read.preservedSha256, roleState: input.read.state,
    secretVersionIds: input.secretVersionIds, scope: CONTROL_CREDENTIAL_SCOPE_V1, price: input.price };
  const result = freeze({ ...body, manifestSha256: await sha256Hex(body) });
  await validateControlCredentialManifestV1(result, input.binding, input.roleSql, input.endpoint);
  return result;
}
export async function validateControlCredentialManifestV1(m: ControlCredentialManifestV1, binding: ControlCredentialBindingV1, roleSql: string, endpoint: ControlCredentialEndpointV1) {
  assertControlCredentialEndpointV1(endpoint);
  if (!exact(m, ["schemaVersion", "protocol", "binding", "reviewedAt", "expiresAt", "endpointSha256", "roleReview", "roleStateSha256", "preservedSha256", "roleState", "secretVersionIds", "scope", "price", "manifestSha256"]) ||
    !exact(binding, ["targetFingerprintSha256", "codeSha256", "certificateSha256"]) || Object.values(binding).some(x => !sha.test(x))) fail("CONTROL_CREDENTIAL_MANIFEST_SHAPE_INVALID");
  const { manifestSha256, ...body } = m;
  if (m.schemaVersion !== 1 || m.protocol !== "control-credential-bootstrap-v1" || !sha.test(manifestSha256) || await sha256Hex(body) !== manifestSha256 ||
    canonicalJson(m.binding) !== canonicalJson(binding) || canonicalJson(m.scope) !== canonicalJson(CONTROL_CREDENTIAL_SCOPE_V1) ||
    await sha256Hex(endpoint) !== m.endpointSha256 || await sha256Hex(m.roleState) !== m.roleStateSha256 || await sha256Hex(m.roleState.preserved) !== m.preservedSha256 ||
    binding.certificateSha256 !== m.roleReview.binding.certificateSha256 || binding.targetFingerprintSha256 !== m.roleReview.binding.targetFingerprintSha256 ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3_600_000 ||
    m.secretVersionIds.length !== 2 || m.secretVersionIds.some(x => !uuid.test(x)) || m.secretVersionIds[0] === m.secretVersionIds[1] ||
    !exact(m.price, ["region", "currency", "perSecretMonthUsd", "perApiCallUsd", "publicFeedSha256"]) || m.price.region !== "ca-central-1" || m.price.currency !== "USD" ||
    !sha.test(m.price.publicFeedSha256) || m.price.perSecretMonthUsd !== 0.4 || m.price.perApiCallUsd !== 0.000005) fail("CONTROL_CREDENTIAL_MANIFEST_BINDING_INVALID");
  await validateControlRoleReviewV1(m.roleReview, m.roleReview.binding, roleSql);
  await verifyControlRolePoststateV1({ state: m.roleState, stateSha256: m.roleStateSha256, preservedSha256: m.preservedSha256, observedAt: m.reviewedAt,
    transaction: { readOnly: "on", isolation: "serializable", deferrable: "on", searchPath: "pg_catalog" }, privatePreimage: { originalRow: "", businessState: "" } }, m.roleReview);
}
function approved(m: ControlCredentialManifestV1, approvedSha: string, now: number) {
  if (approvedSha !== m.manifestSha256 || !sha.test(approvedSha) || !Number.isSafeInteger(now) || now < m.reviewedAt || now >= m.expiresAt)
    fail("CONTROL_CREDENTIAL_APPROVAL_EXPIRED_OR_WRONG");
}
export interface ControlCredentialSecretReadV1 {
  name: string; arn: string; versionId: string; stages: string[]; tags: { Key: string; Value: string }[];
  onlyInitialVersion: boolean; rotationDisabled: boolean; noReplicaOrResourcePolicy: boolean; secretString: string;
}
export function assertControlCredentialSecretV1(read: ControlCredentialSecretReadV1, m: ControlCredentialManifestV1, endpoint: ControlCredentialEndpointV1, index: number) {
  const name = CONTROL_CREDENTIAL_SECRET_NAMES_V1[index];
  if (!name || read.name !== name || !new RegExp(`^arn:aws:secretsmanager:ca-central-1:402010193138:secret:${name}-[A-Za-z0-9]{6}$`).test(read.arn) ||
    read.versionId !== m.secretVersionIds[index] || canonicalJson(read.stages) !== '["AWSCURRENT"]' || !read.onlyInitialVersion || !read.rotationDisabled || !read.noReplicaOrResourcePolicy ||
    canonicalJson([...read.tags].sort((a, b) => a.Key.localeCompare(b.Key))) !== canonicalJson(controlCredentialTagsV1(m)) || typeof read.secretString !== "string" || read.secretString.length > 16384)
    fail("CONTROL_CREDENTIAL_SECRET_METADATA_UNVERIFIED");
  let payload: Record<string, unknown>, url: URL;
  try { payload = JSON.parse(read.secretString); url = new URL(String(payload.databaseUrl)); } catch { return fail("CONTROL_CREDENTIAL_SECRET_PAYLOAD_UNVERIFIED"); }
  if (!exact(payload, index === 0 ? ["schemaVersion", "protocol", "databaseUrl", "certificateSha256", "expectedRegisteredCertificate"] : ["databaseUrl"]) ||
    url.protocol !== "postgresql:" || url.hostname !== endpoint.host || url.port !== "5432" || url.pathname !== `/${endpoint.database}` ||
    decodeURIComponent(url.username) !== CONTROL_CREDENTIAL_ROLES_V1[index] || !/^[A-Za-z0-9_-]{43}$/.test(url.password) || url.hash ||
    canonicalJson([...url.searchParams]) !== canonicalJson([["sslmode", "verify-full"], ["channel_binding", "require"]]) ||
    (index === 0 && (payload.schemaVersion !== 3 || payload.protocol !== "sealed-cell-cleanup-control-v3" || payload.certificateSha256 !== m.binding.certificateSha256 ||
      canonicalJson(payload.expectedRegisteredCertificate) !== canonicalJson({ ...m.roleState.preserved.sealed.certificates[0], sealed_at: Number(m.roleState.preserved.sealed.certificates[0].sealed_at) }))))
    fail("CONTROL_CREDENTIAL_SECRET_PAYLOAD_UNVERIFIED");
  return { databaseUrl: String(payload.databaseUrl) }; // Ephemeral only, never include in a report.
}
export function controlCredentialTagsV1(m: ControlCredentialManifestV1) {
  return [{ Key: "ApprovalSha256", Value: m.manifestSha256 }, { Key: "Environment", Value: "sandbox" },
    { Key: "Project", Value: "Techlong" }, { Key: "Purpose", Value: "control-credential-bootstrap-v1" }];
}
export async function verifyControlCredentialRoleStateV1(read: ControlRoleReadbackV1, m: ControlCredentialManifestV1) {
  const normalized = structuredClone(read), logins = read.state.roles.map(r => r.rolcanlogin);
  if (read.state.roles.length !== 2 || logins.some(x => typeof x !== "boolean")) fail("CONTROL_CREDENTIAL_ROLE_STATE_INVALID");
  normalized.state.roles.forEach(r => { r.rolcanlogin = false; });
  await verifyControlRolePoststateV1(normalized, m.roleReview);
  if (await sha256Hex(normalized.state) !== m.roleStateSha256) fail("CONTROL_CREDENTIAL_ROLE_OR_PERMISSION_DRIFT");
  return { logins, stateSha256: read.stateSha256, preservedSha256: read.preservedSha256 };
}
export interface ControlCredentialBootstrapPortsV1 {
  now(): number; readDb(): Promise<ControlRoleReadbackV1>; readAwsAbsent(): Promise<ControlCredentialAwsReadV1>;
  createSecret(request: { Name: string; ClientRequestToken: string; Description: string; Tags: { Key: string; Value: string }[]; SecretString: string }): Promise<{ ARN?: string; Name?: string; VersionId?: string }>;
  readSecret(index: number, m: ControlCredentialManifestV1): Promise<ControlCredentialSecretReadV1>;
  openDb(): Promise<SealedPlanManagementSqlClientV1 & { end(): Promise<unknown> }>;
  claimSlot(): Promise<void>; saveMarker(name: string, value: Record<string, unknown>): Promise<void>;
}
/** One attempt per write. After any uncertain result, Inspect only; never starts a replacement workflow. */
export async function runControlCredentialBootstrapV1(input: { manifest: ControlCredentialManifestV1; approvedSha: string;
  binding: ControlCredentialBindingV1; roleSql: string; endpoint: ControlCredentialEndpointV1; ports: ControlCredentialBootstrapPortsV1 }) {
  const m = freeze(structuredClone(input.manifest)), p = input.ports;
  await validateControlCredentialManifestV1(m, input.binding, input.roleSql, input.endpoint); approved(m, input.approvedSha, p.now());
  let slotConsumed = false, dbTransaction = false, commitAttempted = false, commitConfirmed = false, stage = "PREFLIGHT";
  let db: Awaited<ReturnType<typeof p.openDb>> | undefined;
  const secretAttempts: string[] = [], secretConfirmed: { name: string; arn: string; versionId: string }[] = [];
  try {
    const start = p.now(), read = await p.readDb(), aws = await p.readAwsAbsent();
    assertControlCredentialAwsAbsentV1(aws); fresh(read.observedAt, start, p.now()); fresh(aws.observedAt, start, p.now());
    await verifyControlRolePoststateV1(read, m.roleReview);
    if (read.stateSha256 !== m.roleStateSha256) fail("CONTROL_CREDENTIAL_PRESTATE_DRIFT");
    approved(m, input.approvedSha, p.now()); await p.claimSlot(); slotConsumed = true;
    await p.saveMarker("approved-manifest.json", m as unknown as Record<string, unknown>);
    fresh(read.observedAt, start, p.now()); approved(m, input.approvedSha, p.now());
    const cert = { ...m.roleState.preserved.sealed.certificates[0], sealed_at: Number(m.roleState.preserved.sealed.certificates[0].sealed_at) };
    const material = await createControlCredentialMaterialsV1(input.endpoint, cert, m.binding.certificateSha256);
    for (let i = 0; i < 2; i++) {
      stage = `CREATE_SECRET_${i + 1}`; approved(m, input.approvedSha, p.now());
      await p.saveMarker(`secret-${i + 1}-attempt.json`, { name: material[i].name, versionId: m.secretVersionIds[i], manifestSha256: m.manifestSha256 });
      approved(m, input.approvedSha, p.now()); secretAttempts.push(material[i].name);
      const result = await p.createSecret({ Name: material[i].name, ClientRequestToken: m.secretVersionIds[i],
        Description: "Techlong sandbox restricted control database credentials v1", Tags: controlCredentialTagsV1(m), SecretString: material[i].secretString });
      if (result.Name !== material[i].name || result.VersionId !== m.secretVersionIds[i]) fail("CONTROL_CREDENTIAL_CREATE_RESPONSE_UNKNOWN");
      const observed = await p.readSecret(i, m); assertControlCredentialSecretV1(observed, m, input.endpoint, i);
      if (observed.arn !== result.ARN || canonicalJson(JSON.parse(observed.secretString)) !== material[i].secretString)
        fail("CONTROL_CREDENTIAL_CREATED_VALUE_UNVERIFIED");
      const metadata = { name: material[i].name, arn: observed.arn, versionId: observed.versionId };
      secretConfirmed.push(metadata); await p.saveMarker(`secret-${i + 1}-confirmed.json`, metadata);
    }
    stage = "DATABASE_LOGIN_TRANSACTION"; approved(m, input.approvedSha, p.now()); db = await p.openDb();
    await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); dbTransaction = true;
    await db.query("SET LOCAL search_path=pg_catalog"); await db.query("SET LOCAL lock_timeout='5s'"); await db.query("SET LOCAL statement_timeout='30s'");
    await db.query(`LOCK TABLE ${tables.map(t => `public.${t}`).sort().join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    const dbStart = p.now(), before = await readSealedControlRoleStateV1(db);
    await verifyControlRolePoststateV1(before, m.roleReview); fresh(before.observedAt, dbStart, p.now());
    if (before.stateSha256 !== m.roleStateSha256) fail("CONTROL_CREDENTIAL_DB_PRESTATE_DRIFT");
    await p.saveMarker("login-attempt.json", { roles: [...CONTROL_CREDENTIAL_ROLES_V1], manifestSha256: m.manifestSha256 });
    for (const value of material) { fresh(before.observedAt, dbStart, p.now()); approved(m, input.approvedSha, p.now()); await db.query(controlCredentialActivationSqlV1(value)); }
    const after = await readSealedControlRoleStateV1(db), verified = await verifyControlCredentialRoleStateV1(after, m);
    if (verified.logins.some(x => x !== true)) fail("CONTROL_CREDENTIAL_LOGIN_NOT_ACTIVE");
    fresh(after.observedAt, dbStart, p.now()); approved(m, input.approvedSha, p.now());
    stage = "DATABASE_COMMIT"; commitAttempted = true; await db.query("COMMIT"); dbTransaction = false; commitConfirmed = true;
    return freeze({ outcome: "CREDENTIAL_BOOTSTRAP_COMMITTED_REQUIRES_INDEPENDENT_INSPECT", slotConsumed, secretAttempts, secretConfirmed,
      commitAttempted, commitConfirmed, failureStage: null, failureCode: null, retryAuthorized: false, runtimeEnabled: false });
  } catch (error) {
    if (dbTransaction && !commitAttempted) await db?.query("ROLLBACK").catch(() => undefined);
    return freeze({ outcome: commitAttempted ? "CREDENTIAL_COMMIT_UNKNOWN_INSPECT_ONLY" : "CREDENTIAL_BOOTSTRAP_STOPPED_INSPECT_ONLY",
      slotConsumed, secretAttempts, secretConfirmed, commitAttempted, commitConfirmed, failureStage: stage,
      failureCode: error instanceof ControlCredentialErrorV1 ? error.code : "CONTROL_CREDENTIAL_WRITE_NOT_VERIFIED", retryAuthorized: false, runtimeEnabled: false });
  } finally { await db?.end().catch(() => undefined); }
}

/** Read-only recovery; never returns secret material or submits a compensating write. */
export async function inspectControlCredentialBootstrapV1(input: { manifest: ControlCredentialManifestV1; binding: ControlCredentialBindingV1;
  roleSql: string; endpoint: ControlCredentialEndpointV1; now: () => number; readDb: () => Promise<ControlRoleReadbackV1>;
  readOwnSecret: (index: number, m: ControlCredentialManifestV1) => Promise<ControlCredentialSecretReadV1 | null>;
  authenticate: (role: typeof CONTROL_CREDENTIAL_ROLES_V1[number], url: string) => Promise<void> }) {
  const m = freeze(structuredClone(input.manifest));
  await validateControlCredentialManifestV1(m, input.binding, input.roleSql, input.endpoint);
  const start = input.now(), before = await input.readDb(), first = await verifyControlCredentialRoleStateV1(before, m);
  const secrets: { name: string; state: string; arn?: string; versionId?: string; authenticated?: boolean }[] = [];
  for (let i = 0; i < 2; i++) {
    const read = await input.readOwnSecret(i, m);
    if (!read) { secrets.push({ name: CONTROL_CREDENTIAL_SECRET_NAMES_V1[i], state: "ABSENT" }); continue; }
    const material = assertControlCredentialSecretV1(read, m, input.endpoint, i);
    let authenticated = false;
    if (first.logins[i] === true) {
      try { await input.authenticate(CONTROL_CREDENTIAL_ROLES_V1[i], material.databaseUrl); authenticated = true; } catch { /* No raw password/URL error. */ }
    }
    secrets.push({ name: read.name, state: "OWN_INITIAL_VERSION_VERIFIED", arn: read.arn, versionId: read.versionId, authenticated });
  }
  const after = await input.readDb(), last = await verifyControlCredentialRoleStateV1(after, m);
  fresh(before.observedAt, start, input.now()); fresh(after.observedAt, start, input.now());
  if (before.stateSha256 !== after.stateSha256) fail("CONTROL_CREDENTIAL_INSPECT_STATE_DRIFT");
  const ready = last.logins.every(x => x === true) && secrets.every(x => x.authenticated === true);
  return freeze({ outcome: ready ? "TWO_CONTROL_CREDENTIALS_LOGIN_AND_OWN_SECRET_VERSIONS_VERIFIED" :
    last.logins.every(x => x === false) ? "CONTROL_ROLES_NOLOGIN_PARTIAL_SECRETS_INSPECT_ONLY" : "CONTROL_CREDENTIAL_AUTH_OR_PARTIAL_STATE_MANUAL_REVIEW",
    rolesLogin: last.logins, secrets, stateSha256: last.stateSha256, preservedSha256: last.preservedSha256,
    observedAt: after.observedAt, readOnly: true, authenticationQueriesReadOnly: true, credentialReady: ready,
    secretValuesPersisted: false, retryAuthorized: false, runtimeEnabled: false });
}
