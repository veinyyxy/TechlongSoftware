import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import { C2A_SHA, type DiagnosticFacts, type ExistingExpressBinding } from '../lib/deployments/execution/aurora-express-c2-diagnostic-review.ts';
import { prepareC3Review, assertC3Approval } from '../lib/deployments/execution/aurora-express-c3-review.ts';
const now = Date.parse('2026-10-14T05:00:00Z');
const binding: ExistingExpressBinding = { manifestSha256:C2A_SHA,
  clusterArn:'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001',clusterResourceId:'cluster-ABCDEFGHIJKLMNOPQRSTUVWX',
  createdAt:'2026-10-14T03:00:00Z',engineVersion:'17.9',endpoint:'fixture.cluster-example.ca-central-1.rds.amazonaws.com',port:5432,
  writerIdentifier:'techlong-sandbox-express-d001-instance-1',writerArn:'arn:aws:rds:ca-central-1:402010193138:db:techlong-sandbox-express-d001-instance-1',
  writerResourceId:'db-ABCDEFGHIJKLMNOPQRSTUVWX',writerCreatedAt:'2026-10-14T03:00:01Z',clusterStatus:'available',writerStatus:'available',
  tags:{ManagedBy:'techlong-sandbox',DatabaseProfile:'express_iam',DeliveryTrack:'D002-C2-admin-facts',ProbeNonce:'c'.repeat(32)}};
function input() {
  const scope={appInstanceId:'app-synthetic',workspaceId:'ws-synthetic',productId:'product-synthetic',environmentId:'env-synthetic',cellKey:'cell-sandbox-1'};
  const stableIdentity=db.digest(scope),facts:DiagnosticFacts={observedAt:new Date(now).toISOString(),binding,
    source:{Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
    plan:{planType:'FREE',planStatus:'ACTIVE'},connectPermission:{action:'rds-db:connect',resource:`arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`,decision:'allowed',missingContext:[]}};
  return {facts,expectedBinding:binding,codeBindingSha256:'d'.repeat(64),historySha256:'e'.repeat(64),candidateInput:{scope,nonce:'c'.repeat(32),
    target:{schema:'techlong/express-management-target/v3',clusterArn:binding.clusterArn,clusterResourceId:binding.clusterResourceId,endpoint:binding.endpoint,port:5432,
      observedEngineVersion:'17.9',managementDatabase:'postgres',managementUsername:'postgres',stableIdentity,resourceGeneration:1,
      tenantDatabase:`tenant_${stableIdentity.slice(0,16)}_db`,tenantUsername:`tenant_${stableIdentity.slice(0,16)}_role`}},
    sqlProgram:{archiveSha256:'1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a',manifestSha256:'62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971',
      restoreSqlSha256:'a'.repeat(64),verificationSqlSha256:'a'.repeat(64),pg17CatalogSqlSha256:'a'.repeat(64),rowCountsSqlSha256:'a'.repeat(64),
      migrations:[{name:'saas_control.sql',sha256:'4da7a9d7974efa0cbab6196bc21a7618c052c11bec8cdd4390e2e24f0d22c8bf'},
        {name:'theme_config.sql',sha256:'eec8838c01101f009b18f838525a64e100e59300c460a52006cb96568c809c14'}],tables:73,
      transaction:'restore-and-migrate-atomic',maximumTenantDatabaseBytes:536870912,runtimeEnabled:false}};
}
test('C3 finite new SQL scope needs the exact fresh SHA, no grant/Secret/runtime expansion',()=>{
  const r=prepareC3Review(input(),now);assertC3Approval(r,r.manifestSha256,r.codeBindingSha256,now+1000);
  assert.equal(r.limits.maximumRunSqlConnections,3);assert.equal(r.limits.maximumIndependentInspectSqlConnections,2);
  assert.equal(r.limits.awsResourceWrites,0);assert.equal(r.limits.secretValueReads,0);assert.equal(r.executionAuthorized,false);
  for(const [sha,code,time] of [['invalid',r.codeBindingSha256,now],[r.manifestSha256,'f'.repeat(64),now],[r.manifestSha256,r.codeBindingSha256,now+6*3600000]] as const)
    assert.throws(()=>assertC3Approval(r,sha,code,time));
  assert.throws(()=>assertC3Approval({...r,attemptSlot:'old-slot'},r.manifestSha256,r.codeBindingSha256,now));
});
test('C3 rejects replaced resource, stale metadata, foreign owner scope and modified SQL/baseline pins',()=>{
  let i=input();i.facts.observedAt=new Date(now-31000).toISOString();assert.throws(()=>prepareC3Review(i,now));
  i=input();i.candidateInput.target.clusterResourceId='cluster-ZZZZZZZZZZZZZZZZZZZZZZZZ';assert.throws(()=>prepareC3Review(i,now));
  i=input();i.candidateInput.scope.workspaceId='foreign';assert.throws(()=>prepareC3Review(i,now));
  i=input();i.sqlProgram.archiveSha256='f'.repeat(64);assert.throws(()=>prepareC3Review(i,now));
  i=input();i.sqlProgram.migrations[0].sha256='f'.repeat(64);assert.throws(()=>prepareC3Review(i,now));
});
