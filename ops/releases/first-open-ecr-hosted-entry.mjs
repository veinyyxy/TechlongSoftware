import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseT42HostedEcrSource, runT42HostedEcrPublisher, runT42HostedEcrReader,
  t42PrivateHostedEcrSourceSchema } from './first-open-ecr-hosted-job.mjs';
import { openT42HostedSessionContext } from './first-open-ecr-hosted-session.mjs';
import { parseT42RawEcrReview } from './first-open-ecr-raw-publication.mjs';

function need(condition, code) {
  if (!condition) throw Error(`T42_ECR_HOSTED_ENTRY_${code}`);
}

export function loadT42HostedEntryInputs(side, env) {
  need(side === 'publisher' || side === 'reader', 'SIDE');
  const { TECHLONG_T42_ECR_REVIEW_TEXT: reviewText, TECHLONG_T42_ECR_APPROVAL_SHA: approvedSha256,
    TECHLONG_T42_ECR_SOURCE_TEXT: sourceBindingText, TECHLONG_T42_ECR_SOURCE_SHA: sourceBindingSha256,
    TECHLONG_T42_ECR_RUNTIME_COMMIT: verifiedRuntimeCommit, GH_TOKEN: githubToken,
    TECHLONG_T42_ECR_UPLOAD_BUNDLE_PATH: uploadBundlePath, TECHLONG_T42_ECR_ARTIFACT_NODE: artifactNodePath } = env;
  const review = parseT42RawEcrReview(reviewText, approvedSha256, sourceBindingSha256);
  const source = parseT42HostedEcrSource(sourceBindingText, sourceBindingSha256, review);
  need(source.schema === t42PrivateHostedEcrSourceSchema && verifiedRuntimeCommit === source.workflows[side].reusableCommit &&
    typeof githubToken === 'string' && /^[A-Za-z0-9_]{16,512}$/.test(githubToken) &&
    [uploadBundlePath, artifactNodePath].every(path => typeof path === 'string' && isAbsolute(path)), 'FROZEN_INPUT');
  return { reviewText, approvedSha256, sourceBindingText, sourceBindingSha256, review, source, githubToken,
    uploadBundlePath, artifactNodePath };
}

export async function runT42HostedEntry(side, env = process.env) {
  const bound = loadT42HostedEntryInputs(side, env);
  const session = await openT42HostedSessionContext({ side, source: bound.source, review: bound.review,
    approvedSha256: bound.approvedSha256, env, githubToken: bound.githubToken });
  const { peerRunId, verifiedClaims, ...credentials } = session;
  const runtime = { env, verifiedClaims, peerRunId, githubToken: bound.githubToken, uploadBundlePath: bound.uploadBundlePath,
    artifactNodePath: bound.artifactNodePath };
  const run = side === 'publisher' ? runT42HostedEcrPublisher : runT42HostedEcrReader;
  const result = await run({ reviewText: bound.reviewText, approvedSha256: bound.approvedSha256,
    sourceBindingText: bound.sourceBindingText, sourceBindingSha256: bound.sourceBindingSha256, runtime, ...credentials });
  const expected = side === 'publisher' ? 'PUBLISHED_AND_INDEPENDENTLY_VERIFIED' : 'INDEPENDENT_READBACK_COMPLETE';
  // Only a verified terminal summary is written to workflow logs. Provider responses remain in scoped audit storage.
  if (result.status !== expected) return { side, status: 'STOP_NO_RETRY' };
  return { side, status: result.status, approvedSha256: bound.approvedSha256, protectedRunId: result.protectedRunId,
    ...(side === 'publisher' ? { independentRunId: result.independentRunId } : { publisherRunId: result.publisherRunId }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  (args.length === 1 ? runT42HostedEntry(args[0]) : Promise.reject(Error('T42_ECR_HOSTED_ENTRY_ARGUMENTS')))
    .then(summary => {
      console.log(JSON.stringify(summary));
      if (summary.status === 'STOP_NO_RETRY') process.exitCode = 1;
    }).catch(() => {
      console.error('T42_ECR_HOSTED_ENTRY_STOP_REVIEW_APPROVED_AUDIT');
      process.exitCode = 1;
    });
}
