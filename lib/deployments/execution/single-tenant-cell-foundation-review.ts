import { renderSingleTenantAcceptanceCell, type SingleTenantAcceptanceCellInput } from "../cloudformation/single-tenant-acceptance-cell.ts";
import type { AcceptanceCellCreateReceipt, AcceptanceCellOperationControl, AcceptanceCellSnapshot } from "./single-tenant-cell-operations.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { CellFoundationFacts } from "../../../ops/aws-sandbox/scripts/single-tenant-cell-live-readonly.ts";
import { ACCEPTANCE_CONTROL_INPUTS } from "./single-tenant-private-sources.ts";

export const CELL_FOUNDATION_RISKS = Object.freeze([
  "One public-key Secret and one 25-resource paid Cell are created non-atomically; failure may leave a chargeable Secret or partially created/rolled-back Cell.",
  "CloudFormation OnFailure=ROLLBACK and 45-minute timeout may DELETE newly created Cell resources on failure; this does not authorize an operator DeleteStack or deletion of old resources.",
  "Cell deletion policies are Delete, database deletion protection is off, backup retention is one day; later approved cleanup can permanently destroy this new Cell's data without a final snapshot.",
  "A three-hour ExpiresAt tag does not install a scheduler, stop charges or enforce the monthly 50 USD target. Sustained 1-ACU operation can exceed that target; estimates exclude variable usage and taxes.",
  "Source simulations are namespace/context checks, not real provider, service-linked-role, KMS key-policy, propagation or complete least-privilege execution proof. Concurrent changes are not cross-service CAS.",
  "The existing mTLS client private-key copy has inherited broad local ACLs. The new restricted copy does not erase the old exposure; no evidence of compromise, rotation or actual TLS handshake is asserted.",
  "One permanent foundation attempt and each API-entry subslot are never reset, overwritten, replayed, automatically completed, retried or compensated. Lost responses require independent inspection.",
  "The public-key Secret is not automatically deleted on Cell failure/cleanup. Source credentials may expire after slot consumption; preserve all evidence and inspect, never silently resume writes.",
  "No tenant, TaskDefinition/RunTask, IAM update, DNS record, Neon write, activation, job, runtime enablement or F3c9 operation is authorized by this review.",
]);
export interface CellFoundationPriceEstimate {
  priceFileSha256: string; observedAt: number; region: "ca-central-1"; currency: "USD";
  rates: { albHour: number; truststoreHour: number; lcuHour: number; ipv4Hour: number; acuHour: number; secretMonth: number; storageGbMonth: number; ioRequest: number };
}
export function estimateCellFoundationPrice(p: CellFoundationPriceEstimate) {
  if (!/^[a-f0-9]{64}$/.test(p.priceFileSha256) || p.region !== "ca-central-1" || p.currency !== "USD" ||
    Object.values(p.rates).some(v => !Number.isFinite(v) || v <= 0)) fail("CELL_FOUNDATION_PRICES_INVALID");
  const fixed = p.rates.albHour + p.rates.truststoreHour + 2 * p.rates.ipv4Hour;
  const active = fixed + p.rates.acuHour + p.rates.lcuHour;
  return { reviewedHours: 3, albPublicIpv4Assumption: 2, acuAssumption: 1, lcuAssumption: 1,
    activeInfrastructureHourlyUsd: active, threeHourInfrastructureUsageUsd: active * 3,
    continuouslyActive730HoursUsd: active * 730 + 2 * p.rates.secretMonth,
    pausedNoLcu730HoursUsd: fixed * 730 + 2 * p.rates.secretMonth,
    excludes: ["Aurora storage/I/O/backup", "CloudWatch logs", "API requests", "additional IPv4/LCU/traffic", "data transfer", "all existing account resources", "future Fargate/tenant", "tax"],
    budgetTargetUsd: 50, hardCap: false, feesContinueUntilActualCleanup: true };
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export async function cellFoundationStableFactsHash(f: CellFoundationFacts) { return sha256Hex({ ...f, observedAt: 0 }); }
export async function prepareCellFoundationReview(input: {
  cellInput: SingleTenantAcceptanceCellInput; facts: CellFoundationFacts; businessInspect: { observedAt: string; checks: Record<string, boolean>; outcome: string };
  prices: CellFoundationPriceEstimate; codeBindingSha256: string;
}, now = Date.now()) {
  const v = structuredClone(input), f = v.facts;
  if (!/^[a-f0-9]{64}$/.test(v.codeBindingSha256) || !Number.isSafeInteger(now) || f.observedAt > now || now - f.observedAt > 60000 ||
    Object.values(f.roleChecks).length !== 10 || Object.values(f.collisionChecks).length !== 7 || Object.values(f.prerequisites).length !== 5 || f.simulations.length !== 5 ||
    ![...Object.values(f.roleChecks), ...Object.values(f.collisionChecks), ...Object.values(f.prerequisites), ...f.simulations.map(s => s.allowed)].every(Boolean) || !f.checksPassed ||
    f.identity.account !== "402010193138" || f.identity.arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" || f.identity.userId !== "AIDAV3GNMXTZEO7SHLC2X" ||
    v.businessInspect.outcome !== "BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL" || Object.keys(v.businessInspect.checks).length !== 13 || !Object.values(v.businessInspect.checks).every(Boolean) ||
    !Number.isSafeInteger(Date.parse(v.businessInspect.observedAt)) || Date.parse(v.businessInspect.observedAt) > now || now - Date.parse(v.businessInspect.observedAt) > 60000 ||
    v.cellInput.requestedAt > now || now - v.cellInput.requestedAt > 60000 || v.prices.observedAt > now || now - v.prices.observedAt > 86400000)
    fail("CELL_FOUNDATION_FRESH_REAL_PRECONDITIONS_REQUIRED");
  if (v.cellInput.certificateArn !== "arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d" ||
    v.cellInput.controlTrustStoreArn !== "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44" ||
    canonicalJson(v.cellInput.availabilityZones) !== canonicalJson(["ca-central-1a", "ca-central-1b"])) fail("CELL_FOUNDATION_EXISTING_TLS_OR_ZONES_DRIFT");
  const draft = await renderSingleTenantAcceptanceCell(v.cellInput), estimate = estimateCellFoundationPrice(v.prices);
  const body = { schemaVersion: 1 as const, protocol: "d001-cell-foundation-create" as const, reviewedAt: now, expiresAt: now + 3600000,
    ...v, factsSha256: await cellFoundationStableFactsHash(f), templateSha256: draft.templateSha256,
    publicKeySecret: { name: ACCEPTANCE_CONTROL_INPUTS.publicKeySecretName, publicKeySha256: "72f953b9f3dab5269a7a1c08fa7acf684d2d9c379ae446b50e3d8294404f02a2",
      keyId: "acceptance-72f953b9f3dab5269a7a1c08", defaultAwsManagedKms: true },
    scope: { maximumDirectCreateApiCalls: 2, publicKeySecretCreates: 1, cellCreates: 1, cellTemplateResources: 25,
      cloudFormationRollbackAllowed: true, timeoutMinutes: 45, operatorDeletes: 0, iamWrites: 0, databaseWrites: 0, runtimeEnabled: false },
    cellDeadline: draft.reviewDeadline, estimate, risks: CELL_FOUNDATION_RISKS };
  return freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export type CellFoundationReview = Awaited<ReturnType<typeof prepareCellFoundationReview>>;
export async function decodeCellFoundationReview(raw: unknown) {
  const r = raw as CellFoundationReview;
  if (!r || r.schemaVersion !== 1 || r.protocol !== "d001-cell-foundation-create") fail("CELL_FOUNDATION_MANIFEST_INVALID");
  const expected = await prepareCellFoundationReview({ cellInput: r.cellInput, facts: r.facts, businessInspect: r.businessInspect,
    prices: r.prices, codeBindingSha256: r.codeBindingSha256 }, r.reviewedAt);
  if (canonicalJson(expected) !== canonicalJson(r)) fail("CELL_FOUNDATION_MANIFEST_DRIFT");
  return expected;
}
export function assertCellFoundationApproval(r: CellFoundationReview, sha: string, code: string, now: number) {
  if (sha !== r.manifestSha256 || code !== r.codeBindingSha256 || now < r.reviewedAt || now >= r.expiresAt ||
    Date.parse(r.cellDeadline) <= now + 60 * 60_000) fail("CELL_FOUNDATION_FRESH_EXACT_APPROVAL_REQUIRED");
}
export interface CellFoundationJournal {
  consumeCell(data: Record<string, unknown>): Promise<void>;
  captureCell(receipt: AcceptanceCellCreateReceipt): Promise<void>;
}
/** Concrete freshness/actual-read guard for the pre-tenant foundation only.
 * Cleanup approval is a distinct exact snapshot SHA; no create SHA can delete.
 */
export function createCellFoundationOperationControl(input: {
  review: CellFoundationReview; approvedSha256: string; currentCodeBindingSha256: string; now?: () => number;
  readFacts(signal: AbortSignal): Promise<CellFoundationFacts>;
  verifyPublicKeySecret(signal: AbortSignal): Promise<void>;
  verifyBusinessUnstarted(signal: AbortSignal): Promise<void>;
  journal: CellFoundationJournal;
}): AcceptanceCellOperationControl {
  const now = input.now ?? Date.now, r = input.review;
  const approval = () => assertCellFoundationApproval(r, input.approvedSha256, input.currentCodeBindingSha256, now());
  return Object.freeze<AcceptanceCellOperationControl>({
    async beforeCreate({ draft, reviewSha256, signal }) {
      signal.throwIfAborted(); approval();
      if (reviewSha256 !== r.manifestSha256 || draft.templateSha256 !== r.templateSha256 || canonicalJson(draft.parameters) !== canonicalJson((await renderSingleTenantAcceptanceCell(r.cellInput)).parameters))
        fail("CELL_FOUNDATION_DRAFT_DRIFT");
      await input.verifyPublicKeySecret(signal); await input.verifyBusinessUnstarted(signal);
      const facts = structuredClone(await input.readFacts(signal)); signal.throwIfAborted(); approval();
      if (facts.collisionChecks.publicKeySecretAbsent !== false) fail("CELL_FOUNDATION_CREATED_PUBLIC_KEY_MISSING");
      // Independently verified created public-key Secret is the only allowed
      // change from pre-create facts. Never relax stack/physical name checks.
      facts.collisionChecks.publicKeySecretAbsent = true; facts.checksPassed = true;
      if (now() - facts.observedAt > 30000 || facts.observedAt > now() || await cellFoundationStableFactsHash(facts) !== r.factsSha256)
        fail("CELL_FOUNDATION_ACTUAL_PRECONDITION_DRIFT");
    },
    async beforeDelete() { fail("CELL_FOUNDATION_CREATE_APPROVAL_CANNOT_DELETE"); },
    async consume({ action, reviewSha256, target, clientRequestToken }) {
      approval();
      if (action !== "create" || reviewSha256 !== r.manifestSha256 || target !== "techlong-sandbox-cell-sandbox-1" || clientRequestToken !== `accept-cell-${r.manifestSha256}`)
        fail("CELL_FOUNDATION_WRONG_SLOT_TARGET");
      await input.journal.consumeCell({ reviewSha256, target, clientRequestToken, consumedAt: now() });
    },
    captureCreated: receipt => input.journal.captureCell(receipt),
  });
}
/** Separate pre-tenant exact UUID cleanup review. Never installed silently by
 * a creation approval. All later workload/DB cleanup requires its own verifier.
 */
export async function prepareUnstartedCellCleanupReview(receipt: AcceptanceCellCreateReceipt, snapshot: AcceptanceCellSnapshot,
  proof: { observedAt: number; noDeploymentOrJob: boolean; noTenantGeneration: boolean; noEcsServicesOrTasks: boolean; permissionsAllowed: boolean }, codeBindingSha256: string, now = Date.now()) {
  if (snapshot.stackId !== receipt.stackId || snapshot.templateSha256 !== receipt.templateSha256 || !Object.values({
    noDeploymentOrJob: proof.noDeploymentOrJob, noTenantGeneration: proof.noTenantGeneration, noEcsServicesOrTasks: proof.noEcsServicesOrTasks, permissionsAllowed: proof.permissionsAllowed }).every(Boolean) ||
    proof.observedAt > now || now - proof.observedAt > 30000 || !/^[a-f0-9]{64}$/.test(codeBindingSha256)) fail("CELL_FOUNDATION_CLEANUP_UNPROVED");
  const body = { protocol: "d001-unstarted-cell-exact-cleanup" as const, receipt, snapshot, proof, codeBindingSha256, reviewedAt: now, expiresAt: now + 3600000,
    scope: { deleteStackCalls: 1, exactStackId: receipt.stackId, deletePublicKeySecret: false, noFinalDatabaseSnapshot: true, forceDelete: false, resetOrRetry: false }, risks: CELL_FOUNDATION_RISKS };
  return freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export function createUnstartedCellCleanupControl(input: {
  review: Awaited<ReturnType<typeof prepareUnstartedCellCleanupReview>>; approvedSha256: string; currentCodeBindingSha256: string; now?: () => number;
  verifyStillUnstarted(signal: AbortSignal): Promise<void>; consume(data: Record<string, unknown>): Promise<void>;
}): AcceptanceCellOperationControl {
  const r = input.review, now = input.now ?? Date.now;
  const approve = () => { if (input.approvedSha256 !== r.manifestSha256 || input.currentCodeBindingSha256 !== r.codeBindingSha256 || now() < r.reviewedAt || now() >= r.expiresAt)
    fail("CELL_FOUNDATION_CLEANUP_FRESH_APPROVAL_REQUIRED"); };
  return Object.freeze<AcceptanceCellOperationControl>({ beforeCreate: async () => fail("CELL_FOUNDATION_CLEANUP_CANNOT_CREATE"), captureCreated: async () => fail("CELL_FOUNDATION_CLEANUP_CANNOT_CAPTURE"),
    async beforeDelete({ receipt, snapshot, reviewSha256, signal }) { approve(); signal.throwIfAborted();
      if (reviewSha256 !== r.manifestSha256 || canonicalJson(receipt) !== canonicalJson(r.receipt) || canonicalJson(snapshot) !== canonicalJson(r.snapshot)) fail("CELL_FOUNDATION_CLEANUP_UUID_DRIFT");
      await input.verifyStillUnstarted(signal); signal.throwIfAborted(); approve(); },
    async consume({ action, reviewSha256, target, clientRequestToken }) { approve();
      if (action !== "delete" || reviewSha256 !== r.manifestSha256 || target !== r.receipt.stackId || clientRequestToken !== `accept-cleanup-${r.manifestSha256}`) fail("CELL_FOUNDATION_CLEANUP_SLOT_DRIFT");
      await input.consume({ target, reviewSha256, clientRequestToken, consumedAt: now() }); },
  });
}
