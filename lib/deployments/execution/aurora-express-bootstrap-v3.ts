import compiler from './aurora-express-bootstrap-v3.cjs';
import type { AuroraLifecycleScope } from './aurora-lifecycle-v2.ts';

export const FIRST_OPEN_MANAGEMENT_SQL_USER = 'sf_fc41597f_lifecycle';
export const FIRST_OPEN_MANAGEMENT_SCHEMA = 'first_open_fc41597f';
export const FIRST_OPEN_EXPRESS_ENDPOINT = 'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com';

export interface ExpressManagementTargetV3 {
  readonly schema: 'techlong/express-management-target/v3';
  readonly clusterArn: string; readonly clusterResourceId: string; readonly endpoint: string; readonly port: 5432;
  readonly observedEngineVersion: '17.9'; readonly managementDatabase: 'postgres';
  readonly managementUsername: 'postgres' | typeof FIRST_OPEN_MANAGEMENT_SQL_USER;
  readonly stableIdentity: string; readonly resourceGeneration: 1; readonly tenantDatabase: string; readonly tenantUsername: string;
}
/** Pre-Secret SQL review data, NOT a v2 runtime binding or executable manifest.
 * Exact real resource facts, fresh approval and a permanent attempt root remain
 * required. No synthetic Secret ARN or v2 activation is generated. */
export function parseExpressManagementTargetV3(raw: unknown): ExpressManagementTargetV3 {
  if (!raw || typeof raw !== 'object' || !('managementUsername' in raw) || raw.managementUsername !== FIRST_OPEN_MANAGEMENT_SQL_USER) {
    return compiler.parseManagementTargetV3(raw);
  }
  if (Object.getPrototypeOf(raw) !== Object.prototype) throw Error('FIRST_OPEN_RESTRICTED_MANAGEMENT_TARGET');
  const legacy: ExpressManagementTargetV3 = compiler.parseManagementTargetV3({ ...raw, managementUsername: 'postgres' });
  if (legacy.clusterArn !== 'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001' ||
    legacy.clusterResourceId !== 'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM' ||
    legacy.endpoint !== FIRST_OPEN_EXPRESS_ENDPOINT ||
    legacy.stableIdentity !== 'e9fdccd5d8c7685cb005f423e7a87fc5849163882f4e2f3ca066f2c51cd9e74a') {
    throw Error('FIRST_OPEN_RESTRICTED_MANAGEMENT_TARGET');
  }
  return Object.freeze({ ...legacy, managementUsername: FIRST_OPEN_MANAGEMENT_SQL_USER });
}
export function compileExpressBootstrapCandidateV3(input: {
  target: ExpressManagementTargetV3; scope: AuroraLifecycleScope; nonce: string;
}) {
  if (input.target.managementUsername !== FIRST_OPEN_MANAGEMENT_SQL_USER) return compiler.compileExpressBootstrapV3(input);
  // Keep the frozen legacy compiler and mirrored backend unchanged. Reuse
  // its strict scope/nonce/archive validation, not its administrator SQL.
  const target = parseExpressManagementTargetV3(input.target);
  const basis = compiler.compileExpressBootstrapV3({ ...input, target: { ...target, managementUsername: 'postgres' } });
  const targetSha256 = compiler.digest(target), { nonce } = input;
  const comments = Object.freeze(Object.fromEntries(['role', 'guard', 'database'].map(kind => [kind,
    compiler.canonical({ schema: 'techlong/express-bootstrap-owner/v3', kind, stableIdentity: target.stableIdentity,
      resourceGeneration: 1, targetSha256, nonce })])));
  const db = `"${target.tenantDatabase}"`;
  const literal = (value: string) => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
  const stages = Object.freeze([
    { name: 'reserve', statements: ['BEGIN', `SELECT ${FIRST_OPEN_MANAGEMENT_SCHEMA}.reserve_role(${literal(comments.role)})`, 'COMMIT'] },
    { name: 'quarantine', statements: [`CREATE DATABASE ${db} OWNER "${FIRST_OPEN_MANAGEMENT_SQL_USER}" TEMPLATE template0 ENCODING 'UTF8' ALLOW_CONNECTIONS false`] },
    { name: 'promote', statements: ['BEGIN', `REVOKE ALL ON DATABASE ${db} FROM PUBLIC`,
      `COMMENT ON DATABASE ${db} IS ${literal(comments.database)}`, `ALTER DATABASE ${db} ALLOW_CONNECTIONS true`, 'COMMIT'] },
  ].map(stage => Object.freeze({ ...stage, statements: Object.freeze(stage.statements) })));
  return Object.freeze({ ...basis, target, targetSha256, comments, stages,
    statementCount: stages.reduce((n, stage) => n + stage.statements.length, 0) });
}
export const expressBootstrapCandidateDigestV3 = (candidate: unknown): string => compiler.digest(candidate);
