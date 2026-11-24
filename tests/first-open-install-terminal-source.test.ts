import assert from "node:assert/strict";
import test from "node:test";
import { isAbsolute } from "node:path";
import { bindFirstOpenInstallSourceTerminalPorts } from "../ops/aws-sandbox/first-open-install-terminal-source.ts";
import { firstOpenInstallBucketStack } from "../ops/aws-sandbox/first-open-install-bucket-executor.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";

const account = "402010193138", region = "ca-central-1", cfn = `arn:aws:cloudformation:${region}:${account}:`;
const inspector = cfn + "stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f";
const { bucket } = FIRST_OPEN_BASELINE_BINDING;
const installIntentSha256 = "a".repeat(64), suffix = installIntentSha256.slice(0, 24), uuid = "00112233-4455-6677-8899-aabbccddeeff";
const inspectorName = `fc41597f-install-readback-${suffix}-relock`, mailboxName = `fc41597f-install-bucket-${suffix}-restore`;
const inspectorChange = `${cfn}changeSet/${inspectorName}/${uuid}`, mailboxChange = `${cfn}changeSet/${mailboxName}/${uuid}`;
const anchor = Date.parse("2026-11-24T15:30:00Z"), factsExpireAt = anchor + 90_000;
const credentials = { accessKeyId: "ASIA0000000000000000", secretAccessKey: "Z".repeat(40), sessionToken: "FAKE-TEMP-TOKEN",
  expiration: new Date(factsExpireAt + 60_000) };
const source = { Account: account, Arn: `arn:aws:iam::${account}:user/techlong-sandbox-dev`, UserId: "AIDAV3GNMXTZEO7SHLC2X" };
const signal = () => new AbortController().signal;
type Runner = NonNullable<Parameters<typeof bindFirstOpenInstallSourceTerminalPorts>[0]["run"]>;
type Lane = Partial<Pick<Parameters<typeof bindFirstOpenInstallSourceTerminalPorts>[0], "phase" | "factsExpireAt" | "credentials">>;

function fixture(fault: "identity" | "cli" | "paginate" | "processed" | "failedChange" | "none" = "none", lane: Lane = {}) {
  let now = anchor;
  const snapshot = lane.credentials ?? credentials;
  const invoked: string[][] = [];
  const run: Runner = async (binary, args, options) => {
    invoked.push(args);
    const [service, op] = args;
    assert.ok(isAbsolute(binary));
    assert.match(binary, /[/\\]aws(?:\.exe)?$/);
    if (process.platform === "win32") assert.equal(binary, "D:\\Amazon\\AWSCLIV2\\aws.exe");
    assert.ok(options.windowsHide && options.encoding === "utf8" && options.timeout <= 15_000);
    assert.equal(options.env.AWS_MAX_ATTEMPTS, "1");
    assert.equal(options.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS, "true");
    assert.equal(options.env.AWS_EC2_METADATA_DISABLED, "true");
    assert.equal(options.env.AWS_SESSION_TOKEN, snapshot.sessionToken);
    assert.equal(options.env.AWS_ACCESS_KEY_ID, snapshot.accessKeyId);
    assert.equal(options.env.AWS_PROFILE, undefined);
    assert.equal(options.env.AWS_ENDPOINT_URL, undefined);
    assert.equal(options.env.AWS_ENDPOINT_URL_CLOUDFORMATION, undefined);
    assert.equal(options.env.HTTPS_PROXY, undefined);
    assert.equal(options.env.PATH, undefined);
    assert.match(options.env.AWS_CONFIG_FILE ?? "", /^(?:NUL|\/dev\/null)$/);
    assert.equal(options.env.AWS_CONFIG_FILE, options.env.AWS_SHARED_CREDENTIALS_FILE);
    assert.ok(!args.join(" ").includes(snapshot.sessionToken!) && !args.join(" ").includes(snapshot.secretAccessKey) &&
      !args.join(" ").includes(snapshot.accessKeyId));
    assert.equal(args[args.indexOf("--endpoint-url") + 1], `https://${service}.${region}.amazonaws.com`);
    assert.ok(args.includes("--no-paginate") && args.includes("--no-cli-pager"));
    const stack = args[args.indexOf("--stack-name") + 1], change = args[args.indexOf("--change-set-name") + 1];
    if (fault === "cli") throw Error("nonpublic-to-be-suppressed");
    let body: Record<string, unknown>;
    switch (op) {
      case "get-caller-identity": body = { ...source, ...(fault === "identity" && { UserId: "other" }) }; break;
      case "describe-stacks": body = { Stacks: [{ StackId: stack, StackStatus: "UPDATE_COMPLETE", CreationTime: new Date(anchor - 20_000).toISOString(),
        LastUpdatedTime: new Date(anchor - 2000).toISOString() }], ...(fault === "paginate" && { NextToken: "not-allowed" }) }; break;
      case "describe-change-set": body = { StackId: stack, ChangeSetId: change, ChangeSetName: change.split("/")[1], Status: "CREATE_COMPLETE",
        ExecutionStatus: fault === "failedChange" ? "EXECUTE_FAILED" : "EXECUTE_COMPLETE" }; break;
      case "get-template": body = { StagesAvailable: [fault === "processed" ? "Processed" : "Original"],
        TemplateBody: stack === inspector ? '{"Resources":{}}' : { Resources: {} } }; break;
      case "get-bucket-policy": body = { Policy: '{"Statement":[]}' }; break;
      default: throw Error("unexpected action");
    }
    return { stdout: JSON.stringify(body) };
  };
  const ports = bindFirstOpenInstallSourceTerminalPorts({ installIntentSha256, factsExpireAt, credentials, ...lane, run, now: () => now });
  return { ports, invoked, setTime: (n: number) => { now = n; } };
}

test("calls only the eight fixed read operations with exact endpoints and no ambient profile", async () => {
  const { ports: p, invoked } = fixture();
  assert.equal((await p.identify(signal())).Arn, source.Arn);
  for (const [stack, change] of [[inspector, inspectorChange], [firstOpenInstallBucketStack, mailboxChange]]) {
    assert.equal((await p.describeStack(stack, signal())).Stacks?.[0]?.CreationTime?.getTime(), anchor - 20_000);
    assert.equal((await p.describeChange(stack, change, signal())).ChangeSetId, change);
    const read = await p.getOriginal(stack, signal());
    assert.deepEqual(read.StagesAvailable, ["Original"]);
    assert.equal(read.TemplateBody, '{"Resources":{}}');
  }
  assert.equal((await p.getBucketPolicy({ Bucket: bucket, ExpectedBucketOwner: account }, signal())).Policy, '{"Statement":[]}');
  await assert.rejects(p.identify(signal()), /ORDER_OR_BUDGET/);
  const practical = invoked.map(x => x.slice(0, x.indexOf("--region")));
  assert.deepEqual(practical, [["sts", "get-caller-identity"],
    ["cloudformation", "describe-stacks", "--stack-name", inspector],
    ["cloudformation", "describe-change-set", "--stack-name", inspector, "--change-set-name", inspectorChange],
    ["cloudformation", "get-template", "--stack-name", inspector, "--template-stage", "Original"],
    ["cloudformation", "describe-stacks", "--stack-name", firstOpenInstallBucketStack],
    ["cloudformation", "describe-change-set", "--stack-name", firstOpenInstallBucketStack, "--change-set-name", mailboxChange],
    ["cloudformation", "get-template", "--stack-name", firstOpenInstallBucketStack, "--template-stage", "Original"],
    ["s3", "get-bucket-policy", "--bucket", bucket, "--expected-bucket-owner", account]]);
});

test("wrong stack, change set, bucket owner or order never reaches the subprocess", async () => {
  for (const bad of [(p: ReturnType<typeof fixture>["ports"]) => p.describeStack("other", signal()),
    (p: ReturnType<typeof fixture>["ports"]) => p.getOriginal(inspector, signal()),
    (p: ReturnType<typeof fixture>["ports"]) => p.getBucketPolicy({ Bucket: bucket, ExpectedBucketOwner: "000000000000" }, signal())]) {
    const { ports, invoked } = fixture();
    await assert.rejects(bad(ports), /STACK_SCOPE|ORDER_OR_BUDGET|BUCKET_SCOPE/);
    assert.equal(invoked.length, 0);
  }
  const { ports: p, invoked } = fixture();
  await p.identify(signal()); await p.describeStack(inspector, signal());
  await assert.rejects(p.describeChange(inspector, mailboxChange, signal()), /CHANGE_SET_SCOPE/);
  assert.equal(invoked.length, 2);
});

test("bad identity, failed or paginated CLI calls and nonterminal reads stop without retries", async () => {
  for (const fault of ["identity", "cli"] as const) {
    const { ports: p, invoked } = fixture(fault);
    await assert.rejects(p.identify(signal()), /^Error: FIRST_OPEN_TERMINAL_SOURCE_(?:SOURCE_IDENTITY|CLI_READ_STOP_NO_RETRY)$/);
    await assert.rejects(p.identify(signal()), /ORDER_OR_BUDGET/);
    assert.equal(invoked.length, 1);
  }
  for (const fault of ["paginate", "failedChange", "processed"] as const) {
    const { ports: p, invoked } = fixture(fault);
    await p.identify(signal());
    if (fault === "paginate") await assert.rejects(p.describeStack(inspector, signal()), /CLI_RESPONSE/);
    else {
      await p.describeStack(inspector, signal());
      if (fault === "failedChange") await assert.rejects(p.describeChange(inspector, inspectorChange, signal()), /CHANGE_SET_TERMINAL/);
      else { await p.describeChange(inspector, inspectorChange, signal()); await assert.rejects(p.getOriginal(inspector, signal()), /ORIGINAL_STAGE/); }
    }
    assert.equal(invoked.length, fault === "paginate" ? 2 : fault === "failedChange" ? 3 : 4);
  }
});

test("a missing temporary session, expired approval or aborted call cannot invoke the CLI", async () => {
  assert.throws(() => bindFirstOpenInstallSourceTerminalPorts({ installIntentSha256, factsExpireAt, now: () => anchor,
    credentials: { ...credentials, sessionToken: undefined } }), /PLAN_OR_FIXED_SESSION/);
  const a = fixture(); a.setTime(factsExpireAt);
  await assert.rejects(a.ports.identify(signal()), /WINDOW_OR_ABORTED/);
  assert.equal(a.invoked.length, 0);
  const b = fixture();
  await assert.rejects(b.ports.identify(AbortSignal.abort()), /WINDOW_OR_ABORTED/);
  assert.equal(b.invoked.length, 0);
});

test("terminal renewal supports only one STS and the exact reads in each named lane", async () => {
  const a = fixture("none", { phase: "inspector", factsExpireAt: anchor + 30_000,
    credentials: { ...credentials, expiration: new Date(anchor + 45_000) } });
  const b = fixture("none", { phase: "bucket",
    credentials: { ...credentials, accessKeyId: "ASIA1111111111111111", sessionToken: "FAKE-NEXT-TEMP-TOKEN" } });
  const check = async (p: typeof a.ports, stack: string, change: string) => {
    assert.equal((await p.identify(signal())).UserId, source.UserId);
    assert.equal((await p.describeStack(stack, signal())).Stacks?.[0].StackId, stack);
    assert.equal((await p.describeChange(stack, change, signal())).ChangeSetId, change);
    assert.deepEqual((await p.getOriginal(stack, signal())).StagesAvailable, ["Original"]);
  };
  await check(a.ports, inspector, inspectorChange);
  b.setTime(anchor + 45_000);
  await check(b.ports, firstOpenInstallBucketStack, mailboxChange);
  await b.ports.getBucketPolicy({ Bucket: bucket, ExpectedBucketOwner: account }, signal());
  assert.deepEqual(a.invoked.map(x => x[1]), ["get-caller-identity", "describe-stacks", "describe-change-set", "get-template"]);
  assert.deepEqual(b.invoked.map(x => x[1]), ["get-caller-identity", "describe-stacks", "describe-change-set", "get-template", "get-bucket-policy"]);
  await assert.rejects(a.ports.identify(signal()), /ORDER_OR_BUDGET/);
  await assert.rejects(b.ports.identify(signal()), /ORDER_OR_BUDGET/);
});

test("named terminal phases reject cross-stack calls, moved cutoff, and a changed Source", async () => {
  const a = fixture("none", { phase: "inspector", factsExpireAt: anchor + 30_000 });
  await assert.rejects(a.ports.getBucketPolicy({ Bucket: bucket, ExpectedBucketOwner: account }, signal()), /PHASE_SCOPE/);
  assert.equal(a.invoked.length, 0);
  const b = fixture("none", { phase: "bucket" });
  await assert.rejects(b.ports.describeStack(inspector, signal()), /PHASE_SCOPE/);
  assert.equal(b.invoked.length, 0);
  const c = fixture("none", { phase: "inspector", factsExpireAt: anchor + 30_000 });
  await c.ports.identify(signal());
  c.setTime(anchor + 30_000);
  await assert.rejects(c.ports.describeStack(inspector, signal()), /WINDOW_OR_ABORTED/);
  assert.equal(c.invoked.length, 1);
  const d = fixture("identity", { phase: "bucket" });
  await assert.rejects(d.ports.identify(signal()), /SOURCE_IDENTITY/);
  await assert.rejects(d.ports.identify(signal()), /ORDER_OR_BUDGET/);
  assert.equal(d.invoked.length, 1);
});
