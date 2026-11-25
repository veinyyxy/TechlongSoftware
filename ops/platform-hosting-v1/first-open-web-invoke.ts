import { Hash } from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { SignatureV4 } from "@smithy/signature-v4";
import { RDS_CONTROL_DATABASE_MODE } from "../../db/postgres-rds.ts";
import { FIRST_OPEN_TASK_ACCOUNT, FIRST_OPEN_TASK_REGION, readEcsTaskCredentials } from "./first-open-task-identity.ts";

const roleArn = `arn:aws:iam::${FIRST_OPEN_TASK_ACCOUNT}:role/TechlongSandboxPlatformWebFirstOpenInvokeRole`;
const aliasArn = `arn:aws:lambda:${FIRST_OPEN_TASK_REGION}:${FIRST_OPEN_TASK_ACCOUNT}:function:techlong-sandbox-first-open-launcher-v1:first-open`;
const hostname = `lambda.${FIRST_OPEN_TASK_REGION}.amazonaws.com`;
const path = `/2015-03-31/functions/${encodeURIComponent(aliasArn)}/invocations`;
const executionIdPattern = /^exec_[a-f0-9]{32}$/;

type CredentialOptions = Parameters<typeof readEcsTaskCredentials>[0];

/** Node Web can notify only the installed alias, and only after the RDS cutover. */
export function createFirstOpenWebInvokeBinding(environment: CredentialOptions["env"], {
  send = fetch,
  readLocal,
  now,
}: { send?: typeof fetch; readLocal?: CredentialOptions["readLocal"]; now?: () => number } = {}) {
  const enabled = () => environment.TECHLONG_FIRST_OPEN_WEB_INVOKE === "true" &&
    environment.TECHLONG_SAAS_CONTROL_DATABASE_MODE === RDS_CONTROL_DATABASE_MODE;
  const notify = async (executionId: string) => {
    if (!enabled() || typeof executionId !== "string" || !executionIdPattern.test(executionId)) {
      throw Error("FIRST_OPEN_WEB_INVOKE_INPUT");
    }
    const signal = AbortSignal.timeout(8_000);
    const credentials = await readEcsTaskCredentials({ env: environment, expectedRoleArn: roleArn, signal, readLocal, now });
    const signer = new SignatureV4({ credentials, region: FIRST_OPEN_TASK_REGION, service: "lambda", sha256: Hash.bind(null, "sha256") });
    const body = JSON.stringify({ executionId });
    const request = await signer.sign(new HttpRequest({ protocol: "https:", hostname, path, method: "POST", body,
      headers: { host: hostname, "content-type": "application/json", "x-amz-invocation-type": "RequestResponse" } }));
    signal.throwIfAborted();
    const response = await send(`https://${hostname}${path}`, {
      method: request.method, headers: request.headers, body, redirect: "error", signal,
    });
    try {
      if (response.status !== 200 || response.headers.has("x-amz-function-error") ||
        !/^[1-9][0-9]*$/.test(response.headers.get("x-amz-executed-version") ?? "")) throw Error("FIRST_OPEN_WEB_INVOKE_UNCONFIRMED");
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  };
  return () => enabled() ? notify : undefined;
}
