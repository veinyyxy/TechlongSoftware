import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createAcceptanceReadonlyNeonSql } from '../../../lib/deployments/execution/single-tenant-control-bindings.ts';
import { inspectExpressDeliveryControlPlaneV1, EXPRESS_EPOCH_TABLE_V1 } from '../../../lib/deployments/execution/express-delivery-control-plane-v1.ts';
import { deriveExpressFirstDeploymentV1 } from '../../../lib/deployments/execution/express-deployment-scope-v1.ts';

/** Explicit read-only Source/Neon root. No PutItem/RunTask/GetSecretValue or
 * Aurora SQL client exists in this script. .env.local is loaded by Node, and
 * only its Neon URL is sent to the existing official Neon HTTPS endpoint. */
export async function inspect(args: string[]) {
  if (args.length !== 2 || args[0] !== '--review' || !args[1]) throw Error('EXPRESS_CONTROL_PLANE_ARGUMENTS_REJECTED');
  const bytes = await readFile(args[1]);
  if (bytes.length > 256_000) throw Error('EXPRESS_CONTROL_PLANE_INPUT_TOO_LARGE');
  const r = JSON.parse(bytes.toString('utf8'));
  const [ddb, sts, provider] = await Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/client-sts'), import('@aws-sdk/credential-provider-node')]);
  const config = { region: 'ca-central-1', credentials: provider.defaultProvider({ profile: 'techlong-sandbox-user' }), maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const dynamo = new ddb.DynamoDBClient(config), identity = new sts.STSClient(config), sql = createAcceptanceReadonlyNeonSql(process.env.DATABASE_URL ?? '');
  try {
    const signal = AbortSignal.timeout(60000), result = await inspectExpressDeliveryControlPlaneV1({ material: r.material, materialSha256: r.materialSha256, signal,
      port: { identity: s => identity.send(new sts.GetCallerIdentityCommand({}), { abortSignal: s }),
        async authority(key, s) { const out = await dynamo.send(new ddb.GetItemCommand({ TableName: EXPRESS_EPOCH_TABLE_V1,
          Key: { authority_key: { S: key } }, ConsistentRead: true }), { abortSignal: s }); return out.Item; },
        query: (text, values, s) => sql.query(text, values, s) } });
    const proposal = result.outcome === 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED'
      ? await deriveExpressFirstDeploymentV1({ material: r.material, materialSha256: r.materialSha256, subscriptionId: result.subscriptionId }) : null;
    return { mode: 'InspectOnly', result, proposal, auroraDatabaseReadAuthorized: false, executionAuthorized: false };
  } finally { dynamo.destroy(); identity.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await inspect(process.argv.slice(2)), null, 2)); }
  catch { console.error('EXPRESS_CONTROL_PLANE_INSPECT_FAILED_NO_WRITE'); process.exitCode = 1; }
}
