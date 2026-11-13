import type { ReleaseSqlClient, ReleaseInspection, StoredReleaseRequest } from "../lib/deployments/releases/repository.ts";
import type { ImageUpdatePlan, InstanceBinding, SoftwareRelease } from "../lib/deployments/releases/contract.ts";

/** Serialized in-memory CONTRACT model of the SQL port, not a PostgreSQL emulator.
 * Native row locks/ACL/DDL must still be verified before the separately approved installation. */
export class MemoryReleaseSql implements ReleaseSqlClient {
  now = 2000;
  calls: string[] = [];
  loseNextResponse = false;
  failBefore: string | null = null;
  loseOn: string | null = null;
  states = new Map<string, { revision: number; current: string; active: string | null }>();
  contexts = new Map<string, { binding: InstanceBinding; releases: SoftwareRelease[] }>();
  requests = new Map<string, { row: StoredReleaseRequest; plan: ImageUpdatePlan | null; text: string;
    token?: string; operations: Map<string, { phase: string; sha: string }>; proof?: ReleaseInspection }>();

  client(role: "planner" | "executor" | "verifier"): ReleaseSqlClient {
    const permissions = { planner: ["prepare_request", "record_decision"],
      executor: ["claim_request", "record_operation", "complete_request", "stop_request"], verifier: ["record_inspection"] };
    return { query: (statement, values) => {
      const fn = /^select deployment_release\.([a-z_]+)\(/.exec(statement)?.[1] ?? "";
      if (!["read_context", "read_request", ...permissions[role]].includes(fn)) throw new Error("synthetic role denied");
      return this.query(statement, values);
    } };
  }

  async query(statement: string, values: unknown[]) {
    this.calls.push(statement);
    const fn = /^select deployment_release\.([a-z_]+)\(/.exec(statement)?.[1];
    if (fn === this.failBefore) throw new Error("secret-canary-before-statement");
    const [id, token, kind, phase, sha, ref] = values as string[];
    let result: unknown;
    const require = (condition: unknown) => { if (!condition) throw new Error("synthetic constraint violation"); };
    if (fn === "read_context") {
      const context = this.contexts.get(id), state = this.states.get(id);
      const current = context?.releases.find(r => r.id === state?.current);
      result = context && state && current ? { ...context, binding: { ...context.binding, stateRevision: state.revision,
        currentRelease: { id: current.id, manifestDigest: current.image.manifestDigest, platformDigest: current.image.platformDigest } },
        activeRequestId: state.active } : null;
    } else if (fn === "record_decision") {
      const decision = JSON.parse(id), key = decision.selection.requestId, state = this.states.get(decision.selection.instanceId);
      const old = this.requests.get(key);
      if (old) { require(old.text === id && old.row.planSha256 === token); result = old.row; }
      else {
        require(state && !state.active && state.revision === decision.expectedStateRevision && state.current === decision.currentReleaseId);
        const row: StoredReleaseRequest = { requestId: key, planSha256: token, status: decision.status, reason: decision.reason,
          runId: null, runAttempt: null, plan: null, decision, operations: {}, inspection: null };
        this.requests.set(key, { row, plan: null, text: id, operations: new Map() }); result = row;
      }
    } else if (fn === "prepare_request") {
      const plan = JSON.parse(id) as ImageUpdatePlan, key = plan.selection.requestId;
      const old = this.requests.get(key);
      if (old) { require(old.text === id && old.row.planSha256 === token); result = old.row; }
      else {
        const state = this.states.get(plan.selection.instanceId);
        require(state && !state.active && state.revision === plan.expectedStateRevision &&
          state.current === plan.from.releaseId && this.now < plan.writeBefore);
        const row: StoredReleaseRequest = { requestId: key, planSha256: token, status: "AWAITING_APPROVAL", runId: null, runAttempt: null,
          plan, operations: {}, inspection: null };
        this.requests.set(key, { row, plan, text: id, operations: new Map() }); result = row;
      }
    } else if (fn === "read_request") result = this.requests.get(id)?.row ?? null;
    else {
      const r = this.requests.get(id); require(r);
      const request = r!; require(request.plan);
      const p = request.plan!, state = this.states.get(p.selection.instanceId)!;
      if (fn === "claim_request") {
        require(request.row.status === "AWAITING_APPROVAL" && !state.active && request.row.planSha256 === token &&
          state.revision === p.expectedStateRevision && state.current === p.from.releaseId && this.now < p.writeBefore);
        state.active = id; request.token = values[4] as string;
        request.row = { ...request.row, status: "CLAIMED", runId: kind, runAttempt: values[3] as number };
      } else if (fn === "record_operation") {
        require(state.active === id && request.token === token && !["SUCCEEDED", "RECONCILIATION_REQUIRED"].includes(request.row.status));
        const old = request.operations.get(kind);
        if (phase === "INTENT") {
          require(!old && request.row.status === (kind === "create" ? "CLAIMED" : "CHANGE_SET_CREATED") && this.now < p.writeBefore);
          request.row.status = kind === "create" ? "CLAIMED" : "EXECUTING";
        } else {
          require(old?.phase === "INTENT" && old.sha === sha && (phase === "UNKNOWN" || ref));
          request.row.status = phase === "UNKNOWN" ? "RECONCILIATION_REQUIRED" : kind === "create" ? "CHANGE_SET_CREATED" : "VERIFYING";
        }
        request.operations.set(kind, { phase, sha });
        request.row.operations[kind as "create" | "execute"] = {
          phase: phase as "INTENT" | "ACK" | "UNKNOWN", actionSha256: sha, providerReference: ref ?? null };
      } else if (fn === "record_inspection") {
        const proof = JSON.parse(token) as ReleaseInspection;
        const expected = proof.result === "FAILED_ROLLED_BACK_VERIFIED" ? p.from : p.to;
        require(state.active === id && request.row.status === "VERIFYING" && !request.proof &&
          proof.requestId === id && proof.planSha256 === request.row.planSha256 && proof.runId === request.row.runId &&
          proof.runAttempt === request.row.runAttempt && proof.stackId === p.changeSet.StackName &&
          proof.changeSetId === request.row.operations.create?.providerReference && proof.observedAt >= p.preparedAt &&
          /^[a-f0-9]{64}$/.test(proof.runtimeSha256) &&
          ["SUCCEEDED", "FAILED_ROLLED_BACK_VERIFIED", "FAILED_NEEDS_INSPECTION"].includes(proof.result) &&
          (proof.result === "FAILED_NEEDS_INSPECTION" || proof.releaseId === expected.releaseId && proof.imageUri === expected.imageUri &&
            proof.platformDigest === expected.platformDigest && proof.templateSha256 === p.templateSha256 &&
            proof.configurationSha256 === p.configurationSha256) && proof.evidence.versionId !== "null");
        request.proof = proof;
        request.row.inspection = proof;
      } else if (fn === "complete_request") {
        require(state.active === id && request.token === token && request.row.status === "VERIFYING" && request.proof &&
          state.revision === p.expectedStateRevision && state.current === p.from.releaseId);
        if (request.proof!.result === "SUCCEEDED") state.current = p.to.releaseId;
        if (request.proof!.result !== "FAILED_NEEDS_INSPECTION") { state.revision++; state.active = null; }
        request.row.status = request.proof!.result;
      } else if (fn === "stop_request") {
        const expiredBeforeClaim = request.row.status === "AWAITING_APPROVAL" && kind === "EXPIRED" && !state.active && this.now >= p.writeBefore;
        require(expiredBeforeClaim || state.active === id && request.token === token && ["CLAIMED", "CHANGE_SET_CREATED", "EXECUTING", "VERIFYING"].includes(request.row.status));
        const retained = ["FAILED_NEEDS_INSPECTION", "RECONCILIATION_REQUIRED"].includes(kind);
        require(retained || !request.operations.has("execute") && !["INTENT", "UNKNOWN"].includes(request.operations.get("create")?.phase ?? ""));
        request.row.status = kind as StoredReleaseRequest["status"]; request.row.reason = phase;
        if (!retained) state.active = null;
      } else throw new Error("unexpected SQL function");
      result = request.row;
    }
    if (this.loseNextResponse || this.loseOn === fn) {
      this.loseNextResponse = false; this.loseOn = null; throw new Error("secret-canary-response-lost-after-commit");
    }
    return { rows: [{ result: structuredClone(result) }] };
  }
}
