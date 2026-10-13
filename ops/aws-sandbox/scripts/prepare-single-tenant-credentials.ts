import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseEnv } from "node:util";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { decodeBusinessBootstrap } from "../../../lib/deployments/execution/single-tenant-business-bootstrap.ts";
import { createAcceptancePrivateSources, type AcceptancePrivateMaterial } from "../../../lib/deployments/execution/single-tenant-private-sources.ts";
import { createBusinessNeonClient, inspectBusinessBootstrap } from "./single-tenant-business-neon.ts";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";

if (process.argv.length !== 4 || process.argv[2] !== "--out") throw Error("ACCEPTANCE_CREDENTIAL_PREPARE_ARGUMENTS_INVALID");
const root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[3]);
if (path.dirname(out).toLowerCase() !== root.toLowerCase() || !/^techlong-d001-credentials-[a-z0-9-]+$/.test(path.basename(out)) || process.platform !== "win32") throw Error("ACCEPTANCE_CREDENTIAL_PRIVATE_PATH_REQUIRED");
const readPrivate = async (name: string) => {
  const p = path.resolve(root, name);
  if ((await realpath(p)).toLowerCase() !== p.toLowerCase() || !p.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw Error("ACCEPTANCE_CREDENTIAL_SYMLINK_REJECTED");
  return readFile(p, "utf8");
};
const exec = promisify(execFile);
let directoryCreated = false;
try {
  const review = await decodeBusinessBootstrap(JSON.parse(await readPrivate("techlong-d001-business-review-20261013-r3/manifest.json")));
  const run = JSON.parse(await readPrivate("techlong-d001-business-run-20261013-7b741e22/run.json"));
  const owner = JSON.parse(await readPrivate("techlong-d001-owner-readonly-20261013-r1.json"));
  if (run.manifestSha256 !== review.manifestSha256 || run.outcome !== "BUSINESS_COMMITTED_REQUIRES_INDEPENDENT_INSPECT" || run.dmlInvocations !== 6) throw Error("ACCEPTANCE_CREDENTIAL_REAL_BUSINESS_REQUIRED");
  const db = await createBusinessNeonClient();
  let business;
  try { await db.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
    business = await inspectBusinessBootstrap(db.client, db.hostSha256, review, owner.suppliedEmail); await db.client.query("ROLLBACK"); }
  finally { await db.client.end(); }
  if (!Object.values(business.checks).every(Boolean)) throw Error("ACCEPTANCE_CREDENTIAL_BUSINESS_DRIFT");
  // New directory ONLY. Never alter inherited ACLs or bytes of the old root,
  // old certificate directory, .env, private CA or archived evidence.
  await mkdir(out); directoryCreated = true;
  const aclScript = "$ErrorActionPreference='Stop'; $taskCredentialPath=$env:TECHLONG_CREDENTIAL_DIR; " +
    "$taskIdentity=[System.Security.Principal.WindowsIdentity]::GetCurrent(); " +
    "$taskAcl=Get-Acl -LiteralPath $taskCredentialPath; $taskAcl.SetAccessRuleProtection($true,$false); " +
    "foreach($taskRule in @($taskAcl.Access)){[void]$taskAcl.RemoveAccessRuleSpecific($taskRule)}; " +
    "$taskFlags=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'; " +
    "$taskUserRule=[System.Security.AccessControl.FileSystemAccessRule]::new($taskIdentity.User,'FullControl',$taskFlags,'None','Allow'); " +
    "$taskSystem=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'); " +
    "$taskSystemRule=[System.Security.AccessControl.FileSystemAccessRule]::new($taskSystem,'FullControl',$taskFlags,'None','Allow'); " +
    "$taskAcl.SetAccessRule($taskUserRule); $taskAcl.SetAccessRule($taskSystemRule); Set-Acl -LiteralPath $taskCredentialPath -AclObject $taskAcl; " +
    "$taskAfter=Get-Acl -LiteralPath $taskCredentialPath; $taskSids=@($taskAfter.Access|ForEach-Object{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); " +
    "if(-not $taskAfter.AreAccessRulesProtected -or $taskSids.Count -ne 2 -or $taskSids -notcontains $taskIdentity.User.Value -or $taskSids -notcontains 'S-1-5-18'){throw 'Restricted ACL verification failed'}; " +
    "@{protected=$true;allowedPrincipals=2;ownerSid=$taskIdentity.User.Value}|ConvertTo-Json -Compress";
  // Do not pass PowerShell 7's module search path to Windows PowerShell 5.1:
  // it otherwise attempts to load incompatible Security/Utility modules.
  const aclEnv = { ...process.env, TECHLONG_CREDENTIAL_DIR: out };
  for (const name of Object.keys(aclEnv)) if (name.toLowerCase() === "psmodulepath") delete aclEnv[name as keyof typeof aclEnv];
  const acl = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", aclScript], {
    env: aclEnv, windowsHide: true, timeout: 15000, maxBuffer: 16384 });
  const aclProof = JSON.parse(acl.stdout);
  if (aclProof.protected !== true || aclProof.allowedPrincipals !== 2) throw Error("ACCEPTANCE_CREDENTIAL_ACL_UNVERIFIED");
  const materialRoot = "techlong-f3c2-materials-20261011-p3/";
  const clientCertificatePem = await readPrivate(`${materialRoot}client-cert.pem`), clientPrivateKeyPem = await readPrivate(`${materialRoot}client-key.pem`),
    clientCaPem = await readPrivate(`${materialRoot}ca-bundle.pem`);
  const backend = parseEnv(await readFile("E:/NodejsProject/SpeedFeast_Backend_main/.env", "utf8"));
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const material: AcceptancePrivateMaterial = { signingPrivateKeyPem: pair.privateKey, signingPublicKeyPem: pair.publicKey,
    clientCertificatePem, clientPrivateKeyPem, clientCaPem, stripeSecretKey: backend.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: backend.STRIPE_WEBHOOK_SECRET ?? "", stripePublishableKey: backend.STRIPE_PUBLISHABLE_KEY ?? "" };
  const m = review.material, binding = { scope: m.futureScope, workspaceId: m.seed.workspaceId, productId: m.productId, templateVersionId: m.templateVersionId, plan: m.plan };
  const sources = await createAcceptancePrivateSources(binding, material);
  const message = Buffer.from("Techlong D001 local signing-key pair check; not a bearer token.");
  if (!verify("RSA-SHA256", message, pair.publicKey, sign("RSA-SHA256", message, pair.privateKey))) throw Error("ACCEPTANCE_CREDENTIAL_RSA_CHECK_FAILED");
  const save = (name: string, value: string) => writeFile(path.join(out, name), value, { flag: "wx", flush: true, mode: 0o600 });
  await save("private-material.json", `${JSON.stringify(material, null, 2)}\n`);
  await save("binding.json", `${JSON.stringify(binding, null, 2)}\n`);
  await save("control-public-key.pem", pair.publicKey);
  const summary = { protocol: "d001-local-private-inputs", observedAt: new Date().toISOString(), businessManifestSha256: review.manifestSha256,
    bindingSha256: await sha256Hex(binding),
    businessIndependentReadOnlyVerified: true, ...sources.summary, localAcl: { protected: true, allowedPrincipals: 2 },
    publicKeySecretCreated: false, bearerTokensIssued: 0, controlHttpCalls: 0, awsSecretValueReads: 0, awsWrites: 0, databaseWrites: 0,
    oldMaterialsAclChanged: false, oldMaterialsInheritedAclRiskRemains: true, credentialFilesMayRequirePrimaryUserExecution: true };
  await save("summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  // SID stays private. Never print key material, Stripe values or hashes of
  // Stripe/webhook/private keys. Public-only key/certificate fingerprints.
  await save("acl-proof.json", `${JSON.stringify(aclProof, null, 2)}\n`);
  sources.dispose();
  process.stdout.write(`${JSON.stringify({ directory: out, ...summary, summaryFileSha256: await sha256Hex(`${JSON.stringify(summary, null, 2)}\n`) })}\n`);
} catch (e) {
  const text = e instanceof Error ? e.message : "ProviderError";
  const failureCode = /^ACCEPTANCE_[A-Z0-9_]+$/.test(text) ? text : e instanceof Error ? e.name : "ProviderError";
  process.stdout.write(`${JSON.stringify({ failureCode, directoryCreated, automaticRetry: false, awsWrites: 0, databaseWrites: 0, valuesPrinted: false })}\n`);
  process.exitCode = 2;
}
