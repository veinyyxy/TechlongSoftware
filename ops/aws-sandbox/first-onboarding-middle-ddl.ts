import ts from "typescript";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { FIRST_OPEN_AUTHORITY_KEY, FIRST_OPEN_EPOCH_MARKER, FIRST_OPEN_MIDDLE_ROLES as roles,
  FIRST_OPEN_MIDDLE_SQL_HASHES, FIRST_OPEN_MIDDLE_WORKER, FIRST_OPEN_RESOURCE_MARKER, FIRST_OPEN_SECRET_BASE_NAME, firstOpenMiddleOperationHash,
  firstOpenMiddleScope, type FirstOpenMiddleOperation, type FirstOpenMiddleScope } from "../../lib/deployments/execution/first-onboarding-middle.ts";
import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { firstOpenVersion, verifyFirstOpenTaskRelease } from "../../lib/deployments/execution/first-onboarding-version.ts";
import { firstOpenSecondSlotSqlFence } from "../../lib/deployments/execution/first-onboarding-claim-entry.ts";

// Offline compiler only. The installed function contains static SQL, never
// dynamic EXECUTE. The application sends only a literal operation + values.
export const FIRST_OPEN_NEON_REPOSITORY_LF_SHA = "390e4f911056404a7c283c243143b51337dbbde422f6081f93a7bca37abe443a";
const methodQueries = {
  loadContext: ["context", "capacity_count"], reserveEnvironmentCapacity: ["reserve"], heartbeat: ["heartbeat"],
  transitionDeployment: ["transition"], beginStep: ["begin_step"], finishStep: ["finish_step"],
  recordTenantResourceLifecycle: ["record_lifecycle"], claimTenantResourceGeneration: ["claim_generation"],
  prepareTenantExternalOperation: ["prepare_epoch"], activateTenantExternalOperation: ["activate_epoch"],
  assertTenantExternalOperation: ["assert_epoch"],
} as const satisfies Record<string, readonly FirstOpenMiddleOperation[]>;

async function reviewedSql(repositorySource: string) {
  const text = repositorySource.replace(/\r\n/g, "\n");
  if (await sha256Hex(text) !== FIRST_OPEN_NEON_REPOSITORY_LF_SHA) throw Error("FIRST_OPEN_MIDDLE_REPOSITORY_SHA");
  const file = ts.createSourceFile("neon-repository.ts", text, ts.ScriptTarget.Latest, true);
  const cls = file.statements.find((n): n is ts.ClassDeclaration => ts.isClassDeclaration(n) && n.name?.text === "NeonDeploymentExecutionRepository");
  const statements = {} as Record<FirstOpenMiddleOperation, string>;
  for (const [method, keys] of Object.entries(methodQueries)) {
    const node = cls?.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(file) === method);
    if (!node) throw Error("FIRST_OPEN_MIDDLE_REPOSITORY_METHOD");
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText(file) === "query" && n.arguments[0]?.getText(file) === "this.sql") {
        const sql = n.arguments[1];
        if (!sql || !ts.isNoSubstitutionTemplateLiteral(sql)) throw Error("FIRST_OPEN_MIDDLE_SQL_LITERAL");
        const key = keys.find(k => !statements[k]);
        if (!key) throw Error("FIRST_OPEN_MIDDLE_SQL_COUNT");
        statements[key] = sql.text;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    for (const k of keys) if (!statements[k] || await sha256Hex(statements[k]) !== FIRST_OPEN_MIDDLE_SQL_HASHES[k]) {
      throw Error("FIRST_OPEN_MIDDLE_SQL_HASH");
    }
  }
  return statements;
}

const schema = "techlong_first_onboarding_middle";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const arg = (n: number) => `(p_args->>${n - 1})`;
const jsonArg = (n: number) => `(p_args->${n - 1})`;
const jsonText = (n: number) => `(${arg(n)}::jsonb)`;
const equal = (n: number, v: string | number | readonly string[] | null) => `${jsonArg(n)}=${literal(JSON.stringify(v))}::jsonb`;
const either = (n: number, v: readonly string[]) => `${arg(n)} IN (${v.map(literal).join(",")})`;
const match = (n: number, regex: string) => `${arg(n)}~${literal(regex)}`;
const hash = (n: number) => match(n, "^[a-f0-9]{64}$");
const stepKeys = ["sts_identity_preflight", "sts_identity_prewrite", "shared_cell_security_preflight", "shared_cell_security_prewrite",
  "first_onboarding_stack_absence", "tenant_database_prepare", "tenant_database_migrate", "cloudformation_apply", "cloudformation_observe",
  "control_health", "control_provision", "control_verify", "first_onboarding_independent_inspection"] as const;
const transitions = [
  [["planned", "retry_wait"], "queued", "queued"], [["queued"], "preflight", "preflight"],
  [["preflight"], "database_preparing", "database_preparing"], [["database_preparing"], "migrating", "migrating"],
  [["migrating"], "infrastructure_provisioning", "cloudformation_apply"],
  [["infrastructure_provisioning"], "waiting_healthy", "cloudformation_wait"],
  [["infrastructure_provisioning"], "waiting_healthy", "waiting_healthy"],
  [["waiting_healthy"], "configuring", "control_provision"], [["configuring"], "verifying", "control_verify"],
] as const;

const reads = {
  deployment_jobs: "id,deployment_id,status,job_type,lease_owner,lease_token,lease_expires_at,attempts,max_attempts,payload,completed_at",
  app_instance_deployments: "id,app_instance_id,environment_id,subscription_id,status,mode,driver,cell_key,created_at,started_at,plan_hash,configuration_hash,artifact_ref,desired_plan,outputs",
  app_instances: "id,workspace_id,product_id,subscription_id,status,provisioning_source,provisioned_at,template_version_id,slug,tenant_key,configuration_snapshot",
  workspaces: "id,status",
  subscriptions: "id,workspace_id,product_id,status,current_period_start,current_period_end",
  deployment_environments: "id,key,name,kind,driver,expected_account_id,region,cell_key,base_domain,apply_enabled,policy,status,admission_state",
  deployment_environment_bindings: "environment_id,worker_role_arn,cloudformation_role_arn,tenant_stack_parameters,status",
  deployment_cleanup_schedules: "id,deployment_id,status,expires_at,provider_schedule_ref,confirmed_at",
  deployment_environment_capacity_reservations: "deployment_id,environment_id,slot",
  deployment_step_runs: "id,deployment_id,job_id,step_key,attempt,status,input_hash,output",
  // Original fenced statements return entire rows of these two exact tables.
  deployment_tenant_resources: "*",
  deployment_tenant_external_operations: "*",
  deployment_tenant_resource_events: "id,app_instance_id,generation,deployment_id,evidence,event_type,created_at",
  deployment_tenant_external_operation_events: "id",
} as const;
const writes = {
  deployment_jobs: "lease_expires_at,updated_at",
  app_instance_deployments: "status,current_step,outputs,started_at,updated_at",
  deployment_environments: "id", app_instances: "id", deployment_environment_capacity_reservations: "deployment_id",
  deployment_step_runs: "status,output,error_code,error_message,finished_at",
  deployment_tenant_resources: "owner_deployment_id,generation,ownership_marker,lifecycle_status,external_operation_epoch,runtime_secret_ref,baseline_digest,migration_contract,evidence_hash,evidence,last_error,updated_at,destroyed_at",
  deployment_tenant_external_operations: "state,evidence_hash,evidence,updated_at,activated_at,completed_at",
} as const;
const inserts = {
  deployment_environment_capacity_reservations: "deployment_id,environment_id,slot,reserved_at",
  deployment_step_runs: "id,deployment_id,job_id,step_key,attempt,status,input_hash,output,started_at",
  deployment_tenant_resources: "app_instance_id,created_by_deployment_id,owner_deployment_id,generation,stable_identity_hash,environment_id,workspace_id,product_id,cell_key,database_name,role_name,secret_name,runtime_secret_ref,ownership_marker,lifecycle_status,baseline_digest,migration_contract,evidence_hash,evidence,last_error,created_at,updated_at,destroyed_at",
  deployment_tenant_resource_events: "id,app_instance_id,generation,deployment_id,event_type,from_status,to_status,evidence_hash,evidence,created_at",
  deployment_tenant_external_operations: "app_instance_id,generation,epoch,stable_identity_hash,owner_deployment_id,created_by_job_id,created_by_attempt,intent,operation_hash,marker,state,evidence_hash,evidence,created_at,updated_at,activated_at,completed_at",
  deployment_tenant_external_operation_events: "id,app_instance_id,generation,epoch,deployment_id,event_type,from_state,to_state,evidence_hash,evidence,created_at",
} as const;
const grants = (action: string, entries: Readonly<Record<string, string>>) => Object.entries(entries).map(([table, cols]) =>
  `GRANT ${action}${cols === "*" ? "" : ` (${cols})`} ON public.${table} TO ${roles.definer};`).join("\n");

type SqlArgumentType = "integer" | "bigint" | "strings" | "clock";
type Branch = { length: number; checks: string[]; substitution?: Record<number, SqlArgumentType> };
const lease = (iJob: number, iDeployment: number, iWorker: number, iToken: number, iAttempt: number) => [
  equal(iJob, s.jobId), equal(iDeployment, s.deploymentId), equal(iWorker, FIRST_OPEN_MIDDLE_WORKER),
  `${arg(iToken)}=p_lease`, equal(iAttempt, 1),
];
const workspace = (n: number) => `encode(sha256(convert_to(${arg(n)},'UTF8')),'hex')=${literal(s.workspaceSha256)}`;
const identity = (n: number) => [equal(n, s.tenantDatabase), equal(n + 1, s.tenantRole),
  equal(n + 2, FIRST_OPEN_SECRET_BASE_NAME), equal(n + 3, s.stableIdentity)];
const resource = (n: number) => [equal(n, s.instanceId), equal(n + 1, 1), equal(n + 2, FIRST_OPEN_RESOURCE_MARKER), equal(n + 3, s.stableIdentity)];
const noPreviousEpoch = `NOT EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations WHERE app_instance_id=${literal(s.instanceId)})`;
const pendingEpoch = `EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations WHERE app_instance_id=${literal(s.instanceId)} AND generation=1 AND epoch=1 AND state='pending_external')`;

export async function sandboxFirstOpenMiddleDdl(input: FirstOpenMiddleScope, repositorySource: string) {
  const scope = firstOpenMiddleScope(input), queries = await reviewedSql(repositorySource);
  const op = await firstOpenMiddleOperationHash(scope);
  const version = firstOpenVersion(scope.taskRelease);
  const secondSlot = scope.secondSlot;
  if (secondSlot !== undefined) {
    if (!scope.taskRelease) throw Error("FIRST_OPEN_MIDDLE_SECOND_SLOT_RELEASE");
    await verifyFirstOpenTaskRelease(scope.taskRelease);
  }
  const vacantSecondSlot = secondSlot === undefined ? "" : firstOpenSecondSlotSqlFence(secondSlot);
  const ownedSecondSlot = secondSlot === undefined ? "" : firstOpenSecondSlotSqlFence(secondSlot, "owned-slot-2");
  const hasCapacity = (predicate: string) => `EXISTS (SELECT 1 FROM public.deployment_environments e WHERE ${predicate})`;
  const secondSlotReads = secondSlot === undefined ? reads : { ...reads, deployment_environments: reads.deployment_environments + ",admission_epoch" };
  const heldVersion = scope.taskRelease === undefined ? "" : `
     AND j.payload::jsonb#>>'{scope,releaseId}'=${literal(version.releaseId)}
     AND j.payload::jsonb#>>'{scope,artifactRef}'=${literal(version.artifactRef)}`;
  const rdb = FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256;
  const proof = jsonText(15), candidate = `${proof}->'authorityRecord'`;
  const requiredRecord = { schemaVersion: 1, stableIdentityHash: s.stableIdentity, ownerDeploymentId: s.deploymentId,
    generation: 1, epoch: 1, intent: "provision", operationHash: op, marker: FIRST_OPEN_EPOCH_MARKER, predecessor: null };
  const absentStack = { stackName: SANDBOX_FIRST_OPEN_STACK, state: "missing", stackId: null, tags: {} };
  const specs: Record<FirstOpenMiddleOperation, Branch> = {
    context: { length: 1, checks: [equal(1, s.deploymentId)] },
    capacity_count: { length: 2, checks: [equal(1, s.environmentId), equal(2, s.deploymentId)] },
    reserve: { length: 7, checks: [...lease(4, 1, 5, 6, 7), equal(2, s.environmentId), secondSlot === undefined ?
      `${arg(3)}::integer=(SELECT (policy::jsonb->>'maxTenants')::integer FROM public.deployment_environments WHERE id=${literal(s.environmentId)})` :
      equal(3, 2)], substitution: { 3: "integer", 7: "integer" } },
    heartbeat: { length: 7, checks: [...lease(2, 3, 4, 5, 6), equal(7, scope.writeBefore), `${arg(1)}::bigint BETWEEN 1 AND 120000`],
      substitution: { 1: "bigint", 6: "integer", 7: "bigint" } },
    transition: { length: 10, checks: [...lease(7, 5, 8, 9, 10), `jsonb_typeof(${jsonText(3)})='object'`,
      `(${transitions.map(([from, to, step]) => `(${equal(6, from)} AND ${equal(1, to)} AND ${equal(2, step)})`).join(" OR ")})`],
      substitution: { 4: "clock", 6: "strings", 10: "integer" } },
    begin_step: { length: 8, checks: [...lease(1, 2, 3, 8, 4), either(6, stepKeys), hash(7),
      `${arg(5)}='step_'||substr(encode(sha256(convert_to(${arg(2)}||':'||${arg(1)}||':'||${arg(6)}||':'||${arg(7)}||':1','UTF8')),'hex'),1,24)`], substitution: { 4: "integer" } },
    finish_step: { length: 10, checks: [...lease(1, 2, 3, 4, 5), either(6, ["succeeded", "failed", "skipped"]),
      `jsonb_typeof(${jsonText(7)})='object'`, match(10, "^step_[a-f0-9]{24}$")], substitution: { 5: "integer" } },
    record_lifecycle: { length: 28, checks: [...lease(2, 1, 3, 24, 25), equal(5, s.instanceId), equal(6, 1),
      equal(7, FIRST_OPEN_RESOURCE_MARKER), equal(8, s.environmentId), workspace(9), equal(10, s.productId), equal(11, "cell-sandbox-1"),
      ...identity(12), match(16, `^arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-[A-Za-z0-9]{6}$`),
      `((${equal(17, "database_empty")} AND ${equal(18, null)} AND ${equal(19, null)}) OR (${equal(17, "verified")} AND ${equal(18, rdb)} AND ${equal(19, s.schemaVersion)}))`,
      hash(20), `jsonb_typeof(${jsonText(21)})='object'`, equal(22, null), equal(23, "lifecycle_recorded"),
      equal(26, 1), equal(27, op), equal(28, FIRST_OPEN_EPOCH_MARKER)], substitution: { 4: "clock", 6: "integer", 25: "integer", 26: "integer" } },
    claim_generation: { length: 15, checks: [...lease(2, 1, 3, 14, 15), equal(5, s.instanceId), equal(6, s.environmentId),
      workspace(7), equal(8, s.productId), equal(9, "cell-sandbox-1"), ...identity(10)], substitution: { 4: "clock", 15: "integer" } },
    prepare_epoch: { length: 11, checks: [...lease(2, 1, 3, 10, 11), ...resource(4), equal(8, "provision"), equal(9, op), noPreviousEpoch], substitution: { 5: "integer", 11: "integer" } },
    activate_epoch: { length: 15, checks: [...lease(2, 1, 3, 13, 14), ...resource(4), equal(8, 1), equal(9, "provision"),
      equal(10, op), equal(11, FIRST_OPEN_EPOCH_MARKER), hash(12), pendingEpoch,
      `${proof}->>'provider'='atomic-external-epoch-authority'`, `${proof}->>'authorityKey'=${literal(FIRST_OPEN_AUTHORITY_KEY)}`,
      `${proof}->>'authorityRevisionHash'=${literal(await sha256Hex("rev:1"))}`, `${candidate}=${literal(JSON.stringify(requiredRecord))}::jsonb`,
      `${proof}->'provisionPredecessor'='null'::jsonb`, ...["workloadReadbackBefore", "workloadReadbackAfter"].map(k =>
        `${proof}->${literal(k)}=${literal(JSON.stringify(absentStack))}::jsonb`)], substitution: { 5: "integer", 8: "integer", 14: "integer" } },
    assert_epoch: { length: 14, checks: [...lease(1, 3, 11, 12, 13), equal(2, s.instanceId), equal(4, 1), equal(5, FIRST_OPEN_RESOURCE_MARKER),
      equal(6, s.stableIdentity), equal(7, 1), equal(8, "provision"), equal(9, op), equal(10, FIRST_OPEN_EPOCH_MARKER), equal(14, "null")],
      substitution: { 4: "integer", 7: "integer", 13: "integer" } },
  };
  const relations = new RegExp(`\\b(FROM|JOIN|UPDATE|INTO) (${Object.keys(reads).join("|")})\\b`, "g");
  const body = (Object.entries(specs) as [FirstOpenMiddleOperation, Branch][]).map(([key, spec]) => {
    const reserveSecondSlot = key === "reserve" && secondSlot !== undefined;
    let source = queries[key];
    if (reserveSecondSlot) {
      // The old ready tenant occupies slot 1 logically, with no ledger row.
      // Keep the original lease and atomic insert; change only its candidate range.
      const firstSlot = "generate_series(1, $3)";
      if (source.indexOf(firstSlot) < 0 || source.indexOf(firstSlot) !== source.lastIndexOf(firstSlot)) {
        throw Error("FIRST_OPEN_MIDDLE_SECOND_SLOT_QUERY");
      }
      source = source.replace(firstSlot, () => "generate_series(2, $3)");
    }
    const sql = source.replace(relations, "$1 public.$2").replace(/\$(\d+)/g, (_, a: string) => {
      const n = Number(a);
      if (n < 1 || n > spec.length) throw Error("FIRST_OPEN_MIDDLE_BINDING_COUNT");
      const kind = spec.substitution?.[n];
      if (kind === "clock") return "scoped_now";
      if (kind === "strings") return `(ARRAY(SELECT jsonb_array_elements_text(${jsonArg(n)})))`;
      return kind ? `(${arg(n)}::${kind})` : arg(n);
    });
    // Allow the pre-create capacity recheck only for our exact slot 2. The
    // original query still verifies the current SQL lease and returns its
    // existing reservation without inserting a second row.
    const lock = reserveSecondSlot ? `
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_SECOND_SLOT_ISOLATION'; END IF;
  PERFORM 1 FROM public.deployment_environments e WHERE e.id=${literal(s.environmentId)} FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_SECOND_SLOT'; END IF;
  IF NOT (${hasCapacity(vacantSecondSlot)} OR ${hasCapacity(ownedSecondSlot)}) THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_SECOND_SLOT'; END IF;` : "";
    const check = reserveSecondSlot ? `
    IF result_row.deployment_id IS DISTINCT FROM ${literal(s.deploymentId)} OR
       NOT ${hasCapacity(ownedSecondSlot)}
    THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_SECOND_SLOT_RESULT'; END IF;` : "";
    return `WHEN ${literal(key)} THEN
  IF jsonb_array_length(p_args)<>${spec.length} OR (${spec.checks.join(" AND\n     ")}) IS NOT TRUE
  THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_ARGUMENTS'; END IF;${lock}
  FOR result_row IN ${sql} LOOP${check}
    RETURN NEXT to_jsonb(result_row);
  END LOOP;`;
  }).join("\n");

  // Public must be on the path for the existing (unqualified) schema triggers.
  // Reject CREATE there for either role, keep pg_catalog first and pg_temp last.
  return `BEGIN;
DO $check$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('${roles.definer}','${roles.runner}')
       AND rolcanlogin=(rolname='${roles.runner}') AND NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member
       WHERE r.rolname IN ('${roles.definer}','${roles.runner}'))
    OR pg_catalog.has_schema_privilege('${roles.definer}','public','CREATE')
    OR pg_catalog.has_schema_privilege('${roles.runner}','public','CREATE')
  THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_ROLE_PRECONDITION'; END IF;
END $check$;
CREATE SCHEMA ${schema} AUTHORIZATION ${roles.definer};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${schema} TO ${roles.runner};
GRANT USAGE ON SCHEMA public TO ${roles.definer};
${grants("SELECT", secondSlotReads)}
${grants("UPDATE", writes)}
${grants("INSERT", inserts)}
CREATE FUNCTION ${schema}.run(p_sha text,p_lease text,p_op text,p_args jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog,public,pg_temp AS $first_open_middle$
DECLARE scoped_now bigint; result_row record; db_lease_deadline bigint;
BEGIN
  IF (p_sha=${literal(scope.approvalSha256)} AND jsonb_typeof(p_args)='array' AND octet_length(p_args::text)<=131072) IS NOT TRUE
  THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_APPROVAL'; END IF;
  IF p_op='readiness' THEN
    scoped_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
    IF p_lease IS DISTINCT FROM '' OR p_args<>'[]'::jsonb OR scoped_now<${scope.window.startAt} OR scoped_now>=${scope.window.claimBefore}
      OR NOT EXISTS (SELECT 1 FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id
        WHERE j.id=${literal(s.jobId)} AND d.id=${literal(s.deploymentId)} AND d.app_instance_id=${literal(s.instanceId)}
          AND d.subscription_id=${literal(s.subscriptionId)} AND d.environment_id=${literal(s.environmentId)}
          AND j.job_type='apply' AND j.status='pending' AND j.attempts=0 AND j.max_attempts=1 AND j.lease_token IS NULL
          AND d.status='planned' AND d.plan_hash=${literal(scope.planHash)} AND d.configuration_hash=${literal(scope.configurationHash)}
          AND d.artifact_ref=${literal(version.artifactRef)}${heldVersion})
      OR EXISTS (SELECT 1 FROM public.deployment_tenant_resources WHERE app_instance_id=${literal(s.instanceId)})
      OR EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations WHERE app_instance_id=${literal(s.instanceId)})
      OR EXISTS (SELECT 1 FROM public.deployment_environment_bindings WHERE environment_id=${literal(s.environmentId)})${secondSlot === undefined ? "" :
      `\n      OR NOT ${hasCapacity(vacantSecondSlot)}`}
    THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_PRECLAIM'; END IF;
    RETURN NEXT jsonb_build_object('jobId',${literal(s.jobId)},'planHash',${literal(scope.planHash)},'configurationHash',${literal(scope.configurationHash)},
        'writeBefore',${scope.writeBefore}::bigint,'claimBefore',${scope.window.claimBefore}::bigint);
    RETURN;
  END IF;
  IF (p_lease~'^lease_[a-f0-9]{32}$') IS NOT TRUE THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_LEASE'; END IF;
  SELECT j.lease_expires_at INTO db_lease_deadline FROM public.deployment_jobs j
    JOIN public.app_instance_deployments d ON d.id=j.deployment_id
    JOIN public.app_instances a ON a.id=d.app_instance_id
    JOIN public.deployment_environments e ON e.id=d.environment_id
    JOIN public.subscriptions sub ON sub.id=d.subscription_id AND sub.id=a.subscription_id AND sub.workspace_id=a.workspace_id AND sub.product_id=a.product_id
  WHERE j.id=${literal(s.jobId)} AND d.id=${literal(s.deploymentId)} AND a.id=${literal(s.instanceId)} AND a.status='pending'
    AND a.provisioning_source='payment_success' AND a.provisioned_at IS NULL AND a.slug=${literal(s.hostname.split(".")[0]!)}
    AND d.environment_id=${literal(s.environmentId)} AND sub.id=${literal(s.subscriptionId)} AND sub.status='active' AND sub.current_period_end>${scope.writeBefore}
    AND sub.current_period_start<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint
    AND d.mode='aws_sandbox' AND d.driver='aws_ecs_cell' AND d.cell_key='cell-sandbox-1'
    AND e.kind='aws_sandbox' AND e.status='active' AND e.expected_account_id=${literal(s.account)} AND e.region=${literal(s.region)}
    AND e.cell_key='cell-sandbox-1' AND e.apply_enabled=0
    AND a.product_id=${literal(s.productId)} AND encode(sha256(convert_to(a.workspace_id,'UTF8')),'hex')=${literal(s.workspaceSha256)}
    AND d.status IN ('planned','queued','preflight','database_preparing','migrating','infrastructure_provisioning','waiting_healthy','configuring','verifying')
    AND d.plan_hash=${literal(scope.planHash)} AND d.configuration_hash=${literal(scope.configurationHash)} AND d.artifact_ref=${literal(version.artifactRef)}${heldVersion}
    AND j.status='running' AND j.job_type='apply' AND j.attempts=1 AND j.max_attempts=1 AND j.completed_at IS NULL
    AND j.lease_owner=${literal(FIRST_OPEN_MIDDLE_WORKER)} AND j.lease_token=p_lease
  FOR UPDATE OF j,d;
  scoped_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF db_lease_deadline IS NULL OR db_lease_deadline<=scoped_now OR db_lease_deadline>${scope.writeBefore}
    OR scoped_now<${scope.window.startAt} OR scoped_now>=${scope.writeBefore}
  THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_LEASE'; END IF;
  IF EXISTS (SELECT 1 FROM public.deployment_tenant_resources r WHERE r.app_instance_id=${literal(s.instanceId)}
      AND (r.generation<>1 OR r.owner_deployment_id<>${literal(s.deploymentId)} OR r.created_by_deployment_id<>${literal(s.deploymentId)}
        OR r.stable_identity_hash<>${literal(s.stableIdentity)} OR r.ownership_marker<>${literal(FIRST_OPEN_RESOURCE_MARKER)}
        OR r.lifecycle_status IN ('reopening','destroying','destroyed','failed') OR coalesce(r.external_operation_epoch,1)<>1))
    OR EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations o WHERE o.app_instance_id=${literal(s.instanceId)}
      AND (o.generation<>1 OR o.epoch<>1 OR o.intent<>'provision' OR o.operation_hash<>${literal(op)}
        OR o.marker<>${literal(FIRST_OPEN_EPOCH_MARKER)} OR o.owner_deployment_id<>${literal(s.deploymentId)} OR o.created_by_job_id<>${literal(s.jobId)}
        OR o.created_by_attempt<>1 OR o.state NOT IN ('pending_external','active')))
  THEN RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_FENCE'; END IF;
  CASE p_op
${body}
  ELSE RAISE EXCEPTION 'FIRST_OPEN_MIDDLE_OPERATION';
  END CASE;
END $first_open_middle$;
ALTER FUNCTION ${schema}.run(text,text,text,jsonb) OWNER TO ${roles.definer};
REVOKE ALL ON FUNCTION ${schema}.run(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ${schema}.run(text,text,text,jsonb) TO ${roles.runner};
COMMIT;`;
}
