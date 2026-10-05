import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile, link, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readStackControlReviewJson, STACK_CONTROL_REVIEW_MAX_BYTES } from "../lib/deployments/execution/arn-probe-stack-scoped-read-control-json.ts";
import { readArnProbeReadComparisonJson } from "../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";

async function temp(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "techlong-j22-json-test-")));
  try { await run(root); } finally { const resolved = await realpath(root), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.match(path.basename(resolved), /^techlong-j22-json-test-/); await rm(resolved, { recursive: true, force: true }); }
}
test("J22 review reader accepts bounded retained evidence above 600 KB without widening old readers", async () => {
  await temp(async root => { const file = path.join(root, "large.json"), value = { padding: "x".repeat(920_000) };
    await writeFile(file, JSON.stringify(value)); assert.deepEqual(await readStackControlReviewJson(file), value);
    await assert.rejects(readArnProbeReadComparisonJson(file), /bounded file/);
    const exact = { padding: "x".repeat(STACK_CONTROL_REVIEW_MAX_BYTES - 14) }; assert.equal(Buffer.byteLength(JSON.stringify(exact)), STACK_CONTROL_REVIEW_MAX_BYTES);
    await writeFile(file, JSON.stringify(exact)); assert.deepEqual(await readStackControlReviewJson(file), exact); });
});
test("J22 review reader rejects overlimit, relative/remote, directory, malformed and multiply linked records", async () => {
  await temp(async root => { const file = path.join(root, "review.json"); await writeFile(file, "x".repeat(STACK_CONTROL_REVIEW_MAX_BYTES + 1));
    await assert.rejects(readStackControlReviewJson(file), /bounded/); await assert.rejects(readStackControlReviewJson("relative.json"), /absolute/);
    await assert.rejects(readStackControlReviewJson("\\\\server\\share\\review.json"), /local absolute/); await assert.rejects(readStackControlReviewJson(root), /bounded/);
    await writeFile(file, "not JSON"); await assert.rejects(readStackControlReviewJson(file), SyntaxError);
    await writeFile(file, "{}"); await link(file, path.join(root, "linked.json")); await assert.rejects(readStackControlReviewJson(file), /singleton/); });
});
test("J22 wrapper parses cleanly and only explicit new review inputs get the larger bound", async () => {
  const wrapper = fileURLToPath(new URL("../ops/aws-sandbox/scripts/Invoke-ReviewedStackScopedReadControl.ps1", import.meta.url));
  const source = await readFile(wrapper, "utf8");
  assert.match(source, /\$review = Read-OrdinaryJson \$executionOutput 2000000/);
  assert.match(source, /\$review = Read-OrdinaryJson \$ExecutionReview 2000000/);
  assert.match(source, /\$null = Read-OrdinaryJson \$Evidence\r?\n/);
  await temp(async root => { const file = path.join(root, "large.json"); await writeFile(file, JSON.stringify({ padding: "x".repeat(920_000) }));
    const command = "$taskTokens=$null; $taskErrors=$null; $taskAst=[System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$taskTokens,[ref]$taskErrors); if($taskErrors.Count){throw 'Parse failed'}; $taskFunction=$taskAst.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Read-OrdinaryJson'},$true); . ([scriptblock]::Create($taskFunction.Extent.Text)); $taskValue=Read-OrdinaryJson $args[1] 2000000; if($taskValue.padding.Length -ne 920000){throw 'Wrong data'}; try { Read-OrdinaryJson $args[1]; throw 'Old bound unexpectedly accepted' } catch { if($_.Exception.Message -notlike '*Bounded ordinary*'){throw} }; 'BOUNDARY_VERIFIED'";
    const child = spawnSync("C:/Program Files/PowerShell/7/pwsh.exe", ["-NoProfile", "-Command", `& { ${command} } '${wrapper.replaceAll("'", "''")}' '${file.replaceAll("'", "''")}'`], { encoding: "utf8", timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /BOUNDARY_VERIFIED/); assert.doesNotMatch(child.stdout, /Enter MFA/); });
});
