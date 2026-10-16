// Local admin UI only. This never starts a worker, publishes a site or calls AWS.
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const LOCAL_PLATFORM_HOST = '127.0.0.1';
export const LOCAL_PLATFORM_PORT = 3100;
export const LOCAL_PLATFORM_MODE = 'TECHLONG_LOCAL_DEPLOYMENT_PLATFORM';
export const LOCAL_PLATFORM_BINDINGS = Object.freeze([
  'DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'AUTH_SESSION_DAYS', 'NEXT_PUBLIC_PLATFORM_NAME',
]);

export function localPlatformPlan(args = []) {
  if (args.length > 1 || (args.length && !['--check', '--enable-request-entry'].includes(args[0])))
    throw new Error('Use no arguments, --check, or --enable-request-entry (only after separate approval).');
  const requestEntryEnabled = args[0] === '--enable-request-entry';
  return Object.freeze({ mode: args[0] === '--check' ? 'Check' : 'Serve',
    origin: `http://${LOCAL_PLATFORM_HOST}:${LOCAL_PLATFORM_PORT}`, requestEntryEnabled,
    workerEnabled: false, awsApplyEnabled: false, publishesSite: false,
    startsAwsDeployment: false, editsEnvironmentFiles: false,
    viteArgs: ['--host', LOCAL_PLATFORM_HOST, '--port', String(LOCAL_PLATFORM_PORT), '--strictPort'] });
}

export function localPlatformEnvironment(inherited, plan) {
  // Vinext/Wrangler load the existing ignored env file. Do not copy its values
  // into config.vars (build output), log them or persist a new .dev.vars.
  const controls = { [LOCAL_PLATFORM_MODE]: 'true',
    AWS_INITIALIZED_REQUESTS_ENABLED: plan.requestEntryEnabled ? 'true' : 'false',
    DEPLOYMENT_WORKER_ENABLED: 'false', AWS_APPLY_ENABLED: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'true', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
    WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_PATH: '.wrangler/logs',
    MINIFLARE_REGISTRY_PATH: '.wrangler/registry',
    WRANGLER_SEND_METRICS: 'false', DO_NOT_TRACK: '1' };
  const names = new Set(Object.keys(controls).map(key => key.toLowerCase()));
  return { ...Object.fromEntries(Object.entries(inherited).filter(([key]) => !names.has(key.toLowerCase()))), ...controls };
}

export function localPlatformWorkerConfig(environment) {
  if (environment[LOCAL_PLATFORM_MODE] !== 'true') return undefined;
  // An explicit secrets allowlist prevents forwarding unrelated host AWS keys.
  // Wrangler includes process.env with precedence, so file values cannot open
  // the request/worker gates. Config contains NAMES only, never secret values.
  return { secrets: { required: [...LOCAL_PLATFORM_BINDINGS,
    'AWS_INITIALIZED_REQUESTS_ENABLED', 'DEPLOYMENT_WORKER_ENABLED', 'AWS_APPLY_ENABLED'] } };
}

export async function main(args = process.argv.slice(2)) {
  const plan = localPlatformPlan(args);
  if (path.resolve(process.cwd()).toLowerCase() !== path.resolve(ROOT).toLowerCase())
    throw new Error('Run from the platform repository root.');
  // Check never reads credentials/config files or starts a child process.
  console.log(JSON.stringify(plan, null, 2));
  if (plan.mode === 'Check') return;
  // Wrangler gives .dev.vars precedence over config vars. Refuse the ambiguity,
  // including environment variants, rather than silently shadowing closed gates.
  if ((await readdir(ROOT)).some(name => name.toLowerCase() === '.dev.vars' || name.toLowerCase().startsWith('.dev.vars.')))
    throw new Error('Local .dev.vars files are not supported by this launcher. No server started.');
  const environment = localPlatformEnvironment(process.env, plan);
  const vite = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  await access(vite);
  const child = spawn(process.execPath, [vite, ...plan.viteArgs], {
    cwd: ROOT, env: environment, stdio: 'inherit', shell: false,
  });
  const stop = signal => { if (!child.killed) child.kill(signal); };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
    });
    process.exitCode = code;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(() => { console.error('LOCAL_PLATFORM_STOPPED: no automatic restart. Check local configuration; no credentials logged.'); process.exitCode = 1; });
