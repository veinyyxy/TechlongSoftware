// Local-only adapter. Construction/Review/Inspect never retrieve a Secret value.
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { neon } from '@neondatabase/serverless';
import { fromLoginCredentials } from '@aws-sdk/credential-provider-login';
import { SecretsManagerClient, DescribeSecretCommand, GetResourcePolicyCommand, ListSecretVersionIdsCommand } from '@aws-sdk/client-secrets-manager';
import { createLocalInstallIoV5, writePublicOnceV5, INSTALL_LOCAL_V5 } from './local-io-v5.mjs';
import { createRecoveryIoV5, recoverySourceBindingV5, recoveryHistoryV5, RECOVERY_SLOT_V5 } from './recovery-local-io-v5.mjs';
import { RECOVERY_ANCHOR_V5 as A, sortRecoveryMetadataV5 } from './recovery-v5.mjs';
import { CONTINUATION_V5 as K } from './continuation-v5.mjs';
import { continuationRequireV5 as must, createContinuationSecretsV5, assessContinuationSecretV5 } from './continuation-secrets-v5.mjs';
import { readNeonInstallInventoryV5 } from './inventory-v5.mjs';
import { RECOVERY_PROVIDER_SQL_V5, neonRecoveryStatementsV5 } from './neon-recovery-sql-v5.mjs';
import { NEON_CATALOG_SQL_V5, verifyNeonCatalogV5 } from '../neon-persistence-v5.mjs';
import { loadNeonContractV5 } from '../neon-contract-v5.mjs';
import { assertEvidenceSafeV5 } from '../cloud-evidence-v5.mjs';
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
const digest = v => createHash('sha256').update(v).digest('hex'), repo = new URL('../../../',import.meta.url);
const recordFile = 'ops/aws-sandbox/reviews/cloud-worker-w5e-neon-recovery.executed.json';
const previousReview = 'F:/ChatGPT_workshop/techlong-w5e-recovery-review-20261017-a/manifest.json';
export const CONTINUATION_SLOT_V5 = 'F:/ChatGPT_workshop/techlong-cloud-worker-v5-neon-continuation-v1.permanent-slot.json';
export async function continuationSourceBindingV5() {
  const s = await recoverySourceBindingV5(), files = new Map(s.files.map(f => [f.file,f]));
  for (const file of [recordFile,K.riskFile,'tests/cloud-worker-continuation-v5.test.mjs','.github/workflows/cloud-worker-continuation.yml']) {
    files.set(file,{ file, normalizedLfSha256: digest((await readFile(new URL(file,repo),'utf8')).replaceAll('\r\n','\n')) });
  }
  return { ...s, files: [...files.values()].sort((a,b) => a.file.localeCompare(b.file)) };
}
export async function continuationHistoryV5() {
  const original = await recoveryHistoryV5(), raw = await readFile(new URL(recordFile,repo));
  must(digest(raw) === K.priorRecordRawSha256, 'CONT_HISTORY');
  const h = JSON.parse(raw), proofRaw = await readFile(h.independentProof.localProof);
  must(digest(proofRaw) === K.priorProofRawSha256 && digest(await readFile(RECOVERY_SLOT_V5)) === K.priorSlotSha256 &&
    h.approvedManifestSha256 === K.priorManifestSha256 && h.runInvocations === 1 && h.counts.awsPutAcknowledged === 1 &&
    h.counts.neonTransactionAttempts === 0 && h.runtimeEnabled === false && h.retryAllowed === false, 'CONT_HISTORY');
  const p = JSON.parse(proofRaw);
  for (const f of p.evidenceFiles) {
    must(f.path.startsWith(INSTALL_LOCAL_V5.base + '/') && !f.path.toLowerCase().includes('private-material'), 'CONT_HISTORY');
    must(digest(await readFile(f.path)) === f.rawSha256, 'CONT_HISTORY');
  }
  const m = JSON.parse(await readFile(previousReview,'utf8'));
  must(m.manifestSha256 === K.priorManifestSha256 && m.source.files.length === 99, 'CONT_HISTORY');
  for (const f of m.source.files) {
    must(digest((await readFile(new URL(f.file,repo),'utf8')).replaceAll('\r\n','\n')) === f.normalizedLfSha256, 'CONT_HISTORY');
  }
  return { original, priorRecordRawSha256: digest(raw), priorProofRawSha256: digest(proofRaw), priorSlotSha256: K.priorSlotSha256,
    priorEvidenceFilesVerified: p.evidenceFiles.length, priorSourcePinsPreserved: m.source.files.length };
}
export function createContinuationIoV5({ output, capsule }) {
  const base = createLocalInstallIoV5({ output,capsule }), readonly = createRecoveryIoV5({ output,capsule });
  const cfg = { region: 'ca-central-1', ignoreConfiguredEndpointUrls: true, maxAttempts: 1 },
    credentials = fromLoginCredentials({ profile: 'techlong-sandbox-user', ignoreCache: true, clientConfig: cfg }),
    sm = new SecretsManagerClient({ ...cfg,credentials });
  let ownerUrl, ownerTarget, catalogBaseline, databaseUrl, controlPayload, controlComplete = false, label = 'LocalSetup';
  let guard = async () => { must(false,'CONT_APPROVAL'); }, guardInstalled = false;
  const counts = { originalPrivateBundleReadAttempts: 0, neonTransactionAttempts: 0, neonCommitAcknowledged: false, dedicatedCatalogReads: 0 };
  const checkpoint = s => { label = s; }, record = async (name,value) => { assertEvidenceSafeV5(value); await writePublicOnceV5(output,name,value); };
  const send = q => sm.send(q,{ abortSignal: AbortSignal.timeout(30000) });
  async function verifyMetadata(index,mode) {
    const ref = A.secrets[index];
    const [d,p,v] = await Promise.all([send(new DescribeSecretCommand({ SecretId: ref.arn })),
      send(new GetResourcePolicyCommand({ SecretId: ref.arn })),
      send(new ListSecretVersionIdsCommand({ SecretId: ref.arn, IncludeDeprecated: true, MaxResults: 100 }))]);
    return assessContinuationSecretV5(index,d,p,v,mode);
  }
  const secrets = createContinuationSecretsV5({ send, verifyMetadata, record, checkpoint, approve: () => guard() });
  async function owner() {
    if (!ownerUrl) ownerUrl = parseEnv(await readFile(new URL('../../../.env.local',import.meta.url),'utf8')).DATABASE_URL;
    const u = new URL(ownerUrl);
    must(['postgres:','postgresql:'].includes(u.protocol) && decodeURIComponent(u.username) === 'neondb_owner' &&
      /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) && (!u.port || u.port === '5432') &&
      /^\/[A-Za-z0-9_-]{1,63}$/.test(u.pathname) && ['require','verify-full'].includes(u.searchParams.get('sslmode')), 'CONT_OWNER');
    const fp = await sha256Hex({ host: u.hostname, port: 5432, database: u.pathname.slice(1), role: 'neondb_owner', transport: 'NeonHTTPS' });
    if (ownerTarget) must(fp === ownerTarget,'CONT_OWNER'); return ownerUrl;
  }
  async function endpointSha() { const u = new URL(await owner());
    return sha256Hex({ host: u.hostname, port: 5432, database: u.pathname.slice(1), role: 'techlong_cloud_worker_v5', transport: 'NeonHTTPS' }); }
  async function oneRead(url,text) {
    const sql = neon(url,{ fullResults: true });
    const [r] = await sql.transaction(tx => [tx.query(text,[])], { isolationLevel: 'RepeatableRead', readOnly: true,
      fetchOptions: { signal: AbortSignal.timeout(30000) } }); must(r.rowCount === 1,'CONT_CATALOG'); return r.rows[0];
  }
  return Object.freeze({
    async preflight() {
      checkpoint('LockedMetadataPreflight'); const p = await readonly.inspectPartial(); ownerTarget = p.metadata.neon.targetFingerprintSha256;
      const fixed = [await verifyMetadata(0,'fixed'),await verifyMetadata(1,'empty')];
      checkpoint('ProviderFlags'); const provider = await oneRead(await owner(),RECOVERY_PROVIDER_SQL_V5);
      catalogBaseline = canonicalJson(sortRecoveryMetadataV5(p.metadata.neon.catalog));
      return { metadata: p.metadata, foundation: { stackId: A.stackId,...p.foundation }, secrets: fixed, provider,
        oldSlotSha256: digest(await readFile(INSTALL_LOCAL_V5.slot)), priorSlotSha256: digest(await readFile(RECOVERY_SLOT_V5)), finishedAt: Date.now() };
    },
    async consumeSlot(v) { await writeFile(CONTINUATION_SLOT_V5,JSON.stringify(v) + '\n',{ flag: 'wx',flush: true }); },
    setApprovalGuard(fn) { must(!guardInstalled && typeof fn === 'function','CONT_APPROVAL'); guard = fn; guardInstalled = true; },
    record, checkpoint: () => label,
    async readDatabase() {
      databaseUrl = await secrets.readDatabase(await endpointSha());
      return { exactDatabaseVersionReadOnce: true, databaseSecretWritten: false, passwordGenerated: false, privateValuesReturned: false };
    },
    async readControl(material) {
      must(databaseUrl && counts.originalPrivateBundleReadAttempts === 0,'CONT_PRIVATE_ONCE'); await guard();
      checkpoint('OriginalControlAclAndRead'); counts.originalPrivateBundleReadAttempts++;
      controlPayload = await base.loadControl(material,capsule.controlFingerprints);
      return { originalPrivateBundleReadAttempts: counts.originalPrivateBundleReadAttempts, publicFingerprintsVerified: true, privateValuesReturned: false };
    },
    async putControl() {
      must(databaseUrl && controlPayload && !controlComplete,'CONT_CONTROL_ONCE');
      checkpoint('DatabaseMetadataBeforeControlPut'); await verifyMetadata(0,'fixed');
      const proof = await secrets.putControl(controlPayload); controlComplete = true; return proof;
    },
    async installNeon() {
      must(databaseUrl && controlComplete && counts.neonTransactionAttempts === 0,'CONT_BINDING');
      checkpoint('NeonCatalogBeforeInstall'); const fresh = await readNeonInstallInventoryV5();
      must(fresh.targetFingerprintSha256 === ownerTarget && canonicalJson(sortRecoveryMetadataV5(fresh.catalog)) === catalogBaseline,'CONT_CATALOG');
      await verifyMetadata(0,'fixed'); await verifyMetadata(1,'fixed');
      const statements = await neonRecoveryStatementsV5(decodeURIComponent(new URL(databaseUrl).password)), sql = neon(await owner(),{ fullResults: true });
      await guard(); checkpoint('NeonTransaction'); counts.neonTransactionAttempts++;
      await sql.transaction(tx => statements.map(s => tx.query(s,[])),{ isolationLevel: 'Serializable',readOnly: false,
        fetchOptions: { signal: AbortSignal.timeout(90000) } });
      counts.neonCommitAcknowledged = true; checkpoint('NeonCommitAckRecording');
      await record('neon-commit-ack',{ commitAcknowledged: true, sourcePasswordFromFixedVersion: true });
      return { commitAcknowledged: true, originalPasswordInLocalReceipts: false };
    },
    async verifyDedicatedNeon() {
      must(counts.neonCommitAcknowledged && databaseUrl && counts.dedicatedCatalogReads === 0,'CONT_BINDING');
      checkpoint('DedicatedCatalog'); counts.dedicatedCatalogReads++;
      const row = await oneRead(databaseUrl,NEON_CATALOG_SQL_V5), expected = { roleOid: String(row.role.oid),ownerOid: '16392',
        functionOids: Object.fromEntries(row.functions.map(f => [f.name,f.oid])),endpointSha256: await endpointSha() };
      await verifyNeonCatalogV5(row,await loadNeonContractV5(),expected); return expected;
    },
    async inspectInstalled(expected) {
      checkpoint('InstalledMetadata'); await verifyMetadata(0,'fixed'); await verifyMetadata(1,'fixed');
      return readonly.inspectInstalled(expected);
    },
    async inspectPartial() {
      checkpoint('IndependentPartialMetadata'); const p = await readonly.inspectPartial();
      return { ...p, continuationSlotPresent: await access(CONTINUATION_SLOT_V5).then(() => true,() => false),
        originalPrivateFileReads: 0, sourceSecretValueReads: 0, externalWrites: 0, runtimeEnabled: false, retryAllowed: false };
    },
    counts: () => ({ ...counts,...secrets.counts() }),
    disposePrivate() { ownerUrl = undefined; databaseUrl = undefined; controlPayload = undefined; base.disposePrivate(); readonly.disposePrivate(); },
    dispose() { ownerUrl = undefined; databaseUrl = undefined; controlPayload = undefined; base.dispose(); readonly.dispose(); sm.destroy(); },
  });
}
