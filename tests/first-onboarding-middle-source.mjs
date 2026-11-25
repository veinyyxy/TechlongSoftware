import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function firstOnboardingMiddleRepositorySource() {
  // The commit that introduced the historical SQL compiler supplies its reviewed input.
  return execFileSync("git", ["--no-replace-objects", "--no-lazy-fetch", "show",
    "8d6a639a7af61d042d74e02f0476a80aa2488991:lib/deployments/execution/neon-repository.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", windowsHide: true,
  });
}
