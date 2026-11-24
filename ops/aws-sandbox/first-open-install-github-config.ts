import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import type { FirstOpenInstallReadbackPlan } from "./first-open-install-readback.ts";

const envName = "techlong-sandbox-deploy", actorId = 14145707, repositoryId = 1323312747;
const repo = "/repos/veinyyxy/TechlongSoftware", env = `${repo}/environments/${envName}`;
const planName = "TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN", shaName = "TECHLONG_FIRST_OPEN_INSTALL_READBACK_PLAN_SHA256";
const runtimeName = "TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT", runName = "TECHLONG_FIRST_OPEN_INSTALL_READBACK_RUN_ID";
const names = [shaName, runtimeName, planName, runName] as const;
type Name = (typeof names)[number];
const hex = /^[0-9a-f]{64}$/, commit = /^[0-9a-f]{40}$/, id = /^[1-9][0-9]{0,18}$/;
type Method = "GET" | "POST" | "PUT" | "DELETE";
export type FirstOpenInstallGitHubConfigRequest = (method: Method, path: string, signal: AbortSignal,
  body?: Record<string, unknown>) => Promise<{ status: number; value: unknown; authorizedNotFound?: boolean; paginated?: boolean }>;
type Answer = Awaited<ReturnType<FirstOpenInstallGitHubConfigRequest>>;
type JournalEvent = { kind: "create-intent" | "create-ack" | "owned" | "delete-intent" | "delete-ack" | "absence-confirmed";
  name: Name; at: number; planSha256: string; createdAt?: string; updatedAt?: string; valueSha256?: string };
export interface FirstOpenInstallGitHubConfigJournal {
  /** Durable writes. A repeated intent for the same exact approval/name is
   * rejected; do not replay a lost ACK or silently reuse a previous slot. */
  record(event: JournalEvent): Promise<void>;
}
type Owned = { name: Name; createdAt: string; updatedAt: string; value?: string };
const at = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const match = (v: unknown, pattern: RegExp): v is string => typeof v === "string" && pattern.test(v);
const fail = (why: string): never => { throw Error("FIRST_OPEN_INSTALL_GITHUB_CONFIG_" + why); };
function need(value: unknown, why: string): asserts value { if (!value) fail(why); }
const datetime = (text: unknown) => typeof text === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(text) ?
  Date.parse(text) : NaN;
const sameId = (x: unknown, expected: string) => typeof x === "number" && Number.isSafeInteger(x) && x > 0 && String(x) === expected;
const variable = (name: Name) => name !== planName;
const collection = (name: Name) => `${env}/${variable(name) ? "variables" : "secrets"}`;
const pathOf = (name: Name) => `${collection(name)}/${name}`;
const absent = (r: Answer) => r.status === 404 && r.authorizedNotFound === true && !r.paginated && obj(r.value) && r.value.message === "Not Found";
const ok = (r: Answer, label: string) => { need(r.status === 200 && !r.paginated && obj(r.value), label); return r.value; };

/** An exact protected-input custodian. The caller owns authenticated GitHub
 * transport, vetted crypto_box_seal and the permanent journal. This binder
 * never discovers tokens, changes an environment gate or dispatches a workflow. */
export function bindFirstOpenInstallGitHubConfig(input: { environmentId: string; request: FirstOpenInstallGitHubConfigRequest;
  seal(plaintext: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array>; journal: FirstOpenInstallGitHubConfigJournal; now?: () => number }) {
  const { environmentId, request, seal, journal, now = Date.now } = input;
  need(match(environmentId, id), "ENVIRONMENT_ID");
  let plan: FirstOpenInstallReadbackPlan | undefined, planSha256 = "", prepared = false, bound = false, started = false, cleaned = false, busy = false;
  let gets = 0, creates = 0, deletes = 0;
  const owned = new Map<Name, Owned>(), uncertain = new Set<Name>();
  const clock = (deadline: number, signal: AbortSignal) => {
    const t = now();
    need(at(t) && !signal.aborted && t < deadline, "WINDOW_OR_ABORTED");
    return t;
  };
  const call = async (method: Method, path: string, deadline: number, outer: AbortSignal, body?: Record<string, unknown>) => {
    const t = clock(deadline, outer);
    if (method === "GET") need(++gets <= 23, "READ_BUDGET");
    else if (method === "DELETE") need(++deletes <= 4, "DELETE_BUDGET");
    else need(++creates <= 4, "CREATE_BUDGET");
    const signal = AbortSignal.any([outer, AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - t)))]);
    let result: Answer;
    try { result = await request(method, path, signal, body); } catch { return fail("REQUEST_STOP_NO_RETRY"); }
    clock(deadline, signal);
    need(result && Number.isInteger(result.status) && !result.paginated, "RESPONSE_SCOPE");
    return result;
  };
  const config = async (deadline: number, sig: AbortSignal) => {
    const gate = ok(await call("GET", env, deadline, sig), "ENVIRONMENT_READ");
    need(sameId(gate.id, environmentId) && gate.name === envName, "ENVIRONMENT_COORDINATES");
    return gate;
  };
  function gateRules(gate: Record<string, unknown>) {
    const all = gate.protection_rules, branch = gate.deployment_branch_policy;
    need(Array.isArray(all) && all.every(x => obj(x) && ["required_reviewers", "branch_policy"].includes(x.type as string)) &&
      all.filter(x => x.type === "required_reviewers").length === 1 && all.filter(x => x.type === "branch_policy").length <= 1 &&
      gate.can_admins_bypass === false && obj(branch) && branch.protected_branches === false && branch.custom_branch_policies === true, "ENVIRONMENT_GATES");
    const owner = all.find(x => x.type === "required_reviewers");
    need(owner.prevent_self_review === false && Array.isArray(owner.reviewers) && owner.reviewers.length === 1 &&
      owner.reviewers[0]?.type === "User" && owner.reviewers[0]?.reviewer?.id === actorId, "PERSONAL_REVIEWER");
  }
  const log = (kind: JournalEvent["kind"], name: Name, evidence?: Partial<Owned>, valueSha256?: string) =>
    journal.record({ kind, name, at: now(), planSha256, ...(evidence && { createdAt: evidence.createdAt, updatedAt: evidence.updatedAt }),
      ...(valueSha256 && { valueSha256 }) });
  const mustBeAbsent = async (name: Name, deadline: number, sig: AbortSignal) =>
    need(absent(await call("GET", pathOf(name), deadline, sig)), "AUTHORIZED_ABSENCE_REQUIRED");
  async function create(name: Name, body: Record<string, unknown>, deadline: number, sig: AbortSignal, value?: string) {
    const begin = clock(deadline, sig), valueSha256 = value === undefined ? undefined : await sha256Hex(value);
    await log("create-intent", name, undefined, valueSha256);
    clock(deadline, sig);
    uncertain.add(name);
    // GitHub uses PUT for an environment secret. A racing creation can return
    // 204; that is not a creation ACK and never establishes ownership here.
    const c = await call(variable(name) ? "POST" : "PUT", variable(name) ? collection(name) : pathOf(name), deadline, sig, body);
    need(c.status === 201, "CREATE_NOT_CONFIRMED");
    await log("create-ack", name, undefined, valueSha256);
    const actual = ok(await call("GET", pathOf(name), deadline, sig), "CREATED_METADATA_READ");
    const created = datetime(actual.created_at);
    need(actual.name === name && typeof actual.created_at === "string" && actual.created_at === actual.updated_at &&
      at(created) && created >= begin - 2000 && created <= now() + 2000 && (value === undefined || actual.value === value), "CREATE_OWNERSHIP");
    const item = { name, createdAt: actual.created_at, updatedAt: actual.created_at, ...(value !== undefined && { value }) };
    await log("owned", name, item, valueSha256);
    owned.set(name, item);
    uncertain.delete(name);
  }
  const createVar = (name: Name, value: string, deadline: number, sig: AbortSignal) =>
    create(name, { name, value }, deadline, sig, value);

  return {
    async prepare(actualPlan: FirstOpenInstallReadbackPlan, approvedSha256: string, sig: AbortSignal) {
      need(!started && !cleaned && !busy, "STATE");
      started = true; busy = true;
      try {
        const p = structuredClone(actualPlan);
        need(p?.schema === "techlong/fc41597f-independent-install-readback/v2" && p.jobId === FIRST_OPEN_BASELINE_BINDING.jobId && p.lane === "install" &&
          p.release?.jobId === p.jobId && p.release.actorId === String(actorId) && match(p.release.callerCommit, commit) &&
          match(p.release.runtimeCommit, commit) && match(p.release.workflowId, id) && match(approvedSha256, hex) &&
          at(p.window?.startAt) && at(p.window?.issueBefore) && at(p.window?.factsCutoff) && p.window.startAt < p.window.issueBefore &&
          p.window.issueBefore < p.window.factsCutoff &&
          await sha256Hex(p) === approvedSha256, "EXACT_PLAN");
        const deadline = p.window.issueBefore;
        clock(deadline, sig);
        const bytes = Buffer.from(canonicalJson(p), "utf8");
        try {
          need(bytes.length > 0 && bytes.length <= 32_768, "PLAN_SIZE");
          plan = p; planSha256 = approvedSha256;
          const actor = ok(await call("GET", "/user", deadline, sig), "ACTOR_READ");
          need(actor.id === actorId && actor.login === "veinyyxy", "OPERATOR_IDENTITY");
          gateRules(await config(deadline, sig));
          const branches = ok(await call("GET", `${env}/deployment-branch-policies?per_page=10`, deadline, sig), "BRANCH_READ");
          need(branches.total_count === 1 && Array.isArray(branches.branch_policies) && branches.branch_policies.length === 1 &&
            branches.branch_policies[0]?.name === "main" && branches.branch_policies[0]?.type === "branch", "BRANCH_GATE");
          for (const name of names) await mustBeAbsent(name, deadline, sig);
          const pub = ok(await call("GET", `${env}/secrets/public-key`, deadline, sig), "PUBLIC_KEY_READ");
          need(match(pub.key_id, /^[0-9]{1,32}$/) && match(pub.key, /^[A-Za-z0-9+/]{43}=$/), "PUBLIC_KEY_SHAPE");
          const key = Buffer.from(pub.key, "base64");
          need(key.length === 32 && key.toString("base64") === pub.key, "PUBLIC_KEY_SHAPE");
          let cipher: Uint8Array | undefined;
          let encrypted: string;
          try {
            cipher = await seal(bytes, key);
            clock(deadline, sig);
            need(cipher instanceof Uint8Array && cipher.byteLength === bytes.length + 48, "SEALED_BOX_SHAPE");
            encrypted = Buffer.from(cipher).toString("base64");
          } catch { return fail("SEALED_BOX_UNAVAILABLE"); }
          finally { bytes.fill(0); key.fill(0); if (cipher instanceof Uint8Array) cipher.fill(0); }
          await createVar(shaName, approvedSha256, deadline, sig);
          await createVar(runtimeName, p.release.runtimeCommit, deadline, sig);
          await create(planName, { encrypted_value: encrypted, key_id: pub.key_id }, deadline, sig);
          prepared = true;
        } finally { bytes.fill(0); }
      } finally { busy = false; }
    },
    async bindRun(runId: string, sig: AbortSignal) {
      need(plan && prepared && !bound && !cleaned && !busy && match(runId, id), "RUN_STATE");
      const { release, window } = plan;
      bound = true; busy = true;
      try {
        const found = ok(await call("GET", `${repo}/actions/runs/${runId}`, window.issueBefore, sig), "RUN_READ");
        need(sameId(found.id, runId) && sameId(found.workflow_id, release.workflowId) && found.run_attempt === 1 &&
          found.event === "workflow_dispatch" && found.head_branch === "main" && found.head_sha === release.callerCommit &&
          obj(found.repository) && found.repository.id === repositoryId && obj(found.actor) && found.actor.id === actorId &&
          (found.triggering_actor === undefined || obj(found.triggering_actor) && found.triggering_actor.id === actorId) &&
          ["queued", "requested", "waiting", "pending"].includes(found.status as string) &&
          found.display_title === `first-open-fc41597f-install-readback-${planSha256}`, "RUN_BINDING");
        await mustBeAbsent(runName, window.issueBefore, sig);
        await createVar(runName, runId, window.issueBefore, sig);
      } finally { busy = false; }
    },
    async cleanup(sig: AbortSignal) {
      need(started && !cleaned && !busy, "CLEANUP_STATE");
      cleaned = true; busy = true;
      const notVerified = () => ({ status: "CLEANUP_RESIDUE" as const, residue: [...new Set([...uncertain, ...owned.keys()])] });
      try {
        if (plan && owned.size) {
          const deadline = plan.window.factsCutoff;
          try { await config(deadline, sig); }
          catch { return notVerified(); }
          for (const item of [...owned.values()].reverse()) {
            const name = item.name;
            try {
              const prior = await call("GET", pathOf(name), deadline, sig);
              if (prior.status === 404 && !absent(prior)) return notVerified();
              if (!absent(prior)) {
                const body = ok(prior, "CLEANUP_OWNERSHIP_READ");
                need(body.name === name && body.created_at === item.createdAt && body.updated_at === item.updatedAt &&
                  (item.value === undefined || body.value === item.value), "CLEANUP_OWNERSHIP_CHANGED");
                await log("delete-intent", name, item);
                need((await call("DELETE", pathOf(name), deadline, sig)).status === 204, "DELETE_NOT_CONFIRMED");
                await log("delete-ack", name, item);
                const after = await call("GET", pathOf(name), deadline, sig);
                if (after.status === 404 && !absent(after)) return notVerified();
                need(absent(after), "CLEANUP_ABSENCE_UNPROVEN");
              }
              await log("absence-confirmed", name, item);
              owned.delete(name);
            } catch { /* Preserve this unverified item, never retry it. */ }
          }
        }
        const residue = [...new Set([...uncertain, ...owned.keys()])];
        return { status: residue.length ? "CLEANUP_RESIDUE" as const : "CLEANUP_VERIFIED" as const, residue };
      } finally { busy = false; }
    },
  };
}
