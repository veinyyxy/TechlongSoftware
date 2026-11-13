import { readFile, appendFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { releaseEnvironment, decodeReleaseHandoff,
  type ReleaseRuntimeConfig, type ReleaseJobContext } from "../lib/deployments/releases/handoff.ts";
import { releaseReader } from "../lib/deployments/releases/sampling.ts";
import { inspectInstanceRelease } from "../lib/deployments/releases/inspection.ts";
import { prepareReleaseWorkflowJob, deployReleaseWorkflowJob } from "../lib/deployments/releases/workflow.ts";
import { assumeReleaseIdentity, releaseRepository, releaseMetadataApi, requireHumanReview, releaseCloud, releaseEvidence } from "../ops/releases/aws-runtime.ts";
import { runReleaseInspector, type ReleaseInspectorPacket } from "../ops/releases/inspector-process.ts";
import type { ImageUpdatePlan } from "../lib/deployments/releases/contract.ts";

const root = new URL("../", import.meta.url);
const configFile = new URL("../ops/releases/runtime.json", import.meta.url);
function jobContext(env: NodeJS.ProcessEnv): ReleaseJobContext {
  return { repository: env.GITHUB_REPOSITORY ?? "", repositoryId: env.GITHUB_REPOSITORY_ID ?? "", runId: env.GITHUB_RUN_ID ?? "",
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT), sourceSha: env.GITHUB_SHA ?? "", ref: env.GITHUB_REF ?? "", event: env.GITHUB_EVENT_NAME ?? "",
    actor: env.GITHUB_ACTOR ?? "", workflowRef: env.GITHUB_WORKFLOW_REF ?? "", instanceId: env.RELEASE_INSTANCE_ID ?? "", releaseId: env.RELEASE_ID ?? "", environment: env.RELEASE_ENVIRONMENT ?? "" };
}
async function assertCheckout(sourceSha: string) {
  const actual = await new Promise<string>((resolve, reject) => execFile("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true },
    (error, stdout) => error ? reject(new Error("RELEASE_CHECKOUT_UNAVAILABLE")) : resolve(stdout.trim())));
  if (actual !== sourceSha) throw new Error("RELEASE_CHECKOUT_CHANGED");
}
async function summary(text: string) { if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text); }
async function output(values: Record<string, string>) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}
async function packetFromStdin() {
  let text = "";
  for await (const part of process.stdin) { text += part.toString("utf8"); if (text.length > 16384) throw new Error("RELEASE_PACKET_TOO_LARGE"); }
  return JSON.parse(text) as ReleaseInspectorPacket;
}

async function main() {
  const mode = process.argv[2];
  if (!["prepare", "deploy", "inspect"].includes(mode)) throw new Error("RELEASE_MODE_REJECTED");
  const config = JSON.parse(await readFile(configFile, "utf8")) as ReleaseRuntimeConfig;
  const packet = mode === "inspect" ? await packetFromStdin() : null;
  const job = packet?.job ?? jobContext(process.env), e = releaseEnvironment(config, job);
  if (!e) {
    if (mode === "inspect") throw new Error("RELEASE_NOT_ACTIVATED");
    await output({ status: "DISABLED", enabled: "false" });
    await summary("## Instance API release: DISABLED\n\nNo credentials, database or AWS API were used. Installation and activation require separate review.\n");
    console.log(JSON.stringify({ status: "DISABLED", cloudWrites: 0 })); return;
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("RELEASE_VERIFIED_TLS_REQUIRED");
  await assertCheckout(job.sourceSha);
  const handoff = mode === "deploy" ? await decodeReleaseHandoff(process.env.RELEASE_HANDOFF ?? "", process.env.RELEASE_HANDOFF_SHA ?? "", job, Date.now()) : null;
  if (mode === "deploy") await requireHumanReview(job, e, process.env.RELEASE_GITHUB_READ_TOKEN ?? "");
  const credentials = packet?.credentials ?? await assumeReleaseIdentity(job, e, mode === "prepare" ? "planner" : "executor", process.env);
  const repository = await releaseRepository(e, mode === "prepare" ? "planner" : mode === "inspect" ? "verifier" : "executor", credentials);
  const resolve = async (plan: ImageUpdatePlan) => {
    const context = await repository.context(plan.selection.instanceId), release = context?.releases.find(r => r.id === plan.to.releaseId);
    if (!context || !release || context.binding.accountId !== e.accountId || context.binding.region !== e.region) throw new Error("RELEASE_CONTEXT_UNAVAILABLE");
    return { binding: context.binding, release };
  };
  const reader = releaseReader(resolve, () => releaseMetadataApi(e, credentials), Date.now);
  if (mode === "inspect") {
    if (!packet) throw new Error("RELEASE_PACKET_REQUIRED");
    const transport = releaseEvidence(e, credentials);
    try { console.log(JSON.stringify(await inspectInstanceRelease(packet.input, { repository, reader, evidence: transport.evidence, now: Date.now }))); }
    finally { transport.destroy(); }
    return;
  }
  if (mode === "prepare") {
    const prepared = await prepareReleaseWorkflowJob(job, e, { repository, api: releaseMetadataApi(e, credentials), now: Date.now });
    await summary(prepared.summary); await output(prepared.outputs);
    if (!prepared.ok) process.exitCode = 1;
    return;
  }
  if (!handoff) throw new Error("RELEASE_HANDOFF_REQUIRED");
  const transport = releaseCloud(e, credentials);
  try {
    const result = await deployReleaseWorkflowJob(job, e, process.env.RELEASE_HANDOFF ?? "", process.env.RELEASE_HANDOFF_SHA ?? "", {
      repository, cloud: transport.cloud, reader, now: Date.now, pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
      inspector: { inspect: async input => {
        if (Date.now() >= input.readBefore) throw new Error("RELEASE_INSPECTION_EXPIRED");
        const verifierCredentials = await assumeReleaseIdentity(job, e, "verifier", process.env);
        if (Date.now() >= input.readBefore) throw new Error("RELEASE_INSPECTION_EXPIRED");
        return runReleaseInspector({ job, input, credentials: verifierCredentials });
      } },
    });
    await summary("## Instance API release result\n\n```json\n" + JSON.stringify(result, null, 2) + "\n```\n");
    console.log(JSON.stringify(result));
    if (!["SUCCEEDED", "NO_CHANGE"].includes(result.status)) process.exitCode = 1;
  } finally { transport.destroy(); }
}

main().catch(() => { console.error("INSTANCE_RELEASE_STOPPED_NO_RETRY"); process.exitCode = 1; });
