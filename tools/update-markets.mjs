// Aktualisiert den Filial-Schnappschuss data/maerkte-leipzig.json aus OpenStreetMap.
//   node tools/update-markets.mjs                 (live von Overpass)
//   node tools/update-markets.mjs antwort.json    (aus gespeicherter Overpass-Antwort)

import { readFile, writeFile } from 'node:fs/promises';
import { OVERPASS_QUERY, parseOverpass, fetchMarketsLive, CITY } from '../js/markets.js';

const target = new URL('../data/maerkte-leipzig.json', import.meta.url);
const source = process.argv[2];

const markets = source
  ? parseOverpass(JSON.parse(await readFile(source, 'utf8')))
  : await fetchMarketsLive();

const data = {
  city: CITY,
  source: 'OpenStreetMap-Mitwirkende, ODbL',
  query: OVERPASS_QUERY,
  loadedAt: new Date().toISOString(),
  markets,
};
await writeFile(target, `${JSON.stringify(data, null, 1)}\n`);

const perChain = Object.entries(Object.groupBy(markets, (m) => m.chain))
  .map(([chain, list]) => `${chain} ${list.length}`).join(', ');
console.log(`${markets.length} Märkte gespeichert: ${perChain}`);
