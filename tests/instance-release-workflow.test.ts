import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { STSClient } from "@aws-sdk/client-sts";
import type { HttpRequest } from "@smithy/types";
import { assertReleaseJob, releaseEnvironment, releaseRequestId, encodeReleaseHandoff, decodeReleaseHandoff } from "../lib/deployments/releases/handoff.ts";
import { prepareReleaseWorkflowJob, deployReleaseWorkflowJob } from "../lib/deployments/releases/workflow.ts";
import { sampleInstanceRelease, releaseReader, sampledObservation } from "../lib/deployments/releases/sampling.ts";
import { inspectInstanceRelease } from "../lib/deployments/releases/inspection.ts";
import { releaseChildEnvironment, requireHumanReview, assertReleaseIdentity, releaseDatabaseUrl,
  releaseMetadataApi, assumeReleaseIdentity } from "../ops/releases/aws-runtime.ts";
import { runReleaseInspector } from "../ops/releases/inspector-process.ts";
import { workflowJob, workflowEnvironment, workflowFixture } from "./instance-release-workflow-fixture.ts";
import { releaseFixture } from "./instance-release-fixture.ts";

const yaml = createRequire(import.meta.url)("js-yaml") as { load(text: string): unknown };

const config = () => ({ schema: "techlong/instance-release-runtime/v1" as const, enabled: true,
  repository: "veinyyxy/TechlongSoftware", environments: { sandbox: workflowEnvironment() } });
const credentials = () => ({ accessKeyId: "synthetic-verifier", secretAccessKey: "synthetic-secret", sessionToken: "synthetic-token", expiresAt: Date.now() + 3600_000 });
const fetchJson = (value: unknown): typeof fetch => async () => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

const installationJson = async (name: string) => JSON.parse(await readFile(new URL(`../ops/releases/${name}`, import.meta.url), "utf8"));

test("release installation materials: three Secrets are CFN-owned, NoEcho, retained and never supplied in the repository", async () => {
  const template = await installationJson("control-secrets.draft.template.json");
  assert.equal(Object.keys(template.Resources).length, 3);
  for (const purpose of ["Planner", "Executor", "Verifier"]) {
    const resource = template.Resources[purpose + "Secret"], parameter = template.Parameters[purpose + "SecretJson"];
    assert.equal(resource.Type, "AWS::SecretsManager::Secret");
    assert.equal(resource.DeletionPolicy, "Retain"); assert.equal(resource.UpdateReplacePolicy, "Retain");
    assert.deepEqual(resource.Properties.SecretString, { Ref: purpose + "SecretJson" });
    assert.equal(parameter.NoEcho, true); assert.equal(parameter.Default, undefined);
    assert.equal(resource.Properties.KmsKeyId, undefined); assert.equal(resource.Properties.GenerateSecretString, undefined);
    assert.deepEqual(template.Outputs[purpose + "SecretArn"].Value, { Ref: purpose + "Secret" });
  }
});

test("release installation materials: existing immutable OIDC subjects and distinct attached policy boundaries", async () => {
  const template = await installationJson("identities.draft.template.json");
  assert.equal(Object.keys(template.Resources).length, 6);
  for (const purpose of ["Planner", "Executor", "Verifier"]) {
    const role = template.Resources[purpose + "Role"].Properties;
    assert.equal(role.RoleName, `TechlongSandboxInstanceRelease${purpose}Role`);
    assert.deepEqual(role.PermissionsBoundary, { Ref: purpose + "Boundary" });
    assert.deepEqual(role.ManagedPolicyArns, [{ Ref: purpose + "Boundary" }]);
    assert.equal(role.MaxSessionDuration, 3600);
    const trust = role.AssumeRolePolicyDocument.Statement;
    assert.equal(trust.length, 1); assert.equal(trust[0].Action, "sts:AssumeRoleWithWebIdentity");
    assert.equal(trust[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com");
    assert.equal(trust[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"],
      "repo:veinyyxy@14145707/TechlongSoftware@1323312747" + (purpose === "Planner" ? ":ref:refs/heads/main" : ":environment:techlong-sandbox-deploy"));
    const policy = template.Resources[purpose + "Boundary"].Properties.PolicyDocument;
    assert.ok(JSON.stringify(policy).length < 6144, "IAM managed policy character limit");
    const secret = policy.Statement.find((s: { Sid: string }) => s.Sid === "OwnFixedControlSecret");
    assert.deepEqual(secret.Resource, { Ref: purpose + "SecretArn" });
    assert.deepEqual(secret.Condition.StringEquals["secretsmanager:VersionId"], { Ref: purpose + "SecretVersionId" });
    const kms = policy.Statement.find((s: { Sid: string }) => s.Sid === "OnlyForwardedOwnSecretDecrypt");
    assert.deepEqual(kms.Resource, { Ref: "SecretsManagerKeyArn" });
    assert.equal(kms.Condition.StringEquals["kms:ViaService"], "secretsmanager.ca-central-1.amazonaws.com");
    assert.deepEqual(kms.Condition.StringEquals["kms:EncryptionContext:SecretARN"], { Ref: purpose + "SecretArn" });
    assert.deepEqual(kms.Condition.StringEquals["kms:EncryptionContext:SecretVersionId"], { Ref: purpose + "SecretVersionId" });
  }
});

test("release installation materials: only executor can change CFN, only verifier writes inspection evidence", async () => {
  const template = await installationJson("identities.draft.template.json");
  for (const purpose of ["Planner", "Executor", "Verifier"]) {
    const statements = template.Resources[purpose + "Boundary"].Properties.PolicyDocument.Statement as { Sid: string; Action: string[]; Resource: unknown }[];
    const writes = statements.flatMap(s => s.Action).filter(a => ["cloudformation:CreateChangeSet", "cloudformation:ExecuteChangeSet"].includes(a));
    assert.deepEqual(writes, purpose === "Executor" ? ["cloudformation:CreateChangeSet", "cloudformation:ExecuteChangeSet"] : []);
    for (const s of statements.filter(s => s.Sid.endsWith("ChangeSet"))) assert.deepEqual(s.Resource, { Ref: "ReleaseStackArns" });
    const actions = statements.flatMap(s => s.Action);
    assert.equal(actions.includes("s3:PutObject"), purpose === "Verifier");
    assert.equal(actions.includes("s3:GetObjectVersion"), purpose === "Verifier");
    assert.equal(actions.some(a => /^(iam:|ecs:(Update|Run|Stop|Register)|elasticloadbalancing:(Create|Delete|Modify)|rds:(Start|Stop|Modify)|secretsmanager:(Put|Create|Update|Delete))/.test(a)), false);
    assert.equal(actions.some(a => a.includes("*") || ["s3:GetObject", "cloudformation:CreateStack", "cloudformation:DeleteStack", "iam:PassRole"].includes(a)), false);
  }
});

test("release installation materials: LOGIN SQL changes only three new roles and accepts no embedded password", async () => {
  const sql = await readFile(new URL("../ops/releases/login-roles.draft.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/^CREATE ROLE /gm) ?? []).length, 3);
  assert.equal((sql.match(/LOGIN PASSWORD %L/g) ?? []).length, 3);
  for (const purpose of ["planner", "executor", "verifier"]) {
    assert(sql.includes(`CREATE ROLE deployment_release_${purpose}_login NOLOGIN INHERIT NOSUPERUSER`));
    for (const option of ["INHERIT TRUE", "SET FALSE", "ADMIN FALSE"]) {
      assert(sql.includes(`GRANT deployment_release_${purpose} TO deployment_release_${purpose}_login WITH ${option};`));
    }
    assert(sql.includes(`techlong_release.${purpose}_password`));
  }
  assert.equal(/^(?:(?:BEGIN|COMMIT)\s*;|(?:CREATE (?:SCHEMA|FUNCTION|TABLE)|GRANT CONNECT|ALTER ROLE deployment_release_owner|INSERT|UPDATE|DELETE)\b)/m.test(sql), false);
  assert(sql.includes("SET LOCAL password_encryption = 'scram-sha-256'"));
});

test("release installation materials: unresolved real references are not approval, activation or generated credentials", async () => {
  const prepared = await installationJson("identity-installation.prepared.json");
  assert.equal(prepared.executionAuthorized, false); assert.equal(prepared.status, "OFFLINE_MATERIALS_COMPLETE_BINDINGS_PENDING");
  assert.ok(prepared.requiredBeforeExecution.length > 0);
  assert.equal(prepared.productionCallsThisPreparation, 0); assert.equal(prepared.passwordsGenerated, 0);
  for (const artifact of prepared.artifacts as { path: string; sha256: string }[]) {
    const text = (await readFile(new URL("../" + artifact.path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), artifact.sha256);
  }
  const template = await installationJson("identities.draft.template.json");
  for (const parameter of Object.values(template.Parameters) as { Default?: unknown }[]) assert.equal(parameter.Default, undefined);
  const runtime = JSON.parse(await readFile(new URL("../ops/releases/runtime.json", import.meta.url), "utf8"));
  assert.deepEqual(runtime.environments, {}); assert.equal(runtime.enabled, false);
});

test("release job: default activation is closed and only a complete, separated sandbox installation can enable it", async () => {
  const current = JSON.parse(await readFile(new URL("../ops/releases/runtime.json", import.meta.url), "utf8"));
  assert.equal(releaseEnvironment(current, workflowJob()), null);
  assert.equal(releaseEnvironment(config(), workflowJob())?.controlEnvironmentId, "sandbox");
  const shared = config(); shared.environments.sandbox.inspectionRoleArn = shared.environments.sandbox.executionRoleArn;
  assert.throws(() => releaseEnvironment(shared, workflowJob()), /ROLE_SEPARATION/);
  assert.throws(() => releaseEnvironment({ ...config(), environments: {} }, workflowJob()), /ACTIVATION_INCOMPLETE/);
});

test("release job: rerun, branch/event changes and arbitrary target syntax are rejected", () => {
  for (const patch of [{ runAttempt: 2 }, { ref: "refs/heads/unreviewed" }, { workflowRef: "other-workflow" }, { event: "push" }, { instanceId: "app; arbitrary-command" }, { environment: "production" }]) {
    assert.throws(() => assertReleaseJob({ ...workflowJob(), ...patch }, config().repository), /BINDING_REJECTED/);
  }
});

test("release handoff: binds exact run, source, selection and original deadline; not reusable by another run", async () => {
  const f = await releaseFixture(), job = workflowJob(); f.plan.selection.requestId = await releaseRequestId(job);
  const bundle = await encodeReleaseHandoff(job, f.plan);
  assert.equal((await decodeReleaseHandoff(bundle.encoded, bundle.sha256, job, 2000)).requestId, f.plan.selection.requestId);
  for (const patch of [{ runId: "other" }, { sourceSha: "2".repeat(40) }, { instanceId: "app_other" }, { releaseId: "other" }]) {
    await assert.rejects(decodeReleaseHandoff(bundle.encoded, bundle.sha256, { ...job, ...patch }, 2000), /HANDOFF_REJECTED/);
  }
  await assert.rejects(decodeReleaseHandoff(bundle.encoded, "0".repeat(64), job, 2000), /HANDOFF_REJECTED/);
  await assert.rejects(decodeReleaseHandoff(bundle.encoded, bundle.sha256, job, f.plan.writeBefore), /HANDOFF_REJECTED/);
});

test("release approval: requires exactly one human review for this run/environment, and only uses GET", async () => {
  const e = workflowEnvironment(), job = workflowJob(); let method: string | undefined;
  const review = { state: "approved", user: { id: e.reviewerId, type: "User" }, environments: [{ id: e.environmentId, name: e.environmentName }] };
  await requireHumanReview(job, e, "synthetic-github-token", async (url, init) => {
    assert.equal(String(url), `https://api.github.com/repos/${job.repository}/actions/runs/${job.runId}/approvals`);
    method = init?.method; return fetchJson([review])(url, init);
  });
  assert.equal(method, "GET");
  for (const values of [[], [review, review], [{ ...review, state: "rejected" }], [{ ...review, user: { id: 999, type: "User" } }],
    [{ ...review, user: { id: e.reviewerId, type: "Bot" } }], [{ ...review, environments: [{ id: 999, name: e.environmentName }] }]]) {
    await assert.rejects(requireHumanReview(job, e, "synthetic", fetchJson(values)), /HUMAN_APPROVAL_REQUIRED/);
  }
});

test("release identity: verifier cannot silently receive executor identity or owner/unfixed database credentials", () => {
  const e = workflowEnvironment(), ref = e.database.verifier;
  assert.doesNotThrow(() => assertReleaseIdentity({ Account: e.accountId, Arn: `arn:aws:sts::${e.accountId}:assumed-role/release-verifier/session` }, e, "verifier"));
  assert.throws(() => assertReleaseIdentity({ Account: e.accountId, Arn: `arn:aws:sts::${e.accountId}:assumed-role/release-executor/session` }, e, "verifier"), /ROLE_MISMATCH/);
  const value = { ARN: ref.arn, VersionId: ref.versionId, SecretString: JSON.stringify({ connectionString: `postgresql://${ref.username}:synthetic@synthetic.neon.tech/control` }) };
  assert.match(releaseDatabaseUrl(ref, value), /deployment_release_verifier_login/);
  for (const patch of [{ VersionId: "other" }, { ARN: "other" },
    { SecretString: JSON.stringify({ connectionString: "postgresql://owner:synthetic@synthetic.neon.tech/control" }) },
    { SecretString: JSON.stringify({ connectionString: `postgresql://${ref.username}:synthetic@foreign.invalid/control` }) }]) {
    assert.throws(() => releaseDatabaseUrl(ref, { ...value, ...patch }), /SECRET_REJECTED/);
  }
});

test("release OIDC real SDK: run/source claims bound before a single STS exchange; no ambient AWS credentials", async () => {
  const e = workflowEnvironment(), job = workflowJob(); let sent = 0;
  const claims = { aud: "sts.amazonaws.com", repository_id: job.repositoryId, run_id: job.runId, run_attempt: "1", sha: job.sourceSha,
    ref: job.ref, event_name: job.event, workflow_ref: job.workflowRef, actor: job.actor, sub: e.deploySubject };
  const token = "synthetic." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".synthetic";
  const makeClient = () => new STSClient({ region: e.region, maxAttempts: 1, requestHandler: { handle: async (request: HttpRequest) => {
    sent++; const body = new URLSearchParams(String(request.body)); assert.equal(body.get("Action"), "AssumeRoleWithWebIdentity");
    assert.equal(body.get("RoleArn"), e.inspectionRoleArn); assert.equal(body.get("WebIdentityToken"), token);
    return { response: { statusCode: 200, headers: { "content-type": "text/xml" }, body: Readable.from([Buffer.from(
      '<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult><Credentials>' +
      '<AccessKeyId>synthetic-verifier</AccessKeyId><SecretAccessKey>synthetic</SecretAccessKey><SessionToken>synthetic</SessionToken>' +
      `<Expiration>${new Date(Date.now()+3600_000).toISOString()}</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`)]) } };
  } } });
  const env = { NODE_ENV: "test" as const, ACTIONS_ID_TOKEN_REQUEST_URL: "https://vstoken.actions.githubusercontent.com/test", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic" };
  assert.equal((await assumeReleaseIdentity(job, e, "verifier", env, fetchJson({ value: token }), makeClient)).accessKeyId, "synthetic-verifier");
  const wrong = "synthetic." + Buffer.from(JSON.stringify({ ...claims, sha: "2".repeat(40) })).toString("base64url") + ".synthetic";
  await assert.rejects(assumeReleaseIdentity(job, e, "verifier", env, fetchJson({ value: wrong }), makeClient), /BINDING_REJECTED/);
  assert.equal(sent, 1);
});

test("release metadata transport: read whitelist, single attempts, clean environment and snapshot budget", async () => {
  const e = workflowEnvironment(); e.maxMetadataCallsPerSnapshot = 1; let calls = 0;
  const api = releaseMetadataApi(e, credentials(), async (args, env) => {
    calls++; assert.deepEqual(args.slice(0,2), ["cloudformation", "describe-stacks"]);
    assert.equal(env.AWS_MAX_ATTEMPTS, "1"); assert.equal(env.AWS_PROFILE, undefined); assert.equal(env.AWS_ENDPOINT_URL, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined); assert.equal(env.DATABASE_URL, undefined); return "{}";
  }, fetch, { NODE_ENV: "test", PATH: process.env.PATH, AWS_PROFILE: "forbidden", AWS_ENDPOINT_URL: "forbidden", DATABASE_URL: "canary", GITHUB_TOKEN: "canary" });
  await api.read("cloudformation", "describe-stacks", { StackName: "synthetic" });
  await assert.rejects(api.read("cloudformation", "describe-stacks", {}), /BUDGET_REJECTED/);
  await assert.rejects(api.read("cloudformation", "create-stack", {}), /BUDGET_REJECTED/); assert.equal(calls, 1);
});

test("release metadata HTTP: only two unauthenticated technical GET paths, no redirects or business payload", async () => {
  let calls = 0;
  const api = releaseMetadataApi(workflowEnvironment(), credentials(), async () => "{}", async (url, init) => {
    calls++; assert.ok(["/health", "/ready"].includes(new URL(String(url)).pathname));
    assert.equal(init?.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(init.headers, undefined); return new Response("", { status: 401 });
  });
  assert.equal((await api.getTechnical("/health", "https://api.sandbox.techlong.cloud")).status, 401);
  await api.getTechnical("/ready", "https://api.sandbox.techlong.cloud");
  await assert.rejects(api.getTechnical("/health", "https://api.sandbox.techlong.cloud"), /PATH_REJECTED/); assert.equal(calls, 2);
});

test("release sampler: reads actual CFN/ECS/routing/RDS/Secret version/ECR metadata into a running observation", async () => {
  const f = await workflowFixture();
  try {
    const facts = await sampleInstanceRelease(f.binding, f.cycle.planningInput.release, f.api, () => f.cycle.sql.now);
    const observation = await sampledObservation(f.binding, facts);
    assert.equal(observation.state, "RUNNING"); assert.equal(observation.configurationSha256, f.binding.configurationSha256);
    assert.equal(facts.persistentUploadsReady, true); assert.equal(facts.checks.length, 0);
    assert.ok(f.calls.length <= f.config.maxMetadataCallsPerSnapshot);
    assert.ok(f.calls.some(c => c.operation === "describe-secret")); assert.equal(f.calls.some(c => c.operation === "get-secret-value"), false);
  } finally { f.cycle.destroy(); }
});

test("release sampler: stopped database refuses restoration; truncated, wrong DNS/routes or unpinned secrets do not become proof", async () => {
  for (const mode of ["stopped", "paginate", "foreignDns", "wrongRoute", "missingSecret", "unpinned"] as const) {
    const f = await workflowFixture();
    try {
      f.controls[mode] = true;
      const sample = () => sampleInstanceRelease(f.binding, f.cycle.planningInput.release, f.api, () => f.cycle.sql.now);
      if (mode === "stopped") assert.equal((await sample()).databaseAvailable, false); else await assert.rejects(sample(), /RELEASE_/);
      assert.equal(f.calls.some(c => /^(start|create|update|delete)/.test(c.operation)), false);
    } finally { f.cycle.destroy(); }
  }
});

test("release workflow: preparation outputs a run-bound summary, then one protected-job pipeline consumes exactly that request", async () => {
  const f = await workflowFixture(), c = f.cycle;
  try {
    const prepared = await prepareReleaseWorkflowJob(f.job, f.config, { repository: c.plannerRepo, api: f.api, now: () => c.sql.now });
    assert.equal(prepared.outputs.status, "PLANNED"); assert.equal(c.events.some(e => e === "CreateChangeSet"), false);
    assert.match(prepared.summary, /not a created Change Set/); assert.doesNotMatch(prepared.summary, /secret-canary|JWT_SECRET|environmentVariables/);
    const h = await decodeReleaseHandoff(prepared.outputs.handoff, prepared.outputs.handoff_sha, f.job, c.sql.now);
    const request = await c.executorRepo.request(h.requestId); assert.ok(request?.plan);
    Object.assign(c.plan, request.plan); c.input.requestId = h.requestId;
    const sourceParameters = f.raw().parameters;
    c.controls.changeSetPatch = cs => { for (const p of cs.Parameters ?? []) if (p.ParameterKey !== "ImageUri") p.ParameterValue = sourceParameters[p.ParameterKey!]; };
    const resolve = async (p: typeof c.plan) => { const context = await c.executorRepo.context(p.selection.instanceId); return { binding: context!.binding, release: context!.releases.find(r => r.id === p.to.releaseId)! }; };
    const reader = releaseReader(resolve, () => f.api, () => c.sql.now);
    const result = await deployReleaseWorkflowJob(f.job, f.config, prepared.outputs.handoff, prepared.outputs.handoff_sha, { ...c.deps, reader,
      inspector: { inspect: input => inspectInstanceRelease(input, { repository: c.verifierRepo, reader: releaseReader(resolve, () => f.api, () => c.sql.now), evidence: c.evidence, now: () => c.sql.now }) } });
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(c.events.filter(e => e === "CreateChangeSet").length, 1); assert.equal(c.events.filter(e => e === "ExecuteChangeSet").length, 1);
    await assert.rejects(deployReleaseWorkflowJob({ ...f.job, runId: "other" }, f.config, prepared.outputs.handoff, prepared.outputs.handoff_sha, c.deps), /HANDOFF_REJECTED/);
  } finally { c.destroy(); }
});

test("release workflow YAML: three inputs, one environment gate, immutable source, no shell-interpolated inputs or automatic trigger", async () => {
  const raw = await readFile(new URL("../.github/workflows/instance-release.yml", import.meta.url), "utf8");
  const w = yaml.load(raw) as { on: { workflow_dispatch: { inputs: Record<string, unknown> } }; permissions: Record<string,string>;
    jobs: Record<string, { environment?: string; if?: string; steps: { run?: string; with?: Record<string,unknown> }[] }> };
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"]); assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs).sort(), ["environment", "instance_id", "release_id"]);
  assert.equal(Object.values(w.jobs).filter(j => j.environment).length, 1); assert.equal(w.jobs.deploy.environment, "techlong-sandbox-deploy");
  assert.equal(w.jobs.prepare.environment, undefined); assert.match(w.jobs.deploy.if!, /github.run_attempt == 1/);
  for (const job of Object.values(w.jobs)) {
    assert.equal(job.steps[0].with?.ref, "${{ github.sha }}");
    for (const step of job.steps) assert.ok(!step.run?.includes("${{ inputs."));
  }
  assert.doesNotMatch(raw, /actions: write|secrets: inherit|approve-pending|workflow_run:|push:/);
});

test("release inspector: a real child receives only verifier credentials over stdin, never inherited write/GitHub/OIDC/database environment", async () => {
  const job = workflowJob(), parent = { ...process.env, AWS_ACCESS_KEY_ID: "synthetic-executor", AWS_SECRET_ACCESS_KEY: "canary",
    AWS_SESSION_TOKEN: "canary", AWS_PROFILE: "canary", DATABASE_URL: "canary", GITHUB_TOKEN: "canary", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "canary",
    ACTIONS_ID_TOKEN_REQUEST_URL: "canary", NODE_OPTIONS: "--invalid-canary", NODE_EXTRA_CA_CERTS: "canary" };
  assert.equal(releaseChildEnvironment(parent).AWS_ACCESS_KEY_ID, undefined);
  const reference = await runReleaseInspector({ job, credentials: credentials(), input: { requestId: "synthetic", planSha256: "a".repeat(64),
    runId: job.runId, runAttempt: 1, changeSetId: "synthetic", notBefore: Date.now(), readBefore: Date.now()+10_000 } }, parent,
  (binary, args, options) => {
    assert.equal(binary, process.execPath); assert.equal(args.at(-1), "inspect"); assert.match(args[1], /scripts[\\/]instance-release.ts$/);
    assert.equal(options.shell, false);
    return spawn(binary, [fileURLToPath(new URL("./fixtures/instance-release-inspector.mjs", import.meta.url))], options);
  });
  assert.equal(reference.versionId, "fixed-version");
});

test("release CLI: the actual default-disabled entry exits without AWS, database or credential use", async () => {
  const job = workflowJob();
  const result = await new Promise<string>((resolve, reject) => execFile(process.execPath,
    ["--experimental-strip-types", "scripts/instance-release.ts", "prepare"], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, timeout: 20_000,
      env: { ...releaseChildEnvironment(process.env), GITHUB_REPOSITORY: job.repository, GITHUB_REPOSITORY_ID: job.repositoryId,
        GITHUB_RUN_ID: job.runId, GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: job.sourceSha, GITHUB_REF: job.ref, GITHUB_EVENT_NAME: job.event,
        GITHUB_ACTOR: job.actor, GITHUB_WORKFLOW_REF: job.workflowRef, RELEASE_INSTANCE_ID: job.instanceId, RELEASE_ID: job.releaseId, RELEASE_ENVIRONMENT: job.environment,
        AWS_ACCESS_KEY_ID: "secret-canary-not-used", DATABASE_URL: "secret-canary-not-used" } },
    (error, stdout) => error ? reject(new Error("disabled CLI failed")) : resolve(stdout)));
  assert.deepEqual(JSON.parse(result), { status: "DISABLED", cloudWrites: 0 }); assert.doesNotMatch(result, /canary/);
});
