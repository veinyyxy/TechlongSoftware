import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { assertInitialSecretVersion } from "../../lib/deployments/execution/first-onboarding-express.ts";
import { verifyFirstOnboardingRuntime, type FirstOnboardingIndependentHandoff } from "../../lib/deployments/execution/first-onboarding-inspection.ts";
import { firstOnboardingReadOnlyBoundary, type FirstOnboardingReadOnlyPort } from "../../lib/deployments/execution/first-onboarding-reader.ts";
import { checkSandboxFirstOpenApproval, SANDBOX_FIRST_OPEN as scope, SANDBOX_FIRST_OPEN_STACK } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { type FirstOpenGitHubHandoff } from "./first-open-github-handoff.ts";
import { offlineRuntimeObservationSha, rebuildOfflineFirstOpenBinding } from "./first-open-oidc-offline.ts";
import { sameFirstOpenFence } from "./first-open-express-scope.ts";
import { firstOpenIndependentDatabase, type FirstOpenReadSession } from "./first-open-express-database.ts";
import { assertFirstOpenSession, type FirstOpenCaller } from "./first-open-sessions.ts";
import { prepareFirstOpenInspectSeed, type FirstOpenInspectSeed } from "./first-open-inspect-input.ts";

type Runtime = Parameters<FirstOnboardingIndependentHandoff["verifyRuntime"]>[0];
type Approval = Awaited<ReturnType<typeof checkSandboxFirstOpenApproval>>;
type SecretAck = Parameters<FirstOnboardingIndependentHandoff["verifyInitialSecret"]>[0];
const fail = (code: string): never => { throw Error("FIRST_OPEN_PAIRED_" + code); };
const iso = (n: number) => new Date(n).toISOString();
const equal = (l: unknown, r: unknown) => canonicalJson(l) === canonicalJson(r);
const fieldsMatch = (actual: Record<string, unknown>, expected: Record<string, unknown>) =>
  Object.entries(expected).every(([key, value]) => actual[key] === value);
const secretPrefix = `arn:aws:secretsmanager:${scope.region}:${scope.account}:secret:${scope.secretName}-`;

async function secretProjection(ack: SecretAck, signal: AbortSignal) {
  sameFirstOpenFence({ externalFence: ack.externalFence, fence: ack.externalFence.resourceFence, signal });
  if (!ack.arn.startsWith(secretPrefix) || !/^[A-Za-z0-9]{6}$/.test(ack.arn.slice(secretPrefix.length)) ||
    !/^[a-f0-9]{64}$/.test(ack.versionId)) return fail("G1_COORDINATES");
  return { secretReferenceSha256: await sha256Hex(ack.arn), versionIdSha256: await sha256Hex(ack.versionId),
    g1e1FenceSha256: await sha256Hex(ack.externalFence) };
}

async function runtimeProjection(x: Runtime, taskRelease?: FirstOpenTaskRelease) {
  const { context, stack, stackId, completion, material, signal } = x, fence = context.tenantExternalOperation;
  const resource = context.tenantResources, review = completion?.review, release = completion?.release, s = review?.payload.scope;
  const version = firstOpenVersion(taskRelease);
  const arnPrefix = `arn:aws:cloudformation:${scope.region}:${scope.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/`;
  if (!completion || !release || !s || !fence || !resource || context.appInstance.id !== scope.instanceId ||
    context.deployment.id !== scope.deploymentId || context.deployment.configurationHash !== s.configurationHash ||
    resource.lifecycleStatus !== "verified" || resource.baselineDigest !== x.baselineDigest ||
    stack.stackName !== SANDBOX_FIRST_OPEN_STACK || !stackId.startsWith(arnPrefix) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(stackId.slice(arnPrefix.length)) ||
    !("protocol" in stack) || stack.cloudFormationRoleArn !== scope.cfnRole ||
    stack.parameters.TenantHostname !== scope.hostname || stack.parameters.ImageUri !== s.artifactRef ||
    context.deployment.artifactRef !== s.artifactRef || s.artifactRef !== version.artifactRef ||
    release.id !== version.releaseId || s.releaseId !== version.releaseId ||
    release.image.manifestDigest !== version.imageDigest || release.image.platformDigest !== version.imageDigest ||
    (taskRelease && !equal(release, taskRelease)) ||
    !equal([material.identity.name, material.identity.roleName, material.identity.ownershipMarker, material.identity.baselineDigest],
      [resource.identity.databaseName, resource.identity.roleName, resource.ownershipMarker, resource.baselineDigest]) ||
    material.identity.otherConnectableDatabases !== 0 || resource.generation !== fence.resourceFence.generation ||
    resource.ownershipMarker !== fence.resourceFence.ownershipMarker || !equal(resource.identity, fence.resourceFence.identity)) return fail("RUNTIME_COORDINATES");
  sameFirstOpenFence({ fence: fence.resourceFence, externalFence: fence, signal });
  const samplingSha256 = await sha256Hex(material.sampling);
  if (samplingSha256 !== completion.approved.samplingSha256) return fail("SAMPLING");
  const parameters = stack.parameters;
  const expectedRuntimeScopeSha256 = await sha256Hex({
    templateSha256: stack.templateSha256, parametersSha256: await sha256Hex(parameters), tagsSha256: await sha256Hex(stack.tags),
    expectedDnsTargetSha256: await sha256Hex(x.dnsTarget),
    listenerBindingsSha256: await sha256Hex({ HttpsListenerArn: parameters.HttpsListenerArn, ControlListenerArn: parameters.ControlListenerArn }),
    releaseId: release.id, imageDigest: release.image.manifestDigest, platformDigest: release.image.platformDigest, baselineDigest: x.baselineDigest,
  });
  // The writer reaches this gate only after its actual control_verify; the
  // inspector matches the expected ACK projection, then independently samples.
  const configurationAckSha256 = await sha256Hex({ ready: true, desiredConfigurationHash: s.configurationHash, imageRevision: version.imageDigest });
  return {
    stackIdSha256: await sha256Hex(stackId), expectedRuntimeScopeSha256, samplingSha256, g1e1FenceSha256: await sha256Hex(fence),
    databaseIdentitySha256: await sha256Hex(material.identity), configurationAckSha256,
  };
}

type HandoffApproval = Pick<Approval, "writeBefore" | "controlledWindow" | "taskRelease">;
export function pairFirstOpenApproval(wire: FirstOpenGitHubHandoff, approval: HandoffApproval, approvalSha256: string) {
  if (!approval.controlledWindow) return fail("APPROVAL_WINDOW");
  wire.requireApproval(approvalSha256, approval.controlledWindow.startAt, approval.controlledWindow.claimBefore, approval.writeBefore, approval.taskRelease);
}

/** Only the three existing authorization/inspection gates; no Inspector credentials or raw facts. */
export function firstOpenRunOnceHandoff(wire: FirstOpenGitHubHandoff, approvedTaskRelease?: FirstOpenTaskRelease): FirstOnboardingIndependentHandoff {
  const taskRelease = approvedTaskRelease && structuredClone(approvedTaskRelease);
  return {
    async checkIdentity(signal) { await wire.take("01-inspector-ready", signal); },
    async verifyInitialSecret(ack, signal) {
      const expected = await secretProjection(ack, signal);
      await wire.emit("02-g1-check-request", expected, signal);
      const { payload } = await wire.take("02-g1-metadata-observed", signal);
      if (!fieldsMatch(payload, expected)) return fail("G1_RECEIPT");
    },
    async verifyRuntime(x) {
      const expected = await runtimeProjection(x, taskRelease), completion = x.completion!;
      if (!("protocol" in x.stack)) return fail("RUNTIME_COORDINATES");
      await wire.emit("03-runtime-check-request", expected, x.signal);
      const { payload } = await wire.take("03-runtime-observed", x.signal);
      if (!fieldsMatch(payload, Object.fromEntries(Object.entries(expected).filter(([key]) => key !== "configurationAckSha256")))) {
        return fail("RUNTIME_RECEIPT");
      }
      const checked = await rebuildOfflineFirstOpenBinding({
        scope: completion.review.payload.scope, release: completion.release, sampling: x.material.sampling,
        clientApiVersion: completion.approved.clientApiVersion, stackId: x.stackId, expectedTemplateSha256: x.stack.templateSha256,
        expectedRuntimeScopeSha256: expected.expectedRuntimeScopeSha256, epochSha256: expected.g1e1FenceSha256,
        databaseIdentitySha256: expected.databaseIdentitySha256, parameterKeys: Object.keys(x.stack.parameters),
      }, payload);
      return { runtime: checked.runtime, initialBindingText: checked.text };
    },
  };
}

/** Exact Inspector entry. Approved sources must independently resolve the fixed
 * stack/name, validated configuration expectations and local database identity.
 * The request body is not passed to these sources and cannot choose targets. */
export function bindFirstOpenPairedInspect(input: {
  approval: Approval; approvalSha256: string; wire: FirstOpenGitHubHandoff;
  identify(signal: AbortSignal): Promise<FirstOpenCaller>;
  readOnly: Omit<FirstOnboardingReadOnlyPort, "caller" | "database">;
  database: { roleDirectorySql: string; session: FirstOpenReadSession };
  expectedSeed: FirstOpenInspectSeed;
  expectedSeedSha256: string;
}, now: () => number = Date.now) {
  const approval = structuredClone(input.approval), seed = structuredClone(input.expectedSeed);
  pairFirstOpenApproval(input.wire, approval, input.approvalSha256);
  let used = false;
  return async (upstream: AbortSignal) => {
    if (used) return fail("INSPECT_ALREADY_USED");
    used = true;
    await checkSandboxFirstOpenApproval(approval, input.approvalSha256, now());
    const signal = AbortSignal.any([upstream, AbortSignal.timeout(approval.writeBefore - now())]);
    signal.throwIfAborted();
    const planned = await prepareFirstOpenInspectSeed(seed, input.expectedSeedSha256, approval, input.approvalSha256, signal);
    const caller = await input.identify(signal), issued = now();
    assertFirstOpenSession("inspector", caller, issued, approval.writeBefore);
    if (issued >= approval.controlledWindow!.claimBefore) return fail("INSPECT_SCOPE");
    const raw = input.readOnly;
    const observeDatabase = firstOpenIndependentDatabase(input.approvalSha256, input.database.roleDirectorySql, input.database.session);
    const databaseState: { observed?: Awaited<ReturnType<typeof observeDatabase>> } = {};
    const independent = firstOnboardingReadOnlyBoundary({ caller: async () => caller,
      read: (...args) => raw.read(...args), getTechnical: (...args) => raw.getTechnical(...args),
      async database(x) {
        x.signal.throwIfAborted();
        const db = databaseState.observed;
        if (!db || x.databaseName !== db.name || x.roleName !== db.roleName) return fail("INSPECT_DATABASE_UNPROVED");
        return structuredClone(db);
      },
    }, scope.inspectorRole, now, approval.writeBefore);
    await independent.checkIdentity(signal);
    await input.wire.emit("01-inspector-ready", { inspectorRoleId: caller.roleId, inspectorSessionArnSha256: await sha256Hex(caller.arn),
      credentialExpiresAtUtc: iso(caller.credentialExpiresAt), verifiedAtUtc: iso(issued) }, signal);
    const request = await input.wire.take("02-g1-check-request", signal);
    // Exact fixed name, not a caller-supplied ARN or Secret value.
    const observed = await independent.secret(scope.secretName, signal), arn = observed.ARN ?? "";
    assertInitialSecretVersion(observed, arn, planned.versionId);
    const expected = await secretProjection({ arn, versionId: planned.versionId, externalFence: planned.epoch }, signal);
    if (!fieldsMatch(request.payload, expected)) return fail("G1_REQUEST");
    await input.wire.emit("02-g1-metadata-observed", { ...expected, requestBodySha256: request.bodySha256,
      observedAtUtc: iso(now()), onlyCurrentVersionVerified: true, notDeletingOrRotatingVerified: true }, signal);
    const intent = await input.wire.take("03-runtime-check-request", signal);
    const stackId = await independent.createdStackId(SANDBOX_FIRST_OPEN_STACK, signal);
    const db = await observeDatabase({ databaseName: scope.tenantDatabase, roleName: scope.tenantRole, signal });
    databaseState.observed = db;
    const { tlsVerified, transactionReadOnly, ...databaseIdentity } = db;
    if (!tlsVerified || !transactionReadOnly) return fail("INSPECT_DATABASE_UNPROVED");
    const x = await planned.assemble({ stackId, arn, identity: databaseIdentity }, signal);
    const projection = await runtimeProjection(x, approval.taskRelease);
    if (!fieldsMatch(intent.payload, projection)) return fail("RUNTIME_REQUEST");
    const completion = x.completion!;
    const reader = independent.runtimeReader({ material: () => x.material, release: completion.release, review: completion.review,
      clientApiVersion: completion.approved.clientApiVersion, mediaPublicBaseUrl: approval.express!.mediaPublicBaseUrl,
      applicationRoleArn: approval.express!.applicationRoleArn });
    const checked = await verifyFirstOnboardingRuntime({ ...x, reader, now });
    if (!checked.initialBindingText) return fail("INSPECT_BINDING");
    const { configurationAckSha256: _local, ...scopeProjection } = projection;
    void _local;
    await input.wire.emit("03-runtime-observed", { ...scopeProjection, requestBodySha256: intent.bodySha256,
      runtimeTemplateSha256: checked.runtime.templateSha256, runtimeConfigurationSha256: checked.runtime.configurationSha256,
      runtimeObservationSha256: await offlineRuntimeObservationSha(checked.runtime),
      initialBindingSha256: await sha256Hex(checked.initialBindingText), releaseId: completion.release.id, observedAtUtc: iso(checked.runtime.observedAt) }, signal);
    await input.wire.keepInspectorAvailable(signal);
  };
}
