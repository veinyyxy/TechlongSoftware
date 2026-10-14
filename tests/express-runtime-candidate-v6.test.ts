import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExpressSecretCreateCandidateV6 as create,finalizeExpressRuntimeBindingCandidateV6 as finalize} from '../lib/deployments/execution/express-runtime-candidate-v6.ts';
import type {DatabaseBindingV2} from '../lib/deployments/execution/aurora-database-v2.ts';
const stable='a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d';
const candidate=create({stableIdentity:stable,resourceGeneration:1});
const base:Omit<Extract<DatabaseBindingV2,{profile:'express_iam'}>,'runtimeSecret'>={schema:'techlong/database-binding/v2',profile:'express_iam',
  clusterArn:'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001',clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',
  endpoint:'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com',port:5432,observedEngineVersion:'17.9',
  tenantDatabase:'tenant_a0da1748bc4d5419_db',tenantUsername:'tenant_a0da1748bc4d5419_role',managementDatabase:'postgres',managementUsername:'postgres',
  stableIdentity:stable,resourceGeneration:1,tlsTrust:'ats-roots/v1',access:{authentication:'iam',internetAccessGatewayEnabled:true,
    applicationRoleArn:'arn:aws:iam::402010193138:role/TechlongSandboxApplicationCandidate',lifecycleRoleArn:'arn:aws:iam::402010193138:role/TechlongSandboxLifecycleCandidate'}};
// Synthetic metadata only; no live Secret/role is created or claimed.
interface Metadata extends Record<string,unknown>{ARN:string;Name:string;Tags:{Key:string;Value:string}[];
  VersionIdsToStages:Record<string,string[]>;KmsKeyId?:string;SecretString?:string;hmac_secret_key?:string}
const metadata=():Metadata=>({ARN:`arn:aws:secretsmanager:ca-central-1:402010193138:secret:${candidate.name}-abc123`,Name:candidate.name,
  Tags:Object.entries(candidate.tags).map(([Key,Value])=>({Key,Value})),VersionIdsToStages:{['a'.repeat(32)]:['AWSCURRENT']}});
test('four stable keys only; no IAM token/password URL, private material, fake ARN/version or write authority',()=>{
  assert.deepEqual(candidate.keys,['hmac_secret_key','jwt_secret_key','stripe_secret_key','stripe_webhook_secret']);
  assert.equal(candidate.secretArn,null);assert.equal(candidate.secretVersionId,null);assert.equal(candidate.executionAuthorized,false);
  assert.equal('SecretString' in candidate.request,false);assert.equal('KmsKeyId' in candidate.request,false);
  assert.throws(()=>create({stableIdentity:stable,resourceGeneration:2}));assert.throws(()=>create({stableIdentity:'f'.repeat(64),resourceGeneration:1}));
});
test('actual-shaped exact metadata yields a version-pinned four-key ECS candidate, not IAM/login/ready proof',()=>{
  const c=finalize({candidate,metadata:metadata(),base});
  assert.equal(c.taskConfiguration.secrets.length,4);assert.ok(c.taskConfiguration.secrets.every(s=>s.valueFrom.endsWith('::'+'a'.repeat(32))));
  assert.equal(c.taskConfiguration.environment.some(e=>e.name==='DATABASE_URL'||e.name==='PGPASSWORD'),false);
  assert.equal(c.secretValuesRead,false);assert.equal(c.databaseLoginVerified,false);assert.equal(c.iamPermissionsVerified,false);assert.equal(c.readyVerified,false);
});
test('foreign name/ARN, old five-key tags, extra versions, custom KMS and accidentally passed private values fail',()=>{
  const changes:Array<(m:Metadata)=>void>=[m=>m.Name='foreign',m=>m.ARN=m.ARN.replace('402010193138','402010193139'),
    m=>m.Tags.push({Key:'Unexpected',Value:'extra'}),m=>m.Tags[1].Value='techlong-runtime-five-key-v1',
    m=>m.VersionIdsToStages['b'.repeat(32)]=['AWSPREVIOUS'],m=>m.KmsKeyId='custom',m=>m.SecretString='SYNTHETIC_PRIVATE',
    m=>m.hmac_secret_key='SYNTHETIC_PRIVATE'];
  for(const mutate of changes) {
    const m=metadata();mutate(m);assert.throws(()=>finalize({candidate,metadata:m,base}));
  }
  assert.throws(()=>finalize({candidate,metadata:metadata(),base:{...base,clusterResourceId:'cluster-FOREIGN000000000000'}}));
  assert.throws(()=>finalize({candidate,metadata:metadata(),base:{...base,endpoint:'foreign.cluster-example.ca-central-1.rds.amazonaws.com'}}));
});
