// Holt aktuelle Angebote von Marktguru für die Produkte im Katalog und schreibt ins
// Daten-Repository:
//   angebote/aktuell.json   aktuelle Treffer
//   angebote/historie.json  Preisgedächtnis der Treffer (letzte 6 Monate)
//   angebote/preise.json    Normalpreise aus Open Prices (letzte 6 Monate)
// Läuft per GitHub Actions im Repo MyEinkauf-daten (siehe tools/angebote-workflow.yml),
// lokal zum Testen:
//
//   node tools/fetch-offers.mjs <pfad-zum-daten-repo> [--force]
//
// Marktguru ist eine inoffizielle Schnittstelle: nur privat und sparsam nutzen.
// Ohne --force wird nicht erneut abgefragt, wenn sich die Suchbegriffe nicht geändert
// haben und heute (deutsche Zeit) schon abgerufen wurde.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { searchTermFor, simplifyOffer, matchOffers } from '../js/offers.js';
import { distanceKm, chainFor, DEFAULT_CHAINS } from '../js/markets.js';
import { updateHistory, summarizeOpenPrices, windowStart, WINDOW_DAYS } from '../js/pricing.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const FALLBACK_ZIP = '04109';
const berlinDate = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 1)}\n`);
}

const [dataDir, ...flags] = process.argv.slice(2);
if (!dataDir) {
  console.error('Aufruf: node tools/fetch-offers.mjs <pfad-zum-daten-repo> [--force]');
  process.exit(1);
}
const force = flags.includes('--force');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Die Web-Schlüssel stehen öffentlich in der Marktguru-Startseite.
async function marktguruKeys() {
  const res = await fetch('https://www.marktguru.de/', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Marktguru-Startseite: HTTP ${res.status}`);
  const html = await res.text();
  const apiKey = html.match(/"apiKey":"([^"]+)"/)?.[1];
  const clientKey = html.match(/"clientKey":"([^"]+)"/)?.[1];
  if (!apiKey || !clientKey) throw new Error('Marktguru-Schlüssel nicht gefunden (Seite geändert?)');
  return { apiKey, clientKey };
}

async function searchOffers(keys, term, zipCode) {
  const url = new URL('https://api.marktguru.de/api/v1/offers/search');
  url.search = new URLSearchParams({ as: 'web', q: term, zipCode, limit: '100', offset: '0' });
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'x-apikey': keys.apiKey,
      'x-clientkey': keys.clientKey,
      Origin: 'https://www.marktguru.de',
      Referer: 'https://www.marktguru.de/',
    },
  });
  if (!res.ok) throw new Error(`Suche „${term}“: HTTP ${res.status}`);
  return (await res.json()).results || [];
}

// PLZ der Filiale, die dem Zuhause am nächsten liegt.
async function zipCodeFor(home) {
  if (home?.lat == null) return FALLBACK_ZIP;
  const snapshot = await readJson(new URL('../data/maerkte-leipzig.json', import.meta.url));
  let best = null;
  for (const m of snapshot?.markets || []) {
    const zip = m.address.match(/\b(\d{5})\b/)?.[1];
    if (!zip) continue;
    const km = distanceKm(home, m);
    if (!best || km < best.km) best = { zip, km };
  }
  return best?.zip || FALLBACK_ZIP;
}

// ---------- Direktlinks zur Händlerseite ----------

// "Bergader Bavaria Blu" → "bergader-bavaria-blu" (so baut penny.de seine Angebots-URLs)
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Penny-Angebote liegen unter /angebote/<rubrik>/<marke-produkt>. Die Rubrik steht nicht in den
// Marktguru-Daten, deshalb: aktuelle Rubriken von penny.de lesen und durchprobieren.
async function addPennyLinks(matches) {
  const penny = matches.filter((m) => m.chain === 'penny');
  if (!penny.length) return;
  let categories = [];
  try {
    const html = await (await fetch('https://www.penny.de/angebote', { headers: { 'User-Agent': UA } })).text();
    categories = [...new Set([...html.matchAll(/data-category-name="([a-z0-9-]+)"/g)].map((m) => m[1]))];
  } catch (err) {
    console.warn(`  Penny-Rubriken nicht lesbar: ${err.message}`);
    return;
  }
  const found = new Map();
  for (const m of penny) {
    const slugs = [...new Set([slugify(`${m.brand} ${m.title}`), slugify(m.title)])].filter(Boolean);
    const cacheKey = slugs.join('|');
    if (!found.has(cacheKey)) {
      let url = null;
      search: for (const slug of slugs) {
        for (const category of categories) {
          const candidate = `https://www.penny.de/angebote/${category}/${slug}`;
          const res = await fetch(candidate, { method: 'HEAD', headers: { 'User-Agent': UA } }).catch(() => null);
          if (res?.ok) {
            url = candidate;
            break search;
          }
          await sleep(150);
        }
      }
      found.set(cacheKey, url);
      console.log(`  Penny-Link ${slugs[0]}: ${url || 'nicht gefunden'}`);
    }
    if (found.get(cacheKey)) m.retailerUrl = found.get(cacheKey);
  }
}

// ---------- Ablauf ----------

const catalog = await readJson(path.join(dataDir, 'katalog/produkte.json'));
if (!catalog) {
  console.log('Noch kein Katalog im Daten-Repository – nichts zu tun.');
  process.exit(0);
}

const products = (catalog.products || []).filter((p) => !p.deleted && p.name);
const chains = Array.isArray(catalog.chains?.list) ? catalog.chains.list : DEFAULT_CHAINS;
const zipCode = await zipCodeFor(catalog.home);
const terms = [...new Set(products.map(searchTermFor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
const termsHash = createHash('sha256')
  .update(JSON.stringify({ terms, chains, zipCode, products: products.map((p) => [p.id, p.name, p.brand, p.searchTerm]) }))
  .digest('hex')
  .slice(0, 16);

const outFile = path.join(dataDir, 'angebote/aktuell.json');
const previous = await readJson(outFile);
if (!force && previous?.termsHash === termsHash && berlinDate(previous.fetchedAt) === berlinDate(Date.now())) {
  console.log('Heute schon abgerufen und keine neuen Suchbegriffe – kein neuer Abruf.');
  process.exit(0);
}

console.log(`${products.length} Produkte, ${terms.length} Suchbegriffe, PLZ ${zipCode}, Ketten: ${chains.join(', ')}`);
const keys = await marktguruKeys();

const offers = new Map();
const errors = [];
for (const term of terms) {
  try {
    const results = await searchOffers(keys, term, zipCode);
    for (const raw of results) offers.set(raw.id, simplifyOffer(raw));
    console.log(`  „${term}“: ${results.length} Angebote`);
  } catch (err) {
    errors.push(err.message);
    console.warn(`  ${err.message}`);
  }
  await sleep(1500); // sparsam bleiben
}

if (errors.length === terms.length && terms.length) {
  console.error('Alle Suchen fehlgeschlagen – bisherige Angebote bleiben.');
  process.exit(1);
}

const matches = matchOffers(products, [...offers.values()], { chains })
  .sort((a, b) => a.productId.localeCompare(b.productId) || (a.price ?? 0) - (b.price ?? 0));
await addPennyLinks(matches);

const fetchedAt = new Date().toISOString();
await writeJson(outFile, {
  format: 'myeinkauf-angebote',
  version: 1,
  fetchedAt,
  source: 'Marktguru (inoffiziell)',
  zipCode,
  chains,
  terms,
  termsHash,
  errors,
  matches,
});
console.log(`${matches.length} passende Angebote gespeichert.`);

// ---------- Preisgedächtnis ----------

const historyFile = path.join(dataDir, 'angebote/historie.json');
const history = await readJson(historyFile, {});
const entries = updateHistory(history.entries, matches);
await writeJson(historyFile, {
  format: 'myeinkauf-preishistorie',
  version: 1,
  updatedAt: fetchedAt,
  windowDays: WINDOW_DAYS,
  entries,
});
console.log(`Preisgedächtnis: ${entries.length} Einträge (letzte ${WINDOW_DAYS} Tage).`);

// ---------- Normalpreise aus Open Prices ----------

const since = windowStart().toISOString().slice(0, 10);
const openPrices = {};
for (const p of products.filter((x) => x.ean)) {
  try {
    const url = new URL('https://prices.openfoodfacts.org/api/v1/prices');
    url.search = new URLSearchParams({ product_code: p.ean, date__gte: since, size: '100', order_by: '-date' });
    const res = await fetch(url, { headers: { 'User-Agent': 'MyEinkauf/0.5 (privater Einkaufsplaner)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const summary = summarizeOpenPrices((await res.json()).items, chainFor);
    if (summary) openPrices[p.id] = summary;
  } catch (err) {
    console.warn(`  Open Prices ${p.name}: ${err.message}`);
  }
  await sleep(300);
}
await writeJson(path.join(dataDir, 'angebote/preise.json'), {
  format: 'myeinkauf-normalpreise',
  version: 1,
  updatedAt: fetchedAt,
  source: 'Open Prices (Open Food Facts), ODbL',
  windowDays: WINDOW_DAYS,
  products: openPrices,
});
console.log(`Open Prices: Normalpreise für ${Object.keys(openPrices).length} von ${products.length} Produkten.`);
