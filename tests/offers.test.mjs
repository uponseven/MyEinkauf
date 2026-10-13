import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainForRetailer, matchScore, matchOffers, decisionKey, parseReweBonus, simplifyOffer,
  searchTermFor, parsePackageSize, sizeDiffers,
} from '../js/offers.js';

const bavaria = { id: 'p1', brand: 'Bergader', name: 'Bavaria Blu', packageSize: '175g' };
const alpro = { id: 'p2', brand: 'alpro', name: 'Danone ALPRO® Joghurt Soja Natur ungesüßt', packageSize: '400 g' };
const feta = { id: 'p3', brand: 'REWE Bio', name: 'Feta', packageSize: '200g' };

const offer = (o) => ({ offerId: 1, chain: 'penny', validTo: '2099-01-01T00:00:00Z', ...o });

test('Händler werden Ketten zugeordnet', () => {
  assert.equal(chainForRetailer('rewe-center'), 'rewe');
  assert.equal(chainForRetailer('penny'), 'penny');
  assert.equal(chainForRetailer('netto-marken-discount'), 'netto');
  assert.equal(chainForRetailer('edeka-foodservice'), null);
  assert.equal(chainForRetailer('edeka'), 'edeka');
  assert.equal(chainForRetailer('globus'), null);
});

test('passende Angebote werden erkannt', () => {
  assert.equal(matchScore(bavaria, offer({ brand: 'Bergader', title: 'Bavaria Blu', description: 'Je 300 g' })), 1);
  assert.equal(matchScore(alpro, offer({ brand: 'Alpro', title: 'Joghurtalternative Soja Natur', description: 'ungesüßt, je 400-g-Becher' })) >= 0.5, true);
});

test('unpassende Angebote werden verworfen', () => {
  // gleiche Marke, anderes Produkt
  assert.equal(matchScore(alpro, offer({ brand: 'Alpro', title: 'Haferdrink Barista', description: 'oder Sojadrink ohne Zucker je 1-l-Pckg.' })), 0);
  assert.equal(matchScore(feta, offer({ brand: 'Rewe Bio', title: 'Bio Zitronen', description: 'je 500-g-Netz' })), 0);
  // gleiches Wort, andere Marke
  assert.equal(matchScore(feta, offer({ brand: 'Salakis', title: 'Feta', description: 'je 150 g' })), 0);
});

test('eigener Suchbegriff gewinnt', () => {
  const p = { ...feta, searchTerm: 'Hirtenkäse' };
  assert.equal(searchTermFor(p), 'Hirtenkäse');
  assert.equal(matchScore(p, offer({ brand: 'Gazi', title: 'Hirtenkäse', description: '' })), 1);
  assert.equal(searchTermFor(bavaria), 'Bergader');
});

test('Treffer filtern nach Kette und Gültigkeit', () => {
  const offers = [
    offer({ offerId: 1, brand: 'Bergader', title: 'Bavaria Blu', chain: 'penny' }),
    offer({ offerId: 2, brand: 'Bergader', title: 'Bavaria Blu', chain: 'aldi' }),
    offer({ offerId: 3, brand: 'Bergader', title: 'Bavaria Blu', validTo: '2020-01-01T00:00:00Z' }),
  ];
  const matches = matchOffers([bavaria], offers, { chains: ['penny', 'rewe'] });
  assert.deepEqual(matches.map((m) => m.offerId), [1]);
  assert.equal(matches[0].key, decisionKey('p1', offers[0]));
});

test('Entscheidung gilt auch für das gleiche Angebot nächste Woche', () => {
  const a = { brand: 'Bergader', title: 'Bavaria Blu', offerId: 1 };
  const b = { brand: 'BERGADER', title: 'Bavaria Blu®', offerId: 99 };
  assert.equal(decisionKey('p1', a), decisionKey('p1', b));
});

test('REWE Bonus und Angebotsdaten', () => {
  assert.equal(parseReweBonus('HINWEIS: MIT APP 0,10 € REWE BONUS oder Sojadrink'), 0.1);
  assert.equal(parseReweBonus('je 500 g'), null);
  const o = simplifyOffer({
    id: 5, price: 1.49, referencePrice: 1.49, volume: 1, unit: { shortName: 'l' },
    advertisers: [{ uniqueName: 'rewe', name: 'REWE' }], brand: { name: 'Alpro' }, product: { name: 'Haferdrink' },
    description: 'MIT APP 0,10 € REWE BONUS', validityDates: [{ from: 'a', to: 'b' }], images: { count: 1 },
  });
  assert.equal(o.chain, 'rewe');
  assert.equal(o.reweBonus, 0.1);
  assert.match(o.image, /offers\/5\/images/);
});

test('Packungsgrößen vergleichen', () => {
  assert.deepEqual(parsePackageSize('175g'), { amount: 0.175, unit: 'kg' });
  assert.deepEqual(parsePackageSize('1,5 l'), { amount: 1.5, unit: 'l' });
  assert.equal(parsePackageSize('6 Stück'), null);
  assert.equal(sizeDiffers(bavaria, { volume: 0.3, unit: 'kg' }), true);
  assert.equal(sizeDiffers(bavaria, { volume: 0.175, unit: 'kg' }), false);
});
