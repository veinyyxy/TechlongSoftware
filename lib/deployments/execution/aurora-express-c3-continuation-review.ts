import db from './aurora-database-contract-v2.cjs';
import continuation from './aurora-express-continuation-v4.cjs';
import { prepareC3Review, type SqlProgramIdentity } from './aurora-express-c3-review.ts';
import type { DiagnosticFacts, ExistingExpressBinding } from './aurora-express-c2-diagnostic-review.ts';
export const c3dAttemptSlot = 'techlong-d002-express-c3-reserved-continuation-v4.permanent-slot.json';
export const c3dInspectSlot = 'techlong-d002-express-c3-reserved-continuation-v4-inspect.permanent-slot.json';
interface ContinuationInput { bootstrapInput: { target: unknown; scope: unknown; nonce: string }; predecessor: typeof continuation.PREDECESSOR }
interface ContinuationSqlIdentity extends SqlProgramIdentity { rolePolicySha256: string; continuationProgramSha256: string }
export function prepareContinuationReview(input: { facts: DiagnosticFacts; expectedBinding: ExistingExpressBinding;
  continuationInput: ContinuationInput; sqlProgram: ContinuationSqlIdentity; codeBindingSha256: string; historySha256: string }, now: number) {
  const program = continuation.compileContinuationV4(input.continuationInput);
  const { rolePolicySha256, continuationProgramSha256, ...sqlBase } = input.sqlProgram;
  // Use the old pure checks only as validation; its old executable scope is NOT
  // reused. New schema/program, eight remaining statements and two new slots.
  prepareC3Review({ ...input, candidateInput: input.continuationInput.bootstrapInput, sqlProgram: sqlBase }, now);
  if (rolePolicySha256 !== continuation.digest(continuation.POLICY) || continuationProgramSha256 !== continuation.digest(program) ||
    db.digest(sqlBase) !== '84948cfc92b85e6004429f1c19ffb02ed8ef887e44794bedc0c50001396a5431')
    throw Error('EXPRESS_C3D_PROGRAM_REJECTED');
  const body = { schema:'techlong/express-reserved-continuation-review/v4',preparedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+6*3600000).toISOString(),facts:input.facts,expectedBinding:input.expectedBinding,
    continuationInput:input.continuationInput,continuationProgramSha256:continuation.digest(program),
    rolePolicySha256,sqlProgram:input.sqlProgram,sqlProgramSha256:db.digest(input.sqlProgram),
    codeBindingSha256:input.codeBindingSha256,historySha256:input.historySha256,
    expectedManagementDatabaseOid:'5',expectedManagementRoleOid:'16410',attemptSlot:c3dAttemptSlot,independentInspectSlot:c3dInspectSlot,
    limits:{maximumRunSqlConnections:3,maximumIndependentInspectSqlConnections:2,runMetadataCallsMaximum:18,inspectMetadataCallsMaximum:9,
      connectTimeoutMs:30000,transportGroupDeadlineMs:120000,temporaryCredentialsMinimumRemainingMs:300000,
      remainingPrepareStatementsIncludingTransactionControl:8,newRoles:0,newMemberships:0,guardRoleDeletions:1,
      restoreAndMigrateTransactions:1,tables:73,migrationSeedRows:9,awsResourceWrites:0,iamWrites:0,secretValueReads:0,
      loginChanges:0,applicationGrants:0,automaticRetries:0},
    risks:[
      'Existing Source is an administrator, not app/Fargate/runtime least-privilege authority. No new IAM is installed.',
      'Reuse only exact existing NOLOGIN app OID16456 and guard OID16457 with nonce/ownership and the diagnostic catalog pin. No role recreation or app ADMIN grant.',
      'One CREATE DATABASE and a separate promotion transaction precede one restore/migration transaction. Failure can leave a guard-owned disconnected database, promoted empty database or committed schema/seeds.',
      'Promotion deletes only the exact existing guard OID16457 after ownership transfer. This role cannot be restored with the same OID; no automatic compensation.',
      'Lost responses, journal or metadata failures require inspection, not replay/down/delete/fill/reset. Both new independent slots are permanent even on a failed attempt.',
      'Cooperative lock, catalog/OID checks and before/after AWS metadata are not cross-service CAS; concurrent privileged administrators can race.',
      'Connections/DDL may resume the retained cluster and incur ACU/storage/I/O costs; 50 USD/month is a target, not a hard cap. No automatic cleanup schedule.',
      'IAM tokens remain in memory; JS/driver erasure is best effort, and AWS/database/provider logs can expose connection/SQL metadata.',
      'Only the trusted pinned 73-table schema and two fixed migrations/nine seeds are installed. PG17 catalog digest is observation, not an automatically learned ready pin.',
      '512 MiB is a tenant gate, not proof of cluster/free-plan capacity. Other database PUBLIC CONNECT is unchanged; app remains NOLOGIN, runtime/Secret-v2/IAM/merchant/activation remain disabled.',
      'Failure Inspect reads only exact management catalog, not full schema or commit state. Success Inspect is a separate read-only schema verification, not runtime compatibility.'
    ],runtimeEnabled:false,lifecycleCompatible:false,executionAuthorized:false};
  return Object.freeze({...structuredClone(body),manifestSha256:db.digest(body)});
}
export type ContinuationReview = ReturnType<typeof prepareContinuationReview>;
export function assertContinuationApproval(r:ContinuationReview,approvedSha:string,codeSha:string,now:number) {
  const {manifestSha256,...body}=r;
  if (!/^[a-f0-9]{64}$/.test(approvedSha || '') || approvedSha!==manifestSha256 || db.digest(body)!==manifestSha256 ||
    r.codeBindingSha256!==codeSha || !Number.isFinite(now) || !Number.isFinite(Date.parse(r.preparedAt)) ||
    !Number.isFinite(Date.parse(r.expiresAt)) || now<Date.parse(r.preparedAt) || now>=Date.parse(r.expiresAt))
    throw Error('EXPRESS_C3D_FRESH_APPROVAL_REQUIRED');
  const expected=prepareContinuationReview({facts:r.facts,expectedBinding:r.expectedBinding,continuationInput:r.continuationInput,
    sqlProgram:r.sqlProgram,codeBindingSha256:codeSha,historySha256:r.historySha256},Date.parse(r.preparedAt));
  if (db.canonicalJson(expected)!==db.canonicalJson(r)) throw Error('EXPRESS_C3D_SCOPE_DRIFT');
}
