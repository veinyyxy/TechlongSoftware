import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { compileExpressBootstrapCandidateV3, expressBootstrapCandidateDigestV3,
  type ExpressManagementTargetV3 } from '../lib/deployments/execution/aurora-express-bootstrap-v3.ts';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';

const scope = { appInstanceId: 'app-v3-synthetic', workspaceId: 'workspace-synthetic', productId: 'product-synthetic',
  environmentId: 'environment-synthetic', cellKey: 'cell-sandbox-1' as const };
const stableIdentity = db.digest(scope);
const target: ExpressManagementTargetV3 = { schema: 'techlong/express-management-target/v3',
  clusterArn: 'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-fixture',
  clusterResourceId: 'cluster-ABCDEFGHIJKL012345678901', endpoint: 'techlong-sandbox-express-fixture.cluster-fixture.ca-central-1.rds.amazonaws.com',
  port: 5432, observedEngineVersion: '17.9', managementDatabase: 'postgres', managementUsername: 'postgres', stableIdentity,
  tenantDatabase: `tenant_${stableIdentity.slice(0,16)}_db`, tenantUsername: `tenant_${stableIdentity.slice(0,16)}_role`, resourceGeneration: 1 };
test('V3 pre-Secret review is detached finite NOLOGIN data and never fabricates runtime authority', () => {
  const input = { target: { ...target }, scope: { ...scope }, nonce: 'c'.repeat(32) };
  const p = compileExpressBootstrapCandidateV3(input), sha = expressBootstrapCandidateDigestV3(p);
  input.scope.workspaceId = 'changed'; input.target.tenantDatabase = 'changed';
  assert.equal(p.scope.workspaceId, scope.workspaceId); assert.equal(Object.isFrozen(p.stages[0].statements), true);
  assert.equal(p.statementCount, 15); assert.equal(p.baseline.tables, 73); assert.equal(p.executionAuthorized, false);
  assert.equal(p.runtimeEnabled, false); assert.equal(JSON.stringify(p).includes('runtimeSecret'), false);
  assert.equal(p.stages[1].statements.length, 1); assert.ok(p.stages[1].statements[0].endsWith('ALLOW_CONNECTIONS false'));
  assert.equal(p.stages[2].statements.some((q: string) => q.startsWith('REVOKE ALL')), true);
  assert.notEqual(expressBootstrapCandidateDigestV3(compileExpressBootstrapCandidateV3({ target, scope, nonce: 'd'.repeat(32) })), sha);
  assert.throws(() => compileExpressBootstrapCandidateV3({ target, scope: { ...scope, workspaceId: 'foreign' }, nonce: 'c'.repeat(32) }));
  assert.throws(() => compileExpressBootstrapCandidateV3({ target: { ...target, tenantUsername: 'postgres' }, scope, nonce: 'c'.repeat(32) }));
});
test('V3 SQL compiler stays byte-identical across platform and backend', t => {
  const peerUrl = new URL('../../SpeedFeast_Backend_main/services/saas/aurora-express-bootstrap-v3.cjs', import.meta.url);
  if (!existsSync(peerUrl)) return t.skip('Peer checkout unavailable; compare during dual-repo release preparation.');
  const local = readFileSync(new URL('../lib/deployments/execution/aurora-express-bootstrap-v3.cjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const peer = readFileSync(peerUrl, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(local, peer);
});
