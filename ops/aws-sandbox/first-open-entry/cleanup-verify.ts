import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { authorizeFirstOpenCleanupLaunch } from "../first-open-cleanup-launch.ts";
import { bindFirstOpenCleanupVerify } from "../first-open-cleanup-verify.ts";
import { firstOpenRunnerOidc } from "../first-open-workflow-launcher.ts";

try {
  const env = process.env;
  if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || !env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP)) throw Error();
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", timeout: 2500, stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (git("status", "--porcelain", "--untracked-files=no") !== "") throw Error();
  const launch = await authorizeFirstOpenCleanupLaunch({ env, actualCheckout: git("rev-parse", "HEAD") }, Date.now());
  const verify = bindFirstOpenCleanupVerify({ ...launch, getToken: firstOpenRunnerOidc(env), backendDirectory: ".first-open-backend" });
  const report = { ...await verify(), bindingSha256: launch.bindingSha256, installationApprovalSha256: launch.installationApprovalSha256 };
  writeFileSync(join(env.RUNNER_TEMP, "fc41597f-cleanup-verify.json"), JSON.stringify(report) + "\n", { flag: "wx", mode: 0o600 });
} catch {
  // Never print provider errors, connection details, OIDC/JWTs, or SQL rows.
  process.stderr.write("FIRST_OPEN_CLEANUP_VERIFY_STOPPED_NO_RETRY\n");
  process.exitCode = 1;
}
