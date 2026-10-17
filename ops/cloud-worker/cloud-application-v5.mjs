// Concrete SDK/RPC/S3/DynamoDB composition. No network or secret read on construction.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { openDynamoCloudWorkerJournalV1 } from '../../lib/deployments/execution/cloud-worker-journal-v1.ts';
import { createCloudSessionV5 } from './cloud-session-v5.mjs';
import { createCloudInitializedAwsV5 } from './aws-initialized-workload-v5.mjs';
import { createFixedControlSecretLoaderV5 } from './cloud-control-v5.mjs';
import { prepareCloudContextV5 } from './cloud-context-v5.mjs';
import { createCloudEvidenceV5 } from './cloud-evidence-v5.mjs';
import { loadNeonContractV5, NEON_V5 } from './neon-contract-v5.mjs';
import { createNeonRpcTransportV5, createNarrowNeonV5 } from './neon-persistence-v5.mjs';
import { assertInstallationV5, continueCloudContextV5, createCloudWorkerRootV5 } from './cloud-worker-root-v5.mjs';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
export async function validateDatabaseMaterialV5(payload, endpointSha256) {
  must(payload && Object.keys(payload).sort().join(',') === 'databaseUrl,schema' &&
    payload.schema === 'techlong/cloud-worker-neon-material/v5' && typeof payload.databaseUrl === 'string', 'NEON_SECRET_SCHEMA');
  const u = new URL(payload.databaseUrl);
  must(u.protocol === 'postgresql:' && decodeURIComponent(u.username) === NEON_V5.role && !!u.password &&
    /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) && (!u.port || u.port === '5432') &&
    /^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname) && !u.hash && [...u.searchParams.keys()].length === 1 &&
    u.searchParams.get('sslmode') === 'verify-full', 'NEON_FIXED_TLS_ENDPOINT');
  const actual = await sha256Hex({ host: u.hostname, port: 5432, database: u.pathname.slice(1), role: NEON_V5.role, transport: 'NeonHTTPS' });
  must(actual === endpointSha256, 'NEON_ENDPOINT_BINDING'); return payload.databaseUrl;
}
export async function createCloudApplicationV5({ capsule, links = [], installation: raw, approvedInstallationSha256, code, run, credentials }) {
  must(code.commitSha === run.commitSha && /^[a-f0-9]{64}$/.test(code.closureSha256), 'CLOUD_CODE_RUN_BINDING');
  const contract = await loadNeonContractV5(), installation = await assertInstallationV5(raw, approvedInstallationSha256, contract);
  const context = await continueCloudContextV5(await prepareCloudContextV5(capsule), links);
  const session = createCloudSessionV5({ credentials, expected: { ...run, roleId: installation.roleId } });
  const sm = new SecretsManagerClient({ ...session.clientConfig(), endpoint: 'https://secretsmanager.ca-central-1.amazonaws.com' });
  const provider = createCloudInitializedAwsV5(context.base, session), evidence = createCloudEvidenceV5(session);
  let databaseOpened = false;
  const secretRead = (reference, signal) => sm.send(new GetSecretValueCommand({ SecretId: reference.arn, VersionId: reference.versionId,
    VersionStage: 'AWSCURRENT' }), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  const root = createCloudWorkerRootV5({ context, installation, contract, code, run, provider, evidence,
    async openDatabase(signal) {
      must(!databaseOpened, 'DATABASE_SECRET_ONCE'); databaseOpened = true;
      // Assert cloud role before sending the first credential-bearing read.
      // readCell additionally proves the idle Cell, but STS is always checked
      // independently even in Inspect (which does not require idle capacity).
      const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
      const sts = new STSClient({ ...session.clientConfig(), endpoint: 'https://sts.ca-central-1.amazonaws.com' });
      try { session.assertIdentity(await sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal })); } finally { sts.destroy(); }
      const reference = installation.databaseSecret, r = await secretRead(reference, signal);
      must(r.ARN === reference.arn && r.VersionId === reference.versionId &&
        r.Name === 'techlong/sandbox/deployment-worker/neon-control-v1' && r.VersionStages?.length === 1 && r.VersionStages[0] === 'AWSCURRENT' &&
        !r.SecretBinary && typeof r.SecretString === 'string' && Buffer.byteLength(r.SecretString) <= 12000, 'NEON_FIXED_SECRET_VERSION');
      const databaseUrl = await validateDatabaseMaterialV5(JSON.parse(r.SecretString), installation.neon.endpointSha256);
      return createNarrowNeonV5({ transport: createNeonRpcTransportV5(databaseUrl), contract, expected: installation.neon });
    },
    async loadControl({ beforeRead, signal }) {
      const loader = createFixedControlSecretLoaderV5({ reference: installation.controlSecret, expected: context.controlFingerprints,
        getSecretValue: input => secretRead({ arn: input.SecretId, versionId: input.VersionId }, signal), beforeRead });
      return loader.loadOnce(signal);
    },
    openJournal: (binding, signal) => openDynamoCloudWorkerJournalV1({ binding, tableId: installation.tableId, signal,
      credentials: session.clientConfig().credentials }),
  });
  return Object.freeze({ ...root, dispose() { provider.dispose(); evidence.dispose(); sm.destroy(); } });
}
