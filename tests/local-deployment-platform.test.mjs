import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { localPlatformPlan, localPlatformEnvironment, localPlatformWorkerConfig } from '../scripts/local-deployment-platform.mjs';

test('local launcher is loopback-only, strict-port, request-OFF by default, never a worker/publisher', () => {
  const plan = localPlatformPlan();
  assert.equal(plan.origin, 'http://127.0.0.1:3100');
  assert.deepEqual(plan.viteArgs, ['--host', '127.0.0.1', '--port', '3100', '--strictPort']);
  for (const key of ['requestEntryEnabled', 'workerEnabled', 'awsApplyEnabled', 'publishesSite', 'startsAwsDeployment', 'editsEnvironmentFiles'])
    assert.equal(plan[key], false);
  assert.equal(localPlatformPlan(['--enable-request-entry']).requestEntryEnabled, true);
  for (const args of [['--host', '0.0.0.0'], ['--publish'], ['--enable-request-entry', '--check'], ['--requests=true']])
    assert.throws(() => localPlatformPlan(args));
});

test('inherited gates cannot enable preview; runtime config contains secret names only, not values', () => {
  const env = localPlatformEnvironment({ AWS_INITIALIZED_REQUESTS_ENABLED: 'true', DEPLOYMENT_WORKER_ENABLED: 'true',
    AWS_APPLY_ENABLED: 'true', DATABASE_URL: 'process-fixture', AWS_SECRET_ACCESS_KEY: 'unrelated-fixture' },
  localPlatformPlan());
  assert.equal(env.AWS_INITIALIZED_REQUESTS_ENABLED, 'false');
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'true');
  assert.equal(env.CLOUDFLARE_INCLUDE_PROCESS_ENV, 'true');
  assert.equal(env.WRANGLER_WRITE_LOGS, 'false');
  assert.equal(env.WRANGLER_LOG_PATH, '.wrangler/logs');
  assert.equal(env.DEPLOYMENT_WORKER_ENABLED, 'false');
  assert.equal(env.AWS_APPLY_ENABLED, 'false');
  const config = localPlatformWorkerConfig(env);
  assert.equal(config.vars, undefined);
  assert.ok(config.secrets.required.includes('DATABASE_URL'));
  assert.ok(config.secrets.required.includes('AWS_INITIALIZED_REQUESTS_ENABLED'));
  assert.ok(!config.secrets.required.includes('AWS_SECRET_ACCESS_KEY'));
  assert.ok(!JSON.stringify(config).includes('process-fixture'));
  assert.equal(localPlatformWorkerConfig({}), undefined);
});

test('explicit request opt-in only enables request persistence, not worker or AWS apply', () => {
  const env = localPlatformEnvironment({}, localPlatformPlan(['--enable-request-entry']));
  assert.equal(env.AWS_INITIALIZED_REQUESTS_ENABLED, 'true');
  assert.equal(env.DEPLOYMENT_WORKER_ENABLED, 'false');
  assert.equal(env.AWS_APPLY_ENABLED, 'false');
});

test('Check is credential-free and cannot start a server', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/local-deployment-platform.mjs', '--check'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'not-a-dsn', AWS_INITIALIZED_REQUESTS_ENABLED: 'true' },
  }));
  assert.equal(result.mode, 'Check');
  assert.equal(result.requestEntryEnabled, false);
  assert.equal(result.startsAwsDeployment, false);
});
