import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import {buildExpressRuntimeCandidateV7 as build,finalizeExpressRuntimeCandidateV7 as finalize} from '../lib/deployments/execution/express-runtime-candidate-v7.ts';
import {buildExpressSecretCreateCandidateV6} from '../lib/deployments/execution/express-runtime-candidate-v6.ts';
import {createAuroraLifecycleTaskV2} from '../lib/deployments/execution/aurora-lifecycle-v2.ts';
import type {DatabaseBindingV2} from '../lib/deployments/execution/aurora-database-v2.ts';
const scope={appInstanceId:'app_e897a4377bce498b9c5ee9e64509dcad',workspaceId:'ws_ac46ffc6778f44f5a4b5332c41bb9f33',
  productId:'prd_restaurant_order_system',environmentId:'env_aws_sandbox_ca_central_1',cellKey:'cell-sandbox-1' as const};
const candidate=build(scope),base:Omit<Extract<DatabaseBindingV2,{profile:'express_iam'}>,'runtimeSecret'>={schema:'techlong/database-binding/v2',profile:'express_iam',
  clusterArn:'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001',clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',
  endpoint:'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com',port:5432,observedEngineVersion:'17.9',
  tenantDatabase:'tenant_a0da1748bc4d5419_db',tenantUsername:'tenant_a0da1748bc4d5419_role',managementDatabase:'postgres',managementUsername:'postgres',
  stableIdentity:db.digest(scope),resourceGeneration:1,tlsTrust:'ats-roots/v1',access:{authentication:'iam',internetAccessGatewayEnabled:true,
    applicationRoleArn:'arn:aws:iam::402010193138:role/TechlongSandboxTaskRole',lifecycleRoleArn:'arn:aws:iam::402010193138:role/TechlongSandboxTenantLifecycleTaskRole'}};
const metadata=()=>({Name:candidate.name,ARN:`arn:aws:secretsmanager:ca-central-1:402010193138:secret:${candidate.name}-AbCdEf`,
  Tags:Object.entries(candidate.tags).map(([Key,Value])=>({Key,Value})),VersionIdsToStages:{['a'.repeat(32)]:['AWSCURRENT']}});
test('V7 preserves existing wire naming/four keys; old V6 name is demonstrably incompatible; no real ARN/material generated',()=>{
  assert.equal(candidate.name,'techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1');
  assert.equal(candidate.secretArn,null);assert.equal(candidate.secretVersionId,null);assert.equal(candidate.keys.length,4);assert.equal('SecretString' in candidate.request,false);
  const old=buildExpressSecretCreateCandidateV6({stableIdentity:base.stableIdentity,resourceGeneration:1});
  assert.throws(()=>createAuroraLifecycleTaskV2({operation:'inspect',scope,ownerDeploymentId:'synthetic',epoch:1,
    binding:{...base,runtimeSecret:{arn:`arn:aws:secretsmanager:ca-central-1:402010193138:secret:${old.name}-AbCdEf`,versionId:'a'.repeat(32)}}}));
});
test('V7 actual-shaped synthetic metadata matches unchanged v2 lifecycle and version-pinned ECS contract, not runtime proof',()=>{
  const r=finalize({candidate,base,metadata:metadata()});assert.equal(r.existingLifecycleV2NameCompatible,true);assert.equal(r.taskConfiguration.secrets.length,4);
  assert.equal(r.iamPermissionsVerified,false);assert.equal(r.databaseLoginVerified,false);assert.equal(r.executionAuthorized,false);assert.equal(r.readyVerified,false);
});
test('V7 rejects foreign scope/roles, old name, private material and extra versions without relaxing Full/v2',()=>{
  assert.throws(()=>build({...scope,workspaceId:'foreign'}));
  assert.throws(()=>finalize({candidate,base,metadata:{...metadata(),Name:'foreign'}}));
  assert.throws(()=>finalize({candidate,base,metadata:{...metadata(),SecretString:'SYNTHETIC_PRIVATE'}}));
  assert.throws(()=>finalize({candidate,base,metadata:{...metadata(),VersionIdsToStages:{['a'.repeat(32)]:['AWSCURRENT'],['b'.repeat(32)]:['AWSPREVIOUS']}}}));
  assert.throws(()=>finalize({candidate,metadata:metadata(),base:{...base,access:{...base.access,applicationRoleArn:base.access.lifecycleRoleArn}}}));
});
