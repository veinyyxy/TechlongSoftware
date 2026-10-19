import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { CONTROL_SCOPE } from '../lib/deployments/controller-v6/contract.ts';
import { projectStatus } from '../lib/deployments/controller-v6/controller.ts';
const require=createRequire(import.meta.url),{AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime.js');
const source=await readFile(new URL('../components/admin/DeploymentControlPanel.tsx',import.meta.url),'utf8');
const imports=new Map([['react',import.meta.resolve('react')],['react/jsx-runtime',import.meta.resolve('react/jsx-runtime')],['next/navigation',import.meta.resolve('next/navigation.js')]]);
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  .replace(/from (['"])([^'"]+)\1/g,(_all,_quote,name)=>{assert.ok(imports.has(name));return 'from '+JSON.stringify(imports.get(name));});
const {DeploymentControlPanel}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function render(view){return renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:{refresh(){throw Error('SSR must not refresh');}}},
  createElement(DeploymentControlPanel,{view,instanceId:CONTROL_SCOPE.instanceId})));}
function row(state,mode='Review',runId=null){return projectStatus({planSha256:'a'.repeat(64),actionSha256:'b'.repeat(64),riskSha256:'c'.repeat(64),
  jobId:'job_'+'d'.repeat(24),mode,sourceCommit:'e'.repeat(40),expiresAt:Date.parse('2026-10-19T13:00:00Z'),state,runId,
  status:runId?'completed':null,conclusion:runId?'success':null,proofSha256:null,privatePayload:'DO_NOT_OUTPUT'});}
test('actual component default view has no action button, credential or network action',()=>{
  const html=render({enabled:false,plans:[],canApproveEnvironment:false,canRetry:false});
  assert.match(html,/控制器尚未启用/);assert.doesNotMatch(html,/<button|private-key|DO_NOT_OUTPUT|github_pat|BEGIN RSA/);
});
test('exact plan/action/risk summaries are visible; unknown is not retryable or green',()=>{
  const pending=render({enabled:true,plans:[row('AWAITING_APPROVAL')],canApproveEnvironment:false,canRetry:false});
  assert.match(pending,/批准并单次调度 Review/);assert.ok(pending.includes('a'.repeat(64)));assert.ok(pending.includes('c'.repeat(64)));
  const unknown=render({enabled:true,plans:[row('UNKNOWN')],canApproveEnvironment:false,canRetry:false});assert.doesNotMatch(unknown,/<button/);
  for(const state of ['EXPIRED','SLOT_OCCUPIED'])assert.doesNotMatch(render({enabled:true,plans:[row(state)],canApproveEnvironment:false,canRetry:false}),/<button/);
  const completed=render({enabled:true,plans:[row('OBSERVED','Inspect','123')],canApproveEnvironment:false,canRetry:false});
  assert.match(completed,/不能判定部署验收通过/);assert.match(completed,/rel="noopener noreferrer"/);assert.doesNotMatch(completed,/DO_NOT_OUTPUT/);
});
test('real route/page use admin gate and candidate-only runtime; launcher and old workflow remain unchanged',async()=>{
  const route=await readFile(new URL('../app/api/admin/instances/[instanceId]/deployment-control/route.ts',import.meta.url),'utf8');
  assert.match(route,/requirePlatformAdminApi/);assert.match(route,/platformControlEnabled/);
  const runtime=await readFile(new URL('../lib/deployments/controller-v6/runtime.ts',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/readFile|child_process|\.pem|fromLoginCredentials/);
  const launcher=await readFile(new URL('../scripts/local-deployment-platform.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(launcher,/TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY/);
  const old=await readFile(new URL('../.github/workflows/cloud-worker-execute.yml',import.meta.url),'utf8');assert.match(old,/github.actor_id == '14145707'/);
});
