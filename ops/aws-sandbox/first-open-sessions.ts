import { AssumeRoleCommand, AssumeRoleWithWebIdentityCommand, GetCallerIdentityCommand, STSClient, type Credentials as StsCredentials } from "@aws-sdk/client-sts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { sdkConfig, type FirstOpenCredentials } from "./first-open-express-aws.ts";
import { stopFirstOpen } from "./first-open-express-scope.ts";
import oidc from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };
import probe from "./first-open-fc41597f-session-deltas.prepared.json" with { type: "json" };
import locked from "./first-open-fc41597f-lifecycle-iam-alignment.prepared.json" with { type: "json" };
import { bindFirstOpenReleaseEntry, type FirstOpenFrozenRelease } from "./first-open-release-entry.ts";

export type FirstOpenCredentialSource = Extract<FirstOpenCredentials, () => Promise<unknown>>;
type Credentials = Awaited<ReturnType<FirstOpenCredentialSource>>;
const { runOnce, inspect } = oidc.federatedTrust;
const roles = {
  provisioner: { ...runOnce.targets[0], name: "first-open-fc41597f-provisioner-g1", arn: s.workerRole },
  lifecycle: { ...runOnce.targets[1], name: locked.isolation.sessionName, arn: s.lifecycleRole },
  application: { roleId: probe.applicationProbe.targetRoleId, roleArn: probe.applicationProbe.targetRoleArn,
    name: probe.applicationProbe.sessionName, arn: s.applicationRole },
  inspector: { ...inspect.targets[0], name: "first-open-fc41597f-inspector-g1", arn: s.inspectorRole },
} as const;
export type FirstOpenSessionKind = keyof typeof roles;
export type FirstOpenCaller = { accountId: string; arn: string; roleId: string; credentialExpiresAt: number };

export function firstOpenSessionArn(kind: FirstOpenSessionKind) {
  const r = roles[kind];
  return `arn:aws:sts::${s.account}:assumed-role/${r.arn.split("/").at(-1)}/${r.name}`;
}

export function assertFirstOpenSession(kind: FirstOpenSessionKind, caller: FirstOpenCaller,
  now: number, neededThrough: number) {
  const r = roles[kind];
  if (r.roleArn !== r.arn || caller.accountId !== s.account || caller.roleId !== r.roleId || caller.arn !== firstOpenSessionArn(kind) ||
    ![now, neededThrough, caller.credentialExpiresAt].every(Number.isSafeInteger) ||
    now >= neededThrough || caller.credentialExpiresAt <= Math.max(now + 120_000, neededThrough)) {
    return stopFirstOpen("FIXED_SESSION_UNPROVED");
  }
}

/** Bind the already-issued, app-specific session to an exact STS identity.
 * No fallback, AssumeRole, renewal, or trust installation. This is consumption
 * validation; the still-locked issuer must separately enforce the same names. */
export function bindFirstOpenSession(kind: FirstOpenSessionKind, source: FirstOpenCredentialSource,
  neededThrough: number, now = Date.now,
  openSts: (snapshot: Credentials) => Pick<STSClient, "send" | "destroy"> = snapshot => new STSClient(sdkConfig(snapshot))) {
  let checked: Promise<{ snapshot: Credentials; identity: FirstOpenCaller }> | undefined;
  async function resolve(signal: AbortSignal) {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(neededThrough) || now() >= neededThrough) return stopFirstOpen("FIXED_SESSION_UNPROVED");
    checked ??= (async () => {
      const supplied = await source().catch(() => stopFirstOpen("RUNTIME_CREDENTIALS_UNAVAILABLE"));
      const expiry = supplied?.expiration instanceof Date ? supplied.expiration.getTime() : NaN;
      if (!supplied?.accessKeyId || !supplied.secretAccessKey || !supplied.sessionToken || !Number.isSafeInteger(expiry) ||
        (kind === "application" && expiry > now() + 900_000)) return stopFirstOpen("FIXED_SESSION_UNPROVED");
      // Clone the expiration; a mutable provider result must not extend our session.
      const snapshot = { ...supplied, expiration: new Date(expiry) };
      const client = openSts(snapshot);
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
      try {
        const { Account, Arn, UserId } = await client.send(new GetCallerIdentityCommand({}), { abortSignal: bounded });
        bounded.throwIfAborted();
        const r = roles[kind], suffix = ":" + r.name;
        if (!UserId?.endsWith(suffix)) return stopFirstOpen("FIXED_SESSION_UNPROVED");
        const roleId = UserId.slice(0, -suffix.length);
        const identity = Object.freeze({ accountId: Account ?? "", arn: Arn ?? "", roleId, credentialExpiresAt: expiry });
        assertFirstOpenSession(kind, identity, now(), neededThrough);
        return { snapshot, identity };
      } catch {
        return stopFirstOpen("FIXED_SESSION_UNPROVED");
      } finally { client.destroy(); }
    })();
    const result = await checked;
    signal.throwIfAborted();
    assertFirstOpenSession(kind, result.identity, now(), neededThrough);
    return result;
  }
  return Object.freeze({
    async identify(signal: AbortSignal) { return (await resolve(signal)).identity; },
    async credentials(signal: AbortSignal) {
      const { snapshot } = await resolve(signal);
      return { ...snapshot, expiration: new Date(snapshot.expiration!.getTime()) };
    },
  });
}

function issued(value: StsCredentials | undefined) {
  if (!value?.AccessKeyId || !value.SecretAccessKey || !value.SessionToken || !(value.Expiration instanceof Date)) {
    return stopFirstOpen("SESSION_ISSUE_UNPROVED");
  }
  return { accessKeyId: value.AccessKeyId, secretAccessKey: value.SecretAccessKey, sessionToken: value.SessionToken,
    expiration: new Date(value.Expiration.getTime()) };
}

/** Explicit protected-job OIDC source. No environment fallback, no export to
 * outputs. Claims are preflight only: STS must authenticate the signed token
 * against the same independently installed role trust. */
export function firstOpenGitHubIssuedSession(input: {
  release: FirstOpenFrozenRelease;
  trustedReleaseSha256: string;
  actual: Parameters<typeof bindFirstOpenReleaseEntry>[2];
  getToken(audience: string, signal: AbortSignal): Promise<string>;
}, now = Date.now): FirstOpenCredentialSource {
  const { actual, release, getToken } = input;
  let once: Promise<Credentials> | undefined;
  return () => once ??= (async () => {
    await bindFirstOpenReleaseEntry(release, input.trustedReleaseSha256, actual);
    if (now() < release.startAt || now() >= release.claimBefore) return stopFirstOpen("SESSION_ISSUE_WINDOW");
    const kind = { management: "lifecycle", inspect: "inspector", runonce: "provisioner" }[actual.role] as "lifecycle" | "inspector" | "provisioner";
    const role = roles[kind], signal = AbortSignal.timeout(Math.min(15_000, release.claimBefore - now()));
    const client = new STSClient({ region: s.region, maxAttempts: 1, ignoreConfiguredEndpointUrls: true,
      credentials: async () => stopFirstOpen("WEB_IDENTITY_MUST_NOT_USE_AWS_SOURCE") });
    try {
      const token = await getToken("sts.amazonaws.com", signal);
      if (typeof token !== "string" || token.length > 32_768 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return stopFirstOpen("OIDC_TOKEN_FORMAT");
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      const fixed = Object.fromEntries(Object.entries(oidc.federatedTrust.commonClaims).map(([k, v]) => [k.split(":")[1], v]));
      const expected = { ...fixed, iss: oidc.federatedTrust.issuer, actor_id: release.actorId, job_workflow_ref: actual.reusableRef,
        run_id: actual.ownRunId, run_attempt: "1", event_name: "workflow_dispatch" };
      if (!Object.entries(expected).every(([k, v]) => claims[k] === v) || now() >= release.claimBefore) return stopFirstOpen("OIDC_ROLE_SCOPE");
      signal.throwIfAborted();
      const result = await client.send(new AssumeRoleWithWebIdentityCommand({ RoleArn: role.arn, RoleSessionName: role.name,
        WebIdentityToken: token, DurationSeconds: Math.min(3_600, Math.max(900, Math.ceil((release.writeBefore - now()) / 1000) + 180)) }), { abortSignal: signal });
      return issued(result.Credentials);
    } catch { return stopFirstOpen("OIDC_SESSION_ISSUE_STOP"); }
    finally { client.destroy(); }
  })();
}

/** Manager-only role chain, exact app probe, no raw credentials cross jobs. */
export function firstOpenManagerProbeSource(lifecycle: FirstOpenCredentialSource, before: number, now = Date.now): FirstOpenCredentialSource {
  let once: Promise<Credentials> | undefined;
  return () => once ??= (async () => {
    if (now() >= before) return stopFirstOpen("SESSION_ISSUE_WINDOW");
    const client = new STSClient(sdkConfig(lifecycle));
    const abortSignal = AbortSignal.timeout(Math.min(15_000, before - now()));
    try {
      const result = await client.send(new AssumeRoleCommand({ RoleArn: roles.application.arn,
        RoleSessionName: roles.application.name, DurationSeconds: 900 }), { abortSignal });
      return issued(result.Credentials);
    } catch { return stopFirstOpen("APPLICATION_SESSION_ISSUE_STOP"); }
    finally { client.destroy(); }
  })();
}
