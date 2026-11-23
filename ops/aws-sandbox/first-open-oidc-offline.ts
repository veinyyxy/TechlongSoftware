// Pure validation shared by offline fixtures and the exact first-open handoff.
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { samplingBinding, type ReleaseSamplingBinding } from "../../lib/deployments/releases/sampling.ts";
import type { InstanceBinding, InstanceReleaseObservation, SoftwareRelease } from "../../lib/deployments/releases/contract.ts";
import type { FirstOnboardingReview } from "../../lib/deployments/first-onboarding.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

type Fields = Record<string, unknown>;
const object = (v: unknown): Fields => v && typeof v === "object" && !Array.isArray(v) ? v as Fields : {};
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) :
  typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;
const fail = (code: string): never => { throw Error("FIRST_OPEN_OFFLINE_" + code); };
const ms = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  ? Date.parse(value) : NaN;
const keysMatch = (v: Fields, keys: readonly string[]) => canonicalJson(Object.keys(v).sort()) === canonicalJson([...keys].sort());
const zipSha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const firstOpenHandoffSchema = contract.artifactContract.bodySchema;
export type FirstOpenHandoffPair = Readonly<{
  pairSha256: string; approvalSha256: string; runtimeSourceSha256: string; callerCommit: string;
  workflowId: string; actorId: string; runOnceId: string; inspectId: string;
  startAt: number; writeBefore: number; phaseCutoffs: readonly number[]; inspectorSessionArnSha256: string;
  taskRelease?: FirstOpenTaskRelease;
}>;
const schedule = contract.handoffs.flatMap(h => [
  ...(h.intentSuffix ? [{ kind: h.intentSuffix, writer: true, keys: h.intentPayloadKeys! }] : []),
  { kind: h.receiptSuffix, writer: false, keys: h.receiptPayloadKeys },
]);
export const validFirstOpenG1ArnSuffix = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{6}$/.test(v);
export function firstOpenHandoffPayloadKeys(pair: FirstOpenHandoffPair, index: number) {
  const stage = schedule[index];
  if (!stage) return fail("SEQUENCE_CLOSED");
  // Only the server-assigned suffix is exposed; the exact name, account and
  // region are already pinned by the reader. The historical contract is unchanged.
  return pair.taskRelease && stage.kind === "02-g1-check-request" ? [...stage.keys, "g1ArnSuffix"] : stage.keys;
}
export function offlineHandoffTitle(pair: FirstOpenHandoffPair, writer: boolean) {
  return writer ? `first-open-fc41597f-runonce-${pair.pairSha256}-${pair.inspectId}` :
    `first-open-fc41597f-inspect-${pair.pairSha256}`;
}
export function offlineHandoffArtifactName(pairSha256: string, kind: string) {
  return `fc41597f-${pairSha256}-${kind}`;
}
export function assertFirstOpenProducer(pair: FirstOpenHandoffPair, run: Fields, writer: boolean) {
  const expectedRunId = writer ? pair.runOnceId : pair.inspectId;
  const repo = object(run.repository), repoId = "1323312747";
  if (id(run.id) !== expectedRunId || id(run.workflow_id) !== pair.workflowId || run.run_attempt !== 1 ||
    run.event !== "workflow_dispatch" || run.path !== contract.federatedTrust.callerPathCandidate ||
    run.head_branch !== "main" || run.head_sha !== pair.callerCommit || repo.full_name !== "veinyyxy/TechlongSoftware" ||
    id(repo.id) !== repoId || id(object(repo.owner).id) !== "14145707" || id(object(run.head_repository).id) !== repoId ||
    id(object(run.actor).id) !== pair.actorId || id(object(run.triggering_actor).id) !== pair.actorId ||
    run.display_title !== offlineHandoffTitle(pair, writer) || run.status !== "in_progress" || run.conclusion !== null) {
    return fail("PRODUCER_RUN");
  }
}
export function firstOpenArtifactMetadata(pair: FirstOpenHandoffPair, listed: Fields, stageIndex: number, now: number) {
  const stage = schedule[stageIndex];
  if (!stage) return fail("ARTIFACT_COUNT");
  return firstOpenNamedArtifactMetadata(pair, listed, stage.kind, stage.writer, now);
}
export function firstOpenNamedArtifactMetadata(pair: FirstOpenHandoffPair, listed: Fields, kind: string, writer: boolean, now: number) {
  const repoId = "1323312747";
  if (listed.total_count !== 1 || !Array.isArray(listed.artifacts) || listed.artifacts.length !== 1) return fail("ARTIFACT_COUNT");
  const a = object(listed.artifacts[0]), artifactId = id(a.id), ar = object(a.workflow_run), created = ms(a.created_at);
  if (!artifactId || a.name !== offlineHandoffArtifactName(pair.pairSha256, kind) ||
    a.expired !== false || !(ms(a.expires_at) > now) || !(created >= pair.startAt && created <= now) ||
    typeof a.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(a.digest) ||
    !Number.isSafeInteger(a.size_in_bytes) || Number(a.size_in_bytes) < 1 || Number(a.size_in_bytes) > contract.artifactContract.maxZipBytes ||
    a.archive_download_url !== `https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/artifacts/${artifactId}/zip` ||
    id(ar.id) !== (writer ? pair.runOnceId : pair.inspectId) || id(ar.repository_id) !== repoId || id(ar.head_repository_id) !== repoId ||
    ar.head_sha !== pair.callerCommit || ar.head_branch !== "main") return fail("ARTIFACT_PROVENANCE");
  return { artifactId, archiveDigest: a.digest.slice(7), created };
}
export function decodeFirstOpenHandoffArchive(zip: Uint8Array, archiveDigest: string) {
  if (!zip.length || zip.length > contract.artifactContract.maxZipBytes || zipSha(zip) !== archiveDigest) return fail("ZIP_DIGEST");
  try {
    let count = 0;
    const contents = unzipSync(zip, { filter(entry) {
      if (++count !== 1 || entry.name !== contract.artifactContract.soleArchiveMember || ![0, 8].includes(entry.compression) ||
        entry.originalSize < 1 || entry.originalSize > contract.artifactContract.maxJsonBytes) return fail("ZIP_ENTRY");
      return true;
    } });
    if (count !== 1) return fail("ZIP_ENTRY");
    const raw = contents[contract.artifactContract.soleArchiveMember];
    if (!raw?.length || raw.length > contract.artifactContract.maxJsonBytes) return fail("ZIP_ENTRY");
    const source = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const body = object(JSON.parse(source));
    if (source !== canonicalJson(body)) return fail("NON_CANONICAL_BODY");
    return { body, bodySha256: zipSha(raw) };
  } catch { return fail("ARTIFACT_BODY"); }
}

/** Assumes the future transport authenticates the API responses and proves
 * the exact caller commit has only its intended uploader. API shape checks
 * alone cannot distinguish jobs that share the same Actions runtime token. */
export function offlineFirstOpenHandoffVerifier(source: FirstOpenHandoffPair) {
  const pair = structuredClone(source);
  const releaseId = firstOpenVersion(pair.taskRelease).releaseId;
  if (![pair.pairSha256, pair.approvalSha256, pair.runtimeSourceSha256, pair.inspectorSessionArnSha256].every(digest) ||
    !/^[a-f0-9]{40}$/.test(pair.callerCommit) || ![pair.workflowId, pair.actorId, pair.runOnceId, pair.inspectId].every(id) ||
    pair.runOnceId === pair.inspectId || ![pair.startAt, pair.writeBefore].every(Number.isSafeInteger) ||
    pair.phaseCutoffs.length !== schedule.length ||
    pair.phaseCutoffs.some((v, n) => !Number.isSafeInteger(v) || v <= pair.startAt || v > pair.writeBefore ||
      (n > 0 && v < pair.phaseCutoffs[n - 1]))) fail("PAIR");
  let index = 0, lastTime = pair.startAt - 1, lastBody: string | null = null, stopped = false;
  let lastPayload: Fields = {};
  const artifactIds = new Set<string>();
  return (input: { run: Fields; listed: Fields; zip: Uint8Array; now: number }) => {
    const stage = schedule[index];
    if (stopped || !stage) return fail("SEQUENCE_CLOSED");
    try {
      const { run, listed, now } = input, until = pair.phaseCutoffs[index];
      if (!Number.isSafeInteger(now) || now < pair.startAt || now >= until) return fail("WINDOW");
      assertFirstOpenProducer(pair, run, stage.writer);
      const { artifactId, archiveDigest, created } = firstOpenArtifactMetadata(pair, listed, index, now);
      if (artifactIds.has(artifactId)) return fail("ARTIFACT_PROVENANCE");
      const { body, bodySha256 } = decodeFirstOpenHandoffArchive(input.zip, archiveDigest), payload = object(body.payload), time = ms(body.producedAtUtc);
      if (!keysMatch(body, contract.artifactContract.envelopeKeys) || !keysMatch(payload, firstOpenHandoffPayloadKeys(pair, index)) ||
        (pair.taskRelease && stage.kind === "02-g1-check-request" && !validFirstOpenG1ArnSuffix(payload.g1ArnSuffix)) ||
        body.schema !== firstOpenHandoffSchema || body.kind !== stage.kind || body.jobId !== contract.jobId ||
        body.pairSha256 !== pair.pairSha256 || body.approvalSha256 !== pair.approvalSha256 ||
        body.runOnceId !== pair.runOnceId || body.inspectId !== pair.inspectId || body.producerAttempt !== 1 ||
        body.producerSourceSha256 !== pair.runtimeSourceSha256 || body.previousBodySha256 !== lastBody ||
        !(time > lastTime && time <= now && created + 1_000 >= time) ||
        Object.entries(payload).some(([key, value]) => key.endsWith("Sha256") && !digest(value))) {
        return fail("RECEIPT_BINDING");
      }
      if (stage.kind === "01-inspector-ready" && (payload.inspectorRoleId !== contract.federatedTrust.inspect.targets[0].roleId ||
        payload.inspectorSessionArnSha256 !== pair.inspectorSessionArnSha256 ||
        !(ms(payload.verifiedAtUtc) >= pair.startAt && ms(payload.verifiedAtUtc) <= time) ||
        !(ms(payload.credentialExpiresAtUtc) > pair.writeBefore))) return fail("INSPECTOR_SESSION");
      if (!stage.writer && index > 0 && (payload.requestBodySha256 !== lastBody ||
        !(ms(payload.observedAtUtc) > lastTime && ms(payload.observedAtUtc) <= time))) return fail("OBSERVATION_ORDER");
      const repeats = index === 2 ? ["secretReferenceSha256", "versionIdSha256", "g1e1FenceSha256"] :
        index === 4 ? ["stackIdSha256", "expectedRuntimeScopeSha256", "samplingSha256", "g1e1FenceSha256", "databaseIdentitySha256"] : [];
      if (repeats.some(key => payload[key] !== lastPayload[key]) ||
        index === 3 && payload.g1e1FenceSha256 !== lastPayload.g1e1FenceSha256 ||
        index === 2 && (payload.onlyCurrentVersionVerified !== true || payload.notDeletingOrRotatingVerified !== true) ||
        index === 4 && payload.releaseId !== releaseId) return fail("RECEIPT_OUTCOME");
      artifactIds.add(artifactId); index++; lastTime = time; lastBody = bodySha256; lastPayload = structuredClone(payload);
      return { artifactId, bodySha256, body, payload };
    } catch (error) { stopped = true; throw error; }
  };
}

export const offlineRuntimeObservationSha = (r: InstanceReleaseObservation) =>
  sha256Hex({ ...r, parameterKeys: [...r.parameterKeys].sort() });

/** Compare this with the real builder, using only public receipt fields and
 * data already held by RunOnce. This does not validate AWS observations. */
export async function rebuildOfflineFirstOpenBinding(local: {
  scope: FirstOnboardingReview["payload"]["scope"]; release: SoftwareRelease; sampling: ReleaseSamplingBinding;
  clientApiVersion: string; stackId: string; expectedTemplateSha256: string; expectedRuntimeScopeSha256: string;
  epochSha256: string; databaseIdentitySha256: string; parameterKeys: readonly string[];
}, received: Fields) {
  const { scope, sampling, release } = local;
  const observedAt = ms(received.observedAtUtc);
  if (!(observedAt > 0) || !digest(received.runtimeConfigurationSha256) || !digest(received.runtimeObservationSha256) ||
    !digest(received.initialBindingSha256) || received.releaseId !== release.id || scope.releaseId !== release.id ||
    received.stackIdSha256 !== await sha256Hex(local.stackId) || received.runtimeTemplateSha256 !== local.expectedTemplateSha256 ||
    received.expectedRuntimeScopeSha256 !== local.expectedRuntimeScopeSha256 || received.g1e1FenceSha256 !== local.epochSha256 ||
    received.databaseIdentitySha256 !== local.databaseIdentitySha256 || received.samplingSha256 !== await sha256Hex(sampling) ||
    !release.compatibility.clientApiVersions.includes(local.clientApiVersion) || sampling.database.profile !== "express_iam" ||
    sampling.database.kind !== "cluster" || scope.artifactRef !== `${release.image.repository}@${release.image.manifestDigest}`) {
    return fail("BINDING_COORDINATE");
  }
  const runtime: InstanceReleaseObservation = {
    instanceId: scope.appInstanceId, stackId: local.stackId, observedAt, state: "RUNNING",
    templateSha256: local.expectedTemplateSha256, configurationSha256: received.runtimeConfigurationSha256,
    imageUri: scope.artifactRef, platformDigest: release.image.platformDigest, parameterKeys: [...local.parameterKeys].sort(),
    servicePresent: true, albPresent: true, databaseAvailable: true, databaseProfile: "express_iam",
    databaseSchemaVersion: sampling.database.schemaVersion, desiredCount: 1, runningCount: 1, pendingCount: 0,
    operationInProgress: false, persistentUploadsReady: true,
  };
  if (await offlineRuntimeObservationSha(runtime) !== received.runtimeObservationSha256) return fail("RUNTIME_PROJECTION");
  const binding: InstanceBinding & { sampling: ReleaseSamplingBinding } = {
    instanceId: scope.appInstanceId, workspaceId: scope.workspaceId, productId: scope.productId, environmentId: scope.environmentId,
    accountId: scope.accountId, region: "ca-central-1", stackId: local.stackId, initialized: true, status: "active",
    sourceRepository: release.source.repository, imageRepository: release.image.repository, runtimePlatform: release.image.runtimePlatform,
    applicationPort: release.compatibility.applicationPort, clientApiVersion: local.clientApiVersion, desiredCount: 1,
    templateSha256: runtime.templateSha256, configurationSha256: runtime.configurationSha256, stateRevision: 0,
    currentRelease: { id: release.id, manifestDigest: release.image.manifestDigest, platformDigest: release.image.platformDigest }, sampling,
  };
  samplingBinding(binding);
  const text = canonicalJson(binding);
  if (await sha256Hex(text) !== received.initialBindingSha256) return fail("BINDING_BYTES");
  return { runtime, text };
}
