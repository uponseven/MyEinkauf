import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median, updateHistory, typicalOfferPrice, summarizeOpenPrices, normalPrice, WINDOW_DAYS,
} from '../js/pricing.js';
import { chainFor } from '../js/markets.js';

const now = new Date('2026-10-14T08:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 864e5).toISOString().slice(0, 10);
const bavaria = { id: 'p1', name: 'Bavaria Blu', brand: 'Bergader', packageSize: '175g' };

test('Median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('Preisgedächtnis: nur 6 Monate, keine Doppelten', () => {
  const old = [
    { date: daysAgo(WINDOW_DAYS + 10), productId: 'p1', offerId: 1 },
    { date: daysAgo(30), productId: 'p1', offerId: 2 },
  ];
  const matches = [
    { productId: 'p1', offerId: 2, validFrom: `${daysAgo(30)}T00:00:00Z` },
    { productId: 'p1', offerId: 3, validFrom: `${daysAgo(1)}T22:00:00Z`, price: 2.29 },
  ];
  const result = updateHistory(old, matches, now);
  assert.deepEqual(result.map((e) => e.offerId), [2, 3]);
});

test('typischer Angebotspreis über den Grundpreis, abgelehnte zählen nicht', () => {
  const history = [
    { date: daysAgo(60), productId: 'p1', key: 'a', price: 3.33, referencePrice: 11.1, unit: 'kg', volume: 0.3 },
    { date: daysAgo(30), productId: 'p1', key: 'b', price: 1.99, referencePrice: 11.37, unit: 'kg', volume: 0.175 },
    { date: daysAgo(10), productId: 'p1', key: 'c', price: 0.99, referencePrice: 5.66, unit: 'kg', volume: 0.175 },
    { date: daysAgo(WINDOW_DAYS + 5), productId: 'p1', key: 'd', price: 0.5, referencePrice: 2.86, unit: 'kg', volume: 0.175 },
  ];
  const t = typicalOfferPrice(bavaria, history, { c: 'no' }, now);
  // 11,10 €/kg × 0,175 = 1,94 und 11,37 × 0,175 = 1,99 → Median 1,97
  assert.deepEqual(t, { value: 1.97, count: 2 });
});

test('Open Prices: Aktionspreise nur mit Normalpreis, Kette erkannt, 6-Monats-Fenster', () => {
  const s = summarizeOpenPrices([
    { price: 2.69, date: daysAgo(90), currency: 'EUR', location: { osm_brand: 'Rewe', osm_name: 'REWE' } },
    { price: 2.89, date: daysAgo(20), currency: 'EUR', location: {} },
    { price: 1.99, price_is_discounted: true, price_without_discount: 2.79, date: daysAgo(5), location: { osm_name: 'Kaufland' } },
    { price: 1.69, price_is_discounted: true, price_without_discount: null, date: daysAgo(5) },
    { price: 1.49, date: daysAgo(WINDOW_DAYS + 30) },
  ], chainFor, now);
  assert.equal(s.count, 3);
  assert.equal(s.median, 2.79);
  assert.deepEqual(s.byChain, { rewe: { median: 2.69, count: 1 }, kaufland: { median: 2.79, count: 1 } });
});

test('Normalpreis: eigene Angabe > Open Prices (Kette) > Schätzung > Schmerzgrenze', () => {
  const prices = { products: { p1: { median: 2.5, count: 4, byChain: { penny: { median: 2.29, count: 2 } } } } };
  const history = [{ date: daysAgo(3), productId: 'p1', key: 'x', price: 1.6, referencePrice: 9.14, unit: 'kg', volume: 0.175 }];
  assert.equal(normalPrice({ ...bavaria, usualPrice: 2.79 }, { prices }).source, 'own');
  assert.equal(normalPrice(bavaria, { prices, chain: 'penny' }).value, 2.29);
  assert.equal(normalPrice(bavaria, { prices, chain: 'rewe' }).value, 2.5);
  const est = normalPrice(bavaria, { history });
  assert.equal(est.source, 'estimate');
  assert.equal(est.value, 2); // 1,60 / 0,8
  assert.equal(normalPrice({ ...bavaria, priceLimit: 2.49 }, {}).source, 'limit');
  assert.equal(normalPrice(bavaria, {}), null);
});
