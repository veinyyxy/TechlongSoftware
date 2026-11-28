/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS entry point for the GitHub JavaScript action. */
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { lstatSync, readFileSync, realpathSync } = require('node:fs');
const { join, resolve } = require('node:path');

function launch(env) {
  const role = env.INPUT_ROLE;
  if ((role !== 'publisher' && role !== 'reader') || !env.GITHUB_EVENT_PATH || !env.GITHUB_WORKSPACE ||
    !env.ACTIONS_RUNTIME_TOKEN || !env.ACTIONS_RESULTS_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ||
    !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.GH_TOKEN) throw Error();

  const { inputs } = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const sameDigest = (text, expected, cap) => typeof text === 'string' && Buffer.byteLength(text) <= cap &&
    /^[a-f0-9]{64}$/.test(expected) && createHash('sha256').update(text).digest('hex') === expected;
  if (!inputs || inputs.approved_sha256 !== env.TECHLONG_T42_ECR_APPROVAL_SHA ||
    inputs.source_sha256 !== env.TECHLONG_T42_ECR_SOURCE_SHA || inputs.source_commit !== env.TECHLONG_T42_ECR_RUNTIME_COMMIT ||
    !/^[a-f0-9]{40}$/.test(inputs.source_commit) || !sameDigest(inputs.review_text, inputs.approved_sha256, 20_000) ||
    !sameDigest(inputs.source_text, inputs.source_sha256, 16_383)) throw Error();

  const workspace = realpathSync(env.GITHUB_WORKSPACE);
  const entry = join(workspace, 'ops', 'releases', 'first-open-ecr-hosted-entry.mjs');
  const bundle = join(workspace, '.t42-ecr-artifact-action', 'dist', 'upload', 'index.js');
  if (workspace !== resolve(__dirname, '../../..') || ![entry, bundle].every(path => lstatSync(path).isFile() &&
    realpathSync(path) === path)) throw Error();

  // A JavaScript action has the runner artifact scope for this job. Review
  // documents stay in the event file and child environment rather than YAML step logs.
  const result = spawnSync('node', ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', entry, role], {
    cwd: workspace, shell: false, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...env, TECHLONG_T42_ECR_REVIEW_TEXT: inputs.review_text, TECHLONG_T42_ECR_SOURCE_TEXT: inputs.source_text,
      TECHLONG_T42_ECR_UPLOAD_BUNDLE_PATH: bundle, TECHLONG_T42_ECR_ARTIFACT_NODE: process.execPath },
  });
  if (result.error || result.signal || result.status === null) throw Error();
  return result.status;
}

try {
  process.exitCode = launch(process.env);
} catch {
  console.error('T42_ECR_PROTECTED_LAUNCH_REFUSED');
  process.exitCode = 1;
}
