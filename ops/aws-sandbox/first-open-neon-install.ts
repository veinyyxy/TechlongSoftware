import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenExecutionWindow, type FirstOpenControlledWindow } from "../../lib/deployments/execution/first-onboarding-window.ts";
import { firstOpenSqlJson } from "../../lib/deployments/execution/first-onboarding-sql-value.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import type { FirstOpenSecondSlotApproval } from "../../lib/deployments/execution/first-open-second-slot.ts";
import { firstOpenManagementNeonDraft } from "./first-open-management-install.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import prepared from "./first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

const { scope, portBinding: { neon } } = prepared;
const owner = "neondb_owner";
const dos = neon.definerRoles;
const logins = Object.values(neon.runtimeLogins);
const all = [...dos, ...logins];
const fresh = neon.newlyRequiredRoles;
const reserved = all.filter(role => !fresh.includes(role));
const provisioning = {
  set: ["SET LOCAL search_path TO pg_catalog", "SET LOCAL lock_timeout TO '3s'", "SET LOCAL statement_timeout TO '20s'"],
  identity: `pg_catalog.current_database()='neondb' AND current_user='${owner}' AND session_user=current_user
    AND (SELECT oid FROM pg_catalog.pg_database WHERE datname='neondb')=16396
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND oid=16392 AND (rolcreaterole OR rolsuper))`,
};
const flags = "NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS";
const lockedFlags = "NOT (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)";
const allowedRole = /^first_onboarding_fc41597f_(?:claim|review|middle|complete|inspect)(?:_owner)?$/;
const hex = /^[a-f0-9]{64}$/;
const scram = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
const quoted = (items: readonly string[]) => items.map(v => `'${v}'`).join(",");
const deny = (code: string): never => { throw Error("FIRST_OPEN_NEON_INSTALL_" + code); };

function rolesAndTaskPrecondition(existing: readonly string[], missing: readonly string[], taskRelease?: FirstOpenTaskRelease) {
  if (all.length !== 8 || reserved.length !== 6 || fresh.length !== 2 || new Set(all).size !== 8 ||
    !all.every(r => allowedRole.test(r)) || logins.length !== 5 || dos.length !== 3) return deny("ROLE_SCOPE");
  const v = firstOpenVersion(taskRelease);
  const versionGuard = taskRelease === undefined ? "" : `
 AND j.payload::jsonb#>>'{scope,releaseId}'='${v.releaseId}'
 AND j.payload::jsonb#>>'{scope,artifactRef}'='${v.artifactRef}'
 AND EXISTS (SELECT 1 FROM deployment_release.releases l WHERE l.id='${v.releaseId}' AND l.status='candidate'
   AND l.product_id='${taskRelease.productId}' AND l.component='tenant_api' AND l.document=${firstOpenSqlJson(taskRelease)})`;
  return `DO $first_open_install$
BEGIN
 IF (${provisioning.identity}) IS NOT TRUE
 THEN RAISE EXCEPTION 'FIRST_OPEN_NEON_INSTALL_IDENTITY'; END IF;
 PERFORM 1 FROM public.deployment_jobs j
 JOIN public.app_instance_deployments d ON d.id=j.deployment_id
 JOIN public.app_instances a ON a.id=d.app_instance_id
 WHERE j.id='${scope.jobId}' AND d.id='${scope.deploymentId}' AND a.id='${scope.instanceId}'
 AND d.subscription_id='${scope.subscriptionId}' AND d.environment_id='${scope.environmentId}'
 AND encode(sha256(convert_to(a.workspace_id,'UTF8')),'hex')='${scope.workspaceSha256}'
 AND d.status='planned' AND d.plan_hash='${scope.planSha256}' AND d.configuration_hash='${scope.configurationSha256}'
 AND d.artifact_ref='${v.artifactRef}' AND j.job_type='apply' AND j.status='pending' AND j.attempts=0 AND j.max_attempts=1${versionGuard}
 AND j.lease_owner IS NULL AND j.lease_token IS NULL AND j.lease_expires_at IS NULL AND j.completed_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM public.deployment_tenant_resources WHERE app_instance_id=a.id)
 AND NOT EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations WHERE app_instance_id=a.id)
 AND NOT EXISTS (SELECT 1 FROM deployment_release.instance_state WHERE instance_id=a.id)
 FOR UPDATE OF j;
 IF NOT FOUND THEN RAISE EXCEPTION 'FIRST_OPEN_NEON_INSTALL_HELD_TASK_CHANGED'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles r WHERE r.rolname IN (${quoted(existing)})
      AND ${lockedFlags}
      AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid)=1
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid AND m.member=16392
         AND m.grantor<>16392 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend dep WHERE dep.refclassid='pg_authid'::regclass
         AND dep.refobjid=r.oid AND dep.deptype IN ('o','a','i','r')))
      <> ${existing.length}
 ${missing.length ? `OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN (${quoted(missing)}))` : ""}
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN (${quoted(neon.schemas)}))
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) acl
       WHERE n.nspname='public' AND acl.grantee=0 AND acl.privilege_type='CREATE')
 THEN RAISE EXCEPTION 'FIRST_OPEN_NEON_INSTALL_CATALOG_CHANGED'; END IF;
END $first_open_install$`;
}

/** Static installation is a single transaction owned by the reviewed caller.
 * Never enable LOGIN, touch existing roles or create the running RPCs here. */
export function firstOpenNeonReserveStatements(taskRelease?: FirstOpenTaskRelease): readonly string[] {
  return Object.freeze([...provisioning.set, "SET LOCAL createrole_self_grant TO ''",
    rolesAndTaskPrecondition(reserved, fresh, taskRelease),
    ...fresh.map(role => `CREATE ROLE ${role} NOLOGIN ${flags} PASSWORD NULL`),
    rolesAndTaskPrecondition(all, [], taskRelease)]);
}

const withoutTransaction = (sql: string) => {
  if (!sql.startsWith("BEGIN;\n") || !sql.endsWith("\nCOMMIT;")) return deny("COMPILER_TRANSACTION");
  const body = sql.slice("BEGIN;\n".length, -"\nCOMMIT;".length);
  if (/^(?:BEGIN|COMMIT|ROLLBACK);\s*$/m.test(body)) return deny("COMPILER_TRANSACTION");
  return body;
};

/** Actual first-open preparation ONLY: render one in-memory transaction after
 * the protected, separately approved real window is known. No I/O/COMMIT.
 * SCRAM verifier-bearing statements must not be saved in any review or receipt. */
export async function firstOpenNeonActivationStatements(input: {
  release: FirstOpenFrozenRelease;
  protectedReleaseSha256: string;
  window: FirstOpenControlledWindow;
  /** Exact value from the separately reviewed full approval's express scope. */
  secondSlot?: FirstOpenSecondSlotApproval;
  repositorySource: string;
  verifiers: Readonly<Record<string, string>>;
}) {
  const { release, window, secondSlot, repositorySource, verifiers, protectedReleaseSha256 } = structuredClone(input);
  if (release.schema !== "techlong/sandbox-first-open-release/v1" || release.jobId !== scope.jobId ||
    release.actorId !== "14145707" || !hex.test(release.approvalSha256) ||
    ![release.callerCommit, release.runtimeCommit, release.runOnceReusableCommit, release.managementReusableCommit,
      release.inspectReusableCommit].every(c => /^[a-f0-9]{40}$/.test(c)) ||
    !/^[1-9][0-9]{0,19}$/.test(release.workflowId) || !hex.test(protectedReleaseSha256) ||
    await sha256Hex(release) !== protectedReleaseSha256 ||
    release.startAt !== window.startAt || release.claimBefore !== window.claimBefore ||
    !Number.isSafeInteger(release.applicationLoginBefore) || release.applicationLoginBefore <= release.claimBefore ||
    release.applicationLoginBefore > release.writeBefore) return deny("RELEASE_BINDING");
  const w = firstOpenExecutionWindow(scope.jobId, release.writeBefore, window)!;
  if (!verifiers || Object.keys(verifiers).sort().join(",") !== [...logins].sort().join(",") ||
    new Set(Object.values(verifiers)).size !== logins.length || !logins.every(r => scram.test(verifiers[r]))) {
    return deny("SCRAM_VERIFIERS");
  }
  const compiler = await firstOpenManagementNeonDraft({
    approvalSha256: release.approvalSha256, planHash: scope.planSha256, configurationHash: scope.configurationSha256,
    writeBefore: w.writeBefore, window, taskRelease: release.taskRelease, secondSlot,
  }, repositorySource);
  // Existing definer-owned DDL temporarily needs SET and INHERIT in this
  // transaction only. The precondition requires an independent ADMIN row;
  // removing the installer-issued row cannot revoke the original membership.
  const statements = [...provisioning.set,
    rolesAndTaskPrecondition(all, [], release.taskRelease),
    `DO $window$ BEGIN IF clock_timestamp() >= '${new Date(release.claimBefore).toISOString()}'::timestamptz
       THEN RAISE EXCEPTION 'FIRST_OPEN_NEON_INSTALL_WINDOW_ELAPSED'; END IF; END $window$`,
    ...logins.map(r => `ALTER ROLE ${r} LOGIN ${flags} CONNECTION LIMIT 2 PASSWORD '${verifiers[r]}' VALID UNTIL '${new Date(w.writeBefore).toISOString()}'`),
    ...dos.map(r => `GRANT ${r} TO SESSION_USER WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY CURRENT_USER`),
    withoutTransaction(compiler.claim), withoutTransaction(compiler.middle), withoutTransaction(compiler.completion),
    ...dos.map(r => `REVOKE ${r} FROM SESSION_USER GRANTED BY CURRENT_USER RESTRICT`),
    `DO $post$
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_roles r WHERE r.rolname IN (${quoted(all)})
   AND r.rolcanlogin=(r.rolname IN (${quoted(logins)}))
   AND NOT (r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
   AND (NOT r.rolcanlogin OR (r.rolconnlimit=2 AND r.rolvaliduntil='${new Date(w.writeBefore).toISOString()}'::timestamptz))
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
   AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid AND m.member=16392
        AND m.grantor<>16392 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)=1
   AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid)=1)<>8
 THEN RAISE EXCEPTION 'FIRST_OPEN_NEON_INSTALL_POSTCONDITION'; END IF;
END $post$`];
  return { jobId: scope.jobId, executionAuthorized: false as const, persistStatements: false as const,
    standaloneTransactions: 1 as const, statements: Object.freeze(statements) };
}
