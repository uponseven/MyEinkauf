import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBringList, bringKey, suggestProducts, resolveItems } from '../js/bring.js';

const products = [
  { id: 'feta', name: 'Feta', brand: 'REWE Bio', category: 'Käse' },
  { id: 'blu', name: 'Bavaria Blu', brand: 'Bergader', category: 'Käse' },
  { id: 'joghurt', name: 'Danone ALPRO® Joghurt Soja Natur ungesüßt', brand: 'alpro', category: 'Pflanzlich' },
  { id: 'tofu', name: 'Tofu Natur', brand: 'Taifun', category: 'Pflanzlich' },
  { id: 'weg', name: 'Alt', deleted: true },
];

test('Bring!-Antworten in beiden Formen', () => {
  assert.deepEqual(parseBringList({ purchase: [{ name: 'Käse', specification: 'Feta' }] }),
    [{ name: 'Käse', specification: 'Feta', uuid: null }]);
  assert.deepEqual(parseBringList({ items: { purchase: [{ itemId: 'Joghurt', specification: '', uuid: 'u1' }, { itemId: '' }] } }),
    [{ name: 'Joghurt', specification: '', uuid: 'u1' }]);
  assert.deepEqual(parseBringList({}), []);
});

test('Vorschläge: Name, Beschreibung, Kategorie', () => {
  assert.equal(suggestProducts({ name: 'Feta' }, products)[0].product.id, 'feta');
  assert.equal(suggestProducts({ name: 'Joghurt' }, products)[0].product.id, 'joghurt');
  assert.equal(suggestProducts({ name: 'Tofu' }, products)[0].product.id, 'tofu');
  // „Käse“ passt über die Kategorie zu beiden Käsesorten
  assert.deepEqual(suggestProducts({ name: 'Käse' }, products).map((s) => s.product.id).sort(), ['blu', 'feta']);
  // Beschreibung entscheidet
  assert.equal(suggestProducts({ name: 'Käse', specification: 'Bavaria Blu' }, products)[0].product.id, 'blu');
  assert.deepEqual(suggestProducts({ name: 'Zahnpasta' }, products), []);
});

test('Zuordnungen auflösen', () => {
  const items = [{ name: 'Feta' }, { name: 'Brot' }, { name: 'Käse' }, { name: 'Milch' }];
  const mapping = { [bringKey('Feta')]: 'feta', [bringKey('Brot')]: 'none', [bringKey('Milch')]: 'geloescht' };
  assert.deepEqual(resolveItems(items, mapping, products).map((i) => i.status), ['mapped', 'none', 'open', 'open']);
  assert.equal(bringKey('Käse '), bringKey('käse'));
});

test('Zuordnung mit Beschreibung gilt nur für genau diese Kombination', () => {
  const mapping = { [bringKey('Käse', 'Bavaria Blu')]: 'blu', [bringKey('Joghurt')]: 'joghurt' };
  const items = [
    { name: 'Käse', specification: 'Bavaria Blu' },
    { name: 'Käse' },
    { name: 'Joghurt', specification: '2x' }, // fällt auf die Zuordnung für den Namen zurück
  ];
  assert.deepEqual(resolveItems(items, mapping, products).map((i) => i.productId), ['blu', null, 'joghurt']);
});
