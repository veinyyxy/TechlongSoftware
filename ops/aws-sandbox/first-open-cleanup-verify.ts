import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_EXPRESS_ENDPOINT, FIRST_OPEN_MANAGEMENT_SQL_USER, parseExpressManagementTargetV3 } from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenManagerSessions, type FirstOpenPg, type FirstOpenSigner } from "./first-open-express-management.ts";
import { bindFirstOpenSession } from "./first-open-sessions.ts";
import oidc from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

const repo = "veinyyxy/TechlongSoftware";
export const cleanupReusable = ".github/workflows/sandbox-first-open-cleanup-verify-v1.yml";
const sessionName = "first-open-fc41597f-cleanup-g1";
const hex = /^[a-f0-9]{64}$/;
const fail = (reason: string): never => { throw Error("FIRST_OPEN_CLEANUP_VERIFY_" + reason); };
const bases = Object.fromEntries(Object.entries(oidc.federatedTrust.commonClaims).map(([name, value]) => [name.split(":")[1], value]));
export type FirstOpenCleanupPermit = { schema: "techlong/fc41597f-cleanup-verify/v1"; jobId: string;
  sourceCommit: string; runId: string; startAt: number; issueBefore: number; verifyBefore: number };

export async function checkFirstOpenCleanupPermit(input: FirstOpenCleanupPermit, digest: string, now: number) {
  const p = structuredClone(input);
  if (!p || Object.keys(p).sort().join(",") !== "issueBefore,jobId,runId,schema,sourceCommit,startAt,verifyBefore" ||
    p.schema !== "techlong/fc41597f-cleanup-verify/v1" || p.jobId !== s.jobId ||
    !/^[a-f0-9]{40}$/.test(p.sourceCommit) || !/^[1-9][0-9]{0,19}$/.test(p.runId) ||
    ![p.startAt, p.issueBefore, p.verifyBefore, now].every(Number.isSafeInteger) ||
    now < p.startAt || now >= p.issueBefore || p.verifyBefore - p.issueBefore < 120_000 || p.verifyBefore - p.startAt > 600_000 ||
    !hex.test(digest) || await sha256Hex(p) !== digest) return fail("PERMIT");
  return p;
}

export function assertFirstOpenCleanupOidc(claims: Record<string, unknown>, permit: FirstOpenCleanupPermit) {
  const expected = { ...bases, iss: oidc.federatedTrust.issuer, actor_id: "14145707", repository: repo,
    job_workflow_ref: `${repo}/${cleanupReusable}@${permit.sourceCommit}`, run_id: permit.runId, run_attempt: "1", event_name: "workflow_dispatch" };
  if (!claims || !Object.entries(expected).every(([key, value]) => claims[key] === value)) fail("OIDC_SCOPE");
}

/** Use only provider-supported trust keys here. Run ID/attempt are checked in
 * the exact protected job before the signed token is sent to STS. */
export function firstOpenCleanupPermitClaims(permit: FirstOpenCleanupPermit) {
  return { ...oidc.federatedTrust.commonClaims,
    "token.actions.githubusercontent.com:actor_id": "14145707",
    "token.actions.githubusercontent.com:job_workflow_ref": `${repo}/${cleanupReusable}@${permit.sourceCommit}` };
}

export function bindFirstOpenCleanupVerify(input: { permit: FirstOpenCleanupPermit; permitSha256: string;
  getToken(audience: string, signal: AbortSignal): Promise<string>; backendDirectory: string }, now = Date.now) {
  let used = false;
  return async () => {
    if (used) return fail("SLOT_USED");
    used = true;
    const p = await checkFirstOpenCleanupPermit(input.permit, input.permitSha256, now());
    const signal = AbortSignal.timeout(p.verifyBefore - now());
    const session = bindFirstOpenSession("cleanup", async () => {
      if (now() >= p.issueBefore) return fail("ISSUE_WINDOW");
      const bound = AbortSignal.any([signal, AbortSignal.timeout(Math.min(15_000, p.issueBefore - now()))]);
      const client = new STSClient({ region: s.region, ignoreConfiguredEndpointUrls: true, maxAttempts: 1,
        credentials: async () => fail("NO_AWS_SOURCE") });
      try {
        const token = await input.getToken("sts.amazonaws.com", bound);
        if (typeof token !== "string" || token.length > 32_768 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return fail("OIDC_FORMAT");
        assertFirstOpenCleanupOidc(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")), p);
        bound.throwIfAborted();
        if (now() >= p.issueBefore) return fail("ISSUE_WINDOW");
        const { Credentials: c } = await client.send(new AssumeRoleWithWebIdentityCommand({ RoleArn: s.lifecycleRole,
          RoleSessionName: sessionName, DurationSeconds: 900, WebIdentityToken: token }), { abortSignal: bound });
        if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !(c.Expiration instanceof Date)) return fail("STS_ACK");
        return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
      } finally { client.destroy(); }
    }, p.verifyBefore, now);
    const target = parseExpressManagementTargetV3({ schema: "techlong/express-management-target/v3", clusterArn: s.clusterArn,
      clusterResourceId: s.clusterId, endpoint: FIRST_OPEN_EXPRESS_ENDPOINT, port: 5432, observedEngineVersion: "17.9",
      managementDatabase: "postgres", managementUsername: FIRST_OPEN_MANAGEMENT_SQL_USER, stableIdentity: s.stableIdentity, resourceGeneration: 1,
      tenantDatabase: s.tenantDatabase, tenantUsername: s.tenantRole });
    const load = createRequire(resolve(input.backendDirectory, "package.json"));
    const { Client } = load("pg") as { Client: new (config: Record<string, unknown>) => FirstOpenPg };
    const { Signer } = load("@aws-sdk/rds-signer") as { Signer: FirstOpenSigner };
    const ca: readonly string[] = load("./services/saas/aurora_connections_v2.js").loadAtsRoots();
    const identity = await session.identify(signal);
    const port = firstOpenManagerSessions({ target, Client, Signer, ca, credentials: () => session.credentials(signal) });
    const observation = await port.verifyCleanup(signal);
    return { schema: "techlong/fc41597f-cleanup-verify-receipt/v1", jobId: s.jobId, installationSha256: input.permitSha256,
      runId: p.runId, sessionArnSha256: await sha256Hex(identity.arn), checkedAt: now(), readOnly: true, ...observation,
      cleanupInvoked: false, firstOpenDispatched: false, tenantClaimed: false };
  };
}
