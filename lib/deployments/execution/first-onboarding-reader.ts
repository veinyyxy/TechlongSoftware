import type { InstanceBinding, SoftwareRelease } from "../releases/contract.ts";
import { sampleInstanceRelease, type ReleaseMetadataApi } from "../releases/sampling.ts";
import type { FirstOnboardingReview } from "../first-onboarding.ts";
import { canonicalJson } from "./hash.ts";
import type { FirstOnboardingRuntimeReader } from "./first-onboarding-inspection.ts";
import { assertInitialSecretVersion, type FirstOnboardingDatabaseIdentity, type FirstOnboardingExpressComposition } from "./first-onboarding-express.ts";

export interface FirstOnboardingReadOnlyPort extends ReleaseMetadataApi {
  caller(signal: AbortSignal): Promise<{ accountId: string; arn: string }>;
  database(input: { databaseName: string; roleName: string; signal: AbortSignal }):
    Promise<FirstOnboardingDatabaseIdentity & { tlsVerified: true; transactionReadOnly: true }>;
}

const allowed = new Set([
  "cloudformation:describe-stacks", "cloudformation:get-template", "cloudformation:list-stack-resources", "cloudformation:list-change-sets",
  "rds:describe-db-clusters", "ecs:describe-services", "ecs:describe-task-definition", "ecs:list-tasks", "ecs:describe-tasks",
  "elbv2:describe-listeners", "elbv2:describe-load-balancers", "elbv2:describe-target-groups", "elbv2:describe-target-health", "elbv2:describe-rules",
  "route53:list-resource-record-sets", "secretsmanager:describe-secret", "s3api:head-bucket", "ecr:batch-get-image",
]);

/** Injected, read-only transport. No role assumption or credential/Secret reading is provided. */
export function firstOnboardingReadOnlyBoundary(api: FirstOnboardingReadOnlyPort, expectedRole: string, now: () => number, deadline: number) {
  let checkedArn: string | undefined, reads = 0;
  const checkWindow = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (now() >= deadline) throw Error("FIRST_ONBOARDING_WINDOW_CLOSED");
  };
  const checkIdentity = async (signal: AbortSignal) => {
    checkWindow(signal);
    const identity = await api.caller(signal);
    checkWindow(signal);
    const expected = "arn:aws:sts::402010193138:assumed-role/TechlongSandboxFirstOpenInspector/";
    if (expectedRole !== "arn:aws:iam::402010193138:role/TechlongSandboxFirstOpenInspector" ||
      identity.accountId !== "402010193138" || !identity.arn.startsWith(expected) ||
      !/^[A-Za-z0-9_+=,.@-]{2,64}$/.test(identity.arn.slice(expected.length)) || (checkedArn && identity.arn !== checkedArn)) {
      throw Error("FIRST_ONBOARDING_INDEPENDENT_ROLE_REQUIRED");
    }
    checkedArn = identity.arn;
  };
  async function read<T>(signal: AbortSignal, service: string, op: string, parameters: Record<string, unknown>) {
    checkWindow(signal);
    if (!checkedArn || !allowed.has(service + ":" + op) || ++reads > 24) throw Error("FIRST_ONBOARDING_INDEPENDENT_READ_OUT_OF_SCOPE");
    const result = await api.read<T>(service, op, parameters);
    checkWindow(signal);
    return result;
  }
  return {
    checkIdentity,
    async secret(arn: string, signal: AbortSignal) {
      await checkIdentity(signal);
      return read<{ ARN?: string; DeletedDate?: unknown; RotationEnabled?: boolean;
        VersionIdsToStages?: Record<string, string[]> }>(signal, "secretsmanager", "describe-secret", { SecretId: arn });
    },
    runtimeReader(input: { material: FirstOnboardingExpressComposition["material"]; release: SoftwareRelease;
      review: FirstOnboardingReview; clientApiVersion: string; mediaPublicBaseUrl: string; applicationRoleArn: string }): FirstOnboardingRuntimeReader {
      let captured = false;
      return { async capture({ stackId, hostname, databaseName, signal }) {
        await checkIdentity(signal);
        const { identity, sampling } = input.material(), scope = input.review.payload.scope;
        if (captured || hostname !== sampling.apiHostname || databaseName !== identity.name) throw Error("FIRST_ONBOARDING_INDEPENDENT_SCOPE_CHANGED");
        captured = true;
        const { release } = input;
        const binding: InstanceBinding & { sampling: typeof sampling } = {
          instanceId: scope.appInstanceId, workspaceId: scope.workspaceId, productId: scope.productId, environmentId: scope.environmentId,
          accountId: scope.accountId, region: "ca-central-1", stackId, initialized: false, status: "pending", sourceRepository: release.source.repository,
          imageRepository: release.image.repository, runtimePlatform: "linux/amd64", applicationPort: 3000, clientApiVersion: input.clientApiVersion,
          desiredCount: 1, templateSha256: "", configurationSha256: "", stateRevision: 0, currentRelease: null, sampling,
        };
        const origin = "https://" + hostname;
        let dnsTarget: string | undefined;
        const scoped: ReleaseMetadataApi = {
          async read<T>(service: string, op: string, parameters: Record<string, unknown>) {
            const result = await read<T>(signal, service, op, parameters);
            const runtimeSecret = sampling.secrets[1];
            if (service === "secretsmanager" && op === "describe-secret" && parameters.SecretId === runtimeSecret.arn) {
              assertInitialSecretVersion(result as Parameters<typeof assertInitialSecretVersion>[0], runtimeSecret.arn, runtimeSecret.versionId);
            }
            if (service === "route53" && op === "list-resource-record-sets") {
              const dns = result as { ResourceRecordSets?: { AliasTarget?: { DNSName?: string } }[] };
              dnsTarget = dns.ResourceRecordSets?.[0]?.AliasTarget?.DNSName?.replace(/\.$/, "");
            }
            return result;
          },
          async getTechnical(path, target) {
            checkWindow(signal);
            if (target !== origin || (path !== "/health" && path !== "/ready")) throw Error("FIRST_ONBOARDING_HTTP_SCOPE_CHANGED");
            const result = await api.getTechnical(path, target);
            checkWindow(signal);
            return result;
          },
        };
        const facts = await sampleInstanceRelease(binding, release, scoped, now);
        const app = facts.taskDefinition.containerDefinitions?.find(c => c.name === "speedfeast-backend");
        const matchesEnv = (name: string, value: string) => app?.environment?.filter(e => e.name === name).length === 1 &&
          app.environment.some(e => e.name === name && e.value === value);
        if (!dnsTarget || !facts.persistentUploadsReady || facts.taskDefinition.taskRoleArn !== input.applicationRoleArn ||
          facts.taskDefinition.executionRoleArn !== facts.parameters.TaskExecutionRoleArn ||
          !matchesEnv("IMAGE_PUBLIC_BASE_URL", input.mediaPublicBaseUrl) || !matchesEnv("ALLOW_EPHEMERAL_IMAGE_STORAGE", "false")) {
          throw Error("FIRST_ONBOARDING_INDEPENDENT_WORKLOAD_CHANGED");
        }
        const { tlsVerified, transactionReadOnly, ...database } = await api.database({ databaseName, roleName: identity.roleName, signal });
        checkWindow(signal);
        if (!tlsVerified || !transactionReadOnly || canonicalJson(database) !== canonicalJson(identity)) {
          throw Error("FIRST_ONBOARDING_INDEPENDENT_DATABASE_CHANGED");
        }
        for (const path of ["/health", "/ready"] as const) facts.checks.push({ path, ...await scoped.getTechnical(path, origin) });
        facts.observedAt = now();
        return { facts, sampling, dns: { hostname, target: dnsTarget }, database };
      } };
    },
  };
}
