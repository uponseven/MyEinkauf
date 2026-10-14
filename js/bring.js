// Bring!-Einkaufsliste: Antworten der (inoffiziellen) Schnittstelle vereinfachen und
// Bring!-Einträge Katalogprodukten zuordnen. Reine Funktionen für App und Abruf-Skript.

import { normalize, tokens } from './offers.js';

/** Bring!-Liste (alte und neue Antwortform) → [{ name, specification, uuid }] */
export function parseBringList(json = {}) {
  const purchase = json.items?.purchase ?? json.purchase ?? [];
  return purchase
    .map((item) => ({
      name: (item.itemId ?? item.name ?? '').trim(),
      specification: (item.specification ?? '').trim(),
      uuid: item.uuid || null,
    }))
    .filter((item) => item.name);
}

/**
 * Schlüssel, unter dem die Zuordnung eines Bring!-Eintrags gespeichert wird.
 * Mit Beschreibung („Käse“ + „Bavaria Blu“) gilt die Zuordnung nur für genau diese Kombination,
 * damit ein schlichtes „Käse“ später etwas anderes meinen darf.
 */
export function bringKey(name, specification = '') {
  const spec = normalize(specification);
  return spec ? `${normalize(name)}|${spec}` : normalize(name);
}

/**
 * Katalogprodukte, die zu einem Bring!-Eintrag passen könnten, beste zuerst.
 * Berücksichtigt Name, Marke, Kategorie und die Bring!-Beschreibung (z. B. „Alpro“).
 */
export function suggestProducts(item, products, limit = 5) {
  const wanted = tokens(`${item.name} ${item.specification || ''}`);
  if (!wanted.length) return [];
  const scored = [];
  for (const p of products) {
    if (p.deleted) continue;
    const nameTokens = tokens(p.name);
    const extraTokens = tokens(`${p.brand || ''} ${p.category || ''} ${p.searchTerm || ''}`);
    let score = 0;
    for (const w of wanted) {
      if (nameTokens.some((t) => t === w)) score += 3;
      else if (nameTokens.some((t) => w.length >= 4 && (t.startsWith(w) || w.startsWith(t) || t.includes(w)))) score += 2;
      else if (extraTokens.some((t) => t === w || (w.length >= 4 && t.startsWith(w)))) score += 1;
    }
    if (normalize(p.name) === normalize(item.name)) score += 5;
    if (score > 0) scored.push({ product: p, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'de'))
    .slice(0, limit);
}

/**
 * Verbindet die Bring!-Liste mit den gespeicherten Zuordnungen.
 * @returns [{ ...item, key, productId | null, status: 'mapped' | 'none' | 'open' }]
 */
export function resolveItems(items, mapping = {}, products = []) {
  const ids = new Set(products.filter((p) => !p.deleted).map((p) => p.id));
  return items.map((item) => {
    const key = bringKey(item.name, item.specification);
    // Erst die genaue Kombination aus Name und Beschreibung, sonst die Zuordnung für den Namen allein.
    const target = mapping[key] ?? mapping[bringKey(item.name)];
    if (target === 'none') return { ...item, key, productId: null, status: 'none' };
    if (target && ids.has(target)) return { ...item, key, productId: target, status: 'mapped' };
    return { ...item, key, productId: null, status: 'open' };
  });
}
