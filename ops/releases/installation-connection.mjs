// Installation-only connection compatibility. No I/O, credentials or execution entry.
export function installationConnectionOptions(connectionString, applicationName) {
  const url = new URL(connectionString);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'channel_binding', 'options', 'lock_timeout', 'statement_timeout']) {
    url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    // These must not become PostgreSQL startup parameters, including via pg defaults.
    options: '',
    lock_timeout: false,
    statement_timeout: false,
    connectionTimeoutMillis: 10000,
    query_timeout: 20000,
    application_name: applicationName,
  };
}

const transactionTimeouts = "\nSET LOCAL lock_timeout = '1s';\nSET LOCAL statement_timeout = '15s';";

/** Preserve the transaction and SQL body; add timeout settings immediately after its
 * opening BEGIN. Covers the installer's three BEGIN forms and its self-contained SQL
 * file, not BEGIN inside a function/DO body. One input remains one query submission.
 * The returned text has a different SHA: future approval must bind that derived text.
 */
export function installationTransactionSql(text) {
  return text.replace(
    /^((?:--[^\n]*(?:\n|$)|\s)*BEGIN(?: ISOLATION LEVEL REPEATABLE READ READ ONLY| READ ONLY)?)(;|$)/i,
    (_, begin) => `${begin};${transactionTimeouts}`,
  );
}
