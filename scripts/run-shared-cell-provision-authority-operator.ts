import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  executeReviewedSharedCellProvisionAuthorityInstall,
  inspectSharedCellProvisionAuthorityCandidate,
  recoverReviewedSharedCellProvisionAuthorityInstall,
  type SharedCellProvisionAuthorityOperatorManifest,
} from "../lib/deployments/execution/shared-cell-provision-authority-operator.ts";
import type { AtomicSharedCellProvisionAuthorityPort } from "../lib/deployments/execution/shared-cell-provision-authority.ts";

type OperatorMode =
  | "LocalValidate"
  | "InspectCandidate"
  | "ExecuteInstall"
  | "Recover";
type AuthorityObserveInput = Parameters<
  AtomicSharedCellProvisionAuthorityPort["observe"]
>[0];
type AuthorityInstallInput = Parameters<
  AtomicSharedCellProvisionAuthorityPort["installIfAbsent"]
>[0];

interface ParsedArguments {
  mode: OperatorMode;
  profile?: string;
  manifestPath?: string;
  manifestSha256?: string;
  approvedCandidateItemSha256?: string;
  grantExpiresAt?: string;
  guardNonce?: string;
  confirmAccountId?: string;
  confirmRegion?: string;
  confirmStackName?: string;
  confirmAuthorityTableArn?: string;
  confirmAuthorityKey?: string;
  acknowledgeAwsWrite?: string;
  acknowledgeReviewedCandidate?: string;
  acknowledgeTemporaryGrantActive?: string;
  acknowledgeAbsentOnlyInstall?: string;
  acknowledgeLowCostNotFree?: string;
  confirmExecutionPhrase?: string;
}

const expectedAccountId = "402010193138";
const expectedRegion = "ca-central-1";
const expectedProfile = "techlong-sandbox-provisioner";
const expectedMfaDeviceArn =
  "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev";
const expectedStackName = "techlong-sandbox-cell-sandbox-1";
const expectedCellCloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
const expectedAuthorityTableArn =
  "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority";
const expectedAuthorityKey = "cell:cell-sandbox-1";
const expectedExecutionPhrase =
  "I_ACKNOWLEDGE_J5F_SHARED_CELL_PROVISION_AUTHORITY_INSTALL";
const guardEnvironmentVariable = "TECHLONG_J5F_OPERATOR_GUARD_NONCE";
const digestPattern = /^[a-f0-9]{64}$/;
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const canonicalUtcPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const minimumGrantRemainingMs = 2 * 60_000;
const maximumGrantRemainingMs = 60 * 60_000;
const maximumManifestBytes = 65_536;
const onlineOperationTimeoutMs = 120_000;

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    fail("Operator arguments must be explicit name/value pairs.");
  }
  const allowed = new Set([
    "--mode",
    "--profile",
    "--manifest-path",
    "--manifest-sha256",
    "--approved-candidate-item-sha256",
    "--grant-expires-at",
    "--guard-nonce",
    "--confirm-account-id",
    "--confirm-region",
    "--confirm-stack-name",
    "--confirm-authority-table-arn",
    "--confirm-authority-key",
    "--acknowledge-aws-write",
    "--acknowledge-reviewed-candidate",
    "--acknowledge-temporary-grant-active",
    "--acknowledge-absent-only-install",
    "--acknowledge-low-cost-not-free",
    "--confirm-execution-phrase",
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || values.has(name) || !value) {
      fail("Operator arguments contain an unknown, duplicate or empty value.");
    }
    values.set(name, value);
  }
  const mode = values.get("--mode");
  if (
    mode !== "LocalValidate" &&
    mode !== "InspectCandidate" &&
    mode !== "ExecuteInstall" &&
    mode !== "Recover"
  ) {
    fail("Operator mode is outside the reviewed allowlist.");
  }
  return {
    mode,
    profile: values.get("--profile"),
    manifestPath: values.get("--manifest-path"),
    manifestSha256: values.get("--manifest-sha256"),
    approvedCandidateItemSha256: values.get(
      "--approved-candidate-item-sha256",
    ),
    grantExpiresAt: values.get("--grant-expires-at"),
    guardNonce: values.get("--guard-nonce"),
    confirmAccountId: values.get("--confirm-account-id"),
    confirmRegion: values.get("--confirm-region"),
    confirmStackName: values.get("--confirm-stack-name"),
    confirmAuthorityTableArn: values.get("--confirm-authority-table-arn"),
    confirmAuthorityKey: values.get("--confirm-authority-key"),
    acknowledgeAwsWrite: values.get("--acknowledge-aws-write"),
    acknowledgeReviewedCandidate: values.get(
      "--acknowledge-reviewed-candidate",
    ),
    acknowledgeTemporaryGrantActive: values.get(
      "--acknowledge-temporary-grant-active",
    ),
    acknowledgeAbsentOnlyInstall: values.get(
      "--acknowledge-absent-only-install",
    ),
    acknowledgeLowCostNotFree: values.get(
      "--acknowledge-low-cost-not-free",
    ),
    confirmExecutionPhrase: values.get("--confirm-execution-phrase"),
  };
}

function assertNoOnlineArguments(input: ParsedArguments): void {
  if (
    input.profile !== undefined ||
    input.manifestPath !== undefined ||
    input.manifestSha256 !== undefined ||
    input.approvedCandidateItemSha256 !== undefined ||
    input.grantExpiresAt !== undefined ||
    input.guardNonce !== undefined ||
    input.confirmAccountId !== undefined ||
    input.confirmRegion !== undefined ||
    input.confirmStackName !== undefined ||
    input.confirmAuthorityTableArn !== undefined ||
    input.confirmAuthorityKey !== undefined ||
    input.acknowledgeAwsWrite !== undefined ||
    input.acknowledgeReviewedCandidate !== undefined ||
    input.acknowledgeTemporaryGrantActive !== undefined ||
    input.acknowledgeAbsentOnlyInstall !== undefined ||
    input.acknowledgeLowCostNotFree !== undefined ||
    input.confirmExecutionPhrase !== undefined
  ) {
    fail("LocalValidate does not accept online operation arguments.");
  }
}

function assertNoAwsEnvironmentOverrides(): void {
  const exactOverrides = new Set([
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
    "AWS_ROLE_ARN",
    "AWS_ROLE_SESSION_NAME",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
  ]);
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      (exactOverrides.has(name.toUpperCase()) ||
        /^AWS_ENDPOINT_URL(?:_|$)/i.test(name))
    ) {
      fail(`Refusing AWS access while override ${name} is set.`);
    }
  }
  if (process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS !== "true") {
    fail("The reviewed wrapper must force configured AWS endpoints to be ignored.");
  }
}

function assertOnlineGuard(input: ParsedArguments): void {
  if (input.profile !== expectedProfile) {
    fail(`Use only the reviewed AWS profile ${expectedProfile}.`);
  }
  const inheritedNonce = process.env[guardEnvironmentVariable];
  if (
    !input.guardNonce ||
    !digestPattern.test(input.guardNonce) ||
    inheritedNonce !== input.guardNonce
  ) {
    fail("The exact-profile PowerShell guard did not attest this online invocation.");
  }
  delete process.env[guardEnvironmentVariable];
  assertNoAwsEnvironmentOverrides();
}

function assertModeArguments(input: ParsedArguments): void {
  if (!input.manifestPath || !input.manifestSha256) {
    fail("Online modes require a reviewed manifest path and raw SHA-256.");
  }
  if (!digestPattern.test(input.manifestSha256)) {
    fail("Manifest SHA-256 must be lowercase hexadecimal.");
  }
  if (input.mode === "InspectCandidate") {
    if (
      input.approvedCandidateItemSha256 !== undefined ||
      input.grantExpiresAt !== undefined
    ) {
      fail("InspectCandidate does not accept a candidate approval or grant expiry.");
    }
    assertNoExecuteConfirmations(input);
    return;
  }
  if (!input.approvedCandidateItemSha256 || !digestPattern.test(input.approvedCandidateItemSha256)) {
    fail("ExecuteInstall and Recover require the reviewed candidate item SHA-256.");
  }
  if (input.mode === "Recover") {
    if (input.grantExpiresAt !== undefined) {
      fail("Recover is read-only and does not accept a grant expiry.");
    }
    assertNoExecuteConfirmations(input);
    return;
  }
  if (!input.grantExpiresAt) {
    fail("ExecuteInstall requires the exact temporary IAM grant expiry.");
  }
  if (
    input.confirmAccountId !== expectedAccountId ||
    input.confirmRegion !== expectedRegion ||
    input.confirmStackName !== expectedStackName ||
    input.confirmAuthorityTableArn !== expectedAuthorityTableArn ||
    input.confirmAuthorityKey !== expectedAuthorityKey ||
    input.acknowledgeAwsWrite !== "true" ||
    input.acknowledgeReviewedCandidate !== "true" ||
    input.acknowledgeTemporaryGrantActive !== "true" ||
    input.acknowledgeAbsentOnlyInstall !== "true" ||
    input.acknowledgeLowCostNotFree !== "true" ||
    input.confirmExecutionPhrase !== expectedExecutionPhrase
  ) {
    fail("ExecuteInstall requires every exact independent execution confirmation.");
  }
}

function assertNoExecuteConfirmations(input: ParsedArguments): void {
  if (
    input.confirmAccountId !== undefined ||
    input.confirmRegion !== undefined ||
    input.confirmStackName !== undefined ||
    input.confirmAuthorityTableArn !== undefined ||
    input.confirmAuthorityKey !== undefined ||
    input.acknowledgeAwsWrite !== undefined ||
    input.acknowledgeReviewedCandidate !== undefined ||
    input.acknowledgeTemporaryGrantActive !== undefined ||
    input.acknowledgeAbsentOnlyInstall !== undefined ||
    input.acknowledgeLowCostNotFree !== undefined ||
    input.confirmExecutionPhrase !== undefined
  ) {
    fail("Read-only modes reject every execution confirmation.");
  }
}

function assertGrantWindow(value: string, now: number): void {
  if (!canonicalUtcPattern.test(value)) {
    fail("Grant expiry must be canonical UTC with milliseconds.");
  }
  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !== value) {
    fail("Grant expiry is not a real canonical UTC instant.");
  }
  const remaining = expiresAt - now;
  if (
    remaining <= minimumGrantRemainingMs ||
    remaining > maximumGrantRemainingMs
  ) {
    fail("ExecuteInstall requires more than 2 and at most 60 minutes of grant time remaining.");
  }
}

async function readReviewedManifest(input: ParsedArguments): Promise<{
  manifest: SharedCellProvisionAuthorityOperatorManifest;
  expectedOwnerDeploymentId: string;
}> {
  const manifestPath = path.resolve(input.manifestPath as string);
  if (path.extname(manifestPath).toLowerCase() !== ".json") {
    fail("Operator manifest must be a JSON file.");
  }
  const bytes = await readFile(manifestPath);
  if (bytes.length === 0 || bytes.length > maximumManifestBytes) {
    fail("Operator manifest size is outside the reviewed bound.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== input.manifestSha256) {
    fail("Operator manifest raw SHA-256 differs from the reviewed digest.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Operator manifest is not valid JSON.");
  }
  const manifestRecord = record(parsed);
  if (
    !exactKeys(manifestRecord, ["binding", "coordinate", "environment", "stackInput"])
  ) {
    fail("Operator manifest has missing or unexpected top-level fields.");
  }
  const coordinate = record(manifestRecord.coordinate);
  if (
    !exactKeys(coordinate, ["epoch", "generation", "ownerDeploymentId"]) ||
    coordinate.generation !== 1 ||
    coordinate.epoch !== 1 ||
    typeof coordinate.ownerDeploymentId !== "string" ||
    !ownerPattern.test(coordinate.ownerDeploymentId)
  ) {
    fail("Operator manifest coordinate is outside the generation-one allowlist.");
  }
  return {
    manifest: parsed as SharedCellProvisionAuthorityOperatorManifest,
    expectedOwnerDeploymentId: coordinate.ownerDeploymentId,
  };
}

function boundedOnlineSignal(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = (signal: string) => {
    controller.abort(new Error(`Operator received ${signal}.`));
  };
  const onSigint = () => abort("SIGINT");
  const onSigterm = () => abort("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const timeout = setTimeout(
    () => abort("the 120-second online timeout"),
    onlineOperationTimeoutMs,
  );
  timeout.unref();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    },
  };
}

async function readHiddenMfaCode(
  mfaSerial: string,
  signal: AbortSignal,
): Promise<string> {
  if (mfaSerial !== expectedMfaDeviceArn) {
    fail("The AWS credential provider requested an unreviewed MFA device.");
  }
  if (
    !process.stdin.isTTY ||
    !process.stderr.isTTY ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    fail("Online modes require an interactive TTY for hidden MFA entry.");
  }
  signal.throwIfAborted();
  const input = process.stdin;
  const wasRaw = input.isRaw;
  const wasPaused = input.isPaused();
  process.stderr.write(`Enter MFA code for ${expectedMfaDeviceArn}: `);
  return await new Promise<string>((resolve, reject) => {
    let code = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      signal.removeEventListener("abort", onAbort);
      try {
        input.setRawMode(wasRaw);
      } catch {
        // The original error remains authoritative if terminal restoration fails.
      }
      if (wasPaused) input.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(code);
    };
    const onAbort = () =>
      finish(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("MFA entry was aborted."),
      );
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("MFA entry was canceled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          if (/^[0-9]{6}$/.test(code)) finish();
          else finish(new Error("MFA code must contain exactly six digits."));
          return;
        }
        if (character === "\u0008" || character === "\u007f") {
          code = code.slice(0, -1);
          continue;
        }
        if (!/^[0-9]$/.test(character) || code.length >= 6) {
          finish(new Error("MFA code must contain exactly six digits."));
          return;
        }
        code += character;
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    input.on("data", onData);
    try {
      input.setRawMode(true);
      input.resume();
    } catch {
      finish(new Error("Unable to enable hidden MFA entry on this TTY."));
    }
  });
}

function assertSafeSummary(
  value: unknown,
  phase: "INSPECTED" | "INSTALLED" | "RECOVERED",
  approvedCandidateItemSha256?: string,
): Record<string, unknown> {
  const summary = record(value);
  const expectedKeys = [
    "accountId",
    "candidateItemSha256",
    "cellExpiresAt",
    "cellId",
    "cloudFormationRoleArn",
    "evidenceObservedAt",
    "generation",
    "mutationPerformed",
    "ownerDeploymentId",
    "phase",
    "provisionEpoch",
    "provisionOperationHash",
    "recordHash",
    "region",
    "resourceInventorySha256",
    "revision",
    "schemaVersion",
    "stackId",
    "stackName",
    "stackStatus",
    "templateCanonicalSha256",
  ];
  if (
    !exactKeys(summary, expectedKeys) ||
    summary.schemaVersion !== 2 ||
    summary.cloudFormationRoleArn !== expectedCellCloudFormationRoleArn ||
    summary.phase !== phase ||
    summary.mutationPerformed !== (phase === "INSTALLED") ||
    !digestPattern.test(String(summary.candidateItemSha256 ?? "")) ||
    (approvedCandidateItemSha256 !== undefined &&
      summary.candidateItemSha256 !== approvedCandidateItemSha256)
  ) {
    fail("Operator core returned an unsafe or drifting summary.");
  }
  return summary;
}

async function main(): Promise<void> {
  const input = parseArguments(process.argv.slice(2));
  if (input.mode === "LocalValidate") {
    assertNoOnlineArguments(input);
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        phase: "LOCAL_VALIDATED",
        mutationPerformed: false,
        callsAws: false,
      })}\n`,
    );
    return;
  }

  assertOnlineGuard(input);
  assertModeArguments(input);
  if (input.mode === "ExecuteInstall") {
    assertGrantWindow(input.grantExpiresAt as string, Date.now());
  }
  const { manifest, expectedOwnerDeploymentId } =
    await readReviewedManifest(input);
  const bounded = boundedOnlineSignal();
  let summary: Record<string, unknown>;
  try {
    const { createAwsSdkSharedCellProvisionRuntime } = await import(
      "../lib/deployments/execution/aws-sdk-shared-cell-provision-runtime.ts"
    );
    const runtime = await createAwsSdkSharedCellProvisionRuntime({
      mfaCodeProvider: (serial) =>
        readHiddenMfaCode(serial, bounded.signal),
    });
    if (input.mode === "InspectCandidate") {
      summary = assertSafeSummary(
        await inspectSharedCellProvisionAuthorityCandidate({
          evidence: runtime.evidence,
          authority: runtime.authority,
          manifest,
          signal: bounded.signal,
        }),
        "INSPECTED",
      );
    } else if (input.mode === "Recover") {
      summary = assertSafeSummary(
        await recoverReviewedSharedCellProvisionAuthorityInstall({
          authority: runtime.authority,
          approvedCandidateItemSha256:
            input.approvedCandidateItemSha256 as string,
          expectedOwnerDeploymentId,
          signal: bounded.signal,
        }),
        "RECOVERED",
        input.approvedCandidateItemSha256,
      );
    } else {
      assertGrantWindow(input.grantExpiresAt as string, Date.now());
      const grantBoundAuthority: AtomicSharedCellProvisionAuthorityPort =
        Object.freeze({
          observe: (request: AuthorityObserveInput) =>
            runtime.authority.observe(request),
          installIfAbsent: (request: AuthorityInstallInput) => {
            assertGrantWindow(input.grantExpiresAt as string, Date.now());
            return runtime.authority.installIfAbsent(request);
          },
        });
      summary = assertSafeSummary(
        await executeReviewedSharedCellProvisionAuthorityInstall({
          evidence: runtime.evidence,
          authority: grantBoundAuthority,
          manifest,
          approvedCandidateItemSha256:
            input.approvedCandidateItemSha256 as string,
          signal: bounded.signal,
        }),
        "INSTALLED",
        input.approvedCandidateItemSha256,
      );
    }
  } finally {
    bounded.dispose();
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

try {
  await main();
} catch (error) {
  const details = record(error);
  const message =
    error instanceof Error
      ? error.message.replace(/[\r\n\t]+/g, " ").slice(0, 500)
      : "Shared Cell provision-authority operator failed.";
  process.stderr.write(
    `${JSON.stringify({
      status: "failed",
      code:
        typeof details.code === "string"
          ? details.code.slice(0, 100)
          : "J5F_OPERATOR_FAILED",
      retryable: details.retryable === true,
      message,
    })}\n`,
  );
  process.exitCode = 1;
}
