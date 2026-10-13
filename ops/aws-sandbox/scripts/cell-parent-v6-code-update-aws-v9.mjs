import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { createCellParentSdkV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { CELL_PARENT_V6_CODE_UPDATE_V9 as t, inspectLockedV6CodeSnapshotV9, decodeV6UpdateSimulationV9, assertV6CodeApprovalV9 } from "../../../lib/deployments/execution/cell-parent-v6-code-update-v9.ts";
import { createCellParentLockedUpdateAwsV5 } from "./cell-parent-locked-update-aws-v5.mjs";

const cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true }, fail = code => { throw Error(`V6_UPDATE_${code}`); };
export function createV6CodeUpdateAwsV9(zipBytes, reviewed, approvedSha, codeBindingSha256) {
  const credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg }),
    sts = new STSClient({ ...cfg, credentials }), iam = new IAMClient({ ...cfg, credentials }), sdkRead = createCellParentSdkV4(credentials),
    lockedRead = createCellParentLockedUpdateAwsV5(undefined), signer = new SignatureV4({ credentials, region: cfg.region, service: "lambda", sha256: Hash.bind(null, "sha256") });
  // Read/Inspect mode has no ZIP payload or reviewed write capability. A copy
  // is kept in memory for Run; upload never rereads a mutable file by path.
  const zip = zipBytes === undefined ? undefined : Buffer.from(zipBytes);
  let entered = false, httpPutEntered = false, latestFull;
  const instrument = async (operation, action) => {
    try { return await action(); } catch (e) { if (e && typeof e === "object") e.codeUpdateOperation = operation; throw e; }
  };
  const identity = () => instrument("SourceIdentity", async () => {
    const r = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
    if (r.Account !== "402010193138" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev") fail("SOURCE_IDENTITY_INVALID");
  });
  const config = () => sdkRead.installation.lambda.send(new sdkRead.installation.commands.functionConfig({ FunctionName: t.functionArn, Qualifier: "$LATEST" }), { abortSignal: AbortSignal.timeout(15000) });
  const full = async () => {
    const startedAt = Date.now(), live = await instrument("StableLocks", lockedRead.readStable);
    if (Date.now() - startedAt > 30000) fail("FULL_READ_TOO_SLOW"); latestFull = { startedAt, live }; return live;
  };
  const responseJson = async response => {
    const reader = response.body?.getReader(); if (!reader) fail("HTTP_RESPONSE_EMPTY"); const chunks = []; let length = 0;
    try { while (true) { const r = await reader.read(); if (r.done) break; length += r.value.byteLength; if (length > 131072) { await reader.cancel(); fail("HTTP_RESPONSE_TOO_LARGE"); } chunks.push(r.value); } }
    finally { reader.releaseLock(); }
    if (response.status !== 200) {
      const e = new Error("V6_UPDATE_HTTP_SUBMISSION_FAILED"); e.name = String(response.headers.get("x-amzn-errortype") ?? "LambdaHttpError").split(":")[0];
      e.$metadata = { requestId: response.headers.get("x-amzn-requestid"), httpStatusCode: response.status }; throw e;
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("HTTP_RESPONSE_JSON_INVALID"); }
  };
  return Object.freeze({ identity, readStable: full,
    async simulateSource() {
      await identity(); const r = await iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
        ActionNames: ["lambda:UpdateFunctionCode"], ResourceArns: [t.functionArn, `${t.functionArn}:$LATEST`] }), { abortSignal: AbortSignal.timeout(15000) });
      return decodeV6UpdateSimulationV9(r);
    },
    async updateOnce(review) {
      if (entered || !zip || !reviewed || canonicalJson(review) !== canonicalJson(reviewed) || !approvedSha || !codeBindingSha256 ||
        zip.length !== t.zipBytes || createHash("sha256").update(zip).digest("hex") !== t.zipSha256 || !latestFull) fail("WRITE_CAPABILITY_INVALID");
      entered = true;
      await identity(); const liveHashes = await inspectLockedV6CodeSnapshotV9(latestFull.live, "before", Date.now());
      if (liveHashes.snapshotSha256 !== reviewed.beforeHashes.snapshotSha256 || Date.now() - latestFull.startedAt > 30000) fail("CACHED_FULL_PRESTATE_DRIFT_OR_AGE");
      assertV6CodeApprovalV9(review, approvedSha, codeBindingSha256, Date.now());
      const { FunctionName: unused, ...input } = review.request; void unused;
      const hostname = "lambda.ca-central-1.amazonaws.com", body = JSON.stringify({ ...input, ZipFile: zip.toString("base64") });
      const request = await signer.sign(new HttpRequest({ protocol: "https:", hostname, method: "PUT", path: `/2015-03-31/functions/${t.functionName}/code`,
        headers: { host: hostname, "content-type": "application/json" }, body }));
      assertV6CodeApprovalV9(review, approvedSha, codeBindingSha256, Date.now());
      if (Date.now() - latestFull.startedAt > 30000) fail("CACHED_FULL_READ_EXPIRED_BEFORE_PUT");
      httpPutEntered = true;
      const response = await instrument("UpdateFunctionCode", () => fetch(`https://${hostname}${request.path}`, { method: "PUT", headers: request.headers, body,
        redirect: "error", signal: AbortSignal.timeout(30000) }));
      const result = await instrument("UpdateFunctionCode", () => responseJson(response));
      if (!result || result.FunctionName !== t.functionName || ![t.functionArn, `${t.functionArn}:$LATEST`].includes(result.FunctionArn) || result.Version !== "$LATEST" ||
        result.CodeSha256 !== t.zipCodeSha256 || result.CodeSize !== t.zipBytes || result.Role !== latestFull.live.function.Role) fail("CODE_RESPONSE_NOT_VERIFIED");
    },
    async waitReady() {
      for (let i = 0; i < 15; i++) {
        const f = await instrument("Readiness", config);
        if (f.State === "Failed" || f.LastUpdateStatus === "Failed") fail("CODE_UPDATE_FAILED");
        if (f.State === "Active" && f.LastUpdateStatus === "Successful" && f.CodeSha256 === t.zipCodeSha256) return;
        if (i < 14) await new Promise(resolve => setTimeout(resolve, 2000));
      }
      fail("CODE_READY_NOT_OBSERVED");
    },
    httpPutEntered: () => httpPutEntered,
    dispose: () => { sts.destroy(); iam.destroy(); sdkRead.dispose(); lockedRead.dispose(); },
  });
}
