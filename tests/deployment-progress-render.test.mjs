import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { projectDeploymentProgress, normalizeArchivedDeploymentEvidence } from '../lib/deployments/deployment-progress-v1.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';

const require = createRequire(import.meta.url), { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime.js');
const source = await readFile(new URL('../components/admin/DeploymentProgressPanel.tsx', import.meta.url), 'utf8');
const imports = new Map([
  ['react', import.meta.resolve('react')], ['react/jsx-runtime', import.meta.resolve('react/jsx-runtime')],
  ['next/navigation', import.meta.resolve('next/navigation.js')],
  ['@/lib/deployments/deployment-progress-v1', new URL('../lib/deployments/deployment-progress-v1.ts', import.meta.url).href],
]);
// Transpile the real component, not a duplicated HTML fixture. Real Next router
// context supplies refresh; no server, credentials or network port is opened.
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replace(/from (['"])([^'"]+)\1/g, (_all, _quote, name) => {
    assert.ok(imports.has(name), 'Unexpected component dependency: ' + name); return 'from ' + JSON.stringify(imports.get(name));
  });
const { DeploymentProgressPanel } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let refreshes = 0;
const render = view => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() { refreshes++; } } },
  createElement(DeploymentProgressPanel, { view })));
const NOW = Date.parse('2026-10-19T05:00:00Z');
async function fixture() {
  const record = JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/cloud-worker-w5r.executed.json', import.meta.url), 'utf8'));
  const rawReceipt = { jobId: record.jobId, providerObservationSha256: record.providerObservationSha256, controlCheckedAt: NOW - 60000,
    workloadExpiresAt: NOW + 3600000, privateFixture: 'DO_NOT_RENDER_PRIVATE_INPUT' };
  record.completionReceiptSha256 = await sha256Hex(rawReceipt);
  return { archive: normalizeArchivedDeploymentEvidence(record), rawReceipt, now: NOW, instanceId: record.appId, deploymentId: record.deploymentId,
    view: { supported: true, latest: { jobId: record.jobId, checkedAt: rawReceipt.controlCheckedAt, expiresAt: rawReceipt.workloadExpiresAt, stackId: record.stackId },
      jobs: [{ id: record.jobId, phase: 'succeeded', status: 'succeeded', requestedAt: NOW - 120000, completedAt: NOW - 50000 }] } };
}
test('real SSR panel renders three archive stages and safe links without rendering credentials or execution controls', async () => {
  const html = render(await projectDeploymentProgress(await fixture()));
  for (const text of ['部署进度与验收', '独立验收已归档', '云计划审阅', '实际部署', '独立验收', '不代表实时在线', '不授权再次执行', '不创建或领取任务']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/data-stage-status="verified"/g) ?? []).length, 3);
  assert.equal((html.match(/<button/g) ?? []).length, 1); assert.ok(html.includes('刷新平台记录'));
  assert.ok(html.includes('rel="noopener noreferrer"')); assert.doesNotMatch(html, /DO_NOT_RENDER_PRIVATE_INPUT|F:\/|password|signedUrl/i);
  assert.equal(refreshes, 0);
});
test('pending task does not borrow a prior success; old links stay in a labelled archive', async () => {
  const f = await fixture(); f.view.jobs.push({ id: 'job_' + 'b'.repeat(24), phase: 'awaiting_review', status: 'pending', requestedAt: NOW - 1000, completedAt: null });
  const html = render(await projectDeploymentProgress(f));
  assert.ok(html.includes('新任务待审')); assert.ok(html.includes('上次验收归档（不是新任务授权）'));
  assert.equal((html.match(/data-stage-status="verified"/g) ?? []).length, 0);
  assert.equal((html.match(/data-stage-status="waiting"/g) ?? []).length, 1);
});
test('unmatched or expired evidence is honestly labelled; unsupported scope renders nothing', async () => {
  const f = await fixture();
  const missing = render(await projectDeploymentProgress({ ...f, archive: null }));
  assert.ok(missing.includes('独立验收证据待匹配')); assert.equal((missing.match(/href=/g) ?? []).length, 0);
  const expired = render(await projectDeploymentProgress({ ...f, now: f.rawReceipt.workloadExpiresAt + 1 }));
  assert.ok(expired.includes('标签时间已到期')); assert.ok(expired.includes('自动停费保证'));
  assert.equal(render(null), '');
});
