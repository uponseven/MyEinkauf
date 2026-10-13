// Produktsuche per Barcode in Open Food Facts und den Schwesterdatenbanken.
// Daten unter ODbL, siehe https://world.openfoodfacts.org/terms-of-use

const SOURCES = [
  { name: 'Open Food Facts', base: 'https://world.openfoodfacts.org' },
  { name: 'Open Beauty Facts', base: 'https://world.openbeautyfacts.org' },
  { name: 'Open Products Facts', base: 'https://world.openproductsfacts.org' },
];

const FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'generic_name_de',
  'brands',
  'quantity',
  'image_front_url',
  'image_url',
  'categories_tags',
].join(',');

async function fetchFrom(source, ean) {
  const url = `${source.base}/api/v2/product/${ean}.json?fields=${FIELDS}`;
  const res = await fetch(url);
  // Unbekannte Produkte liefern 404 mit status 0.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status}`);
  const json = await res.json();
  return json.status === 1 ? json.product : null;
}

/**
 * Sucht ein Produkt nacheinander in allen Quellen.
 * @returns {Promise<object|null>} vereinfachte Produktdaten oder null, wenn nicht gefunden.
 * Wirft nur, wenn keine Quelle erreichbar war.
 */
export async function lookupEan(ean) {
  let reachable = false;
  for (const source of SOURCES) {
    let p;
    try {
      p = await fetchFrom(source, ean);
      reachable = true;
    } catch (err) {
      console.warn(err);
      continue;
    }
    if (!p) continue;
    const brand = (p.brands || '').split(',')[0].trim();
    return {
      name: p.product_name_de || p.product_name || p.generic_name_de || '',
      brand,
      // Das ℮-Zeichen (Füllmenge geschätzt) steht oft als nachgestelltes "e" in den Daten.
      packageSize: (p.quantity || '').replace(/\s*℮\s*$|\s+e$/, '').trim(),
      imageUrl: p.image_front_url || p.image_url || '',
      categoryTags: p.categories_tags || [],
      source: source.name,
      sourceUrl: `${source.base}/product/${ean}`,
    };
  }
  if (!reachable) throw new Error('Produktdatenbank nicht erreichbar (offline?)');
  return null;
}
