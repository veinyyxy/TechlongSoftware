// Pure review renderer. No AWS/SQL/GitHub mutation client exists here.
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../../../lib/deployments/initialized-platform-request-v1.ts';
import { INSTALL_CANDIDATE_V5 as C } from './inventory-v5.mjs';
import { loadNeonContractV5, renderNeonContractV5 } from '../neon-contract-v5.mjs';
const account = '402010193138', region = 'ca-central-1', prefix = `arn:aws:`,
  roleArn = `${prefix}iam::${account}:role/${C.role}`, sourceArn = `${prefix}iam::${account}:user/techlong-sandbox-dev`,
  tableArn = `${prefix}dynamodb:${region}:${account}:table/${C.table}`, bucketArn = `${prefix}s3:::${C.bucket}`;
export const INSTALL_SCOPE_V5 = Object.freeze({ environment: 'techlong-sandbox-deploy', repositoryId: '1323312747', ownerId: '14145707',
  subject: 'repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy',
  caller: '.github/workflows/cloud-worker-execute.yml', reusable: '.github/workflows/cloud-worker-job.yml',
  foundationStack: 'techlong-sandbox-cloud-worker-foundation-v5', roleArn, sourceArn,
  // Public deterministic IDs, NOT secret values; installation must create exactly these versions once.
  secretVersions: ['ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e','2854e7b6-6c3c-41be-a5d8-b87dd9d98810'] });
const I = INSTALL_SCOPE_V5;
const document = statements => ({ Version: '2012-10-17', Statement: statements });
const statement = (Action, Resource, Condition) => ({ Effect: 'Allow', Action, Resource, ...(Condition ? { Condition } : {}) });
const regional = { StringEquals: { 'aws:RequestedRegion': region } };
const secretPattern = name => `${prefix}secretsmanager:${region}:${account}:secret:${name}-??????`;
export function workerTrustV5(reusableCommit) {
  if (!/^[a-f0-9]{40}$/.test(reusableCommit)) throw Error('EXACT_REUSABLE_COMMIT_REQUIRED');
  return document([{ Effect: 'Allow', Principal: { Federated: C.oidc }, Action: 'sts:AssumeRoleWithWebIdentity', Condition: { StringEquals: {
    'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': I.subject,
    'token.actions.githubusercontent.com:repository_id': I.repositoryId, 'token.actions.githubusercontent.com:repository_owner_id': I.ownerId,
    'token.actions.githubusercontent.com:ref': 'refs/heads/main', 'token.actions.githubusercontent.com:environment': I.environment,
    'token.actions.githubusercontent.com:job_workflow_ref': `veinyyxy/TechlongSoftware/${I.reusable}@${reusableCommit}`,
  } } }]);
}
export function secretResourcePolicyV5() {
  // Explicit Deny is necessary: the unchanged old task execution role has a
  // broad techlong/sandbox/* Allow. Install this BEFORE adding a usable value.
  return document([{ Sid: 'DenyOtherDataReaders', Effect: 'Deny', Principal: '*', Action: 'secretsmanager:GetSecretValue', Resource: '*',
    Condition: { ArnNotEquals: { 'aws:PrincipalArn': [roleArn, sourceArn] } } },
  { Sid: 'OnlySourceMayManageNewSecrets', Effect: 'Deny', Principal: '*', Action: [
    'secretsmanager:PutSecretValue','secretsmanager:UpdateSecret','secretsmanager:DeleteSecret','secretsmanager:RestoreSecret',
    'secretsmanager:PutResourcePolicy','secretsmanager:DeleteResourcePolicy','secretsmanager:RotateSecret','secretsmanager:CancelRotateSecret',
    'secretsmanager:ReplicateSecretToRegions','secretsmanager:RemoveRegionsFromReplication','secretsmanager:StopReplicationToReplica'], Resource: '*',
  Condition: { ArnNotEquals: { 'aws:PrincipalArn': sourceArn } } }]);
}
export function workerPermissionsV5(capsule) {
  const b = capsule.base, binding = capsule.delivery.binding, stable = b.epochItem.authority_key.S,
    cfnRole = b.iam.cfnRole.arn, tenantStack = `${prefix}cloudformation:${region}:${account}:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/*`,
    cluster = `${prefix}ecs:${region}:${account}:cluster/cell-sandbox-1`, ecs = `${prefix}ecs:${region}:${account}:`,
    types = ['AWS::Logs::LogGroup','AWS::ECS::TaskDefinition','AWS::ElasticLoadBalancingV2::TargetGroup','AWS::ElasticLoadBalancingV2::ListenerRule','AWS::ECS::Service'];
  const statements = [
    statement(['cloudformation:DescribeStacks','cloudformation:GetTemplate','cloudformation:ListStackResources'], [b.compute.stackId, tenantStack], regional),
    statement('cloudformation:ValidateTemplate', '*', regional),
    statement('cloudformation:CreateStack', tenantStack, { StringEquals: { ...regional.StringEquals,
      'cloudformation:RoleArn': cfnRole, 'aws:RequestTag/AppInstanceId': S.appInstanceId, 'aws:RequestTag/DeploymentId': S.deploymentId,
      'aws:RequestTag/Environment': 'aws-sandbox', 'aws:RequestTag/ManagedBy': 'techlong-provisioner' },
    'ForAllValues:StringEquals': { 'cloudformation:ResourceTypes': types }, Null: { 'cloudformation:ResourceTypes': 'false', 'cloudformation:TemplateUrl': 'true' } }),
    statement('cloudformation:TagResource', tenantStack, { StringEquals: { ...regional.StringEquals,
      'aws:RequestTag/AppInstanceId': S.appInstanceId, 'aws:RequestTag/DeploymentId': S.deploymentId, 'aws:RequestTag/Environment': 'aws-sandbox' } }),
    statement('iam:PassRole', cfnRole, { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } }),
    statement(['iam:GetRole','iam:ListRolePolicies','iam:ListAttachedRolePolicies','iam:GetRolePolicy'], [cfnRole, ...b.iam.roles.map(r => r.arn)]),
    statement(['iam:GetPolicy','iam:GetPolicyVersion'], b.iam.policies.map(p => p.arn)),
    statement('ecs:DescribeClusters', cluster, regional),
    statement('ecs:DescribeServices', ecs + 'service/cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service', regional),
    statement('ecs:DescribeTasks', ecs + 'task/cell-sandbox-1/*', regional),
    statement('ecs:DescribeTaskDefinition', ecs + 'task-definition/tenant-9c5ee9e64509dcad-task-definition:*', regional),
    statement('ecs:ListTasks', '*', { StringEquals: { ...regional.StringEquals, 'ecs:cluster': cluster } }),
    statement(['ecs:ListTaskDefinitions','logs:DescribeLogGroups','elasticloadbalancing:DescribeTargetGroups','elasticloadbalancing:DescribeRules',
      'elasticloadbalancing:DescribeTargetHealth','elasticloadbalancing:DescribeListeners','elasticloadbalancing:DescribeLoadBalancers'], '*', regional),
    statement('rds:DescribeDBClusters', binding.clusterArn, regional),
    statement(['ecr:BatchGetImage','ecr:DescribeImageScanFindings'], `${prefix}ecr:${region}:${account}:repository/techlong-sandbox-speedfeast`, regional),
    statement('route53:ListResourceRecordSets', `${prefix}route53:::hostedzone/${b.hostedZoneId}`),
    statement('lambda:GetFunctionConfiguration', `${prefix}lambda:${region}:${account}:function:techlong-sandbox-janitor`, regional),
    statement('scheduler:GetSchedule', `${prefix}scheduler:${region}:${account}:schedule/techlong-sandbox/global-expired-stack-scan`, regional),
    statement('secretsmanager:DescribeSecret', [binding.runtimeSecret.arn,
      'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/control-public-key-first-acceptance-PfBjiq'], regional),
    statement(['dynamodb:DescribeTable','dynamodb:DescribeTimeToLive'], tableArn, regional),
    statement(['dynamodb:PutItem','dynamodb:ConditionCheckItem','dynamodb:GetItem'], tableArn, {
      StringEquals: regional.StringEquals, 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['JOB#job_*'] }, Null: { 'dynamodb:LeadingKeys': 'false' } }),
    statement('dynamodb:GetItem', `${prefix}dynamodb:${region}:${account}:table/techlong-sandbox-tenant-external-epoch-authority`, {
      StringEquals: regional.StringEquals, 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': [stable, stable.replace('tenant:','tenant:aurora-v2:')] },
      Null: { 'dynamodb:LeadingKeys': 'false' } }),
    statement(['s3:ListBucket','s3:GetBucketPublicAccessBlock','s3:GetEncryptionConfiguration','s3:GetBucketOwnershipControls','s3:GetBucketVersioning'], bucketArn, regional),
    statement('s3:GetObjectVersion', bucketArn + `/worker-v5/${S.appInstanceId}/*`, regional),
    statement('s3:PutObject', bucketArn + `/worker-v5/${S.appInstanceId}/*`, { StringEquals: { ...regional.StringEquals,
      's3:if-none-match': '*', 's3:x-amz-server-side-encryption': 'AES256' } }),
  ];
  C.secrets.forEach((name, index) => statements.push(statement('secretsmanager:GetSecretValue', secretPattern(name), {
    StringEquals: { ...regional.StringEquals, 'secretsmanager:VersionId': I.secretVersions[index] } })));
  return document(statements);
}
export function evidenceBucketPolicyV5() {
  const resource = [bucketArn, bucketArn + '/*'];
  return document([{ Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: resource,
    Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
  { Sid: 'RequireCreateOnlyWorkerPut', Effect: 'Deny', Principal: '*', Action: 's3:PutObject', Resource: bucketArn + `/worker-v5/${S.appInstanceId}/*`,
    Condition: { StringNotEquals: { 's3:if-none-match': '*' } } },
  { Sid: 'KeepWorkerReceipts', Effect: 'Deny', Principal: '*', Action: ['s3:DeleteObject','s3:DeleteObjectVersion'], Resource: bucketArn + `/worker-v5/${S.appInstanceId}/*` }]);
}
export function foundationTemplateV5(capsule) {
  const policy = workerPermissionsV5(capsule), allActions = [...new Set(policy.Statement.flatMap(s => s.Action))].sort(),
    tags = [{ Key: 'Environment', Value: 'aws-sandbox' }, { Key: 'Purpose', Value: 'cloud-worker-v5' }, { Key: 'AppInstanceId', Value: S.appInstanceId }];
  const boundary = document([statement(allActions, '*', { StringEquals: { 'aws:RequestedRegion': [region,'us-east-1'] } })]);
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'W5 cloud worker foundation only; no workload, no secret values, locked trust',
    Resources: {
      Boundary: { Type: 'AWS::IAM::ManagedPolicy', Properties: { ManagedPolicyName: C.boundary.split('/').at(-1), PolicyDocument: boundary } },
      WorkerRole: { Type: 'AWS::IAM::Role', Properties: { RoleName: C.role, MaxSessionDuration: 3600, PermissionsBoundary: { Ref: 'Boundary' },
        AssumeRolePolicyDocument: document([{ Effect: 'Deny', Principal: { Federated: C.oidc }, Action: 'sts:AssumeRoleWithWebIdentity' }]),
        Policies: [{ PolicyName: 'ExactSandboxWorkerV5', PolicyDocument: policy }], Tags: tags } },
      Journal: { Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { TableName: C.table,
        BillingMode: 'PAY_PER_REQUEST', DeletionProtectionEnabled: true, AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }], Tags: tags } },
      EvidenceBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { BucketName: C.bucket,
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] }, VersioningConfiguration: { Status: 'Enabled' },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }, Tags: tags } },
      EvidencePolicy: { Type: 'AWS::S3::BucketPolicy', DependsOn: 'EvidenceBucket', Properties: { Bucket: { Ref: 'EvidenceBucket' }, PolicyDocument: evidenceBucketPolicyV5() } },
    } };
}
export async function compileInstallReviewV5({ capsule, aws, github, neon }) {
  const n = neon.catalog, g = github.repository?.value;
  if (!g || g.id !== Number(I.repositoryId) || g.ownerId !== Number(I.ownerId) || g.visibility !== 'public' ||
    github.oidcSubject?.value?.sub_claim_prefix !== I.subject.split(':environment:')[0] || !github.oidcSubject.value.use_immutable_subject ||
    !aws.preservedIam?.iamLayoutUnchanged || !aws.oidcRoleReferenceScanComplete ||
    [aws.workerRole,aws.boundary,aws.journal,aws.evidenceBucket,...Object.values(aws.secrets)].some(r => r.state !== 'ABSENT_AT_CHECK') ||
    !n || n.candidate_role !== null || n.candidate_schema !== null || n.public_relation_grants.length || n.public_column_grants.length ||
    n.definers.some(f => f.publicExecutable) || n.installer.oid !== '16392') throw Error('INSTALL_REVIEW_PRESTATE_UNPROVED');
  const contract = await loadNeonContractV5(), sql = renderNeonContractV5(contract), foundation = foundationTemplateV5(capsule);
  const body = { schema: 'techlong/cloud-worker-install-design-review/v5', state: 'PREPARED_NOT_EXECUTABLE_NO_MUTATION_APPROVAL',
    currentRuntimeClosureSha256: '4bf7cb340a45d5ccf38f2d80e043763277a61c39514f661f7984280cf557139b',
    scope: I, inventorySha256: { aws: await sha256Hex(aws), github: await sha256Hex(github), neon: await sha256Hex(neon) },
    foundationTemplate: foundation, foundationTemplateSha256: await sha256Hex(foundation),
    secretReadIsolationPolicy: secretResourcePolicyV5(),
    secretInstallOrder: C.secrets.map((name, index) => ({ name, versionId: I.secretVersions[index], kms: 'AWS_MANAGED_DEFAULT',
      sequence: ['CreateSecretWithoutValue','PutResourcePolicyBlockPublicPolicyTrue','VerifyResourcePolicy','PutExactVersionValueOnce','DescribeMetadata'] })),
    neon: { role: C.roleDb, schema: C.schema, ownerOid: n.installer.oid, roleFlags: 'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      functions: sql.functions.map(f => f.name), contractSha256: contract.contractSha256, sqlSha256: await sha256Hex(sql.statements),
      existingAclRlsOrRowsChanged: false, passwordFromMemoryOnly: true, privilegedDsnUploaded: false },
    github: { environment: I.environment, reviewers: [{ type: 'User', id: Number(I.ownerId) }], preventSelfReview: false,
      adminBypass: false, deploymentBranch: 'main', oidcSubjectMutation: false, candidatesAreNotActiveWorkflows: true },
    executionBoundary: { paidCellCreated: false, newJobCreated: false, privateMaterialRead: false, existingIamChanged: false,
      automatedRollbackOrRetry: false, monthlyBudgetTargetUsd: 50, hardCostCap: false },
    activationPending: ['audited single-use installer and exact source/action hashes','immutable reusable workflow commit','fresh source identity and prestate',
      'explicit scoped installation approval','actual role/table/secret/version/function IDs before activation'],
  };
  return { ...body, reviewSha256: await sha256Hex(body) };
}
