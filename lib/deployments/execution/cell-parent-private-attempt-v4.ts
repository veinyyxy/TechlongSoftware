import { realpath, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { CELL_PARENT_BOOTSTRAP_V4 } from "./cell-parent-bootstrap-v4.ts";
import { cellV3Fail } from "../cloudformation/shared-cell-stack-v3.ts";
/** Fixed private durable slot. No caller path, replace/remove, retry or reset. */
export function createCellParentPrivateAttemptV4(kind: "bootstrap" | "registration") {
  if (!["bootstrap", "registration"].includes(kind)) cellV3Fail("CELL_PARENT_PRIVATE_SLOT_KIND_INVALID");
  return Object.freeze({ async claimOnce(approvedSha256: string) {
    if (!/^[a-f0-9]{64}$/.test(approvedSha256)) cellV3Fail("CELL_PARENT_PRIVATE_SLOT_APPROVAL_INVALID");
    const root = "F:/ChatGPT_workshop", resolved = await realpath(root);
    if ((await lstat(root)).isSymbolicLink() || path.resolve(resolved).toLowerCase() !== path.resolve(root).toLowerCase()) cellV3Fail("CELL_PARENT_PRIVATE_SLOT_ROOT_INVALID");
    const name = kind === "bootstrap" ? CELL_PARENT_BOOTSTRAP_V4.localBootstrapSlot : CELL_PARENT_BOOTSTRAP_V4.localRegistrationSlot;
    try { await writeFile(path.join(resolved, name), JSON.stringify({ protocol: "cell-parent-permanent-local-attempt-v4", approvedSha256, attemptedAt: new Date().toISOString(), retryAuthorized: false }) + "\n", { flag: "wx", flush: true }); return true; }
    catch (e) { if ((e as { code?: string }).code === "EEXIST") return false; return cellV3Fail("CELL_PARENT_PRIVATE_SLOT_SAVE_FAILED"); }
  } });
}
