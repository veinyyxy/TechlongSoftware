import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, GetRoleCommand, GetPolicyCommand, GetPolicyVersionCommand, ListPolicyVersionsCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, ValidateTemplateCommand, CreateStackCommand, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { CELL_RESERVATION_V5 as t, assertReservationFoundationV5, reservationRequestV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { createCellV3EvidenceFromCredentials } from "../../../lib/deployments/execution/aws-sdk-cell-stack-evidence-v3.ts";
import { createCellParentLockedUpdateAwsV5 } from "./cell-parent-locked-update-aws-v5.mjs";

export const reservationCertificateArnV5 = "arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d";
export const reservationTrustStoreArnV5 = "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44";
const execute = promisify(execFile), cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const parse = raw => typeof raw === "string" ? JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)) : raw;
const clean = v => JSON.parse(JSON.stringify(v));
const omit = (v, keys) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
const stackIdPattern = /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** No IAM/Update/Delete/ChangeSet/Invoke command is constructed. Create is
 * single-entry, maxAttempts=1, with the exact decoded RESERVED request. */
export function createReservationAwsV5(plan) {
  const credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg }),
    sts = new STSClient({ ...cfg, credentials }), iam = new IAMClient({ ...cfg, credentials }), cfn = new CloudFormationClient({ ...cfg, credentials }),
    parent = createCellParentLockedUpdateAwsV5(undefined);
  let entered = false;
  const call = (client, Command, input) => client.send(new Command(input), { abortSignal: AbortSignal.timeout(25000) });
  const identity = async () => {
    const r = await call(sts, GetCallerIdentityCommand, {});
    if (r.Account !== "402010193138" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev") throw Error("RESERVATION_SOURCE_IDENTITY_INVALID");
  };
  const native = async (service, action, input) => {
    if (!["acm/describe-certificate", "elbv2/describe-trust-stores", "ec2/describe-availability-zones"].includes(`${service}/${action}`)) throw Error("RESERVATION_NATIVE_READ_INVALID");
    const c = await credentials();
    try {
      const r = await execute("aws", [service, action, "--cli-input-json", JSON.stringify(input), "--region", cfg.region, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
        { timeout: 30000, windowsHide: true, maxBuffer: 1000000, env: { ...process.env, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: c.accessKeyId,
          AWS_SECRET_ACCESS_KEY: c.secretAccessKey, AWS_SESSION_TOKEN: c.sessionToken, AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } });
      return JSON.parse(r.stdout);
    } catch { throw Error("RESERVATION_NATIVE_METADATA_READ_UNVERIFIED"); }
  };
  const simulated = async (action, resource, key, value) => {
    const r = await call(iam, SimulatePrincipalPolicyCommand, { PolicySourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", ActionNames: [action], ResourceArns: [resource],
      ContextEntries: [{ ContextKeyName: key, ContextKeyType: "string", ContextKeyValues: [value] }] });
    if (r.IsTruncated || r.Marker || !Array.isArray(r.EvaluationResults) || r.EvaluationResults.length !== 1) throw Error("RESERVATION_SOURCE_SIMULATION_UNVERIFIED");
    const x = r.EvaluationResults[0];
    if (x.EvalActionName !== action || x.EvalResourceName !== resource || x.EvalDecision !== "allowed" || x.MissingContextValues?.length ||
      x.ResourceSpecificResults?.some(v => v.EvalResourceName !== resource || v.EvalResourceDecision !== "allowed" || v.MissingContextValues?.length)) throw Error("RESERVATION_SOURCE_SIMULATION_DENIED_OR_UNVERIFIED");
    return true;
  };
  const foundationOnce = async () => {
    await identity(); const name = "TechlongSandboxCellCloudFormationExecutionRole";
    const [rr, pr, versions, inline, attached, cert, trust, az, createAllowed, passAllowed] = await Promise.all([
      call(iam, GetRoleCommand, { RoleName: name }), call(iam, GetPolicyCommand, { PolicyArn: t.boundaryArn }), call(iam, ListPolicyVersionsCommand, { PolicyArn: t.boundaryArn }),
      call(iam, ListRolePoliciesCommand, { RoleName: name }), call(iam, ListAttachedRolePoliciesCommand, { RoleName: name }),
      native("acm", "describe-certificate", { CertificateArn: reservationCertificateArnV5 }), native("elbv2", "describe-trust-stores", { TrustStoreArns: [reservationTrustStoreArnV5] }),
      native("ec2", "describe-availability-zones", { Filters: [{ Name: "region-name", Values: [cfg.region] }, { Name: "state", Values: ["available"] }] }),
      simulated("cloudformation:CreateStack", `arn:aws:cloudformation:ca-central-1:402010193138:stack/${t.stackName}/*`, "cloudformation:RoleArn", t.roleArn),
      simulated("iam:PassRole", t.roleArn, "iam:PassedToService", "cloudformation.amazonaws.com"),
    ]);
    if (!rr.Role || !pr.Policy || versions.IsTruncated !== false || versions.Marker || inline.IsTruncated !== false || inline.Marker || attached.IsTruncated !== false || attached.Marker ||
      !Array.isArray(versions.Versions) || !versions.Versions.some(x => x.VersionId === pr.Policy.DefaultVersionId && x.IsDefaultVersion)) throw Error("RESERVATION_IAM_METADATA_UNVERIFIED");
    const v = await call(iam, GetPolicyVersionCommand, { PolicyArn: t.boundaryArn, VersionId: pr.Policy.DefaultVersionId });
    if (!v.PolicyVersion || !v.PolicyVersion.IsDefaultVersion) throw Error("RESERVATION_BOUNDARY_DEFAULT_UNVERIFIED");
    if (cert.Certificate?.CertificateArn !== reservationCertificateArnV5 || cert.Certificate.Status !== "ISSUED" ||
      !["sandbox.techlong.cloud", "*.sandbox.techlong.cloud"].every(n => cert.Certificate.SubjectAlternativeNames?.includes(n)) || Date.parse(cert.Certificate.NotAfter) <= Date.now() + 86400000 ||
      trust.TrustStores?.length !== 1 || trust.TrustStores[0].TrustStoreArn !== reservationTrustStoreArnV5 || trust.TrustStores[0].Status !== "ACTIVE" || trust.TrustStores[0].NumberOfCaCertificates !== 1 ||
      !["ca-central-1a", "ca-central-1b"].every(n => az.AvailabilityZones?.some(x => x.ZoneName === n && x.State === "available"))) throw Error("RESERVATION_CERT_TRUST_AZ_UNVERIFIED");
    const f = clean({ role: { ...omit(rr.Role, ["RoleLastUsed", "AssumeRolePolicyDocument"]), AssumeRolePolicyDocument: parse(rr.Role.AssumeRolePolicyDocument), inline: inline.PolicyNames, attached: attached.AttachedPolicies },
      boundary: { arn: pr.Policy.Arn, defaultVersion: pr.Policy.DefaultVersionId, policy: pr.Policy, versions: versions.Versions, document: parse(v.PolicyVersion.Document) },
      foundationMetadataVerified: true, sourceCreateAllowed: createAllowed, sourcePassRoleAllowed: passAllowed });
    assertReservationFoundationV5(f); await identity(); return f;
  };
  const foundationStable = async () => {
    const a = await foundationOnce(), b = await foundationOnce();
    if (canonicalJson(a) !== canonicalJson(b)) throw Error("RESERVATION_FOUNDATION_DOUBLE_READ_DRIFT"); return b;
  };
  const evidence = async expectedId => {
    const scope = createCellV3EvidenceFromCredentials(credentials, "source_inspection");
    try { return await scope.reader.read(plan, expectedId, AbortSignal.timeout(30000)); } finally { scope.dispose(); }
  };
  return Object.freeze({ identity,
    async readBefore() {
      const [p, f, e] = await Promise.all([parent.readStable(), foundationStable(), evidence(null)]);
      return { parent: p, foundation: f, absence: "state" in e && e.state === "ABSENT" };
    },
    async validate() {
      const r = await call(cfn, ValidateTemplateCommand, { TemplateBody: plan.templateBody });
      if (r.Capabilities?.length || !Array.isArray(r.Parameters) || canonicalJson(r.Parameters.map(x => x.ParameterKey).sort()) !== canonicalJson(Object.keys(plan.phaseParameters.RESERVED).sort()) ||
        r.Parameters.find(x => x.ParameterKey === "LifecyclePhase")?.DefaultValue !== "RESERVED") throw Error("RESERVATION_TEMPLATE_VALIDATION_UNVERIFIED");
      return { validatedByAws: true, parameterCount: r.Parameters.length, capabilities: [] };
    },
    async createOnce(request) {
      if (entered || canonicalJson(request) !== canonicalJson(reservationRequestV5(plan))) throw Error("RESERVATION_CREATE_CAPABILITY_INVALID");
      await identity(); entered = true;
      const response = await call(cfn, CreateStackCommand, request);
      if (!stackIdPattern.test(String(response.StackId))) throw Error("RESERVATION_CREATE_RESPONSE_UNVERIFIED");
      return response.StackId;
    },
    async waitReadOnly(stackId) {
      if (!stackIdPattern.test(stackId)) throw Error("RESERVATION_EXACT_STACK_ARN_REQUIRED");
      for (let n = 0; n < 16; n++) {
        const r = await call(cfn, DescribeStacksCommand, { StackName: stackId }), s = r.Stacks?.[0];
        if (r.Stacks?.length !== 1 || s.StackId !== stackId || s.StackName !== t.stackName) throw Error("RESERVATION_READINESS_IDENTITY_INVALID");
        if (s.StackStatus === "CREATE_COMPLETE") return;
        if (s.StackStatus !== "CREATE_IN_PROGRESS") throw Error("RESERVATION_CREATE_NOT_COMPLETE_INSPECT_ONLY");
        if (n < 15) await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw Error("RESERVATION_CREATE_READINESS_NOT_OBSERVED");
    },
    async inspect(expectedId) {
      const e = await evidence(expectedId);
      if ("state" in e) return { evidence: e, parent: await parent.readStable(), foundation: await foundationStable(), stackFlagsVerified: false };
      const [p, f, raw] = await Promise.all([parent.readStable(), foundationStable(), call(cfn, DescribeStacksCommand, { StackName: e.stackId })]);
      const s = raw.Stacks?.[0];
      if (raw.Stacks?.length !== 1 || s.StackId !== e.stackId || s.StackStatus !== e.stackStatus || s.DisableRollback !== true || s.EnableTerminationProtection !== false || s.RoleARN !== t.roleArn || s.LastUpdatedTime)
        throw Error("RESERVATION_STACK_FLAGS_OR_UPDATE_DRIFT");
      return { evidence: e, parent: p, foundation: f, stackFlagsVerified: true };
    },
    dispose: () => { sts.destroy(); iam.destroy(); cfn.destroy(); parent.dispose(); },
  });
}
