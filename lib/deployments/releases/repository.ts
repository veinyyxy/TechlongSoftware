import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import type { ImageUpdatePlan, InstanceBinding, ReleaseRequestStatus, ReleaseSelection, SoftwareRelease } from "./contract.ts";
import type { StoredReleaseCandidate, ReleasePromotionIntent } from "./promotion.ts";

export interface ReleaseEvidenceReference {
  bucket: string;
  key: string;
  versionId: string;
  sha256: string;
}

/** Supplied by the separately authenticated inspector, never by the deployer's completion call. */
export interface ReleaseInspection {
  requestId: string;
  planSha256: string;
  runId: string;
  runAttempt: number;
  stackId: string;
  releaseId: string;
  imageUri: string;
  platformDigest: string;
  templateSha256: string;
  configurationSha256: string;
  result: "SUCCEEDED" | "FAILED_ROLLED_BACK_VERIFIED" | "FAILED_NEEDS_INSPECTION";
  changeSetId: string;
  serviceArn: string;
  taskDefinitionArn: string;
  observedAt: number;
  runtimeSha256: string;
  evidence: ReleaseEvidenceReference;
}

export interface ReleaseDecision {
  schema: "techlong/instance-release-decision/v1";
  selection: ReleaseSelection;
  status: "NO_CHANGE" | "BLOCKED" | "BLOCKED_RESTORE_REQUIRED";
  reason: string;
  expectedStateRevision: number;
  currentReleaseId: string;
}

export type ReleaseStopStatus = "BLOCKED" | "BLOCKED_RESTORE_REQUIRED" | "EXPIRED" |
  "REJECTED_CHANGE_SET" | "FAILED_NEEDS_INSPECTION" | "RECONCILIATION_REQUIRED";

export interface StoredReleaseRequest {
  requestId: string;
  status: ReleaseRequestStatus;
  planSha256: string;
  runId: string | null;
  runAttempt: number | null;
  plan: ImageUpdatePlan | null;
  decision?: ReleaseDecision | null;
  reason?: string | null;
  operations: Partial<Record<"create" | "execute", {
    phase: "INTENT" | "ACK" | "UNKNOWN";
    actionSha256: string;
    providerReference: string | null;
  }>>;
  inspection: ReleaseInspection | null;
}

export interface ReleaseClaim {
  requestId: string;
  token: string;
}

export interface ReleaseSqlClient {
  /** Exactly one statement, no automatic query/transaction replay on connection failure. */
  query(statement: string, values: unknown[]): Promise<{ rows: { result: unknown }[] }>;
}

export class ReleasePersistenceUnknown extends Error {
  constructor() { super("RELEASE_PERSISTENCE_REQUIRES_READBACK"); }
}

export class ReleaseRequestRejected extends Error {}

/** No default DB client, connection string, credential loading, retry, or cloud calls. */
export class PostgresReleaseRepository {
  private readonly sql: ReleaseSqlClient;
  constructor(sql: ReleaseSqlClient) { this.sql = sql; }

  private async call<T>(statement: string, values: unknown[], mutation = false): Promise<T> {
    try {
      const response = await this.sql.query(statement, values);
      if (response.rows.length !== 1) throw new Error("RELEASE_RESULT_MISSING");
      return response.rows[0].result as T;
    } catch (error) {
      // Our PL/pgSQL business exceptions abort the statement. Preserve only the authored code,
      // not DETAIL, SQL text or provider diagnostics; this is a known rejection, not a lost ACK.
      if (error && typeof error === "object" && "code" in error && error.code === "P0001" &&
        "message" in error && typeof error.message === "string" && /^RELEASE_[A-Z_]+$/.test(error.message)) {
        throw new ReleaseRequestRejected(error.message);
      }
      // Even an error response may follow a committed function call. Do not disclose raw DB errors
      // (which can contain parameters), reconnect, retry, or automatically release the instance lock.
      if (mutation) throw new ReleasePersistenceUnknown();
      throw new Error("RELEASE_READ_FAILED");
    }
  }

  context(instanceId: string): Promise<{ binding: InstanceBinding; releases: SoftwareRelease[]; activeRequestId: string | null } | null> {
    return this.call("select deployment_release.read_context($1::text) as result", [instanceId]);
  }

  candidate(id: string): Promise<StoredReleaseCandidate | null> {
    return this.call("select deployment_release.read_candidate($1::text) as result", [id]);
  }

  confirmPromotion(candidateSha: string, release: SoftwareRelease): Promise<SoftwareRelease> {
    return this.call("select deployment_release.confirm_promotion($1::text,$2::text) as result", [candidateSha, canonicalJson(release)], true);
  }

  preparePromoted(plan: ImageUpdatePlan, sha: string, intent: ReleasePromotionIntent): Promise<StoredReleaseRequest> {
    return this.call("select deployment_release.prepare_promoted_request($1::text,$2::text,$3::text,$4::text) as result",
      [canonicalJson(plan), sha, canonicalJson(intent), canonicalJson(intent.job)], true);
  }

  request(requestId: string): Promise<StoredReleaseRequest | null> {
    return this.call("select deployment_release.read_request($1::text) as result", [requestId]);
  }

  async prepare(plan: ImageUpdatePlan, planSha256: string): Promise<StoredReleaseRequest> {
    if (await sha256Hex(plan) !== planSha256) throw new Error("RELEASE_PLAN_HASH_MISMATCH");
    return this.call("select deployment_release.prepare_request($1::text,$2::text) as result",
      [canonicalJson(plan), planSha256], true);
  }

  async recordDecision(decision: ReleaseDecision): Promise<StoredReleaseRequest> {
    return this.call("select deployment_release.record_decision($1::text,$2::text) as result",
      [canonicalJson(decision), await sha256Hex(decision)], true);
  }

  claim(plan: ImageUpdatePlan, planSha256: string, runId: string, runAttempt: number, token: string): Promise<StoredReleaseRequest> {
    return this.call("select deployment_release.claim_request($1::text,$2::text,$3::text,$4::integer,$5::text) as result",
      [plan.selection.requestId, planSha256, runId, runAttempt, token], true);
  }

  operation(claim: ReleaseClaim, kind: "create" | "execute", phase: "INTENT" | "ACK" | "UNKNOWN",
    actionSha256: string, providerReference: string | null = null): Promise<StoredReleaseRequest> {
    return this.call("select deployment_release.record_operation($1::text,$2::text,$3::text,$4::text,$5::text,$6::text) as result",
      [claim.requestId, claim.token, kind, phase, actionSha256, providerReference], true);
  }

  recordInspection(inspection: ReleaseInspection): Promise<StoredReleaseRequest> {
    return this.call("select deployment_release.record_inspection($1::text,$2::jsonb) as result",
      [inspection.requestId, canonicalJson(inspection)], true);
  }

  complete(claim: ReleaseClaim): Promise<StoredReleaseRequest> {
    return this.call("select deployment_release.complete_request($1::text,$2::text) as result",
      [claim.requestId, claim.token], true);
  }

  stop(claim: ReleaseClaim, status: ReleaseStopStatus, reason: string): Promise<StoredReleaseRequest> {
    return this.call("select deployment_release.stop_request($1::text,$2::text,$3::text,$4::text) as result",
      [claim.requestId, claim.token, status, reason], true);
  }
}
