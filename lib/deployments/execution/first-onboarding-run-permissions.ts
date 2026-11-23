import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { FIRST_OPEN_MANAGEMENT_SQL_USER } from "./aurora-express-bootstrap-v3.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "./first-onboarding-run-once.ts";

const stack = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/*`;
const secret = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-`;
const connect = (user: string) => `arn:aws:rds-db:${s.region}:${s.account}:dbuser:${s.clusterId}/${user}`;
const allow = (Action: string, Resource: string | string[], StringEquals?: Record<string, string>) => ({
  Effect: "Allow" as const, Action, Resource, ...(StringEquals ? { Condition: { StringEquals } } : {}),
});
const policy = (...Statement: ReturnType<typeof allow>[]) => ({ Version: "2012-10-17", Statement });
const pinnedSecret = (arn: string, version: string) =>
  allow("secretsmanager:GetSecretValue", arn, { "secretsmanager:VersionId": version });

/** Draft only: the g1 name is exact, the six generated suffix characters are
 * not yet known. Authority still depends on independently verified IAM. */
export function sandboxFirstOpenPlannedSecretGrant(versionId: string) {
  if (!/^[a-f0-9]{64}$/.test(versionId)) throw Error("FIRST_OPEN_POLICY_SECRET_VERSION");
  return pinnedSecret(secret + "??????", versionId);
}

/** The shared ECS role can already match g1 through a legacy Allow. Scope
 * these explicit denies to g1 only; leave existing tenants' reads unchanged. */
export function sandboxFirstOpenPlannedSecretVersionGuard(versionId: string) {
  const { Action, Resource } = sandboxFirstOpenPlannedSecretGrant(versionId);
  const version = "secretsmanager:VersionId";
  return [
    { Effect: "Deny" as const, Action, Resource, Condition: { Null: { [version]: "true" } } },
    { Effect: "Deny" as const, Action, Resource, Condition: { Null: { [version]: "false" }, StringNotEquals: { [version]: versionId } } },
  ];
}

/** Draft fragments only, for exact principals/roles; not trust, installation,
 * or proof that existing identity/boundary policies are already this narrow. */
export function sandboxFirstOpenPolicyDrafts(input: {
  archiveVersionId: string; manifestVersionId: string;
  // Only supply this from the independently verified g1 ACK; never guess it.
  runtimeSecret?: { arn: string; versionId: string };
  plannedRuntimeSecretVersionId?: string;
}) {
  const { archiveVersionId, manifestVersionId, runtimeSecret, plannedRuntimeSecretVersionId } = input;
  const { bucket: baselineBucket, objects } = FIRST_OPEN_BASELINE_BINDING;
  if (archiveVersionId !== objects.archive.versionId || manifestVersionId !== objects.manifest.versionId) {
    throw Error("FIRST_OPEN_POLICY_BASELINE_VERSION");
  }
  if (runtimeSecret && (!runtimeSecret.arn.startsWith(secret) || !/^[a-zA-Z0-9]{6}$/.test(runtimeSecret.arn.slice(secret.length)) ||
    !/^[a-f0-9]{64}$/.test(runtimeSecret.versionId))) throw Error("FIRST_OPEN_POLICY_SECRET_VERSION");
  if (runtimeSecret && plannedRuntimeSecretVersionId !== undefined) throw Error("FIRST_OPEN_POLICY_SECRET_SCOPE_AMBIGUOUS");
  const planned = plannedRuntimeSecretVersionId === undefined ? [] : [sandboxFirstOpenPlannedSecretGrant(plannedRuntimeSecretVersionId)];
  const imageRepo = `arn:aws:ecr:${s.region}:${s.account}:repository/techlong-sandbox-speedfeast`;
  const logStream = `arn:aws:logs:${s.region}:${s.account}:log-group:/saas/cell-sandbox-1/tenant-${s.instanceId.slice(-16)}:log-stream:*`;
  const execution = policy(
    // Authentication itself has no per-repository resource; the pulls below do.
    allow("ecr:GetAuthorizationToken", "*", { "aws:RequestedRegion": s.region }),
    ...["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"].map(action => allow(action, imageRepo)),
    allow("logs:CreateLogStream", logStream), allow("logs:PutLogEvents", logStream),
    pinnedSecret(s.controlArn, s.controlVersion),
    ...(runtimeSecret ? [pinnedSecret(runtimeSecret.arn, runtimeSecret.versionId)] : []),
    ...planned,
  );
  const versionGuard = plannedRuntimeSecretVersionId === undefined ? [] : sandboxFirstOpenPlannedSecretVersionGuard(plannedRuntimeSecretVersionId);
  return {
    submitter: policy(
      allow("cloudformation:DescribeStacks", stack),
      allow("cloudformation:CreateStack", stack, { "cloudformation:RoleArn": s.cfnRole, "aws:RequestTag/AppInstanceId": s.instanceId,
        "aws:RequestTag/DeploymentId": s.deploymentId, "aws:RequestTag/ResourceGeneration": "1" }),
      allow("iam:PassRole", s.cfnRole, { "iam:PassedToService": "cloudformation.amazonaws.com" }),
    ),
    cfnPassEcsRoles: policy(allow("iam:PassRole", [s.executionRole, s.applicationRole], { "iam:PassedToService": "ecs-tasks.amazonaws.com" })),
    secretSupplier: policy(allow("secretsmanager:CreateSecret", secret + "??????", {
      "aws:RequestTag/AppInstanceId": s.instanceId, "aws:RequestTag/DeploymentId": s.deploymentId, "aws:RequestTag/ResourceGeneration": "1",
    })),
    lifecycle: policy(allow("rds-db:connect", connect(FIRST_OPEN_MANAGEMENT_SQL_USER)),
      ...Object.values(objects).map(({ key, versionId }) =>
        allow("s3:GetObjectVersion", `arn:aws:s3:::${baselineBucket}/${key}`, { "s3:VersionId": versionId })),
    ),
    application: policy(allow("rds-db:connect", connect(s.tenantRole)), allow("s3:PutObject", `arn:aws:s3:::${s.bucket}/products/*`)),
    execution: { ...execution, Statement: [...execution.Statement, ...versionGuard] },
    // A planned grant is not proof of an effective grant or a known ARN.
    // Actual listeners, trust, inspector scope and KMS/rollback still require review.
    runtimeSecretReadPending: !runtimeSecret,
  };
}
