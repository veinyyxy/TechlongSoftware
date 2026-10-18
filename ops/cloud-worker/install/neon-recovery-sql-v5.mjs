// Neon-specific recovery compiler. No connection or credential generation.
// Preserve the original verifier compiler/source and every consumed old slot.
import { neonInstallRecipeV5 } from './neon-install-sql-v5.mjs';
export const RECOVERY_PASSWORD_MARKER_V5 = '<GENERATED_48_BYTE_PASSWORD_VIA_TLS_NEON_SQL>';
export const RECOVERY_PROVIDER_SQL_V5 = `SELECT current_user AS actor,session_user AS session_actor,
 (SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS owner_oid,
 current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only,
 current_setting('neon.forward_ddl',true) AS forward_ddl,current_setting('password_encryption') AS password_encryption`;
const providerGuard = `DO $provider$ BEGIN
 IF current_setting('neon.forward_ddl',true) IS DISTINCT FROM 'on' OR
    current_setting('password_encryption') IS DISTINCT FROM 'scram-sha-256'
 THEN RAISE EXCEPTION 'RECOVERY_NEON_PROVIDER_SETTINGS_REJECTED'; END IF;
END; $provider$`;
export async function neonRecoveryRecipeV5() {
  const old = await neonInstallRecipeV5();
  if (old.length !== 19 || !old[2].includes("PASSWORD '<GENERATED_48_BYTE_RANDOM_PASSWORD_SCRAM_VERIFIER>'")) throw Error('RECOVERY_ORIGINAL_SQL_RECIPE_CHANGED');
  const statements = old.map(s => s.replace('<GENERATED_48_BYTE_RANDOM_PASSWORD_SCRAM_VERIFIER>', RECOVERY_PASSWORD_MARKER_V5));
  statements.splice(2, 0, providerGuard); return statements;
}
export async function neonRecoveryStatementsV5(password) {
  // Never accept prehashes, SQL syntax, apostrophes, URLs or caller SQL.
  if (typeof password !== 'string' || !/^[a-f0-9]{96}$/.test(password)) throw Error('RECOVERY_GENERATED_PASSWORD_REQUIRED');
  return (await neonRecoveryRecipeV5()).map(s => s.replace(RECOVERY_PASSWORD_MARKER_V5, password));
}
export function safeRecoveryFailureV5(error) {
  // No message/detail/query/stack/cause/DSN. Provider code alone is not a
  // unique-cause diagnosis and a thrown COMMIT is not a rollback certificate.
  const sqlState = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
  const rawStatus = error?.$metadata?.httpStatusCode ?? error?.status;
  const httpStatus = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
  const known = new Set(['NeonDbError','CredentialsProviderError','AccessDeniedException','ResourceExistsException','ResourceNotFoundException','AbortError','TimeoutError']);
  return { category: known.has(error?.name) ? error.name : 'LOCAL_OR_PROVIDER_FAILURE', sqlState, httpStatus,
    originalProviderTextSaved: false, uniqueCauseProved: false };
}
