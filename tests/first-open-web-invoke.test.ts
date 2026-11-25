import assert from "node:assert/strict";
import test from "node:test";
import { createFirstOpenWebInvokeBinding } from "../ops/platform-hosting-v1/first-open-web-invoke.ts";
import { createFirstOpenAdminHandlers } from "../lib/deployments/first-open-admin-http.ts";
import { createFirstOpenAdminStore } from "../lib/deployments/first-open-admin-store.ts";
import { buildFirstOnboardingJob } from "../lib/deployments/first-onboarding.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const executionId = "exec_" + "7".repeat(32);
const webRole = "arn:aws:iam::402010193138:role/TechlongSandboxPlatformWebFirstOpenInvokeRole";
const lambdaAlias = "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-first-open-launcher-v1:first-open";
const env = {
  TECHLONG_FIRST_OPEN_WEB_INVOKE: "true",
  TECHLONG_SAAS_CONTROL_DATABASE_MODE: "rds-postgresql",
  AWS_EXECUTION_ENV: "AWS_ECS_FARGATE",
  AWS_REGION: "ca-central-1",
  ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/metadata-fixture",
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/authority-fixture",
};
const credentials = (role = webRole) => ({
  RoleArn: role, AccessKeyId: "ASIA" + "1".repeat(16), SecretAccessKey: "a".repeat(40),
  Token: "b".repeat(80), Expiration: new Date(Date.now() + 300_000).toISOString(),
});

test("Web notifies only the fixed Lambda alias using signed task credentials and the exact execution ID", async () => {
  let sent = 0, read = 0;
  const options = {
    async readLocal(url: URL) {
      read++;
      assert.equal(url.href, "http://169.254.170.2/v2/credentials/authority-fixture");
      return credentials();
    },
    async send(url: RequestInfo | URL, request?: RequestInit) {
      sent++;
      assert.equal(url, `https://lambda.ca-central-1.amazonaws.com/2015-03-31/functions/${encodeURIComponent(lambdaAlias)}/invocations`);
      const headers = new Headers(request?.headers);
      assert.match(headers.get("authorization") ?? "", /\/ca-central-1\/lambda\/aws4_request/);
      assert.equal(headers.get("x-amz-invocation-type"), "RequestResponse");
      assert.equal(headers.get("x-amz-security-token"), credentials().Token);
      assert.equal(request?.method, "POST");
      assert.equal(request?.body, JSON.stringify({ executionId }));
      assert.equal(request?.redirect, "error");
      assert.ok(request?.signal);
      return Response.json({ ignored: true }, { headers: { "x-amz-executed-version": "24" } });
    },
  };
  assert.equal(createFirstOpenWebInvokeBinding({}, options)(), undefined);
  assert.equal(createFirstOpenWebInvokeBinding({ ...env, TECHLONG_SAAS_CONTROL_DATABASE_MODE: "neon" }, options)(), undefined);
  const notify = createFirstOpenWebInvokeBinding(env, options)();
  assert.ok(notify);
  assert.equal(read, 0);
  await assert.rejects(notify(executionId + "/different"), /FIRST_OPEN_WEB_INVOKE_INPUT/);
  assert.equal(read, 0);
  await notify(executionId);
  assert.deepEqual([read, sent], [1, 1]);
});

test("a different role or a static credential override cannot invoke, and a lost Lambda response is sent once", async () => {
  let sent = 0;
  const send = async () => { sent++; throw Error("connection interrupted"); };
  const wrongRole = createFirstOpenWebInvokeBinding(env, { send, readLocal: async () => credentials(webRole + "Unexpected") })();
  assert.ok(wrongRole);
  await assert.rejects(wrongRole(executionId), /ECS_FIRST_OPEN_TASK_ROLE_SCOPE/);
  const override = createFirstOpenWebInvokeBinding({ ...env, AWS_ACCESS_KEY_ID: "static-fixture" }, {
    send, readLocal: async () => { throw Error("local lookup must be blocked"); },
  })();
  assert.ok(override);
  await assert.rejects(override(executionId), /ECS_FIRST_OPEN_TASK_IDENTITY_ENV/);
  assert.equal(sent, 0);
  const lost = createFirstOpenWebInvokeBinding(env, { send, readLocal: async () => credentials() })();
  assert.ok(lost);
  await assert.rejects(lost(executionId), /connection interrupted/);
  assert.equal(sent, 1);
  const functionError = createFirstOpenWebInvokeBinding(env, { readLocal: async () => credentials(),
    send: async () => { sent++; return Response.json({ ignored: true }, { headers: {
      "x-amz-executed-version": "24", "x-amz-function-error": "Unhandled",
    } }); },
  })();
  assert.ok(functionError);
  await assert.rejects(functionError(executionId), /FIRST_OPEN_WEB_INVOKE_UNCONFIRMED/);
  assert.equal(sent, 2);
});

async function approvalFixture() {
  const configuration = { property: "synthetic" }, desiredPlan = { mode: "aws_sandbox" };
  const accountId = "111111111111", manifestDigest = "sha256:" + "a".repeat(64);
  const repository = `${accountId}.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast`;
  const scope = { appInstanceId: "app_fixture", workspaceId: "workspace_fixture", tenantKey: "tenant_fixture", subscriptionId: "sub_fixture",
    environmentId: "env_fixture", planId: "plan_fixture", templateVersionId: "version_fixture", accountId, releaseId: "release_" + "a".repeat(32),
    artifactRef: `${repository}@${manifestDigest}`, configurationHash: await sha256Hex(configuration), planHash: await sha256Hex(desiredPlan) };
  const held = await buildFirstOnboardingJob(scope);
  assert.ok(held);
  const target = { ...scope, configuration, desiredPlan, slug: "tenant-fixture", subscriptionEnd: Number.MAX_SAFE_INTEGER,
    purchaseOrderId: "purchase_fixture", instancePendingFirstOpen: true, subscriptionActiveAndCurrent: true,
    scopeStillEligible: true, noOtherDeploymentOrTenantGeneration: true,
    deployment: { id: held.deploymentId, status: "planned", planHash: scope.planHash, configurationHash: scope.configurationHash, artifactRef: scope.artifactRef },
    job: { id: held.jobId, deploymentId: held.deploymentId, dedupeKey: held.dedupeKey, jobType: "apply", status: "pending", payload: held.payload,
      attempts: 0, maxAttempts: 1, availableAt: held.availableAt, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, completedAt: null } };
  const release = { id: scope.releaseId, productId: "prd_restaurant_order_system", component: "tenant_api", version: "synthetic",
    status: "ecr_verified", source: { repository: "synthetic", commit: "b".repeat(40), buildRunId: "1", buildAttempt: 1, artifactSha256: "c".repeat(64) },
    image: { repository, manifestDigest, platformDigest: manifestDigest, verificationSha256: "d".repeat(64), runtimePlatform: "linux/amd64" },
    compatibility: { databaseProfiles: ["full_password"], schemaVersions: ["synthetic"], clientApiVersions: [], applicationPort: 3000,
      requiresMigration: false, startupWrites: false } };
  const control = {
    current: null as string | null, commits: 0, failure: false, concurrent: false,
    dispatch: { dispatchToken: null as string | null, dispatchStartedAt: null as string | null,
      dispatchOutcome: null as string | null, dispatchTaskArn: null as string | null },
    dispatchReads: [] as DatabaseValue[][],
  };
  const summary = () => ({ instanceId: scope.appInstanceId, eligible: !control.current, executionId: control.current,
    status: "waiting", step: "approval", approvedAt: control.current ? 10 : null, events: [] });
  const inputs = new WeakMap<DatabasePreparedStatement, DatabaseValue[]>();
  const prepare = (sql: string, params: DatabaseValue[] = []): DatabasePreparedStatement => {
    const statement = {
      bind: (...values: DatabaseValue[]) => prepare(sql, values),
      async first<T>() {
        if (sql.includes('purchase.id AS "purchaseOrderId"')) return target as T;
        if (sql.startsWith("SELECT document")) return { document: release } as T;
        assert.ok(sql.includes('instance.id AS "instanceId"'));
        if (sql.includes('opened.dispatch_started_at AS "dispatchStartedAt"')) {
          assert.match(sql, /^SELECT /);
          assert.match(sql, /JOIN users actor ON actor\.id = \$1 AND actor\.status = 'active' AND actor\.is_platform_admin = 1/);
          assert.match(sql, /WHERE instance\.id = \$2 AND opened\.id = \$3$/);
          assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|FOR UPDATE|FOR SHARE|LOCK)\b/);
          control.dispatchReads.push(params);
          return params[0] === "admin_fixture" && params[1] === scope.appInstanceId && params[2] === control.current
            ? { ...summary(), ...control.dispatch } as T : null;
        }
        return summary() as T;
      },
      async all<T>() { return { results: [] as T[], meta: {} }; },
      async run() { throw Error("unexpected non-transactional write"); },
    };
    inputs.set(statement, params);
    return statement;
  };
  const db: ApplicationDatabase = {
    prepare,
    async batch<T>(statements: DatabasePreparedStatement[]) {
      assert.equal(statements.length, 2);
      const requested = inputs.get(statements[0])?.[3];
      assert.match(String(requested), /^exec_[a-f0-9]{32}$/);
      if (control.failure) throw Error("synthetic transaction failure");
      control.current = control.concurrent ? executionId : String(requested);
      control.commits++;
      return [{ results: [], meta: {} }, { results: [summary() as T], meta: {} }];
    },
  };
  return { instanceId: scope.appInstanceId, db, control };
}

test("only the new committed Web approval notifies; POST stays durable if notification fails and GET cannot trigger", async t => {
  const { instanceId, db, control } = await approvalFixture();
  const errors = t.mock.method(console, "error", () => undefined);
  const notices: string[] = [];
  const handlers = createFirstOpenAdminHandlers({
    authorize: async () => ({ account: { user: { id: "admin_fixture", status: "active", isPlatformAdmin: true } }, response: null }),
    store: () => createFirstOpenAdminStore(db),
    approvalOptions: () => ({ databaseProfile: "full_password", async afterCommit(id) {
      assert.equal(control.commits, 1);
      assert.equal(id, control.current);
      notices.push(id);
      throw Error("synthetic private transport error");
    } }),
  });
  const url = "https://local.example/api/admin/instances/" + instanceId + "/first-open";
  const context = { params: Promise.resolve({ instanceId }) };
  const post = () => handlers.POST(new Request(url, { method: "POST", headers: { origin: "https://local.example" } }), context);
  control.failure = true;
  assert.equal((await post()).status, 503);
  assert.deepEqual(notices, []);
  control.failure = false;
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  assert.equal((await handlers.GET(new Request(url), context)).status, 200);
  const observed = await handlers.GET(new Request(url + "?executionId=" + control.current), context);
  assert.equal(observed.status, 200);
  assert.deepEqual((await observed.json()).data.dispatch, { state: "reservation_not_observed", reservedAt: null, taskArn: null });
  assert.deepEqual(control.dispatchReads, [["admin_fixture", instanceId, control.current]]);
  assert.deepEqual(notices, [control.current]);
  assert.deepEqual(errors.mock.calls.map(call => call.arguments), [["FIRST_OPEN_WEB_INVOKE_UNCONFIRMED"]]);
  const other = await approvalFixture();
  other.control.concurrent = true;
  let lostRaceNotices = 0;
  await createFirstOpenAdminStore(other.db).approve(instanceId, "admin_fixture", {
    databaseProfile: "full_password", async afterCommit() { lostRaceNotices++; },
  });
  assert.equal(lostRaceNotices, 0);
});

test("existing GET binds the exact execution and administrator and returns only persisted dispatch observations", async () => {
  const { instanceId, db, control } = await approvalFixture();
  control.current = executionId;
  const actor = { id: "admin_fixture", status: "active" as const, isPlatformAdmin: true };
  const handlers = createFirstOpenAdminHandlers({
    authorize: async () => ({ account: { user: actor }, response: null }),
    store: () => createFirstOpenAdminStore(db),
    approvalOptions() { assert.fail("GET cannot load the notification capability"); },
  });
  const url = "https://local.example/api/admin/instances/" + instanceId + "/first-open";
  const lookup = (query = "executionId=" + executionId, id = instanceId) =>
    handlers.GET(new Request(url + "?" + query), { params: Promise.resolve({ instanceId: id }) });
  const taskArn = "arn:aws:ecs:ca-central-1:402010193138:task/techlong-sandbox-platform/" + "2".repeat(32);
  const stored = { dispatchToken: executionId, dispatchStartedAt: "19" };
  for (const [dispatch, expected] of [
    [{ ...stored, dispatchOutcome: null, dispatchTaskArn: null }, { state: "reserved", reservedAt: 19, taskArn: null }],
    [{ ...stored, dispatchOutcome: "failed", dispatchTaskArn: null }, { state: "failed", reservedAt: 19, taskArn: null }],
    [{ ...stored, dispatchOutcome: "unknown", dispatchTaskArn: null }, { state: "result_unknown", reservedAt: 19, taskArn: null }],
    [{ ...stored, dispatchOutcome: "acknowledged", dispatchTaskArn: taskArn }, { state: "acknowledged", reservedAt: 19, taskArn }],
    [{ ...stored, dispatchToken: "unrelated", dispatchOutcome: "acknowledged", dispatchTaskArn: taskArn },
      { state: "inconsistent", reservedAt: null, taskArn: null }],
  ] as const) {
    control.dispatch = dispatch;
    const response = await lookup();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { data } = await response.json();
    assert.deepEqual(data.dispatch, expected);
    assert.ok(!Object.hasOwn(data, "dispatchToken"));
    assert.equal(data.execution.id, executionId);
  }
  assert.equal((await lookup("executionId=exec_" + "f".repeat(32))).status, 404);
  assert.equal((await lookup(undefined, "app_other")).status, 404);
  assert.equal((await lookup("executionId=bad")).status, 400);
  assert.equal((await lookup("executionId=" + executionId + "%0A")).status, 400);
  assert.equal((await lookup("executionId=" + executionId + "&executionId=" + executionId)).status, 400);
  actor.isPlatformAdmin = false;
  assert.equal((await lookup()).status, 403);
  assert.equal(control.dispatchReads.length, 7);
  assert.equal(control.commits, 0);
});
