import assert from "node:assert/strict";
import { canEnterCustomerApplication, getCustomerApplicationMessage } from "../lib/customer-dashboard/presentation.ts";
import { createFirstOpenAdminHandlers } from "../lib/deployments/first-open-admin-http.ts";
import { createFirstOpenAdminStore } from "../lib/deployments/first-open-admin-store.ts";
import { COMPLETE_ECS_FIRST_OPEN, READ_ECS_FIRST_OPEN_COMPLETION } from "../lib/deployments/execution/ecs-first-open-completion.ts";
import { createEcsFirstOpenTaskPorts } from "../lib/deployments/execution/ecs-first-open-runtime.ts";
import { dispatchEcsFirstOpen } from "../lib/deployments/execution/ecs-first-open-dispatch.ts";
import { createFirstOpenDispatchStore } from "../lib/deployments/execution/ecs-first-open-dispatch-store.ts";
import { RepositoryTenantExternalOwnershipCoordinator } from "../lib/deployments/execution/external-ownership-coordinator.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { NeonDeploymentExecutionRepository } from "../lib/deployments/execution/neon-repository.ts";
import {
  firstOpenVisibilityJoins, visibleFirstOpenAccessUrl, visibleFirstOpenProvisionedAt, visibleFirstOpenStatus,
} from "../lib/instances/first-open-visibility.ts";
import {
  adminA, applicationDb, approveRequest, bodyOf, endpoint, params, postgresTransport, seedDatabase, snapshot, withDisposablePostgres,
} from "./first-open-postgres-fixture.mjs";

const clusterArn = "arn:aws:ecs:ca-central-1:123456789012:cluster/first-open-fixture";
const taskDefinitionArn = "arn:aws:ecs:ca-central-1:123456789012:task-definition/first-open-fixture:1";
const taskArn = `arn:aws:ecs:ca-central-1:123456789012:task/first-open-fixture/${"0".repeat(31)}1`;
const placement = {
  clusterArn, taskDefinitionArn, containerName: "platform",
  subnetIds: ["subnet-0123456789abcdef0"],
  securityGroupIds: ["sg-0123456789abcdef0"],
};
const privateCanary = "t3-private-error-canary";

async function installSyntheticEnvironment(db, fixture, instance) {
  const { environment, binding } = fixture.context;
  await db.query("UPDATE deployment_environments SET policy=$2 WHERE id=$1", [environment.id, JSON.stringify(environment.policy)]);
  await db.query(`INSERT INTO deployment_environment_bindings (environment_id,worker_role_arn,cloudformation_role_arn,
    tenant_stack_parameters,status,created_at,updated_at) VALUES ($1,$2,$3,$4,'active',$5,$5)`,
    [environment.id, binding.workerRoleArn, binding.cloudFormationRoleArn, JSON.stringify(binding.tenantStackParameters), Date.now()]);
  const { rows: [deployment] } = await db.query("SELECT created_at FROM app_instance_deployments WHERE id=$1", [instance.deploymentId]);
  fixture.readiness.expiresAt = Number(deployment.created_at) + environment.policy.ttlSeconds * 1000;
}

const scenarios = [
  { label: "one launch, one claim, fresh self-check, atomic revision zero and page readback", status: "succeeded", step: "activation" },
  { label: "launch accepted but acknowledgement lost", fault: "launch", status: "unknown", step: "task_start" },
  { label: "known migration failure", fault: "migration", status: "failed", step: "database_initialization" },
  { label: "observed image digest mismatch", fault: "self_check", status: "failed", step: "self_check" },
  { label: "commit acknowledged but activation readback lost", fault: "readback", status: "unknown", step: "activation" },
  { label: "activation committed but commit acknowledgement lost", fault: "commit_ack", status: "unknown", step: "activation" },
  { label: "activation rolls back all four writes when one update is suppressed", fault: "rollback", status: "unknown", step: "activation" },
];

async function customerPageState(client, instanceId) {
  const { rows: [row] } = await client.query(`SELECT ${visibleFirstOpenStatus} AS "appInstanceStatus",
    ${visibleFirstOpenAccessUrl} AS "accessUrl", ${visibleFirstOpenProvisionedAt} AS "provisionedAt",
    subscription.status AS "subscriptionStatus", subscription.current_period_end AS "currentPeriodEnd"
    FROM app_instances ai JOIN subscriptions subscription ON subscription.id=ai.subscription_id
    ${firstOpenVisibilityJoins} WHERE ai.id=$1`, [instanceId]);
  return { ...row, currentPeriodEnd: Number(row.currentPeriodEnd) };
}

function assertProgressPath(progress, scenario) {
  const expected = [["approval", "completed"], ["task_start", "started"]];
  if (scenario.fault === "launch") expected.push(["task_start", "unknown"]);
  else {
    expected.push(["task_start", "completed"], ["database_initialization", "started"]);
    if (scenario.fault === "migration") expected.push(["database_initialization", "failed"]);
    else {
      expected.push(["database_initialization", "completed"], ["api_deployment", "started"],
        ["api_deployment", "completed"], ["self_check", "started"]);
      if (scenario.fault === "self_check") expected.push(["self_check", "failed"]);
      else expected.push(["self_check", "completed"], ["activation", "started"],
        ["activation", scenario.status === "unknown" ? "unknown" : "completed"]);
    }
  }
  assert.deepEqual(progress.events.map(({ step, status }) => [step, status]), expected);
}

export async function verifyFirstOpenT3(t, pgBin, helpers) {
  for (const scenario of scenarios) {
    await t.test(scenario.label, async () => withDisposablePostgres(pgBin, async connect => {
      const client = await connect();
      const concurrent = await connect();
      const readback = await connect();
      for (const connection of [client, concurrent, readback]) await connection.query("SET statement_timeout='20s'");
      await readback.query("SET default_transaction_read_only=on");
      const { rows: [version] } = await client.query("SHOW server_version");
      assert.match(version.server_version, /^16\.14(?:\s|$)/);
      const fixture = await helpers.createFixture();
      const [a, b] = await seedDatabase(client, fixture);
      assert.equal(a.jobId, fixture.row.job.id);
      await installSyntheticEnvironment(client, fixture, a);
      if (scenario.fault === "rollback") {
        await client.query(`CREATE FUNCTION fixture_suppress_active() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RETURN NULL; END $$;
          CREATE TRIGGER fixture_activation_rollback BEFORE UPDATE ON app_instances
          FOR EACH ROW WHEN (NEW.status='active') EXECUTE FUNCTION fixture_suppress_active();`);
      }
      const before = await snapshot(client);
      const queryErrors = [];
      const trace = connection => ({
        async query(...args) {
          try {
            return await connection.query(...args);
          } catch (error) {
            queryErrors.push([error.code, error.message]);
            throw error;
          }
        },
      });
      const db = applicationDb(trace(client));
      const dispatchDb = applicationDb(concurrent);
      const readDb = applicationDb(trace(readback));
      const handler = createFirstOpenAdminHandlers({
        authorize: async () => ({ account: { user: adminA }, response: null }),
        store: () => createFirstOpenAdminStore(db),
      });
      const approve = () => handler.POST(approveRequest(a.id), params(a.id)).then(bodyOf);
      const logs = id => handler.GET(new Request(endpoint(id)), params(id)).then(bodyOf);
      assert.equal((await logs(a.id)).execution, null);
      assert.equal((await logs(b.id)).execution, null);
      const { id: executionId, status: initialStatus } = await approve();
      assert.equal(initialStatus, "waiting");

      // The simulated ECS service accepts a task once in all scenarios,
      // including the case where the dispatcher never receives its response.
      const launches = [];
      const ecs = { async runTask(request) {
        launches.push(request);
        if (scenario.fault === "launch") throw Error(privateCanary);
        return { tasks: [{ taskArn, clusterArn, taskDefinitionArn }], failures: [] };
      } };
      const dispatch = storeDb => dispatchEcsFirstOpen(executionId, placement, {
        store: createFirstOpenDispatchStore(storeDb), ecs,
      });
      const dispatched = await Promise.all([dispatch(db), dispatch(dispatchDb)]);
      assert.equal(launches.length, 1);
      assert.ok(dispatched.some(result => result.status === (scenario.fault === "launch" ? "unknown" : "acknowledged")));
      assert.deepEqual(launches[0], {
        cluster: clusterArn, taskDefinition: taskDefinitionArn, count: 1, clientToken: executionId, launchType: "FARGATE",
        networkConfiguration: { awsvpcConfiguration: {
          subnets: placement.subnetIds, securityGroups: placement.securityGroupIds, assignPublicIp: "DISABLED",
        } },
        overrides: { containerOverrides: [{ name: placement.containerName,
          command: ["node", "ops/platform-hosting-v1/first-open.mjs", executionId] }] },
      });

      // Use the production lease, generation, epoch, checkpoint and deployment
      // statements. Substituted ports model only provider and app observations.
      const repository = new NeonDeploymentExecutionRepository("postgres://fixture.invalid", undefined, () => postgresTransport(client));
      const calls = fixture.calls;
      const pids = [];
      const mark = step => { calls.push(step); pids.push(process.pid); };
      const ownership = new RepositoryTenantExternalOwnershipCoordinator(repository, {
        async installAndObserve({ pendingFence }) {
          mark("ownership");
          const evidence = { observedMarker: pendingFence.marker, provisionPredecessor: null };
          return { schemaVersion: 1, pendingFence, evidence, evidenceHash: await sha256Hex(evidence), provisionPredecessor: null };
        },
      });
      const { options, context, release } = fixture;
      const { baselineDigest, databaseSchemaVersion, dnsTarget } = options.approval;
      const originalReader = options.independentReader;
      const reader = {
        async capture(request) {
          pids.push(process.pid);
          const evidence = await originalReader.capture(request);
          if (scenario.fault === "self_check") evidence.facts.tasks[0].containers[0].imageDigest = `sha256:${"f".repeat(64)}`;
          return evidence;
        },
      };
      const dependencies = {
        ...options.dependencies, repository, tenantExternalOperationCoordinator: ownership,
        tenantDatabase: {
          async ensureTenantDatabase({ context: claimed }) {
            mark("prepare");
            return helpers.tenantLifecycleOutput(claimed, "empty");
          },
          async migrateTenantDatabase({ context: claimed }) {
            mark("migrate");
            if (scenario.fault === "migration") throw Object.assign(Error(privateCanary),
              { code: "TENANT_MIGRATION_FAILED", retryable: false });
            context.tenantResources = claimed.tenantResources;
            return helpers.tenantLifecycleOutput(claimed, "verified");
          },
        },
      };
      // Observe the real transaction through a fresh connection before simulating its lost readback.
      let activationReads = 0;
      let readResponsesDropped = 0;
      const completionReadDb = { prepare(sql) {
        const query = readDb.prepare(sql);
        if (sql !== READ_ECS_FIRST_OPEN_COMPLETION) return query;
        return { bind: (...args) => ({ first: async () => {
          ++activationReads;
          const result = await query.bind(...args).first();
          if (scenario.fault === "readback") {
            assert.deepEqual(result, { instanceId: a.id, revision: 0 });
            const { rows } = await readback.query(`SELECT ai.status, ai.access_url, deployment.status AS deployment_status,
              job.status AS job_status, release_state.revision
              FROM app_instances ai JOIN app_instance_deployments deployment ON deployment.id=$2 AND deployment.app_instance_id=ai.id
              JOIN deployment_jobs job ON job.id=$3 AND job.deployment_id=deployment.id
              JOIN deployment_release.instance_state release_state ON release_state.instance_id=ai.id WHERE ai.id=$1`,
              [a.id, a.deploymentId, a.jobId]);
            assert.deepEqual(rows, [{ status: "active", access_url: `https://${options.approval.hostname}`,
              deployment_status: "ready", job_status: "succeeded", revision: "0" }]);
            assert.equal(canEnterCustomerApplication(await customerPageState(readback, a.id)), false);
            ++readResponsesDropped;
            throw Error(privateCanary);
          }
          return result;
        } }) };
      } };
      let commitResponsesDropped = 0;
      const taskDb = scenario.fault === "commit_ack" ? { prepare(sql) {
        const query = db.prepare(sql);
        if (sql !== COMPLETE_ECS_FIRST_OPEN) return query;
        return { bind: (...args) => ({ first: async () => {
          assert.deepEqual(await query.bind(...args).first(), { instanceId: a.id, committed: 1 });
          ++commitResponsesDropped;
          throw Error(privateCanary);
        } }) };
      } } : db;
      const writeBefore = Date.now() + 120_000;
      const createTaskPorts = helpers.createTaskPorts ?? createEcsFirstOpenTaskPorts;
      const command = () => helpers.runFirstOpenCommand(launches[0].overrides.containerOverrides[0].command.slice(2),
        async () => createTaskPorts({
          db: taskDb, readDb: completionReadDb, taskArn, taskDefinitionArn, writeBefore, baselineDigest, databaseSchemaVersion, dnsTarget, reader,
          management: { dependencies, config: options.config, cleanupReadiness: options.cleanupReadiness },
        }));
      if (scenario.fault === "launch" || scenario.fault === "migration" || scenario.fault === "self_check") {
        await assert.rejects(command());
      } else {
        const result = await command();
        assert.equal(result.executionId, executionId);
        assert.equal(result.jobId, a.jobId);
        assert.equal(result.runtime.instanceId, a.id);
        const progress = await logs(a.id);
        assert.equal(result.completion?.outcome, scenario.fault ? "unknown" : "activated",
          JSON.stringify({ events: progress.events.map(e => [e.step, e.status]), activationReads, queryErrors }));
      }
      const expectedCalls = {
        launch: [],
        migration: ["ownership", "prepare", "migrate"],
      }[scenario.fault] ?? ["ownership", "prepare", "migrate", "create", "configure", "inspect"];
      assert.deepEqual(calls, expectedCalls);
      assert.ok(pids.every(pid => pid === process.pid));
      assert.equal(activationReads, !scenario.fault || scenario.fault === "readback" ? 1 : 0);
      assert.equal(readResponsesDropped, scenario.fault === "readback" ? 1 : 0);
      assert.equal(commitResponsesDropped, scenario.fault === "commit_ack" ? 1 : 0);
      assert.deepEqual(queryErrors.map(([code]) => code), scenario.fault === "rollback" ? ["22012"] : []);

      const progress = await logs(a.id);
      assert.deepEqual([progress.execution.id, progress.execution.status, progress.execution.step], [executionId, scenario.status, scenario.step]);
      assertProgressPath(progress, scenario);
      assert.doesNotMatch(JSON.stringify(progress), new RegExp(privateCanary));
      assert.equal((await logs(b.id)).execution, null);
      const customerPage = await customerPageState(readback, a.id);
      const confirmed = scenario.status === "succeeded";
      assert.equal(customerPage.appInstanceStatus, confirmed ? "active" : scenario.status === "failed" ? "failed" : "pending");
      assert.equal(customerPage.accessUrl, confirmed ? `https://${options.approval.hostname}` : "");
      assert.equal(customerPage.provisionedAt !== null, confirmed);
      assert.equal(canEnterCustomerApplication(customerPage), confirmed);
      assert.match(getCustomerApplicationMessage(customerPage),
        confirmed ? /已开通/ : scenario.status === "failed" ? /开通失败/ : /等待开通/);
      assert.equal((await customerPageState(readback, b.id)).appInstanceStatus, "pending");
      const after = await snapshot(client);
      assert.equal(after.executions.length, 1);
      assert.equal(after.executions[0].dispatch_token, executionId);
      assert.equal(after.executions[0].dispatch_task_arn, scenario.fault === "launch" ? null : taskArn);
      assert.equal(after.executions[0].dispatch_task_definition_arn, scenario.fault === "launch" ? null : placement.taskDefinitionArn);
      assert.equal(after.executions[0].dispatch_outcome, scenario.fault === "launch" ? "unknown" : "acknowledged");
      for (const [collection, id] of [["instances", b.id], ["deployments", b.deploymentId], ["jobs", b.jobId]]) {
        assert.deepEqual(after[collection].find(row => row.id === id), before[collection].find(row => row.id === id));
      }
      const committed = !scenario.fault || scenario.fault === "readback" || scenario.fault === "commit_ack";
      const job = after.jobs.find(row => row.id === a.jobId);
      const instance = after.instances.find(row => row.id === a.id);
      const deployment = after.deployments.find(row => row.id === a.deploymentId);
      const { rows: bindings } = await client.query("SELECT instance_id,current_release_id,revision,binding,last_evidence FROM deployment_release.instance_state");
      assert.equal(job.attempts, scenario.fault === "launch" ? 0 : 1);
      assert.equal(bindings.length, committed ? 1 : 0);
      if (committed) {
        assert.equal(instance.status, "active");
        assert.equal(instance.access_url, `https://${options.approval.hostname}`);
        assert.equal(deployment.status, "ready");
        assert.equal(job.status, "succeeded");
        assert.deepEqual([bindings[0].instance_id, bindings[0].current_release_id, Number(bindings[0].revision)], [a.id, release.id, 0]);
        assert.equal(bindings[0].binding.currentRelease.manifestDigest, release.image.manifestDigest);
        assert.equal(bindings[0].last_evidence.executionId, executionId);
        assert.equal(bindings[0].last_evidence.jobId, a.jobId);
      } else {
        assert.equal(instance.status, "pending");
        assert.equal(instance.access_url, "");
        assert.notEqual(deployment.status, "ready");
        assert.notEqual(job.status, "succeeded");
      }

      // A replacement dispatcher and repeated button/task invocations consume
      // the same durable intent and can perform no second opening.
      await dispatch(dispatchDb);
      const repeated = await approve();
      assert.deepEqual(repeated, progress.execution);
      await assert.rejects(command());
      assert.deepEqual(calls, expectedCalls);
      assert.equal(launches.length, 1);
      assert.deepEqual(await snapshot(client), after);
    }));
  }
}
