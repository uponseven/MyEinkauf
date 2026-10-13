// Angebote (Marktguru) mit dem Katalog abgleichen.
// Reine Funktionen ohne Browser- oder Datenbankzugriff: laufen in der App und im
// Abruf-Skript (tools/fetch-offers.mjs, GitHub Actions).

// Marktguru-Händler (uniqueName) → Kette der App
const RETAILER_CHAINS = [
  [/^rewe/, 'rewe'],
  [/^kaufland/, 'kaufland'],
  [/^penny/, 'penny'],
  [/^lidl/, 'lidl'],
  [/^edeka(?!-foodservice)/, 'edeka'],
  [/^(dm|dm-drogerie)/, 'dm'],
  [/^konsum/, 'konsum'],
  [/^aldi-nord|^aldi$/, 'aldi'],
  [/^netto/, 'netto'],
  [/^norma/, 'norma'],
  [/^rossmann/, 'rossmann'],
];

export function chainForRetailer(uniqueName = '') {
  for (const [pattern, chain] of RETAILER_CHAINS) {
    if (pattern.test(uniqueName)) return chain;
  }
  return null;
}

// ---------- Text vergleichen ----------

const STOPWORDS = new Set([
  'je', 'versch', 'verschiedene', 'sorten', 'sorte', 'oder', 'und', 'mit', 'ohne', 'aus', 'der', 'die',
  'das', 'für', 'fuer', 'von', 'pckg', 'packung', 'fl', 'flasche', 'dose', 'becher', 'stück', 'stk',
  'g', 'kg', 'ml', 'l', 'cl', 'st', 'hinweis', 'app', 'bonus', 'tlg', 'z', 'b', 'abtropfgewicht', 'aptropfgewicht',
]);

export function normalize(text = '') {
  return text
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Umlaute vereinfachen: ä → a
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokens(text) {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

// Wörter gelten als gleich, wenn eins mit dem anderen beginnt (ab 5 Buchstaben),
// z. B. „joghurt“ ~ „joghurts“, aber nicht „soja“ ~ „sojadrink“ bei kürzeren Wörtern.
function tokenMatches(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

function brandMatches(productBrand, offerBrand, offerText) {
  const pb = normalize(productBrand);
  if (!pb) return false;
  const ob = normalize(offerBrand);
  if (ob && (pb.includes(ob) || ob.includes(pb))) return true;
  return ` ${offerText} `.includes(` ${pb} `);
}

/** Suchbegriff, mit dem ein Produkt bei Marktguru gesucht wird. */
export function searchTermFor(product) {
  if (product.searchTerm?.trim()) return product.searchTerm.trim();
  if (product.brand?.trim()) return product.brand.trim();
  return tokens(product.name).slice(0, 3).join(' ');
}

/**
 * Wie gut passt ein Angebot zu einem Katalogprodukt? 0 … 1, oder 0 wenn es nicht passt.
 */
export function matchScore(product, offer) {
  const offerText = normalize(`${offer.brand || ''} ${offer.title || ''} ${offer.description || ''}`);
  const offerTokens = offerText.split(' ');

  if (product.searchTerm?.trim()) {
    const term = normalize(product.searchTerm);
    if (term && ` ${offerText} `.includes(` ${term} `)) return 1;
  }

  const brandTokens = new Set(tokens(product.brand || ''));
  let wanted = tokens(product.name).filter((t) => !brandTokens.has(t));
  if (!wanted.length) wanted = tokens(product.name);
  if (!wanted.length) return 0;

  const hits = wanted.filter((w) => offerTokens.some((o) => tokenMatches(w, o))).length;
  const score = hits / wanted.length;
  const brandOk = brandMatches(product.brand, offer.brand, offerText);

  if (brandOk && score >= 0.5) return Math.round(score * 100) / 100;
  if (!product.brand && score >= 0.8) return Math.round(score * 100) / 100;
  return 0;
}

/**
 * Schlüssel für die Entscheidung „passt / passt nicht“. Gleiche Angebote in späteren
 * Prospekten (gleiche Marke + gleicher Produktname) werden so automatisch wiedererkannt.
 */
export function decisionKey(productId, offer) {
  return `${productId}|${normalize(`${offer.brand || ''} ${offer.title || ''}`)}`;
}

// ---------- Marktguru-Angebot vereinfachen ----------

// "MIT APP 0,10 € REWE BONUS" → 0.10
export function parseReweBonus(description = '') {
  const m = description.match(/(\d+[.,]\d{2})\s*\S?\s*REWE\s*BONUS/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function simplifyOffer(raw) {
  const retailer = raw.advertisers?.[0] || {};
  const validity = raw.validityDates?.[0] || {};
  return {
    offerId: raw.id,
    chain: chainForRetailer(retailer.uniqueName),
    retailer: retailer.name || '',
    title: raw.product?.name || '',
    brand: raw.brand?.name || '',
    description: raw.description || '',
    price: raw.price ?? null,
    oldPrice: raw.oldPrice ?? null,
    referencePrice: raw.referencePrice ?? null,
    unit: raw.unit?.shortName || '',
    volume: raw.volume ?? null,
    quantity: raw.quantity ?? null,
    validFrom: validity.from || null,
    validTo: validity.to || null,
    loyalty: !!raw.requiresLoyalityMembership,
    reweBonus: parseReweBonus(raw.description),
    image: raw.images?.count ? `https://mg2de.b-cdn.net/api/v1/offers/${raw.id}/images/default/0/small.webp` : '',
  };
}

/**
 * Ordnet Angebote den Katalogprodukten zu.
 * @returns {Array} Treffer: Angebot + productId, score, key
 */
export function matchOffers(products, offers, { chains, now = new Date() } = {}) {
  const live = products.filter((p) => !p.deleted && p.name);
  const seen = new Set();
  const result = [];
  for (const offer of offers) {
    if (!offer.chain || (chains && !chains.includes(offer.chain))) continue;
    if (offer.validTo && new Date(offer.validTo) < now) continue;
    for (const product of live) {
      const score = matchScore(product, offer);
      if (!score) continue;
      const id = `${product.id}|${offer.offerId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ ...offer, productId: product.id, score, key: decisionKey(product.id, offer) });
    }
  }
  return result;
}

// ---------- Packungsgröße ----------

/** "175g" → { amount: 0.175, unit: 'kg' }, "1,5 l" → { amount: 1.5, unit: 'l' } */
export function parsePackageSize(text = '') {
  const m = String(text).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case 'g': return { amount: n / 1000, unit: 'kg' };
    case 'kg': return { amount: n, unit: 'kg' };
    case 'ml': return { amount: n / 1000, unit: 'l' };
    case 'cl': return { amount: n / 100, unit: 'l' };
    default: return { amount: n, unit: 'l' };
  }
}

/** Unterscheidet sich die Angebotsgröße deutlich von der Katalog-Packung? */
export function sizeDiffers(product, offer) {
  const own = parsePackageSize(product.packageSize);
  if (!own || !offer.volume || !offer.unit || offer.unit !== own.unit) return false;
  return Math.abs(offer.volume - own.amount) / own.amount > 0.1;
}
