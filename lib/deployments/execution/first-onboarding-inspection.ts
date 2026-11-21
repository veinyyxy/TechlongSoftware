import type { DeploymentExecutionContext } from "./contracts.ts";
import type { WorkerTenantStack } from "./single-tenant-workload-strategy.ts";
import { canonicalJson } from "./hash.ts";
import { assertFirstOnboardingTechnicalRuntime, assertReleaseArtifact, releaseRuntimeDigests, type ReleaseRuntimeFacts } from "../releases/inspection.ts";
import { buildFirstOnboardingBinding } from "./first-onboarding-completion.ts";
import type { ReleaseSamplingBinding } from "../releases/sampling.ts";
import type { FirstOnboardingExpressComposition } from "./first-onboarding-express.ts";
import type { TenantExternalOperationFence } from "./contracts.ts";

/** In an approved live composition this must be a separate read-only reader,
 * not the executor or its cached CreateStack response. No live reader is wired. */
export interface FirstOnboardingRuntimeReader {
  capture(input: { stackId: string; hostname: string; databaseName: string; signal: AbortSignal }): Promise<{
    facts: ReleaseRuntimeFacts;
    dns: { hostname: string; target: string };
    database: { name: string; roleName: string; ownershipMarker: string; baselineDigest: string };
    /** Only supplied by a reviewed independent D2-compatible reader. */
    sampling?: ReleaseSamplingBinding;
  }>;
}

/** Exact first-open only. A receipt is never returned as raw provider facts. */
export interface FirstOnboardingIndependentHandoff {
  checkIdentity(signal: AbortSignal): Promise<void>;
  verifyInitialSecret(ack: { arn: string; versionId: string; externalFence: TenantExternalOperationFence }, signal: AbortSignal): Promise<void>;
  verifyRuntime(input: Omit<Parameters<typeof verifyFirstOnboardingRuntime>[0], "reader" | "now"> & {
    material: ReturnType<FirstOnboardingExpressComposition["material"]>;
  }): ReturnType<typeof verifyFirstOnboardingRuntime>;
}

export async function verifyFirstOnboardingRuntime(input: {
  context: Pick<DeploymentExecutionContext, "tenantExternalOperation"> & {
    tenantResources?: Pick<NonNullable<DeploymentExecutionContext["tenantResources"]>,
      "identity" | "ownershipMarker" | "generation" | "lifecycleStatus" | "baselineDigest"> | null;
    appInstance: Pick<DeploymentExecutionContext["appInstance"], "id">;
    deployment: Pick<DeploymentExecutionContext["deployment"], "id" | "artifactRef" | "configurationHash">;
  }; stack: WorkerTenantStack; stackId: string; dnsTarget: string; databaseSchemaVersion: string;
  baselineDigest: string; platformDigest: string; reader: FirstOnboardingRuntimeReader; now: () => number; signal: AbortSignal;
  completion?: Pick<Parameters<typeof buildFirstOnboardingBinding>[0], "approved" | "review" | "release">;
}) {
  const { context, stack, stackId, reader, signal, now } = input;
  const hostname = stack.parameters.TenantHostname;
  const resource = context.tenantResources;
  if (!("protocol" in stack) || !resource || resource.generation !== 1 ||
    resource.lifecycleStatus !== "verified" || resource.baselineDigest !== input.baselineDigest ||
    !stackId.startsWith(`arn:aws:cloudformation:${stack.region}:${stack.accountId}:stack/${stack.stackName}/`)) {
    throw Error("FIRST_ONBOARDING_INSPECTION_SCOPE_MISMATCH");
  }
  const startedAt = now();
  const { facts, dns, database, sampling } = await reader.capture({ stackId, hostname, databaseName: resource.identity.databaseName, signal });
  signal.throwIfAborted();
  const normalize = (parameters: Record<string, string>) => ({ ...parameters,
    SubnetIds: parameters.SubnetIds?.split(",").map(x => x.trim()).sort().join(",") });
  if (dns.hostname !== hostname || dns.target !== input.dnsTarget ||
    database.name !== resource.identity.databaseName || database.roleName !== resource.identity.roleName ||
    database.ownershipMarker !== resource.ownershipMarker || database.baselineDigest !== input.baselineDigest ||
    facts.stackStatus !== "CREATE_COMPLETE" || facts.roleArn !== stack.cloudFormationRoleArn || facts.openChangeSetIds.length !== 0 ||
    Object.entries(stack.tags).some(([key, value]) => facts.tags[key] !== value) ||
    canonicalJson(normalize(facts.parameters)) !== canonicalJson(normalize(stack.parameters)) ||
    Object.values(facts.resources).some(r => !r.physicalId)) throw Error("FIRST_ONBOARDING_INSPECTION_BINDING_MISMATCH");
  const image = { imageUri: context.deployment.artifactRef, platformDigest: input.platformDigest };
  await assertReleaseArtifact(image, facts);
  const { configurationSha256 } = await releaseRuntimeDigests(facts);
  // The first-open technical check can report ephemeral storage truthfully.
  // The ordinary D2 verifier still requires persistent uploads by default.
  const runtime = await assertFirstOnboardingTechnicalRuntime({ selection: { instanceId: context.appInstance.id }, changeSet: { StackName: stackId },
    templateSha256: stack.templateSha256, configurationSha256, desiredCount: 1, image,
    compatibility: { databaseProfile: "express_iam", databaseSchemaVersion: input.databaseSchemaVersion, applicationPort: 3000 },
  }, facts, startedAt, now());
  return { runtime, initialBindingText: input.completion
    ? await buildFirstOnboardingBinding({ ...input.completion, runtime, facts, sampling, hostname })
    : undefined };
}
