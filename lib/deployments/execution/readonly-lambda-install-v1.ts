import { canonicalJson, sha256Hex } from "./hash.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 } from "./readonly-runtime-iam-v1.ts";

const digest = /^[a-f0-9]{64}$/;
const roleIds = ["AROAV3GNMXTZLB4NZQLZY", "AROAV3GNMXTZPRETOTXTS"];
export const READONLY_LAMBDA_INSTALL_SCOPE_V1 = Object.freeze({
  logGroupsCreated: 2, logRetentionDays: 7, lambdaFunctionsCreated: 2, lambdaInvocationsMaximum: 2, installationWriteCallsMaximum: 6,
  memoryMb: 128, timeoutSeconds: 60, provisionedConcurrency: false, noVpcLayersExtensionsEnvironmentOrCustomerKms: true,
  probeCodeOnlyNotProductionDrainOrDelete: true, noIamSecretNeonAuthorityCellEcsScheduleWrites: true,
  ownSecretReadInLambdaMemoryOnly: true, databaseConnectionAllowed: false,
  noAutomaticDeleteCompensationResetFillOrWriteInvocationRetry: true,
  sourceFunctionAllowPathCurrentlyUnproved: true, absentCellDoesNotProveProductionCfResourceRead: true,
  iamChecksAreNotServiceSideCompareAndSwap: true, concurrentExternalInvocationsCannotBeExcludedByLocalSlot: true,
  permanentSlot: "techlong-f3b3-readonly-lambda-install-v1-consumed", runtimeEnabled: false, monthlyBudgetTargetUsd: 50,
});
export function readonlyLambdaTargetsV1(artifacts: { index: number; zipSha256: string; zipBytes: number }[]) {
  if (artifacts.length !== 2 || artifacts.some((a, i) => a.index !== i || !digest.test(a.zipSha256) || !Number.isSafeInteger(a.zipBytes) || a.zipBytes < 1 || a.zipBytes > 5_000_000)) throw new Error("PROBE_ARTIFACTS_INVALID");
  return READONLY_RUNTIME_IAM_TARGETS_V1.map((t, i) => ({
    index: i, functionName: t.functionName, functionArn: `arn:aws:lambda:ca-central-1:402010193138:function:${t.functionName}`,
    roleArn: `arn:aws:iam::402010193138:role/${t.role}`, roleId: roleIds[i], logGroup: `/aws/lambda/${t.functionName}`,
    runtime: "nodejs22.x", handler: "index.handler", architecture: "x86_64", memorySize: 128, timeout: 60,
    zipSha256: artifacts[i].zipSha256, zipBytes: artifacts[i].zipBytes,
  }));
}
export interface ReadonlyLambdaInventoryV1 {
  observedAt: number; foundationSha256: string;
  resources: { index: number; functionState: "ABSENT" | "OWN_READY" | "OTHER"; logState: "ABSENT" | "OWN_READY" | "OTHER" }[];
  sourcePermissions: { action: string; resource: string; decision: string }[];
}
export interface ReadonlyLambdaManifestV1 {
  schemaVersion: 1; protocol: "readonly-lambda-install-and-once-probe-v1";
  reviewedAt: number; expiresAt: number; codeSha256: string; artifactsDirectory: string; artifactReportFileSha256: string;
  targets: ReturnType<typeof readonlyLambdaTargetsV1>; foundationSha256: string;
  events: { schemaVersion: 1; action: "verify_readonly_runtime_v1"; nonce: string }[];
  scope: typeof READONLY_LAMBDA_INSTALL_SCOPE_V1; manifestSha256: string;
}
function fresh(at: number, now: number) { if (!Number.isSafeInteger(at) || at <= 0 || at > now || now - at > 30000) throw new Error("PROBE_INVENTORY_STALE"); }
function inventoryShape(r: ReadonlyLambdaInventoryV1) {
  if (!digest.test(r.foundationSha256) || r.resources.length !== 2 || r.resources.some((x, i) => x.index !== i ||
    !["ABSENT", "OWN_READY", "OTHER"].includes(x.functionState) || !["ABSENT", "OWN_READY", "OTHER"].includes(x.logState))) throw new Error("PROBE_INVENTORY_INVALID");
}
function absent(r: ReadonlyLambdaInventoryV1) { inventoryShape(r); if (r.resources.some(x => x.functionState !== "ABSENT" || x.logState !== "ABSENT")) throw new Error("PROBE_RESOURCES_PRESENT_INSPECT_ONLY"); }
function ready(r: ReadonlyLambdaInventoryV1, m: ReadonlyLambdaManifestV1) {
  inventoryShape(r); if (r.foundationSha256 !== m.foundationSha256 || r.resources.some(x => x.functionState !== "OWN_READY" || x.logState !== "OWN_READY")) throw new Error("PROBE_RESOURCES_NOT_READY_INSPECT_ONLY");
}
function validApproval(m: ReadonlyLambdaManifestV1, approvedSha: string, now: number) {
  if (approvedSha !== m.manifestSha256 || !Number.isSafeInteger(now) || now < m.reviewedAt || now >= m.expiresAt) throw new Error("PROBE_FRESH_APPROVAL_REQUIRED");
}
export async function compileReadonlyLambdaManifestV1(input: Omit<ReadonlyLambdaManifestV1, "schemaVersion" | "protocol" | "scope" | "expiresAt" | "foundationSha256" | "manifestSha256"> & { inventory: ReadonlyLambdaInventoryV1 }) {
  const { inventory, ...data } = input; absent(inventory); fresh(inventory.observedAt, input.reviewedAt);
  const body = { ...data, schemaVersion: 1 as const, protocol: "readonly-lambda-install-and-once-probe-v1" as const,
    expiresAt: input.reviewedAt + 3600000, foundationSha256: inventory.foundationSha256, scope: READONLY_LAMBDA_INSTALL_SCOPE_V1 };
  const m = { ...body, manifestSha256: await sha256Hex(body) }; await validateReadonlyLambdaManifestV1(m, input.codeSha256); return m;
}
export async function validateReadonlyLambdaManifestV1(m: ReadonlyLambdaManifestV1, codeSha256: string) {
  const { manifestSha256, ...body } = m;
  if (canonicalJson(Object.keys(m).sort()) !== canonicalJson(["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "artifactsDirectory", "artifactReportFileSha256", "targets", "foundationSha256", "events", "scope", "manifestSha256"].sort()) ||
    m.schemaVersion !== 1 || m.protocol !== "readonly-lambda-install-and-once-probe-v1" || m.codeSha256 !== codeSha256 || !digest.test(codeSha256) ||
    !digest.test(m.artifactReportFileSha256) || !digest.test(m.foundationSha256) || !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 ||
    m.expiresAt - m.reviewedAt !== 3600000 || m.events.length !== 2 || m.events.some(e => canonicalJson(Object.keys(e).sort()) !== canonicalJson(["action", "nonce", "schemaVersion"]) ||
      e.schemaVersion !== 1 || e.action !== "verify_readonly_runtime_v1" || !digest.test(e.nonce)) || m.events[0].nonce === m.events[1].nonce ||
    canonicalJson(m.targets) !== canonicalJson(readonlyLambdaTargetsV1(m.targets)) || canonicalJson(m.scope) !== canonicalJson(READONLY_LAMBDA_INSTALL_SCOPE_V1) ||
    !digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) throw new Error("PROBE_MANIFEST_INVALID");
}
export interface ReadonlyLambdaInstallPortsV1 {
  now(): number; inventory(approval: string): Promise<ReadonlyLambdaInventoryV1>;
  claimSlot(): Promise<void>; marker(name: string, data: unknown): Promise<void>;
  createLog(index: number, approval: string): Promise<void>; retainLog(index: number): Promise<void>;
  createFunction(index: number, approval: string): Promise<void>;
  waitAndInspect(approval: string): Promise<ReadonlyLambdaInventoryV1>;
  invokeOnce(index: number, event: ReadonlyLambdaManifestV1["events"][number]): Promise<unknown>;
}
export async function runReadonlyLambdaInstallV1(input: { manifest: ReadonlyLambdaManifestV1; approvedSha: string; codeSha256: string; ports: ReadonlyLambdaInstallPortsV1 }) {
  const m = structuredClone(input.manifest), p = input.ports; await validateReadonlyLambdaManifestV1(m, input.codeSha256); validApproval(m, input.approvedSha, p.now());
  let slotConsumed = false, installationCalls = 0, invocationCalls = 0, stage = "PREFLIGHT"; const probeReceipts: unknown[] = [];
  try {
    const r = await p.inventory(m.manifestSha256); absent(r); fresh(r.observedAt, p.now());
    if (r.foundationSha256 !== m.foundationSha256) throw new Error("PROBE_FOUNDATION_DRIFT");
    // Simulation is not an execution guarantee, but never consume the slot for a known denied request.
    if (r.sourcePermissions.length !== 14 || r.sourcePermissions.some(x => x.decision !== "allowed")) throw new Error("PROBE_SOURCE_PERMISSION_NOT_VERIFIED");
    validApproval(m, input.approvedSha, p.now()); await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    const attempt = async (label: string, index: number) => { stage = label; validApproval(m, input.approvedSha, p.now());
      await p.marker(`${label}-${index}-attempt.json`, { manifestSha256: m.manifestSha256, target: m.targets[index] }); validApproval(m, input.approvedSha, p.now()); };
    for (let i = 0; i < 2; i++) {
      await attempt("create-log", i); installationCalls++; await p.createLog(i, m.manifestSha256); await p.marker(`create-log-${i}-confirmed.json`, { confirmed: true });
      await attempt("retain-log", i); installationCalls++; await p.retainLog(i); await p.marker(`retain-log-${i}-confirmed.json`, { confirmed: true });
    }
    for (let i = 0; i < 2; i++) {
      await attempt("create-function", i); installationCalls++; await p.createFunction(i, m.manifestSha256); await p.marker(`create-function-${i}-confirmed.json`, { confirmed: true });
    }
    stage = "READONLY_INSTALL_INSPECT"; const installed = await p.waitAndInspect(m.manifestSha256); fresh(installed.observedAt, p.now()); ready(installed, m);
    for (let i = 0; i < 2; i++) {
      // A second fresh read before each invocation: no adoption of changed code/role/resources.
      const observed = await p.inventory(m.manifestSha256); fresh(observed.observedAt, p.now()); ready(observed, m);
      await attempt("invoke", i); invocationCalls++; const result = await p.invokeOnce(i, m.events[i]); probeReceipts.push(result);
      await p.marker(`invoke-${i}-response.json`, result);
    }
    return { outcome: "READONLY_LAMBDAS_AND_TWO_PROBES_SUBMITTED_REQUIRES_INSPECT", slotConsumed, installationCalls, invocationCalls, probeReceipts, failureStage: null, retryAuthorized: false, runtimeEnabled: false };
  } catch (error) {
    return { outcome: "READONLY_LAMBDA_STOPPED_INSPECT_ONLY", slotConsumed, installationCalls, invocationCalls, probeReceipts, failureStage: stage,
      failureCode: error instanceof Error && /^PROBE_[A-Z_]+$/.test(error.message) ? error.message : "PROBE_OPERATION_UNVERIFIED", retryAuthorized: false, runtimeEnabled: false };
  }
}

/** Raw provider output is never persisted. Only this closed, bounded response shape may enter a receipt. */
export function validateReadonlyProbeResponseV1(index: number, event: ReadonlyLambdaManifestV1["events"][number], raw: unknown) {
  const value = raw as { schemaVersion: number; functionArn: string; nonce: string; requestId: string; outcome: string;
    steps: { label: string; passed: boolean; observation?: string; errorCode?: string }[]; runtimeEnabled: boolean; databaseConnected: boolean; mutationPerformed: boolean };
  const expectedArn = `arn:aws:lambda:ca-central-1:402010193138:function:${READONLY_RUNTIME_IAM_TARGETS_V1[index]?.functionName}`;
  const keys = ["schemaVersion", "functionArn", "nonce", "requestId", "outcome", "steps", "runtimeEnabled", "databaseConnected", "mutationPerformed"];
  const labels = ["exact-runtime-identity", "exact-secret-awscurrent", ...(index === 0 ? ["atomic-authority", "intent-journal", "receipt-journal", "stack-list-first-page", "cell-describe", "cell-template", "cell-resources"] : ["provision-authority"])];
  const codes = ["AccessDeniedException", "AccessDenied", "ValidationException", "ValidationError", "ResourceNotFoundException", "TimeoutError", "AbortError", "ThrottlingException", "READONLY_PROBE_READ_NOT_VERIFIED"];
  if (!value || typeof value !== "object" || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys.sort()) ||
    value.schemaVersion !== 1 || value.functionArn !== expectedArn || value.nonce !== event.nonce ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.requestId) ||
    value.runtimeEnabled !== false || value.databaseConnected !== false || value.mutationPerformed !== false || !Array.isArray(value.steps) ||
    !["READONLY_PROBE_READS_VERIFIED", "READONLY_PROBE_READS_NOT_VERIFIED", "READONLY_PROBE_IDENTITY_NOT_VERIFIED"].includes(value.outcome)) throw new Error("PROBE_RESPONSE_NOT_VERIFIED");
  const identityFailed = value.outcome === "READONLY_PROBE_IDENTITY_NOT_VERIFIED";
  if (value.steps.length !== (identityFailed ? 1 : labels.length) || value.steps.some((step, i) => {
    if (!step || typeof step !== "object" || step.label !== labels[i] || typeof step.passed !== "boolean") return true;
    const names = step.passed ? (i < 2 ? ["label", "passed"] : ["label", "observation", "passed"]) : ["errorCode", "label", "passed"];
    return canonicalJson(Object.keys(step).sort()) !== canonicalJson(names.sort()) ||
      (step.passed && i >= 2 && !["ABSENT", "PRESENT", "TWO_KEYS_ABSENT", "RECORDS_PRESENT", "FIRST_PAGE_READ"].includes(step.observation ?? "")) ||
      (!step.passed && !codes.includes(step.errorCode ?? ""));
  }) || (identityFailed ? value.steps[0].passed : !value.steps[0].passed ||
    (value.outcome === "READONLY_PROBE_READS_VERIFIED") !== value.steps.every(s => s.passed))) throw new Error("PROBE_RESPONSE_NOT_VERIFIED");
  return structuredClone(value);
}
