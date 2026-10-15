import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareExpressSingleTenantDeliveryV1 } from '../../../lib/deployments/execution/express-single-tenant-delivery-v1.ts';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';

/** Reads ONLY three expressly named non-secret historical metadata files.
 * Does not load .env/private-material, create SDK clients, connect SQL, write
 * files, create a permanent execution slot, or turn a proposal into approval.
 */
export async function reviewExpressDeliveryFromFiles(args: string[]) {
  const renderCell = args.at(-1) === '--render-cell';
  if (renderCell) args = args.slice(0, -1);
  const names = ['--business-review', '--legacy-binding', '--runtime-binding'];
  if (args.length !== 6 || names.some(n => args.filter(v => v === n).length !== 1) ||
      args.some((v, index) => index % 2 === 0 ? !names.includes(v) : !v || v.startsWith('--'))) throw Error('EXPRESS_DELIVERY_REVIEW_ARGUMENTS_REJECTED');
  const read = async (name: string) => {
    const bytes = await readFile(args[args.indexOf(name) + 1]);
    if (bytes.length > 256_000) throw Error('EXPRESS_DELIVERY_REVIEW_INPUT_TOO_LARGE');
    return { sha256: await sha256Hex(bytes.toString('utf8')), value: JSON.parse(bytes.toString('utf8')) };
  };
  const [business, legacy, runtime] = await Promise.all(names.map(read));
  const m = business.value.material, previous = legacy.value, b = runtime.value.binding;
  if (business.value.manifestSha256 !== '7b741e2278d93c23c1885d33df89469ec03012b6842766a39e95d69083d32afc' ||
      canonicalJson(m.futureScope) !== canonicalJson(previous.scope) || canonicalJson(m.plan) !== canonicalJson(previous.plan) ||
      m.seed.workspaceId !== previous.workspaceId || m.productId !== previous.productId || m.templateVersionId !== previous.templateVersionId ||
      runtime.value.schema !== 'techlong/express-runtime-binding-candidate/v7' ||
      b.stableIdentity !== 'a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d') throw Error('EXPRESS_DELIVERY_HISTORICAL_INPUTS_REJECTED');
  const environment = { ...business.value.inventory.environment, policy: m.targetPolicy };
  const root = await prepareExpressSingleTenantDeliveryV1({ scope: { appInstanceId: previous.scope.appInstanceId,
    ownerDeploymentId: previous.scope.deploymentId, workspaceId: previous.workspaceId, productId: previous.productId,
    templateVersionId: previous.templateVersionId, environmentId: previous.scope.environmentId, cellKey: 'cell-sandbox-1' },
    sourcePlan: previous.plan, sourcePlanSha256: previous.scope.planHash,
    configuration: m.configuration, configurationSha256: previous.scope.configurationHash,
    configurationSchema: business.value.inventory.plan.schema, environment, binding: b,
    databaseOid: '16459', roleOid: '16456', tenantHostname: 'first-acceptance.sandbox.techlong.cloud' });
  return { mode: 'ReviewOnly', historicalMetadataOnly: true, noLiveOwnerOrEpochClaimed: true,
    proposedOwnerSource: 'unchanged D001 futureScope; NOT proved as installed Express database owner',
    sourceFilesSha256: Object.fromEntries(names.map((name, index) => [name.slice(2), [business, legacy, runtime][index].sha256])),
    materialSha256: root.materialSha256, material: root.material,
    cloudWrites: 0, sqlConnections: 0, secretValuesRead: 0, privateBundleReads: 0, executionSlotsConsumed: 0,
    executionAuthorized: false, deploymentApprovalManifestIssued: false,
    ...(renderCell ? { cellCandidate: await root.renderCell({ requestedAt: Date.now(), availabilityZones: ['ca-central-1a', 'ca-central-1b'],
      certificateArn: 'arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d',
      controlTrustStoreArn: 'arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44' }) } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await reviewExpressDeliveryFromFiles(process.argv.slice(2)), null, 2)); }
  catch { console.error('EXPRESS_DELIVERY_REVIEW_FAILED_NO_WRITE'); process.exitCode = 1; }
}
