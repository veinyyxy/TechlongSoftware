import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import diagnostic from '../lib/deployments/execution/aurora-express-c3-catalog-diagnostic.cjs';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
// Call the actual unchanged verifier, not a stub accepting our explanation.
const backend = createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const { verifyPg17Catalog } = backend('./services/saas/aurora_express_restore_v3');
const now = Date.parse('2026-10-14T13:00:00Z');
const tables = Array.from({length:73},(_,i) => `synthetic_${String(i).padStart(2,'0')}`);
function fixture() {
  const c = { schemas:[{name:'public',owner:'pg_database_owner',acl:[]}],
    relations:tables.map(name => ({name,schema:'public',owner:'postgres',kind:'r',persistence:'p',rls:false,forceRls:false,
      rules:[],policies:[],acl:[],columns:[]})), functions:[],
    extensions:[{name:'uuid-ossp',version:'1.1',schema:'public',owner:'postgres'}], types:[], collations:[], eventTriggers:[] };
  return {result:{rowCount:1,rows:[{identity:c}]},context:{read_only:'on',isolation:'repeatable read',bytes:'9000000',user_tables:'73'},tables,verifyCatalog:verifyPg17Catalog};
}
test('each explanatory gate agrees with the actual frozen verifier; acceptance never enables runtime', () => {
  const valid = diagnostic.diagnose(fixture());
  assert.equal(valid.originalValidation.accepted,true); assert.equal(valid.structuralPinInstalled,false);
  assert.equal(valid.runtimeEnabled,false); assert.equal(valid.rowCountsRead,false);
  const cases = [
    ['one_public_schema',c => c.schemas.push({name:'foreign',owner:'postgres',acl:[]})],
    ['public_schema_owner',c => c.schemas[0].owner='postgres'],
    ['public_schema_acl',c => c.schemas[0].acl.push({grantor:'postgres',grantee:'PUBLIC',privilege:'CREATE',grantable:false})],
    ['exact_73_tables',c => c.relations[0].name='unexpected'],
    ['relation_schema_owner_kind',c => c.relations[0].owner='foreign'],
    ['relation_persistence_rls',c => c.relations[0].rls=true],
    ['relation_rules_policies',c => c.relations[0].rules.push('synthetic')],
    ['relation_acl',c => c.relations[0].acl.push({grantee:'PUBLIC',grantor:'postgres',grantable:false})],
    ['column_acl_null',c => c.relations[0].columns.push({acl:'synthetic'})],
    ['function_schema_security_config',c => c.functions.push({schema:'public',owner:'postgres',config:['synthetic'],acl:[]})],
    ['function_owner',c => c.functions.push({schema:'public',owner:'foreign',config:null,acl:[]})],
    ['function_acl',c => c.functions.push({schema:'public',owner:'postgres',config:null,acl:[{grantee:'foreign',grantor:'postgres',privilege:'EXECUTE',grantable:false}]})],
    ['uuid_extension_only',c => c.extensions[0].name='foreign'],
    ['uuid_extension_version_schema_owner',c => c.extensions[0].owner='foreign'],
    ['type_schema_owner_acl',c => c.types.push({schema:'public',owner:'postgres',acl:'synthetic'})],
    ['no_user_collations',c => c.collations.push({name:'synthetic'})],
    ['no_event_triggers',c => c.eventTriggers.push({name:'synthetic'})]
  ];
  for (const [gate,change] of cases) {
    const f=fixture(); change(f.result.rows[0].identity); const observation=diagnostic.diagnose(f);
    assert.equal(observation.originalValidation.accepted,false,gate); assert.ok(observation.rejectedPredicates.includes(gate),gate);
  }
  const f=fixture(); f.verifyCatalog=()=>{throw Error('AURORA_V3_PG17_CATALOG_REJECTED');};
  assert.throws(()=>diagnostic.diagnose(f),/EXPLAINER_DISAGREES/);
});
test('current empty catalog is not manufactured original-failure or rollback evidence; unsafe context is rejected', () => {
  const f=fixture(),c=f.result.rows[0].identity;
  for (const k of ['relations','functions','extensions','types','collations','eventTriggers']) c[k]=[];
  f.context.user_tables='0';
  const o=diagnostic.diagnose(f);
  assert.equal(o.state,'CURRENT_TENANT_CATALOG_EMPTY_ORIGINAL_REJECTION_NOT_RECONSTRUCTED');
  assert.equal(o.originalFailureConditionProved,false); assert.equal(o.rollbackIndependentlyProved,false);
  assert.equal(o.retryAuthorized,false); assert.equal(o.missingExpectedTables,73);
  f.context.read_only='off'; assert.throws(()=>diagnostic.diagnose(f));
  const bad=fixture(); bad.tables=bad.tables.slice(1); assert.throws(()=>diagnostic.diagnose(bad));
  const inconsistent=fixture(); inconsistent.context.user_tables='0'; assert.throws(()=>diagnostic.diagnose(inconsistent));
});
test('diagnostic receipts omit raw function bodies/defaults/settings and unknown names', () => {
  const f=fixture(),c=f.result.rows[0].identity;
  c.functions.push({schema:'public',name:'SYNTHETIC_PRIVATE_FUNCTION',owner:'SYNTHETIC_PRIVATE_OWNER',config:['SYNTHETIC_PRIVATE_CONFIG'],
    definition:'SYNTHETIC_PRIVATE_BODY',arguments:'SYNTHETIC_PRIVATE_ARGS',acl:[]});
  c.relations[0].columns.push({acl:null,default:'SYNTHETIC_PRIVATE_DEFAULT'});
  const text=JSON.stringify(diagnostic.diagnose(f));
  assert.equal(text.includes('SYNTHETIC_PRIVATE'),false); assert.ok(text.includes('function_owner'));
});
test('fresh exact approval binds two read-only connections, history, SQL and unmodified scope', () => {
  const binding={clusterResourceId:'synthetic'},original={manifestSha256:diagnostic.ORIGINAL_SHA,expectedBinding:binding,
    sqlProgram:{pg17CatalogSqlSha256:'a'.repeat(64)}};
  const f={facts:{observedAt:new Date(now).toISOString(),binding,source:{Account:'402010193138',
    Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},plan:{planType:'FREE',planStatus:'ACTIVE'},
    connectPermission:{decision:'allowed',missingContext:[]}},original,codeBindingSha256:'b'.repeat(64),historySha256:'c'.repeat(64),
    sql:{catalogSqlSha256:'a'.repeat(64),ownersSqlSha256:'d'.repeat(64),contextSqlSha256:db.digest(diagnostic.CONTEXT_SQL),tableNamesSha256:db.digest(tables)}};
  const r=diagnostic.prepareReview(f,now),approve=(v=r,sha=r.manifestSha256,time=now)=>
    diagnostic.assertApproval(v,sha,f.codeBindingSha256,f.historySha256,original,f.sql,time);
  approve(); assert.equal(r.limits.sqlConnections,2); assert.equal(r.limits.sqlQueries,9);
  assert.equal(r.limits.businessTableQueries,0); assert.equal(r.limits.sqlMutations,0); assert.equal(r.executionAuthorized,false);
  assert.throws(()=>approve(r,'invalid')); assert.throws(()=>approve(r,r.manifestSha256,now+6*3600000));
  const body={...r,limits:{...r.limits,sqlMutations:1}}; delete body.manifestSha256;
  const forged={...body,manifestSha256:db.digest(body)};
  assert.throws(()=>approve(forged,forged.manifestSha256),/SCOPE_DRIFT/);
  assert.throws(()=>diagnostic.prepareReview({...f,facts:{...f.facts,observedAt:new Date(now-31000).toISOString()}},now));
  assert.equal(/pg_authid|rolpassword|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE/.test(diagnostic.CONTEXT_SQL),false);
});
