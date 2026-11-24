import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DescribeChangeSetCommandOutput, DescribeStacksCommandOutput, GetTemplateCommandOutput } from "@aws-sdk/client-cloudformation";
import type { AwsCredentialIdentity } from "@smithy/types";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenInstallBucketStack } from "./first-open-install-bucket-executor.ts";
import type { FirstOpenInstallIndependentBucketPorts } from "./first-open-install-independent-bucket.ts";

const account = "402010193138", region = "ca-central-1", { bucket } = FIRST_OPEN_BASELINE_BINDING;
const source = `arn:aws:iam::${account}:user/techlong-sandbox-dev`, userId = "AIDAV3GNMXTZEO7SHLC2X";
const cfn = `arn:aws:cloudformation:${region}:${account}:`;
const inspectorStack = cfn + "stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f";
const hex = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const win = process.platform === "win32";
// No PATH lookup and no alternate cli fallback.
const aws = win ? "D:\\Amazon\\AWSCLIV2\\aws.exe" : "/usr/local/bin/aws";
const cliExec = promisify(execFile);
type Options = { env: NodeJS.ProcessEnv; signal: AbortSignal; timeout: number; maxBuffer: number; encoding: "utf8"; windowsHide: true };
type Runner = (binary: string, args: string[], options: Options) => Promise<{ stdout: string }>;
const exec: Runner = (binary, args, options) => cliExec(binary, args, options);
type Service = "sts" | "cloudformation" | "s3";
export type FirstOpenInstallTerminalPhase = "inspector" | "bucket";
const fail = (s: string): never => { throw Error("FIRST_OPEN_TERMINAL_SOURCE_" + s); };
function need(ok: unknown, s: string): asserts ok { if (!ok) fail(s); }
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const plain = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);

/** SDK-shaped read port for a new subprocess using the SAME approved Source.
 * This is not independent-identity evidence. The owner of the outer durable
 * install journal supplies an already loaded temporary snapshot; this port
 * never discovers, refreshes, outputs or puts it on the command line. A named
 * phase permits only that terminal readback under its own cutoff and STS check. */
export function bindFirstOpenInstallSourceTerminalPorts(input: { installIntentSha256: string; factsExpireAt: number;
  credentials: AwsCredentialIdentity; phase?: FirstOpenInstallTerminalPhase; now?: () => number; run?: Runner }): FirstOpenInstallIndependentBucketPorts {
  const { installIntentSha256, factsExpireAt, credentials: snapshot, phase, now = Date.now, run = exec } = input;
  const expiry = snapshot?.expiration instanceof Date ? snapshot.expiration.getTime() : NaN;
  const bound = now();
  need((phase === undefined || phase === "inspector" || phase === "bucket") &&
    plain(installIntentSha256, hex) && time(bound) && time(factsExpireAt) && factsExpireAt > bound && time(expiry) && expiry > factsExpireAt &&
    plain(snapshot?.accessKeyId, /^[A-Z0-9]{16,128}$/) && plain(snapshot?.secretAccessKey, /^[A-Za-z0-9/+=]{32,256}$/) &&
    plain(snapshot?.sessionToken, /^[!-~]{8,32768}$/), "PLAN_OR_FIXED_SESSION");
  // Do not inherit AWS_*, credential/process configuration, proxy, CA, CLI
  // plugin or profile variables. The null config files close the profile path.
  const nullFile = win ? "NUL" : "/dev/null";
  const os = win ? Object.fromEntries(["SystemRoot", "TEMP", "TMP"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : [])) : {};
  const env = Object.freeze({ ...os, NODE_ENV: "production" as const,
    AWS_CONFIG_FILE: nullFile, AWS_SHARED_CREDENTIALS_FILE: nullFile, AWS_ACCESS_KEY_ID: snapshot.accessKeyId,
    AWS_SECRET_ACCESS_KEY: snapshot.secretAccessKey, AWS_SESSION_TOKEN: snapshot.sessionToken, AWS_EC2_METADATA_DISABLED: "true",
    AWS_MAX_ATTEMPTS: "1", AWS_RETRY_MODE: "standard", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" });
  const suffix = installIntentSha256.slice(0, 24);
  const nameFor = (stack: string) => stack === inspectorStack ? `fc41597f-install-readback-${suffix}-relock` :
    stack === firstOpenInstallBucketStack ? `fc41597f-install-bucket-${suffix}-restore` : fail("STACK_SCOPE");
  const limit = phase === "inspector" ? 4 : phase === "bucket" ? 5 : 8;
  let next = 0, busy = false, stopped = false;
  const scope = (ok: unknown, why: string) => { if (!ok) { stopped = true; fail(why); } };
  const offset = (stack: string, operation: number) => {
    scope(stack === inspectorStack || stack === firstOpenInstallBucketStack, "STACK_SCOPE");
    scope(phase === undefined || (phase === "inspector" ? stack === inspectorStack : stack === firstOpenInstallBucketStack), "PHASE_SCOPE");
    return (phase !== undefined || stack === inspectorStack ? 1 : 4) + operation;
  };
  const remaining = (upstream: AbortSignal) => {
    const at = now();
    scope(!upstream.aborted && time(at) && at >= bound && at < factsExpireAt && at < expiry, "WINDOW_OR_ABORTED");
    return Math.min(15_000, factsExpireAt - at, expiry - at);
  };
  const call = async <T>(index: number, service: Service, action: string, args: string[], upstream: AbortSignal,
    interpret: (body: Record<string, unknown>) => T) => {
    scope(!stopped && !busy && index === next && next < limit, "ORDER_OR_BUDGET");
    const timeout = remaining(upstream);
    const signal = AbortSignal.any([upstream, AbortSignal.timeout(timeout)]);
    busy = true; next++;
    try {
      let raw: { stdout: string };
      try {
        raw = await run(aws, [service, action, ...args, "--region", region,
          "--endpoint-url", `https://${service}.${region}.amazonaws.com`, "--no-paginate", "--no-cli-pager", "--output", "json",
          "--cli-connect-timeout", "5", "--cli-read-timeout", "10"],
        { env: { ...env }, signal, timeout, maxBuffer: 524_288, encoding: "utf8", windowsHide: true });
      } catch { return fail("CLI_READ_STOP_NO_RETRY"); }
      scope(!signal.aborted && !stopped, "WINDOW_OR_ABORTED");
      remaining(upstream);
      scope(typeof raw?.stdout === "string" && Buffer.byteLength(raw.stdout) <= 524_288, "CLI_RESPONSE");
      let body: unknown;
      try { body = JSON.parse(raw.stdout); } catch { return fail("CLI_RESPONSE"); }
      need(record(body) && !("$metadata" in body) && !body.NextToken && !body.NextMarker && !body.Marker && body.IsTruncated !== true, "CLI_RESPONSE");
      // Successful CLI output has no SDK metadata. Map its exact successful
      // read to the existing read port; these are not raw HTTP response bytes.
      return { ...interpret(body), $metadata: { httpStatusCode: 200, attempts: 1 } };
    } catch (e) { stopped = true; throw e; }
    finally { busy = false; }
  };
  const timestamp = (v: unknown) => {
    const at = typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
    need(time(at), "STACK_CLOCK");
    return new Date(at);
  };
  return {
    identify: sig => call(0, "sts", "get-caller-identity", [], sig, v => {
      need(v.Account === account && v.Arn === source && v.UserId === userId, "SOURCE_IDENTITY");
      return { Account: account, Arn: source, UserId: userId };
    }),
    describeStack: async (stack, sig) => call(offset(stack, 0), "cloudformation", "describe-stacks", ["--stack-name", stack], sig, v => {
      const rows = v.Stacks as NonNullable<DescribeStacksCommandOutput["Stacks"]> | undefined, row = rows?.[0];
      need(Array.isArray(rows) && rows.length === 1 && row?.StackId === stack && row.StackStatus === "UPDATE_COMPLETE" &&
        !row.DeletionTime && !row.ParentId && !row.RootId && !row.RoleARN, "STACK_TERMINAL");
      return { Stacks: [{ ...row, CreationTime: timestamp(row.CreationTime),
        ...(row.LastUpdatedTime !== undefined && { LastUpdatedTime: timestamp(row.LastUpdatedTime) }) }] };
    }),
    describeChange: async (stack, id, sig) => {
      const index = offset(stack, 1), name = nameFor(stack), prefix = `${cfn}changeSet/${name}/`;
      scope(typeof id === "string" && id.startsWith(prefix) && uuid.test(id.slice(prefix.length)), "CHANGE_SET_SCOPE");
      return call(index, "cloudformation", "describe-change-set", ["--stack-name", stack, "--change-set-name", id], sig, v => {
        need(v.StackId === stack && v.ChangeSetId === id && v.ChangeSetName === name && v.Status === "CREATE_COMPLETE" &&
          v.ExecutionStatus === "EXECUTE_COMPLETE" && !v.RootChangeSetId && !v.ParentChangeSetId && !v.IncludeNestedStacks &&
          !v.ImportExistingResources, "CHANGE_SET_TERMINAL");
        return v as Omit<DescribeChangeSetCommandOutput, "$metadata">;
      });
    },
    getOriginal: async (stack, sig) => call(offset(stack, 2), "cloudformation", "get-template", ["--stack-name", stack, "--template-stage", "Original"], sig, v => {
      const stages = v.StagesAvailable;
      const template = typeof v.TemplateBody === "string" ? v.TemplateBody : record(v.TemplateBody) ? JSON.stringify(v.TemplateBody) : "";
      need(Array.isArray(stages) && stages.includes("Original") && new Set(stages).size === stages.length &&
        stages.every(x => x === "Original" || x === "Processed") && template.length > 0 && Buffer.byteLength(template) <= 51_200, "ORIGINAL_STAGE");
      return { StagesAvailable: stages, TemplateBody: template } as Omit<GetTemplateCommandOutput, "$metadata">;
    }),
    getBucketPolicy: async (arg, sig) => {
      scope(phase !== "inspector", "PHASE_SCOPE");
      scope(record(arg) && Object.keys(arg).sort().join(",") === "Bucket,ExpectedBucketOwner" && arg.Bucket === bucket &&
        arg.ExpectedBucketOwner === account, "BUCKET_SCOPE");
      return call(phase === "bucket" ? 4 : 7, "s3", "get-bucket-policy", ["--bucket", bucket, "--expected-bucket-owner", account], sig, v => {
        need(typeof v.Policy === "string" && v.Policy.length > 0 && Buffer.byteLength(v.Policy) <= 20_480, "BUCKET_POLICY_RESPONSE");
        return { Policy: v.Policy };
      });
    },
  };
}
