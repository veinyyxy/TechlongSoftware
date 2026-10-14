import test from 'node:test';
import assert from 'node:assert/strict';
import c from '../lib/deployments/execution/aurora-express-continuation-v4.cjs';
import {prepareContinuationReview,assertContinuationApproval} from '../lib/deployments/execution/aurora-express-c3-continuation-review.ts';
const now=Date.parse('2026-10-14T12:00:00Z');
function input(){
  const scope={appInstanceId:'app_e897a4377bce498b9c5ee9e64509dcad',workspaceId:'ws_ac46ffc6778f44f5a4b5332c41bb9f33',
    productId:'prd_restaurant_order_system',environmentId:'env_aws_sandbox_ca_central_1',cellKey:'cell-sandbox-1'};
  const stableIdentity=c.digest(scope),target={schema:'techlong/express-management-target/v3',
    clusterArn:'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001',clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',
    endpoint:'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com',port:5432,observedEngineVersion:'17.9',
    managementDatabase:'postgres',managementUsername:'postgres',stableIdentity,resourceGeneration:1,
    tenantDatabase:`tenant_${stableIdentity.slice(0,16)}_db`,tenantUsername:`tenant_${stableIdentity.slice(0,16)}_role`};
  const continuationInput={bootstrapInput:{scope,target,nonce:'96c4e91750c441e3aab2de2609f7f029'},predecessor:{...c.PREDECESSOR}};
  const program=c.compileContinuationV4(continuationInput);
  const binding={manifestSha256:'b883fbeacbb0ae473f408f296f805a31c50bd865730e3b4d7a2af45387101671',
    clusterArn:target.clusterArn,clusterResourceId:target.clusterResourceId,endpoint:target.endpoint,engineVersion:'17.9',port:5432,
    createdAt:'2026-10-14T03:13:30.069Z',writerIdentifier:'techlong-sandbox-express-d001-instance-1',
    writerArn:'arn:aws:rds:ca-central-1:402010193138:db:techlong-sandbox-express-d001-instance-1',writerResourceId:'db-NVAQZTKV2FPTHGITOQE563CPAY',
    writerCreatedAt:'2026-10-14T03:13:30.758Z',clusterStatus:'available' as const,writerStatus:'available' as const,
    tags:{ManagedBy:'techlong-sandbox',DatabaseProfile:'express_iam',DeliveryTrack:'D002-C2-admin-facts',ProbeNonce:'00a8312ed683845aaa682334cba3c032'}};
  return {facts:{observedAt:new Date(now).toISOString(),source:{Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
    binding,plan:{planType:'FREE',planStatus:'ACTIVE'},connectPermission:{action:'rds-db:connect',resource:`arn:aws:rds-db:ca-central-1:402010193138:dbuser:${binding.clusterResourceId}/postgres`,decision:'allowed',missingContext:[]}},
    expectedBinding:binding,continuationInput,codeBindingSha256:'d'.repeat(64),historySha256:'e'.repeat(64),
    sqlProgram:{archiveSha256:'1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a',manifestSha256:'62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971',
      restoreSqlSha256:'db6508986edd25344fcd8fc5763ccc33e2eea01b4659fb4771660f998640bbda',verificationSqlSha256:'c676d7d47fe45f50c6c1ccecb0eefdae4b3eb9397ffdf62d8ef89b7a55043303',
      pg17CatalogSqlSha256:'d350ab918b31a3a16aecb998fedfa4ec379c5dfd2b84148962174d6e097c4f24',rowCountsSqlSha256:'72c9423ea5eb008c8684d362d9adfcd28dd4eff66ce27469d94e4fdd5f586510',
      migrations:[{name:'saas_control.sql',sha256:'4da7a9d7974efa0cbab6196bc21a7618c052c11bec8cdd4390e2e24f0d22c8bf'},
        {name:'theme_config.sql',sha256:'eec8838c01101f009b18f838525a64e100e59300c460a52006cb96568c809c14'}],tables:73,
      transaction:'restore-and-migrate-atomic',maximumTenantDatabaseBytes:536870912,runtimeEnabled:false,
      rolePolicySha256:c.digest(c.POLICY),continuationProgramSha256:c.digest(program)}};
}
test('new continuation is eight remaining statements and zero roles/grants; old approval/expired or modified scope cannot execute',()=>{
  const i=input(),r=prepareContinuationReview(i,now);assertContinuationApproval(r,r.manifestSha256,r.codeBindingSha256,now);
  assert.equal(r.limits.remainingPrepareStatementsIncludingTransactionControl,8);assert.equal(r.limits.newRoles,0);
  assert.equal(r.limits.newMemberships,0);assert.equal(r.limits.guardRoleDeletions,1);assert.equal(r.executionAuthorized,false);
  for(const sha of ['invalid',c.PREDECESSOR.originalManifestSha256,c.PREDECESSOR.diagnosticManifestSha256])assert.throws(()=>assertContinuationApproval(r,sha,r.codeBindingSha256,now));
  assert.throws(()=>assertContinuationApproval(r,r.manifestSha256,r.codeBindingSha256,now+6*3600000));
  assert.throws(()=>assertContinuationApproval({...r,attemptSlot:'old-slot'},r.manifestSha256,r.codeBindingSha256,now));
});
test('continuation rejects changed evidence/OIDs, permissive policy or different baseline while retaining original SQL pins',()=>{
  let i=input();Object.assign(i.continuationInput.predecessor,{tenantRoleOid:'19000'});assert.throws(()=>prepareContinuationReview(i,now));
  i=input();i.sqlProgram.rolePolicySha256='a'.repeat(64);assert.throws(()=>prepareContinuationReview(i,now));
  i=input();i.sqlProgram.restoreSqlSha256='a'.repeat(64);assert.throws(()=>prepareContinuationReview(i,now));
  i=input();i.facts.observedAt=new Date(now-31000).toISOString();assert.throws(()=>prepareContinuationReview(i,now));
});
