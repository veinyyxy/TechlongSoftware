// Candidate runner-only bridge. Not activated by committing this file.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { mainV5 } from './run-worker-v5.mjs';
import { assertEvidenceSafeV5, EVIDENCE_V5, evidenceKeyV5 } from './cloud-evidence-v5.mjs';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
const prefix = 'worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/';
const must = (v, code) => { if (!v) throw Error(code); };
export function validateWorkflowInputV5(input) {
  const keys = ['mode','job','installation','installationSha','manifest','manifestSha','execution','lineage'];
  must(input && Object.keys(input).sort().join(',') === keys.sort().join(',') &&
    ['Review','RunOnce','Inspect'].includes(input.mode) && /^job_[a-f0-9]{24}$/.test(input.job) &&
    /^[a-f0-9]{64}$/.test(input.installationSha), 'WORKFLOW_INPUT_SCOPE');
  for (const name of ['installation','manifest','execution','lineage']) if (input[name] !== '') {
    must(typeof input[name] === 'string' && Buffer.byteLength(input[name]) <= 2000, 'WORKFLOW_REFERENCE_ONLY');
    const r = JSON.parse(input[name]);
    must(Object.keys(r).sort().join(',') === 'key,sha256,versionId' && typeof r.key === 'string' && r.key.startsWith(prefix) &&
      !r.key.includes('..') && !r.key.includes('\\') && /^[a-f0-9]{64}$/.test(r.sha256) &&
      typeof r.versionId === 'string' && /^[A-Za-z0-9._-]{1,256}$/.test(r.versionId), 'WORKFLOW_S3_VERSION_REFERENCE');
    if (name === 'installation') must(r.key === prefix + `installation/${input.installationSha}.json`,
      'WORKFLOW_INSTALLATION_REFERENCE');
  }
  must(input.installation !== '' && (input.mode === 'Review' ? input.manifest === '' && input.manifestSha === '' && input.execution === '' :
    input.manifest !== '' && /^[a-f0-9]{64}$/.test(input.manifestSha) &&
    JSON.parse(input.manifest).key === evidenceKeyV5('manifest.json', { jobId: input.job, manifestSha256: input.manifestSha }) &&
    (input.mode === 'RunOnce' ? input.execution === '' : input.execution !== '')), 'WORKFLOW_MODE_REFERENCE_SET');
  return input;
}
export async function runWorkflowV5() {
  const input = validateWorkflowInputV5(Object.fromEntries(['mode','job','installation','installationSha','manifest','manifestSha','execution','lineage']
    .map(k => [k, process.env['TECHLONG_INPUT_' + k.toUpperCase()] ?? ''])));
  must(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === 'veinyyxy/TechlongSoftware' &&
    process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_RUN_ATTEMPT === '1' &&
    /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA) && /^[1-9][0-9]{0,19}$/.test(process.env.GITHUB_RUN_ID) &&
    !['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'].some(k => process.env[k]), 'WORKFLOW_EXACT_RUN_NO_INHERITED_AWS');
  const tokenUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  must(tokenUrl.protocol === 'https:' && tokenUrl.hostname.endsWith('.actions.githubusercontent.com') && !tokenUrl.username && !tokenUrl.password,
    'WORKFLOW_GITHUB_OIDC_ENDPOINT'); tokenUrl.searchParams.set('audience','sts.amazonaws.com');
  const oidc = await fetch(tokenUrl, { headers: { authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  must(oidc.ok && Number(oidc.headers.get('content-length') ?? 0) < 20000, 'WORKFLOW_OIDC_RESPONSE');
  const jwtText = await oidc.text(); must(jwtText.length < 20000, 'WORKFLOW_OIDC_SIZE'); const token = JSON.parse(jwtText).value;
  must(typeof token === 'string' && token.length < 15000, 'WORKFLOW_OIDC_TOKEN');
  const cfg = { region: 'ca-central-1', ignoreConfiguredEndpointUrls: true, maxAttempts: 1 }, sts = new STSClient(cfg);
  let s3;
  try {
    const r = await sts.send(new AssumeRoleWithWebIdentityCommand({
      RoleArn: 'arn:aws:iam::402010193138:role/TechlongSandboxGitHubDeploymentWorkerRole',
      RoleSessionName: `Deploy-${process.env.GITHUB_RUN_ID}-1`, WebIdentityToken: token, DurationSeconds: 3600,
    }), { abortSignal: AbortSignal.timeout(30000) });
    const c = r.Credentials; must(c?.AccessKeyId && c.SecretAccessKey && c.SessionToken && c.Expiration, 'WORKFLOW_TEMP_CREDENTIALS');
    const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
    s3 = new S3Client({ ...cfg, credentials });
    const get = async (name, ref) => {
      const e = JSON.parse(ref), o = await s3.send(new GetObjectCommand({ Bucket: EVIDENCE_V5.bucket, Key: e.key,
        VersionId: e.versionId, ExpectedBucketOwner: EVIDENCE_V5.owner }), { abortSignal: AbortSignal.timeout(30000) });
      must(o.VersionId === e.versionId && o.ContentLength > 0 && o.ContentLength <= 1000000 && o.ServerSideEncryption === 'AES256', 'WORKFLOW_S3_METADATA');
      const text = await o.Body.transformToString(); must(Buffer.byteLength(text) <= 1000000, 'WORKFLOW_S3_SIZE');
      const value = JSON.parse(text); assertEvidenceSafeV5(value);
      // The S3 reference hashes the WHOLE document, including its own binding
      // member; mainV5 separately reconstructs that member's body digest.
      must(await sha256Hex(value) === e.sha256, 'WORKFLOW_PRIVATE_DOCUMENT_DIGEST');
      if (name === 'manifest') must(value.jobPlan?.jobId === input.job && value.manifestSha256 === input.manifestSha, 'WORKFLOW_MANIFEST_JOB');
      const file = path.join(process.env.RUNNER_TEMP, `techlong-${name}.json`);
      await writeFile(file, text, { flag: 'wx', mode: 0o600 }); return file;
    };
    const args = ['--mode',input.mode,'--installation',await get('installation',input.installation),'--approved-installation-sha',input.installationSha];
    if (input.mode === 'Review') args.push('--job',input.job);
    else { args.push('--manifest',await get('manifest',input.manifest));
      if (input.mode === 'RunOnce') args.push('--approved-manifest-sha',input.manifestSha);
      else args.push('--execution-reference',await get('execution',input.execution)); }
    if (input.lineage) args.push('--lineage',await get('lineage',input.lineage));
    Object.assign(process.env, { AWS_ACCESS_KEY_ID: c.AccessKeyId, AWS_SECRET_ACCESS_KEY: c.SecretAccessKey,
      AWS_SESSION_TOKEN: c.SessionToken, TECHLONG_AWS_CREDENTIAL_EXPIRATION: c.Expiration.toISOString() });
    return await mainV5(args);
  } finally {
    for (const k of ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','TECHLONG_AWS_CREDENTIAL_EXPIRATION']) delete process.env[k];
    s3?.destroy(); sts.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runWorkflowV5().catch(() => {
  console.error('WORKFLOW_REQUIRES_INDEPENDENT_INSPECT_NO_RETRY'); process.exitCode = 1;
});
