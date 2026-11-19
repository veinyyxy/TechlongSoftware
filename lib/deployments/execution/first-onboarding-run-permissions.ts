import { FIRST_OPEN_BASELINE_BUCKET, FIRST_OPEN_BASELINE_OBJECTS, validFirstOpenVersionId } from "./first-onboarding-baseline-versions.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "./first-onboarding-run-once.ts";

const stack = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/*`;
const secret = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-`;
const connect = (user: string) => `arn:aws:rds-db:${s.region}:${s.account}:dbuser:${s.clusterId}/${user}`;
const allow = (Action: string, Resource: string | string[], StringEquals?: Record<string, string>) => ({
  Effect: "Allow" as const, Action, Resource, ...(StringEquals ? { Condition: { StringEquals } } : {}),
});
const policy = (...Statement: ReturnType<typeof allow>[]) => ({ Version: "2012-10-17", Statement });

/** Draft fragments only, for exact principals/roles; not trust, installation,
 * or proof that existing identity/boundary policies are already this narrow. */
export function sandboxFirstOpenPolicyDrafts(input: {
  archiveVersionId: string; manifestVersionId: string;
  // Only supply this from the independently verified g1 ACK; never guess it.
  runtimeSecret?: { arn: string; versionId: string };
}) {
  const { archiveVersionId, manifestVersionId, runtimeSecret } = input;
  if (![archiveVersionId, manifestVersionId].every(validFirstOpenVersionId)) throw Error("FIRST_OPEN_POLICY_BASELINE_VERSION");
  if (runtimeSecret && (!runtimeSecret.arn.startsWith(secret) || !/^[a-zA-Z0-9]{6}$/.test(runtimeSecret.arn.slice(secret.length)) ||
    !/^[a-f0-9]{64}$/.test(runtimeSecret.versionId))) throw Error("FIRST_OPEN_POLICY_SECRET_VERSION");
  const pinnedSecret = (arn: string, version: string) =>
    allow("secretsmanager:GetSecretValue", arn, { "secretsmanager:VersionId": version });
  const imageRepo = `arn:aws:ecr:${s.region}:${s.account}:repository/techlong-sandbox-speedfeast`;
  const logStream = `arn:aws:logs:${s.region}:${s.account}:log-group:/saas/cell-sandbox-1/tenant-${s.instanceId.slice(-16)}:log-stream:*`;
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
    lifecycle: policy(allow("rds-db:connect", connect("postgres")),
      ...([["archive", archiveVersionId], ["manifest", manifestVersionId]] as const).map(([kind, id]) =>
        allow("s3:GetObjectVersion", `arn:aws:s3:::${FIRST_OPEN_BASELINE_BUCKET}/${FIRST_OPEN_BASELINE_OBJECTS[kind].key}`, { "s3:VersionId": id })),
    ),
    application: policy(allow("rds-db:connect", connect(s.tenantRole)), allow("s3:PutObject", `arn:aws:s3:::${s.bucket}/products/*`)),
    execution: policy(
      // Authentication itself has no per-repository resource; the pulls below do.
      allow("ecr:GetAuthorizationToken", "*", { "aws:RequestedRegion": s.region }),
      ...["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"].map(action => allow(action, imageRepo)),
      allow("logs:CreateLogStream", logStream), allow("logs:PutLogEvents", logStream),
      pinnedSecret(s.controlArn, s.controlVersion),
      ...(runtimeSecret ? [pinnedSecret(runtimeSecret.arn, runtimeSecret.versionId)] : []),
    ),
    // This is not an installable full grant. The g1 version, actual listeners,
    // trust, inspector scope and any KMS/rollback rights still require review.
    runtimeSecretReadPending: !runtimeSecret,
  };
}
