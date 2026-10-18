// New explicit continuation from the durable database version. Old runs stay sealed.
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { RECOVERY_ANCHOR_V5 as A, sortRecoveryMetadataV5 } from './recovery-v5.mjs';
import { INSTALL_CANDIDATE_V5 as C } from './inventory-v5.mjs';
import { continuationRequireV5 as must, safeContinuationFailureV5, CONTROL_PUBLICATION_DELAYS_V5 } from './continuation-secrets-v5.mjs';
import { neonRecoveryRecipeV5 } from './neon-recovery-sql-v5.mjs';
import { loadNeonContractV5, renderNeonContractV5 } from '../neon-contract-v5.mjs';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
export const CONTINUATION_V5 = Object.freeze({
  priorManifestSha256: '4f82199f64705e73ece260e6d14e416575b64ab8fed39a5d48e080ef3fb237bb',
  priorRecordRawSha256: '7d0e85b59db316f80b820d8cb0e356f747935d64b0882ee10fa85a1efeeaf682',
  priorSlotSha256: 'db1b665fda7abee9a5bdd852b60da06663747e659a097336cd070634edfd5459',
  priorProofRawSha256: '91e5d0c40eda20cf50ed151b9d5d5a07090ac302ad7e3d90472e799121f610fe',
  riskFile: 'docs/aws-auto-deployment-cloud-worker-w5e-neon-continuation.md',
  attempt: 'neon-continuation-v1',
});
export const CONTINUATION_EFFECTS_V5 = Object.freeze({ sourceDatabaseFixedValueReads: 1, originalPrivateBundleReads: 1,
  controlFixedVersionPuts: 1, databaseSecretWrites: 0, generatedPasswordBytes: 0, neonInstallTransactions: 1,
  dedicatedCatalogAuthentications: 1, publicationReadRounds: CONTROL_PUBLICATION_DELAYS_V5.length,
  publicationBackoffMilliseconds: CONTROL_PUBLICATION_DELAYS_V5, iamWrites: 0, resourceCreations: 0,
  githubConfigurationWrites: 0, businessDml: 0, workloadWrites: 0, automaticWriteRetries: 0, slotReset: false, cleanupOrRollback: false });
export function continuationPrestateV5(p) {
  const x = p.metadata, a = x?.aws, n = x?.neon, c = n?.catalog, v = p.provider;
  must(a?.source?.Arn === 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' && a.source.Account === '402010193138' &&
    a.source.UserId === 'AIDAV3GNMXTZEO7SHLC2X' && a.preservedIam?.iamLayoutUnchanged === true &&
    p.foundation?.stackId === A.stackId && p.foundation.roleId === A.roleId && p.foundation.tableId === A.tableId && p.foundation.lockedTrustVerified === true &&
    p.oldSlotSha256 === A.oldSlotSha256 && p.priorSlotSha256 === CONTINUATION_V5.priorSlotSha256 &&
    p.secrets?.length === 2 && p.secrets.every((s,i) => s.arn === A.secrets[i].arn && s.versionId === A.secrets[i].versionId && s.isolated === true &&
      s.allVersionsIncludingDeprecatedVerified === true && s.fixedVersionPresent === (i === 0) && s.versionCount === (i === 0 ? 1 : 0)) &&
    n.state === 'READ' && c.read_only === 'on' && c.actor === 'neondb_owner' && c.session_actor === 'neondb_owner' &&
    c.installer?.oid === '16392' && c.installer.createRole === true && c.installer.superuser === false && c.candidate_role === null && c.candidate_schema === null &&
    c.public_database_create === false && c.public_create_schemas?.length === 0 && c.public_relation_grants?.length === 0 && c.public_column_grants?.length === 0 &&
    c.definers?.every(f => f.publicExecutable === false) && c.default_acl?.every(d => d.owner !== '16392' || !['f','n'].includes(d.type)) &&
    c.target_tables?.length === 10 && c.target_tables.every(t => t.owner === '16392' && t.rls === false && t.forceRls === false) &&
    v?.actor === 'neondb_owner' && v.session_actor === 'neondb_owner' && v.owner_oid === '16392' && v.read_only === 'on' &&
    v.forward_ddl === 'on' && v.password_encryption === 'scram-sha-256', 'CONT_PREFLIGHT');
  return structuredClone({ source: { arn: a.source.Arn, userId: a.source.UserId }, foundation: p.foundation, secrets: p.secrets,
    neonTarget: n.targetFingerprintSha256, neonCatalog: sortRecoveryMetadataV5(c), provider: v,
    oldSlotSha256: p.oldSlotSha256, priorSlotSha256: p.priorSlotSha256 });
}
export async function continuationActionsV5() {
  const recipe = (await neonRecoveryRecipeV5()).map(s => s.replace('<GENERATED_48_BYTE_PASSWORD_VIA_TLS_NEON_SQL>', '<EXISTING_FIXED_VERSION_PASSWORD_VIA_TLS_NEON_SQL>'));
  const c = await loadNeonContractV5();
  return { reuseOnly: A, prior: CONTINUATION_V5, order: ['VerifyLockedDatabaseFixedControlEmptyNeonAbsent','ConsumeIndependentContinuationSlot',
    'ReadExactDatabaseVersionOnce','ReadOriginalControlBundleOnce','PutMissingControlFixedVersionOnce','PersistApiAckBeforeMetadata',
    'BoundedReadOnlyPublicationChecks','OneNeonAtomicInstall','OneDedicatedCatalogAuthentication','IndependentMetadataInspect'],
    neon: { role: C.roleDb, schema: C.schema, ownerOid: '16392', recipe, recipeSha256: await sha256Hex(recipe),
      contractSha256: c.contractSha256, sqlSha256: await sha256Hex(renderNeonContractV5(c).statements),
      passwordSource: A.secrets[0], providerHookDisabled: false, creatorAutomaticAdminMembership: 'ADMIN_TRUE_INHERIT_FALSE_SET_FALSE' },
    activationAuthorized: false, actualWorkloadAuthorized: false, noDatabaseVersionReplacement: true };
}
export async function prepareContinuationV5({ prestate, source, material, history, now }) {
  must(Number.isSafeInteger(now) && /^[a-f0-9]{40}$/.test(source?.commit) && source.files?.length > 0 &&
    /^[a-f0-9]{64}$/.test(material?.summarySha256) && history?.priorRecordRawSha256 === CONTINUATION_V5.priorRecordRawSha256 &&
    history.priorProofRawSha256 === CONTINUATION_V5.priorProofRawSha256, 'CONT_BINDING');
  const actions = await continuationActionsV5(), body = { schema: 'techlong/cloud-worker-neon-continuation-review/v5',
    preparedAt: now, expiresAt: now + 7200000, source: structuredClone(source), material: structuredClone(material), history: structuredClone(history),
    prestate: continuationPrestateV5(prestate), actions, actionsSha256: await sha256Hex(actions), effects: CONTINUATION_EFFECTS_V5,
    riskFile: CONTINUATION_V5.riskFile, executionAuthorizedByPreparation: false };
  return { ...body, manifestSha256: await sha256Hex(body) };
}
export async function assertContinuationApprovalV5(m, approved, { source, material, history, now }) {
  const { manifestSha256, ...body } = m;
  must(/^[a-f0-9]{64}$/.test(approved) && approved === manifestSha256 && await sha256Hex(body) === approved &&
    Object.keys(body).sort().join(',') === 'actions,actionsSha256,effects,executionAuthorizedByPreparation,expiresAt,history,material,preparedAt,prestate,riskFile,schema,source' &&
    m.schema === 'techlong/cloud-worker-neon-continuation-review/v5' && m.executionAuthorizedByPreparation === false &&
    same(m.source,source) && same(m.material,material) && same(m.history,history) && same(m.effects,CONTINUATION_EFFECTS_V5) &&
    same(m.actions,await continuationActionsV5()) && m.actionsSha256 === await sha256Hex(m.actions) && m.riskFile === CONTINUATION_V5.riskFile &&
    now >= m.preparedAt && now < m.expiresAt && m.expiresAt - m.preparedAt === 7200000, 'CONT_APPROVAL');
}
export async function continueLockedV5({ manifest: m, approvedSha256, source, material, history, io, now = Date.now }) {
  const approve = () => assertContinuationApprovalV5(m, approvedSha256, { source, material, history, now: now() });
  await approve(); const started = now(), p = await io.preflight(); await approve();
  must(same(continuationPrestateV5(p),m.prestate) && now() >= p.finishedAt && now() - p.finishedAt <= 30000 && now() - started <= 180000, 'CONT_PREFLIGHT');
  await io.consumeSlot({ manifestSha256: m.manifestSha256, at: now(), attempt: CONTINUATION_V5.attempt, oldSlotsReset: false, retryAllowed: false });
  const guard = async () => { await approve(); must(now() - started < 1200000, 'CONT_DEADLINE'); };
  let phase = 'DatabaseRead'; io.setApprovalGuard(guard);
  async function step(name, fn) {
    await guard(); phase = name; await io.record(name + '.intent', { manifestSha256: m.manifestSha256, at: now() });
    const r = await fn(); await io.record(name + '.ack',r); return r;
  }
  try {
    await step('DatabaseRead', () => io.readDatabase());
    await step('ControlPrivateRead', () => io.readControl(material));
    await step('ControlVersion', () => io.putControl());
    await step('NeonAtomicInstall', () => io.installNeon());
    phase = 'DedicatedCatalog'; const n = await io.verifyDedicatedNeon();
    phase = 'MetadataInspect'; const proof = await io.inspectInstalled(n);
    must(proof.lockedTrustVerified === true && proof.roleId === A.roleId && proof.tableId === A.tableId, 'CONT_BINDING');
    const body = { schema: 'techlong/cloud-worker-installed-binding/v5', installed: true, roleId: proof.roleId, tableId: proof.tableId,
      neon: { ...n, contractSha256: m.actions.neon.contractSha256, sqlSha256: m.actions.neon.sqlSha256 }, databaseSecret: A.secrets[0],
      controlSecret: A.secrets[1], evidenceBucket: C.bucket }, binding = { ...body, installationSha256: await sha256Hex(body) };
    await assertInstallationV5(binding,binding.installationSha256,await loadNeonContractV5()); await io.record('installation-binding',binding);
    const r = { outcome: 'CONTINUATION_LOCKED_COMPLETE_REQUIRES_INDEPENDENT_INSPECT', manifestSha256: m.manifestSha256,
      bindingSha256: binding.installationSha256, counts: io.counts(), retryAllowed: false, runtimeEnabled: false };
    await io.record('result',r); return r;
  } catch (error) {
    const r = { outcome: 'CONTINUATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY', manifestSha256: m.manifestSha256,
      phase, checkpoint: io.checkpoint(), counts: io.counts(), failure: safeContinuationFailureV5(error), retryAllowed: false, runtimeEnabled: false };
    await io.record('stopped',r); return r;
  } finally { io.disposePrivate(); }
}
