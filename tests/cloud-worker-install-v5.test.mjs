import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { workerTrustV5, workerPermissionsV5, secretResourcePolicyV5, foundationTemplateV5, evidenceBucketPolicyV5,
  compileInstallReviewV5, INSTALL_SCOPE_V5 as I } from '../ops/cloud-worker/install/plan-v5.mjs';
import { NEON_INSTALL_INVENTORY_SQL_V5 } from '../ops/cloud-worker/install/inventory-v5.mjs';
const capsule = JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json', import.meta.url), 'utf8'));
const actions = p => p.Statement.flatMap(s => s.Action);
test('immutable subject/IDs, main, environment and exact reusable SHA all constrain trust without repo subject mutation', () => {
  const c = workerTrustV5('a'.repeat(40)).Statement[0].Condition.StringEquals;
  assert.equal(c['token.actions.githubusercontent.com:sub'], I.subject);
  assert.equal(c['token.actions.githubusercontent.com:repository_id'], '1323312747');
  assert.equal(c['token.actions.githubusercontent.com:repository_owner_id'], '14145707');
  assert.equal(c['token.actions.githubusercontent.com:ref'], 'refs/heads/main');
  assert.equal(c['token.actions.githubusercontent.com:environment'], I.environment);
  assert.ok(c['token.actions.githubusercontent.com:job_workflow_ref'].endsWith('@' + 'a'.repeat(40)));
  assert.throws(() => workerTrustV5('main'));
});
test('five foundation resources, locked initial trust, retained protected journal/private versioned bucket; no workload/secret value', () => {
  const t = foundationTemplateV5(capsule), r = t.Resources;
  assert.equal(Object.keys(r).length, 5); assert.equal(r.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Effect, 'Deny');
  assert.equal(r.Journal.Properties.DeletionProtectionEnabled, true); assert.equal(r.Journal.DeletionPolicy, 'Retain');
  assert.equal(r.Journal.Properties.TimeToLiveSpecification, undefined); assert.equal(r.EvidenceBucket.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.equal(Object.values(r.EvidenceBucket.Properties.PublicAccessBlockConfiguration).every(Boolean), true);
  assert.equal(Object.values(r).some(x => /SecretsManager|ECS|RDS|Lambda/.test(x.Type)), false);
  assert.ok(Buffer.byteLength(JSON.stringify(r.Boundary.Properties.PolicyDocument)) < 6144);
  assert.ok(Buffer.byteLength(JSON.stringify(r.WorkerRole.Properties.Policies[0].PolicyDocument)) < 10240);
});
test('worker only gets two exact new version reads, metadata-only old secrets, CFN-only PassRole; no IAM install/delete/SQL/KMS capability', () => {
  const p = workerPermissionsV5(capsule), a = actions(p), reads = p.Statement.filter(s => s.Action === 'secretsmanager:GetSecretValue');
  assert.equal(reads.length, 2); assert.deepEqual(reads.map(s => s.Condition.StringEquals['secretsmanager:VersionId']), I.secretVersions);
  assert.ok(reads.every(s => s.Resource.includes('/deployment-worker/') && s.Resource.endsWith('-??????')));
  const pass = p.Statement.find(s => s.Action === 'iam:PassRole');
  assert.equal(pass.Resource, capsule.base.iam.cfnRole.arn); assert.equal(pass.Condition.StringEquals['iam:PassedToService'], 'cloudformation.amazonaws.com');
  for (const forbidden of ['cloudformation:DeleteStack','cloudformation:ExecuteChangeSet','iam:CreateRole','iam:PutRolePolicy','s3:DeleteObject',
    'dynamodb:DeleteItem','dynamodb:UpdateItem','secretsmanager:PutSecretValue','lambda:InvokeFunction','rds-db:connect','kms:Decrypt']) assert.ok(!a.includes(forbidden));
  assert.ok(a.includes('dynamodb:ConditionCheckItem')); assert.ok(!a.includes('dynamodb:TransactWriteItems'));
  assert.equal(p.Statement.find(s => s.Action === 's3:PutObject').Condition.StringEquals['s3:if-none-match'], '*');
});
test('new Secret resource policies deny legacy broad reader and allow management only to Source', () => {
  const [read, manage] = secretResourcePolicyV5().Statement;
  assert.equal(read.Effect, 'Deny'); assert.equal(read.Action, 'secretsmanager:GetSecretValue'); assert.equal(read.Principal, '*');
  assert.deepEqual(read.Condition.ArnNotEquals['aws:PrincipalArn'], [I.roleArn, I.sourceArn]);
  assert.ok(!JSON.stringify(read).includes('TechlongSandboxTaskExecutionRole'));
  assert.equal(manage.Condition.ArnNotEquals['aws:PrincipalArn'], I.sourceArn); assert.ok(manage.Action.includes('secretsmanager:PutResourcePolicy'));
  const denyPut = evidenceBucketPolicyV5().Statement.find(s => s.Sid === 'RequireCreateOnlyWorkerPut');
  assert.equal(denyPut.Condition.StringNotEquals['s3:if-none-match'], '*'); // literal *, deliberately NOT Like
});
test('catalog query remains read-only, no password/source/value fields; uses PostgreSQL internal char type', () => {
  assert.doesNotMatch(NEON_INSTALL_INVENTORY_SQL_V5.replace(/'(?:''|[^'])*'/g, "''"), /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|REVOKE)\b|rolpassword|prosrc/);
  assert.match(NEON_INSTALL_INVENTORY_SQL_V5, /'s'::"char"/);
});
test('design compiler fails closed for existing names, unknown IAM or public read capabilities', async () => {
  const absent = { state: 'ABSENT_AT_CHECK' }, aws = { preservedIam: { iamLayoutUnchanged: true }, oidcRoleReferenceScanComplete: true,
    workerRole: absent, boundary: absent, journal: absent, evidenceBucket: absent, secrets: { db: absent, control: absent } },
    github = { repository: { value: { id: Number(I.repositoryId), ownerId: Number(I.ownerId), visibility: 'public' } },
      oidcSubject: { value: { sub_claim_prefix: I.subject.split(':environment:')[0], use_immutable_subject: true } } },
    neon = { catalog: { candidate_role: null, candidate_schema: null, public_database_create: false, public_create_schemas: [],
      public_relation_grants: [], public_column_grants: [], definers: [], installer: { oid: '16392' } } };
  const r = await compileInstallReviewV5({ capsule, aws, github, neon }); assert.equal(r.state, 'PREPARED_NOT_EXECUTABLE_NO_MUTATION_APPROVAL');
  assert.equal(r.github.oidcSubjectMutation, false); assert.equal(r.executionBoundary.paidCellCreated, false);
  await assert.rejects(compileInstallReviewV5({ capsule, aws: { ...aws, workerRole: { state: 'READ' } }, github, neon }));
  await assert.rejects(compileInstallReviewV5({ capsule, aws, github, neon: { catalog: { ...neon.catalog, public_relation_grants: ['unsafe'] } } }));
  await assert.rejects(compileInstallReviewV5({ capsule, aws, github, neon: { catalog: { ...neon.catalog, public_database_create: true } } }));
  await assert.rejects(compileInstallReviewV5({ capsule, aws, github, neon: { catalog: { ...neon.catalog, public_create_schemas: ['untrusted'] } } }));
});
