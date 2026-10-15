import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDatabaseBindingV2} from '../lib/deployments/execution/aurora-database-v2.ts';
import {buildTenantReadinessConfigurationV1 as build} from '../lib/deployments/execution/tenant-readiness-configuration-v1.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/aurora-database-v2.json',import.meta.url),'utf8'));
function input(){return {binding:parseDatabaseBindingV2(fixture()),databaseOid:'16459',roleOid:'16456',appInstanceId:'fixture-instance',configurationHash:'c'.repeat(64)};}
test('readiness wiring binds observed OIDs/instance/desired hash, never injects credentials or claims cloud installation',()=>{
  const v=build(input()),e=Object.fromEntries(v.environment.map(x=>[x.name,x.value]));
  assert.equal(e.APP_READINESS_MODE,'tenant-v1');assert.equal(e.PG_EXPECTED_DATABASE_OID,'16459');assert.equal(e.PG_EXPECTED_ROLE_OID,'16456');
  assert.equal(e.APP_EXPECTED_CONFIGURATION_HASH,'c'.repeat(64));assert.equal(Object.keys(e).length,5);
  assert.equal(v.ecsAndTargetGroupHealthPath,'/bootstrap-ready');assert.equal(v.initializedReadinessPath,'/ready');
  assert.equal(v.healthMeansBootstrapOnly,true);assert.equal(v.cloudConfigurationInstalled,false);assert.equal(v.readyVerified,false);
  assert.equal(Object.isFrozen(v.environment[0]),true);
});
test('same explicit initialized readiness mode supports a newly reviewed Full deployment without altering old defaults',()=>{
  const f={...fixture(),profile:'full_password',tlsTrust:'rds-ca/v1',access:{authentication:'password',internetAccessGatewayEnabled:false,
    managementSecretArn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-fixture-AbCdEf'}};
  assert.equal(build({...input(),binding:parseDatabaseBindingV2(f)}).profile,'full_password');
});
test('invalid/unobserved-shape pins and extra fields reject; data construction does not confer proof even with plausible pins',()=>{
  for(const patch of [{databaseOid:'016459'},{roleOid:''},{appInstanceId:' '},{configurationHash:'unknown'},{password:'forbidden'}])
    assert.throws(()=>build({...input(),...patch}));
  const v=build(input());assert.equal(v.executionAuthorized,false);assert.equal(v.ecsTaskRoleVerified,false);
});
