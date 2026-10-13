import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { IAMClient, GetRoleCommand, GetPolicyCommand, GetPolicyVersionCommand, ListPolicyVersionsCommand, ListRolePoliciesCommand, ListAttachedRolePoliciesCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as old, CELL_PARENT_BOOTSTRAP_DENY_V4, cellParentBootstrapTagsV4 } from "../../../lib/deployments/execution/cell-parent-bootstrap-v4.ts";
import { CELL_PARENT_TRUST_V4, CELL_PARENT_TABLE_ID_V4 } from "../../../lib/deployments/execution/cell-birth-parent-v4.ts";
import { CELL_PARENT_REGISTRATION_EXCLUSIONS_V4, CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4 } from "../../../lib/deployments/execution/cell-parent-source-registrar-v4.ts";
import { createCellParentSdkV4 } from "../../../lib/deployments/execution/aws-sdk-cell-birth-parent-v4.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_TABLE_ARN as table } from "../../../lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority.ts";
import { CELL_PARENT_LOCKED_UPDATE_V5 as t, cellParentLockedUpdateRequestsV5, inspectCellParentLockedSnapshotV5, cellParentAsyncStateV5, decodeCellParentUpdateSimulationV5 } from "../../../lib/deployments/execution/cell-parent-locked-update-v5.ts";
import { assertCellParentAsyncLockedV5 } from "../../../lib/deployments/execution/cell-parent-async-plan-v5.ts";

const native = promisify(execFile), cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const expectedTags = cellParentBootstrapTagsV4("0cb547a6016a508ff5903fb99f804b6cb341147e273e262e1a7a43ef3362676c");
const parse = raw => typeof raw === "string" ? JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw)) : raw;
const without = (raw, keys) => Object.fromEntries(Object.entries(raw).filter(([k]) => !keys.includes(k)));
/** Constructing this adapter does not call AWS or load credentials. Read paths
 * have a fixed command whitelist. Only writeOnce exposes the two approved
 * native operations, with an internal consumed flag BEFORE each submission. */
export function createCellParentLockedUpdateAwsV5(zipPath) {
  const credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg }), clients = createCellParentSdkV4(credentials),
    iam = new IAMClient({ ...cfg, credentials }), cfn = new CloudFormationClient({ ...cfg, credentials }), attempted = new Set();
  const call = (client, Command, input) => client.send(new Command(input), { abortSignal: AbortSignal.timeout(25000) });
  const identity = async () => {
    const r = await call(clients.registry.sts, clients.registry.commands.identity, {});
    if (r.Account !== old.account || r.Arn !== old.sourceArn || r.UserId !== old.sourceUserId) throw Error("LOCKED_UPDATE_SOURCE_IDENTITY_INVALID");
  };
  const cli = async (service, action, input, extra = []) => {
    const c = await credentials();
    if (c.expiration && c.expiration.getTime() - Date.now() < 60000) throw Error("LOCKED_UPDATE_CREDENTIAL_LIFETIME_TOO_SHORT");
    try {
      const r = await native("aws", [service, action, "--cli-input-json", JSON.stringify(input), ...extra, "--region", cfg.region, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
        { timeout: 30000, maxBuffer: 1000000, windowsHide: true, encoding: "utf8", env: { ...process.env, AWS_PROFILE: undefined,
          AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey, AWS_SESSION_TOKEN: c.sessionToken,
          AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } });
      return JSON.parse(r.stdout);
    } catch (e) {
      // Never persist/print raw native args, stdout/stderr or provider messages.
      const match = String(e.stderr ?? "").match(/An error occurred \(([A-Za-z0-9]+)\)/);
      const safe = new Error("LOCKED_UPDATE_NATIVE_CALL_FAILED"); safe.name = match?.[1] ?? "NativeCallError"; throw safe;
    }
  };
  const reads = Object.freeze({
    concurrency: ["lambda", "get-function-concurrency", { FunctionName: t.functionArn }],
    functionTags: ["lambda", "list-tags", { Resource: t.functionArn }],
    logGroups: ["logs", "describe-log-groups", { logGroupNamePrefix: old.logGroup, limit: 50 }],
    logTags: ["logs", "list-tags-for-resource", { resourceArn: `arn:aws:logs:ca-central-1:402010193138:log-group:${old.logGroup}` }],
    resourcePolicy: ["lambda", "get-policy", { FunctionName: t.functionArn }],
    url: ["lambda", "get-function-url-config", { FunctionName: t.functionArn }],
    aliases: ["lambda", "list-aliases", { FunctionName: t.functionArn, MaxItems: 50 }],
    versions: ["lambda", "list-versions-by-function", { FunctionName: t.functionArn, MaxItems: 50 }],
    mappings: ["lambda", "list-event-source-mappings", { FunctionName: t.functionArn, MaxItems: 50 }],
    async: ["lambda", "get-function-event-invoke-config", { FunctionName: t.functionArn, Qualifier: "$LATEST" }],
    asyncList: ["lambda", "list-function-event-invoke-configs", { FunctionName: t.functionArn, MaxItems: 50 }],
    runtime: ["lambda", "get-runtime-management-config", { FunctionName: t.functionArn, Qualifier: "$LATEST" }],
    rules: ["events", "list-rule-names-by-target", { TargetArn: t.functionArn, EventBusName: "default", Limit: 100 }],
  });
  const optional = new Set(["resourcePolicy", "url", "async"]);
  const read = async key => {
    if (!Object.hasOwn(reads, key)) throw Error("LOCKED_UPDATE_READ_CAPABILITY_INVALID");
    try { return await cli(...reads[key]); } catch (e) {
      if (optional.has(key) && e.name === "ResourceNotFoundException") return null;
      const safe = new Error(`LOCKED_UPDATE_NATIVE_${key.toUpperCase()}_READ_FAILED`); safe.name = e.name; throw safe;
    }
  };
  const functionConfig = () => call(clients.installation.lambda, clients.installation.commands.functionConfig, { FunctionName: t.functionArn, Qualifier: "$LATEST" });
  const slots = async () => {
    const keys = [...CELL_PARENT_REGISTRATION_EXCLUSIONS_V4, CELL_PARENT_REGISTRATION_ATTEMPT_KEY_V4], r = await call(clients.registry.ddb, clients.registry.commands.transactGet,
      { TransactItems: keys.map(authority_key => ({ Get: { TableName: table, Key: { authority_key } } })) });
    if (!Array.isArray(r.Responses) || r.Responses.length !== keys.length || r.Responses.some(v => canonicalJson(v) !== "{}")) throw Error("LOCKED_UPDATE_PARENT_OR_WORKFLOW_OCCUPIED");
    return keys;
  };
  const collect = async () => {
    await identity(); const started = Date.now(), before = await slots();
    const [f, roleResponse, policyResponse, versionResponse, versionsResponse, inline, attached, tableResponse, tablePolicy, stackAbsent, nativeValues] = await Promise.all([
      functionConfig(), call(iam, GetRoleCommand, { RoleName: old.roleName }), call(iam, GetPolicyCommand, { PolicyArn: old.boundaryArn }),
      call(iam, GetPolicyVersionCommand, { PolicyArn: old.boundaryArn, VersionId: "v1" }), call(iam, ListPolicyVersionsCommand, { PolicyArn: old.boundaryArn }),
      call(iam, ListRolePoliciesCommand, { RoleName: old.roleName }), call(iam, ListAttachedRolePoliciesCommand, { RoleName: old.roleName }),
      call(clients.installation.ddb, clients.installation.commands.table, { TableName: table }),
      call(clients.installation.ddb, clients.installation.commands.tablePolicy, { ResourceArn: table }).then(r => r).catch(e => { if (e.name === "PolicyNotFoundException") return null; throw e; }),
      call(cfn, DescribeStacksCommand, { StackName: "techlong-sandbox-cell-sandbox-1" }).then(() => false).catch(e => {
        if (e.name === "ValidationError" && e.message === "Stack with id techlong-sandbox-cell-sandbox-1 does not exist") return true; throw e;
      }),
      Promise.all(Object.keys(reads).map(async k => [k, await read(k)])).then(v => Object.fromEntries(v)),
    ]);
    const after = await slots(); await identity();
    if (Date.now() - started > 30000 || canonicalJson(before) !== canonicalJson(after)) throw Error("LOCKED_UPDATE_COLLECTION_STALE_OR_DRIFT");
    const r = roleResponse.Role, p = policyResponse.Policy, v = versionResponse.PolicyVersion, n = nativeValues, tab = tableResponse.Table;
    if (!r || !p || !v || !tab) throw Error("LOCKED_UPDATE_REQUIRED_METADATA_MISSING");
    if (!Array.isArray(n.logGroups.logGroups) || n.logGroups.nextToken) throw Error("LOCKED_UPDATE_LOG_PAGINATION");
    const log = n.logGroups.logGroups.find(g => g.logGroupName === old.logGroup);
    const noPages = x => x && !x.NextMarker && !x.NextToken && !x.nextToken;
    const a = n.async === null ? null : cellParentAsyncStateV5(n.async), aList = n.asyncList.FunctionEventInvokeConfigs;
    const guards = {
      sourceIdentity: true,
      exactRoleIdTrustBoundary: r.Arn === old.roleArn && r.RoleId === t.roleId && r.PermissionsBoundary?.PermissionsBoundaryArn === old.boundaryArn && canonicalJson(parse(r.AssumeRolePolicyDocument)) === canonicalJson(CELL_PARENT_TRUST_V4),
      denyAllV1Only: p.Arn === old.boundaryArn && p.DefaultVersionId === "v1" && v.VersionId === "v1" && v.IsDefaultVersion === true && canonicalJson(parse(v.Document)) === canonicalJson(CELL_PARENT_BOOTSTRAP_DENY_V4) &&
        versionsResponse.IsTruncated === false && !versionsResponse.Marker && versionsResponse.Versions?.length === 1 && versionsResponse.Versions[0].VersionId === "v1" && versionsResponse.Versions[0].IsDefaultVersion === true,
      emptyRolePolicies: inline.IsTruncated === false && !inline.Marker && canonicalJson(inline.PolicyNames) === "[]" && attached.IsTruncated === false && !attached.Marker && canonicalJson(attached.AttachedPolicies) === "[]",
      bootstrapTags: canonicalJson(Object.fromEntries((r.Tags ?? []).map(v => [v.Key, v.Value]))) === canonicalJson(expectedTags) && canonicalJson(n.functionTags.Tags) === canonicalJson(expectedTags) && canonicalJson(n.logTags.tags) === canonicalJson(expectedTags),
      concurrencyZero: n.concurrency.ReservedConcurrentExecutions === 0, logRetentionSeven: log?.retentionInDays === 7,
      exactTableAndNoPolicy: tab.TableArn === table && tab.TableId === CELL_PARENT_TABLE_ID_V4 && tab.TableStatus === "ACTIVE" && tablePolicy === null &&
        canonicalJson(tab.KeySchema) === '[{"AttributeName":"authority_key","KeyType":"HASH"}]' && !tab.GlobalTableVersion && !(tab.Replicas?.length),
      parentWorkflowAndRegistrationAbsent: true, cellStackAbsent: stackAbsent,
      noResourcePolicyOrFunctionUrl: n.resourcePolicy === null && n.url === null,
      noAliasesOrPublishedVersions: noPages(n.aliases) && canonicalJson(n.aliases.Aliases) === "[]" && noPages(n.versions) && n.versions.Versions?.length === 1 && n.versions.Versions[0].Version === "$LATEST",
      noEventSourceMappings: noPages(n.mappings) && canonicalJson(n.mappings.EventSourceMappings) === "[]",
      onlyLatestAsyncConfig: noPages(n.asyncList) && Array.isArray(aList) && aList.length === (a === null ? 0 : 1) && (a === null || canonicalJson(cellParentAsyncStateV5(aList[0])) === canonicalJson(a)),
      defaultBusTargetsAbsent: noPages(n.rules) && canonicalJson(n.rules.RuleNames) === "[]",
    };
    // No telemetry counters, provider $metadata, RoleLastUsed, or async output
    // in the immutable lock facts. RuntimeManagement MODE is preserved; only
    // provider runtime patch ARN may differ across a code update.
    const facts = {
      role: { ...without(r, ["RoleLastUsed", "AssumeRolePolicyDocument"]), AssumeRolePolicyDocument: parse(r.AssumeRolePolicyDocument) },
      policy: p, policyVersion: { ...v, Document: parse(v.Document) }, policyVersions: versionsResponse.Versions,
      inlineNames: inline.PolicyNames, attached: attached.AttachedPolicies, functionTags: n.functionTags.Tags,
      log: log ? without(log, ["storedBytes"]) : null, logTags: n.logTags.tags, concurrency: n.concurrency,
      table: { TableArn: tab.TableArn, TableId: tab.TableId, TableStatus: tab.TableStatus, KeySchema: tab.KeySchema }, tablePolicy,
      slotKeys: after, runtimeManagement: without(n.runtime, ["RuntimeVersionArn"]),
      functionResourcePolicy: null, functionUrl: null, aliases: n.aliases.Aliases, publishedVersions: [], mappings: n.mappings.EventSourceMappings, defaultBusRules: n.rules.RuleNames,
    };
    // Convert SDK Date values before hashing/persisting; cold JSON decoding
    // must have exactly the same canonical content as the live review.
    return JSON.parse(JSON.stringify({ observedAt: Date.now(), function: f, async: a, guards, facts }));
  };
  const stable = async () => {
    const first = await collect(), second = await collect();
    if (canonicalJson(without(first, ["observedAt"])) !== canonicalJson(without(second, ["observedAt"]))) throw Error("LOCKED_UPDATE_DOUBLE_READ_DRIFT");
    return second;
  };
  const simulateSource = async () => {
    await identity(); const response = await call(iam, SimulatePrincipalPolicyCommand, { PolicySourceArn: old.sourceArn,
      ActionNames: ["lambda:UpdateFunctionCode", "lambda:PutFunctionEventInvokeConfig"], ResourceArns: [t.functionArn, `${t.functionArn}:$LATEST`] });
    return decodeCellParentUpdateSimulationV5(response);
  };
  return Object.freeze({ identity, readStable: stable, simulateSource,
    async writeOnce(index, request) {
      if (![0, 1].includes(index) || attempted.has(index) || (index === 1 && !attempted.has(0)) || canonicalJson(request) !== canonicalJson(cellParentLockedUpdateRequestsV5()[index])) throw Error("LOCKED_UPDATE_WRITE_CAPABILITY_INVALID");
      await identity(); attempted.add(index);
      const response = await cli("lambda", request.action, request.input, index === 0 ? ["--zip-file", `fileb://${zipPath}`] : []);
      if (index === 0 && (response.CodeSha256 !== t.zipCodeSha256Base64 || response.FunctionName !== t.functionName || response.Version !== "$LATEST" || response.Role !== old.roleArn || ![t.functionArn, `${t.functionArn}:$LATEST`].includes(response.FunctionArn))) throw Error("LOCKED_UPDATE_CODE_RESPONSE_NOT_VERIFIED");
      if (index === 1) assertCellParentAsyncLockedV5(response, { ReservedConcurrentExecutions: 0 });
    },
    async waitCodeReady() {
      for (let attempt = 0; attempt < 12; attempt++) {
        const f = await functionConfig();
        if (f.LastUpdateStatus === "Failed" || f.State === "Failed") throw Error("LOCKED_UPDATE_CODE_UPDATE_FAILED");
        if (f.LastUpdateStatus === "Successful" && f.State === "Active") {
          await inspectCellParentLockedSnapshotV5(await stable(), "candidate", Date.now());
          return;
        }
        if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw Error("LOCKED_UPDATE_CODE_READY_NOT_OBSERVED");
    },
    dispose: () => { iam.destroy(); cfn.destroy(); clients.dispose(); },
  });
}
