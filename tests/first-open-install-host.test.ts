import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import type { FirstOpenInstallSequencePlan } from "../ops/aws-sandbox/first-open-install-sequence.ts";
import { assertFirstOpenInstallHostApproval, runFirstOpenInstallHost, sealFirstOpenInstallHostApproval } from "../ops/aws-sandbox/first-open-install-host.ts";

const jobId = "job_fc41597f9b5ba8e02b338ecf";
const intent = "a".repeat(64), owner = "b".repeat(64), projection = "e".repeat(64);
const runtime = "1".repeat(40), caller = "2".repeat(40);
const start = 1_700_000_000_000, finish = start + 90 * 60_000;

async function fixture() {
  // The separate host plan test verifies the complete renderer. Here only
  // the outer binding is exercised; no credentials/provider dependencies run.
  const sequence = { schema: "techlong/fc41597f-install-sequence/v1", terminalReadback: "same-source-readonly-subprocess",
    sourceSessionPolicy: "bounded-same-iam-source/v1",
    bucket: { jobId, factsExpireAt: finish, installIntentSha256: intent, ownerReadReceiptSha256: owner,
      phases: { protect: { startAt: start } } }, owner: { jobId, approvalSha256: intent },
    readback: { factsReceiptSha256: owner, release: { jobId, startAt: finish + 15 * 60_000, approvalSha256: intent,
      runtimeCommit: runtime, callerCommit: caller, runtimeSourceSha256: projection } },
  } as FirstOpenInstallSequencePlan;
  return sealFirstOpenInstallHostApproval({ sequence, publication: { sealSha256: "c".repeat(64), base: "3".repeat(40),
    runtime, caller, sourceProjectionSha256: projection }, facts: { awsCellRawSha256: "d".repeat(64),
    neonRawSha256: "f".repeat(64), ownerRawSha256: owner, stagingGateRawSha256: "1".repeat(64) } }, resolve("."));
}

test("one outer SHA binds the runtime, facts and no-claim install scope", async () => {
  const { plan, approvedPlanSha256 } = await fixture();
  await assertFirstOpenInstallHostApproval(plan, approvedPlanSha256);
  assert.equal(plan.scope.firstOpenAuthorized, false);
  assert.equal(plan.scope.claims, 0);
  assert.equal(plan.scope.requiresHumanGitHubApproval, true);
  assert.equal(plan.scope.sourceSigninRefreshes, 12);
  assert.equal(plan.scope.sourceSts, 14);
  const edited = structuredClone(plan);
  edited.publication.caller = "8".repeat(40);
  await assert.rejects(assertFirstOpenInstallHostApproval(edited, approvedPlanSha256), /APPROVAL_SHA_OR_SCOPE/);
  await assert.rejects(assertFirstOpenInstallHostApproval(edited, await sha256Hex(edited)), /PUBLICATION_BINDING/);
  edited.publication.caller = caller;
  edited.facts.ownerRawSha256 = "9".repeat(64);
  await assert.rejects(assertFirstOpenInstallHostApproval(edited, await sha256Hex(edited)), /FACT_RECEIPT_BINDING/);
});

test("a missed launch window stops before touching the workspace or asking for approval", async () => {
  const { plan, approvedPlanSha256 } = await fixture();
  await assert.rejects(runFirstOpenInstallHost({ plan, approvedPlanSha256, workspaceRoot: "not-a-workspace",
    signal: new AbortController().signal, onApprovalRequired: () => assert.fail("no GitHub gate on a closed window") }), /LAUNCH_WINDOW/);
});
