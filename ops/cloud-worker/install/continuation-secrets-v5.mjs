// Single fixed database read + single missing control write. No ambient targets.
import { GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { canonicalJson } from '../../../lib/deployments/execution/hash.ts';
import { RECOVERY_ANCHOR_V5 as A } from './recovery-v5.mjs';
import { INSTALL_CANDIDATE_V5 as C } from './inventory-v5.mjs';
import { secretResourcePolicyV5 } from './plan-v5.mjs';
import { validateDatabaseMaterialV5 } from '../cloud-application-v5.mjs';
import { safeRecoveryFailureV5 } from './neon-recovery-sql-v5.mjs';
const codes = new Set(['CONT_SECRET_METADATA','CONT_SECRET_POLICY','CONT_SECRET_VERSION_SET','CONT_CONTROL_PUBLICATION_PENDING',
  'CONT_VALUE_ONCE','CONT_VALUE_RESPONSE','CONT_VALUE_JSON','CONT_VALUE_PASSWORD','CONT_CONTROL_ONCE','CONT_CONTROL_API_ACK',
  'CONT_PREFLIGHT','CONT_APPROVAL','CONT_DEADLINE','CONT_BINDING','CONT_HISTORY','CONT_SOURCE','CONT_SLOT','CONT_OWNER','CONT_CATALOG','CONT_PRIVATE_ONCE']);
export function continuationErrorV5(code) {
  const e = Error('CONTINUATION_STOPPED');
  e.continuationCode = codes.has(code) ? code : null; return e;
}
export function continuationRequireV5(ok, code) { if (!ok) throw continuationErrorV5(code); }
export function safeContinuationFailureV5(error) {
  return { ...safeRecoveryFailureV5(error), assertion: codes.has(error?.continuationCode) ? error.continuationCode : null };
}
const must = continuationRequireV5, same = (a, b) => canonicalJson(a) === canonicalJson(b);
export const CONTROL_PUBLICATION_DELAYS_V5 = Object.freeze([0,1000,2000,4000,8000]);
export function assessContinuationSecretV5(index, d, p, list, mode) {
  must([0,1].includes(index) && ['empty','fixed','published'].includes(mode) && (index === 1 || mode === 'fixed'), 'CONT_SECRET_METADATA');
  const ref = A.secrets[index];
  must(d?.ARN === ref.arn && d.Name === C.secrets[index] && !d.DeletedDate && !d.KmsKeyId &&
    d.RotationEnabled !== true && !d.RotationLambdaARN && !d.ReplicationStatus?.length && !d.OwningService &&
    same([...(d.Tags ?? [])].sort((a,b) => a.Key.localeCompare(b.Key)), [
      { Key: 'Environment', Value: 'aws-sandbox' }, { Key: 'Purpose', Value: 'cloud-worker-v5' }]), 'CONT_SECRET_METADATA');
  let policy;
  try { policy = JSON.parse(p?.ResourcePolicy); } catch { throw continuationErrorV5('CONT_SECRET_POLICY'); }
  must(p.ARN === ref.arn && same(policy, secretResourcePolicyV5()), 'CONT_SECRET_POLICY');
  const map = d.VersionIdsToStages ?? {}, versions = list?.Versions ?? [], expected = { [ref.versionId]: ['AWSCURRENT'] };
  must(list?.ARN === ref.arn && !list.NextToken && Array.isArray(versions) && versions.length <= 1, 'CONT_SECRET_VERSION_SET');
  const mapEmpty = same(map, {}), mapFixed = same(map, expected), listEmpty = versions.length === 0;
  const listFixed = versions.length === 1 && versions[0].VersionId === ref.versionId && same(versions[0].VersionStages, ['AWSCURRENT']);
  must((mapEmpty || mapFixed) && (listEmpty || listFixed), 'CONT_SECRET_VERSION_SET');
  if (mode === 'published' && !(mapFixed && listFixed)) throw continuationErrorV5('CONT_CONTROL_PUBLICATION_PENDING');
  must(mode === 'empty' ? mapEmpty && listEmpty : mapFixed && listFixed, 'CONT_SECRET_VERSION_SET');
  return { ...ref, isolated: true, fixedVersionPresent: mode !== 'empty',
    allVersionsIncludingDeprecatedVerified: true, versionCount: mode === 'empty' ? 0 : 1 };
}
export function createContinuationSecretsV5({ send, verifyMetadata, record, checkpoint, approve,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let databaseValidated = false;
  const counts = { sourceSecretValueReadAttempts: 0, sourceSecretValueReadAcknowledged: 0,
    controlPutAttempts: 0, controlPutAcknowledged: 0, publicationObservations: 0, generatedPassword: false, databaseSecretWrites: 0 };
  return Object.freeze({
    async readDatabase(endpointSha256) {
      must(counts.sourceSecretValueReadAttempts === 0, 'CONT_VALUE_ONCE');
      checkpoint('DatabaseMetadataBeforeRead'); await verifyMetadata(0, 'fixed'); await approve();
      checkpoint('DatabaseFixedValueRead'); counts.sourceSecretValueReadAttempts++;
      const ref = A.secrets[0], r = await send(new GetSecretValueCommand({ SecretId: ref.arn, VersionId: ref.versionId, VersionStage: 'AWSCURRENT' }));
      must(r.ARN === ref.arn && r.Name === C.secrets[0] && r.VersionId === ref.versionId && same(r.VersionStages, ['AWSCURRENT']) &&
        !r.SecretBinary && typeof r.SecretString === 'string' && Buffer.byteLength(r.SecretString) <= 12000, 'CONT_VALUE_RESPONSE');
      counts.sourceSecretValueReadAcknowledged++; checkpoint('DatabaseValueValidation');
      let payload; try { payload = JSON.parse(r.SecretString); } catch { throw continuationErrorV5('CONT_VALUE_JSON'); }
      const url = await validateDatabaseMaterialV5(payload, endpointSha256);
      must(/^[a-f0-9]{96}$/.test(decodeURIComponent(new URL(url).password)), 'CONT_VALUE_PASSWORD');
      databaseValidated = true;
      return url; // Memory-only caller. Never sent to record()/stdout.
    },
    async putControl(payload) {
      must(counts.controlPutAttempts === 0 && counts.sourceSecretValueReadAcknowledged === 1 && databaseValidated, 'CONT_CONTROL_ONCE');
      checkpoint('ControlMetadataBeforePut'); await verifyMetadata(1, 'empty'); await approve();
      checkpoint('ControlFixedVersionPut'); counts.controlPutAttempts++;
      const ref = A.secrets[1], r = await send(new PutSecretValueCommand({ SecretId: ref.arn,
        ClientRequestToken: ref.versionId, SecretString: JSON.stringify(payload) }));
      must(r.ARN === ref.arn && r.VersionId === ref.versionId, 'CONT_CONTROL_API_ACK');
      counts.controlPutAcknowledged++; checkpoint('ControlApiAckRecording');
      await record('control-api-ack', { ...ref, apiAcknowledged: true, metadataVerifiedYet: false });
      for (const delay of CONTROL_PUBLICATION_DELAYS_V5) {
        if (delay) await wait(delay); await approve();
        checkpoint('ControlPublicationMetadata'); counts.publicationObservations++;
        try { return await verifyMetadata(1, 'published'); }
        catch (e) { if (e.continuationCode !== 'CONT_CONTROL_PUBLICATION_PENDING') throw e; }
      }
      throw continuationErrorV5('CONT_CONTROL_PUBLICATION_PENDING');
    },
    counts: () => ({ ...counts }),
  });
}
