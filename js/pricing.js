// Preise: Preisgedächtnis der Angebote, Normalpreise aus Open Prices, Normalpreis-Schätzung.
// Reine Funktionen: laufen in der App und im Abruf-Skript (GitHub Actions).
// Es zählen nur die letzten 6 Monate, damit Preissteigerungen schnell durchschlagen.

import { parsePackageSize } from './offers.js';

export const WINDOW_DAYS = 183;
// Angebote liegen meist 20–40 % unter dem Normalpreis; für die Schätzung angenommen: 20 % Rabatt.
const ASSUMED_DISCOUNT = 0.2;

const DAY = 24 * 60 * 60 * 1000;

export function windowStart(now = new Date()) {
  return new Date(now.getTime() - WINDOW_DAYS * DAY);
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 100) / 100;
}

// ---------- Preisgedächtnis (angebote/historie.json) ----------

/**
 * Nimmt neue Treffer ins Preisgedächtnis auf und wirft alles außerhalb des Zeitfensters raus.
 * Ein Angebot, das mehrere Tage gefunden wird, steht nur einmal drin.
 */
export function updateHistory(entries = [], matches = [], now = new Date()) {
  const start = windowStart(now);
  const kept = entries.filter((e) => new Date(e.date) >= start);
  const seen = new Set(kept.map((e) => `${e.productId}|${e.offerId}`));
  const today = now.toISOString().slice(0, 10);
  for (const m of matches) {
    const id = `${m.productId}|${m.offerId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push({
      date: (m.validFrom || today).slice(0, 10),
      productId: m.productId,
      offerId: m.offerId,
      key: m.key,
      chain: m.chain,
      price: m.price,
      referencePrice: m.referencePrice,
      unit: m.unit,
      volume: m.volume,
    });
  }
  return kept.sort((a, b) => a.date.localeCompare(b.date));
}

/** Preis eines Eintrags auf die Katalog-Packung umgerechnet (über den Grundpreis), sonst null. */
function packPrice(entry, product) {
  const own = parsePackageSize(product.packageSize);
  if (own && entry.referencePrice != null && entry.unit === own.unit) {
    return Math.round(entry.referencePrice * own.amount * 100) / 100;
  }
  if (!own || !entry.volume) return entry.price; // Größe unbekannt: Preis wie angegeben
  return null;
}

/** Typischer Angebotspreis (Median) der letzten 6 Monate; abgelehnte Treffer zählen nicht. */
export function typicalOfferPrice(product, history = [], decisions = {}, now = new Date()) {
  const start = windowStart(now);
  const prices = history
    .filter((e) => e.productId === product.id && decisions[e.key] !== 'no' && new Date(e.date) >= start)
    .map((e) => packPrice(e, product));
  const value = median(prices);
  return value == null ? null : { value, count: prices.filter((p) => p != null).length };
}

// ---------- Open Prices (angebote/preise.json) ----------

/**
 * Fasst Open-Prices-Einträge eines Produkts zusammen: Median gesamt und je Kette.
 * Aktionspreise zählen mit ihrem Normalpreis (price_without_discount), sonst gar nicht.
 * @param chainFor  Funktion, die einem OSM-Ort eine Kette zuordnet (aus markets.js)
 */
export function summarizeOpenPrices(items = [], chainFor = () => null, now = new Date()) {
  const start = windowStart(now);
  const rows = [];
  for (const item of items) {
    if (item.currency && item.currency !== 'EUR') continue;
    if (!item.date || new Date(item.date) < start) continue;
    const price = item.price_is_discounted ? item.price_without_discount : item.price;
    if (!Number.isFinite(price)) continue;
    const loc = item.location || {};
    rows.push({ price, date: item.date, chain: chainFor({ brand: loc.osm_brand, name: loc.osm_name }) });
  }
  if (!rows.length) return null;
  const byChain = {};
  for (const r of rows) {
    if (!r.chain) continue;
    (byChain[r.chain] ??= []).push(r.price);
  }
  return {
    median: median(rows.map((r) => r.price)),
    count: rows.length,
    latest: rows.map((r) => r.date).sort().at(-1),
    byChain: Object.fromEntries(Object.entries(byChain).map(([c, list]) => [c, { median: median(list), count: list.length }])),
  };
}

// ---------- Normalpreis ----------

/**
 * Bester verfügbarer Normalpreis einer Packung, in dieser Reihenfolge:
 * eigener üblicher Preis → Open Prices (gleiche Kette bevorzugt) → geschätzt aus
 * Angeboten → Schmerzgrenze. Gibt null zurück, wenn nichts bekannt ist.
 */
export function normalPrice(product, { prices, history, decisions, chain } = {}) {
  if (Number.isFinite(product.usualPrice)) {
    return { value: product.usualPrice, source: 'own', label: 'dein üblicher Preis' };
  }
  const op = prices?.products?.[product.id];
  if (op) {
    const sameChain = chain && op.byChain?.[chain];
    if (sameChain) {
      return { value: sameChain.median, source: 'openprices', label: `Open Prices, ${sameChain.count}× bei dieser Kette` };
    }
    return { value: op.median, source: 'openprices', label: `Open Prices, ${op.count} Preis${op.count === 1 ? '' : 'e'}` };
  }
  const typical = typicalOfferPrice(product, history, decisions);
  if (typical) {
    return {
      value: Math.round((typical.value / (1 - ASSUMED_DISCOUNT)) * 100) / 100,
      source: 'estimate',
      label: 'geschätzt aus Angeboten',
    };
  }
  if (Number.isFinite(product.priceLimit)) {
    return { value: product.priceLimit, source: 'limit', label: 'Schmerzgrenze' };
  }
  return null;
}
