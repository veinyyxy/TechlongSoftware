import assert from 'node:assert/strict';
import test from 'node:test';
import { sameInstallationCatalog } from '../ops/releases/installation-catalog-comparison.mjs';

const providerGrant = { role: 'release_owner', member: 'installer', grantor: 'managed_provider', admin_option: true, inherit_option: false, set_option: false };
const installerGrant = { ...providerGrant, grantor: 'installer', admin_option: false };
const catalog = () => ({
  installer: [{ user: 'installer', read_only: 'on' }],
  candidateRoles: [{ name: 'release_owner', login: false }],
  memberships: [structuredClone(providerGrant), structuredClone(installerGrant)],
  schemas: [{ name: 'release', acl: 'synthetic-original-acl' }],
  tables: [{ name: 'requests', owner: 'release_owner' }],
  functions: [{ name: 'first', definition_sha256: 'a' }, { name: 'second', definition_sha256: 'b' }],
  triggers: [], rowPolicies: [], defaultPrivileges: [], databasePrivileges: [], installerMembership: [],
});

test('same role/member with two distinct grantors can return in either order', () => {
  const expected = catalog(), actual = catalog();
  actual.memberships.reverse();
  assert.notDeepEqual(actual, expected);
  assert.equal(sameInstallationCatalog(actual, expected), true);
});

for (const [field, changed] of Object.entries({ role: 'another_role', member: 'another_member', grantor: 'another_grantor', admin_option: false, inherit_option: true, set_option: true })) {
  test(`a changed ${field} is still rejected even when rows are reordered`, () => {
    const expected = catalog(), actual = catalog();
    actual.memberships[0][field] = changed;
    actual.memberships.reverse();
    assert.equal(sameInstallationCatalog(actual, expected), false);
  });
}

test('missing and additional membership rows are rejected', () => {
  const expected = catalog(), missing = catalog(), extra = catalog();
  missing.memberships.pop();
  extra.memberships.push(structuredClone(providerGrant));
  assert.equal(sameInstallationCatalog(missing, expected), false);
  assert.equal(sameInstallationCatalog(extra, expected), false);
});

test('duplicate counts are preserved rather than collapsed into a Set', () => {
  const expected = catalog(), wrongCounts = catalog(), reordered = catalog();
  expected.memberships.push(structuredClone(providerGrant));
  wrongCounts.memberships.push(structuredClone(installerGrant));
  reordered.memberships.unshift(structuredClone(providerGrant));
  assert.equal(sameInstallationCatalog(wrongCounts, expected), false);
  assert.equal(sameInstallationCatalog(reordered, expected), true);
});

test('missing flags, changed types and extra unknown fields are not ignored', () => {
  const expected = catalog(), missing = catalog(), changedType = catalog(), extraField = catalog();
  delete missing.memberships[0].set_option;
  changedType.memberships[0].set_option = 'false';
  extraField.memberships[0].unexpected_grant_option = true;
  for (const actual of [missing, changedType, extraField]) assert.equal(sameInstallationCatalog(actual, expected), false);
});

test('other catalog categories and their array order keep the exact original comparison', () => {
  const expected = catalog(), changedAcl = catalog(), reorderedFunctions = catalog();
  changedAcl.schemas[0].acl = 'changed';
  reorderedFunctions.functions.reverse();
  assert.equal(sameInstallationCatalog(changedAcl, expected), false);
  assert.equal(sameInstallationCatalog(reorderedFunctions, expected), false);
});

test('neither input nor the baseline is modified and object property order stays insignificant', () => {
  const expected = catalog(), actual = catalog();
  actual.memberships.reverse();
  actual.memberships[0] = Object.fromEntries(Object.entries(actual.memberships[0]).reverse());
  const originalExpected = structuredClone(expected), originalActual = structuredClone(actual);
  assert.equal(sameInstallationCatalog(actual, expected), true);
  assert.deepEqual(expected, originalExpected);
  assert.deepEqual(actual, originalActual);
});

test('a missing category is not silently converted into an empty membership array', () => {
  assert.equal(sameInstallationCatalog({}, { memberships: [] }), false);
  assert.equal(sameInstallationCatalog({ memberships: null }, { memberships: [] }), false);
});
