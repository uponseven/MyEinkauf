// Feste Kategorien für den Katalog und eine grobe Zuordnung aus Open-Food-Facts-Kategorien.

export const CATEGORIES = [
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

export function guessCategory(tags = [], source = '') {
  if (source === 'Open Beauty Facts') return 'Drogerie & Körperpflege';
  const joined = tags.join(' ');
  for (const [pattern, category] of RULES) {
    if (pattern.test(joined)) return category;
  }
  return '';
}
