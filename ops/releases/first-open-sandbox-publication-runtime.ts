import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { catalogSourceIdentity, catalogSourceReaders } from "./import-source.ts";
import { readCheckedBuildFiles } from "./build-artifact.ts";
import { releaseChildEnvironment } from "./aws-runtime.ts";
import { checkFirstOpenPublicationSources, firstOpenSandboxPublication, verifyFirstOpenPublicationFiles } from "./first-open-sandbox-publication.ts";
import type { ReleaseEnvironmentConfig } from "../../lib/deployments/releases/handoff.ts";

const p = firstOpenSandboxPublication;
const scanReader = `import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
 entries=archive.infolist()
 names={'os-scan.json','os-scan-summary.json'}
 if len(entries)!=2 or {i.filename for i in entries}!=names or any(
  i.is_dir() or not 0<i.file_size<=8*1024*1024 or (i.external_attr >> 16)&0o170000==0o120000 for i in entries
 ): raise SystemExit(1)
 print(json.dumps({'report':archive.read('os-scan.json').decode('utf-8'),
  'summary':archive.read('os-scan-summary.json').decode('utf-8')},ensure_ascii=False))
`;
export async function readFirstOpenSandboxCandidate(root: string, writeBefore: number, token: () => Promise<string>,
  fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let readToken: Promise<string> | undefined;
  const source = () => catalogSourceReaders({ schema: "techlong/catalog-source-read/v1", ...catalogSourceIdentity,
    nodeVersion: "v24.18.0", scannerVersion: "0.75.0",
    scannerArchiveSha256: "c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f", expiresAt: writeBefore },
  () => readToken ??= token(), fetcher, async () => { throw new Error("FIRST_OPEN_PUBLICATION_SOURCE_PROFILE_FORBIDDEN"); }, now);
  const primary = source(), scanSource = source();
  try {
    const run = await primary.run(p.candidateRunId);
    const artifact = await primary.artifact(p.candidateArtifactId), scan = await scanSource.artifact(p.scanArtifactId);
    checkFirstOpenPublicationSources(run, artifact, scan, now());
    const zip = path.join(root, "artifact.zip"), scanZip = path.join(root, "scan.zip");
    await primary.download(artifact, zip);
    await scanSource.download(scan, scanZip);
    const files = await readCheckedBuildFiles(artifact, zip, path.join(root, "checked"));
    const { stdout } = await promisify(execFile)("python3", ["-I", "-c", scanReader, scanZip],
      { shell: false, windowsHide: true, env: releaseChildEnvironment(process.env), timeout: 20_000, maxBuffer: 12 * 1024 * 1024 });
    return verifyFirstOpenPublicationFiles(files, JSON.parse(stdout), now());
  } finally { primary.close(); scanSource.close(); readToken = undefined; }
}

export function firstOpenPublicationSession(config: ReleaseEnvironmentConfig, requestId: string, candidateSha256: string) {
  const token = config.promotion?.artifactToken;
  if (!token || !/^release_[a-f0-9]{32}$/.test(requestId) || !/^[a-f0-9]{64}$/.test(candidateSha256))
    throw new Error("FIRST_OPEN_PUBLICATION_SESSION_SCOPE");
  const bucket = "arn:aws:s3:::techlong-sandbox-cloud-worker-evidence-402010193138/instance-releases/promotions/";
  const policy = JSON.stringify({ Version: "2012-10-17", Statement: [
    { Effect: "Allow", Action: ["sts:GetCallerIdentity", "ecr:GetAuthorizationToken"], Resource: "*" },
    { Effect: "Allow", Action: ["ecr:DescribeRepositories", "ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"],
    Resource: "arn:aws:ecr:ca-central-1:402010193138:repository/techlong-sandbox-speedfeast" },
    { Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: token.arn,
      Condition: { StringEquals: { "secretsmanager:VersionId": token.versionId } } },
    { Effect: "Allow", Action: "kms:Decrypt", Resource: "*", Condition: { StringEquals: {
      "kms:ViaService": "secretsmanager.ca-central-1.amazonaws.com", "kms:EncryptionContext:SecretARN": token.arn,
      "kms:EncryptionContext:SecretVersionId": token.versionId } } },
    { Effect: "Allow", Action: "s3:PutObject", Resource: [
      `${bucket}${requestId}/intent.json`, `${bucket}${requestId}/published.json`, `${bucket}candidate-${candidateSha256}/push.json`,
    ], Condition: { Null: { "s3:if-none-match": "false" } } },
  ] });
  if (policy.length > 2048) throw new Error("FIRST_OPEN_PUBLICATION_SESSION_POLICY_LIMIT");
  return { durationSeconds: 900, policy } as const;
}
