// Disposable GitHub PostgreSQL ONLY. Never reads .env, AWS or a production URL.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as adminId} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {transferFixture} from '../../tests/fixtures/platform-task-transfer-v6.mjs';
import {TRANSFER as T,createTransferTransaction,verifyTransferReadback,normalizedState} from './transfer.mjs';
import {readTransferState} from './transfer-state.mjs';
import {NEXT,makeNextTransferProfile} from './transfer-next.mjs';
import {readTransferredSnapshot} from '../platform-review-v6/current-database.mjs';
import {wireCycleDatabase,verifyPublishedReview} from '../platform-review-v6/cycle-database.mjs';
import {makeTransferredAnchor,TRANSFERRED_CYCLE} from '../platform-review-v6/transferred-cycle.mjs';
import {J} from '../platform-review-v6/followup.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
import {recoveryFixture} from '../../tests/fixtures/platform-recovery-v1.mjs';
import {recoveryBasisCompiler} from '../platform-recovery-v1/basis.mjs';
import {makeRecoveryRequestReview,createRecoveryRequestTransaction,verifyRecoveryRequestReadback} from '../platform-recovery-v1/request.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true');
const port=Number(process.env.PLATFORM_CONTROL_CI_PORT);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const base={host:'127.0.0.1',port,user:'postgres',password:'controller-ci-only-bootstrap',database:'postgres'},db='task_transfer_v6_ci';
const control=new pg.Client(base);await control.connect();let client,second,created=false,roleCreated=false;
const checks=[];
async function readState(c){
  const jobs=(await c.query(`SELECT to_jsonb(j)||jsonb_build_object('payload',j.payload::jsonb) AS value
    FROM public.deployment_jobs j WHERE deployment_id=$1 ORDER BY id`,[S.deploymentId])).rows.map(r=>r.value);
  const ledger=(await c.query(`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY plan_sha),'[]') FROM deployment_control_v6.plans p WHERE job_id=$1) AS plans,
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.plan_sha),'[]') FROM deployment_control_v6.approvals a JOIN deployment_control_v6.plans p USING(plan_sha) WHERE p.job_id=$1) AS approvals,
    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY plan_sha),'[]') FROM deployment_control_v6.dispatch_attempts a WHERE job_id=$1) AS attempts`,[T.oldJobId])).rows[0];
  const deployment=(await c.query(`SELECT id,app_instance_id AS "appInstanceId",environment_id AS "environmentId",mode,status,
    plan_hash AS "planHash",configuration_hash AS "configurationHash",artifact_ref AS "artifactRef",outputs::jsonb AS outputs
    FROM public.app_instance_deployments WHERE id=$1`,[S.deploymentId])).rows[0];
  const catalog=(await c.query(`SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(pg_get_constraintdef(x.oid) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid) AS constraints,
    (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='public' AND c.relname IN ('deployment_jobs','app_instance_deployments')) OR
      (n.nspname='deployment_control_v6' AND c.relname IN ('plans','approvals','dispatch_attempts')) ORDER BY n.nspname,c.relname`)).rows;
  const triggers=(await c.query(`SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition,p.prosrc,p.prosecdef,p.proconfig
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.deployment_jobs'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`)).rows;
  return {deployment,jobs,ledger,protection:{catalogSha256:await sha256Hex(catalog),triggersSha256:await sha256Hex(triggers)}};
}
async function insertRows(table,rows){
  assert.ok(['public.deployment_jobs','deployment_control_v6.plans','deployment_control_v6.approvals','deployment_control_v6.dispatch_attempts'].includes(table));
  for(const row of rows){const keys=Object.keys(row);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
    await client.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}
}
async function reset(){
  await client.query('TRUNCATE deployment_control_v6.dispatch_attempts,deployment_control_v6.approvals,deployment_control_v6.plans,public.deployment_jobs');
  const f=await transferFixture(Date.now());
  await client.query('UPDATE public.app_instance_deployments SET outputs=$1',[JSON.stringify(f.deployment.outputs)]);
  await client.query('UPDATE public.deployment_environments SET apply_enabled=0');
  await insertRows('public.deployment_jobs',f.jobs);await insertRows('deployment_control_v6.plans',f.ledger.plans);
  await insertRows('deployment_control_v6.approvals',f.ledger.approvals);await insertRows('deployment_control_v6.dispatch_attempts',f.ledger.attempts);
  return readState(client);
}
const transaction=(dbClient=client,record)=>createTransferTransaction({client:dbClient,readState,record});
const execute=(baseline,options={})=>transaction(options.dbClient,options.record)({baseline,assertApproved:async()=>{}});
try{
  await control.query('CREATE DATABASE '+db);created=true;
  client=new pg.Client({...base,database:db});second=new pg.Client({...base,database:db});await client.connect();await second.connect();
  // Disposable connections must render catalog definitions with the same
  // search_path as the real RO reader and transaction-local writer context.
  await client.query('SET search_path=pg_catalog');await second.query('SET search_path=pg_catalog');
  await client.query(`CREATE TABLE public.users(id text PRIMARY KEY,status text,is_platform_admin int);
    CREATE TABLE public.workspaces(id text PRIMARY KEY,status text);
    CREATE TABLE public.subscriptions(id text PRIMARY KEY,status text,current_period_end bigint);
    CREATE TABLE public.app_instances(id text PRIMARY KEY,workspace_id text,product_id text,subscription_id text,status text);
    CREATE TABLE public.deployment_environments(id text PRIMARY KEY,status text,apply_enabled int,admission_state text,admission_epoch int,admission_stack_id text,kind text,expected_account_id text,region text,cell_key text);
    CREATE TABLE public.app_instance_deployments(id text PRIMARY KEY,app_instance_id text,environment_id text,subscription_id text,mode text,status text,plan_hash text,configuration_hash text,artifact_ref text,outputs text,cell_key text);
    CREATE TABLE public.deployment_tenant_resources(app_instance_id text PRIMARY KEY,owner_deployment_id text,lifecycle_status text,destroyed_at bigint,created_by_deployment_id text,generation int,external_operation_epoch int);
    CREATE TABLE public.deployment_tenant_external_operations(app_instance_id text,generation int,epoch int,state text,intent text,owner_deployment_id text,operation_hash text);
    CREATE TABLE public.deployment_jobs(id text PRIMARY KEY,deployment_id text REFERENCES public.app_instance_deployments(id),job_type text,dedupe_key text UNIQUE,status text,payload text,attempts int,max_attempts int,available_at bigint,
      lease_owner text,lease_token text,lease_expires_at bigint,last_error_code text,last_error_message text,created_at bigint,updated_at bigint,completed_at bigint,
      CHECK((status='running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'running' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)));
    CREATE SCHEMA deployment_control_v6;
    CREATE TABLE deployment_control_v6.plans(plan_sha text PRIMARY KEY,action_sha text,risk_sha text,job_id text REFERENCES public.deployment_jobs(id),mode text,body jsonb,expires_at timestamptz,created_at timestamptz);
    CREATE TABLE deployment_control_v6.approvals(plan_sha text PRIMARY KEY REFERENCES deployment_control_v6.plans(plan_sha),admin_id text,approved_at timestamptz);
    CREATE TABLE deployment_control_v6.dispatch_attempts(plan_sha text PRIMARY KEY REFERENCES deployment_control_v6.approvals(plan_sha),job_id text,mode text,state text,run_id text UNIQUE,run_status text,conclusion text,proof_sha text,started_at timestamptz,observed_at timestamptz,UNIQUE(job_id,mode));
    CREATE FUNCTION public.transfer_sealed_guard_ci() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.deployment_id='dep_sealed_fixture' THEN RAISE EXCEPTION 'sealed'; END IF; RETURN NEW; END$$;
    CREATE TRIGGER transfer_sealed_guard_ci BEFORE INSERT OR UPDATE ON public.deployment_jobs FOR EACH ROW EXECUTE FUNCTION public.transfer_sealed_guard_ci();
    ALTER TABLE public.deployment_jobs ENABLE ALWAYS TRIGGER transfer_sealed_guard_ci;`);
  const sub='sub_transfer_fixture';
  await client.query("INSERT INTO public.users VALUES($1,'active',1)",[adminId]);
  await client.query("INSERT INTO public.workspaces VALUES($1,'active')",[S.workspaceId]);
  await client.query("INSERT INTO public.subscriptions VALUES($1,'active',$2)",[sub,Date.now()+86400000]);
  await client.query("INSERT INTO public.app_instances VALUES($1,$2,$3,$4,'active')",[S.appInstanceId,S.workspaceId,S.productId,sub]);
  await client.query("INSERT INTO public.deployment_environments VALUES($1,'active',0,'open',0,NULL,'aws_sandbox','402010193138','ca-central-1','cell-sandbox-1')",[S.environmentId]);
  await client.query("INSERT INTO public.app_instance_deployments VALUES($1,$2,$3,$4,'aws_sandbox','ready',$5,$6,$7,'{}','cell-sandbox-1')",[S.deploymentId,S.appInstanceId,S.environmentId,sub,S.planHash,S.configurationHash,S.artifactRef]);
  await client.query("INSERT INTO public.deployment_tenant_resources VALUES($1,$2,'verified',NULL,$2,1,1)",[S.appInstanceId,S.deploymentId]);
  await client.query("INSERT INTO public.deployment_tenant_external_operations VALUES($1,1,1,'active','provision',$2,$3)",[S.appInstanceId,S.deploymentId,S.operationHash]);
  let before=await reset();
  const recoveryChecks=[];
  for(const scenario of ['success','insertFailure','lostCommitAck']){
    const f=await recoveryFixture();
    await client.query('TRUNCATE deployment_control_v6.dispatch_attempts,deployment_control_v6.approvals,deployment_control_v6.plans,public.deployment_jobs');
    await client.query('UPDATE public.app_instance_deployments SET outputs=$1',[JSON.stringify(f.state.deployment.outputs)]);
    await insertRows('public.deployment_jobs',f.state.jobs);
    for(const name of ['plans','approvals','attempts'])await insertRows('deployment_control_v6.'+(name==='attempts'?'dispatch_attempts':name),f.state.ledger[name]);
    const readRecovery=async c=>{
      const s=await readState(c);s.ledger=(await c.query(`SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY plan_sha),'[]') FROM deployment_control_v6.plans p) AS plans,
        (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY plan_sha),'[]') FROM deployment_control_v6.approvals a) AS approvals,
        (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY plan_sha),'[]') FROM deployment_control_v6.dispatch_attempts a) AS attempts`)).rows[0];
      s.deployment.admissionSnapshot={...structuredClone(f.state.deployment.admissionSnapshot),predecessorJob:s.jobs.find(j=>j.id===f.profile.oldJobId)};
      return normalizedState(s);
    };
    const baseline=await readRecovery(client),profile={...f.profile,stateSha256:await sha256Hex(baseline)};
    const basis=await recoveryBasisCompiler(profile)({...f.input,state:baseline}),review=await makeRecoveryRequestReview({basis,sourceCommit:f.sourceCommit,createdAt:f.at});
    let commits=0,claims=0,inserts=0;
    const adapter={query:async(...args)=>{
      if(args[0].includes(') INSERT INTO public.deployment_jobs')){inserts++;if(scenario==='insertFailure')return client.query('SELECT 1/0');}
      const r=await client.query(...args);if(args[0]==='COMMIT'){commits++;if(scenario==='lostCommitAck')throw Error('synthetic ACK loss');}return r;
    }};
    const result=await createRecoveryRequestTransaction({client:adapter,readState:readRecovery,assertApproved:async()=>{},claimPermanent:async()=>{claims++;}})
      ({review,basis,approved:review.manifestSha256});
    await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const after=await readRecovery(second);await second.query('COMMIT');
    assert.equal(claims,1);assert.equal(inserts,1);
    if(scenario==='insertFailure'){assert.equal(commits,0);assert.deepEqual(after,baseline);}
    else{assert.equal(commits,1);await verifyRecoveryRequestReadback(basis,after,result.at);
      if(scenario==='lostCommitAck')assert.equal(result.outcome,'RECOVERY_REQUEST_COMMIT_UNKNOWN_REQUIRES_READBACK');else assert.equal(result.committed,true,JSON.stringify(result));}
    recoveryChecks.push(scenario);
  }
  console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_RETIRED_RECOVERY_REQUEST',checks:recoveryChecks,
    exactOriginalAdmissionSql:true,oldTaskUpdates:0,productionDatabaseTouched:false,awsCalls:0,workflowDispatches:0}));
  before=await reset();
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query('SET LOCAL search_path=pg_catalog');
  const stablePresentation=await readState(client);await client.query('ROLLBACK');assert.deepEqual(stablePresentation.protection,before.protection);
  let r=await execute(before);assert.equal(r.committed,true,JSON.stringify(r));
  await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const proof=await verifyTransferReadback(before,await readState(second),r.at);await second.query('COMMIT');assert.equal(proof.otherJobsPreserved,2);
  checks.push('actual_original_admission_sql_and_atomic_two_rows_independent_connection_readback');
  before=await reset();await client.query('UPDATE public.deployment_environments SET apply_enabled=1');
  r=await execute(before);assert.equal(r.phase,'ADMISSION_LOCK');assert.equal(r.committed,false);
  assert.equal((await readState(client)).jobs.find(j=>j.id===T.oldJobId).status,'pending');checks.push('business_admission_failure_no_cancel');
  before=await reset();await client.query('UPDATE public.deployment_jobs SET attempts=1 WHERE id=$1',[T.oldJobId]);
  r=await execute(before);assert.equal(r.committed,false);checks.push('changed_old_job_no_write');
  before=await reset();await client.query("UPDATE deployment_control_v6.dispatch_attempts SET state='OBSERVED',run_status='completed',conclusion='success'");
  r=await execute(before);assert.equal(r.committed,false);checks.push('changed_control_ledger_no_write');
  before=await reset();await client.query("INSERT INTO public.deployment_jobs SELECT $1,deployment_id,job_type,$2,'pending',payload,0,1,available_at,NULL,NULL,NULL,NULL,NULL,created_at,updated_at,NULL FROM public.deployment_jobs WHERE id=$3",
    [T.newJobId,'occupied-new-id',T.oldJobId]);r=await execute(before);assert.equal(r.committed,false);checks.push('occupied_new_id_no_cancel');
  before=await reset();await client.query('ALTER TABLE public.deployment_jobs ENABLE ROW LEVEL SECURITY');
  r=await execute(before);assert.equal(r.committed,false);await client.query('ALTER TABLE public.deployment_jobs DISABLE ROW LEVEL SECURITY');checks.push('protection_snapshot_drift_no_write');
  for(const suppress of [false,true]){
    await reset();await client.query(`CREATE FUNCTION public.block_transfer_insert_ci() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.id='${T.newJobId}' THEN ${suppress?'RETURN NULL;':"RAISE EXCEPTION 'synthetic insert failure';"} END IF; RETURN NEW; END$$;
      CREATE TRIGGER block_transfer_insert_ci BEFORE INSERT ON public.deployment_jobs FOR EACH ROW EXECUTE FUNCTION public.block_transfer_insert_ci();`);
    before=await readState(client);r=await execute(before);assert.equal(r.phase,'INSERT');assert.equal(r.committed,false);
    const after=await readState(client);assert.deepEqual(after,before);checks.push(suppress?'zero_insert_result_rolls_back_cancel':'insert_exception_rolls_back_cancel');
    await client.query('DROP TRIGGER block_transfer_insert_ci ON public.deployment_jobs;DROP FUNCTION public.block_transfer_insert_ci()');
  }
  before=await reset();await second.query("SET lock_timeout='200ms'");
  r=await execute(before,{record:async()=>{
    await assert.rejects(second.query("UPDATE deployment_control_v6.dispatch_attempts SET state='OBSERVED'"),e=>e.code==='55P03');
  }});assert.equal(r.committed,true);checks.push('racing_controller_write_blocked_by_pre_snapshot_metadata_lock');
  before=await reset();let commitSubmissions=0;
  const lostAck={query:async(...args)=>{if(args[0]==='COMMIT'){commitSubmissions++;await client.query(...args);throw Error('lost synthetic COMMIT ACK');}return client.query(...args);}};
  r=await execute(before,{dbClient:lostAck});assert.equal(r.outcome,'TASK_TRANSFER_COMMIT_UNKNOWN_REQUIRES_READBACK');assert.equal(commitSubmissions,1);
  await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await verifyTransferReadback(before,await readState(second),r.at);await second.query('COMMIT');
  checks.push('commit_ack_lost_no_retry_committed_rows_independently_verified');
  console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_TASK_TRANSFER',checks,productionDatabaseTouched:false,awsCalls:0}));
  // Same trusted production SELECT reader, but explicit CI-only identity and
  // already isolated client. The production CLI has no such override flag.
  const sql=(await readFile(new URL('../../'+I.sql,import.meta.url),'utf8')).replaceAll('\r\n','\n'),contract=sqlContract(sql);
  await client.query('CREATE ROLE techlong_deployment_controller_v6 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');roleCreated=true;
  await client.query('REVOKE ALL ON SCHEMA deployment_control_v6 FROM PUBLIC;GRANT USAGE ON SCHEMA deployment_control_v6 TO techlong_deployment_controller_v6');
  for(const statement of sql.match(/CREATE FUNCTION deployment_control_v6\.\w+\([\s\S]*?\$\$;/g))await client.query(statement);
  await client.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deployment_control_v6 FROM PUBLIC');
  for(const f of contract.functions.filter(f=>f.serviceExecute))await client.query(`GRANT EXECUTE ON FUNCTION deployment_control_v6.${f.name}(${f.types}) TO techlong_deployment_controller_v6`);
  const sealed=(await readFile(new URL('../aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const guard=sealed.match(/CREATE FUNCTION public\.guard_sealed_plan_reference_v1\(\)[\s\S]*?\$\$;/)[0];
  await client.query('DROP TRIGGER transfer_sealed_guard_ci ON public.deployment_jobs');await client.query(guard);
  await client.query(`CREATE TRIGGER aa_sealed_plan_deployment_jobs_v1 BEFORE INSERT OR UPDATE ON public.deployment_jobs FOR EACH ROW
    EXECUTE FUNCTION public.guard_sealed_plan_reference_v1('deployment_id','');ALTER TABLE public.deployment_jobs ENABLE ALWAYS TRIGGER aa_sealed_plan_deployment_jobs_v1;
    ALTER TABLE public.users ADD COLUMN email text;
    ALTER TABLE public.app_instances ADD COLUMN template_version_id text;
    CREATE TABLE public.app_instance_template_versions(id text PRIMARY KEY,metadata jsonb);
    INSERT INTO public.app_instance_template_versions VALUES('template_transfer_fixture','{}');
    UPDATE public.users SET email='veinyang@gmail.com';UPDATE public.app_instances SET template_version_id='template_transfer_fixture';`);
  const identity=(await client.query(`SELECT current_user::text AS "ownerRole",(SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS "ownerOid",
    current_database() AS database,(SELECT oid::text FROM pg_roles WHERE rolname='techlong_deployment_controller_v6') AS "roleOid",
    (SELECT oid::text FROM pg_namespace WHERE nspname='deployment_control_v6') AS "schemaOid"`)).rows[0];
  const trusted=c=>readTransferState(c,{contract,expected:identity});
  await reset();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');before=await trusted(client);await client.query('COMMIT');
  assert.equal(before.deployment.admissionSnapshot.admin.id,adminId);
  const productionTx=createTransferTransaction({client,readState:trusted});r=await productionTx({baseline:before,assertApproved:async()=>{}});
  assert.equal(r.committed,true);await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await verifyTransferReadback(before,await trusted(second),r.at);await second.query('COMMIT');
  let prepared=await readTransferredSnapshot(second,{contract,expected:identity});
  assert.deepEqual(prepared.newLedger,{plans:[],approvals:[],attempts:[]});
  assert.equal(prepared.state.jobs.find(j=>j.id===T.oldJobId).status,'canceled');
  assert.equal(prepared.state.jobs.find(j=>j.id===T.newJobId).status,'pending');
  assert.equal(prepared.state.ledger.attempts[0].run_id,T.oldReviewRunId);
  // The new-job read is not an alias for the old job's acknowledged history.
  const newPlan=structuredClone(prepared.state.ledger.plans[0]);newPlan.job_id=T.newJobId;newPlan.plan_sha='9'.repeat(64);
  await client.query('INSERT INTO deployment_control_v6.plans SELECT $1,action_sha,risk_sha,$2,mode,body,expires_at,created_at FROM deployment_control_v6.plans LIMIT 1',[newPlan.plan_sha,T.newJobId]);
  const occupied=await readTransferredSnapshot(second,{contract,expected:identity});assert.equal(occupied.newLedger.plans.length,1);
  assert.equal(occupied.state.ledger.plans.length,3);await client.query('DELETE FROM deployment_control_v6.plans WHERE plan_sha=$1',[newPlan.plan_sha]);
  console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_TRANSFERRED_PREPARE_READER',checks:['single_readonly_snapshot_of_both_scopes',
    'old_canceled_new_pending','old_acknowledged_history_not_relabelled','new_plan_occupancy_detected'],productionDatabaseTouched:false,awsCalls:0}));
  await client.query('GRANT EXECUTE ON FUNCTION deployment_control_v6.attest_evidence(text,text) TO techlong_deployment_controller_v6');
  await assert.rejects(trusted(client),/TRANSFER_STATE_CONTROL_FUNCTIONS/);
  await client.query('REVOKE EXECUTE ON FUNCTION deployment_control_v6.attest_evidence(text,text) FROM techlong_deployment_controller_v6');
  await client.query("CREATE TRIGGER unexpected_transfer_ci BEFORE UPDATE ON public.deployment_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_plan_reference_v1('deployment_id','')");
  await assert.rejects(trusted(client),/TRANSFER_STATE_JOB_GUARD/);await client.query('DROP TRIGGER unexpected_transfer_ci ON public.deployment_jobs');
  console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_TRANSFER_PRODUCTION_READER',checks:['nine_installed_function_bodies_and_role_isolation',
    'complete_business_admission_snapshot','actual_atomic_core_with_production_reader','separate_readonly_connection_verified',
    'unexpected_execute_privilege_rejected','unexpected_job_trigger_rejected'],productionDatabaseTouched:false,awsCalls:0}));
  // W8y executes the SAME SQL/reader, with two historical ledger scopes. CI
  // identity/facts are explicit code capabilities, absent from production flags.
  const successorChecks=[];
  const nextReader=c=>readTransferState(c,{contract,expected:identity,ledgerJobIds:[T.oldJobId,NEXT.oldJobId],candidateJobId:NEXT.newJobId});
  async function resetSuccessor(){
    await reset();const legacyBefore=await trusted(client);
    const oldTx=createTransferTransaction({client,readState:trusted});assert.equal((await oldTx({baseline:legacyBefore,assertApproved:async()=>{}})).committed,true);
    const at=Date.now(),body=structuredClone(legacyBefore.ledger.plans[0].body);
    Object.assign(body,{jobId:NEXT.oldJobId,sourceCommit:NEXT.oldSource,preparedAt:at-7200000,expiresAt:at-3600000});body.inputs.job=NEXT.oldJobId;
    body.inputs.installation=canonicalJson({key:`worker-v5/${S.appInstanceId}/installation/${B.platform.installationSha256}.json`,
      sha256:TRANSFERRED_CYCLE.installationObjectSha256,versionId:'synthetic-ci-installation'});
    body.inputs.lineage=canonicalJson({key:J.lineageKey,sha256:J.lineageSha256,versionId:'synthetic-ci-lineage'});
    const v=await validatePlan(body,B.platform,body.preparedAt);
    await insertRows('deployment_control_v6.plans',[{plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:body.riskSha256,job_id:NEXT.oldJobId,mode:'Review',body,
      expires_at:new Date(body.expiresAt).toISOString(),created_at:new Date(body.preparedAt).toISOString()}]);
    await insertRows('deployment_control_v6.approvals',[{plan_sha:v.planSha256,admin_id:adminId,approved_at:new Date(at-3500000).toISOString()}]);
    await insertRows('deployment_control_v6.dispatch_attempts',[{plan_sha:v.planSha256,job_id:NEXT.oldJobId,mode:'Review',state:'ACKNOWLEDGED',run_id:NEXT.oldReviewRunId,
      run_status:null,conclusion:null,proof_sha:null,started_at:new Date(at-3500000).toISOString(),observed_at:null}]);
    const baseline=normalizedState(await nextReader(client)),profile=makeNextTransferProfile({factsAt:at-1000,databaseCheckedAt:at-500,jobCount:baseline.jobs.length,
      baselineSha256:await sha256Hex(baseline),ledgerSha256:await sha256Hex(baseline.ledger),protection:baseline.protection});
    assert.deepEqual(Object.values(baseline.ledger).map(v=>v.length),[4,2,2]);return {baseline,profile};
  }
  for(const scenario of ['success','insertFailure','controllerRace','lostCommitAck']){
    const {baseline,profile}=await resetSuccessor();let commits=0;
    const adapter={query:async(...args)=>{
      if(scenario==='insertFailure'&&args[0].includes(') INSERT INTO public.deployment_jobs'))return client.query('SELECT 1/0');
      if(args[0]==='COMMIT'){commits++;const result=await client.query(...args);if(scenario==='lostCommitAck')throw Error('synthetic ACK loss');return result;}
      return client.query(...args);}};
    const tx=createTransferTransaction({client:adapter,readState:nextReader,profile,record:async()=>{
      if(scenario==='controllerRace')await assert.rejects(second.query('UPDATE deployment_control_v6.dispatch_attempts SET observed_at=clock_timestamp()'),e=>e.code==='55P03');
    }});
    const result=await tx({baseline,assertApproved:async()=>{}});
    await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const observed=await nextReader(second);await second.query('COMMIT');
    if(scenario==='insertFailure'){assert.equal(result.phase,'INSERT');assert.equal(commits,0);assert.deepEqual(normalizedState(observed),baseline);}
    else{await profile.verifyReadback(baseline,observed,result.at);assert.equal(commits,1);
      if(scenario==='lostCommitAck')assert.equal(result.outcome,'TASK_TRANSFER_COMMIT_UNKNOWN_REQUIRES_READBACK');else assert.equal(result.committed,true);}
    successorChecks.push(scenario);
  }
  successorChecks.push('both_generations_full_ledger_read_and_preserved','same_owner_admission_and_always_guard');
  console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_HELD_SUCCESSOR',checks:successorChecks,productionDatabaseTouched:false,awsCalls:0,workflowDispatches:0}));
  {
    const {baseline,profile:txProfile}=await resetSuccessor(),profile={...txProfile,anchorSchema:'techlong/held-successor-review-anchor/v6'};
    const applied=await createTransferTransaction({client,readState:nextReader,profile})({baseline,assertApproved:async()=>{}});assert.equal(applied.committed,true);
    const anchor=await makeTransferredAnchor({before:baseline,after:await nextReader(client),transferredAt:applied.at},profile),source='c'.repeat(40);
    const manifest={binding:B,sourceCommit:source,anchor},ports=await wireCycleDatabase({writer:client,reader:second,contract,expected:identity,
      manifest,profile,guard:async()=>{},assertClaim:async()=>{}});
    const empty=await ports.snapshot();assert.deepEqual(empty.newLedger,{plans:[],approvals:[],attempts:[]});assert.deepEqual(normalizedState(empty.state),anchor.after);
    const at=Date.now(),body=structuredClone(baseline.ledger.plans.find(p=>p.job_id===NEXT.oldJobId).body);
    Object.assign(body,{jobId:NEXT.newJobId,sourceCommit:source,preparedAt:at,expiresAt:at+7200000});body.inputs.job=NEXT.newJobId;
    const review=await validatePlan(body,B.platform,at);await ports.publish(ownerQueryV6('plan',review));
    await verifyPublishedReview(await ports.snapshot(),await ports.loadPlan(review.planSha256),manifest,profile);
    const wrong=structuredClone(body);wrong.jobId=NEXT.oldJobId;wrong.inputs.job=NEXT.oldJobId;
    await assert.rejects(ports.publish(ownerQueryV6('plan',await validatePlan(wrong,B.platform,at))));
    await client.query('SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)',[review.planSha256,review.actionSha256,B.platform.riskSha256,adminId]);
    await client.query('SELECT deployment_control_v6.acknowledge($1,$2)',[review.planSha256,'223456781']);
    await ports.observe(review.planSha256,{runId:'223456781',status:'completed',conclusion:'success',url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/223456781'});
    await ports.advance(ownerQueryV6('proof',{planSha256:review.planSha256,proofSha256:'8'.repeat(64)}));
    const next=structuredClone(body);next.mode='RunOnce';next.inputs.mode='RunOnce';next.preparedAt=Date.now();next.expiresAt=next.preparedAt+300000;
    next.predecessor={planSha256:review.planSha256,runId:'223456781',proofSha256:'8'.repeat(64)};
    next.inputs.manifest=canonicalJson({key:`worker-v5/${S.appInstanceId}/${NEXT.newJobId}/${'7'.repeat(64)}/manifest.json`,sha256:'6'.repeat(64),versionId:'synthetic-ci'});
    next.inputs.manifestSha='7'.repeat(64);await ports.advance(ownerQueryV6('plan',await validatePlan(next,B.platform,next.preparedAt)));
    const observed=await ports.snapshot();assert.deepEqual(normalizedState(observed.state),anchor.after);
    assert.deepEqual(Object.values(observed.newLedger).map(v=>v.length),[2,1,1]);
    const readOnly=await wireCycleDatabase({reader:second,contract,expected:identity,manifest,profile,guard:async()=>{},assertClaim:async()=>{},inspect:true});
    await assert.rejects(readOnly.publish(ownerQueryV6('plan',review)),/INSPECT_READONLY/);await readOnly.close();await ports.close();
    console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_SUCCESSOR_CYCLE_PORTS',checks:['new9db_ledger_read_separate_from_both_old_generations',
      'empty_new_occupancy_verified','exact_new_review_sql_and_independent_readback','old6a_publication_rejected',
      'simulated_manual_ack_and_exact_observation','bound_proof_and_runonce','complete_old_history_business_and_held_job_unchanged','inspect_cannot_publish'],
      productionDatabaseTouched:false,awsCalls:0,workflowDispatches:0}));
  }
  // Restore the original one-generation fixture for the existing cycle proofs.
  await reset();before=await trusted(client);r=await createTransferTransaction({client,readState:trusted})({baseline:before,assertApproved:async()=>{}});
  assert.equal(r.committed,true);
  prepared=await readTransferredSnapshot(second,{contract,expected:identity});
  const source='f'.repeat(40),at=Date.now(),body=structuredClone(prepared.state.ledger.plans[0].body);
  Object.assign(body,{jobId:T.newJobId,sourceCommit:source,preparedAt:at,expiresAt:at+7200000});body.inputs.job=T.newJobId;
  body.inputs.installation=canonicalJson(JSON.parse(body.inputs.installation));
  body.inputs.lineage=canonicalJson({key:`worker-v5/${S.appInstanceId}/lineage/synthetic-ci.json`,sha256:'2'.repeat(64),versionId:'synthetic-ci'});
  const cycleManifest={binding:B,sourceCommit:source,anchor:{after:normalizedState(prepared.state),references:{installation:JSON.parse(body.inputs.installation),lineage:JSON.parse(body.inputs.lineage)}}};
  const ports=await wireCycleDatabase({writer:client,reader:second,contract,expected:identity,manifest:cycleManifest,guard:async()=>{},assertClaim:async()=>{}});
  const review=await validatePlan(body,B.platform,at);await ports.publish(ownerQueryV6('plan',review));
  const independent=await ports.snapshot();await verifyPublishedReview(independent,await ports.loadPlan(review.planSha256),cycleManifest);
  await client.query('SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)',[review.planSha256,review.actionSha256,B.platform.riskSha256,adminId]);
  await client.query('SELECT deployment_control_v6.acknowledge($1,$2)',[review.planSha256,'123456781']);
  await ports.observe(review.planSha256,{runId:'123456781',status:'completed',conclusion:'success',url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/123456781'});
  const proofQuery=ownerQueryV6('proof',{planSha256:review.planSha256,proofSha256:'8'.repeat(64)});await ports.advance(proofQuery);
  const next=structuredClone(body);next.mode='RunOnce';next.inputs.mode='RunOnce';next.preparedAt=Date.now();next.expiresAt=next.preparedAt+300000;
  next.predecessor={planSha256:review.planSha256,runId:'123456781',proofSha256:'8'.repeat(64)};
  next.inputs.manifest=canonicalJson({key:`worker-v5/${S.appInstanceId}/${T.newJobId}/${'7'.repeat(64)}/manifest.json`,sha256:'6'.repeat(64),versionId:'synthetic-ci'});
  next.inputs.manifestSha='7'.repeat(64);const successor=await validatePlan(next,B.platform,next.preparedAt);await ports.advance(ownerQueryV6('plan',successor));
  assert.equal((await ports.loadPlan(review.planSha256)).attempt.proofSha256,'8'.repeat(64));
  assert.equal((await ports.loadPlan(successor.planSha256)).attempt,null);
  await assert.rejects(ports.publish(ownerQueryV6('plan',review)));await assert.rejects(ports.advance(proofQuery));
  const readOnly=await wireCycleDatabase({reader:second,contract,expected:identity,manifest:cycleManifest,guard:async()=>{},assertClaim:async()=>{},inspect:true});
  await assert.rejects(readOnly.publish(ownerQueryV6('plan',review)),/INSPECT_READONLY/);
  assert.deepEqual({plans:ports.counts().plans,proofs:ports.counts().proofs,observations:ports.counts().observations},{plans:2,proofs:1,observations:1});
  await readOnly.close();await ports.close();
  console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_HOSTED_CYCLE_WRITE_PORTS',checks:['exact_review_publication',
    'separate_read_client_publication_readback','simulated_manual_begin_ack_without_GitHub','one_exact_observation','one_proof_and_bound_runonce',
    'write_budget_and_duplicate_proof_rejected','inspect_cannot_publish'],productionDatabaseTouched:false,awsCalls:0,workflowDispatches:0}));
}finally{
  if(second)await second.end();if(client)await client.end();
  if(created)await control.query('DROP DATABASE '+db);if(roleCreated)await control.query('DROP ROLE techlong_deployment_controller_v6');await control.end();
}
