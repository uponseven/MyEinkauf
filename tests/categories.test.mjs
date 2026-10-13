import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, CATEGORIES } from '../js/categories.js';

test('Zuordnung aus OFF-Kategorien', () => {
  assert.equal(guessCategory(['en:beverages', 'en:coffees', 'en:ground-coffees']), 'Kaffee & Tee');
  assert.equal(guessCategory(['en:dairies', 'en:cheeses']), 'Käse');
  assert.equal(guessCategory([], 'Open Beauty Facts'), 'Drogerie & Körperpflege');
  assert.equal(guessCategory(['en:unknown']), '');
});

test('alle Regeln zeigen auf bekannte Kategorien', async () => {
  for (const tags of [['en:beers'], ['en:pastas'], ['en:frozen-foods'], ['en:chocolates']]) {
    assert.ok(CATEGORIES.includes(guessCategory(tags)), tags.join());
  }
});
