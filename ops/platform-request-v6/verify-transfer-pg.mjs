// Disposable GitHub PostgreSQL ONLY. Never reads .env, AWS or a production URL.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as adminId} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {transferFixture} from '../../tests/fixtures/platform-task-transfer-v6.mjs';
import {TRANSFER as T,createTransferTransaction,verifyTransferReadback} from './transfer.mjs';
import {readTransferState} from './transfer-state.mjs';
import {readTransferredSnapshot} from '../platform-review-v6/current-database.mjs';
import {sqlContract,I} from '../platform-controller-review-v6/install.mjs';
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
  const prepared=await readTransferredSnapshot(second,{contract,expected:identity});
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
}finally{
  if(second)await second.end();if(client)await client.end();
  if(created)await control.query('DROP DATABASE '+db);if(roleCreated)await control.query('DROP ROLE techlong_deployment_controller_v6');await control.end();
}
