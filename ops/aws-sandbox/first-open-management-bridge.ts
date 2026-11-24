import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { setTimeout as delay } from "node:timers/promises";
import { compileExpressBootstrapCandidateV3 } from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { firstOnboardingInitialSecretVersion, type FirstOnboardingDatabaseIdentity, type FirstOnboardingExpressApproval,
  type FirstOnboardingExpressPorts } from "../../lib/deployments/execution/first-onboarding-express.ts";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenMiddleOperationHash } from "../../lib/deployments/execution/first-onboarding-middle.ts";
import { verifyFirstOpenTaskRelease, type FirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import type { FirstOpenFixedManagement } from "./first-open-express-runtime.ts";
import { sameFirstOpenFence, stopFirstOpen, type FirstOpenFenceInput } from "./first-open-express-scope.ts";
import { assertFinalizedSupervisedTenantStack } from "../../lib/deployments/execution/single-tenant-workload-strategy.ts";
import prepared from "./first-open-fc41597f-remaining-install.prepared.json" with { type: "json" };

const fail = (code: string): never => stopFirstOpen("MANAGEMENT_BRIDGE_" + code);
const hex = /^[a-f0-9]{64}$/;
export const firstOpenManagementSteps = Object.freeze([
  "inspect", "prepare", "inspect", "inspect", "restore", "inspect", "migrateSaas",
  "activateApplication", "inspect", "verify", "inspect",
] as const);
export const firstOpenManagementBucket = FIRST_OPEN_BASELINE_BINDING.bucket;
export const firstOpenManagementMaxGetsPerSlot = 16;
const bytesMax = 16_384;
type Step = typeof firstOpenManagementSteps[number];
type Side = "runonce" | "management";
type Address = { direction: "request" | "reply"; slot: number };
type MailboxAddress = Address & { signal: AbortSignal };
type Mailbox = {
  put(x: MailboxAddress, value: unknown): Promise<void>;
  take(x: MailboxAddress): Promise<unknown>;
};
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const workloadSlot = firstOpenManagementSteps.length + 1;
const stackIdPattern = new RegExp(`^arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`);

export function firstOpenManagementKeys(approvalSha256: string, controlledWorkload = false) {
  if (!hex.test(approvalSha256)) return fail("APPROVAL");
  // Only the new controlled mailbox uses the short namespace: its bucket
  // policy repeats every exact slot ARN. Keep the task and approval intact.
  // Legacy mailboxes, the CFN submission, and install-owner keys are unchanged.
  const root = `${controlledWorkload ? "fom" : "first-open-management"}/${s.jobId}/${approvalSha256}`;
  const request = firstOpenManagementSteps.map((_, i) => `${root}/request-${i + 1}.json`);
  const reply = ["ready", ...firstOpenManagementSteps].map((_, i) => `${root}/reply-${i}.json`);
  if (controlledWorkload) {
    request.push(`${root}/request-${workloadSlot}.json`);
    reply.push(`${root}/reply-${workloadSlot}.json`);
  }
  return { request, reply };
}

/** Both IAM and this adapter split the write directions. No List, delete,
 * multipart upload, arbitrary object key, private package, or default client. */
export function firstOpenManagementMailbox(aws: Pick<S3Client, "send">, side: Side, approvalSha256: string, controlledWorkload = false) {
  const keys = firstOpenManagementKeys(approvalSha256, controlledWorkload);
  const access = ({ direction, slot, signal }: MailboxAddress, write: boolean) => {
    signal.throwIfAborted();
    const own = side === "runonce" ? "request" : "reply";
    if (!["request", "reply"].includes(direction) || (direction === own) !== write ||
      !Number.isSafeInteger(slot) || (direction === "request" ? slot < 1 : slot < 0) || slot > keys.request.length) return fail("KEY_SCOPE");
    return { Bucket: firstOpenManagementBucket, Key: keys[direction][direction === "request" ? slot - 1 : slot], ExpectedBucketOwner: s.account };
  };
  return {
    async put(x, value) {
      const target = access(x, true);
      const Body = canonicalJson(value);
      if (Buffer.byteLength(Body) > bytesMax) return fail("SIZE");
      try {
        const result = await aws.send(new PutObjectCommand({ ...target, Body, IfNoneMatch: "*", ContentType: "application/json",
          ServerSideEncryption: "AES256" }), { abortSignal: x.signal });
        if (!result.VersionId || result.VersionId === "null") return fail("VERSION_UNPROVED");
      } catch { return fail("PUT_STOP_NO_RETRY"); }
    },
    async take(x) {
      const target = access(x, false);
      for (let n = 0; n < firstOpenManagementMaxGetsPerSlot; n++) {
        x.signal.throwIfAborted();
        let result;
        try {
          result = await aws.send(new GetObjectCommand(target), { abortSignal: x.signal });
        } catch (e) {
          const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
          // Without ListBucket AWS may return 403 for a not-yet-created key.
          // Never turns into broader permissions or a second write.
          if ((status !== 403 && status !== 404) || n + 1 === firstOpenManagementMaxGetsPerSlot) return fail("GET_STOP");
          await delay(10_000, undefined, { signal: x.signal });
          continue;
        }
        const body = result.Body;
        if (!body || !(Symbol.asyncIterator in body)) return fail("BODY");
        try {
          if (!result.VersionId || result.VersionId === "null" || result.DeleteMarker || result.ServerSideEncryption !== "AES256" ||
            !result.ContentLength || result.ContentLength > bytesMax) return fail("OBJECT_SCOPE");
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of body as AsyncIterable<Uint8Array>) {
            x.signal.throwIfAborted();
            if (!(chunk instanceof Uint8Array) || (length += chunk.length) > result.ContentLength) return fail("SIZE");
            chunks.push(Buffer.from(chunk));
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { return fail("BYTES"); }
          if (length !== result.ContentLength || canonicalJson(parsed) !== text) return fail("BYTES");
          return parsed;
        } finally {
          if ("destroy" in body && typeof body.destroy === "function") body.destroy();
        }
      }
      return fail("GET_STOP");
    },
  } satisfies Mailbox;
}

export type FirstOpenManagementScope = { approvalSha256: string; releaseSha256: string; runId: string; writeBefore: number; applicationLoginBefore: number;
  express: FirstOnboardingExpressApproval; fence: Omit<FirstOpenFenceInput, "signal">; initialVersionId: string };
type ManagementBridgeInput = FirstOpenManagementScope & { taskRelease?: FirstOpenTaskRelease };

/** Match the same fixed plan and configuration as Neon claim/middle. The
 * historical digest remains valid only for the original no-task-release path. */
export async function firstOpenManagementOperationSha256(taskRelease?: FirstOpenTaskRelease) {
  if (taskRelease === undefined) return prepared.scope.expectedProvisionOperationSha256;
  const release = structuredClone(taskRelease);
  await verifyFirstOpenTaskRelease(release);
  return firstOpenMiddleOperationHash({ planHash: prepared.scope.planSha256, configurationHash: prepared.scope.configurationSha256,
    taskRelease: release });
}

type Result = Awaited<ReturnType<FirstOnboardingExpressPorts["database"][Step]>>;
type Reply = { scope: string; slot: number; requestSha256: string | null; result: Result | null };
type Request = { scope: string; slot: number; step: Step; previousReplySha256: string; runtimeSecretArn: string | null };
const secretPrefix = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-`;
const usableArn = (arn: unknown): arn is string => typeof arn === "string" && arn.startsWith(secretPrefix) && /^[A-Za-z0-9]{6}$/.test(arn.slice(secretPrefix.length));
const record = (raw: unknown, names: string[]) => {
  if (!raw || typeof raw !== "object" || !same(Object.keys(raw).sort(), names)) return fail("MESSAGE_SHAPE");
};
async function setup(input: ManagementBridgeInput) {
  const scope = structuredClone(input), { approvalSha256, releaseSha256, runId, writeBefore, applicationLoginBefore, fence, express, initialVersionId } = scope;
  if (![approvalSha256, releaseSha256, initialVersionId].every(x => hex.test(x)) || !/^[1-9][0-9]{0,19}$/.test(runId) ||
    ![writeBefore, applicationLoginBefore].every(Number.isSafeInteger) || applicationLoginBefore > writeBefore ||
    await sha256Hex(fence.fence.identity.workspaceId) !== s.workspaceSha256) return fail("RELEASE_SCOPE");
  sameFirstOpenFence({ ...fence, signal: new AbortController().signal });
  if (fence.externalFence.operationHash !== await firstOpenManagementOperationSha256(scope.taskRelease)) return fail("RELEASE_SCOPE");
  if (initialVersionId !== await firstOnboardingInitialSecretVersion({ approvalSha256, name: s.secretName, jobId: s.jobId,
    epoch: fence.externalFence, baselineDigest: FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256 })) return fail("VERSION_CHANGED");
  const identity = fence.fence.identity;
  const program = compileExpressBootstrapCandidateV3({ target: express.target, nonce: express.nonce, scope: {
    appInstanceId: identity.appInstanceId, workspaceId: identity.workspaceId, productId: identity.productId,
    environmentId: identity.environmentId, cellKey: "cell-sandbox-1",
  } });
  return { scope, program, scopeHash: await sha256Hex({ approvalSha256, releaseSha256, runId, attempt: 1, writeBefore, applicationLoginBefore, fence, initialVersionId }) };
}

function within(signal: AbortSignal, deadline: number, now: () => number) {
  signal.throwIfAborted();
  const remaining = deadline - now();
  if (remaining <= 0 || remaining > 3_600_000) return fail("WINDOW");
  return AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
}

/** RunOnce receives this port, never a lifecycle signer/session/driver.
 * All stage parameters that can affect SQL are frozen on the other side. */
export async function firstOpenManagementClient(input: ManagementBridgeInput, wire: Mailbox, now = Date.now,
  author?: (stack: Parameters<NonNullable<FirstOpenFixedManagement["submitStack"]>>[0], signal: AbortSignal) =>
    Promise<{ requestSha256: string; versionId: string; putAcknowledgedAt: number }>): Promise<FirstOpenFixedManagement> {
  const { scope, scopeHash, program } = await setup(input);
  let index = 0, last: string | undefined, secret: string | undefined, running = false, stopped = false, migration: string | undefined;
  const readReply = async (slot: number, requestSha256: string | null, signal: AbortSignal) => {
    const raw = await wire.take({ direction: "reply", slot, signal });
    record(raw, ["requestSha256", "result", "scope", "slot"]);
    const reply = raw as Reply;
    const result = reply.result;
    const receipt = result && typeof result === "object" && ("receipt" in result ? result.receipt : result);
    if (reply.scope !== scopeHash || reply.slot !== slot || reply.requestSha256 !== requestSha256 ||
      (slot === 0 ? result !== null : !receipt || !hex.test(receipt.evidenceHash) ||
        !same([receipt.fence, receipt.externalFence], [scope.fence.fence, scope.fence.externalFence]))) return fail("REPLY_SCOPE");
    last = await sha256Hex(reply);
    return reply.result;
  };
  const send = async <K extends Step>(step: K, x: Parameters<FirstOnboardingExpressPorts["database"][K]>[0]):
  Promise<Awaited<ReturnType<FirstOnboardingExpressPorts["database"][K]>>> => {
    if (stopped || running || !last || firstOpenManagementSteps[index] !== step ||
      !same([x.fence, x.externalFence], [scope.fence.fence, scope.fence.externalFence])) return fail("ORDER");
    const signal = within(x.signal, index < 10 ? scope.applicationLoginBefore : scope.writeBefore, now);
    const fields = x as Record<string, unknown>;
    running = true;
    try {
      if (step === "prepare" && !same(fields.program, program) ||
        step === "restore" && !same([fields.baseline, fields.archiveVersionId, fields.manifestVersionId],
          [scope.express.baseline, scope.express.baseline.archiveVersionId, scope.express.baseline.manifestVersionId]) ||
        step === "migrateSaas" && (fields.command !== "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas" || fields.migrationContract !== s.schemaVersion) ||
        step === "activateApplication" && !same([fields.target, fields.applicationRoleArn, fields.migrationEvidenceSha256],
          [scope.express.target, s.applicationRole, migration]) ||
        step === "verify" && (fields.expectedBaselineDigest !== FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256 ||
          fields.expectedMigrationContract !== s.schemaVersion)) return fail("PROGRAM_CHANGED");
      const arn = fields.runtimeSecretRef;
      if (["prepare", "restore", "migrateSaas"].includes(step)) {
        if (!usableArn(arn) || secret && arn !== secret) return fail("SECRET_COORDINATES");
        secret = arn;
      }
      const slot = ++index, request: Request = { scope: scopeHash, slot, step, previousReplySha256: last, runtimeSecretArn: secret ?? null };
      const sha = await sha256Hex(request);
      await wire.put({ direction: "request", slot, signal }, request);
      const result = await readReply(slot, sha, signal);
      if (step === "migrateSaas" && result && "evidenceHash" in result) migration = result.evidenceHash;
      return result as Awaited<ReturnType<FirstOnboardingExpressPorts["database"][K]>>;
    } catch (e) { stopped = true; throw e; }
    finally { running = false; }
  };
  return Object.freeze({
    async checkReady(sha: string, loginBefore: number, signal: AbortSignal) {
      if (stopped || running || last || sha !== scope.approvalSha256 || loginBefore !== scope.applicationLoginBefore) return fail("READY");
      running = true;
      try { await readReply(0, null, within(signal, loginBefore, now)); }
      catch (e) { stopped = true; throw e; }
      finally { running = false; }
    },
    database: Object.freeze<FirstOnboardingExpressPorts["database"]>({
      inspect: x => send("inspect", x), prepare: x => send("prepare", x), restore: x => send("restore", x),
      migrateSaas: x => send("migrateSaas", x), activateApplication: x => send("activateApplication", x), verify: x => send("verify", x),
    }),
    ...(author && { async submitStack(stack: Parameters<NonNullable<FirstOpenFixedManagement["submitStack"]>>[0], upstream: AbortSignal) {
      if (stopped || running || !last || index !== workloadSlot - 1) return fail("WORKLOAD_ORDER");
      const signal = within(upstream, scope.writeBefore, now);
      running = true;
      try {
        assertFinalizedSupervisedTenantStack(stack);
        const { requestSha256, versionId, putAcknowledgedAt } = await author(stack, signal);
        if (!hex.test(requestSha256) || !validFirstOpenVersionId(versionId) ||
          !Number.isSafeInteger(putAcknowledgedAt) || putAcknowledgedAt <= 0 || putAcknowledgedAt > now()) return fail("WORKLOAD_TEMPLATE_ACK");
        const request = { scope: scopeHash, slot: workloadSlot, previousReplySha256: last, requestSha256, versionId, putAcknowledgedAt };
        await wire.put({ direction: "request", slot: workloadSlot, signal }, request);
        const raw = await wire.take({ direction: "reply", slot: workloadSlot, signal });
        record(raw, ["requestSha256", "scope", "slot", "stackId"]);
        const reply = raw as { requestSha256: string; scope: string; slot: number; stackId: string };
        if (reply.scope !== scopeHash || reply.slot !== workloadSlot || reply.requestSha256 !== await sha256Hex(request) ||
          typeof reply.stackId !== "string" || !stackIdPattern.test(reply.stackId)) return fail("WORKLOAD_REPLY");
        signal.throwIfAborted();
        return { operation: "create" as const, stackId: reply.stackId };
      } finally { stopped = true; running = false; }
    } }),
  });
}

/** Protected job owns this loop and its local fixed port. The only inbound
 * content is an operation index, preceding receipt hash, and g1 ARN metadata.
 * The claim/fence gate is independently read, not a boolean from RunOnce. */
export async function serveFirstOpenManagement(input: ManagementBridgeInput, wire: Mailbox, management: FirstOpenFixedManagement,
  verifyClaim: (signal: AbortSignal) => Promise<void>, upstream: AbortSignal, now = Date.now,
  submit?: (request: { arn: string; identity: FirstOnboardingDatabaseIdentity; requestSha256: string; versionId: string;
    putAcknowledgedAt: number; signal: AbortSignal }) => Promise<{ stackId: string }>) {
  const { scope, scopeHash, program } = await setup(input);
  const early = within(upstream, scope.applicationLoginBefore, now);
  await management.checkReady(scope.approvalSha256, scope.applicationLoginBefore, early);
  let last: string, migration: string | undefined, secret: string | undefined, verifiedIdentity: FirstOnboardingDatabaseIdentity | undefined;
  async function replied(slot: number, requestSha256: string | null, result: Result | null, signal: AbortSignal) {
    const reply: Reply = { scope: scopeHash, slot, requestSha256, result };
    await wire.put({ direction: "reply", slot, signal }, reply);
    last = await sha256Hex(reply);
  }
  const db = management.database;
  await replied(0, null, null, early);
  for (const [i, step] of firstOpenManagementSteps.entries()) {
    const slot = i + 1, signal = within(upstream, i < 10 ? scope.applicationLoginBefore : scope.writeBefore, now);
    const raw = await wire.take({ direction: "request", slot, signal });
    record(raw, ["previousReplySha256", "runtimeSecretArn", "scope", "slot", "step"]);
    const req = raw as Request;
    if (req.scope !== scopeHash || req.slot !== slot || req.step !== step || req.previousReplySha256 !== last! ||
      (slot === 1 ? req.runtimeSecretArn !== null : !usableArn(req.runtimeSecretArn) || !!secret && req.runtimeSecretArn !== secret)) return fail("REQUEST_SCOPE");
    secret = req.runtimeSecretArn ?? undefined;
    await verifyClaim(signal);
    signal.throwIfAborted();
    const x = { ...structuredClone(scope.fence), signal };
    const common = { ...x, runtimeSecretRef: secret!, idempotencyKey: await sha256Hex({ scope: scopeHash, slot }) };
    const { baseline, target } = scope.express;
    let result: Result;
    switch (step) {
      case "inspect": result = await db.inspect(x); break;
      case "prepare": result = await db.prepare({ ...common, program }); break;
      case "restore": result = await db.restore({ ...common, baseline, archiveVersionId: baseline.archiveVersionId, manifestVersionId: baseline.manifestVersionId }); break;
      case "migrateSaas":
        result = await db.migrateSaas({ ...common, command: "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas", migrationContract: s.schemaVersion });
        migration = result.evidenceHash; break;
      case "activateApplication":
        if (!migration) return fail("MIGRATION");
        result = await db.activateApplication({ ...x, target, applicationRoleArn: s.applicationRole, migrationEvidenceSha256: migration }); break;
      case "verify":
        result = await db.verify({ ...x, expectedBaselineDigest: baseline.archiveSha256, expectedMigrationContract: s.schemaVersion });
        verifiedIdentity = structuredClone(result.identity); break;
    }
    // verify() returns the same evidence inside its existing receipt shape.
    await replied(slot, await sha256Hex(req), result, signal);
  }
  if (submit) {
    if (!verifiedIdentity || !usableArn(secret)) return fail("WORKLOAD_IDENTITY");
    const signal = within(upstream, scope.writeBefore, now);
    const raw = await wire.take({ direction: "request", slot: workloadSlot, signal });
    record(raw, ["previousReplySha256", "putAcknowledgedAt", "requestSha256", "scope", "slot", "versionId"]);
    const req = raw as { previousReplySha256: string; requestSha256: string; scope: string; slot: number; versionId: string; putAcknowledgedAt: number };
    if (req.scope !== scopeHash || req.slot !== workloadSlot || req.previousReplySha256 !== last! ||
      typeof req.requestSha256 !== "string" || !hex.test(req.requestSha256) || !validFirstOpenVersionId(req.versionId) ||
      !Number.isSafeInteger(req.putAcknowledgedAt) || req.putAcknowledgedAt <= 0 || req.putAcknowledgedAt > now()) return fail("WORKLOAD_REQUEST");
    await verifyClaim(signal);
    signal.throwIfAborted();
    const ack = await submit({ arn: secret, identity: verifiedIdentity, requestSha256: req.requestSha256,
      versionId: req.versionId, putAcknowledgedAt: req.putAcknowledgedAt, signal });
    if (!stackIdPattern.test(ack.stackId)) return fail("WORKLOAD_REPLY");
    await wire.put({ direction: "reply", slot: workloadSlot, signal }, { scope: scopeHash, slot: workloadSlot,
      requestSha256: await sha256Hex(req), stackId: ack.stackId });
  }
}
