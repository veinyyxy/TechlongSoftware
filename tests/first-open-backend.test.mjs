import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyFirstOpenBackend } from "../ops/platform-hosting-v1/first-open-backend.mjs";

const source = fileURLToPath(new URL("../ops/platform-hosting-v1/first-open-backend/", import.meta.url));

test("platform first open uses the exact pinned lifecycle and fixed SQL source closure", async () => {
  assert.deepEqual(await verifyFirstOpenBackend(source), {
    commit: "b9ca2138738900afc23a6a2ddce141b37a1f0a31",
    manifestSha256: "e4b1d2a13741fdbf128e5690bc262128efb567cf947eb059dca3e97452828a01",
    sourceFiles: 28,
  });
});

test("platform first open rejects added or modified files and a rewritten closure manifest", async t => {
  const directory = await mkdtemp(join(tmpdir(), "first-open-source-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(source, directory, { recursive: true });
  const unexpected = join(directory, "unreviewed.txt");
  await writeFile(unexpected, "synthetic extra source");
  await assert.rejects(verifyFirstOpenBackend(directory), /ECS_FIRST_OPEN_BACKEND_INTEGRITY/);
  await rm(unexpected);

  const sql = join(directory, "db/saas_control.sql");
  const approved = await readFile(sql);
  const altered = Buffer.from(approved);
  altered[0] ^= 1;
  await writeFile(sql, altered);
  await assert.rejects(verifyFirstOpenBackend(directory), /ECS_FIRST_OPEN_BACKEND_INTEGRITY/);
  await writeFile(sql, approved);

  const manifest = join(directory, "manifest.json");
  await writeFile(manifest, `${await readFile(manifest, "utf8")}\n`);
  await assert.rejects(verifyFirstOpenBackend(directory), /ECS_FIRST_OPEN_BACKEND_INTEGRITY/);
});
