import { readFile, writeFile, realpath, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomId } from "../../../lib/domain/ids.ts";
import { prepareBusinessBootstrap, decodeBusinessBootstrap, runBusinessBootstrap, type BusinessReview, type BusinessSeed } from "../../../lib/deployments/execution/single-tenant-business-bootstrap.ts";
import { createBusinessNeonClient, lockBusinessSources, readBusinessInventory, inspectBusinessBootstrap } from "./single-tenant-business-neon.ts";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";

const args: Record<string, string> = {};
for (let n = 2; n < process.argv.length; n += 2) {
  if (!process.argv[n]?.startsWith("--") || !process.argv[n + 1] || args[process.argv[n]]) throw Error("BUSINESS_BOOTSTRAP_ARGUMENTS_INVALID");
  args[process.argv[n]] = process.argv[n + 1];
}
const mode = args["--mode"], wanted = mode === "Review" ? ["--mode", "--out", ...(args["--seed"] ? ["--seed"] : [])] : mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] : ["--mode", "--out", "--manifest", "--run-report"];
if (!["Review", "Run", "Inspect"].includes(mode) || Object.keys(args).sort().join(",") !== wanted.sort().join(",")) throw Error("BUSINESS_BOOTSTRAP_ARGUMENTS_INVALID");
const root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(args["--out"]);
if (path.dirname(out).toLowerCase() !== root.toLowerCase() || !/^techlong-d001-business-[a-z0-9-]+$/.test(path.basename(out))) throw Error("BUSINESS_BOOTSTRAP_PRIVATE_DIRECTORY_REQUIRED");
await mkdir(out); // fresh exclusive output; never overwrite prior reviews
const save = async (name: string, value: unknown) => { const body = `${JSON.stringify(value, null, 2)}\n`; await writeFile(path.join(out, name), body, { flag: "wx", flush: true }); return sha256Hex(body); };
const privateJson = async (file: string) => {
  const p = path.resolve(file), real = await realpath(p);
  if (real.toLowerCase() !== p.toLowerCase() || !p.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw Error("BUSINESS_BOOTSTRAP_PRIVATE_PATH_INVALID");
  return JSON.parse(await readFile(p, "utf8"));
};
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const files = ["lib/deployments/execution/single-tenant-business-bootstrap.ts", "ops/aws-sandbox/scripts/review-single-tenant-business.ts",
  "ops/aws-sandbox/scripts/single-tenant-business-neon.ts", "lib/domain/ids.ts", "lib/templates/validation.ts", "lib/deployments/environment.ts",
  "lib/deployments/profiles.ts", "lib/deployments/types.ts", "lib/deployments/drivers/aws-ecs-cell.ts", "lib/deployments/cloudformation/tenant-stack.ts",
  "lib/deployments/preflight.ts", "lib/deployments/execution/single-deployment-scope.ts",
  "lib/deployments/execution/cell-launch-readiness-v1.ts", "lib/deployments/execution/hash.ts"];
const pins = await Promise.all(files.map(async file => ({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) })));
const codeBindingSha256 = await sha256Hex(pins), signal = AbortSignal.timeout(55_000);
const slot = path.join(root, "techlong-d001-business-bootstrap.permanent-slot.json");
let db: Awaited<ReturnType<typeof createBusinessNeonClient>> | undefined;
try {
  await save("code-binding.json", { codeBindingSha256, pins });
  const owner = await privateJson(path.join(root, "techlong-d001-owner-readonly-20261013-r1.json"));
  if (!/^usr_[a-f0-9]{24,32}$/.test(owner.ownerUserId) || owner.exactEmailMatchCount !== 1 || typeof owner.suppliedEmail !== "string") throw Error("BUSINESS_BOOTSTRAP_APPROVED_OWNER_REQUIRED");
  db = await createBusinessNeonClient();
  if (mode === "Review") {
    try { await lstat(slot); throw Error("BUSINESS_BOOTSTRAP_SLOT_OCCUPIED_INSPECT_ONLY"); } catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e; }
    const supplied = args["--seed"] ? await privateJson(args["--seed"]) : undefined;
    // A read-only refresh can retain all previously proposed IDs, never a
    // consumed attempt. The owner still comes from the human-selected receipt.
    const seed: BusinessSeed = supplied ? { ...supplied, ownerId: owner.ownerUserId } : { ownerId: owner.ownerUserId,
      workspaceId: randomId("ws"), memberId: randomId("wsm"), subscriptionId: randomId("sub"), appInstanceId: randomId("app"), entitlementId: randomId("ent") };
    await save("seed.json", seed);
    await db.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
    const inventory = await readBusinessInventory(db.client, db.hostSha256, seed, owner.suppliedEmail);
    await db.client.query("ROLLBACK"); signal.throwIfAborted();
    const review = await prepareBusinessBootstrap({ inventory, seed, codeBindingSha256 });
    const fileSha256 = await save("manifest.json", review);
    process.stdout.write(`${JSON.stringify({ mode, directory: out, manifestSha256: review.manifestSha256, fileSha256,
      expiresAt: new Date(review.expiresAt).toISOString(), proposedBusinessRows: 5, environmentPolicyUpdates: 1,
      configurationHash: review.material.configurationHash, configurationFieldCount: Object.keys(review.material.configuration).length,
      futureScope: review.material.futureScope, sourcePolicyBudgetCents: 1000, targetPolicyBudgetCents: 5000, schemaVersion: 2,
      databaseWrites: 0, cloudWrites: 0, jobsCreated: 0, startsTtl: false, runtimeEnabled: false })}\n`);
  } else {
    const review: BusinessReview = await decodeBusinessBootstrap(await privateJson(args["--manifest"]));
    if (review.codeBindingSha256 !== codeBindingSha256) throw Error("BUSINESS_BOOTSTRAP_CODE_BINDING_DRIFT");
    if (review.material.ownerId !== owner.ownerUserId) throw Error("BUSINESS_BOOTSTRAP_OWNER_BINDING_DRIFT");
    if (mode === "Run") {
      const result = await runBusinessBootstrap({ review, approvedSha256: args["--approved-sha"], currentCodeBindingSha256: codeBindingSha256,
        signal, consumeSlot: () => writeFile(slot, `${JSON.stringify({ protocol: "d001-business-bootstrap-permanent-attempt", manifestSha256: review.manifestSha256,
          codeBindingSha256, consumedAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx", flush: true }),
        port: { beginAndLock: () => lockBusinessSources(db!.client, review.material.ownerId), inventory: seed => readBusinessInventory(db!.client, db!.hostSha256, seed, owner.suppliedEmail),
          execute: async statement => { const q = await db!.client.query(statement.text, statement.values); return q.rowCount ?? -1; },
          verify: async r => { const check = await inspectBusinessBootstrap(db!.client, db!.hostSha256, r, owner.suppliedEmail); return Object.values(check.checks).every(Boolean); },
          commit: async () => { await db!.client.query("COMMIT"); }, rollback: async () => { await db!.client.query("ROLLBACK"); } } });
      await save("run.json", { ...result, manifestSha256: review.manifestSha256, codeBindingSha256, seed: review.material.seed });
      process.stdout.write(`${JSON.stringify({ mode, directory: out, ...result })}\n`);
      if (result.outcome !== "BUSINESS_COMMITTED_REQUIRES_INDEPENDENT_INSPECT") process.exitCode = 2;
    } else {
      const run = await privateJson(args["--run-report"]), consumed = await privateJson(slot);
      if (run.manifestSha256 !== review.manifestSha256 || run.codeBindingSha256 !== codeBindingSha256 ||
        !Number.isSafeInteger(run.dmlInvocations) || run.dmlInvocations < 0 || run.dmlInvocations > 6 || run.slotConsumed !== true ||
        !["BUSINESS_COMMITTED_REQUIRES_INDEPENDENT_INSPECT", "COMMIT_UNCERTAIN_INSPECT_NO_RETRY", "STOPPED_INSPECT_NO_RETRY"].includes(run.outcome) ||
        consumed.manifestSha256 !== review.manifestSha256 || consumed.codeBindingSha256 !== codeBindingSha256) throw Error("BUSINESS_BOOTSTRAP_RUN_AND_SLOT_BINDING_REQUIRED");
      await db.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
      const result = await inspectBusinessBootstrap(db.client, db.hostSha256, review, owner.suppliedEmail);
      await db.client.query("ROLLBACK");
      await save("inspect.json", result); process.stdout.write(`${JSON.stringify({ mode, directory: out, ...result })}\n`);
      if (result.outcome !== "BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL") process.exitCode = 2;
    }
  }
} catch (e) {
  const raw = e instanceof Error ? e.message : "ProviderError";
  const failureCode = /^BUSINESS_BOOTSTRAP_[A-Z0-9_]+$/.test(raw) ? raw : e && typeof e === "object" && "code" in e ? String(e.code).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100) : e instanceof Error ? e.name : "ProviderError";
  await save("stopped.json", { mode, failureCode, automaticRetry: false, runtimeEnabled: false });
  process.stdout.write(`${JSON.stringify({ mode, directory: out, failureCode, automaticRetry: false })}\n`); process.exitCode = 2;
} finally { if (db) await db.client.end(); }
