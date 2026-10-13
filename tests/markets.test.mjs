import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainFor, parseOverpass, parseOpeningHours, openingStatus, formatOpeningHours, distanceKm, formatDistance,
} from '../js/markets.js';

test('Ketten werden aus brand/name erkannt', () => {
  assert.equal(chainFor({ brand: 'Rewe', name: 'REWE City' }), 'rewe');
  assert.equal(chainFor({ brand: 'Konsum Leipzig' }), 'konsum');
  assert.equal(chainFor({ name: 'dm-drogerie markt' }), 'dm');
  assert.equal(chainFor({ brand: 'EDEKA' }), 'edeka');
  assert.equal(chainFor({ name: 'E center' }), 'edeka');
  assert.equal(chainFor({ brand: 'Netto Marken-Discount' }), 'netto');
  assert.equal(chainFor({ name: 'Biomare Plagwitz' }), null);
  assert.equal(chainFor({ name: 'Pennymarkt' }), null);
});

test('Overpass-Antwort wird umgewandelt', () => {
  const markets = parseOverpass({
    elements: [
      { type: 'node', id: 1, lat: 51.3, lon: 12.3, tags: { shop: 'supermarket', brand: 'Lidl', 'addr:street': 'Hauptstraße', 'addr:housenumber': '5', 'addr:postcode': '04109', 'addr:city': 'Leipzig', opening_hours: 'Mo-Sa 07:00-22:00' } },
      { type: 'way', id: 2, center: { lat: 51.31, lon: 12.31 }, tags: { shop: 'supermarket', name: 'Kaufland' } },
      { type: 'node', id: 3, lat: 51.32, lon: 12.32, tags: { shop: 'supermarket', name: 'Bioladen' } },
    ],
  });
  assert.equal(markets.length, 2);
  const lidl = markets.find((m) => m.chain === 'lidl');
  assert.equal(lidl.id, 'node/1');
  assert.equal(lidl.address, 'Hauptstraße 5, 04109 Leipzig');
  assert.equal(markets.find((m) => m.chain === 'kaufland').id, 'way/2');
});

test('Öffnungszeiten verstehen', () => {
  const week = parseOpeningHours('Mo-Fr 07:00-21:00; Sa 07:00-20:00; Su,PH off');
  assert.deepEqual(week[0], [[420, 1260]]);
  assert.deepEqual(week[5], [[420, 1200]]);
  assert.deepEqual(week[6], []);
  assert.deepEqual(parseOpeningHours('Mo-Sa 09:00-20:00, Su off')[6], []);
  assert.deepEqual(parseOpeningHours('Mo-Sa 09:00-20:00; 2026 Sep 09: off "Renovierung"')[0], [[540, 1200]]);
  assert.equal(parseOpeningHours('sunrise-sunset'), null);
});

test('geöffnet oder geschlossen', () => {
  const hours = 'Mo-Sa 07:00-22:00; Su off';
  // 13.10.2026 ist ein Dienstag.
  assert.deepEqual(openingStatus(hours, new Date(2026, 9, 13, 12, 0)), { open: true, until: '22:00' });
  assert.deepEqual(openingStatus(hours, new Date(2026, 9, 13, 6, 30)), { open: false, next: 'heute 07:00' });
  assert.deepEqual(openingStatus(hours, new Date(2026, 9, 13, 22, 30)), { open: false, next: 'morgen 07:00' });
  // Samstagabend -> Montag
  assert.deepEqual(openingStatus(hours, new Date(2026, 9, 17, 23, 0)), { open: false, next: 'Mo 07:00' });
  assert.equal(openingStatus(''), null);
});

test('Formatierung', () => {
  assert.equal(formatOpeningHours('Mo-Sa 07:00-22:00; Su,PH off'), 'Mo-Sa 07:00–22:00\nSo,Feiertag geschlossen');
  const km = distanceKm({ lat: 51.3397, lon: 12.3731 }, { lat: 51.3455, lon: 12.3810 });
  assert.ok(km > 0.7 && km < 0.9, String(km));
  assert.equal(formatDistance(0.834), '830 m');
  assert.equal(formatDistance(2.345), '2,3 km');
});
