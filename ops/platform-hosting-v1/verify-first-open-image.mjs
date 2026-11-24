import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = /^sha256:[a-f0-9]{64}$/;
const containerId = /^[a-f0-9]{64}$/;
const imageId = value => containerId.test(value) ? `sha256:${value}` : value;
const opening = 'ops/platform-hosting-v1/first-open.mjs';
const dependencyLine = 'T1_OPENING_IMAGE_DEPENDENCIES ';
const executionId = `exec_${'9'.repeat(32)}`;
const testPrefix = '^ECS first open ';
const isolated = ['--pull', 'never', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256'];

export async function buildFirstOpenImageFixture() {
  const {build} = await import('vite');
  const result = await build({
    root, configFile: false, envDir: false, publicDir: false, logLevel: 'silent',
    plugins: [{name: 'first-open-image-entry', enforce: 'pre', resolveId(source) {
      if (source === '../ops/platform-hosting-v1/first-open.ts') return {id: `/app/${opening}`, external: 'absolute'};
    }}],
    build: {ssr: path.join(root, 'tests/deployment-s3-worker.test.ts'), target: 'node22', write: false,
      rolldownOptions: {output: {codeSplitting: false}}},
  });
  assert(!Array.isArray(result) && result.output.length === 1, 'T1_OPENING_FIXTURE_OUTPUT');
  const [fixture] = result.output;
  assert(fixture.type === 'chunk' && fixture.imports.includes(`/app/${opening}`), 'T1_OPENING_FIXTURE_ENTRY');
  return `import {checkFirstOpenImageDependencies} from '/app/${opening}';\n` +
    `console.log('${dependencyLine}' + JSON.stringify(await checkFirstOpenImageDependencies()));\n` + fixture.code;
}

function localEngine(engine, config) {
  const host = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
  const engineArgs = engine === 'podman' ? ['--remote=false'] : ['--config', config, '--host', host];
  const allow = new Set(['path', 'systemroot', 'windir', 'temp', 'tmp']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allow.has(key.toLowerCase())));
  return (args, {input, timeout = 15_000, allowFailure = false} = {}) => {
    const result = spawnSync(engine, [...engineArgs, ...args], {
      input, timeout, env, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024,
    });
    const errorPrefix = `T1_LOCAL_${engine.toUpperCase()}`;
    if (result.error) throw Error(`${errorPrefix}_${result.error.code ?? 'START_FAILED'}`);
    if (result.status !== 0 && !allowFailure) throw Error(`${errorPrefix}_${args[0].toUpperCase()}_${args[1]?.toUpperCase() ?? 'FAILED'}`);
    return result;
  };
}

export async function verifyFirstOpenImage(digest, docker) {
  assert(sha.test(digest), 'T1_IMAGE_CONFIG_DIGEST');
  const inspected = JSON.parse(docker(['image', 'inspect', '--format', '{{json .}}', digest]).stdout);
  assert.equal(imageId(inspected.Id), digest, 'T1_IMAGE_INSPECTION_DIGEST');
  assert.equal(inspected.Os, 'linux', 'T1_IMAGE_OS');
  assert.equal(inspected.Architecture, 'amd64', 'T1_IMAGE_ARCHITECTURE');
  assert.equal(inspected.Config.User, 'node', 'T1_IMAGE_USER');
  assert.equal(inspected.Config.WorkingDir, '/app', 'T1_IMAGE_WORKDIR');
  assert.deepEqual(inspected.Config.Cmd, ['node', 'ops/platform-hosting-v1/start.mjs'], 'T1_IMAGE_WEB_DEFAULT');
  assert.deepEqual(inspected.Config.Entrypoint, ['docker-entrypoint.sh'], 'T1_IMAGE_ENTRYPOINT');
  assert(!(inspected.Config.Env ?? []).some(value => /^(?:AWS_|CI=|GITHUB_|STRIPE_|DATABASE_URL=|NODE_OPTIONS=)/.test(value)), 'T1_IMAGE_RUNTIME_ENV');

  const fixture = await buildFirstOpenImageFixture();
  const withContainer = (args, inspect) => {
    const id = docker(['container', 'create', ...isolated, ...args]).stdout.trim();
    assert(containerId.test(id), 'T1_CONTAINER_ID');
    try {
      const state = docker(['container', 'inspect', '--format', '{{.Image}} {{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}}', id]);
      const [bound, network, readonly, ...rest] = state.stdout.trim().split(/\s+/);
      assert.deepEqual([imageId(bound), network, readonly, ...rest], [digest, 'none', 'true'], 'T1_CONTAINER_ISOLATION');
      return inspect(id);
    } finally {
      docker(['container', 'rm', '--force', id]);
    }
  };
  const web = withContainer([digest], id => {
    docker(['container', 'start', id]);
    const result = docker(['container', 'exec', id, 'node', 'ops/platform-hosting-v1/smoke.mjs'], {timeout: 180_000});
    const evidence = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(evidence.outcome, 'NODE_HOSTING_ANONYMOUS_SMOKE_PASSED', 'T1_WEB_SMOKE');
    return evidence;
  });
  const openingDirect = withContainer([digest, 'node', opening, executionId], id => {
    const result = docker(['container', 'start', '--attach', id], {allowFailure: true, timeout: 30_000});
    const state = docker(['container', 'inspect', '--format', '{{.State.Status}} {{.State.ExitCode}}', id]);
    assert.equal(state.stdout.trim(), 'exited 1', 'T1_OPENING_DIRECT_EXIT');
    assert.equal(result.stderr.trim(), 'ECS_FIRST_OPEN_RUNTIME_UNAVAILABLE', 'T1_OPENING_DIRECT_PREFLIGHT');
    return result.stderr.trim();
  });
  const openingFixture = withContainer(['--interactive', digest, 'node', '--input-type=module', '--test-reporter=tap', '--test-name-pattern', testPrefix, '-'], id => {
    const result = docker(['container', 'start', '--attach', '--interactive', id], {input: fixture, timeout: 60_000});
    const lines = result.stdout.split(/\r?\n/);
    const dependency = lines.find(line => line.startsWith(dependencyLine));
    assert(dependency, 'T1_OPENING_DEPENDENCY_EVIDENCE');
    assert(lines.includes('# tests 3') && lines.includes('# pass 3') && lines.includes('# fail 0'), 'T1_OPENING_SYNTHETIC_CASES');
    return {dependencies: JSON.parse(dependency.slice(dependencyLine.length)), testsPassed: 3};
  });
  return {outcome: 'T1_OFFLINE_SAME_IMAGE_PASSED', imageConfigDigest: digest, web, openingDirect, openingFixture};
}

async function main(args) {
  assert((args.length === 1 || (args.length === 2 && args[1] === '--podman')) && sha.test(args[0]), 'T1_EXPECTS_LOCAL_IMAGE_CONFIG_DIGEST');
  if (args[1] === '--podman') return verifyFirstOpenImage(args[0], localEngine('podman'));
  const config = await mkdtemp(path.join(tmpdir(), 'techlong-t1-docker-'));
  try {
    return await verifyFirstOpenImage(args[0], localEngine('docker', config));
  } finally {
    await rmdir(config);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
