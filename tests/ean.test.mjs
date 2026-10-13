import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEan, normalizeEan } from '../js/ean.js';

test('gültige EAN-13, EAN-8 und UPC-A', () => {
  assert.ok(isValidEan('3017620422003'));
  assert.ok(isValidEan('4006381333931'));
  assert.ok(isValidEan('96385074'));
  assert.ok(isValidEan('036000291452'));
});

test('falsche Prüfziffer oder Länge', () => {
  assert.ok(!isValidEan('3017620422004'));
  assert.ok(!isValidEan('123'));
  assert.ok(!isValidEan(''));
});

test('Leerzeichen und Bindestriche werden entfernt', () => {
  assert.equal(normalizeEan(' 3017620 422003 '), '3017620422003');
  assert.ok(isValidEan('4-006381-333931'));
});
