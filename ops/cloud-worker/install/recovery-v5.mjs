// Separate reviewed recovery, never a replay/resume of InstallLocked.
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { INSTALL_SCOPE_V5 as I } from './plan-v5.mjs';
import { INSTALL_CANDIDATE_V5 as C } from './inventory-v5.mjs';
import { loadNeonContractV5, renderNeonContractV5 } from '../neon-contract-v5.mjs';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
import { neonRecoveryRecipeV5, safeRecoveryFailureV5 } from './neon-recovery-sql-v5.mjs';
const must = (v, code) => { if (!v) throw Error(code); }, same = (a, b) => canonicalJson(a) === canonicalJson(b);
export const RECOVERY_ANCHOR_V5 = Object.freeze({
  oldManifestSha256: '439ab7dc6ff32d196809d5467d713510bbb5b1e9886742e82e0d856171812152',
  oldSlotSha256: '765a1e3cb46ce07cc781d8955323bfbe4baae6e323f55da9a8a859e328d7297f',
  stackId: 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5',
  roleId: 'AROAV3GNMXTZK5O45RG24', tableId: 'ea69c69e-1c48-481a-83f0-36393c196d9f',
  secrets: Object.freeze([
    Object.freeze({ arn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/neon-control-v1-pVKVEV', versionId: I.secretVersions[0] }),
    Object.freeze({ arn: 'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/control-first-acceptance-v1-CatDWK', versionId: I.secretVersions[1] }),
  ]), recoveryAttempt: 'neon-recovery-v1',
});
export const RECOVERY_EFFECTS_V5 = Object.freeze({ putFixedSecretVersions: 2, neonWriteTransactions: 1,
  newPrivateBundleReads: 1, newRandomPasswordBytes: 48, sourceSecretValueReads: 0, createStackCalls: 0,
  createSecretCalls: 0, iamWrites: 0, githubWrites: 0, workloadWrites: 0, businessDml: 0,
  automaticRetries: 0, rollbackOrCleanup: false, oldOrNewSlotReset: false });
export const RECOVERY_RISK_FILE_V5 = 'docs/aws-auto-deployment-cloud-worker-w5e-neon-recovery.md';
export function sortRecoveryMetadataV5(v) {
  if (Array.isArray(v)) return v.map(sortRecoveryMetadataV5).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sortRecoveryMetadataV5(x)])) : v;
}
export function recoveryPrestateV5(p) {
  const a = p.metadata?.aws, n = p.metadata?.neon, c = n?.catalog, provider = p.provider;
  must(a?.source?.Arn === I.sourceArn && a.source.Account === '402010193138' && a.source.UserId === 'AIDAV3GNMXTZEO7SHLC2X' &&
    a.preservedIam?.iamLayoutUnchanged === true && p.oldSlotSha256 === RECOVERY_ANCHOR_V5.oldSlotSha256 &&
    p.foundation?.stackId === RECOVERY_ANCHOR_V5.stackId && p.foundation.roleId === RECOVERY_ANCHOR_V5.roleId &&
    p.foundation.tableId === RECOVERY_ANCHOR_V5.tableId && p.foundation.lockedTrustVerified === true &&
    p.secrets?.length === 2 && p.secrets.every((s, i) => s.arn === RECOVERY_ANCHOR_V5.secrets[i].arn &&
      s.versionId === RECOVERY_ANCHOR_V5.secrets[i].versionId && s.isolated === true && s.fixedVersionPresent === false &&
      s.allVersionsIncludingDeprecatedVerified === true && s.versionCount === 0) &&
    n.state === 'READ' && c.read_only === 'on' && c.actor === 'neondb_owner' && c.session_actor === 'neondb_owner' &&
    c.installer?.oid === '16392' && c.installer.createRole === true && c.installer.superuser === false && c.candidate_role === null && c.candidate_schema === null &&
    c.public_database_create === false && c.public_create_schemas?.length === 0 && c.public_relation_grants?.length === 0 &&
    c.public_column_grants?.length === 0 && c.definers?.every(f => f.publicExecutable === false) &&
    c.default_acl?.every(d => d.owner !== '16392' || !['f','n'].includes(d.type)) &&
    c.target_tables?.length === 10 && c.target_tables.every(t => t.owner === '16392' && t.rls === false && t.forceRls === false) &&
    provider?.actor === 'neondb_owner' && provider.session_actor === 'neondb_owner' && provider.owner_oid === '16392' &&
    provider.read_only === 'on' && provider.forward_ddl === 'on' && provider.password_encryption === 'scram-sha-256',
  'RECOVERY_LOCKED_EMPTY_NEON_ABSENT_PRESTATE_REQUIRED');
  return structuredClone({ source: { arn: a.source.Arn, userId: a.source.UserId }, foundation: p.foundation,
    secrets: p.secrets, neonTarget: n.targetFingerprintSha256, neonCatalog: sortRecoveryMetadataV5(c), provider,
    oldSlotSha256: p.oldSlotSha256 });
}
export async function recoveryActionsV5() {
  const recipe = await neonRecoveryRecipeV5(), contract = await loadNeonContractV5();
  return { reuseOnly: RECOVERY_ANCHOR_V5, order: ['VerifyExistingLockedEmptyResources','ConsumeNewIndependentSlot',
    'ReadPrivateOnceAndGeneratePasswordInMemory','PutDatabaseFixedVersion','PutControlFixedVersion',
    'NeonAtomicCreateRoleSchemaFourFunctions','DedicatedReadOnlyCatalog','ReadOnlyInspectAndBinding'],
  neon: { role: C.roleDb, schema: C.schema, ownerOid: '16392', contractSha256: contract.contractSha256,
    sqlSha256: await sha256Hex(renderNeonContractV5(contract).statements), recipe, recipeSha256: await sha256Hex(recipe),
    passwordTransport: 'GENERATED_ORIGINAL_VALUE_IN_FIXED_SQL_OVER_TLS', providerHookDisabled: false,
    creatorAutomaticAdminMembership: 'ADMIN_TRUE_INHERIT_FALSE_SET_FALSE' },
  secretsBeforeSql: true, includeDeprecatedVersionInventory: true, failureMayLeavePopulatedSecrets: true, doNotReadExistingSecretValues: true,
  activationAuthorized: false, actualWorkloadAuthorized: false };
}
export async function prepareRecoveryV5({ prestate, source, material, history, now }) {
  must(Number.isSafeInteger(now) && /^[a-f0-9]{40}$/.test(source?.commit) && source.files?.length > 0 &&
    /^[a-f0-9]{64}$/.test(material?.summarySha256) && /^[a-f0-9]{64}$/.test(history?.recordSha256) && history.evidenceFiles > 0,
  'RECOVERY_BINDINGS_REQUIRED');
  const actions = await recoveryActionsV5(), body = { schema: 'techlong/cloud-worker-neon-recovery-review/v5',
    preparedAt: now, expiresAt: now + 7200000, source: structuredClone(source), material: structuredClone(material),
    history: structuredClone(history), prestate: recoveryPrestateV5(prestate), actions, actionsSha256: await sha256Hex(actions),
    effects: RECOVERY_EFFECTS_V5, riskFile: RECOVERY_RISK_FILE_V5, executionAuthorizedByPreparation: false };
  return { ...body, manifestSha256: await sha256Hex(body) };
}
export async function assertRecoveryApprovalV5(m, approved, { source, material, history, now }) {
  const { manifestSha256, ...body } = m;
  must(/^[a-f0-9]{64}$/.test(approved) && approved === manifestSha256 && await sha256Hex(body) === approved &&
    Object.keys(body).sort().join(',') === 'actions,actionsSha256,effects,executionAuthorizedByPreparation,expiresAt,history,material,preparedAt,prestate,riskFile,schema,source' &&
    m.schema === 'techlong/cloud-worker-neon-recovery-review/v5' && m.executionAuthorizedByPreparation === false &&
    same(m.source, source) && same(m.material, material) && same(m.history, history) && same(m.effects, RECOVERY_EFFECTS_V5) &&
    same(m.actions, await recoveryActionsV5()) && m.actionsSha256 === await sha256Hex(m.actions) &&
    m.riskFile === RECOVERY_RISK_FILE_V5 && now >= m.preparedAt && now < m.expiresAt && m.expiresAt - m.preparedAt === 7200000,
  'RECOVERY_FRESH_EXACT_APPROVAL_REQUIRED');
}
export async function recoverLockedV5({ manifest: m, approvedSha256, source, material, history, io, now = Date.now }) {
  const approve = () => assertRecoveryApprovalV5(m, approvedSha256, { source, material, history, now: now() });
  await approve(); const started = now(), fresh = await io.preflight(); await approve();
  must(same(recoveryPrestateV5(fresh), m.prestate) && now() - fresh.finishedAt <= 30000 && now() - started <= 180000,
    'RECOVERY_PRESTATE_DRIFT_OR_STALE');
  await io.consumeSlot({ manifestSha256: m.manifestSha256, at: now(), oldSlotReset: false, retryAllowed: false });
  let phase = 'PrivatePreparation', awsSteps = 0, neonSteps = 0;
  async function step(name, kind, fn) {
    await approve(); must(now() - started < 1200000, 'RECOVERY_EXECUTION_DEADLINE'); phase = name;
    await io.record(name + '.intent', { manifestSha256: m.manifestSha256, at: now() });
    if (kind === 'aws') awsSteps++; if (kind === 'neon') neonSteps++;
    must(awsSteps <= 2 && neonSteps <= 1, 'RECOVERY_WRITE_LIMIT');
    const r = await fn(); await io.record(name + '.ack', r); return r;
  }
  try {
    await step('PrivatePreparation', 'local', () => io.preparePrivate(material, m.prestate.neonTarget));
    await step('DatabaseVersion', 'aws', () => io.putDatabase());
    await step('ControlVersion', 'aws', () => io.putControl());
    await step('NeonAtomicCreate', 'neon', () => io.installNeon());
    phase = 'DedicatedCatalog'; const neon = await io.verifyDedicatedNeon();
    phase = 'MetadataInspect'; const proof = await io.inspectInstalled(neon);
    must(proof.lockedTrustVerified === true && proof.roleId === RECOVERY_ANCHOR_V5.roleId && proof.tableId === RECOVERY_ANCHOR_V5.tableId,
      'RECOVERY_ACTUAL_IDS_CHANGED');
    const contract = await loadNeonContractV5(), body = { schema: 'techlong/cloud-worker-installed-binding/v5', installed: true,
      roleId: proof.roleId, tableId: proof.tableId, neon: { ...neon, contractSha256: contract.contractSha256, sqlSha256: m.actions.neon.sqlSha256 },
      databaseSecret: RECOVERY_ANCHOR_V5.secrets[0], controlSecret: RECOVERY_ANCHOR_V5.secrets[1], evidenceBucket: C.bucket },
      binding = { ...body, installationSha256: await sha256Hex(body) };
    await assertInstallationV5(binding, binding.installationSha256, contract); await io.record('installation-binding', binding);
    const result = { outcome: 'RECOVERY_LOCKED_COMPLETE_REQUIRES_INDEPENDENT_INSPECT', manifestSha256: m.manifestSha256,
      bindingSha256: binding.installationSha256, counts: io.counts(), retryAllowed: false, runtimeEnabled: false };
    await io.record('result', result); return result;
  } catch (error) {
    const result = { outcome: 'RECOVERY_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY', manifestSha256: m.manifestSha256,
      phase, counts: io.counts(), failure: safeRecoveryFailureV5(error), retryAllowed: false, runtimeEnabled: false };
    await io.record('stopped', result); return result;
  } finally { io.disposePrivate(); }
}
