import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PostgresReleaseRepository,ReleaseRequestRejected} from '../lib/deployments/releases/repository.ts';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {releaseFixture,releaseProductionFixture,h} from './instance-release-fixture.ts';
import {buildReleaseCandidate,verifyPublishedRelease} from '../lib/deployments/releases/production.ts';
import {writeCatalogRelease,inspectCatalogRelease} from '../ops/releases/catalog-transaction.ts';

// Never falls back to DATABASE_URL or local/production configuration. No DROP/reset/cleanup SQL.
const testUrl=process.env.INSTANCE_RELEASE_TEST_DATABASE_URL;
test('release native PostgreSQL 16: non-superuser draft install, narrow roles, real row-lock claim and verified CAS outcomes', {skip:!testUrl,timeout:30000},async t=>{
 const url=new URL(testUrl);
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/instance_release_ci');assert.equal(url.username,'postgres');
 const clients=[];
 const connect=async(name,role,connectionString=testUrl)=>{const c=new pg.Client({connectionString,application_name:name,statement_timeout:5000});await c.connect();clients.push(c);if(role)await c.query('SET ROLE '+role);return c;};
 try{
  const admin=await connect('release-native-admin');
  const pre=await admin.query("select current_database() as db,current_setting('server_version_num')::int as version,(select count(*)::int from pg_catalog.pg_tables where schemaname not in ('pg_catalog','information_schema')) as tables");
  assert.equal(pre.rows[0].db,'instance_release_ci');assert.ok(pre.rows[0].version>=160000&&pre.rows[0].version<170000);assert.equal(pre.rows[0].tables,0);
  assert.equal((await admin.query("select count(*)::int as n from pg_catalog.pg_roles where rolname like 'deployment_release_%'")).rows[0].n,0);
  // Only the new disposable CI database uses this synthetic LOGIN. Never a production installer.
  await admin.query("CREATE ROLE release_ci_installer LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-ci-only'");
  await admin.query('GRANT CREATE ON DATABASE instance_release_ci TO release_ci_installer');
  const installerUrl=new URL(testUrl);installerUrl.username='release_ci_installer';
  const installer=await connect('release-native-installer',undefined,installerUrl.toString());
  await t.test('non-superuser creator ADMIN is not SET; both drafts install as the real login and close temporary owner access',async()=>{
   const initial=(await installer.query("SELECT current_user,session_user,rolsuper,rolcreaterole,current_setting('createrole_self_grant') AS self_grant FROM pg_roles WHERE rolname=current_user")).rows[0];
   assert.equal(initial.current_user,'release_ci_installer');assert.equal(initial.session_user,initial.current_user);
   assert.equal(initial.rolsuper,false);assert.equal(initial.rolcreaterole,true);assert.equal(initial.self_grant,'');
   await installer.query('CREATE ROLE release_ci_owner_control NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
   const rights=async role=>(await installer.query("SELECT pg_has_role(current_user,$1,'SET') AS can_set,pg_has_role(current_user,$1,'USAGE') AS inherit",[role])).rows[0];
   assert.deepEqual(await rights('release_ci_owner_control'),{can_set:false,inherit:false});
   assert.equal((await installer.query("SELECT bool_or(m.admin_option) AS admin FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname='release_ci_owner_control' AND m.member=current_user::regrole")).rows[0].admin,true);
   await assert.rejects(installer.query('CREATE SCHEMA release_ci_denied AUTHORIZATION release_ci_owner_control'),e=>e.code==='42501');
   await assert.rejects(installer.query('SET ROLE release_ci_owner_control'),e=>e.code==='42501');
   await installer.query(await readFile(new URL('../ops/releases/schema.draft.sql',import.meta.url),'utf8'));
   assert.deepEqual(await rights('deployment_release_owner'),{can_set:false,inherit:false});
   assert.equal((await installer.query('SELECT current_user')).rows[0].current_user,'release_ci_installer');
   await assert.rejects(installer.query('GRANT USAGE ON SCHEMA deployment_release TO release_ci_owner_control'),e=>e.code==='42501');
   await installer.query(await readFile(new URL('../ops/releases/grants.draft.sql',import.meta.url),'utf8'));
   assert.deepEqual(await rights('deployment_release_owner'),{can_set:false,inherit:false});
   await assert.rejects(installer.query('SET ROLE deployment_release_owner'),e=>e.code==='42501');
   await assert.rejects(installer.query('SELECT * FROM deployment_release.requests'),e=>e.code==='42501');
   const membership=(await admin.query("SELECT bool_or(m.admin_option) AS admin,bool_or(m.set_option) AS can_set,bool_or(m.inherit_option) AS inherit FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname='deployment_release_owner' AND m.member='release_ci_installer'::regrole")).rows[0];
   assert.deepEqual(membership,{admin:true,can_set:false,inherit:false});
   assert.equal((await admin.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='deployment_release'")).rows[0].owner,'deployment_release_owner');
   assert.deepEqual((await admin.query("SELECT count(*)::int AS n,bool_and(c.relowner='deployment_release_owner'::regrole) AS owned FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='deployment_release' AND c.relkind='r'")).rows[0],{n:3,owned:true});
   assert.deepEqual((await admin.query("SELECT count(*)::int AS n,bool_and(p.proowner='deployment_release_owner'::regrole AND p.prosecdef) AS owned FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='deployment_release'")).rows[0],{n:9,owned:true});
   for(const role of ['deployment_release_planner','deployment_release_executor','deployment_release_verifier']){
    assert.equal((await admin.query("SELECT pg_has_role($1,'deployment_release_owner','MEMBER') AS member",[role])).rows[0].member,false);
   }
  });
  await t.test('separately reviewed LOGIN fragment: three real logins inherit only their own operation group',async()=>{
   const purposes=['planner','executor','verifier'],passwords=purposes.map((_,i)=>String(i+1).repeat(64));
   await installer.query('BEGIN');
   await installer.query("SELECT set_config('techlong_release.planner_password',$1,true),set_config('techlong_release.executor_password',$2,true),set_config('techlong_release.verifier_password',$3,true)",passwords);
   await installer.query(await readFile(new URL('../ops/releases/login-roles.draft.sql',import.meta.url),'utf8'));
   await installer.query('COMMIT');
   for(const [i,purpose] of purposes.entries()){
    const role='deployment_release_'+purpose+'_login',loginUrl=new URL(testUrl);loginUrl.username=role;loginUrl.password=passwords[i];
    const login=await connect('release-native-'+purpose+'-login',undefined,loginUrl.toString());
    const identity=(await login.query("SELECT current_user,session_user,current_setting('search_path') AS search_path")).rows[0];
    assert.deepEqual(identity,{current_user:role,session_user:role,search_path:'pg_catalog'});
    const memberships=(await admin.query("SELECT p.rolname,m.inherit_option,m.set_option,m.admin_option FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.member=$1::regrole ORDER BY p.rolname",[role])).rows;
    assert.deepEqual(memberships,[{rolname:'deployment_release_'+purpose,inherit_option:true,set_option:false,admin_option:false}]);
    assert.equal((await login.query("SELECT has_function_privilege(current_user,'deployment_release.read_context(text)','EXECUTE') AS allowed")).rows[0].allowed,true);
    assert.equal((await login.query("SELECT has_function_privilege(current_user,'deployment_release.record_inspection(text,jsonb)','EXECUTE') AS allowed")).rows[0].allowed,purpose==='verifier');
    assert.equal((await login.query("SELECT has_function_privilege(current_user,'deployment_release.claim_request(text,text,text,integer,text)','EXECUTE') AS allowed")).rows[0].allowed,purpose==='executor');
    assert.equal((await login.query("SELECT has_function_privilege(current_user,'deployment_release.prepare_request(text,text)','EXECUTE') AS allowed")).rows[0].allowed,purpose==='planner');
    await assert.rejects(login.query('SET ROLE deployment_release_owner'),e=>e.code==='42501');
    await assert.rejects(login.query('SELECT * FROM deployment_release.requests'),e=>e.code==='42501');
    const rights=(await installer.query("SELECT pg_has_role(current_user,$1,'SET') AS can_set,pg_has_role(current_user,$1,'USAGE') AS inherit",[role])).rows[0];
    assert.deepEqual(rights,{can_set:false,inherit:false});
   }
  });
  await t.test('normal version import: real non-superuser writer and independent login close owner SET; immutable conflicts remain enforced',async()=>{
   const f=await releaseProductionFixture();f.policy.productId='catalog_ci_product';
   const candidate=await buildReleaseCandidate(f.policy,f.run,f.artifact,f.files,f.now),release=await verifyPublishedRelease(candidate,f.registry,f.now);
   const ids=(await admin.query("SELECT n.oid::int AS schema_oid,c.oid::int AS releases_oid FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid WHERE n.nspname='deployment_release' AND c.relname='releases'")).rows[0];
   const target={installer:'release_ci_installer',schemaOid:ids.schema_oid,releasesOid:ids.releases_oid};
   assert.equal((await writeCatalogRelease(installer,release,target)).status,'REGISTERED');
   const independent=await connect('release-catalog-independent',undefined,installerUrl.toString());
   assert.equal((await inspectCatalogRelease(independent,release,target)).status,'INDEPENDENTLY_VERIFIED');
   assert.equal((await writeCatalogRelease(installer,release,target)).status,'ALREADY_REGISTERED');
   await assert.rejects(writeCatalogRelease(installer,{...release,id:'different_catalog_id'},target),/VERSION_CONFLICT/);
   await assert.rejects(writeCatalogRelease(installer,{...release,image:{...release.image,platformDigest:'sha256:'+h('a')}},target),/VERSION_CONFLICT/);
   await admin.query("UPDATE deployment_release.releases SET status='revoked' WHERE id=$1",[release.id]);
   await assert.rejects(writeCatalogRelease(installer,release,target),/VERSION_CONFLICT/);
   await assert.rejects(inspectCatalogRelease(independent,release,target),/READBACK_MISMATCH/);
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM deployment_release.releases WHERE product_id=$1',[release.productId])).rows[0].n,1);
   for(const client of [installer,independent]){
    assert.deepEqual((await client.query("SELECT pg_has_role(current_user,'deployment_release_owner','SET') AS can_set,pg_has_role(current_user,'deployment_release_owner','USAGE') AS inherit")).rows[0],{can_set:false,inherit:false});
    await assert.rejects(client.query('SELECT * FROM deployment_release.releases'),e=>e.code==='42501');
   }
  });
  const f=await releaseFixture(),p=f.plan;
  p.observedAt=Date.now();p.preparedAt=p.observedAt;p.writeBefore=p.observedAt+300000;const sha=await sha256Hex(p);
  const document=(id,version,imageUri,platformDigest)=>({id,version,productId:p.productId,component:'tenant_api',status:'ecr_verified',
   source:{repository:p.to.sourceRepository,commit:p.to.sourceCommit,buildRunId:p.to.buildRunId,buildAttempt:1,artifactSha256:p.to.artifactSha256},
   image:{repository:imageUri.split('@')[0],manifestDigest:imageUri.split('@')[1],platformDigest,verificationSha256:p.to.imageVerificationSha256,runtimePlatform:'linux/amd64'}});
  for(const d of [document(p.from.releaseId,'1.0.0',p.from.imageUri,p.from.platformDigest),document(p.to.releaseId,p.to.version,p.to.imageUri,p.to.platformDigest)]){
   await admin.query('insert into deployment_release.releases(id,product_id,component,version,status,document) values($1,$2,$3,$4,$5,$6::jsonb)',[d.id,d.productId,d.component,d.version,d.status,canonicalJson(d)]);
  }
  const binding={instanceId:p.selection.instanceId,workspaceId:p.selection.workspaceId,environmentId:p.selection.environmentId,productId:p.productId,
   status:'active',initialized:true,stackId:p.changeSet.StackName,templateSha256:p.templateSha256,configurationSha256:p.configurationSha256};
  await admin.query('insert into deployment_release.instance_state(instance_id,binding,current_release_id,revision) values($1,$2::jsonb,$3,$4)',[binding.instanceId,canonicalJson(binding),p.from.releaseId,p.expectedStateRevision]);
  const plannerClient=await connect('release-native-planner','deployment_release_planner'),writer=await connect('release-native-writer','deployment_release_executor'),
   verifierClient=await connect('release-native-verifier','deployment_release_verifier'),contender=await connect('release-native-contender','deployment_release_executor');
  const planner=new PostgresReleaseRepository(plannerClient),executor=new PostgresReleaseRepository(writer),verifier=new PostgresReleaseRepository(verifierClient),other=new PostgresReleaseRepository(contender);
  await t.test('runtime roles cannot write tables/self-attest/claim as verifier; PUBLIC cannot call functions',async()=>{
   for(const statement of ["update deployment_release.instance_state set revision=999", "select deployment_release.record_inspection('none','{}'::jsonb)"]){await assert.rejects(writer.query(statement),e=>e.code==='42501');}
   await assert.rejects(verifierClient.query("select deployment_release.claim_request('none','none','1',1,'synthetic-token')"),e=>e.code==='42501');
   await assert.rejects(plannerClient.query("select deployment_release.stop_request('none','none','BLOCKED','TEST')"),e=>e.code==='42501');
   await admin.query('CREATE ROLE release_ci_public NOLOGIN');await admin.query('SET ROLE release_ci_public');
   await assert.rejects(admin.query("select deployment_release.read_request('none')"),e=>e.code==='42501');await admin.query('RESET ROLE');
  });
  const prepared=await planner.prepare(p,sha);assert.equal(prepared.status,'AWAITING_APPROVAL');assert.equal(prepared.planSha256,sha);
  await t.test('claim uses a real instance-row lock; waiting claimant cannot replay after first commit',async()=>{
   await writer.query('BEGIN');const first=await executor.claim(p,sha,'1000',1,'native-token-00000001');assert.equal(first.status,'CLAIMED');
   const pid=(await contender.query('select pg_backend_pid() as pid')).rows[0].pid;
   let settled=false;const waiting=other.claim(p,sha,'1001',1,'native-token-00000002').then(value=>{settled=true;return{value};},error=>{settled=true;return{error};});
   let locked=false;
   for(let i=0;i<20&&!locked;i++){locked=(await admin.query("select wait_event_type='Lock' as locked from pg_stat_activity where pid=$1",[pid])).rows[0]?.locked===true;if(!locked)await new Promise(resolve=>setTimeout(resolve,25));}
   assert.equal(locked,true);assert.equal(settled,false);await writer.query('COMMIT');
   const second=await waiting;assert.ok(second.error instanceof ReleaseRequestRejected);assert.equal(second.error.message,'RELEASE_CLAIM_CONFLICT');
  });
  const claim={requestId:p.selection.requestId,token:'native-token-00000001'};
  const progress=async(plan,token,run)=>{
   const c={requestId:plan.selection.requestId,token};await executor.operation(c,'create','INTENT',h('a'));await executor.operation(c,'create','ACK',h('a'),f.changeSetId);
   await executor.operation(c,'execute','INTENT',h('b'));await executor.operation(c,'execute','ACK',h('b'),f.changeSetId);
   return{requestId:c.requestId,planSha256:await sha256Hex(plan),runId:run,runAttempt:1,stackId:plan.changeSet.StackName,releaseId:plan.to.releaseId,
    imageUri:plan.to.imageUri,platformDigest:plan.to.platformDigest,templateSha256:plan.templateSha256,configurationSha256:plan.configurationSha256,
    result:'SUCCEEDED',changeSetId:f.changeSetId,serviceArn:'synthetic-service',taskDefinitionArn:'synthetic-definition',observedAt:Date.now(),runtimeSha256:h('c'),
    evidence:{bucket:'ci-evidence',key:'synthetic/proof',versionId:'ci-fixed-version',sha256:h('d')}};
  };
  await t.test('only the verifier proof permits one CAS advance, then NO_CHANGE is persisted without an executable plan',async()=>{
   const proof=await progress(p,claim.token,'1000');await assert.rejects(executor.complete(claim),ReleaseRequestRejected);
   await verifier.recordInspection(proof);assert.equal((await executor.complete(claim)).status,'SUCCEEDED');
   const state=await executor.context(binding.instanceId);assert.equal(state.binding.stateRevision,4);assert.equal(state.binding.currentRelease.id,p.to.releaseId);assert.equal(state.activeRequestId,null);
   await assert.rejects(executor.complete(claim),ReleaseRequestRejected);
   const decision=await planner.recordDecision({schema:'techlong/instance-release-decision/v1',selection:{...p.selection,requestId:'native_no_change'},status:'NO_CHANGE',reason:'ALREADY_VERIFIED_IMAGE',expectedStateRevision:4,currentReleaseId:p.to.releaseId});
   assert.equal(decision.status,'NO_CHANGE');assert.equal(decision.plan,null);
  });
  await t.test('verified rollback retains old version and invalidates revision; failed verification retains the active fence',async()=>{
   for(const result of ['FAILED_ROLLED_BACK_VERIFIED','FAILED_NEEDS_INSPECTION']){
    const context=await executor.context(binding.instanceId),next=structuredClone(p);next.selection.requestId='native_'+result.toLowerCase();next.selection.releaseId=p.from.releaseId;
    next.expectedStateRevision=context.binding.stateRevision;next.from={releaseId:p.to.releaseId,imageUri:p.to.imageUri,platformDigest:p.to.platformDigest};
    Object.assign(next.to,{releaseId:p.from.releaseId,version:'1.0.0',imageUri:p.from.imageUri,platformDigest:p.from.platformDigest});
    next.changeSet.Parameters=next.changeSet.Parameters.map(v=>v.ParameterKey==='ImageUri'?{ParameterKey:'ImageUri',ParameterValue:next.to.imageUri}:v);
    const digest=await sha256Hex(next),token='native-token-'+result;await planner.prepare(next,digest);await executor.claim(next,digest,'2000',1,token);
    const proof=await progress(next,token,'2000');Object.assign(proof,{result,releaseId:next.from.releaseId,imageUri:next.from.imageUri,platformDigest:next.from.platformDigest});
    await verifier.recordInspection(proof);assert.equal((await executor.complete({requestId:next.selection.requestId,token})).status,result);
    const after=await executor.context(binding.instanceId);assert.equal(after.binding.currentRelease.id,p.to.releaseId);assert.equal(after.binding.stateRevision,5);
    assert.equal(after.activeRequestId,result==='FAILED_NEEDS_INSPECTION'?next.selection.requestId:null);
   }
  });
 }finally{await Promise.all(clients.map(c=>c.end()));}
});
