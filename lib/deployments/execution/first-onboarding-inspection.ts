import type { DeploymentExecutionContext } from "./contracts.ts";
import type { WorkerTenantStack } from "./single-tenant-workload-strategy.ts";
import { canonicalJson } from "./hash.ts";
import { assertFirstOnboardingTechnicalRuntime, assertReleaseArtifact, releaseRuntimeDigests, type ReleaseRuntimeFacts } from "../releases/inspection.ts";

/** In an approved live composition this must be a separate read-only reader,
 * not the executor or its cached CreateStack response. No live reader is wired. */
export interface FirstOnboardingRuntimeReader {
  capture(input: { stackId: string; hostname: string; databaseName: string; signal: AbortSignal }): Promise<{
    facts: ReleaseRuntimeFacts;
    dns: { hostname: string; target: string };
    database: { name: string; roleName: string; ownershipMarker: string; baselineDigest: string };
  }>;
}

export async function verifyFirstOnboardingRuntime(input: {
  context: DeploymentExecutionContext; stack: WorkerTenantStack; stackId: string; dnsTarget: string; databaseSchemaVersion: string;
  baselineDigest: string; platformDigest: string; reader: FirstOnboardingRuntimeReader; now: () => number; signal: AbortSignal;
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
  const { facts, dns, database } = await reader.capture({ stackId, hostname, databaseName: resource.identity.databaseName, signal });
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
  return assertFirstOnboardingTechnicalRuntime({ selection: { instanceId: context.appInstance.id }, changeSet: { StackName: stackId },
    templateSha256: stack.templateSha256, configurationSha256, desiredCount: 1, image,
    compatibility: { databaseProfile: "express_iam", databaseSchemaVersion: input.databaseSchemaVersion, applicationPort: 3000 },
  }, facts, startedAt, now());
}
