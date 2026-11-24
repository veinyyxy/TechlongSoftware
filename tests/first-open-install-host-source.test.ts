import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { HttpResponse, type HttpHandler } from "@smithy/core/protocols";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenInstallBucketStack } from "../ops/aws-sandbox/first-open-install-bucket-executor.ts";
import { bindFirstOpenInstallHostPhaseSource, bindFirstOpenInstallHostSource,
  FIRST_OPEN_HOST_SOURCE_PHASES } from "../ops/aws-sandbox/first-open-install-host-source.ts";

const account = "402010193138", region = "ca-central-1";
const userId = "AIDAV3GNMXTZEO7SHLC2X", arn = `arn:aws:iam::${account}:user/techlong-sandbox-dev`;
const { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const anchor = Date.parse("2026-11-24T15:30:00Z"), factsExpireAt = anchor + 90_000;
const sig = () => new AbortController().signal;
type Options = Parameters<typeof bindFirstOpenInstallHostSource>[0];

function fixture({ env = {}, expiry = factsExpireAt + 60_000, mode = "success", tokens = ["FAKE-TEMPORARY-TOKEN"] }:
{ env?: Record<string, string | undefined>; expiry?: number; mode?: "success" | "identity" | "failure"; tokens?: string[] } = {}) {
  const credentials = { accessKeyId: "ASIA0000000000000000", secretAccessKey: "Z".repeat(40), sessionToken: "FAKE-TEMPORARY-TOKEN",
    accountId: account, expiration: new Date(expiry) };
  let reads = 0, at = anchor;
  const seen: [string, string][] = [];
  const requestHandler: HttpHandler = {
    httpHandlerConfigs: () => ({}), updateHttpClientConfig() {},
    async handle(request, options) {
      seen.push([request.hostname, request.method]);
      assert.equal(request.protocol, "https:");
      assert.ok(tokens.includes(request.headers["x-amz-security-token"]));
      assert.match(request.headers.authorization, /Credential=ASIA0000000000000000\//);
      assert.equal(options?.abortSignal?.aborted, false);
      const [service] = request.hostname.split(".");
      let body = "";
      switch (service) {
        case "sts": body = `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">` +
          `<GetCallerIdentityResult><Account>${account}</Account><Arn>${arn}</Arn><UserId>${mode === "identity" ? "wrong" : userId}</UserId>` +
          "</GetCallerIdentityResult></GetCallerIdentityResponse>"; break;
        case "cloudformation": body = "<DescribeStacksResponse><DescribeStacksResult><Stacks>" +
          `<member><StackId>${firstOpenInstallBucketStack}</StackId><StackStatus>UPDATE_COMPLETE</StackStatus>` +
          "</member></Stacks></DescribeStacksResult></DescribeStacksResponse>"; break;
        case "s3": body = '{"Statement":[]}'; break;
        default: assert.fail("unexpected endpoint");
      }
      return { response: new HttpResponse({ statusCode: mode === "failure" ? 500 : 200,
        headers: { "content-type": service === "s3" ? "application/json" : "text/xml", "x-amz-version-id": "test-version" },
        body: Readable.from([Buffer.from(body)]) }) };
    },
  };
  const options: Options = { factsExpireAt, signal: sig(), offlineTestOnly: {
    env, now: () => at, requestHandler, loadCache: async () => { reads++; return credentials; },
  } };
  return { credentials, options, seen, get reads() { return reads; }, time: (t: number) => { at = t; } };
}

test("host and sequence verify one fixed Source; CFN and S3 use the same temporary snapshot", async () => {
  const f = fixture(), a = await bindFirstOpenInstallHostSource(f.options);
  try {
    assert.ok(Object.isFrozen(a.terminalSourceCredentials));
    a.terminalSourceCredentials.expiration?.setTime(1);
    assert.equal(a.terminalSourceCredentials.expiration?.getTime(), factsExpireAt + 60_000);
    f.credentials.sessionToken = "MUTATED_AFTER_READING";
    await assert.rejects(a.source.owner.describeStack(firstOpenInstallBucketStack, sig()), /STOP_NO_RETRY/);
    assert.equal(f.seen.length, 0);
    assert.equal((await a.source.identify(sig())).Arn, arn);
    assert.equal((await a.source.identify(sig())).UserId, userId);
    assert.equal((await a.source.bucket.describeStack(firstOpenInstallBucketStack, sig())).Stacks?.[0]?.StackId, firstOpenInstallBucketStack);
    assert.equal((await a.source.getBucketPolicy({ Bucket: bucket, ExpectedBucketOwner: account }, sig())).Policy, '{"Statement":[]}');
    const key = `first-open-management/${jobId}/${"a".repeat(64)}/install-owner/install/shared-predecessor/${"b".repeat(64)}.json`;
    const put = await a.source.staging.put({ Bucket: bucket, Key: key, ExpectedBucketOwner: account, ContentType: "application/json",
      ServerSideEncryption: "AES256", IfNoneMatch: "*", Body: "{}" }, sig());
    assert.equal(put.VersionId, "test-version");
    assert.equal(f.reads, 1);
    assert.deepEqual(f.seen, [[`sts.${region}.amazonaws.com`, "POST"], [`cloudformation.${region}.amazonaws.com`, "POST"],
      [`s3.${region}.amazonaws.com`, "GET"], [`s3.${region}.amazonaws.com`, "PUT"]]);
  } finally { a.close(); }
  await assert.rejects(a.source.identify(sig()), /WINDOW_OR_AMBIENT_OVERRIDE/);
});

test("ambient profile, endpoint, login cache, proxy, and disabled TLS reject before any profile read", async () => {
  for (const env of [{ AWS_PROFILE: "other" }, { AWS_ENDPOINT_URL_STS: "https://example.invalid" },
    { AWS_LOGIN_CACHE_DIRECTORY: "alternative-cache" }, { https_proxy: "https://example.invalid" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }]) {
    const f = fixture({ env });
    await assert.rejects(bindFirstOpenInstallHostSource(f.options), /AMBIENT_OVERRIDE/);
    assert.equal(f.reads, 0);
    assert.equal(f.seen.length, 0);
  }
  const f = fixture({ expiry: factsExpireAt });
  await assert.rejects(bindFirstOpenInstallHostSource(f.options), /DOES_NOT_COVER_CUTOFF/);
  assert.equal(f.reads, 1);
  assert.equal(f.seen.length, 0);
});

test("wrong or unknown STS responses are not retried or allowed to reach other services", async () => {
  for (const mode of ["identity", "failure"] as const) {
    const f = fixture({ mode }), a = await bindFirstOpenInstallHostSource(f.options);
    try {
      const reason = mode === "identity" ? /SOURCE_IDENTITY_MISMATCH/ : /STOP_NO_RETRY/;
      await assert.rejects(a.source.identify(sig()), reason);
      await assert.rejects(a.source.identify(sig()), reason);
      await assert.rejects(a.source.owner.getOriginal(firstOpenInstallBucketStack, sig()), /STOP_NO_RETRY/);
      assert.deepEqual(f.seen, [[`sts.${region}.amazonaws.com`, "POST"]]);
    } finally { a.close(); }
  }
});

test("another stack, change name, key or elapsed cutoff makes no additional request", async () => {
  const f = fixture(), a = await bindFirstOpenInstallHostSource(f.options);
  try {
    await a.source.identify(sig());
    await assert.rejects(a.source.owner.describeStack("other", sig()), /STOP_NO_RETRY/);
    await assert.rejects(a.source.owner.create({ StackName: firstOpenInstallBucketStack, ChangeSetName: "foreign" }, sig()), /CHANGE_SCOPE/);
    await assert.rejects(a.source.staging.put({ Bucket: bucket, Key: "foreign" }, sig()), /STAGING_SCOPE/);
    await assert.rejects(a.source.getBucketPolicy({ Bucket: "other", ExpectedBucketOwner: account }, sig()), /BUCKET_SCOPE/);
    f.time(factsExpireAt);
    await assert.rejects(a.source.identify(sig()), /WINDOW_OR_AMBIENT_OVERRIDE/);
    await assert.rejects(a.source.owner.getOriginal(firstOpenInstallBucketStack, sig()), /STOP_NO_RETRY/);
    assert.deepEqual(f.seen, [[`sts.${region}.amazonaws.com`, "POST"]]);
  } finally { a.close(); }
});

type CacheFixture = NonNullable<Parameters<typeof bindFirstOpenInstallHostPhaseSource>[0]["offlineTestOnly"]>;
const replacement = "DIFFERENT-SYNTHETIC-SESSION";
function phaseFixture({ expiry = anchor + 720_000, refreshExpiry = anchor + 1_440_000, cacheAfter = "renewed" as "renewed" | "read" | "fail" | "double" } = {}) {
  const f = fixture({ expiry, tokens: ["FAKE-TEMPORARY-TOKEN", replacement] }), { env, now, requestHandler } = f.options.offlineTestOnly!;
  const cacheCalls: boolean[] = [], waits: number[] = [];
  let refreshes = 0;
  const resolveCache: CacheFixture["resolveCache"] = async ({ allowRefresh, onRefreshRequest, signal }) => {
    assert.equal(signal.aborted, false);
    cacheCalls.push(allowRefresh);
    const next = { ...f.credentials, sessionToken: replacement, expiration: new Date(refreshExpiry) };
    if (!allowRefresh) return { credentials: cacheAfter === "read" && cacheCalls.length > 1 ? next : f.credentials };
    onRefreshRequest(); refreshes++;
    if (cacheAfter === "double") onRefreshRequest();
    if (cacheAfter === "fail") throw new Error("not safe to disclose");
    return { credentials: next };
  };
  const options = { factsExpireAt: anchor + 1_200_000, signal: sig(), offlineTestOnly: {
    env, now, requestHandler, resolveCache, async wait(ms, signal) {
      assert.equal(signal.aborted, false); waits.push(ms); f.time(now() + ms);
    },
  } } satisfies Parameters<typeof bindFirstOpenInstallHostPhaseSource>[0];
  return { f, options, cacheCalls, waits, get refreshes() { return refreshes; } };
}

test("all twelve phases are ordered; verified protection, staging and terminal phases reuse sufficient Source without touching cache", async () => {
  const p = phaseFixture({ expiry: anchor + 1_300_000 }), { source, openPhase, close } = await bindFirstOpenInstallHostPhaseSource(p.options);
  try {
    assert.deepEqual(p.cacheCalls, []);
    const first = await openPhase("launch", anchor + 80_000, sig());
    assert.equal((await source.identify(sig())).Arn, arn);
    await assert.rejects(source.bucket.describeStack(firstOpenInstallBucketStack, sig()), /OPERATION_OUTSIDE_SOURCE_PHASE/);
    for (const [i, phase] of FIRST_OPEN_HOST_SOURCE_PHASES.entries()) {
      if (i === 0) continue;
      assert.equal(await openPhase(phase, anchor + 80_000 * (i + 1), sig()), first);
      if (phase === "bucket-protect") await source.bucket.describeStack(firstOpenInstallBucketStack, sig());
      if (phase === "source-bucket-read") await source.getBucketPolicy({ Bucket: bucket, ExpectedBucketOwner: account }, sig());
    }
    assert.deepEqual(p.f.seen, [[`sts.${region}.amazonaws.com`, "POST"], [`cloudformation.${region}.amazonaws.com`, "POST"], [`s3.${region}.amazonaws.com`, "GET"]]);
    assert.deepEqual(p.cacheCalls, [false]);
    assert.equal(p.refreshes, 0);
    await assert.rejects(openPhase("terminal-bucket", anchor + 1_010_000, sig()), /PHASE_ORDER_OR_BUSY/);
  } finally { close(); }
});

test("waits only to the SDK five-minute threshold when phase needs renewal, then verifies changed snapshot once", async () => {
  const p = phaseFixture({ expiry: anchor + 400_000 }), a = await bindFirstOpenInstallHostPhaseSource(p.options);
  try {
    const old = await a.openPhase("launch", anchor + 80_000, sig());
    p.f.time(anchor + 80_000);
    const renewed = await a.openPhase("bucket-protect", anchor + 420_000, sig());
    assert.equal(old.expiration?.getTime(), anchor + 400_000);
    assert.equal(renewed.sessionToken, replacement);
    assert.equal(await a.openPhase("source-bucket-read", anchor + 540_000, sig()), renewed);
    assert.deepEqual(p.waits, [20_000]);
    assert.deepEqual(p.cacheCalls, [false, false, true]);
    assert.equal(p.refreshes, 1);
    assert.equal((await a.source.identify(sig())).Arn, arn);
    assert.deepEqual(p.f.seen, Array.from({ length: 2 }, () => [`sts.${region}.amazonaws.com`, "POST"]));
  } finally { a.close(); }
});

test("a newer sufficient cached snapshot needs one STS, not a Signin refresh", async () => {
  const p = phaseFixture({ expiry: anchor + 90_000, cacheAfter: "read" }), a = await bindFirstOpenInstallHostPhaseSource(p.options);
  try {
    await a.openPhase("launch", anchor + 80_000, sig());
    assert.equal((await a.openPhase("bucket-protect", anchor + 200_000, sig())).sessionToken, replacement);
    assert.deepEqual(p.cacheCalls, [false, false]);
    assert.equal(p.refreshes, 0);
    assert.equal(p.f.seen.length, 2);
  } finally { a.close(); }
});

test("a late renewal, failed Signin, or second renewal in one phase stops without fallback or AWS work", async () => {
  for (const cacheAfter of ["renewed", "fail", "double"] as const) {
    const p = phaseFixture({ expiry: anchor + 200_000, cacheAfter }), a = await bindFirstOpenInstallHostPhaseSource(p.options);
    try {
      await a.openPhase("launch", anchor + 80_000, sig());
      p.f.time(anchor + (cacheAfter === "renewed" ? 174_000 : 90_000));
      await assert.rejects(a.openPhase("bucket-protect", anchor + 220_000, sig()),
        /INSUFFICIENT_PHASE_TIME_FOR_RENEWAL|PHASE_STOP_NO_RETRY|SIGNIN_RENEWAL_BUDGET/);
      assert.equal(p.refreshes, cacheAfter === "renewed" ? 0 : 1);
      assert.equal(p.f.seen.length, 1);
      await assert.rejects(a.openPhase("bucket-protect", anchor + 500_000, sig()), /WINDOW_OR_AMBIENT_OVERRIDE/);
      await assert.rejects(a.source.bucket.describeStack(firstOpenInstallBucketStack, sig()), /PHASE_NOT_OPEN/);
    } finally { a.close(); }
  }
});
