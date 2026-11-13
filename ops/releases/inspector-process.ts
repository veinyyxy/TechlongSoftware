import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ReleaseJobContext } from "../../lib/deployments/releases/handoff.ts";
import type { IndependentInspectionInput } from "../../lib/deployments/releases/inspection.ts";
import type { ReleaseEvidenceReference } from "../../lib/deployments/releases/repository.ts";
import { releaseChildEnvironment, type ReleaseCredentials } from "./aws-runtime.ts";

export interface ReleaseInspectorPacket { job: ReleaseJobContext; input: IndependentInspectionInput; credentials: ReleaseCredentials }
type SpawnInspector = (binary: string, args: string[], options: {
  env: NodeJS.ProcessEnv; cwd: string; shell: false; windowsHide: true; stdio: ["pipe", "pipe", "pipe"];
}) => ChildProcessWithoutNullStreams;

/** No write credentials, OIDC API token, GitHub token, database URL, profile or NODE_OPTIONS in env.
 * Only newly obtained verifier credentials cross stdin; nothing secret is written to disk/argv/logs. */
export function runReleaseInspector(packet: ReleaseInspectorPacket, parent: NodeJS.ProcessEnv = process.env,
  start: SpawnInspector = spawn): Promise<ReleaseEvidenceReference> {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = start(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../../scripts/instance-release.ts", import.meta.url)), "inspect"],
      { env: releaseChildEnvironment(parent), cwd: root, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", failed = false;
    const fail = () => { if (!failed) { failed = true; child.kill(); reject(new Error("RELEASE_INSPECTOR_PROCESS_FAILED")); } };
    const timer = setTimeout(fail, Math.max(1, Math.min(600_000, packet.input.readBefore - Date.now())));
    child.on("error", fail); child.stdin.on("error", fail);
    child.stdout.on("data", bytes => { output += bytes.toString("utf8"); if (output.length > 8192) fail(); });
    child.stderr.resume(); // Never echo provider errors or child diagnostics into workflow logs.
    child.on("close", code => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) { fail(); return; }
      try {
        const value = JSON.parse(output) as ReleaseEvidenceReference;
        if (!value.bucket || !value.key || !value.versionId || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error("bad result");
        resolve({ bucket: value.bucket, key: value.key, versionId: value.versionId, sha256: value.sha256 });
      } catch { fail(); }
    });
    child.stdin.end(JSON.stringify(packet));
  });
}
