import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, DEFAULT_CATEGORIES } from '../js/categories.js';

test('Zuordnung aus OFF-Kategorien', () => {
  assert.equal(guessCategory(['en:beverages', 'en:coffees', 'en:ground-coffees']), 'Kaffee & Tee');
  assert.equal(guessCategory(['en:dairies', 'en:cheeses']), 'Käse');
  assert.equal(guessCategory([], 'Open Beauty Facts'), 'Drogerie & Körperpflege');
  assert.equal(guessCategory(['en:unknown']), '');
});

test('alle Regeln zeigen auf bekannte Kategorien', () => {
  for (const tags of [['en:beers'], ['en:pastas'], ['en:frozen-foods'], ['en:chocolates']]) {
    assert.ok(DEFAULT_CATEGORIES.includes(guessCategory(tags)), tags.join());
  }
});

test('pflanzliche Produkte gehen in eine eigene Kategorie, falls vorhanden', () => {
  const tofu = ['en:plant-based-foods', 'en:meat-alternatives', 'en:tofu'];
  const oatDrink = ['en:beverages', 'en:dairy-substitutes', 'en:plant-milks', 'en:oat-based-drinks'];
  const withSoja = [...DEFAULT_CATEGORIES, 'Soja'];
  assert.equal(guessCategory(tofu, '', withSoja), 'Soja');
  assert.equal(guessCategory(oatDrink, '', withSoja), 'Soja');
  // Ohne eigene Kategorie greifen die normalen Regeln.
  assert.equal(guessCategory(oatDrink), 'Getränke');
});

test('gelöschte Kategorien werden nicht vorgeschlagen', () => {
  const withoutCoffee = DEFAULT_CATEGORIES.filter((c) => c !== 'Kaffee & Tee');
  assert.equal(guessCategory(['en:coffees'], '', withoutCoffee), '');
});
