# MyEinkauf

Persönlicher Einkaufsplaner als Web-App (PWA): Katalog der Lieblingsprodukte, später Angebote,
Märkte und optimierte Einkaufslisten. Ziele und Planung stehen in [CLAUDE.md](CLAUDE.md).

## Stand: Phase 3 – Katalog, Märkte, Angebote

- Barcode scannen mit der Kamera (BarcodeDetector des Browsers, sonst ZXing) oder EAN eintippen
- Name, Marke, Packungsgröße, Bild und Kategorievorschlag aus Open Food Facts
  (danach Open Beauty Facts und Open Products Facts für Drogerieartikel)
- Eigenes Foto als Ersatz, Kategorie, übliche Menge, Schmerzgrenze, Notizen
- Eigene Kategorien verwalten (⚙ → Kategorien), werden mit abgeglichen
- Daten lokal im Browser (IndexedDB), Export/Import als JSON-Datei
- Abgleich zwischen Geräten über ein privates GitHub-Repository (siehe unten)
- Installierbar (Homescreen-Symbol), funktioniert offline
- Märkte: Leipziger Filialen aus OpenStreetMap auf einer Karte, Ketten filtern, Lieblingsfilialen,
  Zuhause festlegen (Sortierung nach Entfernung), Öffnungszeiten mit „geöffnet/geschlossen“

- Angebote: täglich und nach jeder Katalogänderung sucht GitHub Actions im Daten-Repo bei Marktguru nach
  Angeboten für die Katalogprodukte. In der App bestätigst du Treffer einmal („passt / passt nicht“).

Die Filialen kommen als Schnappschuss mit (`data/maerkte-leipzig.json`), weil die Overpass-Server oft
überlastet sind. In der App lassen sie sich live aktualisieren; den Schnappschuss erneuert
`node tools/update-markets.mjs`.

## Lokal starten

Am einfachsten per Doppelklick auf **`MyEinkauf-starten.bat`** (braucht Python). Das startet den
Server und öffnet den Browser; Fenster schließen beendet ihn.

Oder von Hand – kein Build-Schritt nötig, nur ein statischer Webserver:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

oder `npm start`. Dann <http://localhost:8080> öffnen. Die Kamera funktioniert auf `localhost`
auch ohne HTTPS.

Tests (Node 20+):

```bash
npm test
```

## Abgleich zwischen PC und Handy

Der Katalog wird über das private Repository `uponseven/MyEinkauf-daten` abgeglichen:
`katalog/produkte.json` (Produkte ohne Fotos, dazu Kategorien, Lieblingsfilialen, Ketten, Zuhause) und `fotos/<photoId>.jpg`.

Einrichtung pro Gerät unter ⚙ → „Abgleich zwischen Geräten“ mit einem
[Fine-grained Token](https://github.com/settings/personal-access-tokens/new):
nur Repository `MyEinkauf-daten`, Berechtigung *Contents: Read and write*.
Der Token liegt nur im Browser des Geräts (localStorage).

Regeln: pro Produkt gewinnt der neuere Stand (`updatedAt`). Gelöschte Produkte bleiben als
`{id, deleted: true, photoId, updatedAt}` erhalten, damit die Löschung überall ankommt.
Abgeglichen wird beim Öffnen, wenn die App wieder sichtbar wird, nach jeder Änderung und
wenn das Netz zurückkommt. Ohne Netz wird lokal gespeichert und später abgeglichen.

## Angebotsabruf

Der Workflow `.github/workflows/angebote.yml` im Daten-Repo (Vorlage: `tools/angebote-workflow.yml`) checkt
dieses Repo aus und startet `tools/fetch-offers.mjs`. Lokal testen:

```bash
node tools/fetch-offers.mjs <pfad-zum-daten-repo> --force
```

Marktguru ist eine inoffizielle Schnittstelle (nur privat, sparsam: ein Suchbegriff pro Marke, 1,5 s Pause,
kein erneuter Abruf innerhalb von 12 h ohne Katalogänderung).

## Am Handy (GitHub Pages)

Android gibt die Kamera nur über HTTPS frei. Deshalb über GitHub Pages veröffentlichen:

1. Repository auf GitHub anlegen und `main` pushen.
2. *Settings → Pages → Build and deployment*: Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
3. Nach ein bis zwei Minuten unter `https://<benutzer>.github.io/<repo>/` erreichbar.
4. Auf dem Handy in Chrome öffnen → Menü → „Zum Startbildschirm hinzufügen“.

Die Daten liegen pro Gerät im Browser. Zum Übertragen zwischen PC und Handy:
Einstellungen → Katalog exportieren, Datei auf das andere Gerät bringen, dort importieren.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html`, `css/app.css` | Grundgerüst und Gestaltung |
| `js/app.js` | Oberfläche und Navigation (Hash-Routing) |
| `js/db.js` | IndexedDB-Zugriff |
| `js/scanner.js` | Kamera und Barcode-Erkennung |
| `js/off.js` | Abfrage Open Food Facts & Co. |
| `js/categories.js` | Kategorien und Zuordnung aus OFF-Daten |
| `js/backup.js` | Export/Import |
| `js/ean.js` | EAN-Prüfziffer |
| `js/sync.js` | Abgleich über GitHub-Repository |
| `js/markets.js` | Ketten, OSM-Abruf, Öffnungszeiten, Entfernungen |
| `js/markets-view.js` | Ansicht Märkte (Karte, Liste) |
| `data/maerkte-leipzig.json`, `tools/update-markets.mjs` | Filial-Schnappschuss und Skript dafür |
| `js/offers.js`, `js/offers-view.js` | Angebote zuordnen, Ansicht Angebote |
| `tools/fetch-offers.mjs`, `tools/angebote-workflow.yml` | Angebotsabruf (läuft in GitHub Actions des Daten-Repos) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (offline, installierbar) |
| `vendor/zxing/` | ZXing-Barcode-Bibliothek 0.2.1 (Apache-2.0), lokal abgelegt |
| `vendor/leaflet/` | Leaflet 1.9.4 (BSD-2), Kartenbibliothek |

## Datenmodell Produkt

```js
{
  id, ean, name, brand, packageSize,   // packageSize als Text, z. B. "500 g"
  category, usualQty,                   // usualQty = Packungen pro Einkauf
  priceLimit,                           // Schmerzgrenze in € pro Packung oder null
  notes, imageUrl,                      // imageUrl von Open Food Facts
  photo,                                // eigenes Foto (Blob, im Export als Data-URL)
  photoId,                              // ID des Fotos im Daten-Repository, neu je Foto
  deleted,                              // true = gelöscht (Markierung für den Abgleich)
  source, sourceUrl, createdAt, updatedAt
}
```

## Lizenzen der Daten

Filialdaten und Kartenkacheln: © OpenStreetMap-Mitwirkende,
[ODbL](https://www.openstreetmap.org/copyright).
Produktdaten und Bilder: Open Food Facts, Open Beauty Facts und Open Products Facts unter
[ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
