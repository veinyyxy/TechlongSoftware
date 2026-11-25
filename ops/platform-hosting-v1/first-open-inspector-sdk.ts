import { lookup } from "node:dns/promises";
import { Agent, get } from "node:https";
import { isIPv4, type LookupFunction } from "node:net";
import { CloudFormationClient, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand, ListChangeSetsCommand } from "@aws-sdk/client-cloudformation";
import { ECRClient, BatchGetImageCommand } from "@aws-sdk/client-ecr";
import { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand, ListTasksCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { ElasticLoadBalancingV2Client, DescribeListenersCommand, DescribeLoadBalancersCommand, DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand, DescribeRulesCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { Route53Client, ListResourceRecordSetsCommand } from "@aws-sdk/client-route-53";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { FIRST_OPEN_TASK_REGION, type attestFirstOpenTask } from "./first-open-task-identity.ts";

type Credentials = Awaited<ReturnType<typeof attestFirstOpenTask>>["credentials"];
type RoleObservation = { Account?: string; Arn?: string };
export type InspectorRead = (service: string, operation: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

function isPrivateV4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

// VPC interface endpoints and the internal ALB must resolve to private IPs.
// The reviewed S3 gateway route is the exception: S3 DNS keeps public IPs.
function privateLookup(expected?: string): LookupFunction {
  return (hostname, options, callback) => {
    if (expected && hostname !== expected) {
      callback(Error("ECS_FIRST_OPEN_PRIVATE_DNS_SCOPE"), "");
      return;
    }
    void lookup(hostname, { all: true, family: 4 }).then(records => {
      if (!records.length || records.some(record => !isPrivateV4(record.address))) {
        callback(Error("ECS_FIRST_OPEN_PRIVATE_DNS_SCOPE"), "");
        return;
      }
      callback(null, options.all ? records : records[0].address, 4);
    }, () => callback(Error("ECS_FIRST_OPEN_PRIVATE_DNS_UNAVAILABLE"), ""));
  };
}

export function isFirstOpenRoute53Endpoint(value: string) {
  return /^https:\/\/vpce-[a-z0-9-]{9,95}\.route53\.us-east-1\.vpce\.amazonaws\.com$/.test(value);
}

export function createFirstOpenInspectorSdk(credentials: Credentials, route53Endpoint: string) {
  if (!isFirstOpenRoute53Endpoint(route53Endpoint) || typeof credentials !== "function") throw Error("ECS_FIRST_OPEN_INSPECTOR_SCOPE");
  const requestHandler = new NodeHttpHandler({ connectionTimeout: 4_000, requestTimeout: 7_000, throwOnRequestTimeout: true,
    httpsAgent: new Agent({ keepAlive: false, minVersion: "TLSv1.2", rejectUnauthorized: true, lookup: privateLookup() }) });
  const sdk = { region: FIRST_OPEN_TASK_REGION, maxAttempts: 1, credentials, requestHandler, useFipsEndpoint: false, useDualstackEndpoint: false };
  const host = (service: string) => `https://${service}.${FIRST_OPEN_TASK_REGION}.amazonaws.com`;
  const sts = new STSClient({ ...sdk, endpoint: host("sts") });
  const cfn = new CloudFormationClient({ ...sdk, endpoint: host("cloudformation") });
  const ecs = new ECSClient({ ...sdk, endpoint: host("ecs") });
  const ecRegistry = new ECRClient({ ...sdk, endpoint: host("api.ecr") });
  const loadBalancing = new ElasticLoadBalancingV2Client({ ...sdk, endpoint: host("elasticloadbalancing") });
  const rds = new RDSClient({ ...sdk, endpoint: host("rds") });
  const dns = new Route53Client({ ...sdk, region: "us-east-1", endpoint: route53Endpoint });
  const secrets = new SecretsManagerClient({ ...sdk, endpoint: host("secretsmanager") });
  const s3 = new S3Client({ ...sdk, endpoint: host("s3"), forcePathStyle: true, followRegionRedirects: false,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 4_000, requestTimeout: 7_000, throwOnRequestTimeout: true,
      httpsAgent: new Agent({ keepAlive: false, minVersion: "TLSv1.2", rejectUnauthorized: true }) }) });

  const read: InspectorRead = async (service, operation, input, signal) => {
    signal.throwIfAborted();
    const options = { abortSignal: signal };
    // This input is constructed and bounded by the adapter before it reaches the SDK.
    const exact = input as never;
    switch (service + ":" + operation) {
      case "cloudformation:describe-stacks": return cfn.send(new DescribeStacksCommand(exact), options);
      case "cloudformation:get-template": return cfn.send(new GetTemplateCommand(exact), options);
      case "cloudformation:list-stack-resources": return cfn.send(new ListStackResourcesCommand(exact), options);
      case "cloudformation:list-change-sets": return cfn.send(new ListChangeSetsCommand(exact), options);
      case "ecs:describe-services": return ecs.send(new DescribeServicesCommand(exact), options);
      case "ecs:describe-task-definition": return ecs.send(new DescribeTaskDefinitionCommand(exact), options);
      case "ecs:list-tasks": return ecs.send(new ListTasksCommand(exact), options);
      case "ecs:describe-tasks": return ecs.send(new DescribeTasksCommand(exact), options);
      case "ecr:batch-get-image": return ecRegistry.send(new BatchGetImageCommand(exact), options);
      case "elbv2:describe-listeners": return loadBalancing.send(new DescribeListenersCommand(exact), options);
      case "elbv2:describe-load-balancers": return loadBalancing.send(new DescribeLoadBalancersCommand(exact), options);
      case "elbv2:describe-target-groups": return loadBalancing.send(new DescribeTargetGroupsCommand(exact), options);
      case "elbv2:describe-target-health": return loadBalancing.send(new DescribeTargetHealthCommand(exact), options);
      case "elbv2:describe-rules": return loadBalancing.send(new DescribeRulesCommand(exact), options);
      case "rds:describe-db-instances": return rds.send(new DescribeDBInstancesCommand(exact), options);
      case "route53:list-resource-record-sets": return dns.send(new ListResourceRecordSetsCommand(exact), options);
      case "secretsmanager:describe-secret": return secrets.send(new DescribeSecretCommand(exact), options);
      case "s3api:head-bucket": return s3.send(new HeadBucketCommand(exact), options);
      default: throw Error("ECS_FIRST_OPEN_INSPECTOR_OPERATION");
    }
  };
  return { read, caller: (signal: AbortSignal): Promise<RoleObservation> => sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal }) };
}

export function readFirstOpenPrivateTechnical(input: {
  path: "/health" | "/ready"; hostname: string; albDnsName: string; signal: AbortSignal; now: () => number;
}): Promise<{ status: number; tlsVerified: boolean; checkedAt: number }> {
  const { path, hostname, albDnsName, signal, now } = input;
  if ((path !== "/health" && path !== "/ready") || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sandbox\.techlong\.cloud$/.test(hostname) ||
    !/^internal-[a-z0-9-]{2,128}\.ca-central-1\.elb\.amazonaws\.com$/.test(albDnsName)) {
    throw Error("ECS_FIRST_OPEN_INSPECTOR_HTTP_SCOPE");
  }
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // The connection goes to the explicitly pinned internal ALB. Preserve the
    // tenant's DNS name for certificate validation and the Host route.
    const request = get({ hostname: albDnsName, servername: hostname, host: albDnsName, port: 443, path, family: 4,
      headers: { host: hostname }, agent: false, lookup: privateLookup(albDnsName), rejectUnauthorized: true,
      minVersion: "TLSv1.2", signal: AbortSignal.any([signal, AbortSignal.timeout(7_000)]) }, response => {
      const status = response.statusCode;
      const remoteAddress = response.socket.remoteAddress;
      response.destroy();
      if (status !== 200 || !remoteAddress || !isPrivateV4(remoteAddress)) {
        reject(Error("ECS_FIRST_OPEN_INSPECTOR_HTTP_UNVERIFIED")); return;
      }
      resolve({ status, tlsVerified: true, checkedAt: now() });
    });
    request.on("error", () => reject(Error("ECS_FIRST_OPEN_INSPECTOR_HTTP_UNVERIFIED")));
  });
}
