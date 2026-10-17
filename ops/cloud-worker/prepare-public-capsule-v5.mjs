// Local PUBLIC-history packaging tool ONLY, never imported by cloud runtime.
// No .env, Secret values, private-material.json, DB or AWS calls/writes.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { platformPublicContextV4 } from '../aws-sandbox/scripts/run-express-platform-worker-v4.mjs';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { INITIALIZED_PLATFORM_SCOPE as S } from '../../lib/deployments/initialized-platform-request-v1.ts';
import { prepareCloudContextV5, W5_CONTROL_FINGERPRINTS } from './cloud-context-v5.mjs';
import { requireCloudV5 as must } from './cloud-session-v5.mjs';
export async function buildPublicCapsuleV5() {
  const c = await platformPublicContextV4();
  const record = JSON.parse(await readFile(new URL('../aws-sandbox/reviews/aurora-dual-mode-w4c-platform-request.executed.json', import.meta.url), 'utf8'));
  must(record.approvedManifestSha256 === 'aad135499b74f8b93fe3f0204dc70a81bfe5ec7aec4e38b0afe5c5148a0add34' &&
    record.run.outcome === 'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED' && record.run.samePlatformJob === true &&
    record.independentInspect.completion === 'SAME_PLATFORM_JOB_SUCCEEDED_OLD_ROWS_PRESERVED' &&
    record.independentInspect.provider === 'EXACT_WORKLOAD_PROVED', 'KNOWN_W4C_EXECUTION');
  const witnesses = {};
  const original = async name => {
    const pin = record.rawEvidence.find(p => p.path === record.run.directory + '/' + name);
    must(pin && ['provider-after.json', 'completion-reference.json'].includes(name), 'PUBLIC_WITNESS_ALLOWLIST');
    const raw = await readFile(pin.path, 'utf8'); must(await sha256Hex(raw) === pin.rawFileSha256, 'PUBLIC_WITNESS_DRIFT');
    witnesses[name] = pin.rawFileSha256; return JSON.parse(raw);
  };
  const provider = await original('provider-after.json'), completion = await original('completion-reference.json');
  const receipt = JSON.parse(completion.outputs).expressInitializedWorkerRunsV2[record.jobId];
  const predecessor = { jobId: receipt.jobId, stackId: provider.stackId, taskDefinitionArn: provider.physical.TenantTaskDefinition,
    receiptSha256: record.run.receiptSha256 };
  const providerObservation = { stackId: provider.stackId, physical: provider.physical, taskArn: provider.taskArn, imageUri: provider.imageUri, checkedAt: provider.checkedAt };
  const body = { schema: 'techlong/cloud-worker-public-capsule/v5',
    delivery: { ...c.inputs.delivery, scope: { ...c.inputs.delivery.scope, ownerDeploymentId: S.deploymentId } },
    base: { ...c.base, compute: { stackId: c.base.compute.stackId, outputs: c.base.compute.outputs, templateSha256: c.base.compute.templateSha256 },
      predecessorStackId: predecessor.stackId, predecessorTaskDefinitionArn: predecessor.taskDefinitionArn },
    publicParameters: c.inputs.privateReceipt.publicParameters, controlFingerprints: W5_CONTROL_FINGERPRINTS,
    lineage: { predecessor, receipt, providerObservation }, sourceWitnesses: witnesses };
  const capsule = { ...body, capsuleSha256: await sha256Hex(body) };
  await prepareCloudContextV5(capsule); return capsule;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  must(process.argv.slice(2).join(',') === '--stdout', 'PUBLIC_PACKAGER_ARGUMENTS');
  buildPublicCapsuleV5().then(v => console.log(JSON.stringify(v, null, 2))).catch(() => {
    console.error('CLOUD_WORKER_V5_PUBLIC_PACKAGING_REJECTED'); process.exitCode = 1;
  });
}
