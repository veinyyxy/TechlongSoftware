import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { t42RawEcrTargets } from './first-open-ecr-raw-artifacts.mjs';

const repositoryId = 1323312747;
const names = Object.freeze({ platform: 'platform.oci.tar.gz', tenant: 'candidate.oci.tar.gz' });
const types = ['platform', 'tenant'];
const selectors = ['runId', 'artifactId', 'headSha', 'artifactDigest'];

function requireHandoff(condition, code) {
  if (!condition) throw Error(`T42_ECR_HANDOFF_${code}`);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function checkMetadata(approval, artifacts) {
  requireHandoff(exactKeys(approval, ['repositoryId', 'artifacts']) && approval.repositoryId === repositoryId &&
    exactKeys(approval.artifacts, types) && exactKeys(artifacts, types), 'METADATA_SCOPE');
  const artifactIds = new Set();
  for (const target of t42RawEcrTargets) {
    const expected = approval.artifacts[target.short];
    const observed = artifacts[target.short];
    requireHandoff(exactKeys(expected, selectors) && positiveId(expected.runId) && positiveId(expected.artifactId) &&
      typeof expected.headSha === 'string' && /^[a-f0-9]{40}$/.test(expected.headSha) &&
      typeof expected.artifactDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(expected.artifactDigest) &&
      !artifactIds.has(expected.artifactId), 'APPROVED_SELECTORS');
    artifactIds.add(expected.artifactId);
    requireHandoff(exactKeys(observed, [...selectors, 'repositoryId', 'archiveSHA', 'archiveBytes']) &&
      observed.repositoryId === repositoryId && selectors.every(key => observed[key] === expected[key]) &&
      observed.archiveSHA === target.archiveSHA && observed.archiveBytes === target.archiveBytes, 'OBSERVED_SELECTORS');
  }
}

const sameObject = (before, after) => before.dev === after.dev && before.ino === after.ino;
const sameFile = (before, after) => after.isFile() && after.nlink === 1n && sameObject(before, after) &&
  before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;

async function readArchive(directory, target) {
  const path = join(directory, names[target.short]);
  requireHandoff(dirname(path) === directory, 'ARCHIVE_PATH');
  const before = await lstat(path, { bigint: true });
  requireHandoff(before.isFile() && before.nlink === 1n && before.size === BigInt(target.archiveBytes) &&
    await realpath(path) === path, 'ARCHIVE_FILE');
  const handle = await open(path, 'r');
  try {
    requireHandoff(sameFile(before, await handle.stat({ bigint: true })), 'ARCHIVE_FILE');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ start: 0, end: target.archiveBytes - 1, autoClose: false })) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    requireHandoff(bytes === target.archiveBytes && hash.digest('hex') === target.archiveSHA, 'ARCHIVE_DIGEST');
    requireHandoff(sameFile(before, await handle.stat({ bigint: true })) &&
      sameFile(before, await lstat(path, { bigint: true })) && await realpath(path) === path, 'ARCHIVE_FILE_CHANGED');
    return path;
  } finally {
    await handle.close();
  }
}

/** The protected caller provides reviewed selectors and authenticated transport metadata. */
export async function resolveT42RawEcrHandoff({ reviewedDirectory, approval, artifacts } = {}) {
  checkMetadata(approval, artifacts);
  requireHandoff(typeof reviewedDirectory === 'string' && isAbsolute(reviewedDirectory), 'DIRECTORY');
  const directory = resolve(reviewedDirectory);
  const { root } = parse(directory);
  requireHandoff(directory !== root && directory === reviewedDirectory &&
    (process.platform !== 'win32' || (/^[A-Za-z]:\\$/.test(root) && !directory.slice(root.length).includes(':'))), 'DIRECTORY');
  const before = await lstat(directory, { bigint: true });
  requireHandoff(before.isDirectory() && await realpath(directory) === directory, 'DIRECTORY');
  const archives = await Promise.allSettled(t42RawEcrTargets.map(target => readArchive(directory, target)));
  const failure = archives.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const [platformArchive, tenantArchive] = archives.map(result => result.value);
  const after = await lstat(directory, { bigint: true });
  requireHandoff(after.isDirectory() && sameObject(before, after) && await realpath(directory) === directory, 'DIRECTORY_CHANGED');
  return Object.freeze({ platformArchive, tenantArchive });
}
