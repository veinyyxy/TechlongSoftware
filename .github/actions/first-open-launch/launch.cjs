const { spawnSync } = require("node:child_process");

const role = process.env.INPUT_ROLE;
if (!["runonce", "inspect"].includes(role) || !process.env.ACTIONS_RUNTIME_TOKEN || !process.env.ACTIONS_RESULTS_URL) {
  console.error("FIRST_OPEN_ARTIFACT_RUNTIME_UNAVAILABLE");
  process.exitCode = 1;
} else {
  // PATH comes from the pinned setup-node step. The local JavaScript action
  // receives artifact runtime credentials for this run; a shell step need not.
  const result = spawnSync("node", ["--disable-warning=ExperimentalWarning", "--experimental-strip-types",
    "ops/aws-sandbox/first-open-entry/run.ts", role], { stdio: "inherit", shell: false,
    env: { ...process.env, FIRST_OPEN_ARTIFACT_NODE: process.execPath } });
  process.exitCode = result.status ?? 1;
}
