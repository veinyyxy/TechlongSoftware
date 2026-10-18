// Local, separate recovery adapter. No AWS creation/permission/activation APIs.
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { SecretsManagerClient, PutSecretValueCommand, ListSecretVersionIdsCommand } from '@aws-sdk/client-secrets-manager';
import { createLocalInstallIoV5, sourceBindingV5, INSTALL_LOCAL_V5, writePublicOnceV5 } from './local-io-v5.mjs';
import { RECOVERY_ANCHOR_V5 as A, sortRecoveryMetadataV5 } from './recovery-v5.mjs';
import { readNeonInstallInventoryV5, INSTALL_CANDIDATE_V5 as C } from './inventory-v5.mjs';
import { RECOVERY_PROVIDER_SQL_V5, neonRecoveryStatementsV5 } from './neon-recovery-sql-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
import { NEON_CATALOG_SQL_V5, verifyNeonCatalogV5 } from '../neon-persistence-v5.mjs';
import { validateDatabaseMaterialV5 } from '../cloud-application-v5.mjs';
import { assertEvidenceSafeV5 } from '../cloud-evidence-v5.mjs';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const must = (v, code) => { if (!v) throw Error(code); }, digest = v => createHash('sha256').update(v).digest('hex');
const repo = new URL('../../../', import.meta.url), proofFile = 'ops/aws-sandbox/reviews/cloud-worker-w5e.executed.json';
export const RECOVERY_SLOT_V5 = 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-neon-recovery-v1.permanent-slot.json';
export async function recoverySourceBindingV5() {
  const s = await sourceBindingV5(), files = new Map(s.files.map(f => [f.file, f]));
  for (const file of [proofFile,'docs/aws-auto-deployment-cloud-worker-w5e-neon-recovery.md',
    'tests/cloud-worker-recovery-v5.test.mjs','scripts/ci/verify-cloud-neon-recovery-v5.mjs','.github/workflows/cloud-worker-candidate.yml']) {
    files.set(file, { file, normalizedLfSha256: digest((await readFile(new URL(file, repo), 'utf8')).replaceAll('\r\n','\n')) });
  }
  return { ...s, files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)) };
}
export async function recoveryHistoryV5() {
  const raw = await readFile(new URL(proofFile, repo)), h = JSON.parse(raw), p = h.independentProof;
  must(h.approvedManifestSha256 === A.oldManifestSha256 && h.runInvocations === 1 && h.stoppedPhase === 'NeonAtomicInstall' &&
    p.foundation.stackId === A.stackId && p.proof.roleId === A.roleId && p.proof.tableId === A.tableId &&
    p.secrets.every((s, i) => s.arn === A.secrets[i]?.arn && s.versionId === A.secrets[i]?.versionId && !s.fixedVersionPresent), 'RECOVERY_ORIGINAL_HISTORY');
  for (const pin of h.evidenceFiles) {
    must(path.resolve(pin.path).toLowerCase().startsWith(path.resolve(INSTALL_LOCAL_V5.base).toLowerCase() + path.sep) &&
      !pin.path.toLowerCase().includes('private-material'), 'RECOVERY_HISTORY_PUBLIC_PATH');
    must(digest(await readFile(pin.path)) === pin.rawSha256, 'RECOVERY_ORIGINAL_EVIDENCE_CHANGED');
  }
  const slotSha256 = digest(await readFile(INSTALL_LOCAL_V5.slot)); must(slotSha256 === A.oldSlotSha256, 'RECOVERY_OLD_SLOT_CHANGED');
  return { recordSha256: digest(raw), evidenceFiles: h.evidenceFiles.length, oldSlotSha256: slotSha256 };
}
export function createRecoveryIoV5({ output, capsule }) {
  const base = createLocalInstallIoV5({ output, capsule }), cfg = { region: 'ca-central-1', ignoreConfiguredEndpointUrls: true, maxAttempts: 1 },
    credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', ignoreCache: true, clientConfig: cfg }),
    sm = new SecretsManagerClient({ ...cfg, credentials });
  let ownerUrl, ownerTarget, catalogBaseline, databaseUrl, controlPayload;
  const counts = { privateBundleReadAttempts: 0, passwordGenerated: false, awsPutAttempts: 0, awsPutAcknowledged: 0,
    neonTransactionAttempts: 0, neonCommitAcknowledged: false, dedicatedCatalogReads: 0, sourceSecretValueReads: 0 };
  const complete = [false,false];
  async function owner() {
    if (!ownerUrl) {
      const e = parseEnv(await readFile(new URL('../../../.env.local', import.meta.url), 'utf8')); ownerUrl = e.DATABASE_URL;
    }
    const u = new URL(ownerUrl);
    must(['postgres:','postgresql:'].includes(u.protocol) && /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) &&
      (!u.port || u.port === '5432') && /^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname) && decodeURIComponent(u.username) === 'neondb_owner' &&
      ['require','verify-full'].includes(u.searchParams.get('sslmode')), 'RECOVERY_FIXED_OWNER_TLS');
    const fp = await sha256Hex({ host: u.hostname, port: 5432, database: u.pathname.slice(1), role: 'neondb_owner', transport: 'NeonHTTPS' });
    if (ownerTarget) must(fp === ownerTarget, 'RECOVERY_OWNER_ENDPOINT_DRIFT'); return ownerUrl;
  }
  async function oneRead(url, text) {
    const sql = neon(url, { fullResults: true });
    const [r] = await sql.transaction(tx => [tx.query(text, [])], { isolationLevel: 'RepeatableRead', readOnly: true,
      fetchOptions: { signal: AbortSignal.timeout(30000) } }); must(r.rowCount === 1, 'RECOVERY_CATALOG_ROW_COUNT'); return r.rows[0];
  }
  const ref = i => A.secrets[i], action = i => ({ name: C.secrets[i], versionId: ref(i).versionId });
  async function verifyVersionSet(index, hasValue) {
    const r = await sm.send(new ListSecretVersionIdsCommand({ SecretId: ref(index).arn, IncludeDeprecated: true, MaxResults: 100 }),
      { abortSignal: AbortSignal.timeout(30000) });
    const versions = r.Versions ?? [];
    must(r.ARN === ref(index).arn && !r.NextToken && Array.isArray(versions) && versions.length === (hasValue ? 1 : 0) &&
      (!hasValue || versions[0].VersionId === ref(index).versionId && canonicalJson(versions[0].VersionStages) === canonicalJson(['AWSCURRENT'])),
    'RECOVERY_COMPLETE_SECRET_VERSION_SET');
    return { allVersionsIncludingDeprecatedVerified: true, versionCount: versions.length };
  }
  async function putVersion(index, value) {
    must(databaseUrl && controlPayload && !complete[index] && counts.awsPutAttempts < 2, 'RECOVERY_PRIVATE_OR_VERSION_STATE');
    await base.verifySecret(ref(index), action(index), false); await verifyVersionSet(index, false); counts.awsPutAttempts++;
    const r = await sm.send(new PutSecretValueCommand({ SecretId: ref(index).arn, ClientRequestToken: ref(index).versionId,
      SecretString: JSON.stringify(value) }), { abortSignal: AbortSignal.timeout(30000) });
    must(r.ARN === ref(index).arn && r.VersionId === ref(index).versionId, 'RECOVERY_SECRET_PUT_ACK');
    counts.awsPutAcknowledged++; const proof = await base.verifySecret(ref(index), action(index), true);
    await verifyVersionSet(index, true); complete[index] = true; return proof;
  }
  const ownerCatalog = NEON_CATALOG_SQL_V5.replace('current_user AS current_user, session_user AS session_user',
    'r.rolname::text AS current_user, r.rolname::text AS session_user').replace('r.rolname=current_user', "r.rolname='techlong_cloud_worker_v5'");
  const endpointSha = async () => { const u = new URL(await owner());
    return sha256Hex({ host: u.hostname, port: 5432, database: u.pathname.slice(1), role: C.roleDb, transport: 'NeonHTTPS' }); };
  return Object.freeze({
    async preflight() {
      const metadata = await base.inspectPartial(); ownerTarget = metadata.neon.targetFingerprintSha256;
      const foundation = { stackId: A.stackId, ...await base.verifyFoundation({ stackId: A.stackId }) }, secrets = [];
      must(foundation.roleId === A.roleId && foundation.tableId === A.tableId, 'RECOVERY_FOUNDATION_REPLACED');
      for (let i = 0; i < 2; i++) {
        const d = metadata.aws.secrets[C.secrets[i]]?.value;
        must(d?.ARN === ref(i).arn && d.Name === C.secrets[i] && d.RotationEnabled !== true && !d.ReplicationStatus?.length &&
          canonicalJson([...(d.Tags ?? [])].sort((a, b) => a.Key.localeCompare(b.Key))) === canonicalJson([
            { Key: 'Environment', Value: 'aws-sandbox' }, { Key: 'Purpose', Value: 'cloud-worker-v5' }]), 'RECOVERY_SECRET_METADATA_DRIFT');
        secrets.push({ ...await base.verifySecret(ref(i), action(i), false), ...await verifyVersionSet(i, false) });
      }
      const provider = await oneRead(await owner(), RECOVERY_PROVIDER_SQL_V5);
      catalogBaseline = canonicalJson(sortRecoveryMetadataV5(metadata.neon.catalog));
      return { metadata, foundation, secrets, provider, oldSlotSha256: digest(await readFile(INSTALL_LOCAL_V5.slot)), finishedAt: Date.now() };
    },
    async consumeSlot(value) { await writeFile(RECOVERY_SLOT_V5, JSON.stringify(value) + '\n', { flag: 'wx', flush: true }); },
    async record(name, value) { assertEvidenceSafeV5(value); await writePublicOnceV5(output, name, value); },
    async preparePrivate(material, expectedOwnerTarget) {
      must(ownerTarget === expectedOwnerTarget && !counts.privateBundleReadAttempts && !counts.passwordGenerated, 'RECOVERY_MATERIAL_ONCE');
      await owner(); counts.privateBundleReadAttempts++;
      controlPayload = await base.loadControl(material, capsule.controlFingerprints);
      const u = new URL(await owner()), target = new URL('postgresql://' + u.host + u.pathname);
      target.username = C.roleDb; target.password = randomBytes(48).toString('hex'); target.searchParams.set('sslmode','verify-full');
      databaseUrl = target.href; counts.passwordGenerated = true;
      await validateDatabaseMaterialV5({ schema: 'techlong/cloud-worker-neon-material/v5', databaseUrl }, await endpointSha());
      return { privateBundleReadAttempts: counts.privateBundleReadAttempts, controlPublicFingerprintsVerified: true, passwordGenerated: true, privateValuesReturned: false };
    },
    putDatabase: () => putVersion(0, { schema: 'techlong/cloud-worker-neon-material/v5', databaseUrl }),
    putControl: () => putVersion(1, controlPayload),
    async installNeon() {
      must(complete.every(Boolean) && databaseUrl && counts.neonTransactionAttempts === 0, 'RECOVERY_DURABLE_MATERIAL_FIRST');
      const fresh = await readNeonInstallInventoryV5();
      must(fresh.targetFingerprintSha256 === ownerTarget && canonicalJson(sortRecoveryMetadataV5(fresh.catalog)) === catalogBaseline,
        'RECOVERY_NEON_CATALOG_DRIFT');
      const statements = await neonRecoveryStatementsV5(decodeURIComponent(new URL(databaseUrl).password)), sql = neon(await owner(), { fullResults: true });
      counts.neonTransactionAttempts++;
      await sql.transaction(tx => statements.map(s => tx.query(s, [])), { isolationLevel: 'Serializable', readOnly: false,
        fetchOptions: { signal: AbortSignal.timeout(90000) } });
      counts.neonCommitAcknowledged = true; return { commitAcknowledged: true, rawPasswordSavedInLocalReceipts: false };
    },
    async verifyDedicatedNeon() {
      must(counts.neonCommitAcknowledged && databaseUrl && counts.dedicatedCatalogReads === 0, 'RECOVERY_DEDICATED_READ_ONCE');
      counts.dedicatedCatalogReads++; const row = await oneRead(databaseUrl, NEON_CATALOG_SQL_V5), expected = {
        roleOid: String(row.role.oid), ownerOid: '16392', functionOids: Object.fromEntries(row.functions.map(f => [f.name, f.oid])), endpointSha256: await endpointSha() };
      await verifyNeonCatalogV5(row, await loadNeonContractV5(), expected); return expected;
    },
    async inspectInstalled(expected) {
      const foundation = await base.verifyFoundation({ stackId: A.stackId });
      must(foundation.roleId === A.roleId && foundation.tableId === A.tableId && expected.endpointSha256 === await endpointSha(), 'RECOVERY_ACTUAL_IDS_OR_ENDPOINT');
      for (let i = 0; i < 2; i++) { await base.verifySecret(ref(i), action(i), true); await verifyVersionSet(i, true); }
      await verifyNeonCatalogV5(await oneRead(await owner(), ownerCatalog), await loadNeonContractV5(), expected);
      return { ...foundation, sourceSecretValueReads: 0, metadataOnlyPasswordAuthenticationNotRepeated: true };
    },
    async inspectPartial() {
      const metadata = await base.inspectPartial(); ownerTarget = metadata.neon.targetFingerprintSha256;
      const foundation = await base.verifyFoundation({ stackId: A.stackId });
      must(foundation.roleId === A.roleId && foundation.tableId === A.tableId, 'RECOVERY_FOUNDATION_REPLACED');
      const secrets = [];
      for (let i = 0; i < 2; i++) {
        const r = ref(i);
        const d = metadata.aws.secrets[C.secrets[i]], versions = d?.value?.VersionIdsToStages ?? {};
        const item = { arn: r.arn, state: d?.state, nameMatches: d?.value?.ARN === r.arn,
          versions, expectedVersionPresent: Object.hasOwn(versions, r.versionId), isolatedVersionShape: 'UNPROVED_OR_DRIFT' };
        try {
          await base.verifySecret(r, action(i), item.expectedVersionPresent);
          await verifyVersionSet(i, item.expectedVersionPresent);
          item.isolatedVersionShape = item.expectedVersionPresent ? 'VERIFIED_FIXED_CURRENT' : 'VERIFIED_EMPTY';
        } catch { /* preserve partial/unknown, no write or retry */ }
        secrets.push(item);
      }
      return { metadata, foundation, secrets, newSlotPresent: await access(RECOVERY_SLOT_V5).then(() => true, () => false),
        externalWrites: 0, sourceSecretValueReads: 0, originalPrivateFileReads: 0, runtimeEnabled: false, retryAllowed: false };
    },
    counts: () => ({ ...counts }),
    disposePrivate() { ownerUrl = undefined; databaseUrl = undefined; controlPayload = undefined; base.disposePrivate(); },
    dispose() { ownerUrl = undefined; databaseUrl = undefined; controlPayload = undefined; base.dispose(); sm.destroy(); },
  });
}
