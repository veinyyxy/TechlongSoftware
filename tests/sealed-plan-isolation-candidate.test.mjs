import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const sql = await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql", import.meta.url), "utf8");
test("sealed candidate is not registered in the automatic migration catalog and does not rewrite business rows", async () => {
  const catalog = await readdir(new URL("../db/postgres-migrations/", import.meta.url));
  assert(!catalog.some(name => /sealed|isolation|0011/.test(name)));
  assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE|DROP\s+(?:TRIGGER|FUNCTION|TABLE)|DISABLE\s+TRIGGER/i);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:app_instance_deployments|app_instances|subscriptions)\b/i);
  assert.match(sql, /dep_d00144511731f1c20991aa56/);
  assert.match(sql, /REVOKE ALL ON public\.deployment_plan_only_isolation_fences/);
});
test("candidate covers execution/event/epoch references and fences stale snapshots with a changed row", () => {
  for (const table of ["deployment_jobs", "deployment_step_runs", "deployment_cleanup_schedules", "deployment_environment_capacity_reservations",
    "deployment_tenant_resources", "deployment_tenant_resource_events", "deployment_tenant_external_operations",
    "deployment_tenant_external_operation_events", "deployment_tenant_cleanup_runs"]) {
    assert(sql.includes(`ARRAY['${table}'`), `missing reference guard ${table}`);
  }
  assert.match(sql, /SET revision=revision\+1/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /ENABLE ALWAYS TRIGGER/);
  assert.match(sql, /NEW\.protection_schema_sha256 IS DISTINCT FROM public\.sealed_plan_protection_hash_v1\(\)/);
});
test("catalog fingerprint closes foreign-schema FKs and table/constraint/trigger changes; verifier stays local only", async () => {
  assert.match(sql, /n\.nspname\|\|'\.'\|\|c\.relname/);
  assert.match(sql, /'columns'/); assert.match(sql, /'constraints'/); assert.match(sql, /'allTriggers'/);
  assert.match(sql, /a\.attcollation/); assert.match(sql, /pg_get_functiondef\(t\.tgfoid\)/);
  const verifier=await readFile(new URL("../ops/aws-sandbox/scripts/verify-f3b3-sealed-plan-pg16.mjs",import.meta.url),"utf8");
  assert.match(verifier,/withIsolatedPg16/); assert.doesNotMatch(verifier,/process\.env\.DATABASE_URL|GetSecretValueCommand|@neondatabase\/serverless/);
});
