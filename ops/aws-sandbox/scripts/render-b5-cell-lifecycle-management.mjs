import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const templatePath = path.join(
  root,
  "cloudformation",
  "s3-b5-cell-lifecycle-management.template.json",
);

const maximumDirectTemplateBytes = 51_200;
const maximumManagedPolicyCharacters = 6_144;
const maximumRoleInlinePolicyCharacters = 10_240;
const accountId = "402010193138";
const region = "ca-central-1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const cellId = "cell-sandbox-1";
const changeSetNamePattern =
  /^techlong-sandbox-cell-sandbox-1-[a-f0-9]{16}$/;
const templateSha256Pattern = /^[a-f0-9]{64}$/;
const canonicalTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const approvedTemplateBucket =
  "techlong-sandbox-build-source-402010193138-ca-central-1";
const approvedTemplatePrefix = "b5-shared-cell/templates/sha256";
const stackArn =
  `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/*`;
const executionRoleArn =
  `arn:aws:iam::${accountId}:role/TechlongSandboxCellCloudFormationExecutionRole`;

export const lifecycleManagementShapes = Object.freeze([
  "Locked",
  "AuthorGrant",
  "ExecuteGrant",
  "RollbackGrant",
]);

export const approvedSharedCellResourceTypes = Object.freeze([
  "AWS::Scheduler::Schedule",
  "AWS::EC2::VPC",
  "AWS::EC2::InternetGateway",
  "AWS::EC2::VPCGatewayAttachment",
  "AWS::EC2::Subnet",
  "AWS::EC2::RouteTable",
  "AWS::EC2::Route",
  "AWS::EC2::SubnetRouteTableAssociation",
  "AWS::EC2::SecurityGroup",
  "AWS::EC2::SecurityGroupIngress",
  "AWS::ECS::Cluster",
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::ElasticLoadBalancingV2::Listener",
  "AWS::ElasticLoadBalancingV2::ListenerRule",
  "AWS::RDS::DBSubnetGroup",
  "AWS::Logs::LogGroup",
  "AWS::RDS::DBCluster",
  "AWS::RDS::DBInstance",
]);

function approvedTemplateLocation(approvedTemplateSha256) {
  const key = `${approvedTemplatePrefix}/${approvedTemplateSha256}.json`;
  return {
    arn: `arn:aws:s3:::${approvedTemplateBucket}/${key}`,
    url: `https://${approvedTemplateBucket}.s3.${region}.amazonaws.com/${key}`,
  };
}

function assertCanonicalTimestamp(value, label) {
  if (!canonicalTimestampPattern.test(value ?? "")) {
    throw new Error(`${label} must be canonical UTC with milliseconds`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} is not a canonical UTC timestamp`);
  }
  return milliseconds;
}

function assertExactGrantInputs({
  shape,
  approvedChangeSetName,
  approvedTemplateSha256,
  approvedCellExpiresAt,
  grantExpiresAt,
}) {
  if (shape === "Locked") {
    if (
      approvedChangeSetName ||
      approvedTemplateSha256 ||
      approvedCellExpiresAt ||
      grantExpiresAt
    ) {
      throw new Error("Locked lifecycle management shape accepts no grant inputs");
    }
    return;
  }
  if (!templateSha256Pattern.test(approvedTemplateSha256 ?? "")) {
    throw new Error("temporary lifecycle grant requires an exact lowercase raw template SHA-256");
  }
  if (!changeSetNamePattern.test(approvedChangeSetName ?? "")) {
    throw new Error("temporary lifecycle grant requires an exact digest-bound Change Set name");
  }
  const expectedChangeSetName =
    `${stackName}-${approvedTemplateSha256.slice(0, 16)}`;
  if (approvedChangeSetName !== expectedChangeSetName) {
    throw new Error("digest-bound Change Set name must match the approved raw template SHA-256");
  }
  const cellExpiry = assertCanonicalTimestamp(
    approvedCellExpiresAt,
    "ApprovedCellExpiresAt",
  );
  const grantExpiry = assertCanonicalTimestamp(grantExpiresAt, "GrantExpiresAt");
  if (grantExpiry >= cellExpiry) {
    throw new Error("temporary lifecycle grant must expire before the Shared Cell TTL");
  }
}

function temporaryCondition(grantExpiresAt, condition = {}) {
  return {
    ...condition,
    DateLessThan: { "aws:CurrentTime": grantExpiresAt },
  };
}

function operatorAuthorStatements(
  approvedChangeSetName,
  approvedTemplateSha256,
  approvedCellExpiresAt,
  grantExpiresAt,
) {
  const changeSetArn =
    `arn:aws:cloudformation:${region}:${accountId}:changeSet/${approvedChangeSetName}/*`;
  const templateLocation = approvedTemplateLocation(approvedTemplateSha256);
  return [
    {
      Sid: "TemporaryAllowAuthorExactCellChangeSet",
      Effect: "Allow",
      Action: "cloudformation:CreateChangeSet",
      Resource: [stackArn, changeSetArn],
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: {
          "aws:RequestedRegion": region,
          "aws:RequestTag/Environment": "aws-sandbox",
          "aws:RequestTag/ManagedBy": "techlong-cell-operator",
          "aws:RequestTag/CellId": cellId,
          "aws:RequestTag/ExpiresAt": approvedCellExpiresAt,
          "cloudformation:TemplateUrl": templateLocation.url,
          "cloudformation:RoleARN": executionRoleArn,
          "cloudformation:ChangeSetName": approvedChangeSetName,
        },
        "ForAllValues:StringEquals": {
          "aws:TagKeys": ["Environment", "ManagedBy", "CellId", "ExpiresAt"],
          "cloudformation:ResourceTypes": approvedSharedCellResourceTypes,
        },
        Null: { "cloudformation:ResourceTypes": "false" },
      }),
    },
    {
      Sid: "TemporaryAllowReadExactApprovedCellTemplate",
      Effect: "Allow",
      Action: "s3:GetObject",
      Resource: templateLocation.arn,
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowReadOrDiscardExactCellChangeSet",
      Effect: "Allow",
      Action: ["cloudformation:DeleteChangeSet", "cloudformation:DescribeChangeSet"],
      Resource: stackArn,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: {
          "aws:RequestedRegion": region,
          "cloudformation:ChangeSetName": approvedChangeSetName,
        },
      }),
    },
    {
      Sid: "TemporaryAllowPassCellExecutionRoleForAuthoring",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: executionRoleArn,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
      }),
    },
  ];
}

function operatorExecuteStatements(approvedChangeSetName, grantExpiresAt) {
  return [
    {
      Sid: "TemporaryAllowExecuteExactCellChangeSet",
      Effect: "Allow",
      Action: "cloudformation:ExecuteChangeSet",
      Resource: stackArn,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: {
          "aws:RequestedRegion": region,
          "cloudformation:ChangeSetName": approvedChangeSetName,
        },
      }),
    },
  ];
}

function operatorRollbackStatements(approvedCellExpiresAt, grantExpiresAt) {
  return [
    {
      Sid: "TemporaryAllowManualFailedCreateDelete",
      Effect: "Allow",
      Action: ["cloudformation:DeleteStack", "cloudformation:DescribeStacks"],
      Resource: stackArn,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: {
          "aws:RequestedRegion": region,
          "aws:ResourceTag/Environment": "aws-sandbox",
          "aws:ResourceTag/ManagedBy": "techlong-cell-operator",
          "aws:ResourceTag/CellId": cellId,
          "aws:ResourceTag/ExpiresAt": approvedCellExpiresAt,
        },
      }),
    },
    {
      Sid: "TemporaryAllowPassCellExecutionRoleForFailedCreateRollback",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: executionRoleArn,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
      }),
    },
  ];
}

function exactCellExecutionStatements(mode, grantExpiresAt) {
  const isExecute = mode === "execute";
  const statements = [
    {
      Sid: "TemporaryAllowCellEc2Read",
      Effect: "Allow",
      Action: [
        "ec2:DescribeInternetGateways",
        "ec2:DescribeRouteTables",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
        "ec2:DescribeVpcs",
      ],
      Resource: "*",
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "aws:RequestedRegion": region },
      }),
    },
    {
      Sid: "TemporaryAllowTaggedCellEc2Delete",
      Effect: "Allow",
      Action: [
        "ec2:DeleteInternetGateway",
        "ec2:DeleteRouteTable",
        "ec2:DeleteSecurityGroup",
        "ec2:DeleteSubnet",
        "ec2:DeleteTags",
        "ec2:DeleteVpc",
      ],
      Resource: "*",
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: {
          "aws:RequestedRegion": region,
          "aws:ResourceTag/Environment": "aws-sandbox",
          "aws:ResourceTag/ManagedBy": "techlong-cell-operator",
          "aws:ResourceTag/CellId": cellId,
        },
      }),
    },
    {
      Sid: "TemporaryAllowCellEc2DependencyCleanup",
      Effect: "Allow",
      Action: [
        "ec2:DeleteRoute",
        "ec2:DetachInternetGateway",
        "ec2:DisassociateRouteTable",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
      ],
      Resource: "*",
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "aws:RequestedRegion": region },
      }),
    },
    {
      Sid: "TemporaryAllowExactCellEcsCleanup",
      Effect: "Allow",
      Action: ["ecs:DeleteCluster", "ecs:DescribeClusters", "ecs:ListTagsForResource"],
      Resource: `arn:aws:ecs:${region}:${accountId}:cluster/${cellId}`,
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellLoadBalancerCleanup",
      Effect: "Allow",
      Action: [
        "elasticloadbalancing:DeleteListener",
        "elasticloadbalancing:DeleteLoadBalancer",
        "elasticloadbalancing:DeleteRule",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeLoadBalancerAttributes",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:DescribeTags",
      ],
      Resource: [
        `arn:aws:elasticloadbalancing:${region}:${accountId}:loadbalancer/app/${stackName}/*`,
        `arn:aws:elasticloadbalancing:${region}:${accountId}:listener/app/${stackName}/*/*`,
        `arn:aws:elasticloadbalancing:${region}:${accountId}:listener-rule/app/${stackName}/*/*/*`,
      ],
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellRdsCleanup",
      Effect: "Allow",
      Action: [
        "rds:DeleteDBCluster",
        "rds:DeleteDBInstance",
        "rds:DeleteDBSubnetGroup",
        "rds:DescribeDBClusters",
        "rds:DescribeDBInstances",
        "rds:DescribeDBSubnetGroups",
      ],
      Resource: [
        `arn:aws:rds:${region}:${accountId}:cluster:${stackName}`,
        `arn:aws:rds:${region}:${accountId}:db:${stackName}-writer`,
        `arn:aws:rds:${region}:${accountId}:subgrp:${stackName}`,
      ],
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellLogCleanup",
      Effect: "Allow",
      Action: ["logs:DeleteLogGroup", "logs:DescribeLogGroups", "logs:ListTagsForResource"],
      Resource: [
        `arn:aws:logs:${region}:${accountId}:log-group:/aws/rds/cluster/${stackName}/postgresql`,
        `arn:aws:logs:${region}:${accountId}:log-group:/aws/rds/cluster/${stackName}/postgresql:*`,
      ],
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellScheduleCleanup",
      Effect: "Allow",
      Action: ["scheduler:DeleteSchedule", "scheduler:GetSchedule"],
      Resource:
        `arn:aws:scheduler:${region}:${accountId}:schedule/techlong-sandbox-cell/${stackName}-ttl`,
      Condition: temporaryCondition(grantExpiresAt),
    },
  ];
  if (!isExecute) return statements;

  statements.push(
    {
      Sid: "TemporaryAllowTaggedCellEc2Create",
      Effect: "Allow",
      Action: [
        "ec2:CreateInternetGateway",
        "ec2:CreateRouteTable",
        "ec2:CreateSecurityGroup",
        "ec2:CreateSubnet",
        "ec2:CreateTags",
        "ec2:CreateVpc",
      ],
      Resource: "*",
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: {
          "aws:RequestedRegion": region,
          "aws:RequestTag/Environment": "aws-sandbox",
          "aws:RequestTag/ManagedBy": "techlong-cell-operator",
          "aws:RequestTag/CellId": cellId,
        },
      }),
    },
    {
      Sid: "TemporaryAllowCellEc2DependencyCreate",
      Effect: "Allow",
      Action: [
        "ec2:AssociateRouteTable",
        "ec2:AttachInternetGateway",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:CreateRoute",
        "ec2:ModifySubnetAttribute",
        "ec2:ModifyVpcAttribute",
        "ec2:ReplaceRouteTableAssociation",
      ],
      Resource: "*",
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "aws:RequestedRegion": region },
      }),
    },
    {
      Sid: "TemporaryAllowExactCellEcsCreate",
      Effect: "Allow",
      Action: [
        "ecs:CreateCluster",
        "ecs:PutClusterCapacityProviders",
        "ecs:TagResource",
        "ecs:UntagResource",
        "ecs:UpdateClusterSettings",
      ],
      Resource: `arn:aws:ecs:${region}:${accountId}:cluster/${cellId}`,
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellLoadBalancerCreate",
      Effect: "Allow",
      Action: [
        "elasticloadbalancing:AddTags",
        "elasticloadbalancing:CreateListener",
        "elasticloadbalancing:CreateLoadBalancer",
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:ModifyListener",
        "elasticloadbalancing:ModifyLoadBalancerAttributes",
        "elasticloadbalancing:ModifyRule",
        "elasticloadbalancing:RemoveTags",
        "elasticloadbalancing:SetSecurityGroups",
        "elasticloadbalancing:SetSubnets",
      ],
      Resource: [
        `arn:aws:elasticloadbalancing:${region}:${accountId}:loadbalancer/app/${stackName}/*`,
        `arn:aws:elasticloadbalancing:${region}:${accountId}:listener/app/${stackName}/*/*`,
        `arn:aws:elasticloadbalancing:${region}:${accountId}:listener-rule/app/${stackName}/*/*/*`,
      ],
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellRdsCreate",
      Effect: "Allow",
      Action: [
        "rds:AddTagsToResource",
        "rds:CreateDBCluster",
        "rds:CreateDBInstance",
        "rds:CreateDBSubnetGroup",
        "rds:ModifyDBCluster",
        "rds:ModifyDBInstance",
        "rds:ModifyDBSubnetGroup",
        "rds:RemoveTagsFromResource",
      ],
      Resource: [
        `arn:aws:rds:${region}:${accountId}:cluster:${stackName}`,
        `arn:aws:rds:${region}:${accountId}:db:${stackName}-writer`,
        `arn:aws:rds:${region}:${accountId}:subgrp:${stackName}`,
      ],
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellLogCreate",
      Effect: "Allow",
      Action: [
        "logs:CreateLogGroup",
        "logs:DeleteRetentionPolicy",
        "logs:PutRetentionPolicy",
        "logs:TagResource",
        "logs:UntagResource",
      ],
      Resource: [
        `arn:aws:logs:${region}:${accountId}:log-group:/aws/rds/cluster/${stackName}/postgresql`,
        `arn:aws:logs:${region}:${accountId}:log-group:/aws/rds/cluster/${stackName}/postgresql:*`,
      ],
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowExactCellScheduleCreate",
      Effect: "Allow",
      Action: [
        "scheduler:CreateSchedule",
        "scheduler:TagResource",
        "scheduler:UntagResource",
        "scheduler:UpdateSchedule",
      ],
      Resource:
        `arn:aws:scheduler:${region}:${accountId}:schedule/techlong-sandbox-cell/${stackName}-ttl`,
      Condition: temporaryCondition(grantExpiresAt),
    },
    {
      Sid: "TemporaryAllowPassOnlyExistingSchedulerInvokeRole",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource:
        `arn:aws:iam::${accountId}:role/TechlongSandboxCellSchedulerInvokeRole`,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "iam:PassedToService": "scheduler.amazonaws.com" },
      }),
    },
  );
  return statements;
}

function policyCharacters(document) {
  return JSON.stringify(document).replace(/\s/g, "").length;
}

function executionBoundaryStatements(mode, grantExpiresAt) {
  const exactStatements = exactCellExecutionStatements(mode, grantExpiresAt);
  const regionalActions = [...new Set(
    exactStatements
      .flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action],
      )
      .filter((action) => action !== "iam:PassRole"),
  )].sort();
  const ec2Actions = regionalActions.filter((action) => action.startsWith("ec2:"));
  const namedActions = regionalActions.filter((action) => !action.startsWith("ec2:"));
  const namedResources = [...new Set(
    exactStatements
      .filter((statement) => {
        const statementActions = Array.isArray(statement.Action)
          ? statement.Action
          : [statement.Action];
        return statementActions.some(
          (action) => action !== "iam:PassRole" && !action.startsWith("ec2:"),
        );
      })
      .flatMap((statement) =>
        Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource],
      )
      .filter((resource) => resource !== "*"),
  )].sort();
  const statements = [
    {
      Sid: mode === "execute"
        ? "TemporaryCellExecutionEc2BoundaryMaximum"
        : "TemporaryCellRollbackEc2BoundaryMaximum",
      Effect: "Allow",
      Action: ec2Actions,
      Resource: "*",
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "aws:RequestedRegion": region },
      }),
    },
    {
      Sid: mode === "execute"
        ? "TemporaryCellExecutionNamedBoundaryMaximum"
        : "TemporaryCellRollbackNamedBoundaryMaximum",
      Effect: "Allow",
      Action: namedActions,
      Resource: namedResources,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "aws:RequestedRegion": region },
      }),
    },
  ];
  if (mode === "execute") {
    statements.push({
      Sid: "TemporaryCellExecutionBoundaryPassSchedulerRole",
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource:
        `arn:aws:iam::${accountId}:role/TechlongSandboxCellSchedulerInvokeRole`,
      Condition: temporaryCondition(grantExpiresAt, {
        StringEquals: { "iam:PassedToService": "scheduler.amazonaws.com" },
      }),
    });
  }
  return statements;
}

function assertPolicySizes(template) {
  for (const logicalId of [
    "CellOperatorBoundary",
    "CellCloudFormationExecutionBoundary",
  ]) {
    const document = template.Resources[logicalId].Properties.PolicyDocument;
    const characters = policyCharacters(document);
    if (characters > maximumManagedPolicyCharacters) {
      throw new Error(
        `${logicalId} policy has ${characters} non-whitespace characters; maximum is ${maximumManagedPolicyCharacters}`,
      );
    }
  }
  const policies = template.Resources.CellCloudFormationExecutionRole.Properties.Policies ?? [];
  const aggregate = policies.reduce(
    (total, policy) => total + policyCharacters(policy.PolicyDocument),
    0,
  );
  if (aggregate > maximumRoleInlinePolicyCharacters) {
    throw new Error(
      `CellCloudFormationExecutionRole inline policies have ${aggregate} non-whitespace characters; maximum is ${maximumRoleInlinePolicyCharacters}`,
    );
  }
}

export async function renderB5CellLifecycleManagementTemplate({
  shape = "Locked",
  approvedChangeSetName = "",
  approvedTemplateSha256 = "",
  approvedCellExpiresAt = "",
  grantExpiresAt = "",
} = {}) {
  if (!lifecycleManagementShapes.includes(shape)) {
    throw new Error(`unsupported B5 Shared Cell lifecycle management shape: ${shape}`);
  }
  assertExactGrantInputs({
    shape,
    approvedChangeSetName,
    approvedTemplateSha256,
    approvedCellExpiresAt,
    grantExpiresAt,
  });
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  const operatorStatements =
    template.Resources?.CellOperatorBoundary?.Properties?.PolicyDocument?.Statement;
  const executionStatements =
    template.Resources?.CellCloudFormationExecutionBoundary?.Properties?.PolicyDocument?.Statement;
  if (!Array.isArray(operatorStatements) || !Array.isArray(executionStatements)) {
    throw new Error("locked lifecycle management template is missing an IAM boundary");
  }
  for (const forbidden of [
    "cloudformation:CreateChangeSet",
    "cloudformation:ExecuteChangeSet",
    "cloudformation:DeleteStack",
    "ec2:CreateVpc",
    "ecs:CreateCluster",
    "elasticloadbalancing:CreateLoadBalancer",
    "rds:CreateDBCluster",
  ]) {
    const hasAllow = [operatorStatements, executionStatements].some((statements) =>
      statements.some((statement) => {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        return statement.Effect === "Allow" && actions.includes(forbidden);
      }),
    );
    if (hasAllow) throw new Error(`locked lifecycle template unexpectedly allows ${forbidden}`);
  }
  if (template.Resources.CellCloudFormationExecutionRole.Properties.Policies) {
    throw new Error("locked lifecycle execution role unexpectedly has an inline policy");
  }

  const boundary = template.Metadata.SafetyBoundary;
  boundary.OperatorGrantState = shape.toUpperCase();
  if (shape !== "Locked") {
    const templateLocation = approvedTemplateLocation(approvedTemplateSha256);
    boundary.ApprovedChangeSetName = approvedChangeSetName;
    boundary.ApprovedTemplateSha256 = approvedTemplateSha256;
    boundary.ApprovedTemplateUrl = templateLocation.url;
    boundary.ApprovedCellExpiresAt = approvedCellExpiresAt;
    boundary.GrantExpiresAt = grantExpiresAt;
  }

  if (shape === "AuthorGrant") {
    operatorStatements.push(
      ...operatorAuthorStatements(
        approvedChangeSetName,
        approvedTemplateSha256,
        approvedCellExpiresAt,
        grantExpiresAt,
      ),
    );
  } else if (shape === "ExecuteGrant") {
    operatorStatements.push(
      ...operatorExecuteStatements(approvedChangeSetName, grantExpiresAt),
    );
    const exactStatements = exactCellExecutionStatements("execute", grantExpiresAt);
    executionStatements.push(
      ...executionBoundaryStatements("execute", grantExpiresAt),
    );
    template.Resources.CellCloudFormationExecutionRole.Properties.Policies = [
      {
        PolicyName: "TechlongSandboxCellTemporaryExecuteGrant",
        PolicyDocument: { Version: "2012-10-17", Statement: exactStatements },
      },
    ];
  } else if (shape === "RollbackGrant") {
    operatorStatements.push(
      ...operatorRollbackStatements(approvedCellExpiresAt, grantExpiresAt),
    );
    const exactStatements = exactCellExecutionStatements("rollback", grantExpiresAt);
    executionStatements.push(
      ...executionBoundaryStatements("rollback", grantExpiresAt),
    );
    template.Resources.CellCloudFormationExecutionRole.Properties.Policies = [
      {
        PolicyName: "TechlongSandboxCellTemporaryRollbackGrant",
        PolicyDocument: { Version: "2012-10-17", Statement: exactStatements },
      },
    ];
  }

  template.Description =
    `Local-only J5g-a Shared Cell lifecycle IAM contract (${shape}); no AWS apply, paid Cell, or TTL deletion is approved.`;
  assertPolicySizes(template);
  const rendered = `${JSON.stringify(template)}\n`;
  if (Buffer.byteLength(rendered, "utf8") > maximumDirectTemplateBytes) {
    throw new Error("rendered B5 Shared Cell lifecycle IAM template exceeds 51,200 bytes");
  }
  return rendered;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : (process.argv[index + 1] ?? "");
}

async function main() {
  const output = argument("--output");
  if (!output) {
    throw new Error(
      "usage: node render-b5-cell-lifecycle-management.mjs --shape <shape> --output <path> [--approved-change-set-name <name> --approved-template-sha256 <raw-sha256> --approved-cell-expires-at <UTC> --grant-expires-at <UTC>]",
    );
  }
  const shape = argument("--shape") || "Locked";
  const rendered = await renderB5CellLifecycleManagementTemplate({
    shape,
    approvedChangeSetName: argument("--approved-change-set-name"),
    approvedTemplateSha256: argument("--approved-template-sha256"),
    approvedCellExpiresAt: argument("--approved-cell-expires-at"),
    grantExpiresAt: argument("--grant-expires-at"),
  });
  const outputPath = path.resolve(process.cwd(), output);
  await writeFile(outputPath, rendered, { encoding: "utf8", flag: "w" });
  console.log(`Rendered B5 Shared Cell lifecycle IAM contract (${shape}): ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
