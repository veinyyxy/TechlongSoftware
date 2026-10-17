import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../../lib/deployments/initialized-platform-request-v1.ts';
import { prepareExpressInitializedWorkerV2 } from '../../lib/deployments/execution/express-initialized-worker-v2.ts';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
export const PUBLIC_CAPSULE_SHA256_V5 = '5c7e5eeff2febef52b469487e0bd7d170e711fb2b26e3df81162b5b46c6e2e14';
const W4 = Object.freeze({ jobId: 'job_fe5ced28b698d0bf128e7b42',
  stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/aa962890-c9e4-11f1-988b-06ffcd51c63d',
  taskDefinitionArn: 'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:5',
  receiptSha256: 'd350a38748a2d1fe70c2e2dfc2768534c53aedc07a44994b571963a500da6bdb' });
export const W5_CONTROL_FINGERPRINTS = Object.freeze({
  publicKeySha256: '72f953b9f3dab5269a7a1c08fa7acf684d2d9c379ae446b50e3d8294404f02a2',
  clientCertificateSha256: '195690a24ed53f23ea891158cbe5c6472cdff098b8c5e250dc2171c5c31c9182',
  clientCaSha256: 'e60ee2d18d79c7e28c1e1dae192798ba7e18c5a106dcb5e280c1dd5643d27d5d' });
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export async function verifyCloudPredecessorV5(lineage) {
  const l = structuredClone(lineage), r = l?.receipt, p = l?.providerObservation;
  must(l && Object.keys(l).sort().join(',') === 'predecessor,providerObservation,receipt' && same(l.predecessor, W4) &&
    await sha256Hex(r) === W4.receiptSha256 && r.jobId === W4.jobId && r.stackId === W4.stackId &&
    r.materialSha256 === S.materialSha256 && r.configurationHash === S.configurationHash && r.imageUri === S.artifactRef &&
    r.initializedVerified === true && r.effectiveConfigurationVerified === true && r.existingDefaultStoreId === S.existingDefaultStoreId &&
    r.epoch === S.epoch && r.operationHash === S.operationHash, 'EXACT_W4C_RECEIPT_LINEAGE');
  must(p && Object.keys(p).sort().join(',') === 'checkedAt,imageUri,physical,stackId,taskArn' &&
    p.stackId === W4.stackId && p.physical?.TenantTaskDefinition === W4.taskDefinitionArn &&
    p.imageUri === r.imageUri && p.checkedAt === r.providerCheckedAt && await sha256Hex(p) === r.providerObservationSha256 &&
    Object.keys(p.physical).length === 7, 'EXACT_W4C_PROVIDER_LINEAGE');
  return freeze(structuredClone(W4)); // Expiry is NOT live retirement proof.
}
export async function prepareCloudContextV5(capsule) {
  const v = structuredClone(capsule), { capsuleSha256, ...body } = v;
  must(v.schema === 'techlong/cloud-worker-public-capsule/v5' && Object.keys(body).sort().join(',') ===
    'base,controlFingerprints,delivery,lineage,publicParameters,schema,sourceWitnesses' &&
    capsuleSha256 === PUBLIC_CAPSULE_SHA256_V5 && await sha256Hex(body) === capsuleSha256, 'PUBLIC_CAPSULE_HASH');
  const predecessor = await verifyCloudPredecessorV5(v.lineage);
  must(same(v.controlFingerprints, W5_CONTROL_FINGERPRINTS) && same(v.delivery.scope, {
    ...v.delivery.scope, appInstanceId: S.appInstanceId, ownerDeploymentId: S.deploymentId, workspaceId: S.workspaceId,
    environmentId: S.environmentId, productId: S.productId, cellKey: S.cellKey }), 'PUBLIC_SCOPE_OR_CONTROL_PINS');
  const root = await prepareExpressInitializedWorkerV2({ delivery: v.delivery, existingDefaultStoreId: S.existingDefaultStoreId });
  must(root.materialSha256 === S.materialSha256 && v.base.predecessorStackId === predecessor.stackId &&
    v.base.predecessorTaskDefinitionArn === predecessor.taskDefinitionArn &&
    Object.keys(v.publicParameters).sort().join(',') === 'ControlIssuer,CorsAllowedOrigins,StripeCancelUrl,StripePublishableKey,StripeSuccessUrl' &&
    v.publicParameters.ControlIssuer === 'https://techlong.cloud', 'PUBLIC_MATERIAL_RECONSTRUCTION');
  return Object.freeze({ root, predecessor, capsuleSha256, base: freeze(v.base), publicParameters: freeze(v.publicParameters),
    controlFingerprints: freeze(v.controlFingerprints), currentCloudHealthProved: false, executionAuthorized: false, runtimeEnabled: false });
}
