import { isDeepStrictEqual } from 'node:util';

// Match the existing object-key comparison; array order is significant by default.
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

function comparable(catalog) {
  if (!catalog || !Array.isArray(catalog.memberships)) return canonical(catalog);
  // Sort complete records, not just role/member. Never discard grantor, flags,
  // unknown fields or repeated records, and never mutate the saved baseline.
  const memberships = catalog.memberships.map(canonical).map(row => ({ row, key: JSON.stringify(row) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(value => value.row);
  return canonical({ ...catalog, memberships });
}

export const sameInstallationCatalog = (actual, expected) => isDeepStrictEqual(comparable(actual), comparable(expected));
