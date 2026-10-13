import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAcceptancePrivateSources, validateAcceptanceCredentialBinding, type AcceptancePrivateMaterial } from "./single-tenant-private-sources.ts";
import { sha256Hex } from "./hash.ts";

function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function parsePrivateJson(bytes: string): unknown {
  try { return JSON.parse(bytes); } catch { fail("ACCEPTANCE_PRIVATE_JSON_REJECTED"); }
}

/** The expected summary fingerprint is a trusted review input, not a value
 * taken from the bundle being checked. Reads only local files/ACLs; no cloud,
 * database, token issuance or credentials-provider resolution in loading.
 */
export async function loadAcceptancePrivateSources(input: { directory: string; expectedSummarySha256: string }) {
  if (process.platform !== "win32" || !/^[a-f0-9]{64}$/.test(input.expectedSummarySha256)) fail("ACCEPTANCE_PRIVATE_LOADER_INPUT_REJECTED");
  const root = await realpath("F:/ChatGPT_workshop"), dir = path.resolve(input.directory);
  if (path.dirname(dir).toLowerCase() !== root.toLowerCase() || !/^techlong-d001-credentials-[a-z0-9-]+$/.test(path.basename(dir)) ||
    (await realpath(dir)).toLowerCase() !== dir.toLowerCase() || (await lstat(dir)).isSymbolicLink()) fail("ACCEPTANCE_PRIVATE_DIRECTORY_REJECTED");
  const names = ["summary.json", "binding.json", "private-material.json", "control-public-key.pem", "acl-proof.json"];
  for (const name of names) {
    const p = path.join(dir, name), stat = await lstat(p);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 100000 ||
      (await realpath(p)).toLowerCase() !== p.toLowerCase()) fail("ACCEPTANCE_PRIVATE_FILE_REJECTED");
  }
  // Read-only ACL inspection. No attempt to repair an insecure bundle or to
  // grant a sandbox principal access. Restricted primary-user execution is
  // intentional. Administrators/SYSTEM remain privileged, not excluded.
  const script = "$ErrorActionPreference='Stop'; $taskDir=$env:TECHLONG_CREDENTIAL_DIR; " +
    "$taskSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; " +
    "$taskNames=@('summary.json','binding.json','private-material.json','control-public-key.pem','acl-proof.json'); " +
    "$taskPaths=@($taskDir)+@($taskNames|ForEach-Object{Join-Path $taskDir $_}); " +
    "foreach($taskPath in $taskPaths){$taskAcl=Get-Acl -LiteralPath $taskPath; " +
    "if($taskPath -eq $taskDir -and -not $taskAcl.AreAccessRulesProtected){throw 'ACL inheritance is not protected'}; " +
    "$taskRules=@($taskAcl.Access); if($taskRules.Count -ne 2){throw 'Unexpected ACL rule count'}; " +
    "$taskPrincipals=@($taskRules|ForEach-Object{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); " +
    "if($taskPrincipals -notcontains $taskSid -or $taskPrincipals -notcontains 'S-1-5-18'){throw 'Unexpected ACL principal'}; " +
    "foreach($taskRule in $taskRules){if($taskRule.AccessControlType -ne 'Allow' -or $taskRule.FileSystemRights -ne 'FullControl'){throw 'Unexpected ACL rights'}}}; " +
    "@{verified=$true;files=5;primaryUser=$true}|ConvertTo-Json -Compress";
  let proof;
  const aclEnv = { ...process.env, TECHLONG_CREDENTIAL_DIR: dir };
  for (const name of Object.keys(aclEnv)) if (name.toLowerCase() === "psmodulepath") delete aclEnv[name as keyof typeof aclEnv];
  try { const r = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: aclEnv, windowsHide: true, timeout: 15000, maxBuffer: 16384 }); proof = JSON.parse(r.stdout); }
  catch { fail("ACCEPTANCE_PRIVATE_ACL_REJECTED"); }
  if (proof.verified !== true || proof.files !== 5 || proof.primaryUser !== true) fail("ACCEPTANCE_PRIVATE_ACL_REJECTED");
  const summaryBytes = await readFile(path.join(dir, "summary.json"), "utf8");
  if (await sha256Hex(summaryBytes) !== input.expectedSummarySha256) fail("ACCEPTANCE_PRIVATE_SUMMARY_DRIFT");
  const summary = parsePrivateJson(summaryBytes) as Record<string, unknown>;
  if (summary.protocol !== "d001-local-private-inputs" || summary.businessManifestSha256 !== "7b741e2278d93c23c1885d33df89469ec03012b6842766a39e95d69083d32afc" ||
    summary.businessIndependentReadOnlyVerified !== true || summary.runtimeEnabled !== false || (summary.localAcl as Record<string, unknown>)?.protected !== true ||
    (summary.localAcl as Record<string, unknown>)?.allowedPrincipals !== 2 || summary.awsWrites !== 0 || summary.databaseWrites !== 0) fail("ACCEPTANCE_PRIVATE_SUMMARY_REJECTED");
  const binding = await validateAcceptanceCredentialBinding(parsePrivateJson(await readFile(path.join(dir, "binding.json"), "utf8")) as Parameters<typeof validateAcceptanceCredentialBinding>[0]);
  if (await sha256Hex(binding) !== summary.bindingSha256 || await sha256Hex(binding.scope) !== summary.scopeSha256) fail("ACCEPTANCE_PRIVATE_BINDING_DRIFT");
  const raw = parsePrivateJson(await readFile(path.join(dir, "private-material.json"), "utf8"));
  const keys = ["signingPrivateKeyPem", "signingPublicKeyPem", "clientCertificatePem", "clientPrivateKeyPem", "clientCaPem", "stripeSecretKey", "stripeWebhookSecret", "stripePublishableKey"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(keys.sort()) || Object.values(raw).some(v => typeof v !== "string")) fail("ACCEPTANCE_PRIVATE_MATERIAL_REJECTED");
  const material = raw as AcceptancePrivateMaterial;
  if (await readFile(path.join(dir, "control-public-key.pem"), "utf8") !== material.signingPublicKeyPem) fail("ACCEPTANCE_PRIVATE_PUBLIC_KEY_DRIFT");
  const sources = await createAcceptancePrivateSources(binding, material);
  if (sources.summary.publicKeySha256 !== summary.publicKeySha256 || sources.summary.clientCertificateSha256 !== summary.clientCertificateSha256 ||
    sources.summary.clientCaSha256 !== summary.clientCaSha256) { sources.dispose(); fail("ACCEPTANCE_PRIVATE_FINGERPRINT_DRIFT"); }
  return Object.freeze({ binding, sources, summarySha256: input.expectedSummarySha256, aclVerified: true });
}
