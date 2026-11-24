import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { verifyStripeBackendOriginalZip } from "../ops/releases/first-open-stripe-artifact-verify.ts";
import { releaseProductionFixture } from "./instance-release-fixture.ts";

const commit = "1cd598f1fc7505813b311783b1a96b40c2a60251";
const repoId = 1064124445;
const python = process.platform === "win32" ? path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe") : "python3";
const names = ["image.tar.gz", "candidate-receipt.json", "self-check.json", "SHA256SUMS"];
test("Stripe candidate artifact: exact original workflow and push, ZIP/receipts, and no overwrite", async () => {
  const base = await releaseProductionFixture();
  const run = { ...base.run, workflow_id: 377674976, repository: { id: repoId, full_name: "veinyyxy/SpeedFeast_Backend_main" },
    head_repository: { id: repoId }, head_sha: commit };
  base.receipt.sourceCommit = commit;
  base.receipt.osSecurityScan.databaseUpdatedAt = new Date(Date.now() - 3000).toISOString();
  base.receipt.osSecurityScan.scannerArchiveSha256 = "c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f";
  await base.repack();
  const root = await mkdtemp(path.join(tmpdir(), "stripe-candidate-"));
  const zipPath = path.join(root, "fixture.zip"), outputDirectory = path.join(root, "checked");
  try {
    execFileSync(python, ["-I", "-c", "import json, sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], 'x') as z:\n    for name, body in json.load(sys.stdin).items():\n        z.writestr(name, body)", zipPath], {
      input: JSON.stringify({ "image.tar.gz": "synthetic-image", "candidate-receipt.json": base.files.receipt,
        "self-check.json": base.files.selfCheck, SHA256SUMS: base.files.checksums }), timeout: 10000,
    });
    const zip = await readFile(zipPath);
    const artifact = { ...base.artifact, name: `checked-app-${commit}-${run.id}-1`, size_in_bytes: zip.length,
      expires_at: new Date(Date.now() + 60000).toISOString(), digest: `sha256:${createHash("sha256").update(zip).digest("hex")}`,
      workflow_run: { id: run.id, repository_id: repoId, head_repository_id: repoId, head_sha: commit, head_branch: "main" } };
    const exact = { run, artifact, zipPath, outputDirectory };
    await assert.rejects(verifyStripeBackendOriginalZip({ ...exact, run: { ...run, workflow_id: 1 } }), /EXACT_METADATA_REQUIRED/);
    await assert.rejects(verifyStripeBackendOriginalZip({ ...exact, run: { ...run, event: "workflow_dispatch" } }), /EXACT_METADATA_REQUIRED/);
    await assert.rejects(verifyStripeBackendOriginalZip({ ...exact, artifact: { ...artifact, size_in_bytes: zip.length + 1 } }), /ZIP_MISMATCH/);
    const verified = await verifyStripeBackendOriginalZip(exact);
    assert.equal(verified.source.commit, commit);
    assert.equal(verified.artifact.archiveSha256, base.files.archiveSha256);
    assert.equal(verified.imageConfigDigest, base.receipt.imageConfigDigest);
    await assert.rejects(verifyStripeBackendOriginalZip(exact), /EXTRACTION_FAILED_NO_RETRY/);
  } finally {
    for (const name of names) await unlink(path.join(outputDirectory, name)).catch(() => {});
    await rmdir(outputDirectory).catch(() => {});
    await unlink(zipPath).catch(() => {});
    await rmdir(root);
  }
});
