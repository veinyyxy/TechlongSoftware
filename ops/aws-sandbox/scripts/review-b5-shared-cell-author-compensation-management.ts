import { readFile } from "node:fs/promises";
import { reviewSharedCellAuthorCompensationManagementAction } from "../../../lib/deployments/execution/shared-cell-author-compensation-management-entry.ts";

// Deliberately no online mode, credential resolution, or environment-file loading.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--input" || !args[1]) {
  throw new Error("Usage: node --experimental-strip-types review-b5-shared-cell-author-compensation-management.ts --input <review.json>");
}
const raw = await readFile(args[1], "utf8");
if (Buffer.byteLength(raw, "utf8") > 200_000) throw new Error("Review input exceeds the bounded local JSON size.");
const reviewed = await reviewSharedCellAuthorCompensationManagementAction(JSON.parse(raw));
console.log(JSON.stringify(reviewed, null, 2));
