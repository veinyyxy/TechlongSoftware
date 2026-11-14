import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { CheckedBuildFiles, ReleaseBuildArtifact } from "../../lib/deployments/releases/production.ts";
import { releaseChildEnvironment } from "./aws-runtime.ts";

async function fingerprint(file: string, maximum: number) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) throw new Error("RELEASE_BUILD_FILE_REJECTED");
  const h = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length; if (bytes > maximum) throw new Error("RELEASE_BUILD_FILE_REJECTED"); h.update(chunk);
  }
  if (bytes !== stat.size) throw new Error("RELEASE_BUILD_FILE_CHANGED");
  return { sha256: h.digest("hex"), size: bytes };
}

/** Explicit local files only. No credential loading, GitHub download, Docker or ECR calls.
 * Uses the existing backend extraction recipe; no arbitrary command/script input or overwrite. */
export async function readCheckedBuildFiles(artifact: ReleaseBuildArtifact, zipPath: string, outputDirectory: string): Promise<CheckedBuildFiles> {
  if (!path.isAbsolute(zipPath) || !path.isAbsolute(outputDirectory)) throw new Error("RELEASE_BUILD_ABSOLUTE_PATH_REQUIRED");
  const zip = await fingerprint(zipPath, 500 * 1024 * 1024);
  if (`sha256:${zip.sha256}` !== artifact.digest || zip.size !== artifact.size_in_bytes) throw new Error("RELEASE_BUILD_ZIP_MISMATCH");
  const script = fileURLToPath(new URL("./extract-build-artifact.py", import.meta.url));
  await new Promise<void>((resolve, reject) => execFile("python3", [script, zipPath, outputDirectory],
    { shell: false, windowsHide: true, env: releaseChildEnvironment(process.env), timeout: 60_000, maxBuffer: 65536 },
    error => error ? reject(new Error("RELEASE_BUILD_EXTRACTION_FAILED_NO_RETRY")) : resolve()));
  const archive = await fingerprint(path.join(outputDirectory, "image.tar.gz"), 471859200);
  const texts = await Promise.all(["candidate-receipt.json", "self-check.json", "SHA256SUMS"].map(async name => {
    const file = path.join(outputDirectory, name); await fingerprint(file, 65536);
    return readFile(file, "utf8");
  }));
  return { zipSha256: zip.sha256, zipSizeBytes: zip.size, archiveSha256: archive.sha256, archiveSizeBytes: archive.size,
    receipt: texts[0], selfCheck: texts[1], checksums: texts[2] };
}
