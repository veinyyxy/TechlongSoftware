import tls from "node:tls";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { DescribeSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { STSClient } from "@aws-sdk/client-sts";
import { compileExpressBootstrapCandidateV3, FIRST_OPEN_MANAGEMENT_SQL_USER, parseExpressManagementTargetV3 } from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { bindReviewedSandboxFirstOpenRunOnce } from "../../lib/deployments/execution/first-onboarding-run-composition.ts";
import { assertInitialSecretVersion, FIRST_OPEN_G1_TAG_PROOF_MODE,
  type FirstOnboardingExpressPorts } from "../../lib/deployments/execution/first-onboarding-express.ts";
import { FIRST_OPEN_BASELINE_BINDING as baseline } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s, checkSandboxFirstOpenApproval } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenBaselineSource, firstOpenInitialSecret, sdkConfig,
  type FirstOpenPaymentSource } from "./first-open-express-aws.ts";
import { assertFirstOpenApplicationRole, FIRST_OPEN_INSPECTOR_SQL_USER, firstOpenExpressDatabase,
  type FirstOpenBackendPorts, type FirstOpenReadSession, type FirstOpenJournal, type QueryResult, type Sql } from "./first-open-express-database.ts";
import { stopFirstOpen, validOid } from "./first-open-express-scope.ts";
import { assertFirstOpenManagementInstall, firstOpenManagerSessions, type FirstOpenPg as Pg, type FirstOpenSigner as Signer } from "./first-open-express-management.ts";
import { verifyFirstOpenCatalog } from "./first-open-express-catalog.ts";
import { bindFirstOpenPairedInspect, firstOpenRunOnceHandoff, pairFirstOpenApproval } from "./first-open-paired-runtime.ts";
import type { FirstOpenGitHubHandoff, firstOpenGitHubAuthorityArtifacts } from "./first-open-github-handoff.ts";
import { bindFirstOpenSession, firstOpenGitHubIssuedSession, firstOpenManagerProbeSource, type FirstOpenCredentialSource as CredentialSource } from "./first-open-sessions.ts";
import { firstOpenManagementClient, firstOpenManagementMailbox, firstOpenManagementOperationSha256, serveFirstOpenManagement,
  type FirstOpenManagementScope } from "./first-open-management-bridge.ts";
import { bindFirstOpenReleaseEntry, type FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { firstOpenManagementClaimProof } from "../../lib/deployments/execution/first-onboarding-claim-entry.ts";
import type { SupervisedTenantStack } from "../../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { createFirstOpenControlledCfnAuthor, createFirstOpenControlledCfnSubmitter, firstOpenVersionAuthorityScope,
  type FirstOpenVersionAuthorityReader } from "./first-open-controlled-cfn.ts";
import type { prepareFirstOpenInspectSeed } from "./first-open-inspect-input.ts";
import type { FirstOpenFormalProvisionerReceipt } from "./first-open-provisioner-lanes.ts";
import prepared from "./first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

type Reviewed = Parameters<typeof bindReviewedSandboxFirstOpenRunOnce>[0];
type Target = NonNullable<Reviewed["approval"]["express"]>["target"];

interface FirstOpenManagementSources {
  backendDirectory: string; // Explicit reviewed SpeedFeast source/tools; never uses the old tenant runtime root.
  baselineTools: { pgRestorePath: string; pythonPath: string; workspace: string };
  lifecycleCredentials: CredentialSource;
  journal: FirstOpenJournal;
}
export interface FirstOpenFixedManagement {
  database: FirstOnboardingExpressPorts["database"];
  submitStack?(stack: SupervisedTenantStack, signal: AbortSignal): Promise<{ operation: "create"; stackId: string }>;
  checkReady(approvalSha256: string, applicationLoginBefore: number, signal: AbortSignal): Promise<void>;
}
export interface FirstOpenExpressSources {
  management: FirstOpenFixedManagement;
  provisionerCredentials: CredentialSource;
  loadTenantPaymentMaterial: FirstOpenPaymentSource;
  handoff: FirstOpenGitHubHandoff;
  controlMaterial?: {
    onVerifiedControlMaterial: NonNullable<FirstOnboardingExpressPorts["onVerifiedControlMaterial"]>;
    rememberOwnerSeed: NonNullable<Parameters<typeof firstOpenInitialSecret>[0]["rememberOwnerSeed"]>;
  };
}

const endpoint = "techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com";
const namespaceSql = "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname=$2) OR " +
  "EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[])) AS occupied";
const one = (r: QueryResult) => {
  if (r.rowCount !== 1 || r.rows.length !== 1) return stopFirstOpen("CATALOG_ROW_CHANGED");
  return r.rows[0];
};

function loadBackend(sources: FirstOpenManagementSources, target: Target, nonce: string,
  bound: (signal: AbortSignal) => AbortSignal): FirstOpenBackendPorts & { assertReady(signal: AbortSignal): Promise<void> } {
  const { backendDirectory, baselineTools } = sources;
  if (![backendDirectory, baselineTools.pgRestorePath, baselineTools.pythonPath, baselineTools.workspace].every(isAbsolute)) {
    return stopFirstOpen("EXPLICIT_BACKEND_TOOLS_REQUIRED");
  }
  const load = createRequire(join(backendDirectory, "package.json"));
  const saas = (module: string) => load("./services/saas/" + module);
  const { Client } = load("pg") as { Client: new (config: Record<string, unknown>) => Pg };
  const { Signer } = load("@aws-sdk/rds-signer") as { Signer: Signer };
  const { loadAtsRoots } = saas("aurora_connections_v2.js");
  const { CATALOG_SQL } = saas("aurora_express_bootstrap_provider_v3.js");
  const { EMPTY_SQL } = saas("tenant_baseline_restore_provider.js");
  const { compileTenantBaselineProgram } = saas("tenant_baseline_program.js");
  const { loadSaasPrograms } = saas("tenant_saas_transaction_provider.js");
  const { PG17_CATALOG_SQL, rowCountSql, verifyRows, verifyPg17Catalog } = saas("aurora_express_restore_v5.js");
  const { ROLE_DIRECTORY_SQL } = saas("aurora_role_directory_v2.js");
  const lifecycle = firstOpenManagerSessions({ target, Client, Signer, ca: loadAtsRoots(), credentials: sources.lifecycleCredentials });
  const namespaceValues = [[target.tenantUsername, `tl_prepare_${nonce}`], target.tenantDatabase];
  const assertVacant = async (sql: Sql) => {
    if (one(await sql(namespaceSql, namespaceValues)).occupied !== false) return stopFirstOpen("DATABASE_NAMESPACE_OCCUPIED");
  };
  return {
    assertReady: signal => lifecycle.management(bound(signal), async sql => {
      await sql("BEGIN READ ONLY");
      await assertFirstOpenManagementInstall(sql);
      await assertVacant(sql);
      await sql("COMMIT");
    }),
    async prepare(submitted, signal, journal) {
      // The historical immutable backend prepare hard-codes postgres. Rebuild
      // this job's compiler-owned program and execute only its fixed stages.
      const program = compileExpressBootstrapCandidateV3({ target, scope: submitted.scope, nonce });
      if (canonicalJson(program) !== canonicalJson(submitted)) return stopFirstOpen("BOOTSTRAP_COMPILER_CHANGED");
      const programSha256 = await sha256Hex(program);
      return lifecycle.management(bound(signal), async (sql, managerRoleOid) => {
        const key = canonicalJson({ schema: "techlong/express-bootstrap-lock/v3", stableIdentity: s.stableIdentity, generation: 1 });
        if (one(await sql("SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS locked", [key])).locked !== true) {
          return stopFirstOpen("DATABASE_LOCK_BUSY");
        }
        await assertFirstOpenManagementInstall(sql);
        await assertVacant(sql);
        let databaseOid: string | undefined, roleOid: string | undefined;
        for (const stage of program.stages) {
          await journal.beforeStage({ stage: stage.name, programSha256, statements: stage.statements.length });
          for (const text of stage.statements) await sql(text);
          const row = one(await sql(CATALOG_SQL, namespaceValues));
          if (!Array.isArray(row.roles) || row.roles.length !== 1 || !Array.isArray(row.databases) ||
            row.databases.length !== (stage.name === "reserve" ? 0 : 1)) return stopFirstOpen("BOOTSTRAP_CATALOG_CHANGED");
          const r = row.roles[0], d = row.databases[0];
          if (r?.name !== s.tenantRole || r.comment !== program.comments.role || !validOid(r.oid) || (roleOid && roleOid !== r.oid)) {
            return stopFirstOpen("BOOTSTRAP_ROLE_CHANGED");
          }
          const observedRoleOid: string = r.oid;
          roleOid = observedRoleOid;
          assertFirstOpenApplicationRole(one(await sql(ROLE_DIRECTORY_SQL, [s.tenantRole, s.tenantDatabase])), false, observedRoleOid);
          if (stage.name !== "reserve") {
            const promoted = stage.name === "promote";
            if (d?.name !== s.tenantDatabase || d.owner !== FIRST_OPEN_MANAGEMENT_SQL_USER || d.ownerOid !== managerRoleOid ||
              !validOid(d.oid) || (databaseOid && d.oid !== databaseOid) || d.template !== false || d.encoding !== "UTF8" ||
              d.connect !== promoted || d.foreignPrivileges !== false || (promoted && d.publicPrivileges !== false) ||
              d.comment !== (promoted ? program.comments.database : null)) return stopFirstOpen("BOOTSTRAP_DATABASE_CHANGED");
            databaseOid = d.oid;
          }
          await journal.stageObserved({ stage: stage.name, catalogSha256: await sha256Hex(row), roleOid, databaseOid: databaseOid ?? null });
        }
        if (!databaseOid || !roleOid) return stopFirstOpen("BOOTSTRAP_ACK_CHANGED");
        return { databaseOid, roleOid, managerRoleOid };
      }); // Closing the owned session releases the advisory lock, even on failure.
    },
    management: (signal, run) => lifecycle.management(bound(signal), run),
    pair: (tenantDatabaseOid, signal, run) => lifecycle.pair(tenantDatabaseOid, bound(signal), run),
    compileBaseline: bytes => compileTenantBaselineProgram({ ...bytes, ...baselineTools,
      archiveSha256: baseline.objects.archive.sha256, manifestSha256: baseline.objects.manifest.sha256 }),
    migrations: () => loadSaasPrograms(),
    ownersSql: CATALOG_SQL, emptySql: EMPTY_SQL, catalogSql: PG17_CATALOG_SQL, roleSql: ROLE_DIRECTORY_SQL,
    countsSql: rowCountSql, verifyCounts: verifyRows, verifyCatalog: (result, tables) => verifyFirstOpenCatalog(result, tables, verifyPg17Catalog),
  };
}

/** Non-admin SQL transport for the existing application proof and independent Inspector. */
function firstOpenReadSession(backendDirectory: string, rawTarget: Target,
  user: typeof s.tenantRole | typeof FIRST_OPEN_INSPECTOR_SQL_USER,
  credentials: (signal: AbortSignal) => ReturnType<CredentialSource>): FirstOpenReadSession {
  const target = exactTarget(rawTarget);
  if (!isAbsolute(backendDirectory) || (user !== s.tenantRole && user !== FIRST_OPEN_INSPECTOR_SQL_USER)) {
    return stopFirstOpen("NONADMIN_SQL_SOURCE_REQUIRED");
  }
  const load = createRequire(join(backendDirectory, "package.json"));
  const { Client } = load("pg") as { Client: new (config: Record<string, unknown>) => Pg };
  const { Signer } = load("@aws-sdk/rds-signer") as { Signer: Signer };
  const ca: readonly string[] = load("./services/saas/aurora_connections_v2.js").loadAtsRoots();
  return async (signal, run) => {
    // This source is already bound to the exact AWS role; the SQL user
    // and physical target are verified separately inside the read.
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
    bounded.throwIfAborted();
    const snapshot = await credentials(bounded);
    bounded.throwIfAborted();
    let signed = false;
    const client = new Client({ host: target.endpoint, port: target.port, database: target.tenantDatabase, user,
      password: async () => {
        bounded.throwIfAborted();
        if (signed) return stopFirstOpen("READ_IAM_SIGN_ALREADY_USED");
        signed = true;
        return new Signer({ region: s.region, hostname: target.endpoint, port: target.port, username: user, credentials: snapshot }).getAuthToken();
      },
      ssl: { ca, rejectUnauthorized: true, servername: target.endpoint, checkServerIdentity: tls.checkServerIdentity, minVersion: "TLSv1.2" },
      connectionTimeoutMillis: 15_000, query_timeout: 10_000, application_name: "techlong-sandbox-first-open-read",
    });
    const kill = () => client.connection?.stream?.destroy();
    client.on("error", kill);
    bounded.addEventListener("abort", kill, { once: true });
    try {
      await client.connect();
      bounded.throwIfAborted();
      const stream = client.connection?.stream;
      if (!stream?.encrypted || stream.authorized !== true || (stream as tls.TLSSocket & { servername?: string }).servername !== target.endpoint) {
        return stopFirstOpen("READ_TLS_UNPROVED");
      }
      const query: Sql = async (text, values) => {
        bounded.throwIfAborted();
        const result = await client.query(values ? { text, values } : text);
        bounded.throwIfAborted();
        return result;
      };
      await query("BEGIN READ ONLY");
      await query("SET LOCAL search_path = pg_catalog");
      await query("SET LOCAL statement_timeout = '10s'");
      const result = await run(query);
      await query("COMMIT");
      return result;
    } catch {
      return stopFirstOpen("READ_SESSION_FAILED_NO_RETRY");
    } finally {
      bounded.removeEventListener("abort", kill);
      kill();
      client.password = null;
      if (client.connectionParameters) client.connectionParameters.password = null;
      await client.end().catch(() => {});
    }
  };
}

function exactTarget(raw: Target) {
  const target = parseExpressManagementTargetV3(raw);
  if (target.stableIdentity !== s.stableIdentity || target.clusterArn !== s.clusterArn || target.clusterResourceId !== s.clusterId ||
    target.endpoint !== endpoint || target.tenantDatabase !== s.tenantDatabase || target.tenantUsername !== s.tenantRole ||
    target.managementDatabase !== "postgres" || target.managementUsername !== FIRST_OPEN_MANAGEMENT_SQL_USER) {
    return stopFirstOpen("RUNTIME_SCOPE_CHANGED");
  }
  return target;
}

/** Protected-side assembly only: retain credentials, driver, baseline compiler
 * and V3 provider here; return only fixed operations and a readiness check.
 * Real deployment must supply this port across the reviewed isolation boundary,
 * not grant the RunOnce job the lifecycle role to mount this locally. */
type FixedManagementInput = FirstOpenManagementSources & {
  approval: NonNullable<Reviewed["approval"]["express"]>;
  approvedSha256: string;
  writeBefore: number;
  applicationLoginBefore: number;
  applicationCredentials?: CredentialSource;
  issueBefore: number;
};

function buildFirstOpenFixedManagement(input: FixedManagementInput, now: () => number, expectedOperationSha256: string) {
  const target = exactTarget(input.approval.target);
  const { writeBefore, approvedSha256, applicationLoginBefore } = input;
  if (!Number.isSafeInteger(applicationLoginBefore) || !Number.isSafeInteger(writeBefore) ||
    applicationLoginBefore > writeBefore || input.applicationCredentials === input.lifecycleCredentials) {
    return stopFirstOpen("MANAGEMENT_SESSION_BINDING_CHANGED");
  }
  const lifecycle = bindFirstOpenSession("lifecycle", input.lifecycleCredentials, writeBefore, now);
  let timer: AbortSignal | undefined;
  const lifetime = () => {
    const remaining = writeBefore - now();
    if (remaining <= 0 || remaining > 3_600_000) return stopFirstOpen("MANAGEMENT_WINDOW_CLOSED");
    return timer ??= AbortSignal.timeout(remaining);
  };
  const lifecycleCredentials = () => lifecycle.credentials(lifetime());
  const application = bindFirstOpenSession("application", input.applicationCredentials ??
    firstOpenManagerProbeSource(lifecycleCredentials, input.issueBefore, now), applicationLoginBefore, now);
  const backend = loadBackend({ ...input, lifecycleCredentials }, target, input.approval.nonce,
    signal => AbortSignal.any([signal, lifetime()]));
  const applicationRead = firstOpenReadSession(input.backendDirectory, target, s.tenantRole, signal => application.credentials(signal));
  let ready = false;
  const admitted = <T>(signal: AbortSignal, operation: () => Promise<T>) => {
    signal.throwIfAborted();
    if (!ready) return stopFirstOpen("MANAGEMENT_SESSION_NOT_READY");
    return operation();
  };
  const database = firstOpenExpressDatabase({ approval: input.approval, approvalSha256: approvedSha256,
    expectedOperationSha256, deadline: writeBefore, now, journal: input.journal, backend,
    applicationRead: (signal, run) => {
      const remaining = applicationLoginBefore - now();
      if (remaining <= 0 || remaining > 900_000) return stopFirstOpen("APPLICATION_LOGIN_WINDOW_CHANGED");
      return applicationRead(AbortSignal.any([signal, AbortSignal.timeout(remaining)]), run);
    },
    readBaseline: firstOpenBaselineSource(new S3Client(sdkConfig(lifecycleCredentials))) });
  const restricted: FirstOnboardingExpressPorts["database"] = {
    inspect: x => admitted(x.signal, () => database.inspect(x)),
    prepare: x => admitted(x.signal, () => database.prepare(x)),
    restore: x => admitted(x.signal, () => database.restore(x)),
    migrateSaas: x => admitted(x.signal, () => database.migrateSaas(x)),
    activateApplication: x => admitted(x.signal, () => database.activateApplication(x)),
    verify: x => admitted(x.signal, () => database.verify(x)),
  };
  const port: FirstOpenFixedManagement = Object.freeze({
    database: Object.freeze(restricted),
    async checkReady(requestSha256: string, loginBefore: number, signal: AbortSignal) {
      if (requestSha256 !== approvedSha256 || loginBefore !== applicationLoginBefore) return stopFirstOpen("MANAGEMENT_APPROVAL_CHANGED");
      await lifecycle.identify(AbortSignal.any([signal, lifetime()]));
      await application.identify(signal);
      await backend.assertReady(signal);
      ready = true;
    },
  });
  return { port, lifecycleCredentials };
}

export function bindFirstOpenFixedManagement(input: FixedManagementInput, now = Date.now): FirstOpenFixedManagement {
  // The legacy standalone binder has no protected task-release input.
  return buildFirstOpenFixedManagement(input, now, prepared.scope.expectedProvisionOperationSha256).port;
}

type ManagementHost = {
  release: FirstOpenFrozenRelease;
  trustedReleaseSha256: string;
  formalApprovalSha256?: string;
  actual: Parameters<typeof bindFirstOpenReleaseEntry>[2];
  approval: Reviewed["approval"];
  scope: FirstOpenManagementScope;
};

/** Installation proof only: the runtime-created version does not exist yet,
 * and a policy permitting any CreateStack is not readiness. */
export interface FirstOpenControlledCfnPreclaimProof {
  schema: "techlong/fc41597f-controlled-cfn-preclaim/v1";
  jobId: string;
  approvalSha256: string;
  writeBefore: number;
  authorRoleArn: string;
  submitterRoleArn: string;
  executionRoleArn: string;
  checkedAt: number;
  versionedTemplateWriteProtectionSha256: string;
  provisionerCreateDeniedSha256: string;
  managementInitiallyCreateDeniedSha256: string;
  authoritySourceSha256: string;
}

export function requireFirstOpenControlledCfnPreclaimProof(proof: FirstOpenControlledCfnPreclaimProof | undefined,
  release: Pick<FirstOpenFrozenRelease, "approvalSha256" | "writeBefore">, now: number) {
  if (!proof || proof.schema !== "techlong/fc41597f-controlled-cfn-preclaim/v1" ||
    proof.jobId !== s.jobId || proof.approvalSha256 !== release.approvalSha256 || proof.writeBefore !== release.writeBefore ||
    proof.authorRoleArn !== s.workerRole || proof.submitterRoleArn !== s.lifecycleRole || proof.executionRoleArn !== s.cfnRole || !Number.isSafeInteger(proof.checkedAt) ||
    proof.checkedAt > now || now - proof.checkedAt >= 5 * 3_600_000 || release.writeBefore <= now ||
    ![proof.versionedTemplateWriteProtectionSha256, proof.provisionerCreateDeniedSha256,
      proof.managementInitiallyCreateDeniedSha256, proof.authoritySourceSha256]
      .every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v))) return stopFirstOpen("CONTROLLED_CFN_PRECLAIM_PROOF_REQUIRED");
  return structuredClone(proof);
}

async function checkManagementHost(input: ManagementHost, role: "management" | "runonce", now: () => number) {
  const { release, scope, actual } = input;
  if (actual.role !== role || scope.approvalSha256 !== release.approvalSha256 || scope.releaseSha256 !== input.trustedReleaseSha256 ||
    scope.runId !== actual.runOnceId || scope.applicationLoginBefore !== release.applicationLoginBefore ||
    scope.writeBefore !== release.writeBefore || input.approval.writeBefore !== release.writeBefore ||
    input.approval.controlledWindow?.claimBefore !== release.claimBefore ||
    input.approval.controlledWindow?.startAt !== release.startAt ||
    canonicalJson(input.approval.taskRelease ?? null) !== canonicalJson(release.taskRelease ?? null) ||
    canonicalJson(scope.express) !== canonicalJson(input.approval.express)) return stopFirstOpen("MANAGEMENT_HOST_CHANGED");
  await bindFirstOpenReleaseEntry(release, input.trustedReleaseSha256, actual);
  await checkSandboxFirstOpenApproval(input.approval, release.approvalSha256, now(), input.formalApprovalSha256);
  const taskRelease = release.taskRelease;
  const expectedOperationSha256 = await firstOpenManagementOperationSha256(taskRelease);
  if (scope.fence.externalFence.operationHash !== expectedOperationSha256) return stopFirstOpen("MANAGEMENT_HOST_CHANGED");
  return { taskRelease, expectedOperationSha256 };
}

/** Only the pinned management reusable may host the privileged provider.
 * Neither the Neon reader nor either AWS source is sent in a mailbox message. */
export async function runProtectedFirstOpenManagement(input: ManagementHost & {
  management: Omit<FixedManagementInput, "approval" | "approvedSha256" | "writeBefore" | "applicationLoginBefore" | "issueBefore" | "lifecycleCredentials" | "applicationCredentials">;
  getToken: Parameters<typeof firstOpenGitHubIssuedSession>[0]["getToken"];
  claimReader: Parameters<typeof firstOpenManagementClaimProof>[0];
  controlledCfnPreclaimProof: FirstOpenControlledCfnPreclaimProof | undefined;
  versionAuthorityReader: FirstOpenVersionAuthorityReader | undefined;
  renderStack: Awaited<ReturnType<typeof prepareFirstOpenInspectSeed>>["renderStack"];
}, signal: AbortSignal, now = Date.now) {
  const { taskRelease, expectedOperationSha256 } = await checkManagementHost(input, "management", now);
  const { scope } = input;
  const cfnProof = requireFirstOpenControlledCfnPreclaimProof(input.controlledCfnPreclaimProof, input.release, now());
  const { versionAuthorityReader } = input;
  if (!versionAuthorityReader || typeof versionAuthorityReader.readVerified !== "function" ||
    versionAuthorityReader.sourceSha256 !== cfnProof.authoritySourceSha256) return stopFirstOpen("CONTROLLED_CFN_AUTHORITY_SOURCE_UNBOUND");
  const { port, lifecycleCredentials } = buildFirstOpenFixedManagement({ ...input.management,
    lifecycleCredentials: firstOpenGitHubIssuedSession(input, now), issueBefore: input.release.claimBefore,
    approval: scope.express, approvedSha256: scope.approvalSha256, writeBefore: scope.writeBefore,
    applicationLoginBefore: scope.applicationLoginBefore }, now, expectedOperationSha256);
  const config = sdkConfig(lifecycleCredentials), s3 = new S3Client(config), cloudFormation = new CloudFormationClient(config);
  const secrets = new SecretsManagerClient(config);
  const verifyClaim = firstOpenManagementClaimProof(input.claimReader, scope.approvalSha256);
  const submit = createFirstOpenControlledCfnSubmitter({
    approvalSha256: scope.approvalSha256, writeBefore: scope.writeBefore, startAt: input.release.startAt,
    submitBefore: input.release.phaseCutoffs[3], runId: scope.runId, authoritySourceSha256: cfnProof.authoritySourceSha256,
    authorityReader: versionAuthorityReader, verifyClaim, s3, cloudFormation,
  }, now);
  try {
    await serveFirstOpenManagement({ ...scope, taskRelease }, firstOpenManagementMailbox(s3, "management", scope.approvalSha256, true), port,
      verifyClaim, signal, now, async request => {
        const live = await secrets.send(new DescribeSecretCommand({ SecretId: request.arn }), { abortSignal: request.signal });
        assertInitialSecretVersion(live, request.arn, scope.initialVersionId);
        const tags = { ManagedBy: "techlong-sandbox", AppInstanceId: s.instanceId, DeploymentId: s.deploymentId, ResourceGeneration: "1",
          SecretSchema: "techlong-runtime-four-key-v2", DatabaseProfile: "express_iam", StableIdentity: s.stableIdentity,
          OwnershipMarker: scope.fence.fence.ownershipMarker };
        if (live.Name !== s.secretName || live.ReplicationStatus?.length || (live.PrimaryRegion && live.PrimaryRegion !== s.region) ||
          (live.KmsKeyId && live.KmsKeyId !== "alias/aws/secretsmanager") || live.Tags?.length !== Object.keys(tags).length ||
          live.VersionIdsToStages?.[scope.initialVersionId]?.length !== 1 ||
          Object.entries(tags).some(([Key, Value]) => live.Tags?.filter(t => t.Key === Key && t.Value === Value).length !== 1)) {
          return stopFirstOpen("CONTROLLED_CFN_SECRET_CHANGED");
        }
        const { stack: expectedStack } = await input.renderStack(request, request.signal);
        return submit({ expectedStack, requestSha256: request.requestSha256, versionId: request.versionId,
          putAcknowledgedAt: request.putAcknowledgedAt, signal: request.signal });
      });
  } finally { s3.destroy(); cloudFormation.destroy(); secrets.destroy(); }
}

/** Build using the same exact Provisioner source used for the RunOnce ports.
 * No lifecycle input is available to the writer. */
export async function bindProtectedFirstOpenManagementClient(input: ManagementHost & { provisionerCredentials: CredentialSource;
  authorityArtifacts?: Pick<ReturnType<typeof firstOpenGitHubAuthorityArtifacts>, "sourceSha256" | "publishIntent"> }, now = Date.now) {
  const { taskRelease } = await checkManagementHost(input, "runonce", now);
  const { scope } = input;
  const verified = bindFirstOpenSession("provisioner", input.provisionerCredentials, scope.writeBefore, now);
  const s3 = new S3Client(sdkConfig(() => verified.credentials(AbortSignal.timeout(15_000))));
  const author = createFirstOpenControlledCfnAuthor({ approvalSha256: scope.approvalSha256, writeBefore: scope.writeBefore, s3 }, now);
  return firstOpenManagementClient({ ...scope, taskRelease }, firstOpenManagementMailbox(s3, "runonce", scope.approvalSha256, true), now, async (stack, signal) => {
    const ack = await author(stack, signal);
    const artifacts = input.authorityArtifacts;
    if (artifacts) {
      const facts = { ...ack, operationSha256: stack.tags.ExternalOperationHash, templateSha256: stack.templateSha256 };
      const exact = firstOpenVersionAuthorityScope({ ...facts, approvalSha256: scope.approvalSha256,
        sourceSha256: artifacts.sourceSha256, runId: scope.runId, submitBefore: input.release.phaseCutoffs[3] });
      await artifacts.publishIntent({ ...facts, scopeSha256: await sha256Hex(exact) }, signal);
    }
    return ack;
  });
}

type PairedInspect = Parameters<typeof bindFirstOpenPairedInspect>[0];
/** No management source here, and the same verified identity is used for
 * readiness, AWS metadata, and the non-admin target database connection. */
export function bindFirstOpenExpressInspector(input: Omit<PairedInspect, "identify" | "readOnly" | "database" | "versionAuthority"> & {
  backendDirectory: string;
  inspectorCredentials: CredentialSource;
  readOnly(credentials: (signal: AbortSignal) => ReturnType<CredentialSource>): PairedInspect["readOnly"];
  versionAuthority?: Omit<NonNullable<PairedInspect["versionAuthority"]>, "verifyFormalGrant" | "verifyInstalledPolicy" | "verifyRelockedPolicy"> & {
    verifyFormalGrantWithInspector(credentials: ReturnType<typeof bindFirstOpenSession>["credentials"]):
      (signal: AbortSignal) => Promise<FirstOpenFormalProvisionerReceipt>;
    verifyWithInspector(credentials: ReturnType<typeof bindFirstOpenSession>["credentials"]):
      NonNullable<PairedInspect["versionAuthority"]>["verifyInstalledPolicy"];
    verifyRelockWithInspector(credentials: ReturnType<typeof bindFirstOpenSession>["credentials"]):
      NonNullable<PairedInspect["versionAuthority"]>["verifyRelockedPolicy"];
  };
}, now = Date.now) {
  const { backendDirectory, inspectorCredentials, readOnly, versionAuthority, ...review } = input;
  const express = review.approval.express;
  if (!express || !isAbsolute(backendDirectory)) return stopFirstOpen("NONADMIN_SQL_SOURCE_REQUIRED");
  const inspector = bindFirstOpenSession("inspector", inspectorCredentials, review.approval.writeBefore, now);
  const load = createRequire(join(backendDirectory, "package.json"));
  return bindFirstOpenPairedInspect({ ...review, identify: inspector.identify, readOnly: readOnly(inspector.credentials),
    ...(versionAuthority && { versionAuthority: { runId: versionAuthority.runId, submitBefore: versionAuthority.submitBefore,
      artifacts: versionAuthority.artifacts, formalProvisionerGrantAckSha256: versionAuthority.formalProvisionerGrantAckSha256,
      async verifyFormalGrant(signal) {
        const receipt = await versionAuthority.verifyFormalGrantWithInspector(inspector.credentials)(signal);
        return { executeAckSha256: receipt.executeAckSha256, receiptSha256: await sha256Hex(receipt) };
      }, verifyInstalledPolicy: versionAuthority.verifyWithInspector(inspector.credentials),
      verifyRelockedPolicy: versionAuthority.verifyRelockWithInspector(inspector.credentials) } }),
    database: { roleDirectorySql: load("./services/saas/aurora_role_directory_v2.js").ROLE_DIRECTORY_SQL,
      session: firstOpenReadSession(backendDirectory, express.target, FIRST_OPEN_INSPECTOR_SQL_USER, inspector.credentials) },
  }, now);
}

/** Explicit operator binding for the fixed job. Import/construction does not
 * read credentials, run the job, enable a queue, or open a cloud/DB connection. */
export function bindReviewedSandboxFirstOpenWithExpress(input: Omit<Reviewed, "ports"> & {
  ports: Omit<Reviewed["ports"], "express" | "verifyEmptyExpressCapability">;
  sources: FirstOpenExpressSources;
  applicationLoginBefore: number; // from the frozen first-open release
  formalProvisionerGrantAckSha256?: string;
}, now: () => number = Date.now) {
  const { sources, applicationLoginBefore, formalProvisionerGrantAckSha256, ...reviewed } = input, express = reviewed.approval.express;
  if (!express || !/^[a-f0-9]{64}$/.test(reviewed.approvedSha256)) return stopFirstOpen("REVIEW_SCOPE_REQUIRED");
  const taggedG1 = reviewed.approval.taskRelease !== undefined;
  if (taggedG1 && express.g1StandaloneTagProof !== FIRST_OPEN_G1_TAG_PROOF_MODE) return stopFirstOpen("G1_TAG_PROOF_APPROVAL_REQUIRED");
  exactTarget(express.target);
  if (!sources.handoff || !sources.management || !reviewed.ports.cleanupReadiness.verifyBeforeClaim ||
    reviewed.approval.jobId !== s.jobId) {
    return stopFirstOpen("SEPARATE_FIRST_OPEN_PROVIDERS_REQUIRED");
  }
  pairFirstOpenApproval(sources.handoff, reviewed.approval, reviewed.approvedSha256);
  if (!Number.isSafeInteger(applicationLoginBefore) || applicationLoginBefore <= reviewed.approval.controlledWindow!.claimBefore ||
    applicationLoginBefore > reviewed.approval.writeBefore) return stopFirstOpen("APPLICATION_LOGIN_WINDOW_CHANGED");
  const provisioner = bindFirstOpenSession("provisioner", sources.provisionerCredentials, reviewed.approval.writeBefore, now);
  const secretConfig = sdkConfig(() => provisioner.credentials(AbortSignal.timeout(15_000)));
  const secret = firstOpenInitialSecret({ approvedSha256: reviewed.approvedSha256, client: new SecretsManagerClient(secretConfig),
    sts: new STSClient(secretConfig), loadTenantPaymentMaterial: sources.loadTenantPaymentMaterial,
    rememberOwnerSeed: sources.controlMaterial?.rememberOwnerSeed,
    ...(taggedG1 && { g1StandaloneTagProof: FIRST_OPEN_G1_TAG_PROOF_MODE }) });
  const handoff = firstOpenRunOnceHandoff(sources.handoff, reviewed.approval.taskRelease, formalProvisionerGrantAckSha256);
  const cleanup = reviewed.ports.cleanupReadiness;
  return bindReviewedSandboxFirstOpenRunOnce({ ...reviewed, ports: { ...reviewed.ports, async verifyEmptyExpressCapability(x) {
    const remaining = reviewed.approval.controlledWindow!.claimBefore - now();
    if (remaining <= 0 || x.review.reviewSha256 !== reviewed.approval.reviewSha256 ||
      x.baselineDigest !== reviewed.approval.baselineDigest || x.databaseSchemaVersion !== reviewed.approval.databaseSchemaVersion) {
      return stopFirstOpen("MANAGEMENT_APPROVAL_CHANGED");
    }
    await sources.management.checkReady(reviewed.approvedSha256, applicationLoginBefore, AbortSignal.timeout(remaining));
    return { profile: "express_iam", restrictedManagementReady: true, evidenceSha256: reviewed.approval.capabilitySha256 };
  }, cleanupReadiness: {
    verify: x => cleanup.verify(x),
    ...(cleanup.verifyBeforeClaim && { async verifyBeforeClaim(x: Parameters<NonNullable<typeof cleanup.verifyBeforeClaim>>[0]) {
      const proof = await cleanup.verifyBeforeClaim!(x);
      x.signal.throwIfAborted();
      await provisioner.identify(x.signal);
      return proof;
    } }),
  }, express: { database: sources.management.database, secret, handoff: taggedG1 ? { ...handoff,
    verifyInitialSecret: (ack, signal) => secret.verifyStandaloneTagDenials(ack, signal, handoff.verifyInitialSecret),
  } : handoff,
    onVerifiedControlMaterial: sources.controlMaterial?.onVerifiedControlMaterial } } }, now);
}
