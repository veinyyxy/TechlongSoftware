import assert from 'node:assert/strict';
import test from 'node:test';
import { sameInstallationInstant } from '../ops/releases/installation-time-comparison.mjs';

test('SDK Date and CLI ISO keep nonzero milliseconds without mutating the Date', () => {
  for (const milliseconds of ['307', '255', '260']) {
    const expected = `2025-01-02T03:04:05.${milliseconds}000+00:00`, actual = new Date(expected);
    const before = actual.getTime();
    assert.notEqual(Date.parse(actual), Date.parse(expected));
    assert.equal(sameInstallationInstant(actual, expected), true);
    assert.equal(sameInstallationInstant(expected, actual), true);
    assert.equal(actual.getTime(), before);
  }
});

test('one millisecond or one second of real change is rejected, never rounded', () => {
  const expected = '2025-01-02T03:04:05.307Z';
  for (const delta of [-1000, -1, 1, 1000]) {
    const actual = new Date(Date.parse(expected) + delta);
    assert.equal(sameInstallationInstant(actual, expected), false);
    assert.equal(sameInstallationInstant(actual.toISOString(), expected), false);
  }
});

test('valid Date/Date, ISO/ISO and equivalent timezone representations compare', () => {
  const utc = '2025-01-02T03:04:05.307Z', offset = '2025-01-01T21:04:05.307-06:00';
  assert.equal(sameInstallationInstant(new Date(utc), new Date(offset)), true);
  assert.equal(sameInstallationInstant(utc, offset), true);
  assert.equal(sameInstallationInstant(utc, utc), true);
  assert.equal(sameInstallationInstant(new Date('2025-01-02T03:04:05Z'), '2025-01-02T03:04:05.000Z'), true);
});

test('invalid or absent values never compare equal or coerce to an instant', () => {
  const valid = '2025-01-02T03:04:05.307Z';
  for (const invalid of [new Date(Number.NaN), '', 'invalid', undefined, null, {}, 0]) {
    assert.equal(sameInstallationInstant(invalid, valid), false);
    assert.equal(sameInstallationInstant(valid, invalid), false);
    assert.equal(sameInstallationInstant(invalid, invalid), false);
  }
});
