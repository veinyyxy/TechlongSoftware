import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IAMClient, GetRoleCommand, GetPolicyCommand, GetPolicyVersionCommand, GetRolePolicyCommand,
  ListRolePoliciesCommand, ListAttachedRolePoliciesCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { compileAcceptanceCellIam, ACCEPTANCE_CELL_IAM as t } from "../../../lib/deployments/execution/single-tenant-cell-iam.ts";
import { ACCEPTANCE_CONTROL_INPUTS } from "../../../lib/deployments/execution/single-tenant-private-sources.ts";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";

export const CELL_PUBLIC_KEY_SECRET = ACCEPTANCE_CONTROL_INPUTS.publicKeySecretName;
export const CELL_PUBLIC_KEY_TAGS = Object.freeze({ Environment: "aws-sandbox", ManagedBy: "techlong-provisioner",
  DeliveryTrack: "single-tenant-acceptance", SecretSchema: "techlong-rs256-public-key-v1" });
const exec = promisify(execFile);
const decode = (s?: string) => { if (!s) throw Error("CELL_FOUNDATION_POLICY_MISSING"); try { return JSON.parse(s); } catch { return JSON.parse(decodeURIComponent(s)); } };
const sorted = (tags?: { Key?: string; Value?: string }[]) => [...tags ?? []].sort((a, b) => (a.Key ?? "").localeCompare(b.Key ?? ""));

/** Actual read-only Source collection, used both before review and at runtime.
 * Simulations are namespace/context preflight, NOT provider execution proof.
 * No Secret values, Neon writes, IAM edits or resource creation here.
 */
export async function readCellFoundationFacts(tags: Record<string, string>, signal: AbortSignal) {
  const config = { region: t.region, credentials: defaultProvider({ profile: "techlong-sandbox-user" }), maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const iam = new IAMClient(config), sts = new STSClient(config), cfn = new CloudFormationClient(config);
  const opt = { abortSignal: signal };
  const cli = async (args: string[]) => {
    signal.throwIfAborted();
    const r = await exec("aws", [...args, "--profile", "techlong-sandbox-user", "--region", t.region, "--output", "json", "--no-cli-pager"], {
      timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal,
      env: { ...process.env, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true" } });
    return JSON.parse(r.stdout);
  };
  try {
    const who = await sts.send(new GetCallerIdentityCommand({}), opt);
    if (who.Account !== t.account || who.Arn !== t.sourceArn || who.UserId !== t.sourceUserId) throw Error("CELL_FOUNDATION_SOURCE_REJECTED");
    const [role, policy, version, inline, names, attached, rdsKey, secretKey] = await Promise.all([
      iam.send(new GetRoleCommand({ RoleName: t.roleName }), opt), iam.send(new GetPolicyCommand({ PolicyArn: t.boundaryArn }), opt),
      iam.send(new GetPolicyVersionCommand({ PolicyArn: t.boundaryArn, VersionId: "v1" }), opt),
      iam.send(new GetRolePolicyCommand({ RoleName: t.roleName, PolicyName: "FirstAcceptanceCellResourcesV1" }), opt),
      iam.send(new ListRolePoliciesCommand({ RoleName: t.roleName }), opt), iam.send(new ListAttachedRolePoliciesCommand({ RoleName: t.roleName }), opt),
      cli(["kms", "describe-key", "--key-id", "alias/aws/rds"]), cli(["kms", "describe-key", "--key-id", "alias/aws/secretsmanager"]),
    ]);
    const expected = await compileAcceptanceCellIam({ rdsKmsKeyArn: rdsKey.KeyMetadata.Arn, secretsKmsKeyArn: secretKey.KeyMetadata.Arn });
    const roleChecks = { roleId: role.Role?.RoleId === "AROAV3GNMXTZESNMKM56K", policyId: policy.Policy?.PolicyId === "ANPAV3GNMXTZL4VMJHXXZ",
      boundary: role.Role?.PermissionsBoundary?.PermissionsBoundaryArn === t.boundaryArn && policy.Policy?.DefaultVersionId === "v1",
      trust: canonicalJson(decode(role.Role?.AssumeRolePolicyDocument)) === canonicalJson(expected.trustDocument),
      tags: canonicalJson(sorted(role.Role?.Tags)) === canonicalJson(sorted(expected.tags)), session: role.Role?.MaxSessionDuration === 3600,
      identityPolicy: canonicalJson(decode(inline.PolicyDocument)) === canonicalJson(expected.policyDocument),
      boundaryPolicy: canonicalJson(decode(version.PolicyVersion?.Document)) === canonicalJson(expected.boundaryDocument),
      exactInline: !names.IsTruncated && canonicalJson(names.PolicyNames) === canonicalJson([expected.inlinePolicyName]),
      noAttached: !attached.IsTruncated && attached.AttachedPolicies?.length === 0 };
    let cellAbsent = false, secretAbsent = false;
    try { await cfn.send(new DescribeStacksCommand({ StackName: t.cellName }), opt); }
    catch (e) { if (e instanceof Error && e.name === "ValidationError" && e.message === `Stack with id ${t.cellName} does not exist`) cellAbsent = true; else throw e; }
    // A missing result is accepted only for the named API's exact not-found
    // class, never access denied, timeout or an empty successful response.
    try { await cli(["secretsmanager", "describe-secret", "--secret-id", CELL_PUBLIC_KEY_SECRET]); }
    catch (e) { if (e && typeof e === "object" && "stderr" in e && /\(ResourceNotFoundException\) when calling the DescribeSecret operation/.test(String(e.stderr))) secretAbsent = true; else throw e; }
    const [db, writer, cluster, alb, logs, certificate, truststore, engine, az] = await Promise.all([
      cli(["rds", "describe-db-clusters"]), cli(["rds", "describe-db-instances"]),
      cli(["ecs", "describe-clusters", "--clusters", "cell-sandbox-1"]), cli(["elbv2", "describe-load-balancers"]),
      cli(["logs", "describe-log-groups", "--log-group-name-prefix", `/aws/rds/cluster/${t.cellName}/postgresql`]),
      cli(["acm", "describe-certificate", "--certificate-arn", "arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d"]),
      cli(["elbv2", "describe-trust-stores", "--trust-store-arns", "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44"]),
      cli(["rds", "describe-db-engine-versions", "--engine", "aurora-postgresql", "--engine-version", "16.14"]),
      cli(["ec2", "describe-availability-zones", "--zone-names", "ca-central-1a", "ca-central-1b"]),
    ]);
    const collisionChecks = { cellStackAbsent: cellAbsent, publicKeySecretAbsent: secretAbsent,
      rdsClusterAbsent: !(db.DBClusters ?? []).some((d: { DBClusterIdentifier: string }) => d.DBClusterIdentifier === t.cellName),
      writerAbsent: !(writer.DBInstances ?? []).some((d: { DBInstanceIdentifier: string }) => d.DBInstanceIdentifier === `${t.cellName}-writer`),
      ecsClusterAbsent: cluster.clusters?.length === 0 && cluster.failures?.length === 1 && cluster.failures[0].reason === "MISSING",
      albAbsent: !(alb.LoadBalancers ?? []).some((l: { LoadBalancerName: string }) => l.LoadBalancerName === t.cellName),
      databaseLogAbsent: !(logs.logGroups ?? []).some((l: { logGroupName: string }) => l.logGroupName === `/aws/rds/cluster/${t.cellName}/postgresql`) };
    const prerequisites = { certificateIssued: certificate.Certificate?.Status === "ISSUED" && certificate.Certificate.SubjectAlternativeNames?.includes("*.sandbox.techlong.cloud") &&
      Date.parse(certificate.Certificate.NotAfter) > Date.now() + 86400000,
      truststoreActive: truststore.TrustStores?.length === 1 && truststore.TrustStores[0].Status === "ACTIVE",
      engineAvailable: engine.DBEngineVersions?.length === 1 && engine.DBEngineVersions[0].EngineVersion === "16.14" && engine.DBEngineVersions[0].Status === "available" &&
        engine.DBEngineVersions[0].ServerlessV2FeaturesSupport?.MinCapacity === 0,
      twoAvailableZones: az.AvailabilityZones?.length === 2 && az.AvailabilityZones.every((z: { State: string }) => z.State === "available"),
      keysEnabledAwsManaged: [rdsKey, secretKey].every(k => k.KeyMetadata.KeyManager === "AWS" && k.KeyMetadata.Enabled === true) };
    const context = (entries: Record<string, string>) => Object.entries(entries).map(([ContextKeyName, value]) => ({ ContextKeyName, ContextKeyValues: [value], ContextKeyType: "string" as const }));
    const cases: { name: string; action: string; resource: string; contexts: Record<string, string> }[] = [
      { name: "createCell", action: "cloudformation:CreateStack", resource: `arn:aws:cloudformation:${t.region}:${t.account}:stack/${t.cellName}/*`,
        contexts: { "aws:RequestedRegion": t.region, "cloudformation:RoleArn": t.roleArn, ...Object.fromEntries(Object.entries(tags).map(([k, v]) => [`aws:RequestTag/${k}`, v])) } },
      { name: "deleteCellNamespace", action: "cloudformation:DeleteStack", resource: `arn:aws:cloudformation:${t.region}:${t.account}:stack/${t.cellName}/*`,
        contexts: { "aws:RequestedRegion": t.region, "cloudformation:RoleArn": t.roleArn, ...Object.fromEntries(Object.entries(tags).map(([k, v]) => [`aws:ResourceTag/${k}`, v])) } },
      { name: "passCellRole", action: "iam:PassRole", resource: t.roleArn, contexts: { "iam:PassedToService": "cloudformation.amazonaws.com", "aws:RequestedRegion": t.region } },
      { name: "createPublicKeySecret", action: "secretsmanager:CreateSecret", resource: `arn:aws:secretsmanager:${t.region}:${t.account}:secret:${CELL_PUBLIC_KEY_SECRET}-??????`,
        contexts: { "aws:RequestedRegion": t.region, "secretsmanager:Name": CELL_PUBLIC_KEY_SECRET, ...Object.fromEntries(Object.entries(CELL_PUBLIC_KEY_TAGS).map(([k, v]) => [`aws:RequestTag/${k}`, v])) } },
      { name: "tagPublicKeySecretAtCreate", action: "secretsmanager:TagResource", resource: `arn:aws:secretsmanager:${t.region}:${t.account}:secret:${CELL_PUBLIC_KEY_SECRET}-??????`,
        contexts: { "aws:RequestedRegion": t.region, ...Object.fromEntries(Object.entries(CELL_PUBLIC_KEY_TAGS).map(([k, v]) => [`aws:RequestTag/${k}`, v])) } },
    ];
    const simulations = await Promise.all(cases.map(async c => {
      const r = await iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: t.sourceArn, ActionNames: [c.action], ResourceArns: [c.resource], ContextEntries: context(c.contexts) }), opt);
      const rows = r.EvaluationResults;
      return { name: c.name, action: c.action, resourceNamespace: c.resource, allowed: rows?.length === 1 && rows[0].EvalDecision === "allowed" && !rows[0].MissingContextValues?.length,
        decision: rows?.[0]?.EvalDecision, missingContext: rows?.[0]?.MissingContextValues ?? [] };
    }));
    signal.throwIfAborted();
    return { observedAt: Date.now(), identity: { account: who.Account, arn: who.Arn, userId: who.UserId }, roleChecks, collisionChecks, prerequisites, simulations,
      roleId: role.Role?.RoleId, policyId: policy.Policy?.PolicyId, roleMaterialSha256: expected.materialSha256,
      defaultKeys: { rds: rdsKey.KeyMetadata.Arn, secrets: secretKey.KeyMetadata.Arn },
      checksPassed: [...Object.values(roleChecks), ...Object.values(collisionChecks), ...Object.values(prerequisites), ...simulations.map(s => s.allowed)].every(Boolean),
      simulationIsExecutionProof: false, awsWrites: 0, secretValueReads: 0 };
  } finally { iam.destroy(); sts.destroy(); cfn.destroy(); }
}
export type CellFoundationFacts = Awaited<ReturnType<typeof readCellFoundationFacts>>;
export async function cellFoundationFactsFingerprint(f: CellFoundationFacts) {
  return sha256Hex({ ...f, observedAt: 0 });
}
