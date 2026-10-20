import { neon, neonConfig } from '@neondatabase/serverless';
import { ControlError, digest, must, obj } from './contract.ts';
import type { ControlLedger, LedgerEntry } from './controller.ts';
import { assertControllerDatabaseUrlV6, assertControllerNeonTransportV6 } from './configuration.ts';

export function createNeonControlLedger(urlBinding: () => unknown): ControlLedger {
  // Lazy and dedicated credential only. No DATABASE_URL or owner-role fallback.
  async function call(name: string, values: unknown[] = []) {
    const binding = urlBinding(); must(typeof binding === 'string' && binding.length < 4096,'CONTROL_DATABASE_BINDING',503);
    try {await assertControllerDatabaseUrlV6(binding);} catch {throw new ControlError('CONTROL_DATABASE_BINDING',503);}
    try {
      // Do not inherit/reset a global probe fetch guard or alternate endpoint.
      assertControllerNeonTransportV6(new URL(binding).hostname,{fetchFunction:neonConfig.fetchFunction,fetchEndpoint:neonConfig.fetchEndpoint});
      const sql = neon(binding);
      const result = await sql.query(`SELECT deployment_control_v6.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) AS value`, values,
        {fetchOptions:{signal:AbortSignal.timeout(15000),redirect:'error'}});
      return result[0]?.value;
    } catch { throw new ControlError('CONTROL_LEDGER_REQUIRES_READBACK',503); }
  }
  return {
    async load(sha) { must(digest(sha),'CONTROL_PLAN_SHA'); const value = obj(await call('load_plan',[sha]));
      must(value.plan && value.planSha256 === sha,'CONTROL_PLAN_MISSING'); return value as unknown as LedgerEntry; },
    async begin(sha,action,risk,admin) { await call('begin_dispatch',[sha,action,risk,admin]); },
    async assertLive(sha) { await call('assert_live',[sha]); },
    async acknowledge(sha,ack) { await call('acknowledge',[sha,ack.runId]); },
    async unknown(sha) { await call('mark_unknown',[sha]); },
    async observe(sha,o) { await call('observe_run',[sha,o.runId,o.status,o.conclusion]); },
    async status() { const value = await call('status'); must(Array.isArray(value) && value.length <= 12,'CONTROL_STATUS_UNAVAILABLE',503); return value; },
  };
}
