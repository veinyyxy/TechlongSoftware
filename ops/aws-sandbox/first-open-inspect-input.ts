import type { AwsSandboxTenantStackInput } from "../../lib/deployments/cloudformation/tenant-stack.ts";
import type { DeploymentExecutionContext, TenantExternalOperationFence } from "../../lib/deployments/execution/contracts.ts";
import { firstOnboardingInitialSecretVersion, renderFirstOpenExpressTemplate, type FirstOnboardingDatabaseIdentity } from "../../lib/deployments/execution/first-onboarding-express.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenVersion } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { renderFirstOnboardingExpectation, sealFirstOpenTaskBinding } from "../../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { checkSandboxFirstOpenApproval, SANDBOX_FIRST_OPEN as S, SANDBOX_FIRST_OPEN_STACK } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenExecutionWindow } from "../../lib/deployments/execution/first-onboarding-window.ts";
import type { FirstOnboardingReview } from "../../lib/deployments/first-onboarding.ts";
import type { SoftwareRelease } from "../../lib/deployments/releases/contract.ts";
import { sameFirstOpenFence, validOid } from "./first-open-express-scope.ts";

type Approval = Awaited<ReturnType<typeof checkSandboxFirstOpenApproval>>;
export type FirstOpenInspectSeed = Pick<AwsSandboxTenantStackInput, "plan" | "environment" | "requestedAt" | "activeCellCount" | "activeTenantCount"> & {
  binding: NonNullable<DeploymentExecutionContext["binding"]>; review: FirstOnboardingReview; release: SoftwareRelease;
  epoch: TenantExternalOperationFence;
};
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSPECT_INPUT_" + code); };
const arnPrefix = `arn:aws:cloudformation:${S.region}:${S.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/`;

/** Pure preparation from a separately sealed seed. No writer job, lease,
 * CreateStack response, or observed template can be used as the expectation. */
export async function prepareFirstOpenInspectSeed(source: FirstOpenInspectSeed, sealedSha: string, approval: Approval,
  approvalSha: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const seed = structuredClone(source), { review, release, epoch } = seed, scope = review.payload.scope;
  const version = firstOpenVersion(approval.taskRelease), { artifactRef } = version;
  const a = approval.express, window = firstOpenExecutionWindow(approval.jobId, approval.writeBefore, approval.controlledWindow);
  const runtimeArn = `arn:aws:secretsmanager:${S.region}:${S.account}:secret:${S.secretName}-`;
  if (!a || !window || sealedSha !== await sha256Hex(seed) || review.reviewSha256 !== approval.reviewSha256 ||
    review.jobId !== S.jobId || scope.appInstanceId !== S.instanceId || scope.deploymentId !== S.deploymentId ||
    scope.artifactRef !== artifactRef || scope.releaseId !== version.releaseId || release.id !== version.releaseId ||
    release.image.repository !== version.imageRepository || release.image.manifestDigest !== version.imageDigest ||
    release.image.platformDigest !== version.imageDigest || review.platformDigest !== version.imageDigest ||
    (approval.taskRelease && canonicalJson(release) !== canonicalJson(approval.taskRelease)) ||
    review.catalogSha256 !== await sha256Hex(release) || scope.planHash !== await sha256Hex(seed.plan) ||
    seed.environment.id !== S.environmentId || seed.environment.expectedAccountId !== S.account ||
    seed.environment.region !== S.region || seed.environment.applyEnabled !== false) {
    return fail("SEED");
  }
  const control = a.sampling.secrets[0];
  if (!control || control.arn !== S.controlArn || control.versionId !== S.controlVersion || a.applicationRoleArn !== S.applicationRole) return fail("BINDING");
  const express = { applicationRoleArn: a.applicationRoleArn, controlRef: `${control.arn}:::${control.versionId}` };
  const binding = await sealFirstOpenTaskBinding({ binding: seed.binding, environment: seed.environment, express,
    approvalSha256: approvalSha, parametersSha256: a.environmentParametersSha256 });
  signal.throwIfAborted();
  const fence = epoch.resourceFence;
  sameFirstOpenFence({ fence, externalFence: epoch, signal });
  const versionId = await firstOnboardingInitialSecretVersion({ approvalSha256: approvalSha,
    name: S.secretName, jobId: S.jobId, epoch, baselineDigest: approval.baselineDigest });
  const renderStack = async (observation: { arn: string; identity: FirstOnboardingDatabaseIdentity }, signal: AbortSignal) => {
    signal.throwIfAborted();
    const { arn, identity } = observation;
    if (!arn.startsWith(runtimeArn) || !/^[A-Za-z0-9]{6}$/.test(arn.slice(runtimeArn.length)) || identity.name !== S.tenantDatabase ||
      !validOid(identity.databaseOid) || !validOid(identity.roleOid) ||
      identity.roleName !== S.tenantRole || identity.ownershipMarker !== fence.ownershipMarker ||
      identity.baselineDigest !== approval.baselineDigest || identity.schemaVersion !== approval.databaseSchemaVersion ||
      identity.clusterResourceId !== S.clusterId || identity.otherConnectableDatabases !== 0) return fail("OBSERVATION");
    const sampling = { ...a.sampling, secrets: [...a.sampling.secrets, { arn, versionId }] }, material = { identity, sampling };
    const context = {
      environment: seed.environment, binding, appInstance: { id: S.instanceId },
      deployment: { id: S.deploymentId, artifactRef, configurationHash: scope.configurationHash },
      tenantResources: { identity: fence.identity, generation: fence.generation, ownershipMarker: fence.ownershipMarker,
        lifecycleStatus: "verified" as const, baselineDigest: identity.baselineDigest },
      tenantExternalOperation: epoch,
    };
    const workload: AwsSandboxTenantStackInput = {
      plan: seed.plan, environment: seed.environment, requestedAt: seed.requestedAt,
      activeCellCount: seed.activeCellCount, activeTenantCount: seed.activeTenantCount,
      deploymentId: S.deploymentId, resourceGeneration: 1, runtimeSecretRef: arn, runtimeSecretName: S.secretName,
      externalOperation: { epoch: 1, intent: "provision", state: "active", ownerDeploymentId: S.deploymentId,
        marker: epoch.marker, operationHash: epoch.operationHash },
      imageUri: artifactRef, tenantHostname: S.hostname, listenerPriority: 100,
    };
    const stack = await renderFirstOnboardingExpectation(workload, context, artifactRef, { ...express,
      render: x => renderFirstOpenExpressTemplate(x, a, material, scope.configurationHash) }, window);
    signal.throwIfAborted();
    return { context, stack, material };
  };
  return {
    epoch,
    versionId,
    binding,
    renderStack,
    async assemble(observation: { stackId: string; arn: string; identity: FirstOnboardingDatabaseIdentity }, signal: AbortSignal) {
      const { stackId } = observation;
      if (!stackId.startsWith(arnPrefix) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(stackId.slice(arnPrefix.length))) return fail("OBSERVATION");
      const { context, stack, material } = await renderStack(observation, signal);
      return { context, stackId, stack, material, signal, dnsTarget: approval.dnsTarget, baselineDigest: approval.baselineDigest,
        databaseSchemaVersion: approval.databaseSchemaVersion, platformDigest: review.platformDigest,
        completion: { review, release, approved: { clientApiVersion: approval.completion!.clientApiVersion, samplingSha256: await sha256Hex(material.sampling) } } };
    },
  };
}
