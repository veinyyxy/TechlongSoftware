import { readFile, stat, writeFile } from "node:fs/promises";
import { compileSharedCellAuthorCompensationIamReview, inspectSharedCellAuthorCompensationIamReview } from "../../../lib/deployments/execution/shared-cell-author-compensation-iam-review.ts";

const args = process.argv.slice(2);
const online = args.length === 6 && args[4] === "--online-simulate" && args[5] === "--acknowledge-read-only";
if ((args.length !== 4 && !online) || args[0] !== "--template" || !args[1] || args[2] !== "--output" || !args[3]) {
  throw new Error("Usage: node --experimental-strip-types review-b5-author-compensation-iam.ts --template <split-candidate.json> --output <new-review.json> [--online-simulate --acknowledge-read-only]");
}
if ((await stat(args[1])).size > 51_200) throw new Error("Candidate exceeds the bounded template size.");
const plan = await compileSharedCellAuthorCompensationIamReview(await readFile(args[1], "utf8"));
let result: unknown = plan;
if (online) {
  // Fixed login provider only; no env-file load, static credentials, default
  // chain, role assumption, custom endpoint, or write-capable SDK commands.
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (/^AWS_ENDPOINT_URL(?:_|$)/.test(key) || ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE"].includes(key))) throw new Error("IAM review refuses ambient credential/config/endpoint overrides.");
  }
  const { loadSharedConfigFiles } = await import("@smithy/core/config");
  const files = await loadSharedConfigFiles({ ignoreCache: true });
  const profile = "techlong-sandbox-user";
  const configured = files.configFile[profile];
  const forbidden = ["aws_access_key_id", "aws_secret_access_key", "aws_session_token", "role_arn", "source_profile", "credential_source", "credential_process", "sso_session", "endpoint_url", "services"];
  if (!configured || configured.login_session !== plan.sourceArn || configured.region !== plan.region || Object.keys(files.credentialsFile[profile] ?? {}).length ||
      [configured, files.configFile.default ?? {}].some((section) => forbidden.some((key) => section[key] !== undefined))) throw new Error("IAM review requires the exact unmodified Source login profile.");
  const { fromLoginCredentials } = await import("@aws-sdk/credential-provider-login");
  const login = fromLoginCredentials({ profile, ignoreCache: true, clientConfig: { region: plan.region, ignoreConfiguredEndpointUrls: true } });
  const credentials = async () => {
    const value = await login();
    if (!value.sessionToken || !value.expiration || value.expiration.getTime() <= Date.now()) throw new Error("Refresh the Source login session before read-only IAM simulation.");
    return value;
  };
  const config = { region: plan.region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
  const { IAMClient, SimulateCustomPolicyCommand } = await import("@aws-sdk/client-iam");
  const sts = new STSClient(config);
  const iam = new IAMClient(config);
  try {
    result = { plan, receipt: await inspectSharedCellAuthorCompensationIamReview(plan, {
      getCallerIdentity: (signal) => sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal }),
      simulateCustomPolicy: (request, signal) => iam.send(new SimulateCustomPolicyCommand(request), { abortSignal: signal }),
    }, AbortSignal.timeout(120_000)) };
  } catch {
    throw new Error("Read-only IAM review failed; refresh Source/check permissions or inspect the candidate. No AWS mutation was submitted.");
  } finally { sts.destroy(); iam.destroy(); }
}
// Evidence output is create-only: never overwrite an earlier review/receipt.
await writeFile(args[3], `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ mode: online ? "ONLINE_SIMULATION_ONLY" : "LOCAL_REVIEW", output: args[3], reviewSha256: plan.reviewSha256, cases: plan.cases.length, providerContextCompatibilityVerified: false, mutationPerformed: false }, null, 2));
