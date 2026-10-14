import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import c4e from '../lib/deployments/execution/express-runtime-iam-c4e.cjs';
const h=JSON.parse(readFileSync('F:/ChatGPT_workshop/techlong-d002-express-c4b-review-20261014-r1/iam-metadata.json','utf8'));
const fixture=()=>({roles:h.roles.map(r=>({name:r.name,id:r.roleId,arn:r.arn,trust:structuredClone(r.trust),boundaryArn:r.boundaryArn,attached:r.attached,inline:structuredClone(r.inline),tags:{}})).sort((a,b)=>a.name.localeCompare(b.name)),
  boundary:{arn:c4e.BOUNDARY,id:'ANPAV3GNMXTZHXSTCQBZC',defaultVersion:'v3',document:structuredClone(h.policies[0].document),versions:[{id:'v3',isDefault:true}],
    boundaryConsumers:{roles:Object.entries(c4e.CONSUMERS).map(([name,id])=>({name,id})).sort((a,b)=>a.name.localeCompare(b.name)),users:[],groups:[]},permissionConsumers:{roles:[],users:[],groups:[]}}});
function updated(i,p){const a=structuredClone(i);a.roles.find(r=>r.name===c4e.APP).inline=[{name:'ConnectExactExpressTenantC4e',document:p.documents.application}];
  a.roles.find(r=>r.name===c4e.LIFE).inline[0].document=p.documents.lifecycle;a.boundary.document=p.documents.boundary;a.boundary.defaultVersion='v4';
  a.boundary.versions=[{id:'v3',isDefault:false},{id:'v4',isDefault:true}];return a;}
test('C4e compiles exactly three writes with precise principals/resources and preserved legacy statements',()=>{
  const i=fixture(),p=c4e.compile(i);assert.equal(p.actions.length,3);assert.deepEqual(p.actions.map(a=>a.api),['CreatePolicyVersion','PutRolePolicy','PutRolePolicy']);
  assert.deepEqual(p.documents.boundary.Statement.slice(0,-3),i.boundary.document.Statement);
  assert.deepEqual(p.documents.lifecycle.Statement.slice(0,-2),i.roles.find(r=>r.name===c4e.LIFE).inline[0].document.Statement);
  assert.deepEqual(p.documents.execution,i.roles.find(r=>r.name===c4e.EXEC).inline[0].document);assert.ok(p.boundaryPolicyBytes<=6144);
  assert.equal(p.actions[0].input.SetAsDefault,true);assert.equal(p.documents.application.Statement[0].Resource,p.applicationConnectResource);
  assert.equal(p.documents.boundary.Statement.at(-1).Condition.StringNotEquals['secretsmanager:VersionId'],c4e.VERSION);
  assert.equal(p.documents.boundary.Statement.at(-1).Resource,c4e.SECRET);assert.equal(p.executionAuthorized,false);
});
test('C4e rejects foreign roles, trust, consumers, default documents, lifecycle drift and full version slots',()=>{
  const mutate=fn=>{const i=fixture();fn(i);assert.throws(()=>c4e.compile(i));};
  mutate(i=>i.roles[0].id='foreign');mutate(i=>i.roles[0].trust.Statement[0].Principal.Service='foreign');
  mutate(i=>i.boundary.boundaryConsumers.roles.pop());mutate(i=>i.boundary.permissionConsumers.users.push({name:'foreign',id:'foreign'}));
  mutate(i=>i.roles.find(r=>r.name===c4e.LIFE).inline[0].document.Statement.push({Effect:'Allow',Action:'*',Resource:'*'}));
  mutate(i=>i.boundary.document.Statement.pop());mutate(i=>i.boundary.versions.push(...['v4','v5','v6','v7'].map(id=>({id,isDefault:false}))));
});
test('C4e simulations include correct cross-principal targets and wrong/missing Secret versions, without reading values',()=>{
  const p=c4e.compile(fixture()),cases=c4e.simulations(p);assert.equal(cases.length,6);
  assert.deepEqual(cases[0].expected,['allowed','implicitDeny']);assert.deepEqual(cases[1].expected,['allowed','implicitDeny']);
  assert.deepEqual(cases[4].expected,['explicitDeny']);assert.deepEqual(cases[5].expected,['explicitDeny']);
  assert.equal(cases[5].input.ContextEntries.some(c=>c.ContextKeyName==='secretsmanager:VersionId'),false);
  for(const c of cases){const rows=c.expected.map((decision,n)=>({EvalActionName:c.input.ActionNames[0],EvalResourceName:c.input.ResourceArns[n],EvalDecision:decision,MissingContextValues:[]}));
    c4e.checkSimulation(c,{EvaluationResults:rows});rows[0].EvalDecision='foreign';assert.throws(()=>c4e.checkSimulation(c,{EvaluationResults:rows}));}
});
test('C4e exact SHA approval rejects wrong/expired/rehashed expanded action scope',()=>{
  const i=fixture(),program=c4e.compile(i),now=Date.parse('2026-10-14T23:00:00Z'),code='a'.repeat(64),facts={observedAt:new Date(now).toISOString()};
  const m=c4e.prepare({facts,inventory:i,codeBindingSha256:code,program,now});c4e.approval(m,m.manifestSha256,code,now+1);
  assert.throws(()=>c4e.approval(m,'0'.repeat(64),code,now));assert.throws(()=>c4e.approval(m,m.manifestSha256,code,now+6*3600000));
  const bad=structuredClone(m);bad.limits.iamWrites=4;const {manifestSha256:ignored,...body}=bad;void ignored;bad.manifestSha256=db.digest(body);
  assert.throws(()=>c4e.approval(bad,bad.manifestSha256,code,now),/SCOPE_DRIFT/);
});
test('C4e uses actual resource-specific AWS decisions, never the aggregate service placeholder result',()=>{
  const c=c4e.simulations(c4e.compile(fixture()))[0],r={EvaluationResults:[{EvalActionName:'rds-db:connect',EvalResourceName:'service-placeholder',
    EvalDecision:'implicitDeny',MissingContextValues:['unrelated-legacy-key'],ResourceSpecificResults:c.expected.map((decision,n)=>({
      EvalResourceName:c.input.ResourceArns[n],EvalResourceDecision:decision,MissingContextValues:[]}))}]};
  c4e.checkSimulation(c,r);assert.equal(c4e.simulationRows(r)[0].EvalDecision,'allowed');
  r.EvaluationResults[0].ResourceSpecificResults[0].EvalResourceDecision='implicitDeny';assert.throws(()=>c4e.checkSimulation(c,r));
});
test('C4e independent state classification does not call partial/old state installed and never removes old versions',()=>{
  const i=fixture(),p=c4e.compile(i),a=updated(i,p);
  assert.equal(c4e.inspect(i,a,p),'IAM_DOCUMENTS_INDEPENDENTLY_OBSERVED_NOT_RUNTIME_VERIFIED');
  assert.equal(c4e.inspect(i,i,p),'IAM_ORIGINAL_STATE_OBSERVED_INSTALL_NOT_PROVED');
  a.roles.find(r=>r.name===c4e.APP).inline=[];assert.equal(c4e.inspect(i,a,p),'IAM_PARTIAL_OR_DIVERGENT_STATE_REQUIRES_REVIEW');
  const b=updated(i,p);b.boundary.versions.shift();assert.throws(()=>c4e.inspect(i,b,p),/OLD_POLICY_VERSION_MISSING/);
});
