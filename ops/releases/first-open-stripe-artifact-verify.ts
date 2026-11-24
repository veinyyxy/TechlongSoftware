import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyBackendBuildEvidence, type ReleaseBuildArtifact, type ReleaseBuildRun } from "../../lib/deployments/releases/production.ts";

const candidate = "1cd598f1fc7505813b311783b1a96b40c2a60251";
const approvedProfile = {
  repository: "veinyyxy/SpeedFeast_Backend_main", repositoryId: 1064124445,
  nodeVersion: "v24.18.0", scannerVersion: "0.75.0",
  scannerArchiveSha256: "c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f",
} as const;
const winPython = path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const extractor = fileURLToPath(new URL("./extract-build-artifact.py", import.meta.url));
const fail = (code: string): never => { throw Error(`FIRST_OPEN_STRIPE_ARTIFACT_${code}`); };

async function fingerprint(file: string, max: number) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > max) return fail("FILE_SCOPE");
  const digest = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(file)) {
    if ((size += chunk.length) > max) return fail("FILE_SCOPE");
    digest.update(chunk);
  }
  if (size !== stat.size) return fail("FILE_CHANGED");
  return { sha256: digest.digest("hex"), size };
}

/** Authenticated metadata must come from the approved exact-run reader. This
 * offline adapter uses the original extractor and does not build or publish. */
export async function verifyStripeBackendOriginalZip({ run, artifact, zipPath: originalZip, outputDirectory: newPrivateDirectory }: {
  run: ReleaseBuildRun & { workflow_id: number }; artifact: ReleaseBuildArtifact; zipPath: string; outputDirectory: string;
}) {
  if (!path.isAbsolute(originalZip) || !path.isAbsolute(newPrivateDirectory) || run.head_sha !== candidate ||
    run.event !== "push" || run.status !== "completed" || run.conclusion !== "success" || run.run_attempt !== 1 ||
    run.head_branch !== "main" || run.path !== ".github/workflows/backend-image-candidate.yml" || run.workflow_id !== 377674976 ||
    run.repository?.id !== approvedProfile.repositoryId || run.repository.full_name !== approvedProfile.repository ||
    run.head_repository?.id !== approvedProfile.repositoryId || !Number.isSafeInteger(run.id) || run.id < 1 ||
    artifact.name !== `checked-app-${candidate}-${run.id}-1` || !Number.isSafeInteger(artifact.id) || artifact.id < 1 ||
    artifact.expired !== false || !(Date.parse(artifact.expires_at) > Date.now()) ||
    artifact.workflow_run?.id !== run.id || artifact.workflow_run?.repository_id !== approvedProfile.repositoryId ||
    artifact.workflow_run?.head_repository_id !== approvedProfile.repositoryId ||
    artifact.workflow_run?.head_sha !== candidate || artifact.workflow_run?.head_branch !== "main" ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)) return fail("EXACT_METADATA_REQUIRED");
  const zip = await fingerprint(originalZip, 500 * 1024 * 1024);
  if (`sha256:${zip.sha256}` !== artifact.digest || zip.size !== artifact.size_in_bytes) return fail("ZIP_MISMATCH");
  try {
    await promisify(execFile)(process.platform === "win32" ? winPython : "python3", ["-I", extractor, originalZip, newPrivateDirectory], {
      shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 65536,
      env: { NODE_ENV: "production", SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PYTHONUTF8: "1" },
    });
  } catch { return fail("EXTRACTION_FAILED_NO_RETRY"); }
  const archive = await fingerprint(path.join(newPrivateDirectory, "image.tar.gz"), 471859200);
  const texts = await Promise.all(["candidate-receipt.json", "self-check.json", "SHA256SUMS"].map(async name => {
    const file = path.join(newPrivateDirectory, name);
    await fingerprint(file, 65536);
    return readFile(file, "utf8");
  }));
  const files = { zipSha256: zip.sha256, zipSizeBytes: zip.size, archiveSha256: archive.sha256, archiveSizeBytes: archive.size,
    receipt: texts[0], selfCheck: texts[1], checksums: texts[2] };
  return verifyBackendBuildEvidence(approvedProfile, run, artifact, files, Date.now());
}
