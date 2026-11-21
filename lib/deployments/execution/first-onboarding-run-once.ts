import { CLAIM_FIRST_ONBOARDING, SELECT_FIRST_ONBOARDING } from "../first-onboarding.ts";
import { isFirstOpenBuyerSignerPin } from "../../buyer-forward/signer-binding.ts";
import { FIRST_OPEN_MANAGEMENT_SQL_USER, parseExpressManagementTargetV3 } from "./aurora-express-bootstrap-v3.ts";
import { awsSandboxTenantStackName } from "../cloudformation/tenant-stack.ts";
import type { AwsDeploymentPort, DeploymentExecutionBinding, DeploymentExecutionRepository, DeploymentJobLeaseFence } from "./contracts.ts";
import { FIRST_OPEN_BASELINE_BINDING, isFixedFirstOpenBaseline } from "./first-onboarding-baseline-versions.ts";
import { firstOpenBuyerBinding } from "./first-open-buyer-binding.ts";
import { assertFirstOpenClaimTime, FIRST_OPEN_CELL_STACK, firstOpenExecutionWindow } from "./first-onboarding-window.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { firstOpenVersion, verifyFirstOpenTaskRelease } from "./first-onboarding-version.ts";
import { attachFirstOpenTaskBinding, isFirstOpenTaskBinding, type SupervisedWorkloadAwsPort } from "./single-tenant-workload-strategy.ts";
import { DisabledTenantDatabasePort, validateApprovedBaseline } from "./tenant-database.ts";
import { runReviewedFirstOnboarding, type DeploymentWorkerDependencies } from "./worker.ts";

export const SANDBOX_FIRST_OPEN = Object.freeze({
  jobId: FIRST_OPEN_BASELINE_BINDING.jobId, deploymentId: "dep_746535593025bf97a9efeccd",
  instanceId: firstOpenBuyerBinding.tenantId, subscriptionId: "sub_f0dea547d45bcd26ed823fd7",
  workspaceSha256: "7359ccf32c3bebd4c4b754caac4cdfbdd471a8202c9206f67a298a8f020ca0fc",
  productId: "prd_restaurant_order_system", account: "402010193138", region: "ca-central-1",
  environmentId: "env_aws_sandbox_ca_central_1", hostname: firstOpenBuyerBinding.apiHostname,
  releaseId: firstOpenVersion().releaseId,
  imageRepository: firstOpenVersion().imageRepository,
  imageDigest: firstOpenVersion().imageDigest,
  schemaVersion: "speedfeast-saas-control-v1",
  clientApi: "speedfeast-client-api-sha256:90191edd28decd490e95ea35461f9e26200874783a1ffc5f8598406bbc583144",
  workerRole: "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole",
  cfnRole: "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole",
  executionRole: "arn:aws:iam::402010193138:role/TechlongSandboxTaskExecutionRole",
  applicationRole: "arn:aws:iam::402010193138:role/TechlongSandboxFirstOpen-e9fdccd5d8c7685c",
  lifecycleRole: "arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole",
  inspectorRole: "arn:aws:iam::402010193138:role/TechlongSandboxFirstOpenInspector",
  bucket: "techlong-sandbox-tenant-images-402010193138-e9fdccd5d8c7685c",
  tenantDatabase: "tenant_e9fdccd5d8c7685c_db", tenantRole: "tenant_e9fdccd5d8c7685c_role",
  stableIdentity: "e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a",
  secretName: "techlong/sandbox/tenant/appbbd626d7d3806af686073211_e9fdccd5d8/runtime/g1",
  controlArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/control-public-key-first-acceptance-PfBjiq",
  controlVersion: "75d8da0af103e1e10e6d3341cbd50226fea7ce5e5aac8d150ab9e447b6340680",
  clusterId: "cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM",
  clusterArn: "arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001",
  cellStack: FIRST_OPEN_CELL_STACK,
  platformStack: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7",
  zone: "Z01473621BTTHKXBGOOEJ",
});
const s = SANDBOX_FIRST_OPEN;
export const SANDBOX_FIRST_OPEN_STACK = awsSandboxTenantStackName(s.instanceId);
const stackArnPrefix = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/`;
const hex = /^[a-f0-9]{64}$/;
const allowedTransitions = new Set(["queued", "preflight", "database_preparing", "migrating", "infrastructure_provisioning",
  "waiting_healthy", "configuring", "verifying"]);
type Worker = Parameters<typeof runReviewedFirstOnboarding>[0];
type Approval = Worker["approval"];
type NarrowRepository = Pick<DeploymentExecutionRepository, "loadContext" | "reserveEnvironmentCapacity" | "heartbeat" |
  "transitionDeployment" | "beginStep" | "finishStep" | "recordTenantResourceLifecycle" | "claimTenantResourceGeneration" | "assertTenantExternalOperation"> & {
  heartbeat(input: Parameters<DeploymentExecutionRepository["heartbeat"]>[0] & { notAfter: number }): Promise<boolean>;
};
type NarrowAws = Pick<AwsDeploymentPort, "region" | "getCallerIdentity" | "describeTenantStack"> & {
  createStack: SupervisedWorkloadAwsPort["applySupervisedTenantStack"];
};
// Explicit operations, never a general SQL client or an arbitrary AWS send.
export interface SandboxFirstOpenPorts {
  repository: NarrowRepository;
  cloud: NarrowAws;
  control: DeploymentWorkerDependencies["controlClient"];
  controlPayloadCompiler: DeploymentWorkerDependencies["controlPayloadCompiler"];
  cellPreflight: DeploymentWorkerDependencies["sharedCellSecurityPreflight"];
  provisionEpoch: NonNullable<DeploymentWorkerDependencies["tenantExternalOperationCoordinator"]>["prepareAndActivate"];
  cleanupReadiness: Worker["cleanupReadiness"]; // evidence check only
  readHeldJob(): ReturnType<Worker["readJob"]>;
  readFixedRelease(): ReturnType<Worker["readRelease"]>;
  claimHeldJob(bindings: Parameters<Worker["claimJob"]>[1]): ReturnType<Worker["claimJob"]>;
  verifyEmptyExpressCapability: Worker["verifyEmptyExpressCapability"];
  express: NonNullable<Worker["expressPorts"]>;
}

function requireScope(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(`FIRST_OPEN_RUN_${code}`);
}
const forbidden = async (): Promise<never> => { throw Error("FIRST_OPEN_RUN_OPERATION_FORBIDDEN"); };
const correctStackArn = (id: string) => id.startsWith(stackArnPrefix) &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id.slice(stackArnPrefix.length));

export async function checkSandboxFirstOpenApproval(approval: Approval, sha: string, now: number) {
  const a = structuredClone(approval), e = a.express, complete = a.completion;
  requireScope(hex.test(sha) && await sha256Hex(a) === sha, "APPROVAL_SHA");
  requireScope(Number.isSafeInteger(a.writeBefore) && now < a.writeBefore && a.writeBefore - now <= 3600000, "WINDOW");
  requireScope(e && a.jobId === s.jobId && a.hostname === s.hostname && a.databaseSchemaVersion === s.schemaVersion &&
    hex.test(a.reviewSha256) && hex.test(a.capabilitySha256) &&
    /^[a-z0-9-]+\.ca-central-1\.elb\.amazonaws\.com$/.test(a.dnsTarget.replace(/^dualstack\./, "")) &&
    complete && "deriveG1Secret" in complete && complete.deriveG1Secret === true && complete.clientApiVersion === s.clientApi,
  "TASK_SCOPE");
  requireScope(parseExpressManagementTargetV3(e.target).managementUsername === FIRST_OPEN_MANAGEMENT_SQL_USER &&
    e.target.clusterArn === s.clusterArn && e.target.clusterResourceId === s.clusterId &&
    e.target.resourceGeneration === 1 && e.target.stableIdentity === s.stableIdentity && e.target.tenantDatabase === s.tenantDatabase &&
    e.target.tenantUsername === s.tenantRole && e.applicationRoleArn === s.applicationRole && e.independentRoleArn === s.inspectorRole &&
    e.lifecycleRoleArn === s.lifecycleRole && e.sampling.cellStackId === s.cellStack && e.sampling.platformStackId === s.platformStack &&
    e.sampling.hostedZoneId === s.zone && e.sampling.apiHostname === s.hostname && e.sampling.persistence.bucket === s.bucket &&
    canonicalJson(e.sampling.secrets) === canonicalJson([{ arn: s.controlArn, versionId: s.controlVersion }]), "PROVIDER_SCOPE");
  requireScope(a.baselineDigest === FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256 && isFixedFirstOpenBaseline(e.baseline, a.jobId), "BASELINE_PINS");
  requireScope(isFirstOpenBuyerSignerPin(e.buyerForwardSigner), "BUYER_SIGNER_PIN_REQUIRED");
  if (a.taskRelease !== undefined) {
    await verifyFirstOpenTaskRelease(a.taskRelease);
    requireScope(a.taskRelease.firstOpenScope.publication.publishedAt <= now, "RELEASE_NOT_PUBLISHED");
  }
  validateApprovedBaseline(e.baseline, a.jobId);
  assertFirstOpenClaimTime(firstOpenExecutionWindow(a.jobId, a.writeBefore, a.controlledWindow)!, now);
  return a;
}

/** One callable entry; only a separately audited operator may supply real
 * role-separated ports. Importing the module opens no connections and reads
 * no configuration. The DB claim is the cross-process single-attempt fence. */
export function createSandboxFirstOpenRunOnce(ports: SandboxFirstOpenPorts, now: () => number = Date.now,
  reviewedTaskBinding?: DeploymentExecutionBinding) {
  let used = false;
  return async (approval: Approval, approvedSha256: string) => {
    const a = await checkSandboxFirstOpenApproval(approval, approvedSha256, now());
    const version = firstOpenVersion(a.taskRelease), artifact = version.artifactRef;
    if (reviewedTaskBinding) requireScope(isFirstOpenTaskBinding(reviewedTaskBinding, approvedSha256), "TASK_BINDING_UNSEALED");
    requireScope(!used && ports.cloud.region === s.region, "ENTRY_ALREADY_USED_OR_REGION");
    used = true;
    const inWindow = () => requireScope(now() < a.writeBefore, "WINDOW");
    const r = ports.repository;
    let leaseToken: string | undefined, stackId: string | undefined;
    let claimSent = false, createSent = false, configureSent = false, stackReads = 0;
    const finishedSteps = new Set<string>();
    const workerId = "first-onboarding:" + s.jobId;
    const guardLease = (lease: DeploymentJobLeaseFence) => {
      inWindow();
      requireScope(leaseToken && lease.leaseToken === leaseToken && lease.jobId === s.jobId &&
        lease.deploymentId === s.deploymentId && lease.workerId === workerId && lease.attempt === 1, "LEASE_SCOPE");
    };
    const guardTenant = (id: string, host: string) => {
      inWindow();
      requireScope(leaseToken && id === s.instanceId && host === s.hostname, "TENANT_SCOPE");
    };
    const repository: DeploymentExecutionRepository = {
      claimNext: forbidden, enqueueJob: forbidden, completeJob: forbidden, retryJob: forbidden, markReady: forbidden,
      confirmCleanupSchedule: forbidden, markInstanceUnavailable: forbidden, markCleanupStatus: forbidden,
      prepareTenantExternalOperation: forbidden, activateTenantExternalOperation: forbidden,
      beginTenantResourceCleanup: forbidden, assertTenantResourceCleanupFence: forbidden, completeTenantResourceCleanup: forbidden,
      beginOrResumeTenantResourceCleanup: forbidden, beginTenantResourceCleanupPhase: forbidden,
      completeTenantResourceCleanupPhase: forbidden, finalizeTenantResourceCleanup: forbidden,
      async loadContext(job) {
        guardLease({ jobId: job.id, deploymentId: job.deploymentId, attempt: job.attempt, workerId, leaseToken: job.leaseToken });
        const c = await r.loadContext(job);
        requireScope(c.deployment.id === s.deploymentId && c.deployment.artifactRef === artifact && c.appInstance.id === s.instanceId &&
          c.environment.id === s.environmentId && c.subscription?.id === s.subscriptionId &&
          await sha256Hex(c.workspace.id) === s.workspaceSha256, "CONTEXT");
        if (!reviewedTaskBinding) return c;
        requireScope(c.job.id === job.id && c.job.leaseToken === job.leaseToken && c.job.attempt === job.attempt, "TASK_BINDING_LEASE");
        return attachFirstOpenTaskBinding(c, reviewedTaskBinding, approvedSha256);
      },
      reserveEnvironmentCapacity(x) { guardLease(x.lease); requireScope(x.environmentId === s.environmentId, "CAPACITY"); return r.reserveEnvironmentCapacity(x); },
      heartbeat(x) { guardLease(x.lease); return r.heartbeat({ ...x, notAfter: a.writeBefore }); },
      transitionDeployment(x) {
        guardLease(x.lease); requireScope(allowedTransitions.has(x.to), "TRANSITION_SCOPE"); return r.transitionDeployment(x);
      },
      beginStep(x) { guardLease(x.lease); return r.beginStep(x); },
      finishStep(x) {
        guardLease(x.lease); requireScope(!finishedSteps.has(x.stepId), "STEP_RESULT_ALREADY_SUBMITTED");
        finishedSteps.add(x.stepId); return r.finishStep(x);
      },
      claimTenantResourceGeneration(x) {
        guardLease(x.lease); requireScope(x.identity.stableIdentityHash === s.stableIdentity && x.identity.appInstanceId === s.instanceId, "GENERATION");
        return r.claimTenantResourceGeneration(x);
      },
      recordTenantResourceLifecycle(x) {
        guardLease(x.lease); requireScope(x.fence.generation === 1 && x.fence.identity.appInstanceId === s.instanceId, "GENERATION");
        return r.recordTenantResourceLifecycle(x);
      },
      assertTenantExternalOperation(x) {
        guardLease(x.lease); requireScope(x.externalFence.intent === "provision" && x.externalFence.resourceFence.generation === 1 &&
          x.externalFence.ownerDeploymentId === s.deploymentId, "EPOCH"); return r.assertTenantExternalOperation(x);
      },
    };
    const d: DeploymentWorkerDependencies = {
      repository, now, applyRuntimeReady: false, cleanupRuntimeReady: false,
      cleanupScheduler: { confirmSchedule: forbidden }, tenantDatabase: new DisabledTenantDatabasePort(),
      sharedCellSecurityPreflight: ports.cellPreflight, controlPayloadCompiler: ports.controlPayloadCompiler,
      tenantExternalOperationCoordinator: { prepareAndActivate(x) {
        guardLease(x.lease); requireScope(x.intent === "provision" && x.resourceFence.generation === 1 &&
          x.resourceFence.identity.appInstanceId === s.instanceId && x.resourceFence.ownerDeploymentId === s.deploymentId, "EPOCH");
        return ports.provisionEpoch(x);
      } },
      controlClient: {
        waitUntilHealthy(x) { guardTenant(x.appInstanceId, x.hostname); return ports.control.waitUntilHealthy(x); },
        readConfiguration(x) { guardTenant(x.appInstanceId, x.hostname); return ports.control.readConfiguration(x); },
        provision(x) {
          guardTenant(x.appInstanceId, x.hostname); requireScope(!configureSent, "CONFIGURE_ONCE");
          configureSent = true; return ports.control.provision(x);
        },
      },
      async awsFactory({ region, workerRoleArn }) {
        inWindow(); requireScope(leaseToken && region === s.region && workerRoleArn === s.workerRole, "AWS_SCOPE");
        const scopePort: SupervisedWorkloadAwsPort = {
          region: s.region, applyTenantStack: forbidden, deleteTenantStack: forbidden,
          getCallerIdentity(x) { inWindow(); return ports.cloud.getCallerIdentity(x); },
          describeTenantStack(id, x) {
            inWindow(); requireScope(++stackReads <= 120 && id === (stackId ?? SANDBOX_FIRST_OPEN_STACK), "STACK_READ_SCOPE");
            return ports.cloud.describeTenantStack(id, x);
          },
          async applySupervisedTenantStack(stack, x) {
            inWindow(); requireScope(!createSent && x.createOnly === true && stack.stackName === SANDBOX_FIRST_OPEN_STACK &&
              stack.cloudFormationRoleArn === s.cfnRole && stack.parameters.ImageUri === artifact, "CREATE_ONCE");
            createSent = true;
            const ack = await ports.cloud.createStack(stack, x);
            requireScope(ack.operation === "create" && correctStackArn(ack.stackId), "CREATE_ACK");
            stackId = ack.stackId;
            return ack;
          },
        };
        return scopePort;
      },
    };
    return runReviewedFirstOnboarding({
      approval: a, approvedSha256, dependencies: d, cleanupReadiness: ports.cleanupReadiness, expressPorts: ports.express,
      config: { workerEnabled: false, applyEnabled: false, confirmation: "", expectedAccountId: s.account,
        expectedRegion: s.region, workerRoleArn: s.workerRole, environmentKey: "aws-sandbox-ca-central-1",
        leaseDurationMs: 120000, pollIntervalMs: 10000 },
      async readJob(sql, args) {
        inWindow(); requireScope(sql === SELECT_FIRST_ONBOARDING && args.length === 1 && args[0] === s.jobId, "JOB_QUERY");
        const row = await ports.readHeldJob();
        requireScope(row && row.job.id === s.jobId && row.deployment.id === s.deploymentId && row.appInstanceId === s.instanceId &&
          row.subscriptionId === s.subscriptionId && row.environmentId === s.environmentId && row.deployment.artifactRef === artifact &&
          await sha256Hex(row.workspaceId) === s.workspaceSha256, "HELD_JOB_SCOPE");
        return row;
      },
      async readRelease(id) {
        inWindow(); requireScope(id === version.releaseId, "RELEASE_SCOPE");
        const release = await ports.readFixedRelease();
        requireScope(release && release.id === version.releaseId && release.image.repository === version.imageRepository &&
          release.image.manifestDigest === version.imageDigest && release.image.platformDigest === version.imageDigest &&
          release.status === version.status && (!a.taskRelease || canonicalJson(release) === canonicalJson(a.taskRelease)), "RELEASE_SCOPE");
        return release;
      },
      verifyEmptyExpressCapability: ports.verifyEmptyExpressCapability,
      async claimJob(sql, b) {
        inWindow(); const token = b[2];
        requireScope(!claimSent && sql === CLAIM_FIRST_ONBOARDING && b[0] === s.jobId && b[1] === workerId &&
          typeof token === "string" && /^lease_[a-f0-9]{32}$/.test(token) &&
          b[3] === a.writeBefore && b[4] === s.deploymentId && b[9] === s.instanceId && b[11] === s.subscriptionId, "CLAIM_ONCE");
        claimSent = true;
        const ack = await ports.claimHeldJob(b);
        if (ack?.jobId === s.jobId) leaseToken = token;
        return ack;
      },
    });
  };
}
