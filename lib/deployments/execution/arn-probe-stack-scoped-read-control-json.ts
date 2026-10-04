import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

// The real generation5 review retains the complete four-generation predecessor
// and is ~916 KB as pretty JSON. Keep old archived readers at 600 KB; only the
// new J22 review/manifest inputs use this bounded reader. Strict schema/hash
// recompilation still happens before any SDK/client/MFA capability is created.
export const STACK_CONTROL_REVIEW_MAX_BYTES = 2_000_000;
export async function readStackControlReviewJson(file: string) {
  if (!path.isAbsolute(file) || /^(?:\\\\|\/\/)/.test(file)) throw new Error("J22 review requires an explicit local absolute path.");
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > STACK_CONTROL_REVIEW_MAX_BYTES) throw new Error("J22 review must be an ordinary bounded singleton file.");
  const data = await readFile(file), after = await lstat(file);
  if (data.byteLength !== before.size || after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
    !after.isFile() || after.isSymbolicLink() || after.nlink !== 1) throw new Error("J22 review changed during read.");
  return JSON.parse(data.toString("utf8"));
}
