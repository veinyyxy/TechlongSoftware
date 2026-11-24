import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { inspectFirstOpenInstallHostTransport } from "../ops/aws-sandbox/first-open-install-host-transport.ts";

const other = "https://managed.example.test/Team/Project.git";
const target = "https://github.com/veinyyxy/TechlongSoftware.git";
const err = /FIRST_OPEN_INSTALL_HOST_TRANSPORT_OVERRIDE/;
const config = (pairs: readonly (readonly [string, string])[]) => Object.fromEntries([
  ["GIT_CONFIG_COUNT", String(pairs.length)], ...pairs.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]]),
]);

test("accepts only disjoint managed HTTPS settings and preserves every pair including an empty helper reset", () => {
  const managed = config([[`credential.${other}.helper`, ""], [`credential.${other}.helper`, "!existing-managed-helper"],
    [`credential.${other}.useHttpPath`, "true"], [`http.${other}.proactiveAuth`, "auto"], [`http.${other}.followRedirects`, "false"]]);
  const unchanged = { ...managed }, actual = inspectFirstOpenInstallHostTransport({ ...managed, PATH: "omitted" });
  assert.equal(actual.mode, "managed-disjoint");
  assert.equal(actual.configCount, 5);
  assert.deepEqual(actual.config, unchanged);
  assert.notEqual(actual.config, managed);
  assert.ok(Object.isFrozen(actual.config));
  assert.deepEqual(managed, unchanged);
  assert.deepEqual(inspectFirstOpenInstallHostTransport({}), { mode: "plain", configCount: 0, config: {} });
});

test("rejects target, generic, rewrite, ambiguous or incomplete config rather than dropping it", () => {
  for (const key of [`credential.${target}.helper`, "credential.https://GitHub.COM/veinyyxy/TechlongSoftware.git.helper",
    "credential.https://github.com./org/repo.helper", "credential.https://api.github.com/org/repo.helper",
    "credential.https://*.example.test/org/repo.helper", "credential.https://user@managed.example.test/org/repo.helper",
    "credential.https://managed.example.test:443/org/repo.helper", "credential.https://managed.example.test/org%2frepo/helper.helper",
    "credential.https://managed.example.test/org/../repo.helper", "credential.helper", "include.path", `http.${other}.sslVerify`,
    `http.${other}.extraHeader`, `url.${other}.insteadOf`]) {
    assert.throws(() => inspectFirstOpenInstallHostTransport(config([[key, "!not-run"]])), err);
  }
  for (const env of [config([[`http.${other}.followRedirects`, "true"]]), config([[`http.${other}.proactiveAuth`, "basic"]]),
    { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `credential.${other}.helper` },
    { ...config([[`credential.${other}.helper`, ""]]), GIT_CONFIG_VALUE_4: "extra" },
    { ...config([[`credential.${other}.helper`, ""]]), git_config_count: "1" },
    { GIT_CONFIG_PARAMETERS: "unknown" }, { GIT_CONFIG_GLOBAL: "outside-config" }, { GIT_SSL_NO_VERIFY: "1" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" }]) assert.throws(() => inspectFirstOpenInstallHostTransport(env), err);
});

test("offline check preflight stops on the same unsafe transport guard before reading any approval artifacts", async () => {
  const child = await promisify(execFile)(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", "--input-type=module", "-e", `
    import { verifyFirstOpenInstallHostLocal } from './ops/aws-sandbox/first-open-install-host.ts';
    try { await verifyFirstOpenInstallHostLocal({ plan: null, approvedPlanSha256: '', workspaceRoot: 'not-an-absolute-path',
      signal: new AbortController().signal }); }
    catch (e) { console.log(e.message); }
  `], { env: { ...process.env, GIT_CONFIG_PARAMETERS: "synthetic-global-override" }, windowsHide: true, timeout: 10000 });
  assert.equal(child.stdout.trim(), "FIRST_OPEN_INSTALL_HOST_TRANSPORT_OVERRIDE");
});
