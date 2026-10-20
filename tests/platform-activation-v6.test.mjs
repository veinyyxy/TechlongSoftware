import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {assessLegacyCompatibilityV6} from '../ops/platform-activation-v6/compatibility.mjs';
import {A,makeCredentialReviewV6,verifyCredentialReviewV6,installCredentialOnceV6,roleLoginSqlV6,secretPolicyV6} from '../ops/platform-activation-v6/credentials.mjs';
import {appTrustOnlyTemplateV6,FROZEN_V6} from '../ops/platform-activation-v6/publication.mjs';
import {CLOUD_V6 as C,S} from '../ops/platform-cloud-v6/contract.mjs';
import {publisherReleaseReadyV6,PUBLISHER_RELEASE_V6} from '../ops/platform-publisher-v6/io.mjs';
const now=Date.parse('2026-10-20T15:00:00Z'),arn='arn:aws:secretsmanager:'+A.region+':'+A.account+':secret:'+A.secretName+'-Ab3eF9';
export async function activationFixtureV6(){
  const functions=Array.from({length:27},(_,i)=>({oid:String(900+i),name:'legacy_trigger_'+i,owner:A.ownerOid,types:'',config:null,
    schema:'public',definer:false,language:'plpgsql',returnType:'trigger',bodySha256:'a'.repeat(64)}));
  const proposal={schema:'techlong/platform-legacy-invoker-trigger-compatibility-proposal/v6',serviceRoleOid:A.roleOid,
    expectedFunctionOwnerOid:A.ownerOid,functionCount:27,functionSnapshotSha256:await sha256Hex(functions),functions};
  const privileges={read_only:'on',actor:'neondb_owner',session_actor:'neondb_owner',database:'neondb',role:{oid:A.roleOid,name:A.role,login:false,
    super:false,inherit:false,createRole:false,createDb:false,replication:false,bypassRls:false,config:null},memberships:[],
    database_create_or_owner:[],schema_create_or_owner:[],relation_or_column_rights:[],unexpected_executable_functions:functions,
    function_grant_options:[],foreign_server_rights:[],temporary_objects_allowed:true};
  const prestate={source:{Account:A.account,Arn:A.sourceArn,UserId:A.sourceUserId},catalog:{role:{oid:A.roleOid,login:false},schema:{oid:A.schemaOid},installer:{oid:A.ownerOid}},
    privileges,secret:{state:'ABSENT'},kms:{arn:'arn:aws:kms:'+A.region+':'+A.account+':key/synthetic-ci',keyManager:'AWS'},
    workerRole:{id:C.roleId},targetFingerprintSha256:A.targetFingerprintSha256};
  const input={sourceCommit:'c'.repeat(40),pins:Array.from({length:10},(_,i)=>({file:'synthetic-'+i,sha256:'d'.repeat(64)})),
    ci:{sourceCommit:'c'.repeat(40),conclusion:'success',status:'completed',attempt:1},prestate,proposal,createdAt:now};
  return {input,prestate,proposal};
}
async function runner(){
  const f=await activationFixtureV6(),m=await makeCredentialReviewV6(f.input),events=[];let occupied=false,activated=false,failAt,clock=now;
  const event=name=>{events.push(name);if(name===failAt)throw Error('synthetic ambiguous '+name);};
  const database=()=>{const v=structuredClone(f.prestate);v.catalog.role.login=activated;v.privileges.role.login=activated;return v;};
  const io={assertSource:async()=>event('source'),preflight:async()=>{event('preflight');return structuredClone(f.prestate);},
    claim:async()=>{assert.equal(occupied,false);occupied=true;event('slot');},record:async name=>event(name),
    createEmpty:async()=>{event('create-empty');return arn;},protect:async()=>event('protect'),verifyEmptyProtected:async()=>event('protected-read'),
    putMaterial:async()=>event('put-value'),verifyMaterialMetadata:async()=>event('material-metadata'),
    readDatabase:async()=>{event(activated?'post-read':'final-read');return database();},
    activateRole:async()=>{event('role-sql');activated=true;return {commitAcknowledged:true};},verifyDedicated:async()=>{event('dedicated');return {readOnly:true};}};
  return {...f,m,io,events,fail:v=>{failAt=v;},at:v=>{clock=v;},run:()=>installCredentialOnceV6({manifest:m,approved:m.manifestSha256,io,now:()=>clock})};
}
test('exact 27 invoker-trigger compatibility is only eligibility, never approval; drift, new functions or extra rights still block',async()=>{
  const f=await activationFixtureV6(),ok=await assessLegacyCompatibilityV6(f.prestate.privileges,f.proposal);
  assert.equal(ok.eligibleForReviewedCredentialInstall,true);assert.equal(ok.compatibilityAccepted,false);assert.equal(ok.loginAuthorized,false);
  for(const patch of [c=>{c.unexpected_executable_functions[0].bodySha256='b'.repeat(64);},c=>{c.unexpected_executable_functions.push(c.unexpected_executable_functions[0]);},
    c=>{c.unexpected_executable_functions[0].definer=true;},c=>{c.relation_or_column_rights=[{}];},c=>{c.memberships=[{}];},c=>{c.role.login=true;}]){
    const c=structuredClone(f.prestate.privileges);patch(c);assert.equal((await assessLegacyCompatibilityV6(c,f.proposal)).eligibleForReviewedCredentialInstall,false);
  }
  const changed=structuredClone(f.proposal);changed.functions[0].returnType='text';await assert.rejects(assessLegacyCompatibilityV6(f.prestate.privileges,changed));
});
test('actual pinned production proposal accepts both null and fixed pg_catalog configuration, but never configuration drift',async()=>{
  const proposal=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/platform-publisher-v6.legacy-trigger-proposal.json',import.meta.url),'utf8'));
  const f=await activationFixtureV6(),c=structuredClone(f.prestate.privileges);c.unexpected_executable_functions=structuredClone(proposal.functions);
  assert.equal((await assessLegacyCompatibilityV6(c,proposal)).eligibleForReviewedCredentialInstall,true);
  const changed=c.unexpected_executable_functions.find(v=>v.config);assert.ok(changed);changed.config=['search_path=public'];
  assert.equal((await assessLegacyCompatibilityV6(c,proposal)).eligibleForReviewedCredentialInstall,false);
});
test('credential manifest is exact 48h, one new Secret/one LOGIN, no key/IAM/workflow action; old approval cannot cover changes',async()=>{
  const f=await activationFixtureV6(),m=await makeCredentialReviewV6(f.input);assert.equal(m.expiresAt-now,48*3600000);
  assert.equal(m.effects.createSecret,1);assert.equal(m.effects.privateKeyReads+m.effects.iamRoleChanges+m.effects.workflowPublications+m.effects.dispatches,0);
  await verifyCredentialReviewV6(m,m.manifestSha256,now);await assert.rejects(verifyCredentialReviewV6(m,'wrong',now));
  await assert.rejects(verifyCredentialReviewV6(m,m.manifestSha256,m.expiresAt));await verifyCredentialReviewV6(m,undefined,m.expiresAt+1,true);
  await assert.rejects(verifyCredentialReviewV6({...m,action:{...m.action,secretName:'other'}},m.manifestSha256,now));
  await assert.rejects(makeCredentialReviewV6({...f.input,prestate:{...f.prestate,secret:{state:'OCCUPIED'}}}));
});
test('empty create and source-only protection are verified BEFORE the only value write and guarded role LOGIN',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'CONTROLLER_CREDENTIAL_INSTALLED_REQUIRES_INDEPENDENT_INSPECT');
  for(const [a,b] of [['slot','create-empty'],['create-empty','protect'],['protect','protected-read'],['protected-read','put-value'],['material-metadata','role-sql'],['role-sql','dedicated']])
    assert.ok(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='create-empty').length,1);assert.equal(f.events.filter(v=>v==='role-sql').length,1);
});
test('any partial create/protect/value/role/ACK/read failure stops once without deletion, compensation, replay or retry',async()=>{
  for(const phase of ['create-empty','protect','protected-read','put-value','material-metadata','role-sql','role-commit-ack','post-read','dedicated']){
    const f=await runner();f.fail(phase);const r=await f.run();assert.match(r.outcome,/PARTIAL_OR_UNKNOWN/);assert.equal(r.retryAllowed,false);assert.equal(r.runtimeEnabled,false);
    await assert.rejects(f.run());assert.ok(f.events.filter(v=>v==='create-empty').length<=1);assert.ok(f.events.filter(v=>v==='role-sql').length<=1);
  }
});
test('wrong approval, source or catalog drift stops before consuming the only slot; post-slot expiry stops before cloud write',async()=>{
  const f=await runner();await assert.rejects(installCredentialOnceV6({manifest:f.m,approved:'wrong',io:f.io,now:()=>now}));assert.deepEqual(f.events,[]);
  const s=await runner();s.fail('source');await assert.rejects(s.run());assert.equal(s.events.includes('slot'),false);
  const d=await runner();d.io.preflight=async()=>({...d.prestate,secret:{state:'OCCUPIED'}});await assert.rejects(d.run());assert.equal(d.events.includes('slot'),false);
  const e=await runner(),claim=e.io.claim;e.io.claim=async v=>{await claim(v);e.at(e.m.expiresAt);};
  assert.match((await e.run()).outcome,/PARTIAL/);assert.equal(e.events.includes('create-empty'),false);
});
test('role SQL has fixed OID/flags/advisory guard and only random 64-character password, transaction COMMIT, no grants or business DML',()=>{
  const sql=roleLoginSqlV6('A'.repeat(64));assert.ok(sql.includes('oid='+A.roleOid));assert.match(sql,/ALTER ROLE techlong_deployment_controller_v6 PASSWORD '[A]+' LOGIN/);
  assert.match(sql,/NOT rolcanlogin/);assert.match(sql,/COMMIT;$/);assert.doesNotMatch(sql,/GRANT |REVOKE |INSERT INTO|UPDATE public\.|DELETE FROM/);
  assert.throws(()=>roleLoginSqlV6("x'; DROP ROLE x;"));
  const p=secretPolicyV6();assert.equal(p.Statement.length,2);assert.ok(p.Statement.every(s=>s.Effect==='Deny'&&s.Condition.ArnNotEquals['aws:PrincipalArn']===A.sourceArn));
});
test('trust proposal changes only App actor and exact new reusable, leaving every permission/resource unchanged',()=>{
  const eq={'token.actions.githubusercontent.com:actor_id':S.ownerId,'token.actions.githubusercontent.com:aud':'sts.amazonaws.com',
    'token.actions.githubusercontent.com:environment':C.environment,'token.actions.githubusercontent.com:job_workflow_ref':`${S.repository}/.github/workflows/cloud-worker-job.yml@${FROZEN_V6.oldReusable}`,
    'token.actions.githubusercontent.com:ref':'refs/heads/main','token.actions.githubusercontent.com:repository_id':S.repositoryId,
    'token.actions.githubusercontent.com:repository_owner_id':S.ownerId,'token.actions.githubusercontent.com:sub':C.oidcSubject};
  const template={Resources:{WorkerRole:{Type:'AWS::IAM::Role',Properties:{RoleName:'TechlongSandboxGitHubDeploymentWorkerRole',Policies:[{unchanged:true}],
    AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:'arn:aws:iam::402010193138:oidc-provider/token.actions.githubusercontent.com'},
      Action:'sts:AssumeRoleWithWebIdentity',Condition:{StringEquals:eq}}]}}},Other:{Properties:{unchanged:true}}}};
  const r=appTrustOnlyTemplateV6(template,'a'.repeat(40));assert.equal(r.changes.length,2);assert.deepEqual(r.template.Resources.Other,template.Resources.Other);
  assert.deepEqual(r.template.Resources.WorkerRole.Properties.Policies,template.Resources.WorkerRole.Properties.Policies);
  template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub']='other';
  assert.throws(()=>appTrustOnlyTemplateV6(template,'a'.repeat(40)));
});
test('local entry has only three scoped cloud write calls and one role SQL batch; preparation never reads App key or starts deployment',async()=>{
  const code=await readFile(new URL('../ops/platform-activation-v6/local.mjs',import.meta.url),'utf8');
  for(const name of ['CreateSecretCommand','PutResourcePolicyCommand','PutSecretValueCommand'])assert.equal((code.match(new RegExp('new '+name,'g'))??[]).length,1);
  assert.equal((code.match(/owner\.query\(roleLoginSqlV6/g)??[]).length,1);assert.doesNotMatch(code,/\.pem|signAppJwt|RunTaskCommand|CreateStackCommand|ExecuteChangeSetCommand|DeleteSecretCommand/);
  assert.match(code,/GetSecretValueCommand\(\{SecretId:secretArn,VersionId:A\.versionId,VersionStage:'AWSCURRENT'/);
  assert.ok(code.indexOf('await write(A.inspectSlot')<code.indexOf('new GetSecretValueCommand'));
});
test('future publisher binding avoids a self-referential caller commit without relaxing the actual UNPUBLISHED gate',async()=>{
  const release={state:'PUBLISHED',workflowId:'1234',actorId:S.candidateBotId,reusableCommit:'d'.repeat(40),closureSha256:'a'.repeat(64),
    identityProofSha256:'b'.repeat(64),installationSha256:C.installationSha256,riskSha256:'e'.repeat(64)},frozen='a'.repeat(40),
    binding={state:'PUBLISHED',releaseSha256:await sha256Hex(release),frozenSourceCommit:frozen};
  for(const sourceCommit of ['b'.repeat(40),'c'.repeat(40)])assert.equal(await publisherReleaseReadyV6(binding,{release,sourceCommit,frozenSourceCommit:frozen}),true);
  assert.equal(await publisherReleaseReadyV6(binding,{release,sourceCommit:'bad',frozenSourceCommit:frozen}),false);
  assert.equal(await publisherReleaseReadyV6(binding,{release:{other:true},sourceCommit:'b'.repeat(40),frozenSourceCommit:frozen}),false);
  assert.equal(await publisherReleaseReadyV6(PUBLISHER_RELEASE_V6,{release,sourceCommit:'b'.repeat(40),frozenSourceCommit:frozen}),false);
});
