import { execFile } from "node:child_process";
import { devNull } from "node:os";
import { STSClient, AssumeRoleWithWebIdentityCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { S3Client } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";
import { PostgresReleaseRepository } from "../../lib/deployments/releases/repository.ts";
import { ReleaseCloudFormationAdapter, ReleaseEvidenceAdapter } from "../../lib/deployments/releases/adapters.ts";
import type { ReleaseEnvironmentConfig, ReleaseJobContext, ReleaseSecretReference } from "../../lib/deployments/releases/handoff.ts";
import type { ReleaseMetadataApi } from "../../lib/deployments/releases/sampling.ts";

export interface ReleaseCredentials { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiresAt: number }

export function releaseChildEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", ...Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "TZ"].filter(k => parent[k] !== undefined).map(k => [k, parent[k]])) };
}

export async function requireHumanReview(job: ReleaseJobContext, config: ReleaseEnvironmentConfig, token: string, fetcher: typeof fetch = fetch) {
  if (!token) throw new Error("RELEASE_GITHUB_REVIEW_TOKEN_MISSING");
  const response = await fetcher(`https://api.github.com/repos/${job.repository}/actions/runs/${job.runId}/approvals`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
  });
  if (!response.ok) throw new Error("RELEASE_GITHUB_REVIEW_UNAVAILABLE");
  const reviews = await response.json() as { state: string; user: { id: number; type: string }; environments: { id: number; name: string }[] }[];
  const relevant = reviews.filter(r => r.environments.some(e => e.id === config.environmentId && e.name === config.environmentName));
  if (relevant.length !== 1 || relevant[0].state !== "approved" || relevant[0].user.id !== config.reviewerId || relevant[0].user.type !== "User") {
    throw new Error("RELEASE_HUMAN_APPROVAL_REQUIRED");
  }
}

export async function assumeReleaseIdentity(job: ReleaseJobContext, config: ReleaseEnvironmentConfig,
  purpose: "planner" | "executor" | "verifier" | "publisher", environment: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch,
  createClient = (region: string) => new STSClient({ region, maxAttempts: 1, endpoint: `https://sts.${region}.amazonaws.com` })): Promise<ReleaseCredentials> {
  const url = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
  if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com") || !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error("RELEASE_OIDC_UNAVAILABLE");
  url.searchParams.set("audience", "sts.amazonaws.com");
  const response = await fetcher(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!response.ok) throw new Error("RELEASE_OIDC_UNAVAILABLE");
  const token = (await response.json() as { value: string }).value;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (claims.aud !== "sts.amazonaws.com" || claims.repository_id !== job.repositoryId || claims.run_id !== job.runId ||
    String(claims.run_attempt) !== "1" || claims.sha !== job.sourceSha || claims.ref !== job.ref || claims.event_name !== job.event ||
    claims.workflow_ref !== job.workflowRef || claims.actor !== job.actor ||
    claims.sub !== (purpose === "planner" ? config.prepareSubject : config.deploySubject)) throw new Error("RELEASE_OIDC_BINDING_REJECTED");
  // STS validates the JWT signature and installed trust policy; decoding above is NOT signature verification.
  const client = createClient(config.region);
  try {
    const result = await client.send(new AssumeRoleWithWebIdentityCommand({
      RoleArn: purpose === "planner" ? config.prepareRoleArn : purpose === "executor" ? config.executionRoleArn : purpose === "publisher" ? config.promotion?.roleArn : config.inspectionRoleArn,
      RoleSessionName: `release-${job.runId}-${purpose}`, WebIdentityToken: token, DurationSeconds: 3600,
    }));
    const c = result.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration || c.Expiration.getTime() <= Date.now() + 300_000) throw new Error("RELEASE_CREDENTIALS_UNAVAILABLE");
    return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiresAt: c.Expiration.getTime() };
  } catch { throw new Error("RELEASE_CREDENTIALS_UNAVAILABLE"); } finally { client.destroy(); }
}

export function assertReleaseIdentity(identity: { Account?: string; Arn?: string }, config: ReleaseEnvironmentConfig, purpose: "planner" | "executor" | "verifier" | "publisher") {
  const role = purpose === "planner" ? config.prepareRoleArn : purpose === "executor" ? config.executionRoleArn : purpose === "publisher" ? config.promotion?.roleArn : config.inspectionRoleArn;
  if (!role) throw new Error("RELEASE_PROMOTION_NOT_ACTIVATED");
  if (identity.Account !== config.accountId || !identity.Arn?.startsWith(`arn:aws:sts::${config.accountId}:assumed-role/${role.split("/").at(-1)}/`)) {
    throw new Error("RELEASE_ACCOUNT_OR_ROLE_MISMATCH");
  }
}

export function releaseDatabaseUrl(reference: ReleaseSecretReference, value: { ARN?: string; VersionId?: string; SecretString?: string }) {
  if (value.ARN !== reference.arn || value.VersionId !== reference.versionId || !value.SecretString || value.SecretString.length > 32768) throw new Error("RELEASE_DATABASE_SECRET_REJECTED");
  const connectionString = (JSON.parse(value.SecretString) as { connectionString: string }).connectionString;
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") ||
    decodeURIComponent(url.username) !== reference.username || !url.password) throw new Error("RELEASE_DATABASE_SECRET_REJECTED");
  return connectionString;
}

export async function releaseRepository(config: ReleaseEnvironmentConfig, purpose: "planner" | "executor" | "verifier" | "publisher", credentials: ReleaseCredentials) {
  const reference = purpose === "publisher" ? config.promotion?.database : config.database[purpose];
  if (!reference) throw new Error("RELEASE_PROMOTION_NOT_ACTIVATED");
  if (credentials.expiresAt <= Date.now()) throw new Error("RELEASE_CREDENTIALS_EXPIRED");
  const sts = new STSClient({ region: config.region, credentials, maxAttempts: 1, endpoint: `https://sts.${config.region}.amazonaws.com` });
  const secrets = new SecretsManagerClient({ region: config.region, credentials, maxAttempts: 1, endpoint: `https://secretsmanager.${config.region}.amazonaws.com` });
  try {
    assertReleaseIdentity(await sts.send(new GetCallerIdentityCommand({})), config, purpose);
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: reference.arn, VersionId: reference.versionId }));
    const connectionString = releaseDatabaseUrl(reference, value);
    const sql = neon(connectionString, { fullResults: true });
    return new PostgresReleaseRepository({ query: async (statement, values) => {
      const result = await sql.query(statement, values, { fullResults: true, fetchOptions: { signal: AbortSignal.timeout(30_000) } });
      return result as unknown as { rows: { result: unknown }[] };
    } });
  } catch { throw new Error("RELEASE_DATABASE_IDENTITY_UNAVAILABLE"); } finally { sts.destroy(); secrets.destroy(); }
}

const reads: Record<string, string[]> = {
  cloudformation: ["describe-stacks", "get-template", "list-stack-resources", "list-change-sets", "describe-change-set"],
  ecs: ["describe-services", "describe-task-definition", "list-tasks", "describe-tasks"],
  elbv2: ["describe-listeners", "describe-load-balancers", "describe-target-groups", "describe-target-health", "describe-rules"],
  rds: ["describe-db-clusters", "describe-db-instances"], secretsmanager: ["describe-secret"],
  ecr: ["batch-get-image"], route53: ["list-resource-record-sets"], s3api: ["head-bucket"],
};

export type ReleaseAwsCommand = (args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
const awsCommand: ReleaseAwsCommand = (args, env) => new Promise((resolve, reject) => {
  execFile("aws", args, { env, shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 1_048_576 }, (error, stdout) => {
    if (error) reject(new Error("RELEASE_METADATA_REQUEST_FAILED")); else resolve(stdout);
  });
});

/** CLI is used only for the fixed read APIs not already exposed by existing write SDK adapters.
 * Each snapshot gets a fresh bounded counter. No credentials/config files or write verbs are accepted. */
export function releaseMetadataApi(config: ReleaseEnvironmentConfig, credentials: ReleaseCredentials,
  command: ReleaseAwsCommand = awsCommand, fetcher: typeof fetch = fetch, parent: NodeJS.ProcessEnv = process.env): ReleaseMetadataApi {
  let used = 0, technical = 0;
  return { read: async <T>(service: string, operation: string, input: Record<string, unknown>) => {
    if (!reads[service]?.includes(operation) || ++used > config.maxMetadataCallsPerSnapshot || credentials.expiresAt <= Date.now()) throw new Error("RELEASE_METADATA_SCOPE_OR_BUDGET_REJECTED");
    const env = { ...releaseChildEnvironment(parent), AWS_ACCESS_KEY_ID: credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      AWS_SESSION_TOKEN: credentials.sessionToken, AWS_MAX_ATTEMPTS: "1", AWS_EC2_METADATA_DISABLED: "true", AWS_PAGER: "",
      AWS_CONFIG_FILE: devNull, AWS_SHARED_CREDENTIALS_FILE: devNull };
    const body = await command([service, operation, "--region", config.region, "--cli-input-json", JSON.stringify(input), "--output", "json", "--no-paginate"], env);
    return (body.trim() ? JSON.parse(body) : {}) as T;
  }, getTechnical: async (path, origin) => {
    const url = new URL(origin);
    if (++technical > 2 || !["/health", "/ready"].includes(path) || url.protocol !== "https:" || url.username || url.password ||
      !url.hostname.endsWith(".sandbox.techlong.cloud") || url.pathname !== "/" || url.search || url.hash || url.port) throw new Error("RELEASE_TECHNICAL_PATH_REJECTED");
    const response = await fetcher(new URL(path, url), { method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000) });
    await response.body?.cancel();
    return { status: response.status, tlsVerified: true, checkedAt: Date.now() };
  } };
}

export function releaseCloud(config: ReleaseEnvironmentConfig, credentials: ReleaseCredentials) {
  const cfn = new CloudFormationClient({ region: config.region, credentials, maxAttempts: 1, endpoint: `https://cloudformation.${config.region}.amazonaws.com` });
  return { cloud: new ReleaseCloudFormationAdapter(cfn), destroy: () => cfn.destroy() };
}
export function releaseEvidence(config: ReleaseEnvironmentConfig, credentials: ReleaseCredentials) {
  const s3 = new S3Client({ region: config.region, credentials, maxAttempts: 1, endpoint: `https://s3.${config.region}.amazonaws.com` });
  return { evidence: new ReleaseEvidenceAdapter(s3, config.evidence), destroy: () => s3.destroy() };
}
