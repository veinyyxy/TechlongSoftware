import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { compileExpressFirstClaimProgramV1 } from '../../../lib/deployments/execution/express-first-claim-program-v1.ts';
import { sha256Hex } from '../../../lib/deployments/execution/hash.ts';
// Explicit planning-only entry. No ANALYZE, no private bundle, no AWS SDK,
// and no way to submit the compiled INSERTs without the EXPLAIN wrapper.
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--plan' || !/^F:\/ChatGPT_workshop\/techlong-express-c5f-[a-z0-9-]+\/plan\.json$/.test(args[1])) throw Error('EXPLAIN_INPUT_REJECTED');
  const plan = JSON.parse(await readFile(args[1], 'utf8'));
  const business = JSON.parse(await readFile('F:/ChatGPT_workshop/techlong-d001-business-review-20261013-r3/manifest.json', 'utf8'));
  const program = await compileExpressFirstClaimProgramV1({ plan, configuration: business.material.configuration,
    environmentPolicy: plan.environmentPolicy, now: Date.now(), leaseToken: 'lease_' + '0'.repeat(32) });
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) throw Error('EXPLAIN_NEON_SOURCE_REJECTED');
  const sql = neon(url.toString(), { fullResults: true }), signal = AbortSignal.timeout(60000);
  const result = await sql.transaction(program.queries.map(q => sql.query('EXPLAIN (FORMAT JSON, ANALYZE FALSE) ' + q.text, q.values)),
    { isolationLevel: 'Serializable', readOnly: true, fullResults: true, fetchOptions: { signal } });
  console.log(JSON.stringify({ outcome: 'FIRST_CLAIM_STATEMENTS_PLANNED_NOT_EXECUTED', at: new Date().toISOString(),
    queryKeys: program.queries.map(q => q.key), explainStatements: result.length, explainPlansSha256: await sha256Hex(result.map(r => r.rows)),
    proposedInsertedRows: program.insertedRows, actualInsertedRows: 0, readOnly: true, analyze: false, locksAcquiredForApplication: false,
    jobCreated: false, epochActivated: false, privateReads: 0, awsCalls: 0, readyVerified: false }));
} catch { console.error('EXPRESS_FIRST_CLAIM_EXPLAIN_FAILED_NO_WRITE'); process.exitCode = 1; }
