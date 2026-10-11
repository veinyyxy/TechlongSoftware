import { compileFastTrackF3Readiness, type F3ReadOnlyEvidence, type F3RegionalPrices } from "./fast-track-f3-readiness.ts";
export const PUBLISHED_F3_IMAGES_V1 = Object.freeze([
  { kind: "app", digest: "sha256:2af648ae122dad46dcba313481797a49766744c4de167d33642dba124908df07", tag: "app-sha19cc3e096df4d37be0a6570ce3116d47c472ace2-r37702693753-a1" },
  { kind: "lifecycle", digest: "sha256:2ab7017dcebd64083e7804001685272a3a5461faa4b7a4bec37adab059980bb4", tag: "lifecycle-sha19cc3e096df4d37be0a6570ce3116d47c472ace2-r37702693753-a1" },
]);
/** Review-only: installed candidates and an image digest never grant paid execution. */
export function compileCellLaunchReadinessV1(evidence: F3ReadOnlyEvidence, prices: F3RegionalPrices,
  scans: { kind: string; digest: string; status: string; high: number; critical: number }[], businessInstallationEvidenceVerified: boolean) {
  const historic = compileFastTrackF3Readiness(evidence, prices, false);
  const read = (label: string) => { const matches = evidence.reads.filter(r => r.label === label); return matches.length === 1 && matches[0].readSucceeded ? matches[0].data : undefined; };
  const images = (read("EcrImages") as { imageDetails?: { registryId: string; repositoryName: string; imageDigest: string; imageTags?: string[] }[] } | undefined)?.imageDetails;
  const imageProof = PUBLISHED_F3_IMAGES_V1.every(p => images?.some(i => i.registryId === "402010193138" && i.repositoryName === "techlong-sandbox-speedfeast" && i.imageDigest === p.digest && i.imageTags?.includes(p.tag)) &&
    scans.filter(s => s.kind === p.kind).length === 1 && scans.some(s => s.kind === p.kind && s.digest === p.digest && s.status === "COMPLETE" && s.high === 0 && s.critical === 0));
  const gateCodes = ["SOURCE_IDENTITY", "AURORA_16_14_SERVERLESS", "CELL_ABSENT", "ADMISSION_READ_CAPACITY", "SANDBOX_WILDCARD_CERTIFICATE", "CONTROL_MTLS_TRUSTSTORE", "DNS_AUTOMATION", "PREPARED_TASK_IAM", "BUDGET_50_USD", "COST_ALLOCATION_TAG", "REQUIRED_SERVICE_LINKED_ROLES", "BASELINE_APPROVED_AND_INSTALLED", "ACTIVATION_AND_CELL_AUTHORITY", "LIVE_ENDPOINT_LEASE_AND_CLEANUP"];
  const gates = historic.gates.filter(g => gateCodes.includes(g.code));
  gates.push({ code: "PUBLISHED_IMAGES_AND_EXISTING_SCAN", status: imageProof ? "pass" : "unverified", detail: "Exact published digest/tag and existing COMPLETE scan without HIGH/CRITICAL; not a new scan or container/provider execution proof." },
    { code: "BUSINESS_CANDIDATES_INSTALLED", status: businessInstallationEvidenceVerified ? "pass" : "unverified", detail: "Independent installation metadata evidence only. Runtime Invoke, cross-reader live permission and cleanup authority remain unproved." },
    { code: "EXECUTABLE_V3_CLEANUP_AND_COMPENSATION", status: "blocked", detail: "TTL journal/delete grant, real provision/zero evidence, exact authority, bounded scheduling and failed-create compensation are not installed or live-accepted." },
    { code: "LEGACY_CELL_TEMPLATE_TTL_INCOMPATIBLE", status: "blocked", detail: "Existing renderer emits schema1 delete_shared_cell_stack to the PLAN_ONLY Janitor, ENABLED schedule and 10 retries. Do not apply it as v3 cleanup." });
  return { schemaVersion: 1, protocol: "cell-launch-readiness-v1", outcome: "CELL_PAID_EXECUTION_BLOCKED_FOUNDATION_REVIEW_ONLY", gates,
    blockers: gates.filter(g => g.status !== "pass").map(g => g.code), deploymentAuthorized: false, runtimeEnabled: false, cloudMutationPerformed: false,
    rates: historic.rates, estimate: historic.estimate, dnsFoundation: { zone: "sandbox.techlong.cloud", certificateNames: ["sandbox.techlong.cloud", "*.sandbox.techlong.cloud"], hostedZoneBaseUsdPerMonth: .5,
      nonExportableIntegratedAcmCertificateUsd: 0, parentNsMustBeDelegatedSeparately: true, rootDomainAndApiCertificatePreserved: true, approvalRequired: true },
    proposedOrder: ["sandbox_dns_and_nonexportable_acm", "manual_subdomain_ns_delegation_then_readonly_issuance", "baseline_and_mtls_material_foundation",
      "dedicated_lifecycle_permissions_read_cap_and_budget_review", "v3_cleanup_compatible_template_and_precise_stack_arn_fencing", "separately_approved_short_ttl_cell_and_single_tenant_acceptance"], monthlyBudgetTargetUsd: 50 };
}
