// Frozen-source activation bridge. Publishing this source does not activate OIDC.
import { pathToFileURL } from 'node:url';
import { STSClient, AssumeRoleWithWebIdentityCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { computeCloudClosureV5 } from '../closure-v5.mjs';
import { runWorkflowV5, validateWorkflowInputV5 } from '../workflow-input-v5.mjs';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
import { createCloudSessionV5 } from '../cloud-session-v5.mjs';
import { createNarrowNeonV5, createNeonRpcTransportV5 } from '../neon-persistence-v5.mjs';
import { validateDatabaseMaterialV5 } from '../cloud-application-v5.mjs';
import { assertEvidenceSafeV5, EVIDENCE_V5 } from '../cloud-evidence-v5.mjs';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
export const ROOT_CLOSURE_V5 = 'e06c12e53732268ca1665ca6ec77805bd626c9f2bce1d44f66ef8efa430e5299';
export const INSTALLED_SHA_V5 = '0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1';
const roleId = 'AROAV3GNMXTZK5O45RG24', roleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxGitHubDeploymentWorkerRole';
const must = (ok,code) => { if (!ok) throw Error('ACTIVATION_RUNTIME_' + code); };
export function validateActivationRunV5(env,closure) {
  must(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === 'veinyyxy/TechlongSoftware' && env.GITHUB_REPOSITORY_ID === '1323312747' &&
    env.GITHUB_REPOSITORY_OWNER_ID === '14145707' && env.GITHUB_ACTOR_ID === '14145707' && env.GITHUB_REF === 'refs/heads/main' &&
    env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_RUN_ATTEMPT === '1' && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA) &&
    /^[a-f0-9]{40}$/.test(env.TECHLONG_FROZEN_SOURCE_COMMIT) && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID) &&
    env.GITHUB_WORKFLOW_REF === 'veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-execute.yml@refs/heads/main' &&
    env.TECHLONG_EXPECTED_INSTALLATION_SHA === INSTALLED_SHA_V5 && closure.closureSha256 === ROOT_CLOSURE_V5 &&
    !['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].some(k => env[k]) &&
    env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !Object.keys(env).some(k => /^AWS_ENDPOINT_URL/.test(k)), 'IDENTITY_OR_SOURCE');
  const input = Object.fromEntries(['mode','job','installation','installationSha','manifest','manifestSha','execution','lineage']
    .map(k => [k,env['TECHLONG_INPUT_' + k.toUpperCase()] ?? '']));
  must(input.installationSha === INSTALLED_SHA_V5,'INSTALLATION');
  if (input.mode === 'VerifyInstall') {
    must(['job','manifest','manifestSha','execution','lineage'].every(k => input[k] === ''),'PROBE_NO_JOB');
    validateWorkflowInputV5({ ...input,mode: 'Review',job: 'job_' + '0'.repeat(24) });
  } else validateWorkflowInputV5(input);
  return input;
}
export async function verifyCloudInstalledV5({ reference,run,sourceCommit,port,expectedInstallationSha256 = INSTALLED_SHA_V5 }) {
  const counters = { bindingReads: 0,identityReads: 0,databaseSecretReads: 0,catalogTransactions: 0,controlSecretReads: 0,cloudWrites: 0,databaseWrites: 0 };
  counters.identityReads++; const who = await port.identity();
  must(who.Account === '402010193138' && who.UserId === roleId + ':Deploy-' + run.runId + '-1' &&
    who.Arn === 'arn:aws:sts::402010193138:assumed-role/TechlongSandboxGitHubDeploymentWorkerRole/Deploy-' + run.runId + '-1','ASSUMED_ROLE');
  counters.bindingReads++; const raw = await port.binding(reference);
  const binding = await assertInstallationV5(raw,expectedInstallationSha256,await loadNeonContractV5());
  must(binding.roleId === roleId && binding.tableId === 'ea69c69e-1c48-481a-83f0-36393c196d9f','ACTUAL_IDS');
  counters.databaseSecretReads++; const material = await port.database(binding.databaseSecret);
  const url = await validateDatabaseMaterialV5(material,binding.neon.endpointSha256);
  counters.catalogTransactions++; await port.catalog(url,binding.neon);
  const result = { schema: 'techlong/cloud-worker-cloud-install-proof/v5',outcome: 'CLOUD_IDENTITY_FIXED_BINDING_DATABASE_CATALOG_VERIFIED',
    installationSha256: expectedInstallationSha256,run,frozenSourceCommit: sourceCommit,rootClosureSha256: ROOT_CLOSURE_V5,counters,
    controlMaterialOrApplicationVerified: false,workloadDeploymentPerformed: false,retryAllowed: false };
  assertEvidenceSafeV5(result); return result;
}
export async function activationRuntimeV5() {
  const input = validateActivationRunV5(process.env,await computeCloudClosureV5());
  if (input.mode !== 'VerifyInstall') return runWorkflowV5();
  const endpoint = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  must(endpoint.protocol === 'https:' && endpoint.hostname.endsWith('.actions.githubusercontent.com') && !endpoint.username && !endpoint.password,'OIDC_ENDPOINT');
  endpoint.searchParams.set('audience','sts.amazonaws.com');
  const response = await fetch(endpoint,{ headers: { authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    redirect: 'error',signal: AbortSignal.timeout(15000) });
  must(response.ok,'OIDC_RESPONSE'); const text = await response.text(); must(text.length < 20000,'OIDC_SIZE');
  const token = JSON.parse(text).value; must(typeof token === 'string' && token.length < 15000,'OIDC_TOKEN');
  const cfg = { region: 'ca-central-1',ignoreConfiguredEndpointUrls: true,maxAttempts: 1 },sts = new STSClient(cfg);
  let authSts,s3,sm;
  try {
    const r = await sts.send(new AssumeRoleWithWebIdentityCommand({ RoleArn: roleArn,RoleSessionName: 'Deploy-' + process.env.GITHUB_RUN_ID + '-1',
      WebIdentityToken: token,DurationSeconds: 3600 }),{ abortSignal: AbortSignal.timeout(30000) });
    const c = r.Credentials; must(c?.Expiration && c.AccessKeyId && c.SecretAccessKey && c.SessionToken,'TEMPORARY_SESSION');
    const run = { repository: process.env.GITHUB_REPOSITORY,runId: process.env.GITHUB_RUN_ID,runAttempt: 1,commitSha: process.env.GITHUB_SHA };
    const session = createCloudSessionV5({ credentials: async () => ({ accessKeyId: c.AccessKeyId,secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,expiration: c.Expiration }),expected: { ...run,roleId } });
    authSts = new STSClient(session.clientConfig()); s3 = new S3Client(session.clientConfig()); sm = new SecretsManagerClient(session.clientConfig());
    const signal = AbortSignal.timeout(120000), options = { abortSignal: signal };
    const result = await verifyCloudInstalledV5({ reference: JSON.parse(input.installation),run,sourceCommit: process.env.TECHLONG_FROZEN_SOURCE_COMMIT,
      port: {
        identity: () => authSts.send(new GetCallerIdentityCommand({}),options),
        async binding(ref) {
          const o = await s3.send(new GetObjectCommand({ Bucket: EVIDENCE_V5.bucket,ExpectedBucketOwner: EVIDENCE_V5.owner,Key: ref.key,VersionId: ref.versionId }),options);
          must(o.VersionId === ref.versionId && o.ServerSideEncryption === 'AES256' && o.ContentLength > 0 && o.ContentLength < 10000,'BINDING_METADATA');
          const raw = await o.Body.transformToString(); must(Buffer.byteLength(raw) < 10000,'BINDING_SIZE');
          const value = JSON.parse(raw); assertEvidenceSafeV5(value); must(await sha256Hex(value) === ref.sha256,'BINDING_DIGEST'); return value;
        },
        async database(ref) {
          const v = await sm.send(new GetSecretValueCommand({ SecretId: ref.arn,VersionId: ref.versionId,VersionStage: 'AWSCURRENT' }),options);
          must(v.ARN === ref.arn && v.VersionId === ref.versionId && v.Name === 'techlong/sandbox/deployment-worker/neon-control-v1' &&
            v.VersionStages?.length === 1 && v.VersionStages[0] === 'AWSCURRENT' && !v.SecretBinary && typeof v.SecretString === 'string' &&
            Buffer.byteLength(v.SecretString) < 12000,'DATABASE_VERSION'); return JSON.parse(v.SecretString);
        },
        async catalog(url,expected) {
          const db = createNarrowNeonV5({ transport: createNeonRpcTransportV5(url),contract: await loadNeonContractV5(),expected }); await db.verify(signal);
        },
      } });
    console.log(JSON.stringify(result,null,2)); return result;
  } finally { sts.destroy(); authSts?.destroy(); s3?.destroy(); sm?.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) activationRuntimeV5().catch(() => {
  console.error('ACTIVATION_RUNTIME_STOPPED_NO_AUTOMATIC_RETRY'); process.exitCode = 1;
});
