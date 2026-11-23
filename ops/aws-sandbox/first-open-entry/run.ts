import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { authorizeFirstOpenLaunch, firstOpenPeerRun, launchFirstOpenJob, type LocalLaunch } from "../first-open-workflow-launcher.ts";

async function main() {
  const [, , role] = process.argv;
  if (!(role === "inspect" || role === "management" || role === "runonce" || role === "install-readback") || process.argv.length !== 3) {
    throw Error("FIRST_OPEN_LAUNCH_ROLE");
  }
  const env = process.env, expectedCheckout = (role === "install-readback" ? env.FIRST_OPEN_INSTALL_RUNTIME_COMMIT : env.FIRST_OPEN_EXPECTED_RUNTIME_COMMIT) ?? "";
  if (!/^[a-f0-9]{40}$/.test(expectedCheckout)) throw Error("FIRST_OPEN_LAUNCH_CHECKOUT");
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", timeout: 2500 }).trim();
  if (role === "install-readback") {
    if (env.RUNNER_OS !== "Linux" || !env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP) ||
      git("status", "--porcelain", "--untracked-files=no") !== "") throw Error("FIRST_OPEN_INSTALL_READBACK_RUNNER");
    const { runFirstOpenInstallReadback } = await import("../first-open-install-readback.ts");
    const report = await runFirstOpenInstallReadback({ env, actualCheckout: git("rev-parse", "HEAD"), async uploadEarly(input) {
      const { checkedRunnerPaths, firstOpenSameRunUpload } = await import("./runner-supply.ts");
      return firstOpenSameRunUpload(checkedRunnerPaths("install-readback", env), env)(input);
    } });
    writeFileSync(join(env.RUNNER_TEMP, "fc41597f-install-readback.json"), JSON.stringify(report) + "\n", { flag: "wx", mode: 0o600 });
    if (report.phases.grant?.status !== "MATCHED_INSTALLED_POLICY_DOCUMENTS" ||
      report.phases.relock?.status !== "MATCHED_INSTALLED_POLICY_DOCUMENTS") throw Error("FIRST_OPEN_INSTALL_READBACK_INCOMPLETE");
    return;
  }
  const launch = { role, env, expectedCheckout, actualCheckout: git("rev-parse", "HEAD") } satisfies LocalLaunch;
  const { record } = await authorizeFirstOpenLaunch(launch);
  // Historical A remains usable by offline fixtures, not the real dispatcher.
  if (!record.release.taskRelease) throw Error("FIRST_OPEN_LAUNCH_TASK_RELEASE_REQUIRED");
  if (git("status", "--porcelain", "--untracked-files=no") !== "") throw Error("FIRST_OPEN_LAUNCH_CHECKOUT_DIRTY");
  if (!env.FIRST_OPEN_PROTECTED_HOST_B64) throw Error("FIRST_OPEN_LAUNCH_HOST_UNBOUND");
  const signal = AbortSignal.timeout(Math.max(1, record.release.writeBefore - Date.now()));
  const peerRunId = await firstOpenPeerRun(launch, signal);
  await launchFirstOpenJob({ ...launch, peerRunId }, signal);
}

main().then(() => { console.log("FIRST_OPEN_PINNED_JOB_COMPLETED"); }).catch((error: unknown) => {
  const code = error instanceof Error && /^FIRST_OPEN_[A-Z0-9_]+$/.test(error.message)
    ? error.message : "FIRST_OPEN_PINNED_JOB_STOPPED";
  console.error(code);
  process.exitCode = 1;
});
