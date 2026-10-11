import { canonicalJson, sha256Hex } from "./hash.ts";
export const SANDBOX_DNS_SCOPE_V1 = Object.freeze({
  accountId: "402010193138", certificateRegion: "ca-central-1", hostedZone: "sandbox.techlong.cloud",
  certificateDomains: Object.freeze(["sandbox.techlong.cloud", "*.sandbox.techlong.cloud"]), certificateExport: "DISABLED", certificateKey: "RSA_2048",
  maximumWrites: 4, newPublicHostedZones: 1, zoneTagWrites: 1, newPublicCertificates: 1, validationRecordCreateBatches: 1,
  validationRecordsMaximum: 2, validationRecordTtl: 300, validationAction: "CREATE",
  parentDnsAndExistingApiCertificateUnchanged: true, namecheapDelegationNotAuthorized: true,
  noIamSecretKeyDatabaseCellEcsLambdaOrScheduleWrites: true, noPrivateCaOrExportOrAliasRecord: true,
  hostedZoneBaseUsdPerMonth: .5, queriesAndOtherCostsExcluded: true, priceIsNotHardCap: true,
  partialFailureMayLeaveChargedResources: true, nonAtomicAndNoServiceSidePrestateCas: true,
  certificateDomainsPubliclyLogged: true, providerDnsValidationAndDelegationMayRemainPending: true,
  noAutomaticDeleteRollbackFillResetOrWriteRetry: true,
  permanentSlot: "techlong-f3c1-sandbox-dns-foundation-v1-consumed", monthlyBudgetTargetUsd: 50,
});
export interface SandboxDnsInventoryV1 { observedAt: number; anchorSha256: string; existingZones: number; existingSandboxCertificates: number; publicChildRecordsPresent: boolean; sourcePermissionsAllowed: boolean; }
export interface SandboxDnsManifestV1 {
  schemaVersion: 1; protocol: "sandbox-dns-foundation-v1"; reviewedAt: number; expiresAt: number;
  codeSha256: string; anchorSha256: string; scope: typeof SANDBOX_DNS_SCOPE_V1; manifestSha256: string;
}
export interface SandboxZoneV1 { id: string; name: string; callerReference: string; nameServers: string[]; }
export interface SandboxValidationRecordV1 { Name: string; Type: "CNAME"; TTL: 300; ResourceRecords: { Value: string }[]; }
const digest = /^[a-f0-9]{64}$/, equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const exact = (v: unknown, keys: string[]) => v !== null && typeof v === "object" && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort());
function fail(code: string): never { throw new Error(code); }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function fresh(i: SandboxDnsInventoryV1, now: number) { if (!digest.test(i.anchorSha256) || !Number.isSafeInteger(i.observedAt) || i.observedAt <= 0 || i.observedAt > now || now - i.observedAt > 30000) fail("SANDBOX_DNS_INVENTORY_STALE"); }
function absent(i: SandboxDnsInventoryV1) { if (i.existingZones !== 0 || i.existingSandboxCertificates !== 0 || i.publicChildRecordsPresent !== false) fail("SANDBOX_DNS_EXISTING_RESOURCE_REQUIRES_REVIEW"); }
export async function compileSandboxDnsManifestV1(i: SandboxDnsInventoryV1, now: number, codeSha256: string) {
  fresh(i, now); absent(i); if (!i.sourcePermissionsAllowed) fail("SANDBOX_DNS_SOURCE_PERMISSION_UNVERIFIED");
  const body = { schemaVersion: 1 as const, protocol: "sandbox-dns-foundation-v1" as const, reviewedAt: now, expiresAt: now + 3600000, codeSha256, anchorSha256: i.anchorSha256, scope: SANDBOX_DNS_SCOPE_V1 };
  const m = freeze({ ...body, manifestSha256: await sha256Hex(body) }); await validateSandboxDnsManifestV1(m, codeSha256); return m;
}
export async function validateSandboxDnsManifestV1(m: SandboxDnsManifestV1, codeSha256: string) {
  if (!exact(m, ["schemaVersion", "protocol", "reviewedAt", "expiresAt", "codeSha256", "anchorSha256", "scope", "manifestSha256"]) || m.schemaVersion !== 1 || m.protocol !== "sandbox-dns-foundation-v1" ||
    !Number.isSafeInteger(m.reviewedAt) || m.reviewedAt <= 0 || m.expiresAt - m.reviewedAt !== 3600000 || !digest.test(codeSha256) || m.codeSha256 !== codeSha256 || !digest.test(m.anchorSha256) || !equal(m.scope, SANDBOX_DNS_SCOPE_V1)) fail("SANDBOX_DNS_MANIFEST_INVALID");
  const { manifestSha256, ...body } = m; if (!digest.test(manifestSha256) || await sha256Hex(body) !== manifestSha256) fail("SANDBOX_DNS_MANIFEST_HASH_INVALID");
}
export function sandboxDnsTagsV1(m: SandboxDnsManifestV1) { return [{ Key: "ApprovalSha256", Value: m.manifestSha256 }, { Key: "Environment", Value: "aws-sandbox" }, { Key: "Project", Value: "Techlong" }, { Key: "Purpose", Value: "sandbox-dns-foundation-v1" }]; }
export function assertSandboxZoneV1(z: SandboxZoneV1, m: SandboxDnsManifestV1) {
  if (!exact(z, ["id", "name", "callerReference", "nameServers"]) || !/^Z[A-Z0-9]{1,40}$/.test(z.id) || z.name !== "sandbox.techlong.cloud." || z.callerReference !== `techlong-f3c1-${m.manifestSha256}` ||
    !Array.isArray(z.nameServers) || z.nameServers.length !== 4 || new Set(z.nameServers).size !== 4 || z.nameServers.some(n => !/^ns-[0-9]+\.awsdns-[0-9]+\.(com|net|org|co\.uk)$/.test(n))) fail("SANDBOX_DNS_NEW_ZONE_UNVERIFIED");
}
export function sandboxValidationRecordsV1(c: unknown, arn: string) {
  const cert = c as Record<string, unknown>;
  if (!/^arn:aws:acm:ca-central-1:402010193138:certificate\/[a-f0-9-]{36}$/.test(arn) || cert.CertificateArn !== arn || cert.DomainName !== "sandbox.techlong.cloud" || cert.Type !== "AMAZON_ISSUED" || cert.KeyAlgorithm !== "RSA-2048" ||
    !["PENDING_VALIDATION", "ISSUED"].includes(String(cert.Status)) || !Array.isArray(cert.SubjectAlternativeNames) || !equal([...cert.SubjectAlternativeNames].sort(), [...SANDBOX_DNS_SCOPE_V1.certificateDomains].sort()) ||
    (cert.Options as { Export?: string } | undefined)?.Export !== "DISABLED" || cert.CertificateAuthorityArn || !Array.isArray(cert.DomainValidationOptions) || cert.DomainValidationOptions.length !== 2) fail("SANDBOX_DNS_CERTIFICATE_UNVERIFIED");
  const records: SandboxValidationRecordV1[] = [], domains: string[] = [];
  for (const raw of cert.DomainValidationOptions) { const d = raw as Record<string, unknown>, r = d.ResourceRecord as Record<string, unknown> | undefined;
    if (!SANDBOX_DNS_SCOPE_V1.certificateDomains.includes(String(d.DomainName)) || d.ValidationMethod !== "DNS" || !r || r.Type !== "CNAME" || typeof r.Name !== "string" || typeof r.Value !== "string" ||
      !/^_[a-f0-9]{32,64}\.sandbox\.techlong\.cloud\.$/.test(r.Name) || !/^_[a-z0-9-]{8,128}\.(?:[a-z0-9-]{1,63}\.)?acm-validations\.aws\.$/.test(r.Value)) fail("SANDBOX_DNS_VALIDATION_RECORD_UNVERIFIED");
    domains.push(String(d.DomainName)); const record: SandboxValidationRecordV1 = { Name: r.Name, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: r.Value }] };
    const same = records.find(x => x.Name === record.Name); if (same && !equal(same, record)) fail("SANDBOX_DNS_VALIDATION_RECORD_CONFLICT"); if (!same) records.push(record);
  }
  if (!equal(domains.sort(), [...SANDBOX_DNS_SCOPE_V1.certificateDomains].sort()) || records.length < 1 || records.length > 2) fail("SANDBOX_DNS_VALIDATION_RECORD_UNVERIFIED"); return freeze(records.sort((a, b) => a.Name.localeCompare(b.Name)));
}
export interface SandboxDnsPortsV1 {
  now(): number; inventory(withPermissions: boolean, owned?: { zone: SandboxZoneV1; certificateArn: string | null }): Promise<SandboxDnsInventoryV1>;
  claimSlot(): Promise<void>; marker(name: string, value: unknown): Promise<void>;
  createZoneOnce(): Promise<SandboxZoneV1>; tagZoneOnce(zone: SandboxZoneV1): Promise<void>;
  requestCertificateOnce(zone: SandboxZoneV1): Promise<string>; readCertificateValidation(arn: string): Promise<unknown>;
  createValidationRecordsOnce(zone: SandboxZoneV1, arn: string, records: readonly SandboxValidationRecordV1[]): Promise<{ changeId: string }>;
}
export async function runSandboxDnsFoundationV1(raw: SandboxDnsManifestV1, approvedSha: string, codeSha256: string, p: SandboxDnsPortsV1) {
  const m = freeze(structuredClone(raw)); await validateSandboxDnsManifestV1(m, codeSha256);
  const approve = () => { const n = p.now(); if (approvedSha !== m.manifestSha256 || !Number.isSafeInteger(n) || n < m.reviewedAt || n + 5000 >= m.expiresAt) fail("SANDBOX_DNS_FRESH_APPROVAL_REQUIRED"); };
  let stage = "PREFLIGHT", slotConsumed = false, writes = 0, zone: SandboxZoneV1 | null = null, certificateArn: string | null = null, records: readonly SandboxValidationRecordV1[] | null = null;
  const before = async (permissions = false) => { const i = await p.inventory(permissions, zone ? { zone, certificateArn } : undefined); fresh(i, p.now());
    if (i.anchorSha256 !== m.anchorSha256 || (permissions && !i.sourcePermissionsAllowed) || i.existingZones !== (zone ? 1 : 0) || i.existingSandboxCertificates !== (certificateArn ? 1 : 0) || i.publicChildRecordsPresent) fail("SANDBOX_DNS_PRESTATE_DRIFT"); };
  const attempt = async (name: string) => { stage = name; await before(); approve(); await p.marker(`${name}-attempt.json`, { manifestSha256: m.manifestSha256, zoneId: zone?.id ?? null, certificateArn }); approve(); };
  try {
    approve(); await before(true); approve(); await p.claimSlot(); slotConsumed = true; await p.marker("approved-manifest.json", m);
    await attempt("create-zone"); writes++; zone = freeze(await p.createZoneOnce()); assertSandboxZoneV1(zone, m); await p.marker("zone-confirmed.json", zone);
    await attempt("tag-zone"); writes++; await p.tagZoneOnce(zone); await p.marker("zone-tags-confirmed.json", { zoneId: zone.id });
    await attempt("request-certificate"); writes++; certificateArn = await p.requestCertificateOnce(zone);
    if (!/^arn:aws:acm:ca-central-1:402010193138:certificate\/[a-f0-9-]{36}$/.test(certificateArn)) fail("SANDBOX_DNS_CERTIFICATE_RESPONSE_UNCERTAIN"); await p.marker("certificate-confirmed.json", { certificateArn });
    stage = "READONLY_CERTIFICATE_VALIDATION"; records = sandboxValidationRecordsV1(await p.readCertificateValidation(certificateArn), certificateArn);
    await attempt("create-validation-records"); await p.marker("validation-records-reviewed.json", records); approve(); writes++;
    const changed = await p.createValidationRecordsOnce(zone, certificateArn, records); if (!/^\/change\/C[A-Z0-9]{1,40}$/.test(changed.changeId)) fail("SANDBOX_DNS_RECORD_RESPONSE_UNCERTAIN"); await p.marker("validation-records-confirmed.json", changed);
    return { outcome: "SANDBOX_DNS_SUBMITTED_REQUIRES_INSPECT_AND_PARENT_DELEGATION", slotConsumed, writeAttempts: writes, zone, certificateArn, records, failureStage: null, failureCode: null,
      parentDelegationPerformed: false, paidCellCreated: false, retryAuthorized: false, runtimeEnabled: false };
  } catch (e) { return { outcome: "SANDBOX_DNS_STOPPED_INSPECT_ONLY", slotConsumed, writeAttempts: writes, zone, certificateArn, records, failureStage: stage,
    failureCode: e instanceof Error && /^SANDBOX_DNS_[A-Z_]+$/.test(e.message) ? e.message : "SANDBOX_DNS_RESULT_UNVERIFIED", parentDelegationPerformed: false, paidCellCreated: false, retryAuthorized: false, runtimeEnabled: false }; }
}
