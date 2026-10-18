// Local one-shot LOCKED installation. No workload or trust activation method.
import { canonicalJson, sha256Hex } from '../../../lib/deployments/execution/hash.ts';
import { foundationTemplateV5, secretResourcePolicyV5, INSTALL_SCOPE_V5 as I } from './plan-v5.mjs';
import { INSTALL_CANDIDATE_V5 as C } from './inventory-v5.mjs';
import { loadNeonContractV5, renderNeonContractV5 } from '../neon-contract-v5.mjs';
import { assertInstallationV5 } from '../cloud-worker-root-v5.mjs';
import { neonInstallRecipeV5 } from './neon-install-sql-v5.mjs';
const must = (ok, code) => { if (!ok) throw Error(code); };
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
export const INSTALL_EFFECTS_V5 = Object.freeze({ createStackCalls: 1, foundationResources: 5,
  createEmptySecrets: 2, putSecretResourcePolicies: 2, putFixedSecretVersions: 2, neonAtomicInstallTransactions: 1,
  privateLocalBundleReads: 1, sourceSecretValueReads: 0, dedicatedDatabaseCatalogReads: 1,
  businessRowWrites: 0, trustActivationWrites: 0, githubWrites: 0, workloadWrites: 0,
  automaticRetries: 0, automaticRollback: false, localPermanentSlotReset: false });
export const INSTALL_RISK_FILE_V5 = 'docs/aws-auto-deployment-cloud-worker-w5e-installer.md';
export async function installActionsV5(capsule) {
  const contract = await loadNeonContractV5(), sql = renderNeonContractV5(contract);
  return { foundation: { stackName: I.foundationStack, template: foundationTemplateV5(capsule),
    capabilities: ['CAPABILITY_NAMED_IAM'], disableRollback: true, terminationProtection: true },
  secrets: C.secrets.map((name, i) => ({ name, versionId: I.secretVersions[i], defaultAwsManagedKey: true,
    policy: secretResourcePolicyV5(), order: ['CreateEmpty','IsolateAndVerify','PutFixedVersionOnce'] })),
  neon: { role: C.roleDb, schema: C.schema, ownerOid: '16392', contractSha256: contract.contractSha256,
    sqlSha256: await sha256Hex(sql.statements), statements: sql.statements,
    installRecipe: await neonInstallRecipeV5(), installRecipeSha256: await sha256Hex(await neonInstallRecipeV5()),
    roleFlags: 'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    password: 'GENERATE_48_RANDOM_BYTES_IN_MEMORY_STORE_SCRAM_VERIFIER_NO_PLAINTEXT_SQL' },
  order: ['FoundationLocked','BothEmptySecretsIsolated','ReadAndValidateControlOnce','NeonAtomicInstall',
    'DedicatedCatalogRead','PutDatabaseVersion','PutControlVersion','IndependentMetadataAndCatalogReadback'],
  activation: 'SEPARATE_FRESH_REVIEW_OF_ACTUAL_IDS_AND_IMMUTABLE_WORKFLOW_COMMIT_REQUIRED' };
}
export function stablePrestateV5(p) {
  // Compare only required, immutable metadata, not request IDs/timing or old
  // workload expiry. Concurrent unrelated workload metadata is not an install CAS.
  const a = p.aws, n = p.neon;
  must(a?.source?.Arn === I.sourceArn && a.source.Account === '402010193138' &&
    a.source.UserId === 'AIDAV3GNMXTZEO7SHLC2X' && a.preservedIam?.iamLayoutUnchanged === true &&
    a.oidcRoleReferenceScanComplete === true && a.oidc?.state === 'READ' &&
    a.oidc.value.Url === 'token.actions.githubusercontent.com' && a.oidc.value.ClientIDList?.includes('sts.amazonaws.com') &&
    [a.workerRole,a.boundary,a.journal,a.evidenceBucket,...C.secrets.map(name => a.secrets?.[name]),p.foundation]
      .every(x => x?.state === 'ABSENT_AT_CHECK') &&
    n?.state === 'READ' && n.catalog?.read_only === 'on' && n.catalog.actor === 'neondb_owner' &&
    n.catalog.session_actor === 'neondb_owner' && n.catalog.installer?.oid === '16392' && n.catalog.installer.createRole === true &&
    n.catalog.candidate_role === null && n.catalog.candidate_schema === null && n.catalog.public_database_create === false &&
    n.catalog.public_create_schemas?.length === 0 && n.catalog.public_relation_grants?.length === 0 &&
    n.catalog.public_column_grants?.length === 0 && n.catalog.definers?.every(f => f.publicExecutable === false) &&
    n.catalog.default_acl?.every(a => a.owner !== '16392' || !['f','n'].includes(a.type)) &&
    n.catalog.target_tables?.length === 10 && n.catalog.target_tables.every(t => t.owner === '16392' && t.rls === false && t.forceRls === false),
  'INSTALL_FRESH_ABSENT_PRESTATE_REQUIRED');
  return { source: { arn: a.source.Arn, id: a.source.UserId }, oidc: { url: a.oidc.value.Url,
    clientIds: [...a.oidc.value.ClientIDList].sort(), thumbprints: [...(a.oidc.value.ThumbprintList ?? [])].sort() },
  preservedIam: a.preservedIam, neonTarget: n.targetFingerprintSha256, neonCatalog: n.catalog,
  requiredAbsent: [C.role,C.boundary,C.table,C.bucket,...C.secrets,I.foundationStack] };
}
export async function prepareInstallV5({ capsule, prestate, source, material, now }) {
  must(Number.isSafeInteger(now) && source?.files?.length > 0 && /^[a-f0-9]{40}$/.test(source.commit) &&
    /^[a-f0-9]{64}$/.test(material?.summarySha256), 'INSTALL_SOURCE_OR_MATERIAL_BINDING');
  const actions = await installActionsV5(capsule), body = { schema: 'techlong/cloud-worker-locked-install-review/v5',
    preparedAt: now, expiresAt: now + 2 * 3600000, source: structuredClone(source), material: structuredClone(material),
    prestate: structuredClone(stablePrestateV5(prestate)), actions, actionsSha256: await sha256Hex(actions),
    capsuleSha256: await sha256Hex(capsule), effects: INSTALL_EFFECTS_V5, riskFile: INSTALL_RISK_FILE_V5,
    activationAuthorized: false, paidWorkloadAuthorized: false };
  return { ...body, manifestSha256: await sha256Hex(body) };
}
export async function assertInstallApprovalV5(m, approved, { capsule, source, material, now }) {
  const { manifestSha256, ...body } = m;
  must(/^[a-f0-9]{64}$/.test(approved) && approved === manifestSha256 && await sha256Hex(body) === approved &&
    Object.keys(body).sort().join(',') === 'actions,actionsSha256,activationAuthorized,capsuleSha256,effects,expiresAt,material,paidWorkloadAuthorized,preparedAt,prestate,riskFile,schema,source' &&
    m.schema === 'techlong/cloud-worker-locked-install-review/v5' && m.activationAuthorized === false && m.paidWorkloadAuthorized === false &&
    equal(m.source, source) && equal(m.material, material) && equal(m.effects, INSTALL_EFFECTS_V5) &&
    m.capsuleSha256 === await sha256Hex(capsule) && m.riskFile === INSTALL_RISK_FILE_V5 &&
    equal(m.actions, await installActionsV5(capsule)) && m.actionsSha256 === await sha256Hex(m.actions) &&
    m.expiresAt - m.preparedAt === 2 * 3600000 && now >= m.preparedAt && now < m.expiresAt,
  'INSTALL_FRESH_EXACT_APPROVAL_REQUIRED');
}
/** IO must be the fixed local adapter. Dependency injection also permits
 * failure-boundary tests without ever reading production credentials. */
export async function installLockedV5({ manifest: m, approvedSha256, capsule, source, material, io, now = Date.now }) {
  const approve = () => assertInstallApprovalV5(m, approvedSha256, { capsule, source, material, now: now() });
  await approve();
  const start = now(), fresh = await io.preflight();
  await approve();
  must(equal(stablePrestateV5(fresh), m.prestate) && now() - fresh.finishedAt <= 30000 && now() - start <= 180000,
    'INSTALL_PRESTATE_DRIFT_OR_STALE');
  // Fixed global (NOT per-manifest) create-only slot, BEFORE any external write
  // or private bundle read. Losing an acknowledgement never enables replay.
  await io.consumeSlot({ manifestSha256: m.manifestSha256, consumedAt: now(), retryAllowed: false });
  let phase = 'FoundationLocked', attemptedAwsWrites = 0, attemptedNeonWrites = 0, privateReads = 0;
  const step = async (label, fn, kind = 'aws') => {
    await approve(); must(now() - start < 20 * 60000, 'INSTALL_RUNTIME_DEADLINE'); phase = label;
    await io.record(label + '.intent', { manifestSha256: m.manifestSha256, at: now() });
    if (kind === 'aws') attemptedAwsWrites++; if (kind === 'neon') attemptedNeonWrites++;
    must(attemptedAwsWrites <= 7 && attemptedNeonWrites <= 1, 'INSTALL_WRITE_BUDGET');
    const result = await fn(); await io.record(label + '.ack', result); return result;
  };
  try {
    const foundation = await step('FoundationLocked', () => io.createFoundation(m.actions.foundation));
    await io.verifyFoundation(foundation); // trust must still be DENY
    const refs = [];
    for (let index = 0; index < 2; index++) {
      const a = m.actions.secrets[index], ref = await step('EmptySecret' + index, () => io.createEmptySecret(a));
      await step('IsolateSecret' + index, () => io.isolateSecret(ref, a));
      await io.verifySecret(ref, a, false); refs.push({ ...ref, versionId: a.versionId });
    }
    await approve(); phase = 'PrivateControlRead'; privateReads++;
    await io.record(phase + '.intent', { fileReadsAtMost: 1, at: now() });
    const control = await io.loadControl(material, capsule.controlFingerprints);
    await io.record(phase + '.ack', { publicFingerprintsVerified: true, valuesSaved: false });
    // The adapter keeps password/DSN only in memory. Neither return value nor
    // receipt contains verifier/DSN/password/private PEM.
    const neon = await step('NeonAtomicInstall', () => io.installNeon(m.actions.neon), 'neon');
    await io.verifyDedicatedNeon(neon);
    await step('DatabaseVersion', () => io.putDatabase(refs[0]));
    await step('ControlVersion', () => io.putControl(refs[1], control));
    const proof = await io.inspect({ foundation, refs, neon, manifest: m });
    must(proof.outcome === 'LOCKED_INSTALL_METADATA_VERIFIED', 'INSTALL_POSTSTATE_REQUIRES_INSPECT');
    const contract = await loadNeonContractV5(), bindingBody = { schema: 'techlong/cloud-worker-installed-binding/v5', installed: true,
      roleId: proof.roleId, tableId: proof.tableId, neon: { ...neon, contractSha256: contract.contractSha256,
        sqlSha256: m.actions.neon.sqlSha256 }, databaseSecret: refs[0], controlSecret: refs[1], evidenceBucket: C.bucket };
    const binding = { ...bindingBody, installationSha256: await sha256Hex(bindingBody) };
    await assertInstallationV5(binding, binding.installationSha256, contract);
    await io.record('installation-binding', binding);
    const result = { outcome: 'LOCKED_INSTALLED_REQUIRES_INDEPENDENT_INSPECT_AND_ACTIVATION_REVIEW', manifestSha256: m.manifestSha256,
      attemptedAwsWrites, attemptedNeonWrites, privateReads, bindingSha256: binding.installationSha256,
      retryAllowed: false, runtimeEnabled: false, trustActivated: false };
    await io.record('result', result); return result;
  } catch {
    const result = { outcome: 'PARTIAL_OR_UNKNOWN_REQUIRES_INDEPENDENT_INSPECT_NO_RETRY', manifestSha256: m.manifestSha256,
      phase, attemptedAwsWrites, attemptedNeonWrites, privateReads, retryAllowed: false, runtimeEnabled: false };
    await io.record('stopped', result); return result;
  } finally { io.disposePrivate(); }
}
