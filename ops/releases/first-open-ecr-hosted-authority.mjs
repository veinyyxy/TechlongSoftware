import { P as hostedPublisher } from '../platform-image-publication-v2/plan.mjs';
import { t42HostedEcrAuthorityMode, t42HostedEcrEnvironmentFor, validateT42EcrHostedWorkflows } from './first-open-ecr-hosted-context.mjs';
import { renderT42HostedEcrLedgerPolicy } from './first-open-ecr-hosted-ledger.mjs';
import { parseT42PrivateEcrArtifactsBinding, t42PrivateEcrArtifactScope } from './first-open-ecr-private-artifacts.mjs';
import { t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';

const { owner: account, region, bucket, prefix: archivePrefix, keys: archiveKeys } = t42PrivateEcrArtifactScope;
const provider = 'token.actions.githubusercontent.com';
const providerArn = `arn:aws:iam::${account}:oidc-provider/${provider}`;

function identity(name) {
  return Object.freeze({ name, arn: `arn:aws:iam::${account}:role/${name}` });
}

const roles = Object.freeze({
  reader: identity('TechlongSandboxT42EcrIndependentReaderRole'),
  custody: identity('TechlongSandboxT42EcrPublicationCustodyRole'),
});
export const t42HostedEcrAuthorityScope = Object.freeze({ account, region, bucket, providerArn, archivePrefix, archiveKeys, roles });

function check(condition, code) {
  if (!condition) throw Error('T42_ECR_HOSTED_AUTHORITY_' + code);
}

function exact(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function dateValue(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isSafeInteger(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}

function datesFor(startsAt, expiresAt) {
  const start = dateValue(startsAt), end = dateValue(expiresAt);
  check(start < end && end - start <= 3_600_000, 'WINDOW');
  return { DateGreaterThanEquals: { 'aws:CurrentTime': startsAt }, DateLessThan: { 'aws:CurrentTime': expiresAt } };
}

export function validateT42HostedEcrRoleSession(lane, expected) {
  check(Object.hasOwn(roles, lane) && exact(expected, ['arn', 'userId']), 'SESSION');
  const prefix = `arn:aws:sts::${account}:assumed-role/${roles[lane].name}/`;
  const session = typeof expected.arn === 'string' && expected.arn.startsWith(prefix) && expected.arn.slice(prefix.length);
  const parts = typeof expected.userId === 'string' && expected.userId.split(':');
  check(typeof session === 'string' && /^[A-Za-z0-9+=,.@_-]{2,64}$/.test(session) && parts && parts.length === 2 &&
    /^AROA[A-Z0-9]{12,124}$/.test(parts[0]) && parts[1] === session, 'SESSION');
  return { arn: expected.arn, userId: expected.userId };
}

/** Compare the independently read STS caller with the exact approved role session. */
export function projectT42HostedEcrRoleSession(lane, expected, actual) {
  const approved = validateT42HostedEcrRoleSession(lane, expected);
  check(actual?.Account === account && actual.Arn === approved.arn && actual.UserId === approved.userId, 'CALLER');
  return approved;
}

function trust(side, workflow, dates) {
  const { repository, repositoryId, ownerId, actorId } = hostedPublisher;
  const { environment, subject } = t42HostedEcrEnvironmentFor(side, t42HostedEcrAuthorityMode);
  return {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow', Principal: { Federated: providerArn }, Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: {
          [`${provider}:aud`]: 'sts.amazonaws.com',
          [`${provider}:sub`]: subject,
          [`${provider}:repository_id`]: String(repositoryId),
          [`${provider}:repository_owner_id`]: ownerId,
          [`${provider}:actor_id`]: actorId,
          [`${provider}:ref`]: 'refs/heads/main',
          [`${provider}:environment`]: environment,
          [`${provider}:job_workflow_ref`]: `${repository}/${workflow.reusablePath}@${workflow.reusableCommit}`,
        },
        ...dates,
      },
    }],
  };
}

function permissions(stage, statements, dates) {
  const policy = renderT42HostedEcrLedgerPolicy(stage);
  return {
    ...policy, Statement: [...policy.Statement, ...statements].map(statement => ({
      ...statement, Condition: { ...statement.Condition, ...dates },
    })),
  };
}

/** Render only local IAM review candidates. The same permissions may serve as each role's boundary. */
export function renderT42HostedEcrAuthority({ workflows, archiveVersions, startsAt, expiresAt } = {}) {
  validateT42EcrHostedWorkflows(workflows);
  const { versions } = parseT42PrivateEcrArtifactsBinding({ owner: account, region, bucket, prefix: archivePrefix, versions: archiveVersions });
  check(Object.values(versions).every(version => !version.includes('${')), 'ARCHIVE_POLICY_VARIABLE');
  const dates = datesFor(startsAt, expiresAt);
  const repositoryArns = t42RawEcrTargets.map(target => `arn:aws:ecr:${region}:${account}:repository/${target.repositoryName}`);
  const readArchives = t42RawEcrTargets.map(({ short }) => ({
    Sid: short === 'platform' ? 'ReadExactPlatformArchiveVersion' : 'ReadExactTenantArchiveVersion',
    Effect: 'Allow', Action: 's3:GetObjectVersion', Resource: `arn:aws:s3:::${bucket}/${archiveKeys[short]}`,
    Condition: { StringEquals: { 'aws:RequestedRegion': region, 's3:VersionId': versions[short] } },
  }));
  return {
    reader: {
      role: roles.reader, trustPolicy: trust('reader', workflows.reader, dates),
      permissionsPolicy: permissions('reader', [{
        Sid: 'ReadOnlyTheTwoT42Repositories',
        Effect: 'Allow', Action: ['ecr:DescribeImages', 'ecr:BatchGetImage'], Resource: repositoryArns,
        Condition: { StringEquals: { 'aws:RequestedRegion': region } },
      }], dates),
    },
    custody: {
      role: roles.custody, trustPolicy: trust('publisher', workflows.publisher, dates),
      permissionsPolicy: permissions('publisher', readArchives, dates),
    },
  };
}
