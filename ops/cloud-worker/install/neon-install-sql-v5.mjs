// Pure SQL/password-verifier compiler; never opens a connection.
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';
import { loadNeonContractV5, renderNeonContractV5, NEON_V5 as C } from '../neon-contract-v5.mjs';
const must = (v, code) => { if (!v) throw Error(code); };
export function scramVerifierV5(password, salt = randomBytes(16)) {
  must(/^[a-f0-9]{96}$/.test(password) && Buffer.isBuffer(salt) && salt.length === 16, 'INSTALL_RANDOM_PASSWORD_SHAPE');
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256'), mac = label => createHmac('sha256', salted).update(label).digest();
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${createHash('sha256').update(mac('Client Key')).digest('base64')}:${mac('Server Key').toString('base64')}`;
}
const postcondition = `DO $install$
DECLARE w oid; o oid;
BEGIN
 SELECT oid INTO STRICT w FROM pg_roles WHERE rolname='techlong_cloud_worker_v5';
 SELECT oid INTO STRICT o FROM pg_roles WHERE rolname=current_user;
 IF w=o OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=w AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND
   NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls) OR
   EXISTS(SELECT 1 FROM pg_auth_members WHERE member=w) OR has_database_privilege(w,current_database(),'CREATE') OR
   EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(w,n.oid,'CREATE')) OR
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND
     (has_table_privilege(w,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(w,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) OR
   EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND
     n.nspname NOT IN ('pg_catalog','information_schema','techlong_cloud_worker_v5') AND has_function_privilege(w,p.oid,'EXECUTE')) OR
   (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='techlong_cloud_worker_v5')<>4 OR
   EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='techlong_cloud_worker_v5' AND
     (p.proowner<>o OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] OR
       (SELECT count(*) FROM aclexplode(p.proacl))<>2 OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE
         a.grantee NOT IN (o,w) OR a.grantor<>o OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))
 THEN RAISE EXCEPTION 'CLOUD_WORKER_INSTALL_POSTCONDITION_REJECTED'; END IF;
END; $install$`;
export async function neonInstallStatementsV5(verifier) {
  must(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/.test(verifier), 'INSTALL_SCRAM_VERIFIER');
  return [`SET LOCAL lock_timeout='5s'`, `SET LOCAL statement_timeout='30s'`,
    `CREATE ROLE ${C.role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`,
    ...renderNeonContractV5(await loadNeonContractV5()).statements, postcondition];
}
export async function neonInstallRecipeV5() {
  // A public syntactically valid placeholder is replaced only in memory; it
  // can never authenticate because no password is derived from this verifier.
  const placeholder = 'SCRAM-SHA-256$4096:' + 'A'.repeat(22) + '==$' + 'A'.repeat(43) + '=:' + 'A'.repeat(43) + '=';
  return (await neonInstallStatementsV5(placeholder)).map(s => s.replace(placeholder, '<GENERATED_48_BYTE_RANDOM_PASSWORD_SCRAM_VERIFIER>'));
}
