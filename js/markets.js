// Supermarkt-Filialen aus OpenStreetMap: Ketten, Abruf, Öffnungszeiten, Entfernungen.
// Die Funktionen ohne Datenbankzugriff laufen auch in Node (Tests, Aktualisierungsskript).

import { getSetting, saveSetting } from './db.js';

// Reihenfolge = Reihenfolge der Filter. default: beim ersten Start ausgewählt.
export const CHAINS = [
  { key: 'rewe', name: 'REWE', label: 'R', color: '#cc071e', match: /^rewe\b/i, default: true },
  { key: 'kaufland', name: 'Kaufland', label: 'K', color: '#7b2d8e', match: /^kaufland\b/i, default: true },
  { key: 'penny', name: 'Penny', label: 'P', color: '#f07d00', match: /^penny\b/i, default: true },
  { key: 'lidl', name: 'Lidl', label: 'L', color: '#f5c400', text: '#1d2420', match: /^lidl\b/i, default: true },
  { key: 'konsum', name: 'Konsum', label: 'Ko', color: '#00843d', match: /^konsum\b/i, default: true },
  { key: 'edeka', name: 'Edeka', label: 'E', color: '#003f87', match: /^(edeka|e[ -]?center)\b/i, default: true },
  { key: 'dm', name: 'dm', label: 'dm', color: '#d6006e', match: /^dm\b/i, default: true },
  { key: 'aldi', name: 'Aldi', label: 'A', color: '#00a0e0', match: /^aldi\b/i },
  { key: 'netto', name: 'Netto', label: 'N', color: '#ffd200', text: '#1d2420', match: /^netto\b/i },
  { key: 'norma', name: 'Norma', label: 'No', color: '#e30613', match: /^norma\b/i },
  { key: 'rossmann', name: 'Rossmann', label: 'Ro', color: '#c3002f', match: /^rossmann\b/i },
];

export const CHAIN_BY_KEY = Object.fromEntries(CHAINS.map((c) => [c.key, c]));
export const DEFAULT_CHAINS = CHAINS.filter((c) => c.default).map((c) => c.key);

export const CITY = 'Leipzig';
export const CITY_CENTER = [51.3397, 12.3731];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export const OVERPASS_QUERY = `[out:json][timeout:60];
area["name"="${CITY}"]["boundary"="administrative"]["admin_level"="6"]->.a;
(nwr["shop"="supermarket"](area.a);nwr["shop"="chemist"](area.a););
out center tags;`;

// ---------- Umwandlung der OSM-Daten ----------

export function chainFor(tags = {}) {
  const candidates = [tags.brand, tags.name, tags.operator].filter(Boolean);
  for (const chain of CHAINS) {
    if (candidates.some((v) => chain.match.test(v.trim()))) return chain.key;
  }
  return null;
}

/** Wandelt die Overpass-Antwort in eine kompakte Liste bekannter Ketten um. */
export function parseOverpass(json) {
  const markets = [];
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const chain = chainFor(tags);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!chain || lat == null || lon == null) continue;
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
    const place = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
    markets.push({
      id: `${el.type}/${el.id}`,
      chain,
      name: tags.name || CHAIN_BY_KEY[chain].name,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      address: [street, place].filter(Boolean).join(', '),
      openingHours: tags.opening_hours || '',
    });
  }
  return markets.sort((a, b) => a.chain.localeCompare(b.chain) || a.name.localeCompare(b.name, 'de'));
}

export async function fetchMarketsLive() {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
        });
        if (res.status === 429 || res.status === 504) {
          lastError = new Error('OpenStreetMap-Server ist überlastet');
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (!res.ok) throw new Error(`OpenStreetMap: HTTP ${res.status}`);
        const markets = parseOverpass(await res.json());
        if (markets.length) return markets;
        lastError = new Error('OpenStreetMap lieferte keine Märkte');
        break;
      } catch (err) {
        lastError = err instanceof TypeError ? new Error('Keine Verbindung zu OpenStreetMap') : err;
        break;
      }
    }
  }
  throw lastError;
}

// ---------- Öffnungszeiten ----------

const DAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Öffnungszeiten lesbar auf Deutsch, eine Regel pro Zeile. */
export function formatOpeningHours(raw) {
  if (!raw) return '';
  return raw
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => rule
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => DAYS_DE[DAYS_EN.indexOf(d)])
      .replace(/\bPH\b/g, 'Feiertag')
      .replace(/\boff\b|\bclosed\b/g, 'geschlossen')
      .replace(/(\d\d:\d\d)-(\d\d:\d\d)/g, '$1–$2'))
    .join('\n');
}

function parseDays(spec) {
  const days = new Set();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) return null;
    const from = DAYS_EN.indexOf(m[1]);
    const to = m[2] ? DAYS_EN.indexOf(m[2]) : from;
    for (let i = from; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === to) break;
    }
  }
  return days;
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Öffnungszeiten-Plan pro Wochentag (0 = Montag) als Liste von [von, bis] in Minuten.
 * Versteht die üblichen Supermarkt-Angaben wie „Mo-Sa 07:00-22:00; Su,PH off“.
 * Gibt null zurück, wenn die Angabe zu speziell ist.
 */
export function parseOpeningHours(raw) {
  if (!raw) return null;
  if (raw.trim() === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]]);
  const week = Array.from({ length: 7 }, () => []);
  // "Mo-Sa 09:00-20:00, Su off": Komma nach einer Zeit trennt ebenfalls Regeln.
  const rules = raw.replace(/(\d\d:\d\d|off|closed)\s*,\s*(?=[A-Z][a-z])/g, '$1;').split(';');
  for (let rule of rules) {
    rule = rule.trim();
    // Leere Regeln und einzelne Datumsausnahmen ("2026 Sep 09: off") überspringen.
    if (!rule || /^\d{4}\b/.test(rule)) continue;
    // Feiertagsregeln ignorieren, "PH" aus gemischten Tageslisten entfernen.
    rule = rule.replace(/,\s*PH\b|\bPH\s*,/g, '');
    if (/^PH\b/.test(rule)) continue;
    const m = rule.match(/^([A-Za-z,\- ]+?)\s+(off|closed|\d\d:\d\d-\d\d:\d\d(?:\s*,\s*\d\d:\d\d-\d\d:\d\d)*)$/);
    if (!m) return null;
    const days = parseDays(m[1].replace(/\s/g, ''));
    if (!days) return null;
    const ranges = /off|closed/.test(m[2])
      ? []
      : m[2].split(',').map((r) => r.trim().split('-').map(toMinutes));
    // Spätere Regeln überschreiben frühere (wie in OSM üblich).
    for (const d of days) week[d] = ranges;
  }
  return week;
}

/**
 * Status zum Zeitpunkt `date`: { open: true, until: '22:00' } | { open: false, next: 'Mo 07:00' } | null
 */
export function openingStatus(raw, date = new Date()) {
  const week = parseOpeningHours(raw);
  if (!week) return null;
  const day = (date.getDay() + 6) % 7;
  const now = date.getHours() * 60 + date.getMinutes();
  const fmt = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  for (const [from, to] of week[day]) {
    if (now >= from && now < to) return { open: true, until: fmt(to) };
  }
  for (let offset = 0; offset < 7; offset++) {
    const d = (day + offset) % 7;
    const next = week[d]
      .map(([from]) => from)
      .filter((from) => offset > 0 || from > now)
      .sort((a, b) => a - b)[0];
    if (next != null) return { open: false, next: `${offset === 0 ? 'heute' : offset === 1 ? 'morgen' : DAYS_DE[d]} ${fmt(next)}` };
  }
  return { open: false, next: null };
}

// ---------- Entfernung ----------

/** Luftlinie in Kilometern. */
export function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

// ---------- Gespeicherte Daten ----------

// Schnappschuss im Repository, damit die Karte auch ohne OSM-Server sofort funktioniert.
const SNAPSHOT_URL = new URL('../data/maerkte-leipzig.json', import.meta.url);

/** Märkte aus dem lokalen Zwischenspeicher, sonst aus dem mitgelieferten Schnappschuss. */
export async function loadMarkets() {
  const cache = await getSetting('markets-cache');
  if (cache?.markets?.length) return cache;
  const res = await fetch(SNAPSHOT_URL);
  const snapshot = await res.json();
  return { markets: snapshot.markets, loadedAt: snapshot.loadedAt, source: 'snapshot' };
}

export async function refreshMarkets() {
  const markets = await fetchMarketsLive();
  const cache = { key: 'markets-cache', markets, loadedAt: new Date().toISOString(), source: 'live' };
  await saveSetting(cache);
  return cache;
}

// Abgeglichene Einstellungen: Lieblingsfilialen, gewählte Ketten, Zuhause.
export async function getFavoriteMarkets() {
  return new Set((await getSetting('favoriteMarkets'))?.ids || []);
}

export function saveFavoriteMarkets(ids) {
  return saveSetting({ key: 'favoriteMarkets', ids: [...ids], updatedAt: new Date().toISOString() });
}

export async function getSelectedChains() {
  const list = (await getSetting('chains'))?.list;
  return new Set(Array.isArray(list) ? list : DEFAULT_CHAINS);
}

export function saveSelectedChains(keys) {
  return saveSetting({ key: 'chains', list: [...keys], updatedAt: new Date().toISOString() });
}

export async function getHome() {
  const home = await getSetting('home');
  return home?.lat != null ? { lat: home.lat, lon: home.lon } : null;
}

export function saveHome(position) {
  return saveSetting({
    key: 'home',
    lat: position ? Math.round(position.lat * 1e4) / 1e4 : null,
    lon: position ? Math.round(position.lon * 1e4) / 1e4 : null,
    updatedAt: new Date().toISOString(),
  });
}
