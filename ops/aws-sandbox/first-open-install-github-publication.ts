import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";

const yaml = createRequire(import.meta.url)("js-yaml") as {
  JSON_SCHEMA: unknown; load(text: string, options: { schema: unknown }): unknown;
};
const repo = "veinyyxy/TechlongSoftware", repositoryId = 1323312747, ownerId = 14145707;
const environment = "techlong-sandbox-deploy", approvedEnvironmentId = 24613410405;
const workflowId = "426525508", branch = "refs/heads/main", prefix = "/repos/" + repo;
const workflow = ".github/workflows/sandbox-first-open-v1.yml";
const inspect = ".github/workflows/sandbox-first-open-inspect-job-v1.yml";
const runOnce = ".github/workflows/sandbox-first-open-run-once-job-v1.yml";
const management = ".github/workflows/sandbox-first-open-management-job-v1.yml";
const checkout = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803";
const commit = /^[0-9a-f]{40}$/;
const maxWorkflowBytes = 128 * 1024;
const failure = (part: string): never => { throw new Error("FIRST_OPEN_INSTALL_GITHUB_PUBLICATION_" + part); };
const object = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const array = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
function yamlFile(value: unknown, path: string) {
  const f = object(value);
  const raw = typeof f.content === "string" && f.content.length <= 2 * maxWorkflowBytes ? f.content.replace(/\r?\n/g, "") : "";
  if (f.type !== "file" || f.path !== path || f.encoding !== "base64" || !Number.isSafeInteger(f.size) ||
    typeof f.sha !== "string" || !commit.test(f.sha) || !raw || !/^[\w+/]+={0,2}$/.test(raw)) return failure("WORKFLOW_CONTENTS");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== f.size || bytes.length > maxWorkflowBytes || bytes.toString("base64") !== raw ||
    createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex") !== f.sha) return failure("WORKFLOW_CONTENTS");
  try {
    return object(yaml.load(new TextDecoder("utf-8", { fatal: true }).decode(bytes), { schema: yaml.JSON_SCHEMA }));
  } catch {
    return failure("WORKFLOW_YAML");
  }
}

/**
 * Authenticated, exact-repository GET port; its caller owns credentials, the
 * api.github.com transport and the prohibition on redirects, retries and pagination.
 * This observes publication/gates and the runtime checkout wiring, not a run or
 * protected-variable values. Those are verified separately by the runner.
 */
export async function verifyFirstOpenInstallPublication(input: {
  release: Pick<FirstOpenFrozenRelease, "callerCommit" | "runtimeCommit" | "workflowId" | "actorId" |
    "inspectReusableCommit" | "runOnceReusableCommit" | "managementReusableCommit">;
  environmentId: number | string;
  request(method: "GET", path: string, signal: AbortSignal, body?: unknown): Promise<{ status: number; value: unknown }>;
  signal: AbortSignal;
}) {
  const p = structuredClone(input.release), { request, signal } = input;
  if (![p.callerCommit, p.runtimeCommit, p.inspectReusableCommit, p.runOnceReusableCommit, p.managementReusableCommit].every(x =>
    typeof x === "string" && commit.test(x)) || p.runtimeCommit !== p.inspectReusableCommit ||
    p.workflowId !== workflowId || p.actorId !== String(ownerId) ||
    (input.environmentId !== approvedEnvironmentId && input.environmentId !== String(approvedEnvironmentId))) return failure("PLAN");
  const get = async (path: string, part: string) => {
    signal.throwIfAborted();
    let response;
    try { response = await request("GET", prefix + path, signal); } catch { return failure(part); }
    signal.throwIfAborted();
    if (response?.status !== 200) return failure(part);
    return object(response.value);
  };
  const identity = await get("", "REPOSITORY");
  if (identity.id !== repositoryId || identity.full_name !== repo || identity.default_branch !== "main" ||
    object(identity.owner).id !== ownerId || object(identity.owner).login !== "veinyyxy") return failure("REPOSITORY");
  const ref = await get("/git/ref/heads/main", "MAIN");
  const head = object(ref.object);
  if (ref.ref !== branch || head.type !== "commit" || head.sha !== p.callerCommit) return failure("MAIN");
  const currentWorkflow = await get("/actions/workflows/" + workflowId, "DISPATCHER");
  if (currentWorkflow.id !== Number(workflowId) || currentWorkflow.path !== workflow ||
    currentWorkflow.state !== "active") return failure("DISPATCHER");
  const route = "/environments/" + environment;
  const gate = await get(route, "ENVIRONMENT");
  const branchPolicy = object(gate.deployment_branch_policy), protection = array(gate.protection_rules).map(object);
  const rules = protection.filter(r => r.type === "required_reviewers");
  const reviewers = array(rules[0]?.reviewers).map(object);
  if (gate.id !== approvedEnvironmentId || gate.name !== environment || gate.can_admins_bypass !== false ||
    branchPolicy.custom_branch_policies !== true || branchPolicy.protected_branches !== false ||
    protection.some(x => x.type !== "required_reviewers" && x.type !== "branch_policy") ||
    protection.filter(x => x.type === "branch_policy").length !== 1 ||
    rules.length !== 1 || rules[0].prevent_self_review !== false ||
    reviewers.length !== 1 || reviewers[0].type !== "User" || object(reviewers[0].reviewer).id !== ownerId) return failure("ENVIRONMENT");
  const policy = await get(route + "/deployment-branch-policies?per_page=10", "BRANCH_POLICY");
  const branches = array(policy.branch_policies).map(object);
  if (policy.total_count !== 1 || branches.length !== 1 || branches[0].name !== "main" ||
    branches[0].type !== "branch") return failure("BRANCH_POLICY");

  const source = async (path: string, sha: string) => yamlFile(await get("/contents/" + path + "?ref=" + sha, "WORKFLOW_CONTENTS"), path);
  const caller = await source(workflow, p.callerCommit);
  const callerJobs = object(caller.jobs);
  const callerInspect = object(callerJobs.inspect);
  if (!array(object(object(object(object(caller.on).workflow_dispatch).inputs).mode).options).includes("install-readback") ||
    callerInspect.uses !== repo + "/" + inspect + "@" + p.inspectReusableCommit ||
    object(callerJobs.runonce).uses !== repo + "/" + runOnce + "@" + p.runOnceReusableCommit ||
    object(callerJobs.management).uses !== repo + "/" + management + "@" + p.managementReusableCommit ||
    object(callerInspect.with).inspect_run !== "${{ inputs.mode == 'install-readback' && 'install-readback' || inputs.inspect_run }}") {
    return failure("CALLER_REUSABLE");
  }
  const reusable = await source(inspect, p.inspectReusableCommit);
  const readback = object(object(reusable.jobs)["bound-install-readback"]);
  const steps = array(readback.steps).map(object);
  const ownCheckout = steps.filter(s => typeof s.uses === "string" && s.uses.startsWith("actions/checkout@") &&
    object(s.with).repository === undefined);
  const launch = steps.filter(s => s.uses === "./.github/actions/first-open-launch");
  if (!Object.hasOwn(object(reusable.on), "workflow_call") || readback.environment !== environment || ownCheckout.length !== 1 ||
    ownCheckout[0].uses !== checkout || object(ownCheckout[0].with)["persist-credentials"] !== false ||
    object(ownCheckout[0].with).ref !== "${{ vars.TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT }}" ||
    launch.length !== 1 || steps.indexOf(ownCheckout[0]) >= steps.indexOf(launch[0]) ||
    object(launch[0].with).role !== "install-readback" ||
    object(launch[0].env).FIRST_OPEN_INSTALL_RUNTIME_COMMIT !== "${{ vars.TECHLONG_FIRST_OPEN_INSTALL_RUNTIME_COMMIT }}") return failure("REUSABLE_CHECKOUT");
  return Object.freeze({ mainSha: p.callerCommit, runtime: p.runtimeCommit, workflowId, environment,
    ownerReviewRequired: true as const, adminBypass: false as const });
}
