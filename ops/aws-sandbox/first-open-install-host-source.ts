import { CloudFormationClient, CreateChangeSetCommand, DescribeChangeSetCommand, DescribeStacksCommand,
  ExecuteChangeSetCommand, GetTemplateCommand, ListChangeSetsCommand } from "@aws-sdk/client-cloudformation";
import { GetBucketPolicyCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { parseKnownFiles } from "@smithy/core/config";
import type { HttpHandler, HttpHandlerUserInput } from "@smithy/core/protocols";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { AwsCredentialIdentity, MiddlewareStack } from "@smithy/types";
import { setTimeout as delay } from "node:timers/promises";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenInstallBucketStack } from "./first-open-install-bucket-executor.ts";
import type { runFirstOpenInstallSequence } from "./first-open-install-sequence.ts";

const account = "402010193138", region = "ca-central-1", profile = "techlong-sandbox-user";
const arn = `arn:aws:iam::${account}:user/techlong-sandbox-dev`, userId = "AIDAV3GNMXTZEO7SHLC2X";
const { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const cfnArn = `arn:aws:cloudformation:${region}:${account}:`;
const identities = cfnArn + "stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f";
const shared = cfnArn + "stack/techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917";
const names = new Map([
  [identities, /^fc41597f-install-readback-[a-f0-9]{24}-(?:grant|relock)$/],
  [shared, /^fc41597f-install-(?:shared-[a-f0-9]{24}-prepare|provisioner-[a-f0-9]{24}-(?:grant|relock))$/],
  [firstOpenInstallBucketStack, /^fc41597f-install-bucket-[a-f0-9]{24}-(?:protect|restore)$/],
]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const stageKey = new RegExp(`^first-open-management/${jobId}/[a-f0-9]{64}/install-owner/install/` +
  "(?:shared-predecessor|provisioner-grant|provisioner-relock)/[a-f0-9]{64}\\.json$");
const override = /^(?:AWS_(?:ENDPOINT_URL(?:_|$)|CONTAINER_CREDENTIALS_|CONFIG_FILE$|SHARED_CREDENTIALS_FILE$|LOGIN_CACHE_DIRECTORY$|CA_BUNDLE$|ACCESS_KEY_ID$|SECRET_ACCESS_KEY$|SESSION_TOKEN$|SECURITY_TOKEN$|PROFILE$|DEFAULT_PROFILE$|ROLE_ARN$|WEB_IDENTITY_TOKEN_FILE$)|NODE_EXTRA_CA_CERTS$|NODE_USE_ENV_PROXY$|SSL_CERT_(?:FILE|DIR)$|(?:HTTPS?|ALL)_PROXY$)/i;
const fail = (code: string): never => { throw Error("FIRST_OPEN_HOST_SOURCE_" + code); };
function need(ok: unknown, code: string): asserts ok { if (!ok) fail(code); }
const https = (service: string) => `${service}.${region}.amazonaws.com`;
const sdkDefaults = { region, maxAttempts: 1, ignoreConfiguredEndpointUrls: true, useFipsEndpoint: false, useDualstackEndpoint: false } as const;
type Env = Readonly<Record<string, string | undefined>>;
const envSafe = (env: Env) => env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" &&
  !Object.entries(env).some(([name, value]) => Boolean(value) && override.test(name));

async function loadLoginCache(): Promise<AwsCredentialIdentity> {
  // The login SDK may try OAuth when its cache ages. Never make that network
  // call or update the login cache from this approved installation transport.
  return fromLoginCredentials({ profile, clientConfig: { ...sdkDefaults,
    requestHandler: { async handle() { return fail("LOGIN_REFRESH_BLOCKED"); }, destroy() {} } },
  })();
}

type Sequence = Parameters<typeof runFirstOpenInstallSequence>[0];
type OfflineTestOnly = { loadCache: () => Promise<AwsCredentialIdentity>; requestHandler: HttpHandlerUserInput;
  env: Env; now: () => number };
type SnapshotInput = { factsExpireAt: number; signal: AbortSignal; loadCache?: () => Promise<AwsCredentialIdentity>;
  requestHandler?: HttpHandlerUserInput; env?: Env; now?: () => number };
function validateCache(cached: AwsCredentialIdentity | undefined) {
  const expiry = cached?.expiration instanceof Date ? cached.expiration.getTime() : NaN;
  need(cached?.accountId === account && /^ASIA[A-Z0-9]{16,124}$/.test(cached.accessKeyId ?? "") &&
    /^[A-Za-z0-9/+=]{32,256}$/.test(cached.secretAccessKey ?? "") && /^[!-~]{8,32768}$/.test(cached.sessionToken ?? "") &&
    Number.isSafeInteger(expiry), "FIXED_LOGIN_INVALID");
  return expiry;
}

/** Exact no-fallback Source for the install sequence only. The outer host
 * invokes this after its approval checks, then verifies Source via identify
 * before publication. The sequence uses that same one-shot STS result. */
export function bindFirstOpenInstallHostSource({ factsExpireAt, signal, offlineTestOnly }: {
  factsExpireAt: number; signal: AbortSignal; offlineTestOnly?: OfflineTestOnly;
}) {
  return bindSourceSnapshot({ factsExpireAt, signal, ...offlineTestOnly });
}

async function bindSourceSnapshot({ factsExpireAt, signal, loadCache = loadLoginCache, requestHandler, env = process.env, now = Date.now }:
SnapshotInput): Promise<{ source: Sequence["source"]; terminalSourceCredentials: AwsCredentialIdentity; close(): void }> {
  const bound = now();
  need(envSafe(env) && !signal.aborted && Number.isSafeInteger(bound) && bound > 0 &&
    Number.isSafeInteger(factsExpireAt) && factsExpireAt > bound, "WINDOW_OR_AMBIENT_OVERRIDE");
  let cached: AwsCredentialIdentity;
  try { cached = await loadCache(); }
  catch { return fail("CACHED_LOGIN_UNAVAILABLE"); }
  const expiry = validateCache(cached);
  need(expiry > factsExpireAt, "FIXED_LOGIN_DOES_NOT_COVER_CUTOFF");
  const credentials: AwsCredentialIdentity = Object.freeze({ accountId: account, accessKeyId: cached.accessKeyId,
    secretAccessKey: cached.secretAccessKey, sessionToken: cached.sessionToken, get expiration() { return new Date(expiry); } });
  // The SDK annotates a supplied credential object in place. A provider
  // returning only this snapshot avoids mutation and cannot reload or refresh.
  const config = { ...sdkDefaults, credentials: async () => credentials, ...(requestHandler && { requestHandler }) };
  const sts = new STSClient({ ...config, endpoint: `https://${https("sts")}` });
  const cfn = new CloudFormationClient({ ...config, endpoint: `https://${https("cloudformation")}` });
  const s3 = new S3Client({ ...config, endpoint: `https://${https("s3")}`, forcePathStyle: true, followRegionRedirects: false });
  const guard = <Input extends object, Output extends object>(stack: MiddlewareStack<Input, Output>, host: string) => {
    stack.add(next => async args => {
      const r = args.request as { protocol?: unknown; hostname?: unknown; port?: unknown } | undefined;
      need(r?.protocol === "https:" && r.hostname === host && (r.port === undefined || r.port === 443), "OFFICIAL_ENDPOINT");
      return next(args);
    }, { step: "finalizeRequest", name: "firstOpenInstallHostFixedEndpoint" });
  };
  guard(sts.middlewareStack, https("sts"));
  guard(cfn.middlewareStack, https("cloudformation"));
  guard(s3.middlewareStack, https("s3"));
  let closed = false, verified = false, identity: ReturnType<Sequence["source"]["identify"]> | undefined;
  const close = () => { if (!closed) { closed = true; sts.destroy(); cfn.destroy(); s3.destroy(); } };
  const options = (upstream: AbortSignal, identityOnly = false) => {
    const at = now();
    need(!closed && !signal.aborted && !upstream.aborted && envSafe(env) && Number.isSafeInteger(at) && at >= bound &&
      at < factsExpireAt && at < expiry, "WINDOW_OR_AMBIENT_OVERRIDE");
    need(identityOnly || verified, "SOURCE_NOT_VERIFIED");
    return { abortSignal: AbortSignal.any([signal, upstream, AbortSignal.timeout(Math.min(25_000, factsExpireAt - at))]) };
  };
  const send = async <T>(call: () => Promise<T>): Promise<T> => {
    try { return await call(); }
    catch { return fail("PROVIDER_REQUEST_STOP_NO_RETRY"); }
  };
  const stack = (id: string | undefined) => { need(id && names.has(id), "STACK_SCOPE"); return id; };
  const change = (stackId: string | undefined, id: string | undefined, create = false) => {
    const pattern = names.get(stack(stackId))!, prefix = cfnArn + "changeSet/";
    if (create) need(typeof id === "string" && pattern.test(id), "CHANGE_SCOPE");
    else {
      need(typeof id === "string" && id.startsWith(prefix), "CHANGE_SCOPE");
      const parts = id.slice(prefix.length).split("/");
      need(parts.length === 2 && pattern.test(parts[0]) && uuid.test(parts[1]), "CHANGE_SCOPE");
    }
    return id;
  };
  const owner: Sequence["source"]["owner"] = {
    describeStack: async (id, sig) => send(() => cfn.send(new DescribeStacksCommand({ StackName: stack(id) }), options(sig))),
    getOriginal: async (id, sig) => send(() => cfn.send(new GetTemplateCommand({ StackName: stack(id), TemplateStage: "Original" }), options(sig))),
    getChangeSetOriginal: async (id, cs, sig) => send(() => cfn.send(new GetTemplateCommand({ StackName: stack(id),
      ChangeSetName: change(id, cs), TemplateStage: "Original" }), options(sig))),
    create: async (request, sig) => {
      change(request.StackName, request.ChangeSetName, true);
      need(request.ChangeSetType === "UPDATE" && request.RoleARN === undefined && request.IncludeNestedStacks === false &&
        request.ImportExistingResources === false && request.ResourcesToImport === undefined, "CREATE_SCOPE");
      return send(() => cfn.send(new CreateChangeSetCommand(request), options(sig)));
    },
    describeChange: async (id, cs, sig) => send(() => cfn.send(new DescribeChangeSetCommand({ StackName: stack(id),
      ChangeSetName: change(id, cs) }), options(sig))),
    execute: async (request, sig) => {
      change(request.StackName, request.ChangeSetName);
      need(request.DisableRollback === false, "EXECUTE_SCOPE");
      return send(() => cfn.send(new ExecuteChangeSetCommand(request), options(sig)));
    },
  };
  const source: Sequence["source"] = {
    async identify(sig) {
      const opts = options(sig, true);
      identity ??= (async () => {
        const who = await send(() => sts.send(new GetCallerIdentityCommand({}), opts));
        options(sig, true);
        need(who.Account === account && who.Arn === arn && who.UserId === userId && who.$metadata.httpStatusCode === 200 &&
          who.$metadata.attempts === 1, "SOURCE_IDENTITY_MISMATCH");
        verified = true;
        return { Account: account, Arn: arn, UserId: userId, $metadata: { httpStatusCode: 200, attempts: 1 } };
      })();
      const who = await identity;
      options(sig, true);
      return structuredClone(who);
    },
    owner,
    bucket: { ...owner, async listChangeSets(id, sig) {
      need(id === firstOpenInstallBucketStack, "STACK_SCOPE");
      return send(() => cfn.send(new ListChangeSetsCommand({ StackName: id }), options(sig)));
    } },
    staging: { async put(request, sig) {
      need(request.Bucket === bucket && request.ExpectedBucketOwner === account && typeof request.Key === "string" && stageKey.test(request.Key) &&
        request.IfNoneMatch === "*" && request.ContentType === "application/json" && request.ServerSideEncryption === "AES256", "STAGING_SCOPE");
      return send(() => s3.send(new PutObjectCommand(request), options(sig)));
    } },
    async getBucketPolicy(request, sig) {
      need(request.Bucket === bucket && request.ExpectedBucketOwner === account, "BUCKET_SCOPE");
      return send(() => s3.send(new GetBucketPolicyCommand(request), options(sig)));
    },
  };
  try { options(signal, true); return { source, terminalSourceCredentials: credentials, close }; }
  catch (error) { close(); throw error; }
}

export const FIRST_OPEN_HOST_SOURCE_PHASES = ["launch", "bucket-protect", "source-bucket-read", "inspector-grant", "staging",
  "shared-predecessor", "provisioner-grant", "provisioner-relock", "inspector-relock", "terminal-inspector", "bucket-restore",
  "terminal-bucket"] as const;
export type FirstOpenHostSourcePhase = (typeof FIRST_OPEN_HOST_SOURCE_PHASES)[number];
const signinHost = `${region}.oauth.signin.aws`, sdkRefreshThresholdMs = 300_000, renewalAndStsReserveMs = 115_000;
type ResolveCache = (options: { allowRefresh: boolean; signal: AbortSignal; before: number; onRefreshRequest(): void }) =>
Promise<{ credentials?: AwsCredentialIdentity; refreshDue?: true }>;

/** Use the locked @aws-sdk/credential-provider-login implementation. Only
 * it handles token and DPoP material; on an acknowledged refresh it replaces
 * the existing named profile's AWS login cache via the SDK's usual behavior. */
const resolvePhaseCache: ResolveCache = async ({ allowRefresh, signal, before, onRefreshRequest }) => {
  const config = (await parseKnownFiles({ profile, ignoreCache: true }))[profile];
  need(config?.login_session === arn && config.region === region && envSafe(process.env) && !signal.aborted,
    "SOURCE_PROFILE_IDENTITY_OR_REGION");
  const transport = allowRefresh ? new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 20_000, throwOnRequestTimeout: true }) : undefined;
  let refreshDue = false, sent = false, requestFailed = false;
  const refreshState = (): { refreshDue?: true } => refreshDue ? { refreshDue: true } : {};
  const guarded: HttpHandler = {
    updateHttpClientConfig() {}, httpHandlerConfigs: () => ({}),
    async handle(request, options) {
      refreshDue = true;
      if (!allowRefresh) return fail("CACHE_PROBE_ONLY");
      try {
        need(transport && !sent && !signal.aborted && envSafe(process.env) && Date.now() < before &&
          request.protocol === "https:" && request.hostname === signinHost && (request.port === undefined || request.port === 443) &&
          request.method === "POST" && request.path === "/v1/token" && Object.keys(request.query ?? {}).length === 0, "OFFICIAL_SIGNIN_SCOPE");
        onRefreshRequest(); sent = true;
        const response = await transport.handle(request, { ...options,
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(25_000, before - Date.now())))]) });
        need(response.response.statusCode === 200, "SIGNIN_RENEWAL_STOP_NO_RETRY");
        return response;
      } catch { requestFailed = true; return fail("SIGNIN_RENEWAL_STOP_NO_RETRY"); }
    },
  };
  try {
    const credentials = await fromLoginCredentials({ profile, clientConfig: { ...sdkDefaults,
      endpoint: `https://${signinHost}`, requestHandler: guarded } })();
    // Login SDK can return the old unexpired token after a failed refresh.
    // Do not treat that fallback as a successful renewal for this phase.
    need(!requestFailed, "SIGNIN_RENEWAL_STOP_NO_RETRY");
    return { credentials, ...refreshState() };
  } catch {
    if (!allowRefresh && refreshDue) return { refreshDue: true };
    return fail(allowRefresh ? "SIGNIN_RENEWAL_STOP_NO_RETRY" : "CACHED_LOGIN_UNAVAILABLE");
  } finally { transport?.destroy(); }
};

type PhaseTest = { resolveCache: ResolveCache; requestHandler: HttpHandlerUserInput; env: Env; now: () => number;
  wait: (ms: number, signal: AbortSignal) => Promise<void> };
type PhaseSourceInput = { factsExpireAt: number; signal: AbortSignal; offlineTestOnly?: PhaseTest };
type BoundSource = Awaited<ReturnType<typeof bindSourceSnapshot>>;
const sameSnapshot = (a: AwsCredentialIdentity, b: AwsCredentialIdentity) => a.accountId === b.accountId &&
  a.accessKeyId === b.accessKeyId && a.secretAccessKey === b.secretAccessKey && a.sessionToken === b.sessionToken &&
  a.expiration?.getTime() === b.expiration?.getTime();

/** Credentials rotate only inside openPhase, never from a service request.
 * A failed or out-of-order boundary stops the lane without replay. */
export async function bindFirstOpenInstallHostPhaseSource({ factsExpireAt, signal, offlineTestOnly }: PhaseSourceInput):
Promise<{ source: Sequence["source"]; openPhase(phase: FirstOpenHostSourcePhase, before: number, signal: AbortSignal): Promise<AwsCredentialIdentity>;
  close(): void }> {
  const now = offlineTestOnly?.now ?? Date.now, env = offlineTestOnly?.env ?? process.env;
  const resolve = offlineTestOnly?.resolveCache ?? resolvePhaseCache;
  const wait = offlineTestOnly?.wait ?? (async (ms: number, sig: AbortSignal) => { await delay(ms, undefined, { signal: sig }); });
  const boundAt = now();
  need(envSafe(env) && !signal.aborted && Number.isSafeInteger(boundAt) && boundAt > 0 &&
    Number.isSafeInteger(factsExpireAt) && boundAt < factsExpireAt, "WINDOW_OR_AMBIENT_OVERRIDE");
  let current: BoundSource | undefined, phaseBefore = 0, phaseIndex = 0, providerRefreshes = 0, inFlight = 0;
  let opening = false, stopped = false;
  const lifetime = new AbortController();
  const close = () => { stopped = true; lifetime.abort(); current?.close(); current = undefined; };
  const clock = (sig: AbortSignal, before: number) => {
    const at = now();
    need(!stopped && !signal.aborted && !sig.aborted && envSafe(env) && Number.isSafeInteger(at) && at >= boundAt &&
      at < before && before <= factsExpireAt, "WINDOW_OR_AMBIENT_OVERRIDE");
    return at;
  };
  const deadline = (sig: AbortSignal, before: number) => AbortSignal.any([signal, sig, lifetime.signal,
    AbortSignal.timeout(Math.min(2_147_483_647, before - clock(sig, before)))]);
  type Route = "source-identity" | "source-bucket-read" | "staging" | "bucket" | "owner";
  const scopes = {
    "inspector-grant": identities, "shared-predecessor": shared, "provisioner-grant": shared, "provisioner-relock": shared, "inspector-relock": identities,
  } as Partial<Record<FirstOpenHostSourcePhase, string>>;
  const execute = async <T>(route: Route, id: string | undefined, sig: AbortSignal,
    f: (p: Sequence["source"], bounded: AbortSignal) => Promise<T>) => {
    need(current && !opening, "PHASE_NOT_OPEN");
    const phase = FIRST_OPEN_HOST_SOURCE_PHASES[phaseIndex - 1];
    need(route === "source-identity" || (route === "owner" && id && scopes[phase] === id) ||
      (route === "bucket" && id === firstOpenInstallBucketStack && (phase === "bucket-protect" || phase === "bucket-restore")) ||
      ((route === "source-bucket-read" || route === "staging") && phase === route), "OPERATION_OUTSIDE_SOURCE_PHASE");
    const phaseSignal = deadline(sig, phaseBefore);
    inFlight++;
    try { return await f(current.source, phaseSignal); }
    finally { inFlight--; }
  };
  const stackPorts = (route: "owner" | "bucket"): Sequence["source"]["owner"] => ({
    describeStack: (id, sig) => execute(route, id, sig, (s, b) => s[route].describeStack(id, b)),
    getOriginal: (id, sig) => execute(route, id, sig, (s, b) => s[route].getOriginal(id, b)),
    getChangeSetOriginal: (id, cs, sig) => execute(route, id, sig, (s, b) => s[route].getChangeSetOriginal!(id, cs, b)),
    create: (request, sig) => execute(route, request.StackName, sig, (s, b) => s[route].create(request, b)),
    describeChange: (id, cs, sig) => execute(route, id, sig, (s, b) => s[route].describeChange(id, cs, b)),
    execute: (request, sig) => execute(route, request.StackName, sig, (s, b) => s[route].execute(request, b)),
  });
  return { source: {
    identify: sig => execute("source-identity", undefined, sig, (s, b) => s.identify(b)), owner: stackPorts("owner"),
    bucket: { ...stackPorts("bucket"), listChangeSets: (id, sig) => execute("bucket", id, sig, (s, b) => s.bucket.listChangeSets(id, b)) },
    staging: { put: (request, sig) => execute("staging", undefined, sig, (s, b) => s.staging.put(request, b)) },
    getBucketPolicy: (request, sig) => execute("source-bucket-read", undefined, sig, (s, b) => s.getBucketPolicy(request, b)),
  },
  async openPhase(phase, before, sig) {
    let candidate: BoundSource | undefined;
    try {
      need(Number.isSafeInteger(before) && phase === FIRST_OPEN_HOST_SOURCE_PHASES[phaseIndex] && !opening && inFlight === 0 &&
        before > phaseBefore, "PHASE_ORDER_OR_BUSY");
      const phaseSignal = deadline(sig, before);
      opening = true;
      const prior = current?.terminalSourceCredentials;
      if (prior && validateCache(prior) > before) {
        phaseIndex++; phaseBefore = before;
        return prior;
      }
      const probe = await resolve({ allowRefresh: false, signal: phaseSignal, before, onRefreshRequest() { return fail("UNAUTHORIZED_SIGNIN"); } });
      clock(phaseSignal, before);
      let cached = probe.credentials;
      if (!cached || validateCache(cached) <= before) {
        need(cached || probe.refreshDue, "CACHED_LOGIN_UNAVAILABLE");
        const at = clock(phaseSignal, before);
        const waitMs = cached ? Math.max(0, validateCache(cached) - sdkRefreshThresholdMs - at) : 0;
        need(at + waitMs + renewalAndStsReserveMs < before, "INSUFFICIENT_PHASE_TIME_FOR_RENEWAL");
        if (waitMs > 0) await wait(waitMs, phaseSignal);
        clock(phaseSignal, before);
        let sent = false;
        const renewed = await resolve({ allowRefresh: true, signal: phaseSignal, before, onRefreshRequest() {
          clock(phaseSignal, before);
          need(!sent && ++providerRefreshes <= FIRST_OPEN_HOST_SOURCE_PHASES.length, "SIGNIN_RENEWAL_BUDGET");
          sent = true;
        } });
        cached = renewed.credentials;
      }
      clock(phaseSignal, before);
      need(cached && validateCache(cached) > before, "FIXED_LOGIN_DOES_NOT_COVER_PHASE");
      if (prior && sameSnapshot(prior, cached)) { phaseIndex++; phaseBefore = before; return prior; }
      const expiry = validateCache(cached);
      const snapshot = cached;
      candidate = await bindSourceSnapshot({ factsExpireAt: Math.min(factsExpireAt, expiry - 1),
        signal: AbortSignal.any([signal, lifetime.signal]), loadCache: async () => snapshot, now, env,
        ...(offlineTestOnly && { requestHandler: offlineTestOnly.requestHandler }) });
      await candidate.source.identify(phaseSignal);
      clock(phaseSignal, before);
      current?.close(); current = candidate; candidate = undefined;
      phaseIndex++; phaseBefore = before;
      return current.terminalSourceCredentials;
    } catch (error) {
      candidate?.close(); close();
      const code = (error as Error)?.message;
      if (typeof code === "string" && /^FIRST_OPEN_HOST_SOURCE_[A-Z_]+$/.test(code)) throw error;
      return fail("PHASE_STOP_NO_RETRY");
    } finally { opening = false; }
  }, close };
}
