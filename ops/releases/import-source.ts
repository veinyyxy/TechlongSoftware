import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { readCheckedBuildFiles } from "./build-artifact.ts";
import { verifyBackendBuildEvidence, readRegistryBuild, type BackendBuildProfile, type ReleaseBuildRun,
  type ReleaseBuildArtifact, type RegistryReadback } from "../../lib/deployments/releases/production.ts";

export interface CatalogSourceScope {
  schema: "techlong/catalog-source-read/v1";
  repository: "veinyyxy/SpeedFeast_Backend_main";
  accountId: "402010193138"; region: "ca-central-1"; ecrRepository: "techlong-sandbox-speedfeast";
  nodeVersion: string; scannerVersion: string; scannerArchiveSha256: string;
  expiresAt: number;
}
export const catalogSourceIdentity = {
  repository: "veinyyxy/SpeedFeast_Backend_main", accountId: "402010193138", region: "ca-central-1", ecrRepository: "techlong-sandbox-speedfeast",
} as const;
export interface SourceCounts { sts: number; ecr: number; githubGets: number; zipDownloads: number; downloadedBytes: number }
type AwsRead = (args: string[]) => Promise<string>;
const must = (ok: unknown, code: string) => { if (!ok) throw new Error(code); };

export async function sourceAwsRead(args: string[]): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, AWS_MAX_ATTEMPTS: "1", AWS_PAGER: "", AWS_EC2_METADATA_DISABLED: "true" };
  for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN"]) delete env[key];
  return new Promise((resolve, reject) => execFile("aws", args, { env, shell: false, windowsHide: true, timeout: 30000, maxBuffer: 2_097_152 },
    (error, out) => error ? reject(new Error("RELEASE_SOURCE_AWS_READ_UNAVAILABLE")) : resolve(out)));
}

/** Lazy, explicit authentication; never print/store credential helper output. Not called by check. */
export async function sourceGitHubCredential(): Promise<string> {
  const result = await new Promise<string>((resolve, reject) => {
    const child = execFile("git", ["credential", "fill"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 },
      (error, out) => error ? reject(new Error("RELEASE_SOURCE_GITHUB_AUTH_UNAVAILABLE")) : resolve(out));
    child.stdin?.end("protocol=https\nhost=github.com\n\n");
  });
  const value = result.split(/\r?\n/).find(line => line.startsWith("password="))?.slice(9);
  must(value && value.length < 8192, "RELEASE_SOURCE_GITHUB_AUTH_UNAVAILABLE");
  return value!;
}

/** Concrete official-endpoint read-only transport. Injected fetch/CLI are used only by regression. */
export function catalogSourceReaders(scope: CatalogSourceScope, token: () => Promise<string>,
  fetcher: typeof fetch = fetch, command: AwsRead = sourceAwsRead, now: () => number = Date.now) {
  must(scope.schema === "techlong/catalog-source-read/v1" && Object.entries(catalogSourceIdentity).every(([k, v]) => scope[k as keyof CatalogSourceScope] === v), "RELEASE_SOURCE_SCOPE_REJECTED");
  must(Number.isSafeInteger(scope.expiresAt) && scope.expiresAt > now() && scope.expiresAt <= now() + 5 * 3600_000, "RELEASE_SOURCE_WINDOW_REJECTED");
  must(/^v\d+\.\d+\.\d+$/.test(scope.nodeVersion) && /^\d+\.\d+\.\d+$/.test(scope.scannerVersion) &&
    /^[a-f0-9]{64}$/.test(scope.scannerArchiveSha256), "RELEASE_SOURCE_PROFILE_REJECTED");
  const counts: SourceCounts = { sts: 0, ecr: 0, githubGets: 0, zipDownloads: 0, downloadedBytes: 0 };
  let credential: string | undefined;
  const guard = () => must(now() < scope.expiresAt && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "RELEASE_SOURCE_EXPIRED_OR_TLS_REJECTED");
  const headers = async () => { credential ??= await token(); return { Authorization: `Bearer ${credential}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; };
  const get = async (endpoint: string, redirect: "error" | "manual" = "error") => {
    guard(); must(++counts.githubGets <= 12, "RELEASE_SOURCE_GITHUB_BUDGET");
    return fetcher(`https://api.github.com/repos/${scope.repository}/${endpoint}`, { method: "GET", redirect,
      signal: AbortSignal.timeout(30000), headers: await headers() });
  };
  const json = async <T>(endpoint: string): Promise<T> => {
    const response = await get(endpoint); must(response.ok && response.body, "RELEASE_SOURCE_GITHUB_READ_FAILED");
    let size = 0, text = ""; const decoder = new TextDecoder();
    for await (const part of Readable.fromWeb(response.body! as import("node:stream/web").ReadableStream<Uint8Array>)) {
      size += part.length; must(size <= 2_097_152, "RELEASE_SOURCE_METADATA_TOO_LARGE"); text += decoder.decode(part, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text) as T; } catch { throw new Error("RELEASE_SOURCE_METADATA_INVALID"); }
  };
  const aws = async <T>(service: "sts" | "ecr", operation: string, input: Record<string, unknown>): Promise<T> => {
    guard(); must(service === "sts" ? ++counts.sts <= 1 : ++counts.ecr <= 5, "RELEASE_SOURCE_AWS_BUDGET");
    const endpoint = service === "sts" ? "sts.ca-central-1.amazonaws.com" : "api.ecr.ca-central-1.amazonaws.com";
    const text = await command([service, operation, "--profile", "techlong-sandbox-user", "--region", scope.region,
      "--endpoint-url", `https://${endpoint}`, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-input-json", JSON.stringify(input)]);
    try { return JSON.parse(text) as T; } catch { throw new Error("RELEASE_SOURCE_AWS_METADATA_INVALID"); }
  };
  return {
    counts,
    close: () => { credential = undefined; },
    identity: async () => {
      const value = await aws<{ Account: string; Arn: string }>("sts", "get-caller-identity", {});
      must(value.Account === scope.accountId && value.Arn === `arn:aws:iam::${scope.accountId}:user/techlong-sandbox-dev`, "RELEASE_SOURCE_IDENTITY_REJECTED");
      return { accountId: value.Account, arn: value.Arn };
    },
    runs: () => json<{ workflow_runs: ReleaseBuildRun[] }>("actions/workflows/backend-image-candidate.yml/runs?branch=main&status=success&per_page=10"),
    artifacts: (id: number) => { must(Number.isSafeInteger(id) && id > 0, "RELEASE_SOURCE_RUN_ID"); return json<{ total_count: number; artifacts: ReleaseBuildArtifact[] }>(`actions/runs/${id}/artifacts?per_page=100`); },
    repository: async () => {
      const value = await aws<{ repositories: { registryId: string; repositoryName: string; imageTagMutability: string }[] }>("ecr", "describe-repositories", { registryId: scope.accountId, repositoryNames: [scope.ecrRepository] });
      must(value.repositories?.length === 1 && value.repositories[0].registryId === scope.accountId &&
        value.repositories[0].repositoryName === scope.ecrRepository && value.repositories[0].imageTagMutability === "IMMUTABLE", "RELEASE_SOURCE_MUTABLE_REPOSITORY_REJECTED");
      return value;
    },
    tag: (tag: string) => {
      must(/^app-sha[a-f0-9]{40}-r\d+-a1$/.test(tag), "RELEASE_SOURCE_TAG_REJECTED");
      return aws<RegistryReadback["root"]>("ecr", "batch-get-image", { registryId: scope.accountId, repositoryName: scope.ecrRepository, imageIds: [{ imageTag: tag }] });
    },
    read: async <T>(service: string, operation: string, input: Record<string, unknown>) => {
      const ids = input.imageIds as { imageDigest?: string }[] | undefined;
      must(service === "ecr" && operation === "batch-get-image" && input.registryId === scope.accountId && input.repositoryName === scope.ecrRepository &&
        ids?.length === 1 && /^sha256:[a-f0-9]{64}$/.test(ids[0].imageDigest ?? ""), "RELEASE_SOURCE_ECR_SCOPE_REJECTED");
      return aws<T>("ecr", "batch-get-image", input);
    },
    download: async (artifact: ReleaseBuildArtifact, destination: string) => {
      guard(); must(++counts.zipDownloads === 1 && Number.isSafeInteger(artifact.id) && artifact.id > 0 &&
        artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 500 * 1024 * 1024, "RELEASE_SOURCE_DOWNLOAD_REJECTED");
      const redirect = await get(`actions/artifacts/${artifact.id}/zip`, "manual");
      must(redirect.status === 302, "RELEASE_SOURCE_DOWNLOAD_REDIRECT_REQUIRED");
      const url = new URL(redirect.headers.get("location") ?? "");
      must(url.protocol === "https:" && !url.username && !url.password && (url.hostname.endsWith(".blob.core.windows.net") || url.hostname.endsWith(".actions.githubusercontent.com")), "RELEASE_SOURCE_DOWNLOAD_HOST_REJECTED");
      guard(); // Never forward GitHub Authorization to the signed blob host; never persist its URL.
      const response = await fetcher(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(180000) });
      must(response.ok && response.body, "RELEASE_SOURCE_DOWNLOAD_FAILED");
      const sha = createHash("sha256");
      await pipeline(Readable.fromWeb(response.body! as import("node:stream/web").ReadableStream<Uint8Array>),
        new Transform({ transform(chunk, _, done) {
          counts.downloadedBytes += chunk.length;
          if (counts.downloadedBytes > artifact.size_in_bytes || counts.downloadedBytes > 500 * 1024 * 1024) { done(new Error("RELEASE_SOURCE_DOWNLOAD_LIMIT")); return; }
          sha.update(chunk); done(null, chunk);
        } }), createWriteStream(destination, { flags: "wx", mode: 0o600 }));
      must(counts.downloadedBytes === artifact.size_in_bytes && `sha256:${sha.digest("hex")}` === artifact.digest, "RELEASE_SOURCE_DOWNLOAD_DIGEST_MISMATCH");
    },
  };
}

export type CatalogSourceReaders = ReturnType<typeof catalogSourceReaders>;
export async function collectCatalogSource(scope: CatalogSourceScope, root: string, readers: CatalogSourceReaders,
  now: () => number = Date.now, readFiles: typeof readCheckedBuildFiles = readCheckedBuildFiles) {
  must(path.isAbsolute(root), "RELEASE_SOURCE_PRIVATE_DIRECTORY_REQUIRED");
  await mkdir(root, { mode: 0o700 }); // Create-only; never reset/clean a previous collection.
  const startedAt = now();
  try {
    const identity = await readers.identity(), runs = await readers.runs();
    await writeFile(path.join(root, "run-metadata.json"), JSON.stringify(runs), { flag: "wx", mode: 0o600 });
    const run = runs.workflow_runs.slice(0, 10).find(r => r.run_attempt === 1 && r.status === "completed" && r.conclusion === "success" &&
      r.head_branch === "main" && ["push", "workflow_dispatch"].includes(r.event) && r.repository.full_name === scope.repository &&
      r.head_repository.id === r.repository.id && r.path === ".github/workflows/backend-image-candidate.yml");
    must(run, "RELEASE_SOURCE_NO_ELIGIBLE_BUILD");
    const metadata = await readers.artifacts(run!.id), name = `checked-app-${run!.head_sha}-${run!.id}-1`;
    await writeFile(path.join(root, "artifact-metadata.json"), JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
    must(metadata.total_count <= 100, "RELEASE_SOURCE_ARTIFACT_PAGE_INCOMPLETE");
    const matches = metadata.artifacts.filter(a => a.name === name && !a.expired && Date.parse(a.expires_at) > now());
    must(matches.length === 1, "RELEASE_SOURCE_NO_LIVE_ARTIFACT");
    const artifact = matches[0], tag = `app-sha${run!.head_sha}-r${run!.id}-a1`;
    // No download of a 500MiB archive unless the exact already-published immutable tag exists.
    const repository = await readers.repository();
    const published = await readers.tag(tag), image = published.images?.[0];
    await writeFile(path.join(root, "tag-metadata.json"), JSON.stringify(published), { flag: "wx", mode: 0o600 });
    must(published.images?.length === 1 && !published.failures?.length && image?.registryId === scope.accountId &&
      image.repositoryName === scope.ecrRepository && image.imageId.imageTag === tag &&
      /^sha256:[a-f0-9]{64}$/.test(image.imageId.imageDigest), "RELEASE_SOURCE_NO_MATCHING_PUBLISHED_IMAGE");
    await readers.download(artifact, path.join(root, "artifact.zip"));
    const files = await readFiles(artifact, path.join(root, "artifact.zip"), path.join(root, "checked"));
    const profile: BackendBuildProfile = { repository: scope.repository, repositoryId: run!.repository.id,
      nodeVersion: scope.nodeVersion, scannerVersion: scope.scannerVersion, scannerArchiveSha256: scope.scannerArchiveSha256 };
    const build = await verifyBackendBuildEvidence(profile, run!, artifact, files, now());
    const imageRepository = `${scope.accountId}.dkr.ecr.${scope.region}.amazonaws.com/${scope.ecrRepository}`;
    const registry = await readRegistryBuild({ imageRepository, imageConfigDigest: build.imageConfigDigest, validUntil: build.validUntil }, image!.imageId.imageDigest, readers, now);
    const result = { schema: "techlong/catalog-source-evidence/v1" as const, status: "SOURCE_AND_ECR_VERIFIED_PRODUCT_BINDING_PENDING" as const,
      startedAt, completedAt: now(), validUntil: Math.min(startedAt + 5 * 3600_000, build.validUntil), identity, scope, profile,
      run: run!, artifact, files, build, imageRepository, repository, publishedTag: tag, registry, counts: { ...readers.counts },
      productBound: false, catalogWritten: false, awsWrites: 0, runtimeEnabled: false };
    await writeFile(path.join(root, "source-evidence.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return result;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "RELEASE_SOURCE_COLLECTION_STOPPED";
    await writeFile(path.join(root, "stopped.json"), JSON.stringify({ startedAt, stoppedAt: now(), code, counts: readers.counts,
      catalogWritten: false, awsWrites: 0, automaticRetry: false }), { flag: "wx", mode: 0o600 });
    throw new Error(code);
  } finally { readers.close(); }
}

export type CatalogSourceEvidence = Awaited<ReturnType<typeof collectCatalogSource>>;
