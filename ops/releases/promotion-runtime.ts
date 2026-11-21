import { execFile } from "node:child_process";
import { mkdir, mkdtemp, unlink } from "node:fs/promises";
import path from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { buildReleaseCandidate, readRegistryBuild, type RegistryReadback, type RegistryBuildTarget, type CheckedBuildFiles } from "../../lib/deployments/releases/production.ts";
import type { StoredReleaseCandidate, ReleasePromotionIntent } from "../../lib/deployments/releases/promotion.ts";
import type { ReleaseEnvironmentConfig } from "../../lib/deployments/releases/handoff.ts";
import { releaseChildEnvironment, type ReleaseCredentials } from "./aws-runtime.ts";
import { catalogSourceIdentity, catalogSourceReaders } from "./import-source.ts";
import { readCheckedBuildFiles } from "./build-artifact.ts";
import { firstOpenSandboxPublication, firstOpenCandidateZipSha256, firstOpenArchiveSha256 } from "./first-open-sandbox-publication.ts";

export type PromotionCommand = (binary: "aws" | "docker", args: string[], env: NodeJS.ProcessEnv, input?: string, timeout?: number) => Promise<string>;
// Publication itself needs no active instance/binding or CFN plan. Daily promotion
// still supplies its full intent/candidate and retains all eligibility checks.
export type AppPublicationIntent = Pick<ReleasePromotionIntent, "candidateSha256" | "requestId" | "writeBefore" | "target">;
export type AppPublicationCandidate = Omit<StoredReleaseCandidate, "files"> & { files?: CheckedBuildFiles };
const command: PromotionCommand = (binary, args, env, input, timeout = 30000) => new Promise((resolve, reject) => {
  const child = execFile(binary, args, { env, shell: false, windowsHide: true, timeout, maxBuffer: 2_097_152 },
    (error, out) => error ? reject(new Error("RELEASE_PROMOTION_COMMAND_STOPPED_NO_RETRY")) : resolve(out));
  child.stdin?.end(input);
});

type PromotionServices = { token(): Promise<string>; put(key: string, body: string): Promise<void> };
/** Shared write transport, reached only through one of the explicit admissions below. */
function createAppArchivePublisher(config: ReleaseEnvironmentConfig, credentials: ReleaseCredentials, root: string,
  services: PromotionServices, execute: PromotionCommand, now: () => number, requireAbsentTag: boolean) {
  const p = config.promotion;
  if (!p || !path.isAbsolute(root)) throw new Error("RELEASE_PROMOTION_NOT_ACTIVATED");
  const env: NodeJS.ProcessEnv = { ...releaseChildEnvironment(process.env), AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey, AWS_SESSION_TOKEN: credentials.sessionToken, AWS_MAX_ATTEMPTS: "1",
    AWS_EC2_METADATA_DISABLED: "true", AWS_PAGER: "", AWS_CONFIG_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
    AWS_SHARED_CREDENTIALS_FILE: process.platform === "win32" ? "NUL" : "/dev/null" };
  let calls = 0, published = false;
  const guard = (intent: AppPublicationIntent) => {
    if (now() >= intent.writeBefore || credentials.expiresAt <= now() || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("RELEASE_PROMOTION_EXPIRED");
  };
  const read = async <T>(operation: string, input: Record<string, unknown>, intent: AppPublicationIntent) => {
    guard(intent);
    if (++calls > 8 || !["describe-repositories", "batch-get-image", "get-login-password"].includes(operation)) throw new Error("RELEASE_PROMOTION_ECR_BUDGET");
    const args = ["ecr", operation, "--region", config.region, "--endpoint-url", `https://api.ecr.${config.region}.amazonaws.com`, "--no-cli-pager"];
    if (operation !== "get-login-password") args.push("--cli-input-json", JSON.stringify(input), "--output", "json", "--no-paginate");
    const text = await execute("aws", args, env);
    return (operation === "get-login-password" ? text.trim() : JSON.parse(text)) as T;
  };
  const audit = async (kind: "intent" | "push" | "published" | "derived", intent: AppPublicationIntent, payload: Record<string, unknown>) => {
    const key = kind === "push" ? `${config.evidence.prefix}/promotions/candidate-${intent.candidateSha256}/push.json` :
      `${config.evidence.prefix}/promotions/${intent.requestId}/${kind}.json`;
    await services.put(key, canonicalJson({ kind, intent, payload }));
  };
  return { audit, publish: async (intent: AppPublicationIntent, sourceCommit: string, check: () => Promise<RegistryBuildTarget>): Promise<RegistryReadback> => {
    guard(intent);
    if (published || intent.target.repository !== p.imageRepository) throw new Error("RELEASE_PROMOTION_SCOPE_REJECTED");
    published = true; await mkdir(root, { mode: 0o700 });
    try {
      const checked = await check();
      if (checked.imageRepository !== p.imageRepository || now() >= checked.validUntil)
        throw new Error("RELEASE_PROMOTION_CHECKED_TARGET_CHANGED");
      const repositoryName = p.imageRepository.split("/").slice(1).join("/"), registry = p.imageRepository.split("/")[0];
      const repo = await read<{ repositories: { registryId: string; repositoryName: string; imageTagMutability: string }[] }>("describe-repositories",
        { registryId: config.accountId, repositoryNames: [repositoryName] }, intent);
      if (repo.repositories?.length !== 1 || repo.repositories[0].registryId !== config.accountId || repo.repositories[0].repositoryName !== repositoryName ||
        repo.repositories[0].imageTagMutability !== "IMMUTABLE") throw new Error("RELEASE_PROMOTION_IMMUTABILITY_REQUIRED");
      const tag = () => read<RegistryReadback["root"]>("batch-get-image", { registryId: config.accountId, repositoryName,
        imageIds: [{ imageTag: intent.target.tag }] }, intent);
      let result = await tag();
      if (requireAbsentTag && !(result.images?.length === 0 && result.failures?.length === 1 &&
        (result.failures[0] as { failureCode?: string }).failureCode === "ImageNotFound")) throw new Error("RELEASE_BOOTSTRAP_TAG_OCCUPIED");
      if (result.images?.length === 0 && result.failures?.length === 1 && (result.failures[0] as { failureCode?: string }).failureCode === "ImageNotFound") {
        const dockerEnv = releaseChildEnvironment(process.env), archive = path.join(root, "checked", "image.tar.gz");
        await execute("docker", ["load", "--input", archive], dockerEnv, undefined, 180000);
        const loaded = JSON.parse(await execute("docker", ["image", "inspect", checked.imageConfigDigest], dockerEnv));
        if (loaded.length !== 1 || loaded[0].Id !== checked.imageConfigDigest || loaded[0].Os !== "linux" || loaded[0].Architecture !== "amd64" ||
          loaded[0].Config?.Labels?.["org.opencontainers.image.revision"] !== sourceCommit) throw new Error("RELEASE_PROMOTION_LOADED_IMAGE_CHANGED");
        const auth = await mkdtemp(path.join(root, "docker-auth-")), authEnv = { ...dockerEnv, DOCKER_CONFIG: auth };
        try {
          const password = await read<string>("get-login-password", {}, intent);
          await execute("docker", ["login", "--username", "AWS", "--password-stdin", registry], authEnv, password);
          const reference = `${p.imageRepository}:${intent.target.tag}`;
          await execute("docker", ["tag", checked.imageConfigDigest, reference], authEnv);
          await audit("push", intent, {}); // Candidate-global one-shot upload slot, before the ONLY push.
          guard(intent); await execute("docker", ["push", reference], authEnv, undefined, 300000);
        } finally { await unlink(path.join(auth, "config.json")).catch(() => {}); } // Local credential file only, never cloud cleanup.
        result = await tag(); // A failed push never reaches this line; no automatic write/read recovery.
      }
      const image = result.images?.[0];
      if (result.images?.length !== 1 || result.failures?.length || image?.imageId.imageTag !== intent.target.tag) throw new Error("RELEASE_PROMOTION_PUBLISHED_TAG_MISMATCH");
      const verified = await readRegistryBuild(checked, image!.imageId.imageDigest, { read: async <T>(service: string, operation: string, input: Record<string, unknown>) => {
        if (service !== "ecr" || operation !== "batch-get-image" || input.registryId !== config.accountId || input.repositoryName !== repositoryName) throw new Error("RELEASE_PROMOTION_SCOPE_REJECTED");
        return read<T>(operation, input, intent);
      } }, now);
      return verified.readback;
    } catch (error) {
      throw new Error(error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "RELEASE_PROMOTION_STOPPED_NO_RETRY");
    }
  } };
}

/** Normal releases still reconstruct and compare the original strict zero-finding candidate. */
export function releasePromotionPublisher(config: ReleaseEnvironmentConfig, credentials: ReleaseCredentials, root: string,
  services: PromotionServices, execute: PromotionCommand = command, fetcher: typeof fetch = fetch, now: () => number = Date.now,
  readFiles: typeof readCheckedBuildFiles = readCheckedBuildFiles, requireAbsentTag = false) {
  const p = config.promotion, transport = createAppArchivePublisher(config, credentials, root, services, execute, now, requireAbsentTag);
  return { audit: transport.audit, publish: async (c: AppPublicationCandidate, intent: AppPublicationIntent) => {
    if (!p || c.policy.repository !== p.sourceRepository || c.policy.repositoryId !== p.sourceRepositoryId ||
      c.build.imageRepository !== p.imageRepository || intent.target.repository !== p.imageRepository ||
      intent.target.tag !== `app-sha${c.build.source.commit}-r${c.build.source.buildRunId}-a1`) throw new Error("RELEASE_PROMOTION_SCOPE_REJECTED");
    return transport.publish(intent, c.build.source.commit, async () => {
      const github = catalogSourceReaders({ schema: "techlong/catalog-source-read/v1", ...catalogSourceIdentity,
        nodeVersion: c.policy.nodeVersion, scannerVersion: c.policy.scannerVersion, scannerArchiveSha256: c.policy.scannerArchiveSha256,
        expiresAt: Math.min(intent.writeBefore, now() + 5 * 3600_000) }, services.token, fetcher,
      async () => { throw new Error("RELEASE_SOURCE_PROFILE_FORBIDDEN_IN_CLOUD_JOB"); }, now);
      try {
        const run = await github.run(c.run.id), artifact = await github.artifact(c.artifact.id);
        if (artifact.id !== c.artifact.id) throw new Error("RELEASE_PROMOTION_ARTIFACT_CHANGED");
        await github.download(artifact, path.join(root, "artifact.zip"));
        const files = await readFiles(artifact, path.join(root, "artifact.zip"), path.join(root, "checked"));
        const checked = await buildReleaseCandidate(c.policy, run, artifact, files, now());
        if (canonicalJson(checked) !== canonicalJson(c.build) || c.files && canonicalJson(files) !== canonicalJson(c.files)) throw new Error("RELEASE_PROMOTION_CANDIDATE_CHANGED");
        return checked;
      } finally { github.close(); }
    });
  } };
}

/** Reuses only the transport; the dedicated admission can name only this image and its exact immutable tag. */
export function firstOpenSandboxArchivePublisher(config: ReleaseEnvironmentConfig, credentials: ReleaseCredentials, root: string,
  services: PromotionServices, check: () => Promise<RegistryBuildTarget>, execute: PromotionCommand = command, now: () => number = Date.now) {
  const p = firstOpenSandboxPublication, transport = createAppArchivePublisher(config, credentials, root, services, execute, now, true);
  return { audit: transport.audit, publish: async (intent: AppPublicationIntent) => {
    if (intent.target.repository !== p.registryRepository || intent.target.tag !== p.tag ||
      intent.target.imageConfigDigest !== p.imageConfigDigest || intent.target.archiveSha256 !== firstOpenArchiveSha256 ||
      intent.target.artifactSha256 !== firstOpenCandidateZipSha256 || intent.candidateSha256 !== firstOpenCandidateZipSha256)
      throw new Error("FIRST_OPEN_PUBLICATION_EXACT_TARGET_REQUIRED");
    return transport.publish(intent, p.sourceCommit, async () => {
      const checked = await check();
      if (checked.imageRepository !== p.registryRepository || checked.imageConfigDigest !== p.imageConfigDigest)
        throw new Error("FIRST_OPEN_PUBLICATION_CHECKED_TARGET_CHANGED");
      return checked;
    });
  } };
}

export function releasePromotionServices(config: ReleaseEnvironmentConfig, credentials: ReleaseCredentials) {
  const p = config.promotion;
  if (!p) throw new Error("RELEASE_PROMOTION_NOT_ACTIVATED");
  const secrets = new SecretsManagerClient({ region: config.region, credentials, maxAttempts: 1, endpoint: `https://secretsmanager.${config.region}.amazonaws.com` });
  const s3 = new S3Client({ region: config.region, credentials, maxAttempts: 1, endpoint: `https://s3.${config.region}.amazonaws.com` });
  let tokenRead = false, puts = 0;
  const receipts: { key: string; versionId: string; bodySha256: string }[] = [];
  return { receipts, token: async () => {
    if (tokenRead) throw new Error("RELEASE_PROMOTION_TOKEN_ALREADY_READ"); tokenRead = true;
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: p.artifactToken.arn, VersionId: p.artifactToken.versionId }));
    if (value.ARN !== p.artifactToken.arn || value.VersionId !== p.artifactToken.versionId || !value.SecretString || value.SecretString.length > 16384) throw new Error("RELEASE_PROMOTION_BUILD_TOKEN_REJECTED");
    const token = JSON.parse(value.SecretString).token;
    if (typeof token !== "string" || !token || token.length > 8192) throw new Error("RELEASE_PROMOTION_BUILD_TOKEN_REJECTED");
    return token;
  }, put: async (key: string, body: string) => {
    if (++puts > 4 || !key.startsWith(`${config.evidence.prefix}/promotions/`) || credentials.expiresAt <= Date.now()) throw new Error("RELEASE_PROMOTION_AUDIT_BUDGET");
    try {
      const ack = await s3.send(new PutObjectCommand({ Bucket: config.evidence.bucket, ExpectedBucketOwner: config.accountId, Key: key,
        IfNoneMatch: "*", ContentType: "application/json", Body: body }));
      if (!ack.VersionId || ack.VersionId === "null") throw new Error("RELEASE_VERSIONED_EVIDENCE_REQUIRED");
      receipts.push({ key, versionId: ack.VersionId, bodySha256: await sha256Hex(body) });
    } catch { throw new Error("RELEASE_PROMOTION_AUDIT_REQUIRES_INSPECTION"); }
  }, destroy: () => { secrets.destroy(); s3.destroy(); } };
}
