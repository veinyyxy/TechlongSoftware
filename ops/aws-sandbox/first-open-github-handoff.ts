import { setTimeout as sleep } from "node:timers/promises";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { assertFirstOpenProducer, decodeFirstOpenHandoffArchive, firstOpenArtifactMetadata, firstOpenNamedArtifactMetadata,
  firstOpenHandoffPayloadKeys, firstOpenHandoffSchema, offlineFirstOpenHandoffVerifier,
  offlineHandoffArtifactName, validFirstOpenG1ArnSuffix, type FirstOpenHandoffPair } from "./first-open-oidc-offline.ts";
import type { VersionAuthorityScope } from "./first-open-controlled-cfn.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

type Fields = Record<string, unknown>;
type OwnUpload = (input: { name: string; member: "handoff.json"; bytes: Uint8Array; signal: AbortSignal }) => Promise<{ artifactId: string }>;
const api = "https://api.github.com/repos/veinyyxy/TechlongSoftware/actions";
const maxZip = contract.artifactContract.maxZipBytes, maxJson = contract.artifactContract.maxJsonBytes;
const stages = contract.artifactContract.chain;
const fail = (code: string): never => { throw Error("FIRST_OPEN_HANDOFF_" + code); };
const object = (v: unknown): Fields => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Fields : fail("OBJECT");
const wait = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal });
const iso = (now: number) => new Date(now).toISOString();
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

async function boundedBytes(response: Response, max: number) {
  if (!response.body) return fail("RESPONSE_BODY");
  const read = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const r = await read.read();
      if (r.done) break;
      size += r.value.length;
      if (size > max) return fail("RESPONSE_LIMIT");
      chunks.push(r.value);
    }
  } finally { await read.cancel().catch(() => {}); }
  return Buffer.concat(chunks, size);
}

type ArtifactIoOptions = {
  token: string;
  now?: () => number; fetch?: typeof fetch; pause?: (ms: number, signal: AbortSignal) => Promise<void>;
};
export function firstOpenArtifactIo(options: ArtifactIoOptions) {
  const now = options.now ?? Date.now, fetcher = options.fetch ?? fetch, pause = options.pause ?? wait;
  if (!options.token || !/^[A-Za-z0-9_]+$/.test(options.token)) return fail("SELF");
  const request = (url: string, signal: AbortSignal, authenticated: boolean) => fetcher(url, {
    method: "GET", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    redirect: "manual", ...(authenticated ? { headers: { Accept: "application/vnd.github+json",
      Authorization: "Bearer " + options.token, "X-GitHub-Api-Version": "2022-11-28" } } : {}),
  });
  async function json(url: string, signal: AbortSignal) {
    const response = await request(url, signal, true);
    if (response.status !== 200) return fail("HTTP_STATUS");
    return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(response, 1024 * 1024))));
  }
  async function readListed(url: string, name: string, until: number, signal: AbortSignal) {
    for (let poll = 0; poll < 16; poll++) {
      signal.throwIfAborted();
      if (now() >= until) return fail("PHASE_CLOSED");
      const page = await json(url, signal), total = page.total_count, rows = page.artifacts;
      if (!Array.isArray(rows) || !Number.isSafeInteger(total) || Number(total) < 0) return fail("LIST_INVALID");
      if (rows.some(row => object(row).name !== name)) return fail("LIST_WRONG_NAME");
      if (rows.length > 1) return fail("LIST_DUPLICATE");
      if (rows.length === 1 && total === 1) return page;
      if (poll < 15) await pause(Math.max(1, Math.min(10_000, until - now())), signal);
    }
    return fail("LIST_NOT_VISIBLE");
  }
  async function archive(artifactId: string, signal: AbortSignal) {
    const redirect = await request(`${api}/artifacts/${artifactId}/zip`, signal, true);
    if (redirect.status !== 302) return fail("DOWNLOAD_REDIRECT");
    const blob = new URL(redirect.headers.get("location") ?? "");
    if (blob.protocol !== "https:" || blob.username || blob.password || (blob.port && blob.port !== "443") ||
      ![".blob.core.windows.net", ".githubusercontent.com"].some(host => blob.hostname.endsWith(host))) return fail("DOWNLOAD_HOST");
    const response = await request(blob.toString(), signal, false);
    if (response.status !== 200) return fail("DOWNLOAD_STATUS");
    return boundedBytes(response, maxZip);
  }
  return { now, pause, json, readListed, archive };
}

/** Exact REST reads plus the caller's frozen, same-run immutable uploader.
 * No token discovery, credential forwarding, upload fallback, or dispatch. */
export function firstOpenGitHubHandoff(options: ArtifactIoOptions & {
  pair: FirstOpenHandoffPair; role: "runonce" | "inspect"; ownRunId: string; uploadOwn: OwnUpload;
  runtimeObservedNotBefore?: number;
}) {
  const pair = structuredClone(options.pair), { now, pause, json, readListed, archive } = firstOpenArtifactIo(options);
  const accept = offlineFirstOpenHandoffVerifier(pair);
  const releaseId = firstOpenVersion(pair.taskRelease).releaseId;
  const writer = options.role === "runonce";
  if ((!writer && options.role !== "inspect") || options.ownRunId !== (writer ? pair.runOnceId : pair.inspectId)) return fail("SELF");
  const runtimeObservedNotBefore = options.runtimeObservedNotBefore;
  if (runtimeObservedNotBefore !== undefined && (!pair.taskRelease || !Number.isSafeInteger(runtimeObservedNotBefore) ||
    !(pair.phaseCutoffs[3] < runtimeObservedNotBefore && runtimeObservedNotBefore < pair.phaseCutoffs[4]))) return fail("PHASE_SCOPE");
  let index = 0, previousBodySha256: string | null = null, busy = false, stopped = false;
  async function step(kind: string, upstream: AbortSignal, payload?: Fields) {
    if (busy || stopped || stages[index] !== kind || !stages[index]) return fail("SEQUENCE");
    busy = true;
    try {
      const at = now(), until = pair.phaseCutoffs[index], fromWriter = index % 2 === 1;
      if (at < pair.startAt || at >= until || (fromWriter === writer) !== (payload !== undefined)) return fail("PHASE_SCOPE");
      const signal = AbortSignal.any([upstream, AbortSignal.timeout(until - at)]);
      signal.throwIfAborted();
      if (writer && kind === "03-runtime-observed" && runtimeObservedNotBefore !== undefined) {
        const after = runtimeObservedNotBefore - now();
        if (after > 0) await pause(after, signal);
        signal.throwIfAborted();
        if (now() < runtimeObservedNotBefore || now() >= until) return fail("PHASE_CLOSED");
      }
      const source = fromWriter ? pair.runOnceId : pair.inspectId, name = offlineHandoffArtifactName(pair.pairSha256, kind);
      let ownId: string | undefined;
      if (payload) {
        const keys = firstOpenHandoffPayloadKeys(pair, index);
        if (Object.keys(payload).length !== keys.length || !keys.every(key => Object.hasOwn(payload, key) &&
          (key.endsWith("Sha256") ? typeof payload[key] === "string" && /^[a-f0-9]{64}$/.test(payload[key] as string) :
            key.endsWith("Utc") ? typeof payload[key] === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(payload[key] as string) :
            key === "g1ArnSuffix" ? validFirstOpenG1ArnSuffix(payload[key]) :
            key === "inspectorRoleId" ? payload[key] === contract.federatedTrust.inspect.targets[0].roleId :
            key === "releaseId" ? payload[key] === releaseId : payload[key] === true))) return fail("UPLOAD_PROJECTION");
        const bytes = new TextEncoder().encode(canonicalJson({
          schema: firstOpenHandoffSchema, kind, jobId: contract.jobId, pairSha256: pair.pairSha256, approvalSha256: pair.approvalSha256,
          runOnceId: pair.runOnceId, inspectId: pair.inspectId, producerAttempt: 1, producerSourceSha256: pair.runtimeSourceSha256,
          producedAtUtc: iso(at), previousBodySha256, payload,
        }));
        if (!bytes.length || bytes.length > maxJson) return fail("UPLOAD_LIMIT");
        assertFirstOpenProducer(pair, await json(`${api}/runs/${source}`, signal), fromWriter);
        signal.throwIfAborted();
        if (now() >= until) return fail("PHASE_CLOSED");
        ownId = (await options.uploadOwn({ name, member: "handoff.json", bytes, signal })).artifactId;
        if (!/^[1-9][0-9]{0,19}$/.test(ownId)) return fail("UPLOAD_ACK");
      }
      const runUrl = `${api}/runs/${source}`, listed = await readListed(`${runUrl}/artifacts?name=${name}&per_page=2`, name, until, signal);
      const { artifactId } = firstOpenArtifactMetadata(pair, listed, index, now());
      if (ownId !== undefined && ownId !== artifactId) return fail("UPLOAD_ACK");
      assertFirstOpenProducer(pair, await json(runUrl, signal), fromWriter);
      const zip = await archive(artifactId, signal), run = await json(runUrl, signal);
      signal.throwIfAborted();
      const observed = accept({ run, listed, zip, now: now() });
      if (writer && kind === "03-runtime-observed" && runtimeObservedNotBefore !== undefined &&
        Date.parse(observed.body.producedAtUtc as string) < runtimeObservedNotBefore) return fail("PHASE_SCOPE");
      previousBodySha256 = observed.bodySha256;
      index++;
      return observed;
    } catch (error) {
      stopped = true;
      // Do not propagate URLs (including signed URLs), provider bodies or secrets.
      if (error instanceof Error && /^FIRST_OPEN_(HANDOFF|OFFLINE)_[A-Z_]+$/.test(error.message)) throw error;
      return fail("IO_STOP");
    } finally { busy = false; }
  }
  return {
    take: (kind: string, signal: AbortSignal) => step(kind, signal),
    emit: (kind: string, payload: Fields, signal: AbortSignal) => step(kind, signal, payload),
    requireApproval(sha: string, startAt: number, claimBefore: number, writeBefore: number, taskRelease?: FirstOpenTaskRelease) {
      if (sha !== pair.approvalSha256 || startAt !== pair.startAt || writeBefore !== pair.writeBefore ||
        pair.phaseCutoffs[0] > claimBefore || pair.phaseCutoffs[4] >= writeBefore) fail("APPROVAL_WINDOW");
      if (canonicalJson(taskRelease ?? null) !== canonicalJson(pair.taskRelease ?? null)) fail("APPROVAL_TASK_RELEASE");
    },
    async keepInspectorAvailable(signal: AbortSignal) {
      if (writer || index !== stages.length || stopped) return fail("SEQUENCE");
      const remaining = pair.phaseCutoffs[4] - now();
      if (remaining > 0) await pause(remaining, signal);
    },
  };
}

export type FirstOpenGitHubHandoff = ReturnType<typeof firstOpenGitHubHandoff>;

const authorityKinds = {
  request: "cfn-version-request", observed: "cfn-version-observed", relocked: "cfn-version-relocked",
} as const;
type AuthorityKind = keyof typeof authorityKinds;
export type FirstOpenAuthorityIntent = { scopeSha256: string; versionId: string; requestSha256: string;
  templateSha256: string; operationSha256: string; putAcknowledgedAt: number };
const keys = (x: Fields, ys: string) => Object.keys(x).sort().join(",") === ys;
const whole = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
function authorityBody(kind: AuthorityKind, p: Fields) {
  if (!digest(p.scopeSha256)) return fail("AUTHORITY_BODY");
  if (kind === "request") {
    if (!keys(p, "operationSha256,putAcknowledgedAt,requestSha256,scopeSha256,templateSha256,versionId") ||
      ![p.operationSha256, p.requestSha256, p.templateSha256].every(digest) ||
      !validFirstOpenVersionId(p.versionId) || !whole(p.putAcknowledgedAt)) return fail("AUTHORITY_BODY");
  } else if (kind === "observed") {
    if (!keys(p, "checkedAt,evidence,expiresAt,policySha256,schema,scopeSha256") ||
      p.schema !== "techlong/fc41597f-exact-cfn-version-authority/v2" || ![p.checkedAt, p.expiresAt].every(whole) ||
      !digest(p.policySha256) || p.evidence !== "MATCHED_INSTALLED_POLICY_DOCUMENTS") return fail("AUTHORITY_BODY");
  } else if (!keys(p, "checkedAt,policySha256,relocked,scopeSha256") || p.relocked !== true ||
    !whole(p.checkedAt) || !digest(p.policySha256)) return fail("AUTHORITY_BODY");
}

/** Reuse the same authenticated REST, one-member ZIP and immutable uploader.
 * These named slots never advance or restart the original five-artifact chain.
 * The trusted source pin comes from protected inputs, not from the uploader. */
export function firstOpenGitHubAuthorityArtifacts(options: ArtifactIoOptions & {
  pair: FirstOpenHandoffPair; role: "runonce" | "inspect" | "management"; ownRunId: string; sourceSha256: string;
  inspectReusableCommit: string; runOnceReusableCommit: string; submitBefore: number; uploadOwn?: OwnUpload;
}) {
  const { pair: pairInput, role, ownRunId, sourceSha256, inspectReusableCommit, runOnceReusableCommit, submitBefore, uploadOwn } = options;
  const pair = structuredClone(pairInput), { now, json, readListed, archive } = firstOpenArtifactIo(options);
  const relockBefore = pair.phaseCutoffs[4];
  const id = /^[1-9][0-9]{0,19}$/, commit = /^[a-f0-9]{40}$/;
  if (!["runonce", "inspect", "management"].includes(role) || !pair.taskRelease ||
    ownRunId !== (role === "inspect" ? pair.inspectId : pair.runOnceId) ||
    ![pair.runOnceId, pair.inspectId, pair.workflowId].every(x => id.test(x)) || pair.runOnceId === pair.inspectId ||
    ![pair.pairSha256, pair.approvalSha256, pair.runtimeSourceSha256, sourceSha256].every(digest) ||
    ![pair.callerCommit, inspectReusableCommit, runOnceReusableCommit].every(x => commit.test(x)) ||
    ![pair.startAt, submitBefore, relockBefore, pair.writeBefore].every(whole) || submitBefore !== pair.phaseCutoffs[3] ||
    !(pair.startAt < submitBefore && submitBefore < relockBefore && relockBefore < pair.writeBefore)) return fail("AUTHORITY_SOURCE");
  const used = new Set<AuthorityKind>();
  let intended: string | undefined, granted: { scopeSha256: string; checkedAt: number } | undefined;
  async function exchange(kind: AuthorityKind, upstream: AbortSignal, payload?: Fields, expectedScope?: string) {
    const writer = kind === "request", owns = writer ? role === "runonce" : role === "inspect";
    const mayRead = writer ? role === "inspect" : role === "management";
    if (used.has(kind) || (payload ? !owns || !uploadOwn : !mayRead)) return fail("AUTHORITY_SEQUENCE");
    used.add(kind);
    const cutoff = kind === "relocked" ? relockBefore : submitBefore;
    const at = now();
    if (at < pair.startAt || at >= cutoff) return fail("AUTHORITY_WINDOW");
    const signal = AbortSignal.any([upstream, AbortSignal.timeout(cutoff - at)]);
    const suffix = authorityKinds[kind], name = offlineHandoffArtifactName(pair.pairSha256, suffix);
    const runUrl = `${api}/runs/${writer ? pair.runOnceId : pair.inspectId}`;
    const ref = writer ? runOnceReusableCommit : inspectReusableCommit;
    const path = writer ? contract.federatedTrust.runOnce.reusablePathCandidate : contract.federatedTrust.inspect.reusablePathCandidate;
    function authenticate(run: Fields) {
      assertFirstOpenProducer(pair, run, writer);
      const refs = run.referenced_workflows;
      if (!Array.isArray(refs) || refs.filter(x => {
        const r = object(x);
        return r.path === `veinyyxy/TechlongSoftware/${path}@${ref}` && r.sha === ref;
      }).length !== 1) return fail("AUTHORITY_REUSABLE");
    }
    const envelope = {
      schema: "techlong/fc41597f-authority-artifact/v1", kind: suffix, jobId: contract.jobId,
      pairSha256: pair.pairSha256, approvalSha256: pair.approvalSha256, runOnceId: pair.runOnceId,
      inspectId: pair.inspectId, sourceSha256, producerAttempt: 1, producerSourceSha256: pair.runtimeSourceSha256,
    };
    try {
      signal.throwIfAborted();
      authenticate(await json(runUrl, signal));
      let ownId: string | undefined;
      if (payload) {
        authorityBody(kind, payload);
        const bytes = new TextEncoder().encode(canonicalJson({ ...envelope, producedAt: at, payload }));
        if (bytes.length > maxJson) return fail("UPLOAD_LIMIT");
        ownId = (await uploadOwn!({ name, member: "handoff.json", bytes, signal })).artifactId;
        if (!id.test(ownId)) return fail("UPLOAD_ACK");
      }
      const listed = await readListed(`${runUrl}/artifacts?name=${name}&per_page=2`, name, cutoff, signal);
      const { artifactId, archiveDigest, created } = firstOpenNamedArtifactMetadata(pair, listed, suffix, writer, now());
      if (ownId !== undefined && ownId !== artifactId) return fail("UPLOAD_ACK");
      const zip = await archive(artifactId, signal);
      authenticate(await json(runUrl, signal));
      signal.throwIfAborted();
      const { body, bodySha256 } = decodeFirstOpenHandoffArchive(zip, archiveDigest);
      const { producedAt, payload: raw, ...fields } = body;
      const p = object(raw);
      authorityBody(kind, p);
      if (canonicalJson(fields) !== canonicalJson(envelope) || !whole(producedAt) || Number(producedAt) < pair.startAt ||
        Number(producedAt) > now() || Number(producedAt) >= cutoff || Number(producedAt) > created + 1_000 || now() >= cutoff ||
        (expectedScope !== undefined && p.scopeSha256 !== expectedScope) ||
        (payload !== undefined && canonicalJson(payload) !== canonicalJson(p))) return fail("AUTHORITY_BINDING");
      return { payload: p, bodySha256, producedAt: Number(producedAt) };
    } catch (e) {
      if (e instanceof Error && /^FIRST_OPEN_(HANDOFF|OFFLINE)_[A-Z_]+$/.test(e.message)) throw e;
      return fail("AUTHORITY_IO_STOP");
    }
  }
  async function scopeHash(scope: VersionAuthorityScope) {
    if (scope.sourceSha256 !== sourceSha256 || scope.runId !== pair.runOnceId || scope.approvalSha256 !== pair.approvalSha256 ||
      scope.submitBefore !== submitBefore) return fail("AUTHORITY_BINDING");
    return sha256Hex(scope);
  }
  return {
    sourceSha256, relockBefore,
    publishIntent: (p: FirstOpenAuthorityIntent, signal: AbortSignal) => exchange("request", signal, p),
    async readIntent(signal: AbortSignal) {
      const receipt = await exchange("request", signal);
      intended = receipt.payload.scopeSha256 as string;
      return receipt;
    },
    async publishVerified(p: Fields, signal: AbortSignal) {
      if (!intended || p.scopeSha256 !== intended || !whole(p.checkedAt) || Number(p.checkedAt) > now() || p.expiresAt !== submitBefore) {
        return fail("AUTHORITY_SEQUENCE");
      }
      const receipt = await exchange("observed", signal, p);
      granted = { scopeSha256: intended, checkedAt: Number(p.checkedAt) };
      return receipt;
    },
    async readVerified(scope: VersionAuthorityScope, signal: AbortSignal) {
      const scopeSha256 = await scopeHash(scope), receipt = await exchange("observed", signal, undefined, scopeSha256);
      const checkedAt = Number(receipt.payload.checkedAt);
      if (checkedAt < scope.putAcknowledgedAt || checkedAt > receipt.producedAt || receipt.payload.expiresAt !== submitBefore) return fail("AUTHORITY_BINDING");
      granted = { scopeSha256, checkedAt };
      return receipt.payload;
    },
    async publishRelocked(p: { checkedAt: number; policySha256: string; relocked: true; scopeSha256: string }, signal: AbortSignal) {
      if (!granted || p.scopeSha256 !== granted.scopeSha256 || !(p.checkedAt > granted.checkedAt && p.checkedAt <= now())) return fail("AUTHORITY_SEQUENCE");
      return exchange("relocked", signal, p);
    },
    async readRelocked(scope: VersionAuthorityScope, signal: AbortSignal) {
      const scopeSha256 = await scopeHash(scope);
      if (!granted || scopeSha256 !== granted.scopeSha256) return fail("AUTHORITY_SEQUENCE");
      const receipt = await exchange("relocked", signal, undefined, scopeSha256);
      const checkedAt = Number(receipt.payload.checkedAt);
      if (!(checkedAt > granted.checkedAt && checkedAt <= receipt.producedAt)) return fail("AUTHORITY_BINDING");
      return receipt;
    },
  };
}
