/** OID/owner-independent exact schema inventory for the sealed 0009/0010 suffix. */
export interface CompensationSchemaClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export const COMPENSATION_TABLES = Object.freeze([
  "shared_cell_author_compensation_operations", "shared_cell_author_compensation_review_windows",
  "shared_cell_author_compensation_phase_attempts", "shared_cell_author_compensation_events",
  "shared_cell_author_compensation_lifecycle_actions",
]);
const relationFilter = "n.nspname = 'public' AND c.relname ~ '(^scac_|^shared_cell_author_compensation_)'";
export const COMPENSATION_SCHEMA_QUERIES = Object.freeze({
  objects: `SELECT kind, name FROM (
    SELECT 'relation'::text AS kind, c.relname::text AS name FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE ${relationFilter}
    UNION ALL SELECT 'function', p.proname::text FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname ~ '(^scac_|_scac_|^shared_cell_author_compensation_)'
    UNION ALL SELECT 'trigger', t.tgname::text FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname ~ '(^scac_|^shared_cell_author_compensation_)'
    UNION ALL SELECT 'constraint', k.conname::text FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_namespace n ON n.oid = k.connamespace
      WHERE n.nspname = 'public' AND k.conname ~ '(^scac_|^shared_cell_author_compensation_)'
      AND k.contype IN ('c','p','u','f','t')
  ) inventory ORDER BY kind, name`,
  relations: `SELECT c.relname AS name, c.relkind::text AS kind, c.relpersistence::text AS persistence,
    c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE ${relationFilter} ORDER BY c.relname`,
  columns: `SELECT c.relname AS relation, a.attname AS name, a.attnum::integer AS position,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
    a.attidentity::text AS identity, a.attgenerated::text AS generated,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid, false) AS default_expression
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE ${relationFilter} AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`,
  constraints: `SELECT c.relname AS relation, k.conname AS name, k.contype::text AS type,
    k.convalidated AS validated, k.condeferrable AS deferrable, k.condeferred AS initially_deferred,
    pg_catalog.pg_get_constraintdef(k.oid, false) AS definition
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE ${relationFilter} AND k.contype IN ('c','p','u','f','t')
    ORDER BY c.relname, k.conname`,
  indexes: `SELECT c.relname AS relation, i.relname AS name, x.indisvalid AS valid,
    x.indisready AS ready, x.indisunique AS unique, x.indisprimary AS primary,
    pg_catalog.pg_get_indexdef(i.oid, 0, false) AS definition
    FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid = x.indrelid
    JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE ${relationFilter} ORDER BY c.relname, i.relname`,
  triggers: `SELECT c.relname AS relation, t.tgname AS name, t.tgenabled::text AS enabled,
    pg_catalog.pg_get_triggerdef(t.oid, false) AS definition
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE ${relationFilter} AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`,
  functions: `SELECT p.proname AS name, pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_catalog.pg_get_function_result(p.oid) AS result, l.lanname AS language,
    replace(p.prosrc, chr(13), '') AS source, p.prosecdef AS security_definer, p.proconfig AS config,
    p.provolatile::text AS volatility, p.proisstrict AS strict, p.prokind::text AS kind,
    p.proparallel::text AS parallel
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.proname ~ '(^scac_|_scac_|^shared_cell_author_compensation_)'
    ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)`,
});
export const EMPTY_COMPENSATION_SCHEMA = Object.freeze(Object.fromEntries(
  Object.keys(COMPENSATION_SCHEMA_QUERIES).map((key) => [key, Object.freeze([])]),
));
export async function readCompensationSchema(client: CompensationSchemaClient) {
  const result: Record<string, readonly Record<string, unknown>[]> = {};
  for (const [key, sql] of Object.entries(COMPENSATION_SCHEMA_QUERIES)) result[key] = (await client.query(sql)).rows;
  return result;
}
