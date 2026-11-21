import { setTimeout as sleep } from "node:timers/promises";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { assertFirstOpenProducer, firstOpenArtifactMetadata, firstOpenHandoffSchema, offlineFirstOpenHandoffVerifier,
  offlineHandoffArtifactName, type FirstOpenHandoffPair } from "./first-open-oidc-offline.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

type Fields = Record<string, unknown>;
type OwnUpload = (input: { name: string; member: "handoff.json"; bytes: Uint8Array; signal: AbortSignal }) => Promise<{ artifactId: string }>;
const api = "https://api.github.com/repos/veinyyxy/TechlongSoftware/actions";
const maxZip = contract.artifactContract.maxZipBytes, maxJson = contract.artifactContract.maxJsonBytes;
const stageKeys = contract.handoffs.flatMap(h => [
  ...(h.intentSuffix ? [h.intentPayloadKeys!] : []), h.receiptPayloadKeys,
]);
const stages = contract.artifactContract.chain;
const fail = (code: string): never => { throw Error("FIRST_OPEN_HANDOFF_" + code); };
const object = (v: unknown): Fields => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Fields : fail("OBJECT");
const wait = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal });
const iso = (now: number) => new Date(now).toISOString();

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

/** Exact REST reads plus the caller's frozen, same-run immutable uploader.
 * No token discovery, credential forwarding, upload fallback, or dispatch. */
export function firstOpenGitHubHandoff(options: {
  pair: FirstOpenHandoffPair; role: "runonce" | "inspect"; ownRunId: string; token: string; uploadOwn: OwnUpload;
  now?: () => number; fetch?: typeof fetch; pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const pair = structuredClone(options.pair), now = options.now ?? Date.now, fetcher = options.fetch ?? fetch, pause = options.pause ?? wait;
  const accept = offlineFirstOpenHandoffVerifier(pair);
  const releaseId = firstOpenVersion(pair.taskRelease).releaseId;
  const writer = options.role === "runonce";
  if ((!writer && options.role !== "inspect") || options.ownRunId !== (writer ? pair.runOnceId : pair.inspectId) ||
    !options.token || !/^[A-Za-z0-9_]+$/.test(options.token)) return fail("SELF");
  let index = 0, previousBodySha256: string | null = null, busy = false, stopped = false;
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
  async function step(kind: string, upstream: AbortSignal, payload?: Fields) {
    if (busy || stopped || stages[index] !== kind || !stages[index]) return fail("SEQUENCE");
    busy = true;
    try {
      const at = now(), until = pair.phaseCutoffs[index], fromWriter = index % 2 === 1;
      if (at < pair.startAt || at >= until || (fromWriter === writer) !== (payload !== undefined)) return fail("PHASE_SCOPE");
      const signal = AbortSignal.any([upstream, AbortSignal.timeout(until - at)]);
      signal.throwIfAborted();
      const source = fromWriter ? pair.runOnceId : pair.inspectId, name = offlineHandoffArtifactName(pair.pairSha256, kind);
      let ownId: string | undefined;
      if (payload) {
        const keys = stageKeys[index];
        if (Object.keys(payload).length !== keys.length || !keys.every(key => Object.hasOwn(payload, key) &&
          (key.endsWith("Sha256") ? typeof payload[key] === "string" && /^[a-f0-9]{64}$/.test(payload[key] as string) :
            key.endsWith("Utc") ? typeof payload[key] === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(payload[key] as string) :
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
      const redirect = await request(`${api}/artifacts/${artifactId}/zip`, signal, true);
      if (redirect.status !== 302) return fail("DOWNLOAD_REDIRECT");
      const blob = new URL(redirect.headers.get("location") ?? "");
      if (blob.protocol !== "https:" || blob.username || blob.password || (blob.port && blob.port !== "443") ||
        ![".blob.core.windows.net", ".githubusercontent.com"].some(host => blob.hostname.endsWith(host))) return fail("DOWNLOAD_HOST");
      const archive = await request(blob.toString(), signal, false);
      if (archive.status !== 200) return fail("DOWNLOAD_STATUS");
      const zip = await boundedBytes(archive, maxZip), run = await json(runUrl, signal);
      signal.throwIfAborted();
      const observed = accept({ run, listed, zip, now: now() });
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
