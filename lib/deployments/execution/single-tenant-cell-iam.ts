import { canonicalJson, sha256Hex } from "./hash.ts";
import { ACCEPTANCE_CELL_SERVICE_ROLE } from "./single-tenant-cell-operations.ts";

export const ACCEPTANCE_CELL_IAM = Object.freeze({
  roleName: "TechlongSandboxFirstAcceptanceCellExecutionRole",
  roleArn: ACCEPTANCE_CELL_SERVICE_ROLE,
  boundaryName: "TechlongSandboxFirstAcceptanceCellExecutionBoundary",
  boundaryArn: "arn:aws:iam::402010193138:policy/TechlongSandboxFirstAcceptanceCellExecutionBoundary",
  sourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
  sourceUserId: "AIDAV3GNMXTZEO7SHLC2X", account: "402010193138", region: "ca-central-1",
  cellName: "techlong-sandbox-cell-sandbox-1",
});
export interface CellIamStatement {
  Sid: string; Effect: "Allow" | "Deny"; Action?: string[]; NotAction?: string[]; Resource: string[] | string;
  Condition?: Record<string, Record<string, string | string[]>>;
}
const a = ACCEPTANCE_CELL_IAM, ec2 = (type: string) => `arn:aws:ec2:${a.region}:${a.account}:${type}/*`;
const rds = (type: string, id: string) => `arn:aws:rds:${a.region}:${a.account}:${type}:${id}`;
const elb = (type: string) => `arn:aws:elasticloadbalancing:${a.region}:${a.account}:${type}/app/${a.cellName}/*`;
const network = ["vpc", "internet-gateway", "subnet", "route-table", "security-group"].map(ec2);
const ownership = { Environment: "aws-sandbox", ManagedBy: "techlong-provisioner", CellId: "cell-sandbox-1",
  DeliveryTrack: "single-tenant-acceptance", CleanupMode: "supervised-reviewed" };
const tags = (prefix: string) => Object.fromEntries(Object.entries(ownership).map(([k, v]) => [`${prefix}/${k}`, v]));
const createNetwork = ["CreateVpc", "CreateInternetGateway", "CreateSubnet", "CreateRouteTable", "CreateSecurityGroup"];
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Dedicated Cell role only. No workload RunTask/CreateService, IAM writes,
 * Secret values, snapshot/restore, VPN/NAT/endpoints or F3c9 permissions. It is
 * an active capability if installed: template parameter caps/UUID/journal are
 * enforced by the separately reviewed operator, not magically by IAM tags.
 */
export async function compileAcceptanceCellIam(raw: { rdsKmsKeyArn: string; secretsKmsKeyArn: string }) {
  const input = structuredClone(raw), key = /^arn:aws:kms:ca-central-1:402010193138:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (Object.keys(input).sort().join(",") !== "rdsKmsKeyArn,secretsKmsKeyArn" || !key.test(input.rdsKmsKeyArn) || !key.test(input.secretsKmsKeyArn)) throw Error("ACCEPTANCE_CELL_KMS_REFERENCES_INVALID");
  const cluster = rds("cluster", a.cellName), writer = rds("db", `${a.cellName}-writer`), subnet = rds("subgrp", a.cellName);
  const log = `arn:aws:logs:${a.region}:${a.account}:log-group:/aws/rds/cluster/${a.cellName}/postgresql`;
  const statements: CellIamStatement[] = [
    { Sid: "DenyOtherRegions", Effect: "Deny", NotAction: ["iam:*"], Resource: "*", Condition: { StringNotEquals: { "aws:RequestedRegion": a.region } } },
    { Sid: "ReadCellProviderMetadata", Effect: "Allow", Action: [
      "ec2:DescribeVpcAttribute", "ec2:DescribeVpcs", "ec2:DescribeNetworkAcls", "ec2:DescribeSecurityGroups", "ec2:DescribeInternetGateways",
      "ec2:DescribeSubnets", "ec2:DescribeRouteTables", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSecurityGroupRules", "ec2:DescribeInstances",
      "ec2:DescribeAccountAttributes", "ec2:DescribeAvailabilityZones", "ec2:DescribeIpamPools",
      "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeLoadBalancerAttributes", "elasticloadbalancing:DescribeCapacityReservation",
      "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeListenerAttributes", "elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTags",
      "rds:DescribeDBClusters", "rds:DescribeDBInstances", "rds:DescribeDBSubnetGroups", "rds:DescribeEvents", "logs:DescribeLogGroups",
    ], Resource: "*" },
    { Sid: "CreateTaggedCellNetwork", Effect: "Allow", Action: createNetwork.map(n => `ec2:${n}`), Resource: network,
      Condition: { StringEquals: tags("aws:RequestTag") } },
    // The VPC is a referenced, existing resource for these three APIs; its
    // ResourceTag keys cannot be confused with RequestTag on the new child.
    { Sid: "UseOnlyOwnedParentVpc", Effect: "Allow", Action: ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"],
      Resource: ec2("vpc"), Condition: { StringEquals: tags("aws:ResourceTag") } },
    { Sid: "TagNetworkDuringCreate", Effect: "Allow", Action: ["ec2:CreateTags"], Resource: network,
      Condition: { StringEquals: { ...tags("aws:RequestTag"), "ec2:CreateAction": createNetwork } } },
    { Sid: "TagAlreadyOwnedNetwork", Effect: "Allow", Action: ["ec2:CreateTags"], Resource: network,
      Condition: { StringEquals: tags("aws:ResourceTag") } },
    { Sid: "ConfigureAndDeleteOwnedNetwork", Effect: "Allow", Action: [
      "ec2:ModifyVpcAttribute", "ec2:ModifySubnetAttribute", "ec2:AttachInternetGateway", "ec2:DetachInternetGateway",
      "ec2:CreateRoute", "ec2:DeleteRoute", "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable", "ec2:ReplaceRouteTableAssociation",
      "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress",
      "ec2:DeleteVpc", "ec2:DeleteInternetGateway", "ec2:DeleteSubnet", "ec2:DeleteRouteTable", "ec2:DeleteSecurityGroup",
    ], Resource: network, Condition: { StringEquals: tags("aws:ResourceTag") } },
    { Sid: "CellClusterOnly", Effect: "Allow", Action: ["ecs:CreateCluster", "ecs:DescribeClusters", "ecs:DeleteCluster", "ecs:TagResource"],
      Resource: `arn:aws:ecs:${a.region}:${a.account}:cluster/cell-sandbox-1` },
    { Sid: "CreateNamedAlbOnly", Effect: "Allow", Action: ["elasticloadbalancing:CreateLoadBalancer"], Resource: elb("loadbalancer"),
      Condition: { StringEquals: { ...tags("aws:RequestTag"), "elasticloadbalancing:Scheme": "internet-facing" } } },
    // Listeners/rules in the reused template are not tagged. Their exact
    // named-parent ARN namespace is used instead of an unsupported tag claim.
    { Sid: "NamedAlbListenersAndRules", Effect: "Allow", Action: ["elasticloadbalancing:CreateListener", "elasticloadbalancing:CreateRule",
      "elasticloadbalancing:DeleteLoadBalancer", "elasticloadbalancing:DeleteListener", "elasticloadbalancing:DeleteRule",
      "elasticloadbalancing:ModifyLoadBalancerAttributes", "elasticloadbalancing:ModifyListenerAttributes", "elasticloadbalancing:SetSecurityGroups", "elasticloadbalancing:AddTags"],
      Resource: [elb("loadbalancer"), elb("listener"), elb("listener-rule")] },
    { Sid: "CreateExactCluster", Effect: "Allow", Action: ["rds:CreateDBCluster"], Resource: [cluster, subnet, rds("cluster-pg", "default.aurora-postgresql16")],
      Condition: { StringEquals: { "rds:DatabaseEngine": "aurora-postgresql" }, Bool: { "rds:StorageEncrypted": "true", "rds:ManageMasterUserPassword": "true" } } },
    { Sid: "CreateExactServerlessWriter", Effect: "Allow", Action: ["rds:CreateDBInstance"], Resource: [writer, cluster, subnet,
      rds("pg", "default.aurora-postgresql16")], Condition: { StringEquals: { "rds:DatabaseEngine": "aurora-postgresql", "rds:DatabaseClass": "db.serverless" },
        Bool: { "rds:PubliclyAccessible": "false" } } },
    { Sid: "ExactRdsConfigureAndDelete", Effect: "Allow", Action: ["rds:CreateDBSubnetGroup", "rds:ModifyDBCluster", "rds:ModifyDBInstance",
      "rds:DeleteDBCluster", "rds:DeleteDBInstance", "rds:DeleteDBSubnetGroup", "rds:AddTagsToResource", "rds:RemoveTagsFromResource", "rds:ListTagsForResource"],
      Resource: [cluster, writer, subnet] },
    { Sid: "ManagedMasterSecretCreationOnly", Effect: "Allow", Action: ["secretsmanager:CreateSecret", "secretsmanager:TagResource"],
      Resource: `arn:aws:secretsmanager:${a.region}:${a.account}:secret:rds!cluster-*` },
    { Sid: "DescribeTwoDefaultKeys", Effect: "Allow", Action: ["kms:DescribeKey"], Resource: [...new Set([input.rdsKmsKeyArn, input.secretsKmsKeyArn])] },
    { Sid: "RdsStorageServiceGrantOnly", Effect: "Allow", Action: ["kms:CreateGrant"], Resource: input.rdsKmsKeyArn,
      Condition: { StringEquals: { "kms:ViaService": "rds.ca-central-1.amazonaws.com", "kms:CallerAccount": a.account }, Bool: { "kms:GrantIsForAWSResource": "true" } } },
    { Sid: "CellPostgresLogOnly", Effect: "Allow", Action: ["logs:CreateLogGroup", "logs:PutRetentionPolicy", "logs:DeleteLogGroup", "logs:TagResource",
      "logs:ListTagsForResource", "logs:GetDataProtectionPolicy", "logs:DeleteDataProtectionPolicy", "logs:DescribeIndexPolicies"], Resource: [log, `${log}:*`] },
  ];
  const policyDocument = { Version: "2012-10-17", Statement: statements };
  const policyBytes = Buffer.byteLength(canonicalJson(policyDocument));
  if (policyBytes > 10240) throw Error(`ACCEPTANCE_CELL_INLINE_POLICY_SIZE_EXCEEDED:${policyBytes}`);
  // Keep the resource/condition-rich identity policy intact rather than
  // widening its ARNs to fit the smaller managed-policy limit. The boundary
  // is a maximum action cap only; it grants nothing unless the exact inline
  // identity policy is also installed on this otherwise policy-empty role.
  const boundaryDocument = { Version: "2012-10-17", Statement: [statements[0], {
    Sid: "MaximumCellActionCap", Effect: "Allow", Action: [...new Set(statements.flatMap(s => s.Effect === "Allow" ? s.Action ?? [] : []))].sort(), Resource: "*",
  }] };
  const boundaryBytes = Buffer.byteLength(canonicalJson(boundaryDocument));
  if (boundaryBytes > 6144) throw Error("ACCEPTANCE_CELL_BOUNDARY_SIZE_EXCEEDED");
  const trustDocument = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "cloudformation.amazonaws.com" }, Action: "sts:AssumeRole" }] };
  const material = { targets: a, defaultKeyReferences: input, policyDocument, boundaryDocument, trustDocument, inlinePolicyName: "FirstAcceptanceCellResourcesV1",
    tags: Object.entries(ownership).map(([Key, Value]) => ({ Key, Value })), maxSessionDuration: 3600,
    mutations: ["CreateBoundaryPolicy", "CreatePolicyEmptyRoleWithExactBoundary", "PutExactResourceScopedInlinePolicy"] as const };
  return freeze({ ...material, materialSha256: await sha256Hex(material), policyBytes, boundaryBytes,
    feeCreatingResourcesCreatedByInstall: false, installsActivePaidCellCapabilitiesIfApproved: true,
    metadataReadResourceStarRequired: true, masterSecretNamespaceNotExactFutureUuid: true,
    sourceForwardedPathNotProved: true, installAuthorized: false, cellDeploymentAuthorized: false });
}
