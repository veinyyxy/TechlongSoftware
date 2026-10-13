import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { CloudFormationClient, DescribeStacksCommand, DescribeTypeCommand } from "@aws-sdk/client-cloudformation";
import { IAMClient, GetRoleCommand, GetPolicyCommand } from "@aws-sdk/client-iam";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

const output = process.argv[2]?.replaceAll("\\", "/");
if (process.argv.length !== 3 || !/^F:\/ChatGPT_workshop\/techlong-d001-[A-Za-z0-9._-]+\.json$/.test(output ?? "")) throw Error("Exact new private output path required");
const digest = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const config = { region: "ca-central-1", credentials: defaultProvider({ profile: "techlong-sandbox-user" }), maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const clients = { cfn: new CloudFormationClient(config), iam: new IAMClient(config), sts: new STSClient(config) };
const signal = AbortSignal.timeout(55_000), options = { abortSignal: signal };
const types = ["AWS::EC2::VPC", "AWS::EC2::InternetGateway", "AWS::EC2::VPCGatewayAttachment", "AWS::EC2::Subnet",
  "AWS::EC2::RouteTable", "AWS::EC2::Route", "AWS::EC2::SubnetRouteTableAssociation", "AWS::EC2::SecurityGroup",
  "AWS::EC2::SecurityGroupIngress", "AWS::ECS::Cluster", "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::ElasticLoadBalancingV2::Listener", "AWS::ElasticLoadBalancingV2::ListenerRule", "AWS::RDS::DBSubnetGroup",
  "AWS::Logs::LogGroup", "AWS::RDS::DBCluster", "AWS::RDS::DBInstance"];
try {
  const identity = await clients.sts.send(new GetCallerIdentityCommand({}), options);
  if (identity.Account !== "402010193138" || identity.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || identity.UserId !== "AIDAV3GNMXTZEO7SHLC2X") throw Error("Exact Source identity required");
  const observedAt = new Date().toISOString();
  const roleNames = ["TechlongSandboxFirstAcceptanceCellExecutionRole", "AWSServiceRoleForRDS", "AWSServiceRoleForECS", "AWSServiceRoleForElasticLoadBalancing"];
  const roleResults = await Promise.all(roleNames.map(async RoleName => {
    try { const r = await clients.iam.send(new GetRoleCommand({ RoleName }), options);
      return { RoleName, exists: true, arn: r.Role?.Arn, roleId: r.Role?.RoleId, boundary: r.Role?.PermissionsBoundary?.PermissionsBoundaryArn ?? null };
    } catch (e) { if (e.name === "NoSuchEntityException") return { RoleName, exists: false }; return { RoleName, errorCode: e.name }; }
  }));
  let boundary;
  try { const r = await clients.iam.send(new GetPolicyCommand({ PolicyArn: "arn:aws:iam::402010193138:policy/TechlongSandboxFirstAcceptanceCellExecutionBoundary" }), options); boundary = { exists: true, arn: r.Policy?.Arn }; }
  catch (e) { boundary = e.name === "NoSuchEntityException" ? { exists: false } : { errorCode: e.name }; }
  let cell;
  try { const r = await clients.cfn.send(new DescribeStacksCommand({ StackName: "techlong-sandbox-cell-sandbox-1" }), options); cell = { exists: true, ids: r.Stacks?.map(s => s.StackId), statuses: r.Stacks?.map(s => s.StackStatus) }; }
  catch (e) { cell = e.name === "ValidationError" && e.message === "Stack with id techlong-sandbox-cell-sandbox-1 does not exist" ? { exists: false } : { errorCode: e.name }; }
  const requirements = [];
  for (let start = 0; start < types.length; start += 4) requirements.push(...await Promise.all(types.slice(start, start + 4).map(async TypeName => {
    try {
      const r = await clients.cfn.send(new DescribeTypeCommand({ Type: "RESOURCE", TypeName }), options), schema = JSON.parse(r.Schema ?? "null");
      if (schema?.typeName !== TypeName || !schema.handlers) throw Error("SCHEMA_TYPE_OR_HANDLERS_INVALID");
      const handlers = Object.fromEntries(["create", "read", "delete"].map(h => [h, schema.handlers[h]?.permissions ?? null]));
      return { TypeName, typeArn: r.Arn, schemaSha256: digest(r.Schema), documentationUrl: r.DocumentationUrl, handlers };
    } catch (e) { return { TypeName, errorCode: e.name === "Error" ? e.message : e.name }; }
  })));
  const result = { schemaVersion: 1, mode: "READ_ONLY_REQUIREMENTS_NOT_IAM_POLICY", observedAt, completedAt: new Date().toISOString(),
    source: { account: identity.Account, arn: identity.Arn, userId: identity.UserId }, roleResults, boundary, cell,
    requirements, writeCalls: 0, secretValueReads: 0, deploymentAuthorized: false, installablePolicyPrepared: false };
  const body = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(output, body, { flag: "wx", encoding: "utf8" });
  process.stdout.write(`${JSON.stringify({ output, fileSha256: digest(body), observedAt, roleResults, boundary, cell,
    resourceTypesRead: requirements.filter(r => !r.errorCode).length, errors: requirements.filter(r => r.errorCode), writeCalls: 0 })}\n`);
} finally { Object.values(clients).forEach(c => c.destroy()); }
