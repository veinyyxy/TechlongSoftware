import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { CellDrainCoordinatorError } from "./prepared-cell-drain-coordinator.ts";

export function cellCleanupInvocationSignal(context: unknown, name: string) {
  const value = context as { functionName?: unknown; invokedFunctionArn?: unknown; getRemainingTimeInMillis?: () => number } | null;
  if (value?.functionName !== name || value.invokedFunctionArn !== `arn:aws:lambda:ca-central-1:402010193138:function:${name}` ||
    typeof value.getRemainingTimeInMillis !== "function") throw new CellDrainCoordinatorError("CELL_CLEANUP_LAMBDA_CONTEXT_INVALID");
  const remaining = value.getRemainingTimeInMillis();
  if (!Number.isSafeInteger(remaining) || remaining < 5_000 || remaining > 900_000) throw new CellDrainCoordinatorError("CELL_CLEANUP_LAMBDA_DEADLINE_INVALID");
  return AbortSignal.timeout(remaining - 1_000);
}
type CleanupRole = "TechlongSandboxCellDrainCoordinatorRole" | "TechlongSandboxCellJanitorExecutionRole" | "TechlongSandboxCellTtlExecutorRole";
async function loadBoundCellCleanupDatabaseUrl(role: CleanupRole, signal: AbortSignal) {
  const secretArn = process.env.CELL_CLEANUP_CONTROL_SECRET_ARN;
  const basename = role === "TechlongSandboxCellDrainCoordinatorRole" ? "cell-drain-control" : "cell-cleanup-readonly";
  const username = role === "TechlongSandboxCellDrainCoordinatorRole" ? "techlong_cell_drain" : "techlong_cell_cleanup_reader";
  if (!secretArn || !new RegExp(`^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/${basename}-[A-Za-z0-9]{6}$`).test(secretArn))
    throw new CellDrainCoordinatorError("CELL_CLEANUP_SECRET_BINDING_MISSING");
  const config = { region: "ca-central-1", ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
  const credentials = defaultProvider({ clientConfig: config });
  const sts = new STSClient({ ...config, credentials });
  const secrets = new SecretsManagerClient({ ...config, credentials });
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal });
    if (identity.Account !== "402010193138" || typeof identity.Arn !== "string" ||
      !new RegExp(`^arn:aws:sts::402010193138:assumed-role/${role}/[A-Za-z0-9+=,.@_-]{2,64}$`).test(identity.Arn)) throw new Error("caller mismatch");
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn, VersionStage: "AWSCURRENT" }), { abortSignal: signal });
    if (value.ARN !== secretArn || !value.VersionStages?.includes("AWSCURRENT") || typeof value.SecretString !== "string" || value.SecretString.length > 8192) throw new Error("secret mismatch");
    const decoded = JSON.parse(value.SecretString) as { databaseUrl?: unknown };
    if (!decoded || Object.keys(decoded).join(",") !== "databaseUrl" || typeof decoded.databaseUrl !== "string" || decoded.databaseUrl.length > 4096) throw new Error("shape mismatch");
    const url = new URL(decoded.databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") || decodeURIComponent(url.username) !== username || !url.password ||
      (url.port && url.port !== "5432") || !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) throw new Error("endpoint mismatch");
    signal.throwIfAborted();
    return decoded.databaseUrl;
  } catch { throw new CellDrainCoordinatorError("CELL_CLEANUP_IDENTITY_OR_SECRET_REJECTED"); }
}
export function loadCellCleanupDatabaseUrl(role: "TechlongSandboxCellDrainCoordinatorRole" | "TechlongSandboxCellJanitorExecutionRole", signal: AbortSignal) {
  // Runtime callers cannot broaden this legacy API by passing a cast role.
  if (!["TechlongSandboxCellDrainCoordinatorRole", "TechlongSandboxCellJanitorExecutionRole"].includes(role))
    throw new CellDrainCoordinatorError("CELL_CLEANUP_IDENTITY_OR_SECRET_REJECTED");
  return loadBoundCellCleanupDatabaseUrl(role, signal);
}
/** Dedicated entry: the role is a code constant, never caller/environment input. */
export function loadDedicatedCellTtlDatabaseUrlV2(signal: AbortSignal) {
  return loadBoundCellCleanupDatabaseUrl("TechlongSandboxCellTtlExecutorRole", signal);
}
