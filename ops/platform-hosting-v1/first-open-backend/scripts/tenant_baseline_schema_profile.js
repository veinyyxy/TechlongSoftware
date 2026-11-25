const { createHash } = require('node:crypto');
const { stripPythonWhitespace } = require('./tenant_baseline_text.js');

// Executable objects of the reviewed empty SpeedFeast baseline. Approval
// still requires the independent archive and manifest digests.
const PROFILE = 'speedfeast-empty-schema/2026-10-05/v1';
const PROGRAMS = Object.freeze({
  'EXTENSION uuid-ossp': `CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;`,
  'FUNCTION public.default_saas_instance_id()': `CREATE FUNCTION public.default_saas_instance_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT instance_id
  FROM public.saas_instances
  WHERE singleton_key = TRUE
  LIMIT 1
$$;`,
  'FUNCTION public.default_store_id()': `CREATE FUNCTION public.default_store_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT store_id
  FROM public.stores
  ORDER BY
    (status = 'active' AND is_default = TRUE) DESC,
    (status = 'active') DESC,
    is_default DESC,
    created_at,
    store_id
  LIMIT 1
$$;`,
  'FUNCTION public.refresh_cart_subtotal(uuid)': `CREATE FUNCTION public.refresh_cart_subtotal(target_cart_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE public.cart
  SET subtotal_snapshot = COALESCE((
    SELECT SUM(line_subtotal)
    FROM public.cartitem
    WHERE cart_id = target_cart_id
  ), 0)
  WHERE cart_id = target_cart_id;
END;
$$;`,
  'FUNCTION public.refresh_cart_subtotal_trigger()': `CREATE FUNCTION public.refresh_cart_subtotal_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_cart_subtotal(OLD.cart_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_cart_subtotal(NEW.cart_id);
  IF TG_OP = 'UPDATE' AND OLD.cart_id <> NEW.cart_id THEN
    PERFORM public.refresh_cart_subtotal(OLD.cart_id);
  END IF;
  RETURN NEW;
END;
$$;`,
  'FUNCTION public.set_updated_at()': `CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;`,
  'TRIGGER public.cart.trg_cart_set_updated_at': 'CREATE TRIGGER trg_cart_set_updated_at BEFORE UPDATE ON public.cart FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
  'TRIGGER public.cartitem.trg_cartitem_refresh_cart_subtotal': 'CREATE TRIGGER trg_cartitem_refresh_cart_subtotal AFTER INSERT OR DELETE OR UPDATE ON public.cartitem FOR EACH ROW EXECUTE FUNCTION public.refresh_cart_subtotal_trigger();',
  'TRIGGER public.cartitem.trg_cartitem_set_updated_at': 'CREATE TRIGGER trg_cartitem_set_updated_at BEFORE UPDATE ON public.cartitem FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
  'TRIGGER public.system_config.trg_system_config_set_updated_at': 'CREATE TRIGGER trg_system_config_set_updated_at BEFORE UPDATE ON public.system_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
});

const REQUIRED_TABLES = Object.freeze(['cart', 'cartitem', 'system_config', 'stores', 'saas_instances']);
// Python re.MULTILINE only treats LF as a line break for ^ and .
const HEADER = /(?:^|(?<=\n))--\n-- Name: ([^\n]+?); Type: ([^\n]+?); Schema: ([^\n]+?); Owner: -\n--\n/g;
const TABLE_SETTINGS = "SET default_tablespace = '';\n\nSET default_table_access_method = heap;";

/** Compare complete executable object blocks before any SQL is used. */
function validateProgramSql(sql) {
  if (typeof sql !== 'string' || !sql.isWellFormed() || Buffer.byteLength(sql, 'utf8') > 8_000_000 || sql.includes('\x00')) {
    throw new Error('Profile requires bounded offline schema SQL');
  }

  const normalized = sql.replaceAll('\r\n', '\n');
  const headers = Array.from(normalized.matchAll(HEADER));
  const observed = {};
  for (const [index, header] of headers.entries()) {
    const [matched, name, descriptor, schema] = header;
    let key;
    if (descriptor === 'EXTENSION') key = schema === '-' ? `EXTENSION ${name}` : 'invalid extension schema';
    else if (descriptor === 'FUNCTION') key = `FUNCTION ${schema}.${name}`;
    else if (descriptor === 'TRIGGER') key = `TRIGGER ${schema}.${name.replaceAll(' ', '.')}`;
    else continue;

    if (!Object.hasOwn(PROGRAMS, key) || Object.hasOwn(observed, key)) {
      throw new Error('Profile SQL contains an unknown or duplicate executable object');
    }
    const end = headers[index + 1]?.index ?? normalized.length;
    let definition = stripPythonWhitespace(normalized.slice(header.index + matched.length, end));
    // Only pg_restore's exact two table defaults may follow a reviewed function.
    if (descriptor === 'FUNCTION' && definition.endsWith(TABLE_SETTINGS)) {
      definition = stripPythonWhitespace(definition.slice(0, -TABLE_SETTINGS.length));
    }
    if (definition !== PROGRAMS[key]) throw new Error('Profile executable definition differs from reviewed code');
    observed[key] = createHash('sha256').update(definition, 'utf8').digest('hex');
  }
  if (Object.keys(observed).length !== Object.keys(PROGRAMS).length) throw new Error('Profile SQL is missing required executable objects');
  return observed;
}

/** Verify installed extension, invoker functions and enabled triggers. */
function renderProfileVerificationSql() {
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const statements = [
    'DO $speedfeast_verify_profile$\nBEGIN\n',
    "  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='uuid-ossp' AND e.extversion='1.1' AND n.nspname='public') THEN\n",
    "    RAISE EXCEPTION 'Schema profile extension mismatch';\n  END IF;\n",
  ];
  for (const [key, definition] of Object.entries(PROGRAMS)) {
    if (key.startsWith('FUNCTION ')) {
      const [name, args] = key.slice('FUNCTION public.'.length, -1).split('(');
      const body = definition.slice(definition.indexOf('AS $$') + 'AS $$'.length, -'$$;'.length);
      const language = definition.includes('LANGUAGE sql') ? 'sql' : 'plpgsql';
      const volatility = definition.includes('LANGUAGE sql STABLE') ? 's' : 'v';
      const [, returns] = /RETURNS (\w+)/.exec(definition);
      statements.push(
        '  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang\n',
        `    WHERE n.nspname='public' AND p.proname=${literal(name)} AND pg_catalog.oidvectortypes(p.proargtypes)=${literal(args)}\n`,
        `    AND p.prorettype='pg_catalog.${returns}'::pg_catalog.regtype AND p.prosrc=${literal(body)} AND l.lanname=${literal(language)} AND p.provolatile=${literal(volatility)}\n`,
        '    AND NOT p.prosecdef AND p.proconfig IS NULL) THEN\n',
        "    RAISE EXCEPTION 'Schema profile function mismatch';\n  END IF;\n",
      );
    } else if (key.startsWith('TRIGGER ')) {
      const [schema, table, name] = key.slice('TRIGGER '.length).split('.');
      const [, targetFunction] = /EXECUTE FUNCTION public\.(\w+)\(\)/.exec(definition);
      // PostgreSQL tgtype flags: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16.
      const triggerType = definition.includes('BEFORE UPDATE') ? 19 : 29;
      statements.push(
        '  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace\n',
        `    WHERE n.nspname=${literal(schema)} AND c.relname=${literal(table)} AND t.tgname=${literal(name)} AND t.tgtype=${triggerType}\n`,
        `    AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgnargs=0 AND pn.nspname='public' AND p.proname=${literal(targetFunction)}) THEN\n`,
        "    RAISE EXCEPTION 'Schema profile trigger mismatch';\n  END IF;\n",
      );
    }
  }
  statements.push('END\n$speedfeast_verify_profile$;\n');
  return statements.join('');
}

module.exports = { PROFILE, PROGRAMS, REQUIRED_TABLES, validateProgramSql, renderProfileVerificationSql };
