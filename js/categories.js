// Kategorien des Katalogs: Standardliste, eigene Liste (in der Datenbank, wird abgeglichen)
// und eine grobe Zuordnung aus Open-Food-Facts-Kategorien.

import { getSetting, saveSetting } from './db.js';

export const DEFAULT_CATEGORIES = [
  'Obst & Gemüse',
  'Brot & Backwaren',
  'Milchprodukte & Eier',
  'Käse',
  'Fleisch & Wurst',
  'Fisch',
  'Tiefkühl',
  'Nudeln, Reis & Getreide',
  'Konserven & Fertiggerichte',
  'Frühstück & Aufstriche',
  'Kaffee & Tee',
  'Süßes & Snacks',
  'Getränke',
  'Alkohol',
  'Gewürze, Öle & Saucen',
  'Backzutaten',
  'Drogerie & Körperpflege',
  'Haushalt & Reinigung',
  'Tierbedarf',
  'Sonstiges',
];

const SETTING_KEY = 'categories';

/** Aktuelle Kategorienliste in der gewählten Reihenfolge. */
export async function getCategories() {
  const setting = await getSetting(SETTING_KEY);
  return Array.isArray(setting?.list) ? setting.list : [...DEFAULT_CATEGORIES];
}

export function saveCategories(list) {
  return saveSetting({ key: SETTING_KEY, list, updatedAt: new Date().toISOString() });
}

// Pflanzliche Alternativen landen in einer eigenen Kategorie, falls es eine gibt
// (z. B. „Soja“, „Pflanzlich“, „Vegan“) – sonst greifen die normalen Regeln.
const PLANT_TAGS = /plant-based|vegan|soy|tofu|meat-analogue|meat-alternative|substitute|plant-milk|oat-based|vegetable-milk/;
const PLANT_NAME = /soja|soya|pflanz|vegan|veggie|vegetar|tofu/i;

// Reihenfolge zählt: der erste Treffer gewinnt. Muster werden gegen die
// englischen OFF-Kategorie-Tags geprüft (z. B. "en:ground-coffees").
const RULES = [
  [/coffee|tea|infusion|cocoa-and-hot/, 'Kaffee & Tee'],
  [/beer|wine|spirit|liqueur|alcoholic/, 'Alkohol'],
  [/beverage|water|juice|soda|drink/, 'Getränke'],
  [/cheese/, 'Käse'],
  [/milk|yogurt|dairy|cream|butter|egg/, 'Milchprodukte & Eier'],
  [/frozen/, 'Tiefkühl'],
  [/fish|seafood|tuna|salmon/, 'Fisch'],
  [/meat|sausage|ham|poultry|salami/, 'Fleisch & Wurst'],
  [/bread|bakery|toast|pastr/, 'Brot & Backwaren'],
  [/pasta|rice|cereal-grain|noodle|flour/, 'Nudeln, Reis & Getreide'],
  [/breakfast|spread|jam|honey|muesli|cereal/, 'Frühstück & Aufstriche'],
  [/chocolate|candies|confection|biscuit|snack|chips|sweet/, 'Süßes & Snacks'],
  [/sauce|condiment|spice|oil|vinegar|ketchup|mustard/, 'Gewürze, Öle & Saucen'],
  [/canned|meal|soup|ready/, 'Konserven & Fertiggerichte'],
  [/fruit|vegetable/, 'Obst & Gemüse'],
  [/baking|sugar|yeast/, 'Backzutaten'],
  [/pet-food|dog|cat-food/, 'Tierbedarf'],
];

/**
 * Schlägt eine Kategorie aus der übergebenen Liste vor, oder '' wenn nichts passt.
 * Kategorien, die der Nutzer gelöscht oder umbenannt hat, werden nie vorgeschlagen.
 */
export function guessCategory(tags = [], source = '', categories = DEFAULT_CATEGORIES) {
  const joined = tags.join(' ');
  const available = (name) => (categories.includes(name) ? name : '');

  if (PLANT_TAGS.test(joined)) {
    const plant = categories.find((c) => PLANT_NAME.test(c));
    if (plant) return plant;
  }
  if (source === 'Open Beauty Facts') return available('Drogerie & Körperpflege');
  for (const [pattern, category] of RULES) {
    if (pattern.test(joined)) return available(category);
  }
  return '';
}
